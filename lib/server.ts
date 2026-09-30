import {requireAction} from './access-policy';
import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { digest, ServiceError } from './service';
import {permissions,type Viewer,type Permission,type AdminRole} from '@/shared/access';
export type Principal={owner:string;role:'admin'|'resident';residentId:string;viewer:Viewer;userId?:string;tokenHash?:string};
export function database(){if(!env.DB)throw new ServiceError('Database is unavailable. Please try again later.',503);return env.DB;}
export async function identity(request:Request):Promise<Principal>{
 const bearer=request.headers.get('authorization');
 if(bearer){const tokenHash=await digest(bearer.replace(/^Bearer /,''));const row=await database().prepare('SELECT owner FROM mobile_tokens WHERE hash = ? AND expires > ?').bind(tokenHash,Date.now()).first<{owner:string}>();if(!row)throw new ServiceError('Pair this mobile app again from portal Settings.',401);return {owner:row.owner,role:'resident',residentId:'demo-resident',viewer:{role:'Resident',permissions:[]},tokenHash};}
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
export function assertOrigin(request:Request){const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)throw new ServiceError('Cross-origin request rejected.',403);}
export function apiError(e:unknown){if(e instanceof ServiceError)return Response.json({error:e.message},{status:e.code});console.error('SAMADHAN request failed',e);return Response.json({error:'Unable to save changes. Please try again.'},{status:500});}
