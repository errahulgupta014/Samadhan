import {ServiceError} from './service';
import {hashPassword, verifyPassword, burnPasswordCheck, needsRehash, randomHex, sha256Hex} from './admin-crypto';
import {
 planCreateUser, planDeleteUser, planResetPassword, planUpdateUser, requireUserAdmin, toAdminView, usernameKey, validatePassword, describeUserChange,
 type AdminUserRecord, type AdminUserView,
} from './admin-policy';

/**
 * Administrator sign-in, sessions and account management, independent of the storage layer: everything goes through AdminStore
 * (D1 in lib/admin-store.ts, memory in tests/admin.test.mjs). Passwords and session tokens are never logged, returned or audited;
 * only a SHA-256 of a session token is stored.
 *
 * PRODUCTION: the first sign-in creates the Super Admin "Admin" if no active account exists. Set the worker variable ADMIN_BOOTSTRAP_PASSWORD
 * to a strong secret BEFORE the first request (or change the password immediately); with the built-in test password the portal keeps showing a
 * warning banner until it is changed. Also set ADMIN_PLATFORM_IDENTITY=off so the platform sign-in cannot bypass this login (see lib/server.ts).
 */
/** The ONLY place the built-in test-mode bootstrap password exists. It is never sent to or shown by any page. */
export const BOOTSTRAP_DEFAULT_PASSWORD = 'Admin';
export const DEFAULT_ADMIN_USERNAME = 'Admin';
export const SESSION_TTL_MS = 12 * 3600 * 1000;
export const SESSION_ABSOLUTE_MS = 7 * 24 * 3600 * 1000;
export const SESSION_SLIDE_MIN_MS = 5 * 60 * 1000;
export const MAX_SESSIONS_PER_USER = 10;
export const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
export const LOCKOUT_USER_LIMIT = 5;
/** Per client address (Cloudflare's CF-Connecting-IP). Higher than the per-username limit so one office behind a shared address is not locked out by a few typos. */
export const LOCKOUT_IP_LIMIT = 20;
export const BAD_CREDENTIALS = 'Incorrect username or password.';

export type AdminSessionRow = {tokenHash: string; owner: string; userId: string; expires: number; createdAt: number; ipHash?: string | null; userAgent?: string | null};
export type AuditEvent = {owner: string; actor: string; subject: string; detail: string; at: string};
export interface AdminStore {
 /** Optional profile photo (a media id uploaded by this administrator, or null to remove it). */
 setAvatar?(owner: string, id: string, mediaId: string | null): Promise<void>;
 countActiveUsers(owner: string): Promise<number>;
 /** Active Super Admins, not counting `exceptId`. */
 countActiveSuperAdmins(owner: string, exceptId?: string): Promise<number>;
 getUserByKey(owner: string, key: string): Promise<AdminUserRecord | null>;
 getUserById(owner: string, id: string): Promise<AdminUserRecord | null>;
 listUsers(owner: string): Promise<AdminUserRecord[]>;
 /** false when the (case-insensitive) username already exists. */
 insertUser(user: AdminUserRecord): Promise<boolean>;
 /** Replaces the mutable fields. With `needsOtherSuperAdmin` it only applies while another active Super Admin exists (atomic). false when nothing was updated. */
 saveUser(user: AdminUserRecord, options?: {needsOtherSuperAdmin?: boolean}): Promise<boolean>;
 deleteUser(owner: string, id: string, options?: {needsOtherSuperAdmin?: boolean}): Promise<boolean>;
 insertSession(session: AdminSessionRow): Promise<void>;
 getSession(tokenHash: string): Promise<AdminSessionRow | null>;
 extendSession(tokenHash: string, expires: number): Promise<void>;
 deleteSession(tokenHash: string): Promise<void>;
 deleteUserSessions(userId: string, exceptTokenHash?: string): Promise<void>;
 failuresSince(bucket: string, since: number): Promise<number[]>;
 addFailure(bucket: string, at: number): Promise<void>;
 clearFailures(bucket: string): Promise<void>;
 audit(event: AuditEvent): Promise<void>;
}
export type AdminEnv = {bootstrapPassword?: string};
export type ClientInfo = {ip?: string | null; userAgent?: string | null};

/* ---------- pure rules: lockout and session lifetime ---------- */
export function lockoutState(failures: readonly number[], now: number, limit: number, windowMs = LOCKOUT_WINDOW_MS) {
 const recent = failures.filter(t => t > now - windowMs).sort((a, b) => a - b);
 if (recent.length < limit) return {locked: false, retryAfter: 0, count: recent.length};
 // The lock lifts when the failure that put the count at `limit` ages out of the window.
 return {locked: true, retryAfter: Math.max(1, Math.ceil((recent[recent.length - limit] + windowMs - now) / 1000)), count: recent.length};
}
export const sessionIsLive = (session: Pick<AdminSessionRow, 'expires' | 'createdAt'>, now: number) => session.expires > now && session.createdAt + SESSION_ABSOLUTE_MS > now;
/** Sliding expiry: 12 h after the latest activity, never beyond 7 days after sign-in; moved at most every 5 minutes to avoid a write per request. */
export function slidExpiry(session: Pick<AdminSessionRow, 'expires' | 'createdAt'>, now: number) {
 const next = Math.min(now + SESSION_TTL_MS, session.createdAt + SESSION_ABSOLUTE_MS);
 return next - session.expires >= SESSION_SLIDE_MIN_MS ? next : session.expires;
}

const clean = (value: string, max = 80) => value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
const iso = (ms: number) => new Date(ms).toISOString();
const tooMany = (retryAfter: number) => new ServiceError(`Too many failed attempts. Try again in ${retryAfter >= 90 ? `${Math.ceil(retryAfter / 60)} minutes` : `${retryAfter} seconds`}.`, 429, retryAfter);

/* ---------- bootstrap ---------- */
/** Creates the initial Super Admin when no active account exists. Returns true when this call created it. */
export async function ensureBootstrap(store: AdminStore, owner: string, env: AdminEnv, now: number) {
 if (await store.countActiveUsers(owner) > 0) return false;
 const configured = typeof env.bootstrapPassword === 'string' && env.bootstrapPassword.length > 0 ? env.bootstrapPassword : '';
 const password = configured || BOOTSTRAP_DEFAULT_PASSWORD;
 const record = await hashPassword(password);
 const user: AdminUserRecord = {id: crypto.randomUUID(), owner, username: DEFAULT_ADMIN_USERNAME, name: 'Administrator', email: null, role: 'Super Admin', permissions: [], active: true,
  mustChangePassword: false, isDefaultPassword: password === BOOTSTRAP_DEFAULT_PASSWORD, passwordHash: record.hash, salt: record.salt, iterations: record.iterations, createdAt: iso(now), updatedAt: iso(now), lastLoginAt: null};
 const created = await store.insertUser(user);
 if (created) await store.audit({owner, actor: 'system', subject: user.username, detail: user.isDefaultPassword ? 'Initial Super Admin account created with the built-in default password (change it now)' : 'Initial Super Admin account created from the configured bootstrap password', at: iso(now)});
 return created;
}

/* ---------- lockout ---------- */
const buckets = async (username: string, ip?: string | null) => ({user: `u:${username}`, ip: ip ? `i:${await sha256Hex(`samadhan-admin-ip:${ip}`)}` : null});
async function lockFor(store: AdminStore, bucket: {user: string; ip: string | null}, now: number) {
 const user = lockoutState(await store.failuresSince(bucket.user, now - LOCKOUT_WINDOW_MS), now, LOCKOUT_USER_LIMIT);
 const ip = bucket.ip ? lockoutState(await store.failuresSince(bucket.ip, now - LOCKOUT_WINDOW_MS), now, LOCKOUT_IP_LIMIT) : {locked: false, retryAfter: 0, count: 0};
 return {locked: user.locked || ip.locked, retryAfter: Math.max(user.retryAfter, ip.retryAfter)};
}
async function recordFailure(store: AdminStore, bucket: {user: string; ip: string | null}, now: number) {
 await store.addFailure(bucket.user, now);
 if (bucket.ip) await store.addFailure(bucket.ip, now);
}

/* ---------- sessions ---------- */
export type SignedIn = {user: AdminUserRecord; token: string; expires: number};
async function startSession(store: AdminStore, user: AdminUserRecord, now: number, client: ClientInfo): Promise<{token: string; expires: number}> {
 const token = randomHex(32);
 const expires = now + SESSION_TTL_MS;
 await store.insertSession({tokenHash: await sha256Hex(token), owner: user.owner, userId: user.id, expires, createdAt: now,
  ipHash: client.ip ? (await sha256Hex(`samadhan-admin-ip:${client.ip}`)).slice(0, 16) : null, userAgent: client.userAgent ? clean(client.userAgent, 160) : null});
 return {token, expires};
}

export async function adminLogin(store: AdminStore, owner: string, env: AdminEnv, input: {username?: unknown; password?: unknown}, client: ClientInfo, now: number): Promise<SignedIn> {
 if (typeof input.username !== 'string' || typeof input.password !== 'string' || !input.username.trim() || !input.password) throw new ServiceError('Enter your username and password.');
 if (input.username.length > 64 || input.password.length > 256) throw new ServiceError(BAD_CREDENTIALS, 401);
 await ensureBootstrap(store, owner, env, now);
 const key = usernameKey(input.username), shown = clean(input.username, 64);
 const bucket = await buckets(key, client.ip);
 const before = await lockFor(store, bucket, now);
 if (before.locked) throw tooMany(before.retryAfter);
 const user = await store.getUserByKey(owner, key);
 const matches = user ? await verifyPassword(input.password, {hash: user.passwordHash, salt: user.salt, iterations: user.iterations}) : (await burnPasswordCheck(input.password), false);
 if (!user || !matches || !user.active) {
  await recordFailure(store, bucket, now);
  await store.audit({owner, actor: shown, subject: user?.username ?? shown, detail: !user ? 'Failed sign-in: unknown username' : !user.active && matches ? 'Sign-in refused: the account is disabled' : 'Failed sign-in: wrong password', at: iso(now)});
  const after = await lockFor(store, bucket, now);
  if (after.locked) {
   await store.audit({owner, actor: shown, subject: user?.username ?? shown, detail: `Locked out for ${Math.ceil(after.retryAfter / 60)} minutes after repeated failed sign-ins`, at: iso(now)});
   throw tooMany(after.retryAfter);
  }
  throw new ServiceError(BAD_CREDENTIALS, 401);
 }
 await store.clearFailures(bucket.user);
 let record = user;
 if (needsRehash(user)) {const upgraded = await hashPassword(input.password); record = {...user, passwordHash: upgraded.hash, salt: upgraded.salt, iterations: upgraded.iterations};}
 record = {...record, lastLoginAt: iso(now)};
 await store.saveUser(record);
 const session = await startSession(store, record, now, client);
 await store.audit({owner, actor: record.username, subject: record.username, detail: 'Signed in', at: iso(now)});
 return {user: record, ...session};
}

/** The signed-in account for a session cookie value, or null. Expired sessions are removed; a live one slides forward. */
export async function resolveAdminSession(store: AdminStore, token: string, now: number): Promise<{user: AdminUserRecord; session: AdminSessionRow} | null> {
 if (!/^[0-9a-f]{64}$/.test(token)) return null;
 const tokenHash = await sha256Hex(token);
 const session = await store.getSession(tokenHash);
 if (!session) return null;
 if (!sessionIsLive(session, now)) {await store.deleteSession(tokenHash); return null;}
 const user = await store.getUserById(session.owner, session.userId);
 if (!user || !user.active) {await store.deleteSession(tokenHash); return null;}
 const expires = slidExpiry(session, now);
 if (expires !== session.expires) await store.extendSession(tokenHash, expires);
 return {user, session: {...session, expires}};
}

export async function adminLogout(store: AdminStore, token: string, now: number) {
 const found = await resolveAdminSession(store, token, now);
 await store.deleteSession(await sha256Hex(token));
 if (found) await store.audit({owner: found.user.owner, actor: found.user.username, subject: found.user.username, detail: 'Signed out', at: iso(now)});
}

export async function adminChangePassword(store: AdminStore, user: AdminUserRecord, keepTokenHash: string | undefined, input: {currentPassword?: unknown; newPassword?: unknown}, client: ClientInfo, now: number): Promise<AdminUserRecord> {
 if (typeof input.currentPassword !== 'string' || !input.currentPassword) throw new ServiceError('Enter your current password.');
 const bucket = await buckets(usernameKey(user.username), client.ip);
 const lock = await lockFor(store, bucket, now);
 if (lock.locked) throw tooMany(lock.retryAfter);
 if (!await verifyPassword(input.currentPassword, {hash: user.passwordHash, salt: user.salt, iterations: user.iterations})) {
  await recordFailure(store, bucket, now);
  await store.audit({owner: user.owner, actor: user.username, subject: user.username, detail: 'Failed password change: wrong current password', at: iso(now)});
  const after = await lockFor(store, bucket, now);
  if (after.locked) throw tooMany(after.retryAfter);
  throw new ServiceError('Your current password is incorrect.', 400);
 }
 const next = validatePassword(input.newPassword, {username: user.username, current: input.currentPassword});
 const record = await hashPassword(next);
 const updated: AdminUserRecord = {...user, passwordHash: record.hash, salt: record.salt, iterations: record.iterations, isDefaultPassword: false, mustChangePassword: false, updatedAt: iso(now)};
 await store.saveUser(updated);
 await store.deleteUserSessions(user.id, keepTokenHash);
 await store.clearFailures(bucket.user);
 await store.audit({owner: user.owner, actor: user.username, subject: user.username, detail: 'Changed own password (other sessions signed out)', at: iso(now)});
 return updated;
}

/* ---------- account management (actor = the signed-in account; every call re-checks the policy) ---------- */
export async function adminListUsers(store: AdminStore, actor: AdminUserRecord): Promise<AdminUserView[]> {
 requireUserAdmin(actor);
 return (await store.listUsers(actor.owner)).map(toAdminView);
}
async function targetOf(store: AdminStore, actor: AdminUserRecord, id: unknown) {
 const target = typeof id === 'string' ? await store.getUserById(actor.owner, id) : null;
 if (!target) throw new ServiceError('That user no longer exists.', 404);
 return target;
}
export async function adminCreateUser(store: AdminStore, actor: AdminUserRecord, input: any, now: number): Promise<AdminUserView> {
 const plan = planCreateUser(actor, input);
 const record = await hashPassword(plan.password);
 const user: AdminUserRecord = {id: crypto.randomUUID(), owner: actor.owner, username: plan.username, name: plan.name, email: plan.email, role: plan.role, permissions: plan.permissions, active: true,
  mustChangePassword: plan.mustChangePassword, isDefaultPassword: false, passwordHash: record.hash, salt: record.salt, iterations: record.iterations, createdAt: iso(now), updatedAt: iso(now), lastLoginAt: null};
 if (!await store.insertUser(user)) throw new ServiceError('That username is already taken.', 409);
 await store.audit({owner: actor.owner, actor: actor.username, subject: user.username, detail: `Created user (${user.role}${user.role === 'Custom' ? `, ${plan.permissions.length} permissions` : ''})${plan.mustChangePassword ? ', must choose a new password at first sign-in' : ''}`, at: iso(now)});
 return toAdminView(user);
}
export async function adminUpdateUser(store: AdminStore, actor: AdminUserRecord, input: any, now: number): Promise<AdminUserView> {
 requireUserAdmin(actor);
 const target = await targetOf(store, actor, input?.id);
 const plan = planUpdateUser(actor, target, input, await store.countActiveSuperAdmins(actor.owner, target.id));
 const updated: AdminUserRecord = {...target, name: plan.name, email: plan.email, role: plan.role, permissions: plan.permissions, active: plan.active, updatedAt: iso(now)};
 if (!await store.saveUser(updated, {needsOtherSuperAdmin: plan.removesSuperAdmin})) throw new ServiceError('The last active Super Admin cannot be deleted, disabled or downgraded.', 409);
 const detail = describeUserChange(target, plan);
 if (plan.accessChanged) await store.deleteUserSessions(target.id);
 await store.audit({owner: actor.owner, actor: actor.username, subject: target.username, detail: plan.accessChanged ? `${detail} (their sessions were signed out)` : detail, at: iso(now)});
 return toAdminView(updated);
}
export async function adminResetPassword(store: AdminStore, actor: AdminUserRecord, input: any, now: number): Promise<AdminUserView> {
 requireUserAdmin(actor);
 const target = await targetOf(store, actor, input?.id);
 const plan = planResetPassword(actor, target, input);
 const record = await hashPassword(plan.password);
 const updated: AdminUserRecord = {...target, passwordHash: record.hash, salt: record.salt, iterations: record.iterations, isDefaultPassword: false, mustChangePassword: plan.mustChangePassword, updatedAt: iso(now)};
 await store.saveUser(updated);
 await store.deleteUserSessions(target.id);
 await store.clearFailures(`u:${usernameKey(target.username)}`);
 await store.audit({owner: actor.owner, actor: actor.username, subject: target.username, detail: `Password reset by an administrator${plan.mustChangePassword ? ' (must choose a new one at next sign-in)' : ''}; their sessions were signed out`, at: iso(now)});
 return toAdminView(updated);
}
export async function adminDeleteUser(store: AdminStore, actor: AdminUserRecord, input: any, now: number) {
 requireUserAdmin(actor);
 const target = await targetOf(store, actor, input?.id);
 const plan = planDeleteUser(actor, target, await store.countActiveSuperAdmins(actor.owner, target.id));
 if (!await store.deleteUser(actor.owner, target.id, {needsOtherSuperAdmin: plan.removesSuperAdmin})) throw new ServiceError('The last active Super Admin cannot be deleted, disabled or downgraded.', 409);
 await store.deleteUserSessions(target.id);
 await store.clearFailures(`u:${usernameKey(target.username)}`);
 await store.audit({owner: actor.owner, actor: actor.username, subject: target.username, detail: `Deleted user (${target.role})`, at: iso(now)});
}

