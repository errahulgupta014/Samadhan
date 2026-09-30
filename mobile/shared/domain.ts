export const statuses = ['Submitted', 'Acknowledged', 'Assigned', 'In Progress', 'On Hold', 'Resolution Proposed', 'Closed', 'Reopened', 'Rejected / Duplicate'] as const;
export type Status = typeof statuses[number];
export const categories = ['Road & Footpath', 'Garbage & Cleaning', 'Drainage & Sewer', 'Streetlight & Electrical', 'Water', 'Parks & Public Spaces', 'Public Infrastructure', 'Other'];
export type IssueCategory = { id: string; nameEn: string; nameHi: string; icon: string; color: string; sortOrder: number; enabled: boolean };
export const categoryIcons = ['walk-outline','trash-outline','water-outline','bulb-outline','water','leaf-outline','business-outline','paw-outline','car-outline','megaphone-outline','shield-checkmark-outline','ellipsis-horizontal'] as const;
export function defaultIssueCategories(): IssueCategory[] {
 const ids=['roads','garbage','drainage','streetlights','water','parks','infrastructure','other'];
 const namesHi=['सड़क / फुटपाथ','कचरा / सफाई','नाली / सीवर','स्ट्रीट लाइट','पानी','पार्क / सार्वजनिक स्थान','सार्वजनिक संरचना','अन्य'];
 return categories.map((nameEn,i)=>({id:ids[i],nameEn,nameHi:namesHi[i],icon:categoryIcons[i===7?11:i],color:['#2473a0','#ed9336','#4491b0','#dfa43e','#3a88b6','#318d60','#547a99','#698194'][i],sortOrder:i,enabled:true}));
}
export function activeCategories(items: IssueCategory[]): IssueCategory[] { return items.filter(c=>c.enabled).sort((a,b)=>a.sortOrder-b.sortOrder||a.nameEn.localeCompare(b.nameEn)); }
export const teams = ['Roads & Infrastructure', 'Sanitation Team', 'Water & Drainage', 'Electrical Team', 'Parks Department'];
export type Timeline = { status: Status; note: string; at: string; actor: string };
export type Complaint = { id: string; title: string; description: string; categoryId?: string; category: string; locality: string; lat: number; lng: number; priority: string; status: Status; assignee: string; resident: string; mobile: string; createdAt: string; dueAt: string; history: Timeline[]; media: string[]; afterMedia: string[]; };
export type Communication = { id: string; complaintId: string; template: string; channel: string; recipient: string; status: string; at: string; reason: string };
export type Announcement = { id: string; title: string; body: string; priority: string; at: string };
export type Workspace = { profile?:ResidentProfile; classifiedNotifications?:boolean; classifieds?:Classified[]; places?:Place[]; municipality?:Municipality; notifications?:ResidentNotification[]; viewer?:Viewer; categories: IssueCategory[]; complaints: Complaint[]; communications: Communication[]; announcements: Announcement[]; audit: { id: string; action: string; actor: string; at: string; complaintId: string }[]; settings: { ward: string; city: string; contact: string; slaHours: number }; };
export const transitions: Record<Status, Status[]> = {
 'Submitted': ['Acknowledged', 'Rejected / Duplicate'], 'Acknowledged': ['Assigned', 'Rejected / Duplicate'],
 'Assigned': ['In Progress', 'On Hold'], 'In Progress': ['On Hold', 'Resolution Proposed'],
 'On Hold': ['Assigned', 'In Progress'], 'Resolution Proposed': ['Closed', 'Reopened'], 'Closed': ['Reopened'],
 'Reopened': ['Acknowledged', 'Assigned'], 'Rejected / Duplicate': ['Reopened'],
};
export function validateTransition(c: Complaint, next: Status, note: string, actor: 'admin' | 'resident', verified = false) {
 if (!transitions[c.status]?.includes(next)) throw new Error(`Cannot move from ${c.status} to ${next}.`);
 if (actor === 'resident' && !['Closed', 'Reopened'].includes(next)) throw new Error('Residents cannot perform operational updates.');
 if (next === 'Closed' && (actor !== 'resident' || !verified)) throw new Error('Resident OTP verification is required.');
 if (['On Hold', 'Reopened', 'Rejected / Duplicate', 'Resolution Proposed'].includes(next) && note.trim().length < 8) throw new Error('Please provide a reason of at least 8 characters.');
 if (next === 'Assigned' && !c.assignee) throw new Error('Select an assigned team.');
 if (next === 'Resolution Proposed' && !c.afterMedia.length) throw new Error('Upload after-work evidence before proposing resolution.');
}
export function seedWorkspace(now = new Date()): Workspace {
 const specs = [
 ['Overflowing waste near Central Market','Garbage & Cleaning','Central Market','High','Submitted',''],
 ['Damaged road outside community centre','Road & Footpath','Gandhi Nagar','High','In Progress','Roads & Infrastructure'],
 ['Streetlights not working on Park Road','Streetlight & Electrical','Park Road','Normal','Assigned','Electrical Team'],
 ['Water leakage near the primary school','Water','Shastri Nagar','High','Acknowledged',''],
 ['Blocked drain along Station Road','Drainage & Sewer','Station Road','High','On Hold','Water & Drainage'],
 ['Broken bench at neighbourhood park','Parks & Public Spaces','Gandhi Nagar','Low','Submitted',''],
 ['Waste collection missed in Block C','Garbage & Cleaning','Civil Lines','Normal','In Progress','Sanitation Team'],
 ['Damaged footpath near bus stop','Road & Footpath','Central Market','Normal','Closed','Roads & Infrastructure'],
 ['Streetlight repaired at community gate','Streetlight & Electrical','Shastri Nagar','Normal','Closed','Electrical Team'],
 ['Public tap leaking at market entrance','Water','Central Market','Normal','Reopened','Water & Drainage'],
 ['Debris cleared from public walkway','Public Infrastructure','Civil Lines','Normal','Closed','Sanitation Team'],
 ['Drain cleaning at residential lane','Drainage & Sewer','Gandhi Nagar','Normal','Assigned','Water & Drainage'],
 ];
 return { categories: defaultIssueCategories(), complaints: specs.map((s,i) => { const at=new Date(+now-(i*7+2)*3600000).toISOString(); return {id:`WC-W12-2026-${String(184+i).padStart(6,'0')}`,title:s[0],description:`${s[0]}. Please inspect the area and arrange the necessary repair or service. This is a sample complaint for workflow testing.`,category:s[1],locality:s[2],lat:26.9124+i*.001,lng:75.7873+i*.001,priority:s[3],status:s[4] as Status,assignee:s[5],resident:'Demo Resident',mobile:'•••••• 2100',createdAt:at,dueAt:new Date(+new Date(at)+48*3600000).toISOString(),history:[{status:'Submitted',note:'Complaint registered by resident.',at,actor:'Demo Resident'},...(s[4]!=='Submitted'?[{status:s[4] as Status,note:'Sample operational update.',at:new Date(+new Date(at)+3600000).toISOString(),actor:'Ward Admin'}]:[])],media:[],afterMedia:[]}; }), communications:[],audit:[], announcements:[{id:'notice-1',title:'Water supply maintenance',body:'Scheduled maintenance in Gandhi Nagar on 30 September, 10 AM–1 PM. Please store sufficient water in advance.',priority:'Service notice',at:now.toISOString()}], settings:{ward:'Ward 12',city:'Jaipur',contact:'Ward office · Monday–Saturday, 10 AM–5 PM',slaHours:48} };
}
import type {ResidentProfile,Classified,Place,Municipality,ResidentNotification} from './community';
import type {Viewer} from './access';
