import { useMemo, useState } from 'react';
import { ScrollView, Switch, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { guessPartyMapping, PARTY_IMPORT_FIELDS, partyImportTemplateAr, roleHas, SUPPLIER_IMPORT_FIELDS, validatePartyRows, type PartyImportField } from '@daftarak/shared';
import { Screen, Text, Button, Card, Chip, Banner, IconBadge, SectionTitle, Steps, EmptyState, colors, fonts } from '../../ui';
import { importParties, type PartyImportReport } from '../../domain/parties/import';
import { isCashierPhone } from '../../domain/sync/role';
import { pickSpreadsheet, shareWorkbook, type PickedSheet } from '../../features/inventory/excel';
import { useBizCtx } from '../../features/sales/useSalesCtx';
import { useCurrency } from '../../features/inventory/useInvCtx';
import { useApp } from '../../state/app';
import { errorMessage } from '../../lib/errors';
import { money, phoneLabel } from '../../lib/format';

type Step = 'pick' | 'map' | 'preview' | 'running' | 'done';

/** Customers / suppliers from Excel or CSV: template → pick → map columns → preview with row errors → import → report. */
export default function ImportParties() {
  const { t, i18n } = useTranslation();
  const params = useLocalSearchParams<{ type?: string }>();
  const type: 'C' | 'S' = params.type === 'S' ? 'S' : 'C';
  const ctx = useBizCtx();
  const currency = useCurrency();
  const allowed = useApp((s) => !!s.user && roleHas(s.user.permissions, type === 'C' ? 'parties.manage' : 'purchases.manage')) && !isCashierPhone();
  const fields = type === 'C' ? PARTY_IMPORT_FIELDS : SUPPLIER_IMPORT_FIELDS;
  const [step, setStep] = useState<Step>('pick');
  const [sheet, setSheet] = useState<PickedSheet | null>(null);
  const [mapping, setMapping] = useState<Partial<Record<PartyImportField, number>>>({});
  const [field, setField] = useState<PartyImportField | null>(null);
  const [update, setUpdate] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [report, setReport] = useState<PartyImportReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  const headers = (sheet?.rows[0] ?? []).map((h, i) => (h == null || String(h).trim() === '' ? `#${i + 1}` : String(h)));
  const country = currency === 'SAR' ? 'SA' : 'EG';
  const validation = useMemo(() => (sheet ? validatePartyRows(sheet.rows.slice(1), mapping, { country }) : null), [sheet, mapping, country]);

  const template = async () => {
    const tpl = partyImportTemplateAr(type);
    try {
      await shareWorkbook([tpl.headers, tpl.example], type === 'C' ? 'kashiro-customers-template.xlsx' : 'kashiro-suppliers-template.xlsx', t(type === 'C' ? 'parties.customers' : 'parties.suppliers'));
    } catch (e) {
      setErr(errorMessage(t, e));
    }
  };

  const pick = async () => {
    if (picking) return;
    setErr(null);
    setPicking(true);
    try {
      const s = await pickSpreadsheet();
      if (!s) return;
      if (s.rows.length < 2) return setErr(t('importer.emptyFile'));
      setSheet(s);
      setMapping(guessPartyMapping(s.rows[0]!, fields));
      setStep('map');
    } catch (e) {
      setErr(t('importer.readError'));
      console.warn(e);
    } finally {
      setPicking(false);
    }
  };

  const run = async () => {
    if (!ctx || !validation) return;
    setErr(null);
    setStep('running');
    setProgress({ done: 0, total: validation.valid.length });
    try {
      const r = await importParties(ctx, type, validation.valid, { updateExisting: update }, (done, total) => setProgress({ done, total }));
      setReport(r);
      setStep('done');
    } catch (e) {
      setErr(errorMessage(t, e));
      setStep('preview');
    }
  };

  const title = t(type === 'C' ? 'partyImport.titleC' : 'partyImport.titleS');
  if (!allowed) {
    return (
      <Screen back title={title}>
        <EmptyState icon="lock" title={t('users.noPermission')} />
      </Screen>
    );
  }

  const stepNo = { pick: 1, map: 2, preview: 3, running: 4, done: 4 }[step];
  return (
    <Screen
      back
      title={title}
      footer={
        step === 'pick' ? (
          <Button testID="party-import-pick" icon="upload" title={picking ? t('common.loading') : t('importer.pick')} loading={picking} onPress={pick} />
        ) : step === 'map' ? (
          <Button title={t('common.next')} disabled={mapping.name == null} onPress={() => setStep('preview')} />
        ) : step === 'preview' ? (
          <Button testID="party-import-run" title={t('partyImport.run', { n: validation?.valid.length ?? 0 })} disabled={!validation?.valid.length || !ctx} onPress={run} />
        ) : step === 'done' ? (
          <Button title={t('common.done')} onPress={() => router.back()} />
        ) : undefined
      }
    >
      <Steps current={stepNo} total={4} label={t('onboarding.step', { n: stepNo, total: 4 })} />

      {step === 'pick' ? (
        <>
          <Card>
            <View style={{ gap: 12 }}>
              <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
                <IconBadge name="download" hue="leaf" size={48} />
                <View style={{ flex: 1 }}>
                  <Text variant="subtitle">{t('importer.templateTitle')}</Text>
                  <Text variant="caption">{t('importer.templateBody')}</Text>
                </View>
              </View>
              <Button kind="secondary" icon="download" title={t('importer.template')} onPress={() => void template()} />
            </View>
          </Card>
          <Banner tone="info" text={t(type === 'C' ? 'partyImport.openingHintC' : 'partyImport.openingHintS')} />
          <Banner tone="info" text={t('importer.hint')} />
        </>
      ) : null}

      {step === 'map' && sheet ? (
        <>
          <Text variant="caption">{t('importer.file', { name: sheet.fileName, n: sheet.rows.length - 1 })}</Text>
          <Text variant="body">{t('importer.mapBody')}</Text>
          {fields.map((f) => (
            <Card key={f} onPress={() => setField(field === f ? null : f)}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Text variant="subtitle" style={{ flex: 1 }}>
                  {t(`partyImport.fields.${f}`)}
                  {f === 'name' ? <Text style={{ color: colors.rose[500] }}> *</Text> : null}
                </Text>
                <View style={{ backgroundColor: mapping[f] != null ? colors.primary[50] : colors.paper.sunk, borderRadius: 99, paddingHorizontal: 12, paddingVertical: 4, maxWidth: 170 }}>
                  <Text numberOfLines={1} style={{ fontFamily: fonts.semibold, fontSize: 13, lineHeight: 22, color: mapping[f] != null ? colors.primary[700] : colors.ink.mute }}>
                    {mapping[f] != null ? headers[mapping[f]!] : t('importer.notMapped')}
                  </Text>
                </View>
              </View>
              {field === f ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingTop: 12 }}>
                  <Chip label={t('importer.notMapped')} selected={mapping[f] == null} onPress={() => setMapping((m) => ({ ...m, [f]: undefined }))} />
                  {headers.map((h, i) => (
                    <Chip key={i} label={h} selected={mapping[f] === i} onPress={() => setMapping((m) => ({ ...m, [f]: i }))} />
                  ))}
                </ScrollView>
              ) : null}
            </Card>
          ))}
        </>
      ) : null}

      {step === 'preview' && validation ? (
        <>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Card style={{ flex: 1 }}>
              <Text variant="caption">{t('importer.valid')}</Text>
              <Text style={{ fontFamily: fonts.bold, fontSize: 26, lineHeight: 43, color: colors.leaf[700] }}>{validation.valid.length}</Text>
            </Card>
            <Card style={{ flex: 1 }}>
              <Text variant="caption">{t('importer.withErrors')}</Text>
              <Text style={{ fontFamily: fonts.bold, fontSize: 26, lineHeight: 43, color: validation.errors.length ? colors.rose[700] : colors.ink.faint }}>
                {new Set(validation.errors.map((e) => e.rowNumber)).size}
              </Text>
            </Card>
          </View>
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Text variant="subtitle">{t('partyImport.updateExisting')}</Text>
                <Text variant="caption">{t('partyImport.updateHint')}</Text>
              </View>
              <Switch testID="party-import-update" value={update} onValueChange={setUpdate} trackColor={{ true: colors.primary[500], false: colors.paper.line }} />
            </View>
          </Card>
          {validation.valid.slice(0, 8).map((r) => (
            <Text key={r.rowNumber} variant="caption">
              {r.rowNumber}. {r.name}
              {r.mobile ? ` — ${phoneLabel(r.mobile, { isolate: true })}` : ''}
              {r.openingMinor ? ` — ${t('partyImport.fields.opening_balance')}: ${money(r.openingMinor, currency, i18n.language)}` : ''}
            </Text>
          ))}
          {validation.errors.length ? (
            <>
              <SectionTitle>{t('importer.errorsTitle')}</SectionTitle>
              <Card>
                <View style={{ gap: 6 }}>
                  {validation.errors.slice(0, 50).map((e, i) => (
                    <Text key={i} variant="caption" style={{ color: colors.rose[700] }}>
                      {t('importer.rowError', { row: e.rowNumber, field: t(`partyImport.fields.${e.field}`), error: t(`partyImport.errors.${e.code}`) })}
                    </Text>
                  ))}
                  {validation.errors.length > 50 ? <Text variant="caption">… +{validation.errors.length - 50}</Text> : null}
                </View>
              </Card>
            </>
          ) : null}
        </>
      ) : null}

      {step === 'running' ? (
        <Card>
          <View style={{ gap: 12, alignItems: 'center', paddingVertical: 12 }}>
            <IconBadge name="upload" hue="primary" size={56} />
            <Text variant="subtitle">{t('importer.running', { done: progress.done, total: progress.total })}</Text>
            <View style={{ width: '100%', height: 10, borderRadius: 5, backgroundColor: colors.paper.sunk, overflow: 'hidden' }}>
              <View style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`, height: 10, backgroundColor: colors.primary[500] }} />
            </View>
          </View>
        </Card>
      ) : null}

      {step === 'done' && report ? (
        <Card>
          <View style={{ gap: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <IconBadge name="check" hue="leaf" size={52} />
              <Text style={{ fontFamily: fonts.bold, fontSize: 19, lineHeight: 31, color: colors.ink.DEFAULT }}>{t('importer.doneTitle')}</Text>
            </View>
            <Text variant="body">{t('partyImport.created', { n: report.created })}</Text>
            {report.updated ? <Text variant="body">{t('partyImport.updated', { n: report.updated })}</Text> : null}
            {report.skippedExisting ? <Text variant="body">{t('partyImport.skipped', { n: report.skippedExisting })}</Text> : null}
            {report.openingIgnored ? <Text variant="body">{t('partyImport.openingIgnored', { n: report.openingIgnored })}</Text> : null}
            {report.failed.length ? (
              <>
                <Text variant="body" style={{ color: colors.rose[700] }}>
                  {t('importer.failed', { n: report.failed.length })}
                </Text>
                {report.failed.slice(0, 20).map((f) => (
                  <Text key={f.rowNumber} variant="caption" style={{ color: colors.rose[700] }}>
                    {f.rowNumber}: {t(`partyImport.failReasons.${f.code}`)}
                  </Text>
                ))}
              </>
            ) : null}
            <Text variant="caption">{t('importer.time', { s: (report.ms / 1000).toFixed(1) })}</Text>
          </View>
        </Card>
      ) : null}

      {err ? <Banner tone="danger" text={err} /> : null}
    </Screen>
  );
}
