/**
 * Daily housekeeping (wrangler.jsonc → triggers.crons). Deletes only operational data that has no value after a
 * while; never business data, payments, audit or committed backups.
 */
import { DAY_MS } from '@daftarak/shared';
import type { Env } from '../env';
import { UNCOMMITTED_TTL_MS, deleteBackups } from '../routes/phase6';

export const RETENTION = {
  otpCodesMs: 30 * DAY_MS,
  otpSendLogMs: 90 * DAY_MS,
  rateCountersMs: 30 * DAY_MS,
  clientErrorsMs: 90 * DAY_MS,
  ocrScansMs: 400 * DAY_MS,
};

export async function runCleanup(env: Env, now: number) {
  const out: Record<string, number> = {};
  const del = async (name: string, sql: string, cutoff: number) => {
    const r = await env.DB.prepare(sql).bind(cutoff).run();
    out[name] = r.meta.changes ?? 0;
  };
  await del('otp_codes', `DELETE FROM otp_codes WHERE created_at < ?1`, now - RETENTION.otpCodesMs);
  await del('otp_send_log', `DELETE FROM otp_send_log WHERE at < ?1`, now - RETENTION.otpSendLogMs);
  await del('rate_counters', `DELETE FROM rate_counters WHERE window_start < ?1`, now - RETENTION.rateCountersMs);
  await del('client_errors', `DELETE FROM client_errors WHERE at < ?1`, now - RETENTION.clientErrorsMs);
  await del('ocr_scans', `DELETE FROM ocr_scans WHERE created_at < ?1`, now - RETENTION.ocrScansMs);
  // Uncommitted backups: the row AND its R2 object, in pages.
  let backups = 0;
  for (let i = 0; i < 20; i++) {
    const r = await env.DB.prepare(`SELECT id, r2_key FROM backups WHERE committed_at IS NULL AND created_at < ?1 LIMIT 200`)
      .bind(now - UNCOMMITTED_TTL_MS)
      .all<{ id: string; r2_key: string }>();
    if (!r.results.length) break;
    await deleteBackups(env, r.results);
    backups += r.results.length;
  }
  out.uncommitted_backups = backups;
  return out;
}
