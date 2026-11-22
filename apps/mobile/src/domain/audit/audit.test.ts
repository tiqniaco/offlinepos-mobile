import { GENESIS_HASH, chainHash } from '@daftarak/shared';
import { auditPayload, verifyAuditRows } from './audit';

function build(n: number) {
  const rows = [];
  let prev = GENESIS_HASH;
  for (let i = 1; i <= n; i++) {
    const r = { seq: i, at: 1000 + i, userId: 'u1', deviceId: 'd1', action: 'user.update', entity: 'users', entityId: 'x', beforeJson: '{"name":"a"}', afterJson: '{"name":"b"}', reason: null };
    const hash = chainHash(auditPayload(r), prev);
    rows.push({ ...r, hash, prevHash: prev });
    prev = hash;
  }
  return rows;
}

describe('audit chain verification', () => {
  it('accepts an intact chain', () => {
    const r = verifyAuditRows(build(20));
    expect(r.ok).toBe(true);
    expect(r.count).toBe(20);
  });
  it('detects an edited row and points at it', () => {
    const rows = build(20);
    rows[7] = { ...rows[7]!, afterJson: '{"name":"hacked"}' };
    expect(verifyAuditRows(rows)).toMatchObject({ ok: false, firstBreakSeq: 8 });
  });
  it('detects a deleted row', () => {
    const rows = build(10);
    rows.splice(4, 1);
    expect(verifyAuditRows(rows)).toMatchObject({ ok: false, firstBreakSeq: 6 });
  });
  it('detects a recomputed tail that does not link', () => {
    const rows = build(5);
    rows[2] = { ...rows[2]!, prevHash: 'f'.repeat(64) };
    expect(verifyAuditRows(rows).ok).toBe(false);
  });
});
