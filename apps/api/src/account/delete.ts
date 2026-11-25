/**
 * Account deletion from inside the app (App Store 5.1.1(v), Google Play account-deletion policy).
 *
 * Deletes the account and everything our server holds for the shops it owns: shops, devices, sessions, backups and
 * payment receipts (R2 objects + rows), cashier-phone sync data, follow snapshots, OCR records, usage counters and
 * limit overrides. Payment records the law may require (billing_events, the activation codes a shop redeemed) are
 * kept without the account: they hold no phone number or shop data.
 *
 * The shop data on the phone is wiped by the app after this succeeds.
 */
import type { Env } from '../env';

const IN_CHUNK = 50;

async function ids(env: Env, sql: string, bind: unknown[]): Promise<string[]> {
  const r = await env.DB.prepare(sql).bind(...bind).all<{ id: string }>();
  return (r.results ?? []).map((x) => x.id);
}

async function deleteObjects(env: Env, keys: string[]) {
  for (let i = 0; i < keys.length; i += 100) await env.BACKUPS.delete(keys.slice(i, i + 100));
}

export async function deleteAccount(env: Env, accountId: string): Promise<{ businesses: number }> {
  const acc = await env.DB.prepare(`SELECT id, phone FROM accounts WHERE id = ?1`).bind(accountId).first<{ id: string; phone: string }>();
  if (!acc) return { businesses: 0 };
  const shops = await ids(env, `SELECT id FROM businesses WHERE owner_account_id = ?1`, [accountId]);

  // R2 objects first (a row without its object is harmless; an object without its row would leak storage).
  const keys: string[] = [];
  for (let i = 0; i < shops.length; i += IN_CHUNK) {
    const part = shops.slice(i, i + IN_CHUNK);
    const q = part.map((_, j) => `?${j + 1}`).join(',');
    const b = await env.DB.prepare(`SELECT r2_key AS k FROM backups WHERE business_id IN (${q})`).bind(...part).all<{ k: string }>();
    const r = await env.DB.prepare(`SELECT receipt_key AS k FROM payment_requests WHERE business_id IN (${q})`).bind(...part).all<{ k: string }>();
    keys.push(...(b.results ?? []).map((x) => x.k), ...(r.results ?? []).map((x) => x.k));
  }
  const own = await env.DB.prepare(`SELECT receipt_key AS k FROM payment_requests WHERE account_id = ?1`).bind(accountId).all<{ k: string }>();
  keys.push(...(own.results ?? []).map((x) => x.k));
  await deleteObjects(env, [...new Set(keys)]);

  const stmts: D1PreparedStatement[] = [];
  const run = (sql: string, ...bind: unknown[]) => stmts.push(env.DB.prepare(sql).bind(...bind));
  for (const id of shops) {
    for (const t of ['sync_ops', 'sync_state', 'device_invites', 'shop_snapshots', 'business_limit_overrides', 'ocr_scans', 'payment_requests', 'backups', 'key_releases', 'anchors', 'request_counters', 'usage_daily']) {
      run(`DELETE FROM ${t} WHERE business_id = ?1`, id);
    }
    run(`DELETE FROM devices WHERE business_id = ?1`, id);
  }
  // This account's sessions (including cashier-phone sessions of its shops): unlink any device still pointing at one.
  const sessionScope = `account_id = ?1 OR device_business_id IN (SELECT id FROM businesses WHERE owner_account_id = ?1)`;
  run(`UPDATE devices SET session_id = NULL WHERE session_id IN (SELECT id FROM sessions WHERE ${sessionScope})`, accountId);
  run(`DELETE FROM sessions WHERE ${sessionScope}`, accountId);
  run(`DELETE FROM payment_requests WHERE account_id = ?1`, accountId);
  run(`DELETE FROM ocr_scans WHERE account_id = ?1`, accountId);
  run(`DELETE FROM businesses WHERE owner_account_id = ?1`, accountId);
  run(`DELETE FROM otp_codes WHERE phone = ?1`, acc.phone);
  run(`DELETE FROM accounts WHERE id = ?1`, accountId);
  await env.DB.batch(stmts);
  return { businesses: shops.length };
}
