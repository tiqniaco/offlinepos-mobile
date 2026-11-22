import { autoPrintIfEnabled } from './actions';

/** Called right after a sale is committed. Never throws. */
export async function printReceiptInBackground(docId: string): Promise<void> {
  await autoPrintIfEnabled(docId).catch(() => undefined);
}
