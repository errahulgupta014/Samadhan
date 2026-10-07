import assert from 'node:assert/strict';
import {base, ownerCookie} from './api-helpers.mjs';
/**
 * API smoke test for the administrator login (POST /api/admin-auth) against a running dev server (default http://localhost:5173).
 * It signs in with the built-in test-mode Super Admin (Admin / Admin; override with TEST_ADMIN_PASSWORD if the password was changed),
 * creates throwaway qa-* accounts, exercises sign-in, lockout, permissions, password change, logout and delete, and deletes every account it made.
 * It never changes the Admin password and never locks Admin (lockout is exercised on a throwaway username).
 * Set TEST_PLATFORM_IDENTITY_OFF=1 when the server runs with ADMIN_PLATFORM_IDENTITY=off.
 */
const ADMIN_USER = process.env.TEST_ADMIN_USERNAME || 'Admin', ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD || 'Admin';
const platformOff = process.env.TEST_PLATFORM_IDENTITY_OFF === '1';
const STRONG = 'Qa-Sturdy-Pass-91', STRONGER = 'Qa-Fresher-Pass-42';
const stamp = Date.now().toString(36);
const created = [];
const cookieOf = res => res.headers.getSetCookie().map(v => v.split(';')[0]).find(v => v.startsWith('samadhan_admin=')) ?? null;
async function auth(body, cookie, headers = {}) {
 const res = await fetch(base + '/api/admin-auth', {method: 'POST', headers: {'Content-Type': 'application/json', ...(cookie ? {cookie} : {}), ...headers}, body: JSON.stringify(body)});
 const text = await res.text(); let json = {}; try {json = JSON.parse(text);} catch {}
 return {res, json, status: res.status, cookie: cookieOf(res)};
}
async function workspace(cookie, body, headers = {}) {
 const res = await fetch(base + '/api/workspace', {method: body ? 'POST' : 'GET', headers: {'Content-Type': 'application/json', ...(cookie ? {cookie} : {}), ...headers}, ...(body ? {body: JSON.stringify(body)} : {})});
 let json = {}; try {json = await res.json();} catch {}
 return {res, json, status: res.status};
}
async function signIn(username, password) {const r = await auth({action: 'login', username, password}); assert.equal(r.status, 200, `login ${username}: ${JSON.stringify(r.json)}`); assert.ok(r.cookie, 'a session cookie is issued'); return r;}

// 1. Admin / Admin signs in; cookie attributes; the default-password flag
const bad = await auth({action: 'login', username: ADMIN_USER, password: 'definitely-wrong'});
assert.equal(bad.status, 401); assert.equal(bad.json.error, 'Incorrect username or password.'); assert.equal(bad.cookie, null);
const unknown = await auth({action: 'login', username: 'no-such-user-' + stamp, password: 'whatever1'});
assert.equal(unknown.status, 401); assert.equal(unknown.json.error, bad.json.error, 'unknown user and wrong password are indistinguishable');
const admin = await auth({action: 'login', username: ADMIN_USER.toLowerCase(), password: ADMIN_PASSWORD});
assert.equal(admin.status, 200, `Admin sign-in failed (${admin.status}). If the Admin password was changed, set TEST_ADMIN_PASSWORD.`);
const setCookie = admin.res.headers.getSetCookie().find(v => v.startsWith('samadhan_admin='));
for (const part of ['HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=43200']) assert.ok(setCookie.includes(part), `cookie has ${part}: ${setCookie.replace(/=[0-9a-f]{64}/, '=<token>')}`);
assert.match(admin.cookie, /^samadhan_admin=[0-9a-f]{64}$/); assert.equal(admin.res.headers.get('cache-control'), 'no-store');
const adminCookie = admin.cookie;
assert.equal(admin.json.ok, true); assert.equal(admin.json.user.username, 'Admin'); assert.equal(admin.json.user.role, 'Super Admin'); assert.equal(admin.json.user.active, true);
assert.ok(admin.json.user.permissions.includes('admins.manage')); assert.deepEqual(Object.keys(admin.json.user).sort(), ['active', 'avatarMediaId', 'createdAt', 'email', 'id', 'isDefaultPassword', 'lastLoginAt', 'mustChangePassword', 'name', 'permissions', 'role', 'username']);
assert.equal(JSON.stringify(admin.json).toLowerCase().includes('hash'), false, 'no hash in any response');
const me = await auth({action: 'me'}, adminCookie); assert.equal(me.json.user.username, 'Admin'); assert.equal(typeof me.json.defaultPassword, 'boolean');
if (ADMIN_PASSWORD === 'Admin') assert.equal(me.json.defaultPassword, true, 'the built-in password is reported as the default password until it is changed');
assert.equal((await auth({action: 'me'})).json.user, null, 'no cookie, no user');
assert.deepEqual((await auth({action: 'me'}, 'samadhan_admin=' + '0'.repeat(64))).json, {user: null, defaultPassword: false});

// 2. CSRF and request hygiene
assert.equal((await auth({action: 'me'}, adminCookie, {Origin: 'https://evil.example'})).status, 403, 'assertOrigin on admin-auth');
assert.equal((await auth({action: 'logout'}, adminCookie, {Origin: 'https://evil.example'})).status, 403);
assert.equal((await fetch(base + '/api/admin-auth', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: 'not json'})).status, 400);
assert.equal((await auth({action: 'nope'}, adminCookie)).status, 400);
assert.equal((await auth({action: 'list-users'})).status, 401, 'account actions need a session');

try {
 // 3. Super Admin creates users: limited, and one forced to change password
 const nameOf = label => `qa-${label}-${stamp}`;
 async function createUser(label, extra) {
  const username = nameOf(label);
  const r = await auth({action: 'create-user', username, name: `QA ${label}`, email: '', password: STRONG, role: 'Custom', permissions: ['announcements.manage'], mustChangePassword: false, ...extra}, adminCookie);
  if (r.status === 200) created.push(r.json.user.id);
  return {...r, username};
 }
 const limited = await createUser('limited'); assert.equal(limited.status, 200, JSON.stringify(limited.json));
 assert.deepEqual(limited.json.user.permissions, ['announcements.manage']); assert.equal(limited.json.user.role, 'Custom'); assert.equal(limited.json.user.isDefaultPassword, false);
 assert.equal((await createUser('limited')).status, 409, 'duplicate username');
 assert.equal((await auth({action: 'create-user', username: nameOf('limited').toUpperCase(), name: 'Dup', password: STRONG, role: 'Auditor'}, adminCookie)).status, 409, 'usernames are case-insensitive');
 for (const [label, extra, status] of [['shortpw', {password: 'short'}, 400], ['samepw', {password: nameOf('samepw')}, 400], ['badname', {username: 'bad name!'}, 400], ['escalate', {permissions: ['admins.manage']}, 400], ['norole', {role: 'Root'}, 400], ['complaints', {permissions: ['complaints.manage']}, 400]]) {
  const r = await auth({action: 'create-user', username: nameOf(label), name: 'X Y', password: STRONG, role: 'Custom', permissions: ['audit.read'], ...extra}, adminCookie); if (r.status === 200) created.push(r.json.user.id);
  assert.equal(r.status, status, `${label}: ${JSON.stringify(r.json)}`);
 }
 const list = await auth({action: 'list-users'}, adminCookie); assert.equal(list.status, 200);
 assert.ok(list.json.users.some(u => u.username === limited.username) && list.json.users.some(u => u.username === 'Admin')); assert.equal(JSON.stringify(list.json).toLowerCase().includes('hash'), false);

 // 4. The limited user: cannot manage users, cannot see or do what they lack
 const ls = await signIn(limited.username, STRONG); const lc = ls.cookie;
 assert.deepEqual(ls.json.user.permissions, ['announcements.manage']);
 for (const body of [{action: 'list-users'}, {action: 'create-user', username: nameOf('sneaky'), name: 'Sneaky', password: STRONG, role: 'Super Admin'}, {action: 'update-user', id: limited.json.user.id, name: 'Me', role: 'Super Admin', permissions: [], active: true}, {action: 'reset-password', id: list.json.users.find(u => u.username === 'Admin').id, newPassword: STRONG}, {action: 'delete-user', id: list.json.users.find(u => u.username === 'Admin').id}]) {
  const r = await auth(body, lc); assert.equal(r.status, 403, `${body.action} must be denied: ${JSON.stringify(r.json)}`);
 }
 const ws = await workspace(lc); assert.equal(ws.status, 200); assert.equal(ws.json.data.viewer.role, 'Custom'); assert.equal(ws.json.data.viewer.email, limited.username); assert.deepEqual(ws.json.data.viewer.permissions, ['announcements.manage']);
 assert.deepEqual(ws.json.data.complaints, [], 'no complaints.read: no complaints'); assert.deepEqual(ws.json.data.audit, [], 'no audit.read: no audit log'); assert.deepEqual(ws.json.data.communications, []);
 assert.equal((await workspace(lc, undefined)).json.data.wards, undefined, 'no settings.manage: no ward records');
 assert.equal((await fetch(base + '/api/workspace?section=admins', {headers: {cookie: lc}})).status, 403, 'legacy grants need admins.manage');
 const version = ws.json.version;
 for (const body of [{action: 'transition', id: 'x', status: 'Acknowledged'}, {action: 'save-category', category: {}}, {action: 'settings', contact: 'Ward office', slaHours: 24}, {action: 'save-ward', ward: {}}, {action: 'save-classified', classified: {}}, {action: 'save-activity', activity: {}}, {action: 'save-place', place: {}}, {action: 'save-municipality', municipality: {}}, {action: 'pair-mobile'}, {action: 'save-admin', admin: {email: 'x@example.test', role: 'Auditor', active: true}}]) {
  const r = await workspace(lc, {...body, version}); assert.equal(r.status, 403, `${body.action} must be denied for a user without that permission: ${r.status} ${JSON.stringify(r.json)}`);
 }
 const allowed = await workspace(lc, {action: 'announcement', title: 'x', body: 'y', version}); assert.equal(allowed.status, 400, `announcements.manage passes the permission check and then fails validation, creating nothing: ${allowed.status} ${JSON.stringify(allowed.json)}`);
 assert.equal((await workspace(lc, {action: 'announcement', title: 'x', body: 'y', view: 'resident', version})).status, 403, 'an admin session cannot use resident mode to reach admin actions');

 // 5. Platform identity: still works for existing tooling unless disabled; the portal marker never uses it
 if (!platformOff) {
  const platform = await ownerCookie();
  assert.equal((await workspace(platform)).status, 200, 'platform identity still works while ADMIN_PLATFORM_IDENTITY is not off');
  assert.equal((await workspace(platform, undefined, {'x-samadhan-portal': '1'})).status, 401, 'requests marked as the portal UI never fall back to the platform identity');
  assert.equal((await workspace(`${platform}; ${lc}`)).json.data.viewer.email, limited.username, 'when both are present the admin session wins');
  assert.equal((await workspace(`${platform}; samadhan_admin=${'1'.repeat(64)}`)).status, 401, 'a present but invalid admin cookie does not fall back');
 } else assert.equal((await workspace(await ownerCookie().catch(() => ''))).status, 401, 'platform identity is off');

 // 6. Forced password change at first sign-in
 const forced = await createUser('forced', {mustChangePassword: true, role: 'Auditor', permissions: []}); assert.equal(forced.status, 200); assert.equal(forced.json.user.mustChangePassword, true);
 const fs = await signIn(forced.username, STRONG); const fc = fs.cookie; assert.equal(fs.json.user.mustChangePassword, true);
 assert.equal((await workspace(fc)).status, 403, 'the workspace is closed until the password is changed'); assert.equal((await auth({action: 'list-users'}, fc)).status, 403);
 assert.equal((await auth({action: 'me'}, fc)).json.user.mustChangePassword, true);
 const wrongCurrent = await auth({action: 'change-password', currentPassword: 'not-it-at-all', newPassword: STRONGER}, fc); assert.equal(wrongCurrent.status, 400);
 for (const newPassword of ['short', forced.username, STRONG, 'password1']) assert.equal((await auth({action: 'change-password', currentPassword: STRONG, newPassword}, fc)).status, 400, `new password "${newPassword}" is refused`);
 const other = await signIn(forced.username, STRONG);
 const changed = await auth({action: 'change-password', currentPassword: STRONG, newPassword: STRONGER}, fc); assert.equal(changed.status, 200, JSON.stringify(changed.json)); assert.equal(changed.json.user.mustChangePassword, false); assert.equal(changed.json.user.isDefaultPassword, false);
 assert.equal((await workspace(fc)).status, 200, 'the workspace opens after the change'); assert.equal((await auth({action: 'me'}, fc)).json.user.username, forced.username, 'the session that changed the password stays signed in');
 assert.equal((await auth({action: 'me'}, other.cookie)).json.user, null, 'every other session of that user is signed out'); assert.equal((await workspace(other.cookie)).status, 401);
 assert.equal((await auth({action: 'login', username: forced.username, password: STRONG})).status, 401, 'the old password stops working');
 await signIn(forced.username, STRONGER);

 // 7. Role / permission changes, disabling and resetting revoke sessions at once; Admin cannot be edited destructively
 const adminId = list.json.users.find(u => u.username === 'Admin').id;
 const before = await signIn(limited.username, STRONG);
 const upd = await auth({action: 'update-user', id: limited.json.user.id, name: 'QA limited', email: 'qa@example.test', role: 'Custom', permissions: ['announcements.manage', 'audit.read'], active: true}, adminCookie); assert.equal(upd.status, 200, JSON.stringify(upd.json));
 assert.deepEqual(upd.json.user.permissions, ['announcements.manage', 'audit.read']); assert.equal(upd.json.user.email, 'qa@example.test');
 assert.equal((await auth({action: 'me'}, before.cookie)).json.user, null, 'a permission change signs the user out');
 const regained = await signIn(limited.username, STRONG); assert.ok((await workspace(regained.cookie)).json.data.audit.length >= 0);
 assert.equal((await auth({action: 'update-user', id: limited.json.user.id, name: 'QA limited', role: 'Custom', permissions: ['admins.manage'], active: true}, adminCookie)).status, 400, 'admins.manage cannot be granted to a Custom role');
 assert.equal((await auth({action: 'update-user', id: limited.json.user.id, name: 'QA limited', role: 'Custom', permissions: ['announcements.manage'], active: 'yes'}, adminCookie)).status, 400);
 for (const body of [{action: 'update-user', id: adminId, name: 'Administrator', role: 'Ward Admin', permissions: [], active: true}, {action: 'update-user', id: adminId, name: 'Administrator', role: 'Super Admin', permissions: [], active: false}, {action: 'delete-user', id: adminId}, {action: 'reset-password', id: adminId, newPassword: STRONG}]) {
  const r = await auth(body, adminCookie); assert.equal(r.status, 409, `${body.action} on yourself: ${JSON.stringify(r.json)}`);
 }
 assert.equal((await auth({action: 'me'}, adminCookie)).json.user.role, 'Super Admin', 'Admin is still a Super Admin');
 const off = await auth({action: 'update-user', id: limited.json.user.id, name: 'QA limited', role: 'Custom', permissions: ['announcements.manage'], active: false}, adminCookie); assert.equal(off.status, 200);
 assert.equal((await auth({action: 'me'}, regained.cookie)).json.user, null, 'disabling signs the user out'); assert.equal((await auth({action: 'login', username: limited.username, password: STRONG})).status, 401, 'a disabled user cannot sign in');
 assert.equal((await auth({action: 'update-user', id: limited.json.user.id, name: 'QA limited', role: 'Custom', permissions: ['announcements.manage'], active: true}, adminCookie)).status, 200);
 const live = await signIn(limited.username, STRONG);
 const reset = await auth({action: 'reset-password', id: limited.json.user.id, newPassword: STRONGER}, adminCookie); assert.equal(reset.status, 200); assert.equal(reset.json.user.mustChangePassword, true);
 assert.equal((await auth({action: 'me'}, live.cookie)).json.user, null, 'a password reset signs the user out'); assert.equal((await auth({action: 'login', username: limited.username, password: STRONG})).status, 401);
 assert.equal((await auth({action: 'reset-password', id: limited.json.user.id, newPassword: 'short'}, adminCookie)).status, 400);
 assert.equal((await signIn(limited.username, STRONGER)).json.user.mustChangePassword, true);

 // 8. Lockout on a throwaway username (never Admin), then clean-up clears it
 const lock = await createUser('lock'); assert.equal(lock.status, 200);
 for (let i = 1; i <= 4; i++) assert.equal((await auth({action: 'login', username: lock.username, password: 'wrong-' + i})).status, 401);
 const locked = await auth({action: 'login', username: lock.username, password: 'wrong-5'});
 assert.equal(locked.status, 429, JSON.stringify(locked.json)); assert.ok(locked.json.retryAfter > 0 && locked.json.retryAfter <= 900, 'retryAfter in the body'); assert.ok(Number(locked.res.headers.get('retry-after')) > 0, 'Retry-After header'); assert.match(locked.json.error, /Too many failed attempts/);
 const stillLocked = await auth({action: 'login', username: lock.username, password: STRONG}); assert.equal(stillLocked.status, 429, 'even the correct password is refused while locked'); assert.equal(stillLocked.cookie, null);
 assert.equal((await auth({action: 'login', username: lock.username.toUpperCase(), password: STRONG})).status, 429, 'case does not dodge the lock');
 assert.equal((await signIn(ADMIN_USER, ADMIN_PASSWORD)).status, 200, 'Admin is not affected by another username being locked');
 const ghost = 'qa-ghost-' + stamp; for (let i = 0; i < 5; i++) await auth({action: 'login', username: ghost, password: 'nope-' + i}); assert.equal((await auth({action: 'login', username: ghost, password: 'nope-x'})).status, 429, 'unknown usernames lock too');
 // the lock is cleared when the account is deleted and recreated
 assert.equal((await auth({action: 'delete-user', id: lock.json.user.id}, adminCookie)).status, 200); created.splice(created.indexOf(lock.json.user.id), 1);
 const again = await createUser('lock'); assert.equal(again.status, 200); assert.equal((await signIn(again.username, STRONG)).status, 200, 'no lockout state is left behind');

 // 9. Audit log: human readable, attributed, and free of passwords
 const audit = (await workspace(adminCookie)).json.data.audit.filter(a => a.action.startsWith('Admin access:'));
 assert.ok(audit.length > 5, 'admin access events are in the audit log');
 for (const entry of audit) {assert.equal(entry.action.includes('{'), false, `no raw JSON: ${entry.action}`); assert.ok(entry.actor, 'every event has an actor');}
 const text = audit.map(a => a.action + '|' + a.actor).join('\n');
 for (const wanted of [/Signed in/, /Failed sign-in: wrong password/, /Locked out/, /Created user \(Custom/, /Updated: .*permissions changed/, /account disabled/, /Password reset by an administrator/, /Changed own password/]) assert.match(text, wanted);
 for (const secret of [STRONG, STRONGER, 'definitely-wrong', 'wrong-5', 'nope-x']) assert.equal(text.includes(secret), false, 'no password in the audit log');
 for (const entry of (await workspace(adminCookie)).json.data.audit) assert.equal(/^Admin access:.*\{"/.test(entry.action), false, 'legacy grants are no longer raw JSON');

 // 10. Logout invalidates the cookie everywhere; deleting a user does too
 const out = await signIn(limited.username, STRONGER); assert.equal((await workspace(out.cookie)).status, 403, 'still forced to change the reset password');
 const solo = await signIn(again.username, STRONG);
 const loggedOut = await auth({action: 'logout'}, solo.cookie); assert.equal(loggedOut.status, 200); assert.ok(loggedOut.res.headers.getSetCookie().some(v => v.startsWith('samadhan_admin=;') && v.includes('Max-Age=0')), 'the cookie is cleared');
 assert.equal((await auth({action: 'me'}, solo.cookie)).json.user, null, 'the old cookie no longer works'); assert.equal((await workspace(solo.cookie)).status, 401); assert.equal((await auth({action: 'list-users'}, solo.cookie)).status, 401);
 const doomed = await signIn(limited.username, STRONGER);
 assert.equal((await auth({action: 'delete-user', id: limited.json.user.id}, adminCookie)).status, 200); created.splice(created.indexOf(limited.json.user.id), 1);
 assert.equal((await auth({action: 'me'}, doomed.cookie)).json.user, null, 'deleting a user signs them out'); assert.equal((await auth({action: 'login', username: limited.username, password: STRONGER})).status, 401);
 assert.equal((await auth({action: 'delete-user', id: limited.json.user.id}, adminCookie)).status, 404);
 assert.equal((await auth({action: 'delete-user', id: 'not-a-user'}, adminCookie)).status, 404);

 // 11. Admin session: Admin keeps working throughout, and the portal APIs accept it
 const finalAdmin = await workspace(adminCookie); assert.equal(finalAdmin.status, 200); assert.equal(finalAdmin.json.data.viewer.role, 'Super Admin'); assert.equal(finalAdmin.json.data.viewer.email, 'Admin');
 const stale = await auth({action: 'logout'}, adminCookie); assert.equal(stale.status, 200);
 assert.equal((await workspace(adminCookie)).status, 401, 'logging Admin out ends that session too');
 console.log('Admin authentication API checks passed.');
} finally {
 // Clean up every account this run created (sign in again: the Admin session above was used up by the logout check)
 const cleanup = await auth({action: 'login', username: ADMIN_USER, password: ADMIN_PASSWORD});
 if (cleanup.cookie) {
  const users = (await auth({action: 'list-users'}, cleanup.cookie)).json.users ?? [];
  for (const u of users.filter(u => u.username.startsWith('qa-') && u.username.endsWith('-' + stamp))) await auth({action: 'delete-user', id: u.id}, cleanup.cookie);
  await auth({action: 'logout'}, cleanup.cookie);
 }
}
