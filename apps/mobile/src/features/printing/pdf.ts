/**
 * A4 invoice / quotation / return → expo-print PDF (HTML built by ./a4.ts). Arabic shaping is handled by the WebView;
 * the Readex Pro font is embedded as a data URI so the PDF looks the same on every phone.
 */
import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';
import i18n from 'i18next';
import { colors } from '../../ui';
import type { ReceiptData } from './receiptData';
import { buildA4Html, type A4Options } from './a4';

let fontCss: string | null = null;

export async function embeddedFontCss(): Promise<string> {
  if (fontCss) return fontCss;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const f = require('@expo-google-fonts/readex-pro');
    const face = async (mod: number, weight: number) => {
      const a = Asset.fromModule(mod);
      await a.downloadAsync();
      const b64 = await new File(a.localUri ?? a.uri).base64();
      return `@font-face{font-family:'Readex';font-weight:${weight};src:url(data:font/ttf;base64,${b64}) format('truetype');}`;
    };
    fontCss = (await face(f.ReadexPro_400Regular, 400)) + (await face(f.ReadexPro_700Bold, 700));
  } catch {
    fontCss = '';
  }
  return fontCss;
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
