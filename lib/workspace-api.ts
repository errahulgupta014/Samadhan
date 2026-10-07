import {canReadMedia} from './media-access';
import {loadWorkspace} from './workspaces';
import {applyAction,digest,ServiceError,departmentsOf,capHistory,type StoredWorkspace,normalizeWorkspace} from './service';
import {database,identity,assertOrigin,apiError,requirePermission,type Principal} from './server';
import {applyCommunityAction,ensureCommunity,type CommunityState} from './community-service';
import {projectWorkspace} from './projection';
import {listAdmins,saveAdmin} from './access-service';
import {isRegistered,assertNotBlocked} from './resident-profile';
import {testClosureCode} from './resident-auth';
import {mobileHashOf} from './resident-otp';
import {recordStatusChanges,statusSnapshot,pushItemsFor,dropBlockedCommunications} from './notifications';
import {pushInBackground} from './push-dispatch';
import {isExpoPushToken} from './push';
import {actionPermissions} from '@/shared/access';
import type {ResidentNotification} from '@/shared/community';
const noStore={'Cache-Control':'no-store'};
/** Actions that permanently remove a record. Only the Super Admin role may run them. */
const DELETE_ACTIONS=new Set(['delete-announcement','delete-classified','delete-activity','delete-place','delete-ward','delete-resident']);
const DELETE_DENIED='Only a Super Admin can delete records.';
export async function GET(request:Request){try{
 const who=await identity(request);const url=new URL(request.url);
 if(url.searchParams.get('section')==='admins')return Response.json({admins:await listAdmins(who)},{headers:noStore});
 const row=await loadWorkspace(who.owner);const resident=who.role==='resident'||url.searchParams.get('view')==='resident';
 const stored=JSON.parse(row.body);if(who.role==='resident')assertNotBlocked(stored.residentProfiles?.[who.residentId]);// identity() already refuses blocked sessions; this re-checks the profile just loaded
 const data=projectWorkspace(stored,who,resident);
 if(!resident&&who.viewer.permissions.includes('audit.read')){const {results}=await database().prepare('SELECT id,actor,subject,detail,created_at FROM admin_access_events WHERE owner = ? ORDER BY created_at DESC LIMIT 100').bind(who.owner).all<{id:string;actor:string;subject:string;detail:string;created_at:string}>();data.audit=[...results.map(e=>({id:e.id,actor:e.actor,at:e.created_at,action:`Admin access: ${e.subject} · ${e.detail}`,complaintId:''})),...data.audit].sort((a,b)=>b.at.localeCompare(a.at));}
 return Response.json({data,version:row.version},{headers:noStore});
 }catch(e){return apiError(e);}}
/**
 * After an administrator blocks or unblocks a resident (the profile flag is already saved, so access ended at once): drop the resident's push tokens, and on unblock also their
 * old sessions, so they sign in again with an OTP. While blocked the sessions stay but every call answers 403 account_blocked (see identity() in lib/server.ts). Best effort: the flag decides.
 */
async function residentAccessCleanup(owner:string,residentId:string,blocked:boolean){
 try{const db=database();await db.batch([db.prepare('DELETE FROM resident_push_tokens WHERE owner = ? AND resident_id = ?').bind(owner,residentId),...(blocked?[]:[db.prepare('DELETE FROM resident_sessions WHERE owner = ? AND resident_id = ?').bind(owner,residentId)])]);}
 catch(e){console.error('SAMADHAN resident access cleanup failed',(e as Error)?.message);}
}
/**
 * The D1 side of delete-resident, as statements for the SAME batch that saves the workspace without the profile: every session and registration token of the resident (by id and by mobile),
 * their push tokens, any pending OTP for their mobile (a stale code can no longer be used, and the resend cooldown starts fresh for the next person to register the number), and the uploader
 * mark of their uploads. The media rows and files stay; the mark becomes 'deleted:<id>', which no principal ever has, so the old photos are unreferenced uploads that nobody can read as
 * "their own" (not even the same mobile registering again) and the new registration starts with an empty upload quota. Each statement only acts when the profile is really gone
 * from the stored workspace by then, so a lost version race revokes nothing.
 */
const profileGone="NOT EXISTS (SELECT 1 FROM workspaces WHERE owner = ? AND json_extract(body, '$.residentProfiles.\"' || ? || '\"') IS NOT NULL)";
function residentDeleteStatements(owner:string,residentId:string,mobileHash:string){
 const db=database();
 return [
  db.prepare(`DELETE FROM resident_sessions WHERE ((owner = ? AND resident_id = ?) OR mobile_hash = ?) AND ${profileGone}`).bind(owner,residentId,mobileHash,owner,residentId),
  db.prepare(`DELETE FROM resident_push_tokens WHERE owner = ? AND resident_id = ? AND ${profileGone}`).bind(owner,residentId,owner,residentId),
  db.prepare(`DELETE FROM resident_otps WHERE mobile_hash = ? AND ${profileGone}`).bind(mobileHash,owner,residentId),
  db.prepare(`UPDATE media SET uploader = ? WHERE owner = ? AND uploader = ? AND ${profileGone}`).bind('deleted:'+residentId,owner,residentId,owner,residentId),
 ];
}
/** Resident push tokens (Expo). Max 5 per resident: registering a sixth drops the least recently updated one. */
async function pushTokenAction(who:Principal,body:any){
 if(who.session?.kind!=='session')throw new ServiceError('Push notifications are available to logged-in residents.',403);
 if(!isExpoPushToken(body.token))throw new ServiceError('Invalid push token.');
 const db=database(),at=new Date().toISOString();
 if(body.action==='register-push')await db.batch([
  db.prepare('INSERT INTO resident_push_tokens (token,owner,resident_id,updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(token) DO UPDATE SET owner = excluded.owner, resident_id = excluded.resident_id, updated_at = excluded.updated_at').bind(body.token,who.owner,who.residentId,at),
  db.prepare('DELETE FROM resident_push_tokens WHERE owner = ? AND resident_id = ? AND token NOT IN (SELECT token FROM resident_push_tokens WHERE owner = ? AND resident_id = ? ORDER BY updated_at DESC, token LIMIT 5)').bind(who.owner,who.residentId,who.owner,who.residentId),
 ]);
 else await db.prepare('DELETE FROM resident_push_tokens WHERE token = ? AND owner = ? AND resident_id = ?').bind(body.token,who.owner,who.residentId).run();
 const row=await loadWorkspace(who.owner);
 return Response.json({ok:true,data:projectWorkspace(JSON.parse(row.body),who,true),version:row.version},{headers:noStore});
}
export async function POST(request:Request){try{
 assertOrigin(request);const who=await identity(request);const raw=await request.text();if(raw.length>75000)throw new ServiceError('Request too large.',413);const body=JSON.parse(raw);
 const resident=who.role==='resident'||body.view==='resident';const permission=actionPermissions[body.action];
 if(permission){if(resident)throw new ServiceError('Administrator access required.',403);requirePermission(who,permission);}
 // Deleting records is reserved for the Super Admin role, whatever permissions other roles hold (admin users are protected by their own API).
 if(DELETE_ACTIONS.has(body.action)&&who.viewer.role!=='Super Admin')throw new ServiceError(DELETE_DENIED,403);
 if(body.action==='pair-mobile'){
  requirePermission(who,'settings.manage');const token=crypto.randomUUID()+crypto.randomUUID();
  await database().batch([database().prepare('DELETE FROM mobile_tokens WHERE owner = ?').bind(who.owner),database().prepare('INSERT INTO mobile_tokens (hash, owner, expires) VALUES (?, ?, ?)').bind(await digest(token),who.owner,Date.now()+86400000)]);return Response.json({token,expiresIn:'24 hours'});
 }
 if(body.action==='save-admin'){await saveAdmin(who,body.admin);return Response.json({admins:await listAdmins(who)});}
 if(body.action==='register-push'||body.action==='unregister-push')return await pushTokenAction(who,body);
 const row=await loadWorkspace(who.owner);if(body.version!==row.version)throw new ServiceError('This record changed in another window. Refresh and try again.',409);
 const state=normalizeWorkspace(JSON.parse(row.body)) as StoredWorkspace&CommunityState;ensureCommunity(state);
 // Removing items through a list save (banners, departments) is a deletion too.
 if(who.viewer.role!=='Super Admin'&&!resident){const keptBannerIds=new Set(Array.isArray(body.banners)?body.banners.map((b:any)=>b?.id):[]);const removesBanner=body.action==='save-banners'&&((Array.isArray(body.banners)&&(state.settings.brandingBanners??[]).some(b=>!keptBannerIds.has(b.id)))||(body.restoreDefault===true&&(state.settings.brandingBanners?.length??0)>0));const keptIds=new Set(Array.isArray(body.departments)?body.departments.map((d:any)=>d?.id).filter(Boolean):[]);const removesDepartment=body.action==='save-departments'&&Array.isArray(body.departments)&&departmentsOf(state.settings).some(d=>!keptIds.has(d.id));if(removesBanner||removesDepartment)throw new ServiceError(DELETE_DENIED,403);}
 const profile=state.residentProfiles![who.residentId];const registered=isRegistered(profile);
 if(who.role==='resident')assertNotBlocked(profile);
 // Residents cannot address another resident's operational records (ownership is the stored residentId, never a shared default).
 if(resident&&body.id&&['dispute','verify-closure','issue-closure-code','preview-closure-code'].includes(body.action)){const complaint=state.complaints.find(c=>c.id===body.id);if(complaint&&(complaint as any).residentId!==who.residentId)throw new ServiceError('Complaint not found.',404);}
 const evidence=Array.isArray(body.media)?body.media:[];
 const mediaIds=[...evidence,...(Array.isArray(body.afterMedia)?body.afterMedia:[]),body.classified?.imageId,body.activity?.imageId,body.place?.imageId,body.splashImageId,body.ward?.memberPhotoId,body.profile?.photoId,...(Array.isArray(body.banners)?body.banners.map((b:any)=>b?.imageId):[])].filter(Boolean);
 if(mediaIds.length>10)throw new ServiceError('Too many media attachments.');
 for(const id of mediaIds){
  if(typeof id!=='string')throw new ServiceError('Invalid evidence.');
  const media=await database().prepare('SELECT uploader FROM media WHERE id = ? AND owner = ?').bind(id,who.owner).first<{uploader:string|null}>();
  if(!media||!canReadMedia(state,who,id,media.uploader,'attach'))throw new ServiceError('Image not found in this workspace.',403);
  // A resident can attach only photographs they uploaded themselves; a ward member photo must be a fresh upload by this admin or the ward's current photo.
  if(resident&&body.action==='create'&&evidence.includes(id)&&media.uploader!==who.residentId)throw new ServiceError('Image not found in this workspace.',403);
  if(body.action==='save-profile'&&id===body.profile?.photoId&&media.uploader!==who.residentId)throw new ServiceError('Choose a photo you uploaded.',403);
  if(body.action==='save-ward'&&id===body.ward?.memberPhotoId&&media.uploader!==who.residentId&&!state.wards?.some(w=>w.id===body.ward?.id&&w.memberPhotoId===id))throw new ServiceError('Upload the ward member photo again.',403);
 }
 const actor=who.viewer.email??(profile?.name||'Resident');const before=statusSnapshot(state.complaints);
 const residentWard=profile?.wardId?state.wards?.find(w=>w.id===profile.wardId):undefined;// the ward a new complaint is filed in: its number goes into the complaint id, its id is stored on the complaint
 const commsBefore=state.communications.length;let result:Record<string,unknown>;
 // delete-resident removes the profile; its mobile is needed afterwards for the D1 clean-up (the OTP challenge and the registration tokens are keyed by the mobile's hash).
 const doomed=body.action==='delete-resident'&&typeof body.id==='string'&&Object.prototype.hasOwnProperty.call(state.residentProfiles!,body.id)?state.residentProfiles![body.id]:undefined;
 try{const community=applyCommunityAction(state,body,who.residentId,actor);result=community??await applyAction(state,body,resident?'resident':'admin',Date.now(),actor,{residentId:who.residentId,resident:registered?{name:profile.name,mobile:profile.mobile}:null,wardNumber:residentWard?.number,wardId:residentWard?.id,closureCode:testClosureCode()});}
 catch(e){if(e instanceof ServiceError)throw e;throw new ServiceError((e as Error).message);}
 // Notifications for push: a status change made by ward administration notifies the complaint's resident; publishing a classified or an activity (first time) notifies opted-in residents.
 const created:ResidentNotification[]=[];const at=new Date().toISOString();
 dropBlockedCommunications(state,state.communications.length-commsBefore);// no message is queued for a blocked resident's number
 created.push(...recordStatusChanges(state,before,at,resident?"resident":"admin"));
 if(body.action==='publish-classified'&&result.notificationCreated){const n=state.notifications?.find(n=>n.kind==='classified'&&n.classifiedId===result.classifiedId);if(n)created.push(n);}
 if(body.action==='publish-activity'&&result.notificationCreated){const n=state.notifications?.find(n=>n.kind==='activity'&&n.activityId===result.activityId);if(n)created.push(n);}
 // A deleted resident's sessions, push tokens, pending OTP and upload marks go in the same batch as the workspace without their profile, so there is no moment where the old token still works.
 const cleanup=body.action==='delete-resident'&&result.deleted===true&&doomed?residentDeleteStatements(who.owner,doomed.id,doomed.mobile?await mobileHashOf(doomed.mobile):''):[];
 const saved=await database().batch([database().prepare('UPDATE workspaces SET body = ?, version = version + 1 WHERE owner = ? AND version = ?').bind(capHistory(state),who.owner,row.version),...cleanup]);if(!saved[0].meta.changes)throw new ServiceError('Another update was saved first. Refresh and retry.',409);
 if(body.action==='block-resident'&&(result.blocked===true||result.changed===true))await residentAccessCleanup(who.owner,result.id as string,result.blocked===true);
 await pushInBackground(who.owner,pushItemsFor(state,created));
 return Response.json({...result,data:projectWorkspace(state,who,resident),version:row.version+1},{status:result.error?400:200,headers:noStore});
 }catch(e){if(e instanceof SyntaxError)return Response.json({error:'Invalid request.'},{status:400});return apiError(e);}}
