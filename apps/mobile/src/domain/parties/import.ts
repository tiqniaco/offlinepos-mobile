/**
 * Excel/CSV import of customers & suppliers (validated rows from packages/shared/partyImport).
 * Every row goes through the normal services, so permissions, licence limits, phone rules, audit and the
 * opening-balance posting are exactly what the party form does:
 *  - new phone (or no phone)  → createPartyWithOpening (party + opening-balance voucher in one transaction);
 *  - phone already saved      → skipped, or updated with the file's non-empty cells (never a second opening balance).
 */
import { and, eq, isNull } from 'drizzle-orm';
import { roleHas, type PartyImportRow } from '@daftarak/shared';
import { customers, suppliers } from '../../db/schema';
import { withTx } from '../../db/tx';
import { appendAudit } from '../audit/audit';
import { PermissionError } from '../auth/users';
import { assertCanWrite, LicenceError } from '../licence/guard';
import { createPartyWithOpening, VoucherError, type VoucherCtx } from '../vouchers/vouchers';
import { getParty, PartyError, saveParty, type PartyInput, type PartyType } from './parties';

export interface PartyImportReport {
  created: number;
  updated: number;
  skippedExisting: number;
  /** Existing parties whose opening balance in the file was not posted (they already have history). */
  openingIgnored: number;
  failed: { rowNumber: number; code: PartyImportFailCode }[];
  ms: number;
}

export type PartyImportFailCode = 'limit' | 'mobile_taken' | 'mobile_invalid' | 'name_required' | 'opening' | 'other';

const yieldToUi = () => new Promise<void>((r) => setTimeout(r, 0));

function failCode(e: unknown): PartyImportFailCode {
  if (e instanceof LicenceError && e.reason === 'limit') return 'limit';
  if (e instanceof PartyError && (e.code === 'mobile_taken' || e.code === 'mobile_invalid' || e.code === 'name_required')) return e.code;
  if (e instanceof VoucherError) return 'opening';
  return 'other';
}

export async function importParties(
  ctx: VoucherCtx,
  type: PartyType,
  rows: PartyImportRow[],
  opts: { updateExisting: boolean },
  onProgress?: (done: number, total: number) => void,
): Promise<PartyImportReport> {
  const perm = type === 'C' ? 'parties.manage' : 'purchases.manage';
  if (!roleHas(ctx.user.permissions, perm)) throw new PermissionError(perm);
  assertCanWrite();
  const t0 = Date.now();
  const report: PartyImportReport = { created: 0, updated: 0, skippedExisting: 0, openingIgnored: 0, failed: [], ms: 0 };
  const tbl = type === 'C' ? customers : suppliers;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    try {
      const existing = r.mobile ? (await ctx.db.select({ id: tbl.id }).from(tbl).where(and(eq(tbl.mobile, r.mobile), isNull(tbl.deletedAt))).limit(1))[0] : undefined;
      if (existing) {
        if (!opts.updateExisting) {
          report.skippedExisting++;
          continue;
        }
        const before = await getParty(ctx.db, type, existing.id);
        if (!before) continue;
        // Only the cells the file fills in replace what is saved.
        await saveParty(ctx, type, {
          id: existing.id,
          name: r.name,
          mobile: before.mobile,
          address: r.address ?? before.address,
          email: r.email ?? before.email,
          taxNumber: r.taxNumber ?? before.taxNumber,
          notes: r.notes ?? before.notes,
          creditLimitMinor: r.creditLimitMinor ?? before.creditLimitMinor,
          priceTier: before.priceTier,
        });
        if (r.openingMinor) report.openingIgnored++;
        report.updated++;
      } else {
        const input: PartyInput = { name: r.name, mobile: r.mobile, address: r.address, email: r.email, taxNumber: r.taxNumber, notes: r.notes, creditLimitMinor: type === 'C' ? r.creditLimitMinor : null };
        const opening = r.openingMinor ? { amountMinor: Math.abs(r.openingMinor), sign: (r.openingMinor > 0 ? 1 : -1) as 1 | -1 } : null;
        await createPartyWithOpening(ctx, type, input, opening);
        report.created++;
      }
    } catch (e) {
      // Permission/licence problems are the same for every row: stop and say so.
      if (e instanceof PermissionError || (e instanceof LicenceError && e.reason !== 'limit')) throw e;
      report.failed.push({ rowNumber: r.rowNumber, code: failCode(e) });
    }
    if (i % 20 === 19) {
      onProgress?.(i + 1, rows.length);
      await yieldToUi();
    }
  }
  onProgress?.(rows.length, rows.length);
  report.ms = Date.now() - t0;
  await withTx(ctx.db, (tx) =>
    appendAudit(tx, {
      action: 'party.import',
      entity: type === 'C' ? 'customers' : 'suppliers',
      after: { created: report.created, updated: report.updated, skipped: report.skippedExisting, failed: report.failed.length },
      userId: ctx.user.id,
      deviceId: ctx.device.id,
      at: ctx.now?.() ?? Date.now(),
    }),
  );
  if (report.created === 0 && report.updated === 0 && report.failed.length && report.failed.every((f) => f.code === 'limit')) throw new LicenceError('limit', 'parties');
  return report;
}
