# SAMADHAN — handoff for Codex

Updated 2026-10-05 after the requested security, accessibility, watermark and splash review. Earlier feature implementation was recorded on 2026-10-04; verification below distinguishes the two runs.
Nothing has been committed or pushed. All work is uncommitted changes on `main` — do not discard them.

## Latest continuation (2026-10-05)

Read this file first, retained the existing dirty tree, and ran the full baseline before editing. Baseline matched this handoff: all six required commands passed, including 23 unit tests. Read the Expo SDK 57 docs before touching the splash implementation. No packages were installed and Reanimated was not added.

- Fixed finding 8 first: disabled-banner references now block the upload-owner shortcut unless another independently readable use grants access. This matters because the owner uploader and paired resident both use `demo-resident`. Unit and API tests exercise that exact identity. Resident bearer requests for hidden media return 404, including `If-None-Match`; settings admins retain preview access. Banner responses now require cache revalidation (`private, max-age=0, must-revalidate`). This cannot revoke bytes a user has already downloaded.
- Fixed findings 9–13: hidden slider links have web `aria-hidden`, negative tab order and disabled state; restoring defaults explicitly clears the draft even if the published baseline was already default; server/admin/mobile validators require a complete HTTPS prefix and reject embedded whitespace, backslashes and userinfo; exported Poppins fonts are relocated to `/mobile-app/fonts`; View all, Toggle and slider dots use the shared pressed feedback.
- Fixed findings 1–2: `CivicWatermark` is memoised, placements/styles are memoised, and its container measures itself with `onLayout`. The measured tab-bar height becomes its bottom inset. The watermark stays outside the keyboard-avoiding container.
- Also resolved finding 5's duplicate splash/wash colours using theme tokens.
- Reviewed the full splash checklist (details below). Fixed native-hide success tracking so a rejected hide can be retried, stopped artwork cross-fades on cleanup, made reduced-motion lookup settle once with an opacity-only timeout fallback, made the web underlay inert during splash, and kept the inline splash's delayed reload link out of focus until visible.
- Regenerated `public/mobile-app`. The current generated entry is `entry-9cd34445f66b4806d76339cf73a1ea2f.js`.

Continue keeping this file current after changes; `CLAUDE_HANDOFF.md` points here so both agents use the same state.

## What this is

SAMADHAN: civic grievance / ward-complaint app for Indian municipal wards (navy/green/saffron tricolour brand, English + Hindi).

- `mobile/` — Expo SDK 57 / React Native 0.86 citizen app (Android, iOS, web export). Source in `mobile/src`, config in `mobile/app.config.js` (authoritative; `mobile/app.json` is kept in sync but `app.config.js` wins).
- Repo root — Next-style portal on `vinext` + Cloudflare Workers (wrangler local) with D1/R2: admin portal (`/admin`), APIs (`/api/*`), and hosting for the mobile web export at `/mobile-app`.
- Shared domain model: `shared/` (root) is copied into `mobile/shared` by `scripts/mobile-web.mjs`. Edit `shared/` and keep `mobile/shared` in step.
- Background docs: `docs/MOBILE_DEVELOPMENT.md`, `docs/COMMUNITY_BUILD.md`, `docs/BUILD_STATUS.md` (historical), `mobile/AGENTS.md` (Expo rules: read SDK 57 docs before touching Expo APIs; install packages only with `npx expo install`).

## The five requirements this session worked on

The user asked for these five things; an audit found all five only partly done, then they were implemented:

| # | Requirement | State |
|---|---|---|
| 1 | Splash screen always animated | Implemented (see below). Web verified visually. Native untested. |
| 2 | 3D look and feel on all options/functionality | Implemented app-wide via shared primitives. Web verified visually. Native untested. |
| 3 | Banner slider (personal/political branding) after splash/login | Implemented: swipe, auto-resume, optional https link per banner. Renders on Home. |
| 4 | Light background watermark fitting the civic business context | Implemented: civic motifs (streetlight, road, tap, drain, bin, ward pin, building, chakra) at the screen edges, low opacity. |
| 5 | Decent colours and fonts everywhere | Implemented: `theme.ts` tokens, contrast fixes, Poppins for English and Hindi, min font sizes. |

### Where things live

- `mobile/src/theme.ts` (new) — all colour/type/radius/spacing tokens; contrast helpers; per-fill bevel/shadow helpers. Do not add raw hex in screens; use tokens.
- `mobile/src/Design.tsx` (rewritten) — `Text`/`TextInput` wrappers (Poppins by weight, Devanagari rules: zero letterSpacing, 13px floor, 1.5x lineHeight, nested-Text inheritance), 3D primitives (`raised`, `pressedState`, `insetStyle`, `Pressable`, `GradientFill`, `GradientButton`, `IconTile`, `Tilt`, `Button`, `IconButton`, `Field`, `Chip`, `StatusBadge`, `Toggle`, `StepDots`, `Notice`, `glass()`, `cardSurface()`), `Glyph`/`Arrow`/`Icon` (Ionicons replacements for missing glyphs).
- `mobile/src/CivicArt.tsx` (new) — `CivicWatermark` + `CivicMotif`. Rendered once at the App root.
- `mobile/src/Brand.tsx` — animated `BrandedSplash` (logo spring, rotating chakra, tagline reveal, tricolour bar, exit transition, hard time cap, reduce-motion = opacity-only animation, holds until fonts load/fail). Native splash hand-off uses `expo-splash-screen` (`preventAutoHideAsync` / `hideAsync` after first layout).
- `mobile/src/BrandingSlider.tsx` (new) — slider (PanResponder swipe, auto-advance that resumes ~10–12 s after interaction, pause/play, dots, optional tap-to-open https link).
- `mobile/src/labels.ts` (new) — Hindi/English status/category/filter labels.
- `mobile/src/App.tsx` — splash/font/ready gate, shell, tab bar.
- `app/banner-manager.tsx` (new, root portal) + banner part of `app/admin-panels.tsx` — admin upload/enable/reorder banners; draft re-syncs after publish/409.
- `lib/service.ts`, `shared/domain.ts` — banner validation (incl. https-only `linkUrl`); `app/api/media/route.ts`, `lib/media-access.ts`, `lib/projection.ts` — media caching + resident visibility (hidden banners must stay unreadable by residents).
- `scripts/mobile-web.mjs` — web export; now also injects an inline CSS splash into `public/mobile-app/index.html` so the web page is not blank before the JS bundle loads.
- New assets: `mobile/assets/splash-logo.png`, `splash-logo-web.png`, `splash-artwork.jpg`. New dependency: `expo-linear-gradient ~57.0.2` (installed via `npx expo install`).
- Tests: `tests/community.test.mjs` (banner + linkUrl cases), `tests/banners-api.mjs` (needs a running dev server).

## Verification status (2026-10-05, after all code changes)

| Check | Result |
|---|---|
| `cd mobile && npx tsc --noEmit` | pass (re-run after last edit) |
| `cd mobile && npx expo lint` | pass (re-run after last edit) |
| root `npx tsc --noEmit` | pass |
| `node --test tests/community.test.mjs tests/workflow.test.mjs` | 24/24 pass; baseline was 23/23 |
| `node tests/banners-api.mjs` (against dev server) | pass, including real resident bearer credentials and the shared `demo-resident` uploader case |
| `node scripts/mobile-web.mjs` (web export) | pass; regenerates `public/mobile-app` |
| root `npm run build` | pass; project dev/worker processes stopped before export/build, then dev restarted |
| Visual check, web export at 375×812 | pass: animated splash → Home, banner slider/dots, watermark, 3D cards and controls |
| Font routes | all four Poppins TTF URLs return HTTP 200, `font/ttf`; browser CSS references relocated paths; no browser console errors observed |
| Local admin regression | pass: upload an unpublished draft while supplied banners are active, enter malformed `https:/example.org` (publishing disabled), restore supplied banners → draft cleared and success shown |
| Web linked-slide keyboard check | pass: Tab from rotation control reaches current link, next Tab reaches Previous banner; both offscreen links have `aria-hidden=true`, `tabindex=-1`, disabled state |

All six required commands passed both before and after edits. Only handoff/evidence files changed after the final build. Root `npm run lint` was not requested/run (see existing noise below).

Visual evidence: `docs/verification/mobile-home-375x812-2026-10-05.jpg` and `docs/verification/mobile-splash-375x812-2026-10-05.jpg`. Measured viewport was 375×812; watermark bottom was 737px and tab-bar top 736.6px (subpixel rounding). Only the active banner appeared in the accessibility tree. Browser testing is not native-device testing.

The API test creates/revokes a local resident pairing token, which replaces any previous test token, restores the original banner configuration in `finally`, and leaves test media/audit records in local storage. Browser QA likewise used temporary local banner media; supplied defaults were restored afterward. No remote workspace was changed.

Re-run the whole set before committing (commands are in "Commands" below).

## NOT done / not possible yet

- **No publishing or EAS build was attempted on 2026-10-05.** The 2026-10-04 handoff reported missing Cloudflare/Sites vars and `.env`, and `eas whoami` → "Not logged in"; credential availability was not re-verified this session. Nothing was submitted to Google Play / App Store; no APK/IPA was built. Verify real credentials before any later deployment; do not invent, hard-code or mint credentials to bypass this gate.
- **No native-device testing.** Android/iOS never run. Specifically unverified on device: boxShadow arrays and inset shadows, perspective tilt, native→in-app splash hand-off timing, authenticated `Image` headers for banners, Devanagari matra clipping, `LinearGradient`. iOS cannot animate its native launch screen, so the design is a seamless hand-off into the in-app animated splash.
- Watermark is not shown on the opaque launch splash or the admin splash preview (intentional).
- Resident authentication is still the documented test bridge (simulated OTP, pairing token) — see `docs/BUILD_STATUS.md`. Not production auth.
- Dev-server artefacts: `mobile/native-dist` and `mobile/dist` are generated outputs.

## Review findings — disposition on 2026-10-05

From the independent code reviews of the final code (file:line as reported; verify before fixing):

1. **Fixed:** memoised watermark and placement style objects. Performance was reviewed structurally, not profiled on hardware.
2. **Fixed:** watermark uses container `onLayout` and measured tab-bar inset. Web bounds verified; native safe-area/rotation/keyboard behaviour remains untested.
3. **Fixed (2026-10-05):** `CivicArt.tsx` now clamps every layer: base strokes (navy and green) by `WATERMARK_MAX_ALPHA` (10%), accents by new `WATERMARK_ACCENT_MAX_ALPHA` (20%) in `theme.ts`, and a `__DEV__` guard warns if tertiary text contrast on the strongest allowed navy stroke drops below 4.5:1. No automated unit test (the mobile TS is not wired into the node test runner).
4. **Fixed (2026-10-05):** the `as unknown as ViewStyle` double-cast is replaced by a typed `WebGestureStyle` with a single `satisfies ... as ViewStyle` cast (RN `ViewStyle` has a narrower `cursor` type, so one cast remains for web-only CSS props).
5. **Fixed:** watermark washes use `saffronSoft`/`greenSoft`, and `SPLASH_BG` uses `colors.paper`. Config and inline pre-React HTML still legitimately mirror token values.
6. **Fixed (2026-10-05):** `typeScale` gained `bodyMd` 15, `titleSm` 17, `titleMd` 19, `h2` 26 and `hero` 30; every off-scale `fontSize` literal in App/Home/Onboarding/ReportFlow/Design/BrandingSlider now references the scale. `hindiType()` is still exported but unused (harmless).
7. Already fixed this session (do not redo): Hindi text now uses Poppins (bundled Poppins files include Devanagari glyphs; the earlier "Devanagari is not in Poppins" gate was wrong); `TextInput` now uses the 13px Devanagari floor and 1.5× line height for multiline Hindi.

### Banner and control findings (all requested fixes completed)

8. **Fixed and regression-tested:** hidden-banner-only media cannot use uploader identity to bypass visibility; real paired-resident requests tested, including conditional caching.
9. **Fixed and browser-tested:** offscreen links are hidden, disabled and excluded from tab order.
10. **Fixed and browser-tested:** restore explicitly resets the draft even when the baseline remains default.
11. **Fixed:** aligned server/admin/mobile HTTPS validation; API tests cover missing slashes, NBSP, tabs, backslashes, credentials and non-HTTPS schemes. UI rejects malformed prefix.
12. **Fixed and HTTP-checked:** export relocates all four Poppins fonts outside `node_modules`, rewrites bundle references, and each route returns 200.
13. **Fixed:** shared pressed feedback on View all, Toggle and dots. Browser verified control rendering and dot navigation; native press/shadow appearance untested.

### Splash checklist review completed (single-agent code review, not independent review)

- Native hand-off: plugin and React share 160px logo/paper background; waits for layout and logo load or 1200ms fallback, then native fade + 150ms lead. Fixed success/in-flight bookkeeping so a failed hide does not permanently suppress retry. Actual Android/iOS transition remains unverified, including safe-area edge clipping.
- Once-only animation: per-mount flags protect intro/tag/art/exit; app launch flag prevents navigation remount replay. Branding URL updates cross-fade only the artwork; artwork animation now stops on cleanup.
- Exit: 2400ms minimum, readiness gate capped at 3500ms, artwork wait capped at 3000ms, 420ms exit (plus 140ms lead for full motion). App has native-hide and overlay-removal safety timers. Underlying web content is inert until overlay removal; observed zero inert wrappers afterward.
- Time caps: checked code paths and cleanup; network failure, hung native bridge and all timer edge cases were not simulated on hardware.
- Reduced motion: opacity-only timeline, preference resolves once; timeout/error defaults to reduced motion so a late response cannot introduce movement mid-timeline. Actual OS accessibility setting was not toggled during browser QA.
- Web inline splash: first HTML frame contains logo and opacity animation before JS, delayed reload control is hidden from focus until visible, React replaces it with the animated splash. Reload frames and subsequent Home rendering verified at 375×812.

## Suggested next steps for Codex (in order)

1. Preserve all uncommitted work on main. Run the full verification set after further code edits.
2. Remaining low-priority review items are 3 (watermark alpha/contrast guard), 4 (web gesture style double-cast), and 6 (off-scale typography / unused helper). Do not report these as fixed.
3. Run on a real/emulated Android and iOS device (`cd mobile && npx expo start`, Android emulator API URL `http://10.0.2.2:5173`) and check: splash hand-off, 3D shadows, gradients, banner swipe vs vertical scroll, Hindi rendering.
4. Review generated output in `public/mobile-app` (many tracked files deleted/added by normal export). Do not commit unless the user separately authorises it.
5. When credentials exist: `eas build --profile preview` (Android APK) and portal deploy. Confirm the real pilot ward, operator, SMS/WhatsApp provider and SLAs first (see `docs/BUILD_STATUS.md`).

## Commands

```powershell
# from E:\@Products\Samadhan\mobile
npx tsc --noEmit
npx expo lint
# from E:\@Products\Samadhan
npx tsc --noEmit
node --test tests/community.test.mjs tests/workflow.test.mjs
node scripts/mobile-web.mjs          # web export -> public/mobile-app (also copies shared/ to mobile/shared)
npm run build                        # vinext build; fails with EPERM if `npm start`/wrangler holds dist/ — stop it first
npm run dev                          # portal + app at http://localhost:5173
node tests/banners-api.mjs           # needs `npm run dev` running (uses /signin-with-chatgpt mock identity)
```

Preview in a browser: open `http://localhost:5173/signin-with-chatgpt?return_to=/mobile-app/index.html` once (dev mode only; returns 404 on `npm start`), then `http://localhost:5173/mobile-app/index.html`.

## Gotchas

- **git "dubious ownership"** on this repo (owner is `CodexSandboxOffline`). Use `git -c safe.directory='E:/@Products/Samadhan' <cmd>` instead of changing global config.
- **Root `npm run lint` is noisy**: ~138 errors/7.9k warnings, all in `mobile/src/*` (root ESLint config applies `no-explicit-any`/`no-require-imports` there) and generated `tests/.community`, `tests/.generated`. The mobile project's own `npx expo lint` is the one that must pass. Do not "fix" the root-lint noise by editing generated files.
- `npm start` (production wrangler) locks `dist/` on Windows → `npm run build` fails EPERM. Stop it before building.
- A pre-existing dev server may already be bound to port 5173; check before starting another.
- Expo APIs change per SDK: read https://docs.expo.dev/versions/v57.0.0/ before touching them; never `npm install` a mobile dependency — use `npx expo install`.
- `public/mobile-app` is generated and fully replaced on every `node scripts/mobile-web.mjs`.
- Do not add Reanimated (not a declared dependency); animations use RN `Animated`/`PanResponder`.
- Security invariants to keep: residents must never read media of disabled banners; banner `linkUrl` must be https only; closure OTP challenge hashes must never appear in workspace payloads; privileged override stays disabled.

## Update 2026-10-05 — logo and branding image on sign-in screens

- The "CITIZEN APP PREVIEW" text on the onboarding/sign-in header was replaced by the SAMADHAN logo (`Onboarding.tsx`, `topLogo`).
- The large logo on the onboarding steps and on the "Connect to a SAMADHAN test workspace" screen (`App.tsx`) was replaced by a new `BrandingArt` card (`Brand.tsx`). It shows the admin-published branding image (same image as the splash, passed in as `splashImage`) and falls back to the bundled `mobile/assets/splash-artwork.jpg` if none is published or loading fails.
- Verified: mobile tsc and lint pass, web export regenerated, onboarding screen checked visually at 375×812. Other screens (Home header etc.) still use the small logo by design. Not checked on a native device.

## Update 2026-10-05 — resident registration, login, wards and notifications (live-app behaviour)

Contract: `docs/RESIDENT_AUTH_API.md` (read it first). Summary of what now exists:

**Backend (root)**
- Resident auth: `lib/resident-otp.ts` (pure OTP rules), `lib/resident-auth.ts` (D1 storage, tokens), `app/api/resident-auth/route.ts`. Actions `send-otp`, `verify-otp`, `register`, `logout`. Sessions ~90 days (hashed in D1), registration tokens 30 min (media upload + register only). New D1 tables `resident_otps`, `resident_sessions` — migration `drizzle/0003_little_kabuki.sql` (applied once to the local dev DB; Sites applies it on publish).
- **Test OTP mode** (`residentOtpMode()` in `lib/resident-otp.ts`): while `OTP_PROVIDER` is unset the server accepts the fixed code `RESIDENT_TEST_OTP` (default `123456`) for EVERY number. The code is never returned or logged and is not shown in the app. **Anyone who can reach the API can sign in as any number in this mode — never run production like this.** To go live: set `OTP_PROVIDER` and implement `deliverOtp()` (currently throws 503 for real providers). The same fixed code is used as the closure-confirmation code while in test mode (`testClosureCode()`).
- Wards: `state.wards` (seed: Ward 12, Jaipur, no member). Public `GET /api/wards`, `GET /api/wards/photo`. Admin `save-ward` / `delete-ward` (permission `settings.manage`) via `app/ward-manager.tsx` in admin Settings.
- Profile rules: after registration only `photoId`, `classifiedNotifications` (default true) and `language` can change. Complaints are owned per resident (`residentId`).
- Notifications: complaint status changes create per-resident notifications; classified ones are gated by the preference; `read-notification`, `read-all-notifications`; `data.unread` counts. Push: `lib/push.ts`, `lib/push-dispatch.ts` (Expo push, best-effort, `register-push` / `unregister-push`, Android channels `complaints` / `classifieds`, payload `data.kind`).
- Test content removed: `seedWorkspace` has no sample complaints/notice; `lib/live-content.ts` is a one-time purge (`liveContentVersion=1`) of seeded records only. `lib/demo-community.ts` and the `add-demo-content` action are gone.
- Hidden-banner media leak (old finding 8) is fixed: the uploader shortcut in `lib/media-access.ts` applies only to unreferenced uploads.

**Mobile**
- New: `Auth.tsx` (welcome → mobile → "Send OTP" → OTP → registration form), `WardPicker.tsx` (dropdown with member photo/name), `Avatar.tsx`, `Inbox.tsx` (notifications page), `MediaImage.tsx` (authenticated images on web), `session.ts`, `errors.ts`, `photo.ts`, `pushTarget.ts`; `Onboarding.tsx` was deleted.
- Session persists (SecureStore / localStorage); a registered resident goes straight to Home ("Welcome, {name}" + ward card). Logout clears the session and returns to login. Profile is read-only except photo, classified switch and language; the splash-preview page is gone. Bell and Complaints/Ads tabs show unread badges. All test/sample wording removed.
- Native base URL: `extra.apiUrl` from `EXPO_PUBLIC_API_URL` (a release build needs an https URL); push needs `EAS_PROJECT_ID`.

**Verified 2026-10-05**: root + mobile tsc, mobile lint, 50/50 unit tests, build, web export, five API smoke tests (`tests/resident-api.mjs`, `api-smoke`, `community-api`, `banners-api`, `branding-api`), and a browser run at 375×812 (saved session → Home, profile, logout → login). Not verified: native devices, real Expo push delivery, a real OTP provider.

**Dev-database leftovers (local only)**: ~14 synthetic "QA …" residents from the test runs, a test resident "Meera Kapoor" (9811223344) with one complaint, and 2 old QA complaints. There is no delete-resident action; remove via the local SQLite/D1 if you want a clean slate.

**Open**: replace test OTP with a real provider; no per-IP rate limit on `/api/resident-auth`; `waitUntil` in production runtime unverified (falls back to a 3 s awaited call); ESLint `no-explicit-any` in new backend files (same as existing code).

## Update 2026-10-05 — Home layout
- Removed the large navy "Small actions. A stronger city." hero card and its skyline art from `HomeScreen.tsx`; the ward card was removed earlier. Home order is now: welcome + bell, branding slider (borderless rounded banner with overlaid dots, swipe + auto-advance, no header or buttons), a "Have a problem in your ward?" row with a small saffron megaphone **Report** button on the right, stats, services, recent complaints.
- OTP resend cooldown is 60 s (server `OTP_RESEND_SECONDS`, app countdown disables Send/Resend OTP). The hourly send cap applies only when a real OTP provider is configured.

## Update 2026-10-05 — softer 3D, optional sample data
- 3D depth was toned down centrally in `mobile/src/theme.ts` (`LEVELS` shadow alphas ~40% of before, `bevel()` halves every lip, gentler `lipColor`/`gradientFor`, lighter inset highlights) plus the tab bar, header, inset fields, toggle and branding card shadows. Callers still pass their original lip sizes; `bevel()` scales them.
- `scripts/seed-sample-data.mjs <registered 10-digit mobile>` (local, optional, re-runnable) adds a Jaipur city guide + 5 places, 4 classified ads (advertisers marked "(sample)") and 5 complaints at different stages for that resident, through the normal API with generated placeholder images. It was run for the local test resident "Shree Shyam". Nothing seeds automatically; the purge/seed-removal rules above are unchanged. Remove samples by archiving ads / unpublishing places in the admin portal.

## Update 2026-10-06 — Activities (campaigns & programmes)
Contract: `docs/ACTIVITIES_API.md`. New resident tab **Activities / गतिविधियाँ** right after Ads, for campaigns run by the Panchayat Samiti / Nagar Parishad.
- **Backend/admin:** `save-activity` / `publish-activity` in `lib/community-service.ts`; permission `activities.manage` (Super Admin, Ward Admin, Content Editor presets; **admin grants saved before this change do not have it until a Super Admin re-saves them**); admin page `app/activities-manager.tsx` ("Activities" sidebar page after Classifieds); resident media access only while an activity is visible.
- **Notifications:** first publish creates an `activity` notification + Expo push (channel `activities`) for residents with `activityNotifications` (default on; missing = on). Visibility/audience use `registeredAt <= createdAt` instead of `notificationConsentAt` (that field is nulled by the classified opt-out). `data.unread.activities`; Profile switch "Activity notifications"; Activities tab badge; inbox filter.
- **Mobile:** six tabs fit via content-width tab layout; list + `activity-detail`; Home services row is a 2×2 grid with an Activities tile.
- **Sample data:** `scripts/seed-sample-data.mjs` also adds 3 sample activities (idempotent). Tests: 63 unit tests; `community-api` / `resident-api` cover activity flows.
- **Local DB leftovers:** more synthetic QA residents (e.g. "Mobile Activities QA …") and QA activities/ads from tests. Seeding/tests may send real Expo pushes to any registered real device tokens.
- **Unverified:** native devices (tel:/links, push channel, hi-IN date formatting), admin image upload through the form.

## Update 2026-10-06 — Admin portal v2 (login, users, dynamic content)
Contract: `docs/ADMIN_PORTAL_API.md`. All verified 2026-10-06: root + mobile tsc, mobile lint, 108 unit tests (`community`, `workflow`, `admin`), build, web export, API smoke tests (`admin-auth-api`, `community-api`, `api-smoke`, `resident-api`, `banners-api`, `branding-api`), and a browser sign-in.

**Admin login and users (A1)**
- `/admin` shows an **Administrator sign-in** page (`app/admin-login.tsx`, `AdminGate`). Initial Super Admin: username `Admin`, password `Admin` (bootstrapped on the first request; flagged as a default password → non-dismissible red warning banner + "Change password" until changed). Top-bar user menu has Change password and Sign out.
- Backend: `lib/admin-crypto.ts` (PBKDF2-SHA256, 210k iterations), `lib/admin-policy.ts`, `lib/admin-auth-core.ts`, `lib/admin-store.ts` (D1), `lib/admin-auth.ts`, `app/api/admin-auth/route.ts` (`login`, `me`, `logout`, `change-password`, `list-users`, `create-user`, `update-user`, `reset-password`, `delete-user`). Cookie `samadhan_admin` (httpOnly, SameSite=Lax, 12 h sliding, 7-day cap). Lockout: 5 failures per username / 15 min (20 per IP when `CF-Connecting-IP` is present). Migration `drizzle/0004_admin_auth.sql` (tables `admin_users`, `admin_sessions`, `admin_login_failures`; applied once to the local dev DB; Sites applies it on publish).
- Users page (`app/admin-users-manager.tsx`, permission `admins.manage`, Super Admin only to grant): create/edit/disable/reset password/delete users with a role preset or per-permission checkboxes; new users must change their password at first login; nobody can delete/disable/downgrade themselves; the last active Super Admin is protected. Legacy email grants show read-only.
- Audit rows are plain sentences now.
- **Production hardening (REQUIRED before real use):** set worker var `ADMIN_BOOTSTRAP_PASSWORD` to a strong secret before the first request (or change the `Admin` password immediately); set `ADMIN_PLATFORM_IDENTITY=off` (otherwise the old platform-header identity still grants admin API access, forgeable if deployed outside the platform edge); serve over https. Not done: MFA, per-IP limits beyond Cloudflare header, forced rotation if a weak bootstrap secret is set.
- Dead code: `AccessManager` in `app/community-panels.tsx` (legacy email-grant UI).

**Dynamic content (A2)**
- New admin actions (permissions in `shared/access.ts`): `save-announcement` / `delete-announcement` (Hindi, priority Service notice/Important/Event/Emergency, optional end time, archive), `delete-classified` / `delete-activity` / `delete-place`, `save-app-config`, `save-teams`; the `settings` action also takes `ward` / `city`. **Editing a published ad or activity now keeps it published** (new items start as drafts).
- `settings.appConfig` (org label EN/HI, support phone/email/hours EN/HI, terms/privacy URLs, tab and tile visibility, maintenance message, minimum app version) is exposed in `data.settings.appConfig` and publicly at `GET /api/app-config` (cache 30 s). New permission `appconfig.manage` (Super Admin, Ward Admin, Content Editor; stored admin grants from before need a Super Admin re-save).
- Portal pages: Announcements (full CRUD), App settings, Teams editor, delete buttons + Hindi fields on ads/places/municipality/banners, live-category dashboard chart. Complaint ids now use the resident's ward number (`WC-W<ward>-<year>-<code>`).
- `scripts/seed-sample-data.mjs` also sets a default app config and two sample ward updates (Hindi).

**Mobile (A3)** reads `appConfig`: tab/tile visibility (3–6 tabs), org label, notices with Hindi + priority chips + expiry, "Need help?" support card (Home + Profile), Terms/Privacy links (Profile + registration consent), maintenance banner, blocking "Please update the app" screen when the installed version < `minAppVersion`, Hindi fields for banner caption/advertiser/address/hours/district/state, cached pre-login config.

**Known gaps / unverified:** native devices; `Secure` cookie on real https; `ADMIN_PLATFORM_IDENTITY=off` end to end; new portal pages at phone width; banner Hindi caption input in the portal (no banners locally); non-admin-user flows were verified by A1 in the browser. The local dev DB holds many synthetic QA records (residents, complaints, ads, activities) from test runs.

## Update 2026-10-06 — admin portal shell clean-up
- Side panel is themed for desktop and the mobile sheet (`app/admin-shell.css`, targets `[data-sidebar="sidebar"]`; the mobile sheet is portalled outside `.main-sidebar`, which is why the brand name was dark-on-navy there): navy panel, white name, white logo tile, light labels.
- Removed from the side panel: ward details, the "Citizen experience" link, and the user-details block. Choosing a page closes the panel on mobile (`NavItemButton` in `app/portal.tsx`).
- New read-only **My profile** page (`app/my-profile.tsx`, sidebar item for every signed-in admin; no permission needed): name, username, email, role, status, last sign-in, created, and what the account may do. Password change stays in the account menu.
- Removed at the product owner's request: the "Report an issue" button on admin pages and the **default-password warning banner** (`DefaultPasswordBanner` is no longer rendered; the API still reports `defaultPassword` and the account menu still has Change password). **Change the `Admin` password / set `ADMIN_BOOTSTRAP_PASSWORD` before any real use.**
- 2026-10-06 (portal): the **Communications** and **Audit log** pages were removed from the admin portal, along with the "Logs" group in the Users permission picker and the log-only **Auditor** role preset for new users (existing Auditor users still display). `My profile` moved from the side panel to the account menu (above Change password). Backend recording is unchanged: `state.audit`, `admin_access_events` and communications are still written; there is simply no UI for them now. The permissions `communications.read` / `audit.read` still exist in `shared/access.ts`.

## Update 2026-10-06 — admin photo, App users (block), Departments, dashboard range, mobile blocked message
Full detail in `docs/ADMIN_PORTAL_API.md` (last addendum). Verified 2026-10-06: root + mobile tsc, mobile lint, 151 unit tests (`community`, `workflow`, `admin`, `residents`, `departments`, `dashboard`), build, web export, API smoke tests run by the agents (`resident-api` incl. the full block/unblock flow, `community-api`, `api-smoke`, `admin-auth-api`, `departments-api`), browser checks of the portal pages, and a live end-to-end run of the mobile blocked-account message (block → reload the app → login screen shows "Your account has been blocked. Please contact the ward office." and the session is cleared).
- Admin portal: title-only top bar (no breadcrumb), "TEST WORKSPACE" label removed, **My profile** (read-only + profile photo, in the account menu), **App users** page (`app/residents-manager.tsx`), **Departments** page (`app/departments-manager.tsx`, replaces Teams), Overview date-range dashboard (`app/date-range.tsx`, `app/activity-chart.tsx`, `lib/date-range.ts`).
- Mobile: `ApiError.code`, `account_blocked` handling in `mobile/src/api.ts` / `App.tsx` / `errors.ts` (also on app start).
- Migrations: `0005_admin_avatar.sql` applied once to the local dev DB.
- **Department updates are only recorded ("Not sent · WhatsApp setup pending"); no WhatsApp/SMS provider is connected.** Do not add fake phone numbers to departments before a provider is connected (real messages could go out). `scripts/seed-sample-data.mjs` deliberately seeds no departments.
- Local DB leftovers: synthetic "QA …" residents (e.g. "QA Blocked …", currently unblocked), QA complaints/ads/activities, and inactive former-department cards from earlier smoke runs.
- Unverified: very wide desktop layouts of the new pages; Content Editor / read-only view of Departments in a browser (projection unit-tested); real hosted D1; native devices.

## Update 2026-10-07 — admin portal tables/filters, ward-agnostic data, closure code, complaint numbers
Detail: `docs/ADMIN_PORTAL_API.md` (last addendum). Verified 2026-10-07: root + mobile tsc, mobile lint, 211 unit tests (community, workflow, admin, residents, departments, dashboard, closure, table-filters, complaint-filters, admin-permission-form), build, web export, API smoke tests (admin-auth-api, departments-api, community-api, api-smoke, banners-api, branding-api; resident-api passed for the delete-resident agent), plus browser checks by each agent.
- **Removed pilot/test wording** from the admin portal (pilot strip, ward/city names card, test pairing panel, provider notes) and the hard-coded Ward 12 / Jaipur (server seed, app fallbacks); fresh workspaces have no wards. Admin Overview no longer shows the 'Ward notice' and 'A little attention' cards; the top bar has a centred logo + tag line (≥ 960 px); the sign-in page has a faint civic watermark (`app/admin-watermark.tsx`, styles in `app/admin-auth.css`).
- **Closure code** `settings.closureOtp` (default 123456, editable in Settings → Service settings); **resolution target** edited in days (default 2); **complaint numbers** `JSS/<yy>/W<ward>/<n>`; **Ward filter** on dashboard/complaints when ≥ 2 wards.
- **Tables + popups + filters** on Announcements, Ads, Activities, City & places, Departments, Admin Users, App users, Categories, Wards, Banners and Complaints; per-row View/Edit/Active-Inactive/Delete; App users can be deleted (`delete-resident`).
- Banner edits in the new banner table take effect immediately (no separate 'Publish banner slider' step). Complaint stat cards on the Complaints page follow the active filters.
- **Open / not verified:** ward-scoped admin permissions (follow-up); native devices; restricted-role views of the new tables in a real browser (unit/projection tested); city profile switch only verified by request interception; many synthetic 'QA …' records remain in the local dev DB (residents, complaints, a QA category and an inactive QA ward 'QA Rampur (Ward Q7)'); legacy `settings.ward/city` fields are unused by any UI and could be dropped later.

## Update 2026-10-07 (later) — closure OTP entered by the admin, Super Admin-only delete, Reports builder
- Admin closes a proposed resolution by entering the closure OTP (`app/closure-verify.tsx`, actions `admin-verify-closure` / `admin-issue-closure-code`, tests in `tests/closure.test.mjs` and `tests/admin-closure-api.mjs`; verified live through the portal screen). Mobile resident screen no longer asks for the code.
- Delete only for Super Admin (server rule in `lib/workspace-api.ts` + UI hiding + confirmation dialogs) — see `docs/ADMIN_PORTAL_API.md` addendum. Departments moved under ADMINISTRATION in the side panel.
- Reports section rebuilt as a report builder with filters, generated reports, exports and charts (agent work; see the final report of that agent for the exported formats and files: `lib/report-engine.ts`, `app/reports-manager.tsx`, `app/report-charts.tsx`).

## Update 2026-10-08 — Reports builder, category→department, nav order, Super Admin delete (STATE AS OF NOW)
**Done and verified** (root + mobile tsc, mobile lint, ~260 unit tests, build, API smoke tests; see per-item notes):
- **Reports builder** (`lib/report-engine.ts`, `app/reports-manager.tsx`, `app/report-charts.tsx`, `app/reports.css`, `tests/report-engine.test.mjs`): report types (register, by category/department/ward/status/priority, trend, resolution performance, ageing, locality hotspots, app-user registrations when `residents.manage`, custom group-by + cross-tab), filters (date range, status, category, priority, department, ward, overdue, search), live-regenerate toggle, KPI cards + SVG charts + sortable table, exports CSV (BOM, quoted, formula-safe) / XLSX (built-in zip writer, no dependency) / JSON / print-PDF (A4 landscape). Names/phones only in the register with "Include resident details" ticked. xlsx not opened in real Excel; print dialog not run.
- **Admin closure by OTP**: `admin-verify-closure` / `admin-issue-closure-code`, `app/closure-verify.tsx`; universal code `settings.closureOtp` (default 123456, Settings → Service settings). Resident app no longer enters the code.
- **Super Admin-only delete** (server `DELETE_ACTIONS` + banner/department removal checks by id in `lib/workspace-api.ts`; UI hides Delete via `app/super-admin.ts` `useIsSuperAdmin`, `viewer.role` is published by `app/use-workspace.ts`); every delete asks via `ConfirmDelete`. Test: `tests/super-admin-delete-api.mjs`.
- **Navigation**: WORKSPACE = Overview, Complaints, Reports; ADMINISTRATION = Wards (own page, moved out of Settings), Departments, Categories, Classifieds, Activities, Announcements, City & places, App users, Admin Users, App settings, Settings. "Platform identity grants (legacy)" section removed from Admin Users.
- **Categories belong to departments**: `IssueCategory.departmentId` (new categories must pick an active department; edits keep it; legacy categories without one still work); new complaints are auto-assigned to the category's department and a "Department update" is recorded; `departmentChoicesOf()` (lib/service.ts) + `data.departmentChoices` + `/api/categories` `{categories, departments}` give residents names only. Tests: `tests/category-departments.test.mjs`. Category form/table/filter in `app/category-manager.tsx`.
- **Data parity test**: `tests/data-parity-api.mjs` (admin view vs a resident's app data for categories/departments, ads, activities, notices, places, city profile, banners, app config, wards, own complaints) — passes; department choices are empty locally because no category has a department yet.
**RESTARTED (new agent a77b7260… after the owner confirmed the stop was a mistake; it repairs/finishes the earlier partial edits) — the earlier agent a7dacc50… was stopped partway — the owner stopped it; the tree still passes mobile tsc and expo lint, but the job is only PARTLY DONE and may contain half-finished edits in mobile/src/ReportFlow.tsx, useCategories.ts, App.tsx and CommunityScreens.tsx. Re-run / review before relying on it. Not verified in a browser. Requirements still outstanding**: remove the reopen/dispute option from the app; remove dates from Ads list/detail; reporting flow = Department tiles → Category tiles (tap advances; single-department auto-skip; legacy categories under 'Other'); refresh every 30 s + on foreground + fresh categories on opening the report flow. When it finishes: rebuild `node scripts/mobile-web.mjs`, rerun mobile tsc/lint, `tests/data-parity-api.mjs`, and update this section.
**Known follow-ups / gaps**: ward-scoped admin permissions; native devices untested; QA leftovers in the local dev DB (many "QA …" residents/complaints, inactive QA categories/ward); `settings.ward/city` legacy fields unused; the closure OTP is not actually delivered (no WhatsApp provider); production hardening (ADMIN_BOOTSTRAP_PASSWORD, ADMIN_PLATFORM_IDENTITY=off, https).

## Update 2026-10-08 (later) — mobile job finished; workspace size fix
**Mobile (agent a77b7260…, verified on the web build only):** Department tiles → Category tiles → Details → Location in `mobile/src/ReportFlow.tsx` (a tap advances; Back keeps the selection; one department or only 'Other' skips step 1; empty state; `useCategories.ts` returns `{categories, departments}` with `cache: 'no-store'` and refetches whenever the flow opens); no reopen/dispute UI in the app (staff-set 'Reopened' status still displays); Ads show no dates; workspace refresh every 30 s in the foreground + on foreground + after actions; a disappeared ad/activity/place shows 'No longer available'. Pull-to-refresh/foreground refresh confirmed by code reading only. Native devices untested.
**Incident fixed:** the single-row workspace JSON had grown to 2.16 MB (communications 1.5 MB, audit 370 KB), over the ~2 MB row limit, so EVERY write failed with 500 'Unable to save changes'. `capHistory()` in `lib/service.ts` now keeps the newest 500 communications and 1500 audit lines (tightening further if still > 1.8 MB) and is applied in `lib/workspace-api.ts` and `lib/resident-auth.ts` saves; workspace is now ~0.8 MB. NOT applied in `lib/workspaces.ts` (the one-time upgrade write). Long-term: move communications/audit/notifications into their own tables (the 'single JSON workspace' scale risk).
**Verified now:** root + mobile tsc, mobile lint, 258 unit tests, build, web export, API tests: admin-auth, departments, community, api-smoke, admin-closure, super-admin-delete, banners, branding, data-parity (13 categories, 2 department choices parity OK).
**Open:** ward-scoped admin permissions; native devices; closure OTP/department updates not delivered (no WhatsApp provider); QA leftovers in the local dev DB (QA residents/complaints, QA categories 'QA Mobile Potholes'/'QA Mobile Lamp' disabled plus older enabled ones: QA Pothole, QA Streetlight, QA Category …, an inactive QA ward); production hardening (ADMIN_BOOTSTRAP_PASSWORD, ADMIN_PLATFORM_IDENTITY=off, https).

## Update 2026-10-08 (cleanup)
Removed (all were tracked in git except generated folders, so `git checkout -- <path>` restores any of them): 47 unused shadcn UI components under `components/ui/` (nothing imports them; the npm packages behind them were NOT removed from package.json); 15 one-off code-patching scripts in `scripts/` (citizen-refinements, community-detail-update, community-upgrade, connect-community, dynamic-categories, final-community-fixes, finalize-mobile, logout-fix, refine-mobile, refine-workflow-checks, secure-community, splash-artwork, tiranga-refresh, wire-mobile, wire-portal); Next starter leftovers `public/{file,globe,window,favicon}.svg`; Expo template images `mobile/assets/{icon,favicon,splash-icon,android-icon-*}.png` (the real app icon comes from `samadhan-logo.png`); the `examples/` folder; generated, git-ignored folders `mobile/native-dist` and `tests/.generated|.community|.closure|.catdept|.admin|.residents|.departments` (tests regenerate them). Kept on purpose: platform scripts (install-ci, install-pnpm, npm/pnpm-install, run-framework, sites-env, build-verified, execution-profile), `build/`, `vendor/`, `docs/` (historical notes are marked superseded), `dist/`, `mobile/dist`, `public/mobile-app`. Re-verified after cleanup: root + mobile tsc, mobile lint, 258 unit tests, build, web export, admin-auth / community / data-parity API tests.
Follow-up ideas: prune unused npm dependencies (radix packages etc.), archive/remove superseded docs, add a proper square app icon (Android adaptive icon currently uses the wide logo).

## Update 2026-10-08 (installable web app / PWA)
Owner chose the phone-browser route instead of native builds (no Expo account, Java/Android SDK, Apple account or hosted server exist yet; see the earlier note on EAS builds: `eas.json` profiles `preview` (APK) and `production` are ready, run `npx eas-cli@latest login|init` then `EXPO_PUBLIC_API_URL=https://… npx eas-cli@latest build -p android|ios --profile preview`; the app id `in.samadhan.citizen` is a placeholder and the Android adaptive icon uses the wide logo).
- `node scripts/mobile-web.mjs` now also writes `public/mobile-app/manifest.webmanifest` (name SAMADHAN, standalone, portrait, start_url/scope `/mobile-app/`, theme #193753, icons 192/512/maskable), `public/mobile-app/sw.js` (no-cache pass-through worker, only to make the app installable; it never caches so admin changes show immediately), copies `mobile/assets/pwa/*` to `public/mobile-app/pwa/`, and injects the manifest, theme-color, `apple-mobile-web-app-*` meta tags, apple-touch-icon and the service-worker registration into `index.html`. Icons are generated by `node scripts/make-pwa-icons.mjs` (sharp) into `mobile/assets/pwa/`.
- Verified: files served with correct types, manifest valid, tags present, app still loads. NOT verified: service-worker registration (the embedded test browser refused to register one: "unknown error when fetching the script", while the server answers 200) and a real home-screen install on Android Chrome / iPhone Safari. Chrome only offers "Install app" on https (or localhost); iPhone Safari's Add to Home Screen works on any URL but needs the server reachable from the phone.

## Update 2026-10-08 (domain structure: site + portal at root + app at /app)
Plan in `docs/DEPLOYMENT.md`. smadhan.com → one-page static site `site/` (preview `node scripts/serve-site.mjs`, http://localhost:5180; contact email `contact@smadhan.com` is a PLACEHOLDER; check the domain spelling smadhan vs samadhan). test.smadhan.com/ → the admin portal (now the home page `app/page.tsx` = `AdminGate` + `Portal`; `/admin` redirects to `/`); test.smadhan.com/app/ → the resident app (Expo web `baseUrl` is now `/app`, exported by `scripts/mobile-web.mjs` into `public/app`; old `public/mobile-app` removed; PWA manifest/start_url/scope/sw are under `/app/`). `next.config.ts` redirects `/admin`→`/`, `/citizen`→`/app/`, `/mobile-app/*`→`/app/*`. Verified locally after restarting the dev server (config redirects need a restart): `/` 200 portal, `/app/` 200, redirects OK, site renders at desktop and 375 px, tsc/lint/unit/API tests/build pass. Not done: no domain, hosting, DNS or deployment exists; real-domain checks pending. Update any bookmarks/docs that still say `/mobile-app`.
