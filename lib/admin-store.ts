import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {ServiceError} from './service';
import {effectivePermissions, type AdminUserRecord} from './admin-policy';
import type {AdminStore, AdminSessionRow, AuditEvent, AdminEnv} from './admin-auth-core';
import {MAX_SESSIONS_PER_USER} from './admin-auth-core';
import type {AdminRole, Permission} from '../shared/access';

/** D1 implementation of AdminStore (tables admin_users, admin_sessions, admin_login_failures; audit goes to admin_access_events). It reads `env.DB` directly so lib/server.ts can use it without an import cycle. */
const db = () => {if (!env.DB) throw new ServiceError('Database is unavailable. Please try again later.', 503); return env.DB;};
const settings = () => env as unknown as Record<string, unknown>;
const configString = (name: string) => typeof settings()[name] === 'string' ? (settings()[name] as string) : undefined;

export const adminEnv = (): AdminEnv => ({bootstrapPassword: configString('ADMIN_BOOTSTRAP_PASSWORD')});
/** Production switch: ADMIN_PLATFORM_IDENTITY=off disables the platform (ChatGPT) identity fallback so only the admin login opens the portal APIs. Anything else leaves it on (dev and test tooling). */
export const platformIdentityEnabled = () => (configString('ADMIN_PLATFORM_IDENTITY') ?? '').trim().toLowerCase() !== 'off';
/** Owner id given to the workspace when the portal is bootstrapped by an admin sign-in before any platform user claimed it (only possible with ADMIN_PLATFORM_IDENTITY=off). */
export const ADMIN_PORTAL_OWNER = 'samadhan-admin-portal';

type UserRow = {id: string; owner: string; username: string; name: string; email: string | null; avatar_media_id: string | null; role: string; permissions: string; active: number; password_hash: string; salt: string; iterations: number; must_change_password: number; is_default_password: number; created_at: string; updated_at: string; last_login_at: string | null};
const USER_COLUMNS = 'id,owner,username,name,email,avatar_media_id,role,permissions,active,password_hash,salt,iterations,must_change_password,is_default_password,created_at,updated_at,last_login_at';
function parsePermissions(text: string): Permission[] {try {const v = JSON.parse(text); return Array.isArray(v) ? v : [];} catch {return [];}}
const toRecord = (r: UserRow): AdminUserRecord => ({id: r.id, owner: r.owner, username: r.username, name: r.name, email: r.email, avatarMediaId: r.avatar_media_id, role: r.role as AdminRole, permissions: parsePermissions(r.permissions), active: !!r.active,
 mustChangePassword: !!r.must_change_password, isDefaultPassword: !!r.is_default_password, passwordHash: r.password_hash, salt: r.salt, iterations: r.iterations, createdAt: r.created_at, updatedAt: r.updated_at, lastLoginAt: r.last_login_at});
const OTHER_SUPER_ADMIN = " AND (SELECT COUNT(*) FROM admin_users WHERE owner = ? AND role = 'Super Admin' AND active = 1 AND id <> ?) > 0";

export const d1AdminStore: AdminStore = {
 async countActiveUsers(owner) {return (await db().prepare('SELECT COUNT(*) AS n FROM admin_users WHERE owner = ? AND active = 1').bind(owner).first<{n: number}>())?.n ?? 0;},
 async countActiveSuperAdmins(owner, exceptId = '') {return (await db().prepare("SELECT COUNT(*) AS n FROM admin_users WHERE owner = ? AND role = 'Super Admin' AND active = 1 AND id <> ?").bind(owner, exceptId).first<{n: number}>())?.n ?? 0;},
 async getUserByKey(owner, key) {const r = await db().prepare(`SELECT ${USER_COLUMNS} FROM admin_users WHERE owner = ? AND lower(username) = ?`).bind(owner, key).first<UserRow>(); return r ? toRecord(r) : null;},
 async getUserById(owner, id) {const r = await db().prepare(`SELECT ${USER_COLUMNS} FROM admin_users WHERE owner = ? AND id = ?`).bind(owner, id).first<UserRow>(); return r ? toRecord(r) : null;},
 async setAvatar(owner, id, mediaId) {await db().prepare('UPDATE admin_users SET avatar_media_id = ?, updated_at = ? WHERE owner = ? AND id = ?').bind(mediaId, new Date().toISOString(), owner, id).run();},
 async listUsers(owner) {const {results} = await db().prepare(`SELECT ${USER_COLUMNS} FROM admin_users WHERE owner = ? ORDER BY lower(username)`).bind(owner).all<UserRow>(); return results.map(toRecord);},
 async insertUser(u) {
  const saved = await db().prepare(`INSERT OR IGNORE INTO admin_users (${USER_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
   .bind(u.id, u.owner, u.username, u.name, u.email, u.avatarMediaId ?? null, u.role, JSON.stringify(u.permissions), u.active ? 1 : 0, u.passwordHash, u.salt, u.iterations, u.mustChangePassword ? 1 : 0, u.isDefaultPassword ? 1 : 0, u.createdAt, u.updatedAt, u.lastLoginAt).run();
  return (saved.meta.changes ?? 0) > 0;
 },
 async saveUser(u, options) {
  const saved = await db().prepare(`UPDATE admin_users SET name = ?, email = ?, role = ?, permissions = ?, active = ?, password_hash = ?, salt = ?, iterations = ?, must_change_password = ?, is_default_password = ?, updated_at = ?, last_login_at = ? WHERE owner = ? AND id = ?${options?.needsOtherSuperAdmin ? OTHER_SUPER_ADMIN : ''}`)
   .bind(u.name, u.email, u.role, JSON.stringify(u.permissions), u.active ? 1 : 0, u.passwordHash, u.salt, u.iterations, u.mustChangePassword ? 1 : 0, u.isDefaultPassword ? 1 : 0, u.updatedAt, u.lastLoginAt, u.owner, u.id, ...(options?.needsOtherSuperAdmin ? [u.owner, u.id] : [])).run();
  return (saved.meta.changes ?? 0) > 0;
 },
 async deleteUser(owner, id, options) {
  const done = await db().prepare(`DELETE FROM admin_users WHERE owner = ? AND id = ?${options?.needsOtherSuperAdmin ? OTHER_SUPER_ADMIN : ''}`).bind(owner, id, ...(options?.needsOtherSuperAdmin ? [owner, id] : [])).run();
  return (done.meta.changes ?? 0) > 0;
 },
 async insertSession(s) {
  await db().batch([
   db().prepare('DELETE FROM admin_sessions WHERE expires < ?').bind(s.createdAt),
   db().prepare('INSERT INTO admin_sessions (token_hash,owner,user_id,expires,created_at,ip_hash,user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(s.tokenHash, s.owner, s.userId, s.expires, s.createdAt, s.ipHash ?? null, s.userAgent ?? null),
   // At most MAX_SESSIONS_PER_USER devices stay signed in per account; the oldest are retired first.
   db().prepare('DELETE FROM admin_sessions WHERE user_id = ? AND token_hash NOT IN (SELECT token_hash FROM admin_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?)').bind(s.userId, s.userId, MAX_SESSIONS_PER_USER),
  ]);
 },
 async getSession(tokenHash) {
  const r = await db().prepare('SELECT token_hash,owner,user_id,expires,created_at FROM admin_sessions WHERE token_hash = ?').bind(tokenHash).first<{token_hash: string; owner: string; user_id: string; expires: number; created_at: number}>();
  return r ? {tokenHash: r.token_hash, owner: r.owner, userId: r.user_id, expires: r.expires, createdAt: r.created_at} satisfies AdminSessionRow : null;
 },
 async extendSession(tokenHash, expires) {await db().prepare('UPDATE admin_sessions SET expires = ? WHERE token_hash = ?').bind(expires, tokenHash).run();},
 async deleteSession(tokenHash) {await db().prepare('DELETE FROM admin_sessions WHERE token_hash = ?').bind(tokenHash).run();},
 async deleteUserSessions(userId, exceptTokenHash) {
  if (exceptTokenHash) await db().prepare('DELETE FROM admin_sessions WHERE user_id = ? AND token_hash <> ?').bind(userId, exceptTokenHash).run();
  else await db().prepare('DELETE FROM admin_sessions WHERE user_id = ?').bind(userId).run();
 },
 async failuresSince(bucket, since) {const {results} = await db().prepare('SELECT at FROM admin_login_failures WHERE bucket = ? AND at > ? ORDER BY at').bind(bucket, since).all<{at: number}>(); return results.map(r => r.at);},
 async addFailure(bucket, at) {
  await db().batch([
   db().prepare('DELETE FROM admin_login_failures WHERE at < ?').bind(at - 3600000),
   db().prepare('INSERT INTO admin_login_failures (bucket, at) VALUES (?, ?)').bind(bucket, at),
  ]);
 },
 async clearFailures(bucket) {await db().prepare('DELETE FROM admin_login_failures WHERE bucket = ?').bind(bucket).run();},
 async audit(e: AuditEvent) {
  await db().prepare('INSERT INTO admin_access_events (id,owner,actor,subject,detail,created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), e.owner, e.actor, e.subject, e.detail.slice(0, 500), e.at).run();
 },
};

/**
 * The workspace owner for administrator accounts: the platform owner row 'main' that residents and the existing workspace already use.
 * Fresh database: with the platform identity enabled, the first platform user claims it (exactly as before) when this request carries one;
 * with ADMIN_PLATFORM_IDENTITY=off no platform user will ever exist, so the portal claims it itself (ADMIN_PORTAL_OWNER).
 */
export async function adminOwner(): Promise<string> {
 const read = async () => (await db().prepare('SELECT user_id FROM platform_owner WHERE id = ?').bind('main').first<{user_id: string}>())?.user_id ?? null;
 const existing = await read();
 if (existing) return existing;
 if (platformIdentityEnabled()) {
  const platformUser = await getChatGPTUser();
  if (!platformUser) throw new ServiceError('The workspace is not set up yet. Sign in with the platform account once, or set ADMIN_PLATFORM_IDENTITY=off to let the administrator login set it up.', 503);
  await db().prepare('INSERT OR IGNORE INTO platform_owner (id,user_id,email) VALUES (?, ?, ?)').bind('main', platformUser.userId, platformUser.email.trim().toLowerCase()).run();
 } else await db().prepare('INSERT OR IGNORE INTO platform_owner (id,user_id,email) VALUES (?, ?, ?)').bind('main', ADMIN_PORTAL_OWNER, 'admin-portal@samadhan.invalid').run();
 const claimed = await read();
 if (!claimed) throw new ServiceError('The workspace is not available. Please try again.', 503);
 return claimed;
}

/** What identity() needs about a signed-in administrator. */
export const principalPermissions = (user: AdminUserRecord) => effectivePermissions(user.role, user.permissions);
