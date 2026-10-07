import {permissions,rolePresets,type AdminRole,type Permission} from '../shared/access';

/**
 * Pure rules for the permission checkboxes of the Add / Edit admin user form (app/admin-users-manager.tsx). No React, no I/O, unit tested.
 * The server (lib/access-policy.ts grantedPermissions, lib/admin-policy.ts) stays the authority; these rules only keep the form from sending what it would refuse:
 * `admins.manage` belongs to the Super Admin role alone, and handling complaints needs reading them.
 */

/** Ticked when Add admin user opens: a basic complaint desk plus notices operator. Change this list to change the starting point. */
export const DEFAULT_NEW_ADMIN_PERMISSIONS:readonly Permission[]=['complaints.read','complaints.manage','announcements.manage'];

/** What the form holds. `role` is what is sent; `basedOn` remembers the preset the boxes started from once they were changed by hand (role becomes Custom). */
export type PermissionForm={role:AdminRole;basedOn:AdminRole|null;permissions:Permission[]};

const order=(list:readonly Permission[])=>permissions.filter(p=>list.includes(p));
/** Dependency rules only: handling complaints needs reading them. Canonical order, no duplicates. */
export function tidy(list:readonly Permission[]):Permission[]{
 const next=new Set(list);
 if(next.has('complaints.manage'))next.add('complaints.read');
 return order([...next]);
}
/** A preset's own permission list (Custom has none of its own). */
export const presetPermissions=(role:AdminRole):Permission[]=>[...rolePresets[role]] as Permission[];
/** Boxes a Custom role may hold: never the administrator-management permission. */
const customable=(list:readonly Permission[])=>tidy(list.filter(p=>p!=='admins.manage'));

/** The Add form when it opens: role Custom with the default boxes ticked. */
export const defaultForm=():PermissionForm=>({role:'Custom',basedOn:null,permissions:tidy(DEFAULT_NEW_ADMIN_PERMISSIONS)});
/** The Edit form: the person's role with their current effective permissions. */
export const formForUser=(user:{role:AdminRole;permissions:readonly Permission[]}):PermissionForm=>({role:user.role,basedOn:null,permissions:order(user.role==='Custom'?user.permissions:presetPermissions(user.role))});

/** Choosing a preset role fills the boxes with that preset. Choosing Custom keeps whatever is ticked (minus admins.manage) and remembers the preset it came from. */
export function pickRole(form:PermissionForm,role:AdminRole):PermissionForm{
 if(role===form.role)return form;
 if(role==='Custom')return {role:'Custom',basedOn:form.role!=='Custom'?form.role:form.basedOn,permissions:customable(form.permissions)};
 return {role,basedOn:role,permissions:order(presetPermissions(role))};
}

export type ToggleResult={form:PermissionForm;note:string};
/**
 * Ticking or unticking a box by hand switches the role to Custom (remembering the preset). `admins.manage` can never be ticked this way.
 * `note` is a short plain-English sentence when a dependency changed another box as well, otherwise ''.
 */
export function toggle(form:PermissionForm,permission:Permission,on:boolean):ToggleResult{
 if(permission==='admins.manage')return {form,note:''};
 let next=customable(form.permissions).filter(p=>p!==permission),note='';
 if(on){
  next.push(permission);
  if(permission==='complaints.manage'&&!next.includes('complaints.read')){next.push('complaints.read');note='Handling complaints needs See complaints, so that was ticked too.';}
 }else if(permission==='complaints.read'&&next.includes('complaints.manage')){
  next=next.filter(p=>p!=='complaints.manage');note='Handling complaints needs See complaints, so that was unticked too.';
 }
 return {form:{role:'Custom',basedOn:form.role!=='Custom'?form.role:form.basedOn,permissions:order(next)},note};
}

/** Restores the default set from the Add form. */
export const resetToDefaults=defaultForm;
/** Something the server would refuse, in plain English, or ''. `shown` limits the count to the permissions the form actually offers (a preset can hold ones the portal no longer shows, such as the log pages). */
export function problem(form:PermissionForm,shown?:readonly Permission[]):string{return form.permissions.some(p=>!shown||shown.includes(p))?'':'Choose at least one permission';}
/** The role and permissions to send: a preset role sends its name alone, Custom sends the ticked boxes. */
export const payload=(form:PermissionForm):{role:AdminRole;permissions:Permission[]}=>({role:form.role,permissions:form.role==='Custom'?form.permissions:[]});
