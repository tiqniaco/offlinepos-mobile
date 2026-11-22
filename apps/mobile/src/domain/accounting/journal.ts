/**
 * Background double-entry journal (SPEC §4). Every financial document posts one balanced entry in the
 * same transaction. Not shown as an accounting UI in v1; reports (Phase 5) read it.
 */
import { eq, isNotNull } from 'drizzle-orm';
import { uuidv7 } from '@daftarak/shared';
import { accounts, journalEntries, journalLines } from '../../db/schema';
import type { Db } from '../../db/types';

export const SYSTEM_ACCOUNTS = [
  { key: 'CASH', code: '1100', ar: 'الخزنة', en: 'Cash', type: 'ASSET' },
  { key: 'CARD', code: '1110', ar: 'مدفوعات بالكارت', en: 'Card clearing', type: 'ASSET' },
  { key: 'WALLET', code: '1120', ar: 'محافظ إلكترونية', en: 'Wallets', type: 'ASSET' },
  { key: 'BANK', code: '1130', ar: 'البنك', en: 'Bank', type: 'ASSET' },
  { key: 'AR', code: '1200', ar: 'العملاء (مدينون)', en: 'Accounts receivable', type: 'ASSET' },
  { key: 'INVENTORY', code: '1300', ar: 'المخزون', en: 'Inventory', type: 'ASSET' },
  { key: 'VAT_IN', code: '1400', ar: 'ضريبة مدخلات', en: 'VAT input', type: 'ASSET' },
  { key: 'AP', code: '2100', ar: 'الموردين (دائنون)', en: 'Accounts payable', type: 'LIABILITY' },
  { key: 'VAT_OUT', code: '2200', ar: 'ضريبة مخرجات', en: 'VAT output', type: 'LIABILITY' },
  { key: 'OPENING_EQUITY', code: '3100', ar: 'أرصدة افتتاحية', en: 'Opening balances', type: 'EQUITY' },
  { key: 'SALES', code: '4100', ar: 'المبيعات', en: 'Sales', type: 'INCOME' },
  { key: 'SALES_RETURNS', code: '4200', ar: 'مردودات المبيعات', en: 'Sales returns', type: 'INCOME' },
  { key: 'ROUNDING', code: '4900', ar: 'فروق التقريب', en: 'Rounding', type: 'INCOME' },
  { key: 'COGS', code: '5100', ar: 'تكلفة البضاعة المباعة', en: 'Cost of goods sold', type: 'EXPENSE' },
  { key: 'STOCK_ADJ', code: '5200', ar: 'فروق المخزون', en: 'Stock adjustments', type: 'EXPENSE' },
  { key: 'EXPENSES', code: '6100', ar: 'مصروفات', en: 'Expenses', type: 'EXPENSE' },
] as const;
export type AccountKey = (typeof SYSTEM_ACCOUNTS)[number]['key'];

export const METHOD_ACCOUNT: Record<'cash' | 'card' | 'wallet' | 'bank' | 'credit', AccountKey> = { cash: 'CASH', card: 'CARD', wallet: 'WALLET', bank: 'BANK', credit: 'AR' };

/** Idempotent seed of the system chart of accounts. */
export async function ensureAccounts(db: Db, deviceId: string, now = Date.now()) {
  const have = new Set((await db.select({ k: accounts.systemKey }).from(accounts).where(isNotNull(accounts.systemKey))).map((r) => r.k));
  for (const a of SYSTEM_ACCOUNTS) {
    if (have.has(a.key)) continue;
    await db.insert(accounts).values({ id: uuidv7(now), code: a.code, systemKey: a.key, nameAr: a.ar, nameEn: a.en, type: a.type, createdAt: now, updatedAt: now, deviceId });
  }
}

export interface JournalLineInput {
  account: AccountKey;
  debit?: number;
  credit?: number;
  partyType?: 'C' | 'S';
  partyId?: string | null;
}

export class UnbalancedJournalError extends Error {}

export async function postJournal(
  tx: Db,
  ctx: { user: { id: string }; device: { id: string } },
  e: { sourceType: string; sourceId: string; businessDay: number; memo?: string; lines: JournalLineInput[]; at: number },
): Promise<string> {
  const lines = e.lines.filter((l) => (l.debit ?? 0) !== 0 || (l.credit ?? 0) !== 0);
  let d = 0;
  let c = 0;
  for (const l of lines) {
    if ((l.debit ?? 0) < 0 || (l.credit ?? 0) < 0) throw new UnbalancedJournalError('negative amount');
    d += l.debit ?? 0;
    c += l.credit ?? 0;
  }
  if (d !== c) throw new UnbalancedJournalError(`unbalanced journal ${e.sourceType}: debit ${d} ≠ credit ${c}`);
  const all = await tx.select({ id: accounts.id, key: accounts.systemKey }).from(accounts).where(isNotNull(accounts.systemKey));
  const byKey = new Map(all.map((a) => [a.key, a.id]));
  const id = uuidv7(e.at);
  const base = { createdAt: e.at, updatedAt: e.at, createdBy: ctx.user.id, deviceId: ctx.device.id };
  await tx.insert(journalEntries).values({ id, ...base, sourceType: e.sourceType, sourceId: e.sourceId, businessDay: e.businessDay, memo: e.memo ?? null });
  for (const l of lines) {
    const accountId = byKey.get(l.account);
    if (!accountId) throw new Error(`account ${l.account} missing — run ensureAccounts`);
    await tx.insert(journalLines).values({ id: uuidv7(e.at), ...base, entryId: id, accountId, debitMinor: l.debit ?? 0, creditMinor: l.credit ?? 0, partyType: l.partyType ?? null, partyId: l.partyId ?? null, businessDay: e.businessDay });
  }
  return id;
}

/** Trial balance check used by tests: Σ debit − Σ credit per account, and overall Σ = 0. */
export async function trialBalance(db: Db): Promise<Map<string, number>> {
  const rows = await db.select({ key: accounts.systemKey, d: journalLines.debitMinor, c: journalLines.creditMinor }).from(journalLines).innerJoin(accounts, eq(accounts.id, journalLines.accountId));
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.key ?? '?', (m.get(r.key ?? '?') ?? 0) + r.d - r.c);
  return m;
}
