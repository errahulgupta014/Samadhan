# Resident registration, login and notifications — API contract

Shared contract between the portal backend (repo root: `lib/`, `app/api/`, `db/`, `drizzle/`, `shared/`) and the Expo citizen app (`mobile/`). Types live in `shared/community.ts` and `shared/domain.ts` (copy to `mobile/shared/` after any change). Base URL = the portal origin (`connection.url`). All bodies are JSON unless noted. Errors are `{error: string}` with a 4xx/5xx status.

## Decisions (made by the product owner's request, 2026-10-05)

- Residents log in **only with mobile number + OTP**. A registered resident is never asked for details again; logging in lands on the Home/welcome screen.
- A session token (opaque, stored hashed server-side, ~90 days, sliding is optional) is kept by the app (SecureStore on native, localStorage on web). The app never asks to log in again until the user logs out, the token expires, or the server returns 401.
- OTP delivery: no SMS/WhatsApp provider is connected yet. Until one is configured, the server runs **test OTP mode** and accepts the fixed code from `RESIDENT_TEST_OTP` (default `123456`). The code is **never shown in the app UI**. Test mode must be a single, clearly named server-side switch (`OTP_PROVIDER` unset => test mode) so it is trivial to replace with a real provider. Document this in the handoff.
- OTP rules: 6 digits, 5-minute expiry, 5 wrong attempts lock the challenge, resend cooldown 60 s, hash the code, never log it.
- After registration a resident can only change: profile **photo**, **classified-notification preference**, and **language** preference. Name, mobile, ward, email and address are immutable from the app.
- `classifiedNotifications` defaults to **true**; `notificationConsentAt` is set at registration.
- Push notifications (Expo push): complaint updates are always sent to the complaint's resident; classified notifications only to residents with `classifiedNotifications === true`.
- All seeded/test content (sample complaints, sample notice, demo ads/places, "Demo Resident", masked sample number) must be gone from what a new resident sees.

## Public endpoints (no auth)

### `GET /api/wards`
`{ wards: PublicWard[] }` — active wards sorted by ward number (numeric, then name). `memberPhotoUrl` is `/api/wards/photo?id=<wardId>` or `null` when no photo.

### `GET /api/wards/photo?id=<wardId>`
Public image bytes of that ward's member photo (only ward member photos are public). 404 otherwise. Cache for a short time.

### `POST /api/resident-auth`
- `{action:'send-otp', mobile}` — `mobile` = 10-digit Indian mobile (strip spaces, `+91`, leading 0; validate `^[6-9]\d{9}$`). → `{ok:true, expiresIn:300, retryAfter:60}`. 429 if resent within 60 s.
- `{action:'verify-otp', mobile, code}` → `{token, registered:boolean}`.
  - `registered:true` → `token` is a full resident session.
  - `registered:false` → `token` is a short-lived (30 min) **registration token**: valid only for `POST /api/media` (photo upload) and `register`.
  - 400 wrong/expired code, 429 locked.
- `{action:'register', name, wardId, email?, address, photoId, consent:true}` with `Authorization: Bearer <registration token>` → `{token}` (full session; the registration token is consumed). Validation: name 2–80 chars; `wardId` must be an active ward; email optional but valid if present; address 5–300 chars required; `photoId` required (a media id uploaded with this registration token); `consent` must be `true`. Creates the resident profile (`registeredAt`, `classifiedNotifications:true`, `notificationConsentAt`). Idempotent by mobile: a mobile can register only once.
- `{action:'logout'}` with a session bearer → revokes that session. `{ok:true}`.

## Authenticated (bearer = session token)

Existing `GET/POST /api/workspace?view=resident` and `/api/media` accept the resident session bearer (resident id is derived from the session, no longer `demo-resident`). The admin pairing token (`pair-mobile`) and the owner cookie identity keep working for the admin portal only.

`data` (resident view) additions:
- `data.profile`: `ResidentProfile` (own profile; `mobile` is the real 10-digit number).
- `data.ward`: `PublicWard | null` — the resident's ward (number, name, city, member name, member photo URL).
- `data.notifications`: `ResidentNotification[]` newest first — kind `'complaint'` (about the resident's own complaint: status changes) and kind `'classified'` (only when `profile.classifiedNotifications` and published after consent). Each has `read` computed per resident.
- `data.unread`: `{complaints, classifieds, total}` counts of unread notifications by kind.
- `data.complaints`: only the resident's own complaints (real ownership by `residentId`), no sample/seed complaints.

Actions (`POST /api/workspace`, body includes `version` and `view:'resident'` as today):
- `save-profile` `{profile:{photoId?, classifiedNotifications?, language?}}` — only these three fields; any attempt to change name/mobile/ward/email/address → 400. `photoId` must be media uploaded by this resident.
- `read-notification` `{id}` and `read-all-notifications` `{kind?:'complaint'|'classified'}`.
- `register-push` `{token}` / `unregister-push` `{token}` — store/remove an Expo push token for this resident (table `resident_push_tokens`); max 5 per resident.

Complaint notifications are created server-side whenever an admin action changes a resident's complaint status (title like "Complaint WC-… is now In Progress", Hindi title too). Publishing a classified creates classified notifications (as today) and push messages.

## Admin portal

Wards are managed in the admin portal (Settings area): add/edit/deactivate wards with number, name (EN/HI), city, ward member name (EN/HI) and **member photo** (uploaded via the existing media upload). Permission: `settings.manage`. Action names: `save-ward` `{ward}` and `delete-ward` `{id}` (deactivate if residents reference it). The workspace seeds exactly one ward: `Ward 12`, Jaipur, no member photo.

## Addendum 2026-10-06 — activities
- `ResidentProfile.activityNotifications` (default `true`), editable via `save-profile` alongside `photoId`, `classifiedNotifications`, `language`.
- `ResidentNotification.kind` may be `'activity'` (with `activityId`); `data.unread` is `{complaints, classifieds, activities, total}`. See `docs/ACTIVITIES_API.md`.
