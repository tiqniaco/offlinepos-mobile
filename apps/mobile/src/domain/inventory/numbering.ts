import { and, eq } from 'drizzle-orm';
import { docSequences } from '../../db/schema';
import type { Db } from '../../db/types';

/** Next document number for this device, e.g. "STK-A-000012" (SPEC §4). Call inside the posting transaction. */
export async function nextDocNumber(tx: Db, device: { id: string; code: string }, docType: string, fallbackPrefix: string): Promise<string> {
  const row = (await tx.select().from(docSequences).where(and(eq(docSequences.deviceId, device.id), eq(docSequences.docType, docType))).limit(1))[0];
  let seq: number;
  let prefix: string;
  if (!row) {
    seq = 1;
    prefix = fallbackPrefix;
    await tx.insert(docSequences).values({ deviceId: device.id, docType, prefix, nextSeq: 2 });
  } else {
    seq = row.nextSeq;
    prefix = row.prefix;
    await tx.update(docSequences).set({ nextSeq: seq + 1 }).where(and(eq(docSequences.deviceId, device.id), eq(docSequences.docType, docType)));
  }
  return `${prefix}-${device.code}-${String(seq).padStart(6, '0')}`;
}
