// Shared helpers for the API smoke tests that run against a running dev server (default http://localhost:5173) in TEST OTP MODE.
export const base = process.env.TEST_BASE_URL || 'http://localhost:5173';
export const TEST_OTP = process.env.TEST_OTP || '123456';
export const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jh2sAAAAASUVORK5CYII=', 'base64');

/** Establishes the local mock owner identity (and the platform owner row resident sign-in needs). Returns the cookie header value. */
export async function ownerCookie() {
 const login = await fetch(base + '/signin-with-chatgpt?return_to=/', {redirect: 'manual'});
 const cookie = login.headers.getSetCookie().map(v => v.split(';')[0]).join('; ');
 if (!cookie) throw new Error('Local sign-in must set the test cookie');
 return cookie;
}

const post = (body, token) => fetch(base + '/api/resident-auth', {method: 'POST', headers: {'Content-Type': 'application/json', ...(token ? {Authorization: `Bearer ${token}`} : {})}, body: JSON.stringify(body)});
const ok = async (res, label) => {const text = await res.text(); if (!res.ok) throw new Error(`${label} failed: ${res.status} ${text.slice(0, 200)}`); return JSON.parse(text);};
let counter = 0;
/** A fresh synthetic mobile number each call (never a real person's). */
export const freshMobile = () => '9' + String(Date.now() * 11 + (counter++) * 7919).slice(-9).padStart(9, '4');

/**
 * Signs a brand-new synthetic resident up through the real flow (send-otp, verify-otp, photo upload, register) and returns the session token.
 * `label` becomes part of the name so QA records are recognisable in the local workspace.
 */
export async function registerResident(label = 'QA Resident', wardId) {
 const mobile = freshMobile();
 await ok(await post({action: 'send-otp', mobile}), 'send-otp');
 const {token: registration, registered} = await ok(await post({action: 'verify-otp', mobile, code: TEST_OTP}), 'verify-otp');
 if (registered) throw new Error('Expected a new mobile number');
 const form = new FormData(); form.append('file', new Blob([png], {type: 'image/png'}), 'qa-resident.png');
 const {id: photoId} = await ok(await fetch(base + '/api/media', {method: 'POST', headers: {Authorization: `Bearer ${registration}`}, body: form}), 'photo upload');
 const {token} = await ok(await post({action: 'register', name: `${label} ${Date.now().toString(36)}`, wardId: wardId ?? (await ensureWard()).id, address: '1 Test Road, Jaipur', photoId, consent: true}, registration), 'register');
 return {token, mobile, photoId};
}

/** Posts one admin action (owner cookie) with the current workspace version. */
export async function adminAction(body) {
 const cookie = await ownerCookie();
 const {version} = await ok(await fetch(base + '/api/workspace', {headers: {cookie}}), 'workspace');
 return ok(await fetch(base + '/api/workspace', {method: 'POST', headers: {cookie, 'Content-Type': 'application/json'}, body: JSON.stringify({...body, version})}), 'admin ' + body.action);
}
let ensured = null;
/**
 * A ward residents can register in (the first public ward). A brand-new workspace has none, so one is then created through the admin API, the way an administrator would
 * (Settings, Wards), and removed again when the script ends (a ward that residents registered in is deactivated instead of removed, which hides it from sign-up).
 */
export async function ensureWard() {
 if (ensured) return ensured;
 const publicWards = async () => (await ok(await fetch(base + '/api/wards'), 'wards')).wards;
 let wards = await publicWards();
 if (!wards.length) {
  const nonce = Date.now().toString(36);
  const {wardId} = await adminAction({action: 'save-ward', ward: {number: 'Q' + nonce.slice(-5).toUpperCase(), name: 'QA Base Ward ' + nonce, nameHi: '', city: 'QA City', memberName: '', memberNameHi: '', active: true}});
  process.once('beforeExit', () => {adminAction({action: 'delete-ward', id: wardId}).catch(e => console.error('QA ward cleanup failed:', e.message));});
  wards = await publicWards();
 }
 return (ensured = wards[0]);
}
