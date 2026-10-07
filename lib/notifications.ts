import {visibleClassified, visibleActivity, type Classified, type Activity, type ResidentNotification, type ResidentProfile, type UnreadCounts} from '../shared/community';
import type {Communication, Complaint, Status} from '../shared/domain';
import {FORMER_RESIDENT, isMaskedMobile} from './resident-profile';

/** Pure notification rules (no I/O): creation, per-resident visibility, unread counts, caps and push audiences. */
export type NotificationState = {complaints: Complaint[]; classifieds?: Classified[]; activities?: Activity[]; notifications?: ResidentNotification[]; residentProfiles?: Record<string, ResidentProfile>};

/** Stored notifications are capped so the workspace JSON cannot grow without bound (newest kept). */
export const MAX_NOTIFICATIONS = 500;

export const kindOf = (n: ResidentNotification): 'complaint' | 'classified' | 'activity' => n.kind === 'complaint' ? 'complaint' : n.kind === 'activity' ? 'activity' : 'classified';
/** Activity notifications default to ON: a stored profile that predates the preference (field missing) counts as opted in. */
export const activityOptIn = (p: Pick<ResidentProfile, 'activityNotifications'>) => p.activityNotifications !== false;

const statusHi: Record<Status, string> = {
 'Submitted': 'दर्ज की गई', 'Acknowledged': 'स्वीकार की गई', 'Assigned': 'सौंपी गई', 'In Progress': 'प्रगति पर', 'On Hold': 'रोकी गई',
 'Resolution Proposed': 'समाधान के लिए प्रस्तावित', 'Closed': 'बंद', 'Reopened': 'फिर से खोली गई', 'Rejected / Duplicate': 'अस्वीकृत / डुप्लिकेट',
};

/** The notification a resident receives when ward administration moves their complaint to `c.status`. */
export function complaintNotification(c: Complaint, at: string): ResidentNotification {
 const note = c.history.at(-1)?.note?.trim() ?? '';
 const proposed = c.status === 'Resolution Proposed';
 return {
  id: crypto.randomUUID(), kind: 'complaint', complaintId: c.id, residentId: (c as any).residentId, classifiedId: '', createdAt: at,
  title: `Complaint ${c.id} is now ${c.status}`,
  titleHi: `शिकायत ${c.id} अब ${statusHi[c.status] ?? c.status} है`,
  body: proposed ? 'The work is marked complete. Review it and confirm the closure code in the app only if the issue is resolved.' : (note || 'Ward administration updated your complaint.').slice(0, 180),
  bodyHi: proposed ? 'कार्य पूरा बताया गया है। समस्या हल होने पर ही ऐप में समापन कोड की पुष्टि करें।' : 'वार्ड प्रशासन ने आपकी शिकायत की स्थिति अपडेट की है।',
 };
}

/** Snapshot of every complaint status, taken before an action runs. */
export function statusSnapshot(complaints: Complaint[]): Map<string, Status> {
 return new Map(complaints.map(c => [c.id, c.status]));
}

/**
 * Creates one complaint notification per complaint whose status differs from the snapshot and that belongs to a resident.
 * Only administrator-driven actions notify: a resident who verifies closure or disputes their own complaint is not notified of what they just did.
 */
export function recordStatusChanges(state: NotificationState, before: Map<string, Status>, at: string, actorRole: "admin" | "resident" = "admin"): ResidentNotification[] {
 state.notifications ??= [];
 const created: ResidentNotification[] = [];
 if (actorRole !== "admin") return created;
 for (const c of state.complaints) {
  const previous = before.get(c.id);
  if (previous === undefined || previous === c.status || !(c as any).residentId) continue;
  // A blocked resident gets no notification record or push; the complaint itself keeps moving for the ward office.
  if (state.residentProfiles?.[(c as any).residentId]?.blocked) continue;
  // The complaint of a deleted resident (anonymised, and nobody registered under its resident id) keeps moving for the ward office; there is nobody to notify.
  if (c.resident === FORMER_RESIDENT && !state.residentProfiles?.[(c as any).residentId]) continue;
  created.push(complaintNotification(c, at));
 }
 if (created.length) {state.notifications.unshift(...created); capNotifications(state);}
 return created;
}

/** Keeps the newest MAX_NOTIFICATIONS entries and forgets read markers that no longer point at a stored notification. */
export function capNotifications(state: NotificationState, max = MAX_NOTIFICATIONS) {
 state.notifications ??= [];
 if (state.notifications.length > max) state.notifications.length = max;
 const live = new Set(state.notifications.map(n => n.id));
 for (const p of Object.values(state.residentProfiles ?? {})) if (p.readNotificationIds?.some(id => !live.has(id))) p.readNotificationIds = p.readNotificationIds.filter(id => live.has(id));
}

/**
 * Notifications one resident may see, newest first, with `read` computed for that resident.
 * complaint: only about the resident's own complaints. classified: only while the resident opts in, published after consent, and the ad is still visible.
 * activity: only while the resident has not opted out of activity notifications (default on), published after the resident registered, and the activity is still visible
 * (published and not ended). Opting out hides them; opting in again restores those that are still visible. The classified opt-out never affects activities.
 */
export function residentNotifications(state: NotificationState, profile: ResidentProfile, now = Date.now()): ResidentNotification[] {
 if (profile.blocked) return [];
 const visibleAds = new Set((state.classifieds ?? []).filter(ad => visibleClassified(ad, now)).map(ad => ad.id));
 const visibleActivities = new Set((state.activities ?? []).filter(a => visibleActivity(a, now)).map(a => a.id));
 const read = new Set(profile.readNotificationIds ?? []);
 const show = (n: ResidentNotification) => {
  const kind = kindOf(n);
  if (kind === 'complaint') return !!n.complaintId && !!n.residentId && n.residentId === profile.id;
  if (kind === 'activity') return activityOptIn(profile) && !!profile.registeredAt && n.createdAt >= profile.registeredAt && !!n.activityId && visibleActivities.has(n.activityId);
  return profile.classifiedNotifications && !!profile.notificationConsentAt && n.createdAt >= profile.notificationConsentAt && visibleAds.has(n.classifiedId);
 };
 return (state.notifications ?? [])
  .filter(show)
  .map(n => ({...n, kind: kindOf(n), read: read.has(n.id)}))
  .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function unreadCounts(list: ResidentNotification[]): UnreadCounts {
 const count = (kind: string) => list.filter(n => !n.read && n.kind === kind).length;
 const complaints = count('complaint'), classifieds = count('classified'), activities = count('activity');
 return {complaints, classifieds, activities, total: complaints + classifieds + activities};
}

/** Marks one visible notification (or every visible notification of a kind) read for this resident only. Returns how many were newly marked. */
export function markRead(state: NotificationState, profile: ResidentProfile, id?: unknown, kind?: unknown, now = Date.now()): number {
 if (kind !== undefined && kind !== null && kind !== 'complaint' && kind !== 'classified' && kind !== 'activity') throw new Error('Choose complaint, classified or activity notifications.');
 const visible = residentNotifications(state, profile, now);
 const targets = id !== undefined ? visible.filter(n => n.id === id) : visible.filter(n => !kind || n.kind === kind);
 if (id !== undefined && !targets.length) throw new Error('Notification not found.');
 const ids = targets.filter(n => !n.read).map(n => n.id);
 if (ids.length) profile.readNotificationIds = Array.from(new Set([...(profile.readNotificationIds ?? []), ...ids]));
 return ids.length;
}

/** Residents who should receive a push for a newly published classified: registered, not blocked, opted in, and consent given before publication. */
export function classifiedAudience(state: NotificationState, publishedAt: string): ResidentProfile[] {
 return Object.values(state.residentProfiles ?? {}).filter(p => !!p.registeredAt && !p.blocked && p.classifiedNotifications && !!p.notificationConsentAt && p.notificationConsentAt <= publishedAt);
}

/** Residents who should receive a push for a newly published activity: registered, not blocked, not opted out (default on), and registered before publication. */
export function activityAudience(state: NotificationState, publishedAt: string): ResidentProfile[] {
 return Object.values(state.residentProfiles ?? {}).filter(p => !!p.registeredAt && !p.blocked && activityOptIn(p) && p.registeredAt <= publishedAt);
}

/**
 * The log of messages queued for residents ("Not sent · WhatsApp setup pending") must not address a blocked resident either. Call it after an action with the number of
 * entries the action added (they sit at the front of the list); entries sent to a blocked resident's mobile number are removed, and so are entries addressed to a masked number
 * (the complaint of a deleted resident keeps only '••••••1234'; there is nobody to send to). Returns how many were dropped.
 * Messages to anyone else (for example a department contact) are untouched.
 */
export function dropBlockedCommunications(state: {communications: Communication[]; residentProfiles?: Record<string, ResidentProfile>}, added: number): number {
 if (added <= 0) return 0;
 const blocked = new Set(Object.values(state.residentProfiles ?? {}).filter(p => p.blocked && p.mobile).map(p => p.mobile));
 const fresh = state.communications.slice(0, added), keep = fresh.filter(m => !blocked.has(m.recipient) && !isMaskedMobile(m.recipient));
 if (keep.length !== fresh.length) state.communications.splice(0, added, ...keep);
 return fresh.length - keep.length;
}

/** Android notification channel for a push of this kind (created by the mobile app). */
export const pushChannelFor = (kind: unknown) => kind === 'classified' ? 'classifieds' : kind === 'activity' ? 'activities' : 'complaints';

/** One push per resident, in the resident's language. Complaint pushes go to the complaint's resident whatever their preferences, unless an administrator blocked them. */
export type PushItem = {residentId: string; subject: string; title: string; body: string; data: Record<string, unknown>};
export function pushItemsFor(state: NotificationState, notifications: ResidentNotification[]): PushItem[] {
 const items: PushItem[] = [];
 for (const n of notifications) {
  const kind = kindOf(n);
  const recipients = kind === 'complaint' ? [n.residentId].filter((id): id is string => !!id && !state.residentProfiles?.[id]?.blocked) : (kind === 'activity' ? activityAudience : classifiedAudience)(state, n.createdAt).map(p => p.id);
  for (const id of recipients) {
   const hi = state.residentProfiles?.[id]?.language === 'hi';
   items.push({residentId: id, subject: kind === 'complaint' ? n.complaintId ?? '' : kind === 'activity' ? n.activityId ?? '' : n.classifiedId, title: (hi && n.titleHi ? n.titleHi : n.title).slice(0, 120), body: (hi && n.bodyHi ? n.bodyHi : n.body).slice(0, 180), data: kind === 'complaint' ? {type: 'complaint', kind: 'complaint', complaintId: n.complaintId, notificationId: n.id} : kind === 'activity' ? {type: 'activity', kind: 'activity', activityId: n.activityId, notificationId: n.id} : {type: 'classified', kind: 'classified', classifiedId: n.classifiedId, notificationId: n.id}});
  }
 }
 return items;
}
