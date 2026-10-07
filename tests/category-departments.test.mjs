import test from 'node:test';
import assert from 'node:assert/strict';
import {buildModules} from './build-ts.mjs';
buildModules(['shared/domain', 'lib/service'], 'tests/.catdept');
const {seedWorkspace} = await import('./.catdept/domain.mjs');
const {applyAction, departmentsOf, departmentChoicesOf} = await import('./.catdept/service.mjs');

const resident = {residentId: 'res-aaaa', resident: {name: 'Asha Verma', mobile: '9876543210'}, wardNumber: '12'};
const base = {nameEn: 'Stray animals', nameHi: 'आवारा पशु', icon: 'paw-outline', color: '#698194', sortOrder: 20, enabled: true};
const save = (s, category, now = 1_000_000) => applyAction(s, {action: 'save-category', category}, 'admin', now, 'Admin');
const report = (s, categoryId, now = 2_000_000) => applyAction(s, {action: 'create', title: 'A damaged pathway', description: 'Damaged footpath beside the public park.', categoryId, locality: 'Gandhi Nagar', lat: 26.91, lng: 75.78, media: ['m1'], consent: true}, 'resident', now, 'Asha Verma', resident);

test('a new category must name a department while active departments exist', async () => {
 const s = seedWorkspace();
 await assert.rejects(save(s, base), /Choose the department/);
 const dept = departmentsOf(s.settings).find(d => d.active);
 const {categoryId} = await save(s, {...base, departmentId: dept.id});
 assert.equal(s.categories.find(c => c.id === categoryId).departmentId, dept.id);
});
test('unknown and inactive departments are refused for a category', async () => {
 const s = seedWorkspace();
 await assert.rejects(save(s, {...base, departmentId: 'dept-nope'}), /Choose a department from the list/);
 const [first, second] = departmentsOf(s.settings);
 const contact = d => ({id: d.id, name: d.name, contactName: 'Officer Name', contactPhone: '9876500001', active: d.active});
 const all = departmentsOf(s.settings).map(contact); all[1].active = false;
 await applyAction(s, {action: 'save-departments', departments: all}, 'admin', 1, 'Admin');
 await assert.rejects(save(s, {...base, departmentId: second.id}), /inactive/);
 assert.ok(await save(s, {...base, departmentId: first.id}));
});
test('editing keeps the department unless another one is sent; an empty value clears it; legacy categories can still be switched', async () => {
 const s = seedWorkspace();
 const legacy = s.categories[0]; assert.equal(legacy.departmentId, undefined);
 await save(s, {id: legacy.id, nameEn: legacy.nameEn, nameHi: legacy.nameHi, icon: legacy.icon, color: legacy.color, sortOrder: legacy.sortOrder, enabled: false});
 assert.equal(s.categories[0].enabled, false, 'switching a legacy category needs no department');
 const [a, b] = departmentsOf(s.settings).filter(d => d.active);
 await save(s, {id: legacy.id, nameEn: legacy.nameEn, nameHi: legacy.nameHi, icon: legacy.icon, color: legacy.color, sortOrder: legacy.sortOrder, enabled: true, departmentId: a.id});
 await save(s, {id: legacy.id, nameEn: legacy.nameEn, nameHi: legacy.nameHi, icon: legacy.icon, color: legacy.color, sortOrder: legacy.sortOrder, enabled: true});
 assert.equal(s.categories[0].departmentId, a.id, 'omitted department is kept');
 await save(s, {id: legacy.id, nameEn: legacy.nameEn, nameHi: legacy.nameHi, icon: legacy.icon, color: legacy.color, sortOrder: legacy.sortOrder, enabled: true, departmentId: b.id});
 assert.equal(s.categories[0].departmentId, b.id);
 await save(s, {id: legacy.id, nameEn: legacy.nameEn, nameHi: legacy.nameHi, icon: legacy.icon, color: legacy.color, sortOrder: legacy.sortOrder, enabled: true, departmentId: ''});
 assert.equal(s.categories[0].departmentId, undefined);
});
test('a complaint is routed to the department of its category, and the department phone gets an update', async () => {
 const s = seedWorkspace();
 const dept = departmentsOf(s.settings).find(d => d.active);
 await applyAction(s, {action: 'save-departments', departments: departmentsOf(s.settings).map((d, i) => ({id: d.id, name: d.name, contactName: 'Officer Name', contactPhone: d.id === dept.id ? '9876500001' : '98765000' + (20 + i), active: d.active}))}, 'admin', 1, 'Admin');
 const {categoryId} = await save(s, {...base, departmentId: dept.id});
 const {id} = await report(s, categoryId);
 const c = s.complaints.find(x => x.id === id);
 assert.equal(c.assignee, dept.name); assert.equal(c.assigneeId, dept.id);
 const note = s.communications.find(m => m.template === 'Department update' && m.complaintId === id);
 assert.ok(note, 'department update recorded'); assert.equal(note.recipient, '9876500001');
 assert.doesNotMatch(note.message, /9876543210|Asha/, 'the resident phone and name are never sent to a department');
});
test('categories without a department, or whose department is inactive, leave the complaint unassigned', async () => {
 const s = seedWorkspace();
 const legacy = s.categories[0];
 assert.equal(s.complaints.length, 0);
 const first = await report(s, legacy.id); assert.equal(s.complaints.find(x => x.id === first.id).assignee, '');
 const [a] = departmentsOf(s.settings);
 const {categoryId} = await save(s, {...base, departmentId: a.id});
 await applyAction(s, {action: 'save-departments', departments: departmentsOf(s.settings).map((d, i) => ({id: d.id, name: d.name, contactName: 'Officer Name', contactPhone: '98765000' + (30 + i), active: i === 0 ? false : d.active}))}, 'admin', 3, 'Admin');
 const second = await report(s, categoryId, 2_100_000); assert.equal(s.complaints.find(x => x.id === second.id).assignee, '');
});

test('residents choose from active departments that have enabled categories (names only)', async () => {
 const s = seedWorkspace();
 assert.deepEqual(departmentChoicesOf(s), [], 'no category points at a department yet');
 const [a, b] = departmentsOf(s.settings);
 await save(s, {...base, departmentId: a.id});
 const second = (await save(s, {...base, nameEn: 'Dog bites', nameHi: 'कुत्ते का काटना', departmentId: b.id})).categoryId;
 assert.deepEqual(departmentChoicesOf(s).map(d => d.id), [a.id, b.id]);
 assert.deepEqual(Object.keys(departmentChoicesOf(s)[0]).sort(), ['id', 'name'], 'no contact details');
 s.categories.find(c => c.id === second).enabled = false;
 assert.deepEqual(departmentChoicesOf(s).map(d => d.id), [a.id], 'a department whose categories are all disabled is not offered');
});
