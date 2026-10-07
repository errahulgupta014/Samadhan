# SAMADHAN — 30 September 2026

The citizen app and admin portal share a persistent server API. This is a reviewable development build with sample authentication, not a production municipal deployment.

## Implemented

- Expo SDK 57 Android/iOS app and browser preview, Expo Router navigation, supplied branding, English/Hindi content.
- Server-persisted resident profile: name, optional email, address, preferred language, opt-in classified notifications. Verified phone cannot be changed through the profile form.
- Logout: native test-token revocation, secure local state clearing, push-token deregistration; private Site sign-out in the browser.
- Classifieds: bilingual titles/descriptions, advertiser, photographs, contacts, HTTPS websites, validity dates, draft/publish/archive. Residents receive currently published, unexpired ads.
- Inbox: consent timestamp, unread badge, durable read status, publication deduplication; foreground, pull-to-refresh and one-minute refresh.
- Municipality: bilingual overview/history with sources; visiting places with photos, addresses, hours, maps, sources, ordering and visibility. Real local content awaits verified input.
- Dynamic issue categories: names in both languages, icons, colours, ordering, stable IDs and enabled status. New categories load from the server. Disabled categories reject new reports while historical labels remain intact.
- Complaint reporting and lifecycle, image uploads, location/consent, assignment, after-work evidence, simulated resident closure verification, dispute/reopen.
- Admin personas: Super Admin, Ward Admin, Complaint Officer, Content Editor, Auditor and Custom. Both navigation and server actions enforce permissions. Only Super Admins grant access; founder/self-demotion protections and durable access-change audits apply. Disabled accounts fail on subsequent requests.
- Private resident projections and media access checks; content editors cannot read complaint records. Optimistic concurrency prevents silent overwrites; notification jobs and ad publication commit atomically.

## Production configuration still required

- Phone OTP is a **simulation**. Native pairing represents one shared demo resident. Production resident provisioning, OTP, admin authentication/MFA and device sessions must be connected before a real-user pilot.
- In-app notifications work. Physical-phone registration code and an outbox exist, but **push delivery is not connected**. Configure Expo/EAS, APNs/FCM, a delivery worker and receipt/retry handling. Jobs remain `awaiting-provider`, not delivered.
- Admin email grants apply application permissions; they do not invite users through the hosting access layer. The hosted preview stays owner-private. Production multi-admin onboarding needs configured authentication/access provisioning.
- Municipality name, district/state and verified visitor/history content await user input. Complaint examples still use Ward 12, Jaipur.
- WhatsApp/SMS, maps/geocoding/boundaries, advanced SLA/escalation, retention/monitoring/backups and production consent/accessibility review remain launch work.
- Privileged closure stays disabled pending MFA and an immutable external audit sink. Application audit tables are not immutable compliance storage.
- No signed APK/IPA, physical-device installation or store submission. JavaScript/Hermes exports are not installable release packages.

## Verification

- Web/mobile TypeScript checks; Expo lint; production portal build; Expo web, Android and iOS exports.
- 17 domain tests covering complaint verification, category lifecycle, role boundaries, grant protections, profile isolation, draft visibility, consent/read/expiry/deduplication and media privacy.
- Local API integration: image upload, complaint lifecycle, version conflicts, dynamic categories, profile persistence, publish → inbox → read, denied resident admin actions, disabled test admin grants, logout token revocation.
- Browser checks: home, profile save, classifieds, city and role-aware admin controls. Synthetic QA ads/categories are archived/disabled; QA admin addresses use `.invalid` and are disabled.

## Development

Run `npm run dev -- --host 127.0.0.1` at the root. Run `npm start` from `mobile` for native development. Apply all Drizzle migrations before starting the API.

Rebuild the browser preview after mobile edits with `node scripts/mobile-web.mjs`. Checks: `node --test tests/workflow.test.mjs tests/community.test.mjs`, `node tests/api-smoke.mjs`, `node tests/community-api.mjs`. API tests operate on the local demo database and create labelled QA fixtures.
