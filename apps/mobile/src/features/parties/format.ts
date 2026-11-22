import i18n from 'i18next';
import { colors } from '../../ui';
import { money } from '../../lib/format';

/** "عليه 120.00 ج.م" (customer owes us) / "له 50.00 ج.م" (we owe) with a matching colour. */
export function balanceLabel(type: 'C' | 'S', owedMinor: number, currency: 'EGP' | 'SAR', lang: string): { text: string; color: string; tag: string } {
  if (owedMinor === 0) return { text: money(0, currency, lang), color: colors.ink.mute, tag: i18n.t('parties.settled') };
  const theyOwe = type === 'C' ? owedMinor > 0 : owedMinor < 0;
  return {
    text: money(Math.abs(owedMinor), currency, lang),
    color: theyOwe ? (type === 'C' ? colors.rose[700] : colors.leaf[700]) : type === 'S' ? colors.amber[700] : colors.leaf[700],
    tag: i18n.t(theyOwe ? 'report.owesUs' : 'report.weOwe'),
  };
}

const PALETTE = ['#0F4CC7', '#0E8C80', '#B17016', '#A8352E', '#306FAA', '#348A40', '#475569'];
export function partyColor(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length]!;
}

/** Reminder message from the template: {name} {amount} {business} {days}. */
export function reminderText(template: string, v: { name: string; amount: string; business: string; days: number }) {
  return template.replace(/\{name\}/g, v.name).replace(/\{amount\}/g, v.amount).replace(/\{business\}/g, v.business).replace(/\{days\}/g, String(v.days));
}
