# OTP

Rules (`packages/shared/src/api.ts → OTP_POLICY`, enforced in `apps/api/src/otp/service.ts`, tested):
6 digits (uniform random), valid 5 minutes, max 5 wrong attempts per code, 60 s between requests,
max 5 codes per phone per hour and 10 per day, max 20 per IP per hour, only Egyptian (+20) and Saudi
(+966) mobiles. Codes are stored only as `HMAC-SHA256(OTP_PEPPER, phone|purpose|code)`.
Requesting a new code invalidates older unused ones.
Verify limits only count calls made while the phone HAS a live code (junk guesses for a phone without one never lock
its owner out): 10 per (phone, IP) per hour, 30 per phone per hour from all networks, 60 per IP per hour. A phone whose
codes were burned (5 wrong tries each) 4 times in a day gets no more checks until the next day.

## Providers
Interface `OtpProvider.send(phone, code, locale)` in `apps/api/src/otp/providers.ts`.
- `console` (dev/tests) — prints the code in the Worker log.
- `smsmisr` (v1, all numbers — owner decision D-07): `POST https://smsmisr.com/api/OTP/` with
  `environment` (2 = test, 1 = live), `username`, `password`, `sender`, `mobile`, `template`, `otp`;
  success code `4901`.
  **Before going live:** confirm the parameter names, your approved template id and the success code in
  your SMS Misr dashboard docs, and test delivery to a Saudi (+966) number. If KSA delivery is poor,
  add a Twilio / WhatsApp Cloud API provider here and route `+966` to it — no other code changes.

## SMS Misr without an OTP template (2026-11)
If `SMSMISR_TEMPLATE` is empty, the server uses the normal SMS API (`POST https://smsmisr.com/api/SMS/`, form fields
`environment, username, password, sender, mobile, language, message`; success code `1901`). The text is only the code:
«كود الدخول لكاشيرو: 123456 — ما تديهوش لأي حد» (language 2 = Arabic) or the English line for English users.
Secrets: `SMSMISR_USERNAME`, `SMSMISR_PASSWORD`, `SMSMISR_SENDER` (Sender Token). Delete `OTP_TEST_CODE` to go live.
