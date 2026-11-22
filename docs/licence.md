# Licence flow

## Token
`lic1.<base64url(JSON payload)>.<base64url(Ed25519 signature of "lic1.<payload>")>`
Payload (schema in `packages/shared/src/licence.ts`): `kid, tid (business), did (device), plan, status,
limits, features, fallback (free plan), iat, expires_at, grace_until, refresh_by, server_time, ads_enabled`.

- Signed by the Worker (`LICENCE_SIGNING_KEY`), verified **offline** by the app with the public keys in
  `apps/mobile/src/config/licenceKeys.ts` (two slots for key rotation; the `dev` key only in debug builds).
- `did` binds the token to one phone; copying it to another phone gives read-only.

## Modes (`computeLicenceState`, pure and unit-tested)
| Situation | Mode | Can write | Ads |
|---|---|---|---|
| plan valid (trial or paid) | full | yes | no (paid/trial have `no_ads`) |
| paid plan ended, ≤ 7 days | grace | yes | no |
| trial ended, or paid + grace ended | **free** (owner decision D-20) | yes, within free limits | yes |
| no check-in for 30 days (`refresh_by`) | read-only | no | — |
| suspended / device deactivated / bad signature / no licence | read-only | no | — |
| device clock > 24 h behind the max time ever seen | needs check-in | no | — |

Read-only never deletes or hides data. Enforcement is in `src/domain/licence/guard.ts`
(`assertCanWrite`, `assertWithinLimit`), called by domain services.

## Clock guard
`max_seen_time` is stored in the DB **and** in the keystore. It moves forward with the device clock
when the clock looks sane and is reset to the server time at every successful check-in.

## Daily check-in (`POST /v1/checkin`)
Runs when the app opens / returns to foreground and the last check-in is older than 20 h.
One request does: refresh-token rotation, session-revoke check, licence refresh, integrity anchor
(Phase 3+ sends real chain heads), notices. If the session was revoked remotely, the app drops the
refresh token and licence → read-only until the owner signs in again with OTP.

## Trial & plans
Sign-up → 14-day Pro trial (from the plan's `trial_days`). Plans and limits are edited in super admin;
new values reach phones at the next check-in.
