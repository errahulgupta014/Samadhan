import test from 'node:test';
import assert from 'node:assert/strict';
import {buildModules} from './build-ts.mjs';
buildModules(['shared/domain', 'lib/service'], 'tests/.generated');
const {seedWorkspace, LIVE_CONTENT_VERSION} = await import('./.generated/domain.mjs');
const {applyAction, publicWorkspace, complaintWardPart, complaintYearCode, nextComplaintId, wardCodeInComplaintId, cleanWardNumber} = await import('./.generated/service.mjs');

const resident = {residentId: 'res-aaaa', resident: {name: 'Asha Verma', mobile: '9876543210'}};
const createBody = {action: 'create', title: 'A damaged pathway', description: 'Damaged footpath beside the public park.', category: 'Road & Footpath', locality: 'Gandhi Nagar', lat: 26.91, lng: 75.78, media: ['test-evidence'], consent: true};
/** A live workspace has no complaints, so every test reports one first (as a registered resident would) and then drives it. */
async function ready() {
 const s = seedWorkspace();
 const {id} = await applyAction(s, createBody, 'resident', 90000, 'Asha Verma', resident);
 const c = s.complaints.find(x => x.id === id);
 c.status = 'In Progress'; c.assignee = 'Roads & Infrastructure'; c.afterMedia = ['test-evidence'];
 return {s, c, base: s.audit.length};
}

test('a new workspace is live: no sample complaints or notices, no wards, and no ward, city or contact text', () => {
 const s = seedWorkspace();
 assert.deepEqual(s.complaints, []);
 assert.deepEqual(s.announcements, []);
 assert.deepEqual(s.communications, []);
 assert.deepEqual(s.wards, [], 'wards are created by administrators only');
 assert.deepEqual([s.settings.ward, s.settings.city, s.settings.contact], ['', '', '']);
 assert.equal(s.settings.slaHours, 48); assert.equal(s.liveContentVersion, LIVE_CONTENT_VERSION);
 for (const text of ['Ward 12', 'ward-12', 'Jaipur', 'Ward office']) assert.equal(JSON.stringify(s).includes(text), false, text + ' is not part of a new workspace');
 assert.equal(JSON.stringify(s).includes('Demo Resident'), false);
 assert.equal(JSON.stringify(s).includes('2100'), false);
});
test('admin cannot close a complaint directly', async () => {const {s, c} = await ready(); c.status = 'Resolution Proposed'; await assert.rejects(applyAction(s, {action: 'transition', id: c.id, status: 'Closed', note: 'Close complaint'}, 'admin'), /OTP/);});
test('resolution proposal requires evidence', async () => {const {s, c} = await ready(); c.afterMedia = []; await assert.rejects(applyAction(s, {action: 'transition', id: c.id, status: 'Resolution Proposed', note: 'The road has been repaired.'}, 'admin'), /evidence/);});
test('resident cannot perform admin work', async () => {const {s, c} = await ready(); await assert.rejects(applyAction(s, {action: 'edit', id: c.id, priority: 'High'}, 'resident'), /Administrator/);});
test('verified closure, incorrect attempt, replay rejection and dispute', async () => {
 const {s, c, base} = await ready();
 await applyAction(s, {action: 'transition', id: c.id, status: 'Resolution Proposed', note: 'Repair is complete; after-work photo attached.'}, 'admin', 100000);
 const code = await applyAction(s, {action: 'preview-closure-code', id: c.id}, 'resident', 100001);
 assert.equal((await applyAction(s, {action: 'verify-closure', id: c.id, code: 'wrong'}, 'resident', 100002)).error, 'Incorrect verification code.');
 assert.equal(c.status, 'Resolution Proposed');
 await applyAction(s, {action: 'verify-closure', id: c.id, code: code.demoCode}, 'resident', 100003);
 assert.equal(c.status, 'Closed'); assert.ok(!s.challenges[c.id]);
 await assert.rejects(applyAction(s, {action: 'verify-closure', id: c.id, code: code.demoCode}, 'resident', 100004));
 await applyAction(s, {action: 'dispute', id: c.id, note: 'The same issue persists at the location.'}, 'resident', 100005);
 assert.equal(c.status, 'Reopened'); assert.equal(s.audit.length - base, 5);
});
test('OTP expires and cannot be resent immediately', async () => {
 const {s, c} = await ready(); c.status = 'Resolution Proposed'; s.settings.closureOtp = ''; // per-complaint codes (the universal closure code is covered in closure.test.mjs)
 await applyAction(s, {action: 'issue-closure-code', id: c.id}, 'resident', 100000);
 const code = await applyAction(s, {action: 'preview-closure-code', id: c.id}, 'resident', 100000);
 await assert.rejects(applyAction(s, {action: 'issue-closure-code', id: c.id}, 'resident', 100001), /60 seconds/);
 await assert.rejects(applyAction(s, {action: 'verify-closure', id: c.id, code: code.demoCode}, 'resident', 400001), /expired/);
});
test('five wrong attempts lock a challenge', async () => {
 const {s, c} = await ready(); c.status = 'Resolution Proposed'; s.settings.closureOtp = '';
 const code = await applyAction(s, {action: 'issue-closure-code', id: c.id}, 'resident', 100000);
 for (let i = 0; i < 5; i++) await applyAction(s, {action: 'verify-closure', id: c.id, code: 'wrong'}, 'resident', 100001 + i);
 await assert.rejects(applyAction(s, {action: 'verify-closure', id: c.id, code: code.demoCode}, 'resident', 100020), /locked/);
});
test('challenge hashes never appear in workspace payload', async () => {const {s, c} = await ready(); c.status = 'Resolution Proposed'; await applyAction(s, {action: 'issue-closure-code', id: c.id}, 'resident'); assert.equal('challenges' in publicWorkspace(s), false);});
test('privileged override fails closed', async () => {const {s, c} = await ready(); await assert.rejects(applyAction(s, {action: 'override-close', id: c.id}, 'admin'), /disabled/);});
test('admin closure request automatically issues an OTP without exposing it to admin', async () => {
 const {s, c} = await ready();
 const result = await applyAction(s, {action: 'transition', id: c.id, status: 'Resolution Proposed', note: 'The repair is complete and evidence is attached.'}, 'admin', 100000);
 assert.ok(s.challenges[c.id]); assert.equal(result.demoCode, undefined); assert.equal(c.status, 'Resolution Proposed');
 assert.equal(result.channel, 'WhatsApp'); assert.equal(result.delivery, 'setup-required');
 await assert.rejects(applyAction(s, {action: 'preview-closure-code', id: c.id}, 'admin', 100001), /Resident/);
 const code = await applyAction(s, {action: 'preview-closure-code', id: c.id}, 'resident', 100001);
 assert.match(code.demoCode, /^\d{6}$/);
 assert.ok(s.communications.every(m => m.channel === 'WhatsApp' && !JSON.stringify(m).includes(code.demoCode)));
});
test('acknowledgement has the same unique reference as the stored complaint', async () => {
 const {s} = await ready();
 const body = {...createBody, title: 'Sample broken pathway', description: 'Sample pathway beside the park is damaged.'};
 const a = await applyAction(s, body, 'resident', 200000, 'Asha', resident), b = await applyAction(s, body, 'resident', 200001, 'Asha', resident);
 assert.notEqual(a.referenceNumber, b.referenceNumber); assert.equal(a.referenceNumber, a.id);
 assert.ok(s.communications.find(m => m.complaintId === a.id).message.includes(a.referenceNumber));
 assert.equal(s.communications[0].channel, 'WhatsApp'); assert.match(s.communications[0].status, /Not sent/);
});
test('complaint requires photo, location and explicit consent', async () => {
 const s = seedWorkspace();
 await assert.rejects(applyAction(s, {...createBody, consent: false}, 'resident'), /consent/);
 await assert.rejects(applyAction(s, {...createBody, media: []}, 'resident'), /photographs/);
 await assert.rejects(applyAction(s, {...createBody, lat: 100}, 'resident'), /coordinates/);
 const result = await applyAction(s, createBody, 'resident');
 assert.equal(s.complaints[0].id, result.id); assert.equal(s.complaints[0].status, 'Submitted');
});
test('a complaint is owned by, and named after, the registered resident; nothing is defaulted to a demo identity', async () => {
 const s = seedWorkspace();
 const {id} = await applyAction(s, createBody, 'resident', 1000, 'Asha Verma', resident);
 const c = s.complaints.find(x => x.id === id);
 assert.equal(c.residentId, 'res-aaaa'); assert.equal(c.resident, 'Asha Verma'); assert.equal(c.mobile, '9876543210');
 assert.equal(c.history[0].actor, 'Asha Verma');
 assert.equal(JSON.stringify(s).includes('Demo Resident'), false); assert.equal(JSON.stringify(s).includes('••••'), false);
 // The resident's context without a registered profile cannot report an issue.
 await assert.rejects(applyAction(s, createBody, 'resident', 1000, 'x', {residentId: 'demo-resident', resident: null}), e => e.code === 403 && /registration/.test(e.message));
 assert.equal(s.complaints.length, 1);
});
test('the per-minute report limit applies to each resident, not to the whole ward', async () => {
 const s = seedWorkspace(); const other = {residentId: 'res-bbbb', resident: {name: 'Ravi Kumar', mobile: '9123456780'}};
 for (let i = 0; i < 5; i++) await applyAction(s, createBody, 'resident', 5000 + i, 'Asha', resident);
 await assert.rejects(applyAction(s, createBody, 'resident', 5010, 'Asha', resident), e => e.code === 429);
 const ok = await applyAction(s, createBody, 'resident', 5011, 'Ravi', other);
 assert.equal(s.complaints.find(c => c.id === ok.id).residentId, 'res-bbbb');
});

/* ---------------------------------------------------------------- complaint numbers: JSS/<yy>/W<ward>/<n> */
const JSS = /^JSS\/(\d{2})\/W([0-9A-Z]+)\/(\d+)$/;
const parts = id => {const m = JSS.exec(id); assert.ok(m, id); return {yy: m[1], ward: m[2], n: m[3]};};
const report = (s, ctx, now, body = createBody) => applyAction(s, body, 'resident', now, 'Asha Verma', {...resident, ...ctx});
const T2026 = Date.UTC(2026, 5, 1, 12);
test('complaint numbers are JSS/<yy>/W<ward>/<n>: the first of a ward and year is 1, then 2, 3, with no zero padding', async () => {
 const s = seedWorkspace(); const ids = [];
 for (let i = 0; i < 3; i++) ids.push((await report(s, {wardNumber: '12'}, T2026 + i * 1000)).id);
 assert.deepEqual(ids, ['JSS/26/W12/1', 'JSS/26/W12/2', 'JSS/26/W12/3']);
 for (let i = 3; i < 10; i++) ids.push((await report(s, {wardNumber: '12'}, T2026 + 100000 * i)).id);
 assert.equal(ids[9], 'JSS/26/W12/10', 'the counter is a plain integer, not padded or limited to one digit');
 const a = await report(s, {wardNumber: '12'}, T2026 + 2_000_000); assert.equal(a.referenceNumber, a.id, 'the acknowledgement and the stored complaint use the same number'); assert.equal(a.id, 'JSS/26/W12/11');
 assert.equal(s.communications[0].message.includes(a.id), true);
});
test('every ward and every year counts on its own', async () => {
 const s = seedWorkspace();
 assert.equal((await report(s, {wardNumber: '12'}, T2026)).id, 'JSS/26/W12/1');
 assert.equal((await report(s, {wardNumber: '12'}, T2026 + 70_000)).id, 'JSS/26/W12/2');
 assert.equal((await report(s, {wardNumber: '7'}, T2026 + 140_000)).id, 'JSS/26/W7/1', 'a different ward starts at 1');
 assert.equal((await report(s, {wardNumber: '7'}, T2026 + 210_000)).id, 'JSS/26/W7/2');
 assert.equal((await report(s, {wardNumber: '12'}, Date.UTC(2027, 2, 1))).id, 'JSS/27/W12/1', 'a new year restarts at 1');
 assert.equal((await report(s, {wardNumber: '12'}, T2026 + 280_000)).id, 'JSS/26/W12/3', 'the old year continues where it left off');
 assert.equal((await report(s, {wardNumber: '1'}, T2026 + 350_000)).id, 'JSS/26/W1/1', 'W1 and W12 never share a counter');
});
test('the number comes after the highest one in use, ignoring legacy ids, other wards and other years', () => {
 const list = ids => ids.map(id => ({id}));
 assert.equal(nextComplaintId([], '5', T2026), 'JSS/26/W5/1');
 assert.equal(nextComplaintId(list(['WC-W5-2026-ABCDEF123456', 'WC-W5-2026-000184', 'WC-W5-2026-12']), '5', T2026), 'JSS/26/W5/1', 'legacy ids never touch the counter and are never renumbered');
 assert.equal(nextComplaintId(list(['JSS/26/W5/3', 'JSS/26/W5/9', 'JSS/26/W5/4']), '5', T2026), 'JSS/26/W5/10', 'one more than the highest, even when numbers have gaps');
 assert.equal(nextComplaintId(list(['JSS/26/W5/3', 'JSS/26/W50/20', 'JSS/26/W6/30', 'JSS/25/W5/40', 'JSS/27/W5/50']), '5', T2026), 'JSS/26/W5/4');
 assert.equal(nextComplaintId(list(['JSS/26/W5/x', 'JSS/26/W5/', 'JSS/26/W5/2/7', 'JSS/26/W5/-4', 'JSS/26/W5/1e3']), '5', T2026), 'JSS/26/W5/1', 'malformed tails are not numbers');
 assert.equal(nextComplaintId(list(['JSS/26/W5/007']), '5', T2026), 'JSS/26/W5/8', 'an id written with zeros still counts');
 // Defensive: the proposed number is never one that already exists.
 const crowded = list(['JSS/26/W5/1', 'JSS/26/W5/2']); assert.ok(!crowded.some(c => c.id === nextComplaintId(crowded, '5', T2026)));
});
test('the year is the Indian (UTC+05:30) calendar year, so New Year arrives at 18:30 UTC on 31 December', async () => {
 assert.equal(complaintYearCode(Date.UTC(2026, 11, 31, 18, 29, 59)), '26'); assert.equal(complaintYearCode(Date.UTC(2026, 11, 31, 18, 30, 0)), '27');
 assert.equal(complaintYearCode(Date.UTC(2026, 11, 31, 20, 0, 0)), '27', '31 Dec 2026 20:00 UTC is already 2027 in India');
 assert.equal(complaintYearCode(Date.UTC(2027, 0, 1, 0, 0, 0)), '27'); assert.equal(complaintYearCode(Date.UTC(2026, 0, 1, 0, 0, 0)), '26');
 assert.equal(complaintYearCode(Date.UTC(2099, 11, 31, 20, 0, 0)), '00', 'two digits, zero padded');
 const s = seedWorkspace();
 assert.equal((await report(s, {wardNumber: '12'}, Date.UTC(2026, 11, 31, 18, 0, 0))).id, 'JSS/26/W12/1');
 assert.equal((await report(s, {wardNumber: '12'}, Date.UTC(2026, 11, 31, 20, 0, 0))).id, 'JSS/27/W12/1', 'filed on the evening of 31 December UTC, already the new year in India');
});
test('the ward part is W plus the cleaned ward number, and W0 while the number is unknown (never a hard-coded ward)', async () => {
 const wardOf = async number => parts((await report(seedWorkspace(), number === undefined ? {} : {wardNumber: number}, T2026)).id).ward;
 assert.equal(await wardOf('12'), '12'); assert.equal(await wardOf('7'), '7'); assert.equal(await wardOf('105'), '105');
 assert.equal(await wardOf('12 a'), '12A', 'letters are upper-cased, spaces dropped'); assert.equal(await wardOf(' 3-B '), '3B'); assert.equal(await wardOf('../x'), 'X', 'only letters and digits survive');
 assert.equal(await wardOf('1234567890123'), '12345678', 'at most eight characters');
 for (const unknown of [undefined, '', ' ', '---', '../']) assert.equal(await wardOf(unknown), '0', JSON.stringify(unknown) + ' has no usable ward number');
 assert.equal((await report(seedWorkspace(), {}, T2026)).id, 'JSS/26/W0/1'); assert.equal((await report(seedWorkspace(), {wardNumber: ''}, T2026)).id, 'JSS/26/W0/1');
 assert.deepEqual(['7', ' ', '', undefined, 'a/b'].map(v => complaintWardPart(v)), ['W7', 'W0', 'W0', 'W0', 'WAB']); assert.equal(complaintWardPart(), 'W0');
 assert.deepEqual(['7', ' ', '', undefined, 'a/b'].map(v => cleanWardNumber(v)), ['7', '', '', '', 'AB']);
 // The label in settings is no longer consulted: it cannot turn an unknown ward into a number.
 const labelled = seedWorkspace(); labelled.settings.ward = 'Ward 9'; assert.equal((await report(labelled, {}, T2026)).id, 'JSS/26/W0/1');
});
test('the ward code inside a complaint number is read from the new and the legacy formats', () => {
 assert.deepEqual(['JSS/26/W12/1', 'JSS/27/W7B/130', 'WC-W7-2026-ABCDEF123456', 'WC-W105-2026-000184', 'JSS/26/W0/3', 'JSS/26/W/3', 'JSS/26/W12/', 'WC-W-2026-1', 'anything', ''].map(wardCodeInComplaintId), ['12', '7B', '7', '105', '', '', '', '', '', '']);
});
test('a new complaint stores the resident ward id, only when it is known', async () => {
 const s = seedWorkspace(); const a = await report(s, {wardNumber: '9', wardId: 'ward-9'}, T2026), b = await report(s, {}, T2026 + 70_000), c = await report(s, {wardNumber: '9', wardId: ''}, T2026 + 140_000);
 const stored = id => s.complaints.find(x => x.id === id);
 assert.equal(stored(a.id).wardId, 'ward-9'); assert.equal('wardId' in stored(b.id), false); assert.equal('wardId' in stored(c.id), false);
 assert.equal('wardLabel' in stored(a.id), false, 'the label is computed when the workspace is read, never stored');
});

/* ---------------------------------------------------------------- departments: phone numbers, validation, assignment, recorded updates */
const {validateDepartments, departmentsOf, activeTeamNames, departmentFor, normalizeIndianPhone, formatPhone, MAX_DEPARTMENTS} = await import('./.generated/service.mjs');
const {teams: defaultTeams} = await import('./.generated/domain.mjs');
const dept = (over = {}) => ({name: 'Roads & Infrastructure', contactName: 'Anil Sharma', contactPhone: '98765 00011', active: true, ...over});
const saveDepartments = (s, departments) => applyAction(s, {action: 'save-departments', departments}, 'admin');
const departmentUpdates = s => s.communications.filter(m => m.template === 'Department update');

test('department phone numbers: mobiles are stored as 10 digits, landlines keep their STD code with a leading 0, everything else is refused', async () => {
 // Decision: mobile = ten digits starting 6-9 with an optional +91 / 91 / 0 prefix. Landline = STD code + number (ten digits starting 1-5, eleven tolerated) stored with a leading 0 (11-12 digits).
 // STD codes starting 6-9 (Kota 0744, Bengaluru 080) are read as a landline only when written STD code, one separator, number: written as one block they are indistinguishable from a mobile.
 for (const [input, stored] of [['9876543210', '9876543210'], ['98765 43210', '9876543210'], ['98765-43210', '9876543210'], ['987 654 3210', '9876543210'], ['+91 98765 43210', '9876543210'], ['+91-98765-43210', '9876543210'], ['+91 9876543210', '9876543210'], ['919876543210', '9876543210'], ['09876543210', '9876543210'], ['0 98765 43210', '9876543210'], [' (0) 98765.43210 ', '9876543210'], ['6000000000', '6000000000'], ['7000000000', '7000000000'], ['8000000000', '8000000000'], ['07442345678', '7442345678']]) assert.equal(normalizeIndianPhone(input), stored, `mobile ${input}`);
 for (const [input, stored] of [['0141 234 5678', '01412345678'], ['0141-2345678', '01412345678'], ['01412345678', '01412345678'], ['+91 141 2345678', '01412345678'], ['141 2345678', '01412345678'], ['011-23456789', '01123456789'], ['04712 345678', '04712345678'], ['0 1412 3456789', '014123456789'], ['0744 2345678', '07442345678'], ['0744-2345678', '07442345678'], ['(0744) 2345678', '07442345678'], ['+91 744 2345678', '07442345678'], ['0 744 2345678', '07442345678'], ['0731 2345678', '07312345678'], ['080 26012345', '08026012345'], ['079-26012345', '07926012345']]) assert.equal(normalizeIndianPhone(input), stored, `landline ${input}`);
 assert.equal(normalizeIndianPhone('0141 234 5678').length, 11); assert.equal(normalizeIndianPhone('0 1412 3456789').length, 12, 'at most 12 digits are stored');
 for (const bad of ['', '   ', '12345', '98765', '987654321', '98765432101', '+91 98765432101', '587654321', '+44 7911 123456', '+1 555 123 4567', '98765-ABCDE', 'call me', '9876543210x', '0000000000', '00 98765 43210', '+91', '+91 12345', '123456789012', '0123456789012', '98765 4321 0000', 98765, null, undefined, {}, ['9876543210']]) assert.equal(normalizeIndianPhone(bad), null, JSON.stringify(bad));
 assert.equal(formatPhone('9876543210'), '+91 98765 43210'); assert.equal(formatPhone('01412345678'), '01412345678');
 // A stored landline is kept exactly when it is sent back (it would read as a mobile number if it were normalised again).
 const s = seedWorkspace(); await saveDepartments(s, [dept({contactPhone: '0744 2345678'})]); const [kota] = s.settings.departments; assert.equal(kota.contactPhone, '07442345678');
 await saveDepartments(s, [{...kota, nameHi: 'सड़क'}]); assert.equal(s.settings.departments[0].contactPhone, '07442345678', 'unchanged phone survives a re-save'); await saveDepartments(s, [{...kota, contactPhone: '98765 00011'}]); assert.equal(s.settings.departments[0].contactPhone, '9876500011', 'a changed phone is normalised');
});

test('departments are derived from the team list until saved; saving stores them and keeps settings.teams in step', async () => {
 const s = seedWorkspace(); assert.equal(s.settings.departments, undefined);
 const derived = departmentsOf(s.settings); assert.deepEqual(derived.map(d => d.name), defaultTeams);
 assert.ok(derived.every(d => d.active && d.contactName === '' && d.contactPhone === '' && /^team-[0-9a-z]+$/.test(d.id)), 'derived departments are active with empty contact fields');
 assert.deepEqual(departmentsOf(s.settings).map(d => d.id), derived.map(d => d.id), 'derived ids are stable');
 assert.equal(new Set(derived.map(d => d.id)).size, derived.length);
 s.settings.teams = ['Ward office', 'Water']; assert.deepEqual(departmentsOf(s.settings).map(d => d.name), ['Ward office', 'Water'], 'derived from a saved legacy team list');
 delete s.settings.teams;
 const before = s.audit.length;
 assert.deepEqual(await saveDepartments(s, [dept({nameHi: ' सड़क विभाग '}), dept({name: '  Sanitation   Team ', contactName: '  Meena  Rao ', contactPhone: '+91 91234-56789', contactEmail: ' meena@example.org '}), dept({name: 'Parks Department', contactName: '', contactPhone: '', active: false})]), {});
 const [a, b, c] = s.settings.departments;
 assert.deepEqual(a, {id: a.id, name: 'Roads & Infrastructure', nameHi: 'सड़क विभाग', contactName: 'Anil Sharma', contactPhone: '9876500011', active: true});
 assert.deepEqual(b, {id: b.id, name: 'Sanitation Team', contactName: 'Meena Rao', contactPhone: '9123456789', contactEmail: 'meena@example.org', active: true});
 assert.deepEqual(c, {id: c.id, name: 'Parks Department', contactName: '', contactPhone: '', active: false}, 'an inactive department may have no contact yet');
 assert.equal(new Set([a.id, b.id, c.id]).size, 3); assert.ok([a.id, b.id, c.id].every(id => typeof id === 'string' && id.length >= 8), 'ids are generated');
 assert.deepEqual(s.settings.teams, ['Roads & Infrastructure', 'Sanitation Team'], 'settings.teams = names of the ACTIVE departments');
 assert.deepEqual(activeTeamNames(s.settings), ['Roads & Infrastructure', 'Sanitation Team']);
 assert.equal(s.audit.length, before + 1); assert.match(s.audit[0].action, /^Updated departments: Roads & Infrastructure, Sanitation Team, Parks Department \(inactive\)/); assert.equal(s.audit[0].action.includes('9876500011'), false, 'phone numbers stay out of the audit log');
 // Re-saving with the ids keeps them; the order of the list is kept.
 await saveDepartments(s, [{...b}, {...a}, {...c}]); assert.deepEqual(s.settings.departments.map(d => d.id), [b.id, a.id, c.id]); assert.deepEqual(s.settings.teams, ['Sanitation Team', 'Roads & Infrastructure']);
 await assert.rejects(applyAction(seedWorkspace(), {action: 'save-departments', departments: [dept()]}, 'resident'), e => e.code === 403 && /Administrator/.test(e.message), 'residents cannot save departments');
});

test('save-departments validation: counts, names, contact person, phone, email, active flags and ids; a failed save changes nothing', async () => {
 const s = seedWorkspace(); await saveDepartments(s, [dept(), dept({name: 'Sanitation Team', contactName: 'Meena Rao', contactPhone: '9123456789'})]);
 const stored = () => JSON.stringify([s.settings, s.audit]); const before = stored(); const [one] = s.settings.departments;
 const bad = (departments, pattern, label) => assert.rejects(saveDepartments(s, departments), pattern, label ?? String(JSON.stringify(departments)).slice(0, 80));
 await bad([], /between 1 and 20 departments/); await bad(undefined, /between 1 and 20/); await bad('x', /between 1 and 20/); await bad(null, /between 1 and 20/); await bad({length: 2}, /between 1 and 20/);
 assert.equal(MAX_DEPARTMENTS, 20); await bad(Array.from({length: 21}, (_, i) => dept({name: `Department ${i + 1}`})), /between 1 and 20/);
 await bad([dept(), 5], /Department 2: enter a name/); await bad([null], /Department 1: enter a name/); await bad([[]], /Department 1: enter a name/);
 for (const name of ['A', ' ', '', 'x'.repeat(61), 'Roads\u0007', 'Roads\nand more', 5, null, undefined]) await bad([dept({name})], /department name must be 2–60 characters/, `name ${JSON.stringify(name)}`);
 await bad([dept({name: 'Roads'}), dept({name: ' roads '})], /“roads” is listed twice/); await bad([dept({name: 'Water  Team'}), dept({name: 'water team'})], /listed twice/); await bad([dept({name: 'Roads'}), dept({name: 'ROADS', active: false})], /listed twice/, 'inactive names count too');
 for (const contactName of ['', ' ', 'A', 'x'.repeat(81), 'Anil\u0000Sharma', 5]) await bad([dept({contactName})], /enter the contact person's name \(2–80 characters\)|contact person's name must be 2–80/, `contact ${JSON.stringify(contactName)}`);
 for (const contactPhone of ['', '  ', undefined, null]) await bad([dept({contactPhone})], /enter the phone number on which updates will be sent/, `phone ${JSON.stringify(contactPhone)}`);
 for (const contactPhone of ['12345', 'abc', '+44 7911 123456', '587654321', 12345, '98765 4321 0000']) await bad([dept({contactPhone})], /Roads & Infrastructure: that phone number is not valid\. Enter a 10-digit mobile number/, `phone ${contactPhone}`);
 await bad([dept({contactName: '', contactPhone: '9876500011'})], /contact person's name/); await bad([dept({contactName: 'Anil', contactPhone: ''})], /phone number/);
 for (const contactEmail of ['nope', 'a@b', 'a b@example.org', 'x'.repeat(121) + '@example.org', 5]) await bad([dept({contactEmail})], /valid email address/, `email ${contactEmail}`);
 await bad([dept({active: 'yes'})], /choose whether the department is active/); await bad([dept({active: undefined})], /choose whether the department is active/); await bad([dept({active: 1})], /choose whether/);
 await bad([dept({nameHi: 'x'.repeat(61)})], /Hindi name/); await bad([dept({nameHi: 5})], /Hindi name/);
 await bad([dept({active: false}), dept({name: 'Other', active: false})], /at least one active department/);
 await bad([{...one, id: 'missing-id'}], /no longer exists\. Refresh/); await bad([{...one, id: 5}], /invalid department id/); await bad([{...one, id: 'x'.repeat(101)}], /invalid department id/);
 await bad([{...one}, {...one, name: 'Another'}], /listed twice/, 'the same id twice');
 assert.equal(stored(), before, 'nothing is stored or audited when a save fails');
 // Optional things really are optional, and whitespace is normalised.
 await saveDepartments(s, [{...one, nameHi: '', contactEmail: ' '}]); assert.deepEqual(s.settings.departments[0], {id: one.id, name: 'Roads & Infrastructure', contactName: 'Anil Sharma', contactPhone: '9876500011', active: true});
 assert.deepEqual(validateDepartments([dept({name: 'x'.repeat(60), contactName: 'y'.repeat(80)})], [], []).map(d => d.name.length + d.contactName.length), [140], 'limits are inclusive');
 assert.equal(validateDepartments(Array.from({length: 20}, (_, i) => dept({name: `Department ${i + 1}`})), [], []).length, 20);
});

test('a department from the old team list with no contact can be saved unchanged; every added or edited one needs a contact', async () => {
 const s = seedWorkspace(); const derived = departmentsOf(s.settings);
 // Sending the derived list back unchanged is fine, so contacts can be filled in one department at a time.
 await saveDepartments(s, derived); assert.equal(s.settings.departments.length, defaultTeams.length); assert.deepEqual(s.settings.teams, defaultTeams);
 const edited = s.settings.departments.map((d, i) => i === 1 ? {...d, contactName: 'Meena Rao', contactPhone: '9123456789'} : d);
 await saveDepartments(s, edited); assert.equal(s.settings.departments[1].contactPhone, '9123456789'); assert.equal(s.settings.departments[0].contactPhone, '');
 // A new department, or one that had a contact, cannot be saved without one; a blank one that never had a contact stays allowed.
 await assert.rejects(saveDepartments(s, [...s.settings.departments, {name: 'New wing', active: true}]), /enter the contact person's name/);
 await assert.rejects(saveDepartments(s, s.settings.departments.map((d, i) => i === 1 ? {...d, contactName: '', contactPhone: ''} : d)), /Sanitation Team: enter the contact person's name/, 'a department that has a contact cannot lose it while active');
 await saveDepartments(s, s.settings.departments.map((d, i) => i === 1 ? {...d, contactName: '', contactPhone: '', active: false} : d)); assert.equal(s.settings.departments[1].active, false, 'an inactive department may drop its contact');
});

test('a department that complaints refer to cannot be removed from the list, only made inactive; unused ones can be deleted', async () => {
 const s = seedWorkspace(); await saveDepartments(s, [dept(), dept({name: 'Sanitation Team', contactName: 'Meena Rao', contactPhone: '9123456789'}), dept({name: 'Parks Department', contactName: 'Ravi Jain', contactPhone: '9988776655'})]);
 const [roads, sanitation, parks] = s.settings.departments;
 const {id} = await applyAction(s, createBody, 'resident', 90000, 'Asha Verma', resident);
 await applyAction(s, {action: 'edit', id, assignee: 'Sanitation Team'}, 'admin');
 await assert.rejects(saveDepartments(s, [roads, parks]), /“Sanitation Team” has 1 complaint assigned, so it cannot be deleted\. Mark it as inactive instead/);
 assert.equal(s.settings.departments.length, 3, 'nothing was removed');
 await saveDepartments(s, [roads, {...sanitation, active: false}, parks]); assert.equal(s.settings.departments[1].active, false); assert.deepEqual(s.settings.teams, ['Roads & Infrastructure', 'Parks Department']);
 assert.equal(s.complaints[0].assignee, 'Sanitation Team', 'the complaint keeps its department'); assert.equal(departmentFor(s.settings, s.complaints[0]).name, 'Sanitation Team', 'and its contact lookup still works');
 await saveDepartments(s, [roads, {...sanitation, active: false}]); assert.deepEqual(s.settings.departments.map(d => d.name), ['Roads & Infrastructure', 'Sanitation Team'], 'Parks Department had no complaints: deleting it is fine');
 // Complaints stored before departments existed refer to a team by name only; a department with the same name replaces the old one.
 const legacy = seedWorkspace(); legacy.complaints.push({id: 'WC-L-1', assignee: 'Sanitation Team', status: 'Assigned', history: []});
 await assert.rejects(saveDepartments(legacy, [dept()]), /“Sanitation Team” has 1 complaint assigned/); await saveDepartments(legacy, [dept(), dept({name: 'Sanitation Team', contactName: 'Meena Rao', contactPhone: '9123456789'})]); assert.equal(departmentFor(legacy.settings, legacy.complaints[0]).contactPhone, '9123456789');
});

test('assignment is validated against the ACTIVE departments; a complaint of an inactive or renamed department stays editable and keeps its history', async () => {
 const s = seedWorkspace(); await saveDepartments(s, [dept(), dept({name: 'Sanitation Team', contactName: 'Meena Rao', contactPhone: '9123456789'}), dept({name: 'Old Wing', contactName: 'Old Hand', contactPhone: '9000000001', active: false})]);
 const {id} = await applyAction(s, createBody, 'resident', 90000, 'Asha Verma', resident); const c = s.complaints.find(x => x.id === id);
 await assert.rejects(applyAction(s, {action: 'edit', id, assignee: 'Old Wing'}, 'admin'), /Unknown team or department\. Choose one of the active departments\./, 'inactive departments cannot be assigned');
 await assert.rejects(applyAction(s, {action: 'edit', id, assignee: 'Nowhere'}, 'admin'), /Unknown team/); await assert.rejects(applyAction(s, {action: 'edit', id, assignee: 'roads & infrastructure'}, 'admin'), /Unknown team/, 'names match exactly as the dropdown sends them');
 await assert.rejects(applyAction(s, {action: 'edit', id, assignee: 5}, 'admin'), /Unknown team/); assert.equal(c.assignee, '');
 await applyAction(s, {action: 'edit', id, assignee: 'Sanitation Team'}, 'admin'); assert.equal(c.assignee, 'Sanitation Team'); assert.equal(c.assigneeId, s.settings.departments[1].id);
 // Rename: the complaint keeps the name it was given, its history is untouched, and it still finds its department by id.
 const history = JSON.stringify(c.history); const [roads, sanitation, old] = s.settings.departments;
 await saveDepartments(s, [roads, {...sanitation, name: 'Solid Waste Management'}, old]);
 assert.equal(c.assignee, 'Sanitation Team'); assert.equal(JSON.stringify(c.history), history); assert.equal(departmentFor(s.settings, c).name, 'Solid Waste Management'); assert.deepEqual(s.settings.teams, ['Roads & Infrastructure', 'Solid Waste Management']);
 await applyAction(s, {action: 'edit', id, priority: 'High'}, 'admin'); assert.equal(c.priority, 'High', 'editing other fields never revalidates the current assignee');
 await assert.rejects(applyAction(s, {action: 'edit', id, assignee: 'Sanitation Team'}, 'admin'), /Unknown team/, 'the old name is no longer a department, even when it is the complaint\'s current assignee'); assert.equal(c.assignee, 'Sanitation Team');
 await assert.rejects(applyAction(s, {action: 'edit', id, assignee: 'Parks Department'}, 'admin'), /Unknown team/);
 // Deactivated: stays on the complaint, cannot be chosen again for another one.
 await saveDepartments(s, [roads, {...sanitation, name: 'Solid Waste Management', active: false}, old]); assert.equal(c.assignee, 'Sanitation Team');
 const other = await applyAction(s, createBody, 'resident', 190000, 'Asha Verma', resident); await assert.rejects(applyAction(s, {action: 'edit', id: other.id, assignee: 'Solid Waste Management'}, 'admin'), /Unknown team/);
 // Complaints can still use the plain legacy team list while no departments are saved.
 const fresh = seedWorkspace(); const f = await applyAction(fresh, createBody, 'resident', 90000, 'Asha Verma', resident); await applyAction(fresh, {action: 'edit', id: f.id, assignee: 'Sanitation Team'}, 'admin'); assert.equal(fresh.complaints[0].assignee, 'Sanitation Team'); assert.equal(fresh.complaints[0].assigneeId, departmentsOf(fresh.settings).find(d => d.name === 'Sanitation Team').id);
});

test('assigning a complaint to a department, and every status change after that, records an update for the department phone (recorded, never sent)', async () => {
 const s = seedWorkspace(); await saveDepartments(s, [dept(), dept({name: 'Sanitation Team', contactName: 'Meena Rao', contactPhone: '+91 91234 56789'})]);
 const {id} = await applyAction(s, createBody, 'resident', 90000, 'Asha Verma', {...resident, wardNumber: '12'}); const c = s.complaints.find(x => x.id === id);
 const residentEntries = () => s.communications.filter(m => m.template !== 'Department update');
 assert.equal(departmentUpdates(s).length, 0, 'filing a complaint tells no department'); assert.equal(residentEntries().length, 1);
 await applyAction(s, {action: 'transition', id, status: 'Acknowledged', note: 'Complaint acknowledged by ward administration.'}, 'admin'); assert.equal(departmentUpdates(s).length, 0, 'an unassigned complaint tells no department');
 // Assignment.
 await applyAction(s, {action: 'edit', id, assignee: 'Roads & Infrastructure'}, 'admin');
 assert.equal(departmentUpdates(s).length, 1); const assigned = departmentUpdates(s)[0];
 assert.deepEqual([assigned.channel, assigned.recipient, assigned.status, assigned.template, assigned.complaintId], ['WhatsApp', '9876500011', 'Not sent · WhatsApp setup pending', 'Department update', id]);
 assert.equal(assigned.reason, 'WhatsApp Business sender and approved templates are not configured.');
 for (const part of [id, c.title, c.locality, 'Acknowledged', 'Ward 12', 'Roads & Infrastructure', 'New complaint assigned']) assert.ok(assigned.message.includes(part), `message mentions ${part}: ${assigned.message}`);
 for (const secret of ['9876543210', 'Asha', 'Verma']) assert.equal(assigned.message.includes(secret), false, `the resident's ${secret} never reaches the department`);
 assert.ok(assigned.at && assigned.id);
 // No-op edits record nothing: same assignee again, other fields, nothing at all.
 await applyAction(s, {action: 'edit', id, assignee: 'Roads & Infrastructure'}, 'admin'); await applyAction(s, {action: 'edit', id, priority: 'High'}, 'admin'); await applyAction(s, {action: 'edit', id}, 'admin'); await applyAction(s, {action: 'edit', id, assignee: ''}, 'admin');
 assert.equal(departmentUpdates(s).length, 1, 'no duplicates for no-op edits');
 // A rejected assignment records nothing either.
 await assert.rejects(applyAction(s, {action: 'edit', id, assignee: 'Nowhere'}, 'admin'), /Unknown team/); assert.equal(departmentUpdates(s).length, 1);
 // Status changes: one entry per transition, in addition to the resident's own entry (unchanged behaviour).
 const residentBefore = residentEntries().length;
 await applyAction(s, {action: 'transition', id, status: 'Assigned', note: 'Assigned to Roads & Infrastructure.'}, 'admin');
 assert.equal(departmentUpdates(s).length, 2); assert.equal(residentEntries().length, residentBefore + 1, 'the resident still gets exactly one entry per transition');
 const t1 = departmentUpdates(s)[0]; assert.equal(t1.recipient, '9876500011'); assert.ok(t1.message.includes('is now Assigned') && t1.message.includes(c.title) && t1.message.includes(c.locality) && t1.message.includes('Ward 12') && t1.message.includes('Note: Assigned to Roads & Infrastructure.'), t1.message);
 assert.equal(residentEntries()[0].recipient, '9876543210', 'resident entries still go to the resident');
 await applyAction(s, {action: 'transition', id, status: 'In Progress', note: 'Work has started.'}, 'admin'); assert.equal(departmentUpdates(s).length, 3);
 await applyAction(s, {action: 'transition', id, status: 'On Hold', note: 'Waiting for material delivery.'}, 'admin'); assert.equal(departmentUpdates(s).length, 4);
 await assert.rejects(applyAction(s, {action: 'transition', id, status: 'Closed', note: 'Not allowed.'}, 'admin'), /OTP|Cannot move/); assert.equal(departmentUpdates(s).length, 4, 'a refused transition records nothing');
 // Reassigning tells the new department (not the old one); later transitions go to the new phone.
 await applyAction(s, {action: 'transition', id, status: 'In Progress', note: 'Work resumed.'}, 'admin'); await applyAction(s, {action: 'edit', id, assignee: 'Sanitation Team'}, 'admin');
 const reassigned = departmentUpdates(s)[0]; assert.equal(reassigned.recipient, '9123456789'); assert.ok(reassigned.message.startsWith('Sanitation Team: ') && reassigned.message.includes('New complaint assigned') && reassigned.message.includes('In Progress'));
 c.afterMedia = ['test-evidence']; const count = departmentUpdates(s).length;
 await applyAction(s, {action: 'transition', id, status: 'Resolution Proposed', note: 'Repair complete; photo attached.'}, 'admin'); assert.equal(departmentUpdates(s).length, count + 1); assert.equal(departmentUpdates(s)[0].recipient, '9123456789');
 // Resident-driven transitions tell the department as well.
 const code = await applyAction(s, {action: 'preview-closure-code', id}, 'resident', Date.now()); await applyAction(s, {action: 'verify-closure', id, code: code.demoCode}, 'resident', Date.now());
 assert.equal(c.status, 'Closed'); assert.equal(departmentUpdates(s).length, count + 2); assert.ok(departmentUpdates(s)[0].message.includes('is now Closed'));
 await applyAction(s, {action: 'dispute', id, note: 'The work is not finished. Call me on 9812345678.'}, 'resident', Date.now()); assert.equal(c.status, 'Reopened'); assert.equal(departmentUpdates(s).length, count + 3);
 assert.ok(departmentUpdates(s)[0].message.includes('is now Reopened') && !departmentUpdates(s)[0].message.includes('9812345678') && !departmentUpdates(s)[0].message.includes('not finished'), 'free text written by the resident is not forwarded to the department');
 assert.ok(departmentUpdates(s).every(m => m.status === 'Not sent · WhatsApp setup pending' && m.channel === 'WhatsApp' && m.complaintId === id));
});

test('department updates follow a renamed department by id, skip departments with no phone, and use the resident ward', async () => {
 const s = seedWorkspace(); await saveDepartments(s, [dept(), dept({name: 'Sanitation Team', contactName: 'Meena Rao', contactPhone: '9123456789'})]);
 s.wards = [{id: 'ward-9', number: '9', name: 'Gandhi Nagar (Ward 9)', active: true}]; s.residentProfiles = {'res-aaaa': {wardId: 'ward-9'}};
 const {id} = await applyAction(s, createBody, 'resident', 90000, 'Asha Verma', {...resident, wardNumber: '12'}); const c = s.complaints.find(x => x.id === id); assert.equal(id, 'JSS/70/W12/1');
 await applyAction(s, {action: 'edit', id, assignee: 'Roads & Infrastructure'}, 'admin'); assert.ok(departmentUpdates(s)[0].message.includes("Resident's ward: Gandhi Nagar (Ward 9)."), departmentUpdates(s)[0].message);
 // A ward stored on the complaint wins; then the resident's profile ward; then the ward code inside the complaint number ("Ward <code>"); a number with an unknown ward (W0) says nothing at all.
 delete s.residentProfiles; await applyAction(s, {action: 'transition', id, status: 'Acknowledged', note: 'Acknowledged.'}, 'admin'); assert.ok(departmentUpdates(s)[0].message.includes("Resident's ward: Ward 12."), departmentUpdates(s)[0].message);
 c.id = 'WC-W7-2026-ABCDEF123456'; s.communications.length = 0; await applyAction(s, {action: 'transition', id: c.id, status: 'Assigned', note: 'Assigned.'}, 'admin'); assert.ok(departmentUpdates(s)[0].message.includes("Resident's ward: Ward 7."), departmentUpdates(s)[0].message);
 // Rename: the complaint keeps 'Roads & Infrastructure' but the department (found by id) keeps receiving updates, at its current phone.
 const [roads, sanitation] = s.settings.departments; await saveDepartments(s, [{...roads, name: 'Public Works', contactPhone: '+91 99887 76655'}, sanitation]); assert.equal(c.assignee, 'Roads & Infrastructure');
 s.communications.length = 0; await applyAction(s, {action: 'transition', id: c.id, status: 'In Progress', note: 'Started.'}, 'admin'); assert.equal(departmentUpdates(s).length, 1); assert.equal(departmentUpdates(s)[0].recipient, '9988776655'); assert.ok(departmentUpdates(s)[0].message.startsWith('Public Works: '));
 // A department with no phone number (derived from the old team list) is skipped: no entry without a recipient. Resident entries are unaffected.
 const legacy = seedWorkspace(); const l = await applyAction(legacy, createBody, 'resident', 90000, 'Asha Verma', resident); await applyAction(legacy, {action: 'edit', id: l.id, assignee: 'Sanitation Team'}, 'admin'); await applyAction(legacy, {action: 'transition', id: l.id, status: 'Acknowledged', note: 'Acknowledged.'}, 'admin');
 assert.equal(departmentUpdates(legacy).length, 0); assert.equal(legacy.communications.length, 2); assert.ok(legacy.communications.every(m => m.recipient === '9876543210'));
 // Inactive departments keep receiving updates for the complaints they already hold.
 const [r2, s2] = s.settings.departments; await saveDepartments(s, [r2, {...s2, active: false}]); await applyAction(s, {action: 'edit', id: c.id, priority: 'High'}, 'admin'); assert.equal(departmentFor(s.settings, c).name, 'Public Works');
 const [r3, s3] = s.settings.departments; await saveDepartments(s, [{...r3, active: false}, {...s3, active: true}]); s.communications.length = 0; await applyAction(s, {action: 'transition', id: c.id, status: 'On Hold', note: 'Waiting for parts.'}, 'admin');
 assert.equal(departmentUpdates(s).length, 1, 'an inactive department still hears about complaints it already holds'); assert.equal(departmentUpdates(s)[0].recipient, '9988776655');
});

test('a complaint of an unknown ward tells the department nothing about a ward; a stored ward is named', async () => {
 const s = seedWorkspace(); await saveDepartments(s, [dept()]);
 const unknown = await applyAction(s, createBody, 'resident', 90000, 'Asha Verma', resident);
 assert.equal(unknown.id, 'JSS/70/W0/1'); await applyAction(s, {action: 'edit', id: unknown.id, assignee: 'Roads & Infrastructure'}, 'admin');
 const message = departmentUpdates(s)[0].message; assert.ok(message.includes('Status: Submitted.'), message); assert.equal(message.includes("Resident's ward"), false, message); assert.equal(/Ward 12|Jaipur/.test(message), false, 'no default ward is ever mentioned');
 s.wards = [{id: 'w-9', number: '9', name: 'Nehru Colony', active: true}]; s.communications.length = 0;
 const known = await applyAction(s, createBody, 'resident', 90000 + 70000, 'Asha Verma', {...resident, wardNumber: '9', wardId: 'w-9'}); assert.equal(known.id, 'JSS/70/W9/1');
 await applyAction(s, {action: 'edit', id: known.id, assignee: 'Roads & Infrastructure'}, 'admin'); assert.ok(departmentUpdates(s)[0].message.includes("Resident's ward: Nehru Colony."), departmentUpdates(s)[0].message);
});
