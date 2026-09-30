import {defaultProfile,defaultMunicipality,visibleClassified,type ResidentProfile,type Classified,type Place,type Municipality,type ResidentNotification} from '../shared/community';
import type {Viewer} from '../shared/access';
import type {Workspace} from '../shared/domain';
export type CommunityState={residentProfiles?:Record<string,ResidentProfile>;classifieds?:Classified[];places?:Place[];municipality?:Municipality;notifications?:ResidentNotification[]};
export function ensureCommunity<T extends CommunityState>(state:T):T{state.residentProfiles??={};state.classifieds??=[];state.places??=[];state.notifications??=[];state.municipality??=defaultMunicipality();return state;}
export function communityView(state:Workspace&CommunityState,residentId:string,viewer:Viewer,resident:boolean){
 ensureCommunity(state);const profile=state.residentProfiles![residentId]??defaultProfile(residentId);
 const classifications=resident||!viewer.permissions.includes('classifieds.manage')?state.classifieds!.filter(ad=>visibleClassified(ad)):state.classifieds!;
 const notifications=profile.classifiedNotifications?state.notifications!.filter(n=>classifications.some(ad=>ad.id===n.classifiedId)&&profile.notificationConsentAt&&n.createdAt>=profile.notificationConsentAt).map(n=>({...n,read:profile.readNotificationIds.includes(n.id)})):[];
 return {profile,classifieds:classifications,places:state.places!.filter(p=>!resident&&viewer.permissions.includes('city.manage')||p.published).sort((a,b)=>a.sortOrder-b.sortOrder),municipality:!resident&&viewer.permissions.includes('city.manage')||state.municipality!.published?state.municipality!:defaultMunicipality(),notifications};
}
function field(v:unknown,min=0,max=2000){if(typeof v!=='string'||v.trim().length<min||v.length>max)throw new Error(`Enter between ${min} and ${max} characters.`);return v.trim();}
function url(v:unknown){const value=field(v,0,1000);if(value){const u=new URL(value);if(u.protocol!=='https:')throw new Error('Links must use HTTPS.');}return value;}
export function applyCommunityAction(state:Workspace&CommunityState,body:any,residentId:string,actor:string,now=Date.now()):Record<string,unknown>|null{
 ensureCommunity(state);const at=new Date(now).toISOString();const log=(action:string,id='')=>state.audit.unshift({id:crypto.randomUUID(),action,actor,at,complaintId:id});
 if(body.action==='save-profile'){
  const p=body.profile;const previous=state.residentProfiles![residentId]??defaultProfile(residentId);const email=field(p.email,0,150);
  if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error('Enter a valid email address.');
  if(!['en','hi'].includes(p.language)||typeof p.classifiedNotifications!=='boolean')throw new Error('Invalid profile preferences.');
  state.residentProfiles![residentId]={...previous,name:field(p.name,2,80),email,address:field(p.address,0,300),language:p.language,classifiedNotifications:p.classifiedNotifications,notificationConsentAt:p.classifiedNotifications?(previous.notificationConsentAt??at):null,updatedAt:at};
  log('Resident updated own profile and notification preferences');return {};
 }
 if(body.action==='read-notification'){
  const profile=state.residentProfiles![residentId]??defaultProfile(residentId);
  if(!state.notifications!.some(n=>n.id===body.id))throw new Error('Notification not found.');
  profile.readNotificationIds=Array.from(new Set([...profile.readNotificationIds,body.id]));state.residentProfiles![residentId]=profile;return {};
 }
 if(body.action==='save-classified'){
  const ad=body.classified;const previous=ad.id?state.classifieds!.find(x=>x.id===ad.id):undefined;if(ad.id&&!previous)throw new Error('Classified not found.');
  const startsAt=field(ad.startsAt,1,40),endsAt=field(ad.endsAt,1,40);if(!Number.isFinite(+new Date(startsAt))||!Number.isFinite(+new Date(endsAt))||+new Date(endsAt)<=+new Date(startsAt))throw new Error('End date must be later than the start date.');
  const entry:Classified={id:previous?.id??crypto.randomUUID(),title:field(ad.title,4,120),titleHi:field(ad.titleHi,0,120),description:field(ad.description,10,4000),descriptionHi:field(ad.descriptionHi,0,4000),advertiser:field(ad.advertiser,2,150),contactPhone:field(ad.contactPhone,0,30),imageId:field(ad.imageId,0,100),url:url(ad.url),startsAt,endsAt,status:'draft',publishedAt:previous?.publishedAt??null};
  if(previous)state.classifieds![state.classifieds!.indexOf(previous)]=entry;else state.classifieds!.push(entry);log('Saved classified draft',entry.id);return {id:entry.id};
 }
 if(body.action==='publish-classified'){
  const ad=state.classifieds!.find(ad=>ad.id===body.id);if(!ad)throw new Error('Classified not found.');
  if(!['published','archived'].includes(body.status))throw new Error('Invalid publication status.');
  if(body.status==='published'&&+new Date(ad.endsAt)<=now)throw new Error('This classified has expired. Update its dates before publishing.');
  const notify=body.status==='published'&&!ad.publishedAt;ad.status=body.status;if(body.status==='published')ad.publishedAt??=at;
  if(notify)state.notifications!.unshift({id:crypto.randomUUID(),classifiedId:ad.id,title:ad.title,titleHi:ad.titleHi,body:`${ad.advertiser}: ${ad.description.slice(0,180)}`,bodyHi:ad.descriptionHi.slice(0,180),createdAt:at});
  log(`Classified ${body.status}`,ad.id);return {notificationCreated:notify,classifiedId:ad.id};
 }
 if(body.action==='save-municipality'){
  const m=body.municipality;if(typeof m.published!=='boolean')throw new Error('Choose publication status.');
  if(m.published&&(!m.sourceUrl||!m.history||!m.about))throw new Error('Add an overview, history and a source before publishing.');
  state.municipality={name:field(m.name,2,120),nameHi:field(m.nameHi,0,120),district:field(m.district,2,80),state:field(m.state,2,80),about:field(m.about,0,6000),aboutHi:field(m.aboutHi,0,6000),history:field(m.history,0,20000),historyHi:field(m.historyHi,0,20000),sourceUrl:url(m.sourceUrl),published:m.published};log('Municipality information updated');return {};
 }
 if(body.action==='save-place'){
  const p=body.place;const previous=p.id?state.places!.find(x=>x.id===p.id):undefined;if(p.id&&!previous)throw new Error('Place not found.');
  if(typeof p.published!=='boolean'||!Number.isInteger(p.sortOrder)||p.sortOrder<0)throw new Error('Invalid place visibility or order.');
  const entry:Place={id:previous?.id??crypto.randomUUID(),name:field(p.name,2,120),nameHi:field(p.nameHi,0,120),description:field(p.description,10,6000),descriptionHi:field(p.descriptionHi,0,6000),address:field(p.address,4,300),hours:field(p.hours,0,200),imageId:field(p.imageId,0,100),mapUrl:url(p.mapUrl),sourceUrl:url(p.sourceUrl),published:p.published,sortOrder:p.sortOrder};
  if(previous)state.places![state.places!.indexOf(previous)]=entry;else state.places!.push(entry);log('Visitor place saved',entry.id);return {id:entry.id};
 }
 return null;
}
