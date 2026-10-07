import {permissions,rolePresets,type Permission,type AdminRole,type Viewer} from '../shared/access';
import {ServiceError} from './service';
export function requireAction(viewer:Viewer,permission:Permission){if(viewer.role==='Resident'||!viewer.permissions.includes(permission))throw new ServiceError('Your role does not have permission for this action.',403);}
export function validateAdminGrant(viewer:Viewer,ownerEmail:string,input:any){
 requireAction(viewer,'admins.manage');if(viewer.role!=='Super Admin')throw new ServiceError('Only a Super Admin can grant administrator access.',403);
 const email=typeof input?.email==='string'?input.email.trim().toLowerCase():'';
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>180)throw new ServiceError('Enter a valid administrator email.');
 if(!Object.prototype.hasOwnProperty.call(rolePresets,input.role)||typeof input.active!=='boolean')throw new ServiceError('Select a role and access status.');
 if(email===ownerEmail)throw new ServiceError('The founding Super Admin cannot be disabled or downgraded.');
 if(email===viewer.email)throw new ServiceError('Another Super Admin must change your own access.');
 return {email,role:input.role as AdminRole,permissions:grantedPermissions(input.role,input.permissions),active:input.active as boolean};
}
/**
 * The permission list a role may be given: a preset's own list, or the explicit list for 'Custom'. Shared by the legacy email grants above and the
 * administrator accounts (lib/admin-policy.ts). `admins.manage` belongs to Super Admin only, and managing complaints needs reading them.
 */
export function grantedPermissions(role:unknown,requested:unknown):Permission[]{
 if(typeof role!=='string'||!Object.prototype.hasOwnProperty.call(rolePresets,role))throw new ServiceError('Select a role and access status.');
 const allowed:Permission[]=role==='Custom'?requested as Permission[]:[...rolePresets[role as AdminRole]];
 if(!Array.isArray(allowed)||allowed.some(p=>!permissions.includes(p)))throw new ServiceError('Invalid permissions.');
 if(role!=='Super Admin'&&allowed.includes('admins.manage'))throw new ServiceError('Access management is reserved for Super Admins.');
 if(allowed.includes('complaints.manage')&&!allowed.includes('complaints.read'))throw new ServiceError('Managing complaints also requires permission to read them.');
 return [...new Set(allowed)];
}
