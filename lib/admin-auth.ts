import {assertOrigin, apiError, database} from './server';
import {ServiceError} from './service';
import {
 adminLogin, adminLogout, adminChangePassword, adminListUsers, adminCreateUser, adminUpdateUser, adminResetPassword, adminDeleteUser, resolveAdminSession,
 type ClientInfo,
} from './admin-auth-core';
import {toAdminView, type AdminUserRecord} from './admin-policy';
import {sha256Hex} from './admin-crypto';
import {ADMIN_COOKIE_MAX_AGE, adminTokenOf, clearedCookie, isSecureRequest, sessionCookie} from './admin-cookie';
import {adminEnv, adminOwner, d1AdminStore} from './admin-store';

/**
 * Administrator portal sign-in API: POST /api/admin-auth (JSON) with { action }:
 *  login | me | logout | change-password            (the signed-in administrator)
 *  list-users | create-user | update-user | reset-password | delete-user   (permission admins.manage, Super Admin only)
 * Contract: docs/ADMIN_PORTAL_API.md (A1). The rules live in lib/admin-policy.ts and lib/admin-auth-core.ts; storage in lib/admin-store.ts.
 * Every POST passes assertOrigin; responses are never cached; passwords and tokens are never logged or returned.
 */
const noStore = {'Cache-Control': 'no-store'};
const MUST_CHANGE = 'Choose a new password to continue.';
function clientOf(request: Request): ClientInfo {
 // CF-Connecting-IP is set by Cloudflare and cannot be forged by the client; without it (local development) only the per-username lockout applies.
 return {ip: request.headers.get('cf-connecting-ip'), userAgent: request.headers.get('user-agent')};
}
function reply(body: Record<string, unknown>, cookie?: string) {
 const headers = new Headers(noStore);
 if (cookie) headers.append('Set-Cookie', cookie);
 return Response.json(body, {headers});
}
const sessionBody = (user: AdminUserRecord) => ({user: toAdminView(user), defaultPassword: user.isDefaultPassword});

export async function POST(request: Request) {
 try {
  assertOrigin(request);
  const raw = await request.text();
  if (raw.length > 20000) throw new ServiceError('Request too large.', 413);
  let body: any;
  try {body = JSON.parse(raw);} catch {throw new ServiceError('Invalid request.');}
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ServiceError('Invalid request.');
  const store = d1AdminStore, now = Date.now(), secure = isSecureRequest(request), token = adminTokenOf(request), client = clientOf(request);

  if (body.action === 'login') {
   // Signing in again retires the session this browser already held.
   if (token) await store.deleteSession(await sha256Hex(token));
   const signed = await adminLogin(store, await adminOwner(), adminEnv(), body, client, now);
   return reply({ok: true, ...sessionBody(signed.user)}, sessionCookie(signed.token, ADMIN_COOKIE_MAX_AGE, secure));
  }
  if (body.action === 'logout') {
   if (token) await adminLogout(store, token, now);
   return reply({ok: true}, clearedCookie(secure));
  }

  const found = token ? await resolveAdminSession(store, token, now) : null;
  if (body.action === 'me') {
   if (!found) return reply({user: null, defaultPassword: false}, token ? clearedCookie(secure) : undefined);
   return reply(sessionBody(found.user), sessionCookie(token!, Math.min(ADMIN_COOKIE_MAX_AGE, (found.session.expires - now) / 1000), secure));
  }
  if (!found) throw new ServiceError('Sign in to continue.', 401);
  const {user, session} = found;
  if (body.action === 'change-password') {
   const updated = await adminChangePassword(store, user, session.tokenHash, body, client, now);
   return reply({ok: true, ...sessionBody(updated)});
  }
  if (user.mustChangePassword) throw new ServiceError(MUST_CHANGE, 403);

  if (body.action === 'set-avatar') {
   // The administrator's own profile photo: a media id they uploaded themselves (POST /api/media), or null to remove it.
   const mediaId = body.mediaId === null ? null : typeof body.mediaId === 'string' && body.mediaId.length <= 100 ? body.mediaId : undefined;
   if (mediaId === undefined) throw new ServiceError('Choose a photo to upload.');
   if (mediaId !== null) {
    const owned = await database().prepare('SELECT id FROM media WHERE id = ? AND owner = ? AND uploader = ?').bind(mediaId, user.owner, `admin:${user.id}`).first();
    if (!owned) throw new ServiceError('That photo was not uploaded by your account. Please upload it again.', 403);
   }
   await store.setAvatar!(user.owner, user.id, mediaId);
   return reply({ok: true, ...sessionBody({...user, avatarMediaId: mediaId})});
  }

  switch (body.action) {
   case 'list-users': return reply({users: await adminListUsers(store, user)});
   case 'create-user': return reply({ok: true, user: await adminCreateUser(store, user, body, now)});
   case 'update-user': return reply({ok: true, user: await adminUpdateUser(store, user, body, now)});
   case 'reset-password': return reply({ok: true, user: await adminResetPassword(store, user, body, now)});
   case 'delete-user': await adminDeleteUser(store, user, body, now); return reply({ok: true});
  }
  throw new ServiceError('Unknown action.');
 } catch (e) {return apiError(e);}
}
