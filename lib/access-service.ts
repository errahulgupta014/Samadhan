import {validateAdminGrant} from './access-policy';
import {database,requirePermission,type Principal} from './server';
import {ServiceError} from './service';
import {permissions,rolePresets,type Permission,type AdminRole} from '@/shared/access';
/** Legacy platform-identity grants (admin_access, by sign-in email). Read-only in the portal now that administrators sign in with accounts (lib/admin-auth.ts); the audit line is plain text, never raw JSON. */
const grantSummary=(grant:{role:string;active:boolean;permissions:string[]})=>`Access set to ${grant.role} (${grant.active?'account active':'account disabled'}) with ${grant.permissions.length} permissions`;
export async function listAdmins(who:Principal){requirePermission(who,'admins.manage');const {results}=await database().prepare('SELECT email,role,permissions,active,updated_at FROM admin_access WHERE owner = ? ORDER BY email').bind(who.owner).all<{email:string;role:AdminRole;permissions:string;active:number;updated_at:string}>();return results.map(row=>({...row,permissions:JSON.parse(row.permissions),active:!!row.active}));}
export async function saveAdmin(who:Principal,input:any){
 requirePermission(who,'admins.manage');if(who.viewer.role!=='Super Admin')throw new ServiceError('Only a Super Admin can grant administrator access.',403);
 const root=await database().prepare('SELECT email FROM platform_owner WHERE id = ?').bind('main').first<{email:string}>();
 const grant=validateAdminGrant(who.viewer,root!.email,input);const {email,role,permissions:allowed,active}=grant;const at=new Date().toISOString();
 await database().batch([database().prepare('INSERT INTO admin_access (email,owner,role,permissions,active,updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(email) DO UPDATE SET role=excluded.role, permissions=excluded.permissions, active=excluded.active, updated_at=excluded.updated_at WHERE admin_access.owner=excluded.owner').bind(email,who.owner,role,JSON.stringify(allowed),active?1:0,at),database().prepare('INSERT INTO admin_access_events (id,owner,actor,subject,detail,created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(),who.owner,who.viewer.email??who.userId,email,grantSummary(grant),at)]);
}
