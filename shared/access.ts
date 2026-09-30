export const permissions = ['complaints.read','complaints.manage','categories.manage','announcements.manage','classifieds.manage','city.manage','communications.read','audit.read','settings.manage','admins.manage'] as const;
export type Permission = typeof permissions[number];
export const rolePresets = {
 'Super Admin': [...permissions],
 'Ward Admin': permissions.filter(p=>p!=='admins.manage'),
 'Complaint Officer': ['complaints.read','complaints.manage','communications.read'],
 'Content Editor': ['announcements.manage','classifieds.manage','city.manage'],
 'Auditor': ['complaints.read','communications.read','audit.read'],
 'Custom': [],
} satisfies Record<string,readonly Permission[]>;
export type AdminRole=keyof typeof rolePresets;
export type Viewer={role:AdminRole|'Resident';permissions:Permission[];email?:string;isOwner?:boolean};
export const actionPermissions:Record<string,Permission>={transition:'complaints.manage',edit:'complaints.manage','save-category':'categories.manage',announcement:'announcements.manage',settings:'settings.manage','save-classified':'classifieds.manage','publish-classified':'classifieds.manage','save-municipality':'city.manage','save-place':'city.manage','save-admin':'admins.manage'};
export function can(viewer:Viewer,permission:Permission){return viewer.permissions.includes(permission);}
