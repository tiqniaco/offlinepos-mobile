import { useCallback, useEffect, useState } from 'react';
import { call, fmtDate, fmtMoney, session, AdminApiError } from './api';

type View = { name: 'businesses' } | { name: 'business'; id: string } | { name: 'plans' } | { name: 'audit' } | { name: 'settings' };

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

function BusinessDetail({ id, back }: { id: string; back: () => void }) {
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
  const [view, setView] = useState<View>({ name: 'businesses' });
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
        {nav({ name: 'businesses' }, 'الأنشطة')}
        {nav({ name: 'plans' }, 'الباقات')}
        {nav({ name: 'settings' }, 'إعدادات')}
        {nav({ name: 'audit' }, 'سجل الإدارة')}
        <div className="spacer" />
        <button onClick={() => call('/logout', { body: {} }).finally(() => { session.clear(); setAuthed(false); })}>خروج</button>
      </aside>
      <main>
        {view.name === 'businesses' && <Businesses open={(id) => setView({ name: 'business', id })} />}
        {view.name === 'business' && <BusinessDetail id={view.id} back={() => setView({ name: 'businesses' })} />}
        {view.name === 'plans' && <Plans />}
        {view.name === 'audit' && <Audit />}
        {view.name === 'settings' && <Settings />}
      </main>
    </div>
  );
}
