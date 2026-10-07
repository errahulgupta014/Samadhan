import test from 'node:test';
import assert from 'node:assert/strict';
import {buildModules} from './build-ts.mjs';
buildModules(['shared/domain', 'lib/service'], 'tests/.closure');
const {seedWorkspace} = await import('./.closure/domain.mjs');
const {applyAction, closureOtpOf} = await import('./.closure/service.mjs');

const resident = {residentId: 'res-aaaa', resident: {name: 'Asha Verma', mobile: '9876543210'}};
const createBody = {action: 'create', title: 'A damaged pathway', description: 'Damaged footpath beside the public park.', category: 'Road & Footpath', locality: 'Gandhi Nagar', lat: 26.91, lng: 75.78, media: ['m1'], consent: true};
const status = e => e?.code ?? e?.status;
/** A complaint that is waiting for the resident to confirm the work. */
async function proposed(configure) {
 const s = seedWorkspace(); configure?.(s);
 const {id} = await applyAction(s, createBody, 'resident', 1_000_000, 'Asha Verma', resident);
 const c = s.complaints.find(x => x.id === id);
 c.status = 'In Progress'; c.assignee = 'Roads & Infrastructure'; c.afterMedia = ['evidence'];
 await applyAction(s, {action: 'transition', id, status: 'Resolution Proposed', note: 'Work completed.'}, 'admin', 1_100_000, 'Admin');
 return {s, c, id};
}
const confirm = (s, id, code, now = 1_200_000) => applyAction(s, {action: 'verify-closure', id, code}, 'resident', now, 'Asha Verma', resident);

test('the closure code defaults to 123456, can be changed, and an empty value turns the universal code off', () => {
 assert.equal(closureOtpOf({}), '123456');
 assert.equal(closureOtpOf({closureOtp: '4321'}), '4321');
 assert.equal(closureOtpOf({closureOtp: ''}), '');
});
/** Resolves to the error text when the code is refused (a returned error or a thrown one), or null when it was accepted. */
const refused = async (s, id, code, now) => {try {const r = await confirm(s, id, code, now); return r?.error ?? null;} catch (e) {return e.message;}};
test('the default universal code closes a proposed complaint, even after the 5-minute window and after wrong tries', async () => {
 const {s, c, id} = await proposed();
 for (let i = 0; i < 7; i++) assert.ok(await refused(s, id, '000000'), 'a wrong code is refused');
 assert.equal(await refused(s, id, '123456', 1_100_000 + 3_600_000), null);
 assert.equal(c.status, 'Closed');
});
test('a changed closure code replaces the default for confirmation', async () => {
 const {s, c, id} = await proposed(w => {w.settings.closureOtp = '4321';});
 assert.ok(await refused(s, id, '123456'));
 assert.notEqual(c.status, 'Closed');
 assert.equal(await refused(s, id, '4321'), null);
 assert.equal(c.status, 'Closed');
});
test('with the universal code switched off every complaint gets its own random code', async () => {
 const {s, c, id} = await proposed(w => {w.settings.closureOtp = '';});
 assert.ok(s.challenges?.[id], 'a challenge was issued');
 assert.ok(await refused(s, id, '123456'));
 assert.notEqual(c.status, 'Closed');
});
test('only residents can confirm and only while the proposal is open; admins cannot save an invalid code', async () => {
 const {s, id} = await proposed();
 await assert.rejects(applyAction(s, {action: 'verify-closure', id, code: '123456'}, 'admin', 1_200_000, 'Admin'), e => status(e) === 403);
 for (const bad of ['12ab', '123', '123456789', '12 34']) await assert.rejects(applyAction(s, {action: 'settings', contact: 'Ward office hours', slaHours: 48, closureOtp: bad}, 'admin', 1_300_000, 'Admin'), /closure code/);
 await applyAction(s, {action: 'settings', contact: 'Ward office hours', slaHours: 48, closureOtp: '987654'}, 'admin', 1_300_000, 'Admin');
 assert.equal(s.settings.closureOtp, '987654');
});
test('the resolution target is the opening time plus the configured number of days (default 2)', async () => {
 const s = seedWorkspace();
 assert.equal(s.settings.slaHours, 48);
 const {id} = await applyAction(s, createBody, 'resident', Date.UTC(2026, 9, 6, 8, 0, 0), 'Asha Verma', resident);
 assert.equal(s.complaints.find(c => c.id === id).dueAt, new Date(Date.UTC(2026, 9, 8, 8, 0, 0)).toISOString());
 await applyAction(s, {action: 'settings', contact: 'Ward office hours', slaHours: 5 * 24}, 'admin', 1, 'Admin');
 const second = await applyAction(s, createBody, 'resident', Date.UTC(2026, 9, 6, 8, 0, 0) + 70_000, 'Asha Verma', resident);
 assert.equal(s.complaints.find(c => c.id === second.id).dueAt, new Date(Date.UTC(2026, 9, 11, 8, 1, 10)).toISOString());
});

// ---- Admin closes the complaint by entering the OTP the resident received on WhatsApp ----
const adminDo = (s, id, action, extra = {}, now = 1_200_000) => applyAction(s, {action, id, ...extra}, 'admin', now, 'Ward Officer');
const adminRefused = async (s, id, code, now) => {try {const r = await adminDo(s, id, 'admin-verify-closure', {code}, now); return r?.error ?? null;} catch (e) {return e.message;}};

test('an administrator closes a proposed resolution by entering the closure OTP', async () => {
 const {s, c, id} = await proposed();
 assert.equal(await adminRefused(s, id, '123456'), null);
 assert.equal(c.status, 'Closed');
 assert.match(c.history.at(-1).note, /verified by the administrator/);
 assert.equal(c.history.at(-1).actor, 'Ward Officer');
});
test('a wrong OTP does not close the complaint; with per-complaint codes five wrong tries lock it', async () => {
 const {s, c, id} = await proposed(w => {w.settings.closureOtp = '';});
 for (let i = 0; i < 5; i++) assert.equal(await adminRefused(s, id, '000000', 1_200_000 + i), 'Incorrect verification code.');
 assert.match(await adminRefused(s, id, '999999', 1_200_010), /expired or locked/);
 assert.notEqual(c.status, 'Closed');
});
test('the closure OTP of a complaint also works for the administrator when the universal code is off', async () => {
 const {s, c, id} = await proposed(w => {w.settings.closureOtp = '';});
 const code = (await applyAction(s, {action: 'preview-closure-code', id}, 'resident', 1_150_000, 'Asha Verma', resident)).demoCode;
 assert.ok(code, 'a per-complaint code exists');
 assert.equal(await adminRefused(s, id, code, 1_160_000), null);
 assert.equal(c.status, 'Closed');
});
test('an administrator can resend the closure OTP (60 s cooldown); only admins, only while the resolution awaits confirmation', async () => {
 const {s, id} = await proposed();
 await assert.rejects(adminDo(s, id, 'admin-issue-closure-code', {}, 1_100_500), /60 seconds/);
 const sent = await adminDo(s, id, 'admin-issue-closure-code', {}, 1_100_000 + 61_000);
 assert.equal(sent.channel, 'WhatsApp');
 await assert.rejects(applyAction(s, {action: 'admin-issue-closure-code', id}, 'resident', 1_300_000, 'Asha Verma', resident), e => status(e) === 403);
 await assert.rejects(applyAction(s, {action: 'admin-verify-closure', id, code: '123456'}, 'resident', 1_300_000, 'Asha Verma', resident), e => status(e) === 403);
});
test('the administrator cannot close without the OTP, and OTP actions need a proposed resolution', async () => {
 const s = seedWorkspace();
 const {id} = await applyAction(s, createBody, 'resident', 1_000_000, 'Asha Verma', resident);
 await assert.rejects(adminDo(s, id, 'admin-verify-closure', {code: '123456'}), e => status(e) === 403);
 const c = s.complaints.find(x => x.id === id); c.status = 'In Progress'; c.assignee = 'Roads & Infrastructure'; c.afterMedia = ['evidence'];
 await applyAction(s, {action: 'transition', id, status: 'Resolution Proposed', note: 'Work completed.'}, 'admin', 1_100_000, 'Admin');
 await assert.rejects(applyAction(s, {action: 'transition', id, status: 'Closed', note: 'Closing directly.'}, 'admin', 1_150_000, 'Admin'), /OTP verification is required/);
});

// ---- The single-row workspace stays under the size limit ----
const {capHistory, HISTORY_CAPS, MAX_WORKSPACE_BYTES} = await import('./.closure/service.mjs');
test('capHistory keeps only the newest communications and audit lines and always fits the size limit', () => {
 const s = seedWorkspace();
 s.communications = Array.from({length: HISTORY_CAPS.communications + 300}, (_, i) => ({id: 'c' + i, message: 'x'.repeat(40)}));
 s.audit = Array.from({length: HISTORY_CAPS.audit + 300}, (_, i) => ({id: 'a' + i, action: 'y'.repeat(40)}));
 const json = capHistory(s);
 assert.equal(s.communications.length, HISTORY_CAPS.communications); assert.equal(s.communications[0].id, 'c0', 'newest (first) entries are kept');
 assert.equal(s.audit.length, HISTORY_CAPS.audit); assert.equal(s.audit[0].id, 'a0');
 assert.ok(json.length <= MAX_WORKSPACE_BYTES); assert.deepEqual(JSON.parse(json).audit.length, HISTORY_CAPS.audit);
 const big = seedWorkspace(); big.communications = Array.from({length: 480}, (_, i) => ({id: 'c' + i, message: 'z'.repeat(6000)}));
 const tight = capHistory(big);
 assert.ok(tight.length <= MAX_WORKSPACE_BYTES, 'caps tighten when entries are large'); assert.ok(big.communications.length < 480);
});
