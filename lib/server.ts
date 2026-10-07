import {requireAction} from './access-policy';
import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { digest, ServiceError } from './service';
import {permissions,type Viewer,type Permission,type AdminRole} from '@/shared/access';
import {resolveAdminSession} from './admin-auth-core';
import {effectivePermissions,type AdminUserRecord} from './admin-policy';
import {adminTokenOf} from './admin-cookie';
import {d1AdminStore,platformIdentityEnabled} from './admin-store';
import {AccountBlockedError} from './resident-profile';
/**
 * `session` is set for resident bearer tokens issued by lib/resident-auth.ts: kind 'session' is a logged-in resident (~90 days), kind 'registration'
 * is the 30-minute token that may only upload media and register. `tokenHash` is the hash of whichever bearer token authenticated the request.
 */
export type Principal={owner:string;role:'admin'|'resident';residentId:string;viewer:Viewer;userId?:string;tokenHash?:string;session?:{kind:'session'|'registration';mobileHash:string;mobile:string|null}};
export function database(){if(!env.DB)throw new ServiceError('Database is unavailable. Please try again later.',503);return env.DB;}
/** The single workspace's owner (the platform_owner row 'main'), or null before the first administrator has signed in. */
export async function mainOwner():Promise<string|null>{const row=await database().prepare('SELECT user_id FROM platform_owner WHERE id = ?').bind('main').first<{user_id:string}>();return row?.user_id??null;}
/** The Principal for a signed-in administrator account. Its permissions are recomputed from the account on every request, so changes apply at once. */
export function adminPrincipal(user:AdminUserRecord):Principal{const id='admin:'+user.id;return {owner:user.owner,role:'admin',residentId:id,userId:id,viewer:{role:user.role,permissions:effectivePermissions(user.role,user.permissions),email:user.username,isOwner:false}};}
/**
 * Resolves who is calling. Bearer tokens: an admin pairing token (mobile_tokens, test devices, resident id 'demo-resident') or a resident token
 * (resident_sessions). A registration token is accepted only where `allowRegistration` is set (media upload and register); anywhere else it answers 403.
 * Without a bearer token: the administrator session cookie (POST /api/admin-auth, lib/admin-auth.ts) -> a Principal with role 'admin', userId/residentId
 * "admin:<account id>" (never colliding with resident ids), viewer.email = the username. A cookie that is present but expired or revoked answers 401 and never
 * falls back. Last, the platform (ChatGPT) identity as before, unless env ADMIN_PLATFORM_IDENTITY is 'off' (set it in production) or the request is
 * marked as coming from the portal UI (header x-samadhan-portal: 1), which must use the administrator session only.
 * A resident session (or registration token) whose profile an administrator has blocked answers 403 {error, code:'account_blocked'} everywhere (the flag is read from the
 * workspace in the same query that finds the session, so it cannot be skipped); only `allowBlocked` (logout) lets such a token through so it can be revoked.
 */
export async function identity(request:Request,options:{allowRegistration?:boolean;allowBlocked?:boolean}={}):Promise<Principal>{
 const bearer=request.headers.get('authorization');
 if(bearer){
  const tokenHash=await digest(bearer.replace(/^Bearer /,''));const now=Date.now();
  const paired=await database().prepare('SELECT owner FROM mobile_tokens WHERE hash = ? AND expires > ?').bind(tokenHash,now).first<{owner:string}>();
  if(paired)return {owner:paired.owner,role:'resident',residentId:'demo-resident',viewer:{role:'Resident',permissions:[]},tokenHash};
  const session=await database().prepare("SELECT s.owner,s.resident_id,s.kind,s.mobile_hash,s.mobile,json_extract(w.body,'$.residentProfiles.\"'||s.resident_id||'\".blocked') AS blocked FROM resident_sessions s LEFT JOIN workspaces w ON w.owner = s.owner WHERE s.token_hash = ? AND s.expires > ?").bind(tokenHash,now).first<{owner:string;resident_id:string;kind:'session'|'registration';mobile_hash:string;mobile:string|null;blocked:number|null}>();
  if(!session)throw new ServiceError('Your session has expired. Log in again.',401);
  if(session.blocked&&!options.allowBlocked)throw new AccountBlockedError();
  if(session.kind==='registration'&&!options.allowRegistration)throw new ServiceError('Finish registering before using this.',403);
  return {owner:session.owner,role:'resident',residentId:session.resident_id,viewer:{role:'Resident',permissions:[]},tokenHash,session:{kind:session.kind,mobileHash:session.mobile_hash,mobile:session.mobile}};
 }
 const adminToken=adminTokenOf(request);
 if(adminToken){
  const signedIn=await resolveAdminSession(d1AdminStore,adminToken,Date.now());
  if(!signedIn)throw new ServiceError('Your session has ended. Sign in again.',401);
  if(signedIn.user.mustChangePassword)throw new ServiceError('Choose a new password to continue.',403);
  return adminPrincipal(signedIn.user);
 }
 if(!platformIdentityEnabled()||request.headers.get('x-samadhan-portal')==='1')throw new ServiceError('Sign in to the administrator portal.',401);
 const user=await getChatGPTUser();if(!user)throw new ServiceError('Sign in to open your private test workspace.',401);
 const email=user.email.trim().toLowerCase();
 // First owner is established while the Site is owner-private. Never reset this on logout.
 await database().prepare('INSERT OR IGNORE INTO platform_owner (id,user_id,email) VALUES (?, ?, ?)').bind('main',user.userId,email).run();
 const owner=await database().prepare('SELECT user_id,email FROM platform_owner WHERE id = ?').bind('main').first<{user_id:string;email:string}>();
 if(owner!.user_id===user.userId)return {owner:owner!.user_id,role:'admin',residentId:'demo-resident',userId:user.userId,viewer:{role:'Super Admin',permissions:[...permissions],email,isOwner:true}};
 const access=await database().prepare('SELECT owner,role,permissions,active FROM admin_access WHERE email = ? AND owner = ?').bind(email,owner!.user_id).first<{owner:string;role:AdminRole;permissions:string;active:number}>();
 if(!access||!access.active)throw new ServiceError('Your account does not have access. Contact the Super Admin.',403);
 const granted=JSON.parse(access.permissions) as Permission[];
 return {owner:access.owner,role:'admin',residentId:user.userId,userId:user.userId,viewer:{role:access.role,permissions:granted.filter(p=>permissions.includes(p)),email,isOwner:false}};
}
export function requirePermission(who:Principal,permission:Permission){requireAction(who.viewer,permission);}
/** Browsers always send Origin on POST, so a cross-site page is rejected. Bearer-token mobile clients send no Origin and pass. */
export function assertOrigin(request:Request){const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)throw new ServiceError('Cross-origin request rejected.',403);}
export function apiError(e:unknown){if(e instanceof ServiceError){const retry=e.retryAfter&&e.retryAfter>0?Math.ceil(e.retryAfter):undefined;const code=(e as {errorCode?:string}).errorCode;return Response.json({error:e.message,...(code?{code}:{}),...(retry?{retryAfter:retry}:{})},{status:e.code,...(retry?{headers:{'Retry-After':String(retry)}}:{})});}console.error('SAMADHAN request failed',e);return Response.json({error:'Unable to save changes. Please try again.'},{status:500});}
