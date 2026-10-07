# SAMADHAN — historical build notes, 28 September 2026

Superseded by [the community and administration build](COMMUNITY_BUILD.md), dated 30 September 2026. The notes below describe the earlier mobile-first milestone, not the current feature set.

Priority changed to the citizen Android/iOS app during implementation. The admin portal is retained for exercising the complaint lifecycle; further admin features are paused.

## Implemented and reviewable

- React Native / Expo SDK 57 app, shared across Android, iOS and the browser review build.
- Supplied logo and navy/green/saffron brand direction. English/Hindi welcome, language selection, simulated phone verification and session-only sample profile.
- Resident home, complaint counters, filtered complaint list, detail, status history and ward notices.
- Three-step reporting: category, title/description and camera/gallery photos, then foreground GPS or editable coordinates, locality and media-processing consent.
- Actual authenticated image upload to R2; signature checks for JPEG/PNG/WebP and a 5 MB limit per file. Images stay scoped to the private test workspace.
- Durable D1 test complaint state, unique IDs, version checks to prevent lost updates, transitions and timestamped audit events.
- Resolution evidence, simulated closure-code issuance, hash/expiry/attempt limits, resident closure and dispute/reopen. No provider messages are sent.
- Native app pairing using a hashed, expiring, resident-only token. Stored in native secure storage. The browser preview uses the private Site identity.
- Admin workbench, assignment, status changes, evidence, CSV export, notices, workload, settings and communication/audit views, retained as supporting test tools.

## Explicitly incomplete

This is a working development prototype, not the PRD's completed production POC.

- Welcome-screen phone OTP is a **UI simulation**, not authentication. It uses a fixed sample phone number and creates no real resident account. The welcome profile is explicitly session-only.
- Native pairing is a developer test bridge. Production resident authentication, user provisioning and per-resident authorization still need implementing against a chosen provider.
- WhatsApp Business and SMS adapters, approved localized templates, provider webhooks, retries and actual delivery remain unconnected. Logs explicitly say not sent.
- Privileged override is deliberately unavailable until actual role provisioning, fresh MFA and an immutable external audit sink exist. Current audit entries are application-protected, not an immutable compliance log.
- One sample ward (Ward 12, Jaipur); it is not a verified operational ward boundary. Coordinates are editable; map pin selection, geocoding and boundary validation remain outstanding.
- Basic Hindi coverage; category names, seed content and some secondary screens still use English.
- Video, internal admin notes, resident follow-up uploads, actual staff accounts, category-specific acknowledgement/resolution SLAs, scheduled escalation, ads and advanced reports are not implemented.
- Malware scanning, retention/deletion jobs, monitoring, backup/restore drills, production legal/consent copy and accessibility/device audit remain launch work.
- No APK/IPA was signed, no device installation was performed and nothing was submitted to Google Play or the App Store. Native JS bundling does not replace device testing.

## Verification

- Web and mobile TypeScript checks.
- Nine domain tests: transition permissions; evidence requirement; valid/invalid/expired/locked/replayed closure codes; dispute; private challenge filtering; disabled override; submission validation.
- Local API integration: unauthenticated rejection; synthetic image upload; full complaint lifecycle; native resident permission boundaries; stale-version conflict; persisted read-back.
- Browser review of the actual Expo web export: welcome, test verification, sample profile and resident home. Reporting interaction checks are performed separately.

## Product decisions assumed for this first build

One shared app for Android/iOS; a single private demo workspace; one sample ward; no public complaint map; reports private to operations; WhatsApp preferred with SMS fallback once integrated. Confirm real pilot ward, controller/operator, SMS/WhatsApp provider, map provider, category SLAs and allowed reopen period before a real-user pilot.
