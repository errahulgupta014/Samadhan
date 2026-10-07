# SAMADHAN — Claude handoff

Updated 2026-10-05. Read [CODEX_HANDOFF.md](CODEX_HANDOFF.md) first; it is the authoritative, current project handoff with changes, verification results, open findings and commands. Keep both handoff entry points current after future work.

- All work is uncommitted on `main`. Do not reset, revert, discard or commit without new user instructions.
- Use `git -c safe.directory=E:/@Products/Samadhan <cmd>`; never alter global Git configuration.
- Requested findings 1–2 and 8–13 are fixed; duplicate theme colours (5) also fixed. Splash checklist reviewed and hardened.
- All six required baseline/final commands passed; final unit tests 24/24. Local banner API security tests and 375×812 browser checks passed. Full details and screenshot paths are in CODEX_HANDOFF.md.
- Findings 3, 4 and 6 fixed 2026-10-05 (watermark alpha clamp + dev contrast guard, typed web gesture style, type-scale steps). Re-verified: mobile tsc/lint, root tsc, 24/24 unit tests, web export, 375×812 browser check, no console errors.
- 2026-10-06: Activities tab, admin login (`Admin` / `Admin` default, change before real use), user management, dynamic content and app settings were added; see the last sections of CODEX_HANDOFF.md, docs/ADMIN_PORTAL_API.md and docs/ACTIVITIES_API.md.
- 2026-10-06 (later): admin profile photo, App users page with block/unblock (mobile shows a blocked-account message), Departments with contact phone (updates recorded only, no provider), dashboard date range, portal clean-up. See CODEX_HANDOFF.md (last section) and docs/ADMIN_PORTAL_API.md (addendum).
- 2026-10-07: admin portal tables with popups + filters + View/Edit/Active-Inactive/Delete everywhere, Admin Users with default permissions, no hard-coded ward/pilot content, closure code setting, complaint numbers JSS/yy/Wward/n, delete-resident. See CODEX_HANDOFF.md (last section).
- 2026-10-08: Reports builder (filters + exports + charts), admin enters closure OTP, Super Admin-only delete, nav reordered (Wards own page), categories belong to departments (complaints auto-routed), data-parity test. MOBILE JOB DONE (Department → Category tiles, no reopen, no ad dates, 30 s sync) and a workspace-size incident fixed (history capped; writes had been failing with 500) (Department → Category tiles, no reopen, no ad dates, faster sync): compiles, but unfinished/unverified — see CODEX_HANDOFF.md. See CODEX_HANDOFF.md (last section).
- 2026-10-05: resident registration, mobile+OTP login (test OTP mode), ward directory, persistent session, unread badges and push were added; see the last section of CODEX_HANDOFF.md and docs/RESIDENT_AUTH_API.md. Open: replace the test OTP with a real provider before real users; native-device validation.
- Nothing was tested on a real Android or iOS device. No EAS build, publish, deployment, commit or push was performed.
- Read Expo SDK 57 docs before Expo/React Native API changes; mobile packages only through `npx expo install`; no Reanimated.
- Never invent or hard-code credentials. Verify real deployment credentials before publishing.
- 2026-10-08: installable web app (PWA) added to the mobile web export (manifest, icons, service worker); native APK/IPA not built (needs Expo account, hosted https server, Apple account). See CODEX_HANDOFF.md.
- 2026-10-08: address layout: smadhan.com = one-page site (site/), test.smadhan.com/ = admin portal, test.smadhan.com/app/ = resident app (public/app). See docs/DEPLOYMENT.md and CODEX_HANDOFF.md.
