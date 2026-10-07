import test from 'node:test';
import assert from 'node:assert/strict';
import {buildModules} from './build-ts.mjs';
// The pure engine behind the admin Reports page (lib/report-engine.ts): filters, grouping, metrics, KPI cards, chart data, sorting, config storage and the CSV / JSON / Excel files.
buildModules(['shared/domain', 'shared/community', 'lib/service', 'lib/wards', 'lib/complaint-wards', 'lib/date-range', 'lib/complaint-filters', 'lib/report-engine'], 'tests/.generated/report-engine');
const E = await import('./.generated/report-engine/report-engine.mjs');
const D = await import('./.generated/report-engine/date-range.mjs');

// Every instant is built from local calendar parts, so these tests hold in any time zone (they are also run under several TZ values).
const at = (y, m, d, h = 12, mi = 0) => new Date(y, m - 1, d, h, mi).toISOString();
const NOW = new Date(2026, 9, 6, 12, 0).getTime(); // Tuesday 6 October 2026, 12:00
const NOW_DATE = new Date(NOW);

const categories = [
 {id: 'roads', nameEn: 'Road & Footpath', nameHi: '', icon: '', color: '#2473a0', sortOrder: 0, enabled: true},
 {id: 'garbage', nameEn: 'Garbage & Cleaning', nameHi: '', icon: '', color: '#ed9336', sortOrder: 1, enabled: true},
 {id: 'water', nameEn: 'Water', nameHi: '', icon: '', color: '#3a88b6', sortOrder: 2, enabled: true},
 {id: 'unused', nameEn: 'Unused idea', nameHi: '', icon: '', color: '#999999', sortOrder: 3, enabled: false},
];
const dept = (id, name, active = true) => ({id, name, contactName: '', contactPhone: '', active});
const departments = [dept('d-roads', 'Roads & Infrastructure'), dept('d-water', 'Water & Drainage'), dept('d-san', 'Sanitation Team'), dept('d-old', 'Old Wing', false)];
const wards = [{id: 'w12', number: '12', name: 'Ward 12', active: true}, {id: 'w7', number: '7', name: 'Rampur', active: true}];
const W12 = {wardId: 'w12', wardLabel: 'Ward 12'}, W7 = {wardId: 'w7', wardLabel: 'Ward 7 · Rampur'};
const make = (id, over = {}) => ({id, title: `Title ${id}`, description: 'x', categoryId: 'roads', category: 'Road & Footpath', locality: 'Gandhi Nagar', lat: 1, lng: 1, priority: 'Normal', status: 'Submitted', assignee: '', resident: 'Asha Verma', mobile: '9876543210',
 createdAt: at(2026, 10, 3), dueAt: at(2026, 10, 20), history: [], media: [], afterMedia: [], ...over});
const hist = (...entries) => entries.map(([status, when]) => ({status, note: '', at: when, actor: 'admin'}));
const A1 = make('JSS/26/W12/1', {createdAt: at(2026, 10, 1, 9), dueAt: at(2026, 10, 3, 9), priority: 'Critical', status: 'In Progress', assignee: 'Roads & Infrastructure', assigneeId: 'd-roads', ...W12, locality: 'Gandhi Nagar'});
const A2 = make('JSS/26/W12/2', {createdAt: at(2026, 10, 1, 10), dueAt: at(2026, 10, 3, 10), categoryId: 'garbage', category: 'Garbage & Cleaning', status: 'Closed', assignee: 'Sanitation Team', assigneeId: 'd-san', ...W12, locality: 'gandhi nagar ',
 history: hist(['Submitted', at(2026, 10, 1, 10)], ['Closed', at(2026, 10, 2, 10)])});
const A3 = make('JSS/26/W7/1', {createdAt: at(2026, 10, 2, 8), dueAt: at(2026, 10, 4, 8), categoryId: 'water', category: 'Water', priority: 'High', status: 'Closed', assignee: 'Water & Drainage', assigneeId: 'd-water', ...W7, locality: 'Station Road',
 history: hist(['Submitted', at(2026, 10, 2, 8)], ['Closed', at(2026, 10, 6, 8)], ['Reopened', at(2026, 10, 6, 8, 30)], ['Closed', at(2026, 10, 6, 9)])});
const A4 = make('WC-W0-2026-A4', {createdAt: at(2026, 10, 3, 12), dueAt: at(2026, 10, 20, 12), priority: 'Low', status: 'Submitted', locality: 'Station Road', wardId: '', wardLabel: ''});
const A5 = make('JSS/26/W7/2', {createdAt: at(2026, 10, 3, 13), dueAt: at(2026, 10, 5, 13), status: 'Rejected / Duplicate', assignee: 'Roads & Infrastructure', assigneeId: 'd-roads', ...W7, locality: 'Lane 7'});
const A6 = make('JSS/26/W7/3', {createdAt: at(2026, 10, 5, 9), dueAt: at(2026, 10, 5, 12), categoryId: 'water', category: 'Water', priority: 'Critical', status: 'Reopened', assignee: 'Water & Drainage', assigneeId: 'd-water', ...W7, locality: 'Lane 7',
 history: hist(['Submitted', at(2026, 10, 5, 9)], ['Closed', at(2026, 10, 5, 10)], ['Reopened', at(2026, 10, 5, 11)])});
const A7 = make('JSS/26/W12/3', {createdAt: at(2026, 10, 6, 7), dueAt: at(2026, 10, 8, 7), categoryId: 'garbage', category: 'Garbage & Cleaning', status: 'Assigned', assignee: 'Old Wing', assigneeId: 'd-old', ...W12, locality: 'Gandhi Nagar'});
const A8 = make('JSS/26/W12/0', {createdAt: at(2026, 9, 30, 23, 30), dueAt: at(2026, 10, 2), status: 'Closed', history: hist(['Closed', at(2026, 10, 1, 8)])}); // September: outside the default range
const A9 = make('JSS/26/W12/9', {createdAt: at(2026, 11, 1, 0, 10), dueAt: at(2026, 11, 3), categoryId: 'water', category: 'Water'}); // November
const complaints = [A1, A2, A3, A4, A5, A6, A7, A8, A9];
const residents = [
 {registeredAt: at(2026, 10, 1, 10), wardId: 'w12', wardLabel: 'Ward 12', language: 'en', blocked: false, complaintCount: 2, name: 'Secret Person One', mobile: '9876500001', email: 'one@example.test', address: '1 Hidden Road'},
 {registeredAt: at(2026, 10, 2, 9), wardId: 'w7', wardLabel: 'Ward 7 · Rampur', language: 'hi', blocked: true, complaintCount: 0, name: 'Secret Person Two', mobile: '9876500002', email: '', address: ''},
 {registeredAt: at(2026, 10, 5, 9), wardId: 'w12', wardLabel: 'Ward 12', language: 'hi', blocked: false, complaintCount: 1, name: 'Secret Person Three', mobile: '9876500003', email: '', address: ''},
 {registeredAt: at(2026, 9, 15, 9), wardId: 'w7', wardLabel: 'Ward 7 · Rampur', language: 'en', blocked: false, complaintCount: 0, name: 'Secret Person Four', mobile: '9876500004', email: '', address: ''},
 {registeredAt: null, wardId: '', wardLabel: '', language: 'en', blocked: false, complaintCount: 0, name: 'Secret Person Five', mobile: '9876500005', email: '', address: ''},
];
const input = {complaints, categories, departments, wards, slaHours: 48, residents};
const cfg = (over = {}, filters = {}) => {const d = E.defaultConfig(NOW_DATE); return {...d, ...over, filters: {...d.filters, ...filters}};};
const build = (over, filters, inp = input) => E.buildReport(inp, cfg(over, filters), NOW);
const col = (r, id) => r.columns.findIndex(c => c.id === id);
const cellsOf = (r, id) => r.rows.map(row => row.cells[col(r, id)]);
const labels = r => r.rows.map(row => row.cells[0]);
const kpi = (r, id) => r.kpis.find(k => k.id === id);

test('the default configuration is Summary by Category for this month with no filters', () => {
 const c = E.defaultConfig(NOW_DATE);
 assert.equal(c.type, 'category'); assert.deepEqual(c.filters.range, {preset: 'thisMonth', from: '2026-10-01', to: '2026-10-31'});
 assert.deepEqual(c.metrics, ['complaints', 'open', 'resolved', 'overdue', 'slaPct', 'avgDays']); assert.equal(c.includeResident, false);
 assert.equal(E.activeFilterCount(c.filters), 0); assert.equal(E.configProblem(c), '');
});

test('KPI definitions: open excludes closed and rejected, overdue is open past target, SLA met and days to close come from the FIRST Closed entry of closed complaints', () => {
 const r = build();
 assert.equal(r.recordCount, 7, 'September and November complaints are outside This month');
 assert.deepEqual(['total', 'open', 'resolved', 'overdue', 'sla', 'avgDays'].map(id => kpi(r, id).raw), [7, 4, 2, 2, 50, 2.5]);
 assert.equal(kpi(r, 'sla').value, '50%'); assert.equal(kpi(r, 'sla').caption, '1 of 2 closed on time'); assert.equal(kpi(r, 'avgDays').caption, 'Median 2.5 days');
 assert.equal(kpi(r, 'resolved').caption, '28.6% of the total');
 // A3 was closed, reopened and closed again: the first Closed entry (4 days after creation) counts, not the later one. A6 is Reopened: open again, no close time.
 assert.equal(E.closedAtOf(A3), new Date(2026, 9, 6, 8).getTime()); assert.equal(E.closedAtOf(A6), null); assert.equal(E.closedAtOf(A1), null);
 const empty = build({}, {status: 'Closed', category: 'Road & Footpath'}); assert.equal(kpi(empty, 'total').raw, 0); assert.equal(kpi(empty, 'sla').value, '—'); assert.equal(kpi(empty, 'avgDays').value, '—');
});

test('a missing or invalid due date falls back to created + SLA hours, so overdue and SLA met still work', () => {
 const noDue = make('X1', {createdAt: at(2026, 10, 1, 9), dueAt: 'garbage', status: 'Submitted'}); // due Oct 3 09:00 by the 48 h SLA: overdue at NOW
 const r = E.buildReport({...input, complaints: [noDue]}, cfg(), NOW); assert.equal(kpi(r, 'overdue').raw, 1);
 const r168 = E.buildReport({...input, complaints: [noDue], slaHours: 168}, cfg(), NOW); assert.equal(kpi(r168, 'overdue').raw, 0, 'a 7-day target (until 8 Oct) has not passed yet');
});

test('Summary by Category: groups by the live category, biggest first, with totals and shares; zero-count categories stay out', () => {
 const r = build({type: 'category'});
 assert.equal(r.title, 'Complaints by Category'); assert.deepEqual(labels(r), ['Road & Footpath', 'Garbage & Cleaning', 'Water']);
 assert.deepEqual(r.columns.map(c => c.label), ['Category', 'Complaints', 'Open', 'Resolved', 'Overdue', 'SLA met %', 'Avg days to close', '% of complaints']);
 assert.deepEqual(r.rows[0].cells, ['Road & Footpath', 3, 2, 0, 1, null, null, 42.9]);
 assert.deepEqual(r.rows[1].cells, ['Garbage & Cleaning', 2, 1, 1, 0, 100, 1, 28.6]);
 assert.deepEqual(r.rows[2].cells, ['Water', 2, 1, 1, 1, 0, 4, 28.6]);
 assert.deepEqual(r.totals, ['Total', 7, 4, 2, 2, 50, 2.5, 100]);
 assert.equal(r.chart.kind, 'bar'); assert.deepEqual(r.chart.items.map(i => i.value), [3, 2, 2]);
 assert.equal(r.recordNoun, 'complaints');
});

test('a renamed category keeps its complaints (found by id), a removed one is grouped by its stored name', () => {
 const renamed = categories.map(c => c.id === 'water' ? {...c, nameEn: 'Water supply'} : c);
 const r = E.buildReport({...input, categories: renamed}, cfg({type: 'category'}), NOW); assert.ok(labels(r).includes('Water supply')); assert.ok(!labels(r).includes('Water'));
 const gone = E.buildReport({...input, categories: categories.filter(c => c.id !== 'garbage')}, cfg({type: 'category'}), NOW); assert.ok(labels(gone).includes('Garbage & Cleaning'), 'stored name is used');
});

test('Summary by Status keeps the workflow order and draws a donut; Summary by Priority runs Critical to Low', () => {
 const s = build({type: 'status'});
 assert.deepEqual(labels(s), ['Submitted', 'Assigned', 'In Progress', 'Closed', 'Reopened', 'Rejected / Duplicate']); assert.deepEqual(cellsOf(s, 'complaints'), [1, 1, 1, 2, 1, 1]);
 assert.equal(s.chart.kind, 'donut'); assert.equal(s.chart.total, 7); assert.equal(s.chart.items.length, 6);
 const p = build({type: 'priority'});
 assert.deepEqual(labels(p), ['Critical', 'High', 'Normal', 'Low']); assert.deepEqual(cellsOf(p, 'complaints'), [2, 1, 3, 1]); assert.equal(p.chart.kind, 'donut');
 assert.equal(p.chart.items[0].color, '#b3261e', 'critical is red');
});

test('Summary by Department: by stored id (a renamed department keeps its complaints), Unassigned for none, inactive departments still counted', () => {
 const r = build({type: 'department'});
 assert.deepEqual(labels(r), ['Roads & Infrastructure', 'Water & Drainage', 'Old Wing', 'Sanitation Team', 'Unassigned']); assert.deepEqual(cellsOf(r, 'complaints'), [2, 2, 1, 1, 1]);
 const renamed = departments.map(d => d.id === 'd-water' ? {...d, name: 'Water Works'} : d);
 assert.ok(labels(E.buildReport({...input, departments: renamed}, cfg({type: 'department'}), NOW)).includes('Water Works'), 'complaints still carry the old name but follow the department id');
});

test('Summary by Ward: ward number order (7 before 12), "No ward recorded" last', () => {
 const r = build({type: 'ward'});
 assert.deepEqual(labels(r), ['Ward 7 · Rampur', 'Ward 12', 'No ward recorded']); assert.deepEqual(cellsOf(r, 'complaints'), [3, 3, 1]);
 const none = E.buildReport({...input, wards: []}, cfg({type: 'ward'}), NOW); assert.ok(none.notes.some(n => /No wards are set up/.test(n)) || labels(none).length >= 1);
});

test('Locality hotspots: free-text localities are grouped ignoring case and spaces, the most common spelling is shown, biggest first', () => {
 const r = build({type: 'localities'});
 assert.deepEqual(labels(r), ['Gandhi Nagar', 'Lane 7', 'Station Road']); assert.deepEqual(cellsOf(r, 'complaints'), [3, 2, 2]); assert.equal(r.title, 'Locality hotspots');
 const blank = E.buildReport({...input, complaints: [make('B1', {locality: '   ', createdAt: at(2026, 10, 2)})]}, cfg({type: 'localities'}), NOW); assert.deepEqual(labels(blank), ['Not recorded']);
});

test('every filter combines with AND and each one narrows on its own', () => {
 const n = (filters, over = {}) => build({type: 'register', ...over}, filters).recordCount;
 assert.equal(n({status: E.STATUS_OPEN_GROUP}), 4); assert.equal(n({status: E.STATUS_RESOLVED_GROUP}), 2); assert.equal(n({status: 'Closed'}), 2); assert.equal(n({status: 'Reopened'}), 1);
 assert.equal(n({category: 'Water'}), 2); assert.equal(n({priority: 'Critical'}), 2);
 assert.equal(n({department: 'unassigned'}), 1); assert.equal(n({department: 'dept:d-roads'}), 2); assert.equal(n({department: 'dept:d-old'}), 1);
 assert.equal(n({ward: 'w12'}), 3); assert.equal(n({ward: 'w7'}), 3); assert.equal(n({ward: 'none'}), 1);
 assert.equal(n({overdueOnly: true}), 2);
 assert.equal(n({query: 'gandhi'}), 3, 'locality'); assert.equal(n({query: 'station road'}), 2, 'every word must appear, in any order'); assert.equal(n({query: 'ROAD STATION'}), 2, 'case-insensitive');
 assert.equal(n({query: 'w12/2'}), 1, 'complaint id'); assert.equal(n({query: 'title jss/26/w7/3'}), 1, 'title and id words together'); assert.equal(n({query: 'nothing here'}), 0);
 assert.equal(n({status: E.STATUS_OPEN_GROUP, ward: 'w12'}), 2); assert.equal(n({status: E.STATUS_OPEN_GROUP, ward: 'w12', overdueOnly: true}), 1); assert.equal(n({status: 'Closed', overdueOnly: true}), 0);
 assert.equal(n({category: 'Water', priority: 'Critical', department: 'dept:d-water', ward: 'w7', status: 'Reopened', overdueOnly: true, query: 'lane'}), 1);
 const range = (from, to) => n({range: D.makeRange('custom', NOW_DATE) && {preset: 'custom', from, to}});
 assert.equal(range('2026-10-02', '2026-10-03'), 3, 'both ends inclusive'); assert.equal(range('2026-10-01', '2026-10-01'), 2); assert.equal(range('2026-09-30', '2026-09-30'), 1, 'late evening of 30 Sep'); assert.equal(range('2026-11-01', '2026-11-01'), 1);
 assert.equal(range('2026-10-31', '2026-10-31'), 0);
});

test('the headline reads like "Complaints by Category · 1 Oct 2026 – 31 Oct 2026 · Status: Open" and lists every active filter', () => {
 const r = build({type: 'category'}, {status: E.STATUS_OPEN_GROUP});
 assert.equal(r.headline, 'Complaints by Category · 1 Oct 2026 – 31 Oct 2026 · Status: Open'); assert.deepEqual(r.filterParts, ['1 Oct 2026 – 31 Oct 2026', 'Status: Open']);
 const all = build({type: 'register'}, {status: 'Reopened', category: 'Water', priority: 'Critical', department: 'dept:d-water', ward: 'w7', overdueOnly: true, query: ' lane '});
 assert.deepEqual(all.filterParts, ['1 Oct 2026 – 31 Oct 2026', 'Status: Reopened', 'Category: Water', 'Priority: Critical', 'Department: Water & Drainage', 'Ward: Ward 7 · Rampur', 'Overdue only', 'Search: "lane"']);
 assert.equal(build({type: 'status'}, {status: E.STATUS_RESOLVED_GROUP}).filterParts[1], 'Status: Resolved');
 assert.equal(E.activeFilterCount(cfg({}, {status: 'Closed', overdueOnly: true, query: ' x '}).filters), 3);
 assert.equal(build({type: 'status'}, {range: {preset: 'custom', from: '2026-10-05', to: '2026-10-05'}}).filterParts[0], '5 Oct 2026');
 assert.equal(new Date(r.generatedAt).getTime(), NOW);
});

test('Trend over time: one row per day with zeros filled in, days after today left out, a line chart of received and resolved', () => {
 const r = build({type: 'trend'});
 assert.equal(r.title, 'Complaint trend (daily)'); assert.deepEqual(labels(r), ['1 Oct 2026', '2 Oct 2026', '3 Oct 2026', '4 Oct 2026', '5 Oct 2026', '6 Oct 2026']);
 assert.deepEqual(cellsOf(r, 'complaints'), [2, 1, 2, 0, 1, 1]); assert.deepEqual(cellsOf(r, 'resolved'), [1, 1, 0, 0, 0, 0]); assert.deepEqual(r.totals.slice(0, 2), ['Total', 7]);
 assert.equal(r.chart.kind, 'line'); assert.equal(r.chart.points.length, 6); assert.deepEqual(r.chart.series.map(s => s.name), ['Received', 'Resolved']); assert.deepEqual(r.chart.series[0].values, [2, 1, 2, 0, 1, 1]);
 assert.equal(r.chart.points[0].label, '1 Oct'); assert.equal(r.chart.points[0].title, '1 Oct 2026');
 assert.deepEqual([kpi(r, 'busiest').value, kpi(r, 'busiest').raw, kpi(r, 'average').value], ['1 Oct', 2, '1.2']);
 // chosen units
 const w = build({type: 'trend', trendUnit: 'week'}); assert.equal(w.title, 'Complaint trend (weekly)'); assert.deepEqual(cellsOf(w, 'complaints'), [5, 2]); assert.deepEqual(labels(w), ['1 Oct 2026 – 4 Oct 2026', '5 Oct 2026 – 11 Oct 2026']); assert.equal(w.chart.kind, 'bar', 'two periods read better as bars');
 const m = build({type: 'trend', trendUnit: 'month'}); assert.deepEqual(labels(m), ['Oct 2026']); assert.deepEqual(cellsOf(m, 'complaints'), [7]);
 // Automatic follows the range length like the dashboard: a whole year is monthly.
 const year = build({type: 'trend'}, {range: {preset: 'custom', from: '2026-01-01', to: '2026-12-31'}}); assert.equal(year.title, 'Complaint trend (monthly)'); assert.deepEqual(cellsOf(year, 'complaints').slice(8, 11), [1, 7, 1], 'Sep, Oct and the November complaint');
 assert.equal(year.rows.length, 11, 'Jan to Nov: December has not come and is empty, so it is left out');
 // a complaint dated in the future is still counted and its day kept
 const future = E.buildReport({...input, complaints: [...complaints, make('F1', {createdAt: at(2026, 10, 9)})]}, cfg({type: 'trend'}), NOW); assert.equal(future.rows.length, 7, 'the six days so far plus 9 Oct; the empty days in between are left out'); assert.equal(future.rows.at(-1).cells[0], '9 Oct 2026'); assert.equal(future.totals[1], 8);
 // empty
 const none = build({type: 'trend'}, {query: 'zzzz'}); assert.equal(none.chart.kind, 'empty'); assert.equal(none.recordCount, 0);
});

test('time buckets agree with the dashboard buckets for the automatic unit and keep every day exactly once', () => {
 for (const [from, to] of [['2026-10-01', '2026-10-31'], ['2026-10-01', '2026-11-30'], ['2026-01-01', '2026-12-31'], ['2025-10-06', '2026-10-06'], ['2026-10-06', '2026-10-06']]) {
  const days = D.dayCount(from, to), unit = D.bucketUnit(days), mine = E.bucketsForUnit(from, to, unit), theirs = D.buckets(from, to).buckets;
  assert.deepEqual(mine.map(b => [b.key, b.from, b.to, b.short]), theirs.map(b => [b.key, b.from, b.to, b.label]), `${from}..${to} ${unit}`);
  assert.equal(E.trendUnitFor('auto', from, to), unit);
 }
 for (const unit of ['day', 'week', 'month']) {const list = E.bucketsForUnit('2026-02-10', '2026-04-20', unit); let days = 0; list.forEach((b, i) => {days += D.dayCount(b.from, b.to); if (i) assert.equal(D.addDays(list[i - 1].to, 1), b.from);}); assert.equal(days, D.dayCount('2026-02-10', '2026-04-20'), unit);}
 assert.deepEqual(E.bucketsForUnit('2026-10-10', '2026-10-09', 'day'), []);
 assert.equal(E.bucketsForUnit('2026-10-05', '2026-10-05', 'week')[0].label, '5 Oct 2026', 'a one-day bucket reads as a single date');
});

test('Resolution performance: resolved vs open, overdue, SLA met %, average and median days to close, and a donut that adds up to every complaint', () => {
 const r = build({type: 'resolution'});
 assert.equal(r.title, 'Resolution performance by Department'); assert.deepEqual(r.columns.map(c => c.id), ['group', 'complaints', 'open', 'resolved', 'overdue', 'slaPct', 'avgDays', 'medianDays', 'share']);
 assert.deepEqual(r.totals, ['Total', 7, 4, 2, 2, 50, 2.5, 2.5, 100]);
 const water = r.rows.find(row => row.cells[0] === 'Water & Drainage').cells; assert.deepEqual(water.slice(1, 8), [2, 1, 1, 1, 0, 4, 4]);
 assert.deepEqual(r.kpis.map(k => k.id), ['total', 'resolved', 'open', 'overdue', 'sla', 'avgDays', 'medianDays']); assert.equal(kpi(r, 'medianDays').value, '2.5');
 assert.equal(r.chart.kind, 'donut'); const parts = Object.fromEntries(r.chart.items.map(i => [i.key, i.value])); assert.deepEqual(parts, {ontime: 1, late: 1, within: 2, overdue: 2, rejected: 1}); assert.equal(r.chart.items.reduce((n, i) => n + i.value, 0), 7);
 const byCat = build({type: 'resolution', resolutionBy: 'category'}); assert.equal(byCat.title, 'Resolution performance by Category'); assert.equal(byCat.rows.length, 3);
 const byMonth = build({type: 'resolution', resolutionBy: 'month'}, {range: {preset: 'custom', from: '2026-09-01', to: '2026-10-31'}}); assert.deepEqual(labels(byMonth), ['Sep 2026', 'Oct 2026']); assert.equal(byMonth.rows[0].cells[2 - 1 + 0], 1, 'the September complaint');
 // odd cases: closed with no Closed entry in the timeline has no close time, so it is left out of SLA and averages
 const odd = E.buildReport({...input, complaints: [make('Z1', {status: 'Closed', createdAt: at(2026, 10, 2), history: []})]}, cfg({type: 'resolution'}), NOW);
 assert.equal(kpi(odd, 'resolved').raw, 1); assert.equal(kpi(odd, 'sla').value, '—'); assert.equal(odd.chart.items[0].key, 'unknown');
});

test('Ageing of open complaints: 0–2, 3–7, 8–14 and 15+ days, open complaints only, counted at generation time', () => {
 const r = build({type: 'ageing'});
 assert.equal(r.title, 'Ageing of open complaints'); assert.deepEqual(labels(r), ['0–2 days', '3–7 days', '8–14 days', '15+ days']); assert.deepEqual(cellsOf(r, 'open'), [2, 2, 0, 0]);
 assert.deepEqual(cellsOf(r, 'overdue'), [1, 1, 0, 0]); assert.deepEqual(cellsOf(r, 'share'), [50, 50, 0, 0]); assert.deepEqual(cellsOf(r, 'oldest'), [1, 5, null, null]); assert.deepEqual(cellsOf(r, 'avg'), [0.7, 4.1, null, null]);
 assert.deepEqual(r.totals, ['Total', 4, 100, 2, 5, 2.4]); assert.equal(r.recordCount, 4); assert.equal(r.recordNoun, 'open complaints');
 assert.equal(r.chart.kind, 'bar'); assert.equal(kpi(r, 'over7').value, '0%'); assert.equal(kpi(r, 'oldest').caption, 'Days · JSS/26/W12/1');
 // later the same complaints are older: 20 days on, everything is 15+
 const later = E.buildReport(input, cfg({type: 'ageing'}), NOW + 20 * 86400000); assert.deepEqual(cellsOf(later, 'open'), [0, 0, 0, 4]);
 // boundaries: exactly 3 days old is in 3–7, 2 days 23 h is in 0–2, 8 days in 8–14, 15 days in 15+
 const edge = ['2026-10-03T12:00', '2026-10-03T13:00', '2026-09-28T12:00', '2026-09-21T12:00'].map((d, i) => make(`E${i}`, {createdAt: new Date(d).toISOString()}));
 const b = E.buildReport({...input, complaints: edge}, cfg({type: 'ageing'}, {range: {preset: 'custom', from: '2026-09-01', to: '2026-10-31'}}), NOW); assert.deepEqual(cellsOf(b, 'open'), [1, 1, 1, 1]);
 const none = build({type: 'ageing'}, {status: 'Closed'}); assert.equal(none.chart.kind, 'empty'); assert.deepEqual(cellsOf(none, 'open'), [0, 0, 0, 0]);
 assert.ok(r.notes.some(n => /Only open complaints created in the chosen period/.test(n)));
});

test('Custom: group by any dimension with any metrics; the table follows the ticked metrics, the chart the first one', () => {
 const r = build({type: 'custom', group: 'outcome', metrics: ['complaints', 'overdue']});
 assert.equal(r.title, 'Complaint summary by Resolved / Open'); assert.deepEqual(r.columns.map(c => c.id), ['group', 'complaints', 'overdue', 'share']); assert.deepEqual(labels(r), ['Open', 'Resolved', 'Rejected / duplicate']); assert.deepEqual(cellsOf(r, 'complaints'), [4, 2, 1]);
 assert.equal(r.chart.kind, 'donut'); assert.equal(r.chart.valueLabel, 'Complaints');
 const sla = build({type: 'custom', group: 'category', metrics: ['slaPct']}); assert.equal(sla.title, 'SLA met % by Category'); assert.deepEqual(sla.columns.map(c => c.id), ['group', 'slaPct'], 'no share column without Complaints');
 assert.equal(sla.chart.kind, 'bar'); assert.equal(sla.chart.unit, 'pct'); assert.deepEqual(sla.chart.items.map(i => i.label), ['Garbage & Cleaning', 'Water'], 'groups with no closed complaint have no SLA value and are not charted');
 assert.ok(sla.notes.some(n => /closed complaints only/.test(n)));
 const single = build({type: 'custom', group: 'priority', metrics: ['open']}); assert.equal(single.title, 'Open complaints by Priority'); assert.equal(single.chart.valueLabel, 'Open');
 const days = build({type: 'custom', group: 'day', metrics: ['complaints', 'resolved', 'avgDays']}); assert.equal(days.chart.kind, 'line'); assert.deepEqual(days.chart.series.map(s => s.id), ['complaints', 'resolved'], 'only measures of the same kind share a line chart');
 const weeks = build({type: 'custom', group: 'week', metrics: ['complaints']}); assert.equal(weeks.rows.length, 2); const months = build({type: 'custom', group: 'month', metrics: ['complaints']}); assert.equal(months.rows.length, 1);
 // metrics are always in the canonical order and an empty tick list falls back to Complaints
 assert.deepEqual(E.resolveConfig(cfg({type: 'custom', metrics: ['avgDays', 'complaints']})).metrics, ['complaints', 'avgDays']); assert.deepEqual(E.resolveConfig(cfg({type: 'custom', metrics: []})).metrics, ['complaints']);
});

test('Custom cross-tab: Category × Status as a matrix with row and column totals and a stacked chart', () => {
 const r = build({type: 'custom', group: 'category', thenBy: 'status'});
 assert.equal(r.title, 'Complaints by Category and Status'); assert.deepEqual(r.columns.map(c => c.label), ['Category', 'Submitted', 'Assigned', 'In Progress', 'Closed', 'Reopened', 'Rejected / Duplicate', 'Total']);
 assert.deepEqual(r.rows.map(row => row.cells), [['Road & Footpath', 1, 0, 1, 0, 0, 1, 3], ['Garbage & Cleaning', 0, 1, 0, 1, 0, 0, 2], ['Water', 0, 0, 0, 1, 1, 0, 2]]);
 assert.deepEqual(r.totals, ['Total', 1, 1, 1, 2, 1, 1, 7]);
 assert.equal(r.chart.kind, 'stacked'); assert.deepEqual(r.chart.series.map(s => s.label), r.columns.slice(1, 7).map(c => c.label)); assert.deepEqual(r.chart.rows[0], {key: 'Road & Footpath', label: 'Road & Footpath', values: [1, 0, 1, 0, 0, 1], total: 3});
 assert.equal(r.chart.series[3].color, '#23815e', 'Closed is green');
 // another value in the cells
 const od = build({type: 'custom', group: 'category', thenBy: 'status', cellMetric: 'overdue'}); assert.equal(od.title, 'Overdue complaints by Category and Status'); assert.deepEqual(od.totals, ['Total', 0, 0, 1, 0, 1, 0, 2]);
 // a non-count cell metric falls back to Complaints; a Then by equal to the group, or a day/week, is dropped
 assert.equal(E.resolveConfig(cfg({type: 'custom', thenBy: 'status', cellMetric: 'slaPct'})).cellMetric, 'complaints'); assert.equal(E.resolveConfig(cfg({type: 'custom', group: 'status', thenBy: 'status'})).thenBy, ''); assert.equal(E.resolveConfig(cfg({type: 'custom', thenBy: 'day'})).thenBy, '');
 // by month spreads across month columns, in order
 const mm = build({type: 'custom', group: 'category', thenBy: 'month'}, {range: {preset: 'custom', from: '2026-09-01', to: '2026-11-30'}}); assert.deepEqual(mm.columns.map(c => c.label), ['Category', 'Sep 2026', 'Oct 2026', 'Nov 2026', 'Total']);
 // cross-tabs by time keep chronological row order
 const dd = build({type: 'custom', group: 'day', thenBy: 'priority'}); assert.deepEqual(labels(dd), ['1 Oct 2026', '2 Oct 2026', '3 Oct 2026', '4 Oct 2026', '5 Oct 2026', '6 Oct 2026']);
 assert.equal(build({type: 'custom', group: 'category', thenBy: 'status'}, {query: 'zzz'}).chart.kind, 'empty');
});

test('Custom cross-tab: more than 12 columns keep the most common values and merge the rest into Other; long bar charts keep the largest and add up the rest', () => {
 const many = Array.from({length: 15}, (_, i) => make(`L${i}`, {locality: `Colony ${String.fromCharCode(65 + i)}`, createdAt: at(2026, 10, 2 + (i % 3)), ...(i < 3 ? {locality: 'Colony A'} : {})}));
 const r = E.buildReport({...input, complaints: many}, cfg({type: 'custom', group: 'category', thenBy: 'locality'}), NOW);
 assert.equal(r.columns.length, 1 + 12 + 1); assert.match(r.columns[r.columns.length - 2].label, /^Other \(\d+\)$/);
 assert.equal(r.totals.at(-1), 15); assert.equal(r.totals.slice(1, -1).reduce((n, v) => n + v, 0), 15, 'merging loses nothing');
 const bars = E.buildReport({...input, complaints: many}, cfg({type: 'localities'}), NOW); assert.equal(bars.chart.kind, 'bar'); assert.equal(bars.chart.items.length, E.CHART_TOP + 1); assert.match(bars.chart.items.at(-1).label, /^Other/);
 assert.equal(bars.chart.items.reduce((n, i) => n + i.value, 0), 15); assert.equal(bars.rows.length, 13, 'the table still lists every locality'); assert.match(bars.chart.note, /Showing the 10 largest of 13 groups/);
});

test('Complaint register: one row per complaint, newest first, dates and days, no resident details by default', () => {
 const r = build({type: 'register'});
 assert.deepEqual(r.columns.map(c => c.id), ['id', 'title', 'category', 'department', 'ward', 'priority', 'status', 'created', 'due', 'closed', 'daysOpen', 'daysToClose', 'locality']);
 assert.deepEqual(r.rows.map(row => row.key), [A7.id, A6.id, A5.id, A4.id, A3.id, A2.id, A1.id]); assert.equal(r.totals, null);
 const row = id => r.rows.find(x => x.key === id).cells;
 assert.deepEqual(row(A3.id), [A3.id, 'Title JSS/26/W7/1', 'Water', 'Water & Drainage', 'Ward 7 · Rampur', 'High', 'Closed', '2026-10-02', '2026-10-04', '2026-10-06', null, 4, 'Station Road']);
 assert.deepEqual(row(A1.id).slice(7), ['2026-10-01', '2026-10-03', null, 5.1, null, 'Gandhi Nagar'], 'open: days open since creation, no closed date');
 assert.deepEqual(row(A4.id).slice(2, 5), ['Road & Footpath', 'Unassigned', 'No ward recorded']); assert.equal(row(A6.id)[9], null, 'a reopened complaint has no closed date');
 const text = JSON.stringify(r); assert.ok(!text.includes('Asha Verma') && !text.includes('9876543210'), 'resident name and mobile never appear unless asked'); assert.equal(r.includesResidentDetails, false);
 assert.ok(r.notes.some(n => /not included/.test(n))); assert.equal(r.chart.kind, 'line'); assert.equal(r.chart.title, 'Complaints received per day');
 // ticking "Include resident details" adds exactly two columns
 const withResident = build({type: 'register', includeResident: true}); assert.deepEqual(withResident.columns.slice(-2).map(c => c.label), ['Resident name', 'Resident mobile']); assert.deepEqual(withResident.rows[0].cells.slice(-2), ['Asha Verma', '9876543210']);
 assert.equal(withResident.includesResidentDetails, true); assert.ok(withResident.notes.some(n => /resident names and mobile numbers/.test(n)));
});

test('privacy: grouped reports and the app-users report never contain resident names, mobile numbers, e-mails or addresses, even when asked for the register option', () => {
 for (const type of ['category', 'department', 'ward', 'status', 'priority', 'trend', 'resolution', 'ageing', 'localities', 'custom', 'users']) {
  const text = JSON.stringify(build({type, includeResident: true, group: 'locality', thenBy: 'status'}));
  for (const secret of ['Asha Verma', '9876543210', 'Secret Person', '98765000', 'example.test', 'Hidden Road']) assert.ok(!text.includes(secret), `${type} leaks ${secret}`);
  assert.equal(JSON.parse(text).includesResidentDetails, false, type);
 }
});

test('App users registrations: counts by month, ward and language, filtered by registration date and ward', () => {
 const m = build({type: 'users'});
 assert.equal(m.title, 'App users registrations by Month'); assert.deepEqual(m.columns.map(c => c.label), ['Month', 'Registrations', '% of registrations', 'Blocked', 'With complaints']); assert.deepEqual(m.rows.map(r => r.cells), [['Oct 2026', 3, 100, 1, 2]]); assert.deepEqual(m.totals, ['Total', 3, 100, 1, 2]);
 assert.equal(m.recordCount, 3); assert.equal(m.recordNoun, 'app users'); assert.deepEqual(m.kpis.map(k => k.raw), [3, 1, 2, 2, 1]); assert.deepEqual(m.filterParts, ['1 Oct 2026 – 31 Oct 2026']);
 assert.ok(m.notes.some(n => /1 user without a registration date is left out/.test(n)));
 const w = build({type: 'users', userGroup: 'ward'}); assert.deepEqual(w.rows.map(r => r.cells.slice(0, 2)), [['Ward 7 · Rampur', 1], ['Ward 12', 2]]); assert.equal(w.chart.kind, 'bar');
 const l = build({type: 'users', userGroup: 'language'}); assert.deepEqual(l.rows.map(r => r.cells.slice(0, 2)), [['English', 1], ['Hindi', 2]]); assert.equal(l.chart.kind, 'donut'); assert.deepEqual(l.chart.items.map(i => i.value), [1, 2]);
 const ward = build({type: 'users', userGroup: 'ward'}, {ward: 'w12'}); assert.equal(ward.recordCount, 2); assert.deepEqual(ward.filterParts, ['1 Oct 2026 – 31 Oct 2026', 'Ward: Ward 12']);
 const ignores = build({type: 'users'}, {status: 'Closed', category: 'Water', overdueOnly: true, query: 'zz'}); assert.equal(ignores.recordCount, 3, 'complaint filters do not apply to app users'); assert.deepEqual(ignores.filterParts, ['1 Oct 2026 – 31 Oct 2026']);
 const wide = build({type: 'users'}, {range: {preset: 'custom', from: '2026-07-01', to: '2026-12-31'}}); assert.equal(wide.chart.kind, 'line'); assert.deepEqual(wide.rows.map(r => [r.cells[0], r.cells[1]]), [['Jul 2026', 0], ['Aug 2026', 0], ['Sep 2026', 1], ['Oct 2026', 3]], 'months that have not come yet are left out');
 const text = JSON.stringify([m, w, l, wide]); for (const secret of ['Secret Person', '98765000', 'example.test', 'Hidden Road']) assert.ok(!text.includes(secret));
 assert.equal(build({type: 'users'}, {}, {...input, residents: undefined}).recordCount, 0);
});

test('sorting: numbers numerically, text naturally and case-insensitively, empty cells last in both directions, stable, periods by their real date', () => {
 const columns = [{id: 'name', label: 'Name', kind: 'text'}, {id: 'n', label: 'N', kind: 'int'}, {id: 'd', label: 'D', kind: 'days'}];
 const rows = [{key: 'a', cells: ['Ward 10', 5, null]}, {key: 'b', cells: ['ward 2', 20, 1.5]}, {key: 'c', cells: ['Ward 1', 5, 0.5]}, {key: 'd', cells: ['Ward 3', null, 2]}];
 const keys = sort => E.sortRows(columns, rows, sort).map(r => r.key).join('');
 assert.equal(keys(null), 'abcd'); assert.equal(keys({col: 'name', dir: 'asc'}), 'cbda'); assert.equal(keys({col: 'name', dir: 'desc'}), 'adbc');
 assert.equal(keys({col: 'n', dir: 'asc'}), 'acbd', 'stable for equal numbers, empty last'); assert.equal(keys({col: 'n', dir: 'desc'}), 'bacd', 'empty still last');
 assert.equal(keys({col: 'd', dir: 'asc'}), 'cbda'); assert.equal(keys({col: 'd', dir: 'desc'}), 'dbca'); assert.equal(keys({col: 'nope', dir: 'asc'}), 'abcd'); assert.deepEqual(rows.map(r => r.key), ['a', 'b', 'c', 'd'], 'the report is not modified');
 const trend = build({type: 'trend', trendUnit: 'day'}), desc = E.sortRows(trend.columns, trend.rows, {col: 'group', dir: 'desc'}); assert.deepEqual(desc.map(r => r.cells[0]).slice(0, 2), ['6 Oct 2026', '5 Oct 2026'], 'not alphabetical: "6 Oct" before "5 Oct" would be wrong');
 const asc = E.sortRows(trend.columns, trend.rows, {col: 'group', dir: 'asc'}); assert.equal(asc[0].cells[0], '1 Oct 2026');
 const reg = build({type: 'register'}); assert.equal(E.sortRows(reg.columns, reg.rows, {col: 'created', dir: 'asc'})[0].key, A1.id); assert.equal(E.sortRows(reg.columns, reg.rows, {col: 'daysToClose', dir: 'desc'})[0].key, A3.id);
 assert.deepEqual(E.sortRows(reg.columns, reg.rows, {col: 'id', dir: 'asc'}).map(r => r.key), ['JSS/26/W7/1', 'JSS/26/W7/2', 'JSS/26/W7/3', 'JSS/26/W12/1', 'JSS/26/W12/2', 'JSS/26/W12/3', 'WC-W0-2026-A4'], 'ids sort naturally: W7 before W12, /2 before /10');
 assert.equal(E.sortRows(reg.columns, reg.rows, {col: 'created', dir: 'desc'})[0].key, A7.id); assert.deepEqual(E.sortRows(reg.columns, reg.rows, {col: 'created', dir: 'asc'}).slice(0, 2).map(r => r.key), [A1.id, A2.id], 'same day: the earlier one first (sorted by the exact time)');
});

test('display of cells: dashes for empty, % and one decimal, readable dates', () => {
 const c = k => ({id: 'x', label: 'X', kind: k});
 assert.equal(E.displayCell(null, c('int')), '—'); assert.equal(E.displayCell('', c('text')), '—'); assert.equal(E.displayCell(3, c('int')), '3'); assert.equal(E.displayCell(42.9, c('pct')), '42.9%'); assert.equal(E.displayCell(100, c('pct')), '100%');
 assert.equal(E.displayCell(2.5, c('days')), '2.5'); assert.equal(E.displayCell(4, c('days')), '4'); assert.equal(E.displayCell('2026-10-02', c('date')), '2 Oct 2026'); assert.equal(E.displayCell('Hello', c('text')), 'Hello');
 assert.deepEqual([E.fmtNum(12), E.fmtNum(12.5), E.fmtNum(12.04), E.fmtNum(2.45), E.dayLabel('2026-02-30')], ['12', '12.5', '12', '2.5', '']);
});

test('CSV: UTF-8 with a BOM, every cell quoted, quotes doubled, CRLF lines, totals row last, formula-looking text defused with an apostrophe', () => {
 const evil = make('Q1', {title: '=HYPERLINK("http://evil.test","x")', locality: '+91 98765', createdAt: at(2026, 10, 2)}), minus = make('Q2', {title: '-2+3', locality: '@SUM(A1)', createdAt: at(2026, 10, 2)}), tab = make('Q3', {title: '\tcmd', locality: '  =cmd|calc', createdAt: at(2026, 10, 2)});
 const quote = make('Q4', {title: 'Say "hello", then\nleave', locality: 'Ünïcode — हिन्दी', createdAt: at(2026, 10, 2)});
 const r = E.buildReport({...input, complaints: [evil, minus, tab, quote]}, cfg({type: 'register'}), NOW), csv = E.toCsv(r);
 assert.equal(csv.charCodeAt(0), 0xFEFF, 'byte order mark'); assert.ok(csv.endsWith('\r\n'));
 const body = csv.slice(1); assert.ok(!/(^|\r\n)[^"]/.test(body.replace(/"(?:[^"]|"")*"/g, '""')), 'only quoted cells');
 assert.ok(csv.includes('"\'=HYPERLINK(""http://evil.test"",""x"")"'), 'formula defused, inner quotes doubled'); assert.ok(csv.includes('"\'+91 98765"')); assert.ok(csv.includes('"\'-2+3"')); assert.ok(csv.includes('"\'@SUM(A1)"')); assert.ok(csv.includes('"\'\tcmd"')); assert.ok(csv.includes('"\'=cmd|calc"'), 'spaces around a locality are tidied first');
 assert.ok(csv.includes('"Say ""hello"", then\nleave"')); assert.ok(csv.includes('Ünïcode — हिन्दी'));
 for (const cell of body.match(/"(?:[^"]|"")*"/g)) assert.ok(!/^"\s*[=+\-@\t\r]/.test(cell), `a cell starts like a formula: ${cell}`);
 assert.equal(E.csvCell(-3), '"-3"', 'a real negative number is not text'); assert.equal(E.csvCell(2.5), '"2.5"'); assert.equal(E.csvCell(null), '""'); assert.equal(E.csvCell('plain'), '"plain"'); assert.equal(E.csvCell('="x"'), '"\'=""x"""');
 assert.equal(E.csvCell('2026-10-01'), '"2026-10-01"', 'a leading digit or a date is safe'); assert.equal(E.csvCell('Ward 7 · Rampur'), '"Ward 7 · Rampur"');
 // summary report: header, rows in the order given, totals last
 const cat = build({type: 'category'}), lines = E.toCsv(cat).slice(1).split('\r\n');
 assert.equal(lines[0], '"Category","Complaints","Open","Resolved","Overdue","SLA met %","Avg days to close","% of complaints"'); assert.equal(lines[1], '"Road & Footpath","3","2","0","1","","","42.9"'); assert.equal(lines.at(-2), '"Total","7","4","2","2","50","2.5","100"'); assert.equal(lines.length, 3 + 2 + 1 - 1 + 1);
 // the order of the rows given is the order exported (the sort on screen)
 const sorted = E.sortRows(cat.columns, cat.rows, {col: 'group', dir: 'asc'}); assert.deepEqual(E.toCsv(cat, sorted).slice(1).split('\r\n').slice(1, 4).map(l => l.split(',')[0]), ['"Garbage & Cleaning"', '"Road & Footpath"', '"Water"']);
});

test('JSON: title, filters, generated time, KPIs, columns, rows keyed by column id in the order shown, and totals', () => {
 const cat = build({type: 'category'}, {status: E.STATUS_OPEN_GROUP}), j = JSON.parse(E.toJson(cat, E.sortRows(cat.columns, cat.rows, {col: 'complaints', dir: 'asc'}))).report;
 assert.equal(j.title, 'Complaints by Category'); assert.deepEqual(j.filters, ['1 Oct 2026 – 31 Oct 2026', 'Status: Open']); assert.equal(j.generatedAt, new Date(NOW).toISOString()); assert.equal(j.recordCount, 4); assert.equal(j.from, '2026-10-01');
 assert.deepEqual(j.columns.map(c => c.id), ['group', 'complaints', 'open', 'resolved', 'overdue', 'slaPct', 'avgDays', 'share']);
 assert.deepEqual(j.rows.map(r => r.complaints), [...j.rows.map(r => r.complaints)].sort((a, b) => a - b)); assert.equal(j.totals.group, 'Total'); assert.equal(j.totals.complaints, 4); assert.equal(j.kpis.find(k => k.id === 'open').value, 4);
 assert.equal(JSON.parse(E.toJson(build({type: 'register'}))).report.totals, null);
});

test('file names: samadhan-<report>-<from>_<to>.<ext>', () => {
 const r = build({type: 'category'}); assert.equal(E.exportFileName(r, 'csv'), 'samadhan-complaints-by-category-2026-10-01_2026-10-31.csv');
 assert.equal(E.exportFileName(build({type: 'register'}), 'xlsx'), 'samadhan-complaint-register-2026-10-01_2026-10-31.xlsx');
 assert.equal(E.exportFileName(build({type: 'localities'}, {range: {preset: 'custom', from: '2026-09-01', to: '2026-09-30'}}), 'json'), 'samadhan-locality-hotspots-2026-09-01_2026-09-30.json');
 assert.equal(E.exportFileName(build({type: 'custom', group: 'category', thenBy: 'status'}), 'csv'), 'samadhan-complaints-by-category-and-status-2026-10-01_2026-10-31.csv');
 assert.equal(E.exportFileName(build({type: 'custom', group: 'ward', metrics: ['slaPct']}), 'csv'), 'samadhan-sla-met-by-ward-2026-10-01_2026-10-31.csv');
});

// ---- .xlsx: a real Office Open XML workbook in a stored zip. These helpers read it back without any library. ----
function readZip(bytes) {
 const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), dec = new TextDecoder();
 let end = bytes.length - 22; assert.equal(v.getUint32(end, true), 0x06054b50, 'end of central directory'); const count = v.getUint16(end + 10, true), cdOffset = v.getUint32(end + 16, true), files = {};
 let p = cdOffset;
 for (let i = 0; i < count; i++) {
  assert.equal(v.getUint32(p, true), 0x02014b50); const method = v.getUint16(p + 10, true), crc = v.getUint32(p + 16, true), size = v.getUint32(p + 24, true), nameLen = v.getUint16(p + 28, true), extra = v.getUint16(p + 30, true), comment = v.getUint16(p + 32, true), lho = v.getUint32(p + 42, true);
  const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen)); assert.equal(v.getUint32(lho, true), 0x04034b50); assert.equal(method, 0, 'stored'); const nl = v.getUint16(lho + 26, true), el = v.getUint16(lho + 28, true), start = lho + 30 + nl + el;
  const data = bytes.subarray(start, start + size); assert.equal(v.getUint32(lho + 14, true), crc); files[name] = {data, crc, text: dec.decode(data)}; p += 46 + nameLen + extra + comment;
 }
 return files;
}
function crc32(b) {let c = ~0; for (const x of b) {c ^= x; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xEDB88320 : c >>> 1;} return ~c >>> 0;}
function assertWellFormed(xml, name) {
 assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'), name); const stack = [];
 for (const m of xml.replace(/<\?xml[^>]*\?>/, '').matchAll(/<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>/g)) {
  if (m[4]) continue; if (m[1]) assert.equal(stack.pop(), m[2], `${name}: closing ${m[2]}`); else stack.push(m[2]);
 }
 assert.equal(stack.length, 0, `${name}: unclosed tags`);
 const text = xml.replace(/<[^>]*>/g, ''); assert.equal(text.includes('<'), false, `${name}: stray <`); assert.ok(!/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;)/.test(text), `${name}: bad entity`);
}
test('Excel: a real .xlsx (stored zip + Office Open XML) with a Report sheet and a Filters sheet', () => {
 const evil = make('Q1', {title: '=1+1 & <b>"bold"</b>', locality: 'Ünïcode हिन्दी', createdAt: at(2026, 10, 2)});
 const r = E.buildReport({...input, complaints: [...complaints, evil]}, cfg({type: 'register'}), NOW), bytes = E.toXlsx(r), files = readZip(bytes);
 assert.deepEqual(Object.keys(files).sort(), ['[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']);
 assert.equal(bytes[0], 0x50); assert.equal(bytes[1], 0x4B); for (const [name, f] of Object.entries(files)) {assert.equal(crc32(f.data), f.crc, `crc ${name}`); assertWellFormed(f.text, name);}
 const sheet = files['xl/worksheets/sheet1.xml'].text;
 assert.ok(sheet.includes('<pane ySplit="1"'), 'header row frozen'); assert.ok(sheet.includes('t="inlineStr"') && sheet.includes('<t xml:space="preserve">ID</t>')); assert.ok(!sheet.includes('<f>'), 'text is never a formula');
 assert.ok(sheet.includes('=1+1 &amp; &lt;b&gt;&quot;bold&quot;&lt;/b&gt;'), 'text escaped, not interpreted'); assert.ok(sheet.includes('Ünïcode हिन्दी'));
 assert.match(sheet, /<c r="H2" s="5"><v>\d{5}<\/v><\/c>/, 'created is a real Excel date'); assert.match(sheet, /<c r="K\d+" s="3"><v>5\.1<\/v><\/c>/, 'days open is a number');
 assert.ok(files['xl/workbook.xml'].text.includes('name="Report"') && files['xl/workbook.xml'].text.includes('name="Filters"'));
 const info = files['xl/worksheets/sheet2.xml'].text; assert.ok(info.includes('Complaint register') && info.includes('1 Oct 2026 – 31 Oct 2026') && info.includes('Generated'));
 const cat = E.buildReport(input, cfg({type: 'category'}), NOW), s = readZip(E.toXlsx(cat))['xl/worksheets/sheet1.xml'].text;
 assert.ok(s.includes('<c r="B2"><v>3</v></c>'), 'counts are plain numbers'); assert.ok(s.includes('<c r="H2" s="3"><v>42.9</v></c>')); assert.match(s, /<row r="5">.*<t xml:space="preserve">Total<\/t>.*<\/row>/, 'totals row last'); assert.ok(!s.includes('<c r="F2"'), 'empty cells are left out');
 const same = E.toXlsx(cat), again = E.toXlsx(cat); assert.deepEqual(Array.from(same), Array.from(again), 'deterministic');
});

test('zip writer: files are stored with correct sizes, offsets, UTF-8 names and CRC', () => {
 const out = E.zipStore([{name: 'a.txt', data: new TextEncoder().encode('hello')}, {name: 'dir/é.xml', data: new TextEncoder().encode('<x/>')}, {name: 'empty', data: new Uint8Array(0)}], new Date(Date.UTC(2026, 9, 6, 12, 30, 40)));
 const files = readZip(out); assert.deepEqual(Object.keys(files), ['a.txt', 'dir/é.xml', 'empty']); assert.equal(files['a.txt'].text, 'hello'); assert.equal(crc32(files['a.txt'].data), 0x3610A686); assert.equal(files.empty.data.length, 0);
 assert.equal(crc32(new TextEncoder().encode('123456789')), 0xCBF43926, 'standard CRC-32 check value');
});

test('chart text alternatives and the "view as table" data', () => {
 const bar = build({type: 'category'}).chart; assert.match(E.describeChart(bar), /^Bar chart: Complaints by Category\. Road & Footpath 3, Garbage & Cleaning 2, Water 2\.$/);
 assert.deepEqual(E.chartTable(bar), {columns: ['Group', 'Complaints', 'Share'], rows: [['Road & Footpath', '3', '42.9%'], ['Garbage & Cleaning', '2', '28.6%'], ['Water', '2', '28.6%']]});
 const donut = build({type: 'status'}).chart; assert.match(E.describeChart(donut), /^Donut chart: Complaints by Status\. Total 7\. Submitted 1 \(14\.3%\)/); assert.deepEqual(E.chartTable(donut).columns, ['Group', 'Complaints', 'Share']);
 const line = build({type: 'trend'}).chart; assert.match(E.describeChart(line), /^Line chart: Complaints received per day, 6 points from 1 Oct 2026 to 6 Oct 2026\. Received peaks at 2 on 1 Oct 2026\./); assert.deepEqual(E.chartTable(line).rows[0], ['1 Oct 2026', '2', '1']);
 const stacked = build({type: 'custom', group: 'category', thenBy: 'status'}).chart; assert.match(E.describeChart(stacked), /^Stacked bar chart: Complaints by Category and Status\. Road & Footpath 3: Submitted 1, Assigned 0/); assert.deepEqual(E.chartTable(stacked).rows.at(-1), ['Water', '0', '0', '0', '1', '1', '0', '2']);
 const none = build({type: 'category'}, {query: 'zzz'}).chart; assert.equal(none.kind, 'empty'); assert.match(E.describeChart(none), /nothing to chart/); assert.deepEqual(E.chartTable(none).columns, ['Chart']);
 const pct = build({type: 'custom', group: 'category', metrics: ['slaPct']}).chart; assert.match(E.describeChart(pct), /Garbage & Cleaning 100%, Water 0%/); assert.equal(E.chartTable(pct).rows[0][1], '100%');
});

test('stored configuration: remembered per session, never the resident-details choice, always safe to read back', () => {
 const original = cfg({type: 'custom', group: 'ward', thenBy: 'status', metrics: ['complaints', 'overdue'], cellMetric: 'open', trendUnit: 'week', resolutionBy: 'category', userGroup: 'ward', includeResident: true}, {status: 'Closed', category: 'Water', priority: 'High', department: 'unassigned', ward: 'w7', overdueOnly: true, query: 'drain', range: {preset: 'custom', from: '2026-09-15', to: '2026-10-02'}});
 const text = E.serializeConfig(original, false); assert.ok(!text.includes('includeResident')); const back = E.parseStoredConfig(text, NOW_DATE, {allowUsers: true});
 assert.deepEqual(back.config, {...original, includeResident: false}); assert.equal(back.live, false);
 // presets are stored by name and recomputed from today
 const preset = E.serializeConfig(cfg({}, {range: D.makeRange('last7', new Date(2026, 7, 1))}), true); assert.ok(preset.includes('"range":{"preset":"last7"}')); assert.deepEqual(E.parseStoredConfig(preset, NOW_DATE, {allowUsers: true}).config.filters.range, D.makeRange('last7', NOW_DATE));
 // garbage in, defaults out
 const fallback = E.defaultConfig(NOW_DATE);
 for (const bad of [null, undefined, '', 'not json', '[]', '5', '{"type":"nope"}']) assert.deepEqual(E.parseStoredConfig(bad, NOW_DATE, {allowUsers: true}), {config: fallback, live: true}, String(bad));
 const messy = E.parseStoredConfig(JSON.stringify({type: 'bogus', group: 'x', thenBy: 'day', metrics: ['nope', 'avgDays', 5], cellMetric: 'slaPct', trendUnit: 'hourly', filters: {range: {preset: 'custom', from: '2026-10-10', to: '2026-10-01'}, status: 7, query: 'x'.repeat(500), overdueOnly: 'yes'}}), NOW_DATE, {allowUsers: true});
 assert.equal(messy.config.type, 'category'); assert.equal(messy.config.group, 'category'); assert.equal(messy.config.thenBy, '', 'a day cannot be spread across columns'); assert.deepEqual(messy.config.metrics, ['avgDays']); assert.equal(messy.config.cellMetric, 'slaPct'); assert.equal(messy.config.trendUnit, 'auto');
 assert.deepEqual(messy.config.filters.range, fallback.filters.range, 'a reversed stored range falls back to this month'); assert.equal(messy.config.filters.status, ''); assert.equal(messy.config.filters.query.length, 200); assert.equal(messy.config.filters.overdueOnly, false);
 // app-users report types are only restored for administrators who may see them
 const users = E.serializeConfig(cfg({type: 'users'}), true); assert.equal(E.parseStoredConfig(users, NOW_DATE, {allowUsers: true}).config.type, 'users'); assert.equal(E.parseStoredConfig(users, NOW_DATE, {allowUsers: false}).config.type, 'category');
 assert.ok(E.REPORT_TYPES.some(t => t.id === 'users' && t.usersOnly));
});

test('configuration checks: plain-English problems, staleness detection, stale filter values cleared', () => {
 assert.equal(E.configProblem(cfg({}, {range: {preset: 'custom', from: '2026-10-10', to: '2026-10-01'}})), 'The From date must be on or before the To date.');
 assert.equal(E.configProblem(cfg({}, {range: {preset: 'custom', from: '2025-01-01', to: '2026-01-02'}})), 'Choose a range of up to 366 days. This one covers 367 days.');
 assert.equal(E.configProblem(cfg({}, {range: {preset: 'custom', from: '2025-01-01', to: '2026-01-01'}})), '', '366 days is fine');
 assert.equal(E.configProblem(cfg({}, {range: {preset: 'custom', from: '', to: '2026-01-01'}})), 'Choose both a From date and a To date.');
 assert.equal(E.configProblem(cfg({type: 'custom', metrics: []})), 'Tick at least one metric.'); assert.equal(E.configProblem(cfg({type: 'custom', metrics: [], thenBy: 'status'})), '', 'cross-tabs use the cell value instead of metrics');
 assert.equal(E.sameConfig(cfg(), cfg()), true); assert.equal(E.sameConfig(cfg({}, {query: 'Drain '}), cfg({}, {query: 'drain'})), true, 'case and spaces of the search do not matter');
 assert.equal(E.sameConfig(cfg(), cfg({}, {status: 'Closed'})), false); assert.equal(E.sameConfig(cfg({type: 'register'}), cfg({type: 'register', includeResident: true})), false); assert.equal(E.sameConfig(cfg({type: 'category', metrics: ['avgDays']}), cfg({type: 'category'})), true, 'metrics only matter for custom reports');
 assert.equal(E.sameConfig(cfg({type: 'custom', group: 'ward', thenBy: 'ward'}), cfg({type: 'custom', group: 'ward'})), true);
 const options = E.reportFilterOptions(input);
 assert.deepEqual(E.reconcileFilters(cfg({}, {status: 'Closed', category: 'Gone', priority: 'High', department: 'dept:d-removed', ward: 'w-removed'}).filters, options).category, ''); const kept = E.reconcileFilters(cfg({}, {status: 'Closed', priority: 'High', department: 'dept:d-water', ward: 'w7'}).filters, options);
 assert.deepEqual([kept.status, kept.priority, kept.department, kept.ward], ['Closed', 'High', 'dept:d-water', 'w7']); assert.equal(E.reconcileFilters(cfg({}, {department: 'dept:d-removed', ward: 'w-removed'}).filters, options).department, '');
});

test('filter options: status groups, categories in use, departments with Unassigned, wards from the first one on', () => {
 const o = E.reportFilterOptions(input);
 assert.deepEqual(o.status.slice(0, 3), [{value: 'group:open', label: 'Open (not closed or rejected)'}, {value: 'group:resolved', label: 'Resolved (closed)'}, {value: 'Submitted', label: 'Submitted'}]); assert.equal(o.status.length, 2 + 9);
 assert.deepEqual(o.category.map(c => c.value), ['Road & Footpath', 'Garbage & Cleaning', 'Water'], 'a disabled category nobody uses is not offered'); assert.ok(E.reportFilterOptions({...input, complaints: [make('U1', {category: 'Unused idea', categoryId: 'unused'})]}).category.some(c => c.value === 'Unused idea'));
 assert.deepEqual(o.priority.map(p => p.value), ['Low', 'Normal', 'High', 'Critical']); assert.equal(o.department[0].value, 'unassigned'); assert.ok(o.department.some(d => d.value === 'dept:d-old' && /inactive/.test(d.label)));
 assert.deepEqual(o.ward.map(w => w.value), ['w7', 'w12', 'none']); assert.deepEqual(E.reportFilterOptions({...input, wards: []}).ward, []); assert.equal(E.reportFilterOptions({...input, wards: [wards[0]]}).ward.length >= 1, true);
});

test('titles', () => {
 const t = over => E.reportTitle(cfg(over));
 assert.deepEqual(['register', 'category', 'department', 'ward', 'status', 'priority', 'localities', 'ageing'].map(type => t({type})), ['Complaint register', 'Complaints by Category', 'Complaints by Department', 'Complaints by Ward', 'Complaints by Status', 'Complaints by Priority', 'Locality hotspots', 'Ageing of open complaints']);
 assert.equal(t({type: 'users', userGroup: 'language'}), 'App users registrations by Language'); assert.equal(t({type: 'custom', group: 'locality', metrics: ['complaints', 'open']}), 'Complaint summary by Locality'); assert.equal(t({type: 'custom', group: 'month', thenBy: 'category', metrics: ['avgDays']}), 'Complaints by Month and Category');
});

test('every report type builds without error on empty data and on a bare workspace', () => {
 for (const inp of [{...input, complaints: [], residents: []}, {complaints: [], categories: []}, {complaints: [make('S1', {createdAt: at(2026, 10, 2)})], categories: []}]) {
  for (const {id} of E.REPORT_TYPES) {
   const r = E.buildReport(inp, cfg({type: id, group: 'locality', thenBy: 'category'}), NOW);
   assert.ok(r.title && r.headline.startsWith(r.title) && Array.isArray(r.rows) && r.columns.length >= 2, id); assert.ok(r.rows.every(row => row.cells.length === r.columns.length), `${id}: cells line up with columns`); if (r.totals) assert.equal(r.totals.length, r.columns.length, id);
   assert.ok(E.toCsv(r).startsWith('﻿')); JSON.parse(E.toJson(r)); readZip(E.toXlsx(r)); assert.ok(E.describeChart(r.chart).length > 5); E.chartTable(r.chart);
  }
 }
});

test('generating is deterministic and leaves the workspace data untouched', () => {
 const before = JSON.stringify(input), a = build({type: 'custom', group: 'category', thenBy: 'status'}), b = build({type: 'custom', group: 'category', thenBy: 'status'}); assert.deepEqual(a, b); assert.equal(JSON.stringify(input), before);
 const big = Array.from({length: 4000}, (_, i) => make(`P${i}`, {createdAt: at(2026, 10, 1 + (i % 28), i % 24), categoryId: ['roads', 'garbage', 'water'][i % 3], category: ['Road & Footpath', 'Garbage & Cleaning', 'Water'][i % 3], status: i % 4 ? 'Submitted' : 'Closed', locality: `Colony ${i % 40}`, history: i % 4 ? [] : hist(['Closed', at(2026, 10, 2 + (i % 28))])}));
 const t0 = performance.now(); for (const type of ['register', 'category', 'trend', 'resolution', 'ageing', 'localities']) E.buildReport({...input, complaints: big}, cfg({type}), NOW); const ms = performance.now() - t0; assert.ok(ms < 3000, `six reports over 4000 complaints took ${Math.round(ms)} ms`);
});
