import {defaultMunicipality} from '../shared/community';
import {LIVE_CONTENT_VERSION} from '../shared/domain';

/**
 * One-time, version-marked removal of the identifiable seeded TEST content from workspaces stored before go-live.
 * Only records that the old seed or the old "demo community" backfill created are removed, identified exactly by:
 *  - complaints: no residentId AND resident === 'Demo Resident' (the seeded ones, plus their communications and closure challenges)
 *  - announcement id 'notice-1' (the seeded "Water supply maintenance" notice)
 *  - classifieds 'sample-ad-market' | 'sample-ad-skills' | 'sample-ad-garden' (and notifications that point at them)
 *  - places 'sample-place-gate' | 'sample-place-park' | 'sample-place-museum'
 *  - municipality: only the untouched generated "<city> · sample city guide" entry (its name suffix and its 'DEMO CONTENT' overview)
 * Everything else (real or QA-created complaints with a resident id, other ads, notices, admin edits) is left alone.
 *
 * Version 2 (multi-ward product): the old single-ward pilot seeded settings.ward = 'Ward 12', settings.city = 'Jaipur' and a ward-office contact line. Each of those three values is blanked
 * when it STILL holds exactly the old seeded text, and a value an administrator has changed is left alone. Wards themselves are real, admin-managed records and are never touched or re-created.
 * The steps are staged by the stored version: a workspace already at version 1 gets only version 2's step (the purge never runs twice).
 */
export const SEED_CLASSIFIED_IDS = ['sample-ad-market', 'sample-ad-skills', 'sample-ad-garden'];
export const SEED_PLACE_IDS = ['sample-place-gate', 'sample-place-park', 'sample-place-museum'];
export const SEED_ANNOUNCEMENT_IDS = ['notice-1'];
export const SEED_COMPLAINT_RESIDENT = 'Demo Resident';
/** The labels the single-ward pilot seeded into every workspace. A value equal to one of these was never customised. */
export const PILOT_SETTINGS_DEFAULTS = {ward: 'Ward 12', city: 'Jaipur', contact: 'Ward office · Monday–Saturday, 10 AM–5 PM'} as const;

export type PurgeSummary = {complaints: number; communications: number; announcements: number; classifieds: number; places: number; notifications: number; municipality: boolean; /** Pilot default labels blanked by the version 2 step (0 to 3). */ labelsCleared: number};

/**
 * Upgrades `state` in place to LIVE_CONTENT_VERSION. Returns the summary when the upgrade ran, or null when the workspace was already upgraded
 * (so the caller only writes when something changed). Idempotent: a second call is a no-op.
 */
export function upgradeLiveContent(state: any, now = Date.now()): PurgeSummary | null {
 const from = Number.isInteger(state.liveContentVersion) ? state.liveContentVersion as number : 0;
 if (from >= LIVE_CONTENT_VERSION) return null;
 const summary: PurgeSummary = {complaints: 0, communications: 0, announcements: 0, classifieds: 0, places: 0, notifications: 0, municipality: false, labelsCleared: 0};
 if (from < 1) purgeSeededContent(state, summary, now);
 if (from < 2) clearPilotLabels(state, summary, now);
 state.liveContentVersion = LIVE_CONTENT_VERSION;
 return summary;
}

/** Version 2: blanks settings.ward, settings.city and settings.contact where they still hold the old pilot defaults. */
function clearPilotLabels(state: any, summary: PurgeSummary, now: number) {
 const settings = state.settings;
 if (!settings || typeof settings !== 'object') return;
 const cleared: string[] = [];
 for (const key of ['ward', 'city', 'contact'] as const) if (typeof settings[key] === 'string' && settings[key].trim() === PILOT_SETTINGS_DEFAULTS[key]) {settings[key] = ''; cleared.push(key);}
 summary.labelsCleared = cleared.length;
 if (cleared.length && Array.isArray(state.audit)) state.audit.unshift({id: crypto.randomUUID(), action: `Cleared single-ward pilot defaults (live content v2): ${cleared.join(', ')}`, actor: 'System', at: new Date(now).toISOString(), complaintId: ''});
}

/** Version 1: removes the seeded test content (see the file comment) and seeds the structural defaults older workspaces lack. */
function purgeSeededContent(state: any, summary: PurgeSummary, now: number) {
 const complaints: any[] = Array.isArray(state.complaints) ? state.complaints : [];
 const seeded = new Set(complaints.filter(c => !c.residentId && c.resident === SEED_COMPLAINT_RESIDENT).map(c => c.id));
 if (seeded.size) {
  state.complaints = complaints.filter(c => !seeded.has(c.id));
  summary.complaints = seeded.size;
  if (Array.isArray(state.communications)) {const before = state.communications.length; state.communications = state.communications.filter((m: any) => !seeded.has(m.complaintId)); summary.communications = before - state.communications.length;}
  if (state.challenges && typeof state.challenges === 'object') for (const id of seeded) delete state.challenges[id];
 }
 if (Array.isArray(state.announcements)) {const before = state.announcements.length; state.announcements = state.announcements.filter((a: any) => !SEED_ANNOUNCEMENT_IDS.includes(a.id)); summary.announcements = before - state.announcements.length;}
 if (Array.isArray(state.classifieds)) {const before = state.classifieds.length; state.classifieds = state.classifieds.filter((a: any) => !SEED_CLASSIFIED_IDS.includes(a.id)); summary.classifieds = before - state.classifieds.length;}
 if (Array.isArray(state.places)) {const before = state.places.length; state.places = state.places.filter((p: any) => !SEED_PLACE_IDS.includes(p.id)); summary.places = before - state.places.length;}
 if (Array.isArray(state.notifications)) {const before = state.notifications.length; state.notifications = state.notifications.filter((n: any) => !SEED_CLASSIFIED_IDS.includes(n.classifiedId)); summary.notifications = before - state.notifications.length;}
 const m = state.municipality;
 if (m && typeof m.name === 'string' && m.name.endsWith(' · sample city guide') && typeof m.about === 'string' && m.about.startsWith('DEMO CONTENT')) {state.municipality = defaultMunicipality(); summary.municipality = true;}
 // Not test content: structural upgrades that ride on the same marker. Legacy classified notifications get an explicit kind; a workspace stored before wards existed starts with none (administrators add them).
 if (Array.isArray(state.notifications)) for (const n of state.notifications) n.kind ??= 'classified';
 if (!Array.isArray(state.wards)) state.wards = [];
 delete state.demoContentVersion;
 const removed = summary.complaints + summary.communications + summary.announcements + summary.classifieds + summary.places + summary.notifications + (summary.municipality ? 1 : 0);
 if (removed && Array.isArray(state.audit)) state.audit.unshift({id: crypto.randomUUID(), action: `Removed seeded test content (live content v1): ${summary.complaints} complaints, ${summary.announcements} notices, ${summary.classifieds} ads, ${summary.places} places${summary.municipality ? ', sample city guide' : ''}`, actor: 'System', at: new Date(now).toISOString(), complaintId: ''});
}
