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
 const allowed:Permission[]=input.role==='Custom'?input.permissions:[...rolePresets[input.role as AdminRole]];
 if(!Array.isArray(allowed)||allowed.some(p=>!permissions.includes(p)))throw new ServiceError('Invalid permissions.');
 if(input.role!=='Super Admin'&&allowed.includes('admins.manage'))throw new ServiceError('Access management is reserved for Super Admins.');
 if(allowed.includes('complaints.manage')&&!allowed.includes('complaints.read'))throw new ServiceError('Managing complaints also requires permission to read them.');
 return {email,role:input.role as AdminRole,permissions:[...new Set(allowed)],active:input.active as boolean};
}
