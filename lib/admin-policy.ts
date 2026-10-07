import {permissions,rolePresets,type Permission,type AdminRole} from '../shared/access';
import {grantedPermissions} from './access-policy';
import {ServiceError} from './service';

/**
 * Pure rules for administrator accounts (no storage, no Workers APIs): username/name/email/password validation, who may manage whom,
 * and the protections that keep the portal reachable (nobody deletes, disables or downgrades themselves; the last active Super Admin is untouchable).
 * Storage and sessions live in lib/admin-auth-core.ts; the D1 layer is lib/admin-store.ts.
 */
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;
export const USERNAME_PATTERN = /^[A-Za-z0-9._-]{3,32}$/;
const COMMON_PASSWORDS = new Set(['password', 'password1', 'password123', '12345678', '123456789', '1234567890', 'qwertyui', 'qwerty123', 'abcd1234', 'admin123', 'admin1234', 'administrator', 'samadhan', 'samadhan123', 'letmein123', 'iloveyou']);

export type AdminUserRecord = {
 id: string; owner: string; username: string; name: string; email: string | null; avatarMediaId?: string | null;
 role: AdminRole; permissions: Permission[]; active: boolean;
 mustChangePassword: boolean; isDefaultPassword: boolean;
 passwordHash: string; salt: string; iterations: number;
 createdAt: string; updatedAt: string; lastLoginAt: string | null;
};
/** What the API and the portal ever see of an account. Never a hash. `permissions` is the effective list. */
export type AdminUserView = {
 id: string; username: string; name: string; email: string | null; avatarMediaId: string | null; role: AdminRole; permissions: Permission[]; active: boolean;
 isDefaultPassword: boolean; mustChangePassword: boolean; createdAt: string; lastLoginAt: string | null;
};
export type AdminActor = Pick<AdminUserRecord, 'id' | 'role' | 'permissions' | 'username'>;

/** Preset roles always take their current preset (so a permission added later reaches existing Super Admins); Custom uses its stored list. */
export function effectivePermissions(role: AdminRole, stored: readonly string[]): Permission[] {
 if (role !== 'Custom') return [...(rolePresets[role] ?? [])];
 return (stored as Permission[]).filter((p, i, all) => permissions.includes(p) && p !== 'admins.manage' && all.indexOf(p) === i);
}
export function toAdminView(user: AdminUserRecord): AdminUserView {
 return {id: user.id, username: user.username, name: user.name, email: user.email, avatarMediaId: user.avatarMediaId ?? null, role: user.role, permissions: effectivePermissions(user.role, user.permissions), active: user.active,
  isDefaultPassword: user.isDefaultPassword, mustChangePassword: user.mustChangePassword, createdAt: user.createdAt, lastLoginAt: user.lastLoginAt};
}

export function normalizeUsername(raw: unknown): string {
 const value = typeof raw === 'string' ? raw.trim() : '';
 if (!USERNAME_PATTERN.test(value)) throw new ServiceError('Username must be 3 to 32 characters: letters, numbers, dot, dash or underscore.');
 return value;
}
export const usernameKey = (username: string) => username.trim().toLowerCase();
export function normalizeName(raw: unknown): string {
 const value = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
 if (value.length < 2 || value.length > 80) throw new ServiceError('Enter the person’s name (2 to 80 characters).');
 return value;
}
export function normalizeEmail(raw: unknown): string | null {
 if (raw === undefined || raw === null || raw === '') return null;
 const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
 if (!value) return null;
 if (value.length > 180 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new ServiceError('Enter a valid email address, or leave it empty.');
 return value;
}

/** Password policy for every password except the built-in bootstrap one: 8 to 128 characters, not the username, not the current password, not a trivial one. */
export function validatePassword(password: unknown, context: {username: string; current?: string}): string {
 if (typeof password !== 'string' || !password) throw new ServiceError('Enter a password.');
 if (password.length < MIN_PASSWORD_LENGTH) throw new ServiceError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
 if (password.length > MAX_PASSWORD_LENGTH) throw new ServiceError(`Password must be ${MAX_PASSWORD_LENGTH} characters or fewer.`);
 if (!password.trim()) throw new ServiceError('Password cannot be only spaces.');
 const lower = password.normalize('NFKC').toLowerCase();
 if (lower === context.username.normalize('NFKC').toLowerCase()) throw new ServiceError('Password cannot be the same as the username.');
 if (context.current !== undefined && password === context.current) throw new ServiceError('Choose a password different from the current one.');
 if (COMMON_PASSWORDS.has(lower)) throw new ServiceError('That password is too easy to guess. Choose a different one.');
 return password;
}

/** Only an active Super Admin holding admins.manage may manage accounts. */
export function requireUserAdmin(actor: Pick<AdminActor, 'role' | 'permissions'>) {
 if (!effectivePermissions(actor.role, actor.permissions).includes('admins.manage')) throw new ServiceError('Your role does not have permission for this action.', 403);
 if (actor.role !== 'Super Admin') throw new ServiceError('Only a Super Admin can manage administrator accounts.', 403);
}

export const LAST_SUPER_ADMIN_MESSAGE = 'The last active Super Admin cannot be deleted, disabled or downgraded.';
const SELF_MESSAGE = 'Another Super Admin must change your own role, permissions or status.';
const isActiveSuperAdmin = (u: Pick<AdminUserRecord, 'role' | 'active'>) => u.role === 'Super Admin' && u.active;
const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every(p => b.includes(p));

export type NewUserPlan = {username: string; name: string; email: string | null; role: AdminRole; permissions: Permission[]; password: string; mustChangePassword: boolean};
export function planCreateUser(actor: AdminActor, input: any): NewUserPlan {
 requireUserAdmin(actor);
 const username = normalizeUsername(input?.username);
 const role = input?.role as AdminRole;
 const granted = grantedPermissions(role, input?.permissions);
 if (role === 'Custom' && !granted.length) throw new ServiceError('Choose at least one permission for a Custom role.');
 return {username, name: normalizeName(input?.name), email: normalizeEmail(input?.email), role, permissions: granted,
  password: validatePassword(input?.password, {username}), mustChangePassword: input?.mustChangePassword === undefined ? true : input.mustChangePassword === true};
}

export type UserUpdatePlan = {name: string; email: string | null; role: AdminRole; permissions: Permission[]; active: boolean; accessChanged: boolean; removesSuperAdmin: boolean};
/** `otherActiveSuperAdmins` counts active Super Admins other than `target`. */
export function planUpdateUser(actor: AdminActor, target: AdminUserRecord, input: any, otherActiveSuperAdmins: number): UserUpdatePlan {
 requireUserAdmin(actor);
 if (typeof input?.active !== 'boolean') throw new ServiceError('Select a role and access status.');
 const role = input?.role as AdminRole;
 const granted = grantedPermissions(role, input?.permissions);
 if (role === 'Custom' && !granted.length) throw new ServiceError('Choose at least one permission for a Custom role.');
 const nextEffective = effectivePermissions(role, granted);
 const rolePermissionsChanged = role !== target.role || !sameSet(effectivePermissions(target.role, target.permissions), nextEffective);
 if (target.id === actor.id && (rolePermissionsChanged || input.active !== target.active)) throw new ServiceError(SELF_MESSAGE, 409);
 const removesSuperAdmin = isActiveSuperAdmin(target) && !(role === 'Super Admin' && input.active);
 if (removesSuperAdmin && otherActiveSuperAdmins < 1) throw new ServiceError(LAST_SUPER_ADMIN_MESSAGE, 409);
 return {name: normalizeName(input?.name), email: normalizeEmail(input?.email), role, permissions: role === 'Custom' ? granted : [...rolePresets[role]], active: input.active,
  accessChanged: rolePermissionsChanged || (target.active && !input.active), removesSuperAdmin};
}

export function planDeleteUser(actor: AdminActor, target: AdminUserRecord, otherActiveSuperAdmins: number) {
 requireUserAdmin(actor);
 if (target.id === actor.id) throw new ServiceError('You cannot delete your own account.', 409);
 const removesSuperAdmin = isActiveSuperAdmin(target);
 if (removesSuperAdmin && otherActiveSuperAdmins < 1) throw new ServiceError(LAST_SUPER_ADMIN_MESSAGE, 409);
 return {removesSuperAdmin};
}

export function planResetPassword(actor: AdminActor, target: AdminUserRecord, input: any) {
 requireUserAdmin(actor);
 if (target.id === actor.id) throw new ServiceError('Use “Change password” for your own account.', 409);
 return {password: validatePassword(input?.newPassword, {username: target.username}), mustChangePassword: input?.mustChangePassword === undefined ? true : input.mustChangePassword === true};
}

/** One plain sentence describing what changed, for the audit log. */
export function describeUserChange(target: AdminUserRecord, plan: UserUpdatePlan): string {
 const parts: string[] = [];
 if (plan.role !== target.role) parts.push(`role ${target.role} → ${plan.role}`);
 else if (!sameSet(effectivePermissions(target.role, target.permissions), plan.permissions)) parts.push(`permissions changed (${plan.permissions.length} allowed)`);
 if (plan.active !== target.active) parts.push(plan.active ? 'account enabled' : 'account disabled');
 if (plan.name !== target.name) parts.push('name changed');
 if (plan.email !== target.email) parts.push('email changed');
 return parts.length ? `Updated: ${parts.join(', ')}` : 'Saved with no changes';
}
