/**
 * Public pages served by the Worker (Google OAuth consent screen, Google Play listing):
 *   /            home        /privacy     privacy policy
 *   /terms       terms of use  /delete-account  how to delete the account and data
 * Arabic first (RTL), English below. Plain HTML, no scripts, no cookies, no tracking.
 */
import { Hono } from 'hono';
import type { AppEnv } from '../env';

export const SUPPORT_EMAIL = 'tiqniaofficial@gmail.com';
const UPDATED = '2026-11-24';

const css = `
:root{--ink:#101828;--soft:#475467;--line:#EAECF0;--bg:#F8F9FC;--card:#fff;--brand:#0F4CC7}
@media (prefers-color-scheme:dark){:root{--ink:#F2F4F7;--soft:#C5CCD6;--line:#2A3342;--bg:#0B1220;--card:#111A2B;--brand:#6FA0FF}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.75 "IBM Plex Sans Arabic","Segoe UI",Tahoma,Arial,sans-serif}
main{max-width:820px;margin:0 auto;padding:24px 16px 64px}
header{display:flex;align-items:center;gap:12px;margin:8px 0 20px}
header img{width:48px;height:48px;border-radius:12px}
header b{font-size:22px}nav{display:flex;flex-wrap:wrap;gap:14px;margin:0 0 20px}
nav a,a{color:var(--brand)}section{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:20px 22px;margin:16px 0}
h1{font-size:26px;line-height:1.5;margin:0 0 6px}h2{font-size:19px;margin:22px 0 6px}p,li{color:var(--soft)}
.en{direction:ltr;text-align:left;font-family:Inter,"Segoe UI",Arial,sans-serif}.muted{font-size:14px;color:var(--soft)}
`;

const logo = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0866FF"/><stop offset="1" stop-color="#0B2E80"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#g)"/><path d="M19 13h22a3 3 0 0 1 3 3v30l-4-3-4 3-4-3-4 3-4-3-4 3-4-3V16a3 3 0 0 1 3-3z" fill="#fff"/><rect x="23" y="20" width="18" height="3" rx="1.5" fill="#0F4CC7"/><rect x="23" y="27" width="14" height="2.5" rx="1.25" fill="#B9C8F5"/><circle cx="45" cy="44" r="10" fill="#fff" stroke="#0F4CC7" stroke-width="3"/><path d="m40.5 44 3 3 6-6" fill="none" stroke="#0866FF" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
)}`;

function page(title: string, ar: string, en: string): string {
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><meta name="description" content="كاشيرو — كاشير وفواتير ومخازن من موبايلك، حتى من غير نت."><style>${css}</style></head><body><main>
<header><img src="${logo}" alt="Kashiro"><b>كاشيرو · Kashiro</b></header>
<nav><a href="/">الرئيسية</a><a href="/privacy">سياسة الخصوصية</a><a href="/terms">شروط الاستخدام</a><a href="/delete-account">حذف الحساب</a></nav>
<section>${ar}</section><section class="en" dir="ltr" lang="en">${en}</section>
<p class="muted">© TIQNIA · تقنية — ${SUPPORT_EMAIL}</p></main></body></html>`;
}

const HOME_AR = `<h1>كاشيرو — كاشير وفواتير ومخازن من موبايلك</h1>
<p>تطبيق نقاط بيع للمحلات في مصر: بيع وطباعة فواتير، مخزون، عملاء وموردين، مصروفات وورديات وتقارير — وكله شغال على الموبايل حتى من غير إنترنت.</p>
<p>بيانات المحل محفوظة ومشفّرة على موبايلك. تقدر تعمل نسخ احتياطية على Google Drive بتاعك أو في فولدر على موبايلك أو على سيرفرنا.</p>
<p>للتواصل: <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a></p>`;
const HOME_EN = `<h1>Kashiro — POS, invoices and stock on your phone</h1>
<p>A point-of-sale app for shops in Egypt: selling and receipts, stock, customers and suppliers, expenses, shifts and reports — all working on the phone, even offline.</p>
<p>Shop data is stored encrypted on your phone. Backups can go to your own Google Drive, a folder on your phone, or our server.</p>
<p>Contact: <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a></p>`;

const PRIVACY_AR = `<h1>سياسة الخصوصية</h1><p class="muted">آخر تحديث: ${UPDATED}</p>
<p>كاشيرو تطبيق من «تقنية» (TIQNIA). السياسة دي بتشرح إيه البيانات اللي بنتعامل معاها وليه. باختصار: بيانات محلك (المبيعات، المنتجات، العملاء…) بتتخزّن على موبايلك أنت، مشفّرة، ومش بنبيعها ولا بنشاركها مع حد لأغراض إعلانية.</p>
<h2>1. البيانات اللي على موبايلك</h2>
<p>الفواتير والمنتجات والمخزون والعملاء والموردين والمصروفات والمستخدمين محفوظة في قاعدة بيانات مشفّرة على الموبايل. التطبيق بيشتغل من غير إنترنت، والبيانات دي مش بتتبعت لسيرفرنا إلا في الحالات اللي تحت.</p>
<h2>2. البيانات اللي بتوصل لسيرفرنا</h2>
<ul>
<li><b>رقم الموبايل</b> لإنشاء الحساب وتسجيل الدخول (بكود SMS أو كلمة سر)، و<b>اسم المحل</b> ونوعه.</li>
<li><b>بيانات الجهاز</b>: موديل الموبايل، إصدار التطبيق، معرّف التثبيت، وفحص سلامة الجهاز من جوجل/أبل — عشان الترخيص والحماية من الاحتيال.</li>
<li><b>الاشتراك والدفع</b>: الباقة وتواريخها؛ ولو دفعت بإنستاباي/فودافون كاش، صورة الإيصال ورقم المحوّل منه لمراجعة الدفع.</li>
<li><b>النسخ الاحتياطي على السيرفر</b> (لو استخدمته): ملف مشفّر لبيانات المحل. مفتاح التشفير محفوظ عندنا بشكل محمي عشان تقدر ترجّع بياناتك على موبايل جديد بعد تأكيد رقمك بكود SMS.</li>
<li><b>موبايلات الكاشير</b> (لو استخدمتها): المبيعات والكتالوج بيعدّوا على السيرفر <b>مشفّرين بمفتاح المحل</b> اللي موجود في كود الـ QR بس — سيرفرنا ما يقدرش يقراهم.</li>
<li><b>ملخص المحل</b> لموبايل المتابعة (لو فعّلته): أرقام مجمّعة زي مبيعات اليوم وآخر الفواتير.</li>
<li><b>تقارير الأعطال</b>: رسالة الخطأ وإصدار التطبيق، عشان نصلّح المشاكل.</li>
<li><b>عدّادات استخدام</b> لكل محل (عدد الطلبات، الرسائل، المسح) لتطبيق حدود الباقة.</li>
</ul>
<h2>3. خدمات أطراف تانية</h2>
<ul>
<li><b>Cloudflare</b>: استضافة السيرفر وقاعدة البيانات والتخزين.</li>
<li><b>SMS Misr</b>: إرسال أكواد التحقق لرقمك.</li>
<li><b>Anthropic (Claude)</b>: لما تصوّر فاتورة مورّد أو قائمة أصناف، الصورة بتتبعت عشان تتقري وتتحوّل لأصناف وأسعار. ما بنستخدمهاش لأي غرض تاني.</li>
<li><b>Google AdMob</b>: إعلانات في الباقة المجانية بس. AdMob ممكن يستخدم معرّف الإعلانات الخاص بالجهاز حسب سياسة جوجل. الباقات المدفوعة من غير إعلانات.</li>
<li><b>Google Drive</b> (لو ربطته): التطبيق بيستخدم صلاحية <code>drive.file</code> — بيشوف بس الملفات اللي هو عملها (فولدر «Kashiro Backups»)، ومش بيوصل لباقي ملفاتك. الملفات محمية بكلمة سر أنت اللي بتختارها، وما بتعدّيش على سيرفرنا. استخدام كاشيرو للبيانات اللي بتيجي من Google APIs ملتزم بـ <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a> بما فيها شروط Limited Use.</li>
<li><b>Google Play / App Store</b> لو اشتركت من المتجر.</li>
</ul>
<h2>4. الصلاحيات على الموبايل</h2>
<p>الكاميرا (مسح الباركود وتصوير الفواتير)، البلوتوث (الطابعة الحرارية)، الإشعارات، والبصمة (فتح التطبيق). كلها اختيارية وبتتطلب وقت الاستخدام.</p>
<h2>5. المدة والحذف</h2>
<p>بنحتفظ ببيانات الحساب طول ما الحساب شغال. النسخ الاحتياطية على السيرفر بيتمسح القديم منها تلقائيًا حسب الباقة. تقدر تطلب حذف حسابك وكل بياناتك من سيرفرنا في أي وقت — شوف <a href="/delete-account">حذف الحساب</a>. البيانات اللي على موبايلك بتتمسح لما تمسح التطبيق.</p>
<h2>6. الأمان</h2>
<p>الاتصال مشفّر (HTTPS)، قاعدة البيانات على الموبايل مشفّرة، النسخ الاحتياطية مشفّرة، والدخول على الإعدادات الحساسة محمي بكلمة سر المالك.</p>
<h2>7. الأطفال</h2><p>التطبيق موجّه لأصحاب المحلات والعاملين فيها، ومش موجّه للأطفال.</p>
<h2>8. التواصل</h2><p>أي سؤال أو طلب: <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>. لو غيّرنا السياسة دي هنحدّث التاريخ اللي فوق ونبلغك جوه التطبيق.</p>`;

const PRIVACY_EN = `<h1>Privacy Policy</h1><p class="muted">Last updated: ${UPDATED}</p>
<p>Kashiro is an app by TIQNIA. This policy explains what data we handle and why. In short: your shop data (sales, products, customers…) is stored on your own phone, encrypted; we do not sell it or share it for advertising.</p>
<h2>1. Data on your phone</h2><p>Invoices, products, stock, customers, suppliers, expenses and users are kept in an encrypted database on the phone. The app works offline; this data reaches our server only in the cases below.</p>
<h2>2. Data that reaches our server</h2><ul>
<li><b>Phone number</b> to create the account and sign in (SMS code or password), and the <b>shop name</b> and type.</li>
<li><b>Device data</b>: model, app version, install ID and Google/Apple device-integrity checks — for licensing and fraud protection.</li>
<li><b>Subscription and payment</b>: plan and dates; for InstaPay / Vodafone Cash payments, the receipt photo and sender number to review the payment.</li>
<li><b>Server backups</b> (if used): an encrypted file of the shop data. The encryption key is stored protected on our side so you can restore on a new phone after confirming your number by SMS.</li>
<li><b>Cashier phones</b> (if used): sales and the catalog pass through our server <b>encrypted with the shop key</b> that exists only in the QR code — our server cannot read them.</li>
<li><b>Shop summary</b> for a follow-up phone (if enabled): aggregated figures such as today's sales and recent invoices.</li>
<li><b>Crash reports</b>: the error message and app version, to fix problems.</li>
<li><b>Usage counters</b> per shop (requests, SMS, scans) to apply plan limits.</li></ul>
<h2>3. Third-party services</h2><ul>
<li><b>Cloudflare</b>: server hosting, database and storage.</li>
<li><b>SMS Misr</b>: sending verification codes to your number.</li>
<li><b>Anthropic (Claude)</b>: when you photograph a supplier invoice or a product list, the image is sent to be read and turned into items and prices. It is not used for anything else.</li>
<li><b>Google AdMob</b>: ads on the free plan only; AdMob may use the device advertising ID under Google's policies. Paid plans have no ads.</li>
<li><b>Google Drive</b> (if linked): the app uses the <code>drive.file</code> scope — it sees only the files it created (the “Kashiro Backups” folder), never the rest of your Drive. Files are protected by a password you choose and never pass through our server. Kashiro's use and transfer of information received from Google APIs adheres to the <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>, including the Limited Use requirements.</li>
<li><b>Google Play / App Store</b> if you subscribe through the store.</li></ul>
<h2>4. Phone permissions</h2><p>Camera (barcode scanning, invoice photos), Bluetooth (thermal printer), notifications and biometrics (unlocking the app). All optional and requested when used.</p>
<h2>5. Retention and deletion</h2><p>Account data is kept while the account is active. Old server backups are deleted automatically according to the plan. You can ask us to delete your account and all your data from our server at any time — see <a href="/delete-account">Delete account</a>. Data on your phone is removed when you uninstall the app.</p>
<h2>6. Security</h2><p>Connections use HTTPS, the on-phone database is encrypted, backups are encrypted, and sensitive settings are protected by the owner's password.</p>
<h2>7. Children</h2><p>The app is meant for shop owners and staff, not for children.</p>
<h2>8. Contact</h2><p>Questions or requests: <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>. If this policy changes we will update the date above and tell you in the app.</p>`;

const TERMS_AR = `<h1>شروط الاستخدام</h1><p class="muted">آخر تحديث: ${UPDATED}</p>
<ul><li>كاشيرو أداة لإدارة المحل؛ أنت مسؤول عن صحة البيانات اللي بتدخلها وعن الالتزام بالقوانين والضرائب الخاصة بنشاطك.</li>
<li>الحساب مرتبط برقم موبايلك؛ حافظ على كلمة السر والرقم السري للمستخدمين.</li>
<li>الباقات المدفوعة بتتجدد حسب طريقة الدفع اللي اخترتها؛ الدفع اليدوي بيتفعّل بعد مراجعة الإيصال.</li>
<li>بنعمل كل اللي نقدر عليه عشان التطبيق يشتغل من غير مشاكل، وننصح بعمل نسخة احتياطية بانتظام؛ مش مسؤولين عن فقد بيانات بسبب ضياع الموبايل من غير نسخة احتياطية.</li>
<li>ممنوع استخدام التطبيق في أي نشاط مخالف للقانون، أو محاولة اختراقه أو التحايل على الترخيص.</li>
<li>ممكن نحدّث الشروط دي ونبلغك جوه التطبيق.</li></ul>
<p>للتواصل: <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a></p>`;
const TERMS_EN = `<h1>Terms of Use</h1><p class="muted">Last updated: ${UPDATED}</p>
<ul><li>Kashiro is a shop-management tool; you are responsible for the data you enter and for complying with the laws and taxes of your business.</li>
<li>The account is tied to your phone number; keep your password and staff PINs safe.</li>
<li>Paid plans renew according to the payment method you chose; manual payments are activated after the receipt is reviewed.</li>
<li>We do our best to keep the app working well and recommend regular backups; we are not liable for data lost with a phone that had no backup.</li>
<li>Do not use the app for unlawful activity, or try to break it or bypass licensing.</li>
<li>We may update these terms and will tell you in the app.</li></ul>
<p>Contact: <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a></p>`;

const DELETE_AR = `<h1>حذف الحساب والبيانات</h1>
<p>تقدر تطلب حذف حسابك في كاشيرو وكل بياناته من سيرفرنا في أي وقت:</p>
<ol><li>ابعت رسالة على <a href="mailto:${SUPPORT_EMAIL}?subject=Kashiro%20account%20deletion">${SUPPORT_EMAIL}</a> بعنوان «حذف حساب كاشيرو» ومعاها رقم الموبايل المسجل واسم المحل.</li>
<li>هنتأكد إن الطلب من صاحب الرقم (هنبعتلك كود أو نتصل بيك).</li>
<li>هنحذف خلال 30 يوم: الحساب، المحلات، الأجهزة، النسخ الاحتياطية على السيرفر، طلبات الدفع وصور الإيصالات، والبيانات المشفّرة لموبايلات الكاشير.</li></ol>
<p><b>اللي ممكن يفضل:</b> سجلات الدفع اللي القانون بيطلب الاحتفاظ بيها (لو فيه) لمدة القانون بس. البيانات اللي على موبايلك ونسخ Google Drive أو الفولدر بتاعك تحت إيدك أنت — امسح التطبيق أو الملفات بنفسك.</p>`;
const DELETE_EN = `<h1>Delete your account and data</h1>
<p>You can ask us to delete your Kashiro account and all its data from our server at any time:</p>
<ol><li>Email <a href="mailto:${SUPPORT_EMAIL}?subject=Kashiro%20account%20deletion">${SUPPORT_EMAIL}</a> with the subject “Kashiro account deletion”, your registered phone number and shop name.</li>
<li>We confirm the request comes from the number's owner (a code or a call).</li>
<li>Within 30 days we delete: the account, shops, devices, server backups, payment requests and receipt photos, and the encrypted cashier-phone data.</li></ol>
<p><b>What may remain:</b> payment records we must keep by law (if any), only for the legal period. Data on your phone and your Google Drive / folder backups are under your control — uninstall the app or delete the files yourself.</p>`;

export function publicPages() {
  const app = new Hono<AppEnv>();
  const pages: [string, string][] = [
    ['/', page('Kashiro · كاشيرو', HOME_AR, HOME_EN)],
    ['/privacy', page('سياسة الخصوصية · Kashiro Privacy Policy', PRIVACY_AR, PRIVACY_EN)],
    ['/terms', page('شروط الاستخدام · Kashiro Terms', TERMS_AR, TERMS_EN)],
    ['/delete-account', page('حذف الحساب · Delete Kashiro account', DELETE_AR, DELETE_EN)],
  ];
  for (const [path, body] of pages) app.get(path, (c) => c.html(body, 200, { 'Cache-Control': 'public, max-age=3600' }));
  return app;
}
