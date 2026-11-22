import { useEffect, useState } from 'react';
import { Image, Pressable, Switch, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as ImagePicker from 'expo-image-picker';
import { internalBarcode, normalizeBarcode, uuidv7 } from '@daftarak/shared';
import { Screen, Text, Button, TextField, MoneyField, QtyField, Card, SectionTitle, Chip, Icon, Banner, Sheet, colors } from '../../ui';
import { getDb } from '../../db/client';
import { createProduct, getProduct, updateProduct, type ProductInput } from '../../domain/inventory/products';
import { listCategories, listUnits, saveCategory } from '../../domain/inventory/catalog';
import { useCan, useInvCtx } from '../../features/inventory/useInvCtx';
import { invErrorMessage } from '../../features/inventory/errors';
import { useScanner } from '../../state/scanner';
import { toast } from '../../state/toast';
import { saveProductImage } from '../../features/inventory/images';
import { useApp } from '../../state/app';

type Unit = Awaited<ReturnType<typeof listUnits>>[number];
type Cat = Awaited<ReturnType<typeof listCategories>>[number];

function Toggle({ label, hint, value, onChange, disabled }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, opacity: disabled ? 0.5 : 1 }}>
      <View style={{ flex: 1 }}>
        <Text variant="subtitle">{label}</Text>
        {hint ? <Text variant="caption">{hint}</Text> : null}
      </View>
      <Switch disabled={disabled} value={value} onValueChange={onChange} trackColor={{ true: colors.primary[500], false: colors.paper.line }} />
    </View>
  );
}

export default function ProductForm() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ id?: string; barcode?: string }>();
  const editing = !!params.id;
  const ctx = useInvCtx();
  const canCost = useCan('cost.view');
  const canPrice = useCan('price.change');
  const device = useApp((s) => s.device);
  const multiUnit = ctx?.features.includes('multi_unit') ?? false;
  const expiryFeature = ctx?.features.includes('expiry') ?? false;

  const [units, setUnits] = useState<Unit[]>([]);
  const [cats, setCats] = useState<Cat[]>([]);
  const [name, setName] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [sku, setSku] = useState('');
  const [notes, setNotes] = useState('');
  const [barcode, setBarcode] = useState(params.barcode ? normalizeBarcode(params.barcode) : '');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [baseUnitId, setBaseUnitId] = useState<string | null>(null);
  const [cost, setCost] = useState<number | null>(null);
  const [retail, setRetail] = useState<number | null>(null);
  const [wholesale, setWholesale] = useState<number | null>(null);
  const [trackStock, setTrackStock] = useState(true);
  const [trackExpiry, setTrackExpiry] = useState(false);
  const [opening, setOpening] = useState<number | null>(null);
  const [lowStock, setLowStock] = useState<number | null>(null);
  const [hasLarger, setHasLarger] = useState(false);
  const [largerUnitId, setLargerUnitId] = useState<string | null>(null);
  const [factor, setFactor] = useState<number | null>(null);
  const [largerPrice, setLargerPrice] = useState<number | null>(null);
  const [largerBarcode, setLargerBarcode] = useState('');
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [variantLabel, setVariantLabel] = useState<string | null>(null);
  const [showMore, setShowMore] = useState(false);
  const [newCat, setNewCat] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const db = getDb();
    void (async () => {
      const [u, c] = await Promise.all([listUnits(db), listCategories(db)]);
      setUnits(u);
      setCats(c);
      if (!editing) {
        setBaseUnitId(u.find((x) => x.nameAr === 'قطعة')?.id ?? u[0]?.id ?? null);
        setLargerUnitId(u.find((x) => x.nameAr === 'كرتونة')?.id ?? null);
        return;
      }
      const d = await getProduct(db, params.id!);
      if (!d) return;
      const p = d.product;
      setName(p.name);
      setNameEn(p.nameEn ?? '');
      setSku(p.sku ?? '');
      setNotes(p.notes ?? '');
      setCategoryId(p.categoryId);
      setBaseUnitId(p.baseUnitId);
      setCost(p.costMinor);
      setRetail(p.retailPriceMinor);
      setWholesale(p.wholesalePriceMinor);
      setTrackStock(p.trackStock);
      setTrackExpiry(p.trackExpiry);
      setLowStock(p.lowStockMilli);
      setImagePath(p.imagePath);
      setVariantLabel(p.variantLabel);
      const base = d.units.find((x) => x.isBase)!;
      const larger = d.units.find((x) => !x.isBase);
      setBarcode(d.barcodes.find((b) => b.productUnitId === base.id)?.code ?? '');
      if (larger) {
        setHasLarger(true);
        setLargerUnitId(larger.unitId);
        setFactor(larger.factorMilli);
        setLargerPrice(larger.retailPriceMinor);
        setLargerBarcode(d.barcodes.find((b) => b.productUnitId === larger.id)?.code ?? '');
      } else setLargerUnitId(u.find((x) => x.nameAr === 'كرتونة')?.id ?? null);
    })();
  }, [editing, params.id]);

  const baseUnit = units.find((u) => u.id === baseUnitId);
  const margin = cost != null && retail ? Math.round(((retail - cost) / retail) * 100) : null;

  const scanInto = (setter: (v: string) => void) => {
    useScanner.getState().set({
      continuous: false,
      onCode: (code) => {
        setter(normalizeBarcode(code));
        return null;
      },
    });
    router.push('/scan');
  };

  const generate = () => {
    // In-store EAN-13: prefix 2 + device number + time-based sequence (unique per device).
    const devNo = device ? (device.code.charCodeAt(0) - 64) % 100 : 1;
    const seq = Math.floor(Date.now() / 1000) % 1_000_000_000;
    setBarcode(internalBarcode(devNo, seq));
  };

  const pickImage = async (camera: boolean) => {
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.8 };
    const r = camera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (r.canceled || !r.assets[0]) return;
    setImagePath(await saveProductImage(r.assets[0].uri, uuidv7()));
  };

  const save = async () => {
    if (!ctx || !baseUnitId) return;
    setErr(null);
    if (!name.trim()) return setErr(t('invErrors.name_required'));
    const input: ProductInput = {
      name,
      nameEn,
      sku,
      notes,
      categoryId,
      baseUnitId,
      costMinor: cost ?? 0,
      retailPriceMinor: retail ?? 0,
      wholesalePriceMinor: wholesale ?? retail ?? 0,
      trackStock,
      trackExpiry,
      lowStockMilli: trackStock ? lowStock : null,
      imagePath,
      variantLabel,
      barcodes: barcode ? [barcode] : [],
      largerUnit:
        hasLarger && largerUnitId && factor
          ? { unitId: largerUnitId, factorMilli: factor, retailPriceMinor: largerPrice, wholesalePriceMinor: null, barcode: largerBarcode || null }
          : null,
    };
    setBusy(true);
    try {
      if (editing) {
        await updateProduct(ctx, params.id!, input);
        router.back();
      } else {
        const id = await createProduct(ctx, { ...input, openingQtyMilli: trackStock ? opening : null });
        router.replace({ pathname: '/products/[id]', params: { id } });
      }
      toast(t('productForm.saved'));
    } catch (e) {
      setErr(invErrorMessage(t, e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen back title={editing ? t('productForm.editTitle') : t('productForm.newTitle')} footer={<Button testID="product-save" title={t('productForm.save')} loading={busy} onPress={save} />}>
      {/* Photo + name */}
      <Card>
        <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
          <Pressable onPress={() => void pickImage(false)} style={{ width: 84, height: 84, borderRadius: 22, backgroundColor: colors.paper.sunk, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderWidth: 2, borderStyle: 'dashed', borderColor: colors.paper.line }}>
            {imagePath ? <Image source={{ uri: imagePath }} style={{ width: 84, height: 84 }} /> : <Icon name="image" color={colors.ink.faint} size={32} />}
          </Pressable>
          <View style={{ flex: 1, gap: 8 }}>
            <Button compact kind="secondary" icon="camera" title={t('productForm.takePhoto')} onPress={() => void pickImage(true)} />
            {imagePath ? <Button compact kind="ghost" title={t('productForm.removePhoto')} onPress={() => setImagePath(null)} /> : <Button compact kind="ghost" icon="image" title={t('productForm.pickPhoto')} onPress={() => void pickImage(false)} />}
          </View>
        </View>
      </Card>

      <TextField testID="product-name" icon="tag" label={t('productForm.name')} placeholder={t('productForm.namePh')} value={name} onChangeText={setName} latinDigits={false} />

      <View style={{ gap: 6 }}>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
          <View style={{ flex: 1 }}>
            <TextField testID="product-barcode" icon="scan" label={t('productForm.barcode')} placeholder={t('productForm.barcodePh')} value={barcode} onChangeText={(v) => setBarcode(normalizeBarcode(v))} ltr autoCapitalize="none" />
          </View>
          <Pressable onPress={() => scanInto(setBarcode)} style={{ width: 56, height: 56, borderRadius: 16, backgroundColor: colors.primary[600], alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="camera" color="#FFFFFF" tint="rgba(255,255,255,0.2)" />
          </Pressable>
        </View>
        {!barcode ? <Button compact kind="ghost" icon="plus" title={t('productForm.generate')} onPress={generate} /> : null}
      </View>

      <SectionTitle>{t('productForm.category')}</SectionTitle>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Chip label={t('products.noCategory')} selected={categoryId === null} onPress={() => setCategoryId(null)} />
        {cats.map((c) => (
          <Chip key={c.id} label={c.name} dot={c.color} selected={categoryId === c.id} onPress={() => setCategoryId(c.id)} />
        ))}
        <Chip label={`+ ${t('productForm.newCategory')}`} onPress={() => setNewCat('')} />
      </View>

      <SectionTitle>{t('productForm.unit')}</SectionTitle>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {units.map((u) => (
          <Chip key={u.id} label={u.nameAr} selected={baseUnitId === u.id} onPress={() => setBaseUnitId(u.id)} />
        ))}
      </View>

      <SectionTitle>{t('productForm.sectionPrices')}</SectionTitle>
      <Card>
        <View style={{ gap: 12 }}>
          {canCost ? <MoneyField label={t('productForm.cost')} valueMinor={cost} onValue={setCost} /> : null}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <MoneyField testID="product-retail" label={t('productForm.retail')} valueMinor={retail} onValue={setRetail} editable={!editing || canPrice} />
            </View>
            <View style={{ flex: 1 }}>
              <MoneyField label={t('productForm.wholesale')} valueMinor={wholesale} onValue={setWholesale} editable={!editing || canPrice} placeholder={retail != null ? (retail / 100).toFixed(2) : ''} />
            </View>
          </View>
          {canCost && margin != null ? (
            <View style={{ alignSelf: 'flex-start', backgroundColor: margin >= 0 ? colors.leaf[50] : colors.rose[50], borderRadius: 99, paddingHorizontal: 12, paddingVertical: 4 }}>
              <Text style={{ fontFamily: 'IBMPlexSansArabic_700Bold', fontSize: 13, lineHeight: 20, color: margin >= 0 ? colors.leaf[700] : colors.rose[700] }}>{t('productForm.margin', { p: margin })}</Text>
            </View>
          ) : null}
        </View>
      </Card>

      <SectionTitle>{t('productForm.sectionLarger')}</SectionTitle>
      <Card>
        <View style={{ gap: 12 }}>
          <Toggle label={t('productForm.largerToggle')} hint={multiUnit ? undefined : t('productForm.featureMulti')} value={hasLarger} onChange={setHasLarger} disabled={!multiUnit} />
          {hasLarger && multiUnit ? (
            <>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {units
                  .filter((u) => u.id !== baseUnitId)
                  .map((u) => (
                    <Chip key={u.id} label={u.nameAr} selected={largerUnitId === u.id} onPress={() => setLargerUnitId(u.id)} />
                  ))}
              </View>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <QtyField label={t('productForm.factor', { unit: baseUnit?.nameAr ?? '' })} valueMilli={factor} onValue={setFactor} allowFraction={false} />
                </View>
                <View style={{ flex: 1 }}>
                  <MoneyField label={t('productForm.largerPrice')} valueMinor={largerPrice} onValue={setLargerPrice} placeholder={retail != null && factor ? ((retail * factor) / 100_000).toFixed(2) : ''} />
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
                <View style={{ flex: 1 }}>
                  <TextField label={t('productForm.largerBarcode')} value={largerBarcode} onChangeText={(v) => setLargerBarcode(normalizeBarcode(v))} ltr />
                </View>
                <Pressable onPress={() => scanInto(setLargerBarcode)} style={{ width: 56, height: 56, borderRadius: 16, backgroundColor: colors.primary[50], alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="scan" color={colors.primary[700]} />
                </Pressable>
              </View>
            </>
          ) : null}
        </View>
      </Card>

      <SectionTitle>{t('productForm.sectionStock')}</SectionTitle>
      <Card>
        <View style={{ gap: 12 }}>
          <Toggle label={t('productForm.trackStock')} value={trackStock} onChange={setTrackStock} />
          {trackStock ? (
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {!editing ? (
                <View style={{ flex: 1 }}>
                  <QtyField testID="product-opening" label={t('productForm.opening')} valueMilli={opening} onValue={setOpening} allowFraction={baseUnit?.allowsFraction ?? false} />
                </View>
              ) : null}
              <View style={{ flex: 1 }}>
                <QtyField label={t('productForm.lowStock')} valueMilli={lowStock} onValue={setLowStock} allowFraction={baseUnit?.allowsFraction ?? false} />
              </View>
            </View>
          ) : null}
          {expiryFeature ? <Toggle label={t('productForm.expiry')} hint={t('productForm.expiryHint')} value={trackExpiry} onChange={setTrackExpiry} /> : null}
        </View>
      </Card>

      <Pressable onPress={() => setShowMore((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6 }}>
        <Text variant="label" style={{ color: colors.primary[700] }}>
          {t('productForm.more')}
        </Text>
        <Icon name={showMore ? 'minus' : 'plus'} size={16} color={colors.primary[700]} />
      </Pressable>
      {showMore ? (
        <View style={{ gap: 12 }}>
          <TextField label={t('productForm.sku')} value={sku} onChangeText={setSku} ltr autoCapitalize="characters" />
          <TextField label={t('productForm.nameEn')} value={nameEn} onChangeText={setNameEn} latinDigits={false} ltr />
          <TextField label={t('productForm.notes')} value={notes} onChangeText={setNotes} latinDigits={false} multiline style={{ height: 80 }} />
        </View>
      ) : null}

      {err ? <Banner tone="danger" text={err} /> : null}

      <Sheet
        visible={newCat !== null}
        onClose={() => setNewCat(null)}
        title={t('productForm.newCategory')}
        footer={
          <Button
            title={t('common.save')}
            onPress={async () => {
              if (!ctx || !newCat?.trim()) return;
              try {
                const id = await saveCategory(ctx, { name: newCat });
                setCats(await listCategories(getDb()));
                setCategoryId(id);
                setNewCat(null);
              } catch (e) {
                toast(invErrorMessage(t, e), 'error');
              }
            }}
          />
        }
      >
        <TextField label={t('categories.name')} value={newCat ?? ''} onChangeText={setNewCat} latinDigits={false} autoFocus />
      </Sheet>
    </Screen>
  );
}
