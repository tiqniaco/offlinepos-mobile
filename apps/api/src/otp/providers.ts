/**
 * OTP delivery providers behind one interface (SPEC §2). v1 uses SMS Misr for every number (D-07);
 * Twilio / WhatsApp Cloud API implementations plug in here later without touching the OTP service.
 */
import type { Env } from '../env';

export interface SendResult {
  ok: boolean;
  providerRef?: string;
  error?: string;
  /** Provider reply text (no credentials) for diagnostics. */
  detail?: string;
}

export interface OtpProvider {
  readonly name: string;
  send(phoneE164: string, code: string, locale: 'ar' | 'en'): Promise<SendResult>;
}

/** Development / test provider: records codes in memory, never sends anything. */
export class ConsoleProvider implements OtpProvider {
  readonly name = 'console';
  static readonly sent: { phone: string; code: string; at: number }[] = [];
  async send(phone: string, code: string): Promise<SendResult> {
    ConsoleProvider.sent.push({ phone, code, at: Date.now() });
    console.log(`[otp:console] ${phone} → ${code}`);
    return { ok: true, providerRef: 'console' };
  }
  static lastCodeFor(phone: string): string | undefined {
    return [...ConsoleProvider.sent].reverse().find((s) => s.phone === phone)?.code;
  }
}

/**
 * SMS Misr OTP API: POST {base}?environment=&username=&password=&sender=&mobile=&template=&otp=
 * Success is response code "4901". Uses an approved OTP template (the template contains the code
 * placeholder), so we never send free text. Environment "2" = test, "1" = live.
 * NOTE: verify parameter names and response codes against the docs in your SMS Misr dashboard
 * before going live — see docs/otp.md.
 */
export class SmsMisrProvider implements OtpProvider {
  readonly name = 'smsmisr';
  constructor(
    private readonly cfg: { baseUrl: string; environment: string; username: string; password: string; sender: string; template: string },
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async send(phone: string, code: string): Promise<SendResult> {
    const url = new URL(this.cfg.baseUrl);
    url.searchParams.set('environment', this.cfg.environment);
    url.searchParams.set('username', this.cfg.username);
    url.searchParams.set('password', this.cfg.password);
    url.searchParams.set('sender', this.cfg.sender);
    url.searchParams.set('mobile', phone);
    url.searchParams.set('template', this.cfg.template);
    url.searchParams.set('otp', code);
    try {
      const res = await this.fetchFn(url.toString(), { method: 'POST' });
      const text = await res.text();
      let codeField: string | undefined;
      try {
        codeField = String((JSON.parse(text) as { code?: unknown }).code ?? '');
      } catch {
        codeField = text.trim();
      }
      if (res.ok && codeField === '4901') return { ok: true, providerRef: codeField };
      return { ok: false, error: `smsmisr:${res.status}:${codeField}` };
    } catch (e) {
      return { ok: false, error: `smsmisr:network:${(e as Error).message}` };
    }
  }
}

/**
 * SMS Misr normal SMS API (no approved OTP template needed): POST https://smsmisr.com/api/SMS/
 * form fields environment, username, password, sender (Sender Token), mobile (2010…), language, message.
 * Success is code "1901". language: 2 = Arabic (unicode). The message never contains anything but the code.
 */
export class SmsMisrSmsProvider implements OtpProvider {
  readonly name = 'smsmisr-sms';
  constructor(
    private readonly cfg: { baseUrl: string; environment: string; username: string; password: string; sender: string },
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  static text(code: string, locale: 'ar' | 'en') {
    return locale === 'en' ? `Your Kashiro code: ${code}\nDo not share it with anyone.` : `كود الدخول لكاشيرو: ${code}\nما تديهوش لأي حد.`;
  }

  async send(phone: string, code: string, locale: 'ar' | 'en'): Promise<SendResult> {
    const form = new URLSearchParams({
      environment: this.cfg.environment,
      username: this.cfg.username,
      password: this.cfg.password,
      sender: this.cfg.sender,
      mobile: phone,
      language: locale === 'en' ? '1' : '2',
      message: SmsMisrSmsProvider.text(code, locale),
    });
    try {
      const res = await this.fetchFn(this.cfg.baseUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() });
      const text = await res.text();
      let codeField: string;
      try {
        codeField = String((JSON.parse(text) as { code?: unknown }).code ?? '');
      } catch {
        codeField = text.trim().slice(0, 40);
      }
      if (res.ok && codeField === '1901') return { ok: true, providerRef: codeField };
      return { ok: false, error: `smsmisr-sms:${res.status}:${codeField}`, detail: text.slice(0, 200) };
    } catch (e) {
      return { ok: false, error: `smsmisr-sms:network:${(e as Error).message}` };
    }
  }
}

export function providerFor(env: Env): OtpProvider {
  if (env.OTP_PROVIDER === 'smsmisr') {
    const { SMSMISR_USERNAME, SMSMISR_PASSWORD, SMSMISR_SENDER, SMSMISR_TEMPLATE } = env;
    if (!SMSMISR_USERNAME || !SMSMISR_PASSWORD || !SMSMISR_SENDER) {
      throw new Error('SMS Misr secrets are not configured');
    }
    // No approved OTP template → the normal SMS API with our own short text.
    if (!SMSMISR_TEMPLATE) {
      return new SmsMisrSmsProvider({
        baseUrl: env.SMSMISR_SMS_URL || 'https://smsmisr.com/api/SMS/',
        environment: env.SMSMISR_ENVIRONMENT,
        username: SMSMISR_USERNAME,
        password: SMSMISR_PASSWORD,
        sender: SMSMISR_SENDER,
      });
    }
    return new SmsMisrProvider({
      baseUrl: env.SMSMISR_BASE_URL,
      environment: env.SMSMISR_ENVIRONMENT,
      username: SMSMISR_USERNAME,
      password: SMSMISR_PASSWORD,
      sender: SMSMISR_SENDER,
      template: SMSMISR_TEMPLATE,
    });
  }
  return new ConsoleProvider();
}
