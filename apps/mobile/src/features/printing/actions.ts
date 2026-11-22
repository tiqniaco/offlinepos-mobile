/**
 * Print / share actions used by the screens. Printing never blocks or undoes a sale: it runs after the
 * sale is committed, and any failure shows a toast with a one-tap "reprint" (SPEC §3).
 */
import { router } from 'expo-router';
import i18n from 'i18next';
import { eq, sql } from 'drizzle-orm';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { getDb } from '../../db/client';
import { withTx } from '../../db/tx';
import { salesDocs } from '../../db/schema';
import { toast } from '../../state/toast';
import { buildReceiptData } from './receiptData';
import { renderReceiptBytes } from './PrintHost';
import { currentPrinter, driverFor } from './printerConfig';
import { receiptHtml } from './pdf';
import { PrintError, type PrinterConfig } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const t = (k: string, o?: Record<string, unknown>) => (i18n.t as any)(k, o) as string;

export async function sendToPrinter(cfg: PrinterConfig, bytes: Uint8Array) {
  const driver = driverFor(cfg);
  for (let i = 0; i < Math.max(1, cfg.copies); i++) await driver.write(cfg, bytes);
}

export async function printReceipt(docId: string): Promise<boolean> {
  const cfg = currentPrinter();
  if (!cfg) {
    toast(t('done.noPrinter'), 'info', { label: t('more.printers'), onPress: () => router.push('/settings/printers') });
    return false;
  }
  try {
    const data = await buildReceiptData(docId);
    const bytes = await renderReceiptBytes(data, cfg.dots, cfg.openDrawer && data.kind === 'INVOICE');
    await sendToPrinter(cfg, bytes);
    await withTx(getDb(), (tx) => tx.update(salesDocs).set({ printCount: sql`${salesDocs.printCount} + 1`, lastPrintedAt: Date.now() }).where(eq(salesDocs.id, docId)));
    toast(t('done.printed'));
    return true;
  } catch (e) {
    const code = e instanceof PrintError ? e.code : 'write';
    toast(`${t('done.printFailed')} (${t(`printers.errors.${code}`)})`, 'error', { label: t('invoice.reprint'), onPress: () => void printReceipt(docId) });
    return false;
  }
}

/** Fire-and-forget after posting when auto-print is on. */
export async function autoPrintIfEnabled(docId: string) {
  if (currentPrinter()?.autoPrint) await printReceipt(docId);
}

/** A4 PDF → share sheet (WhatsApp, email…). PLAN.md D-08: files go through the share sheet. */
export async function sharePdf(docId: string): Promise<void> {
  try {
    const data = await buildReceiptData(docId);
    const { uri } = await Print.printToFileAsync({ html: await receiptHtml(data), base64: false });
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: data.number, UTI: 'com.adobe.pdf' });
  } catch {
    toast(t('errors.unknown'), 'error');
  }
}
