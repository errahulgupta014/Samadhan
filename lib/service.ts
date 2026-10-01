import { defaultIssueCategories, categoryIcons, teams, validateTransition, type Workspace, type Complaint, type Status, type IssueCategory } from '../shared/domain';
// demoCode is private test-only state. Never include challenges in workspace projections.
export type StoredWorkspace = Workspace & { challenges?: Record<string,{hash:string;expires:number;attempts:number;lastSent:number;demoCode?:string}> };
export class ServiceError extends Error { constructor(message:string,public code=400){super(message);} }
export async function digest(value:string){ const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,'0')).join(''); }
export function normalizeWorkspace(s:StoredWorkspace):StoredWorkspace {
 // Upgrade legacy JSON records without overwriting an intentionally empty catalog.
 if(!Array.isArray(s.categories))s.categories=defaultIssueCategories();
 for(const complaint of s.complaints)if(!complaint.categoryId)complaint.categoryId=s.categories.find(c=>c.nameEn===complaint.category)?.id;
 return s;
}
export function publicWorkspace(s:StoredWorkspace):Workspace { const {challenges,...data}=normalizeWorkspace(s);return data; }
function text(v:unknown,min=1,max=2000){if(typeof v!=='string'||v.trim().length<min||v.length>max)throw new ServiceError(`Enter between ${min} and ${max} characters.`);return v.trim();}
export async function applyAction(s:StoredWorkspace,body:any,role:'admin'|'resident',now=Date.now(),actorOverride?:string):Promise<Record<string,unknown>> {
 normalizeWorkspace(s);
 const at=new Date(now).toISOString();const action=body.action;const actor=actorOverride??(role==='admin'?'Ward Admin (test)':'Demo Resident');
 const adminActions=['transition','edit','announcement','settings','save-category','save-branding'];
 if(adminActions.includes(action)&&role!=='admin')throw new ServiceError('Administrator access required.',403);
 const c=s.complaints.find(c=>c.id===body.id);
 const log=(label:string,id='')=>s.audit.unshift({id:crypto.randomUUID(),action:label,actor,at,complaintId:id});
 const communicate=(c:Complaint,template:string,message:string)=>s.communications.unshift({id:crypto.randomUUID(),complaintId:c.id,template,channel:'WhatsApp',recipient:c.mobile,status:'Not sent · WhatsApp setup pending',at,reason:'WhatsApp Business sender, approved templates and verified resident numbers are not configured.',message});
 const issueClosure=async(c:Complaint)=>{const prev=s.challenges?.[c.id];if(prev&&now-prev.lastSent<60000)throw new ServiceError('Wait 60 seconds before requesting another code.',429);const buf=new Uint32Array(1);crypto.getRandomValues(buf);const code=String(100000+buf[0]%900000);s.challenges??={};s.challenges[c.id]={hash:await digest(`${c.id}:${code}`),expires:now+300000,attempts:0,lastSent:now,demoCode:code};communicate(c,'Closure OTP',`Closure requested for ${c.id}. Review the completed work and verify the OTP in your app only if the issue is resolved. The code expires in 5 minutes.`);log('Test WhatsApp closure challenge issued',c.id);return {expiresAt:new Date(now+300000).toISOString(),delivery:'setup-required',channel:'WhatsApp'};};
 const transition=(c:Complaint,next:Status,note:string,verified=false)=>{validateTransition(c,next,note,role,verified);c.status=next;c.history.push({status:next,note,at,actor});delete s.challenges?.[c.id];log(`Status changed to ${next}`,c.id);communicate(c,next,`SAMADHAN reference ${c.id}: ${next}. ${note}`);};
 if(action==='save-category'){
  const input=body.category;
  if(!input||typeof input!=='object')throw new ServiceError('Enter category details.');
  const current=input.id?s.categories.find(c=>c.id===input.id):undefined;
  if(input.id&&!current)throw new ServiceError('Category not found.',404);
  const nameEn=text(input.nameEn,2,80),nameHi=text(input.nameHi,2,80);
  const key=(value:string)=>value.normalize('NFKC').replace(/\s+/g,' ').trim().toLocaleLowerCase();
  if(s.categories.some(c=>c.id!==current?.id&&(key(c.nameEn)===key(nameEn)||key(c.nameHi)===key(nameHi))))throw new ServiceError('A category with this English or Hindi name already exists.');
  if(!categoryIcons.includes(input.icon))throw new ServiceError('Choose a supported category icon.');
  if(typeof input.color!=='string'||!/^#[0-9a-fA-F]{6}$/.test(input.color))throw new ServiceError('Choose a valid category color.');
  if(typeof input.enabled!=='boolean'||!Number.isInteger(input.sortOrder)||input.sortOrder<0||input.sortOrder>9999)throw new ServiceError('Set visibility and an order between 0 and 9999.');
  const entry:IssueCategory={id:current?.id??crypto.randomUUID(),nameEn,nameHi,icon:input.icon,color:input.color,sortOrder:input.sortOrder,enabled:input.enabled};
  if(current)s.categories[s.categories.indexOf(current)]=entry;else s.categories.push(entry);
  log(`${current?'Updated':'Added'} issue category: ${nameEn} (${entry.enabled?'enabled':'disabled'})`,entry.id);
  return {categoryId:entry.id};
 }
 if(action==='create'){
  if(role!=='resident')throw new ServiceError('Use the citizen reporting flow.',403);
  if(body.consent!==true)throw new ServiceError('Media-processing consent is required.');
  const category=s.categories.find(c=>(body.categoryId?c.id===body.categoryId:c.nameEn===body.category)&&c.enabled);
  if(!category)throw new ServiceError('This issue category is unavailable. Refresh the categories and choose another.');
  if(!Array.isArray(body.media)||body.media.length<1||body.media.length>5)throw new ServiceError('Attach 1–5 photographs.');
  if(!Number.isFinite(body.lat)||Math.abs(body.lat)>90||!Number.isFinite(body.lng)||Math.abs(body.lng)>180)throw new ServiceError('Confirm valid coordinates.');
  if(s.complaints.filter(c=>now-+new Date(c.createdAt)<60000).length>=5)throw new ServiceError('Please wait a minute before submitting another report.',429);
  let id:string;do{id=`WC-W12-${new Date(now).getFullYear()}-${crypto.randomUUID().replaceAll('-','').slice(0,12).toUpperCase()}`;}while(s.complaints.some(c=>c.id===id));
  const complaint:Complaint={id,title:text(body.title,4,120),description:text(body.description,10),categoryId:category.id,category:category.nameEn,locality:text(body.locality,4,200),lat:body.lat,lng:body.lng,priority:'Normal',status:'Submitted',assignee:'',resident:'Demo Resident',mobile:'•••••• 2100',createdAt:at,dueAt:new Date(now+s.settings.slaHours*3600000).toISOString(),history:[{status:'Submitted',note:'Complaint submitted. Media consent recorded: pilot-v1.',at,actor}],media:body.media,afterMedia:[]};
  s.complaints.unshift(complaint);log('Complaint submitted; consent pilot-v1',id);communicate(complaint,'Complaint acknowledgement',`Your complaint has been registered. Reference: ${id}. ${complaint.title}. Track progress in SAMADHAN → My complaints.`);return {id,referenceNumber:id,delivery:'setup-required',channel:'WhatsApp'};
 }
 if(action==='announcement'){s.announcements.unshift({id:crypto.randomUUID(),title:text(body.title,5,120),body:text(body.body,10),priority:'Service notice',at});log('Ward notice published');return {};}
 if(action==='save-branding'){s.settings.splashImageId=text(body.splashImageId,0,100);log('Updated published app splash image');return {};}
 if(action==='settings'){if(!Number.isInteger(body.slaHours)||body.slaHours<1||body.slaHours>720)throw new ServiceError('Resolution SLA must be 1–720 hours.');s.settings.contact=text(body.contact,5,200);s.settings.slaHours=body.slaHours;log('Ward settings updated');return {};}
 if(!c)throw new ServiceError('Complaint not found.',404);
 if(action==='edit'){
  if(body.priority&&!['Low','Normal','High','Critical'].includes(body.priority))throw new ServiceError('Invalid priority.');
  const category=(body.categoryId||body.category)?s.categories.find(c=>(body.categoryId?c.id===body.categoryId:c.nameEn===body.category)&&c.enabled):undefined;
  if((body.categoryId||body.category)&&!category)throw new ServiceError('Invalid or disabled category.');
  if(body.assignee&&!teams.includes(body.assignee))throw new ServiceError('Unknown team.');
  if(body.priority)c.priority=body.priority;if(category){c.category=category.nameEn;c.categoryId=category.id;}if(body.assignee)c.assignee=body.assignee;
  if(body.afterMedia){if(!Array.isArray(body.afterMedia)||body.afterMedia.length>5)throw new ServiceError('Maximum 5 evidence photographs.');c.afterMedia=body.afterMedia;}
  log('Complaint classification / assignment / evidence updated',c.id);return {};
 }
 if(action==='transition'){transition(c,body.status,text(body.note??'',1));if(body.status==='Resolution Proposed')return await issueClosure(c);return {};}
 if(action==='dispute'){if(role!=='resident')throw new ServiceError('Use the resident dispute flow.',403);transition(c,'Reopened',text(body.note,8));return {};}
 if(action==='issue-closure-code'){
  if(role!=='resident'||c.status!=='Resolution Proposed')throw new ServiceError('A resident can request verification after resolution is proposed.',403);
  return await issueClosure(c);
 }
 if(action==='preview-closure-code'){
  if(role!=='resident'||c.status!=='Resolution Proposed')throw new ServiceError('Resident test preview required.',403);
  const ch=s.challenges?.[c.id];if(!ch?.demoCode||ch.expires<=now||ch.attempts>=5)throw new ServiceError('Test code expired or locked. Request another code.');
  return {demoCode:ch.demoCode,expiresAt:new Date(ch.expires).toISOString(),delivery:'setup-required'};
 }
 if(action==='verify-closure'){
  if(role!=='resident'||c.status!=='Resolution Proposed')throw new ServiceError('Resident verification required.',403);
  const ch=s.challenges?.[c.id];if(!ch||ch.expires<now||ch.attempts>=5)throw new ServiceError('Code expired or locked. Request a new code.');
  ch.attempts++;if(ch.hash!==await digest(`${c.id}:${body.code}`)){log('Incorrect closure code attempt',c.id);return {error:'Incorrect verification code.'};}
  transition(c,'Closed','Resolution accepted. Resident verified with a simulated OTP.',true);return {};
 }
 if(action==='override-close')throw new ServiceError('Privileged closure is disabled until production MFA and authorization are configured.',403);
 throw new ServiceError('Unknown action.');
}
