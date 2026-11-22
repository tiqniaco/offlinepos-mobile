/** Display formatting. Latin digits everywhere (owner decision D-21). */
export function dateLabel(lang: string, d = new Date()) {
  return d.toLocaleDateString(lang === 'en' ? 'en-GB' : 'ar-EG-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long' });
}

export function dateTimeLabel(lang: string, ms: number) {
  return new Date(ms).toLocaleString(lang === 'en' ? 'en-GB' : 'ar-EG-u-nu-latn', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}
