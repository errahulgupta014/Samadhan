import type {Ward} from '../shared/community';
import {compareWards} from './wards';

/**
 * Pure ward helpers for complaints (no I/O, no server imports), shared by the server projection and the admin portal's ward filter.
 *
 * A complaint stores `wardId` when it is created (the resident's ward at that moment). Complaints filed before that field existed derive their ward
 * from the resident's profile when it is available; otherwise they have no ward (blank). The ward's display label is computed whenever the workspace is read
 * and is never stored, so renaming a ward is reflected everywhere at once.
 */

/** "Ward 7" for a ward named "Ward 7" (number 7), otherwise "Ward <number> · <name>". */
export function wardLabelOf(ward?: Pick<Ward, 'number' | 'name'>) {
 if (!ward) return '';
 const number = ward.number.trim(), name = ward.name.trim();
 return name.toLowerCase().split(/[^0-9a-z]+/).includes(number.toLowerCase()) ? name : `Ward ${number} · ${name}`;
}

type WardState = {wards?: Ward[]; residentProfiles?: Record<string, {wardId?: string}>};
const hasOwn = (o: object | undefined, key: string) => !!o && Object.prototype.hasOwnProperty.call(o, key);

/**
 * The ward record a complaint belongs to: its stored ward when that ward still exists, otherwise (only for complaints that never stored one)
 * the resident's current profile ward. A stored ward that has since been removed leaves the complaint without a ward rather than guessing.
 */
export function complaintWardOf(state: WardState, c: {wardId?: string; residentId?: string}): Ward | undefined {
 const wards = state.wards ?? [];
 if (c.wardId) return wards.find(w => w.id === c.wardId);
 const profileWardId = c.residentId && hasOwn(state.residentProfiles, c.residentId) ? state.residentProfiles![c.residentId]?.wardId : undefined;
 return profileWardId ? wards.find(w => w.id === profileWardId) : undefined;
}

/** Complaints as an administrator reads them: `wardId` resolved (blank when unknown) and the computed `wardLabel`. The input records are not modified. */
export function withWardInfo<T extends {wardId?: string; residentId?: string}>(complaints: T[], state: WardState): (T & {wardId: string; wardLabel: string})[] {
 return complaints.map(c => {const ward = complaintWardOf(state, c); return {...c, wardId: ward?.id ?? '', wardLabel: ward ? wardLabelOf(ward) : ''};});
}

/* ---- Admin ward filter (Overview and Complaints) ---- */

export const ALL_WARDS = 'all';
export const NO_WARD = 'none';
export type WardOption = {value: string; label: string};

/** The filter only makes sense once there is a choice between wards: hidden for none or one. */
export const showWardFilter = (wards: Pick<Ward, 'id'>[] | undefined) => (wards?.length ?? 0) >= 2;

/**
 * Filter choices: All wards, then every ward (active and inactive, numeric order; inactive ones are marked), then "No ward recorded" only when some complaint has no ward.
 */
export function wardFilterOptions(wards: Pick<Ward, 'id' | 'number' | 'name' | 'active'>[] | undefined, complaints: {wardId?: string}[] = []): WardOption[] {
 const list = [...(wards ?? [])].sort(compareWards).map(w => ({value: w.id, label: wardLabelOf(w) + (w.active === false ? ' (inactive)' : '')}));
 const unknown = list.length > 0 && complaints.some(c => !c.wardId);
 return [{value: ALL_WARDS, label: 'All wards'}, ...list, ...(unknown ? [{value: NO_WARD, label: 'No ward recorded'}] : [])];
}

/** A stored filter value that no longer matches an option (the ward was removed) means All wards. */
export const resolveWardFilter = (value: string, options: WardOption[]) => options.some(o => o.value === value) ? value : ALL_WARDS;

/** Items whose `wardId` matches the chosen filter value (a ward id, NO_WARD for items without a ward, ALL_WARDS or anything unknown for everything). Order is kept. */
export function filterByWard<T extends {wardId?: string}>(items: T[], value: string | undefined): T[] {
 if (!value || value === ALL_WARDS) return items;
 if (value === NO_WARD) return items.filter(c => !c.wardId);
 return items.filter(c => c.wardId === value);
}
