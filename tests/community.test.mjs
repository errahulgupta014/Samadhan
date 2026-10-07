import test from 'node:test';
import assert from 'node:assert/strict';
import {buildModules} from './build-ts.mjs';
buildModules(['shared/domain', 'shared/community', 'shared/access', 'lib/service', 'lib/community-service', 'lib/projection', 'lib/access-policy', 'lib/media-access', 'lib/wards', 'lib/complaint-wards', 'lib/notifications', 'lib/resident-otp', 'lib/resident-profile', 'lib/live-content', 'lib/push'], 'tests/.community');
const {seedWorkspace: freshWorkspace, defaultIssueCategories, LIVE_CONTENT_VERSION, defaultAppConfig, resolveAppConfig, teams: defaultTeams} = await import('./.community/domain.mjs');
/** A brand-new workspace has no wards (administrators add them in the portal); most tests need one, so this fixture adds a single ward the way an administrator would. */
const testWard = (over = {}) => ({id: 'ward-12', number: '12', name: 'Ward 12', nameHi: 'वार्ड 12', city: 'Jaipur', memberName: '', memberNameHi: '', memberPhotoId: '', active: true, ...over});
const seedWorkspace = () => ({...freshWorkspace(), wards: [testWard()]});
const {defaultProfile} = await import('./.community/community.mjs');
const {rolePresets, permissions, actionPermissions} = await import('./.community/access.mjs');
const {applyAction, normalizeWorkspace, ServiceError, departmentsOf} = await import('./.community/service.mjs');
const {applyCommunityAction, communityView, ensureCommunity, announcementsView, announcementLive, publicAppConfig, validateAppConfig, validateTeams, teamsOf, MAX_TEAMS} = await import('./.community/community-service.mjs');
const {projectWorkspace} = await import('./.community/projection.mjs');
const {requireAction, validateAdminGrant} = await import('./.community/access-policy.mjs');
const {canReadMedia} = await import('./.community/media-access.mjs');
const {activePublicWards, compareWards, toPublicWard, saveWard, deleteWard} = await import('./.community/wards.mjs');
const {complaintWardOf, withWardInfo, wardLabelOf, ALL_WARDS, NO_WARD, showWardFilter, wardFilterOptions, resolveWardFilter, filterByWard} = await import('./.community/complaint-wards.mjs');
const {recordStatusChanges, statusSnapshot, capNotifications, residentNotifications, unreadCounts, pushItemsFor, pushChannelFor, activityAudience, MAX_NOTIFICATIONS} = await import('./.community/notifications.mjs');
const otp = await import('./.community/resident-otp.mjs');
const {registerProfile} = await import('./.community/resident-profile.mjs');
const {upgradeLiveContent, PILOT_SETTINGS_DEFAULTS} = await import('./.community/live-content.mjs');
const {sendExpoPush, isExpoPushToken, EXPO_PUSH_URL} = await import('./.community/push.mjs');

const viewer = role => ({role, permissions: [...(rolePresets[role] ?? [])], email: 'owner@example.test'});
const who = (role, id = 'one') => ({role: role === 'Resident' ? 'resident' : 'admin', viewer: viewer(role), residentId: id, owner: 'tenant'});
const makeAd = () => ({title: 'Local crafts fair', titleHi: 'स्थानीय हस्तशिल्प मेला', description: 'Discover handmade crafts at the local fair.', descriptionHi: '', advertiser: 'Community centre', contactPhone: '', url: '', imageId: '', startsAt: new Date(Date.now() - 1000).toISOString(), endsAt: new Date(Date.now() + 86400000).toISOString()});
const apply = (s, b, id = 'one', now = Date.now()) => applyCommunityAction(s, b, id, 'test', now);
const iso = ms => new Date(ms).toISOString();
const MOBILES = {one: '9876500001', two: '9876500002', three: '9876500003'};
/** Registers a resident the way POST /api/resident-auth register does (the live workspace has no profile until then). */
const register = (s, id, extra = {}, at = Date.now() - 10000) => registerProfile(s, {name: `Resident ${id}`, wardId: 'ward-12', address: '12 Market Road, Jaipur', photoId: `photo-${id}`, consent: true, ...extra}, id, MOBILES[id] ?? '9999900000', iso(at));
/** A complaint record as the live workflow stores it. */
const complaint = (over = {}) => ({id: 'WC-T-1', title: 'Broken light', description: 'The streetlight is broken.', category: 'Streetlight & Electrical', categoryId: 'streetlights', locality: 'Park Road', lat: 26.9, lng: 75.8, priority: 'Normal', status: 'Submitted', assignee: '', resident: 'Resident one', mobile: MOBILES.one, residentId: 'one', createdAt: iso(1000), dueAt: iso(90000000), history: [{status: 'Submitted', note: 'Complaint submitted.', at: iso(1000), actor: 'Resident one'}], media: [], afterMedia: [], ...over});
const memoryOtpStore = () => {
 const rows = new Map();
 return {rows,
  async get(h) {const r = rows.get(h); return r ? {...r} : null;},
  async put(r) {rows.set(r.mobileHash, {...r});},
  async claimAttempt(h, now) {const r = rows.get(h); if (!r || r.attempts >= otp.OTP_MAX_ATTEMPTS || r.expires <= now) return false; r.attempts++; return true;},
  async consume(h, codeHash) {const r = rows.get(h); if (!r || r.codeHash !== codeHash || r.expires <= 0) return false; r.expires = 0; return true;}};
};
const status = e => e.code;

/* ---------------------------------------------------------------- live content: seed and one-time purge */

test('the seed is configuration only (no wards, no ward, city or contact text), and the demo-content action no longer exists', async () => {
 const s = freshWorkspace();
 assert.deepEqual([s.complaints, s.announcements, s.communications, s.audit], [[], [], [], []]);
 assert.deepEqual(s.wards, [], 'a new workspace contains no ward: administrators add them under Settings'); assert.deepEqual([s.settings.ward, s.settings.city, s.settings.contact], ['', '', '']); assert.equal(s.settings.slaHours, 48);
 assert.equal(JSON.stringify(s).includes('Jaipur') || JSON.stringify(s).includes('Ward 12') || JSON.stringify(s).includes('ward-12'), false);
 assert.equal(s.liveContentVersion, LIVE_CONTENT_VERSION);
 assert.equal(apply(s, {action: 'add-demo-content'}), null, 'community service must not recognise the removed action');
 await assert.rejects(applyAction(s, {action: 'add-demo-content'}, 'admin'), /Unknown action/);
 assert.equal('add-demo-content' in actionPermissions, false);
 assert.equal(ensureCommunity({}).classifieds.length + ensureCommunity({}).places.length, 0);
});

const legacyWorkspace = () => {
 const s = freshWorkspace(); delete s.liveContentVersion; delete s.wards; Object.assign(s.settings, PILOT_SETTINGS_DEFAULTS);
 const ad = id => ({...makeAd(), id, status: 'published', publishedAt: iso(0), imageId: ''});
 const place = id => ({id, name: id, nameHi: '', description: 'x'.repeat(12), descriptionHi: '', address: 'Somewhere road', hours: '', imageId: '', sourceUrl: '', mapUrl: '', published: true, sortOrder: 0});
 s.complaints = [
  complaint({id: 'WC-W12-2026-000184', resident: 'Demo Resident', mobile: '•••••• 2100', residentId: undefined}),
  complaint({id: 'WC-W12-2026-CB84737C', resident: 'Demo Resident', residentId: undefined}),
  complaint({id: 'qa-owned', resident: 'Demo Resident', residentId: 'demo-resident'}),
  complaint({id: 'real-1', resident: 'Asha Verma', residentId: 'res-a'}),
  complaint({id: 'phone-in', resident: 'Walk-in caller', residentId: undefined}),
 ];
 s.communications = [{id: 'm1', complaintId: 'WC-W12-2026-000184', template: 't', channel: 'WhatsApp', recipient: 'r', status: 's', at: iso(0), reason: ''}, {id: 'm2', complaintId: 'real-1', template: 't', channel: 'WhatsApp', recipient: 'r', status: 's', at: iso(0), reason: ''}];
 s.challenges = {'WC-W12-2026-000184': {hash: 'h', expires: 1, attempts: 0, lastSent: 0, demoCode: '111111'}, 'real-1': {hash: 'h2', expires: 1, attempts: 0, lastSent: 0}};
 s.announcements = [{id: 'notice-1', title: 'Water supply maintenance', body: 'Scheduled maintenance', priority: 'Service notice', at: iso(0)}, {id: 'real-notice', title: 'Real notice', body: 'Genuine content', priority: 'Service notice', at: iso(0)}];
 s.classifieds = [ad('sample-ad-market'), ad('sample-ad-skills'), ad('sample-ad-garden'), ad('real-ad')];
 s.places = [place('sample-place-gate'), place('sample-place-park'), place('sample-place-museum'), place('real-place')];
 s.notifications = [{id: 'n-sample', classifiedId: 'sample-ad-market', title: 't', titleHi: '', body: 'b', bodyHi: '', createdAt: iso(0)}, {id: 'n-real', classifiedId: 'real-ad', title: 't', titleHi: '', body: 'b', bodyHi: '', createdAt: iso(0)}];
 s.municipality = {name: 'Jaipur · sample city guide', nameHi: '', district: 'Jaipur', state: 'Rajasthan', about: 'DEMO CONTENT — This page shows how the municipality can introduce its services.', aboutHi: '', history: 'SAMPLE HISTORY', historyHi: '', sourceUrl: '', published: true};
 s.demoContentVersion = 1;
 return s;
};
test('the one-time purge removes only identifiable seeded test records and is marked so it never runs twice', () => {
 const s = legacyWorkspace();
 const summary = upgradeLiveContent(s, 5000);
 assert.deepEqual(summary, {complaints: 2, communications: 1, announcements: 1, classifieds: 3, places: 3, notifications: 1, municipality: true, labelsCleared: 3});
 assert.deepEqual(s.complaints.map(c => c.id), ['qa-owned', 'real-1', 'phone-in'], 'complaints with a resident id or another name are kept');
 assert.deepEqual(s.communications.map(m => m.id), ['m2']);
 assert.deepEqual(Object.keys(s.challenges), ['real-1']);
 assert.deepEqual(s.announcements.map(a => a.id), ['real-notice']);
 assert.deepEqual(s.classifieds.map(a => a.id), ['real-ad']);
 assert.deepEqual(s.places.map(p => p.id), ['real-place']);
 assert.deepEqual(s.notifications.map(n => n.id), ['n-real']);
 assert.equal(s.notifications[0].kind, 'classified', 'legacy notifications gain an explicit kind');
 assert.equal(s.municipality.name, ''); assert.equal(s.municipality.published, false);
 assert.deepEqual(s.wards, [], 'a stored workspace without wards starts with none: no ward is invented');
 assert.deepEqual([s.settings.ward, s.settings.city, s.settings.contact], ['', '', ''], 'the old pilot labels are blanked in the same pass');
 assert.equal(s.liveContentVersion, LIVE_CONTENT_VERSION); assert.equal('demoContentVersion' in s, false);
 assert.equal(s.audit.length, 2); assert.match(s.audit[0].action, /Cleared single-ward pilot defaults/); assert.match(s.audit[1].action, /Removed seeded test content/);
 const snapshot = JSON.stringify(s);
 assert.equal(upgradeLiveContent(s, 6000), null); assert.equal(JSON.stringify(s), snapshot, 'second run changes nothing');
});
test('the purge keeps real city information, and leaves an already-upgraded workspace alone', () => {
 const s = legacyWorkspace(); s.municipality = {...s.municipality, name: 'Jaipur', about: 'The real overview written by the municipality.'};
 upgradeLiveContent(s); assert.equal(s.municipality.name, 'Jaipur'); assert.equal(s.municipality.published, true);
 const live = seedWorkspace(); live.complaints = [complaint({id: 'late', resident: 'Demo Resident', residentId: undefined})]; live.announcements = [{id: 'notice-1', title: 'Created after go-live', body: 'x', priority: 'Service notice', at: iso(0)}];
 assert.equal(upgradeLiveContent(live), null); assert.equal(live.complaints.length, 1); assert.equal(live.announcements.length, 1);
 const bare = {complaints: [], settings: {}}; upgradeLiveContent(bare); assert.deepEqual(bare.wards, [], 'older stored workspaces get an empty ward list, never a default ward'); assert.deepEqual(bare.settings, {}, 'missing labels are not invented');
});

test('version 2: pilot ward, city and contact defaults are blanked once; customised values and the wards themselves are left alone', () => {
 const v1 = () => {const s = freshWorkspace(); s.liveContentVersion = 1; Object.assign(s.settings, PILOT_SETTINGS_DEFAULTS); s.wards = [testWard(), testWard({id: 'ward-7', number: '7', name: 'Ward 7', city: 'Ajmer'})]; s.audit = [{id: 'a0', action: 'Earlier entry', actor: 'x', at: iso(0), complaintId: ''}]; return s;};
 const s = v1(); const wardsBefore = JSON.stringify(s.wards); const summary = upgradeLiveContent(s, 5000);
 assert.deepEqual(summary, {complaints: 0, communications: 0, announcements: 0, classifieds: 0, places: 0, notifications: 0, municipality: false, labelsCleared: 3});
 assert.deepEqual([s.settings.ward, s.settings.city, s.settings.contact], ['', '', '']); assert.equal(s.settings.slaHours, 48);
 assert.equal(JSON.stringify(s.wards), wardsBefore, 'existing wards are real, admin-managed records: kept exactly as they are');
 assert.equal(s.liveContentVersion, LIVE_CONTENT_VERSION); assert.equal(s.audit.length, 2); assert.match(s.audit[0].action, /Cleared single-ward pilot defaults \(live content v2\): ward, city, contact/); assert.equal(s.audit[1].id, 'a0');
 const snapshot = JSON.stringify(s); assert.equal(upgradeLiveContent(s, 6000), null, 'idempotent: a second pass does nothing'); assert.equal(JSON.stringify(s), snapshot);
 // Re-typing the old text afterwards is the administrator's choice and survives (the step never runs twice).
 s.settings.ward = 'Ward 12'; assert.equal(upgradeLiveContent(s), null); assert.equal(s.settings.ward, 'Ward 12');
 // Each value is judged on its own: anything an administrator has changed stays, even by one character.
 const custom = v1(); Object.assign(custom.settings, {ward: 'Ward 12 (North)', city: 'Jaipur', contact: 'Ward office · Monday–Saturday, 10 AM–5 PM '}); upgradeLiveContent(custom);
 assert.deepEqual([custom.settings.ward, custom.settings.city, custom.settings.contact], ['Ward 12 (North)', '', ''], 'the trailing space is ignored, the edited ward label is kept'); assert.match(custom.audit[0].action, /: city, contact$/);
 const mine = v1(); Object.assign(mine.settings, {ward: 'Ward 3', city: 'Ajmer', contact: 'Call the ward office on 0145 2000000'}); assert.equal(upgradeLiveContent(mine).labelsCleared, 0);
 assert.deepEqual(mine.settings, {ward: 'Ward 3', city: 'Ajmer', contact: 'Call the ward office on 0145 2000000', slaHours: 48}); assert.equal(mine.audit.length, 1, 'nothing changed, so nothing is logged'); assert.equal(mine.liveContentVersion, LIVE_CONTENT_VERSION);
 // It only stages the missing step: seeded-looking content created after the v1 purge is not removed by the v2 pass, and an admin who deleted every ward does not get Ward 12 back.
 const later = v1(); later.wards = []; later.announcements = [{id: 'notice-1', title: 'Created after go-live', body: 'x', priority: 'Service notice', at: iso(0)}]; later.complaints = [complaint({id: 'late', resident: 'Demo Resident', residentId: undefined})];
 upgradeLiveContent(later); assert.equal(later.announcements.length, 1); assert.equal(later.complaints.length, 1); assert.deepEqual(later.wards, []);
 assert.deepEqual(ensureCommunity({}).wards, [], 'no default ward is backfilled on read either'); assert.deepEqual(ensureCommunity({wards: []}).wards, []);
 const noSettings = {liveContentVersion: 1, wards: []}; assert.doesNotThrow(() => upgradeLiveContent(noSettings)); assert.equal(noSettings.liveContentVersion, LIVE_CONTENT_VERSION);
});

/* ----------------------------------------------------------------- multi-ward: complaints, ward list and the admin ward filter */

const threeWards = () => [testWard(), testWard({id: 'ward-7', number: '7', name: 'Gandhi Nagar (Ward 7)', city: 'Ajmer'}), testWard({id: 'ward-3', number: '3', name: 'Ward 3', active: false})];

test('registration needs a ward the administrators have added: with none, residents get a friendly message instead of a broken picker', () => {
 const s = freshWorkspace(); ensureCommunity(s);
 const attempt = (state, wardId) => () => registerProfile(state, {name: 'Asha Verma', wardId, address: '12 Market Road', photoId: 'p', consent: true}, 'one', '9876500001', iso(1000));
 assert.throws(attempt(s, 'ward-12'), /No wards are available yet\. Please try again later or contact the ward office\./);
 assert.throws(attempt(s, ''), /No wards are available yet/);
 s.wards = [testWard({active: false})]; assert.throws(attempt(s, 'ward-12'), /No wards are available yet/, 'only inactive wards: nothing to choose');
 s.wards = [testWard()]; assert.throws(attempt(s, 'ward-404'), /Choose your ward/, 'with wards available the message asks to choose one');
 assert.equal(attempt(s, 'ward-12')().wardId, 'ward-12');
 assert.deepEqual(activePublicWards(freshWorkspace().wards), [], 'the public ward list of a new workspace is empty');
});
test('an administrator who deletes every ward does not get one back', () => {
 const s = seedWorkspace(); ensureCommunity(s); assert.deepEqual(deleteWard(s, 'ward-12'), {id: 'ward-12', deactivated: false, deleted: true});
 assert.deepEqual(s.wards, []); ensureCommunity(s); assert.deepEqual(s.wards, [], 'reading the workspace again never re-creates a ward');
 assert.deepEqual(communityView(s, 'one', viewer('Resident'), true).ward, null);
});
test('a complaint belongs to its stored ward, else to the resident profile ward, else to none; the label is computed and never stored', () => {
 const s = seedWorkspace(); s.wards = threeWards(); register(s, 'one', {wardId: 'ward-7'}); register(s, 'two');
 s.complaints.push(
  complaint({id: 'stored', residentId: 'one', wardId: 'ward-3'}), complaint({id: 'derived', residentId: 'one'}), complaint({id: 'other-ward', residentId: 'two'}),
  complaint({id: 'no-profile', residentId: 'ghost'}), complaint({id: 'no-resident', residentId: undefined}), complaint({id: 'proto', residentId: '__proto__'}), complaint({id: 'removed-ward', residentId: 'two', wardId: 'ward-gone'}),
 );
 const rows = withWardInfo(s.complaints, s).map(c => [c.id, c.wardId, c.wardLabel]);
 assert.deepEqual(rows, [['stored', 'ward-3', 'Ward 3'], ['derived', 'ward-7', 'Gandhi Nagar (Ward 7)'], ['other-ward', 'ward-12', 'Ward 12'], ['no-profile', '', ''], ['no-resident', '', ''], ['proto', '', ''], ['removed-ward', '', '']],
  'the stored ward wins (even if it is inactive or the resident has moved); old complaints follow the profile; a ward that no longer exists leaves the complaint without one');
 assert.equal(complaintWardOf(s, s.complaints[0]).name, 'Ward 3'); assert.equal(complaintWardOf(s, s.complaints[3]), undefined);
 assert.equal(s.complaints.some(c => 'wardLabel' in c), false, 'the stored records are untouched'); assert.equal(JSON.stringify(s).includes('wardLabel'), false);
 assert.equal(wardLabelOf({number: '12', name: 'Ward 12'}), 'Ward 12'); assert.equal(wardLabelOf({number: '7', name: 'Rampur'}), 'Ward 7 · Rampur'); assert.equal(wardLabelOf(undefined), '');
});
test('administrators who read complaints get each complaint with its ward id and label; residents and other roles do not', () => {
 const s = seedWorkspace(); s.wards = threeWards(); register(s, 'one', {wardId: 'ward-7'}); register(s, 'two');
 s.complaints.push(complaint({id: 'A', residentId: 'one'}), complaint({id: 'B', residentId: 'two', wardId: 'ward-12'}), complaint({id: 'C', residentId: undefined}));
 for (const role of ['Super Admin', 'Ward Admin', 'Complaint Officer', 'Auditor']) assert.deepEqual(projectWorkspace(s, who(role, 'a'), false).complaints.map(c => [c.id, c.wardId, c.wardLabel]), [['A', 'ward-7', 'Gandhi Nagar (Ward 7)'], ['B', 'ward-12', 'Ward 12'], ['C', '', '']], role);
 for (const role of ['Content Editor', 'Custom']) assert.deepEqual(projectWorkspace(s, who(role, 'a'), false).complaints, [], role);
 const mine = projectWorkspace(s, who('Resident', 'one'), true); assert.deepEqual(mine.complaints.map(c => c.id), ['A']); assert.equal('wardLabel' in mine.complaints[0], false, 'residents are not sent the computed label'); assert.equal('wards' in mine, false);
 // The ward list that rides along never carries member photo ids, whichever permission grants it.
 s.wards[0].memberPhotoId = 'secret-photo';
 for (const role of ['Complaint Officer', 'Auditor']) assert.equal(JSON.stringify(projectWorkspace(s, who(role, 'a'), false)).includes('secret-photo'), false, role);
 assert.equal(JSON.stringify(projectWorkspace(s, who('Ward Admin', 'a'), false)).includes('secret-photo'), true, 'settings.manage still gets the full records for the ward manager');
});
test('ward filter helpers: shown only with two or more wards; options list every ward in numeric order; filtering is by ward id', () => {
 assert.equal(showWardFilter(undefined), false); assert.equal(showWardFilter([]), false); assert.equal(showWardFilter([testWard()]), false); assert.equal(showWardFilter(threeWards()), true);
 const complaints = [{id: 'a', wardId: 'ward-7'}, {id: 'b', wardId: 'ward-12'}, {id: 'c', wardId: 'ward-7'}, {id: 'd', wardId: ''}, {id: 'e'}];
 assert.deepEqual(wardFilterOptions(threeWards(), complaints), [
  {value: ALL_WARDS, label: 'All wards'}, {value: 'ward-3', label: 'Ward 3 (inactive)'}, {value: 'ward-7', label: 'Gandhi Nagar (Ward 7)'}, {value: 'ward-12', label: 'Ward 12'}, {value: NO_WARD, label: 'No ward recorded'},
 ]);
 assert.deepEqual(wardFilterOptions(threeWards(), complaints.slice(0, 3)).map(o => o.value), [ALL_WARDS, 'ward-3', 'ward-7', 'ward-12'], 'No ward recorded appears only when some complaint has none');
 assert.deepEqual(wardFilterOptions([], complaints).map(o => o.value), [ALL_WARDS]); assert.deepEqual(wardFilterOptions(undefined).map(o => o.value), [ALL_WARDS]);
 assert.deepEqual(filterByWard(complaints, ALL_WARDS).map(c => c.id), ['a', 'b', 'c', 'd', 'e']); assert.deepEqual(filterByWard(complaints, undefined).map(c => c.id), ['a', 'b', 'c', 'd', 'e']);
 assert.deepEqual(filterByWard(complaints, 'ward-7').map(c => c.id), ['a', 'c'], 'order is kept'); assert.deepEqual(filterByWard(complaints, 'ward-12').map(c => c.id), ['b']);
 assert.deepEqual(filterByWard(complaints, NO_WARD).map(c => c.id), ['d', 'e']); assert.deepEqual(filterByWard(complaints, 'ward-3'), []); assert.deepEqual(filterByWard([], 'ward-7'), []);
 const options = wardFilterOptions(threeWards(), complaints); assert.equal(resolveWardFilter('ward-7', options), 'ward-7'); assert.equal(resolveWardFilter('ward-deleted', options), ALL_WARDS, 'a ward that no longer exists falls back to All wards'); assert.equal(resolveWardFilter('', options), ALL_WARDS);
 assert.equal(filterByWard(complaints, 'ward-7') !== complaints && filterByWard(complaints, ALL_WARDS) === complaints, true, 'All wards returns the list as it is');
});

/* ------------------------------------------------------------------------------- media access */

test('demo-resident uploader cannot bypass disabled banner visibility; independent readable references still work', () => {
 const s = seedWorkspace(); const resident = who('Resident', 'demo-resident');
 s.settings.brandingBanners = [{id: 'hidden', imageId: 'owner-art', title: 'Hidden', enabled: false}];
 assert.equal(canReadMedia(s, resident, 'owner-art', 'demo-resident'), false);
 assert.equal(canReadMedia(s, who('Content Editor', 'demo-resident'), 'owner-art', 'demo-resident'), false);
 assert.equal(canReadMedia(s, who('Super Admin', 'demo-resident'), 'owner-art', 'demo-resident'), true);
 assert.equal(canReadMedia(s, resident, 'unattached-own-upload', 'demo-resident'), true);
 s.settings.brandingBanners.push({id: 'visible', imageId: 'owner-art', title: 'Visible elsewhere', enabled: true}); assert.equal(canReadMedia(s, resident, 'owner-art', 'demo-resident'), true);
 s.settings.brandingBanners.pop(); s.settings.splashImageId = 'owner-art'; assert.equal(canReadMedia(s, resident, 'owner-art', 'demo-resident'), true);
 delete s.settings.splashImageId; s.complaints.push(complaint({media: ['owner-art'], residentId: 'another-resident'}));
 assert.equal(canReadMedia(s, resident, 'owner-art', 'demo-resident'), false);
 s.complaints[0].residentId = 'demo-resident'; assert.equal(canReadMedia(s, resident, 'owner-art', 'demo-resident'), true);
});
test('the uploader shortcut never exposes draft ads, unpublished places, ward photos or other residents evidence', () => {
 const s = seedWorkspace(); const resident = who('Resident', 'res-a');
 s.classifieds = [{...makeAd(), id: 'draft', imageId: 'draft-art', status: 'draft', publishedAt: null}]; s.places = [{id: 'p', published: false, sortOrder: 0, imageId: 'place-art'}];
 s.wards[0].memberPhotoId = 'ward-photo'; s.complaints.push(complaint({media: ['evidence'], residentId: 'res-b'}));
 for (const id of ['draft-art', 'place-art', 'evidence']) assert.equal(canReadMedia(s, resident, id, 'res-a'), false, id + ' is referenced by hidden content');
 assert.equal(canReadMedia(s, who('Content Editor'), 'draft-art', 'x'), true); assert.equal(canReadMedia(s, who('Content Editor'), 'place-art', 'x'), true);
 assert.equal(canReadMedia(s, resident, 'free-upload', 'res-a'), true); assert.equal(canReadMedia(s, resident, 'free-upload', 'res-b'), false);
 assert.equal(canReadMedia(s, resident, 'ward-photo', 'admin'), true, 'active ward photos are public');
 s.wards[0].active = false; assert.equal(canReadMedia(s, resident, 'ward-photo', 'admin'), false); assert.equal(canReadMedia(s, who('Ward Admin', 'admin'), 'ward-photo', 'admin'), true);
});
test('unpublished media and other residents evidence cannot be accessed by guessing an id', () => {
 const s = seedWorkspace(); s.complaints.push(complaint({residentId: 'two', media: ['secret']})); s.classifieds = [{...makeAd(), id: 'a', imageId: 'draft-photo', status: 'draft'}];
 assert.equal(canReadMedia(s, who('Resident'), 'secret', 'two'), false); assert.equal(canReadMedia(s, who('Content Editor'), 'secret', 'two'), false); assert.equal(canReadMedia(s, who('Complaint Officer'), 'secret', 'two'), true);
 assert.equal(canReadMedia(s, who('Resident'), 'draft-photo', 'staff'), false); assert.equal(canReadMedia(s, who('Content Editor'), 'draft-photo', 'staff'), true); assert.equal(canReadMedia(s, who('Resident'), 'own-upload', 'one'), true);
});

/* ------------------------------------------------------------------------------------ banners */

test('banner publication is permission controlled and validates the complete list atomically', async () => {
 const s = seedWorkspace(); const banners = [{id: 'first', imageId: 'image-one', title: 'Community branding', enabled: true}, {id: 'second', imageId: 'image-two', title: 'Hidden artwork', enabled: false}];
 assert.equal(actionPermissions['save-banners'], 'settings.manage');
 await assert.rejects(applyAction(s, {action: 'save-banners', banners}, 'resident'), e => e.code === 403);
 await applyAction(s, {action: 'save-banners', banners}, 'admin'); assert.deepEqual(s.settings.brandingBanners, banners);
 for (const invalid of [[...banners, banners[0]], Array(6).fill(banners[0]), [{...banners[0], title: ''}], [{...banners[0], enabled: 'yes'}], [{...banners[0], imageId: ''}]]) {await assert.rejects(applyAction(s, {action: 'save-banners', banners: invalid}, 'admin')); assert.deepEqual(s.settings.brandingBanners, banners);}
 await applyAction(s, {action: 'save-banners', banners: []}, 'admin'); assert.deepEqual(s.settings.brandingBanners, []);
 await applyAction(s, {action: 'save-banners', restoreDefault: true}, 'admin'); assert.equal(s.settings.brandingBanners, undefined);
});
test('residents see enabled banners in saved order and cannot read hidden banner media', async () => {
 const s = seedWorkspace(); await applyAction(s, {action: 'save-banners', banners: [{id: 'b', imageId: 'visible-b', title: 'Second image first', enabled: true}, {id: 'a', imageId: 'hidden-a', title: 'Hidden', enabled: false}, {id: 'c', imageId: 'visible-c', title: 'Last', enabled: true}]}, 'admin');
 const copy = JSON.parse(JSON.stringify(s));
 assert.deepEqual(projectWorkspace(copy, who('Resident'), true).settings.brandingBanners.map(b => b.id), ['b', 'c']); assert.equal(projectWorkspace(copy, who('Super Admin'), false).settings.brandingBanners.length, 3);
 assert.equal(canReadMedia(copy, who('Resident'), 'visible-b', 'staff'), true); assert.equal(canReadMedia(copy, who('Resident'), 'hidden-a', 'staff'), false); assert.equal(canReadMedia(copy, who('Super Admin'), 'hidden-a', 'staff'), true);
});
test('banner caption and https call-to-action link are optional, trimmed, validated and shown to residents only when enabled', async () => {
 const s = seedWorkspace(); const base = {id: 'cta', imageId: 'image-cta', title: 'Internal label', enabled: true};
 await applyAction(s, {action: 'save-banners', banners: [{...base, caption: '  Meet your candidate  ', linkUrl: ' https://example.org/campaign?utm_source=samadhan '}, {id: 'blank', imageId: 'image-two', title: 'No extras', enabled: true, caption: '   ', linkUrl: null}, {id: 'hidden', imageId: 'image-three', title: 'Hidden', enabled: false, caption: 'Hidden caption', linkUrl: 'https://example.org/hidden'}]}, 'admin');
 assert.deepEqual(s.settings.brandingBanners[0], {...base, caption: 'Meet your candidate', linkUrl: 'https://example.org/campaign?utm_source=samadhan'});
 assert.deepEqual(s.settings.brandingBanners[1], {id: 'blank', imageId: 'image-two', title: 'No extras', enabled: true});
 const before = JSON.parse(JSON.stringify(s.settings.brandingBanners));
 for (const linkUrl of ['http://example.org', 'javascript:alert(1)', 'data:text/html,hi', 'ftp://example.org/file', '//example.org', 'example.org', 'https://user:secret@example.org', 'https://exa mple.org', 'https://', 'https://example.org/' + 'a'.repeat(1000), 42, {}, []]) {await assert.rejects(applyAction(s, {action: 'save-banners', banners: [{...base, linkUrl}]}, 'admin'), e => e.code === 400, `link ${String(linkUrl).slice(0, 40)} must be rejected`); assert.deepEqual(s.settings.brandingBanners, before);}
 for (const caption of ['x'.repeat(141), 7, {}]) {await assert.rejects(applyAction(s, {action: 'save-banners', banners: [{...base, caption}]}, 'admin'), e => e.code === 400); assert.deepEqual(s.settings.brandingBanners, before);}
 const visible = projectWorkspace(JSON.parse(JSON.stringify(s)), who('Resident'), true).settings.brandingBanners;
 assert.deepEqual(visible.map(b => b.id), ['cta', 'blank']); assert.equal(visible[0].linkUrl, 'https://example.org/campaign?utm_source=samadhan'); assert.equal(visible[0].caption, 'Meet your candidate'); assert.equal(JSON.stringify(visible).includes('hidden'), false);
});

/* ----------------------------------------------------------------------------- admin policy */

test('server policy denies every administrative action for residents; content and auditor roles stay scoped', () => {
 for (const p of Object.values(actionPermissions)) assert.throws(() => requireAction(viewer('Resident'), p), e => e.code === 403);
 assert.doesNotThrow(() => requireAction(viewer('Content Editor'), 'classifieds.manage'));
 for (const role of ['Content Editor', 'Auditor', 'Complaint Officer', 'Ward Admin']) assert.throws(() => requireAction(viewer(role), 'admins.manage'));
 assert.throws(() => requireAction(viewer('Auditor'), 'complaints.manage'));
 for (const p of permissions) assert.doesNotThrow(() => requireAction(viewer('Super Admin'), p));
});
test('Super Admin grant validates role, custom permissions and protects founder/self', () => {
 const v = viewer('Super Admin'); const base = {email: 'member@example.test', role: 'Custom', permissions: ['city.manage'], active: true};
 assert.deepEqual(validateAdminGrant(v, v.email, base).permissions, ['city.manage']);
 assert.throws(() => validateAdminGrant(viewer('Ward Admin'), v.email, base)); assert.throws(() => validateAdminGrant(v, v.email, {...base, email: v.email}));
 assert.throws(() => validateAdminGrant(v, v.email, {...base, permissions: ['admins.manage']})); assert.throws(() => validateAdminGrant(v, v.email, {...base, permissions: ['imaginary']})); assert.throws(() => validateAdminGrant(v, v.email, {...base, permissions: ['complaints.manage']}));
 assert.deepEqual(validateAdminGrant(v, v.email, {...base, role: 'Auditor', permissions}).permissions, rolePresets.Auditor);
});

/* ------------------------------------------------------------------------------- resident OTP */

test('test OTP mode: one named switch, default code 123456, configurable, never returned and never stored', async () => {
 assert.deepEqual(otp.residentOtpMode({}), {mode: 'test', code: '123456'});
 assert.deepEqual(otp.residentOtpMode({OTP_PROVIDER: 'test', RESIDENT_TEST_OTP: '654321'}), {mode: 'test', code: '654321'});
 assert.deepEqual(otp.residentOtpMode({RESIDENT_TEST_OTP: '12ab'}), {mode: 'test', code: '123456'}, 'a malformed test code falls back to the default');
 assert.deepEqual(otp.residentOtpMode({OTP_PROVIDER: 'acme-sms'}), {mode: 'provider', provider: 'acme-sms'});
 const store = memoryOtpStore(), t0 = 1_000_000;
 const sent = await otp.sendOtp(store, '9876543210', t0, {});
 assert.deepEqual(sent, {ok: true, expiresIn: 300, retryAfter: 60});
 assert.equal(JSON.stringify(sent).includes('123456'), false);
 const stored = JSON.stringify([...store.rows.values()]); assert.equal(stored.includes('123456'), false); assert.equal(stored.includes('9876543210'), false);
 const verified = await otp.verifyOtp(store, '9876543210', '123456', t0 + 1000); assert.match(verified.mobileHash, /^[0-9a-f]{64}$/);
 const custom = memoryOtpStore(); await otp.sendOtp(custom, '9876543210', t0, {RESIDENT_TEST_OTP: '654321'});
 await assert.rejects(otp.verifyOtp(custom, '9876543210', '123456', t0 + 1), e => status(e) === 400 && /Incorrect/.test(e.message));
 await otp.verifyOtp(custom, '9876543210', '654321', t0 + 2);
});
test('real provider mode generates a random code, delivers it, and refuses to run without an implementation', async () => {
 const store = memoryOtpStore(), seen = []; const deliver = async (provider, mobile, code) => {seen.push({provider, mobile, code});};
 await otp.sendOtp(store, '9876543210', 5000, {OTP_PROVIDER: 'acme-sms'}, deliver);
 assert.equal(seen.length, 1); assert.equal(seen[0].provider, 'acme-sms'); assert.equal(seen[0].mobile, '9876543210'); assert.match(seen[0].code, /^\d{6}$/);
 await assert.rejects(otp.verifyOtp(store, '9876543210', seen[0].code === '123456' ? '123457' : '123456', 5100), /Incorrect/);
 await otp.verifyOtp(store, '9876543210', seen[0].code, 5200);
 const none = memoryOtpStore();
 await assert.rejects(otp.sendOtp(none, '9876543210', 1, {OTP_PROVIDER: 'acme-sms'}), e => status(e) === 503);
 assert.equal(none.rows.size, 0, 'nothing is stored when delivery is impossible');
});
test('OTP expires after five minutes and cannot be replayed', async () => {
 const store = memoryOtpStore(); await otp.sendOtp(store, '9876543210', 0, {});
 await assert.rejects(otp.verifyOtp(store, '9876543210', '123456', 300_000), e => status(e) === 400 && /expired/.test(e.message));
 await otp.sendOtp(store, '9876543210', 400_000, {});
 await otp.verifyOtp(store, '9876543210', '123456', 400_000 + 299_999);
 await assert.rejects(otp.verifyOtp(store, '9876543210', '123456', 400_000 + 299_999), e => status(e) === 400, 'a spent code cannot be used again');
 await assert.rejects(otp.verifyOtp(memoryOtpStore(), '9876543210', '123456', 1), e => status(e) === 400, 'verifying without a challenge fails like an expired one');
});
test('five wrong codes lock the challenge, even against the correct code; a new code after the cooldown starts fresh', async () => {
 const store = memoryOtpStore(); await otp.sendOtp(store, '9876543210', 0, {});
 for (let i = 1; i <= 4; i++) await assert.rejects(otp.verifyOtp(store, '9876543210', '000000', 1000 * i), e => status(e) === 400 && e.message.includes(`${5 - i} attempts left`));
 await assert.rejects(otp.verifyOtp(store, '9876543210', '000000', 5000), e => status(e) === 429);
 await assert.rejects(otp.verifyOtp(store, '9876543210', '123456', 6000), e => status(e) === 429, 'the correct code no longer works');
 await otp.sendOtp(store, '9876543210', 61_000, {});
 await otp.verifyOtp(store, '9876543210', '123456', 62_000);
});
test('malformed codes are rejected without costing an attempt', async () => {
 const store = memoryOtpStore(); await otp.sendOtp(store, '9876543210', 0, {});
 for (const code of ['', 'abc', '12345', '1234567', 123456, null, undefined, {}]) await assert.rejects(otp.verifyOtp(store, '9876543210', code, 10), e => status(e) === 400);
 assert.equal([...store.rows.values()][0].attempts, 0);
});
test('resend cooldown is 60 seconds with a Retry-After; at most five codes per mobile per hour', async () => {
 const store = memoryOtpStore(); await otp.sendOtp(store, '9876543210', 0, {});
 await assert.rejects(otp.sendOtp(store, '9876543210', 59_999, {}), e => status(e) === 429 && e.retryAfter >= 1 && e.retryAfter <= 60);
 await otp.sendOtp(store, '9876543210', 60_000, {});
 const limited = memoryOtpStore();
 for (let i = 0; i < 5; i++) await otp.sendOtp(limited, '9876543210', i * 60_000, {OTP_PROVIDER: 'acme-sms'}, async () => {});
 await assert.rejects(otp.sendOtp(limited, '9876543210', 300_000, {OTP_PROVIDER: 'acme-sms'}, async () => {}), e => status(e) === 429 && e.retryAfter > 3000);
 await otp.sendOtp(limited, '9876543210', 3_600_001, {OTP_PROVIDER: 'acme-sms'}, async () => {});
 for (let i = 2; i < 12; i++) await otp.sendOtp(store, '9876543210', i * 60_000, {}); // test OTP mode sends nothing, so it has no hourly cap
 const other = memoryOtpStore(); await otp.sendOtp(other, '9876543210', 0, {}); await otp.sendOtp(other, '9876543211', 1, {});
});
test('mobile numbers are normalised to ten digits and the resident id is derived from the number only', async () => {
 for (const raw of ['9876543210', '98765 43210', '+91 98765 43210', '+919876543210', '09876543210', '919876543210', '98765-43210', ' 9876543210 ', 9876543210]) assert.equal(otp.normalizeMobile(raw), '9876543210', String(raw));
 for (const raw of ['5876543210', '987654321', '98765432100', 'abcdefghij', '', null, undefined, {}, [], '+1 9876543210', '9876543210; DROP', '0'.repeat(30)]) assert.throws(() => otp.normalizeMobile(raw), e => status(e) === 400, String(raw));
 const a = await otp.residentIdOf('9876543210'), b = await otp.residentIdOf('9876543211');
 assert.match(a, /^res-[0-9a-f]{24}$/); assert.equal(a, await otp.residentIdOf('9876543210')); assert.notEqual(a, b); assert.equal(a.includes('9876543210'), false);
 assert.notEqual(await otp.mobileHashOf('9876543210'), '9876543210');
});

/* ------------------------------------------------------------------ registration and profile */

test('registration validates every field and creates a consented profile once per mobile', () => {
 const s = seedWorkspace(); const at = iso(1_000_000);
 const good = {name: '  Asha   Verma ', wardId: 'ward-12', email: 'asha@example.org', address: '12 Market Road, Jaipur', photoId: 'photo-1', consent: true};
 const invalid = {'short name': {name: 'A'}, 'long name': {name: 'x'.repeat(81)}, 'control char name': {name: 'Asha\u0007'}, 'newline name': {name: 'Asha\nVerma'}, 'missing ward': {wardId: undefined}, 'unknown ward': {wardId: 'ward-99'}, 'bad email': {email: 'not-an-email'}, 'long email': {email: 'a'.repeat(150) + '@x.in'}, 'short address': {address: 'Rd'}, 'long address': {address: 'x'.repeat(301)}, 'no address': {address: undefined}, 'no photo': {photoId: ''}, 'photo not a string': {photoId: 5}, 'no consent': {consent: undefined}, 'consent false': {consent: false}, 'consent string': {consent: 'true'}, 'bad language': {language: 'fr'}};
 for (const [label, patch] of Object.entries(invalid)) assert.throws(() => registerProfile(s, {...good, ...patch}, 'res-a', '9876543210', at), e => status(e) === 400, label);
 assert.throws(() => registerProfile(s, null, 'res-a', '9876543210', at), e => status(e) === 400);
 assert.deepEqual(s.residentProfiles ?? {}, {}, 'a rejected registration leaves no profile behind');
 const p = registerProfile(s, good, 'res-a', '9876543210', at);
 assert.deepEqual(p, {id: 'res-a', name: 'Asha Verma', mobile: '9876543210', email: 'asha@example.org', address: '12 Market Road, Jaipur', wardId: 'ward-12', photoId: 'photo-1', language: 'en', classifiedNotifications: true, activityNotifications: true, notificationConsentAt: at, readNotificationIds: [], registeredAt: at, updatedAt: at});
 assert.throws(() => registerProfile(s, good, 'res-a', '9876543210', at), e => status(e) === 409, 'a mobile registers only once');
 assert.equal(registerProfile(s, {...good, email: undefined, address: 'Line one\r\nLine two', language: 'hi'}, 'res-b', '9876543211', at).language, 'hi');
 assert.equal(s.residentProfiles['res-b'].email, ''); assert.equal(s.residentProfiles['res-b'].address, 'Line one\nLine two');
 s.wards[0].active = false; assert.throws(() => registerProfile(s, good, 'res-c', '9876543212', at), /ward/i, 'an inactive ward cannot be chosen');
});
test('after registration only photo, classified and activity preferences and language can change', () => {
 const s = seedWorkspace(); const profile = register(s, 'one', {email: 'one@example.org'}, 1_000_000);
 const rejected = {name: 'Someone Else', mobile: '9000000000', email: 'new@example.org', address: 'Another address entirely', wardId: 'ward-99', id: 'res-evil', registeredAt: iso(5), notificationConsentAt: iso(5), readNotificationIds: ['x'], updatedAt: iso(5)};
 for (const [key, value] of Object.entries(rejected)) {assert.throws(() => apply(s, {action: 'save-profile', profile: {[key]: value}}), e => status(e) === 400, key); assert.throws(() => apply(s, {action: 'save-profile', profile: {language: 'hi', [key]: value}}), e => status(e) === 400, key + ' alongside an allowed field'); assert.equal(s.residentProfiles.one.language, 'en', 'a rejected request changes nothing');}
 assert.throws(() => apply(s, {action: 'save-profile', profile: {nickname: 'x'}}), /Unsupported/); assert.throws(() => apply(s, {action: 'save-profile', profile: 'name'}));
 apply(s, {action: 'save-profile', profile: {...profile}}); // a client may echo the whole unchanged profile back
 for (const bad of [{language: 'fr'}, {classifiedNotifications: 'yes'}, {activityNotifications: 'yes'}, {activityNotifications: 0}, {photoId: ''}, {photoId: 7}]) assert.throws(() => apply(s, {action: 'save-profile', profile: bad}), e => status(e) === 400, JSON.stringify(bad));
 apply(s, {action: 'save-profile', profile: {photoId: 'new-photo', language: 'hi', classifiedNotifications: false}});
 const saved = s.residentProfiles.one; assert.equal(saved.photoId, 'new-photo'); assert.equal(saved.language, 'hi'); assert.equal(saved.classifiedNotifications, false); assert.equal(saved.notificationConsentAt, null);
 assert.deepEqual([saved.name, saved.mobile, saved.email, saved.address, saved.wardId, saved.registeredAt], [profile.name, profile.mobile, 'one@example.org', profile.address, 'ward-12', profile.registeredAt]);
 const out = projectWorkspace(s, who('Resident'), true); assert.equal('residentProfiles' in out, false); assert.equal(out.profile.language, 'hi');
});
test('an unregistered caller cannot save a profile or read notifications, so no profile appears from nowhere', () => {
 const s = seedWorkspace();
 for (const action of [{action: 'save-profile', profile: {language: 'hi'}}, {action: 'read-notification', id: 'x'}, {action: 'read-all-notifications'}]) assert.throws(() => apply(s, action, 'demo-resident'), e => status(e) === 403, action.action);
 assert.deepEqual(s.residentProfiles, {});
 assert.equal(communityView(s, 'demo-resident', viewer('Resident'), true).profile.registeredAt, null);
});

/* ---------------------------------------------------------------------------------------- wards */

test('wards: admin validation, numeric ordering, deactivate-if-referenced, and the public shape hides media ids', () => {
 const s = seedWorkspace(); const form = {number: '7', name: 'Ward 7', nameHi: 'वार्ड 7', city: 'Jaipur', memberName: 'A. Member', memberNameHi: 'ए. सदस्य', memberPhotoId: 'photo-7', active: true};
 assert.equal(actionPermissions['save-ward'], 'settings.manage'); assert.equal(actionPermissions['delete-ward'], 'settings.manage');
 const {wardId} = apply(s, {action: 'save-ward', ward: form}); assert.match(wardId, /\S/);
 saveWard(s, {...form, number: '100', name: 'Ward 100', memberPhotoId: ''}); saveWard(s, {...form, number: '9A', name: 'Ward 9A', memberPhotoId: ''}); saveWard(s, {...form, number: '8', name: 'Hidden', active: false, memberPhotoId: ''});
 assert.deepEqual(activePublicWards(s.wards).map(w => w.number), ['7', '9A', '12', '100'], 'ordered by leading number, then text; inactive wards are not offered');
 const publicWard = activePublicWards(s.wards)[0]; assert.deepEqual(Object.keys(publicWard).sort(), ['city', 'id', 'memberName', 'memberNameHi', 'memberPhotoUrl', 'name', 'nameHi', 'number']);
 assert.equal(publicWard.memberPhotoUrl, `/api/wards/photo?id=${wardId}`); assert.equal(activePublicWards(s.wards).find(w => w.number === '12').memberPhotoUrl, null); assert.equal(JSON.stringify(activePublicWards(s.wards)).includes('photo-7'), false);
 assert.equal(toPublicWard({...s.wards[0], nameHi: '', memberName: 'X', memberNameHi: ''}).nameHi, s.wards[0].name, 'Hindi falls back to English');
 assert.ok(compareWards({number: '2', name: 'b'}, {number: '10', name: 'a'}) < 0);
 const invalid = {'no number': {number: ''}, 'long number': {number: '1234567890A'}, 'symbol number': {number: '7#'}, 'duplicate number': {number: '12'}, 'short name': {name: 'W'}, 'no city': {city: ''}, 'long member': {memberName: 'x'.repeat(81)}, 'no active flag': {active: undefined}, 'bad photo': {memberPhotoId: 42}, 'control chars': {name: 'Ward\u0000'}};
 for (const [label, patch] of Object.entries(invalid)) assert.throws(() => apply(s, {action: 'save-ward', ward: {...form, number: '55', name: 'Ward 55', ...patch}}), label.includes('duplicate') ? /already exists/ : Error, label);
 assert.throws(() => apply(s, {action: 'save-ward', ward: {...form, id: 'missing'}}), /not found/); assert.throws(() => apply(s, {action: 'save-ward'}), /Enter ward details/);
 const count = s.wards.length; const edited = apply(s, {action: 'save-ward', ward: {id: wardId, number: '7', name: 'Ward Seven', city: 'Jaipur', active: true}}); assert.equal(edited.wardId, wardId);
 assert.equal(s.wards.length, count); const ward7 = s.wards.find(w => w.id === wardId); assert.equal(ward7.name, 'Ward Seven'); assert.equal(ward7.memberPhotoId, 'photo-7', 'omitting memberPhotoId keeps the photo'); assert.equal(saveWard(s, {...ward7, memberPhotoId: ''}).memberPhotoId, '');
 register(s, 'one', {wardId}); assert.deepEqual(apply(s, {action: 'delete-ward', id: wardId}), {id: wardId, deactivated: true, deleted: false}); assert.equal(s.wards.find(w => w.id === wardId).active, false);
 const empty = s.wards.find(w => w.name === 'Hidden'); assert.deepEqual(apply(s, {action: 'delete-ward', id: empty.id}), {id: empty.id, deactivated: false, deleted: true}); assert.equal(s.wards.some(w => w.id === empty.id), false);
 assert.throws(() => apply(s, {action: 'delete-ward', id: 'nope'}), /not found/);
 assert.equal(communityView(s, 'one', viewer('Resident'), true).ward.name, 'Ward Seven', 'a resident keeps seeing their ward after it is deactivated');
});
test('ward records with media ids are visible to settings admins only; residents get only their own PublicWard', () => {
 const s = seedWorkspace(); s.wards[0].memberPhotoId = 'secret-media-id'; s.wards[0].memberName = 'Member'; register(s, 'one');
 const resident = projectWorkspace(s, who('Resident'), true); assert.equal('wards' in resident, false); assert.equal(JSON.stringify(resident).includes('secret-media-id'), false);
 assert.deepEqual(resident.ward, {id: 'ward-12', number: '12', name: 'Ward 12', nameHi: 'वार्ड 12', city: 'Jaipur', memberName: 'Member', memberNameHi: 'Member', memberPhotoUrl: '/api/wards/photo?id=ward-12'});
 assert.equal(projectWorkspace(s, who('Ward Admin', 'admin'), false).wards[0].memberPhotoId, 'secret-media-id');
 // The ward list is also sent (id, number, name, city, active; never the member photo id) to administrators who can read complaints, for the ward filter; roles with no business with wards get none.
 for (const role of ['Auditor', 'Complaint Officer']) {const out = projectWorkspace(s, who(role, 'aud'), false); assert.deepEqual(out.wards.map(w => [w.id, w.number, w.name, w.active, w.memberPhotoId]), [['ward-12', '12', 'Ward 12', true, '']], role); assert.equal(JSON.stringify(out).includes('secret-media-id'), false, role);}
 assert.equal('wards' in projectWorkspace(s, who('Content Editor', 'ed'), false), false); assert.equal('wards' in projectWorkspace(s, who('Custom', 'c'), false), false);
 assert.equal(projectWorkspace(s, who('Super Admin', 'admin'), false).ward, null);
});

/* ----------------------------------------------------------------------- complaints and scoping */

test('residents see only their own complaints; staff, drafts, disabled places and private history stay hidden', () => {
 const s = seedWorkspace(); s.complaints.push(complaint({id: 'WC-1', residentId: 'one'}), complaint({id: 'WC-2', residentId: 'two'}), complaint({id: 'WC-3', residentId: undefined}));
 apply(s, {action: 'save-classified', classified: makeAd()}); s.places = [{id: 'hidden', published: false, sortOrder: 0}]; s.municipality = {published: false, history: 'not verified'};
 let out = projectWorkspace(s, who('Resident'), true);
 assert.equal(out.classifieds.length, 0); assert.equal(out.places.length, 0); assert.equal(out.municipality.history, ''); assert.deepEqual(out.complaints.map(c => c.id), ['WC-1']);
 assert.deepEqual(projectWorkspace(s, who('Resident', 'demo-resident'), true).complaints, [], 'no shared default owner: unowned records belong to nobody');
 out = projectWorkspace(s, who('Content Editor'), false);
 assert.equal(out.complaints.length, 0); assert.equal(out.audit.length, 0); assert.equal(out.communications.length, 0); assert.equal(out.classifieds.length, 1);
});
test('session scoping: resident A cannot see resident B complaints, notifications, profile or media', async () => {
 const s = seedWorkspace(); register(s, 'one'); register(s, 'two');
 s.complaints.push(complaint({id: 'WC-A', residentId: 'one', media: ['evidence-a']}), complaint({id: 'WC-B', residentId: 'two', media: ['evidence-b'], resident: 'Resident two', mobile: MOBILES.two}));
 const before = statusSnapshot(s.complaints);
 await applyAction(s, {action: 'transition', id: 'WC-A', status: 'Acknowledged', note: 'Looking into it now.'}, 'admin', 3000, 'Officer');
 await applyAction(s, {action: 'transition', id: 'WC-B', status: 'Acknowledged', note: 'Looking into it too.'}, 'admin', 3000, 'Officer');
 recordStatusChanges(s, before, iso(3000), 'admin');
 const a = projectWorkspace(s, who('Resident', 'one'), true), b = projectWorkspace(s, who('Resident', 'two'), true);
 assert.deepEqual(a.complaints.map(c => c.id), ['WC-A']); assert.deepEqual(b.complaints.map(c => c.id), ['WC-B']);
 assert.deepEqual(a.notifications.map(n => n.complaintId), ['WC-A']); assert.deepEqual(b.notifications.map(n => n.complaintId), ['WC-B']);
 assert.equal(a.profile.id, 'one'); assert.equal(b.profile.id, 'two'); assert.equal(JSON.stringify(a).includes(MOBILES.two), false, 'B’s mobile number is not in A’s payload'); assert.equal(JSON.stringify(a).includes('WC-B'), false);
 assert.equal(canReadMedia(s, who('Resident', 'one'), 'evidence-a', 'one'), true); assert.equal(canReadMedia(s, who('Resident', 'one'), 'evidence-b', 'two'), false); assert.equal(canReadMedia(s, who('Resident', 'two'), 'evidence-a', 'one'), false);
 assert.equal(canReadMedia(s, who('Resident', 'one'), 'photo-two', 'two'), false, 'another resident’s profile photo is private'); assert.equal(canReadMedia(s, who('Resident', 'two'), 'photo-two', 'two'), true);
 assert.equal(canReadMedia(s, who('Complaint Officer', 'staff'), 'evidence-b', 'two'), true);
});

/* ------------------------------------------------------------------------------- notifications */

test('an admin status change creates a bilingual complaint notification for that resident only', async () => {
 const s = seedWorkspace(); register(s, 'one'); register(s, 'two');
 s.complaints.push(complaint({id: 'WC-A', residentId: 'one', status: 'Assigned', assignee: 'Roads & Infrastructure'}), complaint({id: 'WC-B', residentId: 'two'}), complaint({id: 'WC-C', residentId: undefined, resident: 'Walk-in'}));
 const before = statusSnapshot(s.complaints);
 await applyAction(s, {action: 'transition', id: 'WC-A', status: 'In Progress', note: 'Crew is on site.'}, 'admin', 9000, 'Officer');
 const created = recordStatusChanges(s, before, iso(9000), 'admin');
 assert.equal(created.length, 1); const [n] = created;
 assert.deepEqual([n.kind, n.residentId, n.complaintId, n.classifiedId], ['complaint', 'one', 'WC-A', '']);
 assert.equal(n.title, 'Complaint WC-A is now In Progress'); assert.match(n.titleHi, /^शिकायत WC-A अब .+ है$/); assert.equal(n.body, 'Crew is on site.'); assert.match(n.bodyHi, /\S/); assert.equal(n.createdAt, iso(9000));
 assert.equal(s.notifications[0].id, n.id);
 assert.deepEqual(communityView(s, 'one', viewer('Resident'), true).notifications.map(x => x.id), [n.id]); assert.equal(communityView(s, 'two', viewer('Resident'), true).notifications.length, 0);
 assert.equal(recordStatusChanges(s, statusSnapshot(s.complaints), iso(9500), 'admin').length, 0, 'no status change, no notification');
 const edit = statusSnapshot(s.complaints); await applyAction(s, {action: 'edit', id: 'WC-B', priority: 'High'}, 'admin', 9600); assert.equal(recordStatusChanges(s, edit, iso(9600), 'admin').length, 0, 'edits are not status changes');
 const own = statusSnapshot(s.complaints); s.complaints[2].status = 'Rejected / Duplicate'; assert.equal(recordStatusChanges(s, own, iso(9700), 'admin').length, 0, 'a complaint with no resident has nobody to notify');
});
test('closure requests notify the resident; their own closure or dispute does not', async () => {
 const s = seedWorkspace(); register(s, 'one'); s.complaints.push(complaint({id: 'WC-A', status: 'In Progress', assignee: 'Roads & Infrastructure', afterMedia: ['after']}));
 let before = statusSnapshot(s.complaints);
 await applyAction(s, {action: 'transition', id: 'WC-A', status: 'Resolution Proposed', note: 'Repair completed, photo attached.'}, 'admin', 20000, 'Officer');
 const [proposed] = recordStatusChanges(s, before, iso(20000), 'admin'); assert.equal(proposed.title, 'Complaint WC-A is now Resolution Proposed'); assert.match(proposed.body, /closure code/); assert.match(proposed.bodyHi, /\S/);
 before = statusSnapshot(s.complaints);
 const {demoCode} = await applyAction(s, {action: 'preview-closure-code', id: 'WC-A'}, 'resident', 20100);
 await applyAction(s, {action: 'verify-closure', id: 'WC-A', code: demoCode}, 'resident', 20200); assert.equal(s.complaints[0].status, 'Closed');
 assert.deepEqual(recordStatusChanges(s, before, iso(20200), 'resident'), []); assert.equal(s.notifications.length, 1);
});
test('unread counts are per resident and per kind; read and read-all affect only the caller', () => {
 const s = seedWorkspace(); register(s, 'one'); register(s, 'two');
 const {id} = apply(s, {action: 'save-classified', classified: makeAd()}); apply(s, {action: 'publish-classified', id, status: 'published'});
 const now = Date.now(); for (const [i, owner] of ['one', 'one', 'two'].entries()) s.notifications.unshift({id: `c${i}`, kind: 'complaint', complaintId: `WC-${i}`, residentId: owner, classifiedId: '', title: 'T', titleHi: 'T', body: 'B', bodyHi: 'B', createdAt: iso(now + i)});
 const view = who => communityView(s, who, viewer('Resident'), true);
 assert.deepEqual(view('one').unread, {complaints: 2, classifieds: 1, activities: 0, total: 3}); assert.deepEqual(view('two').unread, {complaints: 1, classifieds: 1, activities: 0, total: 2});
 assert.deepEqual(view('one').notifications.map(n => n.id).slice(0, 2), ['c1', 'c0'], 'newest first');
 assert.deepEqual(view('three').unread, {complaints: 0, classifieds: 0, activities: 0, total: 0}, 'an unknown resident has nothing');
 apply(s, {action: 'read-notification', id: 'c0'}, 'one'); assert.deepEqual(view('one').unread, {complaints: 1, classifieds: 1, activities: 0, total: 2}); assert.deepEqual(view('two').unread, {complaints: 1, classifieds: 1, activities: 0, total: 2});
 assert.throws(() => apply(s, {action: 'read-notification', id: 'c2'}, 'one'), /not found/, 'a resident cannot touch another resident’s notification');
 assert.throws(() => apply(s, {action: 'read-notification'}, 'one')); assert.throws(() => apply(s, {action: 'read-all-notifications', kind: 'other'}, 'one'));
 apply(s, {action: 'read-all-notifications', kind: 'classified'}, 'one'); assert.deepEqual(view('one').unread, {complaints: 1, classifieds: 0, activities: 0, total: 1});
 apply(s, {action: 'read-all-notifications'}, 'one'); assert.deepEqual(view('one').unread, {complaints: 0, classifieds: 0, activities: 0, total: 0}); assert.deepEqual(view('two').unread, {complaints: 1, classifieds: 1, activities: 0, total: 2});
 assert.equal(view('one').notifications.every(n => n.read === true), true); assert.deepEqual(unreadCounts(view('two').notifications), view('two').unread);
});
test('classified notifications follow the resident’s preference and consent time; complaint notifications are always delivered', () => {
 const s = seedWorkspace(); const t0 = Date.now() - 100000;
 register(s, 'one', {}, t0); register(s, 'two', {}, t0); apply(s, {action: 'save-profile', profile: {classifiedNotifications: false}}, 'two', t0 + 1000);
 const oldAd = () => ({...makeAd(), startsAt: iso(Date.now() - 10 * 86400000)}); const first = apply(s, {action: 'save-classified', classified: oldAd()}).id; assert.equal(apply(s, {action: 'publish-classified', id: first, status: 'published'}, 'x', t0 + 5000).notificationCreated, true);
 const view = who => communityView(s, who, viewer('Resident'), true, t0 + 6000);
 assert.equal(view('one').notifications.length, 1); assert.equal(view('two').notifications.length, 0, 'opted out: no classified notification');
 assert.deepEqual(pushItemsFor(s, [s.notifications[0]]).map(i => i.residentId), ['one'], 'push audience is opted-in residents only');
 apply(s, {action: 'save-profile', profile: {classifiedNotifications: true}}, 'two', t0 + 7000);
 assert.equal(communityView(s, 'two', viewer('Resident'), true, t0 + 8000).notifications.length, 0, 'ads published before re-consent stay hidden');
 const second = apply(s, {action: 'save-classified', classified: oldAd()}).id; apply(s, {action: 'publish-classified', id: second, status: 'published'}, 'x', t0 + 9000);
 assert.equal(communityView(s, 'two', viewer('Resident'), true, t0 + 10000).notifications.length, 1);
 apply(s, {action: 'save-profile', profile: {classifiedNotifications: false}}, 'two', t0 + 11000);
 s.complaints.push(complaint({id: 'WC-Z', residentId: 'two', resident: 'Resident two'}));
 const snap = statusSnapshot(s.complaints); s.complaints[0].status = 'Acknowledged'; const [n] = recordStatusChanges(s, snap, iso(t0 + 12000), 'admin');
 const out = communityView(s, 'two', viewer('Resident'), true, t0 + 13000); assert.deepEqual(out.notifications.map(x => x.kind), ['complaint']); assert.deepEqual(out.unread, {complaints: 1, classifieds: 0, activities: 0, total: 1});
 assert.deepEqual(pushItemsFor(s, [n]).map(i => i.residentId), ['two'], 'complaint pushes ignore the classified preference');
});
test('push content follows the resident’s language and carries the deep-link data', () => {
 const s = seedWorkspace(); register(s, 'one'); register(s, 'two', {language: 'hi'});
 s.complaints.push(complaint({id: 'WC-A', residentId: 'two', status: 'Acknowledged'})); const [n] = recordStatusChanges(s, new Map([['WC-A', 'Submitted']]), iso(5), 'admin');
 const [item] = pushItemsFor(s, [n]); assert.equal(item.residentId, 'two'); assert.equal(item.title, n.titleHi); assert.deepEqual(item.data, {type: 'complaint', kind: 'complaint', complaintId: 'WC-A', notificationId: n.id}); assert.equal(item.subject, 'WC-A');
 const {id} = apply(s, {action: 'save-classified', classified: makeAd()}); apply(s, {action: 'publish-classified', id, status: 'published'});
 const items = pushItemsFor(s, [s.notifications[0]]); assert.deepEqual(items.map(i => i.residentId).sort(), ['one', 'two']); assert.deepEqual(items[0].data.type, 'classified'); assert.equal(items.find(i => i.residentId === 'one').title, 'Local crafts fair');
});
test('stored notifications are capped and read markers for dropped notifications are forgotten', () => {
 const s = seedWorkspace(); register(s, 'one'); s.notifications = Array.from({length: MAX_NOTIFICATIONS + 25}, (_, i) => ({id: `n${i}`, kind: 'complaint', complaintId: 'WC', residentId: 'one', classifiedId: '', title: '', titleHi: '', body: '', bodyHi: '', createdAt: iso(MAX_NOTIFICATIONS + 25 - i)}));
 s.residentProfiles.one.readNotificationIds = ['n0', `n${MAX_NOTIFICATIONS + 24}`]; capNotifications(s); // newest first, like unshift
 assert.equal(s.notifications.length, MAX_NOTIFICATIONS); assert.deepEqual(s.residentProfiles.one.readNotificationIds, ['n0']); assert.equal(s.notifications.some(n => n.id === `n${MAX_NOTIFICATIONS + 24}`), false);
 assert.equal(residentNotifications(s, s.residentProfiles.one).length, MAX_NOTIFICATIONS);
});
test('publication creates one notification, honours opt-in and expiry, and persists read status', () => {
 const s = seedWorkspace(); register(s, 'one', {}, Date.now() - 10000);
 const {id} = apply(s, {action: 'save-classified', classified: makeAd()}); assert.equal(communityView(s, 'one', viewer('Resident'), true).notifications.length, 0);
 assert.equal(apply(s, {action: 'publish-classified', id, status: 'published'}).notificationCreated, true);
 const out = communityView(s, 'one', viewer('Resident'), true); assert.equal(out.notifications.length, 1); assert.equal(out.notifications[0].kind, 'classified'); assert.equal(communityView(s, 'two', viewer('Resident'), true).notifications.length, 0);
 apply(s, {action: 'read-notification', id: out.notifications[0].id}); assert.equal(communityView(s, 'one', viewer('Resident'), true).notifications[0].read, true);
 apply(s, {action: 'publish-classified', id, status: 'archived'}); assert.equal(communityView(s, 'one', viewer('Resident'), true).classifieds.length, 0);
 assert.equal(apply(s, {action: 'publish-classified', id, status: 'published'}).notificationCreated, false); assert.equal(s.notifications.length, 1);
 s.classifieds[0].endsAt = new Date(Date.now() - 1000).toISOString(); assert.equal(communityView(s, 'one', viewer('Resident'), true).notifications.length, 0); assert.throws(() => apply(s, {action: 'publish-classified', id, status: 'published'}), /expired/);
});
test('archiving a draft does not consume its first publication notification', () => {
 const s = seedWorkspace(); const {id} = apply(s, {action: 'save-classified', classified: makeAd()}); apply(s, {action: 'publish-classified', id, status: 'archived'});
 assert.equal(apply(s, {action: 'publish-classified', id, status: 'published'}).notificationCreated, true);
});

/* ------------------------------------------------------------------------------------ push client */

test('Expo push: batches of 100, records invalid devices, and never throws', async () => {
 const token = i => `ExponentPushToken[device${String(i).padStart(6, '0')}]`; const calls = [];
 const fetcher = async (url, init) => {const batch = JSON.parse(init.body); calls.push({url, size: batch.length, headers: init.headers}); return Response.json({data: batch.map((m, i) => i === 1 && calls.length === 1 ? {status: 'error', message: 'gone', details: {error: 'DeviceNotRegistered'}} : {status: 'ok', id: String(i)})});};
 const messages = Array.from({length: 250}, (_, i) => ({to: token(i), title: 'T', body: 'B', data: {type: 'complaint'}}));
 const result = await sendExpoPush(messages, {fetcher});
 assert.deepEqual(calls.map(c => c.size), [100, 100, 50]); assert.equal(calls[0].url, EXPO_PUSH_URL); assert.equal(calls[0].headers['Content-Type'], 'application/json');
 assert.deepEqual([result.status, result.sent, result.failed, result.invalidTokens], ['partial', 249, 1, [token(1)]]);
 assert.equal((await sendExpoPush([{to: 'garbage', title: 'T', body: 'B'}], {fetcher})).status, 'failed'); assert.equal((await sendExpoPush([], {fetcher})).status, 'skipped');
 assert.equal(isExpoPushToken('ExpoPushToken[abcdefghijklmnop]'), true); assert.equal(isExpoPushToken('x'), false); assert.equal(isExpoPushToken(5), false);
 const down = await sendExpoPush(messages.slice(0, 3), {fetcher: async () => {throw new Error('network down');}}); assert.deepEqual([down.status, down.failed, down.errors], ['failed', 3, ['network down']]);
 const http500 = await sendExpoPush(messages.slice(0, 2), {fetcher: async () => new Response('oops', {status: 500})}); assert.equal(http500.status, 'failed'); assert.match(http500.errors[0], /500/);
 const hang = await sendExpoPush(messages.slice(0, 1), {timeoutMs: 20, fetcher: (url, init) => new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))))}); assert.deepEqual([hang.status, hang.errors], ['failed', ['Expo push timed out']]);
});

/* ------------------------------------------------------------------------- existing catalog tests */

test('catalog additions are immediately usable; disabled categories reject new submissions and preserve history', async () => {
 const s = seedWorkspace(); const category = {nameEn: 'Stray animals', nameHi: 'आवारा पशु', icon: 'paw-outline', color: '#137556', sortOrder: 2, enabled: true, departmentId: departmentsOf(s.settings).find(d => d.active).id};
 const {categoryId} = await applyAction(s, {action: 'save-category', category}, 'admin');
 const body = {action: 'create', categoryId, title: 'Animal near crossing', description: 'A stray animal needs assistance at the crossing.', locality: 'Main market road', lat: 20, lng: 75, media: ['photo'], consent: true};
 await applyAction(s, body, 'resident'); assert.equal(s.complaints[0].categoryId, categoryId);
 await applyAction(s, {action: 'save-category', category: {...category, id: categoryId, enabled: false}}, 'admin'); await assert.rejects(applyAction(s, body, 'resident'), /unavailable/); assert.equal(s.complaints[0].category, 'Stray animals');
 await assert.rejects(applyAction(s, {action: 'save-category', category: {...category, nameEn: '  STRAY ANIMALS  '}}, 'admin'), /already exists/);
 const old = seedWorkspace(); delete old.categories; assert.equal(normalizeWorkspace(old).categories.length, defaultIssueCategories().length); old.categories = []; assert.equal(normalizeWorkspace(old).categories.length, 0);
});
test('ServiceError carries retryAfter for 429 responses', () => {assert.equal(new ServiceError('slow down', 429, 12).retryAfter, 12); assert.equal(new ServiceError('x').retryAfter, undefined); assert.equal(defaultProfile('x').classifiedNotifications, true);});

/* ------------------------------------------------------------------------------------ activities (docs/ACTIVITIES_API.md) */

const HOUR = 3600000;
const makeActivity = (over = {}) => ({title: 'Swachh Nagar cleanliness drive', titleHi: 'स्वच्छ नगर सफाई अभियान', description: 'Join the ward-wide cleanliness drive and help keep our streets clean.', descriptionHi: '', organizer: 'Nagar Parishad, Jaipur', organizerHi: '', venue: 'Ward park gate', venueHi: '', startsAt: iso(Date.now() + 2 * HOUR), endsAt: iso(Date.now() + 8 * HOUR), imageId: '', contactPhone: '', url: '', ...over});
const saveActivity = (s, over = {}) => apply(s, {action: 'save-activity', activity: makeActivity(over)}).id;
const publishActivity = (s, id, status = 'published', now = Date.now()) => apply(s, {action: 'publish-activity', id, status}, 'one', now);
const titlesOf = list => list.map(a => a.title);

test('a new or legacy workspace has an empty activities list in every view', () => {
 assert.deepEqual(ensureCommunity({}).activities, []);
 const s = seedWorkspace(); assert.equal('activities' in s, false, 'legacy stored workspaces have no activities field');
 assert.deepEqual(communityView(s, 'one', viewer('Resident'), true).activities, []);
 assert.deepEqual(communityView(s, 'one', viewer('Content Editor'), false).activities, []);
 assert.deepEqual(projectWorkspace(s, who('Resident'), true).activities, []);
});
test('save-activity validates every field per the contract and persists nothing when it fails', () => {
 const s = seedWorkspace(); const t = iso(Date.now() + HOUR);
 const bad = (over, pattern) => assert.throws(() => apply(s, {action: 'save-activity', activity: makeActivity(over)}), pattern, JSON.stringify(over).slice(0, 60));
 assert.throws(() => apply(s, {action: 'save-activity'}), /activity details/);
 bad({title: 'abc'}, /Title/); bad({title: '   a   '}, /Title/); bad({title: 'x'.repeat(121)}, /Title/); bad({title: undefined}, /Title/);
 bad({description: 'too short'}, /Description/); bad({description: 'x'.repeat(4001)}, /Description/); bad({description: undefined}, /Description/);
 bad({organizer: ''}, /Organizer/); bad({organizer: ' N '}, /Organizer/); bad({organizer: 'x'.repeat(151)}, /Organizer/); bad({organizer: undefined}, /Organizer/);
 bad({titleHi: 'x'.repeat(121)}, /Hindi title/); bad({descriptionHi: 'x'.repeat(4001)}, /Hindi description/); bad({organizerHi: 'x'.repeat(151)}, /Hindi organizer/);
 bad({venue: 'x'.repeat(201)}, /Venue/); bad({venueHi: 'x'.repeat(201)}, /Hindi venue/); bad({contactPhone: '9'.repeat(31)}, /Contact phone/); bad({imageId: 'x'.repeat(101)}, /Image/); bad({title: 42}, /Title/);
 bad({startsAt: 'next week'}, /Start date/); bad({endsAt: 'soon'}, /End date/); bad({startsAt: undefined}, /Start date/); bad({endsAt: ''}, /End date/); bad({startsAt: '2026-13-45T10:00:00.000Z'}, /Start date/);
 bad({startsAt: t, endsAt: t}, /later than the start/); bad({startsAt: iso(Date.now() + 2 * HOUR), endsAt: iso(Date.now() + HOUR)}, /later than the start/);
 bad({url: 'http://example.org/drive'}, /HTTPS/); bad({url: 'javascript:alert(1)'}, /HTTPS/); bad({url: 'ftp://example.org/x'}, /HTTPS/);
 assert.deepEqual(s.activities, [], 'a rejected save leaves no record'); assert.equal(s.audit.length, 0, 'and no audit line');
 // Boundary values are accepted.
 const id = saveActivity(s, {title: 'abcd', description: 'x'.repeat(10), organizer: 'NP', titleHi: 'x'.repeat(120), descriptionHi: 'x'.repeat(4000), organizerHi: 'x'.repeat(150), venue: 'x'.repeat(200), venueHi: 'x'.repeat(200), contactPhone: '9'.repeat(30), imageId: 'x'.repeat(100), url: 'https://example.org/drive'});
 assert.ok(id); assert.equal(s.activities.length, 1);
 const long = saveActivity(s, {title: 'x'.repeat(120), description: 'x'.repeat(4000), organizer: 'x'.repeat(150)}); assert.ok(long);
});
test('save-activity stores a trimmed draft, accepts omitted optional fields, and edits in place', () => {
 const s = seedWorkspace(); const startsAt = iso(Date.now() + 2 * HOUR), endsAt = iso(Date.now() + 5 * HOUR);
 const id = saveActivity(s, {title: '  Padded activity title  ', organizer: ' Panchayat Samiti, Amer ', url: 'https://example.org/camp', contactPhone: '0141 2200000', startsAt, endsAt});
 assert.equal(typeof id, 'string'); assert.equal(s.activities.length, 1);
 assert.deepEqual(s.activities[0], {id, title: 'Padded activity title', titleHi: 'स्वच्छ नगर सफाई अभियान', description: 'Join the ward-wide cleanliness drive and help keep our streets clean.', descriptionHi: '', organizer: 'Panchayat Samiti, Amer', organizerHi: '', venue: 'Ward park gate', venueHi: '', startsAt, endsAt, imageId: '', contactPhone: '0141 2200000', url: 'https://example.org/camp', status: 'draft', publishedAt: null});
 assert.equal(s.audit[0].action, 'Saved activity draft'); assert.equal(s.audit[0].complaintId, id); assert.equal(s.audit[0].actor, 'test');
 const minimal = apply(s, {action: 'save-activity', activity: {title: 'Minimal fields', description: 'Only the required fields are supplied.', organizer: 'Nagar Parishad', startsAt, endsAt}}).id;
 const stored = s.activities.find(a => a.id === minimal); assert.deepEqual([stored.titleHi, stored.descriptionHi, stored.organizerHi, stored.venue, stored.venueHi, stored.imageId, stored.contactPhone, stored.url], ['', '', '', '', '', '', '', '']);
 assert.equal(apply(s, {action: 'save-activity', activity: {...makeActivity({title: 'Renamed activity'}), id}}).id, id); assert.equal(s.activities.length, 2); assert.equal(s.activities[0].title, 'Renamed activity');
 assert.throws(() => apply(s, {action: 'save-activity', activity: {...makeActivity(), id: 'no-such-activity'}}), /not found/); assert.equal(s.activities.length, 2);
 // The wire id is never trusted for creation: a client cannot choose the id of a new record.
 const another = apply(s, {action: 'save-activity', activity: {...makeActivity(), id: undefined}}).id; assert.notEqual(another, id);
});
test('publish-activity publishes and archives, sets publishedAt once and rejects ended activities', () => {
 const s = seedWorkspace(); register(s, 'one'); const id = saveActivity(s); const t1 = Date.now();
 assert.throws(() => publishActivity(s, id, 'draft'), /Invalid publication status/); assert.throws(() => publishActivity(s, id, null), /Invalid publication status/); assert.throws(() => publishActivity(s, 'missing'), /not found/);
 assert.deepEqual(publishActivity(s, id, 'published', t1), {notificationCreated: true, activityId: id});
 assert.equal(s.activities[0].status, 'published'); assert.equal(s.activities[0].publishedAt, iso(t1));
 publishActivity(s, id, 'archived', t1 + 1000); assert.equal(s.activities[0].status, 'archived'); assert.equal(s.activities[0].publishedAt, iso(t1), 'archiving keeps the first publication time');
 assert.equal(publishActivity(s, id, 'published', t1 + 2000).notificationCreated, false, 'republishing never notifies again'); assert.equal(s.activities[0].status, 'published'); assert.equal(s.activities[0].publishedAt, iso(t1), 'republishing does not move publishedAt');
 assert.deepEqual(s.audit.map(a => a.action).slice(0, 3), ['Activity published', 'Activity archived', 'Activity published']); assert.ok(s.audit.slice(0, 3).every(a => a.complaintId === id));
 assert.equal(s.notifications.length, 1, 'one notification for the first publication only'); assert.equal(s.communications.length, 0, 'activities create no WhatsApp/communication entries');
 // An activity whose end has passed cannot be published (archiving is always allowed); moving the end date makes it publishable.
 const now = Date.now(); const past = saveActivity(s, {startsAt: iso(now - 4 * HOUR), endsAt: iso(now - HOUR)});
 assert.throws(() => publishActivity(s, past), /update its dates/i); assert.equal(s.activities.find(a => a.id === past).status, 'draft'); assert.equal(s.activities.find(a => a.id === past).publishedAt, null);
 assert.doesNotThrow(() => publishActivity(s, past, 'archived'));
 const edge = saveActivity(s, {startsAt: iso(now - HOUR), endsAt: iso(now)}); assert.throws(() => publishActivity(s, edge, 'published', now), /update its dates/i, 'ending exactly now counts as ended');
 apply(s, {action: 'save-activity', activity: {...makeActivity({startsAt: iso(now - HOUR), endsAt: iso(now + HOUR)}), id: edge}}); assert.doesNotThrow(() => publishActivity(s, edge, 'published', now));
 assert.ok(s.activities.find(a => a.id === edge).publishedAt);
});
test('editing a published activity keeps it published (and its first publication time); drafts and archived ones keep their status', () => {
 const s = seedWorkspace(); const id = saveActivity(s); const t1 = Date.now(); publishActivity(s, id, 'published', t1);
 apply(s, {action: 'save-activity', activity: {...makeActivity({title: 'Edited published activity'}), id}});
 assert.equal(s.activities[0].status, 'published'); assert.equal(s.activities[0].publishedAt, iso(t1)); assert.equal(residentActivities(s).length, 1, 'still visible after the edit'); assert.equal(s.activities[0].title, 'Edited published activity');
 assert.equal(publishActivity(s, id, 'published', t1 + 5000).notificationCreated, false); assert.equal(s.activities[0].publishedAt, iso(t1));
 publishActivity(s, id, 'archived'); apply(s, {action: 'save-activity', activity: {...makeActivity({title: 'Edited while archived'}), id}}); assert.equal(s.activities[0].status, 'archived', 'an explicit unpublish survives later edits'); assert.equal(residentActivities(s).length, 0);
 const draft = saveActivity(s, {title: 'Still a draft'}); apply(s, {action: 'save-activity', activity: {...makeActivity({title: 'Still a draft, edited'}), id: draft}}); assert.equal(s.activities.find(a => a.id === draft).status, 'draft', 'a draft stays a draft');
});
const residentActivities = (s, residentId = 'one', now = Date.now()) => communityView(s, residentId, viewer('Resident'), true, now).activities;
test('residents see only published, not-yet-ended activities, soonest first; staff with activities.manage see every record', () => {
 const s = seedWorkspace(); const now = Date.now();
 const late = saveActivity(s, {title: 'Late programme', startsAt: iso(now + 48 * HOUR), endsAt: iso(now + 50 * HOUR)});
 const soon = saveActivity(s, {title: 'Soon programme', startsAt: iso(now + 2 * HOUR), endsAt: iso(now + 4 * HOUR)});
 const ongoing = saveActivity(s, {title: 'Ongoing programme', startsAt: iso(now - 2 * HOUR), endsAt: iso(now + HOUR)});
 const endsSoon = saveActivity(s, {title: 'Ends in a second', startsAt: iso(now - 3 * HOUR), endsAt: iso(now + 1000)});
 const draft = saveActivity(s, {title: 'Draft programme', startsAt: iso(now + HOUR)});
 const archived = saveActivity(s, {title: 'Archived programme', startsAt: iso(now + 3 * HOUR)});
 const wasEnded = saveActivity(s, {title: 'Already ended programme', startsAt: iso(now - 5 * HOUR), endsAt: iso(now + 500)});
 for (const id of [late, soon, ongoing, endsSoon, archived, wasEnded]) publishActivity(s, id, 'published', now); publishActivity(s, archived, 'archived', now);
 assert.deepEqual(titlesOf(residentActivities(s, 'one', now)), ['Already ended programme', 'Ends in a second', 'Ongoing programme', 'Soon programme', 'Late programme'], 'soonest start first; draft and archived are absent');
 assert.deepEqual(titlesOf(residentActivities(s, 'one', now + 500)), ['Ends in a second', 'Ongoing programme', 'Soon programme', 'Late programme'], 'an activity disappears at its end time');
 assert.deepEqual(titlesOf(residentActivities(s, 'one', now + 1000)), ['Ongoing programme', 'Soon programme', 'Late programme']);
 assert.deepEqual(titlesOf(residentActivities(s, 'one', now + 2 * HOUR)), ['Soon programme', 'Late programme']);
 // Staff view: everything, soonest first, without reordering the stored list.
 const stored = s.activities.map(a => a.title);
 const editor = communityView(s, 'x', viewer('Content Editor'), false, now).activities;
 assert.equal(editor.length, 7); assert.deepEqual(titlesOf(editor), [...editor].sort((a, b) => +new Date(a.startsAt) - +new Date(b.startsAt)).map(a => a.title));
 assert.ok(editor.some(a => a.title === 'Draft programme') && editor.some(a => a.title === 'Archived programme'));
 assert.deepEqual(s.activities.map(a => a.title), stored, 'viewing never reorders the stored records');
 assert.equal(communityView(s, 'x', viewer('Super Admin'), false, now).activities.length, 7);
 // Administrators without activities.manage and a Super Admin acting through the resident view see the resident list.
 for (const role of ['Auditor', 'Complaint Officer']) assert.deepEqual(titlesOf(communityView(s, 'x', viewer(role), false, now).activities), titlesOf(residentActivities(s, 'one', now)), role);
 assert.deepEqual(titlesOf(communityView(s, 'x', viewer('Super Admin'), true, now).activities), titlesOf(residentActivities(s, 'one', now)));
 assert.ok(draft, 'the draft exists but is never shown to residents');
});
test('the projected workspace never leaks draft, archived or ended activities to residents', () => {
 const s = seedWorkspace(); const now = Date.now(); register(s, 'one');
 const visible = saveActivity(s, {title: 'Public vaccination camp'}); publishActivity(s, visible);
 saveActivity(s, {title: 'Secret draft programme', imageId: 'draft-img'}); const archived = saveActivity(s, {title: 'Secret archived programme'}); publishActivity(s, archived); publishActivity(s, archived, 'archived');
 const ended = saveActivity(s, {title: 'Secret ended programme', startsAt: iso(now - 4 * HOUR), endsAt: iso(now + 100)}); publishActivity(s, ended, 'published', now); s.activities.find(a => a.id === ended).endsAt = iso(now - 1000);
 const resident = projectWorkspace(s, who('Resident'), true);
 assert.deepEqual(titlesOf(resident.activities), ['Public vaccination camp']); assert.equal(JSON.stringify(resident).includes('Secret'), false, 'raw stored activities are replaced, not merged');
 assert.equal(JSON.stringify(projectWorkspace(s, who('Resident', 'demo-resident'), true)).includes('Secret'), false);
 assert.equal(JSON.stringify(projectWorkspace(s, who('Auditor'), false)).includes('Secret'), false);
 assert.equal(projectWorkspace(s, who('Content Editor'), false).activities.length, 4);
 assert.equal(projectWorkspace(s, who('Super Admin'), true).activities.length, 1, 'view=resident previews exactly what residents see');
});
test('activity actions need activities.manage: residents and administrators without it are refused', () => {
 assert.equal(actionPermissions['save-activity'], 'activities.manage'); assert.equal(actionPermissions['publish-activity'], 'activities.manage');
 assert.ok(permissions.includes('activities.manage'));
 for (const action of ['save-activity', 'publish-activity']) {
  const permission = actionPermissions[action];
  assert.throws(() => requireAction(viewer('Resident'), permission), e => e.code === 403, 'Resident');
  for (const role of ['Auditor', 'Complaint Officer']) assert.throws(() => requireAction(viewer(role), permission), e => e.code === 403, role);
  assert.throws(() => requireAction({role: 'Custom', permissions: ['classifieds.manage', 'city.manage', 'announcements.manage']}, permission), e => e.code === 403, 'custom admin with the neighbouring permissions only');
  assert.throws(() => requireAction({role: 'Custom', permissions: []}, permission), e => e.code === 403);
  for (const role of ['Content Editor', 'Ward Admin', 'Super Admin']) assert.doesNotThrow(() => requireAction(viewer(role), permission), role);
  assert.doesNotThrow(() => requireAction({role: 'Custom', permissions: ['activities.manage']}, permission));
 }
 assert.ok(rolePresets['Content Editor'].includes('activities.manage')); assert.ok(rolePresets['Ward Admin'].includes('activities.manage')); assert.ok(rolePresets['Super Admin'].includes('activities.manage'));
 for (const role of ['Auditor', 'Complaint Officer', 'Custom']) assert.equal(rolePresets[role].includes('activities.manage'), false, role);
 const v = viewer('Super Admin'); const base = {email: 'editor@example.test', role: 'Custom', permissions: ['activities.manage'], active: true};
 assert.deepEqual(validateAdminGrant(v, v.email, base).permissions, ['activities.manage'], 'a custom administrator can be granted just activities.manage');
 assert.deepEqual(validateAdminGrant(v, v.email, {...base, role: 'Content Editor', permissions: []}).permissions, rolePresets['Content Editor']);
 // The policy table is what POST /api/workspace consults: every activity action maps to the permission, and unrelated ad/city permissions do not stand in for it.
 assert.notEqual(actionPermissions['save-activity'], actionPermissions['save-classified']);
});
test('activity images: residents read them only while the activity is visible; draft, archived and ended stay hidden even from the uploader', () => {
 const s = seedWorkspace(); const resident = who('Resident', 'res-a'); const other = who('Resident', 'res-b');
 const id = saveActivity(s, {imageId: 'act-art'}); const can = (viewerPrincipal, uploader = 'res-a') => canReadMedia(s, viewerPrincipal, 'act-art', uploader);
 assert.equal(can(resident), false, 'draft: the uploader shortcut does not apply to referenced media'); assert.equal(can(other), false);
 assert.equal(can(who('Content Editor')), true, 'activities.manage reads drafts'); assert.equal(can(who('Ward Admin')), true); assert.equal(can(who('Super Admin')), true);
 assert.equal(can(who('Auditor')), false, 'admins without activities.manage cannot read drafts'); assert.equal(can(who('Complaint Officer')), false);
 publishActivity(s, id); assert.equal(can(resident), true, 'published and running'); assert.equal(can(other), true); assert.equal(can(who('Auditor')), true);
 publishActivity(s, id, 'archived'); assert.equal(can(resident), false, 'archived'); assert.equal(can(other, 'someone'), false); assert.equal(can(who('Content Editor')), true);
 publishActivity(s, id); s.activities[0].endsAt = iso(Date.now() - 1000); assert.equal(can(resident), false, 'ended'); assert.equal(can(who('Content Editor')), true); assert.equal(can(who('Auditor')), false);
 s.activities[0].endsAt = iso(Date.now() + HOUR); s.activities[0].startsAt = iso(Date.now() + HOUR / 2); assert.equal(can(resident), true, 'upcoming published activities are visible, so is their image');
 assert.equal(canReadMedia(s, resident, 'unrelated-upload', 'res-a'), true, 'free uploads still work'); assert.equal(canReadMedia(s, other, 'unrelated-upload', 'res-a'), false);
 // The same image used by another visible record keeps working through that record, but never through the hidden activity.
 s.activities[0].status = 'archived'; s.places = [{id: 'p', published: true, sortOrder: 0, imageId: 'act-art'}]; assert.equal(can(resident), true, 'readable through the published place');
 s.places[0].published = false; assert.equal(can(resident), false);
});

/* ------------------------------------------------------------------------------------ activity notifications, unread counts, push */

test('activity notifications default to ON for new and legacy profiles; only a boolean can change the preference', () => {
 const s = seedWorkspace(); const profile = register(s, 'one', {}, 1_000_000); assert.equal(profile.activityNotifications, true);
 assert.equal(communityView(s, 'one', viewer('Resident'), true).profile.activityNotifications, true);
 // A profile stored before the preference existed counts as opted in, in the projected profile and in every rule.
 delete s.residentProfiles.one.activityNotifications; assert.equal(communityView(s, 'one', viewer('Resident'), true).profile.activityNotifications, true);
 assert.equal(projectWorkspace(s, who('Resident', 'one'), true).profile.activityNotifications, true);
 assert.deepEqual(activityAudience(s, iso(Date.now())).map(p => p.id), ['one']);
 apply(s, {action: 'save-profile', profile: {language: 'hi'}}); assert.equal(s.residentProfiles.one.activityNotifications, true, 'saving anything else normalises a legacy profile to true');
 apply(s, {action: 'save-profile', profile: {...s.residentProfiles.one}}); // the whole profile echoed back is tolerated
 const classifiedConsent = s.residentProfiles.one.notificationConsentAt;
 apply(s, {action: 'save-profile', profile: {activityNotifications: false}}); const saved = s.residentProfiles.one;
 assert.equal(saved.activityNotifications, false); assert.equal(saved.classifiedNotifications, true); assert.equal(saved.notificationConsentAt, classifiedConsent, 'independent of the classified consent');
 assert.deepEqual([saved.name, saved.mobile, saved.address, saved.wardId, saved.registeredAt, saved.language], [profile.name, profile.mobile, profile.address, 'ward-12', profile.registeredAt, 'hi']);
 for (const bad of ['yes', 1, 0, null, {}, [true]]) assert.throws(() => apply(s, {action: 'save-profile', profile: {activityNotifications: bad}}), e => status(e) === 400, JSON.stringify(bad));
 assert.equal(s.residentProfiles.one.activityNotifications, false, 'rejected values change nothing');
 for (const [key, value] of Object.entries({name: 'Someone Else', mobile: '9000000000', wardId: 'ward-99', email: 'new@example.org', address: 'Another address entirely'})) assert.throws(() => apply(s, {action: 'save-profile', profile: {activityNotifications: true, [key]: value}}), e => status(e) === 400, key);
 assert.equal(s.residentProfiles.one.activityNotifications, false, 'a rejected request does not flip the preference');
 apply(s, {action: 'save-profile', profile: {activityNotifications: true}}); assert.equal(s.residentProfiles.one.activityNotifications, true);
 assert.throws(() => apply(s, {action: 'save-profile', profile: {activityNotifications: false}}, 'nobody'), e => status(e) === 403, 'an unregistered caller cannot save preferences');
});
test('the first publication of an activity creates one notification, shown only to residents who have not opted out and only while the activity is visible', () => {
 const s = seedWorkspace(); const t0 = Date.now() - 100000; const unreadOf = (who, now) => communityView(s, who, viewer('Resident'), true, now).unread;
 for (const id of ['one', 'two', 'three']) register(s, id, {}, t0);
 apply(s, {action: 'save-profile', profile: {activityNotifications: false}}, 'two', t0 + 1000);
 const id = saveActivity(s, {title: 'Free health camp', titleHi: 'निःशुल्क स्वास्थ्य शिविर', organizer: 'Nagar Parishad, Jaipur', organizerHi: 'नगर परिषद, जयपुर', description: 'Free check-ups and vaccination for all residents.', descriptionHi: 'सभी निवासियों के लिए निःशुल्क जाँच और टीकाकरण।', startsAt: iso(t0 + HOUR), endsAt: iso(t0 + 6 * HOUR)});
 assert.equal(s.notifications.length, 0, 'saving a draft notifies nobody'); assert.equal(communityView(s, 'one', viewer('Resident'), true, t0 + 2000).notifications.length, 0);
 const published = publishActivity(s, id, 'published', t0 + 5000); assert.equal(published.notificationCreated, true);
 assert.equal(s.notifications.length, 1); const [n] = s.notifications;
 assert.deepEqual(n, {id: n.id, kind: 'activity', activityId: id, classifiedId: '', title: 'Free health camp', titleHi: 'निःशुल्क स्वास्थ्य शिविर', body: 'Nagar Parishad, Jaipur: Free check-ups and vaccination for all residents.', bodyHi: 'नगर परिषद, जयपुर: सभी निवासियों के लिए निःशुल्क जाँच और टीकाकरण।', createdAt: iso(t0 + 5000)});
 const now = t0 + 6000; const view = who => communityView(s, who, viewer('Resident'), true, now);
 assert.deepEqual(view('one').notifications.map(x => [x.kind, x.activityId, x.read]), [['activity', id, false]]); assert.deepEqual(unreadOf('one', now), {complaints: 0, classifieds: 0, activities: 1, total: 1});
 assert.equal(view('two').notifications.length, 0, 'opted out: hidden'); assert.deepEqual(unreadOf('two', now), {complaints: 0, classifieds: 0, activities: 0, total: 0});
 assert.equal(view('three').notifications.length, 1); assert.equal(view('stranger').notifications.length, 0, 'an unregistered resident sees nothing');
 // Opting in again restores what is still visible; opting out again hides it and zeroes the count.
 apply(s, {action: 'save-profile', profile: {activityNotifications: true}}, 'two', t0 + 7000); assert.equal(view('two').notifications.length, 1); assert.equal(unreadOf('two', now).activities, 1);
 apply(s, {action: 'read-notification', id: n.id}, 'one'); assert.equal(unreadOf('one', now).total, 0); assert.equal(view('one').notifications[0].read, true); assert.equal(unreadOf('three', now).activities, 1, 'read state is per resident');
 apply(s, {action: 'save-profile', profile: {activityNotifications: false}}, 'one', t0 + 8000); assert.equal(view('one').notifications.length, 0); assert.deepEqual(unreadOf('one', now), {complaints: 0, classifieds: 0, activities: 0, total: 0});
 apply(s, {action: 'save-profile', profile: {activityNotifications: true}}, 'one', t0 + 9000); assert.equal(view('one').notifications[0].read, true, 'opting back in restores the notification with its read state');
 // Republishing, or archiving and publishing again, never notifies twice.
 publishActivity(s, id, 'archived', t0 + 9500); assert.equal(view('three').notifications.length, 0, 'archived: hidden'); assert.equal(unreadOf('three', now).activities, 0);
 assert.equal(publishActivity(s, id, 'published', t0 + 9600).notificationCreated, false); assert.equal(s.notifications.length, 1); assert.equal(view('three').notifications.length, 1, 'visible again once republished');
 // The notification disappears when the activity ends.
 assert.equal(communityView(s, 'three', viewer('Resident'), true, t0 + 6 * HOUR).notifications.length, 0); assert.equal(communityView(s, 'three', viewer('Resident'), true, t0 + 6 * HOUR - 1).notifications.length, 1);
 // Notifications of residents who registered after the publication are not back-filled.
 register(s, 'late', {}, t0 + 20000); assert.equal(communityView(s, 'late', viewer('Resident'), true, now + 30000).notifications.length, 0);
});
test('activity and classified preferences are independent; a draft that was archived keeps its first notification; the cap and prune rules still apply', () => {
 const s = seedWorkspace(); const t0 = Date.now() - 100000; register(s, 'one', {}, t0);
 apply(s, {action: 'save-profile', profile: {classifiedNotifications: false}}, 'one', t0 + 1000);
 const ad = apply(s, {action: 'save-classified', classified: {...makeAd(), startsAt: iso(t0)}}).id; apply(s, {action: 'publish-classified', id: ad, status: 'published'}, 'x', t0 + 5000);
 const act = saveActivity(s, {startsAt: iso(t0), endsAt: iso(t0 + 5 * HOUR)}); publishActivity(s, act, 'archived', t0 + 5100);
 assert.equal(publishActivity(s, act, 'published', t0 + 5200).notificationCreated, true, 'archiving a draft does not consume its first publication notification');
 const view = () => communityView(s, 'one', viewer('Resident'), true, t0 + 6000);
 assert.deepEqual(view().notifications.map(n => n.kind), ['activity'], 'classified opt-out hides ads but never activities'); assert.deepEqual(view().unread, {complaints: 0, classifieds: 0, activities: 1, total: 1});
 apply(s, {action: 'save-profile', profile: {classifiedNotifications: true, activityNotifications: false}}, 'one', t0 + 6500);
 assert.deepEqual(communityView(s, 'one', viewer('Resident'), true, t0 + 7000).notifications.map(n => n.kind), [], 'activity opt-out hides activities; ads published before the new consent stay hidden');
 const ad2 = apply(s, {action: 'save-classified', classified: {...makeAd(), startsAt: iso(t0)}}).id; apply(s, {action: 'publish-classified', id: ad2, status: 'published'}, 'x', t0 + 8000);
 assert.deepEqual(communityView(s, 'one', viewer('Resident'), true, t0 + 9000).notifications.map(n => n.kind), ['classified'], 'activity opt-out leaves classified notifications alone');
 // read-all by kind accepts 'activity' and touches nothing else.
 apply(s, {action: 'save-profile', profile: {activityNotifications: true}}, 'one', t0 + 9500); const kinds = () => communityView(s, 'one', viewer('Resident'), true, t0 + 10000);
 assert.deepEqual(kinds().unread, {complaints: 0, classifieds: 1, activities: 1, total: 2}); apply(s, {action: 'read-all-notifications', kind: 'activity'}, 'one');
 assert.deepEqual(kinds().unread, {complaints: 0, classifieds: 1, activities: 0, total: 1}); assert.throws(() => apply(s, {action: 'read-all-notifications', kind: 'event'}, 'one'), /activity/);
 // Cap: the newest MAX_NOTIFICATIONS survive and read markers for dropped notifications are forgotten.
 s.notifications.push(...Array.from({length: MAX_NOTIFICATIONS}, (_, i) => ({id: `old-${i}`, kind: 'complaint', complaintId: 'x', residentId: 'other', classifiedId: '', title: 't', titleHi: '', body: 'b', bodyHi: '', createdAt: iso(1000 + i)})));
 const next = saveActivity(s, {startsAt: iso(t0), endsAt: iso(t0 + 5 * HOUR)}); publishActivity(s, next, 'published', t0 + 11000);
 assert.equal(s.notifications.length, MAX_NOTIFICATIONS); assert.equal(s.notifications[0].activityId, next, 'newest first'); assert.ok(s.residentProfiles.one.readNotificationIds.every(id => s.notifications.some(n => n.id === id)));
});
test('activity pushes go to registered residents who have not opted out, in their language, with the activity deep-link data', () => {
 const s = seedWorkspace(); const t0 = Date.now() - 100000;
 register(s, 'one', {}, t0); register(s, 'two', {}, t0); register(s, 'three', {language: 'hi'}, t0); register(s, 'four', {}, t0 + 50000);
 apply(s, {action: 'save-profile', profile: {activityNotifications: false}}, 'two', t0 + 1000); apply(s, {action: 'save-profile', profile: {classifiedNotifications: false}}, 'one', t0 + 1000);
 const id = saveActivity(s, {title: 'Tree plantation drive', titleHi: 'वृक्षारोपण अभियान', organizer: 'Panchayat Samiti, Amer', organizerHi: 'पंचायत समिति, आमेर', description: 'Plant a sapling in your neighbourhood.', descriptionHi: 'अपने मोहल्ले में एक पौधा लगाएँ।', startsAt: iso(t0), endsAt: iso(t0 + 5 * HOUR)});
 publishActivity(s, id, 'published', t0 + 5000); const [n] = s.notifications;
 const items = pushItemsFor(s, [n]); assert.deepEqual(items.map(i => i.residentId).sort(), ['one', 'three'], 'opted-out and not-yet-registered residents are excluded; the classified opt-out does not matter');
 for (const item of items) {assert.deepEqual(item.data, {type: 'activity', kind: 'activity', activityId: id, notificationId: n.id}); assert.equal(item.subject, id);}
 const en = items.find(i => i.residentId === 'one'), hi = items.find(i => i.residentId === 'three');
 assert.equal(en.title, 'Tree plantation drive'); assert.equal(en.body, 'Panchayat Samiti, Amer: Plant a sapling in your neighbourhood.');
 assert.equal(hi.title, 'वृक्षारोपण अभियान'); assert.equal(hi.body, 'पंचायत समिति, आमेर: अपने मोहल्ले में एक पौधा लगाएँ।');
 // Without Hindi text a Hindi resident gets the English text; long text is cut to the push limits.
 const plain = saveActivity(s, {title: 'T'.repeat(120), titleHi: '', organizerHi: '', descriptionHi: '', description: 'D'.repeat(300), startsAt: iso(t0), endsAt: iso(t0 + 5 * HOUR)}); publishActivity(s, plain, 'published', t0 + 6000);
 const [fallback] = pushItemsFor(s, [s.notifications[0]]).filter(i => i.residentId === 'three'); assert.equal(fallback.title, 'T'.repeat(120)); assert.equal(fallback.body.length, 180); assert.ok(fallback.body.startsWith('Nagar Parishad, Jaipur: D'));
 assert.equal(pushChannelFor('activity'), 'activities'); assert.equal(pushChannelFor('classified'), 'classifieds'); assert.equal(pushChannelFor('complaint'), 'complaints'); assert.equal(pushChannelFor(undefined), 'complaints');
 // Complaint and classified pushes are unchanged by the new kind.
 const adPush = pushItemsFor(s, [{id: 'x', kind: 'classified', classifiedId: 'ad-1', title: 'Ad', titleHi: '', body: 'b', bodyHi: '', createdAt: iso(t0 + 7000)}]);
 assert.deepEqual(adPush.map(i => i.residentId).sort(), ['three', 'two'], 'classified audience follows the classified preference and consent only'); assert.deepEqual(adPush.map(i => i.data.type), ['classified', 'classified']);
});

/* ------------------------------------------------------------------------------------ admin portal v2: content and configuration (docs/ADMIN_PORTAL_API.md, A2) */

const notice = (over = {}) => ({title: 'Water supply maintenance', titleHi: 'जलापूर्ति रखरखाव', body: 'Water supply will pause on Sunday from 10 AM to 2 PM.', bodyHi: 'रविवार को सुबह 10 से दोपहर 2 बजे तक जलापूर्ति बंद रहेगी।', priority: 'Important', status: 'published', ...over});
const saveNotice = (s, over = {}, now = Date.now()) => apply(s, {action: 'save-announcement', announcement: notice(over)}, 'one', now).id;
const noticeView = (s, now, role = 'Resident') => communityView(s, 'one', viewer(role), role === 'Resident', now).announcements;

test('save-announcement creates and edits ward updates (Hindi text, priority, end time, status); a failed save changes nothing', () => {
 const s = seedWorkspace(); const now = Date.now();
 const id = saveNotice(s, {endsAt: iso(now + HOUR)}, now);
 assert.deepEqual(s.announcements, [{id, title: 'Water supply maintenance', titleHi: 'जलापूर्ति रखरखाव', body: 'Water supply will pause on Sunday from 10 AM to 2 PM.', bodyHi: 'रविवार को सुबह 10 से दोपहर 2 बजे तक जलापूर्ति बंद रहेगी।', priority: 'Important', at: iso(now), endsAt: iso(now + HOUR), status: 'published'}]);
 assert.match(s.audit[0].action, /^Published ward notice: Water supply maintenance/);
 // Editing keeps the id and the original time; the form decides priority, text, end time (omitted = no end) and status.
 assert.equal(apply(s, {action: 'save-announcement', announcement: {...notice({title: 'Water supply maintenance (updated)', priority: 'Emergency'}), id}}, 'one', now + 5000).id, id);
 assert.equal(s.announcements.length, 1); assert.deepEqual([s.announcements[0].at, s.announcements[0].priority, s.announcements[0].title, 'endsAt' in s.announcements[0]], [iso(now), 'Emergency', 'Water supply maintenance (updated)', false]);
 assert.match(s.audit[0].action, /^Updated ward notice/);
 // The Hindi twins and the priority default sensibly when a client leaves them out of an edit; an explicit empty string clears Hindi.
 apply(s, {action: 'save-announcement', announcement: {id, title: 'Water supply maintenance (updated)', body: 'Water supply will pause on Sunday from 10 AM to 2 PM.'}}, 'one', now + 6000);
 assert.deepEqual([s.announcements[0].titleHi, s.announcements[0].priority, s.announcements[0].status], ['जलापूर्ति रखरखाव', 'Emergency', 'published']);
 apply(s, {action: 'save-announcement', announcement: {id, ...notice({titleHi: '', bodyHi: ''})}}, 'one', now + 7000); assert.deepEqual([s.announcements[0].titleHi, s.announcements[0].bodyHi], ['', '']);
 // Validation: every rule, and nothing is stored or audited when one fails.
 const before = JSON.stringify([s.announcements, s.audit]); const bad = (over, pattern, label) => assert.throws(() => apply(s, {action: 'save-announcement', announcement: {...notice(), ...over}}, 'one', now + 8000), pattern, label ?? JSON.stringify(over).slice(0, 60));
 bad({title: 'Hey'}, /Title/); bad({title: 'x'.repeat(121)}, /Title/); bad({title: 12345}, /Title/); bad({body: 'too short'}, /Notice/); bad({body: 'x'.repeat(2001)}, /Notice/);
 bad({titleHi: 'x'.repeat(121)}, /Hindi title/); bad({bodyHi: 'x'.repeat(2001)}, /Hindi notice/); bad({titleHi: 5}, /Hindi title/);
 bad({priority: 'Urgent'}, /priority/i); bad({priority: ''}, /priority/i); bad({priority: ['Event']}, /priority/i);
 bad({status: 'draft'}, /published or archived/); bad({status: 'deleted'}, /published or archived/); bad({status: null}, /published or archived/);
 bad({endsAt: 'tomorrow'}, /End date/); bad({endsAt: 42}, /End date/); bad({endsAt: iso(now - 1000)}, /already passed/);
 bad({id: 'no-such-notice'}, /not found/);
 for (const nope of [undefined, null, 'text', 7]) assert.throws(() => apply(s, {action: 'save-announcement', announcement: nope}), /notice details/);
 assert.equal(JSON.stringify([s.announcements, s.audit]), before, 'rejected saves store and audit nothing');
 // An archived notice may keep an end time in the past (it is hidden anyway); an end time is optional.
 const old = saveNotice(s, {title: 'Finished campaign notice', status: 'archived', endsAt: iso(now - HOUR)}, now); assert.equal(s.announcements.find(a => a.id === old).status, 'archived');
 assert.match(s.audit[0].action, /\(archived\)$/);
});
test('residents see only published notices that have not ended, newest first, with Hindi fields; administrators with announcements.manage see every notice', () => {
 const s = seedWorkspace(); const now = Date.now();
 // A notice stored before Hindi, end times and status existed.
 s.announcements.push({id: 'legacy', title: 'Legacy notice here', body: 'Created before the Hindi fields existed.', priority: 'Service notice', at: iso(now - 5 * HOUR)});
 const live = saveNotice(s, {title: 'Live notice one'}, now - 3 * HOUR), soon = saveNotice(s, {title: 'Ends soon notice', priority: 'Emergency', endsAt: iso(now + HOUR)}, now - 2 * HOUR);
 const ended = saveNotice(s, {title: 'Already ended notice', endsAt: iso(now - HOUR)}, now - 10 * HOUR), archived = saveNotice(s, {title: 'Archived notice', status: 'archived'}, now - HOUR);
 assert.deepEqual(noticeView(s, now).map(a => a.title), ['Ends soon notice', 'Live notice one', 'Legacy notice here'], 'newest first; archived and ended hidden');
 const [first, , legacy] = noticeView(s, now); assert.deepEqual([first.priority, first.titleHi, first.bodyHi, first.status, first.endsAt], ['Emergency', 'जलापूर्ति रखरखाव', notice().bodyHi, 'published', iso(now + HOUR)]);
 assert.deepEqual([legacy.titleHi, legacy.bodyHi, legacy.status], ['', '', 'published'], 'legacy notices are normalised: Hindi empty, status published');
 for (const role of ['Auditor', 'Complaint Officer']) assert.deepEqual(noticeView(s, now, role).map(a => a.id), [soon, live, 'legacy'], `${role} has no announcements.manage`);
 for (const role of ['Content Editor', 'Ward Admin', 'Super Admin']) assert.deepEqual(noticeView(s, now, role).map(a => a.id), [archived, soon, live, 'legacy', ended], role);
 assert.deepEqual(communityView(s, 'one', viewer('Super Admin'), true, now).announcements.map(a => a.id), [soon, live, 'legacy'], 'view=resident previews exactly what residents see');
 // The end time is exclusive; the notice disappears the moment it passes, and a later republish does not duplicate it.
 assert.equal(announcementLive({...s.announcements.find(a => a.id === soon)}, now + HOUR - 1), true); assert.equal(announcementLive({...s.announcements.find(a => a.id === soon)}, now + HOUR), false);
 assert.deepEqual(noticeView(s, now + HOUR).map(a => a.title), ['Live notice one', 'Legacy notice here']);
 assert.equal(announcementLive({status: 'archived'}), false); assert.equal(announcementLive({}), true); assert.deepEqual(announcementsView(undefined, true), []);
 assert.deepEqual(s.announcements.map(a => a.id).length, 5, 'viewing never removes or reorders the stored notices');
 // Nothing hidden leaks through the projected workspace, for residents or for staff without the permission.
 const t = Date.now(); const p = seedWorkspace(); saveNotice(p, {title: 'Public notice for all'}, t - 1000); saveNotice(p, {title: 'SECRET archived notice', status: 'archived'}, t - 900); saveNotice(p, {title: 'SECRET ended notice', endsAt: iso(t + 50)}, t - 800); p.announcements.find(a => a.title.includes('ended')).endsAt = iso(t - 1);
 for (const [principal, resident] of [[who('Resident'), true], [who('Auditor'), false], [who('Complaint Officer'), false], [who('Super Admin'), true]]) assert.equal(JSON.stringify({...projectWorkspace(p, principal, resident), audit: []}).includes('SECRET'), false, principal.viewer.role);
 assert.equal(projectWorkspace(p, who('Content Editor'), false).announcements.length, 3);
});
test('the old announcement action keeps working and writes the new shape; delete-announcement removes a notice for good', async () => {
 const s = seedWorkspace(); await applyAction(s, {action: 'announcement', title: 'Road work on Main Street', body: 'Expect delays between 9 AM and 5 PM.'}, 'admin');
 assert.deepEqual([s.announcements[0].priority, s.announcements[0].status, s.announcements[0].titleHi], ['Service notice', 'published', '']);
 await assert.rejects(applyAction(s, {action: 'announcement', title: 'Road work on Main Street', body: 'Expect delays.'}, 'resident'), e => e.code === 403);
 const id = saveNotice(s, {title: 'To be deleted soon'}); const audits = s.audit.length;
 assert.throws(() => apply(s, {action: 'delete-announcement', id: 'missing'}), /not found/); assert.throws(() => apply(s, {action: 'delete-announcement'}), /not found/); assert.equal(s.audit.length, audits);
 assert.deepEqual(apply(s, {action: 'delete-announcement', id}), {id, deleted: true}); assert.equal(s.announcements.some(a => a.id === id), false); assert.match(s.audit[0].action, /^Deleted ward notice: To be deleted soon/); assert.equal(s.audit[0].complaintId, id);
 assert.throws(() => apply(s, {action: 'delete-announcement', id}), /not found/, 'a second delete is refused');
});

test('editing a published ad keeps it published and visible; new ads are drafts; drafts stay drafts and archived ads stay archived; advertiserHi is stored and kept', () => {
 const s = seedWorkspace(); register(s, 'one'); const visible = () => communityView(s, 'one', viewer('Resident'), true).classifieds.length;
 const saved = apply(s, {action: 'save-classified', classified: {...makeAd(), advertiserHi: 'सामुदायिक केंद्र'}}); const id = saved.id; assert.equal(saved.status, 'draft'); assert.equal(s.classifieds[0].status, 'draft'); assert.equal(s.classifieds[0].advertiserHi, 'सामुदायिक केंद्र');
 apply(s, {action: 'save-classified', classified: {...makeAd(), id, title: 'Crafts fair, new title'}}); assert.equal(s.classifieds[0].status, 'draft'); assert.equal(s.classifieds[0].advertiserHi, 'सामुदायिक केंद्र', 'a field the client did not send keeps its value');
 assert.equal(apply(s, {action: 'publish-classified', id, status: 'published'}).notificationCreated, true); assert.equal(visible(), 1); const publishedAt = s.classifieds[0].publishedAt;
 assert.equal(apply(s, {action: 'save-classified', classified: {...makeAd(), id, title: 'Crafts fair, edited while live', advertiserHi: ''}}).status, 'published');
 assert.deepEqual([s.classifieds[0].status, s.classifieds[0].title, s.classifieds[0].publishedAt, s.classifieds[0].advertiserHi], ['published', 'Crafts fair, edited while live', publishedAt, '']); assert.equal(visible(), 1, 'still visible right after the edit');
 assert.equal(s.notifications.length, 1, 'editing never notifies again'); assert.match(s.audit[0].action, /^Updated classified \(published\)/);
 assert.throws(() => apply(s, {action: 'save-classified', classified: {...makeAd(), id, advertiserHi: 'x'.repeat(151)}}), /Hindi advertiser/);
 apply(s, {action: 'publish-classified', id, status: 'archived'}); apply(s, {action: 'save-classified', classified: {...makeAd(), id, title: 'Edited while archived'}}); assert.equal(s.classifieds[0].status, 'archived'); assert.equal(visible(), 0);
 apply(s, {action: 'publish-classified', id, status: 'published'}); assert.equal(visible(), 1, 'an explicit publish still works after an archive');
});
test('delete-classified, delete-activity and delete-place remove the record, its inbox notifications and read markers; images stay in storage but stop being readable through content', () => {
 const s = seedWorkspace(); const t0 = Date.now() - 100000; register(s, 'one', {}, t0); const resident = who('Resident', 'res-a'), other = who('Resident', 'res-b'), editor = who('Content Editor', 'ed');
 const ad = apply(s, {action: 'save-classified', classified: {...makeAd(), startsAt: iso(t0), imageId: 'ad-art'}}).id; apply(s, {action: 'publish-classified', id: ad, status: 'published'}, 'x', t0 + 5000);
 const act = saveActivity(s, {imageId: 'act-art', startsAt: iso(t0), endsAt: iso(t0 + 5 * HOUR)}); publishActivity(s, act, 'published', t0 + 6000);
 const place = apply(s, {action: 'save-place', place: {name: 'Hawa Mahal', nameHi: 'हवा महल', description: 'The Palace of Winds in the old city.', descriptionHi: '', address: 'Badi Choupad, Jaipur', hours: '9 AM to 5 PM', imageId: 'place-art', mapUrl: '', sourceUrl: '', published: true, sortOrder: 0}}).id;
 const view = () => communityView(s, 'one', viewer('Resident'), true, t0 + 7000); assert.equal(view().notifications.length, 2); apply(s, {action: 'read-all-notifications'}, 'one'); assert.equal(s.residentProfiles.one.readNotificationIds.length, 2);
 for (const art of ['ad-art', 'act-art', 'place-art']) assert.equal(canReadMedia(s, other, art, 'res-a'), true, `${art} readable while the content is visible`);
 // Deleting an ad takes only its own notification; the read marker of the other one stays.
 assert.deepEqual(apply(s, {action: 'delete-classified', id: ad}), {id: ad, deleted: true}); assert.equal(s.classifieds.length, 0); assert.deepEqual(s.notifications.map(n => n.kind), ['activity']); assert.equal(s.residentProfiles.one.readNotificationIds.length, 1);
 assert.equal(view().classifieds.length, 0); assert.deepEqual(view().notifications.map(n => n.kind), ['activity']); assert.match(s.audit[0].action, /^Deleted classified: Local crafts fair/); assert.equal(s.audit[0].complaintId, ad);
 assert.equal(canReadMedia(s, other, 'ad-art', 'res-a'), false, 'the image is unreferenced now: only its uploader could read it'); assert.equal(canReadMedia(s, resident, 'ad-art', 'res-a'), true); assert.equal(canReadMedia(s, editor, 'ad-art', 'res-a'), false, 'staff keep no access through the deleted content');
 assert.deepEqual(apply(s, {action: 'delete-activity', id: act}), {id: act, deleted: true}); assert.equal(s.activities.length, 0); assert.deepEqual(s.notifications, []); assert.deepEqual(s.residentProfiles.one.readNotificationIds, []); assert.equal(view().activities.length, 0); assert.match(s.audit[0].action, /^Deleted activity: /);
 assert.equal(canReadMedia(s, other, 'act-art', 'res-a'), false);
 assert.deepEqual(apply(s, {action: 'delete-place', id: place}), {id: place, deleted: true}); assert.equal(s.places.length, 0); assert.match(s.audit[0].action, /^Deleted place: Hawa Mahal/); assert.equal(canReadMedia(s, other, 'place-art', 'res-a'), false);
 for (const action of ['delete-classified', 'delete-activity', 'delete-place']) {assert.throws(() => apply(s, {action, id: 'missing'}), /not found/, action); assert.throws(() => apply(s, {action}), /not found/, action);}
 assert.throws(() => apply(s, {action: 'delete-classified', id: act}), /not found/, 'ids of another kind are not found');
});
test('every new admin action needs its permission: residents and administrators without it are refused', () => {
 const expected = {'save-announcement': 'announcements.manage', 'delete-announcement': 'announcements.manage', 'delete-classified': 'classifieds.manage', 'delete-activity': 'activities.manage', 'delete-place': 'city.manage', 'save-app-config': 'appconfig.manage', 'save-teams': 'settings.manage'};
 for (const [action, permission] of Object.entries(expected)) {
  assert.equal(actionPermissions[action], permission, action); assert.ok(permissions.includes(permission));
  assert.throws(() => requireAction(viewer('Resident'), permission), e => e.code === 403, `${action}: resident`);
  assert.throws(() => requireAction({role: 'Custom', permissions: permissions.filter(p => p !== permission)}, permission), e => e.code === 403, `${action}: every other permission`);
  assert.throws(() => requireAction({role: 'Custom', permissions: []}, permission), e => e.code === 403);
  assert.doesNotThrow(() => requireAction({role: 'Custom', permissions: [permission]}, permission), action); assert.doesNotThrow(() => requireAction(viewer('Super Admin'), permission), action);
 }
 // Roles: a Content Editor runs ward updates, ads, activities, the city guide and app settings, but not teams; a Complaint Officer or Auditor none of them.
 for (const action of ['save-announcement', 'delete-announcement', 'delete-classified', 'delete-activity', 'delete-place', 'save-app-config']) assert.doesNotThrow(() => requireAction(viewer('Content Editor'), expected[action]), action);
 assert.throws(() => requireAction(viewer('Content Editor'), expected['save-teams']), e => e.code === 403); assert.doesNotThrow(() => requireAction(viewer('Ward Admin'), expected['save-teams']));
 for (const role of ['Complaint Officer', 'Auditor']) for (const permission of Object.values(expected)) assert.throws(() => requireAction(viewer(role), permission), e => e.code === 403, `${role}: ${permission}`);
});

const configOf = (over = {}) => ({...defaultAppConfig(), orgLabel: {en: 'Nagar Parishad, Jaipur', hi: 'नगर परिषद, जयपुर'}, support: {phone: '+91 141 234 5678', email: 'help@example.org', hoursEn: 'Monday–Saturday, 10 AM–5 PM', hoursHi: 'सोमवार–शनिवार, सुबह 10 से शाम 5'}, termsUrl: 'https://example.org/terms', privacyUrl: 'https://example.org/privacy', tabs: {classifieds: true, activities: false, city: true}, tiles: {classifieds: true, activities: false, city: true, notices: true}, maintenance: {enabled: true, messageEn: 'Complaint updates may be delayed tonight.', messageHi: 'आज रात शिकायतों के अपडेट में देरी हो सकती है।'}, minAppVersion: '1.2.0', ...over});
test('save-app-config validates every field per the contract and stores a clean copy; defaults apply until one is saved', () => {
 const s = seedWorkspace(); assert.equal(s.settings.appConfig, undefined); assert.deepEqual(resolveAppConfig(s.settings.appConfig), defaultAppConfig());
 const good = configOf(); assert.deepEqual(apply(s, {action: 'save-app-config', appConfig: good}), {}); assert.deepEqual(s.settings.appConfig, good); assert.match(s.audit[0].action, /^Updated app settings/);
 // Whitespace is trimmed, unknown keys are dropped, empty optional fields are accepted, a Hindi maintenance message is optional.
 apply(s, {action: 'save-app-config', appConfig: {...good, evil: 'x', orgLabel: {en: '  Nagar Parishad  ', hi: ' नगर परिषद ', extra: 1}, support: {phone: ' 0141-2345678 ', email: ' help@example.org ', hoursEn: '', hoursHi: '', admin: true}, termsUrl: '  https://example.org/terms  ', privacyUrl: '', maintenance: {enabled: false, messageEn: '', messageHi: ''}, minAppVersion: ' 10.20.30 '}});
 assert.deepEqual(s.settings.appConfig, configOf({orgLabel: {en: 'Nagar Parishad', hi: 'नगर परिषद'}, support: {phone: '0141-2345678', email: 'help@example.org', hoursEn: '', hoursHi: ''}, privacyUrl: '', maintenance: {enabled: false, messageEn: '', messageHi: ''}, minAppVersion: '10.20.30'}));
 assert.deepEqual(validateAppConfig({...good, minAppVersion: ''}).minAppVersion, '');
 // Every rule. Nothing is stored (or audited) when one fails.
 const stored = JSON.stringify([s.settings, s.audit]); const bad = (over, pattern, label) => assert.throws(() => apply(s, {action: 'save-app-config', appConfig: {...good, ...over}}), pattern, label ?? JSON.stringify(over).slice(0, 70));
 for (const url of ['http://example.org/terms', 'ftp://example.org', 'javascript:alert(1)', 'data:text/html,hi', 'https://user:secret@example.org', 'https://exa mple.org', 'example.org/terms', 'https://', 'https:///path', 'HTTPS:\\\\example.org', 'https://example.org/' + 'a'.repeat(1000), 7]) {bad({termsUrl: url}, /Terms of use link/, `terms ${String(url).slice(0, 30)}`); bad({privacyUrl: url}, /Privacy policy link/, `privacy ${String(url).slice(0, 30)}`);}
 bad({support: {...good.support, phone: '1'.repeat(31)}}, /phone/i); bad({support: {...good.support, phone: 'call the office'}}, /phone/i); bad({support: {...good.support, phone: 5}}, /phone/i);
 for (const email of ['not-an-email', 'a@b', 'a b@example.org', '@example.org', 'help@example', 'x'.repeat(121) + '@example.org']) bad({support: {...good.support, email}}, /email/i, `email ${email.slice(0, 20)}`);
 bad({support: {...good.support, hoursEn: 'x'.repeat(201)}}, /Support hours/); bad({support: {...good.support, hoursHi: 'x'.repeat(201)}}, /Support hours/); bad({support: {...good.support, hoursEn: 'line one\nline two'}}, /Support hours/);
 bad({maintenance: {...good.maintenance, messageEn: 'x'.repeat(301)}}, /Maintenance message/); bad({maintenance: {...good.maintenance, messageHi: 'x'.repeat(301)}}, /Maintenance message/); bad({maintenance: {enabled: true, messageEn: '', messageHi: ''}}, /Maintenance message/); bad({maintenance: {enabled: true, messageEn: '  ', messageHi: 'हिन्दी'}}, /Maintenance message/);
 for (const v of ['1.2', '1', '1.2.3.4', 'v1.2.3', '1.2.x', '1..3', '1.2.-3', '123456.0.0', ' 1. 2.3', 'latest', 5, true]) bad({minAppVersion: v}, /Minimum app version/, `version ${v}`);
 for (const v of ['yes', 1, 0, null, undefined, 'true', {}]) {bad({tabs: {...good.tabs, activities: v}}, /Activities tab/, `tab ${String(v)}`); bad({tiles: {...good.tiles, notices: v}}, /Ward updates tile/, `tile ${String(v)}`); bad({maintenance: {...good.maintenance, enabled: v}}, /Maintenance mode/, `maintenance ${String(v)}`);}
 for (const key of ['classifieds', 'activities', 'city']) {const {[key]: _drop, ...rest} = good.tabs; bad({tabs: rest}, /tab/i, `tab ${key} missing`);}
 for (const key of ['orgLabel', 'support', 'tabs', 'tiles', 'maintenance']) bad({[key]: undefined}, /missing/i, `${key} missing`);
 bad({orgLabel: {en: '', hi: 'नगर परिषद'}}, /Organisation name/); bad({orgLabel: {en: 'Nagar Parishad', hi: ''}}, /Organisation name/); bad({orgLabel: {en: 'x'.repeat(101), hi: 'नगर परिषद'}}, /Organisation name/);
 for (const nope of [undefined, null, 'x', 5, [], true]) assert.throws(() => apply(s, {action: 'save-app-config', appConfig: nope}), /App settings/, JSON.stringify(nope));
 assert.equal(JSON.stringify([s.settings, s.audit]), stored, 'rejected saves store and audit nothing');
});
test('the app configuration reaches residents and administrators in the projected settings; the team list stays internal', () => {
 const s = seedWorkspace(); const good = configOf();
 for (const [principal, resident] of [[who('Resident'), true], [who('Content Editor'), false], [who('Super Admin'), false]]) assert.deepEqual(projectWorkspace(s, principal, resident).settings.appConfig, defaultAppConfig(), `defaults before anything is saved: ${principal.viewer.role}`);
 apply(s, {action: 'save-app-config', appConfig: good});
 for (const [principal, resident] of [[who('Resident'), true], [who('Resident', 'demo-resident'), true], [who('Auditor'), false], [who('Content Editor'), false], [who('Super Admin'), false], [who('Super Admin'), true]]) assert.deepEqual(projectWorkspace(s, principal, resident).settings.appConfig, good, principal.viewer.role);
 s.settings.appConfig = {support: {phone: '0141-2345678'}, tabs: {city: false}}; // a partial or older stored value still resolves to a complete config
 const resolved = projectWorkspace(s, who('Resident'), true).settings.appConfig; assert.deepEqual([resolved.support.phone, resolved.support.hoursEn, resolved.tabs, resolved.tiles.notices, resolved.orgLabel.en], ['0141-2345678', '', {classifieds: true, activities: true, city: false}, true, defaultAppConfig().orgLabel.en]);
 // Teams: administrators who work complaints or settings get the list (default until saved); residents and content-only staff never do.
 assert.deepEqual(projectWorkspace(s, who('Complaint Officer'), false).settings.teams, defaultTeams); assert.deepEqual(projectWorkspace(s, who('Super Admin'), false).settings.teams, defaultTeams);
 for (const [principal, resident] of [[who('Resident'), true], [who('Content Editor'), false], [who('Super Admin'), true]]) assert.equal('teams' in projectWorkspace(s, principal, resident).settings, false, principal.viewer.role);
 s.settings.teams = ['Secret Roads Squad', 'Water']; assert.equal(JSON.stringify(projectWorkspace(s, who('Resident'), true)).includes('Secret Roads Squad'), false); assert.deepEqual(projectWorkspace(s, who('Auditor'), false).settings.teams, ['Secret Roads Squad', 'Water']);
});
test('publicAppConfig is the unauthenticated payload: configuration only, with defaults before anything is configured', () => {
 const s = seedWorkspace(); const empty = publicAppConfig(null);
 assert.deepEqual(Object.keys(empty).sort(), ['appConfig', 'city', 'contact', 'ward']); assert.deepEqual(empty, {appConfig: defaultAppConfig(), ward: '', city: '', contact: ''}); assert.deepEqual(publicAppConfig(undefined), empty);
 assert.deepEqual(publicAppConfig(s.settings), empty);
 apply(s, {action: 'save-app-config', appConfig: configOf()}); s.settings.ward = 'Ward 7'; s.settings.city = 'Ajmer'; s.settings.splashImageId = 'splash-secret'; s.settings.brandingBanners = [{id: 'b', imageId: 'banner-secret', title: 'x', enabled: false}]; s.settings.teams = ['Secret team']; s.settings.slaHours = 99;
 const shown = publicAppConfig(s.settings); assert.deepEqual(Object.keys(shown).sort(), ['appConfig', 'city', 'contact', 'ward']); assert.deepEqual([shown.appConfig, shown.ward, shown.city], [configOf(), 'Ward 7', 'Ajmer']);
 for (const secret of ['splash-secret', 'banner-secret', 'Secret team', 'slaHours', 'residentProfiles', 'complaints']) assert.equal(JSON.stringify(shown).includes(secret), false, secret);
 assert.deepEqual(publicAppConfig({appConfig: {tabs: {city: false}}}).appConfig.tabs, {classifieds: true, activities: true, city: false}, 'a partial stored value is completed with defaults');
});

test('save-teams validates the list, stores it in settings.teams, and complaint assignment follows it; renaming does not rewrite history', async () => {
 const s = seedWorkspace(); assert.deepEqual(teamsOf(s.settings), defaultTeams); assert.equal(MAX_TEAMS, 12);
 const stored = () => JSON.stringify([s.settings, s.audit]); const before = stored(); const bad = (teams, pattern, label) => assert.throws(() => apply(s, {action: 'save-teams', teams}), pattern, label ?? String(JSON.stringify(teams)).slice(0, 60));
 bad([], /between 1 and 12/); bad(undefined, /between 1 and 12/); bad('Roads', /between 1 and 12/); bad(null, /between 1 and 12/); bad({length: 2}, /between 1 and 12/); bad(Array.from({length: 13}, (_, i) => `Team number ${i}`), /between 1 and 12/);
 bad(['A'], /2–60/); bad(['x'.repeat(61)], /2–60/); bad(['Valid team', ''], /2–60/); bad(['Valid team', '   '], /2–60/); bad(['Valid\u0007team'], /2–60/); bad([5], /name/); bad([null], /name/); bad(['Roads', 'roads'], /twice/); bad(['Roads', '  ROADS  '], /twice/); bad(['Water  Team', 'water team'], /twice/);
 assert.equal(stored(), before, 'rejected saves change nothing');
 const twelve = Array.from({length: 12}, (_, i) => `Team number ${i + 1}`); apply(s, {action: 'save-teams', teams: twelve}); assert.deepEqual(s.settings.teams, twelve);
 apply(s, {action: 'save-teams', teams: ['Roads & Infrastructure', '  Sanitation   Team ', 'Street Lighting']}); assert.deepEqual(s.settings.teams, ['Roads & Infrastructure', 'Sanitation Team', 'Street Lighting']); assert.match(s.audit[0].action, /^Updated teams: Roads & Infrastructure, Sanitation Team, Street Lighting/);
 assert.deepEqual(validateTeams(['Ward office']), ['Ward office']);
 // A complaint assigned to a team that was later removed keeps its history; new assignments must use the saved list.
 s.complaints.push(complaint({id: 'WC-T-2', status: 'Assigned', assignee: 'Electrical Team', history: [{status: 'Assigned', note: 'Assigned to the Electrical Team.', at: iso(2000), actor: 'x'}]}));
 const history = JSON.stringify(s.complaints[0].history); apply(s, {action: 'save-teams', teams: ['Roads & Infrastructure', 'Street Lighting']});
 assert.equal(s.complaints[0].assignee, 'Electrical Team'); assert.equal(JSON.stringify(s.complaints[0].history), history, 'history is untouched by a team list change');
 await applyAction(s, {action: 'edit', id: 'WC-T-2', assignee: 'Street Lighting'}, 'admin'); assert.equal(s.complaints[0].assignee, 'Street Lighting');
 await assert.rejects(applyAction(s, {action: 'edit', id: 'WC-T-2', assignee: 'Electrical Team'}, 'admin'), /Unknown team/, 'a team that is not in the saved list cannot be assigned');
 await assert.rejects(applyAction(s, {action: 'edit', id: 'WC-T-2', assignee: 'Sanitation Team'}, 'admin'), /Unknown team/);
 await applyAction(s, {action: 'edit', id: 'WC-T-2', priority: 'High'}, 'admin'); assert.equal(s.complaints[0].priority, 'High', 'other edits do not revalidate the current assignee');
 // Until a list is saved the default one applies to assignment too.
 const fresh = seedWorkspace(); fresh.complaints.push(complaint({id: 'WC-T-3'})); await applyAction(fresh, {action: 'edit', id: 'WC-T-3', assignee: 'Sanitation Team'}, 'admin'); assert.equal(fresh.complaints[0].assignee, 'Sanitation Team');
});
test('Hindi twins: place addressHi / hoursHi, municipality districtHi / stateHi and classified advertiserHi persist, survive edits that omit them, and clear on an explicit empty string', () => {
 const s = seedWorkspace(); const place = {name: 'Jal Mahal', nameHi: 'जल महल', description: 'A palace in the middle of the lake.', descriptionHi: '', address: 'Man Sagar Lake, Jaipur', addressHi: 'मान सागर झील, जयपुर', hours: '9 AM to 5 PM', hoursHi: 'सुबह 9 से शाम 5', imageId: '', mapUrl: '', sourceUrl: '', published: true, sortOrder: 1};
 const id = apply(s, {action: 'save-place', place}).id; assert.deepEqual([s.places[0].addressHi, s.places[0].hoursHi], ['मान सागर झील, जयपुर', 'सुबह 9 से शाम 5']);
 const {addressHi, hoursHi, ...older} = place; apply(s, {action: 'save-place', place: {...older, id, name: 'Jal Mahal Palace'}}); assert.deepEqual([s.places[0].name, s.places[0].addressHi, s.places[0].hoursHi], ['Jal Mahal Palace', 'मान सागर झील, जयपुर', 'सुबह 9 से शाम 5']);
 apply(s, {action: 'save-place', place: {...place, id, addressHi: '', hoursHi: ''}}); assert.deepEqual([s.places[0].addressHi, s.places[0].hoursHi], ['', '']);
 assert.throws(() => apply(s, {action: 'save-place', place: {...place, id, addressHi: 'x'.repeat(301)}}), /Hindi address/); assert.throws(() => apply(s, {action: 'save-place', place: {...place, id, hoursHi: 'x'.repeat(201)}}), /Hindi visiting hours/);
 const city = {name: 'Jaipur', nameHi: 'जयपुर', district: 'Jaipur', districtHi: 'जयपुर', state: 'Rajasthan', stateHi: 'राजस्थान', about: '', aboutHi: '', history: '', historyHi: '', sourceUrl: '', published: false};
 apply(s, {action: 'save-municipality', municipality: city}); assert.deepEqual([s.municipality.districtHi, s.municipality.stateHi], ['जयपुर', 'राजस्थान']);
 const {districtHi, stateHi, ...legacyCity} = city; apply(s, {action: 'save-municipality', municipality: {...legacyCity, about: 'Heritage city'}}); assert.deepEqual([s.municipality.about, s.municipality.districtHi, s.municipality.stateHi], ['Heritage city', 'जयपुर', 'राजस्थान'], 'an older client that omits them keeps them');
 apply(s, {action: 'save-municipality', municipality: {...city, districtHi: '', stateHi: ''}}); assert.deepEqual([s.municipality.districtHi, s.municipality.stateHi], ['', '']);
 assert.throws(() => apply(s, {action: 'save-municipality', municipality: {...city, districtHi: 'x'.repeat(81)}}), /Hindi district/); assert.throws(() => apply(s, {action: 'save-municipality', municipality: {...city, stateHi: 'x'.repeat(81)}}), /Hindi state/);
 // Residents get the Hindi twins with the rest of the published content.
 const view = communityView(s, 'one', viewer('Resident'), true); assert.equal(view.places[0].addressHi, ''); apply(s, {action: 'save-place', place: {...place, id}}); assert.equal(communityView(s, 'one', viewer('Resident'), true).places[0].addressHi, 'मान सागर झील, जयपुर');
});
test('the contact line and the legacy ward and city labels start empty and are edited through settings (slaHours is still required and validated); banners carry a Hindi caption', async () => {
 const s = seedWorkspace(); assert.deepEqual([s.settings.ward, s.settings.city, s.settings.contact], ['', '', '']); await applyAction(s, {action: 'settings', slaHours: 48}, 'admin'); assert.deepEqual([s.settings.ward, s.settings.city, s.settings.contact, s.settings.slaHours], ['', '', '', 48], 'omitted values stay (a contact line is optional)');
 await applyAction(s, {action: 'settings', contact: 'Ward office · Monday–Saturday', slaHours: 48}, 'admin'); assert.equal(s.settings.contact, 'Ward office · Monday–Saturday');
 await applyAction(s, {action: 'settings', contact: 'Ward office · Monday–Saturday', slaHours: 72, ward: ' Ward 7 ', city: 'Ajmer'}, 'admin'); assert.deepEqual([s.settings.ward, s.settings.city, s.settings.slaHours], ['Ward 7', 'Ajmer', 72]); assert.equal(s.audit[0].action, 'Service settings updated');
 await applyAction(s, {action: 'settings', slaHours: 72, ward: '  ', city: null}, 'admin'); assert.deepEqual([s.settings.ward, s.settings.city, s.settings.contact], ['', 'Ajmer', 'Ward office · Monday–Saturday'], 'an empty label clears it, null or a missing value keeps it');
 await applyAction(s, {action: 'settings', contact: '', slaHours: 72, ward: 'Ward 7'}, 'admin'); assert.deepEqual([s.settings.ward, s.settings.contact], ['Ward 7', ''], 'an empty contact line clears it');
 for (const bad of [{ward: 'W'}, {city: 'x'}, {ward: 'x'.repeat(61)}, {city: 5}, {ward: ['Ward 9']}, {slaHours: 0}, {slaHours: 721}, {contact: 'abc'}, {contact: 7}, {contact: 'x'.repeat(201)}]) await assert.rejects(applyAction(s, {action: 'settings', contact: 'Ward office · Monday–Saturday', slaHours: 72, ...bad}, 'admin'), e => e instanceof ServiceError, JSON.stringify(bad));
 assert.deepEqual([s.settings.ward, s.settings.city, s.settings.slaHours], ['Ward 7', 'Ajmer', 72], 'a rejected save changes nothing');
 await assert.rejects(applyAction(s, {action: 'settings', contact: 'Ward office · Monday–Saturday', slaHours: 72, ward: 'Ward 9'}, 'resident'), e => e.code === 403);
 const banner = {id: 'b1', imageId: 'img-1', title: 'Councillor', enabled: true, caption: 'Meet your ward councillor', captionHi: 'अपने वार्ड पार्षद से मिलें'};
 await applyAction(s, {action: 'save-banners', banners: [banner, {id: 'b2', imageId: 'img-2', title: 'Plain', enabled: true, captionHi: '   '}, {id: 'b3', imageId: 'img-3', title: 'English only', enabled: true, caption: 'Hello'}]}, 'admin');
 assert.deepEqual(s.settings.brandingBanners, [banner, {id: 'b2', imageId: 'img-2', title: 'Plain', enabled: true}, {id: 'b3', imageId: 'img-3', title: 'English only', enabled: true, caption: 'Hello'}]);
 await assert.rejects(applyAction(s, {action: 'save-banners', banners: [{...banner, captionHi: 'x'.repeat(141)}]}, 'admin'), e => e instanceof ServiceError);
 assert.equal(projectWorkspace(s, who('Resident'), true).settings.brandingBanners[0].captionHi, 'अपने वार्ड पार्षद से मिलें');
});
