import {env} from 'cloudflare:workers';
import {assertOrigin, apiError, database, identity, mainOwner, type Principal} from './server';
import {ServiceError, digest, normalizeWorkspace, capHistory, type StoredWorkspace} from './service';
import {loadWorkspace} from './workspaces';
import {ensureCommunity, type CommunityState} from './community-service';
import {registerProfile, isRegistered, assertNotBlocked} from './resident-profile';
import {OTP_MAX_ATTEMPTS, normalizeMobile, residentOtpMode, residentIdOf, sendOtp, verifyOtp, type OtpEnv, type OtpStore} from './resident-otp';

/**
 * Resident sign-in API: POST /api/resident-auth { action: 'send-otp' | 'verify-otp' | 'register' | 'logout' } (contract: docs/RESIDENT_AUTH_API.md).
 * The OTP rules and the test-OTP switch live in lib/resident-otp.ts (residentOtpMode); this file wires them to D1 and issues bearer tokens.
 */
export const SESSION_TTL_MS = 90 * 24 * 3600 * 1000;
export const REGISTRATION_TTL_MS = 30 * 60 * 1000;
export const MAX_SESSIONS = 10;
const noStore = {'Cache-Control': 'no-store'};

const configString = (v: unknown) => typeof v === 'string' ? v : undefined;
/** Server-side configuration. OTP_PROVIDER unset => TEST OTP MODE (see residentOtpMode). Wrangler vars / .dev.vars supply both values. */
/** Fixed closure code while the server is in test OTP mode (same switch as sign-in); undefined once a real provider is configured. */
export function testClosureCode(): string | undefined {const m = residentOtpMode(otpEnv()); return m.mode === 'test' ? m.code : undefined;}
function otpEnv(): OtpEnv {const e = env as unknown as Record<string, unknown>; return {OTP_PROVIDER: configString(e.OTP_PROVIDER), RESIDENT_TEST_OTP: configString(e.RESIDENT_TEST_OTP)};}

type OtpRow = {mobile_hash: string; code_hash: string; expires: number; attempts: number; last_sent: number; sends: number; window_start: number};
export const d1OtpStore: OtpStore = {
 async get(h) {
  const r = await database().prepare('SELECT mobile_hash,code_hash,expires,attempts,last_sent,sends,window_start FROM resident_otps WHERE mobile_hash = ?').bind(h).first<OtpRow>();
  return r ? {mobileHash: r.mobile_hash, codeHash: r.code_hash, expires: r.expires, attempts: r.attempts, lastSent: r.last_sent, sends: r.sends, windowStart: r.window_start} : null;
 },
 async put(r) {
  await database().batch([
   database().prepare('DELETE FROM resident_otps WHERE last_sent < ?').bind(r.lastSent - 24 * 3600 * 1000),
   database().prepare('INSERT INTO resident_otps (mobile_hash,code_hash,expires,attempts,last_sent,sends,window_start) VALUES (?, ?, ?, 0, ?, ?, ?) ON CONFLICT(mobile_hash) DO UPDATE SET code_hash = excluded.code_hash, expires = excluded.expires, attempts = 0, last_sent = excluded.last_sent, sends = excluded.sends, window_start = excluded.window_start').bind(r.mobileHash, r.codeHash, r.expires, r.lastSent, r.sends, r.windowStart),
  ]);
 },
 async claimAttempt(h, now) {return ((await database().prepare('UPDATE resident_otps SET attempts = attempts + 1 WHERE mobile_hash = ? AND attempts < ? AND expires > ?').bind(h, OTP_MAX_ATTEMPTS, now).run()).meta.changes ?? 0) > 0;},
 // A spent challenge keeps its row (send counters survive) but can no longer be verified.
 async consume(h, codeHash) {return ((await database().prepare('UPDATE resident_otps SET expires = 0 WHERE mobile_hash = ? AND code_hash = ? AND expires > 0').bind(h, codeHash).run()).meta.changes ?? 0) > 0;},
};

const hex = (bytes: Uint8Array) => Array.from(bytes, n => n.toString(16).padStart(2, '0')).join('');
/** Issues an opaque bearer token; only its SHA-256 is stored. A registration token also remembers the verified mobile until registration completes. */
export async function issueToken(owner: string, residentId: string, kind: 'session' | 'registration', mobileHash: string, mobile: string | null, now = Date.now()) {
 const token = hex(crypto.getRandomValues(new Uint8Array(32)));
 await database().batch([
  database().prepare('DELETE FROM resident_sessions WHERE expires < ?').bind(now),
  ...(kind === 'registration' ? [database().prepare("DELETE FROM resident_sessions WHERE mobile_hash = ? AND kind = 'registration'").bind(mobileHash)] : []),
  database().prepare('INSERT INTO resident_sessions (token_hash,owner,resident_id,kind,mobile_hash,mobile,expires) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(await digest(token), owner, residentId, kind, mobileHash, kind === 'registration' ? mobile : null, now + (kind === 'session' ? SESSION_TTL_MS : REGISTRATION_TTL_MS)),
  // At most MAX_SESSIONS devices stay logged in per resident; the oldest sessions are retired first.
  ...(kind === 'session' ? [database().prepare("DELETE FROM resident_sessions WHERE owner = ? AND resident_id = ? AND kind = 'session' AND token_hash NOT IN (SELECT token_hash FROM resident_sessions WHERE owner = ? AND resident_id = ? AND kind = 'session' ORDER BY expires DESC LIMIT ?)").bind(owner, residentId, owner, residentId, MAX_SESSIONS)] : []),
 ]);
 return token;
}

/** Revokes the bearer token that authenticated `who` (resident session, registration token or admin pairing token) and the resident's push tokens. */
export async function revokeCurrentToken(who: Principal) {
 const db = database(), statements = [];
 if (who.session && who.tokenHash) statements.push(db.prepare('DELETE FROM resident_sessions WHERE token_hash = ?').bind(who.tokenHash));
 else if (who.tokenHash) statements.push(db.prepare('DELETE FROM mobile_tokens WHERE hash = ?').bind(who.tokenHash));
 // Logging out stops pushes to this resident everywhere; other devices register again the next time the app opens.
 if (who.session?.kind !== 'registration') statements.push(db.prepare('DELETE FROM resident_push_tokens WHERE owner = ? AND resident_id = ?').bind(who.owner, who.residentId));
 if (statements.length) await db.batch(statements);
}

async function requireOwner() {
 const owner = await mainOwner();
 if (!owner) throw new ServiceError('Resident sign-in is not available yet. Ask the ward office to finish setting up the portal.', 503);
 return owner;
}

async function verify(body: any) {
 const mobile = normalizeMobile(body.mobile), now = Date.now(), owner = await requireOwner();
 const {mobileHash} = await verifyOtp(d1OtpStore, mobile, body.code, now);
 const residentId = await residentIdOf(mobile);
 const state = JSON.parse((await loadWorkspace(owner)).body) as StoredWorkspace & CommunityState;
 const profile = state.residentProfiles?.[residentId];
 // A blocked resident proves the number with a correct code and is then refused (send-otp stays generic, so a wrong guess learns nothing); no session is issued.
 assertNotBlocked(profile);
 const registered = isRegistered(profile);
 return {token: await issueToken(owner, residentId, registered ? 'session' : 'registration', mobileHash, mobile, now), registered};
}

async function register(request: Request, body: any) {
 const who = await identity(request, {allowRegistration: true});
 if (who.session?.kind !== 'registration' || !who.session.mobile) throw new ServiceError('Verify your mobile number first.', 401);
 const mobile = who.session.mobile, db = database();
 // The photo must have been uploaded with THIS registration token (its uploader is the mobile-derived resident id).
 if (typeof body.photoId === 'string' && body.photoId.trim()) {
  const media = await db.prepare('SELECT uploader FROM media WHERE id = ? AND owner = ?').bind(body.photoId.trim(), who.owner).first<{uploader: string | null}>();
  if (!media || media.uploader !== who.residentId) throw new ServiceError('Upload your photo again.');
 }
 for (let attempt = 0; attempt < 4; attempt++) {
  const row = await loadWorkspace(who.owner);
  const state = normalizeWorkspace(JSON.parse(row.body)) as StoredWorkspace & CommunityState;
  ensureCommunity(state);
  assertNotBlocked(state.residentProfiles![who.residentId]);
  const at = new Date().toISOString();
  const profile = registerProfile(state, body, who.residentId, mobile, at);
  state.audit.unshift({id: crypto.randomUUID(), action: 'Resident registered', actor: profile.name, at, complaintId: ''});
  const saved = await db.prepare('UPDATE workspaces SET body = ?, version = version + 1 WHERE owner = ? AND version = ?').bind(capHistory(state), who.owner, row.version).run();
  if (!saved.meta.changes) continue;
  const token = await issueToken(who.owner, who.residentId, 'session', who.session.mobileHash, null);
  await db.prepare('DELETE FROM resident_sessions WHERE token_hash = ?').bind(who.tokenHash!).run();
  return {token};
 }
 throw new ServiceError('Registration is busy. Please try again.', 409);
}

export async function POST(request: Request) {
 try {
  assertOrigin(request);
  const raw = await request.text();
  if (raw.length > 20000) throw new ServiceError('Request too large.', 413);
  let body: any;
  try {body = JSON.parse(raw);} catch {throw new ServiceError('Invalid request.');}
  if (!body || typeof body !== 'object') throw new ServiceError('Invalid request.');
  if (body.action === 'send-otp') {
   await requireOwner();
   return Response.json(await sendOtp(d1OtpStore, normalizeMobile(body.mobile), Date.now(), otpEnv()), {headers: noStore});
  }
  if (body.action === 'verify-otp') return Response.json(await verify(body), {headers: noStore});
  if (body.action === 'register') return Response.json(await register(request, body), {headers: noStore});
  if (body.action === 'logout') {
   // A blocked resident may still sign out, which removes the session row.
   await revokeCurrentToken(await identity(request, {allowRegistration: true, allowBlocked: true}));
   return Response.json({ok: true}, {headers: noStore});
  }
  throw new ServiceError('Unknown action.');
 } catch (e) {return apiError(e);}
}
