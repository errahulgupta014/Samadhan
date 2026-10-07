# Activities (campaigns & programmes) — contract

Product request (2026-10-06): a new resident-app section **Activities**, similar to **Ads** and placed right next to it. It lists campaigns / programmes / events run by the **Panchayat Samiti or Nagar Parishad**. Shared types are already in `shared/community.ts` (`Activity`, `visibleActivity`), `shared/domain.ts` (`Workspace.activities?`) and `shared/access.ts` (permission `activities.manage`, actions `save-activity`, `publish-activity`); they are copied to `mobile/shared/`. Do not change them without telling the other agent; if you must, edit `shared/` and copy the three files to `mobile/shared/` immediately.

## Data

`Activity = {id,title,titleHi,description,descriptionHi,organizer,organizerHi,venue,venueHi,startsAt,endsAt,imageId,contactPhone,url,status:'draft'|'published'|'archived',publishedAt}`.

- `organizer` is free text, e.g. "Nagar Parishad, Jaipur" or "Panchayat Samiti, Amer".
- Residents see an activity while `status==='published'` and `endsAt` is in the future (`visibleActivity`). They see upcoming and ongoing ones. Admins with `activities.manage` see all.
- `GET/POST /api/workspace` resident view returns `data.activities: Activity[]` (visible ones only for residents), sorted by `startsAt` ascending (soonest first).

## Actions (POST /api/workspace, admin permission `activities.manage`)

Mirror the existing Ads (`save-classified` / `publish-classified` in `lib/community-service.ts`) exactly in style:
- `save-activity` `{activity:{id?,title,titleHi,description,descriptionHi,organizer,organizerHi,venue,venueHi,startsAt,endsAt,imageId,contactPhone,url}}` → saves as `draft`, returns `{id}`. Validation: title 4–120, description 10–4000, organizer 2–150 (required), organizerHi/venue/venueHi/titleHi/descriptionHi optional (≤ same limits), venue ≤200, valid ISO `startsAt`/`endsAt` with `endsAt` after `startsAt`, `url` https only (or empty), `contactPhone` ≤30, `imageId` optional media id (must pass the same media-ownership check as classifieds `imageId` in `lib/workspace-api.ts`).
- `publish-activity` `{id,status:'published'|'archived'}`; publishing an already-ended activity is rejected ("update its dates before publishing"), sets `publishedAt` once.
- Residents cannot call either (403). Add audit-log lines like the ads do.
- Media: the image of a published, visible activity must be readable by residents (extend `lib/media-access.ts` the same way classified images are), and must NOT be readable by residents while draft/archived/ended (keep the hidden-media security invariants).
- **Notifications (scope change 2026-10-06):** the first publication creates a `ResidentNotification` of kind `activity` (with `activityId`) and an Expo push (Android channel `activities`, data `{type,kind:'activity',activityId,notificationId}`) for residents with `profile.activityNotifications === true` (default true; missing = true). Opting out hides activity notifications and zeroes `unread.activities`. `save-profile` accepts `activityNotifications` as a fourth editable field. Activity notifications are shown only while the activity is still visible and for residents registered before it was published.

## Admin portal

Add an **Activities** section next to **Ads** in the admin portal (`app/community-panels.tsx` / wherever Ads are managed; model a new `app/activities-manager.tsx` on the Ads editor): list with status, create/edit form (all fields, date-time pickers or the same inputs the Ads form uses, image upload), Publish / Archive actions, validation messages. Include `activities.manage` in the admin-access permission picker wherever `classifieds.manage` is listed (labels like "Activities").

## Citizen app (mobile/)

- New bottom tab **Activities** (Hindi **गतिविधियाँ**) placed immediately after **Ads**, key `activities`, icon `calendar-outline` / `calendar`. Six tabs must fit a 375 px phone without clipped labels (shorten labels or adjust the tab layout if needed; keep ≥ 12 px text).
- List screen like Ads: header "Activities" with a one-line caption ("Campaigns and programmes by your Panchayat Samiti and Nagar Parishad."), cards with image, organizer chip (uppercase small label), title, date range, venue, short description, "View details". Empty state when none. Active-language fields (`titleHi` etc. fall back to English).
- Detail screen `activity-detail` (like `ad-detail`): image, organizer, title, full description, date/time range ("Starts ..., ends ..."), venue, optional contact phone (tap to call) and optional link (https, opens externally), back navigation returning to the Activities tab. Tab highlight stays on Activities.
- Home: add an Activities tile to the "Your city, connected" services row.
- Activities tab shows an unread badge (`data.unread.activities`); the inbox has an Activities filter; Profile has an 'Activity notifications' switch (default on).
- Use the existing design system (theme tokens, `cardSurface`, `Text`, `MediaImage` for authenticated images). Follow the Ads screens in `mobile/src/CommunityScreens.tsx` / `CommunityDetail.tsx` for structure.

## Sample data

`scripts/seed-sample-data.mjs` should also add 3 activities (idempotent by title; organizer names real-world generic like "Nagar Parishad, Jaipur (sample)"): e.g. a cleanliness drive, a health/vaccination camp, a tree-plantation drive — with generated placeholder images like the existing ads, published, with `endsAt` in the future.
