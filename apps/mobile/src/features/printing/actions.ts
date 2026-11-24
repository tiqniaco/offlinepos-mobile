/**
 * Print / share actions used by the screens. Printing never blocks or undoes a sale: it runs after the
 * sale is committed, and any failure shows a toast with a one-tap "reprint" (SPEC §3).
 */
import { Alert, Platform } from 'react-native';
import { router } from 'expo-router';
import i18n from 'i18next';
import { eq, sql } from 'drizzle-orm';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as IntentLauncher from 'expo-intent-launcher';
import { File } from 'expo-file-system';
import { EncodingType, StorageAccessFramework as SAF } from 'expo-file-system/legacy';
import { getDb } from '../../db/client';
import { withTx } from '../../db/tx';
import { salesDocs } from '../../db/schema';
import { toast } from '../../state/toast';
import { buildReceiptData } from './receiptData';
import { renderReceiptBytes } from './PrintHost';
import { currentPrinter, driverFor } from './printerConfig';
import { receiptHtml } from './pdf';
import { PrintError, type PrinterConfig } from './types';
import { formatMinor, formatQty } from '@daftarak/shared';
import { openWhatsApp } from '../export/whatsapp';
import { getSale } from '../../domain/sales/sales';
import { getParty } from '../../domain/parties/parties';
import { getMeta, setMeta } from '../../domain/device';
import { pdfFileName } from './a4';
import type { ReceiptData } from './receiptData';
import { withLockHold } from '../../state/lockHold';

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

/** Render the A4 PDF into the app cache and rename it to a readable name («فاتورة INV-000245 - المحل.pdf»). */
async function makePdf(docId: string): Promise<{ data: ReceiptData; file: File; name: string }> {
  const data = await buildReceiptData(docId);
  const { uri } = await Print.printToFileAsync({ html: await receiptHtml(data), base64: false });
  const name = pdfFileName(data.title, data.number, data.businessName);
  const tmp = new File(uri);
  try {
    const named = new File(tmp.parentDirectory, name);
    if (named.exists) named.delete();
    tmp.move(named);
    return { data, file: named, name };
  } catch {
    return { data, file: tmp, name }; // renaming is cosmetic: keep the expo-print file
  }
}

/** A4 PDF → share sheet (WhatsApp, email…). PLAN.md D-08: files go through the share sheet. */
export async function sharePdf(docId: string): Promise<void> {
  try {
    const { data, file } = await makePdf(docId);
    await withLockHold(() => Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', dialogTitle: data.number, UTI: 'com.adobe.pdf' }));
  } catch {
    toast(t('errors.unknown'), 'error');
  }
}

/** kv_meta key of the folder the owner picked once for saved PDFs (Android SAF tree URI). */
const PDF_DIR_KEY = 'pdf_save_dir';

/** Ask once for a folder (the picker opens on «Download»); remembered in kv_meta so the next save is one tap. */
async function pdfDirectory(forceAsk = false): Promise<string | null> {
  const db = getDb();
  if (!forceAsk) {
    const saved = await getMeta(db, PDF_DIR_KEY);
    if (saved) return saved;
  }
  const perm = await SAF.requestDirectoryPermissionsAsync(SAF.getUriForDirectoryInRoot('Download'));
  if (!perm.granted) return null;
  await setMeta(db, PDF_DIR_KEY, perm.directoryUri);
  return perm.directoryUri;
}

/** Open a saved PDF in the phone's PDF viewer; no viewer → the share sheet. */
async function openPdf(contentUri: string, localUri: string) {
  try {
    await IntentLauncher.startActivityAsync('android.intent.action.VIEW', { data: contentUri, flags: 1, type: 'application/pdf' });
  } catch {
    await withLockHold(() => Sharing.shareAsync(localUri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' })).catch(() => undefined);
  }
}

/**
 * Download the A4 PDF onto the phone. Android: written into the folder the owner picked once (Storage Access
 * Framework, suggested «Download»). iOS: the share sheet with «Save to Files».
 */
export async function downloadPdf(docId: string): Promise<void> {
  try {
    const { file, name } = await makePdf(docId);
    if (Platform.OS !== 'android') {
      await withLockHold(() => Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', dialogTitle: name, UTI: 'com.adobe.pdf' }));
      return;
    }
    const b64 = await file.base64();
    const write = async (dir: string) => {
      const target = await SAF.createFileAsync(dir, name.replace(/\.pdf$/, ''), 'application/pdf');
      await SAF.writeAsStringAsync(target, b64, { encoding: EncodingType.Base64 });
      return target;
    };
    let dir = await pdfDirectory();
    if (!dir) return; // the owner closed the folder picker
    let target: string;
    try {
      target = await write(dir);
    } catch {
      // The saved folder was deleted or its permission revoked → ask again once.
      dir = await pdfDirectory(true);
      if (!dir) return;
      target = await write(dir);
    }
    toast(t('templates.a4Saved'), 'success', { label: t('templates.a4Open'), onPress: () => void openPdf(target, file.uri) });
  } catch {
    toast(t('errors.unknown'), 'error');
  }
}

/** A4 PDF → the system print dialog (print on a Wi-Fi printer or «Save as PDF»). */
export async function printA4(docId: string): Promise<void> {
  try {
    const data = await buildReceiptData(docId);
    const html = await receiptHtml(data);
    await withLockHold(() => Print.printAsync({ html }));
  } catch (e) {
    // Closing the print dialog is not an error.
    if (!/cancel/i.test(String((e as Error)?.message ?? ''))) toast(t('errors.unknown'), 'error');
  }
}

/** Preview any A4 HTML (settings «شكل الفواتير») in the system print preview. */
export async function previewHtml(html: string): Promise<void> {
  try {
    await withLockHold(() => Print.printAsync({ html }));
  } catch (e) {
    if (!/cancel/i.test(String((e as Error)?.message ?? ''))) toast(t('errors.unknown'), 'error');
  }
}

/** «PDF A4» button: download to the phone, share (WhatsApp, email…) or print. Resolves when the chosen action finished. */
export function a4Menu(docId: string): Promise<void> {
  return new Promise((resolve) => {
    Alert.alert(t('templates.a4Title'), t('templates.a4Body'), [
      { text: t('templates.a4Download'), onPress: () => void downloadPdf(docId).finally(resolve) },
      { text: t('templates.a4Share'), onPress: () => void sharePdf(docId).finally(resolve) },
      { text: t('templates.a4Print'), onPress: () => void printA4(docId).finally(resolve) },
      // Android dialogs show at most 3 buttons: there, tapping outside closes it (cancelable).
      ...(Platform.OS === 'ios' ? [{ text: t('common.cancel'), style: 'cancel' as const, onPress: () => resolve() }] : []),
    ], { cancelable: true, onDismiss: () => resolve() });
  });
}

/** WhatsApp text of an invoice/return to the customer's number (or any chat if none). */
export async function whatsappInvoice(docId: string): Promise<void> {
  try {
    const db = getDb();
    const data = await buildReceiptData(docId);
    const s = await getSale(db, docId);
    const mobile = s?.doc.customerId ? ((await getParty(db, 'C', s.doc.customerId))?.mobile ?? null) : null;
    const cur = data.currency === 'SAR' ? 'ر.س' : 'ج.م';
    const lines = [
      `*${data.businessName}*`,
      `${data.title} ${data.number}`,
      data.customerName ? data.customerName : '',
      '',
      ...data.lines.map((l) => `• ${l.name} — ${formatQty(l.qtyMilli)} × ${formatMinor(l.priceMinor)} = ${formatMinor(l.totalMinor)}`),
      '',
      data.discountMinor ? `${t('pos.discount')}: -${formatMinor(data.discountMinor)}` : '',
      `*${t('pos.total')}: ${formatMinor(data.totalMinor)} ${cur}*`,
      data.creditMinor ? `${t('invoice.credit')}: ${formatMinor(data.creditMinor)}` : '',
      data.customerBalanceMinor ? `${t('report.balanceNow')}: ${formatMinor(data.customerBalanceMinor)}` : '',
      data.template.footer ?? '',
    ].filter((x, i, a) => x !== '' || (i > 0 && a[i - 1] !== ''));
    await openWhatsApp(mobile, lines.join('\n'));
  } catch {
    toast(t('errors.unknown'), 'error');
  }
}
