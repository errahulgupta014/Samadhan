import type {Ward, PublicWard, ResidentProfile} from '../shared/community';

/** Pure ward helpers (no I/O) so validation and sorting are unit tested. */
type WardState = {wards?: Ward[]; residentProfiles?: Record<string, ResidentProfile>};

/** Contract: `memberPhotoUrl` is `/api/wards/photo?id=<wardId>` or null when the ward has no photo. Never expose the media id. */
export function toPublicWard(w: Ward): PublicWard {
 return {id: w.id, number: w.number, name: w.name, nameHi: w.nameHi || w.name, city: w.city, memberName: w.memberName, memberNameHi: w.memberNameHi || w.memberName, memberPhotoUrl: w.memberPhotoId ? `/api/wards/photo?id=${encodeURIComponent(w.id)}` : null};
}

/** Numeric ward number first (12 before 100), then the text of the number, then the name. Non-numeric numbers sort after numeric ones. */
export function compareWards(a: Pick<Ward, 'number' | 'name'>, b: Pick<Ward, 'number' | 'name'>): number {
 const na = parseInt(a.number, 10), nb = parseInt(b.number, 10);
 const fa = Number.isFinite(na), fb = Number.isFinite(nb);
 if (fa !== fb) return fa ? -1 : 1;
 if (fa && fb && na !== nb) return na - nb;
 return a.number.localeCompare(b.number) || a.name.localeCompare(b.name);
}

/** Wards residents can register into, sorted for the picker. */
export function activePublicWards(wards: Ward[] | undefined): PublicWard[] {
 return [...(wards ?? [])].filter(w => w.active).sort(compareWards).map(toPublicWard);
}

/** The resident's own ward (kept visible even if an admin later deactivates it). */
export function wardOfProfile(state: WardState, profile: Pick<ResidentProfile, 'wardId'>): PublicWard | null {
 const ward = profile.wardId ? state.wards?.find(w => w.id === profile.wardId) : undefined;
 return ward ? toPublicWard(ward) : null;
}

const CONTROL = /[\u0000-\u001f\u007f]/;
function text(label: string, v: unknown, min: number, max: number): string {
 if (typeof v !== 'string') throw new Error(`${label}: enter text.`);
 const value = v.replace(/\s+/g, ' ').trim();
 if (CONTROL.test(value) || value.length < min || value.length > max) throw new Error(min ? `${label}: enter ${min}–${max} characters.` : `${label}: use at most ${max} characters.`);
 return value;
}
export const MAX_WARDS = 100;

/**
 * Validates an admin ward form and returns the ward to store. `memberPhotoId` is only checked for shape here: the API layer verifies the media
 * exists in this workspace and was uploaded by the admin (or is already this ward's photo) before the action runs.
 * Omitting memberPhotoId keeps the current photo; sending '' removes it.
 */
export function validateWard(input: any, wards: Ward[]): Ward {
 if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Enter ward details.');
 let current: Ward | undefined;
 if (input.id !== undefined && input.id !== null && input.id !== '') {
  if (typeof input.id !== 'string') throw new Error('Invalid ward.');
  current = wards.find(w => w.id === input.id);
  if (!current) throw new Error('Ward not found.');
 } else if (wards.length >= MAX_WARDS) throw new Error(`You can configure at most ${MAX_WARDS} wards.`);
 const number = text('Ward number', input.number, 1, 10);
 if (!/^[0-9A-Za-z][0-9A-Za-z \-]*$/.test(number)) throw new Error('Ward number: use letters, digits, spaces or hyphens.');
 if (wards.some(w => w.id !== current?.id && w.number.toLowerCase() === number.toLowerCase())) throw new Error('A ward with this number already exists.');
 if (typeof input.active !== 'boolean') throw new Error('Choose whether the ward is active.');
 let memberPhotoId = current?.memberPhotoId ?? '';
 if (input.memberPhotoId !== undefined && input.memberPhotoId !== null) {
  if (typeof input.memberPhotoId !== 'string' || input.memberPhotoId.length > 100 || CONTROL.test(input.memberPhotoId)) throw new Error('Invalid member photo.');
  memberPhotoId = input.memberPhotoId.trim();
 }
 return {id: current?.id ?? crypto.randomUUID(), number, name: text('Ward name', input.name, 2, 80), nameHi: text('Ward name (Hindi)', input.nameHi ?? '', 0, 80), city: text('City', input.city, 2, 80), memberName: text('Ward member name', input.memberName ?? '', 0, 80), memberNameHi: text('Ward member name (Hindi)', input.memberNameHi ?? '', 0, 80), memberPhotoId, active: input.active};
}

/** Adds or replaces a ward. Returns the stored ward. */
export function saveWard(state: WardState, input: any): Ward {
 state.wards ??= [];
 const ward = validateWard(input, state.wards);
 const index = state.wards.findIndex(w => w.id === ward.id);
 if (index >= 0) state.wards[index] = ward; else state.wards.push(ward);
 return ward;
}

/** Residents reference wards by id, so a ward that any resident belongs to is deactivated instead of removed. */
export function deleteWard(state: WardState, id: unknown): {id: string; deactivated: boolean; deleted: boolean} {
 if (typeof id !== 'string' || !id) throw new Error('Choose a ward.');
 const wards = state.wards ??= [];
 const ward = wards.find(w => w.id === id);
 if (!ward) throw new Error('Ward not found.');
 if (Object.values(state.residentProfiles ?? {}).some(p => p.wardId === id)) {ward.active = false; return {id, deactivated: true, deleted: false};}
 wards.splice(wards.indexOf(ward), 1);
 return {id, deactivated: false, deleted: true};
}
