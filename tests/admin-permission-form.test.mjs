import test from 'node:test';
import assert from 'node:assert/strict';
import {buildModules} from './build-ts.mjs';
// Unit tests for the permission checkboxes of the Add / Edit admin user form (lib/admin-permission-form.ts): defaults, preset fill, dependency rules, role switching.
buildModules(['shared/access', 'lib/admin-permission-form'], 'tests/.generated/permform');
const f = await import('./.generated/permform/admin-permission-form.mjs');
const {permissions, rolePresets} = await import('./.generated/permform/access.mjs');

test('the Add form opens as Custom with the default boxes ticked', () => {
 const form = f.defaultForm();
 assert.equal(form.role, 'Custom');
 assert.equal(form.basedOn, null);
 assert.deepEqual(form.permissions, ['complaints.read', 'complaints.manage', 'announcements.manage']);
 assert.deepEqual(f.DEFAULT_NEW_ADMIN_PERMISSIONS, form.permissions);
 assert.equal(f.problem(form), '');
});

test('picking a preset fills the boxes and remembers the preset', () => {
 for (const role of ['Super Admin', 'Ward Admin', 'Complaint Officer', 'Content Editor']) {
  const form = f.pickRole(f.defaultForm(), role);
  assert.equal(form.role, role);
  assert.equal(form.basedOn, role);
  assert.deepEqual(form.permissions, permissions.filter(p => rolePresets[role].includes(p)));
 }
 assert.ok(f.pickRole(f.defaultForm(), 'Super Admin').permissions.includes('admins.manage'));
 assert.ok(!f.pickRole(f.defaultForm(), 'Ward Admin').permissions.includes('admins.manage'));
});

test('any manual tick or untick switches to Custom and names the preset it came from', () => {
 const officer = f.pickRole(f.defaultForm(), 'Complaint Officer');
 const {form, note} = f.toggle(officer, 'communications.read', false);
 assert.equal(form.role, 'Custom');
 assert.equal(form.basedOn, 'Complaint Officer');
 assert.deepEqual(form.permissions, ['complaints.read', 'complaints.manage']);
 assert.equal(note, '');
 // a second change keeps the original preset name
 const again = f.toggle(form, 'city.manage', true).form;
 assert.equal(again.role, 'Custom');
 assert.equal(again.basedOn, 'Complaint Officer');
 assert.ok(again.permissions.includes('city.manage'));
 // from the defaults (already Custom) there is no preset to remember
 assert.equal(f.toggle(f.defaultForm(), 'city.manage', true).form.basedOn, null);
});

test('picking a preset after customising refills the boxes; Custom keeps them', () => {
 const custom = f.toggle(f.pickRole(f.defaultForm(), 'Content Editor'), 'city.manage', false).form;
 assert.equal(custom.role, 'Custom');
 const back = f.pickRole(custom, 'Content Editor');
 assert.deepEqual(back.permissions, permissions.filter(p => rolePresets['Content Editor'].includes(p)));
 assert.equal(back.role, 'Content Editor');
 const kept = f.pickRole(f.pickRole(f.defaultForm(), 'Ward Admin'), 'Custom');
 assert.equal(kept.role, 'Custom');
 assert.equal(kept.basedOn, 'Ward Admin');
 assert.deepEqual(kept.permissions, permissions.filter(p => p !== 'admins.manage'));
 assert.equal(f.pickRole(kept, 'Custom'), kept);
});

test('managing complaints needs reading them, both ways', () => {
 const none = {role: 'Custom', basedOn: null, permissions: []};
 const ticked = f.toggle(none, 'complaints.manage', true);
 assert.deepEqual(ticked.form.permissions, ['complaints.read', 'complaints.manage']);
 assert.match(ticked.note, /needs See complaints.*ticked/);
 const unticked = f.toggle(ticked.form, 'complaints.read', false);
 assert.deepEqual(unticked.form.permissions, []);
 assert.match(unticked.note, /unticked/);
 // reading alone can be unticked without a note
 const readOnly = f.toggle({role: 'Custom', basedOn: null, permissions: ['complaints.read']}, 'complaints.read', false);
 assert.equal(readOnly.note, '');
 assert.equal(f.problem(readOnly.form), 'Choose at least one permission');
 // permissions the form does not show (the removed log pages) do not count as a choice
 const hiddenOnly = {role: 'Custom', basedOn: null, permissions: ['communications.read']};
 assert.equal(f.problem(hiddenOnly), '');
 assert.equal(f.problem(hiddenOnly, ['complaints.read', 'complaints.manage']), 'Choose at least one permission');
 assert.equal(f.problem({role: 'Custom', basedOn: null, permissions: ['complaints.read']}, ['complaints.read']), '');
});

test('admins.manage can never be ticked by hand and never reaches a Custom role', () => {
 const custom = f.defaultForm();
 assert.equal(f.toggle(custom, 'admins.manage', true).form, custom);
 const superAdmin = f.pickRole(custom, 'Super Admin');
 assert.ok(superAdmin.permissions.includes('admins.manage'));
 const edited = f.toggle(superAdmin, 'city.manage', false).form;
 assert.equal(edited.role, 'Custom');
 assert.ok(!edited.permissions.includes('admins.manage'));
 assert.equal(edited.permissions.length, permissions.length - 2);
 assert.ok(!f.pickRole(superAdmin, 'Custom').permissions.includes('admins.manage'));
});

test('the edit form is pre-filled with the effective permissions', () => {
 const preset = f.formForUser({role: 'Complaint Officer', permissions: []});
 assert.deepEqual(preset.permissions, ['complaints.read', 'complaints.manage', 'communications.read']);
 assert.equal(preset.role, 'Complaint Officer');
 const custom = f.formForUser({role: 'Custom', permissions: ['city.manage', 'complaints.read']});
 assert.deepEqual(custom.permissions, ['complaints.read', 'city.manage']);
});

test('reset restores the defaults and the payload follows the server contract', () => {
 const messed = f.toggle(f.pickRole(f.defaultForm(), 'Ward Admin'), 'audit.read', false).form;
 assert.deepEqual(f.resetToDefaults(), f.defaultForm());
 assert.deepEqual(f.payload(f.pickRole(f.defaultForm(), 'Ward Admin')), {role: 'Ward Admin', permissions: []});
 assert.deepEqual(f.payload(messed), {role: 'Custom', permissions: messed.permissions});
 assert.deepEqual(f.payload(f.defaultForm()), {role: 'Custom', permissions: ['complaints.read', 'complaints.manage', 'announcements.manage']});
});
