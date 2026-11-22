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
