/** Admin API client. The session token lives in sessionStorage (cleared when the tab closes). */
const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8787';
const KEY = 'daftarak_admin_token';

export class AdminApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export const session = {
  get: () => sessionStorage.getItem(KEY),
  set: (t: string) => sessionStorage.setItem(KEY, t),
  clear: () => sessionStorage.removeItem(KEY),
};

export async function call<T = any>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = session.get();
  const res = await fetch(`${API}/admin${path}`, {
    method: init.method ?? (init.body ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401) session.clear();
    throw new AdminApiError(res.status, json?.error?.code ?? 'error', json?.error?.message ?? `HTTP ${res.status}`);
  }
  return json as T;
}

export const fmtDate = (ms: number | null | undefined) => (ms ? new Date(ms).toLocaleString('ar-EG-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
export const fmtMoney = (minor: number) => (minor / 100).toLocaleString('en-US', { minimumFractionDigits: 0 });

/** Fetches an authenticated binary resource (e.g. a receipt image) and returns an object URL (revoke when done). */
export async function blobUrl(path: string): Promise<string> {
  const token = session.get();
  const res = await fetch(`${API}/admin${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) {
    if (res.status === 401) session.clear();
    throw new AdminApiError(res.status, 'error', `HTTP ${res.status}`);
  }
  return URL.createObjectURL(await res.blob());
}

export function timeAgo(ms: number, now = Date.now()): string {
  const m = Math.max(0, Math.round((now - ms) / 60_000));
  if (m < 1) return 'دلوقتي';
  if (m < 60) return `من ${m} دقيقة`;
  const h = Math.round(m / 60);
  if (h < 24) return `من ${h} ساعة`;
  return `من ${Math.round(h / 24)} يوم`;
}
