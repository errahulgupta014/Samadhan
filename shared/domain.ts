export const statuses = ['Submitted', 'Acknowledged', 'Assigned', 'In Progress', 'On Hold', 'Resolution Proposed', 'Closed', 'Reopened', 'Rejected / Duplicate'] as const;
export type Status = typeof statuses[number];
export const categories = ['Road & Footpath', 'Garbage & Cleaning', 'Drainage & Sewer', 'Streetlight & Electrical', 'Water', 'Parks & Public Spaces', 'Public Infrastructure', 'Other'];
/** `departmentId` = the department that handles complaints of this category. Residents get it too so the app can ask for the department first and then list that department's categories; new complaints are routed to it automatically. */
/** A department as residents see it when reporting a problem: names only (never contacts). */
export type DepartmentChoice = { id: string; name: string; nameHi?: string };
export type IssueCategory = { id: string; nameEn: string; nameHi: string; icon: string; color: string; sortOrder: number; enabled: boolean; departmentId?: string };
export const categoryIcons = ['walk-outline','trash-outline','water-outline','bulb-outline','water','leaf-outline','business-outline','paw-outline','car-outline','megaphone-outline','shield-checkmark-outline','ellipsis-horizontal'] as const;
export function defaultIssueCategories(): IssueCategory[] {
 const ids=['roads','garbage','drainage','streetlights','water','parks','infrastructure','other'];
 const namesHi=['सड़क / फुटपाथ','कचरा / सफाई','नाली / सीवर','स्ट्रीट लाइट','पानी','पार्क / सार्वजनिक स्थान','सार्वजनिक संरचना','अन्य'];
 return categories.map((nameEn,i)=>({id:ids[i],nameEn,nameHi:namesHi[i],icon:categoryIcons[i===7?11:i],color:['#2473a0','#ed9336','#4491b0','#dfa43e','#3a88b6','#318d60','#547a99','#698194'][i],sortOrder:i,enabled:true}));
}
export function activeCategories(items: IssueCategory[]): IssueCategory[] { return items.filter(c=>c.enabled).sort((a,b)=>a.sortOrder-b.sortOrder||a.nameEn.localeCompare(b.nameEn)); }
export const teams = ['Roads & Infrastructure', 'Sanitation Team', 'Water & Drainage', 'Electrical Team', 'Parks Department'];
export type Timeline = { status: Status; note: string; at: string; actor: string };
/** `wardId` is stored on new complaints (the resident's ward when they reported it). `wardLabel` ("Ward 3 · Name") is computed when the workspace is read for an administrator and is never stored; both are blank when the ward is unknown. */
export type Complaint = { id: string; title: string; description: string; categoryId?: string; category: string; locality: string; lat: number; lng: number; priority: string; status: Status; assignee: string; resident: string; mobile: string; createdAt: string; dueAt: string; history: Timeline[]; media: string[]; afterMedia: string[]; wardId?: string; wardLabel?: string; };
export type Communication = { id: string; complaintId: string; template: string; channel: string; recipient: string; status: string; at: string; reason: string; message?:string };
export type Announcement = { id: string; title: string; titleHi?: string; body: string; bodyHi?: string; priority: string; at: string; endsAt?: string; status?: 'published' | 'archived' };
/** A department that handles complaints. `contactPhone` is where complaint updates for the department are sent (provider connection pending). Names double as the assignee values stored on complaints. */
export type Department = { id: string; name: string; nameHi?: string; contactName: string; contactPhone: string; contactEmail?: string; active: boolean };
export type BrandingBanner = {id:string;imageId:string;title:string;enabled:boolean;caption?:string;captionHi?:string;linkUrl?:string};
/** Remote app configuration edited in the admin portal (settings.appConfig); always read through resolveAppConfig so missing fields default. */
export type AppConfig = {
 orgLabel: {en: string; hi: string};
 support: {phone: string; email: string; hoursEn: string; hoursHi: string};
 termsUrl: string; privacyUrl: string;
 tabs: {classifieds: boolean; activities: boolean; city: boolean};
 tiles: {classifieds: boolean; activities: boolean; city: boolean; notices: boolean};
 maintenance: {enabled: boolean; messageEn: string; messageHi: string};
 minAppVersion: string;
};
export function defaultAppConfig(): AppConfig {
 return {orgLabel: {en: 'Panchayat Samiti and Nagar Parishad', hi: 'पंचायत समिति और नगर परिषद'}, support: {phone: '', email: '', hoursEn: '', hoursHi: ''}, termsUrl: '', privacyUrl: '', tabs: {classifieds: true, activities: true, city: true}, tiles: {classifieds: true, activities: true, city: true, notices: true}, maintenance: {enabled: false, messageEn: '', messageHi: ''}, minAppVersion: ''};
}
export function resolveAppConfig(c?: Partial<AppConfig> | null): AppConfig {
 const d = defaultAppConfig();
 return {...d, ...c, orgLabel: {...d.orgLabel, ...c?.orgLabel}, support: {...d.support, ...c?.support}, tabs: {...d.tabs, ...c?.tabs}, tiles: {...d.tiles, ...c?.tiles}, maintenance: {...d.maintenance, ...c?.maintenance}};
}
export type Workspace = { departmentChoices?: DepartmentChoice[]; residents?:AdminResident[]; activities?:Activity[]; wards?:Ward[]; ward?:PublicWard|null; unread?:UnreadCounts; profile?:ResidentProfile; classifiedNotifications?:boolean; classifieds?:Classified[]; places?:Place[]; municipality?:Municipality; notifications?:ResidentNotification[]; viewer?:Viewer; categories: IssueCategory[]; complaints: Complaint[]; communications: Communication[]; announcements: Announcement[]; audit: { id: string; action: string; actor: string; at: string; complaintId: string }[]; settings: { /** Universal closure confirmation code residents enter to close a resolved complaint (admins with settings.manage only; undefined = default 123456, '' = disabled so a random code is issued per complaint). */ closureOtp?:string; appConfig?:AppConfig; teams?:string[]; departments?:Department[]; brandingBanners?:BrandingBanner[]; splashImageId?:string; ward: string; city: string; contact: string; slaHours: number }; };
export const transitions: Record<Status, Status[]> = {
 'Submitted': ['Acknowledged', 'Rejected / Duplicate'], 'Acknowledged': ['Assigned', 'Rejected / Duplicate'],
 'Assigned': ['In Progress', 'On Hold'], 'In Progress': ['On Hold', 'Resolution Proposed'],
 'On Hold': ['Assigned', 'In Progress'], 'Resolution Proposed': ['Closed', 'Reopened'], 'Closed': ['Reopened'],
 'Reopened': ['Acknowledged', 'Assigned'], 'Rejected / Duplicate': ['Reopened'],
};
export function validateTransition(c: Complaint, next: Status, note: string, actor: 'admin' | 'resident', verified = false) {
 if (!transitions[c.status]?.includes(next)) throw new Error(`Cannot move from ${c.status} to ${next}.`);
 if (actor === 'resident' && !['Closed', 'Reopened'].includes(next)) throw new Error('Residents cannot perform operational updates.');
 // A complaint is only ever closed after the closure OTP was verified: by the resident in the app, or by the administrator entering the OTP the resident received on WhatsApp.
 if (next === 'Closed' && !verified) throw new Error('Closure OTP verification is required.');
 if (['On Hold', 'Reopened', 'Rejected / Duplicate', 'Resolution Proposed'].includes(next) && note.trim().length < 8) throw new Error('Please provide a reason of at least 8 characters.');
 if (next === 'Assigned' && !c.assignee) throw new Error('Select an assigned team.');
 if (next === 'Resolution Proposed' && !c.afterMedia.length) throw new Error('Upload after-work evidence before proposing resolution.');
}
/** Version marker of the live-content upgrade (lib/live-content.ts): v1 purged seeded test records, v2 blanks the old single-ward pilot labels (settings.ward, settings.city, settings.contact). Each step runs once per stored workspace. */
export const LIVE_CONTENT_VERSION = 2;
/** A brand-new workspace contains configuration only: no sample complaints, notices, ads or places, and no wards (administrators add them under Settings → Wards), ward or city label or contact line. */
export function seedWorkspace(_now = new Date()): Workspace & { liveContentVersion: number } {
 return { categories: defaultIssueCategories(), complaints: [], communications: [], audit: [], announcements: [], wards: [], liveContentVersion: LIVE_CONTENT_VERSION, settings: { ward: '', city: '', contact: '', slaHours: 48 } };
}
import type {ResidentProfile,AdminResident,Activity,Classified,Place,Municipality,ResidentNotification,PublicWard,UnreadCounts,Ward} from './community';
import type {Viewer} from './access';
