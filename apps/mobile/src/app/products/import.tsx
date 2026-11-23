import { useMemo, useState } from 'react';
import { fonts } from '../../ui/fonts';
import { ScrollView, Switch, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { IMPORT_FIELDS, guessMapping, validateImportRows, type ImportField } from '@daftarak/shared';
import { Screen, Text, Button, Card, Chip, Banner, IconBadge, SectionTitle, Steps, colors } from '../../ui';
import { importProducts, type ImportReport } from '../../domain/inventory/import';
import { pickSpreadsheet, shareImportTemplate, type PickedSheet } from '../../features/inventory/excel';
import { useInvCtx } from '../../features/inventory/useInvCtx';
import { invErrorMessage } from '../../features/inventory/errors';

type Step = 'pick' | 'map' | 'preview' | 'running' | 'done';
const REQUIRED: ImportField[] = ['name'];

/** Excel/CSV import: template → pick file → map columns → preview with row errors → import → report. */
export default function ImportProducts() {
  const { t } = useTranslation();
  const ctx = useInvCtx();
  const [step, setStep] = useState<Step>('pick');
  const [sheet, setSheet] = useState<PickedSheet | null>(null);
  const [mapping, setMapping] = useState<Partial<Record<ImportField, number>>>({});
  const [field, setField] = useState<ImportField | null>(null);
  const [update, setUpdate] = useState(true);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [report, setReport] = useState<ImportReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  const headers = (sheet?.rows[0] ?? []).map((h, i) => (h == null || String(h).trim() === '' ? `#${i + 1}` : String(h)));
  const validation = useMemo(() => (sheet ? validateImportRows(sheet.rows.slice(1), mapping) : null), [sheet, mapping]);

  const pick = async () => {
    if (picking) return;
    setErr(null);
    setPicking(true);
    try {
      const s = await pickSpreadsheet();
      if (!s) return;
      if (s.rows.length < 2) return setErr(t('importer.emptyFile'));
      setSheet(s);
      setMapping(guessMapping(s.rows[0]!));
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
    setStep('running');
    setProgress({ done: 0, total: validation.valid.length });
    try {
      const r = await importProducts(ctx, validation.valid, { updateExisting: update }, (done, total) => setProgress({ done, total }));
      setReport(r);
      setStep('done');
    } catch (e) {
      setErr(invErrorMessage(t, e));
      setStep('preview');
    }
  };

  const stepNo = { pick: 1, map: 2, preview: 3, running: 4, done: 4 }[step];
  return (
    <Screen
      back
      title={t('importer.title')}
      footer={
        step === 'pick' ? (
          <Button icon="upload" title={picking ? t('common.loading') : t('importer.pick')} loading={picking} onPress={pick} />
        ) : step === 'map' ? (
          <Button title={t('common.next')} disabled={REQUIRED.some((f) => mapping[f] == null)} onPress={() => setStep('preview')} />
        ) : step === 'preview' ? (
          <Button testID="import-run" title={t('importer.run', { n: validation?.valid.length ?? 0 })} disabled={!validation?.valid.length} onPress={run} />
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
              <Button kind="secondary" icon="download" title={t('importer.template')} onPress={() => void shareImportTemplate()} />
            </View>
          </Card>
          <Banner tone="info" text={t('importer.hint')} />
        </>
      ) : null}

      {step === 'map' && sheet ? (
        <>
          <Text variant="caption">{t('importer.file', { name: sheet.fileName, n: sheet.rows.length - 1 })}</Text>
          <Text variant="body">{t('importer.mapBody')}</Text>
          {IMPORT_FIELDS.map((f) => (
            <Card key={f} onPress={() => setField(field === f ? null : f)}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Text variant="subtitle" style={{ flex: 1 }}>
                  {t(`importer.fields.${f}`)}
                  {REQUIRED.includes(f) ? <Text style={{ color: colors.rose[500] }}> *</Text> : null}
                </Text>
                <View style={{ backgroundColor: mapping[f] != null ? colors.primary[50] : colors.paper.sunk, borderRadius: 99, paddingHorizontal: 12, paddingVertical: 4, maxWidth: 170 }}>
                  <Text numberOfLines={1} style={{ fontFamily: fonts.semibold, fontSize: 13, lineHeight: 20, color: mapping[f] != null ? colors.primary[700] : colors.ink.mute }}>
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
              <Text style={{ fontFamily: fonts.bold, fontSize: 26, lineHeight: 36, color: colors.leaf[700] }}>{validation.valid.length}</Text>
            </Card>
            <Card style={{ flex: 1 }}>
              <Text variant="caption">{t('importer.withErrors')}</Text>
              <Text style={{ fontFamily: fonts.bold, fontSize: 26, lineHeight: 36, color: validation.errors.length ? colors.rose[700] : colors.ink.faint }}>
                {new Set(validation.errors.map((e) => e.rowNumber)).size}
              </Text>
            </Card>
          </View>
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Text variant="subtitle">{t('importer.updateExisting')}</Text>
                <Text variant="caption">{t('importer.updateHint')}</Text>
              </View>
              <Switch value={update} onValueChange={setUpdate} trackColor={{ true: colors.primary[500], false: colors.paper.line }} />
            </View>
          </Card>
          {validation.valid.slice(0, 5).map((r) => (
            <Text key={r.rowNumber} variant="caption">
              {r.rowNumber}. {r.name} {r.retailMinor != null ? `— ${(r.retailMinor / 100).toFixed(2)}` : ''}
            </Text>
          ))}
          {validation.errors.length ? (
            <>
              <SectionTitle>{t('importer.errorsTitle')}</SectionTitle>
              <Card>
                <View style={{ gap: 6 }}>
                  {validation.errors.slice(0, 50).map((e, i) => (
                    <Text key={i} variant="caption" style={{ color: colors.rose[700] }}>
                      {t('importer.rowError', { row: e.rowNumber, field: t(`importer.fields.${e.field}`), error: t(`importer.errors.${e.code}`) })}
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
              <Text style={{ fontFamily: fonts.bold, fontSize: 19, lineHeight: 28, color: colors.ink.DEFAULT }}>{t('importer.doneTitle')}</Text>
            </View>
            <Text variant="body">{t('importer.created', { n: report.created })}</Text>
            {report.updated ? <Text variant="body">{t('importer.updated', { n: report.updated })}</Text> : null}
            {report.skippedExisting ? <Text variant="body">{t('importer.skipped', { n: report.skippedExisting })}</Text> : null}
            {report.failed.length ? (
              <>
                <Text variant="body" style={{ color: colors.rose[700] }}>
                  {t('importer.failed', { n: report.failed.length })}
                </Text>
                {report.failed.slice(0, 20).map((f) => (
                  <Text key={f.rowNumber} variant="caption" style={{ color: colors.rose[700] }}>
                    {f.rowNumber}: {t(`importer.failReasons.${f.code}`)}
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
