/**
 * One document model for every printable/shareable report (statement, vouchers, purchase invoices, shift
 * close, expenses). The same ReportDoc becomes an A4 PDF, an Excel sheet, a thermal receipt and a short
 * WhatsApp message, so all four always show the same numbers.
 */
export interface ReportColumn {
  key: string;
  label: string;
  /** Numbers/money are right-aligned in LTR digits. */
  num?: boolean;
  /** Hidden on 58 mm thermal paper (too narrow). */
  wideOnly?: boolean;
}

export interface ReportRow {
  cells: Record<string, string>;
  /** Raw numbers for Excel (same keys as cells). */
  values?: Record<string, number | string>;
  /** Detail lines under the row (detailed statement: invoice items). */
  sub?: string[];
  muted?: boolean;
}

export interface ReportDoc {
  title: string;
  number?: string | null;
  /** epoch ms */
  date?: number;
  period?: string | null;
  businessName: string;
  address?: string | null;
  phones?: string[];
  vatNumber?: string | null;
  /** "العميل: محمود — 01012345678" */
  partyLine?: string | null;
  /** Big figures at the top (balance, amount…). */
  summary: { label: string; value: string; strong?: boolean }[];
  columns: ReportColumn[];
  rows: ReportRow[];
  totals: { label: string; value: string; strong?: boolean }[];
  note?: string | null;
  footer?: string | null;
  /** Watermark for voided documents. */
  voided?: boolean;
  fileName: string;
  /** Short message for WhatsApp (falls back to summary + totals). */
  whatsappText?: string;
}

/** Plain-text version for WhatsApp / SMS. */
export function reportText(d: ReportDoc): string {
  if (d.whatsappText) return d.whatsappText;
  const lines = [`*${d.businessName}*`, `${d.title}${d.number ? ` ${d.number}` : ''}`];
  if (d.period) lines.push(d.period);
  if (d.partyLine) lines.push(d.partyLine);
  lines.push('');
  for (const s of d.summary) lines.push(`${s.label}: ${s.strong ? `*${s.value}*` : s.value}`);
  for (const s of d.totals) lines.push(`${s.label}: ${s.strong ? `*${s.value}*` : s.value}`);
  if (d.note) lines.push('', d.note);
  return lines.join('\n');
}

/** Rows for Excel: header row + data rows (numbers stay numbers). */
export function reportSheet(d: ReportDoc): (string | number)[][] {
  const head: (string | number)[][] = [[d.businessName], [d.title + (d.number ? ` ${d.number}` : '')]];
  if (d.period) head.push([d.period]);
  if (d.partyLine) head.push([d.partyLine]);
  for (const s of d.summary) head.push([s.label, s.value]);
  head.push([]);
  const cols = d.columns;
  const body = d.rows.flatMap((r) => [cols.map((c) => r.values?.[c.key] ?? r.cells[c.key] ?? ''), ...(r.sub ?? []).map((s) => ['', s])]);
  const foot = d.totals.map((t) => [t.label, t.value]);
  return [...head, cols.map((c) => c.label), ...body, [], ...foot];
}
