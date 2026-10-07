import {defaultProfile, defaultMunicipality, visibleClassified, visibleActivity, type ResidentProfile, type Classified, type Activity, type Place, type Municipality, type ResidentNotification, type Ward} from '../shared/community';
import {resolveAppConfig, seedWorkspace, type Department, type Workspace, type Announcement, type AppConfig} from '../shared/domain';
import type {Viewer} from '../shared/access';
import {applyBlock, applyProfileUpdate, applyResidentDelete, applyResidentEdit, isRegistered} from './resident-profile';
import {capNotifications, kindOf, markRead, residentNotifications, unreadCounts} from './notifications';
import {deleteWard, saveWard, wardOfProfile} from './wards';
import {ServiceError, httpsLink, activeTeamNames, setTeamNames} from './service';
export type CommunityState = {residentProfiles?: Record<string, ResidentProfile>; classifieds?: Classified[]; activities?: Activity[]; places?: Place[]; municipality?: Municipality; notifications?: ResidentNotification[]; wards?: Ward[]};
export function ensureCommunity<T extends CommunityState>(state: T): T {state.residentProfiles ??= {}; state.classifieds ??= []; state.activities ??= []; state.places ??= []; state.notifications ??= []; state.wards ??= []; state.municipality ??= defaultMunicipality(); return state;}

/** The community slice of a workspace as one viewer sees it. `ward`, `notifications` and `unread` follow docs/RESIDENT_AUTH_API.md. */
export function communityView(state: Workspace & CommunityState, residentId: string, viewer: Viewer, resident: boolean, now = Date.now()) {
 ensureCommunity(state);
 const profile = state.residentProfiles![residentId] ?? defaultProfile(residentId);
 const classifieds = resident || !viewer.permissions.includes('classifieds.manage') ? state.classifieds!.filter(ad => visibleClassified(ad, now)) : state.classifieds!;
 // Activities: residents see published, not-yet-ended ones; administrators with activities.manage see every record. Soonest start first.
 const activities = (resident || !viewer.permissions.includes('activities.manage') ? state.activities!.filter(a => visibleActivity(a, now)) : [...state.activities!]).sort((a, b) => +new Date(a.startsAt) - +new Date(b.startsAt));
 const notifications = residentNotifications({complaints: state.complaints, classifieds: state.classifieds, activities: state.activities, notifications: state.notifications, residentProfiles: state.residentProfiles}, profile, now);
 return {
  profile: ownProfile(profile), ward: wardOfProfile(state, profile), unread: unreadCounts(notifications), notifications, classifieds, activities, announcements: announcementsView(state.announcements, !resident && viewer.permissions.includes('announcements.manage'), now),
  places: state.places!.filter(p => !resident && viewer.permissions.includes('city.manage') || p.published).sort((a, b) => a.sortOrder - b.sortOrder),
  municipality: !resident && viewer.permissions.includes('city.manage') || state.municipality!.published ? state.municipality! : defaultMunicipality(),
 };
}
/** A profile as its owner (or a viewing administrator) gets it: the administrator-only block fields never leave the server (admins read them from `residents`). */
function ownProfile(profile: ResidentProfile): ResidentProfile {const {blocked: _blocked, blockedAt: _blockedAt, blockedReason: _blockedReason, ...own} = profile; return {...own, activityNotifications: profile.activityNotifications !== false};}
function field(v: unknown, min = 0, max = 2000, label = '') {if (typeof v !== 'string' || v.trim().length < min || v.length > max) throw new Error(`${label ? `${label}: enter` : 'Enter'} between ${min} and ${max} characters.`); return v.trim();}
/** Optional text: absent means empty; anything else must be a string within the limit. */
function optional(v: unknown, max: number, label: string) {return v === undefined || v === null ? '' : field(v, 0, max, label);}
/** ISO 8601 date or date-time that parses to a real instant. */
function isoDate(v: unknown, label: string) {const value = field(v, 1, 40, label); if (!/^\d{4}-\d{2}-\d{2}/.test(value) || !Number.isFinite(+new Date(value))) throw new Error(`${label} must be a valid date and time.`); return value;}
function url(v: unknown) {const value = field(v, 0, 1000); if (value) {const u = new URL(value); if (u.protocol !== 'https:') throw new Error('Links must use HTTPS.');} return value;}
/** On edit a field the client did not send keeps its stored value (older clients know nothing of the Hindi twins); an explicit empty string clears it. */
function keep(v: unknown, previous: string | undefined, max: number, label: string) {return v === undefined ? previous ?? '' : optional(v, max, label);}

/* ---- Ward updates (announcements) ---- */
export const ANNOUNCEMENT_PRIORITIES = ['Service notice', 'Important', 'Event', 'Emergency'] as const;
/** Residents see a notice while it is published (legacy notices have no status: published) and has not passed its end time. */
export function announcementLive(a: Announcement, now = Date.now()) {return a.status !== 'archived' && (!a.endsAt || +new Date(a.endsAt) > now);}
/** The notices one viewer sees, newest first, always with the Hindi fields and a status. Administrators with announcements.manage see archived and expired ones too. */
export function announcementsView(list: Announcement[] | undefined, manage: boolean, now = Date.now()): Announcement[] {
 return (list ?? []).filter(a => manage || announcementLive(a, now)).map(a => ({...a, titleHi: a.titleHi ?? '', bodyHi: a.bodyHi ?? '', status: a.status ?? 'published'})).sort((a, b) => b.at.localeCompare(a.at));
}

/* ---- App configuration (settings.appConfig) and teams (settings.teams) ---- */
const CONTROL = /[\u0000-\u001f\u007f]/;
const PHONE = /^[0-9+()\-.\s]*$/;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const SEMVER = /^\d{1,5}\.\d{1,5}\.\d{1,5}$/;
function line(v: unknown, min: number, max: number, label: string) {
 if (typeof v !== 'string') throw new Error(`${label}: enter text.`);
 const value = v.trim(); if (CONTROL.test(value) || value.length < min || value.length > max) throw new Error(min ? `${label}: enter ${min}–${max} characters.` : `${label}: use at most ${max} characters.`);
 return value;
}
function flag(v: unknown, label: string) {if (typeof v !== 'boolean') throw new Error(`${label}: choose on or off.`); return v;}
function section(v: unknown, label: string): any {if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`${label}: missing.`); return v;}
function optionalLink(v: unknown, label: string) {
 if (v === undefined || v === null || (typeof v === 'string' && !v.trim())) return '';
 try {return httpsLink(v);} catch {throw new Error(`${label}: enter a link that starts with https:// (no spaces, username or password).`);}
}
/** Validates the whole app configuration and returns the clean copy to store. Every section and flag must be present. */
export function validateAppConfig(input: unknown): AppConfig {
 const c = section(input, 'App settings'); const org = section(c.orgLabel, 'Organisation name'), support = section(c.support, 'Support details'), tabs = section(c.tabs, 'Tabs'), tiles = section(c.tiles, 'Home tiles'), maintenance = section(c.maintenance, 'Maintenance');
 const version = c.minAppVersion === undefined || c.minAppVersion === null ? '' : line(c.minAppVersion, 0, 20, 'Minimum app version');
 if (version && !SEMVER.test(version)) throw new Error('Minimum app version: use the form 1.2.3 or leave it empty.');
 const email = line(support.email ?? '', 0, 120, 'Support email'); if (email && !EMAIL.test(email)) throw new Error('Support email: enter a valid email address.');
 const phone = line(support.phone ?? '', 0, 30, 'Support phone'); if (!PHONE.test(phone)) throw new Error('Support phone: use digits, spaces, + - ( ) only.');
 const enabled = flag(maintenance.enabled, 'Maintenance mode'), messageEn = line(maintenance.messageEn ?? '', 0, 300, 'Maintenance message'), messageHi = line(maintenance.messageHi ?? '', 0, 300, 'Maintenance message (Hindi)');
 if (enabled && messageEn.length < 5) throw new Error('Maintenance message: write what residents should see while maintenance mode is on.');
 return {
  orgLabel: {en: line(org.en, 2, 100, 'Organisation name'), hi: line(org.hi, 2, 100, 'Organisation name (Hindi)')},
  support: {phone, email, hoursEn: line(support.hoursEn ?? '', 0, 200, 'Support hours'), hoursHi: line(support.hoursHi ?? '', 0, 200, 'Support hours (Hindi)')},
  termsUrl: optionalLink(c.termsUrl, 'Terms of use link'), privacyUrl: optionalLink(c.privacyUrl, 'Privacy policy link'),
  tabs: {classifieds: flag(tabs.classifieds, 'Ads tab'), activities: flag(tabs.activities, 'Activities tab'), city: flag(tabs.city, 'City tab')},
  tiles: {classifieds: flag(tiles.classifieds, 'Ads tile'), activities: flag(tiles.activities, 'Activities tile'), city: flag(tiles.city, 'City tile'), notices: flag(tiles.notices, 'Ward updates tile')},
  maintenance: {enabled, messageEn, messageHi}, minAppVersion: version,
 };
}
/** What GET /api/app-config returns before anyone has signed in: configuration only, never resident data. */
export function publicAppConfig(settings?: Partial<Workspace['settings']> | null) {
 const base = seedWorkspace().settings; const s = {...base, ...settings};
 return {appConfig: resolveAppConfig(s.appConfig), ward: s.ward, city: s.city, contact: s.contact};
}
export const MAX_TEAMS = 12;
/** The team names administrators may assign complaints to: the saved list, or the built-in default list until one is saved. */
export const teamsOf = (settings: {teams?: string[]; departments?: Department[]}): string[] => activeTeamNames(settings);
export function validateTeams(input: unknown): string[] {
 if (!Array.isArray(input) || input.length < 1 || input.length > MAX_TEAMS) throw new Error(`Add between 1 and ${MAX_TEAMS} teams.`);
 const seen = new Set<string>(); const names: string[] = [];
 for (const raw of input) {
  if (typeof raw !== 'string') throw new Error('Each team needs a name.');
  const name = raw.replace(/\s+/g, ' ').trim(); if (CONTROL.test(name) || name.length < 2 || name.length > 60) throw new Error('Team names must be 2–60 characters.');
  const key = name.normalize('NFKC').toLocaleLowerCase(); if (seen.has(key)) throw new Error(`The team “${name}” is listed twice.`);
  seen.add(key); names.push(name);
 }
 return names;
}
export function applyCommunityAction(state: Workspace & CommunityState, body: any, residentId: string, actor: string, now = Date.now()): Record<string, unknown> | null {
 ensureCommunity(state); const at = new Date(now).toISOString(); const log = (action: string, id = '') => state.audit.unshift({id: crypto.randomUUID(), action, actor, at, complaintId: id});
 if (body.action === 'save-profile') {
  // Residents may change only photoId, classifiedNotifications and language (lib/resident-profile.ts). Everything else is immutable from the app.
  applyProfileUpdate(state, residentId, body.profile, at);
  log('Resident updated photo or notification preferences'); return {};
 }
 if (body.action === 'read-notification' || body.action === 'read-all-notifications') {
  const profile = state.residentProfiles![residentId];
  if (!profile || !isRegistered(profile)) throw new ServiceError('Complete your registration first.', 403);
  const notificationState = {complaints: state.complaints, classifieds: state.classifieds, activities: state.activities, notifications: state.notifications, residentProfiles: state.residentProfiles};
  if (body.action === 'read-notification') {if (typeof body.id !== 'string') throw new Error('Notification not found.'); markRead(notificationState, profile, body.id, undefined, now);}
  else markRead(notificationState, profile, undefined, body.kind, now);
  return {};
 }
 // App users (permission residents.manage, enforced by POST /api/workspace through actionPermissions). Rules and messages: lib/resident-profile.ts.
 if (body.action === 'save-resident') {
  const {profile, changed, complaintsRenamed} = applyResidentEdit(state, body, at);
  log(`Updated app user ${profile.name}${changed.length ? `: ${changed.join(', ')}` : ' (no changes)'}${complaintsRenamed ? `; name updated on ${complaintsRenamed} open complaint${complaintsRenamed === 1 ? '' : 's'}` : ''}`, profile.id);
  return {id: profile.id};
 }
 if (body.action === 'block-resident') {
  const {profile, blocked, changed, reasonChanged} = applyBlock(state, body, at);
  if (changed || reasonChanged) log(blocked ? `${changed ? 'Blocked' : 'Updated block reason for'} app user ${profile.name}: ${profile.blockedReason}` : `Unblocked app user ${profile.name}`, profile.id);
  return {id: profile.id, blocked, changed};
 }
 // Permanent removal (confirmed in the portal). The audit line names the resident by id only; the sessions, push tokens and OTP in D1 are cleaned up by POST /api/workspace in the same batch that saves this.
 if (body.action === 'delete-resident') {
  const {profile, complaints, notifications} = applyResidentDelete(state, body); capNotifications(state);
  log(`Deleted app user ${profile.id}: ${complaints} complaint${complaints === 1 ? '' : 's'} anonymised, ${notifications} notification${notifications === 1 ? '' : 's'} removed`, profile.id);
  return {id: profile.id, deleted: true};
 }
 if (body.action === 'save-ward') {const ward = saveWard(state, body.ward); log(`Saved ward: ${ward.name}`, ward.id); return {wardId: ward.id};}
 if (body.action === 'delete-ward') {const result = deleteWard(state, body.id); log(result.deactivated ? 'Deactivated ward (residents belong to it)' : 'Deleted ward', result.id); return result;}
 if (body.action === 'save-classified') {
  const ad = body.classified; const previous = ad.id ? state.classifieds!.find(x => x.id === ad.id) : undefined; if (ad.id && !previous) throw new Error('Classified not found.');
  const startsAt = field(ad.startsAt, 1, 40), endsAt = field(ad.endsAt, 1, 40); if (!Number.isFinite(+new Date(startsAt)) || !Number.isFinite(+new Date(endsAt)) || +new Date(endsAt) <= +new Date(startsAt)) throw new Error('End date must be later than the start date.');
  const entry: Classified = {id: previous?.id ?? crypto.randomUUID(), title: field(ad.title, 4, 120), titleHi: field(ad.titleHi, 0, 120), description: field(ad.description, 10, 4000), descriptionHi: field(ad.descriptionHi, 0, 4000), advertiser: field(ad.advertiser, 2, 150), advertiserHi: keep(ad.advertiserHi, previous?.advertiserHi, 150, 'Hindi advertiser'), contactPhone: field(ad.contactPhone, 0, 30), imageId: field(ad.imageId, 0, 100), url: url(ad.url), startsAt, endsAt, status: previous?.status ?? 'draft', publishedAt: previous?.publishedAt ?? null};
  // New ads start as drafts; editing never changes the publication status (use Publish / Archive for that).
  if (previous) state.classifieds![state.classifieds!.indexOf(previous)] = entry; else state.classifieds!.push(entry); log(previous ? `Updated classified (${entry.status})` : 'Saved classified draft', entry.id); return {id: entry.id, status: entry.status};
 }
 if (body.action === 'publish-classified') {
  const ad = state.classifieds!.find(ad => ad.id === body.id); if (!ad) throw new Error('Classified not found.');
  if (!['published', 'archived'].includes(body.status)) throw new Error('Invalid publication status.');
  if (body.status === 'published' && +new Date(ad.endsAt) <= now) throw new Error('This classified has expired. Update its dates before publishing.');
  const notify = body.status === 'published' && !ad.publishedAt; ad.status = body.status; if (body.status === 'published') ad.publishedAt ??= at;
  // One shared notification per classified. Each resident sees it only while opted in and only if consent predates publication (residentNotifications).
  if (notify) {state.notifications!.unshift({id: crypto.randomUUID(), kind: 'classified', classifiedId: ad.id, title: ad.title, titleHi: ad.titleHi, body: `${ad.advertiser}: ${ad.description.slice(0, 180)}`, bodyHi: ad.descriptionHi.slice(0, 180), createdAt: at}); capNotifications(state);}
  if (notify) for (const profile of Object.values(state.residentProfiles!)) if (profile.registeredAt && !profile.blocked && profile.classifiedNotifications) state.communications.unshift({id: crypto.randomUUID(), complaintId: ad.id, template: 'Classified published', channel: 'WhatsApp', recipient: profile.mobile, status: 'Not sent · WhatsApp setup pending', at, reason: 'WhatsApp Business sender and approved templates are not configured.', message: `${ad.title}: ${ad.description.slice(0, 180)}. Open SAMADHAN → Ads for details.`});
  log(`Classified ${body.status}`, ad.id); return {notificationCreated: notify, classifiedId: ad.id};
 }
 // Activities (docs/ACTIVITIES_API.md): campaigns and programmes by the Panchayat Samiti / Nagar Parishad. Same draft → publish → archive flow as ads; the first publication creates one activity notification (no WhatsApp entries).
 if (body.action === 'save-activity') {
  const a = body.activity; if (!a || typeof a !== 'object') throw new Error('Enter the activity details.');
  const previous = a.id ? state.activities!.find(x => x.id === a.id) : undefined; if (a.id && !previous) throw new Error('Activity not found.');
  const startsAt = isoDate(a.startsAt, 'Start date'), endsAt = isoDate(a.endsAt, 'End date'); if (+new Date(endsAt) <= +new Date(startsAt)) throw new Error('End date must be later than the start date.');
  const entry: Activity = {id: previous?.id ?? crypto.randomUUID(), title: field(a.title, 4, 120, 'Title'), titleHi: optional(a.titleHi, 120, 'Hindi title'), description: field(a.description, 10, 4000, 'Description'), descriptionHi: optional(a.descriptionHi, 4000, 'Hindi description'), organizer: field(a.organizer, 2, 150, 'Organizer'), organizerHi: optional(a.organizerHi, 150, 'Hindi organizer'), venue: optional(a.venue, 200, 'Venue'), venueHi: optional(a.venueHi, 200, 'Hindi venue'), startsAt, endsAt, imageId: optional(a.imageId, 100, 'Image'), contactPhone: optional(a.contactPhone, 30, 'Contact phone'), url: url(a.url ?? ''), status: previous?.status ?? 'draft', publishedAt: previous?.publishedAt ?? null};
  // New activities start as drafts; editing never changes the publication status (use Publish / Archive for that).
  if (previous) state.activities![state.activities!.indexOf(previous)] = entry; else state.activities!.push(entry); log(previous ? `Updated activity (${entry.status})` : 'Saved activity draft', entry.id); return {id: entry.id, status: entry.status};
 }
 if (body.action === 'publish-activity') {
  const a = state.activities!.find(x => x.id === body.id); if (!a) throw new Error('Activity not found.');
  if (!['published', 'archived'].includes(body.status)) throw new Error('Invalid publication status.');
  if (body.status === 'published' && +new Date(a.endsAt) <= now) throw new Error('This activity has already ended. Update its dates before publishing.');
  // One shared notification per activity, on its first publication only. Each resident sees it while not opted out and while the activity is still visible (residentNotifications).
  const notify = body.status === 'published' && !a.publishedAt; a.status = body.status; if (body.status === 'published') a.publishedAt ??= at;
  if (notify) {state.notifications!.unshift({id: crypto.randomUUID(), kind: 'activity', activityId: a.id, classifiedId: '', title: a.title, titleHi: a.titleHi, body: `${a.organizer}: ${a.description.slice(0, 180)}`, bodyHi: a.descriptionHi ? `${a.organizerHi || a.organizer}: ${a.descriptionHi.slice(0, 180)}` : '', createdAt: at}); capNotifications(state);}
  log(`Activity ${body.status}`, a.id); return {notificationCreated: notify, activityId: a.id};
 }
 if (body.action === 'save-municipality') {
  const m = body.municipality; if (typeof m.published !== 'boolean') throw new Error('Choose publication status.');
  if (m.published && (!m.sourceUrl || !m.history || !m.about)) throw new Error('Add an overview, history and a source before publishing.');
  state.municipality = {name: field(m.name, 2, 120), nameHi: field(m.nameHi, 0, 120), district: field(m.district, 2, 80), districtHi: keep(m.districtHi, state.municipality?.districtHi, 80, 'Hindi district'), state: field(m.state, 2, 80), stateHi: keep(m.stateHi, state.municipality?.stateHi, 80, 'Hindi state'), about: field(m.about, 0, 6000), aboutHi: field(m.aboutHi, 0, 6000), history: field(m.history, 0, 20000), historyHi: field(m.historyHi, 0, 20000), sourceUrl: url(m.sourceUrl), published: m.published}; log('Municipality information updated'); return {};
 }
 if (body.action === 'save-place') {
  const p = body.place; const previous = p.id ? state.places!.find(x => x.id === p.id) : undefined; if (p.id && !previous) throw new Error('Place not found.');
  if (typeof p.published !== 'boolean' || !Number.isInteger(p.sortOrder) || p.sortOrder < 0) throw new Error('Invalid place visibility or order.');
  const entry: Place = {id: previous?.id ?? crypto.randomUUID(), name: field(p.name, 2, 120), nameHi: field(p.nameHi, 0, 120), description: field(p.description, 10, 6000), descriptionHi: field(p.descriptionHi, 0, 6000), address: field(p.address, 4, 300), addressHi: keep(p.addressHi, previous?.addressHi, 300, 'Hindi address'), hours: field(p.hours, 0, 200), hoursHi: keep(p.hoursHi, previous?.hoursHi, 200, 'Hindi visiting hours'), imageId: field(p.imageId, 0, 100), mapUrl: url(p.mapUrl), sourceUrl: url(p.sourceUrl), published: p.published, sortOrder: p.sortOrder};
  if (previous) state.places![state.places!.indexOf(previous)] = entry; else state.places!.push(entry); log('Visitor place saved', entry.id); return {id: entry.id};
 }
 // Hard deletes (confirmed in the portal): the record and its inbox notifications disappear; uploaded images stay in storage but are no longer referenced, so nobody can read them through content any more.
 if (body.action === 'delete-classified') {
  const ad = state.classifieds!.find(x => x.id === body.id); if (!ad) throw new Error('Classified not found.');
  state.classifieds = state.classifieds!.filter(x => x !== ad); state.notifications = state.notifications!.filter(n => !(kindOf(n) === 'classified' && n.classifiedId === ad.id)); capNotifications(state);
  log(`Deleted classified: ${ad.title}`, ad.id); return {id: ad.id, deleted: true};
 }
 if (body.action === 'delete-activity') {
  const a = state.activities!.find(x => x.id === body.id); if (!a) throw new Error('Activity not found.');
  state.activities = state.activities!.filter(x => x !== a); state.notifications = state.notifications!.filter(n => !(kindOf(n) === 'activity' && n.activityId === a.id)); capNotifications(state);
  log(`Deleted activity: ${a.title}`, a.id); return {id: a.id, deleted: true};
 }
 if (body.action === 'delete-place') {
  const p = state.places!.find(x => x.id === body.id); if (!p) throw new Error('Place not found.');
  state.places = state.places!.filter(x => x !== p); log(`Deleted place: ${p.name}`, p.id); return {id: p.id, deleted: true};
 }
 // Ward updates: editing keeps the notice's original time and publication status unless the form says otherwise; archived and expired notices are hidden from residents.
 if (body.action === 'save-announcement') {
  const a = body.announcement; if (!a || typeof a !== 'object') throw new Error('Enter the notice details.');
  const previous = a.id ? state.announcements.find(x => x.id === a.id) : undefined; if (a.id && !previous) throw new Error('Announcement not found.');
  const priority = a.priority === undefined ? previous?.priority ?? 'Service notice' : a.priority; if (!(ANNOUNCEMENT_PRIORITIES as readonly string[]).includes(priority)) throw new Error('Choose a priority: Service notice, Important, Event or Emergency.');
  const status = a.status === undefined ? previous?.status ?? 'published' : a.status; if (status !== 'published' && status !== 'archived') throw new Error('Choose published or archived.');
  const endsAt = a.endsAt === undefined || a.endsAt === null || a.endsAt === '' ? '' : isoDate(a.endsAt, 'End date');
  if (status === 'published' && endsAt && +new Date(endsAt) <= now) throw new Error('The end time has already passed. Choose a later end time, or archive the notice.');
  const entry: Announcement = {id: previous?.id ?? crypto.randomUUID(), title: field(a.title, 5, 120, 'Title'), titleHi: keep(a.titleHi, previous?.titleHi, 120, 'Hindi title'), body: field(a.body, 10, 2000, 'Notice'), bodyHi: keep(a.bodyHi, previous?.bodyHi, 2000, 'Hindi notice'), priority, at: previous?.at ?? at, ...(endsAt ? {endsAt} : {}), status};
  if (previous) state.announcements[state.announcements.indexOf(previous)] = entry; else state.announcements.unshift(entry);
  log(`${previous ? 'Updated' : 'Published'} ward notice: ${entry.title}${entry.status === 'archived' ? ' (archived)' : ''}`, entry.id); return {id: entry.id, status: entry.status};
 }
 if (body.action === 'delete-announcement') {
  const a = state.announcements.find(x => x.id === body.id); if (!a) throw new Error('Announcement not found.');
  state.announcements = state.announcements.filter(x => x !== a); log(`Deleted ward notice: ${a.title}`, a.id); return {id: a.id, deleted: true};
 }
 if (body.action === 'save-app-config') {
  state.settings.appConfig = validateAppConfig(body.appConfig); log('Updated app settings (tabs, tiles, support, maintenance, versions)'); return {};
 }
 if (body.action === 'save-teams') {
  setTeamNames(state.settings, validateTeams(body.teams)); log(`Updated teams: ${state.settings.teams!.join(', ')}`); return {};
 }
 return null;
}
