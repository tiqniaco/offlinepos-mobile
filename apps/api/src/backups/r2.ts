/**
 * Presigned R2 URLs (S3 SigV4 via aws4fetch): the phone uploads/downloads the encrypted backup directly to R2,
 * so the Worker never touches backup bytes and stays within the request budget (PLAN.md §9.3).
 */
import { AwsClient } from 'aws4fetch';
import type { Env } from '../env';

export const PRESIGN_SECONDS = 15 * 60;

function client(env: Env) {
  return new AwsClient({ accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY, service: 's3', region: 'auto' });
}

export async function presign(env: Env, key: string, method: 'PUT' | 'GET', size?: number): Promise<{ url: string; headers: Record<string, string>; expiresAt: number }> {
  const url = new URL(`https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET}/${key}`);
  url.searchParams.set('X-Amz-Expires', String(PRESIGN_SECONDS));
  const headers: Record<string, string> = method === 'PUT' ? { 'Content-Type': 'application/octet-stream', ...(size ? { 'Content-Length': String(size) } : {}) } : {};
  const signed = await client(env).sign(new Request(url, { method, headers }), { aws: { signQuery: true, allHeaders: method === 'PUT' } });
  return { url: signed.url, headers, expiresAt: Date.now() + PRESIGN_SECONDS * 1000 };
}
