# OTP

Rules (`packages/shared/src/api.ts → OTP_POLICY`, enforced in `apps/api/src/otp/service.ts`, tested):
6 digits (uniform random), valid 5 minutes, max 5 wrong attempts per code, 60 s between requests,
max 5 codes per phone per hour and 10 per day, max 20 per IP per hour, only Egyptian (+20) and Saudi
(+966) mobiles. Codes are stored only as `HMAC-SHA256(OTP_PEPPER, phone|purpose|code)`.
Requesting a new code invalidates older unused ones.

## Providers
Interface `OtpProvider.send(phone, code, locale)` in `apps/api/src/otp/providers.ts`.
- `console` (dev/tests) — prints the code in the Worker log.
- `smsmisr` (v1, all numbers — owner decision D-07): `POST https://smsmisr.com/api/OTP/` with
  `environment` (2 = test, 1 = live), `username`, `password`, `sender`, `mobile`, `template`, `otp`;
  success code `4901`.
  **Before going live:** confirm the parameter names, your approved template id and the success code in
  your SMS Misr dashboard docs, and test delivery to a Saudi (+966) number. If KSA delivery is poor,
  add a Twilio / WhatsApp Cloud API provider here and route `+966` to it — no other code changes.
