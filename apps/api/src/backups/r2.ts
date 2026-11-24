/**
 * Backup upload/download URLs for the phone.
 *  - With R2 API keys (R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY): presigned R2 URLs (S3 SigV4 via aws4fetch), the phone
 *    talks to R2 directly and the Worker never touches backup bytes (PLAN.md §9.3).
 *  - Without them: a short-lived signed URL on this Worker (/v1/backups/blob), which streams the bytes to/from the R2
 *    binding. Same contract for the phone ({url, headers, expiresAt}); no extra secret to set up.
 */
import { AwsClient } from 'aws4fetch';
import type { Env } from '../env';
import { hmacHex, safeEqual } from '../lib/crypto';

export const PRESIGN_SECONDS = 15 * 60;

let publicOrigin = '';
/** Set per request (index.ts): the Worker's own https origin, for the fallback URLs. */
export function setPublicOrigin(origin: string) {
  if (origin) publicOrigin = origin;
}

const hasR2Keys = (env: Env) => !!env.R2_ACCESS_KEY_ID && !!env.R2_SECRET_ACCESS_KEY && !!env.R2_ACCOUNT_ID;

function client(env: Env) {
  return new AwsClient({ accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY, service: 's3', region: 'auto' });
}

const blobMac = (env: Env, key: string, method: string, exp: number) => hmacHex(env.ACCESS_TOKEN_SECRET, `blob:${method}:${key}:${exp}`);

export async function verifyBlobUrl(env: Env, key: string, method: string, exp: number, sig: string, now: number): Promise<boolean> {
  if (!key || !Number.isFinite(exp) || exp < now) return false;
  return safeEqual(await blobMac(env, key, method, exp), sig);
}

export async function presign(env: Env, key: string, method: 'PUT' | 'GET', size?: number): Promise<{ url: string; headers: Record<string, string>; expiresAt: number }> {
  const headers: Record<string, string> = method === 'PUT' ? { 'Content-Type': 'application/octet-stream', ...(size ? { 'Content-Length': String(size) } : {}) } : {};
  const expiresAt = Date.now() + PRESIGN_SECONDS * 1000;
  if (!hasR2Keys(env)) {
    const u = new URL(`${publicOrigin || 'https://localhost'}/v1/backups/blob`);
    u.searchParams.set('k', key);
    u.searchParams.set('m', method);
    u.searchParams.set('exp', String(expiresAt));
    u.searchParams.set('sig', await blobMac(env, key, method, expiresAt));
    return { url: u.toString(), headers, expiresAt };
  }
  const url = new URL(`https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET}/${key}`);
  url.searchParams.set('X-Amz-Expires', String(PRESIGN_SECONDS));
  const signed = await client(env).sign(new Request(url, { method, headers }), { aws: { signQuery: true, allHeaders: method === 'PUT' } });
  return { url: signed.url, headers, expiresAt };
}
