# समाधान (SAMADHAN)

समाधान / SAMADHAN

**जनता की बात, समाधान के साथ**

Product Requirements Document (PRD)

Civic Issue Reporting, Resolution Tracking & Ward Administration Platform


| Document Version | 1.4 |
| --- | --- |
| Product Stage | POC → MVP → Pilot |
| Primary Platforms | Android / iOS mobile app + Web Admin Portal |
| Primary Users | Residents, Ward Admin, Super Admin |
| Prepared | 22 September 2026 |


> **Final Product Name:** समाधान (SAMADHAN)  
**Tagline:** जनता की बात, समाधान के साथ


# 1. Executive Summary

समाधान (SAMADHAN) is a mobile-first civic grievance platform that enables residents to report local problems such as damaged roads, potholes, sanitation issues, garbage, drainage, streetlights, water leakage, broken public infrastructure and other ward-level concerns. A resident can submit a complaint using photos/videos, description and GPS location, then track acknowledgement, work progress and resolution.

The administration side provides a web portal for complaint triage, assignment, status updates, SLA tracking, analytics and closure. Normal closure requires OTP confirmation from the complainant. An exceptional privileged closure path is supported through a tightly audited administrative override rather than an unsafe shared static code.

The product is designed as a configurable multi-ward platform. Each deployment can carry neutral ward/representative identity, local announcements and approved local advertising. Civic-service functionality must remain operationally separate from political persuasion, voter profiling or political micro-targeting.

# 2. Product Vision & Objectives

- Make it extremely easy for a resident to report a ward-level issue in under 2 minutes.

- Give every complaint a transparent lifecycle, owner, timestamp and visible status.

- Reduce complaint loss across WhatsApp, phone calls, informal messages and paper registers.

- Give ward administrators a single operational dashboard for pending, ageing and resolved issues.

- Create verifiable closure through resident OTP confirmation, while retaining a controlled exception process.

- Provide ward-level analytics to identify recurring hotspots, service bottlenecks and resolution performance.

- Support a low-cost POC first, then expand to a production-grade multi-ward platform.

# 3. Scope

| In Scope for Core Product |
| --- |
| Resident registration with mobile OTP |
| Ward selection and GPS-assisted location |
| Complaint creation with photo/video |
| Complaint tracking and WhatsApp/SMS communications |
| Admin acknowledgement, assignment and resolution |
| OTP-based resident confirmation for closure |
| Admin dashboards and basic analytics |
| Configurable ward/representative branding |
| Basic local ad/banner slots |


# 4. User Roles & Personas

| Role | Primary Goal | Key Permissions |
| --- | --- | --- |
| Resident / Citizen | Report and track local civic issues | Register, submit complaint, upload evidence, track status, confirm closure, reopen/dispute |
| Field Worker / Vendor | Execute assigned work | View assigned jobs, add before/after evidence, update work status |
| Ward Admin | Manage complete ward operations | Acknowledge, classify, prioritize, assign, comment, update status, request closure, manage ward users/categories/SLAs, dashboards, ads and announcements |
| Super Admin | Platform governance | Manage wards/tenants, global configuration, privileged override, audit review |
| Advertiser (future) | Promote local business/service | Submit ad creative, dates and target ward; no access to resident personal data |


# 5. End-to-End Process Summary

1. Resident downloads the app and selects language.

1. Resident registers using mobile number + OTP and enters name, address, ward and consented location.

1. App opens the resident home dashboard showing Report Issue, My Complaints, ward updates and approved banners.

1. Resident selects issue category, captures/uploads photos or video, enters description and confirms map location.

1. System generates a unique Complaint ID and sends the complaint to the correct ward queue.

1. Ward Admin acknowledges the complaint, validates category/location, sets priority and assigns an owner/team.

1. Resident receives transactional updates through WhatsApp Business Messaging API as the preferred channel, with SMS API fallback, for events such as Acknowledged, Assigned, In Progress and Resolution Proposed.

1. Field/Admin user adds work notes and after-work evidence, then requests closure.

1. System sends OTP to the complainant’s registered mobile number. Successful OTP verification closes the complaint.

1. If the resident rejects the resolution, the complaint returns to Reopened/Disputed with reason.

1. Exceptional closure without resident OTP is allowed only to authorized roles with MFA, mandatory reason, evidence and immutable audit trail.

1. Dashboards update resolution ratio, ageing, SLA compliance, issue category trends and hotspot data.

# 6. Resident Mobile Application Requirements

## 6.1 Registration & Onboarding

- Mobile number is the primary login identifier; OTP-based authentication is preferred over passwords.

- Fields: Full Name, Mobile Number, Address, Ward, optional email, preferred language.

- Location permission must be explicitly requested and explained. Registration should not require continuous background tracking.

- GPS may suggest ward/location; user must be able to correct the address or drop a pin.

- Terms of Use, Privacy Notice and consent must be captured with version and timestamp.

- Optional future verification: address proof or ward resident verification, if operationally required.

## 6.2 Resident Home Dashboard

- Primary CTA: Report a Problem.

- Complaint counters: Open, In Progress, Resolution Proposed, Closed.

- Recent complaints list with status chips, Complaint ID, category, date and locality.

- Ward announcements / service notices.

- Configurable banner area for approved local advertisements or public-information campaigns.

- Representative/ward profile can be shown as tenant identity, but grievance priority and service access must not depend on political affiliation.

## 6.3 Create Complaint

| Field | Requirement |
| --- | --- |
| Issue Category | Required. Examples: Road/Pothole, Garbage, Drainage, Streetlight, Water, Sewer, Park, Encroachment, Public Safety, Other. |
| Title | Auto-suggested from category or short user-entered title. |
| Description | Required text; voice-to-text can be added later. |
| Photos | 1–5 images; camera and gallery supported; compress before upload. |
| Video | Optional; duration/size limit configurable. |
| Location | GPS coordinates + map pin + readable address/locality. |
| Ward | Derived from registration/location; editable only when allowed. |
| Visibility | Default private-to-operations; future public issue map can use anonymized data. |
| Consent | User confirms submitted media can be used for complaint processing. |


## 6.4 Complaint Tracking

- Timeline view showing Created → Acknowledged → Assigned → In Progress → Resolution Proposed → Closed.

- Display latest update, assigned department/team label, expected target date and public admin note.

- All important transactional status updates are sent through WhatsApp Business Messaging API and/or SMS API. WhatsApp is the preferred channel; SMS is used as fallback when WhatsApp delivery is unavailable or not applicable.
- The app must not depend on push notifications for critical communication; push notifications may be added later as a supplementary channel.
- Each outbound communication must be recorded in a Communication Log with message type/template, channel, masked recipient, sent time, delivery status, failure reason and fallback/retry status.

- Resident can add clarification/evidence while complaint is open, subject to moderation and size limits.

- Resident can mark resolution as accepted through OTP or reject it with a reason.

# 7. Admin Web Portal Requirements

## 7.1 Operations Dashboard

- KPI cards: Total Complaints, New, Pending, In Progress, Resolution Proposed, Closed, Reopened, SLA Breached.

- Resolution ratio and average/median resolution time.

- Trend by day/week/month and category.

- Map/hotspot view for complaint density, with privacy-safe aggregation.

- Filters: ward, category, status, priority, locality, assignee, created date, ageing bucket.

- Export to CSV/Excel for authorized admins.

## 7.2 Complaint Workbench

- Search by Complaint ID, resident mobile (masked by default), locality, category and assignee.

- Complaint detail includes resident-submitted evidence, map, timeline, internal notes, public notes and audit history.

- Actions: Acknowledge, Change Category, Set Priority, Assign, Start Work, Add Evidence, Propose Resolution, Reopen, Escalate.

- Bulk assignment/status updates may be introduced after POC with safeguards.

## 7.3 Assignment & SLA

- Each category can map to a department/team and default SLA.

- Priority: Low, Normal, High, Critical. Critical should be reserved for configured safety/service conditions.

- SLA timers should distinguish acknowledgement SLA and resolution SLA.

- Escalation rules: reminder before breach; alert to Ward Admin on breach; optional higher-level escalation.

# 7.4 Communication Architecture

SAMADHAN will use WhatsApp Business Messaging API and SMS API as the primary communication layer for resident-facing transactional messages. Critical product flows must not depend on app push notifications.

- **Preferred channel:** WhatsApp Business Messaging API for complaint confirmations and lifecycle updates.
- **Fallback channel:** SMS API when WhatsApp delivery fails, the number is not WhatsApp-reachable, or the message type/provider policy requires SMS.
- **OTP:** Login/registration and complaint-closure OTP delivery must use an approved authentication/OTP mechanism. Provider routing must remain configurable.
- **Transactional events:** Registration/login OTP, complaint submitted, acknowledged, assigned, in progress, on hold, resolution proposed, closure OTP, closed, reopened/disputed and critical ward service notices.
- **Communication Log:** Every send attempt must record complaint/user reference, template/message type, channel, masked destination, provider message ID, timestamp, delivery status, failure reason, retry count and fallback result.
- **Templates:** WhatsApp templates and SMS templates must be centrally configurable, versioned and localized for Hindi/English.
- **Consent/compliance:** Promotional or advertising messages must be separated from transactional civic-service messages and sent only under applicable consent and provider rules.
- **Push notifications:** Optional future enhancement only; not required for POC or critical communication.

# 8. Complaint Status Model

| Status | Meaning | Resident Visible? | Typical Actor |
| --- | --- | --- | --- |
| Submitted | Complaint received by system | Yes | Resident |
| Acknowledged | Admin has reviewed/accepted for processing | Yes | Ward Admin |
| Assigned | Owner/team assigned | Yes | Ward Admin |
| In Progress | Work is underway | Yes | Field/Admin |
| On Hold | Blocked by dependency; reason required | Yes | Ward Admin |
| Resolution Proposed | Admin states work is completed; OTP confirmation pending | Yes | Admin |
| Closed | Resident OTP verified or audited privileged closure completed | Yes | System/Admin |
| Reopened / Disputed | Resident rejected resolution or valid issue persists | Yes | Resident/Admin |
| Rejected / Duplicate | Invalid, duplicate or out-of-scope; reason required | Yes | Ward Admin |


# 9. OTP Closure & Privileged Override

## 9.1 Standard Closure

1. Admin/field team completes work and uploads after-work evidence.

1. Admin selects Propose Resolution.

1. System sends a time-limited OTP to the complainant’s registered mobile number.

1. Resident enters OTP in app or confirms via approved verification flow.

1. System closes the complaint and records verification timestamp.

1. Resident may provide satisfaction feedback after closure.

## 9.2 Exceptional Closure

A single reusable “super code” is not recommended because it can be shared, leaked or used without attribution. The equivalent business capability should be implemented as a Privileged Closure Override.

- Restricted to explicitly authorized Super Admin/Ward Admin roles.

- Require fresh MFA/re-authentication.

- Mandatory closure reason from controlled list + free-text justification.

- Mandatory evidence attachment where applicable.

- Record actor, timestamp, IP/device/session, reason and before/after status in immutable audit log.

- Notify resident that the complaint was administratively closed and provide a dispute/reopen route.

- Generate a periodic report of all override closures for governance review.

# 10. Branding, Announcements & Advertising

- Tenant-level branding: app name/logo variant, ward name, colors, representative profile and contact/help information.

- Announcements: road closure, sanitation drive, water disruption, camp/event, emergency notice, public-service information.

- Local ad slots: home banner, complaint-list footer, announcement card, subject to approval and content policy.

- Ad fields: advertiser name, creative, destination URL/phone, start/end date, ward coverage, approval status, impression/click counters.

- Resident phone numbers, complaint content and precise locations must not be shared with advertisers.

- Do not use complaint history or sensitive personal data for political persuasion or political micro-targeting. Keep civic operations and any political communications operationally separated.

# 11. Functional Requirements Catalogue

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-001 | Resident OTP registration | Must |
| FR-002 | Resident profile and ward selection | Must |
| FR-003 | GPS/map pin capture | Must |
| FR-004 | Complaint category and description | Must |
| FR-005 | Photo upload | Must |
| FR-006 | Video upload | Should |
| FR-007 | Complaint ID generation | Must |
| FR-008 | Resident complaint dashboard | Must |
| FR-009 | Admin queue and filters | Must |
| FR-010 | Acknowledgement and assignment | Must |
| FR-011 | Status timeline | Must |
| FR-012 | Admin/field evidence upload | Must |
| FR-013 | OTP-based closure | Must |
| FR-014 | Resident reject/reopen | Must |
| FR-015 | Privileged audited closure override | Must |
| FR-016 | WhatsApp Business Messaging API for transactional communication | Must |
| FR-017 | SMS API for OTP and communication fallback | Must |
| FR-017A | Communication delivery log, retry and channel fallback tracking | Must |
| FR-017B | Push notifications as supplementary future channel | Could |
| FR-018 | SLA configuration | Should |
| FR-019 | Ward KPI dashboard | Must |
| FR-020 | CSV/Excel export | Could |
| FR-021 | Announcements | Should |
| FR-022 | Ad/banner management | Could for POC; Should for MVP |
| FR-023 | Multi-language UI | Should |
| FR-024 | Multi-ward tenant configuration | Should |
| FR-025 | Audit log | Must |


# 12. Non-Functional Requirements

| Area | Requirement |
| --- | --- |
| Performance | Core screens should load within ~2–3 seconds on typical 4G; image upload must show progress and retry. |
| Availability | POC best effort; production target should be defined (e.g., 99.5%+ monthly) based on hosting plan. |
| Scalability | Architecture should support multiple wards and growth in complaints/media without redesign. |
| Security | TLS, encryption at rest, RBAC, MFA for privileged users, secure secrets, rate limiting, audit logs. |
| Privacy | Data minimization, purpose limitation, consent, retention policy, deletion/correction process and masked PII in admin views. |
| Accessibility | Readable contrast, scalable text, screen-reader labels, keyboard-accessible admin portal. |
| Localization | Hindi + English recommended for pilot; translation keys externalized. |
| Observability | Central logs, error tracking, API metrics, WhatsApp/SMS delivery logs, fallback/retry telemetry and admin audit events. |
| Backup/DR | Automated database backup; media durability; documented restore procedure. |


# 13. Privacy, Safety & Data Governance

- Collect only information required to identify the resident, route the complaint and communicate status.

- Precise location should be captured per complaint when needed; avoid continuous background location tracking.

- Define retention periods for resident profiles, complaint records, media, OTP logs and audit logs.

- Mask mobile numbers and addresses for roles that do not need full access.

- Media may contain faces, vehicle plates or private property; provide admin controls for restricted viewing and future redaction if public display is added.

- Rate-limit complaint creation and OTP requests to reduce spam/abuse.

- Maintain an appeal/reopen path for rejected or administratively closed complaints.

- Before production launch in India, obtain legal review for applicable privacy, telecom/SMS, advertising and government-data obligations.

# 14. Suggested Data Model

| Entity | Key Fields |
| --- | --- |
| User | user_id, role, name, mobile, email, address, ward_id, language, status, consent_version |
| Ward | ward_id, name, boundary, city, tenant_branding, contact_info |
| Complaint | complaint_id, user_id, ward_id, category_id, title, description, lat, lng, address, status, priority, assignee_id, created_at, closed_at |
| Media | media_id, complaint_id, type, storage_url, uploaded_by, created_at, metadata |
| Status History | history_id, complaint_id, from_status, to_status, actor_id, public_note, internal_note, timestamp |
| Assignment | assignment_id, complaint_id, team/user, assigned_by, assigned_at, completed_at |
| OTP Verification | verification_id, complaint_id, channel, hashed_otp/reference, expires_at, verified_at, attempts |
| Override Closure | override_id, complaint_id, actor_id, reason_code, justification, evidence, reauth_event, timestamp |
| Announcement | announcement_id, ward_id, title, body, start/end, priority, status |
| Advertisement | ad_id, ward_id, advertiser, creative_url, destination, start/end, approval, metrics |
| Audit Event | event_id, actor_id, action, entity_type, entity_id, metadata, timestamp |


# 15. Recommended Technical Architecture

For a fast POC, use a cross-platform mobile client, a responsive web admin portal, REST/GraphQL APIs, a relational database, object storage for media, OTP/SMS provider, WhatsApp Business Messaging provider/API and map/geocoding provider. Keep providers replaceable through interfaces.

| Layer | POC Recommendation | Production Consideration |
| --- | --- | --- |
| Mobile App | Flutter or React Native | Retain cross-platform unless device-specific requirements emerge |
| Admin Portal | React / Next.js | Role-based enterprise web UI |
| Backend | Node.js/NestJS, .NET, Java/Spring, or equivalent | Modular service architecture; background jobs |
| Database | PostgreSQL | Managed HA PostgreSQL + geospatial extensions if needed |
| Media | Cloud object storage | CDN, lifecycle rules, malware scanning |
| Auth/OTP | Managed SMS/OTP provider | Rate limits, OTP security, fallback provider, delivery monitoring |
| Communication | WhatsApp Business Messaging API + SMS API | Template management, delivery receipts, retries, WhatsApp-to-SMS fallback and communication logs |
| Maps | Google Maps / Mapbox / equivalent | Ward polygon validation and geocoding |
| Push Notifications | Not required for core POC | Optional supplementary channel in a later phase |
| Analytics | App + backend event analytics | BI warehouse when scale requires |


# 16. API Surface – POC

| Method | Endpoint | Purpose |
| --- | --- | --- |
| POST | /auth/request-otp | Request login/registration OTP |
| POST | /auth/verify-otp | Verify OTP and issue session |
| GET | /wards | List/configure available wards |
| POST | /complaints | Create complaint |
| GET | /complaints/mine | Resident complaint list |
| GET | /complaints/{id} | Complaint detail/timeline |
| POST | /complaints/{id}/media | Upload evidence |
| POST | /admin/complaints/{id}/acknowledge | Acknowledge complaint |
| POST | /admin/complaints/{id}/assign | Assign complaint |
| POST | /admin/complaints/{id}/status | Update operational status |
| POST | /admin/complaints/{id}/propose-resolution | Start closure verification |
| POST | /complaints/{id}/verify-closure | Resident OTP closure confirmation |
| POST | /complaints/{id}/dispute | Reject/reopen resolution |
| POST | /admin/complaints/{id}/override-close | Audited privileged closure |
| GET | /admin/dashboard | KPI and trend data |
| GET | /admin/communications | Communication log and delivery/fallback status |
| POST | /admin/communications/{id}/retry | Retry failed eligible communication |


# 17. POC Definition

The POC should prove the complete complaint lifecycle with minimal complexity. Recommended POC scope:

- 1 ward only; 50–200 test residents.

- Android first or cross-platform build with Android pilot package.

- Hindi/English basic localization.

- Mobile OTP registration using SMS API and/or approved WhatsApp authentication flow, based on provider capability and policy.

- Five complaint categories.

- Photo upload; video can be deferred if schedule is tight.

- GPS/map pin and readable address.

- Resident complaint list and detail timeline.
- WhatsApp Business Messaging API for transactional updates, with SMS API fallback.
- Communication delivery logging for complaint and OTP messages.

- Admin web portal with queue, acknowledgement, assignment, status and resolution evidence.

- OTP-based closure and audited privileged override.

- Basic dashboard: submitted, pending, resolved, resolution rate and average resolution time.

- One announcement slot and one configurable banner slot.

- Basic audit logging and error monitoring.

# 18. POC Success Criteria

| Metric | Target for POC |
| --- | --- |
| Complaint submission completion | ≥ 90% of invited test users can submit without assistance |
| Median complaint creation time | ≤ 2 minutes after login |
| Routing accuracy | ≥ 95% complaints enter correct ward/category queue in controlled pilot |
| Status traceability | 100% state changes have actor + timestamp |
| Closure verification | 100% standard closures require valid OTP |
| Override governance | 100% override closures contain authorized actor + reason + audit event |
| Crash-free pilot sessions | Target ≥ 99% |
| Admin usability | Ward Admin can acknowledge, assign, update and close complaints without developer assistance |


# 19. Acceptance Criteria – Critical User Stories

## US-01: Resident submits a complaint

- Given a registered resident, when they select category, add description, at least one photo and confirm location, then a unique complaint is created.

- The resident sees the Complaint ID and Submitted status immediately.

- The ward admin queue receives the complaint with location and evidence.

## US-02: Admin processes complaint

- Admin can acknowledge and assign the complaint.

- Every status change appears in the resident timeline with a timestamp.

- Internal notes are not exposed to residents; public notes are.

## US-03: Verified closure

- When admin proposes resolution, an OTP verification challenge is created.

- Incorrect/expired OTP cannot close the complaint.

- Valid OTP closes the complaint and records verification.

## US-04: Exceptional closure

- Only a privileged authorized user can access override closure.

- Fresh authentication/MFA, reason and audit event are mandatory.

- Resident receives the closure message through WhatsApp, with SMS fallback where required, and can dispute/reopen within configured policy.

# 20. Analytics & Reporting

- Complaint volume by category, locality and date.

- Open vs resolved ratio.

- Acknowledgement and resolution SLA compliance.

- Average and median time to acknowledge/resolve.

- Ageing buckets: 0–1, 2–3, 4–7, 8–15, 15+ days.

- Reopen/dispute rate.

- Top recurring issue categories and privacy-safe geographic hotspots.

- Ward Admin/team workload.

- Ad impressions/clicks for approved commercial banners, without exposing resident-level personal data.

# 21. Abuse Prevention & Operational Controls

- OTP and messaging rate limits, device/session throttling and bot protection.
- WhatsApp/SMS templates must be centrally managed and approved where provider/platform rules require it.
- Failed WhatsApp delivery should follow configurable retry/fallback rules; critical eligible messages should fall back to SMS.
- Advertising or promotional messages must not be mixed into transactional complaint/OTP templates without appropriate consent and applicable platform/provider compliance.

- Duplicate complaint detection using location/category/time; initially advisory, later AI-assisted.

- File type, size and malware validation.

- Admin moderation for abusive text/media.

- Role-based permissions and least privilege.

- No hard delete of operational complaint history by ordinary admins; use archival/status policies.

- All privileged actions must be auditable.

# 22. Phased Delivery Plan

| Phase | Indicative Duration | Outcome |
| --- | --- | --- |
| Phase 0 – Discovery & UX | 1–2 weeks | Finalize categories, ward workflow, wireframes, data/privacy decisions, POC backlog |
| Phase 1 – POC Build | 4–6 weeks | Resident app + admin portal + end-to-end complaint/OTP lifecycle |
| Phase 2 – Controlled Pilot | 2–4 weeks | Single-ward real-user pilot, telemetry, issue fixes, workflow tuning |
| Phase 3 – MVP | 6–10 weeks | Multi-ward, stronger SLA, notifications, announcements, ads, reporting, production hardening |
| Phase 4 – Scale | Ongoing | Integrations, field-worker app, GIS, advanced analytics, multilingual expansion |


# 23. Indicative POC Backlog

| Epic | Key Stories |
| --- | --- |
| Authentication | Request OTP, verify OTP, session, logout, resend/rate limit |
| Resident Profile | Name, address, ward, language, consent |
| Complaint | Create, media, location, category, validation, unique ID |
| Resident Tracking | List, detail, timeline, notifications |
| Admin Operations | Queue, filters, acknowledge, assign, status, notes, evidence |
| Closure | Propose resolution, OTP verification, dispute/reopen, override closure |
| Dashboard | Core KPIs, status/category chart, ageing |
| Configuration | Categories, ward details, branding, banner/announcement |
| Security | RBAC, audit events, media validation, rate limiting |
| QA | API tests, mobile smoke tests, role tests, closure/security tests |


# 24. Key Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| False/spam complaints | OTP identity, rate limits, duplicate detection, moderation |
| Location inaccuracies | Map pin confirmation, address edit, GPS accuracy indicator |
| Admin closes without real resolution | Resident OTP, after-work evidence, override audit and dispute path |
| Shared privileged code leakage | Do not use static super code; use RBAC + MFA + audited override |
| Large media costs | Compression, upload limits, lifecycle/retention rules |
| Low resident adoption | Simple onboarding, Hindi/English, QR campaigns, assisted registration |
| Operational backlog | SLA dashboard, ownership, escalation, ageing queues |
| Privacy concerns | Data minimization, transparent notice, masking, retention and access controls |
| Branding perceived as affecting service | Separate civic-service workflow from political communication and prohibit service prioritization by affiliation |


# 25. Open Product Decisions

- Will one app serve all wards (multi-tenant) or will each ward have a separately branded app?

- Who is the legal/data controller: private operator, elected representative office, municipality, NGO, or another entity?

- Should residents be allowed to report outside their registered ward?

- Should anonymous complaints ever be allowed for sensitive categories?

- What are category-specific acknowledgement and resolution SLAs?

- Who are the actual field executors: ward team, municipal department, contractor, volunteer, or mixed?

- Should a complaint become publicly visible on a map/list? If yes, what data must be anonymized?

- Which SMS/OTP and map providers will be used, and what is the expected monthly volume?

- What is the ad approval policy and revenue model?

- What is the allowed reopen window after closure?

- What evidence is mandatory for each category before resolution can be proposed?

# 26. Recommended First Implementation

Start with a single-ward POC and deliberately keep the workflow narrow: OTP login → create complaint with photo/location → admin acknowledgement/assignment → work update → resolution evidence → resident OTP closure → dashboard. Do not begin with a large ad marketplace, complex government integrations or AI. Those features can be added after the core trust loop—report, track, resolve, verify—works reliably.

For the first UX prototype, create approximately 8 resident screens (language/login, registration, home, create complaint, map/location, complaint success, my complaints, complaint detail/OTP) and 5 admin screens (login, dashboard, complaint queue, complaint detail, configuration). This is sufficient for stakeholder review and a clickable POC before backend development.

# 27. Definition of Done for POC

- A test resident can register and log in using OTP.

- A complaint can be submitted with category, description, photo and location.

- The complaint appears in the correct admin queue.

- Admin can acknowledge, assign and progress the complaint.

- Admin can attach resolution evidence and request closure.

- Resident OTP is required for standard closure.

- Privileged override is role-controlled and fully audited.

- Resident and admin dashboards reflect status accurately.

- Critical APIs have automated tests and security checks.

- Pilot telemetry and error logging are enabled.

- Privacy notice, consent and basic retention policy are documented.

# Appendix A – Suggested Complaint Categories for Pilot

| Category | Examples |
| --- | --- |
| Road & Footpath | Pothole, broken slab, damaged footpath, unsafe road surface |
| Garbage & Cleaning | Uncollected garbage, dirty public area, overflowing bin |
| Drainage & Sewer | Blocked drain, open drain, sewer overflow |
| Streetlight & Electrical | Streetlight not working, exposed public wiring |
| Water | Leakage, public supply issue, damaged public tap/pipe |
| Parks & Public Spaces | Broken bench, damaged play equipment, cleanliness |
| Public Infrastructure | Broken cover, railing, signboard, public structure |
| Other | Any ward-level issue not covered above |


# Appendix B – Example Resident Complaint

Complaint ID: WC-W12-2026-000184

Category: Road & Footpath

Description: Broken slab and pothole near the community entrance; two-wheelers are slipping during rain.

Location: GPS pin + locality/address

Evidence: 2 photos

Timeline: Submitted → Acknowledged → Assigned → In Progress → Resolution Proposed → Closed (OTP Verified)
