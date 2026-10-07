import type {AdminResident, ResidentNotification, ResidentProfile, Ward} from '../shared/community';
import type {Communication, Complaint} from '../shared/domain';
import {ServiceError} from './service';
import {wardLabelOf} from './complaint-wards';
export {wardLabelOf};

/** Pure resident registration and profile rules (no I/O). */
type ProfileState = {residentProfiles?: Record<string, ResidentProfile>; wards?: Ward[]};

const CONTROL = /[\u0000-\u001f\u007f]/;
function field(label: string, v: unknown, min: number, max: number, multiline = false): string {
 const value = typeof v === 'string' ? v.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').trim() : '';
 if (typeof v !== 'string' || (!multiline && value.includes('\n')) || CONTROL.test(value.replace(/\n/g, ' ')) || value.length < min || value.length > max) throw new ServiceError(min ? `${label}: enter ${min}–${max} characters.` : `${label}: use at most ${max} characters.`);
 return value;
}
export const isRegistered = (profile?: ResidentProfile) => !!profile?.registeredAt;
/** What sign-up says while the administrators have not added (or have deactivated) every ward. */
export const NO_WARDS_MESSAGE = 'No wards are available yet. Please try again later or contact the ward office.';

/**
 * Creates the resident profile for `residentId` (derived from the verified mobile). Name 2–80, active ward, optional valid email, address 5–300,
 * a photo that the API layer has already verified was uploaded with this registration, and explicit consent. A mobile registers only once.
 */
export function registerProfile(state: ProfileState, input: any, residentId: string, mobile: string, at: string): ResidentProfile {
 if (!input || typeof input !== 'object') throw new ServiceError('Enter your details.');
 if (isRegistered(state.residentProfiles?.[residentId])) throw new ServiceError('This mobile number is already registered. Log in with an OTP.', 409);
 const name = field('Name', input.name, 2, 80);
 const ward = typeof input.wardId === 'string' ? state.wards?.find(w => w.id === input.wardId && w.active) : undefined;
 if (!ward) throw new ServiceError(state.wards?.some(w => w.active) ? 'Choose your ward.' : NO_WARDS_MESSAGE);
 const email = input.email === undefined || input.email === null ? '' : field('Email', input.email, 0, 150);
 if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ServiceError('Enter a valid email address.');
 const address = field('Address', input.address, 5, 300, true);
 if (typeof input.photoId !== 'string' || !input.photoId.trim() || input.photoId.length > 100) throw new ServiceError('Add your photo.');
 if (input.consent !== true) throw new ServiceError('Please accept the notification and data consent to register.');
 if (input.language !== undefined && input.language !== 'en' && input.language !== 'hi') throw new ServiceError('Invalid language.');
 const profile: ResidentProfile = {id: residentId, name, mobile, email, address, wardId: ward.id, photoId: input.photoId.trim(), language: input.language === 'hi' ? 'hi' : 'en', classifiedNotifications: true, activityNotifications: true, notificationConsentAt: at, readNotificationIds: [], registeredAt: at, updatedAt: at};
 (state.residentProfiles ??= {})[residentId] = profile;
 return profile;
}

const IMMUTABLE: (keyof ResidentProfile)[] = ['id', 'name', 'mobile', 'email', 'address', 'wardId', 'registeredAt', 'notificationConsentAt', 'readNotificationIds', 'updatedAt'];
const EDITABLE = ['photoId', 'classifiedNotifications', 'activityNotifications', 'language'];
/**
 * A registered resident may change only photoId, classifiedNotifications, activityNotifications and language. Echoing an unchanged identity field is tolerated (a client may
 * send its whole profile back); any attempt to change name, mobile, ward, email or address, or to send an unknown field, is rejected with 400.
 * photoId ownership (media uploaded by this resident) is verified by the API layer before this runs.
 */
export function applyProfileUpdate(state: ProfileState, residentId: string, input: any, at: string): ResidentProfile {
 const previous = state.residentProfiles?.[residentId];
 if (!previous || !isRegistered(previous)) throw new ServiceError('Complete your registration first.', 403);
 if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ServiceError('Enter your preferences.');
 for (const key of Object.keys(input)) {
  if (EDITABLE.includes(key)) continue;
  if ((IMMUTABLE as string[]).includes(key) && JSON.stringify(input[key]) === JSON.stringify(previous[key as keyof ResidentProfile])) continue;
  throw new ServiceError(IMMUTABLE.includes(key as keyof ResidentProfile) ? 'Name, mobile number, ward, email and address cannot be changed in the app.' : `Unsupported profile field: ${key.slice(0, 40)}.`);
 }
 const next: ResidentProfile = {...previous, activityNotifications: previous.activityNotifications !== false, updatedAt: at};
 if (input.photoId !== undefined) {
  if (typeof input.photoId !== 'string' || !input.photoId.trim() || input.photoId.length > 100) throw new ServiceError('Choose a valid photo.');
  next.photoId = input.photoId.trim();
 }
 if (input.language !== undefined) {
  if (input.language !== 'en' && input.language !== 'hi') throw new ServiceError('Invalid language.');
  next.language = input.language;
 }
 if (input.classifiedNotifications !== undefined) {
  if (typeof input.classifiedNotifications !== 'boolean') throw new ServiceError('Invalid notification preference.');
  next.classifiedNotifications = input.classifiedNotifications;
  // Turning notifications back on records fresh consent, so only ads published afterwards reach the resident.
  next.notificationConsentAt = input.classifiedNotifications ? (previous.classifiedNotifications && previous.notificationConsentAt ? previous.notificationConsentAt : at) : null;
 }
 if (input.activityNotifications !== undefined) {
  if (typeof input.activityNotifications !== 'boolean') throw new ServiceError('Invalid notification preference.');
  // Independent of the classified preference and of consent: activity notifications simply follow this switch (default on).
  next.activityNotifications = input.activityNotifications;
 }
 state.residentProfiles![residentId] = next;
 return next;
}

/* ---------------------------------------------------------------- administrators: app users (permission residents.manage) */

/** The one message and machine-readable code a blocked resident gets from every resident API path (the mobile app keys on `code`). */
export const ACCOUNT_BLOCKED_MESSAGE = 'Your account has been blocked. Please contact the ward office.';
export const ACCOUNT_BLOCKED_CODE = 'account_blocked';
/** HTTP 403. lib/server.ts apiError() serialises `errorCode` as the JSON field `code`: {error: ACCOUNT_BLOCKED_MESSAGE, code: 'account_blocked'}. */
export class AccountBlockedError extends ServiceError {
 readonly errorCode = ACCOUNT_BLOCKED_CODE;
 constructor() {super(ACCOUNT_BLOCKED_MESSAGE, 403);}
}
export const isBlocked = (profile?: Pick<ResidentProfile, 'blocked'> | null) => !!profile?.blocked;
/** Throws AccountBlockedError when the profile is blocked. Unknown or unregistered profiles pass (the registration rules handle them). */
export function assertNotBlocked(profile?: Pick<ResidentProfile, 'blocked'> | null) {if (isBlocked(profile)) throw new AccountBlockedError();}

type AdminState = ProfileState & {complaints?: Complaint[]};
const hasOwn = (o: object | undefined, key: string) => !!o && Object.prototype.hasOwnProperty.call(o, key);
/** Every registered resident as the admin portal sees them (real mobile number included), newest registration first. */
export function adminResidents(state: AdminState): AdminResident[] {
 const counts = new Map<string, number>();
 for (const c of state.complaints ?? []) {const id = (c as any).residentId; if (typeof id === 'string' && id) counts.set(id, (counts.get(id) ?? 0) + 1);}
 return Object.values(state.residentProfiles ?? {}).filter(isRegistered).map((p): AdminResident => ({
  id: p.id, name: p.name, mobile: p.mobile, email: p.email, address: p.address, wardId: p.wardId, wardLabel: wardLabelOf(state.wards?.find(w => w.id === p.wardId)), photoId: p.photoId, language: p.language,
  classifiedNotifications: !!p.classifiedNotifications, activityNotifications: p.activityNotifications !== false, registeredAt: p.registeredAt,
  blocked: !!p.blocked, blockedAt: p.blocked ? p.blockedAt ?? null : null, blockedReason: p.blocked ? p.blockedReason ?? '' : '', complaintCount: counts.get(p.id) ?? 0,
 })).sort((a, b) => (b.registeredAt ?? '').localeCompare(a.registeredAt ?? '') || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
function registeredProfileOf(state: ProfileState, id: unknown, notFound = 'App user not found.'): ResidentProfile {
 if (typeof id !== 'string' || !id || id.length > 100) throw new ServiceError('Choose an app user.');
 const profile = hasOwn(state.residentProfiles, id) ? state.residentProfiles![id] : undefined;
 if (!profile || !isRegistered(profile)) throw new ServiceError(notFound, 404);
 return profile;
}

/** Complaints in these states are history; every other complaint of a renamed resident shows the new name. */
const FINISHED = ['Closed', 'Rejected / Duplicate'];
const EDITED_FIELDS = ['name', 'email', 'address', 'wardId', 'language', 'classifiedNotifications', 'activityNotifications'] as const;
const FIELD_NAMES: Record<typeof EDITED_FIELDS[number], string> = {name: 'name', email: 'email', address: 'address', wardId: 'ward', language: 'language', classifiedNotifications: 'ad notifications', activityNotifications: 'activity notifications'};
/**
 * An administrator corrects a registered resident's details (action save-resident). Validated like registration: name 2–80, optional valid email, address 5–300,
 * an active ward (or the resident's current one, even if it has since been deactivated), language en|hi, notification preferences true|false.
 * The mobile number is the resident's login and cannot be changed here. registeredAt, photoId, read markers and the blocked state are kept.
 * `email` left out keeps the stored value (null or '' clears it); language and the notification flags left out keep theirs; name, address and wardId are required.
 * Turning ad notifications on records fresh consent now (as the resident doing it in the app would), so only ads published afterwards reach them.
 * Open complaints (anything not Closed or Rejected / Duplicate) of the resident take the new name; finished ones stay as they were filed.
 */
export function applyResidentEdit(state: AdminState, input: any, at: string): {profile: ResidentProfile; changed: string[]; complaintsRenamed: number} {
 if (!input || typeof input !== 'object') throw new ServiceError('Enter the app user details.');
 const previous = registeredProfileOf(state, input.id);
 const name = field('Name', input.name, 2, 80);
 const email = input.email === undefined ? previous.email : input.email === null ? '' : field('Email', input.email, 0, 150);
 if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ServiceError('Enter a valid email address.');
 const address = field('Address', input.address, 5, 300, true);
 const ward = typeof input.wardId === 'string' ? state.wards?.find(w => w.id === input.wardId && (w.active || w.id === previous.wardId)) : undefined;
 if (!ward) throw new ServiceError('Choose an active ward for this app user.');
 if (input.language !== undefined && input.language !== 'en' && input.language !== 'hi') throw new ServiceError('Invalid language.');
 for (const key of ['classifiedNotifications', 'activityNotifications']) if (input[key] !== undefined && typeof input[key] !== 'boolean') throw new ServiceError('Invalid notification preference.');
 if (input.mobile !== undefined && input.mobile !== previous.mobile) throw new ServiceError('The mobile number cannot be changed here: it is how this person signs in.');
 const classified = input.classifiedNotifications === undefined ? previous.classifiedNotifications : input.classifiedNotifications;
 const next: ResidentProfile = {
  ...previous, name, email, address, wardId: ward.id, language: input.language === undefined ? previous.language : input.language,
  classifiedNotifications: classified, activityNotifications: input.activityNotifications === undefined ? previous.activityNotifications !== false : input.activityNotifications, updatedAt: at,
  notificationConsentAt: classified ? (previous.classifiedNotifications && previous.notificationConsentAt ? previous.notificationConsentAt : at) : null,
 };
 const changed = EDITED_FIELDS.filter(key => previous[key] !== next[key] && !(key === 'activityNotifications' && previous.activityNotifications === undefined && next.activityNotifications === true)).map(key => FIELD_NAMES[key]);
 let complaintsRenamed = 0;
 if (name !== previous.name) for (const c of state.complaints ?? []) if ((c as any).residentId === previous.id && !FINISHED.includes(c.status) && c.resident !== name) {c.resident = name; complaintsRenamed++;}
 state.residentProfiles![previous.id] = next;
 return {profile: next, changed, complaintsRenamed};
}

/**
 * An administrator blocks or unblocks a registered resident (action block-resident {id, blocked, reason?}). Blocking needs a reason of 1–200 characters
 * and stores blocked/blockedAt/blockedReason; blocking again only updates the reason (blockedAt stays). Unblocking removes all three fields and ignores `reason`;
 * unblocking someone who is not blocked changes nothing. `changed` tells the caller whether the blocked state itself changed.
 */
export function applyBlock(state: ProfileState, input: any, at: string): {profile: ResidentProfile; blocked: boolean; changed: boolean; reasonChanged: boolean} {
 if (!input || typeof input !== 'object') throw new ServiceError('Choose an app user.');
 const previous = registeredProfileOf(state, input.id);
 if (typeof input.blocked !== 'boolean') throw new ServiceError('Choose whether to block or unblock this app user.');
 if (!input.blocked) {
  if (!previous.blocked) return {profile: previous, blocked: false, changed: false, reasonChanged: false};
  const {blocked: _b, blockedAt: _at, blockedReason: _r, ...rest} = previous;
  const next: ResidentProfile = {...rest, updatedAt: at};
  state.residentProfiles![previous.id] = next;
  return {profile: next, blocked: false, changed: true, reasonChanged: false};
 }
 const reason = typeof input.reason === 'string' ? input.reason.replace(/\s+/g, ' ').trim() : '';
 if (!reason) throw new ServiceError('Enter a reason for blocking this app user.');
 if (reason.length > 200) throw new ServiceError('The reason can be at most 200 characters.');
 if (CONTROL.test(reason)) throw new ServiceError('The reason cannot contain control characters.');
 const already = !!previous.blocked;
 const next: ResidentProfile = {...previous, blocked: true, blockedAt: already ? previous.blockedAt ?? at : at, blockedReason: reason, updatedAt: at};
 state.residentProfiles![previous.id] = next;
 return {profile: next, blocked: true, changed: !already, reasonChanged: already && previous.blockedReason !== reason};
}

/* ---------------------------------------------------------------- administrators: delete an app user (permission residents.manage) */

/** Stands in for a deleted resident's name on the complaints they filed, in the history lines they wrote and in the messages that were addressed to them. */
export const FORMER_RESIDENT = 'Former resident';
/** A mobile number as it is kept once its owner is deleted: only the last four digits ('9876543210' becomes '••••••3210'). Applying it again changes nothing. */
export function maskMobile(mobile: unknown): string {
 const digits = typeof mobile === 'string' || typeof mobile === 'number' ? String(mobile).replace(/\D/g, '') : '';
 return digits.length >= 4 ? `••••••${digits.slice(-4)}` : '••••••';
}
/** True for what maskMobile returns: there is no real number behind it, so nothing can be sent to it. */
export const isMaskedMobile = (value: unknown) => typeof value === 'string' && /^•{6}(\d{4})?$/.test(value);

/** The audit lines a resident writes about themselves, without a complaint or resident reference (see POST /api/resident-auth register and the save-profile action). */
const RESIDENT_AUDIT_LINES = ['Resident registered', 'Resident updated photo or notification preferences'];
type DeleteState = AdminState & {notifications?: ResidentNotification[]; communications?: Communication[]; audit?: {id: string; action: string; actor: string; at: string; complaintId: string}[]};
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The full name as a whole word (so "Ram" is not found inside "Ramesh"), whatever the capitalisation. */
const wholeName = (name: string) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(name)}(?![\\p{L}\\p{N}])`, 'giu');
/** A 10-digit mobile number as people write it in a note: optional +91 / 91 / 0 in front, optional space or hyphen between the digits. */
const mobileInText = (mobile: string) => new RegExp(`(?<!\\d)(?:(?:\\+?91|0)[\\s-]?)?${mobile.split('').join('[\\s-]?')}(?!\\d)`, 'g');

/**
 * An administrator permanently deletes a registered resident (action delete-resident {id}). 404 'Resident not found.' for an unknown or unregistered id (so a second call is a 404 too).
 * Removes the profile (with its read markers, blocked flag and consent) and every complaint notification addressed to the resident. The complaints stay as operational records:
 * `resident` becomes 'Former resident', `mobile` keeps only its last four digits, history lines the resident wrote lose their name, a complaint that never stored its ward keeps the
 * profile's ward, and `residentId` is kept so numbers, wards and history stay intact. Messages in the communication log addressed to the resident's number are masked the same way
 * (the number, and the name where a message mentions it); audit lines that name the resident (the ones filed under their id), the resident's own actions on their complaints and their
 * registration / photo lines lose the name (the last two only while no other registered resident has the same name).
 * The D1 side (sessions, push tokens, the pending OTP, the uploader mark of their uploads) is cleaned up by POST /api/workspace in the same batch that saves this state.
 * The mobile number is free afterwards: registering it again creates a brand-new profile (the resident id is derived from the mobile, so it is the same id, but nothing of the old profile is left).
 */
export function applyResidentDelete(state: DeleteState, input: any): {profile: ResidentProfile; complaints: number; notifications: number; communications: number} {
 if (!input || typeof input !== 'object') throw new ServiceError('Choose an app user.');
 const profile = registeredProfileOf(state, input.id, 'Resident not found.');
 const {id, name, mobile} = profile, digits = (value: unknown) => String(value ?? '').replace(/\D/g, '').slice(-10);
 const phone = /^\d{10}$/.test(mobile) ? mobileInText(mobile) : null, named = name ? wholeName(name) : null;
 const scrub = (text: string, withName = false) => {let out = phone ? text.replace(phone, maskMobile(mobile)) : text; if (withName && named) out = out.replace(named, FORMER_RESIDENT); return out;};
 const owned = new Set<string>(); let complaints = 0;
 for (const c of state.complaints ?? []) {
  if ((c as any).residentId !== id && !(mobile && digits(c.mobile) === mobile)) continue;
  owned.add(c.id); complaints++;
  if (!c.wardId && profile.wardId) c.wardId = profile.wardId; // the ward of a complaint filed before complaints stored one is read from the profile, which is about to go
  c.resident = FORMER_RESIDENT; c.mobile = c.mobile ? maskMobile(c.mobile) : '';
  for (const entry of c.history ?? []) {if (entry.actor === name) entry.actor = FORMER_RESIDENT; if (entry.note) entry.note = scrub(entry.note);}
 }
 const notificationsBefore = state.notifications?.length ?? 0;
 if (state.notifications) state.notifications = state.notifications.filter(n => n.residentId !== id);
 let communications = 0;
 for (const m of state.communications ?? []) {
  const toResident = !!mobile && digits(m.recipient) === mobile;
  if (toResident) {m.recipient = maskMobile(m.recipient); communications++;}
  if (toResident || owned.has(m.complaintId)) {if (typeof m.message === 'string') m.message = scrub(m.message, toResident); if (typeof m.reason === 'string') m.reason = scrub(m.reason, toResident);}
 }
 // The lines the resident filed under their own name without a reference (registering, changing the photo) can only be told apart by the name: they are masked only while no other registered resident has it.
 const nameIsUnique = !Object.values(state.residentProfiles ?? {}).some(p => p.id !== id && p.name === name);
 for (const a of state.audit ?? []) {
  if (a.complaintId === id) a.action = scrub(named ? a.action.replace(named, FORMER_RESIDENT) : a.action);
  else if (a.actor === name && (owned.has(a.complaintId) || (nameIsUnique && !a.complaintId && RESIDENT_AUDIT_LINES.includes(a.action)))) a.actor = FORMER_RESIDENT;
 }
 delete state.residentProfiles![id];
 return {profile, complaints, notifications: notificationsBefore - (state.notifications?.length ?? 0), communications};
}
