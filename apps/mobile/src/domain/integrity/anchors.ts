/**
 * Daily anchors (PLAN.md §7.5): the chain heads go to the server with the check-in; the server signs a receipt.
 * The full integrity check proves that history up to each anchor was not rewritten later (even on a rooted
 * phone that recomputed every hash: the anchored head at that sequence would no longer match).
 */
import { and, asc, desc, eq } from 'drizzle-orm';
import { canonicalJson, ed25519Verify, base64urlDecode, utf8ToBytes, uuidv7 } from '@daftarak/shared';
import { anchorReceipts, auditLog, integrityChain } from '../../db/schema';
import type { Db } from '../../db/types';
import { LICENCE_PUBLIC_KEYS } from '../../config/licenceKeys';
import { chainHead } from './chain';

export async function currentAnchor(db: Db, deviceId: string) {
  const head = await chainHead(db, deviceId);
  const a = (await db.select({ seq: auditLog.seq, hash: auditLog.hash }).from(auditLog).orderBy(desc(auditLog.seq)).limit(1))[0];
  return { chainSeq: head.seq, chainHead: head.hash, auditSeq: a?.seq ?? 0, auditHead: a?.hash ?? '0'.repeat(64) };
}

export async function saveReceipt(db: Db, deviceId: string, r: { chainSeq: number; chainHead: string; auditSeq: number; auditHead: string; serverTime: number; sig: string }) {
  await db.insert(anchorReceipts).values({ id: uuidv7(r.serverTime), deviceId, ...r });
}

/** Receipt signed by OUR server key (any embedded kid). */
export function receiptValid(deviceId: string, r: { chainSeq: number; chainHead: string; auditSeq: number; auditHead: string; serverTime: number; sig: string }): boolean {
  const msg = utf8ToBytes(canonicalJson({ t: 'anchor', deviceId, chainSeq: r.chainSeq, chainHead: r.chainHead, auditSeq: r.auditSeq, auditHead: r.auditHead, serverTime: r.serverTime }));
  return Object.values(LICENCE_PUBLIC_KEYS).some((pk) => {
    try {
      return ed25519Verify(base64urlDecode(r.sig), msg, pk);
    } catch {
      return false;
    }
  });
}

export interface AnchorReport {
  anchors: number;
  lastAnchorAt: number | null;
  /** First anchor whose head no longer matches the local chain/audit (history rewritten before it). */
  mismatch: { serverTime: number; chainSeq: number; kind: 'chain' | 'audit' | 'signature' | 'missing' } | null;
}

export async function verifyAnchors(db: Db, deviceId: string): Promise<AnchorReport> {
  const rs = await db.select().from(anchorReceipts).where(eq(anchorReceipts.deviceId, deviceId)).orderBy(asc(anchorReceipts.chainSeq));
  for (const r of rs) {
    if (!receiptValid(deviceId, r)) return { anchors: rs.length, lastAnchorAt: rs.at(-1)?.serverTime ?? null, mismatch: { serverTime: r.serverTime, chainSeq: r.chainSeq, kind: 'signature' } };
    if (r.chainSeq > 0) {
      const e = (await db.select({ hash: integrityChain.hash }).from(integrityChain).where(and(eq(integrityChain.deviceId, deviceId), eq(integrityChain.chainSeq, r.chainSeq))).limit(1))[0];
      if (!e) return { anchors: rs.length, lastAnchorAt: rs.at(-1)!.serverTime, mismatch: { serverTime: r.serverTime, chainSeq: r.chainSeq, kind: 'missing' } };
      if (e.hash !== r.chainHead) return { anchors: rs.length, lastAnchorAt: rs.at(-1)!.serverTime, mismatch: { serverTime: r.serverTime, chainSeq: r.chainSeq, kind: 'chain' } };
    }
    if (r.auditSeq > 0) {
      const a = (await db.select({ hash: auditLog.hash }).from(auditLog).where(eq(auditLog.seq, r.auditSeq)).limit(1))[0];
      if (!a || a.hash !== r.auditHead) return { anchors: rs.length, lastAnchorAt: rs.at(-1)!.serverTime, mismatch: { serverTime: r.serverTime, chainSeq: r.chainSeq, kind: 'audit' } };
    }
  }
  return { anchors: rs.length, lastAnchorAt: rs.at(-1)?.serverTime ?? null, mismatch: null };
}
