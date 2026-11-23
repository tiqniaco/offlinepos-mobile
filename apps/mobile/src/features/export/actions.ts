/** Export a ReportDoc: A4 PDF, Excel, thermal print, WhatsApp text. Used by every report screen. */
import * as Print from 'expo-print';
import { File, Paths } from 'expo-file-system';
import { router } from 'expo-router';
import i18n from 'i18next';
import { toast } from '../../state/toast';
import { renderReportBytes } from '../printing/PrintHost';
import { currentPrinter } from '../printing/printerConfig';
import { sendToPrinter } from '../printing/actions';
import { PrintError } from '../printing/types';
import { reportHtml } from './reportHtml';
import { reportSheet, reportText, type ReportDoc } from './report';
import { openWhatsApp, shareFile } from './whatsapp';

/** SheetJS is ~1 MB: required on first use only, so it never slows the app start. */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const xlsx = (): typeof import('xlsx') => require('xlsx');

const t = (k: string) => i18n.t(k);
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export type ExportKind = 'pdf' | 'excel' | 'print' | 'whatsapp';

export async function exportReport(d: ReportDoc, kind: ExportKind, mobile?: string | null): Promise<boolean> {
  try {
    if (kind === 'whatsapp') {
      await openWhatsApp(mobile, reportText(d));
      return true;
    }
    if (kind === 'pdf') {
      const { uri } = await Print.printToFileAsync({ html: await reportHtml(d), base64: false });
      const f = new File(uri);
      const named = new File(Paths.cache, `${d.fileName}.pdf`);
      if (named.exists) named.delete();
      f.move(named);
      await shareFile(named.uri, 'application/pdf', d.title, 'com.adobe.pdf');
      return true;
    }
    if (kind === 'excel') {
      const ws = xlsx().utils.aoa_to_sheet(reportSheet(d));
      ws['!cols'] = d.columns.map(() => ({ wch: 18 }));
      const wb = xlsx().utils.book_new();
      wb.Workbook = { Views: [{ RTL: true }] };
      xlsx().utils.book_append_sheet(wb, ws, d.title.slice(0, 30));
      const file = new File(Paths.cache, `${d.fileName}.xlsx`);
      if (file.exists) file.delete();
      file.create();
      file.write(xlsx().write(wb, { type: 'base64', bookType: 'xlsx' }) as string, { encoding: 'base64' });
      await shareFile(file.uri, XLSX_MIME, d.title, 'org.openxmlformats.spreadsheetml.sheet');
      return true;
    }
    const cfg = currentPrinter();
    if (!cfg) {
      toast(t('done.noPrinter'), 'info', { label: t('more.printers'), onPress: () => router.push('/settings/printers') });
      return false;
    }
    const bytes = await renderReportBytes(d, cfg.dots);
    await sendToPrinter({ ...cfg, copies: 1 }, bytes);
    toast(t('done.printed'));
    return true;
  } catch (e) {
    if (kind === 'print') {
      const code = e instanceof PrintError ? e.code : 'write';
      toast(`${t('done.printFailed')} (${t(`printers.errors.${code}`)})`, 'error', { label: t('invoice.reprint'), onPress: () => void exportReport(d, 'print') });
    } else toast(t('errors.unknown'), 'error');
    return false;
  }
}
