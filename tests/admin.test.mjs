import test from 'node:test';
import assert from 'node:assert/strict';
import {buildModules} from './build-ts.mjs';
// Unit tests for the administrator login: password hashing, account policy, lockout, sessions and the account lifecycle (in-memory store;
// the D1 layer and the HTTP surface are covered by tests/admin-auth-api.mjs against a running dev server).
buildModules(['shared/domain', 'shared/community', 'shared/access', 'lib/service', 'lib/access-policy', 'lib/admin-crypto', 'lib/admin-policy', 'lib/admin-auth-core', 'lib/admin-cookie'], 'tests/.admin');
const crypto$ = await import('./.admin/admin-crypto.mjs');
const policy = await import('./.admin/admin-policy.mjs');
const core = await import('./.admin/admin-auth-core.mjs');
const cookie = await import('./.admin/admin-cookie.mjs');
const {rolePresets, permissions} = await import('./.admin/access.mjs');
const {validateAdminGrant} = await import('./.admin/access-policy.mjs');
const {hashPassword, verifyPassword, timingSafeEqual, needsRehash, PBKDF2_ITERATIONS, MIN_PBKDF2_ITERATIONS, sha256Hex, randomHex} = crypto$;
const {effectivePermissions, normalizeUsername, normalizeEmail, normalizeName, validatePassword, planCreateUser, planUpdateUser, planDeleteUser, planResetPassword, toAdminView, LAST_SUPER_ADMIN_MESSAGE} = policy;
const {ServiceError} = await import('./.admin/service.mjs');

const H = 3600 * 1000, T0 = Date.UTC(2026, 9, 6, 9, 0, 0);
const rejects = (fn, code, pattern) => assert.throws(fn, e => e instanceof ServiceError && (code === undefined || e.code === code) && (!pattern || pattern.test(e.message)), `expected ServiceError ${code ?? ''} ${pattern ?? ''}`);
const rejectsAsync = (promise, code, pattern) => assert.rejects(promise, e => e instanceof ServiceError && (code === undefined || e.code === code) && (!pattern || pattern.test(e.message)), `expected ServiceError ${code ?? ''} ${pattern ?? ''}`);

/** In-memory AdminStore with the same contract as lib/admin-store.ts (returns copies, like a database would). */
function memoryStore() {
 const users = new Map(), sessions = new Map(), failures = [], events = [], copy = v => v && structuredClone(v);
 const others = (owner, except) => [...users.values()].filter(u => u.owner === owner && u.role === 'Super Admin' && u.active && u.id !== except).length;
 return {
  users, sessions, failures, events,
  async countActiveUsers(owner) {return [...users.values()].filter(u => u.owner === owner && u.active).length;},
  async countActiveSuperAdmins(owner, except = '') {return others(owner, except);},
  async getUserByKey(owner, key) {return copy([...users.values()].find(u => u.owner === owner && u.username.toLowerCase() === key)) ?? null;},
  async getUserById(owner, id) {const u = users.get(id); return u && u.owner === owner ? copy(u) : null;},
  async listUsers(owner) {return [...users.values()].filter(u => u.owner === owner).map(copy).sort((a, b) => a.username.toLowerCase().localeCompare(b.username.toLowerCase()));},
  async insertUser(user) {if ([...users.values()].some(u => u.username.toLowerCase() === user.username.toLowerCase())) return false; users.set(user.id, copy(user)); return true;},
  async saveUser(user, options) {if (!users.has(user.id)) return false; if (options?.needsOtherSuperAdmin && !others(user.owner, user.id)) return false; users.set(user.id, copy(user)); return true;},
  async deleteUser(owner, id, options) {if (!users.has(id)) return false; if (options?.needsOtherSuperAdmin && !others(owner, id)) return false; users.delete(id); return true;},
  async insertSession(s) {sessions.set(s.tokenHash, copy(s));},
  async getSession(hash) {return copy(sessions.get(hash)) ?? null;},
  async extendSession(hash, expires) {sessions.get(hash).expires = expires;},
  async deleteSession(hash) {sessions.delete(hash);},
  async deleteUserSessions(userId, except) {for (const [hash, s] of sessions) if (s.userId === userId && hash !== except) sessions.delete(hash);},
  async failuresSince(bucket, since) {return failures.filter(f => f.bucket === bucket && f.at > since).map(f => f.at).sort((a, b) => a - b);},
  async addFailure(bucket, at) {failures.push({bucket, at});},
  async clearFailures(bucket) {for (let i = failures.length - 1; i >= 0; i--) if (failures[i].bucket === bucket) failures.splice(i, 1);},
  async audit(event) {events.push(event);},
 };
}
const OWNER = 'owner-1', STRONG = 'Correct-Horse-9';
const user = (overrides = {}) => ({id: 'u1', owner: OWNER, username: 'ravi', name: 'Ravi', email: null, role: 'Complaint Officer', permissions: [], active: true, mustChangePassword: false, isDefaultPassword: false, passwordHash: 'x', salt: 'aa', iterations: 1, createdAt: '', updatedAt: '', lastLoginAt: null, ...overrides});
const superAdmin = (overrides = {}) => user({id: 'sa1', username: 'Boss', name: 'Boss', role: 'Super Admin', ...overrides});

/* ---------------- passwords ---------------- */
test('PBKDF2 hashing: per-user salt, >=150k iterations, constant-time verify, nothing reversible', async () => {
 assert.ok(PBKDF2_ITERATIONS >= 150000 && MIN_PBKDF2_ITERATIONS >= 150000);
 const a = await hashPassword(STRONG), b = await hashPassword(STRONG);
 assert.equal(a.iterations, PBKDF2_ITERATIONS); assert.match(a.salt, /^[0-9a-f]{32}$/); assert.match(a.hash, /^[0-9a-f]{64}$/);
 assert.notEqual(a.salt, b.salt, 'a fresh random salt per hash'); assert.notEqual(a.hash, b.hash, 'the same password hashes differently for two users');
 assert.equal(JSON.stringify(a).includes(STRONG), false);
 assert.equal(await verifyPassword(STRONG, a), true);
 assert.equal(await verifyPassword(STRONG + 'x', a), false);
 assert.equal(await verifyPassword('', a), false);
 assert.equal(await verifyPassword(STRONG.toLowerCase(), a), false);
 const fixed = await hashPassword(STRONG, {salt: '00'.repeat(16)}), again = await hashPassword(STRONG, {salt: '00'.repeat(16)});
 assert.equal(fixed.hash, again.hash, 'same salt and password derive the same key');
});
test('PBKDF2: weak iteration counts are refused and malformed records never match or throw', async () => {
 await assert.rejects(hashPassword(STRONG, {iterations: 1000}), /iterations/);
 const good = await hashPassword(STRONG);
 for (const bad of [{...good, hash: 'zz'}, {...good, salt: 'not-hex'}, {...good, iterations: 0}, {...good, iterations: NaN}, {...good, hash: ''}, {...good, hash: good.hash.slice(2)}]) assert.equal(await verifyPassword(STRONG, bad), false);
 assert.equal(needsRehash({iterations: PBKDF2_ITERATIONS - 1}), true); assert.equal(needsRehash({iterations: PBKDF2_ITERATIONS}), false);
});
test('timingSafeEqual compares whole byte strings, including different lengths', () => {
 assert.equal(timingSafeEqual(Uint8Array.of(1, 2, 3), Uint8Array.of(1, 2, 3)), true);
 assert.equal(timingSafeEqual(Uint8Array.of(1, 2, 3), Uint8Array.of(1, 2, 4)), false);
 assert.equal(timingSafeEqual(Uint8Array.of(1, 2, 3), Uint8Array.of(1, 2)), false);
 assert.equal(timingSafeEqual(Uint8Array.of(), Uint8Array.of()), true);
 assert.match(randomHex(32), /^[0-9a-f]{64}$/); assert.notEqual(randomHex(32), randomHex(32));
});

/* ---------------- validation ---------------- */
test('usernames: 3-32 characters of letters, digits, dot, dash and underscore', () => {
 for (const ok of ['Admin', 'abc', 'a.b-c_d', 'ward12.officer', 'x'.repeat(32), '  padded  ']) assert.doesNotThrow(() => normalizeUsername(ok), ok);
 assert.equal(normalizeUsername('  padded  '), 'padded');
 for (const bad of ['ab', 'x'.repeat(33), 'has space', 'a@b', 'ravi!', 'नाम', '', '   ', null, undefined, 42, 'a/b', "o'neil"]) rejects(() => normalizeUsername(bad), 400, /Username/);
});
test('names and emails are optional-safe and bounded', () => {
 assert.equal(normalizeName('  Ravi   Kumar '), 'Ravi Kumar'); rejects(() => normalizeName('R'), 400); rejects(() => normalizeName('x'.repeat(81)), 400); rejects(() => normalizeName(5), 400);
 assert.equal(normalizeEmail(''), null); assert.equal(normalizeEmail(undefined), null); assert.equal(normalizeEmail(null), null); assert.equal(normalizeEmail(' Ravi@Example.COM '), 'ravi@example.com');
 rejects(() => normalizeEmail('not-an-email'), 400); rejects(() => normalizeEmail('a@b'), 400); rejects(() => normalizeEmail('a b@c.in'), 400);
});
test('password policy: 8-128 characters, not the username, not the current password, not trivial', () => {
 assert.equal(validatePassword(STRONG, {username: 'ravi'}), STRONG);
 rejects(() => validatePassword('short1', {username: 'ravi'}), 400, /at least 8/);
 rejects(() => validatePassword('x'.repeat(129), {username: 'ravi'}), 400, /128/);
 rejects(() => validatePassword('        ', {username: 'ravi'}), 400, /spaces/);
 rejects(() => validatePassword('RAVI.KUMAR', {username: 'ravi.kumar'}), 400, /username/);
 rejects(() => validatePassword(STRONG, {username: 'ravi', current: STRONG}), 400, /different/);
 rejects(() => validatePassword('Password1', {username: 'ravi'}), 400, /easy to guess/);
 rejects(() => validatePassword('12345678', {username: 'ravi'}), 400, /easy to guess/);
 for (const bad of [undefined, null, 12345678, '', {}]) rejects(() => validatePassword(bad, {username: 'ravi'}), 400);
 assert.doesNotThrow(() => validatePassword('x'.repeat(128), {username: 'ravi'}));
});

/* ---------------- permissions and roles ---------------- */
test('effective permissions: presets are always current, Custom is filtered and can never carry admins.manage', () => {
 assert.deepEqual(effectivePermissions('Super Admin', []), [...permissions], 'a Super Admin with an old stored list still gets every permission, including newly added ones');
 assert.deepEqual(effectivePermissions('Auditor', ['admins.manage', 'settings.manage']), [...rolePresets.Auditor]);
 assert.deepEqual(effectivePermissions('Custom', ['complaints.read', 'admins.manage', 'bogus', 'complaints.read', 'audit.read']), ['complaints.read', 'audit.read']);
 assert.deepEqual(effectivePermissions('Custom', []), []);
});
test('the view never contains a hash, a salt or the stored permission snapshot', () => {
 const view = toAdminView(user({passwordHash: 'secret-hash', salt: 'secret-salt', permissions: ['audit.read']}));
 assert.equal(JSON.stringify(view).includes('secret'), false); assert.deepEqual(Object.keys(view).sort(), ['active', 'avatarMediaId', 'createdAt', 'email', 'id', 'isDefaultPassword', 'lastLoginAt', 'mustChangePassword', 'name', 'permissions', 'role', 'username'].sort());
 assert.deepEqual(view.permissions, [...rolePresets['Complaint Officer']]);
 assert.equal(view.avatarMediaId, null, 'an account without a photo reports null');
 assert.equal(toAdminView(user({avatarMediaId: 'media-1'})).avatarMediaId, 'media-1');
});
const newUser = (overrides = {}) => ({username: 'meena', name: 'Meena Devi', email: 'meena@example.test', password: STRONG, role: 'Complaint Officer', permissions: [], ...overrides});
test('only a Super Admin holding admins.manage may create accounts; privilege escalation is refused', () => {
 assert.doesNotThrow(() => planCreateUser(superAdmin(), newUser()));
 for (const role of ['Ward Admin', 'Complaint Officer', 'Content Editor', 'Auditor', 'Custom']) rejects(() => planCreateUser(user({role, permissions: [...permissions]}), newUser()), 403);
 // a forged actor claiming Super Admin powers through a stored Custom list still has no admins.manage
 rejects(() => planCreateUser(user({role: 'Custom', permissions: ['admins.manage']}), newUser()), 403);
 // an actor with admins.manage but not the Super Admin role (corrupt data) is still refused
 rejects(() => planCreateUser({...user({role: 'Ward Admin'}), permissions: [...permissions]}, newUser()), 403);
 rejects(() => planCreateUser(superAdmin(), newUser({role: 'Custom', permissions: ['admins.manage', 'complaints.read']})), 400, /Super Admins/);
 rejects(() => planCreateUser(superAdmin(), newUser({role: 'Custom', permissions: ['complaints.manage']})), 400, /read/);
 rejects(() => planCreateUser(superAdmin(), newUser({role: 'Custom', permissions: []})), 400, /at least one/);
 rejects(() => planCreateUser(superAdmin(), newUser({role: 'Custom', permissions: ['nope']})), 400, /Invalid permissions/);
 rejects(() => planCreateUser(superAdmin(), newUser({role: 'Root'})), 400);
 rejects(() => planCreateUser(superAdmin(), newUser({role: undefined})), 400);
});
test('creating accounts: presets use the preset list, Custom the explicit list; bad usernames and passwords are refused; first sign-in password change defaults on', () => {
 const preset = planCreateUser(superAdmin(), newUser({role: 'Auditor', permissions: ['settings.manage']}));
 assert.deepEqual(preset.permissions, [...rolePresets.Auditor], 'a preset ignores any permissions sent with it');
 const custom = planCreateUser(superAdmin(), newUser({role: 'Custom', permissions: ['announcements.manage', 'announcements.manage', 'audit.read']}));
 assert.deepEqual(custom.permissions, ['announcements.manage', 'audit.read']);
 assert.equal(custom.mustChangePassword, true); assert.equal(planCreateUser(superAdmin(), newUser({mustChangePassword: false})).mustChangePassword, false);
 rejects(() => planCreateUser(superAdmin(), newUser({username: 'no spaces'})), 400, /Username/);
 rejects(() => planCreateUser(superAdmin(), newUser({password: 'short'})), 400, /8 characters/);
 rejects(() => planCreateUser(superAdmin(), newUser({username: 'meenadevi', password: 'MeenaDevi'})), 400, /username/);
 rejects(() => planCreateUser(superAdmin(), newUser({email: 'bad'})), 400);
 assert.equal(planCreateUser(superAdmin(), newUser({email: ''})).email, null);
});
test('the legacy email grant rules still hold (shared with the account rules)', () => {
 const sa = {role: 'Super Admin', permissions: [...permissions], email: 'root@example.test'};
 assert.throws(() => validateAdminGrant(sa, 'founder@example.test', {email: 'x@example.test', role: 'Custom', permissions: ['admins.manage'], active: true}), /reserved for Super Admins/);
 assert.deepEqual(validateAdminGrant(sa, 'founder@example.test', {email: 'x@example.test', role: 'Auditor', active: true}).permissions, [...rolePresets.Auditor]);
});
const edit = (target, overrides = {}) => ({id: target.id, name: target.name, email: target.email, role: target.role, permissions: target.permissions, active: target.active, ...overrides});
test('updating accounts: nobody changes their own role, permissions or status; names and emails are fine', () => {
 const me = superAdmin();
 assert.doesNotThrow(() => planUpdateUser(me, me, edit(me, {name: 'Boss Person', email: 'boss@example.test'}), 1));
 rejects(() => planUpdateUser(me, me, edit(me, {role: 'Ward Admin'}), 1), 409, /Another Super Admin/);
 rejects(() => planUpdateUser(me, me, edit(me, {active: false}), 1), 409, /Another Super Admin/);
 rejects(() => planUpdateUser(me, me, edit(me, {role: 'Custom', permissions: [...permissions.filter(p => p !== 'admins.manage')]}), 1), 409);
 const own = superAdmin({role: 'Custom', permissions: ['audit.read']}); // a Custom account with the same permissions may keep them
 const plan = planUpdateUser(superAdmin(), own, edit(own, {name: 'Renamed'}), 1); assert.equal(plan.accessChanged, false);
});
test('updating accounts: the last active Super Admin can never be disabled or downgraded', () => {
 const actor = superAdmin(), last = superAdmin({id: 'sa2', username: 'Other'});
 rejects(() => planUpdateUser(actor, last, edit(last, {active: false}), 0), 409, /last active Super Admin/);
 rejects(() => planUpdateUser(actor, last, edit(last, {role: 'Ward Admin'}), 0), 409, new RegExp(LAST_SUPER_ADMIN_MESSAGE.slice(0, 20)));
 const allowed = planUpdateUser(actor, last, edit(last, {role: 'Ward Admin'}), 1);
 assert.equal(allowed.removesSuperAdmin, true); assert.equal(allowed.accessChanged, true);
 // a disabled Super Admin is not "the last active one"
 const dormant = superAdmin({id: 'sa3', username: 'Dormant', active: false});
 assert.doesNotThrow(() => planUpdateUser(actor, dormant, edit(dormant, {role: 'Auditor'}), 0));
 // renaming the last Super Admin is not a downgrade
 assert.doesNotThrow(() => planUpdateUser(actor, last, edit(last, {name: 'New Name'}), 0));
});
test('updating accounts: escalation and invalid input are refused; session revocation is flagged only when access changed', () => {
 const actor = superAdmin(), target = user();
 rejects(() => planUpdateUser(user({role: 'Ward Admin', permissions: [...permissions]}), target, edit(target), 1), 403);
 rejects(() => planUpdateUser(actor, target, edit(target, {role: 'Custom', permissions: ['admins.manage']}), 1), 400, /Super Admins/);
 rejects(() => planUpdateUser(actor, target, edit(target, {active: 'yes'}), 1), 400);
 rejects(() => planUpdateUser(actor, target, edit(target, {name: ''}), 1), 400);
 assert.equal(planUpdateUser(actor, target, edit(target, {name: 'New'}), 1).accessChanged, false);
 assert.equal(planUpdateUser(actor, target, edit(target, {role: 'Auditor'}), 1).accessChanged, true);
 assert.equal(planUpdateUser(actor, target, edit(target, {active: false}), 1).accessChanged, true);
 assert.equal(planUpdateUser(actor, target, edit(target, {role: 'Custom', permissions: ['complaints.read']}), 1).accessChanged, true);
});
test('deleting and resetting: not yourself, not the last Super Admin, policy applied to the new password', () => {
 const actor = superAdmin(), target = user(), last = superAdmin({id: 'sa2', username: 'Other'});
 rejects(() => planDeleteUser(actor, actor, 1), 409, /own account/);
 rejects(() => planDeleteUser(actor, last, 0), 409, /last active Super Admin/);
 assert.equal(planDeleteUser(actor, last, 1).removesSuperAdmin, true); assert.equal(planDeleteUser(actor, target, 0).removesSuperAdmin, false);
 rejects(() => planDeleteUser(user({role: 'Ward Admin', permissions: [...permissions]}), target, 1), 403);
 rejects(() => planResetPassword(actor, actor, {newPassword: STRONG}), 409, /Change password/);
 rejects(() => planResetPassword(actor, target, {newPassword: 'short'}), 400);
 rejects(() => planResetPassword(actor, user({username: 'meena.devi'}), {newPassword: 'Meena.Devi'}), 400, /username/);
 assert.deepEqual(planResetPassword(actor, target, {newPassword: STRONG}), {password: STRONG, mustChangePassword: true});
 assert.equal(planResetPassword(actor, target, {newPassword: STRONG, mustChangePassword: false}).mustChangePassword, false);
});

/* ---------------- lockout and session rules ---------------- */
test('lockout: 5 failures in 15 minutes lock; the lock lifts when the 5th-newest failure ages out; old failures do not count', () => {
 const w = core.LOCKOUT_WINDOW_MS, L = core.LOCKOUT_USER_LIMIT;
 assert.equal(L, 5); assert.equal(w, 15 * 60 * 1000);
 assert.deepEqual(core.lockoutState([], T0, L), {locked: false, retryAfter: 0, count: 0});
 const four = [1, 2, 3, 4].map(n => T0 - n * 1000); assert.equal(core.lockoutState(four, T0, L).locked, false);
 const five = [...four, T0 - 5000]; const state = core.lockoutState(five, T0, L);
 assert.equal(state.locked, true); assert.equal(state.retryAfter, Math.ceil((T0 - 5000 + w - T0) / 1000)); assert.ok(state.retryAfter <= 15 * 60 && state.retryAfter > 14 * 60);
 assert.equal(core.lockoutState(five, T0 + state.retryAfter * 1000, L).locked, false, 'unlocked exactly when the window passes');
 assert.equal(core.lockoutState(five, T0 + state.retryAfter * 1000 - 1500, L).locked, true);
 assert.equal(core.lockoutState([T0 - w - 1, T0 - w - 2, T0 - w - 3, T0 - w - 4, T0 - 1], T0, L).locked, false, 'failures older than the window are ignored');
 const six = [...five, T0 - 100]; assert.equal(core.lockoutState(six, T0, L).retryAfter, Math.ceil((T0 - 4000 + w - T0) / 1000), 'more failures push the unlock to the newer ones');
});
test('sessions: 12 hour sliding expiry, capped at 7 days, renewed at most every 5 minutes', () => {
 const s = {createdAt: T0, expires: T0 + core.SESSION_TTL_MS};
 assert.equal(core.SESSION_TTL_MS, 12 * H); assert.equal(core.SESSION_ABSOLUTE_MS, 7 * 24 * H);
 assert.equal(core.sessionIsLive(s, T0 + 11 * H), true); assert.equal(core.sessionIsLive(s, T0 + 12 * H), false); assert.equal(core.sessionIsLive(s, T0 + 12 * H + 1), false);
 assert.equal(core.slidExpiry(s, T0 + 60 * 1000), s.expires, 'no write within five minutes');
 assert.equal(core.slidExpiry(s, T0 + 6 * 60 * 1000), T0 + 6 * 60 * 1000 + 12 * H);
 const old = {createdAt: T0, expires: T0 + 7 * 24 * H - H}; assert.equal(core.slidExpiry(old, T0 + 7 * 24 * H - 30 * 60 * 1000), T0 + 7 * 24 * H, 'never beyond the absolute cap');
 assert.equal(core.sessionIsLive({createdAt: T0, expires: T0 + 8 * 24 * H}, T0 + 7 * 24 * H), false, 'the cap ends even a still-sliding session');
});
test('cookie helpers: httpOnly, SameSite=Lax, Path=/, Secure only on https, 12 hours', () => {
 const token = randomHex(32), c = cookie.sessionCookie(token, cookie.ADMIN_COOKIE_MAX_AGE, true);
 for (const part of ['samadhan_admin=' + token, 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=43200', 'Secure']) assert.ok(c.includes(part), part);
 assert.equal(cookie.sessionCookie(token, 100, false).includes('Secure'), false);
 assert.ok(cookie.clearedCookie(false).includes('Max-Age=0')); assert.equal(cookie.sessionCookie(token, -5, false).includes('Max-Age=0'), true);
 const req = h => ({headers: new Headers(h)});
 assert.equal(cookie.adminTokenOf(req({cookie: `a=1; samadhan_admin=${token}; b=2`})), token); assert.equal(cookie.adminTokenOf(req({})), null);
 assert.equal(cookie.adminTokenOf(req({cookie: 'xsamadhan_admin=1'})), null); assert.equal(cookie.adminTokenOf(req({cookie: 'samadhan_admin='})), '');
 assert.equal(cookie.isSecureRequest({url: 'https://x.test/a', headers: new Headers()}), true); assert.equal(cookie.isSecureRequest({url: 'http://localhost/a', headers: new Headers()}), false);
});

/* ---------------- the sign-in flow against the in-memory store ---------------- */
const NO_ENV = {};
const login = (store, username, password, now = T0, client = {}, env = NO_ENV) => core.adminLogin(store, OWNER, env, {username, password}, client, now);
const allAuditText = store => store.events.map(e => `${e.actor}|${e.subject}|${e.detail}`).join('\n');

test('bootstrap: the first sign-in creates the Super Admin "Admin" with the default password, flagged until it is changed', async () => {
 const store = memoryStore();
 assert.equal(await core.ensureBootstrap(store, OWNER, NO_ENV, T0), true); assert.equal(await core.ensureBootstrap(store, OWNER, NO_ENV, T0), false, 'only when no active account exists');
 const admin = [...store.users.values()][0];
 assert.equal(admin.username, 'Admin'); assert.equal(admin.role, 'Super Admin'); assert.equal(admin.isDefaultPassword, true); assert.equal(admin.mustChangePassword, false); assert.equal(admin.active, true);
 assert.ok(admin.iterations >= 150000); assert.notEqual(admin.passwordHash, core.BOOTSTRAP_DEFAULT_PASSWORD);
 const signed = await login(store, 'Admin', core.BOOTSTRAP_DEFAULT_PASSWORD);
 assert.equal(signed.user.isDefaultPassword, true); assert.equal(policy.toAdminView(signed.user).isDefaultPassword, true);
});
test('bootstrap: ADMIN_BOOTSTRAP_PASSWORD replaces the default and is not flagged as the default password; the default no longer works', async () => {
 const store = memoryStore(), env = {bootstrapPassword: 'Prod-Secret-Value-77'};
 const signed = await login(store, 'admin', env.bootstrapPassword, T0, {}, env);
 assert.equal(signed.user.isDefaultPassword, false);
 await rejectsAsync(login(store, 'Admin', core.BOOTSTRAP_DEFAULT_PASSWORD, T0, {}, env), 401, /Incorrect username or password\./);
 // an empty variable means "not configured"
 const other = memoryStore(); assert.equal((await login(other, 'Admin', core.BOOTSTRAP_DEFAULT_PASSWORD, T0, {}, {bootstrapPassword: ''})).user.isDefaultPassword, true);
});
test('bootstrap does not run again while any other account is active', async () => {
 const store = memoryStore(); await core.ensureBootstrap(store, OWNER, NO_ENV, T0);
 const admin = [...store.users.values()][0]; await core.adminCreateUser(store, admin, newUser(), T0);
 store.users.delete(admin.id);
 assert.equal(await core.ensureBootstrap(store, OWNER, NO_ENV, T0), false, 'meena is still active, so no default Admin appears');
});
test('login: case-insensitive username, one generic error for every kind of failure, no password in the audit log', async () => {
 const store = memoryStore(); await core.ensureBootstrap(store, OWNER, NO_ENV, T0);
 const good = await login(store, 'aDmIn', 'Admin'); assert.match(good.token, /^[0-9a-f]{64}$/); assert.equal(good.expires, T0 + core.SESSION_TTL_MS);
 const stored = [...store.sessions.values()][0]; assert.notEqual(stored.tokenHash, good.token); assert.equal(stored.tokenHash, await sha256Hex(good.token), 'only the hash of the token is stored');
 const messages = new Set();
 for (const [u, p] of [['Admin', 'wrong'], ['nobody', 'Admin'], ['Admin', 'admin'], ['Admin ', 'Admin2']]) {
  try {await login(store, u, p, T0 + 1000); assert.fail('should not sign in');} catch (e) {assert.ok(e instanceof ServiceError); assert.equal(e.code, 401); messages.add(e.message);}
 }
 assert.deepEqual([...messages], ['Incorrect username or password.']);
 for (const body of [{}, {username: 'Admin'}, {password: 'x'}, {username: '', password: ''}, {username: 5, password: 'x'}]) await rejectsAsync(core.adminLogin(store, OWNER, NO_ENV, body, {}, T0), 400, /Enter your username and password/);
 await rejectsAsync(login(store, 'x'.repeat(65), 'a'), 401); await rejectsAsync(login(store, 'Admin', 'x'.repeat(257)), 401);
 const text = allAuditText(store); assert.equal(text.includes('Admin2'), false, 'attempted passwords are never audited');
 assert.equal(text.includes('Signed in'), true); assert.equal(text.includes('Failed sign-in'), true);
 assert.equal(store.events.some(e => e.detail.toLowerCase().includes('password: ')), false);
});
test('login: a disabled account cannot sign in and gets the same generic error', async () => {
 const store = memoryStore(); await core.ensureBootstrap(store, OWNER, NO_ENV, T0);
 const admin = [...store.users.values()][0]; const created = await core.adminCreateUser(store, admin, newUser({mustChangePassword: false}), T0);
 await core.adminUpdateUser(store, admin, edit(created, {active: false}), T0);
 await rejectsAsync(login(store, 'meena', STRONG), 401, /^Incorrect username or password\.$/);
 assert.match(store.events.at(-1).detail, /disabled/);
});
test('lockout: 5 failed sign-ins for a username lock it (429 with retryAfter), even for the correct password, until the window passes; a success clears the count', async () => {
 const store = memoryStore(); await core.ensureBootstrap(store, OWNER, NO_ENV, T0);
 for (let i = 1; i <= 4; i++) await rejectsAsync(login(store, 'Admin', 'bad' + i, T0 + i * 1000), 401);
 await login(store, 'Admin', 'Admin', T0 + 5000); // success resets the counter
 assert.equal(store.failures.filter(f => f.bucket === 'u:admin').length, 0);
 for (let i = 1; i <= 4; i++) await rejectsAsync(login(store, 'Admin', 'bad' + i, T0 + 10000 + i * 1000), 401);
 let locked; try {await login(store, 'Admin', 'bad5', T0 + 15000);} catch (e) {locked = e;}
 assert.ok(locked instanceof ServiceError); assert.equal(locked.code, 429); assert.ok(locked.retryAfter > 800 && locked.retryAfter <= 900); assert.match(locked.message, /Too many failed attempts/);
 const sessionsBefore = store.sessions.size;
 await rejectsAsync(login(store, 'Admin', 'Admin', T0 + 20000), 429, /Try again in/); assert.equal(store.sessions.size, sessionsBefore, 'a locked account opens no session');
 await rejectsAsync(login(store, 'ADMIN', 'Admin', T0 + 20000), 429, undefined);
 assert.equal(store.failures.length, 5, 'attempts while locked are not counted again');
 assert.ok(store.events.some(e => /Locked out/.test(e.detail)));
 await rejectsAsync(login(store, 'Admin', 'Admin', T0 + 15000 + 15 * 60 * 1000 - 11000 - 1000), 429);
 assert.ok((await login(store, 'Admin', 'Admin', T0 + 11000 + 15 * 60 * 1000 + 1000)).token, 'the correct password works again after the window');
 // another account is unaffected
 const created = await core.adminCreateUser(store, [...store.users.values()][0], newUser({mustChangePassword: false}), T0 + 1e6);
 assert.ok((await login(store, 'meena', STRONG, T0 + 1e6 + 10)).token); assert.ok(created.id);
});
test('lockout also applies to a username that does not exist (no way to tell accounts apart), and per client address', async () => {
 const store = memoryStore(); await core.ensureBootstrap(store, OWNER, NO_ENV, T0);
 for (let i = 0; i < 4; i++) await rejectsAsync(login(store, 'ghost', 'x' + i, T0 + i), 401);
 await rejectsAsync(login(store, 'ghost', 'x4', T0 + 10), 429);
 const ip = {ip: '203.0.113.9'}; // 20 failures from one address, each against a different username, lock that address
 for (let i = 0; i < 19; i++) await rejectsAsync(login(store, 'user' + i, 'x', T0 + 100 + i, ip), 401);
 await rejectsAsync(login(store, 'user19', 'x', T0 + 200, ip), 429);
 await rejectsAsync(login(store, 'Admin', 'Admin', T0 + 300, ip), 429, /Try again/);
 assert.ok((await login(store, 'Admin', 'Admin', T0 + 300, {ip: '198.51.100.7'})).token, 'a different address is not locked');
 assert.ok((await login(store, 'Admin', 'Admin', T0 + 300)).token, 'no address (local development) only uses the per-username limit');
 assert.equal(JSON.stringify(store.failures).includes('203.0.113.9'), false, 'raw addresses are never stored');
});
test('sessions: valid, sliding, expiring, revoked by logout, disabled users and the absolute cap', async () => {
 const store = memoryStore(); await core.ensureBootstrap(store, OWNER, NO_ENV, T0);
 const {token, user: admin} = await login(store, 'Admin', 'Admin', T0);
 const found = await core.resolveAdminSession(store, token, T0 + 60000); assert.equal(found.user.id, admin.id); assert.equal(found.session.expires, T0 + core.SESSION_TTL_MS, 'not slid within five minutes');
 const slid = await core.resolveAdminSession(store, token, T0 + 10 * H); assert.equal(slid.session.expires, T0 + 22 * H);
 assert.ok(await core.resolveAdminSession(store, token, T0 + 21 * H), 'activity at 10 h kept the session alive past the original 12 h');
 assert.equal(await core.resolveAdminSession(store, token, T0 + 40 * H), null, 'expired'); assert.equal(store.sessions.size, 0, 'an expired session is deleted');
 for (const bad of ['', 'abc', 'g'.repeat(64), token.toUpperCase().slice(0, 63), 'a'.repeat(63), 'a'.repeat(65), token + '0']) assert.equal(await core.resolveAdminSession(store, bad, T0), null);
 const second = await login(store, 'Admin', 'Admin', T0);
 await core.adminLogout(store, second.token, T0 + 1000); assert.equal(await core.resolveAdminSession(store, second.token, T0 + 2000), null, 'logout invalidates the token'); assert.ok(store.events.some(e => e.detail === 'Signed out'));
 await core.adminLogout(store, second.token, T0 + 3000); // logging out twice is harmless
 // a session whose user was disabled or removed stops working at once
 const third = await login(store, 'Admin', 'Admin', T0); store.users.get(admin.id).active = false; assert.equal(await core.resolveAdminSession(store, third.token, T0 + 1), null);
 store.users.get(admin.id).active = true;
 // absolute cap: a session kept alive by activity ends 7 days after sign-in
 const capped = await login(store, 'Admin', 'Admin', T0); let t = T0; for (let i = 0; i < 20; i++) {t += 11 * H; const r = await core.resolveAdminSession(store, capped.token, t); if (t >= T0 + 7 * 24 * H) {assert.equal(r, null); break;} assert.ok(r, `still live at +${(t - T0) / H} h`);}
 assert.equal(await core.resolveAdminSession(store, capped.token, T0 + 7 * 24 * H + 1), null);
});
test('the portal APIs never see a session for a different owner', async () => {
 const store = memoryStore(); await core.ensureBootstrap(store, OWNER, NO_ENV, T0);
 const {token} = await login(store, 'Admin', 'Admin', T0);
 const row = [...store.sessions.values()][0]; row.owner = 'someone-else'; assert.equal(await core.resolveAdminSession(store, token, T0 + 1), null, 'the account is looked up under the session owner and is not found');
});
test('change password: verifies the current one, applies the policy, signs out other sessions, clears the default-password flag', async () => {
 const store = memoryStore(); await core.ensureBootstrap(store, OWNER, NO_ENV, T0);
 const a = await login(store, 'Admin', 'Admin', T0), b = await login(store, 'Admin', 'Admin', T0 + 1000);
 const keep = await sha256Hex(a.token); let current = (await core.resolveAdminSession(store, a.token, T0 + 2000)).user;
 await rejectsAsync(core.adminChangePassword(store, current, keep, {currentPassword: 'wrong-one', newPassword: STRONG}, {}, T0 + 2000), 400, /current password is incorrect/);
 await rejectsAsync(core.adminChangePassword(store, current, keep, {currentPassword: 'Admin', newPassword: 'short'}, {}, T0 + 2000), 400, /at least 8/);
 await rejectsAsync(core.adminChangePassword(store, current, keep, {currentPassword: 'Admin', newPassword: 'admin'}, {}, T0 + 2000), 400);
 await rejectsAsync(core.adminChangePassword(store, current, keep, {currentPassword: 'Admin', newPassword: 'Admin'}, {}, T0 + 2000), 400);
 await rejectsAsync(core.adminChangePassword(store, current, keep, {currentPassword: '', newPassword: STRONG}, {}, T0 + 2000), 400, /current password/);
 const updated = await core.adminChangePassword(store, current, keep, {currentPassword: 'Admin', newPassword: STRONG}, {}, T0 + 3000);
 assert.equal(updated.isDefaultPassword, false); assert.equal(updated.mustChangePassword, false);
 assert.ok(await core.resolveAdminSession(store, a.token, T0 + 4000), 'the session that changed the password stays'); assert.equal(await core.resolveAdminSession(store, b.token, T0 + 4000), null, 'every other session is signed out');
 await rejectsAsync(login(store, 'Admin', 'Admin', T0 + 5000), 401); assert.ok((await login(store, 'Admin', STRONG, T0 + 6000)).token);
 assert.equal(store.users.get(updated.id).isDefaultPassword, false);
 assert.equal(allAuditText(store).includes(STRONG), false);
});
test('change password: wrong current passwords count towards the lockout (a stolen session cannot guess the password)', async () => {
 const store = memoryStore(); await core.ensureBootstrap(store, OWNER, NO_ENV, T0);
 const a = await login(store, 'Admin', 'Admin', T0); const me = (await core.resolveAdminSession(store, a.token, T0)).user; const keep = await sha256Hex(a.token);
 for (let i = 0; i < 4; i++) await rejectsAsync(core.adminChangePassword(store, me, keep, {currentPassword: 'guess' + i, newPassword: STRONG}, {}, T0 + i), 400);
 await rejectsAsync(core.adminChangePassword(store, me, keep, {currentPassword: 'guess4', newPassword: STRONG}, {}, T0 + 10), 429);
 await rejectsAsync(core.adminChangePassword(store, me, keep, {currentPassword: 'Admin', newPassword: STRONG}, {}, T0 + 20), 429, /Try again/);
});

test('account lifecycle: create, sign in with a forced password change, update, reset, delete; sessions are revoked when access changes', async () => {
 const store = memoryStore(); await core.ensureBootstrap(store, OWNER, NO_ENV, T0);
 const boss = [...store.users.values()][0];
 const created = await core.adminCreateUser(store, boss, newUser({role: 'Custom', permissions: ['complaints.read', 'announcements.manage']}), T0);
 assert.deepEqual(created.permissions, ['complaints.read', 'announcements.manage']); assert.equal(created.mustChangePassword, true); assert.equal(created.isDefaultPassword, false);
 await rejectsAsync(core.adminCreateUser(store, boss, newUser({username: 'MEENA'}), T0), 409, /already taken/);
 assert.equal(JSON.stringify(created).includes(STRONG), false, 'the view never carries the password');
 const first = await login(store, 'MEENA', STRONG, T0 + 1000); assert.equal(first.user.mustChangePassword, true);
 await core.adminChangePassword(store, first.user, await sha256Hex(first.token), {currentPassword: STRONG, newPassword: 'Fresh-Passphrase-1'}, {}, T0 + 2000);
 const s1 = await login(store, 'meena', 'Fresh-Passphrase-1', T0 + 3000);
 assert.equal((await core.resolveAdminSession(store, s1.token, T0 + 3500)).user.mustChangePassword, false);
 // listing is Super Admin only
 const officerSession = (await core.resolveAdminSession(store, s1.token, T0 + 3500)).user;
 for (const call of [() => core.adminListUsers(store, officerSession), () => core.adminCreateUser(store, officerSession, newUser({username: 'sneaky'}), T0), () => core.adminUpdateUser(store, officerSession, edit(created, {role: 'Super Admin'}), T0), () => core.adminResetPassword(store, officerSession, {id: boss.id, newPassword: STRONG}, T0), () => core.adminDeleteUser(store, officerSession, {id: boss.id}, T0)]) await rejectsAsync(call(), 403);
 assert.ok(store.users.get(boss.id), 'nothing was deleted by the limited user'); assert.equal([...store.users.values()].some(u => u.username === 'sneaky'), false);
 // a name change keeps their session; a permission change signs them out
 await core.adminUpdateUser(store, boss, edit(created, {name: 'Meena D.'}), T0 + 4000); assert.ok(await core.resolveAdminSession(store, s1.token, T0 + 4500));
 const changed = await core.adminUpdateUser(store, boss, edit(created, {role: 'Auditor', name: 'Meena D.'}), T0 + 5000);
 assert.equal(changed.role, 'Auditor'); assert.deepEqual(changed.permissions, [...rolePresets.Auditor]); assert.equal(await core.resolveAdminSession(store, s1.token, T0 + 5500), null, 'a role change revokes their sessions at once');
 const s2 = await login(store, 'meena', 'Fresh-Passphrase-1', T0 + 6000);
 await core.adminUpdateUser(store, boss, edit(created, {role: 'Auditor', name: 'Meena D.', active: false}), T0 + 7000); assert.equal(await core.resolveAdminSession(store, s2.token, T0 + 7500), null, 'disabling revokes');
 await rejectsAsync(login(store, 'meena', 'Fresh-Passphrase-1', T0 + 8000), 401);
 await core.adminUpdateUser(store, boss, edit(created, {role: 'Auditor', name: 'Meena D.', active: true}), T0 + 9000);
 const s3 = await login(store, 'meena', 'Fresh-Passphrase-1', T0 + 10000);
 await rejectsAsync(core.adminResetPassword(store, boss, {id: boss.id, newPassword: STRONG}, T0), 409);
 await rejectsAsync(core.adminResetPassword(store, boss, {id: created.id, newPassword: 'short'}, T0), 400);
 const reset = await core.adminResetPassword(store, boss, {id: created.id, newPassword: 'Another-Secret-22'}, T0 + 11000);
 assert.equal(reset.mustChangePassword, true); assert.equal(await core.resolveAdminSession(store, s3.token, T0 + 11500), null, 'a reset revokes sessions');
 await rejectsAsync(login(store, 'meena', 'Fresh-Passphrase-1', T0 + 12000), 401); assert.ok((await login(store, 'meena', 'Another-Secret-22', T0 + 13000)).token);
 // reset clears a lockout so the person is not stuck
 for (let i = 0; i < 5; i++) await login(store, 'meena', 'nope' + i, T0 + 20000 + i).catch(() => {});
 await rejectsAsync(login(store, 'meena', 'Another-Secret-22', T0 + 21000), 429);
 await core.adminResetPassword(store, boss, {id: created.id, newPassword: 'Third-Secret-333', mustChangePassword: false}, T0 + 22000); assert.ok((await login(store, 'meena', 'Third-Secret-333', T0 + 23000)).token);
 // delete removes the account, its sessions and its lockout; the username is free again
 const s4 = await login(store, 'meena', 'Third-Secret-333', T0 + 24000);
 await core.adminDeleteUser(store, boss, {id: created.id}, T0 + 25000);
 assert.equal(store.users.has(created.id), false); assert.equal(await core.resolveAdminSession(store, s4.token, T0 + 25500), null); assert.equal(store.failures.some(f => f.bucket === 'u:meena'), false);
 await rejectsAsync(core.adminDeleteUser(store, boss, {id: created.id}, T0 + 26000), 404, /no longer exists/); await rejectsAsync(core.adminUpdateUser(store, boss, edit(created), T0), 404);
 await rejectsAsync(core.adminDeleteUser(store, boss, {id: 5}, T0), 404);
 assert.ok(await core.adminCreateUser(store, boss, newUser(), T0 + 27000));
 const text = allAuditText(store);
 for (const secret of [STRONG, 'Fresh-Passphrase-1', 'Another-Secret-22', 'Third-Secret-333']) assert.equal(text.includes(secret), false, 'no password in the audit log');
 for (const wanted of [/Created user \(Custom, 2 permissions\)/, /role Custom → Auditor/, /account disabled/, /account enabled/, /Password reset by an administrator/, /Deleted user/, /Failed sign-in: wrong password/]) assert.ok(store.events.some(e => wanted.test(e.detail)), String(wanted));
 for (const e of store.events) {assert.equal(e.detail.trimStart().startsWith('{'), false, 'audit details are sentences, never raw JSON'); assert.ok(e.actor && e.subject && e.owner === OWNER);}
});
test('account lifecycle: the last active Super Admin, self-service rules and the atomic guard', async () => {
 const store = memoryStore(); await core.ensureBootstrap(store, OWNER, NO_ENV, T0);
 const boss = [...store.users.values()][0];
 await rejectsAsync(core.adminDeleteUser(store, boss, {id: boss.id}, T0), 409, /own account/);
 await rejectsAsync(core.adminUpdateUser(store, boss, edit(boss, {active: false}), T0), 409, /Another Super Admin/);
 await rejectsAsync(core.adminUpdateUser(store, boss, edit(boss, {role: 'Ward Admin'}), T0), 409);
 const renamed = await core.adminUpdateUser(store, boss, edit(boss, {name: 'Chief Administrator', email: 'chief@example.test'}), T0); assert.equal(renamed.name, 'Chief Administrator');
 // a second Super Admin may then act on the first; the second becomes the last one and is protected
 const second = await core.adminCreateUser(store, boss, newUser({username: 'deputy', role: 'Super Admin', mustChangePassword: false}), T0);
 const deputy = store.users.get(second.id);
 await core.adminUpdateUser(store, deputy, edit(boss, {role: 'Ward Admin'}), T0 + 1);
 await rejectsAsync(core.adminDeleteUser(store, store.users.get(boss.id), {id: deputy.id}, T0 + 2), 403, undefined);
 await rejectsAsync(core.adminDeleteUser(store, deputy, {id: deputy.id}, T0 + 2), 409);
 // the database guard also holds when two requests race: A's plan saw B, but B deleted A before A's delete ran
 const store2 = memoryStore(); await core.ensureBootstrap(store2, OWNER, NO_ENV, T0);
 const a = [...store2.users.values()][0]; const b = await core.adminCreateUser(store2, a, newUser({username: 'second', role: 'Super Admin'}), T0);
 const realCount = store2.countActiveSuperAdmins.bind(store2);
 store2.countActiveSuperAdmins = async (owner, except) => {const n = await realCount(owner, except); store2.users.delete(a.id); return n;};
 await rejectsAsync(core.adminDeleteUser(store2, a, {id: b.id}, T0 + 1), 409, /last active Super Admin/);
 assert.ok(store2.users.get(b.id), 'the last Super Admin survived the race');
});
test('a Custom role can be given any permission except admins.manage, and complaints.manage always implies complaints.read', async () => {
 const store = memoryStore(); await core.ensureBootstrap(store, OWNER, NO_ENV, T0); const boss = [...store.users.values()][0];
 for (const p of permissions.filter(p => p !== 'admins.manage' && p !== 'complaints.manage')) assert.ok(await core.adminCreateUser(store, boss, newUser({username: 'u' + p.replace('.', '_'), role: 'Custom', permissions: [p]}), T0), p);
 await rejectsAsync(core.adminCreateUser(store, boss, newUser({username: 'blocked', role: 'Custom', permissions: ['admins.manage']}), T0), 400);
 await rejectsAsync(core.adminCreateUser(store, boss, newUser({username: 'blocked', role: 'Custom', permissions: ['complaints.manage']}), T0), 400);
 assert.ok(await core.adminCreateUser(store, boss, newUser({username: 'allowed', role: 'Custom', permissions: ['complaints.manage', 'complaints.read']}), T0));
});
