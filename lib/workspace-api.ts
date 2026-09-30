import {canReadMedia} from './media-access';
import {loadWorkspace} from './workspaces';
import {applyAction,digest,ServiceError,type StoredWorkspace,normalizeWorkspace} from './service';
import {database,identity,assertOrigin,apiError,requirePermission} from './server';
import {applyCommunityAction,type CommunityState} from './community-service';
import {projectWorkspace} from './projection';
import {listAdmins,saveAdmin} from './access-service';
import {actionPermissions} from '@/shared/access';
export async function GET(request:Request){try{
 const who=await identity(request);const url=new URL(request.url);
 if(url.searchParams.get('section')==='admins')return Response.json({admins:await listAdmins(who)},{headers:{'Cache-Control':'no-store'}});
 const row=await loadWorkspace(who.owner);const resident=who.role==='resident'||url.searchParams.get('view')==='resident';
 const data=projectWorkspace(JSON.parse(row.body),who,resident);
 if(!resident&&who.viewer.permissions.includes('audit.read')){const {results}=await database().prepare('SELECT id,actor,subject,detail,created_at FROM admin_access_events WHERE owner = ? ORDER BY created_at DESC LIMIT 100').bind(who.owner).all<{id:string;actor:string;subject:string;detail:string;created_at:string}>();data.audit=[...results.map(e=>({id:e.id,actor:e.actor,at:e.created_at,action:`Admin access: ${e.subject} · ${e.detail}`,complaintId:''})),...data.audit].sort((a,b)=>b.at.localeCompare(a.at));}
 return Response.json({data,version:row.version},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return apiError(e);}}
export async function POST(request:Request){try{
 assertOrigin(request);const who=await identity(request);const raw=await request.text();if(raw.length>75000)throw new ServiceError('Request too large.',413);const body=JSON.parse(raw);
 const resident=who.role==='resident'||body.view==='resident';const permission=actionPermissions[body.action];
 if(permission){if(resident)throw new ServiceError('Administrator access required.',403);requirePermission(who,permission);}
 if(body.action==='pair-mobile'){
  requirePermission(who,'settings.manage');const token=crypto.randomUUID()+crypto.randomUUID();
  await database().batch([database().prepare('DELETE FROM mobile_tokens WHERE owner = ?').bind(who.owner),database().prepare('INSERT INTO mobile_tokens (hash, owner, expires) VALUES (?, ?, ?)').bind(await digest(token),who.owner,Date.now()+86400000)]);return Response.json({token,expiresIn:'24 hours'});
 }
 if(body.action==='save-admin'){await saveAdmin(who,body.admin);return Response.json({admins:await listAdmins(who)});}
 if(body.action==='register-push'){
  if(typeof body.token!=='string'||!/^ExponentPushToken\[[a-zA-Z0-9_-]+\]$|^ExpoPushToken\[[a-zA-Z0-9_-]+\]$/.test(body.token))throw new ServiceError('Invalid device push token.');
  await database().prepare('INSERT INTO resident_push_tokens (token,owner,resident_id,updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(token) DO UPDATE SET owner=excluded.owner,resident_id=excluded.resident_id,updated_at=excluded.updated_at').bind(body.token,who.owner,who.residentId,new Date().toISOString()).run();return Response.json({registered:true});
 }
 const row=await loadWorkspace(who.owner);if(body.version!==row.version)throw new ServiceError('This record changed in another window. Refresh and try again.',409);
 const state=normalizeWorkspace(JSON.parse(row.body)) as StoredWorkspace&CommunityState;
 // Residents cannot address another resident's operational records.
 if(resident&&body.id&&['dispute','verify-closure','issue-closure-code'].includes(body.action)){const complaint=state.complaints.find(c=>c.id===body.id);if(complaint&&((complaint as any).residentId??'demo-resident')!==who.residentId)throw new ServiceError('Complaint not found.',404);}
 const mediaIds=[...(Array.isArray(body.media)?body.media:[]),...(Array.isArray(body.afterMedia)?body.afterMedia:[]),body.classified?.imageId,body.place?.imageId].filter(Boolean);
 if(mediaIds.length>10)throw new ServiceError('Too many media attachments.');
 for(const id of mediaIds){if(typeof id!=='string')throw new ServiceError('Invalid evidence.');const media=await database().prepare('SELECT uploader FROM media WHERE id = ? AND owner = ?').bind(id,who.owner).first<{uploader:string|null}>();if(!media||!canReadMedia(state,who,id,media.uploader))throw new ServiceError('Image not found in this workspace.',403);}
 let result:Record<string,unknown>;
 try{const community=applyCommunityAction(state,body,who.residentId,who.viewer.email??'Resident');result=community??await applyAction(state,body,resident?'resident':'admin',Date.now(),who.viewer.email??'Resident');}
 catch(e){if(e instanceof ServiceError)throw e;throw new ServiceError((e as Error).message);}
 if(body.action==='create'&&result.id){const complaint=state.complaints.find(c=>c.id===result.id)!;(complaint as any).residentId=who.residentId;complaint.resident=state.residentProfiles?.[who.residentId]?.name??'Demo Resident';}
 const statements=[];
 if(result.notificationCreated)statements.push(database().prepare('INSERT INTO push_jobs (id,owner,classified_id,status,created_at,detail) SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM workspaces WHERE owner = ? AND version = ?)').bind(crypto.randomUUID(),who.owner,result.classifiedId,'awaiting-provider',new Date().toISOString(),'In-app notification published. Remote push delivery requires Expo project credentials and a dispatcher.',who.owner,row.version));
 statements.push(database().prepare('UPDATE workspaces SET body = ?, version = version + 1 WHERE owner = ? AND version = ?').bind(JSON.stringify(state),who.owner,row.version));
 const saved=await database().batch(statements);if(!saved[saved.length-1].meta.changes)throw new ServiceError('Another update was saved first. Refresh and retry.',409);
 return Response.json({...result,data:projectWorkspace(state,who,resident),version:row.version+1},{status:result.error?400:200,headers:{'Cache-Control':'no-store'}});
 }catch(e){if(e instanceof SyntaxError)return Response.json({error:'Invalid request.'},{status:400});return apiError(e);}}
