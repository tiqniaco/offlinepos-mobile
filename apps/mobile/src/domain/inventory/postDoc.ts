/**
 * Finalise an inventory document: number, business day, hash-chain entry, journal entry, status POSTED.
 * Shared by opening stock, adjustments and counts (all inside the caller's transaction).
 */
import { eq } from 'drizzle-orm';
import { businessDay } from '@daftarak/shared';
import { inventoryDocs, inventoryLines } from '../../db/schema';
import type { Db } from '../../db/types';
import { appendChain, inventoryPayload } from '../integrity/chain';
import { postJournal } from '../accounting/journal';
import type { InvCtx } from './context';
import { nextDocNumber } from './numbering';

/** valueMinor = Σ (qty × unit cost) of the posted movements, signed (+ stock in, − stock out). */
export async function finalizeInventoryDoc(tx: Db, ctx: InvCtx, docId: string, now: number, valueMinor: number): Promise<string> {
  const draft = (await tx.select().from(inventoryDocs).where(eq(inventoryDocs.id, docId)).limit(1))[0]!;
  const lines = await tx.select().from(inventoryLines).where(eq(inventoryLines.docId, docId));
  const number = await nextDocNumber(tx, ctx.device, 'INVENTORY', 'STK');
  const day = businessDay(now, ctx.timezone);
  const posted = { ...draft, number, postedAt: now, businessDay: day, status: 'POSTED' as const };
  const chain = await appendChain(tx, ctx.device.id, 'INVENTORY', docId, now, () => inventoryPayload(posted, lines));
  if (valueMinor !== 0) {
    const counter = draft.type === 'OPENING' ? 'OPENING_EQUITY' : 'STOCK_ADJ';
    await postJournal(tx, ctx, {
      sourceType: 'inventory_doc',
      sourceId: docId,
      businessDay: day,
      memo: number,
      at: now,
      lines:
        valueMinor > 0
          ? [{ account: 'INVENTORY', debit: valueMinor }, { account: counter, credit: valueMinor }]
          : [{ account: counter, debit: -valueMinor }, { account: 'INVENTORY', credit: -valueMinor }],
    });
  }
  await tx
    .update(inventoryDocs)
    .set({ status: 'POSTED', number, postedAt: now, businessDay: day, hash: chain.hash, prevHash: chain.prevHash, chainSeq: chain.seq, updatedAt: now })
    .where(eq(inventoryDocs.id, docId));
  return number;
}
