// API smoke test for departments against a running dev server (default http://localhost:5173) in TEST OTP MODE.
// Creates one QA complaint and one QA department; the department is removed again and the original department list is restored.
import assert from 'node:assert/strict';
import {base, png, ownerCookie, registerResident, ensureWard} from './api-helpers.mjs';
const cookie = await ownerCookie();
let version, data;
/** One request as the admin (cookie) or as a resident (bearer token). A POST first reads the workspace so its version is current. */
async function api(body, token) {
 const headers = {...(token ? {Authorization: `Bearer ${token}`} : {cookie}), 'Content-Type': 'application/json'};
 if (body) {const fresh = await (await fetch(base + '/api/workspace', {headers})).json(); version = fresh.version;}
 const res = await fetch(base + '/api/workspace', {method: body ? 'POST' : 'GET', headers, ...(body ? {body: JSON.stringify({...body, version})} : {})});
 const j = await res.json(); if (j.version) {version = j.version; data = j.data;} return {res, j};
}
const nonce = Date.now().toString(36), qaName = 'QA Department ' + nonce, qaPhone = '98765 00099';
const {token, mobile} = await registerResident('QA Dept');

// Admins receive the departments (derived from the team list until saved); residents never do.
await api(); const original = data.settings.departments; const originalTeams = data.settings.teams;
assert.ok(Array.isArray(original) && original.length >= 1 && original.every(d => d.id && d.name && typeof d.active === 'boolean' && 'contactName' in d && 'contactPhone' in d), 'admins receive the departments');
assert.deepEqual(originalTeams, original.filter(d => d.active).map(d => d.name), 'teams are the names of the active departments');
await api(undefined, token); assert.equal('departments' in data.settings, false, 'residents never receive departments'); assert.equal('teams' in data.settings, false);
assert.equal((await api({action: 'save-departments', departments: original}, token)).res.status, 403, 'residents cannot save departments'); await api();

// Validation: every refusal is a 400 with a plain-English message and nothing is stored.
const qa = {name: qaName, contactName: 'QA Contact', contactPhone: qaPhone, active: true};
const bad = async (departments, pattern, label) => {const r = await api({action: 'save-departments', departments}); assert.equal(r.res.status, 400, label); assert.match(r.j.error, pattern, label);};
await bad([], /between 1 and 20/, 'empty list'); await bad(Array.from({length: 21}, (_, i) => ({...qa, name: `QA ${nonce} ${i}`})), /between 1 and 20/, 'too many');
await bad([...original, {...qa, contactPhone: '12345'}], /phone number is not valid/, 'invalid phone'); await bad([...original, {...qa, contactPhone: ''}], /phone number/, 'missing phone'); await bad([...original, {...qa, contactName: ''}], /contact person/, 'missing contact');
await bad([...original, qa, {...qa, name: qaName.toUpperCase()}], /listed twice/, 'duplicate names'); await bad([{...original[0], active: false}, ...original.slice(1).map(d => ({...d, active: false}))], /at least one active/, 'no active department'); await bad([...original, {...qa, contactEmail: 'nope'}], /email/, 'invalid email');
await api(); assert.equal(data.settings.departments.length, original.length, 'refused saves stored nothing');

// Save: ids generated, phone normalised to ten digits, teams in step, a legacy save-teams call still works.
const saved = await api({action: 'save-departments', departments: [...original, qa]}); assert.equal(saved.res.status, 200, JSON.stringify(saved.j));
const mine = data.settings.departments.find(d => d.name === qaName); assert.ok(mine && mine.id && mine.contactPhone === '9876500099' && mine.active, 'the new department is stored with a generated id and a normalised phone');
assert.deepEqual(data.settings.teams, [...originalTeams, qaName], 'settings.teams follows the active departments');

// A complaint reported by a resident; assigning it records an update for the department phone, and so does every status change.
const form = new FormData(); form.append('file', new Blob([Uint8Array.from(png)], {type: 'image/png'}), 'test-evidence.png');
const upload = await fetch(base + '/api/media', {method: 'POST', headers: {Authorization: `Bearer ${token}`}, body: form}); assert.equal(upload.status, 200); const media = (await upload.json()).id;
const created = await api({action: 'create', view: 'resident', category: 'Road & Footpath', title: 'QA: department update ' + nonce, description: 'Automated test complaint for department updates.', locality: 'QA locality', lat: 26.91, lng: 75.78, media: [media], consent: true}, token); assert.equal(created.res.status, 200, JSON.stringify(created.j)); const id = created.j.id;
await api(); const entries = () => data.communications.filter(m => m.complaintId === id && m.template === 'Department update');
assert.equal(entries().length, 0, 'an unassigned complaint tells no department');
assert.equal((await api({action: 'transition', id, status: 'Acknowledged', note: 'Acknowledged by the department test.'})).res.status, 200); assert.equal(entries().length, 0);
assert.equal((await api({action: 'edit', id, assignee: 'Not a department'})).res.status, 400, 'unknown departments cannot be assigned');
assert.equal((await api({action: 'edit', id, assignee: qaName})).res.status, 200); assert.equal(entries().length, 1);
const first = entries()[0]; assert.deepEqual([first.channel, first.recipient, first.status, first.template], ['WhatsApp', '9876500099', 'Not sent · WhatsApp setup pending', 'Department update']);
assert.equal(first.reason, 'WhatsApp Business sender and approved templates are not configured.'); for (const part of [id, 'QA: department update', 'QA locality', 'Acknowledged', (await ensureWard()).name, qaName]) assert.ok(first.message.includes(part), `message mentions ${part}`);
assert.equal(first.message.includes(mobile), false, "the resident's phone number never reaches the department"); assert.equal(first.message.includes('QA Dept'), false, "nor the resident's name");
assert.equal((await api({action: 'edit', id, assignee: qaName})).res.status, 200); assert.equal((await api({action: 'edit', id, priority: 'High'})).res.status, 200); assert.equal(entries().length, 1, 'no-op edits record nothing more');
assert.equal((await api({action: 'transition', id, status: 'Assigned', note: 'Assigned for the department test.'})).res.status, 200); assert.equal(entries().length, 2); assert.ok(entries()[0].message.includes('is now Assigned'));
assert.equal(data.complaints.find(c => c.id === id).assignee, qaName); assert.ok(data.communications.some(m => m.complaintId === id && m.template !== 'Department update' && m.recipient === mobile), "the resident's own entries are unchanged");

// Rename: the complaint keeps the name it was given, the department keeps receiving its updates.
const renamed = qaName + ' (renamed)'; assert.equal((await api({action: 'save-departments', departments: data.settings.departments.map(d => d.id === mine.id ? {...d, name: renamed} : d)})).res.status, 200);
assert.equal(data.complaints.find(c => c.id === id).assignee, qaName, 'renaming never rewrites complaints');
assert.equal((await api({action: 'transition', id, status: 'In Progress', note: 'Work started for the test.'})).res.status, 200); assert.equal(entries().length, 3); assert.ok(entries()[0].message.startsWith(renamed + ': '), 'the renamed department still gets the update');

// A department that complaints refer to cannot be deleted, only deactivated; an inactive department cannot be assigned.
const without = data.settings.departments.filter(d => d.id !== mine.id); const removal = await api({action: 'save-departments', departments: without}); assert.equal(removal.res.status, 400); assert.match(removal.j.error, /1 complaint assigned, so it cannot be deleted/);
assert.equal((await api({action: 'save-departments', departments: data.settings.departments.map(d => d.id === mine.id ? {...d, active: false} : d)})).res.status, 200); assert.equal(data.settings.teams.includes(renamed), false); assert.equal(data.settings.departments.find(d => d.id === mine.id).active, false);
assert.equal((await api({action: 'edit', id, assignee: renamed})).res.status, 400, 'an inactive department cannot be assigned');

// Restore: move the QA complaint to an original department, then delete the QA department and check the original list is back.
const target = original.find(d => d.active); assert.equal((await api({action: 'edit', id, assignee: target.name})).res.status, 200);
assert.equal((await api({action: 'save-departments', departments: without})).res.status, 200, 'the QA department is deletable once no complaint refers to it');
assert.deepEqual(data.settings.departments.map(d => [d.id, d.name, d.contactName, d.contactPhone, d.active]), original.map(d => [d.id, d.name, d.contactName, d.contactPhone, d.active]), 'the original departments are restored'); assert.deepEqual(data.settings.teams, originalTeams);
console.log('PASS: departments (admin-only visibility, validation, save, phone normalisation, teams sync), recorded department updates for assignment and every status change (no resident details, no duplicates), rename keeps history and updates, delete-vs-deactivate, restore.');
