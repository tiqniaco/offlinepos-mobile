import { useCallback, useEffect, useState } from 'react';
import { call, fmtDate, fmtMoney, session, AdminApiError } from './api';

type View = { name: 'dashboard' } | { name: 'codes' } | { name: 'notify'; businessId?: string; businessName?: string } | { name: 'businesses' } | { name: 'business'; id: string } | { name: 'plans' } | { name: 'audit' } | { name: 'settings' };

const STATUS_AR: Record<string, string> = { trial: 'تجربة', active: 'مشترك', past_due: 'منتهي', suspended: 'موقوف' };
const DAY = 86_400_000;

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

function Login({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await call<{ token: string }>('/login', { body: { email, password, totp } });
      session.set(r.token);
      onDone();
    } catch (e) {
      setErr(e instanceof AdminApiError && e.status === 429 ? 'الحساب مقفول مؤقتاً، جرّب بعد ربع ساعة.' : 'بيانات الدخول غير صحيحة.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <h2>دفترك — لوحة التحكم</h2>
        <label>
          البريد الإلكتروني
          <input className="ltr" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          كلمة المرور
          <input className="ltr" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        <label>
          كود التحقق (تطبيق Authenticator)
          <input className="ltr" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} value={totp} onChange={(e) => setTotp(e.target.value.replace(/\D/g, ''))} required />
        </label>
        {err ? <div className="err">{err}</div> : null}
        <button className="btn" disabled={busy}>
          دخول
        </button>
      </form>
    </div>
  );
}

function Businesses({ open }: { open: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const { data, error } = useLoad(() => call(`/businesses?q=${encodeURIComponent(query)}`), [query]);
  return (
    <>
      <h2>الأنشطة</h2>
      <form className="row" style={{ marginBottom: 14 }} onSubmit={(e) => { e.preventDefault(); setQuery(q); }}>
        <input placeholder="بحث بالاسم أو رقم الموبايل" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, maxWidth: 360 }} />
        <button className="btn ghost">بحث</button>
      </form>
      {error ? <div className="err">{error}</div> : null}
      <div className="card">
        <table>
          <thead>
            <tr><th>النشاط</th><th>الموبايل</th><th>البلد</th><th>الباقة</th><th>الحالة</th><th>ينتهي</th><th>آخر ظهور</th><th>الإصدار</th></tr>
          </thead>
          <tbody>
            {data?.businesses.map((b: any) => (
              <tr key={b.id} className="click" onClick={() => open(b.id)}>
                <td>{b.name}</td>
                <td className="ltr">+{b.owner_phone}</td>
                <td>{b.country === 'EG' ? 'مصر' : 'السعودية'}</td>
                <td>{b.plan_code}</td>
                <td><span className={`pill ${b.status}`}>{STATUS_AR[b.status] ?? b.status}</span></td>
                <td>{fmtDate(b.plan_expires_at)}</td>
                <td>{fmtDate(b.last_seen_at)}</td>
                <td className="muted">{b.app_version ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && data.businesses.length === 0 ? <p className="muted">لا توجد نتائج.</p> : null}
      </div>
    </>
  );
}

function BusinessDetail({ id, back, notify }: { id: string; back: () => void; notify: (name: string) => void }) {
  const { data, error, reload } = useLoad(() => call(`/businesses/${id}`), [id]);
  const plans = useLoad(() => call('/plans'), []);
  const [days, setDays] = useState(7);
  const [msg, setMsg] = useState<string | null>(null);
  const [planCode, setPlanCode] = useState('basic');
  const [planDays, setPlanDays] = useState(30);
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    try {
      await fn();
      setMsg(ok);
      reload();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  if (error) return <div className="err">{error}</div>;
  if (!data) return <p className="muted">جاري التحميل…</p>;
  const b = data.business;
  return (
    <>
      <div className="row" style={{ marginBottom: 14 }}>
        <button className="btn ghost" onClick={back}>→ رجوع</button>
        <h2 style={{ margin: 0 }}>{b.name}</h2>
        <button onClick={() => notify(b.name)}>إرسال إشعار</button>
        <span className={`pill ${b.status}`}>{STATUS_AR[b.status] ?? b.status}</span>
      </div>
      <div className="grid two">
        <div className="card grid">
          <div className="muted">صاحب النشاط</div>
          <div className="ltr">+{b.owner_phone}</div>
          <div className="muted">الباقة / ينتهي</div>
          <div>{b.plan_code} — {fmtDate(b.plan_expires_at)}</div>
          <div className="muted">النوع / ضريبة</div>
          <div>{b.type === 'shop' ? 'محل' : 'شركة تجارية'} — {b.vat_registered ? 'مسجّل' : 'غير مسجّل'}</div>
          <div className="muted">تاريخ التسجيل</div>
          <div>{fmtDate(b.created_at)}</div>
        </div>
        <div className="card grid">
          <strong>إجراءات</strong>
          <div className="row">
            <input type="number" min={1} max={365} value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ width: 90 }} />
            <button className="btn" onClick={() => act(() => call(`/businesses/${id}/extend-trial`, { body: { days } }), 'تم مد التجربة')}>مد التجربة (يوم)</button>
          </div>
          <div className="row">
            <select value={planCode} onChange={(e) => setPlanCode(e.target.value)}>
              {plans.data?.plans.map((p: any) => <option key={p.code} value={p.code}>{p.name_ar}</option>)}
            </select>
            <input type="number" min={1} value={planDays} onChange={(e) => setPlanDays(Number(e.target.value))} style={{ width: 90 }} />
            <button
              className="btn ghost"
              onClick={() => act(() => call(`/businesses/${id}/plan`, { body: { planCode, status: 'active', expiresAt: Date.now() + planDays * DAY } }), 'تم تغيير الباقة')}
            >
              تفعيل الباقة (يوم)
            </button>
          </div>
          <div className="row">
            {b.status === 'suspended' ? (
              <button className="btn ghost" onClick={() => act(() => call(`/businesses/${id}/suspend`, { body: { suspended: false } }), 'تم إلغاء الإيقاف')}>إلغاء الإيقاف</button>
            ) : (
              <button className="btn danger" onClick={() => confirm('إيقاف هذا النشاط؟ التطبيق هيبقى للعرض بس بعد آخر تحديث.') && act(() => call(`/businesses/${id}/suspend`, { body: { suspended: true } }), 'تم الإيقاف')}>
                إيقاف
              </button>
            )}
          </div>
          {msg ? <div className="ok">{msg}</div> : null}
          <div className="muted">التغييرات بتوصل للموبايل في أول تحديث يومي (أو لما المستخدم يضغط "اتصل وحدّث").</div>
        </div>
        <div className="card">
          <strong>الأجهزة</strong>
          <table>
            <thead><tr><th>الكود</th><th>النظام</th><th>آخر تحديث</th><th>الحالة</th></tr></thead>
            <tbody>
              {data.devices.map((d: any) => (
                <tr key={d.id}>
                  <td>{d.code}</td>
                  <td>{d.platform} {d.model ?? ''}</td>
                  <td>{fmtDate(d.last_checkin_at)}</td>
                  <td>{d.deactivated_at ? <span className="pill suspended">موقوف</span> : <span className="pill active">نشط</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <strong>طلبات السيرفر يومياً (الهدف ≤ ٥)</strong>
          <table>
            <thead><tr><th>اليوم</th><th>عدد الطلبات</th></tr></thead>
            <tbody>
              {data.requests.map((r: any) => (
                <tr key={r.day}><td className="ltr">{r.day}</td><td className={r.count > 5 ? 'err' : ''}>{r.count}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function Plans() {
  const { data, error, reload } = useLoad(() => call('/plans'), []);
  const [edit, setEdit] = useState<any | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const save = async () => {
    setMsg(null);
    try {
      await call(`/plans/${edit.code}`, {
        method: 'PUT',
        body: {
          nameAr: edit.name_ar, nameEn: edit.name_en,
          monthlyEgp: Number(edit.monthly_egp), monthlySar: Number(edit.monthly_sar), yearlyEgp: Number(edit.yearly_egp), yearlySar: Number(edit.yearly_sar),
          limits: Object.fromEntries(Object.entries(edit.limits).map(([k, v]) => [k, Number(v)])),
          features: edit.features, trialDays: Number(edit.trial_days), active: !!edit.active,
        },
      });
      setEdit(null);
      reload();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  const FEATURES = ['no_ads', 'multi_unit', 'offers', 'expenses_shifts', 'expiry', 'adv_reports', 'custom_roles'];
  return (
    <>
      <h2>الباقات</h2>
      {error ? <div className="err">{error}</div> : null}
      <div className="card">
        <table>
          <thead><tr><th>الكود</th><th>الاسم</th><th>شهري (ج/ر)</th><th>سنوي (ج/ر)</th><th>الحدود</th><th>تجربة</th><th></th></tr></thead>
          <tbody>
            {data?.plans.map((p: any) => (
              <tr key={p.code}>
                <td className="ltr">{p.code}</td>
                <td>{p.name_ar}</td>
                <td>{fmtMoney(p.monthly_egp)} / {fmtMoney(p.monthly_sar)}</td>
                <td>{fmtMoney(p.yearly_egp)} / {fmtMoney(p.yearly_sar)}</td>
                <td className="muted">مستخدمين {p.limits.users} · منتجات {p.limits.products} · فواتير/شهر {p.limits.invoices_month}</td>
                <td>{p.trial_days} يوم</td>
                <td><button className="btn ghost" onClick={() => setEdit(JSON.parse(JSON.stringify(p)))}>تعديل</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted">الأسعار بالقرش/الهللة. ‎-1 = بدون حد.</p>
      </div>
      {edit ? (
        <div className="card grid" style={{ marginTop: 16 }}>
          <strong>تعديل {edit.code}</strong>
          <div className="row">
            <label>الاسم بالعربي<input value={edit.name_ar} onChange={(e) => setEdit({ ...edit, name_ar: e.target.value })} /></label>
            <label>الاسم بالإنجليزي<input value={edit.name_en} onChange={(e) => setEdit({ ...edit, name_en: e.target.value })} /></label>
            <label>أيام التجربة<input type="number" value={edit.trial_days} onChange={(e) => setEdit({ ...edit, trial_days: e.target.value })} /></label>
          </div>
          <div className="row">
            {['monthly_egp', 'monthly_sar', 'yearly_egp', 'yearly_sar'].map((k) => (
              <label key={k}>{k}<input type="number" value={edit[k]} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} /></label>
            ))}
          </div>
          <div className="row">
            {Object.keys(edit.limits).map((k) => (
              <label key={k}>{k}<input type="number" value={edit.limits[k]} onChange={(e) => setEdit({ ...edit, limits: { ...edit.limits, [k]: e.target.value } })} /></label>
            ))}
          </div>
          <div className="row">
            {FEATURES.map((f) => (
              <label key={f} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={edit.features.includes(f)} onChange={(e) => setEdit({ ...edit, features: e.target.checked ? [...edit.features, f] : edit.features.filter((x: string) => x !== f) })} />
                <span className="ltr">{f}</span>
              </label>
            ))}
          </div>
          <div className="row">
            <button className="btn" onClick={save}>حفظ</button>
            <button className="btn ghost" onClick={() => setEdit(null)}>إلغاء</button>
            {msg ? <span className="err">{msg}</span> : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

function Audit() {
  const { data, error } = useLoad(() => call('/audit'), []);
  return (
    <>
      <h2>سجل إجراءات الإدارة</h2>
      {error ? <div className="err">{error}</div> : null}
      <div className="card">
        <table>
          <thead><tr><th>الوقت</th><th>المسؤول</th><th>الإجراء</th><th>الهدف</th><th>التفاصيل</th></tr></thead>
          <tbody>
            {data?.entries.map((e: any) => (
              <tr key={e.id}>
                <td>{fmtDate(e.at)}</td>
                <td className="ltr">{e.email}</td>
                <td className="ltr">{e.action}</td>
                <td className="ltr muted">{e.target ?? ''}</td>
                <td className="ltr muted" style={{ maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.details_json}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Dashboard() {
  const { data, error } = useLoad(() => call('/metrics'), []);
  const tile = (label: string, value: string | number) => (
    <div className="card" style={{ flex: 1, minWidth: 160 }}>
      <div className="muted">{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700 }}>{value}</div>
    </div>
  );
  return (
    <>
      <h2>لوحة الأرقام</h2>
      {error ? <div className="err">{error}</div> : null}
      {data ? (
        <>
          <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
            {tile('كل الأنشطة', data.total)}
            {tile('نشطين آخر 30 يوم', data.active30)}
            {tile('فترة تجربة', data.trials)}
            {tile('مشتركين', data.paid)}
            {tile('MRR ج.م', fmtMoney(data.mrrMinor.EGP))}
            {tile('MRR ر.س', fmtMoney(data.mrrMinor.SAR))}
            {tile('Churn 30 يوم', `${(data.churn30 * 100).toFixed(1)}%`)}
            {tile('طلبات/نشاط/يوم (متوسط · أقصى)', `${Number(data.requestsPerBusinessDay.avg).toFixed(1)} · ${data.requestsPerBusinessDay.max}`)}
          </div>
          <div className="card">
            <strong>المشتركين حسب الباقة</strong>
            <div className="muted ltr">{Object.entries(data.byPlan).map(([k, v]) => `${k}: ${v}`).join(' · ') || '—'}</div>
          </div>
        </>
      ) : null}
    </>
  );
}

function Codes() {
  const { data, reload } = useLoad(() => call('/codes'), []);
  const [plan, setPlan] = useState('basic');
  const [days, setDays] = useState(365);
  const [count, setCount] = useState(10);
  const [note, setNote] = useState('');
  const [fresh, setFresh] = useState<string[]>([]);
  const gen = async () => {
    const r = await call('/codes', { body: { planCode: plan, days, count, note: note || undefined } });
    setFresh(r.codes);
    reload();
  };
  const csv = () => {
    const rows = [['code', 'plan', 'days', 'note', 'created', 'redeemed', 'business'], ...(data?.codes ?? []).map((k: any) => [k.code, k.plan_code, k.days, k.note ?? '', fmtDate(k.created_at), fmtDate(k.redeemed_at), k.business_name ?? ''])];
    const blob = new Blob(['\ufeff' + rows.map((r) => r.join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'activation-codes.csv';
    a.click();
  };
  return (
    <>
      <h2>أكواد التفعيل</h2>
      <div className="card row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <select value={plan} onChange={(e) => setPlan(e.target.value)}>
          <option value="basic">أساسي</option>
          <option value="pro">احترافي</option>
        </select>
        <label>أيام <input type="number" value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ width: 90 }} /></label>
        <label>العدد <input type="number" value={count} onChange={(e) => setCount(Number(e.target.value))} style={{ width: 80 }} /></label>
        <input placeholder="ملاحظة (اسم المندوب)" value={note} onChange={(e) => setNote(e.target.value)} />
        <button className="btn" onClick={() => void gen()}>توليد</button>
        <button onClick={csv}>تصدير CSV</button>
      </div>
      {fresh.length ? <div className="card ltr" style={{ fontFamily: 'monospace' }}>{fresh.join('  ')}</div> : null}
      <div className="card">
        <table>
          <thead><tr><th>الكود</th><th>الباقة</th><th>أيام</th><th>ملاحظة</th><th>الحالة</th><th /></tr></thead>
          <tbody>
            {data?.codes.map((k: any) => (
              <tr key={k.code}>
                <td className="ltr" style={{ fontFamily: 'monospace' }}>{k.code}</td>
                <td>{k.plan_code}</td>
                <td>{k.days}</td>
                <td className="muted">{k.note ?? ''}</td>
                <td>{k.revoked_at ? 'ملغي' : k.redeemed_at ? `مستخدم — ${k.business_name ?? ''}` : 'متاح'}</td>
                <td>{!k.redeemed_at && !k.revoked_at ? <button onClick={() => call(`/codes/${k.code}/revoke`, { body: {} }).then(reload)}>إلغاء</button> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

const SCREENS: [string, string][] = [
  ['', 'بدون (يفتح صندوق الرسائل)'],
  ['/settings/subscription', 'الاشتراك والباقات'],
  ['/settings/backup', 'النسخ الاحتياطي'],
  ['/settings/printers', 'الطابعات'],
  ['/reports', 'التقارير'],
  ['/offers', 'العروض'],
  ['/(main)/sell', 'شاشة البيع'],
  ['/(main)/products', 'الأصناف'],
  ['/(main)/parties', 'العملاء'],
  ['store', 'تحديث التطبيق (المتجر)'],
];
const STATUS: Record<string, string> = { trial: 'تجربة', active: 'مشترك', past_due: 'متأخر في الدفع', suspended: 'موقوف' };

/** Super-admin → users: push now (phones that allowed notifications) + inbox copy with each phone's daily check-in. */
function Notify({ businessId, businessName }: { businessId?: string; businessName?: string }) {
  const { data, reload } = useLoad(() => call('/announcements'), []);
  const [titleAr, setTitleAr] = useState('');
  const [bodyAr, setBodyAr] = useState('');
  const [titleEn, setTitleEn] = useState('');
  const [bodyEn, setBodyEn] = useState('');
  const [url, setUrl] = useState('');
  const [mode, setMode] = useState<'all' | 'filter' | 'one'>(businessId ? 'one' : 'all');
  const [countries, setCountries] = useState<string[]>([]);
  const [plans, setPlans] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [push, setPush] = useState(true);
  const [days, setDays] = useState(14);
  const [reach, setReach] = useState<{ businesses: number; devices: number; push: number } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const target = mode === 'all' ? { all: true } : mode === 'one' && businessId ? { businessIds: [businessId] } : { countries: countries.length ? countries : undefined, plans: plans.length ? plans : undefined, statuses: statuses.length ? statuses : undefined };
  const key = JSON.stringify(target);
  useEffect(() => {
    setReach(null);
    const h = setTimeout(() => void call('/announcements/preview', { body: target }).then(setReach, () => setReach(null)), 300);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const toggle = (list: string[], set: (v: string[]) => void, v: string) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const chip = (on: boolean, label: string, onClick: () => void) => (
    <button key={label} className={on ? 'btn' : ''} onClick={onClick} style={{ padding: '4px 10px' }}>{label}</button>
  );
  const send = async () => {
    if (!reach?.businesses) return;
    if (!confirm(`هيتبعت لـ ${reach.businesses} نشاط (${reach.devices} جهاز). متأكد؟`)) return;
    try {
      const r = await call('/announcements', { body: { titleAr, bodyAr, titleEn: titleEn || undefined, bodyEn: bodyEn || undefined, url: url || undefined, target, push, days } });
      setMsg(`اتبعت ✓ — ${r.businesses} نشاط، ${r.pushSent} إشعار فوري${r.pushFailed ? `، ${r.pushFailed} فشل` : ''}. الباقي هيوصله مع التحديث اليومي.`);
      setTitleAr(''); setBodyAr(''); setTitleEn(''); setBodyEn('');
      reload();
    } catch (e) {
      setMsg(`خطأ: ${(e as Error).message}`);
    }
  };
  const targetLabel = (j: string) => {
    const t = JSON.parse(j);
    if (t.all) return 'الكل';
    if (t.businessIds) return `${t.businessIds.length} نشاط محدد`;
    return [t.countries?.map((c: string) => (c === 'EG' ? 'مصر' : 'السعودية')).join('، '), t.plans?.join('، '), t.statuses?.map((s: string) => STATUS[s]).join('، ')].filter(Boolean).join(' · ');
  };
  return (
    <>
      <h2>إرسال إشعار للمستخدمين</h2>
      <div className="card" style={{ display: 'grid', gap: 10 }}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <strong>لمين؟</strong>
          {chip(mode === 'all', 'كل المستخدمين', () => setMode('all'))}
          {chip(mode === 'filter', 'فئة معينة', () => setMode('filter'))}
          {businessId ? chip(mode === 'one', `نشاط: ${businessName ?? businessId}`, () => setMode('one')) : null}
        </div>
        {mode === 'filter' ? (
          <div style={{ display: 'grid', gap: 6 }}>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <span className="muted">البلد:</span>
              {chip(countries.includes('EG'), 'مصر', () => toggle(countries, setCountries, 'EG'))}
              {chip(countries.includes('SA'), 'السعودية', () => toggle(countries, setCountries, 'SA'))}
            </div>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <span className="muted">الباقة:</span>
              {[['free', 'مجانية'], ['basic', 'أساسي'], ['pro', 'احترافي']].map(([v, l]) => chip(plans.includes(v!), l!, () => toggle(plans, setPlans, v!)))}
            </div>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <span className="muted">الحالة:</span>
              {Object.entries(STATUS).map(([v, l]) => chip(statuses.includes(v), l, () => toggle(statuses, setStatuses, v)))}
            </div>
          </div>
        ) : null}
        <input placeholder="العنوان (عربي) — مثال: خصم 20% على الباقة السنوية" maxLength={80} value={titleAr} onChange={(e) => setTitleAr(e.target.value)} />
        <textarea placeholder="نص الرسالة (عربي)" maxLength={500} rows={3} value={bodyAr} onChange={(e) => setBodyAr(e.target.value)} />
        <details>
          <summary className="muted">نسخة إنجليزي (اختياري — للي مختار اللغة الإنجليزية)</summary>
          <div style={{ display: 'grid', gap: 6, marginTop: 6 }} className="ltr">
            <input placeholder="Title (English)" maxLength={80} value={titleEn} onChange={(e) => setTitleEn(e.target.value)} />
            <textarea placeholder="Message (English)" maxLength={500} rows={2} value={bodyEn} onChange={(e) => setBodyEn(e.target.value)} />
          </div>
        </details>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <label>يفتح شاشة <select value={url} onChange={(e) => setUrl(e.target.value)}>{SCREENS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <label>يفضل ظاهر <input type="number" min={1} max={60} value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ width: 60 }} /> يوم</label>
          <label><input type="checkbox" checked={push} onChange={(e) => setPush(e.target.checked)} /> إشعار فوري على الموبايل</label>
        </div>
        <div className="row" style={{ gap: 10, alignItems: 'center' }}>
          <span className="muted" style={{ flex: 1 }}>
            {reach ? `هيوصل لـ ${reach.businesses} نشاط · ${reach.devices} جهاز · ${reach.push} منهم يستقبلوا إشعار فوري` : '…'}
          </span>
          <button className="btn" disabled={titleAr.trim().length < 2 || bodyAr.trim().length < 2 || !reach?.businesses} onClick={() => void send()}>إرسال</button>
        </div>
        {msg ? <div className="muted">{msg}</div> : null}
      </div>
      <div className="card">
        <table>
          <thead><tr><th>التاريخ</th><th>الرسالة</th><th>لمين</th><th>فوري</th><th>وصل في التطبيق</th><th /></tr></thead>
          <tbody>
            {data?.announcements.map((a: any) => (
              <tr key={a.id} style={a.cancelled_at ? { opacity: 0.5 } : undefined}>
                <td>{fmtDate(a.created_at)}</td>
                <td><strong>{a.title_ar}</strong><div className="muted">{a.body_ar}</div></td>
                <td>{targetLabel(a.target_json)}</td>
                <td>{a.push_sent}{a.push_failed ? ` (${a.push_failed} فشل)` : ''}</td>
                <td>{a.delivered}</td>
                <td>{a.cancelled_at ? 'مسحوب' : a.expires_at > Date.now() ? <button onClick={() => confirm('سحب الرسالة؟ اللي لسه ماوصلهاش مش هتوصله.') && call(`/announcements/${a.id}/cancel`, { body: {} }).then(reload)}>سحب</button> : 'انتهت'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Settings() {
  const { data, reload } = useLoad(() => call('/settings'), []);
  const ads = data?.ads_enabled !== 'false';
  return (
    <>
      <h2>إعدادات عامة</h2>
      <div className="card row">
        <div style={{ flex: 1 }}>
          <strong>الإعلانات في الباقة المجانية</strong>
          <div className="muted">إيقافها هنا بيخفي الإعلانات من كل الأجهزة في أول تحديث يومي.</div>
        </div>
        <button className={ads ? 'btn danger' : 'btn'} onClick={() => call('/settings/ads', { method: 'PUT', body: { enabled: !ads } }).then(reload)}>
          {ads ? 'إيقاف الإعلانات' : 'تشغيل الإعلانات'}
        </button>
      </div>
    </>
  );
}

export function App() {
  const [authed, setAuthed] = useState(!!session.get());
  const [view, setView] = useState<View>({ name: 'dashboard' });
  if (!authed) return <Login onDone={() => setAuthed(true)} />;
  const nav = (v: View, label: string) => (
    <button className={view.name === v.name ? 'on' : ''} onClick={() => setView(v)}>
      {label}
    </button>
  );
  return (
    <div className="shell">
      <aside className="side">
        <h1>دفترك</h1>
        {nav({ name: 'dashboard' }, 'لوحة الأرقام')}
        {nav({ name: 'businesses' }, 'الأنشطة')}
        {nav({ name: 'codes' }, 'أكواد التفعيل')}
        {nav({ name: 'notify' }, 'الإشعارات')}
        {nav({ name: 'plans' }, 'الباقات')}
        {nav({ name: 'settings' }, 'إعدادات')}
        {nav({ name: 'audit' }, 'سجل الإدارة')}
        <div className="spacer" />
        <button onClick={() => call('/logout', { body: {} }).finally(() => { session.clear(); setAuthed(false); })}>خروج</button>
      </aside>
      <main>
        {view.name === 'dashboard' && <Dashboard />}
        {view.name === 'codes' && <Codes />}
        {view.name === 'notify' && <Notify key={view.businessId ?? 'all'} businessId={view.businessId} businessName={view.businessName} />}
        {view.name === 'businesses' && <Businesses open={(id) => setView({ name: 'business', id })} />}
        {view.name === 'business' && <BusinessDetail id={view.id} back={() => setView({ name: 'businesses' })} notify={(name) => setView({ name: 'notify', businessId: view.id, businessName: name })} />}
        {view.name === 'plans' && <Plans />}
        {view.name === 'audit' && <Audit />}
        {view.name === 'settings' && <Settings />}
      </main>
    </div>
  );
}
