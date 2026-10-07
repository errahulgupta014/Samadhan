import assert from 'node:assert/strict';
import {base, png, ownerCookie, registerResident, ensureWard} from './api-helpers.mjs';
const cookie = await ownerCookie();
let version, data;
async function api(body, token) {
 const res = await fetch(base + '/api/workspace', {method: body ? 'POST' : 'GET', headers: {...(token ? {Authorization: `Bearer ${token}`} : {cookie}), 'Content-Type': 'application/json'}, ...(body ? {body: JSON.stringify({...body, version})} : {})});
 const j = await res.json(); if (j.version) {version = j.version; data = j.data;} return {res, j};
}
assert.equal((await fetch(base + '/api/workspace')).status, 401);
assert.equal((await api()).res.status, 200);
// Residents sign in with a mobile number and OTP (test OTP mode); the complaint belongs to that real resident.
const {token} = await registerResident('QA Smoke');
const upload = async headers => {const form = new FormData(); form.append('file', new Blob([Uint8Array.from(png)], {type: 'image/png'}), 'test-evidence.png'); const r = await fetch(base + '/api/media', {method: 'POST', headers, body: form}); assert.equal(r.status, 200); return (await r.json()).id;};
const media = await upload({Authorization: `Bearer ${token}`}), adminMedia = await upload({cookie});
await api(undefined, token);
const noPhoto = await api({action: 'create', category: 'Road & Footpath', title: 'QA: no evidence', description: 'Automated test complaint without a photograph.', locality: 'QA locality', lat: 26.91, lng: 75.78, media: [], consent: true}, token); assert.equal(noPhoto.res.status, 400);
let result = await api({action: 'create', view: 'resident', category: 'Road & Footpath', title: 'QA: sample pathway issue', description: 'Automated test complaint using a synthetic 1-pixel evidence image.', locality: 'QA locality', lat: 26.91, lng: 75.78, media: [media], consent: true}, token); assert.equal(result.res.status, 200, JSON.stringify(result.j)); const id = result.j.id;
assert.equal(data.complaints.length, 1, 'a resident sees only their own complaint'); assert.equal(data.complaints[0].residentId, data.profile.id);
await api();
const mine = data.complaints.find(c => c.id === id); assert.ok(mine, 'the admin sees the complaint'); assert.match(mine.resident, /^QA Smoke /); assert.match(mine.mobile, /^[6-9]\d{9}$/);
assert.equal((await api({action: 'create', view: 'resident', category: 'Road & Footpath', title: 'QA: owner cannot report', description: 'The owner has no resident profile.', locality: 'QA locality', lat: 26.91, lng: 75.78, media: [adminMedia], consent: true})).res.status, 403);
assert.equal((await api({action: 'transition', id, status: 'Acknowledged', note: 'Acknowledged by automated test.'})).res.status, 200);
// Complaint numbers are JSS/<yy>/W<ward>/<n>: the number of the resident's ward (whichever ward this workspace has), the Indian two-digit year, and a counter per ward and year.
const qaWard = await ensureWard(), wardPart = qaWard.number.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8), yy = String(new Date(Date.now() + 19800000).getUTCFullYear() % 100).padStart(2, '0');
assert.match(id, new RegExp('^JSS/' + yy + '/W' + wardPart + '/[1-9][0-9]*$'), 'the number carries the ward number of the resident ward');
assert.equal(mine.wardId, qaWard.id, 'the complaint stores the ward the resident reported from'); assert.ok(mine.wardLabel.includes(qaWard.number), 'the admin read carries the computed ward label'); assert.equal(new Set(data.complaints.map(c => c.id)).size, data.complaints.length, 'numbers are unique');
result = await api({action: 'create', view: 'resident', category: 'Road & Footpath', title: 'QA: second pathway issue', description: 'Second automated complaint from the same ward.', locality: 'QA locality', lat: 26.91, lng: 75.78, media: [media], consent: true}, token); assert.equal(result.res.status, 200, JSON.stringify(result.j));
const numberOf = value => Number(value.split('/').pop()); assert.equal(result.j.id.slice(0, result.j.id.lastIndexOf('/')), id.slice(0, id.lastIndexOf('/')), 'same ward and year'); assert.ok(numberOf(result.j.id) > numberOf(id), 'the next complaint in the ward gets a higher number');
await api();
// Teams: the list comes from settings.teams; the assignee dropdown follows it; renaming or removing a team does not rewrite assigned complaints. The original list is restored.
const originalTeams = data.settings.teams; assert.ok(Array.isArray(originalTeams) && originalTeams.length >= 1, 'admins receive the team list'); const qaTeam = 'QA Team ' + Date.now().toString(36);
for (const bad of [[], 'x', ['A'], ['Same team', 'same team'], Array.from({length: 13}, (_, i) => 'Team number ' + i), [originalTeams[0], 'x'.repeat(61)]]) assert.equal((await api({action: 'save-teams', teams: bad})).res.status, 400, JSON.stringify(bad).slice(0, 50));
assert.equal((await api({action: 'save-teams', teams: [...originalTeams, qaTeam]}, token)).res.status, 403, 'residents cannot edit teams');
assert.equal((await api({action: 'save-teams', teams: [...originalTeams, '  ' + qaTeam.replace(' ', '   ') + ' ']})).res.status, 200); assert.deepEqual(data.settings.teams, [...originalTeams, qaTeam], 'names are trimmed and whitespace is collapsed');
assert.equal((await api({action: 'edit', id, assignee: qaTeam})).res.status, 200); assert.equal((await api({action: 'edit', id, assignee: 'Not a listed team'})).res.status, 400);
assert.equal((await api({action: 'save-teams', teams: originalTeams})).res.status, 200); assert.equal(data.complaints.find(c => c.id === id).assignee, qaTeam, 'removing a team leaves assigned complaints untouched');
assert.equal((await api({action: 'edit', id, assignee: qaTeam})).res.status, 400, 'a removed team can no longer be assigned');
await api(undefined, token); assert.equal('teams' in data.settings, false, 'residents never receive the team list'); await api();
assert.equal((await api({action: 'edit', id, assignee: 'Roads & Infrastructure'})).res.status, 200);
assert.equal((await api({action: 'transition', id, status: 'Assigned', note: 'Assigned for test work.'})).res.status, 200);
assert.equal((await api({action: 'transition', id, status: 'In Progress', note: 'Test work commenced.'})).res.status, 200);
assert.equal((await api({action: 'transition', id, status: 'Resolution Proposed', note: 'Resolution without evidence must fail.'})).res.status, 400);
assert.equal((await api({action: 'edit', id, afterMedia: [adminMedia]})).res.status, 200);
assert.equal((await api({action: 'transition', id, status: 'Resolution Proposed', note: 'Test repair completed with evidence.'})).res.status, 200);
assert.equal((await api({action: 'edit', id, priority: 'High'}, token)).res.status, 403);
const code = (await api({action: 'preview-closure-code', id}, token)).j.demoCode; assert.match(code, /^\d{6}$/);
assert.equal((await api({action: 'verify-closure', id, code: 'wrong'}, token)).res.status, 400);
assert.equal((await api({action: 'verify-closure', id, code}, token)).res.status, 200); assert.equal(data.complaints.find(c => c.id === id).status, 'Closed');
assert.equal((await api({action: 'verify-closure', id, code}, token)).res.status, 403);
assert.equal((await api({action: 'dispute', id, note: 'Reopened by the automated resident test.'}, token)).res.status, 200);
await api(); assert.equal(data.complaints.find(c => c.id === id).status, 'Reopened'); assert.ok(!('challenges' in data));
// Another resident cannot touch this complaint, even with a valid session of their own.
const other = await registerResident('QA Other'); await api(undefined, other.token); assert.equal(data.complaints.length, 0);
assert.equal((await api({action: 'dispute', id, note: 'Trying to reopen someone else’s complaint.'}, other.token)).res.status, 404);
const stale = await fetch(base + '/api/workspace', {method: 'POST', headers: {cookie, 'Content-Type': 'application/json'}, body: JSON.stringify({action: 'edit', id, priority: 'Low', version: 0})}); assert.equal(stale.status, 409);
console.log('PASS: unauthenticated rejection, OTP-registered resident, media upload, create → acknowledge → assign → progress → evidence → propose → wrong OTP → verify → replay denied → reopen; resident-owned complaints, JSS/<yy>/W<ward>/<n> complaint numbers (ward number, Indian year, per-ward counter, stored ward id), editable teams (validation, resident denial, assignee list, restore), cross-resident denial and stale-write conflict.');
