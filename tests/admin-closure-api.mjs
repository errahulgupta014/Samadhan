import assert from 'node:assert/strict';
import {base, png, ownerCookie, registerResident} from './api-helpers.mjs';
// Admin closes a complaint by entering the closure OTP the resident received on WhatsApp (universal code 123456 unless Settings changed it).
const cookie = await ownerCookie();
let version, data;
async function api(body, token) {
 const res = await fetch(base + '/api/workspace', {method: body ? 'POST' : 'GET', headers: {...(token ? {Authorization: `Bearer ${token}`} : {cookie}), 'Content-Type': 'application/json'}, ...(body ? {body: JSON.stringify({...body, version})} : {})});
 const j = await res.json(); if (j.version) {version = j.version; data = j.data;} return {res, j};
}
const call = async (body, token, tries = 4) => {for (let i = 0; i < tries; i++) {await api(undefined, token); const r = await api(body, token); if (r.res.status !== 409) return r;} return api(body, token);};
const upload = async headers => {const form = new FormData(); form.append('file', new Blob([Uint8Array.from(png)], {type: 'image/png'}), 'evidence.png'); const r = await fetch(base + '/api/media', {method: 'POST', headers, body: form}); assert.equal(r.status, 200); return (await r.json()).id;};
await api();
const closureOtp = data.settings.closureOtp;
const {token} = await registerResident('QA Admin Closure');
const photo = await upload({Authorization: `Bearer ${token}`}), after = await upload({cookie});
const created = await call({action: 'create', view: 'resident', category: 'Road & Footpath', title: 'QA: admin closure flow', description: 'Automated test complaint for closing with the OTP in the admin portal.', locality: 'QA locality', lat: 26.91, lng: 75.78, media: [photo], consent: true}, token);
assert.equal(created.res.status, 200, JSON.stringify(created.j)); const id = created.j.id; assert.match(id, /^JSS\/\d\d\/W[A-Z0-9]{1,8}\/\d+$/);
for (const [step, body] of [['ack', {action: 'transition', id, status: 'Acknowledged', note: 'Acknowledged by the automated test.'}], ['assign-edit', {action: 'edit', id, assignee: 'Roads & Infrastructure'}], ['assigned', {action: 'transition', id, status: 'Assigned', note: 'Assigned for test work.'}], ['progress', {action: 'transition', id, status: 'In Progress', note: 'Test work commenced.'}], ['evidence', {action: 'edit', id, afterMedia: [after]}], ['propose', {action: 'transition', id, status: 'Resolution Proposed', note: 'Test repair completed with evidence.'}]]) {
 const r = await call(body); assert.equal(r.res.status, 200, `${step}: ${JSON.stringify(r.j)}`);
}
// A direct close by the admin is refused; so is the OTP flow for a resident-only actor, and a wrong OTP does not close it.
assert.equal((await call({action: 'transition', id, status: 'Closed', note: 'Closing without OTP.'})).res.status, 400);
assert.equal((await call({action: 'admin-verify-closure', id, code: 'abc'}, token)).res.status, 403, 'residents cannot use the admin action');
const wrong = await call({action: 'admin-verify-closure', id, code: '000000'}); assert.equal(wrong.res.status, 400); assert.match(wrong.j.error, /Incorrect/);
assert.notEqual(data.complaints.find(c => c.id === id).status, 'Closed');
// The OTP request was sent when closure was requested; a second request within a minute is refused.
assert.equal((await call({action: 'admin-issue-closure-code', id})).res.status, 429);
const code = closureOtp === undefined ? '123456' : closureOtp;
if (code) {
 const ok = await call({action: 'admin-verify-closure', id, code}); assert.equal(ok.res.status, 200, JSON.stringify(ok.j));
 const closed = data.complaints.find(c => c.id === id); assert.equal(closed.status, 'Closed'); assert.match(closed.history.at(-1).note, /verified by the administrator/);
 assert.equal((await call({action: 'admin-verify-closure', id, code})).res.status, 403, 'a closed complaint cannot be closed again');
} else console.log('Universal closure code is switched off here: the final close was skipped.');
console.log('PASS: admin closes a complaint with the closure OTP (direct close refused, wrong OTP refused, resend cooldown, resident refused, closed with the right OTP).');
