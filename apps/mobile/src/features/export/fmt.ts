/** Pure formatting helpers shared by the ReportDoc builders (no database, safe in unit tests). */
import i18n from 'i18next';
import { formatMinor } from '@daftarak/shared';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const t = (k: string, o?: Record<string, unknown>) => (i18n.t as any)(k, o) as string;

export type Currency = 'EGP' | 'SAR';

export interface BizHeader {
  businessName: string;
  address: string | null;
  phones: string[];
  vatNumber: string | null;
  currency: Currency;
}

export const cur = (c: Currency) => (i18n.language === 'en' ? (c === 'SAR' ? 'SAR' : 'EGP') : c === 'SAR' ? 'ر.س' : 'ج.م');
export const m = (v: number) => formatMinor(v);
export const dayText = (d: number) => `${Math.floor(d / 10000)}-${String(Math.floor(d / 100) % 100).padStart(2, '0')}-${String(d % 100).padStart(2, '0')}`;
export const stamp = () => new Date().toISOString().slice(0, 10);

/** Signed balance as words: "عليه 120.00" / "له 50.00". */
export function balanceWords(type: 'C' | 'S', owedMinor: number, c: Currency): string {
  if (owedMinor === 0) return `${m(0)} ${cur(c)}`;
  const key = type === 'C' ? (owedMinor > 0 ? 'report.owesUs' : 'report.weOwe') : owedMinor > 0 ? 'report.weOwe' : 'report.owesUs';
  return `${t(key)} ${m(Math.abs(owedMinor))} ${cur(c)}`;
}
