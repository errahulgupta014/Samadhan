import test from 'node:test';
import assert from 'node:assert/strict';
import {buildModules} from './build-ts.mjs';
// Unit tests for the App users feature: administrators list, edit, block and unblock registered residents (permission residents.manage).
// The HTTP enforcement (403 {code: 'account_blocked'} on every resident path, verify-otp refusal, session handling) runs against a dev server in tests/resident-api.mjs.
buildModules(['shared/domain', 'shared/community', 'shared/access', 'lib/service', 'lib/community-service', 'lib/projection', 'lib/access-policy', 'lib/media-access', 'lib/wards', 'lib/complaint-wards', 'lib/notifications', 'lib/resident-profile'], 'tests/.residents');
const {seedWorkspace: freshWorkspace} = await import('./.residents/domain.mjs');
/** A brand-new workspace has no wards (administrators add them in the portal); these tests start from one ward, the way an administrator would have set it up. */
const seedWorkspace = () => ({...freshWorkspace(), wards: [{id: 'ward-12', number: '12', name: 'Ward 12', nameHi: 'वार्ड 12', city: 'Jaipur', memberName: '', memberNameHi: '', memberPhotoId: '', active: true}]});
const {rolePresets, permissions, actionPermissions} = await import('./.residents/access.mjs');
const {ServiceError} = await import('./.residents/service.mjs');
const {applyCommunityAction, communityView, ensureCommunity} = await import('./.residents/community-service.mjs');
const {projectWorkspace} = await import('./.residents/projection.mjs');
const {requireAction} = await import('./.residents/access-policy.mjs');
const {canReadMedia} = await import('./.residents/media-access.mjs');
const {recordStatusChanges, statusSnapshot, residentNotifications, classifiedAudience, activityAudience, pushItemsFor, dropBlockedCommunications} = await import('./.residents/notifications.mjs');
const {registerProfile, adminResidents, wardLabelOf, applyResidentEdit, applyBlock, isBlocked, assertNotBlocked, AccountBlockedError, ACCOUNT_BLOCKED_MESSAGE, ACCOUNT_BLOCKED_CODE} = await import('./.residents/resident-profile.mjs');

const iso = ms => new Date(ms).toISOString();
const T0 = Date.UTC(2026, 9, 1, 9, 0, 0), HOUR = 3600 * 1000;
const viewer = role => ({role, permissions: [...(rolePresets[role] ?? [])], email: 'admin@example.test'});
const custom = list => ({role: 'Custom', permissions: list, email: 'custom@example.test'});
const who = (v, residentId = 'admin:1') => ({role: v.role === 'Resident' ? 'resident' : 'admin', viewer: v, residentId, owner: 'tenant'});
const MOBILES = {asha: '9876500001', bina: '9876500002', chitra: '9876500003'};
const apply = (s, body, now = T0 + 24 * HOUR) => applyCommunityAction(s, body, 'admin:1', 'admin@example.test', now);
const rejects = (fn, code, pattern) => assert.throws(fn, e => e instanceof ServiceError && (code === undefined || e.code === code) && (!pattern || pattern.test(e.message)), `expected ServiceError ${code ?? ''} ${pattern ?? ''}`);
const complaint = (over = {}) => ({id: 'WC-1', title: 'Broken light', description: 'The streetlight is broken.', category: 'Streetlight & Electrical', categoryId: 'streetlights', locality: 'Park Road', lat: 26.9, lng: 75.8, priority: 'Normal', status: 'Submitted', assignee: '', resident: 'Asha Verma', mobile: MOBILES.asha, residentId: 'res-asha', createdAt: iso(T0), dueAt: iso(T0 + 99 * HOUR), history: [{status: 'Submitted', note: 'Filed.', at: iso(T0), actor: 'Resident'}], media: ['m'], afterMedia: [], ...over});
const makeAd = () => ({title: 'Local crafts fair', titleHi: '', description: 'Discover handmade crafts at the local fair.', descriptionHi: '', advertiser: 'Community centre', contactPhone: '', url: '', imageId: '', startsAt: iso(T0), endsAt: iso(T0 + 10 * 24 * HOUR)});
const makeActivity = () => ({title: 'Tree plantation drive', titleHi: '', organizer: 'Panchayat Samiti', organizerHi: '', description: 'Plant a sapling in your neighbourhood.', descriptionHi: '', venue: '', venueHi: '', startsAt: iso(T0 + 30 * HOUR), endsAt: iso(T0 + 36 * HOUR), imageId: '', contactPhone: '', url: ''});

/** A live workspace with three registered residents (Asha 12, Bina 9, Chitra 12), an inactive ward and a couple of complaints. */
function workspace() {
 const s = seedWorkspace(); ensureCommunity(s);
 s.wards.push({id: 'ward-9', number: '9', name: 'Nehru Colony', nameHi: '', city: 'Jaipur', memberName: '', memberNameHi: '', memberPhotoId: 'ward-photo-9', active: true}, {id: 'ward-old', number: '7', name: 'Old Ward', nameHi: '', city: 'Jaipur', memberName: '', memberNameHi: '', memberPhotoId: '', active: false});
 const add = (key, name, wardId, at, extra = {}) => registerProfile(s, {name, wardId, address: `${key} Market Road, Jaipur`, photoId: `photo-${key}`, email: `${key}@example.org`, consent: true, ...extra}, `res-${key}`, MOBILES[key], iso(at));
 add('asha', 'Asha Verma', 'ward-12', T0); add('bina', 'Bina Rao', 'ward-9', T0 + HOUR); add('chitra', 'Chitra Nair', 'ward-12', T0 + 2 * HOUR, {language: 'hi'});
 s.complaints.push(complaint({id: 'WC-1'}), complaint({id: 'WC-2', status: 'In Progress'}), complaint({id: 'WC-3', status: 'Closed'}), complaint({id: 'WC-4', resident: 'Bina Rao', mobile: MOBILES.bina, residentId: 'res-bina'}));
 return s;
}
const edit = (over = {}) => ({action: 'save-resident', id: 'res-asha', name: 'Asha Verma', email: 'asha@example.org', address: '12 Market Road, Jaipur', wardId: 'ward-12', ...over});
const block = (over = {}) => ({action: 'block-resident', id: 'res-asha', blocked: true, reason: 'Repeated abusive language towards staff.', ...over});

/* ---------------------------------------------------------------- listing */

test('adminResidents lists registered residents only, newest registration first, with real mobile, ward label and complaint count', () => {
 const s = workspace(); s.residentProfiles['res-ghost'] = {id: 'res-ghost', name: 'Not registered', mobile: '', email: '', address: '', wardId: '', photoId: '', language: 'en', classifiedNotifications: true, activityNotifications: true, notificationConsentAt: null, readNotificationIds: [], registeredAt: null, updatedAt: iso(T0)};
 const list = adminResidents(s);
 assert.deepEqual(list.map(r => r.name), ['Chitra Nair', 'Bina Rao', 'Asha Verma'], 'newest first; the unregistered profile is not an app user');
 const asha = list.find(r => r.id === 'res-asha');
 assert.deepEqual(Object.keys(asha).sort(), ['activityNotifications', 'address', 'blocked', 'blockedAt', 'blockedReason', 'classifiedNotifications', 'complaintCount', 'email', 'id', 'language', 'mobile', 'name', 'photoId', 'registeredAt', 'wardId', 'wardLabel']);
 assert.equal(asha.mobile, MOBILES.asha, 'administrators with residents.manage see the real mobile number');
 assert.equal(asha.wardLabel, 'Ward 12'); assert.equal(asha.complaintCount, 3); assert.equal(list.find(r => r.id === 'res-bina').complaintCount, 1); assert.equal(list.find(r => r.id === 'res-chitra').complaintCount, 0);
 assert.equal(list.find(r => r.id === 'res-bina').wardLabel, 'Ward 9 · Nehru Colony'); assert.deepEqual([asha.blocked, asha.blockedAt, asha.blockedReason], [false, null, '']);
 assert.equal(list.find(r => r.id === 'res-chitra').language, 'hi');
 assert.equal(wardLabelOf({number: '12', name: 'Ward 12'}), 'Ward 12'); assert.equal(wardLabelOf({number: '1', name: 'Ward 12'}), 'Ward 1 · Ward 12'); assert.equal(wardLabelOf({number: 'T7', name: 'QA Ward'}), 'Ward T7 · QA Ward'); assert.equal(wardLabelOf(undefined), '');
 assert.deepEqual(adminResidents({complaints: []}), [], 'an empty workspace has no app users');
});

/* ---------------------------------------------------------------- save-resident */

test('save-resident updates the details, keeps registration data, returns {id} and writes an audit line', () => {
 const s = workspace(); const before = structuredClone(s.residentProfiles['res-asha']); const auditBefore = s.audit.length;
 const result = apply(s, edit({name: 'Asha V. Sharma', email: 'new@example.org', address: '5 New Colony,\nJaipur', wardId: 'ward-9', language: 'hi', classifiedNotifications: false, activityNotifications: false, version: 7, view: 'admin'}), T0 + 5 * HOUR);
 assert.deepEqual(result, {id: 'res-asha'});
 const after = s.residentProfiles['res-asha'];
 assert.deepEqual([after.name, after.email, after.address, after.wardId, after.language, after.classifiedNotifications, after.activityNotifications], ['Asha V. Sharma', 'new@example.org', '5 New Colony,\nJaipur', 'ward-9', 'hi', false, false]);
 for (const kept of ['id', 'mobile', 'photoId', 'registeredAt', 'readNotificationIds']) assert.deepEqual(after[kept], before[kept], kept);
 assert.equal(after.updatedAt, iso(T0 + 5 * HOUR)); assert.equal(after.notificationConsentAt, null, 'turning ad notifications off clears consent, like the app does');
 assert.equal(s.audit.length, auditBefore + 1); const line = s.audit[0];
 assert.equal(line.actor, 'admin@example.test'); assert.equal(line.complaintId, 'res-asha'); assert.match(line.action, /^Updated app user Asha V\. Sharma: name, email, address, ward, language, ad notifications, activity notifications/);
 assert.equal(line.action.includes('new@example.org') || line.action.includes('New Colony'), false, 'the audit line names the fields, never their private values');
 assert.deepEqual(Object.keys(s.residentProfiles).sort(), ['res-asha', 'res-bina', 'res-chitra'].sort());
});

test('save-resident keeps what the request leaves out: email, language and notification choices; null or empty email clears it', () => {
 const s = workspace(); const before = s.residentProfiles['res-chitra'];
 apply(s, edit({id: 'res-chitra', name: 'Chitra N. Nair', email: undefined}));
 const after = s.residentProfiles['res-chitra']; assert.equal(after.email, before.email); assert.equal(after.language, 'hi'); assert.equal(after.classifiedNotifications, true); assert.equal(after.activityNotifications, true); assert.equal(after.notificationConsentAt, before.notificationConsentAt, 'consent time is kept while the choice is unchanged');
 apply(s, edit({id: 'res-chitra', name: 'Chitra N. Nair', email: null})); assert.equal(s.residentProfiles['res-chitra'].email, '');
 apply(s, edit({id: 'res-bina', name: 'Bina Rao', wardId: 'ward-9', email: ''})); assert.equal(s.residentProfiles['res-bina'].email, '');
 apply(s, edit({id: 'res-bina', name: 'Bina Rao', wardId: 'ward-9', email: '  bina@example.org  '})); assert.equal(s.residentProfiles['res-bina'].email, 'bina@example.org', 'values are trimmed');
 const noChange = s.audit.length; apply(s, edit({id: 'res-bina', name: 'Bina Rao', wardId: 'ward-9', email: 'bina@example.org', address: s.residentProfiles['res-bina'].address})); assert.match(s.audit[0].action, /no changes/); assert.equal(s.audit.length, noChange + 1);
});

test('turning ad notifications back on records fresh consent now; leaving them on keeps the original consent', () => {
 const s = workspace(); const consent = s.residentProfiles['res-asha'].notificationConsentAt;
 apply(s, edit({classifiedNotifications: true}), T0 + 9 * HOUR); assert.equal(s.residentProfiles['res-asha'].notificationConsentAt, consent);
 apply(s, edit({classifiedNotifications: false}), T0 + 10 * HOUR); assert.equal(s.residentProfiles['res-asha'].notificationConsentAt, null);
 apply(s, edit({classifiedNotifications: true}), T0 + 11 * HOUR); assert.equal(s.residentProfiles['res-asha'].notificationConsentAt, iso(T0 + 11 * HOUR), 'only ads published afterwards reach them');
});

test('save-resident validates exactly like registration', () => {
 const s = workspace(); const before = JSON.stringify(s);
 const bad = (patch, code, pattern) => rejects(() => apply(s, edit(patch)), code, pattern);
 bad({name: 'A'}, 400, /Name: enter 2–80 characters/); bad({name: 'x'.repeat(81)}, 400, /Name/); bad({name: '   '}, 400, /Name/); bad({name: undefined}, 400, /Name/); bad({name: 12345}, 400, /Name/); bad({name: 'Line\nBreak'}, 400, /Name/); bad({name: 'Tab\u0007Bell'}, 400, /Name/);
 bad({email: 'not-an-email'}, 400, /valid email/); bad({email: 'a@b'}, 400, /valid email/); bad({email: 'two words@example.org'}, 400, /valid email/); bad({email: 'x'.repeat(151)}, 400, /Email/); bad({email: 42}, 400, /Email/);
 bad({address: 'Hi'}, 400, /Address: enter 5–300 characters/); bad({address: 'x'.repeat(301)}, 400, /Address/); bad({address: undefined}, 400, /Address/); bad({address: '      '}, 400, /Address/);
 bad({wardId: 'ward-404'}, 400, /Choose an active ward/); bad({wardId: 'ward-old'}, 400, /Choose an active ward/, 'a ward that is switched off cannot be assigned to someone else'); bad({wardId: undefined}, 400, /ward/); bad({wardId: 9}, 400, /ward/); bad({wardId: ''}, 400, /ward/);
 bad({language: 'fr'}, 400, /language/); bad({language: 1}, 400, /language/);
 bad({classifiedNotifications: 'yes'}, 400, /notification preference/); bad({activityNotifications: 1}, 400, /notification preference/); bad({classifiedNotifications: null}, 400, /notification preference/);
 assert.equal(JSON.stringify(s), before, 'a refused edit changes nothing, not even the audit log');
 // The limits themselves are valid.
 apply(s, edit({name: 'Aa', address: '12345', email: 'a@b.co'})); apply(s, edit({name: 'N'.repeat(80), address: 'A'.repeat(300), email: ('e'.repeat(140) + '@example.org').slice(0, 150)}));
 assert.equal(s.residentProfiles['res-asha'].name.length, 80);
});

test('a resident may keep a ward that has been switched off; moving to an active ward works; the mobile number is read-only', () => {
 const s = workspace(); s.residentProfiles['res-bina'].wardId = 'ward-old';
 apply(s, edit({id: 'res-bina', name: 'Bina R. Rao', wardId: 'ward-old'})); assert.equal(s.residentProfiles['res-bina'].wardId, 'ward-old'); assert.equal(s.residentProfiles['res-bina'].name, 'Bina R. Rao');
 assert.equal(adminResidents(s).find(r => r.id === 'res-bina').wardLabel, 'Ward 7 · Old Ward');
 apply(s, edit({id: 'res-bina', name: 'Bina R. Rao', wardId: 'ward-12'})); assert.equal(s.residentProfiles['res-bina'].wardId, 'ward-12');
 rejects(() => apply(s, edit({id: 'res-bina', name: 'Bina R. Rao', wardId: 'ward-old'})), 400, /active ward/, 'once moved away, the switched-off ward is gone');
 rejects(() => apply(s, edit({mobile: '9000000000'})), 400, /mobile number cannot be changed/);
 apply(s, edit({mobile: MOBILES.asha})); assert.equal(s.residentProfiles['res-asha'].mobile, MOBILES.asha, 'echoing the stored mobile number is tolerated');
 assert.equal(s.residentProfiles['res-asha'].mobile, MOBILES.asha);
});

test('save-resident and block-resident only reach registered app users', () => {
 const s = workspace(); s.residentProfiles['res-ghost'] = {...s.residentProfiles['res-asha'], id: 'res-ghost', registeredAt: null};
 for (const id of ['res-nobody', 'res-ghost', 'admin:1', 'demo-resident', '__proto__', 'constructor', 'toString']) {
  rejects(() => apply(s, edit({id})), 404, /App user not found/, id); rejects(() => apply(s, block({id})), 404, /App user not found/, id);
 }
 for (const id of [undefined, null, '', 5, {}, [], 'x'.repeat(101)]) {rejects(() => apply(s, edit({id})), 400, /Choose an app user/); rejects(() => apply(s, block({id})), 400, /Choose an app user/);}
 rejects(() => applyResidentEdit(s, null, iso(T0)), 400); rejects(() => applyBlock(s, 'nope', iso(T0)), 400);
 assert.equal(s.residentProfiles['res-ghost'].registeredAt, null);
});

test('renaming a resident updates their open complaints; closed and rejected ones and other residents’ complaints keep their record', () => {
 const s = workspace(); s.complaints.push(complaint({id: 'WC-5', status: 'Rejected / Duplicate'}), complaint({id: 'WC-6', status: 'Reopened'}));
 const mobileBefore = s.complaints.map(c => c.mobile);
 apply(s, edit({name: 'Asha Sharma'}));
 const byId = Object.fromEntries(s.complaints.map(c => [c.id, c.resident]));
 assert.deepEqual(byId, {'WC-1': 'Asha Sharma', 'WC-2': 'Asha Sharma', 'WC-3': 'Asha Verma', 'WC-4': 'Bina Rao', 'WC-5': 'Asha Verma', 'WC-6': 'Asha Sharma'});
 assert.deepEqual(s.complaints.map(c => c.mobile), mobileBefore, 'the mobile number on complaints is never touched');
 assert.match(s.audit[0].action, /name updated on 3 open complaints/);
 // Same name again: nothing to rename, no mention.
 apply(s, edit({name: 'Asha Sharma', address: '99 Another Road, Jaipur'})); assert.equal(/open complaint/.test(s.audit[0].action), false);
 // The complaint record still belongs to the same resident, so the resident (who cannot be renamed in the app) keeps seeing it.
 const asResident = projectWorkspace(s, who(viewer('Resident'), 'res-asha'), true); assert.deepEqual(asResident.complaints.map(c => c.id).sort(), ['WC-1', 'WC-2', 'WC-3', 'WC-5', 'WC-6']); assert.equal(asResident.profile.name, 'Asha Sharma');
});

/* ---------------------------------------------------------------- permissions */

test('save-resident and block-resident need residents.manage: residents and administrators without it are refused', () => {
 assert.ok(permissions.includes('residents.manage'));
 for (const action of ['save-resident', 'block-resident']) {
  assert.equal(actionPermissions[action], 'residents.manage', action);
  assert.throws(() => requireAction(viewer('Resident'), 'residents.manage'), e => e.code === 403, `${action}: resident`);
  for (const role of ['Auditor', 'Complaint Officer', 'Content Editor']) assert.throws(() => requireAction(viewer(role), actionPermissions[action]), e => e.code === 403, `${action}: ${role}`);
  assert.throws(() => requireAction(custom(permissions.filter(p => p !== 'residents.manage')), actionPermissions[action]), e => e.code === 403, 'every other permission is not enough');
  assert.throws(() => requireAction(custom([]), actionPermissions[action]), e => e.code === 403);
  for (const role of ['Super Admin', 'Ward Admin']) assert.doesNotThrow(() => requireAction(viewer(role), actionPermissions[action]), role);
  assert.doesNotThrow(() => requireAction(custom(['residents.manage']), actionPermissions[action]));
 }
 for (const role of ['Super Admin', 'Ward Admin']) assert.ok(rolePresets[role].includes('residents.manage'), role);
 for (const role of ['Complaint Officer', 'Content Editor', 'Auditor', 'Custom']) assert.equal(rolePresets[role].includes('residents.manage'), false, role);
});

/* ---------------------------------------------------------------- block / unblock */

test('block-resident needs a reason, stores blocked/blockedAt/blockedReason and writes an audit line; unblock clears them', () => {
 const s = workspace(); const before = s.audit.length;
 rejects(() => apply(s, block({reason: undefined})), 400, /Enter a reason/); rejects(() => apply(s, block({reason: ''})), 400, /Enter a reason/); rejects(() => apply(s, block({reason: '   \n  '})), 400, /Enter a reason/); rejects(() => apply(s, block({reason: 12})), 400, /Enter a reason/);
 rejects(() => apply(s, block({reason: 'x'.repeat(201)})), 400, /at most 200 characters/); rejects(() => apply(s, block({reason: 'bad\u0000reason'})), 400, /control characters/);
 rejects(() => apply(s, block({blocked: 'yes'})), 400, /block or unblock/); rejects(() => apply(s, block({blocked: undefined})), 400, /block or unblock/); rejects(() => apply(s, block({blocked: 1})), 400, /block or unblock/);
 assert.equal(s.audit.length, before, 'refused requests leave no trace'); assert.equal(isBlocked(s.residentProfiles['res-asha']), false);
 const result = apply(s, block({reason: '  Repeated   abusive language.  '}), T0 + 30 * HOUR);
 assert.deepEqual(result, {id: 'res-asha', blocked: true, changed: true});
 const p = s.residentProfiles['res-asha']; assert.equal(p.blocked, true); assert.equal(p.blockedAt, iso(T0 + 30 * HOUR)); assert.equal(p.blockedReason, 'Repeated abusive language.', 'whitespace is collapsed');
 assert.equal(s.audit.length, before + 1); assert.match(s.audit[0].action, /^Blocked app user Asha Verma: Repeated abusive language\.$/); assert.equal(s.audit[0].actor, 'admin@example.test'); assert.equal(s.audit[0].complaintId, 'res-asha');
 assert.equal(s.audit[0].action.includes(MOBILES.asha), false, 'the audit line carries no phone number');
 apply(s, block({reason: 'x'.repeat(200)})); assert.equal(s.residentProfiles['res-asha'].blockedReason.length, 200);
 // Blocking again keeps the original time and only changes the reason.
 const again = apply(s, block({reason: 'New reason after review.'}), T0 + 40 * HOUR); assert.deepEqual(again, {id: 'res-asha', blocked: true, changed: false});
 assert.equal(s.residentProfiles['res-asha'].blockedAt, iso(T0 + 30 * HOUR)); assert.equal(s.residentProfiles['res-asha'].blockedReason, 'New reason after review.'); assert.match(s.audit[0].action, /^Updated block reason for app user Asha Verma: New reason/);
 const lines = s.audit.length; apply(s, block({reason: 'New reason after review.'})); assert.equal(s.audit.length, lines, 'blocking with an unchanged reason is a no-op');
 // Unblock.
 const unblocked = apply(s, {action: 'block-resident', id: 'res-asha', blocked: false, reason: 'ignored'}, T0 + 50 * HOUR); assert.deepEqual(unblocked, {id: 'res-asha', blocked: false, changed: true});
 const q = s.residentProfiles['res-asha']; assert.equal('blocked' in q, false); assert.equal('blockedAt' in q, false); assert.equal('blockedReason' in q, false); assert.match(s.audit[0].action, /^Unblocked app user Asha Verma$/);
 assert.deepEqual(['name', 'mobile', 'email', 'address', 'wardId', 'photoId', 'registeredAt', 'language'].map(k => q[k]), ['Asha Verma', MOBILES.asha, 'asha@example.org', 'asha Market Road, Jaipur', 'ward-12', 'photo-asha', iso(T0), 'en'], 'blocking and unblocking never touch the details');
 const afterLines = s.audit.length; assert.deepEqual(apply(s, {action: 'block-resident', id: 'res-asha', blocked: false}), {id: 'res-asha', blocked: false, changed: false}); assert.equal(s.audit.length, afterLines, 'unblocking an active resident is a no-op');
 const row = adminResidents(s).find(r => r.id === 'res-asha'); assert.deepEqual([row.blocked, row.blockedAt, row.blockedReason], [false, null, '']);
});

test('the enforcement helper: a blocked profile throws 403 with the exact message and machine-readable code', () => {
 assert.equal(ACCOUNT_BLOCKED_MESSAGE, 'Your account has been blocked. Please contact the ward office.'); assert.equal(ACCOUNT_BLOCKED_CODE, 'account_blocked');
 const e = new AccountBlockedError(); assert.ok(e instanceof ServiceError); assert.equal(e.code, 403); assert.equal(e.errorCode, 'account_blocked'); assert.equal(e.message, ACCOUNT_BLOCKED_MESSAGE); assert.equal(e.retryAfter, undefined);
 const s = workspace();
 assert.doesNotThrow(() => assertNotBlocked(s.residentProfiles['res-asha'])); assert.doesNotThrow(() => assertNotBlocked(undefined)); assert.doesNotThrow(() => assertNotBlocked(null)); assert.doesNotThrow(() => assertNotBlocked({blocked: false}));
 apply(s, block());
 assert.throws(() => assertNotBlocked(s.residentProfiles['res-asha']), err => err instanceof AccountBlockedError && err.code === 403 && err.errorCode === 'account_blocked');
 assert.equal(isBlocked(s.residentProfiles['res-asha']), true); assert.equal(isBlocked(s.residentProfiles['res-bina']), false);
 apply(s, {action: 'block-resident', id: 'res-asha', blocked: false}); assert.doesNotThrow(() => assertNotBlocked(s.residentProfiles['res-asha']));
});

test('a blocked resident is left out of push audiences, notification creation and the communication log; unblocking restores them', () => {
 const s = workspace(); const at = T0 + 24 * HOUR;
 apply(s, block({id: 'res-bina'}), at);
 // Classified: shared notification, push audience and WhatsApp log entries skip the blocked resident.
 const adId = apply(s, {action: 'save-classified', classified: makeAd()}, at).id;
 assert.equal(apply(s, {action: 'publish-classified', id: adId, status: 'published'}, at + HOUR).notificationCreated, true);
 const adNotice = s.notifications[0];
 assert.deepEqual(classifiedAudience(s, adNotice.createdAt).map(p => p.id).sort(), ['res-asha', 'res-chitra']);
 assert.deepEqual(pushItemsFor(s, [adNotice]).map(i => i.residentId).sort(), ['res-asha', 'res-chitra']);
 assert.deepEqual(s.communications.filter(c => c.template === 'Classified published').map(c => c.recipient).sort(), [MOBILES.asha, MOBILES.chitra], 'no message is queued for the blocked number');
 assert.deepEqual(residentNotifications(s, s.residentProfiles['res-bina'], at + 2 * HOUR), [], 'a blocked profile has no inbox');
 assert.equal(residentNotifications(s, s.residentProfiles['res-asha'], at + 2 * HOUR).length, 1);
 // Activity.
 const actId = apply(s, {action: 'save-activity', activity: makeActivity()}, at).id; apply(s, {action: 'publish-activity', id: actId, status: 'published'}, at + HOUR);
 const actNotice = s.notifications[0]; assert.equal(actNotice.kind, 'activity');
 assert.deepEqual(activityAudience(s, actNotice.createdAt).map(p => p.id).sort(), ['res-asha', 'res-chitra']); assert.deepEqual(pushItemsFor(s, [actNotice]).map(i => i.residentId).sort(), ['res-asha', 'res-chitra']);
 // Complaint status changes by ward administration: no notification record and no push for the blocked resident; the complaint still moves.
 const snap = statusSnapshot(s.complaints); const bina = s.complaints.find(c => c.id === 'WC-4'), asha = s.complaints.find(c => c.id === 'WC-1');
 bina.status = 'Acknowledged'; asha.status = 'Acknowledged';
 const created = recordStatusChanges(s, snap, iso(at + 2 * HOUR), 'admin');
 assert.deepEqual(created.map(n => n.residentId), ['res-asha'], 'only the active resident gets a complaint notification'); assert.equal(s.notifications.some(n => n.residentId === 'res-bina'), false);
 assert.deepEqual(pushItemsFor(s, [{...created[0], residentId: 'res-bina'}]), [], 'even a notification addressed to the blocked resident produces no push'); assert.deepEqual(pushItemsFor(s, created).map(i => i.residentId), ['res-asha']);
 assert.equal(bina.status, 'Acknowledged');
 // Admin work on the blocked resident's complaint does not fail.
 s.complaints.find(c => c.id === 'WC-4').assignee = 'Roads & Infrastructure';
 // Unblocking restores the audiences for what is published afterwards.
 apply(s, {action: 'block-resident', id: 'res-bina', blocked: false}, at + 3 * HOUR);
 assert.deepEqual(classifiedAudience(s, iso(at + 4 * HOUR)).map(p => p.id).sort(), ['res-asha', 'res-bina', 'res-chitra']); assert.deepEqual(activityAudience(s, iso(at + 4 * HOUR)).map(p => p.id).sort(), ['res-asha', 'res-bina', 'res-chitra']);
 const snap2 = statusSnapshot(s.complaints); bina.status = 'Assigned'; assert.deepEqual(recordStatusChanges(s, snap2, iso(at + 5 * HOUR), 'admin').map(n => n.residentId), ['res-bina']);
});

test('queued messages (the communication log) skip a blocked resident’s number but keep messages to anyone else', () => {
 const s = workspace(); apply(s, block({id: 'res-bina'}));
 const entry = (id, recipient, complaintId = 'WC-4') => ({id, complaintId, template: 'Acknowledged', channel: 'WhatsApp', recipient, status: 'Not sent · WhatsApp setup pending', at: iso(T0), reason: 'x', message: 'm'});
 s.communications = [entry('new-bina', MOBILES.bina), entry('new-dept', '9000000099'), entry('new-asha', MOBILES.asha, 'WC-1'), entry('old-bina', MOBILES.bina)];
 assert.equal(dropBlockedCommunications(s, 3), 1, 'only the entries the action just added are examined');
 assert.deepEqual(s.communications.map(c => c.id), ['new-dept', 'new-asha', 'old-bina'], 'department and other residents’ messages stay; history is not rewritten');
 assert.equal(dropBlockedCommunications(s, 0), 0); assert.equal(dropBlockedCommunications({communications: [entry('x', MOBILES.bina)], residentProfiles: {}}, 1), 0, 'nobody blocked: nothing dropped');
 // End to end: an administrator moving a blocked resident's complaint queues no message for their number.
 const t = workspace(); apply(t, block({id: 'res-bina'})); t.communications = [];
 const queued = (num, residentId) => {const c = t.complaints.find(x => x.residentId === residentId); t.communications.unshift(entry('q-' + num, num, c.id));};
 queued(MOBILES.bina, 'res-bina'); queued(MOBILES.asha, 'res-asha'); dropBlockedCommunications(t, 2);
 assert.deepEqual(t.communications.map(c => c.recipient), [MOBILES.asha]);
});
test('administrators keep full access to a blocked resident’s complaints', () => {
 const s = workspace(); apply(s, block({id: 'res-bina'}));
 const admin = projectWorkspace(s, who(viewer('Super Admin')), false);
 assert.ok(admin.complaints.some(c => c.id === 'WC-4'), 'the complaint stays on the ward office’s workbench');
 assert.equal(admin.residents.find(r => r.id === 'res-bina').complaintCount, 1); assert.equal(admin.residents.find(r => r.id === 'res-bina').blocked, true);
});

/* ---------------------------------------------------------------- projection: who sees app users */

test('projection: only administrators with residents.manage receive app users; nobody else gets any resident profile data', () => {
 const s = workspace(); apply(s, block({id: 'res-chitra', reason: 'Fake complaints, see case note 12.'}));
 const asAdmin = projectWorkspace(s, who(viewer('Super Admin')), false);
 assert.deepEqual(asAdmin.residents.map(r => r.id), ['res-chitra', 'res-bina', 'res-asha']); assert.equal(asAdmin.residents[0].blockedReason, 'Fake complaints, see case note 12.'); assert.equal(asAdmin.residents[2].mobile, MOBILES.asha);
 assert.equal('residentProfiles' in asAdmin, false, 'raw profiles never leave the server');
 assert.deepEqual(projectWorkspace(s, who(viewer('Ward Admin')), false).residents.map(r => r.id), ['res-chitra', 'res-bina', 'res-asha']);
 assert.deepEqual(projectWorkspace(s, who(custom(['residents.manage'])), false).residents.map(r => r.id), ['res-chitra', 'res-bina', 'res-asha'], 'a custom role with only residents.manage');
 // Everyone else: no residents key. Profile-only values (email, address, photo, block reason) never appear; administrators who may read complaints still see the name, mobile and id
 // copied onto each complaint (existing behaviour), while every other role sees none of the resident's identity anywhere in the payload.
 const profileOnly = ['asha@example.org', 'bina@example.org', 'chitra@example.org', 'Market Road', 'photo-asha', 'photo-bina', 'photo-chitra', 'Fake complaints'];
 const identity = [...Object.values(MOBILES), 'Asha Verma', 'Bina Rao', 'Chitra Nair', 'res-asha', 'res-bina', 'res-chitra'];
 for (const v of [viewer('Content Editor'), viewer('Auditor'), viewer('Complaint Officer'), custom([]), custom(['announcements.manage', 'settings.manage']), custom(permissions.filter(p => p !== 'residents.manage' && !p.startsWith('complaints') && p !== 'communications.read' && p !== 'audit.read'))]) {
  const data = projectWorkspace(s, who(v), false); assert.equal('residents' in data, false, v.role + ' ' + v.permissions.join());
  const text = JSON.stringify({...data, audit: [], communications: []}), readsComplaints = v.permissions.includes('complaints.read');
  for (const secret of readsComplaints ? profileOnly : [...profileOnly, ...identity]) assert.equal(text.includes(secret), false, `${v.role} (${v.permissions.length} permissions) must not receive ${secret}`);
  assert.equal(readsComplaints, data.complaints.length > 0);
 }
 // Residents: neither the list nor anybody else, whatever the view flag says.
 for (const id of ['res-asha', 'res-bina', 'res-chitra', 'res-unregistered']) {
  const data = projectWorkspace(s, who(viewer('Resident'), id), true); assert.equal('residents' in data, false, id); assert.equal('wards' in data, false, id);
  const text = JSON.stringify(data); for (const [key, other] of [['asha', 'res-asha'], ['bina', 'res-bina'], ['chitra', 'res-chitra']]) if (other !== id) { for (const secret of [MOBILES[key], `${key}@example.org`, `photo-${key}`, other]) assert.equal(text.includes(secret), false, `${id} must not see ${secret}`); }
 }
 assert.equal('residents' in projectWorkspace(s, who(viewer('Super Admin')), true), false, 'the resident preview of an administrator carries no app users');
});

test('projection: administrators with residents.manage get the ward list for the ward picker, without member photo ids; settings admins keep the full records', () => {
 const s = workspace();
 const picker = projectWorkspace(s, who(custom(['residents.manage'])), false);
 assert.deepEqual(picker.wards.map(w => w.id).sort(), ['ward-12', 'ward-9', 'ward-old']); assert.equal(picker.wards.every(w => w.memberPhotoId === ''), true); assert.equal(JSON.stringify(picker).includes('ward-photo-9'), false);
 assert.equal(projectWorkspace(s, who(viewer('Ward Admin')), false).wards.find(w => w.id === 'ward-9').memberPhotoId, 'ward-photo-9');
 assert.equal('wards' in projectWorkspace(s, who(viewer('Content Editor')), false), false);
 assert.equal('wards' in projectWorkspace(s, who(viewer('Resident'), 'res-asha'), true), false);
});

test('a resident’s own profile never carries the administrator-only block fields', () => {
 const s = workspace(); apply(s, block({reason: 'Internal note for the office.'}));
 const own = communityView(s, 'res-asha', viewer('Resident'), true, T0 + 30 * HOUR).profile;
 assert.equal(own.id, 'res-asha'); for (const key of ['blocked', 'blockedAt', 'blockedReason']) assert.equal(key in own, false, key);
 assert.equal(JSON.stringify(projectWorkspace(s, who(viewer('Resident'), 'res-asha'), true)).includes('Internal note'), false);
 const viaAdmin = communityView(s, 'res-asha', viewer('Super Admin'), false, T0 + 30 * HOUR).profile; assert.equal(viaAdmin.name, 'Asha Verma'); assert.equal('blockedReason' in viaAdmin, false, 'the admin-only fields travel in `residents`, never in `profile`');
});

/* ---------------------------------------------------------------- media */

test('administrators with residents.manage can read resident profile photos; residents still read only their own', () => {
 const s = workspace();
 for (const key of ['asha', 'bina', 'chitra']) {
  const id = `photo-${key}`;
  assert.equal(canReadMedia(s, who(viewer('Super Admin')), id, `res-${key}`), true, 'Super Admin'); assert.equal(canReadMedia(s, who(viewer('Ward Admin')), id, `res-${key}`), true, 'Ward Admin');
  assert.equal(canReadMedia(s, who(custom(['residents.manage'])), id, `res-${key}`), true, 'residents.manage only');
  for (const v of [viewer('Content Editor'), viewer('Auditor'), viewer('Complaint Officer'), custom([]), custom(permissions.filter(p => p !== 'residents.manage'))]) assert.equal(canReadMedia(s, who(v), id, `res-${key}`), false, `${v.role} without residents.manage: ${id}`);
  for (const other of ['asha', 'bina', 'chitra']) assert.equal(canReadMedia(s, who(viewer('Resident'), `res-${other}`), id, `res-${key}`), other === key, `resident ${other} reading ${id}`);
  assert.equal(canReadMedia(s, who(viewer('Resident'), 'res-stranger'), id, `res-${key}`), false);
 }
 // Reading is not attaching: POST /api/workspace asks with purpose 'attach', so a resident photo can never be put on an ad, activity, ward or banner (that would publish it).
 for (const v of [viewer('Super Admin'), viewer('Ward Admin'), custom(['residents.manage'])]) assert.equal(canReadMedia(s, who(v), 'photo-asha', 'res-asha', 'attach'), false, `${v.role}: attach`);
 assert.equal(canReadMedia(s, who(viewer('Resident'), 'res-asha'), 'photo-asha', 'res-asha', 'attach'), true, 'a resident keeps their own current photo (save-profile)');
 assert.equal(canReadMedia(s, who(viewer('Super Admin')), 'photo-nobody', null), false, 'unreferenced, un-uploaded media stays closed');
 assert.equal(canReadMedia(s, who(viewer('Super Admin')), 'ward-photo-9', null), true, 'ward member photos keep their own rule');
});

/* ---------------------------------------------------------------- delete-resident */

const {applyResidentDelete, maskMobile, isMaskedMobile, FORMER_RESIDENT} = await import('./.residents/resident-profile.mjs');
const del = (over = {}) => ({action: 'delete-resident', id: 'res-asha', ...over});
const comm = (id, recipient, complaintId, message = 'm') => ({id, complaintId, template: 'Acknowledged', channel: 'WhatsApp', recipient, status: 'Not sent · WhatsApp setup pending', at: iso(T0), reason: 'x', message});
const NAME_ASHA = 'Asha Verma', EMAIL_ASHA = 'asha@example.org';
/** Nothing that identifies Asha may be left anywhere in a workspace after her deletion, except the opaque resident id kept on her complaints. */
const traceOfAsha = text => [NAME_ASHA, MOBILES.asha, '98765 00001', EMAIL_ASHA, 'photo-asha', 'asha Market Road'].filter(secret => text.includes(secret));

test('delete-resident needs residents.manage: residents and administrators without it are refused, and it is mapped like the other app user actions', () => {
 assert.equal(actionPermissions['delete-resident'], 'residents.manage');
 assert.throws(() => requireAction(viewer('Resident'), actionPermissions['delete-resident']), e => e.code === 403);
 for (const role of ['Auditor', 'Complaint Officer', 'Content Editor']) assert.throws(() => requireAction(viewer(role), actionPermissions['delete-resident']), e => e.code === 403, role);
 assert.throws(() => requireAction(custom(permissions.filter(p => p !== 'residents.manage')), actionPermissions['delete-resident']), e => e.code === 403, 'every other permission is not enough');
 assert.throws(() => requireAction(custom([]), actionPermissions['delete-resident']), e => e.code === 403);
 for (const role of ['Super Admin', 'Ward Admin']) assert.doesNotThrow(() => requireAction(viewer(role), actionPermissions['delete-resident']), role);
 assert.doesNotThrow(() => requireAction(custom(['residents.manage']), actionPermissions['delete-resident']));
});

test('delete-resident removes the profile, returns {id, deleted: true}, and a second call is a 404', () => {
 const s = workspace(); const before = s.audit.length;
 const result = apply(s, del(), T0 + 30 * HOUR); assert.deepEqual(result, {id: 'res-asha', deleted: true});
 assert.equal('res-asha' in s.residentProfiles, false); assert.deepEqual(Object.keys(s.residentProfiles).sort(), ['res-bina', 'res-chitra'], 'nobody else is touched');
 assert.deepEqual(adminResidents(s).map(r => r.id), ['res-chitra', 'res-bina']); assert.equal(s.residentProfiles['res-bina'].name, 'Bina Rao');
 // The audit line names the resident by id only, never by name or mobile.
 assert.equal(s.audit.length, before + 1); const line = s.audit[0];
 assert.equal(line.action, 'Deleted app user res-asha: 3 complaints anonymised, 0 notifications removed'); assert.equal(line.actor, 'admin@example.test'); assert.equal(line.complaintId, 'res-asha'); assert.equal(line.at, iso(T0 + 30 * HOUR));
 for (const secret of [NAME_ASHA, 'Asha', MOBILES.asha, EMAIL_ASHA]) assert.equal(line.action.includes(secret), false, 'the audit line must not contain ' + secret);
 // Idempotent safe: nothing is left to delete the second time, and nothing is written.
 const lines = s.audit.length; rejects(() => apply(s, del()), 404, /^Resident not found\.$/); assert.equal(s.audit.length, lines, 'a refused call leaves no trace');
 // Only registered residents exist for this action; ids that are not valid ask for a choice (like save-resident and block-resident).
 s.residentProfiles['res-ghost'] = {...s.residentProfiles['res-bina'], id: 'res-ghost', registeredAt: null};
 for (const id of ['res-nobody', 'res-ghost', 'admin:1', 'demo-resident', '__proto__', 'constructor', 'toString', 'hasOwnProperty']) rejects(() => apply(s, del({id})), 404, /^Resident not found\.$/, id);
 for (const id of [undefined, null, '', 5, {}, [], 'x'.repeat(101)]) rejects(() => apply(s, del({id})), 400, /Choose an app user/);
 rejects(() => applyResidentDelete(s, null), 400); rejects(() => applyResidentDelete(s, 'res-bina'), 400);
 assert.ok(s.residentProfiles['res-ghost'] && s.residentProfiles['res-bina'], 'refused requests delete nothing');
});

test('a blocked resident can be deleted; no block flag, reason or read marker outlives the profile', () => {
 const s = workspace(); apply(s, block({reason: 'Fake complaints, see case note 12.'}), T0 + 24 * HOUR);
 assert.equal(s.residentProfiles['res-asha'].blocked, true);
 assert.deepEqual(apply(s, del(), T0 + 30 * HOUR), {id: 'res-asha', deleted: true});
 assert.equal(JSON.stringify(s.residentProfiles).includes('Fake complaints'), false);
 assert.equal(s.audit.some(a => a.action.includes('Asha')), false, 'no audit line names the resident any more');
 assert.match(s.audit.find(a => a.action.startsWith('Blocked app user')).action, /^Blocked app user Former resident: Fake complaints, see case note 12\.$/, 'the audit line keeps the reason and the resident id (complaintId) but not the name');
 assert.equal(s.audit.find(a => a.action.startsWith('Blocked app user')).complaintId, 'res-asha');
});

test('the complaints stay but are anonymised: Former resident, the last four digits, ward and history kept, other residents untouched', () => {
 const s = workspace();
 s.complaints[0].history.push({status: 'Acknowledged', note: `Called ${MOBILES.asha.slice(0, 5)} ${MOBILES.asha.slice(5)} and +91${MOBILES.asha}; no answer.`, at: iso(T0 + HOUR), actor: 'Ward Admin'}, {status: 'Reopened', note: 'Still broken.', at: iso(T0 + 2 * HOUR), actor: NAME_ASHA});
 s.complaints.push(complaint({id: 'WC-7', residentId: undefined, resident: '', mobile: MOBILES.asha, status: 'Closed'})); delete s.complaints.at(-1).residentId; // old record: no resident id, only the mobile number
 s.complaints.push(complaint({id: 'WC-8', wardId: 'ward-9', status: 'Closed'}));
 const frozen = structuredClone(s.complaints); const bina = structuredClone(s.complaints.find(c => c.id === 'WC-4'));
 apply(s, del());
 const mine = s.complaints.filter(c => ['WC-1', 'WC-2', 'WC-3', 'WC-7', 'WC-8'].includes(c.id)); assert.equal(mine.length, 5);
 for (const c of mine) {assert.equal(c.resident, FORMER_RESIDENT, c.id); assert.equal(c.mobile, '••••••0001', c.id); assert.equal(c.mobile, maskMobile(MOBILES.asha));}
 for (const c of s.complaints.filter(x => x.id !== 'WC-7')) if (c.resident === FORMER_RESIDENT) assert.equal(c.residentId, 'res-asha', 'the resident id stays on the complaint');
 // Everything else about a complaint is unchanged: id, text, status, dates, evidence, history (apart from names and numbers).
 for (const c of s.complaints) {const was = frozen.find(x => x.id === c.id); for (const key of ['id', 'title', 'description', 'category', 'locality', 'lat', 'lng', 'priority', 'status', 'assignee', 'createdAt', 'dueAt', 'media', 'afterMedia']) assert.deepEqual(c[key], was[key], `${c.id}.${key}`); assert.equal(c.history.length, was.history.length, c.id); assert.deepEqual(c.history.map(h => [h.status, h.at]), was.history.map(h => [h.status, h.at]), c.id);}
 const wc1 = s.complaints.find(c => c.id === 'WC-1'); assert.equal(wc1.history[1].note, 'Called ••••••0001 and ••••••0001; no answer.', 'a phone number typed into a note is masked'); assert.equal(wc1.history[2].actor, FORMER_RESIDENT, 'a history line the resident wrote loses the name'); assert.equal(wc1.history[1].actor, 'Ward Admin'); assert.equal(wc1.history[0].actor, 'Resident');
 // The ward survives: complaints that stored none take the profile's ward before it goes; a stored ward is not overwritten.
 assert.deepEqual(s.complaints.filter(c => c.resident === FORMER_RESIDENT).map(c => [c.id, c.wardId]).sort(), [['WC-1', 'ward-12'], ['WC-2', 'ward-12'], ['WC-3', 'ward-12'], ['WC-7', 'ward-12'], ['WC-8', 'ward-9']]);
 const admin = projectWorkspace(s, who(viewer('Super Admin')), false); assert.equal(admin.complaints.find(c => c.id === 'WC-2').wardLabel, 'Ward 12'); assert.equal(admin.complaints.find(c => c.id === 'WC-8').wardLabel, 'Ward 9 · Nehru Colony');
 // Other residents' complaints are not touched at all.
 assert.deepEqual(s.complaints.find(c => c.id === 'WC-4'), bina);
 assert.deepEqual(traceOfAsha(JSON.stringify(s)), [], 'no name, number, email, photo or address of the resident is left anywhere in the workspace');
 assert.equal(JSON.stringify(s).includes('res-asha'), true, 'only the opaque resident id remains (on the complaints and the audit line)');
});

test('masking is idempotent and tells real numbers from masked ones', () => {
 assert.equal(maskMobile('9876543210'), '••••••3210'); assert.equal(maskMobile('+91 98765 43210'), '••••••3210'); assert.equal(maskMobile('••••••3210'), '••••••3210'); assert.equal(maskMobile(''), '••••••'); assert.equal(maskMobile(undefined), '••••••'); assert.equal(maskMobile('12'), '••••••');
 for (const masked of ['••••••3210', '••••••']) assert.equal(isMaskedMobile(masked), true, masked);
 for (const real of ['9876543210', '', '••••••32', '•••3210', undefined, null, 5]) assert.equal(isMaskedMobile(real), false, String(real));
});

test('notifications of the resident are removed with their read markers; shared notices and other residents’ notifications stay', () => {
 const s = workspace(); const at = T0 + 24 * HOUR;
 const snap = statusSnapshot(s.complaints); s.complaints.find(c => c.id === 'WC-1').status = 'Acknowledged'; s.complaints.find(c => c.id === 'WC-4').status = 'Acknowledged';
 assert.equal(recordStatusChanges(s, snap, iso(at), 'admin').length, 2);
 const adId = apply(s, {action: 'save-classified', classified: makeAd()}, at).id; apply(s, {action: 'publish-classified', id: adId, status: 'published'}, at + HOUR);
 applyCommunityAction(s, {action: 'read-all-notifications'}, 'res-asha', NAME_ASHA, at + 2 * HOUR);
 assert.equal(s.residentProfiles['res-asha'].readNotificationIds.length, 2); assert.equal(s.notifications.length, 3);
 apply(s, del(), at + 3 * HOUR);
 assert.equal(s.notifications.some(n => n.residentId === 'res-asha'), false, 'her complaint notification is gone');
 assert.deepEqual(s.notifications.map(n => n.kind + ':' + (n.residentId ?? '')).sort(), ['classified:', 'complaint:res-bina'], 'the shared ad notice and Bina’s notification stay');
 assert.equal(s.audit[0].action, 'Deleted app user res-asha: 3 complaints anonymised, 1 notification removed');
 assert.deepEqual(s.residentProfiles['res-bina'].readNotificationIds, [], 'other residents’ read markers are untouched');
 assert.equal(residentNotifications(s, s.residentProfiles['res-bina'], at + 4 * HOUR).length, 2);
 // The ward office keeps working on the anonymised complaint: no notification, push or queued message is created for a person who is gone.
 const snap2 = statusSnapshot(s.complaints); s.complaints.find(c => c.id === 'WC-1').status = 'Assigned'; s.complaints.find(c => c.id === 'WC-4').status = 'Assigned';
 assert.deepEqual(recordStatusChanges(s, snap2, iso(at + 5 * HOUR), 'admin').map(n => n.residentId), ['res-bina'], 'only the living resident is notified');
 const queued = [comm('masked', maskMobile(MOBILES.asha), 'WC-1'), comm('real', MOBILES.bina, 'WC-4')]; s.communications = queued;
 assert.equal(dropBlockedCommunications(s, 2), 1, 'a message addressed to a masked number is dropped'); assert.deepEqual(s.communications.map(c => c.id), ['real']);
});

test('the communication log: messages to the resident’s number are masked, everything else is kept', () => {
 const s = workspace();
 s.communications = [
  comm('to-asha', MOBILES.asha, 'WC-1', `SAMADHAN reference WC-1: Acknowledged. Asha Verma, we called ${MOBILES.asha.slice(0, 5)} ${MOBILES.asha.slice(5)} twice.`),
  comm('ad-to-asha', MOBILES.asha, 'ad-1', 'Local crafts fair: come and see.'), comm('plus91', '+91 ' + MOBILES.asha, 'WC-2', 'Plain message.'),
  comm('dept', '9000000099', 'WC-1', `Roads: Complaint WC-1 is now Acknowledged. Title: Broken light. Resident's ward: Ward 12. Call ${MOBILES.asha}.`),
  comm('to-bina', MOBILES.bina, 'WC-4', 'Bina Rao, your complaint has been registered.'), comm('other-dept', '9000000098', 'WC-4', 'Roads: nothing about Asha Verma here.'),
 ];
 apply(s, del());
 const by = Object.fromEntries(s.communications.map(c => [c.id, c]));
 assert.deepEqual([by['to-asha'].recipient, by['ad-to-asha'].recipient, by.plus91.recipient], ['••••••0001', '••••••0001', '••••••0001']);
 assert.equal(by['to-asha'].message, 'SAMADHAN reference WC-1: Acknowledged. Former resident, we called ••••••0001 twice.');
 assert.equal(by['ad-to-asha'].message, 'Local crafts fair: come and see.'); assert.equal(by.plus91.message, 'Plain message.');
 assert.equal(by.dept.recipient, '9000000099', 'a department number is not the resident’s'); assert.equal(by.dept.message, 'Roads: Complaint WC-1 is now Acknowledged. Title: Broken light. Resident\'s ward: Ward 12. Call ••••••0001.', 'the resident’s number is masked in messages about their complaints');
 assert.deepEqual([by['to-bina'].recipient, by['to-bina'].message, by['other-dept'].message], [MOBILES.bina, 'Bina Rao, your complaint has been registered.', 'Roads: nothing about Asha Verma here.'], 'other residents and unrelated entries are untouched (free text of other complaints is never rewritten)');
 assert.equal(s.communications.length, 6, 'no entry is removed from the log');
 // Names are replaced as whole words only, and only in messages addressed to the resident.
 const t = workspace(); t.residentProfiles['res-bina'].name = 'Ram'; t.communications = [comm('x', MOBILES.bina, 'WC-4', 'Ramesh Colony light. Ram ji, it is fixed. ram')];
 apply(t, del({id: 'res-bina'})); assert.equal(t.communications[0].message, 'Ramesh Colony light. Former resident ji, it is fixed. Former resident');
});

test('audit lines that name the resident are masked (by id); the audit line of the deletion itself names nobody', () => {
 const s = workspace();
 apply(s, edit({name: 'Asha V. Sharma'}), T0 + 10 * HOUR); apply(s, block({reason: 'Rude on calls.'}), T0 + 11 * HOUR);
 s.audit.unshift({id: 'own1', action: 'Status changed to Closed', actor: 'Asha V. Sharma', at: iso(T0 + 12 * HOUR), complaintId: 'WC-3'}, {id: 'other1', action: 'Status changed to Closed', actor: 'Bina Rao', at: iso(T0 + 12 * HOUR), complaintId: 'WC-4'}, {id: 'admin1', action: 'Status changed to Assigned', actor: 'admin@example.test', at: iso(T0 + 12 * HOUR), complaintId: 'WC-1'});
 const name = s.residentProfiles['res-asha'].name; assert.equal(name, 'Asha V. Sharma');
 s.audit.push({id: 'reg1', action: 'Resident registered', actor: name, at: iso(T0), complaintId: ''}, {id: 'photo1', action: 'Resident updated photo or notification preferences', actor: name, at: iso(T0 + HOUR), complaintId: ''}, {id: 'reg-bina', action: 'Resident registered', actor: 'Bina Rao', at: iso(T0), complaintId: ''});
 const twin = structuredClone(s); twin.residentProfiles['res-bina'].name = name; // a living resident with the very same name: the lines without a reference cannot be told apart
 apply(s, del(), T0 + 20 * HOUR); apply(twin, del(), T0 + 20 * HOUR);
 assert.deepEqual(['reg1', 'photo1', 'reg-bina'].map(id => s.audit.find(a => a.id === id).actor), [FORMER_RESIDENT, FORMER_RESIDENT, 'Bina Rao'], 'registration and photo lines lose the name; other residents’ lines stay');
 assert.deepEqual(['reg1', 'photo1'].map(id => twin.audit.find(a => a.id === id).actor), [name, name], 'ambiguous (a living resident has the same name): left alone'); assert.equal(twin.audit.find(a => a.id === 'own1').actor, FORMER_RESIDENT, 'what is tied to the resident’s complaints is masked regardless');
 const byId = Object.fromEntries(s.audit.map(a => [a.id, a]));
 assert.equal(byId.own1.actor, FORMER_RESIDENT, 'her own action on her complaint'); assert.equal(byId.other1.actor, 'Bina Rao'); assert.equal(byId.admin1.actor, 'admin@example.test');
 const lines = s.audit.filter(a => a.complaintId === 'res-asha').map(a => a.action); assert.equal(lines.length, 3);
 assert.ok(lines.includes('Deleted app user res-asha: 3 complaints anonymised, 0 notifications removed')); assert.ok(lines.some(l => /^Updated app user Former resident: name/.test(l))); assert.ok(lines.includes('Blocked app user Former resident: Rude on calls.'));
 assert.equal(JSON.stringify(s.audit).includes('Asha'), false); assert.equal(JSON.stringify(s.audit).includes(MOBILES.asha), false);
});

test('the number is free again: registering it creates a brand-new resident, with nothing of the old profile', () => {
 const s = workspace(); const at = T0 + 24 * HOUR;
 // Old life: blocked once, consent given, notifications read, an ad published.
 const adId = apply(s, {action: 'save-classified', classified: makeAd()}, at).id; apply(s, {action: 'publish-classified', id: adId, status: 'published'}, at + HOUR);
 applyCommunityAction(s, {action: 'read-all-notifications'}, 'res-asha', NAME_ASHA, at + 2 * HOUR); assert.equal(s.residentProfiles['res-asha'].readNotificationIds.length, 1);
 applyCommunityAction(s, {action: 'save-profile', profile: {classifiedNotifications: false, activityNotifications: false, language: 'hi'}}, 'res-asha', NAME_ASHA, at + 3 * HOUR);
 apply(s, block({reason: 'Fake complaints.'}), at + 4 * HOUR);
 rejects(() => registerProfile(s, {name: 'Asha Again', wardId: 'ward-9', address: '1 New Road, Jaipur', photoId: 'photo-new', consent: true}, 'res-asha', MOBILES.asha, iso(at + 5 * HOUR)), 409, /already registered/);
 apply(s, del(), at + 6 * HOUR);
 const fresh = registerProfile(s, {name: 'Asha Again', wardId: 'ward-9', address: '1 New Road, Jaipur', photoId: 'photo-new', consent: true}, 'res-asha', MOBILES.asha, iso(at + 7 * HOUR));
 assert.deepEqual([fresh.id, fresh.mobile, fresh.name, fresh.wardId, fresh.photoId, fresh.language, fresh.classifiedNotifications, fresh.activityNotifications, fresh.registeredAt, fresh.notificationConsentAt, fresh.readNotificationIds], ['res-asha', MOBILES.asha, 'Asha Again', 'ward-9', 'photo-new', 'en', true, true, iso(at + 7 * HOUR), iso(at + 7 * HOUR), []]);
 for (const key of ['blocked', 'blockedAt', 'blockedReason']) assert.equal(key in fresh, false, key);
 assert.doesNotThrow(() => assertNotBlocked(s.residentProfiles['res-asha'])); assert.equal(adminResidents(s).find(r => r.id === 'res-asha').blocked, false);
 assert.deepEqual(residentNotifications(s, fresh, at + 8 * HOUR), [], 'nothing published before the new registration is shown, and no old notification came back');
 assert.deepEqual(classifiedAudience(s, iso(at + 9 * HOUR)).map(p => p.id).sort(), ['res-asha', 'res-bina', 'res-chitra']);
 // The old complaints stay anonymised; registering again does not rewrite them.
 assert.deepEqual(s.complaints.filter(c => c.residentId === 'res-asha').map(c => [c.resident, c.mobile]), [[FORMER_RESIDENT, '••••••0001'], [FORMER_RESIDENT, '••••••0001'], [FORMER_RESIDENT, '••••••0001']]);
 // And the new resident can be deleted again.
 assert.deepEqual(apply(s, del(), at + 10 * HOUR), {id: 'res-asha', deleted: true}); rejects(() => apply(s, del()), 404);
});

test('deleted resident: nobody reads the old profile photo (not even the same mobile registering again); complaint evidence stays with the complaint', () => {
 const s = workspace(); s.complaints[0].media = ['evidence-asha'];
 const principals = {'Super Admin': who(viewer('Super Admin')), 'Ward Admin': who(viewer('Ward Admin')), 'residents.manage only': who(custom(['residents.manage'])), 'settings.manage only': who(custom(['settings.manage'])), 'Content Editor': who(viewer('Content Editor')), Auditor: who(viewer('Auditor')), 'Complaint Officer': who(viewer('Complaint Officer')), 'the resident (same id)': who(viewer('Resident'), 'res-asha'), 'another resident': who(viewer('Resident'), 'res-bina')};
 assert.equal(canReadMedia(s, principals['Super Admin'], 'photo-asha', 'res-asha'), true, 'before: administrators with residents.manage read it'); assert.equal(canReadMedia(s, principals['the resident (same id)'], 'photo-asha', 'res-asha'), true, 'before: the resident reads it');
 apply(s, del());
 // What POST /api/workspace does to the D1 media row of the deleted resident: the uploader becomes 'deleted:<id>'.
 const tombstone = 'deleted:res-asha';
 for (const [label, p] of Object.entries(principals)) for (const purpose of ['read', 'attach']) assert.equal(canReadMedia(s, p, 'photo-asha', tombstone, purpose), false, `${label}: ${purpose} of the deleted resident's photo`);
 for (const [label, p] of Object.entries(principals)) assert.equal(canReadMedia(s, p, 'photo-asha', null), false, `${label}: unreferenced and without an uploader`);
 // The same holds for an upload whose uploader mark was not rewritten, except for the uploader itself (the generic "own unreferenced upload" rule that the rewrite exists to switch off).
 for (const [label, p] of Object.entries(principals)) assert.equal(canReadMedia(s, p, 'photo-asha', 'res-asha'), label === 'the resident (same id)', `${label}: un-rewritten uploader`);
 // Complaint evidence is part of the (kept) complaint: complaints.read administrators still read it, others still cannot.
 for (const label of ['Super Admin', 'Ward Admin', 'Complaint Officer', 'Auditor']) assert.equal(canReadMedia(s, principals[label], 'evidence-asha', tombstone), true, label);
 for (const label of ['Content Editor', 'residents.manage only', 'settings.manage only', 'another resident']) assert.equal(canReadMedia(s, principals[label], 'evidence-asha', tombstone), false, label);
 // A resident registering the same mobile again uploads a new photo, which is theirs.
 registerProfile(s, {name: 'Asha Again', wardId: 'ward-9', address: '1 New Road, Jaipur', photoId: 'photo-new', consent: true}, 'res-asha', MOBILES.asha, iso(T0 + 40 * HOUR));
 assert.equal(canReadMedia(s, principals['the resident (same id)'], 'photo-new', 'res-asha'), true); assert.equal(canReadMedia(s, principals['the resident (same id)'], 'photo-asha', tombstone), false, 'the old photo stays closed');
 assert.equal(canReadMedia(s, principals['Super Admin'], 'photo-new', 'res-asha'), true);
});

test('projection after deletion: the resident is gone from the app users list; administrators see anonymised complaints, no payload carries the person', () => {
 const s = workspace(); apply(s, del());
 for (const [label, v] of [['Super Admin', viewer('Super Admin')], ['Ward Admin', viewer('Ward Admin')], ['residents.manage only', custom(['residents.manage'])]]) {
  const data = projectWorkspace(s, who(v), false); assert.deepEqual(data.residents.map(r => r.id), ['res-chitra', 'res-bina'], label); assert.equal(data.residents.some(r => r.name === NAME_ASHA), false);
  assert.deepEqual(traceOfAsha(JSON.stringify(data)), [], label + ' must not receive anything that identifies the deleted resident');
 }
 const admin = projectWorkspace(s, who(viewer('Super Admin')), false); const kept = admin.complaints.filter(c => c.residentId === 'res-asha'); assert.deepEqual(kept.map(c => c.id).sort(), ['WC-1', 'WC-2', 'WC-3'], 'the complaints stay on the ward office’s workbench');
 assert.deepEqual([...new Set(kept.map(c => c.resident))], [FORMER_RESIDENT]); assert.deepEqual([...new Set(kept.map(c => c.mobile))], ['••••••0001']);
 // The deleted resident's id now has no profile: a stale resident principal reads an empty default profile (the HTTP layer answers 401 before this, the sessions are gone).
 const stale = projectWorkspace(s, who(viewer('Resident'), 'res-asha'), true); assert.equal(stale.profile.registeredAt, null); assert.equal(stale.profile.name, ''); assert.equal(stale.profile.mobile, ''); assert.deepEqual(stale.notifications, []); assert.equal(stale.unread.total, 0);
 assert.deepEqual(traceOfAsha(JSON.stringify(stale)), []);
});
