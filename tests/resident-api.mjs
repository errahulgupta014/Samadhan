// End-to-end smoke test of resident sign-up, sign-in and notifications against a running dev server:
//   TEST_BASE_URL=http://localhost:5173 node tests/resident-api.mjs
// Flow: wards -> send-otp -> verify-otp -> upload photo -> register -> workspace -> save-profile -> complaint -> admin update -> notification ->
// logout -> login again as registered. It runs in the server's TEST OTP MODE (OTP_PROVIDER unset): set TEST_OTP if RESIDENT_TEST_OTP is not 123456.
// It also covers the App users feature (permission residents.manage): the admin list, editing details, blocking and unblocking, the 403 {code: 'account_blocked'}
// every resident path answers for a blocked resident, the refusal of verify-otp for a blocked number and a fresh sign-in after unblocking. That part signs in as the built-in
// Admin / Admin account (override with TEST_ADMIN_USERNAME / TEST_ADMIN_PASSWORD) to create two throwaway limited administrators, which it deletes again.
// It also covers delete-resident (permission residents.manage): who may call it, a blocked resident being deleted, the old session token answering 401, the pending OTP, sessions and push tokens
// being removed, the complaints staying but anonymised, the audit line naming the resident by id only, and the number registering again as a brand-new resident (see deleteResidentPhase1/2).
// It creates clearly marked synthetic residents ("QA Resident ...", "QA Blocked ...", "QA Unblocked ...", "QA Erased ...") and complaints in the LOCAL workspace and takes ~2 minutes (60 s resend cooldowns).
// The QA residents of a run are deleted again at the end (delete-resident); their complaints stay in the workspace, anonymised.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const base = process.env.TEST_BASE_URL || 'http://localhost:5173';
const OTP = process.env.TEST_OTP || '123456';
const json = {'Content-Type': 'application/json'};
const nonce = Date.now().toString(36);
const mobileOf = salt => '9' + String(Date.now() * 7 + salt * 1234567).slice(-9).padStart(9, '3');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jh2sAAAAASUVORK5CYII=', 'base64');
const must = async (res, status, label) => {const body = await res.text(); assert.equal(res.status, status, `${label}: expected ${status}, got ${res.status} ${body.slice(0, 300)}`); try {return JSON.parse(body);} catch {return body;}};

// Owner (administrator) identity: the local mock sign-in cookie. It also creates the platform owner row that resident sign-in needs.
const login = await fetch(base + '/signin-with-chatgpt?return_to=/', {redirect: 'manual'});
const cookie = login.headers.getSetCookie().map(v => v.split(';')[0]).join('; ');
assert.ok(cookie, 'Local sign-in must set the test cookie');
const admin = {
 async get() {return must(await fetch(base + '/api/workspace', {headers: {cookie}}), 200, 'admin workspace');},
 async act(body, status = 200) {const {version} = await admin.get(); return must(await fetch(base + '/api/workspace', {method: 'POST', headers: {cookie, ...json}, body: JSON.stringify({...body, version})}), status, 'admin ' + body.action);},
 async upload() {const form = new FormData(); form.append('file', new Blob([png], {type: 'image/png'}), 'qa-admin.png'); return (await must(await fetch(base + '/api/media', {method: 'POST', headers: {cookie}, body: form}), 200, 'admin upload')).id;},
};
const auth = token => ({Authorization: `Bearer ${token}`});
const resident = token => ({
 async get() {return must(await fetch(base + '/api/workspace?view=resident', {headers: auth(token)}), 200, 'resident workspace');},
 async act(body, status = 200) {const {version} = await this.get(); return must(await fetch(base + '/api/workspace', {method: 'POST', headers: {...auth(token), ...json}, body: JSON.stringify({view: 'resident', ...body, version})}), status, 'resident ' + body.action);},
 async upload(status = 200) {const form = new FormData(); form.append('file', new Blob([png], {type: 'image/png'}), 'qa-resident.png'); const res = await fetch(base + '/api/media', {method: 'POST', headers: auth(token), body: form}); const out = await must(res, status, 'resident upload'); return out.id;},
 media: id => fetch(base + '/api/media?id=' + encodeURIComponent(id), {headers: auth(token)}),
});
const auth_ = (body, token) => fetch(base + '/api/resident-auth', {method: 'POST', headers: {...json, ...(token ? auth(token) : {})}, body: JSON.stringify(body)});

// Local dev only: the dev server's D1 file, opened read-only, lets us verify who a push was addressed to (push_jobs records the device count).
// Skipped (with a note) when the file cannot be read, e.g. a remote TEST_BASE_URL.
async function localDb() {
 try {
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname)) return null;
  const {DatabaseSync} = await import('node:sqlite');
  const dir = new URL('../.wrangler/state/v3/d1/miniflare-D1DatabaseObject/', import.meta.url);
  const file = fs.readdirSync(dir).find(f => f.endsWith('.sqlite') && f !== 'metadata.sqlite');
  return file ? new DatabaseSync(new URL(file, dir), {readOnly: true}) : null;
 } catch {return null;}
}
/** Push devices an activity publication should address right now: tokens of registered residents who have not opted out of activity notifications. */
function expectedActivityDevices(db) {
 const profiles = JSON.parse(db.prepare('SELECT body FROM workspaces').get().body).residentProfiles ?? {};
 return db.prepare('SELECT resident_id FROM resident_push_tokens').all().filter(row => {const p = profiles[row.resident_id]; return !!p?.registeredAt && p.activityNotifications !== false;}).length;
}

// ---------------------------------------------------------------- app users (permission residents.manage): list, edit, block / unblock, and what a block stops
// Phase 1 registers two QA residents (so their 60 s OTP cooldown runs while the rest of this test executes), lets the owner administrator list and edit them,
// blocks them and checks every resident path. Phase 2 (end of the file) covers sign-in: send-otp stays generic, verify-otp is refused for a blocked number,
// and an unblocked resident signs in again with an OTP while their old session is gone.
const BLOCKED_BODY = {error: 'Your account has been blocked. Please contact the ward office.', code: 'account_blocked'};
const STRONG = 'Qa-Sturdy-Pass-91';
const adminAuth = async (body, ck) => {
 const res = await fetch(base + '/api/admin-auth', {method: 'POST', headers: {...json, ...(ck ? {cookie: ck} : {})}, body: JSON.stringify(body)});
 const text = await res.text(); let out = {}; try {out = JSON.parse(text);} catch {}
 return {status: res.status, body: out, cookie: res.headers.getSetCookie().map(v => v.split(';')[0]).find(v => v.startsWith('samadhan_admin=')) ?? null};
};
const expectBlocked = async (res, label) => {const text = await res.text(); assert.equal(res.status, 403, `${label}: expected 403, got ${res.status} ${text.slice(0, 200)}`); assert.deepEqual(JSON.parse(text), BLOCKED_BODY, label);};
const ADMIN_RESIDENT_KEYS = ['activityNotifications', 'address', 'blocked', 'blockedAt', 'blockedReason', 'classifiedNotifications', 'complaintCount', 'email', 'id', 'language', 'mobile', 'name', 'photoId', 'registeredAt', 'wardId', 'wardLabel'];
async function appUsersPhase1(baseWard, cleanup) {
 const signUp = async (salt, label) => {
  const mobile = mobileOf(salt), sentAt = Date.now(), name = `QA ${label} ${nonce}`;
  await must(await auth_({action: 'send-otp', mobile}), 200, 'send-otp ' + label);
  const registration = (await must(await auth_({action: 'verify-otp', mobile, code: OTP}), 200, 'verify-otp ' + label)).token;
  const photoId = await resident(registration).upload();
  const {token} = await must(await auth_({action: 'register', name, wardId: baseWard.id, email: `qa-${label.toLowerCase()}@example.org`, address: '3 Test Street, Jaipur', photoId, consent: true}, registration), 200, 'register ' + label);
  return {mobile, token, photoId, name, sentAt};
 };
 const qaBlocked = await signUp(5, 'Blocked'), qaOpen = await signUp(6, 'Unblocked');
 const blockedApp = resident(qaBlocked.token), openApp = resident(qaOpen.token);
 const fileComplaint = async (app, title) => {const evidence = await app.upload(); return (await app.act({action: 'create', title, description: 'Automated app users test complaint with a synthetic image.', category: 'Road & Footpath', locality: 'QA locality', lat: 26.91, lng: 75.78, media: [evidence], consent: true})).id;};
 const complaintBlocked = await fileComplaint(blockedApp, 'QA: complaint of a user who gets blocked ' + nonce), complaintOpen = await fileComplaint(openApp, 'QA: complaint of a user who is renamed ' + nonce);

 // ---- the owner administrator (Super Admin, residents.manage) lists every registered app user, newest first, with the real mobile number
 const {data: first} = await admin.get(); const rows = first.residents;
 assert.ok(Array.isArray(rows) && rows.length >= 2, 'administrators with residents.manage receive data.residents');
 const rowOf = (list, qa) => list.find(r => r.mobile === qa.mobile);
 const rb = rowOf(rows, qaBlocked), ro = rowOf(rows, qaOpen); assert.ok(rb && ro, 'new residents are listed with their real mobile number');
 assert.deepEqual([rb.name, rb.email, rb.address, rb.wardId, rb.photoId, rb.language, rb.classifiedNotifications, rb.activityNotifications, rb.blocked, rb.blockedAt, rb.blockedReason, rb.complaintCount], [qaBlocked.name, 'qa-blocked@example.org', '3 Test Street, Jaipur', baseWard.id, qaBlocked.photoId, 'en', true, true, false, null, '', 1]);
 assert.ok(rb.wardLabel.includes(baseWard.number) && rb.registeredAt);
 for (const r of rows) assert.deepEqual(Object.keys(r).sort(), ADMIN_RESIDENT_KEYS);
 for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].registeredAt >= rows[i].registeredAt, 'newest registration first');
 assert.ok(rows.indexOf(ro) < rows.indexOf(rb), 'the later registration is listed first');
 assert.equal((await fetch(base + '/api/media?id=' + qaBlocked.photoId, {headers: {cookie}})).status, 200, 'administrators with residents.manage can open a resident photo');
 assert.equal((await openApp.media(qaBlocked.photoId)).status, 404, 'residents still cannot open each other photos');

 // ---- administrators without residents.manage get no app users, cannot use the actions and cannot open resident photos (needs the built-in Admin account to create throwaway ones)
 const superLogin = await adminAuth({action: 'login', username: process.env.TEST_ADMIN_USERNAME || 'Admin', password: process.env.TEST_ADMIN_PASSWORD || 'Admin'});
 if (superLogin.cookie) {
  cleanup.push(async () => {await adminAuth({action: 'logout'}, superLogin.cookie);});
  const makeAdmin = async (label, permissions) => {
   const username = `qa-${label}-${nonce}`;
   const made = await adminAuth({action: 'create-user', username, name: `QA ${label}`, email: '', password: STRONG, role: 'Custom', permissions, mustChangePassword: false}, superLogin.cookie); assert.equal(made.status, 200, JSON.stringify(made.body));
   cleanup.push(async () => {await adminAuth({action: 'delete-user', id: made.body.user.id}, superLogin.cookie);});
   const signedIn = await adminAuth({action: 'login', username, password: STRONG}); assert.equal(signedIn.status, 200); return signedIn.cookie;
  };
  const as = ck => ({
   get: async () => must(await fetch(base + '/api/workspace', {headers: {cookie: ck}}), 200, 'workspace as limited admin'),
   post: async (body, status) => {const {version} = await as(ck).get(); return must(await fetch(base + '/api/workspace', {method: 'POST', headers: {cookie: ck, ...json}, body: JSON.stringify({...body, version})}), status, body.action + ' as limited admin');},
  });
  const denied = await makeAdmin('appusers-denied', ['announcements.manage', 'settings.manage']), manager = await makeAdmin('appusers-manager', ['residents.manage']);
  const {data: limitedData} = await as(denied).get(); assert.equal('residents' in limitedData, false, 'no residents.manage: no app users');
  for (const secret of [qaBlocked.mobile, qaBlocked.photoId, 'qa-blocked@example.org', '3 Test Street', rb.id]) assert.equal(JSON.stringify(limitedData).includes(secret), false, 'nothing about residents reaches an administrator without the permission: ' + secret);
  await as(denied).post({action: 'save-resident', id: rb.id, name: 'Nope Nope', email: '', address: '1 Some Road', wardId: baseWard.id}, 403);
  await as(denied).post({action: 'block-resident', id: rb.id, blocked: true, reason: 'nope'}, 403);
  assert.equal((await fetch(base + '/api/media?id=' + qaBlocked.photoId, {headers: {cookie: denied}})).status, 404, 'resident photos stay closed without residents.manage');
  const {data: managerData} = await as(manager).get(); assert.ok(rowOf(managerData.residents, qaBlocked), 'a custom role with only residents.manage sees the app users');
  assert.ok(managerData.wards.length >= 1 && managerData.wards.every(w => w.memberPhotoId === ''), 'and the ward list for the picker, without member photo ids');
  const reader = await makeAdmin('complaints-reader', ['complaints.read']); const {data: readerData} = await as(reader).get();
  assert.ok(readerData.wards.length >= 1 && readerData.wards.every(w => w.memberPhotoId === '' && w.id && w.number && w.name), 'complaints.read gets the ward list for the ward filter (never member photo ids)'); assert.equal('residents' in readerData, false, 'but still no app users');
  assert.ok(readerData.complaints.every(c => typeof c.wardId === 'string' && typeof c.wardLabel === 'string'), 'every complaint carries wardId and wardLabel (blank when unknown)');
  assert.equal((await fetch(base + '/api/media?id=' + qaBlocked.photoId, {headers: {cookie: manager}})).status, 200);
  await as(manager).post({action: 'save-ward', ward: {number: '99', name: 'Nope', city: 'Jaipur', active: true}}, 403);
 } else console.log('note: the built-in Admin sign-in did not work (set TEST_ADMIN_PASSWORD); the limited-administrator checks are covered by the unit tests only');

 // ---- editing: validation like registration, mobile read-only, residents refused, then a real change that the resident sees
 const save = (patch, status = 200) => admin.act({action: 'save-resident', id: ro.id, name: ro.name, email: ro.email, address: ro.address, wardId: ro.wardId, ...patch}, status);
 for (const [patch, pattern] of [[{name: 'Q'}, /Name/], [{email: 'nope'}, /valid email/], [{address: 'x'}, /Address/], [{wardId: 'ward-404'}, /ward/i], [{language: 'fr'}, /language/i], [{classifiedNotifications: 'yes'}, /notification/i], [{mobile: '9000000000'}, /mobile number/i], [{name: undefined}, /Name/]]) assert.match((await save(patch, 400)).error, pattern, JSON.stringify(patch));
 await admin.act({action: 'save-resident', id: 'res-does-not-exist', name: 'Nobody Here', email: '', address: '1 Some Road', wardId: baseWard.id}, 404);
 await admin.act({action: 'save-resident', name: 'Nobody Here', email: '', address: '1 Some Road', wardId: baseWard.id}, 400);
 await openApp.act({action: 'save-resident', id: ro.id, name: 'Hacker X', email: '', address: '1 Some Road', wardId: baseWard.id}, 403);
 await openApp.act({action: 'block-resident', id: rb.id, blocked: true, reason: 'not allowed'}, 403);
 const newName = qaOpen.name + ' Sharma';
 const saved = await save({name: newName, email: '', address: '9 Updated Lane,\nJaipur', language: 'hi', activityNotifications: false}); assert.equal(saved.id, ro.id);
 const roAfter = rowOf(saved.data.residents, qaOpen);
 assert.deepEqual([roAfter.name, roAfter.email, roAfter.address, roAfter.language, roAfter.activityNotifications, roAfter.classifiedNotifications, roAfter.mobile, roAfter.photoId, roAfter.registeredAt, roAfter.blocked], [newName, '', '9 Updated Lane,\nJaipur', 'hi', false, true, qaOpen.mobile, qaOpen.photoId, ro.registeredAt, false]);
 const {data: mine} = await openApp.get();
 assert.deepEqual([mine.profile.name, mine.profile.language, mine.profile.activityNotifications, mine.profile.mobile, mine.profile.photoId], [newName, 'hi', false, qaOpen.mobile, qaOpen.photoId], 'the app shows the corrected details');
 for (const key of ['blocked', 'blockedAt', 'blockedReason']) assert.equal(key in mine.profile, false, 'administrator-only fields never reach the resident');
 assert.equal(mine.complaints.find(c => c.id === complaintOpen).resident, newName, 'an open complaint carries the corrected name'); assert.equal(mine.complaints.find(c => c.id === complaintOpen).mobile, qaOpen.mobile);
 const adminView = await admin.get(); assert.equal(adminView.data.complaints.find(c => c.id === complaintOpen).resident, newName);
 assert.ok(adminView.data.audit.some(a => a.action.startsWith('Updated app user ' + newName) && a.complaintId === ro.id), 'the edit is in the audit log');

 // ---- blocking: validation, then every resident path answers 403 {error, code: 'account_blocked'}
 const db = await localDb(), pushToken = `ExponentPushToken[qablk${nonce}xxxxxx]`;
 const count = (table, id) => db ? db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE resident_id = ?`).get(id).n : null;
 await blockedApp.act({action: 'register-push', token: pushToken}); if (db) assert.equal(count('resident_push_tokens', rb.id), 1);
 const blockBody = (patch = {}) => ({action: 'block-resident', id: rb.id, blocked: true, reason: 'QA: repeated test abuse', ...patch});
 assert.match((await admin.act(blockBody({reason: undefined}), 400)).error, /reason/i); assert.match((await admin.act(blockBody({reason: '   '}), 400)).error, /reason/i); assert.match((await admin.act(blockBody({reason: 'x'.repeat(201)}), 400)).error, /200/);
 await admin.act(blockBody({blocked: 'yes'}), 400); await admin.act(blockBody({id: 'res-does-not-exist'}), 404); await admin.act(blockBody({id: 'demo-resident-not-registered'}), 404);
 assert.equal(rowOf((await admin.get()).data.residents, qaBlocked).blocked, false, 'refused requests change nothing');
 const blocked = await admin.act(blockBody()); assert.deepEqual([blocked.id, blocked.blocked, blocked.changed], [rb.id, true, true]);
 const rbAfter = rowOf(blocked.data.residents, qaBlocked); assert.deepEqual([rbAfter.blocked, rbAfter.blockedReason, Number.isFinite(Date.parse(rbAfter.blockedAt))], [true, 'QA: repeated test abuse', true]);
 if (db) assert.equal(count('resident_push_tokens', rb.id), 0, 'push tokens are dropped at once');
 const authBlocked = auth(qaBlocked.token), stillBlocked = async () => {
  await expectBlocked(await fetch(base + '/api/workspace?view=resident', {headers: authBlocked}), 'workspace GET');
  await expectBlocked(await fetch(base + '/api/workspace', {headers: authBlocked}), 'workspace GET (no view)');
  await expectBlocked(await fetch(base + '/api/workspace', {method: 'POST', headers: {...authBlocked, ...json}, body: JSON.stringify({action: 'read-all-notifications', version: 1})}), 'workspace POST');
  await expectBlocked(await fetch(base + '/api/workspace', {method: 'POST', headers: {...authBlocked, ...json}, body: JSON.stringify({action: 'register-push', token: pushToken})}), 'register-push');
  await expectBlocked(await fetch(base + '/api/workspace', {method: 'POST', headers: {...authBlocked, ...json}, body: JSON.stringify({action: 'unregister-push', token: pushToken})}), 'unregister-push');
  await expectBlocked(await fetch(base + '/api/categories', {headers: authBlocked}), 'categories');
  await expectBlocked(await blockedApp.media(qaBlocked.photoId), 'media read');
  const form = new FormData(); form.append('file', new Blob([png], {type: 'image/png'}), 'qa-blocked.png'); await expectBlocked(await fetch(base + '/api/media', {method: 'POST', headers: authBlocked, body: form}), 'media upload');
  await expectBlocked(await auth_({action: 'register', name: 'QA Blocked Again', wardId: baseWard.id, address: '1 Test Road, Jaipur', photoId: qaBlocked.photoId, consent: true}, qaBlocked.token), 'register');
 };
 await stillBlocked();
 if (db) assert.ok(count('resident_sessions', rb.id) >= 1, 'the session row stays while blocked (every call is refused); it is removed on logout or unblock');
 // The ward office keeps working on a blocked resident's complaint; no notification or push is created for them.
 assert.ok((await admin.get()).data.complaints.some(c => c.id === complaintBlocked), 'the complaint stays visible to administrators');
 await admin.act({action: 'transition', id: complaintBlocked, status: 'Acknowledged', note: 'Received by the ward office (blocked user test).'});
 const afterTransition = (await admin.get()).data; assert.equal(afterTransition.complaints.find(c => c.id === complaintBlocked).status, 'Acknowledged');
 assert.equal(afterTransition.communications.some(c => c.complaintId === complaintBlocked && c.template === 'Acknowledged' && c.recipient === qaBlocked.mobile), false, 'no message is queued for the blocked resident’s number');
 if (db) {
  const stored = JSON.parse(db.prepare('SELECT body FROM workspaces').get().body);
  assert.equal(stored.notifications.some(n => n.complaintId === complaintBlocked), false, 'no notification is created for a blocked resident');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM push_jobs WHERE classified_id = ?').get(complaintBlocked).n, 0, 'and no push is sent');
  assert.equal(stored.residentProfiles[rb.id].blocked, true);
 }
 const edited = await admin.act({action: 'save-resident', id: rb.id, name: qaBlocked.name, email: rb.email, address: rb.address, wardId: rb.wardId}); assert.equal(rowOf(edited.data.residents, qaBlocked).blocked, true, 'editing details keeps the block');
 const reblocked = await admin.act(blockBody({reason: 'QA: reason updated after review'})); assert.deepEqual([reblocked.blocked, reblocked.changed], [true, false]); assert.equal(rowOf(reblocked.data.residents, qaBlocked).blockedReason, 'QA: reason updated after review');

 // ---- the other resident: blocked, refused, unblocked; the old session is retired (sign in again with an OTP)
 await admin.act({action: 'block-resident', id: ro.id, blocked: true, reason: 'QA: temporary block'});
 await expectBlocked(await fetch(base + '/api/workspace?view=resident', {headers: auth(qaOpen.token)}), 'workspace GET before unblock');
 const unblocked = await admin.act({action: 'block-resident', id: ro.id, blocked: false}); assert.deepEqual([unblocked.id, unblocked.blocked, unblocked.changed], [ro.id, false, true]);
 const roUn = rowOf(unblocked.data.residents, qaOpen); assert.deepEqual([roUn.blocked, roUn.blockedAt, roUn.blockedReason], [false, null, '']);
 assert.equal((await fetch(base + '/api/workspace?view=resident', {headers: auth(qaOpen.token)})).status, 401, 'unblocking retires the old session: the resident signs in again with an OTP');
 if (db) assert.equal(count('resident_sessions', ro.id), 0);
 assert.equal((await admin.act({action: 'block-resident', id: ro.id, blocked: false})).changed, false, 'unblocking someone who is not blocked changes nothing');
 return {qaBlocked, qaOpen, rb, ro, newName, complaintOpen, complaintBlocked, stillBlocked, rowOf};
}
async function appUsersPhase2(s) {
 const {qaBlocked, qaOpen, rb, newName, complaintOpen, stillBlocked, rowOf} = s;
 const wait = Math.max(qaBlocked.sentAt, qaOpen.sentAt) + 61000 - Date.now(); if (wait > 0) {console.log(`waiting ${Math.ceil(wait / 1000)}s for the QA residents' resend cooldown...`); await sleep(wait);}
 // A blocked number: send-otp answers like any other number (the block is not revealed), a wrong code is an ordinary 400, and the right code is refused without a session.
 const generic = await must(await auth_({action: 'send-otp', mobile: qaBlocked.mobile}), 200, 'send-otp for a blocked number'); assert.deepEqual(generic, {ok: true, expiresIn: 300, retryAfter: 60});
 if (OTP !== '000000') await must(await auth_({action: 'verify-otp', mobile: qaBlocked.mobile, code: '000000'}), 400, 'a wrong code reveals nothing about the block');
 const refused = await auth_({action: 'verify-otp', mobile: qaBlocked.mobile, code: OTP}); const refusedText = await refused.text(); assert.equal(refused.status, 403, refusedText);
 assert.deepEqual(JSON.parse(refusedText), BLOCKED_BODY, 'verify-otp for a blocked number is refused with the account_blocked code'); assert.equal(refusedText.includes('token'), false, 'no session is issued');
 await must(await auth_({action: 'verify-otp', mobile: qaBlocked.mobile, code: OTP}), 400, 'the code is spent');
 await stillBlocked(); // the old session is still unusable
 await must(await auth_({action: 'logout'}, qaBlocked.token), 200, 'a blocked resident can still sign out');
 assert.equal((await fetch(base + '/api/workspace?view=resident', {headers: auth(qaBlocked.token)})).status, 401, 'logout removed the session');
 // Unblock (this also tidies the QA record). The other resident, unblocked earlier, signs in again as a registered resident and finds everything intact.
 assert.equal((await admin.act({action: 'block-resident', id: rb.id, blocked: false})).changed, true);
 assert.equal(rowOf((await admin.get()).data.residents, qaBlocked).blocked, false);
 await must(await auth_({action: 'send-otp', mobile: qaOpen.mobile}), 200, 'send-otp after unblock');
 const back = await must(await auth_({action: 'verify-otp', mobile: qaOpen.mobile, code: OTP}), 200, 'verify-otp after unblock'); assert.equal(back.registered, true); assert.ok(back.token.length >= 32);
 const {data} = await resident(back.token).get();
 assert.deepEqual([data.profile.name, data.profile.language, data.profile.mobile], [newName, 'hi', qaOpen.mobile]); assert.ok(data.complaints.some(c => c.id === complaintOpen));
 assert.equal((await fetch(base + '/api/logout', {method: 'POST', headers: auth(back.token)})).status, 200);
}

// ---------------------------------------------------------------- delete-resident (permission residents.manage): permanent removal; the complaints stay, anonymised
// Phase 1 registers three QA residents ("QA Erased", "QA Bystander", "QA ErasedBlocked") with a complaint each, checks who may delete, and deletes the BLOCKED one.
// Phase 2 (end of the file, once the resend cooldown of the QA residents has run) deletes a resident who has a pending OTP and follows everything: the old token, the OTP, the anonymised complaint,
// the masked messages, the number registering again as a brand-new resident and nothing old coming back. Every QA resident this run created is deleted in the cleanup (the complaints stay, anonymised).
const sha256 = async value => Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))).toString('hex');
const FORMER = 'Former resident', maskedOf = mobile => '••••••' + mobile.slice(-4);
async function deleteResidentPhase1(baseWard, cleanup) {
 const db = await localDb(), n = (sql, ...args) => db ? db.prepare(sql).get(...args).n : null, hashOf = mobile => sha256(`samadhan-mobile:${mobile}`);
 const signUp = async (salt, label) => {
  const mobile = mobileOf(salt), sentAt = Date.now(), name = `QA ${label} ${nonce}`, email = `qa-${label.toLowerCase()}-${nonce}@example.org`;
  await must(await auth_({action: 'send-otp', mobile}), 200, 'send-otp ' + label);
  const registration = (await must(await auth_({action: 'verify-otp', mobile, code: OTP}), 200, 'verify-otp ' + label)).token;
  const photoId = await resident(registration).upload();
  const {token} = await must(await auth_({action: 'register', name, wardId: baseWard.id, email, address: `3 ${label} Street, Jaipur`, photoId, consent: true}, registration), 200, 'register ' + label);
  return {mobile, token, photoId, name, email, sentAt, id: (await resident(token).get()).data.profile.id};
 };
 const x = await signUp(11, 'Erased'), y = await signUp(12, 'Bystander'), z = await signUp(13, 'ErasedBlocked');
 // Whatever happens below, the QA residents of this run (also those of the other flows in this file) are deleted at the end; the complaints stay, anonymised.
 cleanup.push(async () => {
  for (const r of (await admin.get()).data.residents.filter(r => r.name.startsWith('QA ') && r.name.includes(nonce))) await admin.act({action: 'delete-resident', id: r.id});
  assert.equal((await admin.get()).data.residents.some(r => r.name.startsWith('QA ') && r.name.includes(nonce)), false, 'no QA resident of this run is left');
 });
 const fileComplaint = async (person, title) => {const app = resident(person.token), evidence = await app.upload(); return (await app.act({action: 'create', title, description: 'Automated delete-resident test complaint with a synthetic image.', category: 'Road & Footpath', locality: 'QA locality', lat: 26.91, lng: 75.78, media: [evidence], consent: true})).id;};
 const cx = await fileComplaint(x, 'QA: complaint of a resident who is deleted ' + nonce), cy = await fileComplaint(y, 'QA: complaint of a bystander ' + nonce), cz = await fileComplaint(z, 'QA: complaint of a blocked resident who is deleted ' + nonce);
 const xApp = resident(x.token), pushToken = `ExponentPushToken[qaera${nonce}xxxxxxxx]`;
 await resident(z.token).act({action: 'register-push', token: `ExponentPushToken[qaerz${nonce}xxxxxxxx]`}); // x registers its device in phase 2 (a push to this fake token would be dropped as invalid by the transition below)
 await admin.act({action: 'transition', id: cx, status: 'Acknowledged', note: 'Received by the ward office (delete-resident test).'});
 await xApp.act({action: 'read-all-notifications'}); assert.ok((await xApp.get()).data.profile.readNotificationIds.length >= 1, 'the resident has read markers that must not come back');

 // ---- who may delete: not residents (not even themselves), not administrators without residents.manage, not a cross-site page; the id must name a registered resident
 const target = {action: 'delete-resident', id: y.id};
 assert.match((await xApp.act(target, 403)).error, /Administrator access required/); await xApp.act({action: 'delete-resident', id: x.id}, 403);
 await admin.act({...target, view: 'resident'}, 403);
 const {version} = await admin.get(); assert.equal((await fetch(base + '/api/workspace', {method: 'POST', headers: {cookie, ...json, Origin: 'https://evil.example'}, body: JSON.stringify({...target, version})})).status, 403, 'a cross-site request is refused');
 await admin.act({action: 'delete-resident'}, 400); await admin.act({action: 'delete-resident', id: 5}, 400); await admin.act({action: 'delete-resident', id: ''}, 400);
 for (const id of ['res-does-not-exist', 'demo-resident', 'admin:1', '__proto__']) assert.equal((await admin.act({action: 'delete-resident', id}, 404)).error, 'Resident not found.', id);
 const superLogin = await adminAuth({action: 'login', username: process.env.TEST_ADMIN_USERNAME || 'Admin', password: process.env.TEST_ADMIN_PASSWORD || 'Admin'});
 let manager = null;
 if (superLogin.cookie) {
  cleanup.push(async () => {await adminAuth({action: 'logout'}, superLogin.cookie);});
  const makeAdmin = async (label, permissions) => {
   const username = `qa-${label}-${nonce}`, made = await adminAuth({action: 'create-user', username, name: `QA ${label}`, email: '', password: STRONG, role: 'Custom', permissions, mustChangePassword: false}, superLogin.cookie); assert.equal(made.status, 200, JSON.stringify(made.body));
   cleanup.push(async () => {await adminAuth({action: 'delete-user', id: made.body.user.id}, superLogin.cookie);});
   const signedIn = await adminAuth({action: 'login', username, password: STRONG}); assert.equal(signedIn.status, 200); return signedIn.cookie;
  };
  const post = async (ck, body, status) => {const {version} = await must(await fetch(base + '/api/workspace', {headers: {cookie: ck}}), 200, 'workspace as limited admin'); return must(await fetch(base + '/api/workspace', {method: 'POST', headers: {cookie: ck, ...json}, body: JSON.stringify({...body, version})}), status, body.action + ' as limited admin');};
  for (const [label, permissions] of [['erase-denied', ['announcements.manage', 'settings.manage']], ['erase-reader', ['complaints.read', 'complaints.manage', 'audit.read']]]) assert.match((await post(await makeAdmin(label, permissions), target, 403)).error, /permission|access/i, label);
  manager = await makeAdmin('erase-manager', ['residents.manage']);
 } else console.log('note: the built-in Admin sign-in did not work (set TEST_ADMIN_PASSWORD); the limited-administrator checks of delete-resident are covered by the unit tests only');
 const listed = (await admin.get()).data.residents; for (const person of [x, y, z]) assert.ok(listed.some(r => r.id === person.id), 'refused requests delete nobody: ' + person.name);

 // ---- a BLOCKED resident can be deleted (here by an administrator who only has residents.manage); the blocked session answers 401 afterwards, not 403 account_blocked
 await admin.act({action: 'block-resident', id: z.id, blocked: true, reason: 'QA: blocked, then deleted'});
 await expectBlocked(await fetch(base + '/api/workspace?view=resident', {headers: auth(z.token)}), 'blocked before deletion');
 if (db) assert.equal(n('SELECT COUNT(*) AS n FROM resident_otps WHERE mobile_hash = ?', await hashOf(z.mobile)), 1, 'the sign-up left an OTP row (its resend cooldown is still running)');
 const deletedZ = manager ? await (async () => {const {version} = await must(await fetch(base + '/api/workspace', {headers: {cookie: manager}}), 200, 'workspace as manager'); return must(await fetch(base + '/api/workspace', {method: 'POST', headers: {cookie: manager, ...json}, body: JSON.stringify({action: 'delete-resident', id: z.id, version})}), 200, 'delete as residents.manage');})() : await admin.act({action: 'delete-resident', id: z.id});
 assert.deepEqual([deletedZ.id, deletedZ.deleted], [z.id, true]); assert.equal(deletedZ.data.residents.some(r => r.id === z.id), false);
 assert.equal((await fetch(base + '/api/workspace?view=resident', {headers: auth(z.token)})).status, 401, 'the old session is gone: 401, no longer 403 account_blocked');
 await must(await auth_({action: 'logout'}, z.token), 401, 'logout with the old token');
 if (db) {
  assert.deepEqual(['resident_sessions', 'resident_push_tokens'].map(table => n(`SELECT COUNT(*) AS n FROM ${table} WHERE resident_id = ?`, z.id)), [0, 0], 'sessions and push tokens are deleted with the resident');
  assert.equal(n('SELECT COUNT(*) AS n FROM resident_otps WHERE mobile_hash = ?', await hashOf(z.mobile)), 0, 'and so is the pending OTP row');
 }
 const afterZ = (await admin.get()).data, complaintZ = afterZ.complaints.find(c => c.id === cz);
 assert.deepEqual([complaintZ.resident, complaintZ.mobile, complaintZ.residentId, complaintZ.wardId, complaintZ.status], [FORMER, maskedOf(z.mobile), z.id, baseWard.id, 'Submitted'], 'the complaint stays, anonymised, with its ward');
 // The number is free at once (the 60 s resend cooldown went with the OTP row) and registers as a brand-new, unblocked resident.
 await must(await auth_({action: 'send-otp', mobile: z.mobile}), 200, 'send-otp straight after the deletion');
 const verifiedZ = await must(await auth_({action: 'verify-otp', mobile: z.mobile, code: OTP}), 200, 'verify-otp is no longer refused (it is a new number)'); assert.equal(verifiedZ.registered, false);
 const newZ = `QA ErasedBlocked ${nonce} Again`, photoZ = await resident(verifiedZ.token).upload();
 const tokenZ = (await must(await auth_({action: 'register', name: newZ, wardId: baseWard.id, address: '4 Erase Street, Jaipur', photoId: photoZ, consent: true}, verifiedZ.token), 200, 'register again')).token;
 const {data: freshZ} = await resident(tokenZ).get(); assert.deepEqual([freshZ.profile.id, freshZ.profile.name, freshZ.profile.readNotificationIds, freshZ.notifications], [z.id, newZ, [], []]);
 const rowZ = (await admin.get()).data.residents.find(r => r.mobile === z.mobile); assert.deepEqual([rowZ.name, rowZ.blocked, rowZ.blockedAt, rowZ.blockedReason], [newZ, false, null, ''], 'nothing of the block came back');
 return {x, y, z, cx, cy, db, baseWard, hashOf, n, pushToken};
}
async function deleteResidentPhase2(s) {
 const {x, y, cy, cx, db, baseWard, hashOf, n, pushToken} = s;
 const wait = x.sentAt + 61000 - Date.now(); if (wait > 0) {console.log(`waiting ${Math.ceil(wait / 1000)}s for the delete-resident QA resident's resend cooldown...`); await sleep(wait);}
 const xApp = resident(x.token), yApp = resident(y.token), last4 = x.mobile.slice(-4), xHash = await hashOf(x.mobile);
 const before = (await admin.get()).data, rowBefore = before.residents.find(r => r.id === x.id), complaintBefore = before.complaints.find(c => c.id === cx);
 assert.ok(rowBefore && complaintBefore, 'the resident and the complaint exist before the deletion'); assert.equal(complaintBefore.resident, x.name);
 assert.ok(before.communications.some(m => m.complaintId === cx && m.recipient === x.mobile), 'messages were queued for the resident’s number');
 assert.ok((await xApp.get()).data.notifications.some(n => n.complaintId === cx), 'the resident has a complaint notification');
 await xApp.act({action: 'register-push', token: pushToken});
 // A second device asks for a code: a challenge is pending when the resident is deleted.
 await must(await auth_({action: 'send-otp', mobile: x.mobile}), 200, 'send-otp for a registered resident');
 if (db) assert.deepEqual([n('SELECT COUNT(*) AS n FROM resident_otps WHERE mobile_hash = ?', xHash), n('SELECT COUNT(*) AS n FROM resident_push_tokens WHERE resident_id = ?', x.id), n('SELECT COUNT(*) AS n FROM media WHERE uploader = ?', x.id) >= 2, n('SELECT COUNT(*) AS n FROM resident_sessions WHERE resident_id = ?', x.id) >= 1], [1, 1, true, true], 'before: a pending OTP, a push token, uploads and a session');

 const result = await admin.act({action: 'delete-resident', id: x.id});
 assert.deepEqual(Object.keys(result).sort(), ['data', 'deleted', 'id', 'version']); assert.deepEqual([result.id, result.deleted], [x.id, true]); assert.equal(result.data.residents.some(r => r.id === x.id), false);
 assert.equal((await admin.act({action: 'delete-resident', id: x.id}, 404)).error, 'Resident not found.', 'a second call is a 404');
 assert.equal((await admin.get()).data.residents.some(r => r.id === y.id), true, 'other residents are untouched');

 // ---- the old session token: every call answers 401 (the session rows are gone)
 const stale = auth(x.token), staleCall = async (label, res) => {const text = await res.text(); assert.equal(res.status, 401, `${label}: expected 401, got ${res.status} ${text.slice(0, 120)}`);};
 await staleCall('workspace GET', await fetch(base + '/api/workspace?view=resident', {headers: stale})); await staleCall('workspace GET (no view)', await fetch(base + '/api/workspace', {headers: stale}));
 await staleCall('workspace POST', await fetch(base + '/api/workspace', {method: 'POST', headers: {...stale, ...json}, body: JSON.stringify({action: 'read-all-notifications', version: 1})}));
 await staleCall('register-push', await fetch(base + '/api/workspace', {method: 'POST', headers: {...stale, ...json}, body: JSON.stringify({action: 'register-push', token: pushToken})}));
 await staleCall('categories', await fetch(base + '/api/categories', {headers: stale})); await staleCall('media read', await xApp.media(x.photoId));
 const form = new FormData(); form.append('file', new Blob([png], {type: 'image/png'}), 'qa-stale.png'); await staleCall('media upload', await fetch(base + '/api/media', {method: 'POST', headers: stale, body: form}));
 await staleCall('logout', await auth_({action: 'logout'}, x.token)); await staleCall('legacy logout', await fetch(base + '/api/logout', {method: 'POST', headers: stale}));
 if (db) {
  assert.deepEqual(['resident_sessions', 'resident_push_tokens'].map(table => n(`SELECT COUNT(*) AS n FROM ${table} WHERE resident_id = ?`, x.id)), [0, 0]); assert.equal(n('SELECT COUNT(*) AS n FROM resident_otps WHERE mobile_hash = ?', xHash), 0, 'the pending OTP row is deleted');
  assert.deepEqual([n('SELECT COUNT(*) AS n FROM media WHERE uploader = ?', x.id), n('SELECT COUNT(*) AS n FROM media WHERE uploader = ?', 'deleted:' + x.id) >= 2], [0, true], 'the uploads stay (files and rows) but no longer belong to a resident id');
  const stored = JSON.parse(db.prepare('SELECT body FROM workspaces').get().body); assert.equal(x.id in stored.residentProfiles, false); assert.equal(stored.notifications.some(note => note.residentId === x.id), false, 'her notifications are gone');
  assert.equal(JSON.stringify(stored).includes(x.mobile), false, 'her mobile number is nowhere in the stored workspace'); assert.equal(JSON.stringify(stored).includes(x.name), false); assert.equal(JSON.stringify(stored).includes(x.email), false);
 }
 // The challenge that was pending cannot be used any more.
 assert.match((await must(await auth_({action: 'verify-otp', mobile: x.mobile, code: OTP}), 400, 'a pending OTP is unusable after the deletion')).error, /expired|never requested/);

 // ---- the complaint stays, anonymised; messages and the audit log carry no trace of the person
 const after = (await admin.get()).data, complaint = after.complaints.find(c => c.id === cx);
 assert.deepEqual([complaint.resident, complaint.mobile, complaint.residentId, complaint.status, complaint.history.length, complaint.wardId, complaint.title, complaint.id], [FORMER, maskedOf(x.mobile), x.id, 'Acknowledged', complaintBefore.history.length, baseWard.id, complaintBefore.title, cx]);
 assert.ok(complaint.wardLabel.includes(baseWard.number), 'the ward label is still computed'); assert.equal(complaint.history.some(h => h.actor === x.name), false, 'history lines lose the name'); assert.deepEqual(complaint.media, complaintBefore.media);
 const toHer = after.communications.filter(m => m.complaintId === cx); assert.ok(toHer.length >= 1); assert.equal(toHer.some(m => m.recipient === x.mobile), false, 'no message is addressed to her number any more'); assert.ok(toHer.some(m => m.recipient === maskedOf(x.mobile)), 'it is masked to the last four digits');
 assert.match(after.audit[0].action, new RegExp(`^Deleted app user ${x.id}: 1 complaint anonymised, 1 notification removed$`), 'the audit line names the resident by id only');
 for (const secret of [x.mobile, x.name, x.email, '3 Erased Street']) assert.equal(JSON.stringify(after).includes(secret), false, 'the administrator payload carries nothing that identifies the deleted resident: ' + secret);
 assert.equal((await fetch(base + '/api/media?id=' + x.photoId, {headers: {cookie}})).status, 404, 'her old profile photo is an unreferenced upload: nobody opens it');
 const evidence = complaintBefore.media[0]; assert.equal((await fetch(base + '/api/media?id=' + evidence, {headers: {cookie}})).status, 200, 'complaint evidence stays with the complaint');
 // Bystander: untouched, still signed in.
 const {data: yData} = await yApp.get(); assert.equal(yData.profile.name, y.name); assert.ok(yData.complaints.some(c => c.id === cy && c.resident === y.name && c.mobile === y.mobile));

 // ---- the number registers again as a brand-new resident
 await must(await auth_({action: 'send-otp', mobile: x.mobile}), 200, 'send-otp straight after the deletion (the resend cooldown went with the challenge)');
 const verified = await must(await auth_({action: 'verify-otp', mobile: x.mobile, code: OTP}), 200, 'verify-otp as a new number'); assert.equal(verified.registered, false); const reg = verified.token;
 const details = {action: 'register', name: `QA Erased ${nonce} Again`, wardId: baseWard.id, address: '5 Erase Street, Jaipur', consent: true};
 assert.match((await must(await auth_({...details, photoId: x.photoId}, reg), 400, 'the old photo cannot be reused')).error, /Upload your photo again/);
 const newPhoto = await resident(reg).upload(), token2 = (await must(await auth_({...details, photoId: newPhoto}, reg), 200, 'register again')).token, again = resident(token2);
 const {data: fresh} = await again.get();
 assert.deepEqual([fresh.profile.id, fresh.profile.name, fresh.profile.photoId, fresh.profile.readNotificationIds, 'blocked' in fresh.profile, fresh.notifications, fresh.unread.total], [x.id, details.name, newPhoto, [], false, [], 0], 'a brand-new profile: no old read markers, notifications or block');
 assert.equal((await again.media(x.photoId)).status, 404, 'not even the same mobile can open the old photo'); assert.equal((await again.media(newPhoto)).status, 200);
 const rowAfter = (await admin.get()).data.residents.find(r => r.id === x.id); assert.ok(rowAfter.registeredAt > rowBefore.registeredAt && rowAfter.blocked === false && rowAfter.name === details.name);
 const stillAnonymous = (await admin.get()).data.complaints.find(c => c.id === cx); assert.deepEqual([stillAnonymous.resident, stillAnonymous.mobile], [FORMER, maskedOf(x.mobile)], 'registering again does not un-anonymise the old complaint');
 // The ward office keeps working on the anonymised complaint; no message is queued for its masked number.
 await admin.act({action: 'edit', id: cx, assignee: 'Roads & Infrastructure'}); await admin.act({action: 'transition', id: cx, status: 'Assigned', note: 'Assigned (delete-resident test).'});
 const afterStatus = (await admin.get()).data; assert.equal(afterStatus.complaints.find(c => c.id === cx).status, 'Assigned');
 assert.equal(afterStatus.communications.some(m => m.complaintId === cx && m.template === 'Assigned' && (m.recipient === x.mobile || m.recipient === maskedOf(x.mobile))), false, 'no message is queued for a masked number');
}

const cleanup = [];
try {
 // ---------------------------------------------------------------- public endpoints, before any resident exists
 assert.equal((await fetch(base + '/api/workspace')).status, 401, 'workspace needs a login');
 assert.equal((await fetch(base + '/api/workspace', {headers: auth('not-a-real-token')})).status, 401);
 let {wards} = await must(await fetch(base + '/api/wards'), 200, 'wards');
 // A new workspace has no ward (administrators add them). When this one has none, create a QA ward the way an administrator would and remove it again at the end.
 if (!wards.length) {
  const qaBase = {number: 'Q' + nonce.slice(-5).toUpperCase(), name: 'QA Base Ward ' + nonce, nameHi: '', city: 'QA City', memberName: '', memberNameHi: '', active: true};
  const {wardId: baseId} = await admin.act({action: 'save-ward', ward: qaBase}); cleanup.push(async () => {await admin.act({action: 'delete-ward', id: baseId});});
  ({wards} = await must(await fetch(base + '/api/wards'), 200, 'wards'));
 }
 assert.ok(wards.length >= 1, 'there is a ward to register in');
 const baseWard = wards[0];
 for (const w of wards) {assert.deepEqual(Object.keys(w).sort(), ['city', 'id', 'memberName', 'memberNameHi', 'memberPhotoUrl', 'name', 'nameHi', 'number']);}
 assert.equal((await fetch(base + '/api/wards/photo?id=' + encodeURIComponent(baseWard.id))).status, wards.find(w => w.id === baseWard.id).memberPhotoUrl ? 200 : 404);
 assert.equal((await fetch(base + '/api/wards/photo?id=nope')).status, 404); assert.equal((await fetch(base + '/api/wards/photo')).status, 404);

 // ---------------------------------------------------------------- app users, phase 1 (registers two QA residents first so their OTP cooldown overlaps the rest of this test)
 const appUsers = await appUsersPhase1(baseWard, cleanup);
 const erase = await deleteResidentPhase1(baseWard, cleanup); // delete-resident, phase 1 (registers three more QA residents; permissions, a blocked resident, re-registration)

 // ---------------------------------------------------------------- admin ward management (settings.manage), including the public member photo
 const photo = await admin.upload();
 const qaWard = {number: 'T' + nonce.slice(-5).toUpperCase(), name: 'QA Ward ' + nonce, nameHi: 'परीक्षण वार्ड', city: 'Jaipur', memberName: 'QA Member', memberNameHi: 'परीक्षण सदस्य', memberPhotoId: photo, active: true};
 await admin.act({action: 'save-ward', ward: {...qaWard, number: baseWard.number}}, 400); // duplicate number
 await admin.act({action: 'save-ward', ward: {...qaWard, memberPhotoId: 'not-uploaded'}}, 403);
 const {wardId} = await admin.act({action: 'save-ward', ward: qaWard}); assert.ok(wardId);
 const listed = (await (await fetch(base + '/api/wards')).json()).wards.find(w => w.id === wardId);
 assert.equal(listed.memberPhotoUrl, `/api/wards/photo?id=${wardId}`); assert.equal(JSON.stringify(listed).includes(photo), false, 'the media id never leaves the server');
 const wardPhoto = await fetch(base + listed.memberPhotoUrl); assert.equal(wardPhoto.status, 200); assert.equal(wardPhoto.headers.get('content-type'), 'image/png'); assert.deepEqual(Buffer.from(await wardPhoto.arrayBuffer()), png); assert.match(wardPhoto.headers.get('cache-control'), /max-age/);
 const etag = wardPhoto.headers.get('etag'); assert.equal((await fetch(base + listed.memberPhotoUrl, {headers: {'If-None-Match': etag}})).status, 304);
 assert.ok((await admin.get()).data.wards.some(w => w.id === wardId && w.memberPhotoId === photo), 'admins see the stored ward');
 cleanup.push(async () => {await admin.act({action: 'delete-ward', id: wardId});});

 // ---------------------------------------------------------------- OTP: send, rate limits, lock, wrong code
 const mobile = mobileOf(1), formatted = `+91 ${mobile.slice(0, 5)} ${mobile.slice(5)}`;
 await must(await auth_({action: 'send-otp', mobile: '12345'}), 400, 'invalid mobile');
 const sentAt = Date.now();
 const sent = await must(await auth_({action: 'send-otp', mobile: formatted}), 200, 'send-otp'); assert.deepEqual(sent, {ok: true, expiresIn: 300, retryAfter: 60});
 const again = await auth_({action: 'send-otp', mobile}); await must(again, 429, 'resend cooldown'); assert.ok(Number(again.headers.get('retry-after')) > 0);
 assert.equal((await auth_({action: 'verify-otp', mobile, code: '000000'})).status === 400 || OTP === '000000', true, 'wrong code is a 400');
 assert.equal((await auth_({action: 'verify-otp', mobile, code: 'abc'})).status, 400);
 // Lock: five wrong codes on another number, then even the right code is refused with 429.
 const locked = mobileOf(2); await must(await auth_({action: 'send-otp', mobile: locked}), 200, 'send for lock');
 for (let i = 0; i < 4; i++) await must(await auth_({action: 'verify-otp', mobile: locked, code: i % 2 ? '111111' : '222222'}), 400, 'wrong code ' + i);
 await must(await auth_({action: 'verify-otp', mobile: locked, code: '333333'}), 429, 'fifth wrong code locks');
 await must(await auth_({action: 'verify-otp', mobile: locked, code: OTP}), 429, 'locked even for the right code');
 // Browsers always send Origin; a cross-site page is refused. Bearer clients (the app) send none and are accepted.
 assert.equal((await fetch(base + '/api/resident-auth', {method: 'POST', headers: {...json, Origin: 'https://evil.example'}, body: JSON.stringify({action: 'send-otp', mobile: mobileOf(3)})})).status, 403);

 // ---------------------------------------------------------------- verify -> registration token (limited) -> register
 const verified = await must(await auth_({action: 'verify-otp', mobile, code: OTP}), 200, 'verify-otp'); assert.equal(verified.registered, false); assert.ok(verified.token.length >= 32);
 const reg = verified.token;
 await must(await auth_({action: 'verify-otp', mobile, code: OTP}), 400, 'a spent code cannot be replayed');
 await must(await fetch(base + '/api/workspace?view=resident', {headers: auth(reg)}), 403, 'registration token cannot read the workspace');
 await must(await fetch(base + '/api/categories', {headers: auth(reg)}), 403, 'registration token cannot read categories');
 await must(await auth_({action: 'logout'}, 'bogus'), 401, 'logout with a bad token');
 const regPhoto = await resident(reg).upload(); assert.ok(regPhoto);
 assert.equal((await resident(reg).media(regPhoto)).status, 403, 'registration token cannot read media back');
 const details = {action: 'register', name: 'QA Resident ' + nonce, wardId: baseWard.id, email: 'qa@example.org', address: '12 Test Road, Jaipur', photoId: regPhoto, consent: true};
 for (const [label, patch] of Object.entries({consent: {consent: false}, 'no photo': {photoId: ''}, 'foreign photo': {photoId: photo}, name: {name: 'Q'}, address: {address: 'x'}, email: {email: 'nope'}, ward: {wardId: 'ward-404'}})) await must(await auth_({...details, ...patch}, reg), 400, 'register rejects ' + label);
 await must(await auth_(details), 401, 'register needs the registration token');
 await must(await auth_(details, 'bogus'), 401);
 const registered = await must(await auth_(details, reg), 200, 'register'); assert.ok(registered.token && registered.token !== reg);
 await must(await auth_(details, reg), 401, 'the registration token is consumed');
 const token = registered.token, me = resident(token);

 // ---------------------------------------------------------------- the registered resident's workspace
 let {data} = await me.get();
 assert.equal(data.viewer.role, 'Resident'); assert.equal(data.profile.name, details.name); assert.equal(data.profile.mobile, mobile); assert.equal(data.profile.wardId, baseWard.id); assert.equal(data.profile.photoId, regPhoto);
 assert.equal(data.profile.classifiedNotifications, true); assert.equal(data.profile.activityNotifications, true, 'activity notifications default to on'); assert.ok(data.profile.notificationConsentAt); assert.ok(data.profile.registeredAt); assert.match(data.profile.id, /^res-[0-9a-f]{24}$/);
 assert.equal(data.ward.id, baseWard.id); assert.deepEqual(data.unread, {complaints: 0, classifieds: 0, activities: 0, total: 0}); assert.deepEqual(data.complaints, []);
 assert.ok(data.settings.appConfig?.tabs && data.settings.appConfig?.support, 'residents receive the remote app configuration'); assert.equal('teams' in data.settings, false, 'the internal team list is not sent to residents'); assert.deepEqual(data.notifications, []);
 for (const hidden of ['Demo Resident', '•••••• 2100', 'sample-ad', 'sample-place', 'Water supply maintenance', 'residentProfiles', 'challenges', 'memberPhotoId']) assert.equal(JSON.stringify(data).includes(hidden), false, 'resident payload must not contain ' + hidden);
 assert.equal('wards' in data, false); assert.equal(data.audit.length, 0); assert.equal(data.communications.length, 0);
 assert.equal((await me.media(regPhoto)).status, 200, 'the resident can read their own photo');

 // ---------------------------------------------------------------- profile rules
 for (const patch of [{name: 'Someone Else'}, {mobile: '9000000000'}, {wardId: baseWard.id + 'x'}, {email: 'new@example.org'}, {address: 'Another place entirely'}, {language: 'fr'}, {classifiedNotifications: 'no'}, {activityNotifications: 'no'}, {activityNotifications: null}]) await me.act({action: 'save-profile', profile: patch}, 400);
 await me.act({action: 'save-profile', profile: {photoId: photo}}, 403); // someone else's upload
 const newPhoto = await me.upload(); await me.act({action: 'save-profile', profile: {photoId: newPhoto, language: 'hi'}});
 ({data} = await me.get()); assert.equal(data.profile.photoId, newPhoto); assert.equal(data.profile.language, 'hi'); assert.equal(data.profile.name, details.name);
 await me.act({action: 'save-ward', ward: qaWard}, 403); await me.act({action: 'save-classified', classified: {}}, 403); await me.act({action: 'save-activity', activity: {}}, 403); await me.act({action: 'publish-activity', id: 'x', status: 'published'}, 403);
 assert.equal((await fetch(base + '/api/workspace?section=admins', {headers: auth(token)})).status, 403);

 // ---------------------------------------------------------------- complaint, admin update, notification
 const evidence = await me.upload();
 const created = await me.act({action: 'create', title: 'QA: broken pathway ' + nonce, description: 'Automated resident test complaint with a synthetic evidence image.', category: 'Road & Footpath', locality: 'QA locality', lat: 26.91, lng: 75.78, media: [evidence], consent: true});
 const complaintId = created.id; assert.ok(complaintId);
 // The number is JSS/<yy>/W<ward>/<n>: the ward number of the resident's ward, never a hard-coded one; n counts per ward and year from 1.
 const wardPart = baseWard.number.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8), yearIst = String(new Date(Date.now() + 19800000).getUTCFullYear() % 100).padStart(2, '0');
 assert.match(complaintId, new RegExp('^JSS/' + yearIst + '/W' + wardPart + '/[1-9][0-9]*$'));
 await me.act({action: 'create', title: 'QA: borrowed photo', description: 'Uses an image another person uploaded.', category: 'Road & Footpath', locality: 'QA locality', lat: 26.91, lng: 75.78, media: [photo], consent: true}, 403);
 ({data} = await me.get()); const own = data.complaints.find(c => c.id === complaintId);
 assert.ok(own); assert.equal(own.resident, details.name); assert.equal(own.mobile, mobile); assert.equal(own.residentId, data.profile.id);
 const adminData = (await admin.get()).data, adminView = adminData.complaints.find(c => c.id === complaintId); assert.equal(adminView.resident, details.name); assert.equal(adminView.mobile, mobile);
 assert.equal(adminView.wardId, baseWard.id, 'the complaint stores the resident ward'); assert.ok(adminView.wardLabel.includes(baseWard.number), 'and the admin read carries its computed label'); assert.equal('wardLabel' in own, false, 'residents are not sent the computed label');
 assert.equal(new Set(adminData.complaints.map(c => c.id)).size, adminData.complaints.length, 'complaint numbers are unique');
 assert.equal(data.unread.total, 0, 'a resident is not notified of their own submission');
 await admin.act({action: 'transition', id: complaintId, status: 'Acknowledged', note: 'Received by the ward office (automated test).'});
 ({data} = await me.get());
 const notice = data.notifications.find(n => n.complaintId === complaintId); assert.ok(notice, 'status change creates a complaint notification');
 assert.deepEqual([notice.kind, notice.read, notice.title], ['complaint', false, `Complaint ${complaintId} is now Acknowledged`]); assert.match(notice.titleHi, /शिकायत/); assert.deepEqual(data.unread, {complaints: 1, classifieds: 0, activities: 0, total: 1});
 await me.act({action: 'read-notification', id: 'unknown-id'}, 400);
 await me.act({action: 'read-notification', id: notice.id}); ({data} = await me.get()); assert.deepEqual(data.unread, {complaints: 0, classifieds: 0, activities: 0, total: 0}); assert.equal(data.notifications.find(n => n.id === notice.id).read, true);
 await admin.act({action: 'transition', id: complaintId, status: 'Assigned', note: 'Assigned for the automated test.', ...{}}, 400); // no team assigned yet
 await admin.act({action: 'edit', id: complaintId, assignee: 'Roads & Infrastructure'}); await admin.act({action: 'transition', id: complaintId, status: 'Assigned', note: 'Assigned for the automated test.'});
 ({data} = await me.get()); assert.deepEqual(data.unread, {complaints: 1, classifieds: 0, activities: 0, total: 1});
 await me.act({action: 'read-all-notifications', kind: 'complaint'}); ({data} = await me.get()); assert.equal(data.unread.total, 0);

 // ---------------------------------------------------------------- push token registration (Expo tokens only, max five per resident)
 const tokens = Array.from({length: 6}, (_, i) => `ExponentPushToken[qa${nonce}${i}xxxxxxxxxx]`);
 await me.act({action: 'register-push', token: 'not-a-push-token'}, 400);
 for (const t of tokens) await me.act({action: 'register-push', token: t});
 for (const t of tokens) await me.act({action: 'unregister-push', token: t});
 await admin.act({action: 'register-push', token: tokens[0]}, 403);

 // ---------------------------------------------------------------- a second resident cannot see the first one's records
 const mobileB = mobileOf(4); await must(await auth_({action: 'send-otp', mobile: mobileB}), 200, 'send B');
 const regB = (await must(await auth_({action: 'verify-otp', mobile: mobileB, code: OTP}), 200, 'verify B')).token;
 const photoB = await resident(regB).upload();
 const tokenB = (await must(await auth_({action: 'register', name: 'QA Resident B ' + nonce, wardId: baseWard.id, address: '7 Test Lane, Jaipur', photoId: photoB, consent: true}, regB), 200, 'register B')).token, other = resident(tokenB);
 let {data: dataB} = await other.get();
 assert.deepEqual(dataB.complaints, []); assert.deepEqual(dataB.notifications, []); assert.equal(dataB.unread.total, 0); assert.equal(JSON.stringify(dataB).includes(complaintId), false); assert.equal(JSON.stringify(dataB).includes(mobile), false);
 assert.equal((await other.media(evidence)).status, 404, 'B cannot read A’s complaint evidence'); assert.equal((await other.media(newPhoto)).status, 404, 'B cannot read A’s profile photo'); assert.equal((await me.media(photoB)).status, 404);
 await other.act({action: 'dispute', id: complaintId, note: 'Trying to touch someone else’s complaint.'}, 404);
 await other.act({action: 'preview-closure-code', id: complaintId}, 404);

 // ---------------------------------------------------------------- classifieds: published ads notify only residents who opted in
 const ad = {title: 'QA advertisement ' + nonce, titleHi: 'परीक्षण विज्ञापन', description: 'Synthetic advertisement used by the resident API test.', descriptionHi: '', advertiser: 'QA only', contactPhone: '', url: '', imageId: '', startsAt: new Date(Date.now() - 60000).toISOString(), endsAt: new Date(Date.now() + 86400000).toISOString()};
 await other.act({action: 'save-profile', profile: {classifiedNotifications: false}});
 const adId = (await admin.act({action: 'save-classified', classified: ad})).id; cleanup.push(async () => {await admin.act({action: 'publish-classified', id: adId, status: 'archived'});});
 assert.equal((await admin.act({action: 'publish-classified', id: adId, status: 'published'})).notificationCreated, true);
 ({data} = await me.get()); const adNotice = data.notifications.find(n => n.classifiedId === adId); assert.ok(adNotice); assert.equal(adNotice.kind, 'classified'); assert.deepEqual(data.unread, {complaints: 0, classifieds: 1, activities: 0, total: 1});
 ({data: dataB} = await other.get()); assert.equal(dataB.notifications.some(n => n.classifiedId === adId), false, 'opted out'); assert.equal(dataB.unread.total, 0); assert.equal(dataB.profile.notificationConsentAt, null);
 await me.act({action: 'read-all-notifications'}); ({data} = await me.get()); assert.equal(data.unread.total, 0);

 // ---------------------------------------------------------------- activities: default-on notifications, opt-out, unread counts and the push audience
 const DAY = 86400000, actImage = await admin.upload();
 const activity = {title: 'QA activity ' + nonce, titleHi: 'परीक्षण गतिविधि', description: 'Synthetic programme used by the resident API test.', descriptionHi: '', organizer: 'Nagar Parishad, QA (test)', organizerHi: '', venue: 'QA ground', venueHi: '', startsAt: new Date(Date.now() + DAY).toISOString(), endsAt: new Date(Date.now() + 2 * DAY).toISOString(), imageId: actImage, contactPhone: '', url: ''};
 const actId = (await admin.act({action: 'save-activity', activity})).id; cleanup.push(async () => {await admin.act({action: 'publish-activity', id: actId, status: 'archived'});});
 ({data} = await me.get()); assert.equal(data.activities.some(a => a.id === actId), false, 'a draft activity is hidden'); assert.equal((await me.media(actImage)).status, 404, 'its image is hidden too');
 await other.act({action: 'save-profile', profile: {activityNotifications: false}});
 const pushTokens = {me: `ExponentPushToken[qaact${nonce}me0000]`, other: `ExponentPushToken[qaact${nonce}ot0000]`};
 await me.act({action: 'register-push', token: pushTokens.me}); await other.act({action: 'register-push', token: pushTokens.other});
 cleanup.push(async () => {await me.act({action: 'unregister-push', token: pushTokens.me}).catch(() => {}); await other.act({action: 'unregister-push', token: pushTokens.other}).catch(() => {});});
 const db = await localDb(), expectedDevices = db ? expectedActivityDevices(db) : null;
 if (db) assert.ok(expectedDevices >= 1, 'the opted-in resident has a device');
 const publishedAct = await admin.act({action: 'publish-activity', id: actId, status: 'published'}); assert.equal(publishedAct.notificationCreated, true);
 ({data} = await me.get()); const actNotice = data.notifications.find(n => n.activityId === actId);
 assert.ok(data.activities.some(a => a.id === actId), 'a published activity is listed'); assert.equal((await me.media(actImage)).status, 200, 'the image of a visible activity is readable');
 assert.ok(actNotice, 'default-on: the opted-in resident is notified'); assert.deepEqual([actNotice.kind, actNotice.read], ['activity', false]); assert.equal(actNotice.titleHi, activity.titleHi); assert.ok(actNotice.body.startsWith(activity.organizer));
 assert.deepEqual(data.unread, {complaints: 0, classifieds: 0, activities: 1, total: 1});
 ({data: dataB} = await other.get());
 assert.equal(dataB.profile.activityNotifications, false); assert.ok(dataB.activities.some(a => a.id === actId), 'opting out of notifications does not hide the activity itself'); assert.equal(dataB.notifications.some(n => n.activityId === actId), false, 'opted out: no notification');
 assert.deepEqual(dataB.unread, {complaints: 0, classifieds: 0, activities: 0, total: 0}); assert.equal((await other.media(actImage)).status, 200);
 // Opt-out hides the notification and zeroes the unread count; opting in again restores it.
 await me.act({action: 'save-profile', profile: {activityNotifications: false}}); ({data} = await me.get());
 assert.equal(data.notifications.some(n => n.activityId === actId), false); assert.deepEqual(data.unread, {complaints: 0, classifieds: 0, activities: 0, total: 0}); assert.equal(data.profile.activityNotifications, false);
 await me.act({action: 'save-profile', profile: {activityNotifications: true}}); ({data} = await me.get()); assert.ok(data.notifications.some(n => n.activityId === actId)); assert.equal(data.unread.activities, 1);
 await other.act({action: 'save-profile', profile: {activityNotifications: true}}); ({data: dataB} = await other.get()); assert.ok(dataB.notifications.some(n => n.activityId === actId), 'a resident who opts in later sees the still-visible activity'); assert.equal(dataB.unread.activities, 1);
 await other.act({action: 'read-all-notifications', kind: 'activity'}); ({data: dataB} = await other.get()); assert.equal(dataB.unread.activities, 0); await other.act({action: 'save-profile', profile: {activityNotifications: false}});
 await me.act({action: 'read-notification', id: actNotice.id}); ({data} = await me.get()); assert.equal(data.unread.activities, 0); assert.equal(data.notifications.find(n => n.activityId === actId).read, true); assert.equal(data.unread.total, 0);
 // One notification per first publication, however often it is republished.
 assert.equal((await admin.act({action: 'publish-activity', id: actId, status: 'published'})).notificationCreated, false); ({data} = await me.get()); assert.equal(data.notifications.filter(n => n.activityId === actId).length, 1);
 // Push audience: the push for the first publication was addressed to opted-in residents' devices only (the opted-out resident's registered device was left out).
 if (db) {
  let job; for (let i = 0; i < 40 && !job; i++) {job = db.prepare('SELECT detail FROM push_jobs WHERE classified_id = ?').get(actId); if (!job) await sleep(500);}
  assert.ok(job, 'a push job was recorded for the first publication'); const detail = JSON.parse(job.detail);
  assert.equal(detail.kind, 'activity'); assert.equal(detail.devices, expectedDevices, 'devices addressed = devices of registered residents who have not opted out');
 } else console.log('note: local D1 file not readable; push audience is covered by the unit tests only');
 await admin.act({action: 'publish-activity', id: actId, status: 'archived'}); ({data} = await me.get()); assert.equal(data.activities.some(a => a.id === actId), false, 'archived: hidden'); assert.equal(data.notifications.some(n => n.activityId === actId), false); assert.equal((await me.media(actImage)).status, 404);

 // ---------------------------------------------------------------- hidden banner media stays private to real resident sessions
 const originalBanners = (await admin.get()).data.settings.brandingBanners; const banner = await admin.upload();
 cleanup.push(async () => {await admin.act(originalBanners ? {action: 'save-banners', banners: originalBanners} : {action: 'save-banners', restoreDefault: true});});
 await admin.act({action: 'save-banners', banners: [{id: 'qa-' + nonce, title: 'QA hidden', imageId: banner, enabled: false}]});
 assert.equal((await me.media(banner)).status, 404, 'hidden banner media is not readable by residents');
 assert.equal((await fetch(base + '/api/media?id=' + banner, {headers: {cookie}})).status, 200, 'settings admins keep preview access');
 await admin.act({action: 'save-banners', banners: [{id: 'qa-' + nonce, title: 'QA visible', imageId: banner, enabled: true}]}); assert.equal((await me.media(banner)).status, 200);

 // ---------------------------------------------------------------- the admin pairing token still works, as a non-registered test device
 const pair = await must(await fetch(base + '/api/workspace', {method: 'POST', headers: {cookie, ...json}, body: JSON.stringify({action: 'pair-mobile'})}), 200, 'pair-mobile');
 const paired = await must(await fetch(base + '/api/workspace', {headers: auth(pair.token)}), 200, 'paired workspace');
 assert.equal(paired.data.viewer.role, 'Resident'); assert.ok(!paired.data.profile.registeredAt, 'a paired test device is not a registered resident'); assert.deepEqual(paired.data.complaints.filter(c => c.id === complaintId), []);
 await must(await fetch(base + '/api/workspace', {method: 'POST', headers: {...auth(pair.token), ...json}, body: JSON.stringify({action: 'save-profile', profile: {language: 'hi'}, version: paired.version})}), 403, 'paired device has no resident profile');
 assert.equal((await fetch(base + '/api/logout', {method: 'POST', headers: auth(pair.token)})).status, 200);

 // ---------------------------------------------------------------- logout, then log in again as a registered resident (lands on the same data)
 await must(await auth_({action: 'logout'}, token), 200, 'logout');
 assert.equal((await fetch(base + '/api/workspace?view=resident', {headers: auth(token)})).status, 401, 'the revoked session is rejected');
 await must(await auth_({action: 'logout'}, tokenB), 200, 'logout B');
 const wait = sentAt + 61000 - Date.now(); if (wait > 0) {console.log(`waiting ${Math.ceil(wait / 1000)}s for the resend cooldown...`); await sleep(wait);}
 await must(await auth_({action: 'send-otp', mobile}), 200, 'send-otp for login');
 const again2 = await must(await auth_({action: 'verify-otp', mobile: formatted, code: OTP}), 200, 'login verify'); assert.equal(again2.registered, true);
 const back = resident(again2.token); ({data} = await back.get());
 assert.equal(data.profile.name, details.name); assert.equal(data.profile.language, 'hi'); assert.ok(data.complaints.some(c => c.id === complaintId)); assert.equal(data.ward.id, baseWard.id);
 await must(await auth_(details, again2.token), 401, 'registered residents cannot register again with a session token');
 // /api/logout (the legacy route) revokes resident sessions too.
 assert.equal((await fetch(base + '/api/logout', {method: 'POST', headers: auth(again2.token)})).status, 200); assert.equal((await fetch(base + '/api/workspace?view=resident', {headers: auth(again2.token)})).status, 401);
 // ---------------------------------------------------------------- app users, phase 2: sign-in of a blocked number is refused, an unblocked resident signs in again
 await appUsersPhase2(appUsers);
 // ---------------------------------------------------------------- delete-resident, phase 2: a resident with a pending OTP is deleted; old token, OTP, anonymised complaint, the number registers again
 await deleteResidentPhase2(erase);
 console.log('PASS (delete-resident: permissions, 401 for the old token, OTP/sessions/push tokens gone, complaints anonymised, messages masked, audit by id, number registers again as a new resident, QA residents cleaned up).');
 console.log('PASS: wards -> OTP (send, cooldown, lock, replay) -> registration token limits -> register -> profile rules -> complaint + admin update -> notifications/unread -> push tokens -> resident isolation -> classified opt-in -> activities (default-on notifications, opt-out/in, unread, push audience) -> hidden banner privacy -> pairing token -> logout -> login again -> app users (admin list, edit, block, unblock, 403 account_blocked everywhere, verify-otp refused).');
} finally {
 for (const step of cleanup.reverse()) await step().catch(e => console.error('cleanup failed:', e.message));
}
