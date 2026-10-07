import {publicWorkspace, departmentsOf, departmentChoicesOf, closureOtpOf, type StoredWorkspace} from './service';
import {communityView, teamsOf, type CommunityState} from './community-service';
import {resolveAppConfig} from '../shared/domain';
import {adminResidents} from './resident-profile';
import {withWardInfo} from './complaint-wards';
import type {Principal} from './server';
/**
 * The workspace as one principal may see it. Residents get only their own complaints (strict residentId match), their own profile, ward,
 * notifications and unread counts; stored ward records (media ids), other profiles and internal markers never leave the server.
 * `residents` (every registered app user) goes only to administrators with residents.manage; they also get the ward list (without member photo ids) to pick a ward from.
 * The ward list (id, number, name, city, active; never member photo ids) also goes to administrators with complaints.read, for the ward filter. Their complaints carry the
 * ward they were filed in (`wardId`) and its label (`wardLabel`), computed here from the stored ward or the resident's profile, never stored.
 */
export function projectWorkspace(state: StoredWorkspace & CommunityState, who: Pick<Principal, 'residentId' | 'viewer'>, resident: boolean) {
 const data = publicWorkspace(state); const can = (p: string) => !resident && who.viewer.permissions.some(v => v === p);
 const {residentProfiles, wards, liveContentVersion, ...safe} = data as typeof data & CommunityState & {liveContentVersion?: number};
 const {teams: _storedTeams, departments: _storedDepartments, closureOtp: _storedClosureOtp, ...settingsRest} = data.settings;
 return {...safe, ...communityView(state, who.residentId, who.viewer, resident),
  ...(can('settings.manage') ? {wards: state.wards ?? []} : can('residents.manage') || can('complaints.read') ? {wards: (state.wards ?? []).map(w => ({...w, memberPhotoId: ''}))} : {}),
  // App users: only administrators with residents.manage receive other residents' profiles (real mobile numbers included); residents and every other role get nothing of the kind.
  ...(can('residents.manage') ? {residents: adminResidents(state)} : {}),
  complaints: resident ? data.complaints.filter(c => !!who.residentId && (c as any).residentId === who.residentId) : can('complaints.read') ? withWardInfo(data.complaints, state) : [],
  audit: can('audit.read') ? data.audit : [], communications: can('communications.read') ? data.communications : [],
  // appConfig reaches everyone (tabs, support and maintenance must work for residents); the team list and the departments (with their contact people and phone numbers) are internal to administrators who work complaints or settings.
  settings: {...settingsRest, appConfig: resolveAppConfig(data.settings.appConfig), ...(can('settings.manage') ? {closureOtp: closureOtpOf(data.settings)} : {}), ...(can('complaints.read') || can('settings.manage') ? {teams: teamsOf(data.settings), departments: departmentsOf(data.settings)} : {}), // Category managers need the department names for the category form, but not the contact people and phone numbers.
    ...(!(can('complaints.read') || can('settings.manage')) && can('categories.manage') ? {departments: departmentsOf(data.settings).map(d => ({id: d.id, name: d.name, nameHi: d.nameHi, contactName: '', contactPhone: '', active: d.active}))} : {}), ...(data.settings.brandingBanners ? {brandingBanners: can('settings.manage') ? data.settings.brandingBanners : data.settings.brandingBanners.filter(b => b.enabled)} : {})},
  categories: can('categories.manage') ? data.categories : data.categories.filter(c => c.enabled),
  // The departments residents can choose from when reporting: active ones that have at least one enabled category (names only, no contacts).
  departmentChoices: departmentChoicesOf(data),
  viewer: resident ? {role: 'Resident' as const, permissions: []} : who.viewer,
 };
}
