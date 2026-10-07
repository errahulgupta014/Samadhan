import test from 'node:test';
import assert from 'node:assert/strict';
import {buildModules} from './build-ts.mjs';
// The pure rules behind the Complaints table filters (lib/complaint-filters.ts), applied with the shared applyFilters from app/table-filters.ts.
buildModules(['shared/domain', 'shared/community', 'lib/service', 'lib/wards', 'lib/complaint-wards', 'app/table-filters', 'lib/complaint-filters'], 'tests/.generated/complaint-filters');
const T = await import('./.generated/complaint-filters/table-filters.mjs');
const C = await import('./.generated/complaint-filters/complaint-filters.mjs');
const {statuses} = await import('./.generated/complaint-filters/domain.mjs');

// Every instant is built from local calendar parts, so these tests hold in any time zone.
const at = (y, m, d, h = 12, mi = 0) => new Date(y, m - 1, d, h, mi).toISOString();
const NOW = new Date(2026, 9, 6, 12, 0).getTime();
const state = (patch = {}) => ({...T.emptyFilters(), ...patch});
const sel = values => state({values});
const departments = [
 {id: 'd-roads', name: 'Roads & Infrastructure', contactName: 'A', contactPhone: '9876500011', active: true},
 {id: 'd-water', name: 'Water & Drainage', contactName: 'B', contactPhone: '9876500012', active: true},
 {id: 'd-old', name: 'Old Wing', contactName: 'C', contactPhone: '9876500013', active: false},
 {id: 'd-idle', name: 'Idle Wing', contactName: '', contactPhone: '', active: false},
];
const make = (id, over = {}) => ({id, title: 'Broken pathway', description: 'x', category: 'Road & Footpath', locality: 'Gandhi Nagar', lat: 1, lng: 1, priority: 'Normal', status: 'Submitted', assignee: '', resident: 'R', mobile: '9', createdAt: at(2026, 10, 3), dueAt: at(2026, 10, 20), history: [], media: [], afterMedia: [], wardId: 'w12', wardLabel: 'Ward 12', ...over});
const rows = [
 make('JSS/26/W12/1', {title: 'Streetlight out near park', category: 'Streetlight & Electrical', priority: 'High', status: 'In Progress', assignee: 'Roads & Infrastructure', assigneeId: 'd-roads', createdAt: at(2026, 10, 1, 0, 0), dueAt: at(2026, 10, 2)}),
 make('JSS/26/W12/2', {title: 'Garbage not collected', category: 'Garbage & Cleaning', locality: 'Nehru Colony', status: 'Closed', assignee: 'Water & Drainage', assigneeId: 'd-water', createdAt: at(2026, 10, 6, 23, 59), dueAt: at(2026, 10, 1)}),
 make('JSS/26/W7/1', {title: 'Drain overflow', category: 'Drainage & Sewer', priority: 'Critical', status: 'Assigned', assignee: 'Roads & Infrastructure', wardId: 'w7', wardLabel: 'Ward 7 · Rampur', createdAt: at(2026, 10, 7, 0, 0), dueAt: at(2026, 10, 30)}),
 make('WC-W12-2026-ABCDEF123456', {title: 'Old legacy complaint', priority: 'Low', status: 'Rejected / Duplicate', assignee: 'Old Wing', assigneeId: 'd-old', wardId: '', wardLabel: '', createdAt: at(2026, 9, 30, 23, 59), dueAt: at(2026, 9, 5)}),
 make('JSS/26/W7/2', {title: 'Pothole on Station Road', locality: 'Station Road', status: 'Reopened', assignee: 'A department that was renamed', wardId: 'w7', wardLabel: 'Ward 7 · Rampur', createdAt: at(2026, 10, 5), dueAt: at(2026, 10, 4)}),
 make('JSS/26/W12/3', {title: 'Water tap leaking', category: 'Water', status: 'Acknowledged', createdAt: at(2026, 10, 4), dueAt: at(2026, 10, 30)}),
];
const spec = C.complaintFilterSpec(departments, () => NOW);
const ids = (patch) => T.applyFilters(rows, patch, spec).map(c => c.id);

test('no filters: every complaint, in the original order', () => {
 assert.deepEqual(ids(T.emptyFilters()), rows.map(c => c.id));
 assert.equal(T.hasActiveFilters(T.emptyFilters()), false);
});
test('search: every word must appear in the id, title, locality, department or ward label (case-insensitive)', () => {
 assert.deepEqual(ids(state({query: 'jss/26/w7/1'})), ['JSS/26/W7/1']);
 assert.deepEqual(ids(state({query: 'STREETLIGHT park'})), ['JSS/26/W12/1'], 'words in any order, any case');
 assert.deepEqual(ids(state({query: 'nehru'})), ['JSS/26/W12/2'], 'locality');
 assert.deepEqual(ids(state({query: 'water &'})), ['JSS/26/W12/2'], 'department name');
 assert.deepEqual(ids(state({query: 'rampur'})), ['JSS/26/W7/1', 'JSS/26/W7/2'], 'ward label');
 assert.deepEqual(ids(state({query: 'WC-W12'})), ['WC-W12-2026-ABCDEF123456'], 'legacy ids are searchable too');
 assert.deepEqual(ids(state({query: 'nothing matches this'})), []);
 assert.deepEqual(ids(state({query: '   '})), rows.map(c => c.id), 'blank search is no search');
});
test('status, priority and category are exact choices', () => {
 assert.deepEqual(ids(sel({status: 'Closed'})), ['JSS/26/W12/2']);
 assert.deepEqual(ids(sel({priority: 'High'})), ['JSS/26/W12/1']); assert.deepEqual(ids(sel({priority: 'Critical'})), ['JSS/26/W7/1']);
 assert.deepEqual(ids(sel({category: 'Water'})), ['JSS/26/W12/3']); assert.deepEqual(ids(sel({category: 'Road & Footpath'})), ['WC-W12-2026-ABCDEF123456', 'JSS/26/W7/2']);
 assert.deepEqual(ids(sel({status: 'No such status'})), []);
});
test('department: by the stored department id (a renamed department keeps its complaints), Unassigned, and names that match no department', () => {
 assert.deepEqual(ids(sel({department: 'dept:d-roads'})), ['JSS/26/W12/1', 'JSS/26/W7/1'], 'a complaint with no assigneeId is found by its department name');
 assert.deepEqual(ids(sel({department: 'dept:d-water'})), ['JSS/26/W12/2']); assert.deepEqual(ids(sel({department: 'dept:d-old'})), ['WC-W12-2026-ABCDEF123456'], 'inactive departments still filter the complaints they hold');
 assert.deepEqual(ids(sel({department: C.UNASSIGNED})), ['JSS/26/W12/3']);
 assert.deepEqual(ids(sel({department: 'name:A department that was renamed'})), ['JSS/26/W7/2']);
 const renamed = [{...departments[0], name: 'Public Works'}, ...departments.slice(1)]; const afterRename = C.complaintFilterSpec(renamed, () => NOW);
 assert.deepEqual(T.applyFilters(rows, sel({department: 'dept:d-roads'}), afterRename).map(c => c.id), ['JSS/26/W12/1', 'JSS/26/W7/1'].slice(0, 1), 'after a rename the complaint with the stored id still matches; one found only by the old name no longer does');
 assert.equal(C.assigneeValue({assignee: 'Roads & Infrastructure'}, departments), 'dept:d-roads'); assert.equal(C.assigneeValue({assignee: ' roads  &  infrastructure '}, departments), 'dept:d-roads', 'names compare ignoring case and spacing');
 assert.equal(C.assigneeValue({assignee: ''}, departments), C.UNASSIGNED); assert.equal(C.assigneeValue({}, departments), C.UNASSIGNED);
});
test('department options: Unassigned, the active departments, referenced inactive ones (marked), then unmatched names; idle inactive departments are left out', () => {
 const options = C.departmentFilterOptions(departments, rows);
 assert.deepEqual(options, [
  {value: C.UNASSIGNED, label: 'Unassigned'}, {value: 'dept:d-old', label: 'Old Wing (inactive)'}, {value: 'dept:d-roads', label: 'Roads & Infrastructure'}, {value: 'dept:d-water', label: 'Water & Drainage'},
  {value: 'name:A department that was renamed', label: 'A department that was renamed (not in the department list)'},
 ]);
 assert.deepEqual(C.departmentFilterOptions(departments, []).map(o => o.value), [C.UNASSIGNED, 'dept:d-roads', 'dept:d-water']);
 assert.deepEqual(C.departmentFilterOptions(undefined, []).map(o => o.value), [C.UNASSIGNED]);
});
test('created between: whole local days, From and To inclusive, either end optional, an invalid range is ignored', () => {
 const range = (from, to) => state({ranges: {created: {from, to}}});
 assert.deepEqual(ids(range('2026-10-01', '2026-10-06')), ['JSS/26/W12/1', 'JSS/26/W12/2', 'JSS/26/W7/2', 'JSS/26/W12/3'], '1 Oct 00:00 and 6 Oct 23:59 are both inside');
 assert.deepEqual(ids(range('2026-10-07', '2026-10-07')), ['JSS/26/W7/1'], 'a single day');
 assert.deepEqual(ids(range('2026-09-30', '2026-09-30')), ['WC-W12-2026-ABCDEF123456'], 'the last minute of a day belongs to that day');
 assert.deepEqual(ids(range('2026-10-06', '')), ['JSS/26/W12/2', 'JSS/26/W7/1'], 'open end'); assert.deepEqual(ids(range('', '2026-10-01')), ['JSS/26/W12/1', 'WC-W12-2026-ABCDEF123456'], 'open start');
 assert.deepEqual(ids(range('2026-10-08', '2026-10-01')), rows.map(c => c.id), 'From after To is not applied');
 assert.deepEqual(ids(range('2026-11-01', '2026-11-30')), []);
 assert.equal(T.rangeProblem({from: '2026-10-08', to: '2026-10-01'}) !== '', true);
 assert.deepEqual(T.applyFilters([make('x', {createdAt: 'not a date'}), make('y', {createdAt: ''})], range('2026-10-01', '2026-10-31'), spec), [], 'a complaint without a valid date never matches an active range');
});
test('ward: by ward id, "No ward recorded" for complaints without one', () => {
 assert.deepEqual(ids(sel({ward: 'w7'})), ['JSS/26/W7/1', 'JSS/26/W7/2']); assert.deepEqual(ids(sel({ward: 'w12'})), ['JSS/26/W12/1', 'JSS/26/W12/2', 'JSS/26/W12/3']);
 assert.deepEqual(ids(sel({ward: 'none'})), ['WC-W12-2026-ABCDEF123456']); assert.deepEqual(ids(sel({ward: 'w99'})), []);
});
test('progress: needs attention is every complaint that is not closed or rejected; resolved is closed', () => {
 assert.deepEqual(ids(sel({stage: 'attention'})), ['JSS/26/W12/1', 'JSS/26/W7/1', 'JSS/26/W7/2', 'JSS/26/W12/3']);
 assert.deepEqual(ids(sel({stage: 'resolved'})), ['JSS/26/W12/2']);
 assert.equal(rows.filter(c => C.isOpenComplaint(c)).length, 4); assert.equal(C.isOpenComplaint({status: 'Rejected / Duplicate'}), false); assert.equal(C.isOpenComplaint({status: 'Closed'}), false); assert.equal(C.isOpenComplaint({status: 'Reopened'}), true);
});
test('overdue only: open complaints past their resolution target at the time of filtering', () => {
 assert.deepEqual(ids(sel({overdue: 'yes'})), ['JSS/26/W12/1', 'JSS/26/W7/2'], 'closed and rejected complaints are never overdue, even past their target');
 assert.equal(C.isOverdueComplaint({status: 'Assigned', dueAt: at(2026, 10, 6, 11, 59)}, NOW), true); assert.equal(C.isOverdueComplaint({status: 'Assigned', dueAt: at(2026, 10, 6, 12, 1)}, NOW), false);
 let clock = NOW; const live = C.complaintFilterSpec(departments, () => clock);
 assert.deepEqual(T.applyFilters(rows, sel({overdue: 'yes'}), live).map(c => c.id), ['JSS/26/W12/1', 'JSS/26/W7/2']);
 clock = new Date(2026, 10, 15).getTime(); assert.deepEqual(T.applyFilters(rows, sel({overdue: 'yes'}), live).map(c => c.id), ['JSS/26/W12/1', 'JSS/26/W7/1', 'JSS/26/W7/2', 'JSS/26/W12/3'], 'later, more complaints are overdue');
});
test('filters combine with AND; clearing returns everything; the count equals the rows shown (and exported)', () => {
 assert.deepEqual(ids(state({query: 'ward 7', values: {status: 'Reopened'}, ranges: {created: {from: '2026-10-05', to: '2026-10-05'}}})), ['JSS/26/W7/2']);
 assert.deepEqual(ids(state({values: {department: 'dept:d-roads', stage: 'attention', priority: 'High'}})), ['JSS/26/W12/1']);
 assert.deepEqual(ids(state({values: {department: 'dept:d-roads', priority: 'Low'}})), [], 'no complaint satisfies both');
 const active = state({query: 'x', values: {status: 'Closed', priority: ''}, ranges: {created: {from: '2026-10-01', to: ''}}});
 assert.equal(T.activeFilterCount(active), 2, 'an empty choice is not an active filter'); assert.equal(T.hasActiveFilters(active), true);
 assert.deepEqual(ids(T.emptyFilters()), rows.map(c => c.id), 'Clear filters');
 assert.deepEqual(T.applyFilters([], sel({status: 'Closed'}), spec), []);
 assert.equal(rows.length, 6, 'the fixture is unchanged by filtering');
});
test('filter options: statuses, priorities (plus any unusual stored value), categories from the catalogue and the data, wards only when there are two or more', () => {
 const wards = [{id: 'w12', number: '12', name: 'Ward 12', active: true}, {id: 'w7', number: '7', name: 'Rampur', active: true}, {id: 'w3', number: '3', name: 'Ward 3', active: false}];
 const o = C.complaintFilterOptions({categories: [{nameEn: 'Water'}, {nameEn: 'Parks & Public Spaces'}], wards, departments, complaints: [...rows, make('z', {priority: 'Urgent', category: 'Retired category'})], statuses});
 assert.deepEqual(o.status.map(x => x.value), [...statuses]); assert.deepEqual(o.priority.map(x => x.value), ['Low', 'Normal', 'High', 'Critical', 'Urgent']);
 assert.deepEqual(o.category.map(x => x.value).slice(0, 2), ['Water', 'Parks & Public Spaces']); assert.ok(o.category.some(x => x.value === 'Retired category') && o.category.some(x => x.value === 'Road & Footpath'));
 assert.deepEqual(o.ward, [{value: 'w3', label: 'Ward 3 (inactive)'}, {value: 'w7', label: 'Ward 7 · Rampur'}, {value: 'w12', label: 'Ward 12'}, {value: 'none', label: 'No ward recorded'}]);
 assert.deepEqual(C.complaintFilterOptions({wards: wards.slice(0, 1), departments, complaints: rows, statuses}).ward, [], 'one ward: no ward filter'); assert.deepEqual(C.complaintFilterOptions({wards: [], complaints: [], statuses}).ward, []);
 assert.deepEqual(o.stage.map(x => x.value), ['attention', 'resolved']); assert.deepEqual(o.overdue.map(x => x.value), ['yes']);
});
