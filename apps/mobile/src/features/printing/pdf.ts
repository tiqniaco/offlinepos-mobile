/**
 * A4 invoice / quotation / return → expo-print PDF (HTML built by ./a4.ts). Arabic shaping is handled by the WebView;
 * the app's Arabic font is embedded as a data URI so the PDF looks the same on every phone.
 */
import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';
import i18n from 'i18next';
import { colors } from '../../ui';
import { currentFont, FONT_FAMILIES } from '../../ui/fonts';
import type { ReceiptData } from './receiptData';
import { a4FontFaceCss, buildA4Html, type A4Options } from './a4';

/** @font-face CSS per app font family, cached in memory (≈ 270 KB of base64 for regular + bold). */
const fontCache = new Map<string, string>();

/**
 * The app's selected Arabic font (المظهر; Readex Pro by default), regular + bold only, embedded as base64 so the PDF
 * renders the same on every phone. Any failure → '' and the HTML falls back to the system Arabic font.
 */
export async function embeddedFontCss(): Promise<string> {
  const fam = FONT_FAMILIES.find((f) => f.id === currentFont) ?? FONT_FAMILIES[0]!;
  const hit = fontCache.get(fam.id);
  if (hit != null) return hit;
  try {
    const mods = fam.load();
    const b64 = async (name: string) => {
      const mod = mods[name];
      if (mod == null) return null;
      const a = Asset.fromModule(mod);
      await a.downloadAsync();
      return new File(a.localUri ?? a.uri).base64();
    };
    const [regular, bold] = await Promise.all([b64(fam.set.regular), b64(fam.set.bold)]);
    const css = a4FontFaceCss(regular, bold);
    fontCache.set(fam.id, css);
    return css;
  } catch {
    return '';
  }
}

export { esc } from './a4';

/** The logo as a data: URI (file:// images are blocked inside the print WebView). */
async function logoDataUri(path: string | null): Promise<string | null> {
  if (!path) return null;
  try {
    const b64 = await new File(path).base64();
    const ext = path.split('.').pop()?.toLowerCase();
    return `data:image/${ext === 'png' ? 'png' : ext === 'webp' ? 'webp' : 'jpeg'};base64,${b64}`;
  } catch {
    return null;
  }
}

/** The A4 HTML for a document (same builder as the settings preview). */
export async function receiptHtml(d: ReceiptData, opts: Pick<A4Options, 'style'> = {}): Promise<string> {
  const t = i18n.t.bind(i18n);
  return buildA4Html(d, {
    ...opts,
    brand: d.template.brandColor ?? colors.primary['600'],
    fontCss: await embeddedFontCss(),
    logoSrc: d.template.showLogo ? await logoDataUri(d.logoPath) : null,
    methodLabel: (m) => t(`pay.methods.${m}`),
  });
}
