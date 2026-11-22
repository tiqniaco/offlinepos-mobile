/**
 * ZATCA (KSA) simplified-invoice QR code — Phase 1 "TLV" format (SPEC §3: ZATCA-format TLV QR).
 * Tags: 1 seller name, 2 VAT number, 3 timestamp (ISO 8601), 4 invoice total incl. VAT, 5 VAT total.
 * Each field: tag byte, length byte, UTF-8 value. The QR content is base64 of the concatenation.
 * Phase 2 (integration) adds signed XML + more tags; see PLAN.md D-10.
 */
import { utf8ToBytes } from './crypto';
import { formatMinor } from './money';

function b64(bytes: Uint8Array): string {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += A[(n >> 18) & 63]! + A[(n >> 12) & 63]! + (i + 1 < bytes.length ? A[(n >> 6) & 63]! : '=') + (i + 2 < bytes.length ? A[n & 63]! : '=');
  }
  return out;
}

export function zatcaTlvBase64(f: { sellerName: string; vatNumber: string; timestamp: string; totalWithVatMinor: number; vatMinor: number }): string {
  const fields = [f.sellerName, f.vatNumber, f.timestamp, formatMinor(f.totalWithVatMinor, { grouping: false }), formatMinor(f.vatMinor, { grouping: false })];
  const parts: number[] = [];
  fields.forEach((v, i) => {
    const bytes = utf8ToBytes(v);
    if (bytes.length > 255) throw new Error(`ZATCA field ${i + 1} too long`);
    parts.push(i + 1, bytes.length, ...bytes);
  });
  return b64(new Uint8Array(parts));
}

/** ISO 8601 UTC without milliseconds, as ZATCA examples use: 2022-04-25T15:30:00Z */
export function zatcaTimestamp(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}
