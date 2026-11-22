import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActionTiles } from './ActionTiles';
import { exportReport, type ExportKind } from '../export/actions';
import type { ReportDoc } from '../export/report';
import { maybeShowInterstitial } from '../ads/ads';

/** واتساب · PDF · إكسيل · طباعة — one row on every report/document screen. */
export function ExportBar({ build, mobile, kinds = ['whatsapp', 'pdf', 'excel', 'print'] }: { build: () => Promise<ReportDoc> | ReportDoc; mobile?: string | null; kinds?: ExportKind[] }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const run = async (k: ExportKind) => {
    if (busy) return;
    setBusy(true);
    try {
      const ok = await exportReport(await build(), k, mobile);
      if (ok && (k === 'pdf' || k === 'excel')) maybeShowInterstitial();
    } finally {
      setBusy(false);
    }
  };
  const all = {
    whatsapp: { key: 'whatsapp', icon: 'whatsapp' as const, hue: 'leaf' as const, label: t('share.whatsapp') },
    pdf: { key: 'pdf', icon: 'file' as const, hue: 'rose' as const, label: 'PDF' },
    excel: { key: 'excel', icon: 'sheet' as const, hue: 'leaf' as const, label: t('share.excel') },
    print: { key: 'print', icon: 'printer' as const, hue: 'primary' as const, label: t('share.print') },
  };
  return <ActionTiles flat columns={kinds.length} tiles={kinds.map((k) => ({ ...all[k], onPress: () => void run(k) }))} />;
}
