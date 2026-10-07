import { defaultIssueCategories, categoryIcons, teams, validateTransition, type Workspace, type Complaint, type Status, type IssueCategory, type Department } from '../shared/domain';
// demoCode is private test-only state. Never include challenges in workspace projections.
export type StoredWorkspace = Workspace & { liveContentVersion?: number; challenges?: Record<string,{hash:string;expires:number;attempts:number;lastSent:number;demoCode?:string}> };
/** retryAfter (seconds) is sent as the Retry-After header and `retryAfter` JSON field of a 429 by apiError(). */
export class ServiceError extends Error { constructor(message:string,public code=400,public retryAfter?:number){super(message);} }
/** Who is acting. Residents pass their id and registered profile details so new complaints are owned by, and named after, the real resident. */
/** The universal closure confirmation code: settings.closureOtp, default 123456; an explicit empty string disables it (a random code is then issued per complaint). */
export function closureOtpOf(settings:{closureOtp?:string}):string{return settings.closureOtp===undefined?'123456':settings.closureOtp;}
export type ActionContext = { residentId: string; resident: { name: string; mobile: string } | null; /** Number of the resident's ward; becomes part of new complaint numbers (JSS/<yy>/W<ward>/<n>). */ wardNumber?: string; /** Id of the resident's ward; stored on the new complaint as `wardId`. */ wardId?: string; /** Fixed closure code used while no OTP provider is configured (test OTP mode). */ closureCode?: string };
export async function digest(value:string){ const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,'0')).join(''); }
export function normalizeWorkspace(s:StoredWorkspace):StoredWorkspace {
 // Upgrade legacy JSON records without overwriting an intentionally empty catalog.
 if(!Array.isArray(s.categories))s.categories=defaultIssueCategories();
 for(const complaint of s.complaints)if(!complaint.categoryId)complaint.categoryId=s.categories.find(c=>c.nameEn===complaint.category)?.id;
 return s;
}
export function publicWorkspace(s:StoredWorkspace):Workspace { const {challenges,...data}=normalizeWorkspace(s);return data; }
function text(v:unknown,min=1,max=2000){if(typeof v!=='string'||v.trim().length<min||v.length>max)throw new ServiceError(`Enter between ${min} and ${max} characters.`);return v.trim();}
// Optional banner fields: absent, null or whitespace-only values mean "not set"; anything else must validate.
function blankField(v:unknown){return v===undefined||v===null||(typeof v==='string'&&!v.trim());}
/* ---- Complaint numbers ----
 * New complaints are numbered JSS/<yy>/W<ward>/<n>, for example JSS/26/W12/1: yy is the last two digits of the year in India (UTC+05:30), W<ward> is W plus the resident's ward number
 * (upper-case letters and digits, at most 8; W0 when it is unknown) and n is a plain integer (no zero padding) that starts at 1 and counts per ward per year.
 * Complaints created before this scheme keep their old WC-W<ward>-<year>-<code> ids; they are never renumbered and never affect the counter. */
export const COMPLAINT_ID_PREFIX='JSS';
/** Upper-case letters and digits of a ward number, at most 8 ('' when nothing usable is left). */
export function cleanWardNumber(wardNumber?:string){return (wardNumber??'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,8);}
/** The W<ward> part of a complaint number: W plus the cleaned ward number, or W0 while the ward number is unknown. */
export function complaintWardPart(wardNumber?:string){return `W${cleanWardNumber(wardNumber)||'0'}`;}
/** The two-digit year of an instant in India Standard Time (UTC+05:30), so the evening of 31 December UTC already belongs to the new year. */
export function complaintYearCode(now:number){return String(new Date(now+19800000).getUTCFullYear()%100).padStart(2,'0');}
/** The next number for a ward and year: 1 plus the highest n among existing JSS/<yy>/W<ward>/<n> ids with the same prefix (legacy and other-ward ids are ignored), bumped past any id already in use. */
export function nextComplaintId(complaints:{id:string}[],wardNumber:string|undefined,now:number){
 const prefix=`${COMPLAINT_ID_PREFIX}/${complaintYearCode(now)}/${complaintWardPart(wardNumber)}/`;
 let highest=0;const taken=new Set<string>();
 for(const c of complaints){taken.add(c.id);if(c.id.startsWith(prefix)){const tail=c.id.slice(prefix.length);if(/^[0-9]{1,9}$/.test(tail))highest=Math.max(highest,Number(tail));}}
 let n=highest+1;while(taken.has(`${prefix}${n}`))n++;
 return `${prefix}${n}`;
}
/** The ward code inside a complaint number (new JSS/<yy>/W<ward>/<n> or legacy WC-W<ward>-<year>-<code>); '' when it says nothing (W0, which stands for an unknown ward). */
export function wardCodeInComplaintId(id:string){const m=/^JSS\/\d{2}\/W([A-Z0-9]{1,8})\/\d+$/.exec(id)??/^WC-W([A-Z0-9]+)-/.exec(id);return m&&m[1]!=='0'?m[1]:'';}
// Banner call-to-action links open outside the app, so only credential-free https URLs are accepted.
export function httpsLink(v:unknown){const bad=new ServiceError('Enter a valid link that starts with https:// (up to 1000 characters, no spaces, username or password).');if(typeof v!=='string')throw bad;const raw=v.trim();if(raw.length<10||raw.length>1000||!/^https:\/\/[^/\\?#]/i.test(raw)||/[\s\u0000-\u001f\u007f\\]/u.test(raw))throw bad;let url:URL;try{url=new URL(raw);}catch{throw bad;}if(url.protocol!=='https:'||!url.hostname||url.username||url.password)throw bad;return raw;}
/* ---- Departments (settings.departments) ----
 * Departments replace the plain team list. `settings.teams` stays in sync (the names of the ACTIVE departments) so older code and clients keep working.
 * Until departments are saved once they are derived from the saved team list (or the built-in default list) with empty contact details.
 * Complaints store the department NAME in `assignee` (history is never rewritten on rename) plus, since departments exist, `assigneeId`, which keeps the link to the
 * department's current contact details after a rename. A department can be deactivated (no new assignments) but is only removed while no complaint refers to it. */
export const MAX_DEPARTMENTS = 20;
const CONTROL_CHARS=/[\u0000-\u001f\u007f]/;
const DEPARTMENT_EMAIL=/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const departmentKey = (v:string)=>v.normalize('NFKC').replace(/\s+/g,' ').trim().toLocaleLowerCase();
/** Deterministic id for a department derived from a plain team name, so the same team keeps the same id on every read. */
function derivedDepartmentId(name:string,taken:Set<string>){let h=2166136261;for(const ch of departmentKey(name)){h^=ch.codePointAt(0)!;h=Math.imul(h,16777619)>>>0;}let id=`team-${h.toString(36)}`;while(taken.has(id))id+='x';taken.add(id);return id;}
/** The departments in force: the saved list, else one derived (all active, no contact yet) from the saved team list or the default teams. Treat the result as read-only. */
/** Departments a resident can pick when reporting: active, with at least one enabled category pointing at them. Names only. */
export function departmentChoicesOf(data:{settings:{teams?:string[];departments?:Department[]};categories:IssueCategory[]}):{id:string;name:string;nameHi?:string}[]{const used=new Set(data.categories.filter(c=>c.enabled&&c.departmentId).map(c=>c.departmentId));return departmentsOf(data.settings).filter(d=>d.active&&used.has(d.id)).map(d=>({id:d.id,name:d.name,...(d.nameHi?{nameHi:d.nameHi}:{})}));}
/**
 * The whole workspace is stored as ONE database row, which must stay well under the ~2 MB row limit. The two append-only histories grow with use
 * (every complaint step adds communications and audit lines), so only the newest entries are kept (both lists are newest-first). If the JSON is
 * still too big the caps tighten, so a save can never be refused for size.
 */
export const HISTORY_CAPS={communications:500,audit:1500};
export const MAX_WORKSPACE_BYTES=1_800_000;
export function capHistory(state:{communications?:unknown[];audit?:unknown[]}):string{
 let caps={...HISTORY_CAPS};
 for(let i=0;i<5;i++){
  if(state.communications&&state.communications.length>caps.communications)state.communications.length=caps.communications;
  if(state.audit&&state.audit.length>caps.audit)state.audit.length=caps.audit;
  const json=JSON.stringify(state);
  if(json.length<=MAX_WORKSPACE_BYTES)return json;
  caps={communications:Math.floor(caps.communications/2),audit:Math.floor(caps.audit/2)};
 }
 return JSON.stringify(state);
}
export function departmentsOf(settings:{teams?:string[];departments?:Department[]}):Department[]{
 if(Array.isArray(settings.departments)&&settings.departments.length)return settings.departments;
 const taken=new Set<string>();
 return (settings.teams?.length?settings.teams:teams).map(name=>({id:derivedDepartmentId(name,taken),name,contactName:'',contactPhone:'',active:true}));
}
/** Names complaints may be assigned to now: the active departments (never an empty list; the legacy list covers a corrupted record). */
export function activeTeamNames(settings:{teams?:string[];departments?:Department[]}):string[]{
 const active=departmentsOf(settings).filter(d=>d.active).map(d=>d.name);
 return active.length?active:settings.teams?.length?settings.teams:teams;
}
/** The department a complaint is assigned to: by the stored department id when present, otherwise by the (case-insensitive) assignee name. */
export function departmentFor(settings:{teams?:string[];departments?:Department[]},c:{assignee?:string;assigneeId?:string}):Department|undefined{
 const list=departmentsOf(settings);
 return (c.assigneeId?list.find(d=>d.id===c.assigneeId):undefined)??(c.assignee?list.find(d=>departmentKey(d.name)===departmentKey(c.assignee!)):undefined);
}
export const PHONE_HELP='Enter a 10-digit mobile number (for example 98765 43210), with or without +91 or 0 in front, or a landline with its STD code (for example 0141 234 5678).';
/**
 * Normalises an Indian phone number for department updates. Spaces, dots, hyphens and brackets are ignored.
 *  - Mobile: ten digits starting 6–9, optionally prefixed by +91, 91 or 0. Stored as the plain 10 digits (98765 43210 -> 9876543210).
 *  - Landline: STD code plus number, ten digits starting 1–5 (eleven are tolerated), optionally prefixed by 0 or +91. Stored with a leading 0, so 11–12 digits (0141 234 5678 -> 01412345678).
 *  - STD codes that start with 6–9 (Kota 0744, Indore 0731, Bengaluru 080) look exactly like a mobile number when written as one block of ten digits. They are read as a landline only
 *    when written as STD code, one space or hyphen, then the number (0744 2345678, (0744) 2345678, +91 744 2345678); written 07442345678 or 7442345678 they are stored as a mobile number.
 * Returns null when the value is not a usable number.
 */
export function normalizeIndianPhone(value:unknown):string|null{
 if(typeof value!=='string')return null;
 const raw=value.trim(),compact=raw.replace(/[\s().-]/g,'');let digits:string;
 if(/^\+91\d+$/.test(compact))digits=compact.slice(3);
 else if(/^\d+$/.test(compact))digits=compact.length===12&&compact.startsWith('91')?compact.slice(2):compact.startsWith('0')?compact.slice(1):compact;
 else return null;
 if(/^[6-9]\d{9}$/.test(digits)){
  const std=/^(?:\+91[\s-]*)?\(?0?\s*(\d{2,4})\)?[\s.-]+(\d{6,8})$/.exec(raw);
  return std&&std[1].length+std[2].length===10?'0'+digits:digits;
 }
 if(/^[1-5]\d{9,10}$/.test(digits))return '0'+digits;
 return null;
}
/** Readable form of a stored department phone: +91 98765 43210 for mobiles, the stored digits for landlines. */
export function formatPhone(stored:string):string{return /^[6-9]\d{9}$/.test(stored)?`+91 ${stored.slice(0,5)} ${stored.slice(5)}`:stored;}
/**
 * Validates the whole department list sent by the admin portal and returns the clean list to store (ids generated for new entries).
 * Rules: 1–20 departments; names 2–60 characters and unique (case-insensitive, also against inactive ones); contact person 2–80 characters; phone per normalizeIndianPhone;
 * optional valid email; at least one active department. A department with no contact yet (derived from the old team list) or an inactive one may keep both contact fields empty
 * if it already had none, so one department can be completed at a time; every added or changed department must have a contact person and a phone number.
 * A phone number sent back exactly as it is stored is kept as it is (re-reading a stored landline such as 07442345678 would mistake it for a mobile number).
 * A department that complaints refer to cannot be removed from the list: deactivate it instead.
 */
export function validateDepartments(input:unknown,current:Department[],complaints:{assignee?:string;assigneeId?:string}[]=[]):Department[]{
 if(!Array.isArray(input)||input.length<1||input.length>MAX_DEPARTMENTS)throw new Error(`Add between 1 and ${MAX_DEPARTMENTS} departments.`);
 const byId=new Map(current.map(d=>[d.id,d]));const ids=new Set<string>(),names=new Set<string>();const out:Department[]=[];
 const plain=(v:unknown)=>typeof v==='string'?v.replace(/\s+/g,' ').trim():'';
 for(const [index,raw] of input.entries()){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error(`Department ${index+1}: enter a name, a contact person and a phone number.`);
  const r=raw as Record<string,unknown>;const name=plain(r.name);const who=name||`Department ${index+1}`;
  if(typeof r.name!=='string'||CONTROL_CHARS.test(r.name)||name.length<2||name.length>60)throw new Error(`${who}: the department name must be 2–60 characters.`);
  const key=departmentKey(name);if(names.has(key))throw new Error(`The department “${name}” is listed twice. Department names must be different.`);names.add(key);
  const hasId=!(r.id===undefined||r.id===null||(typeof r.id==='string'&&!r.id.trim()));
  if(hasId&&(typeof r.id!=='string'||r.id.length>100))throw new Error(`${who}: invalid department id.`);
  const previous=hasId?byId.get(r.id as string):undefined;if(hasId&&!previous)throw new Error(`${who}: this department no longer exists. Refresh the page and try again.`);
  const id=previous?.id??crypto.randomUUID();if(ids.has(id))throw new Error(`${who}: the same department is listed twice.`);ids.add(id);
  if(typeof r.active!=='boolean')throw new Error(`${who}: choose whether the department is active.`);
  const nameHi=r.nameHi===undefined||r.nameHi===null?'':plain(r.nameHi);if((r.nameHi!==undefined&&r.nameHi!==null&&typeof r.nameHi!=='string')||CONTROL_CHARS.test(nameHi)||nameHi.length>60)throw new Error(`${who}: the Hindi name must be at most 60 characters.`);
  const contactName=r.contactName===undefined||r.contactName===null?'':plain(r.contactName);if((r.contactName!==undefined&&r.contactName!==null&&typeof r.contactName!=='string')||CONTROL_CHARS.test(contactName))throw new Error(`${who}: the contact person's name must be 2–80 characters.`);
  const phoneText=r.contactPhone===undefined||r.contactPhone===null?'':typeof r.contactPhone==='string'?r.contactPhone.trim():'?';
  const noContact=!contactName&&!phoneText;
  let contactPhone='';
  if(noContact&&(!r.active||(previous&&!previous.contactName&&!previous.contactPhone))){/* contact not set yet: allowed for inactive or not-yet-completed departments */}
  else{
   if(contactName.length<2||contactName.length>80)throw new Error(`${who}: enter the contact person's name (2–80 characters).`);
   if(!phoneText)throw new Error(`${who}: enter the phone number on which updates will be sent. ${PHONE_HELP}`);
   const phone=previous?.contactPhone&&phoneText===previous.contactPhone?previous.contactPhone:normalizeIndianPhone(phoneText);if(!phone)throw new Error(`${who}: that phone number is not valid. ${PHONE_HELP}`);contactPhone=phone;
  }
  const email=r.contactEmail===undefined||r.contactEmail===null?'':typeof r.contactEmail==='string'?r.contactEmail.trim():'?';
  if(email&&(email.length>120||!DEPARTMENT_EMAIL.test(email)))throw new Error(`${who}: enter a valid email address or leave it empty.`);
  out.push({id,name,...(nameHi?{nameHi}:{}),contactName:noContact?'':contactName,contactPhone,...(email?{contactEmail:email}:{}),active:r.active});
 }
 if(!out.some(d=>d.active))throw new Error('Keep at least one active department so complaints can still be assigned.');
 for(const old of current){
  if(ids.has(old.id)||names.has(departmentKey(old.name)))continue; // kept, or replaced by a department of the same name (complaints find it by name)
  const used=complaints.filter(c=>c.assigneeId?c.assigneeId===old.id:!!c.assignee&&departmentKey(c.assignee)===departmentKey(old.name)).length;
  if(used)throw new Error(`“${old.name}” has ${used} complaint${used===1?'':'s'} assigned, so it cannot be deleted. Mark it as inactive instead: it stays on those complaints but cannot be assigned to new ones.`);
 }
 return out;
}
/** Stores a validated department list and keeps the legacy settings.teams in step (names of the active departments, in list order). */
export function storeDepartments(settings:Workspace['settings'],list:Department[]){settings.departments=list;settings.teams=list.filter(d=>d.active).map(d=>d.name);}
/**
 * Legacy `save-teams`: stores the plain team names. When departments exist they follow: matching names are reactivated (contact details kept), new names are added without a contact,
 * and departments missing from the list are deactivated, or dropped when they hold no contact details (so a removed team leaves nothing behind; complaints keep the name they were given).
 */
export function setTeamNames(settings:Workspace['settings'],names:string[]){
 settings.teams=names;if(!Array.isArray(settings.departments)||!settings.departments.length)return;
 const existing=settings.departments,keys=new Set(names.map(departmentKey));
 const next=names.map(name=>{const prev=existing.find(d=>departmentKey(d.name)===departmentKey(name));return prev?{...prev,name,active:true}:{id:crypto.randomUUID(),name,contactName:'',contactPhone:'',active:true};});
 settings.departments=[...next,...existing.filter(d=>!keys.has(departmentKey(d.name))&&(d.contactName||d.contactPhone)).map(d=>({...d,active:false}))];
}
export async function applyAction(s:StoredWorkspace,body:any,role:'admin'|'resident',now=Date.now(),actorOverride?:string,ctx?:ActionContext):Promise<Record<string,unknown>> {
 normalizeWorkspace(s);
 const at=new Date(now).toISOString();const action=body.action;const actor=actorOverride??(role==='admin'?'Ward Admin':'Resident');
 const adminActions=['transition','edit','announcement','settings','save-category','save-branding','save-banners','save-departments'];
 if(adminActions.includes(action)&&role!=='admin')throw new ServiceError('Administrator access required.',403);
 const c=s.complaints.find(c=>c.id===body.id);
 const log=(label:string,id='')=>s.audit.unshift({id:crypto.randomUUID(),action:label,actor,at,complaintId:id});
 const communicate=(c:Complaint,template:string,message:string)=>s.communications.unshift({id:crypto.randomUUID(),complaintId:c.id,template,channel:'WhatsApp',recipient:c.mobile,status:'Not sent · WhatsApp setup pending',at,reason:'WhatsApp Business sender, approved templates and verified resident numbers are not configured.',message});
 /** The ward the complaint was filed in (stored ward, else the resident's profile ward, else the ward code inside the complaint id): the only resident detail departments are told. Never the resident's phone number or address. Empty when unknown. */
 const wardOf=(c:Complaint)=>{const st=s as any;const wards:any[]=Array.isArray(st.wards)?st.wards:[];const profileWardId=!c.wardId&&(c as any).residentId?st.residentProfiles?.[(c as any).residentId]?.wardId:undefined;const known=c.wardId?wards.find(w=>w.id===c.wardId):profileWardId?wards.find(w=>w.id===profileWardId):undefined;if(known)return String(known.name||`Ward ${known.number}`);const code=wardCodeInComplaintId(c.id);if(!code)return '';const byCode=wards.find(w=>cleanWardNumber(w.number)===code);return String(byCode?.name||`Ward ${code}`);};
 /** Records (does not send: no WhatsApp provider is connected) an update for the department the complaint is assigned to, addressed to the department's contact phone. Departments without a phone number get nothing. */
 const tellDepartment=(c:Complaint,message:string)=>{const d=departmentFor(s.settings,c as any);if(!d?.contactPhone)return;s.communications.unshift({id:crypto.randomUUID(),complaintId:c.id,template:'Department update',channel:'WhatsApp',recipient:d.contactPhone,status:'Not sent · WhatsApp setup pending',at,reason:'WhatsApp Business sender and approved templates are not configured.',message:`${d.name}: ${message}`});};
 const aboutComplaint=(c:Complaint)=>{const ward=wardOf(c);return `Title: ${c.title}. Locality: ${c.locality}. Status: ${c.status}.${ward?` Resident's ward: ${ward}.`:''}`;};
 const issueClosure=async(c:Complaint)=>{const prev=s.challenges?.[c.id];if(prev&&now-prev.lastSent<60000)throw new ServiceError('Wait 60 seconds before requesting another code.',429);const buf=new Uint32Array(1);crypto.getRandomValues(buf);const code=closureOtpOf(s.settings)||ctx?.closureCode||String(100000+buf[0]%900000);s.challenges??={};s.challenges[c.id]={hash:await digest(`${c.id}:${code}`),expires:now+300000,attempts:0,lastSent:now,demoCode:code};communicate(c,'Closure OTP',`Closure requested for ${c.id}. Your closure OTP is sent to your WhatsApp. Share it with the ward officer only if the work is complete. The code expires in 5 minutes.`);log('Test WhatsApp closure challenge issued',c.id);return {expiresAt:new Date(now+300000).toISOString(),delivery:'setup-required',channel:'WhatsApp'};};
 /** Checks a closure OTP for complaint `c`: the configured universal code always works; otherwise the per-complaint code issued when closure was requested (5 minutes, 5 tries). Returns an error object for a wrong code, throws when the code expired or locked. */
 const closureCheck=async(c:Complaint,code:unknown):Promise<{ok:true}|{error:string}>=>{const given=typeof code==='string'?code.trim():'';const universal=closureOtpOf(s.settings);if(universal&&given===universal)return {ok:true};const ch=s.challenges?.[c.id];if(!ch||ch.expires<now||ch.attempts>=5)throw new ServiceError('Code expired or locked. Request a new code.');ch.attempts++;if(ch.hash!==await digest(`${c.id}:${given}`)){log('Incorrect closure code attempt',c.id);return {error:'Incorrect verification code.'};}return {ok:true};};
 const transition=(c:Complaint,next:Status,note:string,verified=false)=>{validateTransition(c,next,note,role,verified);c.status=next;c.history.push({status:next,note,at,actor});delete s.challenges?.[c.id];log(`Status changed to ${next}`,c.id);communicate(c,next,`SAMADHAN reference ${c.id}: ${next}. ${note}`);tellDepartment(c,`Complaint ${c.id} is now ${next}. ${aboutComplaint(c)}${role==='admin'&&note.trim()?` Note: ${note.trim().slice(0,300)}`:''}`);}; // only the administrator's own note goes to the department; a resident's free text (dispute reason, closure wording) never does
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
  // Every category belongs to a department. New categories must name one; edits keep the current department unless another is sent; an empty value clears it (legacy categories).
  const departments=departmentsOf(s.settings);const activeDepartments=departments.filter(d=>d.active);
  let departmentId=current?.departmentId;
  if(input.departmentId!==undefined){const chosen=typeof input.departmentId==='string'?input.departmentId.trim():'';if(chosen==='')departmentId=undefined;else{const dept=departments.find(d=>d.id===chosen);if(!dept)throw new ServiceError('Choose a department from the list.');if(!dept.active&&chosen!==current?.departmentId)throw new ServiceError('That department is inactive. Choose an active department.');departmentId=chosen;}}
  if(!current&&!departmentId&&activeDepartments.length)throw new ServiceError('Choose the department that handles this category.');
  const entry:IssueCategory={id:current?.id??crypto.randomUUID(),nameEn,nameHi,icon:input.icon,color:input.color,sortOrder:input.sortOrder,enabled:input.enabled,...(departmentId?{departmentId}:{})};
  if(current)s.categories[s.categories.indexOf(current)]=entry;else s.categories.push(entry);
  log(`${current?'Updated':'Added'} issue category: ${nameEn} (${entry.enabled?'enabled':'disabled'})`,entry.id);
  return {categoryId:entry.id};
 }
 if(action==='save-departments'){
  // Admin-only (settings.manage in actionPermissions). Validation errors are plain-English messages; nothing is stored when one fails.
  const list=validateDepartments(body.departments,departmentsOf(s.settings),s.complaints as any);
  storeDepartments(s.settings,list);
  log(`Updated departments: ${list.map(d=>d.active?d.name:`${d.name} (inactive)`).join(', ')}`);return {};
 }
 if(action==='create'){
  if(role!=='resident')throw new ServiceError('Use the citizen reporting flow.',403);
  if(ctx&&!ctx.resident)throw new ServiceError('Complete your registration before reporting an issue.',403);
  if(body.consent!==true)throw new ServiceError('Media-processing consent is required.');
  const category=s.categories.find(c=>(body.categoryId?c.id===body.categoryId:c.nameEn===body.category)&&c.enabled);
  if(!category)throw new ServiceError('This issue category is unavailable. Refresh the categories and choose another.');
  if(!Array.isArray(body.media)||body.media.length<1||body.media.length>5)throw new ServiceError('Attach 1–5 photographs.');
  if(!Number.isFinite(body.lat)||Math.abs(body.lat)>90||!Number.isFinite(body.lng)||Math.abs(body.lng)>180)throw new ServiceError('Confirm valid coordinates.');
  if(s.complaints.filter(c=>now-+new Date(c.createdAt)<60000&&(!ctx||(c as any).residentId===ctx.residentId)).length>=5)throw new ServiceError('Please wait a minute before submitting another report.',429);
  const id=nextComplaintId(s.complaints,ctx?.wardNumber,now);// JSS/<yy>/W<ward>/<n>; the workspace's optimistic-concurrency save keeps two simultaneous reports from sharing a number
  const complaint:Complaint={id,title:text(body.title,4,120),description:text(body.description,10),categoryId:category.id,category:category.nameEn,locality:text(body.locality,4,200),lat:body.lat,lng:body.lng,priority:'Normal',status:'Submitted',assignee:'',resident:ctx?.resident?.name??'',mobile:ctx?.resident?.mobile??'',createdAt:at,dueAt:new Date(now+s.settings.slaHours*3600000).toISOString(),history:[{status:'Submitted',note:'Complaint submitted. Media consent recorded: pilot-v1.',at,actor}],media:body.media,afterMedia:[],...(ctx?{residentId:ctx.residentId}:{}),...(ctx?.wardId?{wardId:ctx.wardId}:{})} as Complaint;
  // Route the complaint to the department that handles its category (an active department only); the team still moves it through the workflow.
  const routed=category.departmentId?departmentsOf(s.settings).find(d=>d.id===category.departmentId&&d.active):undefined;
  if(routed){complaint.assignee=routed.name;(complaint as any).assigneeId=routed.id;}
  s.complaints.unshift(complaint);log('Complaint submitted; consent pilot-v1',id);if(routed)tellDepartment(complaint,`New complaint ${complaint.id} has been routed to your department. ${aboutComplaint(complaint)}`);communicate(complaint,'Complaint acknowledgement',`Your complaint has been registered. Reference: ${id}. ${complaint.title}. Track progress in SAMADHAN → My complaints.`);return {id,referenceNumber:id,delivery:'setup-required',channel:'WhatsApp'};
 }
 if(action==='announcement'){s.announcements.unshift({id:crypto.randomUUID(),title:text(body.title,5,120),body:text(body.body,10),titleHi:'',bodyHi:'',priority:'Service notice',at,status:'published'});log('Ward notice published');return {};}
 if(action==='save-banners'){
  if(body.restoreDefault===true){delete s.settings.brandingBanners;log('Restored default home banners');return {};}
  if(!Array.isArray(body.banners)||body.banners.length>5)throw new ServiceError('Add up to five branding banners.');
  const ids=new Set<string>();
  const banners=body.banners.map((b:any)=>{if(!b||typeof b.enabled!=='boolean')throw new ServiceError('Set banner visibility.');const id=text(b.id,1,100);if(ids.has(id)||['supplied','community'].includes(id))throw new ServiceError('Invalid banner identifier.');ids.add(id);return {id,imageId:text(b.imageId,1,100),title:text(b.title,1,100),enabled:b.enabled,...(blankField(b.caption)?{}:{caption:text(b.caption,1,140)}),...(blankField(b.captionHi)?{}:{captionHi:text(b.captionHi,1,140)}),...(blankField(b.linkUrl)?{}:{linkUrl:httpsLink(b.linkUrl)})};});
  s.settings.brandingBanners=banners;log('Updated mobile home branding banners');return {};
 }
 if(action==='save-branding'){s.settings.splashImageId=text(body.splashImageId,0,100);log('Updated published app splash image');return {};}
 if(action==='settings'){if(!Number.isInteger(body.slaHours)||body.slaHours<1||body.slaHours>720)throw new ServiceError('Resolution SLA must be 1–720 hours.');const optionalLabel=(v:unknown,min:number,max:number)=>v===undefined||v===null?undefined:text(v,typeof v==='string'&&!v.trim()?0:min,max);/* left out or null keeps the stored value; an empty string clears it (new workspaces start with no contact line, ward label or city label) */const contactLabel=optionalLabel(body.contact,5,200),wardLabel=optionalLabel(body.ward,2,60),cityLabel=optionalLabel(body.city,2,60);if(contactLabel!==undefined)s.settings.contact=contactLabel;s.settings.slaHours=body.slaHours;if(body.closureOtp!==undefined){const otp=typeof body.closureOtp==='string'?body.closureOtp.trim():'';if(otp!==''&&!/^[0-9]{4,8}$/.test(otp))throw new ServiceError('The closure code must be 4 to 8 digits, or empty to issue a random code for each complaint.');s.settings.closureOtp=otp;log('Closure confirmation code updated');}if(wardLabel!==undefined)s.settings.ward=wardLabel;if(cityLabel!==undefined)s.settings.city=cityLabel;log('Service settings updated');return {};}
 if(!['edit','transition','dispute','issue-closure-code','preview-closure-code','verify-closure','admin-issue-closure-code','admin-verify-closure','override-close'].includes(action))throw new ServiceError('Unknown action.');
 if(!c)throw new ServiceError('Complaint not found.',404);
 if(action==='edit'){
  if(body.priority&&!['Low','Normal','High','Critical'].includes(body.priority))throw new ServiceError('Invalid priority.');
  const category=(body.categoryId||body.category)?s.categories.find(c=>(body.categoryId?c.id===body.categoryId:c.nameEn===body.category)&&c.enabled):undefined;
  if((body.categoryId||body.category)&&!category)throw new ServiceError('Invalid or disabled category.');
  // Assignment: the assignee must be an ACTIVE department (as it had to be in the team list before). Edits that do not send an assignee never revalidate the current one, so complaints of a deactivated or renamed department stay editable.
  const department=body.assignee&&typeof body.assignee==='string'?departmentsOf(s.settings).find(d=>d.active&&d.name===body.assignee):undefined;
  if(body.assignee&&!department)throw new ServiceError('Unknown team or department. Choose one of the active departments.');
  let assigned:Department|undefined;
  if(body.priority)c.priority=body.priority;if(category){c.category=category.nameEn;c.categoryId=category.id;}if(body.assignee){if(department)(c as any).assigneeId=department.id;if(body.assignee!==c.assignee&&department)assigned=department;c.assignee=body.assignee;}
  if(body.afterMedia){if(!Array.isArray(body.afterMedia)||body.afterMedia.length>5)throw new ServiceError('Maximum 5 evidence photographs.');c.afterMedia=body.afterMedia;}
  if(assigned)tellDepartment(c,`New complaint assigned: ${c.id}. ${aboutComplaint(c)} Further status updates will be sent to this number.`);
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
  // The configured closure code is valid for as long as the complaint awaits confirmation: it never expires or locks.
  const checked=await closureCheck(c,body.code);if('error' in checked)return checked;
  transition(c,'Closed','Resolution accepted. Resident confirmed the closure.',true);return {};
 }
 // The administrator closes a proposed resolution by entering the OTP the resident received on WhatsApp (resend with admin-issue-closure-code).
 if(action==='admin-issue-closure-code'){
  if(role!=='admin'||c.status!=='Resolution Proposed')throw new ServiceError('A closure OTP can be sent while the resolution awaits confirmation.',403);
  return await issueClosure(c);
 }
 if(action==='admin-verify-closure'){
  if(role!=='admin'||c.status!=='Resolution Proposed')throw new ServiceError('Closure can be verified while the resolution awaits confirmation.',403);
  const checked=await closureCheck(c,body.code);if('error' in checked)return checked;
  transition(c,'Closed','Resolution confirmed: the resident’s closure OTP was verified by the administrator.',true);return {};
 }
 if(action==='override-close')throw new ServiceError('Privileged closure is disabled until production MFA and authorization are configured.',403);
 throw new ServiceError('Unknown action.');
}
