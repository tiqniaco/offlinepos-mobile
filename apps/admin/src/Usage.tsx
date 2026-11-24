/** «الاستهلاك»: usage vs the Cloudflare free tier, usage per shop, and per-shop limit overrides. */
import { useCallback, useEffect, useState } from 'react';
import { call } from './api';

function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    setError(null);
    fn().then(setData, (e: Error) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(reload, [reload]);
  return { data, error, reload };
}

const n = (v: number | null | undefined) => (v ?? 0).toLocaleString('en-US');
export const fmtBytes = (b: number | null | undefined) => {
  const v = b ?? 0;
  if (v >= 1024 ** 3) return `${(v / 1024 ** 3).toFixed(2)} GB`;
  if (v >= 1024 ** 2) return `${(v / 1024 ** 2).toFixed(1)} MB`;
  if (v >= 1024) return `${(v / 1024).toFixed(0)} KB`;
  return `${v} B`;
};
const usd = (v: number) => `$${v.toFixed(v < 1 ? 3 : 2)}`;
const lim = (v: number | undefined) => (v == null || v === -1 ? '∞' : n(v));
const LEVEL_COLOR: Record<string, string> = { ok: 'var(--leaf)', warn: 'var(--amber)', danger: 'var(--rose)' };
const levelOf = (pct: number) => (pct >= 90 ? 'danger' : pct >= 70 ? 'warn' : 'ok');
const GAUGE_AR: Record<string, string> = {
  requests: 'طلبات Workers اليوم (من 100 ألف)',
  d1_writes: 'صفوف D1 اتكتبت اليوم (من 100 ألف)',
  d1_reads: 'صفوف D1 اتقرت اليوم (من 5 مليون)',
  r2_storage: 'مساحة R2 (من 10 GB)',
};

function Meter({ pct, label, sub }: { pct: number; label: string; sub: string }) {
  const lv = levelOf(pct);
  return (
    <div className="card" style={{ flex: 1, minWidth: 220 }}>
      <div className="muted">{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: LEVEL_COLOR[lv] }}>{pct.toFixed(1)}%</div>
      <div style={{ height: 8, borderRadius: 99, background: 'var(--paper)', overflow: 'hidden', margin: '6px 0' }}>
        <div style={{ width: `${Math.min(100, pct)}%`, height: '100%', background: LEVEL_COLOR[lv] }} />
      </div>
      <div className="muted ltr">{sub}</div>
    </div>
  );
}

function Bars({ series, metric, label, bytes }: { series: any[]; metric: string; label: string; bytes?: boolean }) {
  const vals = series.map((d) => Number(d[metric] ?? 0));
  const max = Math.max(1, ...vals);
  return (
    <div className="card">
      <strong>{label}</strong>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 90, marginTop: 10, direction: 'ltr' }}>
        {series.map((d, i) => (
          <div key={d.day} title={`${d.day}: ${bytes ? fmtBytes(vals[i]) : n(vals[i])}`} style={{ flex: 1, minWidth: 4, height: `${Math.max(2, (vals[i]! / max) * 100)}%`, background: 'var(--teal)', borderRadius: '3px 3px 0 0', opacity: vals[i] ? 1 : 0.25 }} />
        ))}
      </div>
      <div className="muted ltr" style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>{series[0]?.day ?? ''}</span>
        <span>max {bytes ? fmtBytes(max) : n(max)}</span>
        <span>{series[series.length - 1]?.day ?? ''}</span>
      </div>
    </div>
  );
}

/** Dashboard banner: a global gauge above 70 % of the free tier today. */
export function UsageBanner({ alert, open }: { alert: { gauges: { key: string; pct: number; level: string }[] } | null | undefined; open: () => void }) {
  if (!alert?.gauges?.length) return null;
  const danger = alert.gauges.some((g) => g.level === 'danger');
  return (
    <div className="card alert row" style={{ marginBottom: 12, ...(danger ? { background: 'var(--rose-l)', borderColor: 'var(--rose)' } : {}) }}>
      <div style={{ flex: 1 }}>
        <strong>{danger ? 'الاستهلاك قرب يخلص حد Cloudflare المجاني' : 'الاستهلاك عدّى 70% من حد Cloudflare المجاني'}</strong>
        <div className="muted">{alert.gauges.map((g) => `${GAUGE_AR[g.key] ?? g.key}: ${g.pct.toFixed(0)}%`).join(' · ')}</div>
      </div>
      <button className="btn" onClick={open}>شوف الاستهلاك</button>
    </div>
  );
}

const SORT_COLS: [string, string][] = [
  ['name', 'النشاط'],
  ['plan', 'الباقة'],
  ['requests', 'طلبات اليوم'],
  ['sms', 'SMS اليوم'],
  ['ocr', 'مسح فواتير/شهر'],
  ['backup', 'نسخ السيرفر'],
  ['receipts', 'إيصالات/شهر'],
  ['devices', 'أجهزة'],
];

export function UsagePage({ open }: { open: (id: string) => void }) {
  const [days, setDays] = useState(30);
  const g = useLoad(() => call(`/usage?days=${days}`), [days]);
  const [sort, setSort] = useState('requests');
  const [dir, setDir] = useState<'desc' | 'asc'>('desc');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const t = useLoad(() => call(`/usage/businesses?sort=${sort}&dir=${dir}&q=${encodeURIComponent(query)}`), [sort, dir, query]);
  const d = g.data;
  const tot = (k: string, p: 'today' | 'd7' | 'd30') => d?.totals?.[p]?.[k]?.count ?? 0;
  return (
    <>
      <h2>الاستهلاك</h2>
      {g.error ? <div className="err">{g.error}</div> : null}
      {d ? (
        <>
          <div className="row" style={{ gap: 12, marginBottom: 12 }}>
            {d.status.gauges.map((x: any) => (
              <Meter key={x.key} pct={x.pct} label={GAUGE_AR[x.key] ?? x.label} sub={x.key === 'r2_storage' ? `${fmtBytes(x.used)} / ${fmtBytes(x.max)}` : `${n(x.used)} / ${n(x.max)}`} />
            ))}
          </div>
          <p className="muted">أيام الاستهلاك بتوقيت القاهرة؛ حدود Cloudflare اليومية بتتصفّر الساعة 12 بتوقيت UTC، فالنسبة تقريبية. صفوف D1 محسوبة من ردود قاعدة البيانات لطلبات التطبيق (من غير الـ cron).</p>
          <div className="card" style={{ marginBottom: 12 }}>
            <table>
              <thead>
                <tr><th></th><th>النهارده</th><th>7 أيام</th><th>30 يوم</th></tr>
              </thead>
              <tbody>
                <tr><td>طلبات السيرفر</td><td>{n(tot('api_requests', 'today'))}</td><td>{n(tot('api_requests', 'd7'))}</td><td>{n(tot('api_requests', 'd30'))}</td></tr>
                <tr><td>تحديثات يومية (check-in)</td><td>{n(tot('checkins', 'today'))}</td><td>{n(tot('checkins', 'd7'))}</td><td>{n(tot('checkins', 'd30'))}</td></tr>
                <tr><td>رسائل SMS اتبعتت</td><td>{n(tot('otp_sms_sent', 'today'))}</td><td>{n(tot('otp_sms_sent', 'd7'))}</td><td>{n(tot('otp_sms_sent', 'd30'))}</td></tr>
                <tr><td>مسح فواتير (OCR)</td><td>{n(tot('ocr_scans', 'today'))}</td><td>{n(tot('ocr_scans', 'd7'))}</td><td>{n(tot('ocr_scans', 'd30'))}</td></tr>
                <tr>
                  <td>توكنز OCR (داخل / خارج)</td>
                  {(['today', 'd7', 'd30'] as const).map((p) => <td key={p} className="ltr">{n(tot('ocr_input_tokens', p))} / {n(tot('ocr_output_tokens', p))}</td>)}
                </tr>
                <tr><td>محاولات Opus (الموديل الغالي)</td><td>{n(tot('ocr_opus_calls', 'today'))}</td><td>{n(tot('ocr_opus_calls', 'd7'))}</td><td>{n(tot('ocr_opus_calls', 'd30'))}</td></tr>
                <tr>
                  <td>تكلفة OCR <span className="pill trial">تقدير</span></td>
                  <td className="ltr">{usd(d.ocrCostUsd.today)}</td><td className="ltr">{usd(d.ocrCostUsd.d7)}</td><td className="ltr">{usd(d.ocrCostUsd.d30)}</td>
                </tr>
                <tr><td>نسخ احتياطية اترفعت</td><td>{n(tot('backup_uploads', 'today'))}</td><td>{n(tot('backup_uploads', 'd7'))}</td><td>{n(tot('backup_uploads', 'd30'))}</td></tr>
                <tr><td>إيصالات دفع اترفعت</td><td>{n(tot('receipt_uploads', 'today'))}</td><td>{n(tot('receipt_uploads', 'd7'))}</td><td>{n(tot('receipt_uploads', 'd30'))}</td></tr>
                <tr><td>رسائل وصلت للأجهزة</td><td>{n(tot('announcements_delivered', 'today'))}</td><td>{n(tot('announcements_delivered', 'd7'))}</td><td>{n(tot('announcements_delivered', 'd30'))}</td></tr>
              </tbody>
            </table>
            <p className="muted ltr">
              Haiku ${d.prices.haiku.in} / ${d.prices.haiku.out} · Opus ${d.prices.opus.in} / ${d.prices.opus.out} per MTok (in / out) — estimate
            </p>
            <p className="muted">
              مساحة النسخ على السيرفر: {fmtBytes(d.status.storage.backupBytes)} ({n(d.status.storage.backupCount)} نسخة) · الإيصالات: {fmtBytes(d.status.storage.receiptBytes)}
            </p>
          </div>
          <div className="row" style={{ marginBottom: 8 }}>
            <span className="muted">الرسم البياني:</span>
            {[7, 30, 90].map((x) => (
              <button key={x} className={x === days ? 'btn' : 'btn ghost'} onClick={() => setDays(x)}>{x} يوم</button>
            ))}
          </div>
          <div className="grid two" style={{ marginBottom: 16 }}>
            <Bars series={d.series} metric="api_requests" label="طلبات السيرفر يومياً" />
            <Bars series={d.series} metric="d1_rows_written" label="صفوف D1 اتكتبت يومياً" />
            <Bars series={d.series} metric="otp_sms_sent" label="SMS يومياً" />
            <Bars series={d.series} metric="ocr_scans" label="مسح فواتير يومياً" />
          </div>
        </>
      ) : !g.error ? <p className="muted">جاري التحميل…</p> : null}

      <h2>الاستهلاك لكل نشاط</h2>
      <form className="row" style={{ marginBottom: 12 }} onSubmit={(e) => { e.preventDefault(); setQuery(q); }}>
        <input placeholder="بحث بالاسم" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, maxWidth: 320 }} />
        <button className="btn ghost">بحث</button>
      </form>
      {t.error ? <div className="err">{t.error}</div> : null}
      <div className="card" style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              {SORT_COLS.map(([k, label]) => (
                <th key={k} className="click" style={{ cursor: 'pointer' }} onClick={() => (sort === k ? setDir(dir === 'desc' ? 'asc' : 'desc') : (setSort(k), setDir('desc')))}>
                  {label} {sort === k ? (dir === 'desc' ? '▼' : '▲') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {t.data?.businesses.map((b: any) => {
              const over = (used: number, max: number) => (max !== -1 && used >= max ? 'err' : '');
              const mark = (k: string) => (b.overridden.includes(k) ? ' *' : '');
              return (
                <tr key={b.id} className="click" onClick={() => open(b.id)}>
                  <td>{b.name}</td>
                  <td>{b.effectivePlan}{b.effectivePlan !== b.plan ? <span className="muted"> ({b.plan})</span> : null}</td>
                  <td className={over(b.requestsToday, b.limits.api_requests_day)}>{n(b.requestsToday)} / {lim(b.limits.api_requests_day)}{mark('api_requests_day')}</td>
                  <td className={over(b.smsToday, b.limits.sms_day)}>{n(b.smsToday)} / {lim(b.limits.sms_day)}{mark('sms_day')}</td>
                  <td className={over(b.ocrMonth, b.limits.ocr_month)}>{n(b.ocrMonth)} / {lim(b.limits.ocr_month)}{mark('ocr_month')}</td>
                  <td className={over(b.backupBytes / 1024 / 1024, b.limits.backup_storage_mb)}>{fmtBytes(b.backupBytes)} / {b.limits.backup_storage_mb === -1 ? '∞' : `${n(b.limits.backup_storage_mb)} MB`}{mark('backup_storage_mb')}</td>
                  <td className={over(b.receiptsMonth, b.limits.receipt_uploads_month)}>{n(b.receiptsMonth)} / {lim(b.limits.receipt_uploads_month)}{mark('receipt_uploads_month')}</td>
                  <td>{n(b.devices)} / {lim(b.limits.devices)}{mark('devices')}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {t.data && t.data.businesses.length === 0 ? <p className="muted">لا توجد نتائج.</p> : null}
        <p className="muted">* = حد معدّل للنشاط ده (مش حد الباقة). اضغط على النشاط لتفاصيل الاستهلاك وتعديل الحدود.</p>
      </div>
    </>
  );
}

export const USAGE_LIMIT_LABELS: Record<string, string> = {
  users: 'مستخدمين',
  products: 'منتجات',
  parties: 'عملاء/موردين',
  invoices_month: 'فواتير/شهر',
  backups_kept: 'نسخ محفوظة على السيرفر',
  ocr_month: 'مسح فواتير/شهر',
  sms_day: 'رسائل SMS/يوم',
  backup_storage_mb: 'مساحة النسخ على السيرفر (MB)',
  receipt_uploads_month: 'إيصالات دفع/شهر',
  api_requests_day: 'طلبات السيرفر/يوم',
  devices: 'أجهزة',
};

export function BusinessUsage({ id, back }: { id: string; back: () => void }) {
  const [days, setDays] = useState(30);
  const { data, error, reload } = useLoad(() => call(`/businesses/${id}/usage?days=${days}`), [id, days]);
  const [form, setForm] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (data) setForm(Object.fromEntries(data.limits.map((l: any) => [l.key, l.override == null ? '' : String(l.override)])));
  }, [data]);
  if (error) return <div className="err">{error}</div>;
  if (!data) return <p className="muted">جاري التحميل…</p>;
  const save = async () => {
    setMsg(null);
    const limits: Record<string, number | null> = {};
    for (const l of data.limits) {
      const raw = (form[l.key] ?? '').trim();
      const prev = l.override == null ? '' : String(l.override);
      if (raw === prev) continue;
      if (raw === '') limits[l.key] = null;
      else {
        const v = Number(raw);
        if (!Number.isInteger(v) || v < -1) return setMsg(`«${USAGE_LIMIT_LABELS[l.key] ?? l.key}» لازم رقم صحيح (‎-1 = بدون حد، فاضي = حد الباقة)`);
        limits[l.key] = v;
      }
    }
    if (!Object.keys(limits).length) return setMsg('مفيش تغيير');
    try {
      await call(`/businesses/${id}/limits`, { method: 'PUT', body: { limits, ...(note.trim() ? { note: note.trim() } : {}) } });
      setMsg('اتحفظ — بيوصل للموبايل في أول تحديث يومي.');
      reload();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  return (
    <>
      <div className="row" style={{ marginBottom: 14 }}>
        <button className="btn ghost" onClick={back}>→ رجوع</button>
        <h2 style={{ margin: 0 }}>استهلاك {data.business.name}</h2>
        <span className="muted">الباقة: {data.business.effectivePlan}{data.business.effectivePlan !== data.business.plan ? ` (${data.business.plan})` : ''}</span>
      </div>
      <div className="row" style={{ marginBottom: 8 }}>
        {[7, 30, 90].map((x) => (
          <button key={x} className={x === days ? 'btn' : 'btn ghost'} onClick={() => setDays(x)}>{x} يوم</button>
        ))}
        <span className="muted">تكلفة OCR في الفترة (تقدير): <span className="ltr">{usd(data.ocrCostUsd30)}</span></span>
      </div>
      <div className="grid two" style={{ marginBottom: 16 }}>
        <Bars series={data.series} metric="api_requests" label="طلبات السيرفر يومياً" />
        <Bars series={data.series} metric="otp_sms_sent" label="SMS يومياً" />
        <Bars series={data.series} metric="ocr_scans" label="مسح فواتير يومياً" />
        <Bars series={data.series} metric="backup_bytes_stored" label="مساحة النسخ على السيرفر" bytes />
      </div>
      <div className="card">
        <strong>عدّل الحدود</strong>
        <p className="muted">الخانة الفاضية = حد الباقة. ‎-1 = بدون حد. 0 = ممنوع (مثلاً 0 في مساحة النسخ = مفيش نسخ على السيرفر).</p>
        <table>
          <thead><tr><th>الحد</th><th>المستخدم دلوقتي</th><th>حد الباقة</th><th>الحد المعدّل</th><th>الفعلي</th></tr></thead>
          <tbody>
            {data.limits.map((l: any) => (
              <tr key={l.key}>
                <td>{USAGE_LIMIT_LABELS[l.key] ?? l.key} <span className="muted ltr">({l.key})</span></td>
                <td className={l.used != null && l.effective !== -1 && l.used >= l.effective ? 'err' : ''}>{l.used == null ? '—' : n(l.used)}</td>
                <td>{lim(l.plan)}</td>
                <td>
                  <input type="number" min={-1} placeholder="حد الباقة" value={form[l.key] ?? ''} onChange={(e) => setForm({ ...form, [l.key]: e.target.value })} style={{ width: 120 }} />
                  {l.note ? <div className="muted">{l.note}</div> : null}
                </td>
                <td><strong>{lim(l.effective)}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row" style={{ marginTop: 12 }}>
          <input placeholder="ملاحظة (اختياري) — مثلاً: عميل VIP" value={note} onChange={(e) => setNote(e.target.value)} style={{ flex: 1, maxWidth: 360 }} />
          <button className="btn" onClick={save}>حفظ الحدود</button>
        </div>
        {msg ? <div className="ok">{msg}</div> : null}
      </div>
    </>
  );
}
