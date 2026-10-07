import test from 'node:test';
import assert from 'node:assert/strict';
import {buildModules} from './build-ts.mjs';
// Server-side parts of the Departments feature that need the projection and community modules (service-level rules live in workflow.test.mjs).
buildModules(['shared/domain', 'shared/community', 'shared/access', 'lib/service', 'lib/community-service', 'lib/projection', 'lib/access-policy', 'lib/media-access', 'lib/wards', 'lib/complaint-wards', 'lib/notifications', 'lib/resident-otp', 'lib/resident-profile', 'lib/live-content', 'lib/push'], 'tests/.departments');
const {seedWorkspace, teams: defaultTeams} = await import('./.departments/domain.mjs');
const {rolePresets, actionPermissions} = await import('./.departments/access.mjs');
const {applyAction, departmentsOf} = await import('./.departments/service.mjs');
const {applyCommunityAction, teamsOf, ensureCommunity} = await import('./.departments/community-service.mjs');
const {projectWorkspace} = await import('./.departments/projection.mjs');
const {requireAction} = await import('./.departments/access-policy.mjs');

const viewer = role => ({role, permissions: [...(rolePresets[role] ?? [])], email: 'owner@example.test'});
const who = (role, id = 'one') => ({role: role === 'Resident' ? 'resident' : 'admin', viewer: viewer(role), residentId: id, owner: 'tenant'});
const dept = (over = {}) => ({name: 'Roads & Infrastructure', contactName: 'Anil Sharma', contactPhone: '98765 00011', active: true, ...over});
const resident = {residentId: 'res-aaaa', resident: {name: 'Asha Verma', mobile: '9876543210'}};
const createBody = {action: 'create', title: 'A damaged pathway', description: 'Damaged footpath beside the public park.', category: 'Road & Footpath', locality: 'Gandhi Nagar', lat: 26.91, lng: 75.78, media: ['test-evidence'], consent: true};
/** What workspace-api does for an admin POST: community actions first, then the complaint workflow. */
const post = async (s, body) => applyCommunityAction(ensureCommunity(s), body, 'one', 'owner@example.test') ?? await applyAction(s, body, 'admin', Date.now(), 'owner@example.test');

test('save-departments is gated by settings.manage: only roles that manage settings may call it', () => {
 assert.equal(actionPermissions['save-departments'], 'settings.manage'); assert.equal(actionPermissions['save-teams'], 'settings.manage');
 for (const role of ['Super Admin', 'Ward Admin']) assert.doesNotThrow(() => requireAction(viewer(role), 'settings.manage'), role);
 for (const role of ['Complaint Officer', 'Content Editor', 'Auditor', 'Custom']) assert.throws(() => requireAction(viewer(role), 'settings.manage'), e => e.code === 403, role);
 assert.throws(() => requireAction(viewer('Resident'), 'settings.manage'), e => e.code === 403);
});

test('departments (with contact people and phone numbers) reach only administrators who read complaints or manage settings, never residents', async () => {
 const s = seedWorkspace(); ensureCommunity(s);
 // Before anything is saved: derived from the default team list, with empty contacts.
 const derived = projectWorkspace(s, who('Super Admin'), false).settings.departments; assert.deepEqual(derived.map(d => d.name), defaultTeams); assert.ok(derived.every(d => d.contactPhone === '' && d.contactName === '' && d.active));
 await post(s, {action: 'save-departments', departments: [dept({nameHi: 'लोक निर्माण परीक्षण'}), dept({name: 'Sanitation Team', contactName: 'Meena Rao', contactPhone: '9123456789', contactEmail: 'meena@example.org'}), dept({name: 'Old Wing', contactName: 'Old Hand', contactPhone: '9000000001', active: false})]});
 for (const role of ['Super Admin', 'Ward Admin', 'Complaint Officer', 'Auditor']) {
  const settings = projectWorkspace(s, who(role), false).settings;
  assert.deepEqual(settings.departments.map(d => [d.name, d.contactName, d.contactPhone, d.active]), [['Roads & Infrastructure', 'Anil Sharma', '9876500011', true], ['Sanitation Team', 'Meena Rao', '9123456789', true], ['Old Wing', 'Old Hand', '9000000001', false]], role);
  assert.deepEqual(settings.teams, ['Roads & Infrastructure', 'Sanitation Team'], `${role}: the legacy team list is the active department names`);
 }
 assert.equal('departments' in projectWorkspace(s, who('Custom'), false).settings, false, 'a Custom role with no permissions');
 const manageOnly = {role: 'Custom', permissions: ['settings.manage'], email: 'x@example.test'}; assert.equal(projectWorkspace(s, {...who('Super Admin'), viewer: manageOnly}, false).settings.departments.length, 3, 'settings.manage alone is enough');
 const readOnly = {role: 'Custom', permissions: ['complaints.read'], email: 'x@example.test'}; assert.equal(projectWorkspace(s, {...who('Super Admin'), viewer: readOnly}, false).settings.departments.length, 3, 'complaints.read alone is enough');
 for (const [principal, isResident, label] of [[who('Content Editor'), false, 'Content Editor'], [who('Resident'), true, 'resident'], [who('Super Admin'), true, 'administrator viewing as a resident'], [who('Resident', 'res-aaaa'), true, 'another resident']]) {
  const projected = projectWorkspace(s, principal, isResident); const json = JSON.stringify(projected);
  assert.equal('departments' in projected.settings, false, label); assert.equal('teams' in projected.settings, false, label);
  for (const secret of ['Anil Sharma', 'Meena Rao', '9876500011', '9123456789', 'meena@example.org', 'Old Hand', 'लोक निर्माण परीक्षण', 'Sanitation Team']) assert.equal(json.includes(secret), false, `${label} must not see ${secret}`);
 }
});

test('department updates recorded for a department phone are visible only to administrators with communications.read', async () => {
 const s = seedWorkspace(); ensureCommunity(s); await post(s, {action: 'save-departments', departments: [dept()]});
 const {id} = await applyAction(s, createBody, 'resident', 90000, 'Asha Verma', resident); await post(s, {action: 'edit', id, assignee: 'Roads & Infrastructure'});
 assert.equal(s.communications.filter(m => m.template === 'Department update').length, 1);
 for (const role of ['Super Admin', 'Ward Admin', 'Complaint Officer', 'Auditor']) assert.ok(projectWorkspace(s, who(role), false).communications.some(m => m.template === 'Department update' && m.recipient === '9876500011'), role);
 for (const [principal, isResident] of [[who('Content Editor'), false], [who('Resident', 'res-aaaa'), true], [who('Super Admin'), true]]) {const projected = projectWorkspace(s, principal, isResident); assert.deepEqual(projected.communications, []); assert.equal(JSON.stringify(projected).includes('9876500011'), false);}
 // A resident sees their own complaint and its assignee name, but never the department's contact.
 const own = projectWorkspace(s, who('Resident', 'res-aaaa'), true).complaints; assert.equal(own.length, 1); assert.equal(own[0].assignee, 'Roads & Infrastructure'); assert.equal(JSON.stringify(own).includes('Anil Sharma'), false);
});

test('legacy save-teams keeps working beside departments: names follow, contacts are kept, nothing is deleted', async () => {
 // Without saved departments only the legacy list is stored; departments stay derived from it.
 const fresh = seedWorkspace(); ensureCommunity(fresh); await post(fresh, {action: 'save-teams', teams: ['Ward office', 'Street Lighting']});
 assert.deepEqual(fresh.settings.teams, ['Ward office', 'Street Lighting']); assert.equal(fresh.settings.departments, undefined); assert.deepEqual(departmentsOf(fresh.settings).map(d => d.name), ['Ward office', 'Street Lighting']); assert.deepEqual(teamsOf(fresh.settings), ['Ward office', 'Street Lighting']);
 // With departments: matching names are reactivated (contact kept), new names are added without a contact, the others are deactivated.
 const s = seedWorkspace(); ensureCommunity(s); await post(s, {action: 'save-departments', departments: [dept(), dept({name: 'Sanitation Team', contactName: 'Meena Rao', contactPhone: '9123456789'}), dept({name: 'Old Wing', contactName: 'Old Hand', contactPhone: '9000000001', active: false})]});
 const [roads, sanitation, old] = s.settings.departments;
 await post(s, {action: 'save-teams', teams: ['  Old   Wing ', 'Roads & Infrastructure', 'Street Lighting']});
 assert.deepEqual(s.settings.teams, ['Old Wing', 'Roads & Infrastructure', 'Street Lighting']);
 assert.deepEqual(s.settings.departments.map(d => [d.name, d.active]), [['Old Wing', true], ['Roads & Infrastructure', true], ['Street Lighting', true], ['Sanitation Team', false]]);
 const byName = name => s.settings.departments.find(d => d.name === name);
 assert.deepEqual([byName('Old Wing').id, byName('Old Wing').contactPhone, byName('Roads & Infrastructure').id, byName('Roads & Infrastructure').contactName, byName('Sanitation Team').id, byName('Sanitation Team').contactPhone], [old.id, '9000000001', roads.id, 'Anil Sharma', sanitation.id, '9123456789'], 'ids and contacts survive a legacy team save');
 assert.deepEqual([byName('Street Lighting').contactName, byName('Street Lighting').contactPhone], ['', '']); assert.ok(byName('Street Lighting').id);
 assert.deepEqual(teamsOf(s.settings), ['Old Wing', 'Roads & Infrastructure', 'Street Lighting']);
 // A department with no contact details that is dropped from the team list leaves nothing behind; one with a contact is only deactivated.
 await post(s, {action: 'save-teams', teams: ['Old Wing', 'Roads & Infrastructure']});
 assert.deepEqual(s.settings.departments.map(d => [d.name, d.active]), [['Old Wing', true], ['Roads & Infrastructure', true], ['Sanitation Team', false]], 'Street Lighting had no contact: removed; Sanitation Team had one: kept inactive');
 await post(s, {action: 'save-teams', teams: ['Old Wing', 'Roads & Infrastructure', 'Street Lighting']});
 // The page can save the list straight back: the department that has no contact yet is allowed unchanged.
 await post(s, {action: 'save-departments', departments: s.settings.departments}); assert.equal(s.settings.departments.length, 4);
 // Legacy validation is unchanged.
 await assert.rejects(async () => post(s, {action: 'save-teams', teams: []}), /between 1 and 12/); await assert.rejects(async () => post(s, {action: 'save-teams', teams: ['Roads', 'roads']}), /twice/);
});
