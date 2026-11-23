/**
 * Live A4 preview («شكل الفواتير»): the REAL A4 HTML (same builder as the PDF) in a WebView, scaled so the whole
 * A4 width fits the screen, pinch-zoomable. Updates are pushed into the page (debounced 150 ms) without reloading,
 * so the scroll position is kept. If the WebView cannot load, `fallback` (the native sketch) is shown instead.
 *
 * DROP-IN: needs `react-native-webview` (14.0.1 for this Expo SDK) → copy to src/features/printing/A4Live.tsx.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useWindowDimensions, View } from 'react-native';
import { WebView as RNWebView, type WebViewProps } from 'react-native-webview';

// react-native-webview's class typings clash with React 19's JSX types; use it through a plain component type.
type WebViewHandle = { injectJavaScript: (js: string) => void };
const WebView = RNWebView as unknown as React.ComponentType<WebViewProps & { ref?: React.Ref<WebViewHandle> }>;
import type { ReceiptData } from './receiptData';
import { buildA4Html, type A4Options } from './a4';

/** A4 at 96 dpi. The preview draws the paper with its print margins (14/12/16 mm) as padding. */
const PAGE_W = 794;

function shell(fontCss: string, scale: number) {
  return `<!doctype html><html dir="rtl"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,minimum-scale=1,maximum-scale=5,user-scalable=yes"/>
<style>${fontCss}html{background:#E4E7EC}body{margin:0}#zoom{zoom:${scale};padding:12px 0}
.sheet{width:${PAGE_W}px;min-height:1123px;margin:0 auto;background:#fff;box-shadow:0 1px 4px rgba(16,24,40,.18);padding:14mm 12mm 16mm;box-sizing:border-box}</style>
<style id="doc"></style></head><body><div id="zoom"><div class="sheet" id="sheet"></div></div>
<script>window.__set=function(css,body){var y=window.scrollY;document.getElementById('doc').textContent=css;document.getElementById('sheet').innerHTML=body;window.scrollTo(0,y);};true;</script>
</body></html>`;
}

/** Split the builder's HTML into its CSS (without @page, which a screen ignores) and its body. */
function parts(html: string): { css: string; body: string } {
  const css = (html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '').replace(/@page\{[^{}]*(\{[^{}]*\}[^{}]*)*\}/, '');
  const body = html.match(/<body>([\s\S]*)<\/body>/)?.[1] ?? '';
  return { css, body };
}

export function A4Live({ d, opts, fontCss, fallback }: { d: ReceiptData; opts: A4Options; fontCss: string; fallback: ReactNode }) {
  const { width } = useWindowDimensions();
  const w = Math.min(width - 32, 520);
  const scale = (w - 8) / (PAGE_W + 16);
  const ref = useRef<WebViewHandle>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  // The font goes into the shell once (≈ 270 KB); updates carry only the document (no font CSS).
  const source = useMemo(() => ({ html: shell(fontCss, scale) }), [fontCss, scale]);
  const html = useMemo(() => buildA4Html(d, { ...opts, fontCss: '' }), [d, opts]);

  useEffect(() => {
    if (!ready) return;
    const id = setTimeout(() => {
      const { css, body } = parts(html);
      ref.current?.injectJavaScript(`window.__set(${JSON.stringify(css)},${JSON.stringify(body)});true;`);
    }, 150);
    return () => clearTimeout(id);
  }, [html, ready]);

  if (failed) return <>{fallback}</>;
  return (
    <View style={{ width: w, height: Math.round(w * 1.414) + 24, borderRadius: 8, overflow: 'hidden', backgroundColor: '#E4E7EC' }}>
      <WebView
        ref={ref}
        originWhitelist={['*']}
        source={source}
        onLoadEnd={() => setReady(true)}
        onError={() => setFailed(true)}
        onRenderProcessGone={() => setFailed(true)}
        javaScriptEnabled
        scalesPageToFit
        setBuiltInZoomControls
        setDisplayZoomControls={false}
        nestedScrollEnabled
        showsVerticalScrollIndicator
        style={{ backgroundColor: 'transparent' }}
      />
    </View>
  );
}
