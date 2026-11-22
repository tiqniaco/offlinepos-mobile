import QRCode from 'qrcode';

/** QR as an SVG string (used by the receipt image and the PDF). Error correction M, quiet zone 1. */
export function qrSvg(text: string): string {
  let svg = '';
  QRCode.toString(text, { type: 'svg', errorCorrectionLevel: 'M', margin: 1 }, (err, s) => {
    if (!err) svg = s;
  });
  return svg;
}
