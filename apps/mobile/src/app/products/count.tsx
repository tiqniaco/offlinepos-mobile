import { useCallback, useEffect, useRef, useState } from 'react';
import { fonts } from '../../ui/fonts';
import { Alert, TextInput, View, Platform } from 'react-native';
import { Pressable } from '../../ui/Press';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import Animated, { FadeIn, FadeInUp, LinearTransition } from 'react-native-reanimated';
import { normalizeBarcode, normalizeDigits } from '@daftarak/shared';
import { Screen, Text, Button, Card, Icon, Sheet, QtyField, EmptyState, Chip, TextField, SectionTitle, colors, shadow } from '../../ui';
import { Pulse } from '../../ui/Pulse';
import { getDb } from '../../db/client';
import { countItem, countLines, discardCount, getOpenCount, openCount, postCount, removeCountItem, type CountLine, type OpenCount } from '../../domain/inventory/adjust';
import { countProgress, diffValue } from '../../domain/inventory/counts';
import { listCategories } from '../../domain/inventory/catalog';
import { findByBarcode, listProducts } from '../../domain/inventory/products';
import { InventoryError } from '../../domain/inventory/context';
import { useInvCtx, useCan, useCurrency } from '../../features/inventory/useInvCtx';
import { invErrorMessage } from '../../features/inventory/errors';
import { useScanner } from '../../state/scanner';
import { fx } from '../../ui/fx';
import { toast } from '../../state/toast';
import { money, qty } from '../../lib/format';

type Cat = { id: string; name: string; color: string | null };
type Hit = { id: string; name: string; variantLabel: string | null; unitName: string };

const timeLabel = (lang: string, ms: number) => new Date(ms).toLocaleTimeString(lang === 'en' ? 'en-GB' : 'ar-EG-u-nu-latn', { hour: 'numeric', minute: '2-digit' });

/** Start a count: optional name + scope (all products or one category). Nothing is created until «ابدأ». */
function StartCount({ cats, onStart, busy }: { cats: Cat[]; onStart: (note: string, categoryId: string | null) => void; busy: boolean }) {
  const { t } = useTranslation();
  const [note, setNote] = useState('');
  const [cat, setCat] = useState<string | null>(null);
  return (
    <Screen back title={t('count.newTitle')} footer={<Button testID="count-start" icon="clipboard" title={t('count.start')} loading={busy} onPress={() => onStart(note, cat)} />}>
      <Card>
        <View style={{ gap: 6 }}>
          <Text variant="title">{t('count.startHeadline')}</Text>
          <Text variant="caption">{t('count.startHint')}</Text>
        </View>
      </Card>
      <TextField testID="count-note" label={t('count.nameLabel')} placeholder={t('count.namePh')} value={note} onChangeText={setNote} maxLength={60} />
      <SectionTitle>{t('count.scopeLabel')}</SectionTitle>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Chip testID="count-scope-all" label={t('count.scopeAll')} selected={cat === null} onPress={() => setCat(null)} />
        {cats.map((c) => (
          <Chip key={c.id} label={c.name} dot={c.color} selected={cat === c.id} onPress={() => setCat(c.id)} />
        ))}
      </View>
      <Text variant="caption">{cat ? t('count.scopeCatHint') : t('count.scopeAllHint')}</Text>
      <Button kind="ghost" icon="chart" title={t('countReport.title')} onPress={() => router.push('/products/counts')} />
    </Screen>
  );
}

function Stepper({ onMinus, onPlus }: { onMinus: () => void; onPlus: () => void }) {
  const b = (icon: 'minus' | 'plus', on: () => void, primary: boolean) => (
    <Pressable
      hitSlop={6}
      onPress={on}
      accessibilityRole="button"
      accessibilityLabel={icon === 'plus' ? '+1' : '-1'}
      style={({ pressed }) => ({ width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: primary ? (pressed ? colors.primary[100] : colors.primary[50]) : pressed ? colors.paper.line : colors.paper.card })}
    >
      <Icon name={icon} size={20} color={primary ? colors.primary[700] : colors.ink.soft} />
    </Pressable>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, direction: 'ltr', backgroundColor: colors.paper.sunk, borderRadius: 14, padding: 3 }}>
      {b('minus', onMinus, false)}
      {b('plus', onPlus, true)}
    </View>
  );
}

function Badge({ label, value, tone }: { label: string; value: string; tone: 'ink' | 'leaf' | 'rose' | 'sky' }) {
  const fg = tone === 'leaf' ? colors.leaf[700] : tone === 'rose' ? colors.rose[700] : tone === 'sky' ? colors.sky[700] : colors.ink.soft;
  const bg = tone === 'leaf' ? colors.leaf[50] : tone === 'rose' ? colors.rose[50] : tone === 'sky' ? colors.sky[50] : colors.paper.sunk;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2, backgroundColor: bg }}>
      <Text style={{ fontFamily: fonts.medium, fontSize: 11.5, lineHeight: 17, color: fg }}>{label}</Text>
      <Text style={{ fontFamily: fonts.bold, fontSize: 12, lineHeight: 17, color: fg }}>{value}</Text>
    </View>
  );
}

/**
 * Stock count (جرد): scan / search / +− — every change is written immediately (resumes after leaving), progress
 * «اتعدّ 34 من 120», and a clear summary (shortage / surplus at cost) before «اعتمد الجرد».
 */
export default function StockCount() {
  const { t, i18n } = useTranslation();
  const ctx = useInvCtx();
  const currency = useCurrency();
  const costView = useCan('cost.view');
  const [phase, setPhase] = useState<'loading' | 'start' | 'count'>('loading');
  const [open, setOpen] = useState<OpenCount | null>(null);
  const [cats, setCats] = useState<Cat[]>([]);
  const [lines, setLines] = useState<CountLine[]>([]);
  const [progress, setProgress] = useState({ counted: 0, total: 0, missing: 0 });
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [code, setCode] = useState('');
  const [search, setSearch] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [edit, setEdit] = useState<CountLine | null>(null);
  const [editQty, setEditQty] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState(false);
  const [missing, setMissing] = useState<'keep' | 'zero'>('keep');
  const [lastId, setLastId] = useState<string | null>(null);
  const docId = open?.id ?? null;
  const writes = useRef(0);
  /** Last scan failed (not found / other category) → error toast for hardware-scanner input. */
  const scanFailed = useRef(false);

  const reload = useCallback(
    async (id: string) => {
      try {
        const db = getDb();
        const [ls, pr] = await Promise.all([countLines(db, id), countProgress(db, id)]);
        setLines(ls);
        setProgress(pr);
      } catch (e) {
        toast(invErrorMessage(t, e), 'error');
      }
    },
    [t],
  );

  useEffect(() => {
    void listCategories(getDb()).then((c) => setCats(c.map((x) => ({ id: x.id, name: x.name, color: x.color ?? null }))), () => undefined);
    void getOpenCount(getDb()).then(
      (o) => {
        if (!o) return setPhase('start');
        setOpen(o);
        setSavedAt(Date.now());
        setPhase('count');
        void reload(o.id);
      },
      (e) => toast(invErrorMessage(t, e), 'error'),
    );
  }, [reload, t]);

  const start = async (note: string, categoryId: string | null) => {
    if (!ctx || busy) return;
    setBusy(true);
    try {
      await openCount(ctx, { note, categoryId });
      const o = await getOpenCount(getDb());
      setOpen(o);
      setPhase('count');
      if (o) void reload(o.id);
    } catch (e) {
      toast(invErrorMessage(t, e), 'error');
    } finally {
      setBusy(false);
    }
  };

  /** Every write goes through here: «بيتحفظ…» → «اتحفظ ✓ 10:42». */
  const write = useCallback(
    async (fn: () => Promise<unknown>, productId?: string) => {
      if (!docId) return;
      writes.current++;
      setSaving(true);
      try {
        await fn();
        setSavedAt(Date.now());
        if (productId) setLastId(productId);
        await reload(docId);
      } finally {
        if (--writes.current === 0) setSaving(false);
      }
    },
    [docId, reload],
  );

  const scopeError = (e: unknown) => {
    scanFailed.current = true;
    if (e instanceof InventoryError && e.code === 'out_of_scope') {
      fx.warn();
      return t('count.outOfScope', { name: String(e.detail?.name ?? '') });
    }
    fx.error();
    return invErrorMessage(t, e);
  };

  const handleCode = useCallback(
    async (raw: string): Promise<string | null> => {
      if (!ctx || !docId) return t('common.loading');
      scanFailed.current = false;
      const hit = await findByBarcode(getDb(), raw);
      if (!hit) {
        scanFailed.current = true;
        fx.notFound();
        return t('count.notFound');
      }
      try {
        await write(() => countItem(ctx, docId, hit.productId, hit.factorMilli, 'add'), hit.productId);
      } catch (e) {
        return scopeError(e);
      }
      fx.scan();
      const l = (await countLines(getDb(), docId)).find((x) => x.productId === hit.productId);
      return l ? `${l.name}: ${qty(l.countedMilli)}` : null;
    },
    [ctx, docId, t, write], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Search by name (products without barcodes): results limited to the count's category.
  useEffect(() => {
    const q = search.trim();
    if (!q) return setHits([]);
    const h = setTimeout(() => {
      void listProducts(getDb(), { search: q, categoryId: open?.categoryId ?? undefined, limit: 8 }).then(
        (rs) => setHits(rs.filter((r) => r.trackStock).map((r) => ({ id: r.id, name: r.name, variantLabel: r.variantLabel, unitName: r.unitName }))),
        () => setHits([]),
      );
    }, 180);
    return () => clearTimeout(h);
  }, [search, open?.categoryId]);

  const step = async (productId: string, deltaMilli: number) => {
    if (!ctx || !docId) return;
    try {
      await write(() => countItem(ctx, docId, productId, deltaMilli, 'add'), productId);
      if (deltaMilli > 0) fx.add();
      else fx.remove();
    } catch (e) {
      toast(scopeError(e), 'error');
    }
  };

  const discard = () =>
    Alert.alert(t('count.discard'), t('count.confirmDiscardKeep'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('count.discard'),
        style: 'destructive',
        onPress: async () => {
          if (!ctx || !docId) return;
          setBusy(true);
          try {
            await discardCount(ctx, docId);
            router.back();
          } catch (e) {
            toast(invErrorMessage(t, e), 'error');
          } finally {
            setBusy(false);
          }
        },
      },
    ]);

  const saveEdit = async (remove: boolean) => {
    if (!ctx || !docId || !edit) return;
    const id = edit.productId;
    try {
      await write(() => (remove ? removeCountItem(ctx, docId, id) : countItem(ctx, docId, id, editQty ?? 0, 'set')), remove ? undefined : id);
      if (remove) fx.remove();
      setEdit(null);
    } catch (e) {
      toast(invErrorMessage(t, e), 'error');
    }
  };

  const post = async () => {
    if (!ctx || !docId || busy) return;
    setBusy(true);
    try {
      const r = await postCount(ctx, docId, { missing });
      fx.success();
      setReview(false);
      toast(t('count.posted', { number: r.number, n: r.changed + r.zeroed }), 'success');
      router.replace({ pathname: '/products/count-report', params: { id: docId } });
    } catch (e) {
      fx.error();
      toast(invErrorMessage(t, e), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (phase === 'loading') return <Screen back title={t('count.title')}>{null}</Screen>;
  if (phase === 'start') return <StartCount cats={cats} busy={busy} onStart={(n, c) => void start(n, c)} />;

  const catName = open?.categoryId ? (cats.find((c) => c.id === open.categoryId)?.name ?? '') : null;
  const short = lines.reduce((s, l) => (l.countedMilli < l.expectedMilli ? s + diffValue(l.expectedMilli - l.countedMilli, l.unitCostMinor) : s), 0);
  const surplus = lines.reduce((s, l) => (l.countedMilli > l.expectedMilli ? s + diffValue(l.countedMilli - l.expectedMilli, l.unitCostMinor) : s), 0);
  const shortItems = lines.filter((l) => l.countedMilli < l.expectedMilli).length;
  const surplusItems = lines.filter((l) => l.countedMilli > l.expectedMilli).length;
  const pct = progress.total ? Math.min(1, progress.counted / progress.total) : 0;
  const m = (v: number) => money(v, currency, i18n.language);

  return (
    <Screen
      back
      title={open?.note || t('count.title')}
      subtitle={catName ? t('count.scopeOne', { name: catName }) : t('count.scopeAll')}
      right={<Button compact kind="ghost" title={t('count.discard')} disabled={busy} onPress={discard} />}
      footer={<Button testID="count-post" icon="check" title={t('count.post')} disabled={!lines.length || busy} onPress={() => setReview(true)} />}
    >
      {/* Progress + saved indicator */}
      <Card>
        <View style={{ gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <Text testID="count-progress" style={{ fontFamily: fonts.bold, fontSize: 17, lineHeight: 26, color: colors.ink.DEFAULT }}>
              {t('count.progress', { n: progress.counted, total: progress.total })}
            </Text>
            <Animated.View key={saving ? 'saving' : `saved-${savedAt ?? 0}`} entering={FadeIn.duration(180)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 99, paddingHorizontal: 9, paddingVertical: 3, backgroundColor: saving ? colors.paper.sunk : colors.leaf[50] }}>
              <Icon name={saving ? 'clock' : 'check'} size={14} color={saving ? colors.ink.soft : colors.leaf[700]} tint="transparent" />
              <Text testID="count-saved" style={{ fontFamily: fonts.semibold, fontSize: 12, lineHeight: 18, color: saving ? colors.ink.soft : colors.leaf[700] }}>
                {saving ? t('count.saving') : savedAt ? t('count.savedAt', { time: timeLabel(i18n.language, savedAt) }) : t('count.saved')}
              </Text>
            </Animated.View>
          </View>
          <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.paper.sunk, overflow: 'hidden' }}>
            <Animated.View layout={LinearTransition.duration(250)} style={{ width: `${Math.round(pct * 100)}%`, height: 8, borderRadius: 4, backgroundColor: colors.primary[500] }} />
          </View>
          <Text variant="caption">{t('count.autoSaveHint')}</Text>
        </View>
      </Card>

      {/* Big scan button + hardware scanner input + search by name */}
      <Button
        testID="count-scan"
        icon="scan"
        title={t('count.scan')}
        disabled={!docId}
        onPress={() => {
          useScanner.getState().set({ continuous: true, onCode: handleCode });
          router.push('/scan');
        }}
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, height: 50, borderRadius: 14, borderWidth: 2, borderColor: colors.paper.line, paddingHorizontal: 12, backgroundColor: colors.paper.card }}>
        <Icon name="search" color={colors.ink.faint} size={20} />
        <TextInput
          maxFontSizeMultiplier={1.15}
          testID="count-input"
          value={search || code}
          editable={!!docId}
          onChangeText={(v) => {
            const d = normalizeDigits(v);
            // Digits only → a barcode typed by a hardware scanner; anything else → name search.
            if (/^\d*$/.test(d)) {
              setCode(d);
              setSearch('');
            } else {
              setSearch(v);
              setCode('');
            }
          }}
          onSubmitEditing={async () => {
            const c = normalizeBarcode(code);
            setCode('');
            if (!c) return;
            const msg = await handleCode(c).catch((e: unknown) => scopeError(e));
            if (msg) toast(msg, scanFailed.current ? 'error' : 'success');
          }}
          blurOnSubmit={false}
          placeholder={t('count.searchPh')}
          placeholderTextColor={colors.ink.faint}
          style={[{ flex: 1, minWidth: 0, fontSize: 16, color: colors.ink.DEFAULT, textAlign: i18n.language === 'en' ? 'left' : 'right', fontFamily: fonts.medium }, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null]}
        />
        {search || code ? (
          <Pressable hitSlop={8} onPress={() => (setSearch(''), setCode(''))}>
            <Icon name="backspace" size={18} color={colors.ink.faint} />
          </Pressable>
        ) : null}
      </View>
      {hits.length ? (
        <View style={[{ borderRadius: 16, backgroundColor: colors.paper.card, overflow: 'hidden' }, shadow.soft]}>
          {hits.map((h, i) => (
            <Pressable
              key={h.id}
              onPress={() => {
                setSearch('');
                void step(h.id, 1000);
              }}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderTopWidth: i ? 1 : 0, borderColor: colors.paper.line, backgroundColor: pressed ? colors.paper.sunk : 'transparent' })}
            >
              <Icon name="plus" size={18} color={colors.primary[600]} />
              <Text style={{ flex: 1, fontFamily: fonts.semibold, fontSize: 15, lineHeight: 22, color: colors.ink.DEFAULT }}>
                {h.name}
                {h.variantLabel ? ` · ${h.variantLabel}` : ''}
              </Text>
              <Text variant="caption">+1 {h.unitName}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {lines.length === 0 ? (
        <EmptyState icon="clipboard" hue="sky" title={t('count.empty')} body={t('count.intro')} />
      ) : (
        lines.map((l) => {
          const diff = l.countedMilli - l.expectedMilli;
          return (
            <Animated.View key={l.productId} entering={FadeInUp.springify().damping(18)} layout={LinearTransition.springify().damping(20)}>
              <Pulse trigger={l.countedMilli} active={l.productId === lastId}>
                <Pressable
                  onPress={() => {
                    setEdit(l);
                    setEditQty(l.countedMilli);
                  }}
                  style={[{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 18, backgroundColor: l.productId === lastId ? colors.primary[50] : colors.paper.card, borderWidth: 1.5, borderColor: l.productId === lastId ? colors.primary[200] : 'transparent' }, shadow.soft]}
                >
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text numberOfLines={2} style={{ fontFamily: fonts.semibold, fontSize: 15, lineHeight: 22, color: colors.ink.DEFAULT }}>
                      {l.name}
                      {l.variantLabel ? ` · ${l.variantLabel}` : ''}
                    </Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                      <Badge tone="ink" label={t('count.system')} value={qty(l.expectedMilli)} />
                      <Badge tone="sky" label={t('count.counted')} value={qty(l.countedMilli)} />
                      <Badge tone={diff === 0 ? 'leaf' : diff > 0 ? 'sky' : 'rose'} label={diff === 0 ? t('countReport.match') : diff > 0 ? t('countReport.surplus') : t('countReport.short')} value={diff === 0 ? '✓' : `${diff > 0 ? '+' : ''}${qty(diff)}`} />
                    </View>
                  </View>
                  <Stepper onMinus={() => void step(l.productId, -1000)} onPlus={() => void step(l.productId, 1000)} />
                </Pressable>
              </Pulse>
            </Animated.View>
          );
        })
      )}

      {/* Edit exact quantity */}
      <Sheet
        visible={!!edit}
        onClose={() => setEdit(null)}
        title={edit?.name}
        footer={
          <>
            <Button title={t('common.save')} loading={saving} onPress={() => void saveEdit(false)} />
            <Button kind="danger" icon="trash" title={t('count.removeItem')} disabled={saving} onPress={() => void saveEdit(true)} />
          </>
        }
      >
        {edit ? <Text variant="caption">{t('count.system')}: {qty(edit.expectedMilli)} {edit.unitName}</Text> : null}
        <QtyField label={t('count.setQty')} valueMilli={editQty} onValue={setEditQty} autoFocus />
      </Sheet>

      {/* Summary before posting */}
      <Sheet
        visible={review}
        onClose={() => setReview(false)}
        title={t('count.reviewTitle')}
        footer={
          <>
            <Button testID="count-confirm" icon="check" title={t('count.post')} loading={busy} onPress={() => void post()} />
            <Button kind="ghost" title={t('count.keepCounting')} disabled={busy} onPress={() => setReview(false)} />
          </>
        }
      >
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1, padding: 12, borderRadius: 14, backgroundColor: colors.rose[50], gap: 2 }}>
            <Text style={{ fontFamily: fonts.medium, fontSize: 12.5, lineHeight: 18, color: colors.rose[700] }}>{t('countReport.shortTitle', { n: shortItems })}</Text>
            <Text testID="count-review-short" style={{ fontFamily: fonts.bold, fontSize: 18, lineHeight: 26, color: colors.rose[700] }}>{costView ? m(short) : shortItems}</Text>
          </View>
          <View style={{ flex: 1, padding: 12, borderRadius: 14, backgroundColor: colors.sky[50], gap: 2 }}>
            <Text style={{ fontFamily: fonts.medium, fontSize: 12.5, lineHeight: 18, color: colors.sky[700] }}>{t('countReport.surplusTitle', { n: surplusItems })}</Text>
            <Text style={{ fontFamily: fonts.bold, fontSize: 18, lineHeight: 26, color: colors.sky[700] }}>{costView ? m(surplus) : surplusItems}</Text>
          </View>
        </View>
        <Text variant="subtitle">{t('count.reviewItems', { n: lines.length, match: lines.length - shortItems - surplusItems })}</Text>
        {costView ? <Text variant="caption">{t('count.reviewNet', { v: m(surplus - short) })}</Text> : null}
        {progress.missing > 0 ? (
          <View style={{ gap: 8, padding: 12, borderRadius: 14, backgroundColor: colors.amber[50] }}>
            <Text style={{ fontFamily: fonts.semibold, fontSize: 14, lineHeight: 21, color: colors.amber[700] }}>{t('count.missingQ', { n: progress.missing })}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Chip testID="count-missing-keep" label={t('count.missingKeep')} selected={missing === 'keep'} onPress={() => setMissing('keep')} />
              <Chip testID="count-missing-zero" label={t('count.missingZero')} selected={missing === 'zero'} onPress={() => setMissing('zero')} />
            </View>
            <Text variant="caption">{missing === 'keep' ? t('count.missingKeepHint') : t('count.missingZeroHint')}</Text>
          </View>
        ) : null}
      </Sheet>
    </Screen>
  );
}
