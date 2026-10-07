import test from 'node:test';
import assert from 'node:assert/strict';
import {buildModules} from './build-ts.mjs';
buildModules(['app/table-filters'], 'tests/.generated');
const F = await import('./.generated/table-filters.mjs');

// Every instant is built from local calendar parts, so these tests hold in any time zone.
const at = (y, m, d, h = 12, mi = 0) => new Date(y, m - 1, d, h, mi).toISOString();
const state = (patch = {}) => ({...F.emptyFilters(), ...patch});

const rows = [
 {id: 'a', title: 'Water supply paused', titleHi: 'जलापूर्ति बंद', status: 'Published', org: 'Nagar Parishad', startsAt: at(2026, 10, 5), endsAt: at(2026, 10, 6)},
 {id: 'b', title: 'Tree plantation drive', titleHi: '', status: 'Draft', org: 'Panchayat Samiti', startsAt: at(2026, 10, 10), endsAt: at(2026, 10, 12)},
 {id: 'c', title: 'Health camp', titleHi: '', status: 'Archived', org: 'Nagar Parishad', startsAt: at(2026, 9, 1), endsAt: at(2026, 9, 2)},
 {id: 'd', title: 'No dates here', titleHi: '', status: 'Draft', org: '', startsAt: '', endsAt: ''},
];
const spec = {
 search: r => [r.title, r.titleHi, r.org],
 selects: {status: r => r.status, org: r => r.org},
 ranges: {starts: r => r.startsAt, valid: r => ({start: r.startsAt, end: r.endsAt})},
};
const ids = (list) => list.map(r => r.id);

test('empty state returns every row in the original order and does not modify the input', () => {
 const before = ids(rows);
 assert.deepEqual(ids(F.applyFilters(rows, F.emptyFilters(), spec)), ['a', 'b', 'c', 'd']);
 assert.deepEqual(ids(rows), before);
 assert.notEqual(F.applyFilters(rows, F.emptyFilters(), spec), rows, 'returns a new array');
});

test('search: case-insensitive, every word must appear in some field, Hindi text works, blank query is no filter', () => {
 assert.deepEqual(ids(F.applyFilters(rows, state({query: 'WATER'}), spec)), ['a']);
 assert.deepEqual(ids(F.applyFilters(rows, state({query: 'nagar water'}), spec)), ['a'], 'words may match different fields');
 assert.deepEqual(ids(F.applyFilters(rows, state({query: 'drive plantation'}), spec)), ['b'], 'any order');
 assert.deepEqual(ids(F.applyFilters(rows, state({query: 'जलापूर्ति'}), spec)), ['a']);
 assert.deepEqual(ids(F.applyFilters(rows, state({query: '   '}), spec)), ['a', 'b', 'c', 'd']);
 assert.deepEqual(ids(F.applyFilters(rows, state({query: 'zzz'}), spec)), []);
});

test('select filters: exact match, empty choice means any, several selects combine with AND, unknown keys are ignored', () => {
 assert.deepEqual(ids(F.applyFilters(rows, state({values: {status: 'Draft'}}), spec)), ['b', 'd']);
 assert.deepEqual(ids(F.applyFilters(rows, state({values: {status: ''}}), spec)), ['a', 'b', 'c', 'd']);
 assert.deepEqual(ids(F.applyFilters(rows, state({values: {status: 'Draft', org: 'Panchayat Samiti'}}), spec)), ['b']);
 assert.deepEqual(ids(F.applyFilters(rows, state({values: {org: 'Nagar Parishad'}}), spec)), ['a', 'c']);
 assert.deepEqual(ids(F.applyFilters(rows, state({values: {nothing: 'x'}}), spec)), ['a', 'b', 'c', 'd'], 'a filter without a getter is not applied');
});

test('date range on one instant: whole local days, inclusive at both ends, open-ended ranges, rows without a date never match', () => {
 const r = (from, to) => state({ranges: {starts: {from, to}}});
 assert.deepEqual(ids(F.applyFilters(rows, r('2026-10-05', '2026-10-05'), spec)), ['a'], 'a single day includes the whole day (12:00 is inside)');
 assert.deepEqual(ids(F.applyFilters(rows, r('2026-10-01', '2026-10-31'), spec)), ['a', 'b']);
 assert.deepEqual(ids(F.applyFilters(rows, r('2026-10-06', ''), spec)), ['b'], 'From only');
 assert.deepEqual(ids(F.applyFilters(rows, r('', '2026-09-30'), spec)), ['c'], 'To only');
 assert.deepEqual(ids(F.applyFilters(rows, r('2026-10-11', '2026-10-31'), spec)), [], 'nothing starts after the 10th');
 assert.deepEqual(ids(F.applyFilters(rows, r('2026-01-01', '2026-12-31'), spec)), ['a', 'b', 'c'], 'the row with no date is excluded once a range is active');
 assert.deepEqual(ids(F.applyFilters(rows, r('', ''), spec)), ['a', 'b', 'c', 'd'], 'an empty range is no filter');
});

test('date range on an interval: matches when the interval overlaps the range (valid on / between)', () => {
 const r = (from, to) => state({ranges: {valid: {from, to}}});
 assert.deepEqual(ids(F.applyFilters(rows, r('2026-10-06', '2026-10-06'), spec)), ['a'], 'valid on the last day it runs');
 assert.deepEqual(ids(F.applyFilters(rows, r('2026-10-07', '2026-10-09'), spec)), [], 'a gap between two intervals');
 assert.deepEqual(ids(F.applyFilters(rows, r('2026-10-11', ''), spec)), ['b'], 'From only: still running on or after that day');
 assert.deepEqual(ids(F.applyFilters(rows, r('', '2026-09-15'), spec)), ['c'], 'To only: already started by that day');
 assert.deepEqual(ids(F.applyFilters(rows, r('2026-09-02', '2026-10-05'), spec)), ['a', 'c'], 'touching ends count');
 const open = [{id: 'x', startsAt: at(2026, 10, 1), endsAt: ''}, {id: 'y', startsAt: '', endsAt: at(2026, 10, 3)}, {id: 'z', startsAt: '', endsAt: ''}];
 const s = {ranges: {valid: x => ({start: x.startsAt, end: x.endsAt})}};
 assert.deepEqual(ids(F.applyFilters(open, state({ranges: {valid: {from: '2026-12-01', to: '2026-12-02'}}}), s)), ['x'], 'no end date: valid from its start onwards');
 assert.deepEqual(ids(F.applyFilters(open, state({ranges: {valid: {from: '2026-09-01', to: '2026-09-02'}}}), s)), ['y'], 'no start date: valid up to its end');
});

test('an invalid range (From after To, or not a date) is reported and ignored by applyFilters', () => {
 assert.equal(F.rangeProblem({from: '2026-10-10', to: '2026-10-09'}), 'The From date must be on or before the To date.');
 assert.equal(F.rangeProblem({from: '2026-10-10', to: '2026-10-10'}), '', 'the same day is fine');
 assert.equal(F.rangeProblem({from: '2026-10-10', to: ''}), '');
 assert.equal(F.rangeProblem({from: '', to: ''}), '');
 assert.equal(F.rangeProblem(undefined), '');
 assert.equal(F.rangeProblem({from: '2026-02-30', to: ''}), 'Enter a valid date.');
 assert.equal(F.rangeProblem({from: 'soon', to: ''}), 'Enter a valid date.');
 assert.deepEqual(ids(F.applyFilters(rows, state({ranges: {starts: {from: '2026-10-10', to: '2026-10-01'}}}), spec)), ['a', 'b', 'c', 'd'], 'ignored, not "show nothing"');
});

test('everything combines: search AND selects AND ranges', () => {
 const s = state({query: 'nagar', values: {status: 'Published'}, ranges: {starts: {from: '2026-10-01', to: '2026-10-31'}}});
 assert.deepEqual(ids(F.applyFilters(rows, s, spec)), ['a']);
 assert.deepEqual(ids(F.applyFilters(rows, {...s, values: {status: 'Archived'}}, spec)), [], 'Archived Nagar Parishad rows are all in September');
 assert.deepEqual(ids(F.applyFilters(rows, {...s, ranges: {}}, spec)), ['a']);
});

test('counting and clearing: search text is not a filter, but any narrowing enables "Clear filters"', () => {
 assert.equal(F.activeFilterCount(F.emptyFilters()), 0);
 assert.equal(F.hasActiveFilters(F.emptyFilters()), false);
 const s = state({query: ' x ', values: {a: 'v', b: ''}, ranges: {r1: {from: '2026-01-01', to: ''}, r2: {from: '', to: ''}}});
 assert.equal(F.activeFilterCount(s), 2, 'one select + one range');
 assert.equal(F.hasActiveFilters(s), true);
 assert.equal(F.hasActiveFilters(state({query: 'abc'})), true);
 assert.equal(F.hasActiveFilters(state({query: '   '})), false);
 assert.equal(F.hasActiveFilters(state({values: {a: ''}})), false);
 assert.deepEqual(F.emptyFilters(), {query: '', values: {}, ranges: {}});
 assert.notEqual(F.emptyFilters(), F.emptyFilters(), 'a fresh object every time');
});

test('filterKey changes with the filters but ignores cosmetic differences', () => {
 const a = state({query: 'Water', values: {s: 'x', t: ''}});
 assert.equal(F.filterKey(a), F.filterKey(state({query: ' water ', values: {s: 'x'}})));
 assert.notEqual(F.filterKey(a), F.filterKey(state({query: 'water', values: {s: 'y'}})));
 assert.notEqual(F.filterKey(a), F.filterKey(state({query: 'water', values: {s: 'x'}, ranges: {r: {from: '2026-01-01', to: ''}}})));
});

test('dayBound is local-day based and rejects impossible dates', () => {
 assert.equal(F.dayBound('2026-10-05'), +new Date(2026, 9, 5, 0, 0, 0, 0));
 assert.equal(F.dayBound('2026-10-05', true), +new Date(2026, 9, 5, 23, 59, 59, 999));
 assert.ok(Number.isNaN(F.dayBound('2026-13-01')));
 assert.ok(Number.isNaN(F.dayBound('2026-02-29')), '2026 is not a leap year');
 assert.ok(Number.isFinite(F.dayBound('2028-02-29')));
 assert.ok(Number.isNaN(F.dayBound('5 Oct 2026')));
 assert.ok(Number.isNaN(F.dayBound('')));
});

test('option helpers: distinctOptions is trimmed, de-duplicated, sorted and skips blanks; plainOptions mirrors the text', () => {
 assert.deepEqual(F.distinctOptions(rows, r => r.org), [{value: 'Nagar Parishad', label: 'Nagar Parishad'}, {value: 'Panchayat Samiti', label: 'Panchayat Samiti'}]);
 assert.deepEqual(F.distinctOptions([{a: ' Zed '}, {a: 'alpha'}, {a: 'Zed'}, {a: null}, {}], r => r.a), [{value: 'alpha', label: 'alpha'}, {value: 'Zed', label: 'Zed'}]);
 assert.deepEqual(F.plainOptions(['Published', 'Draft']), [{value: 'Published', label: 'Published'}, {value: 'Draft', label: 'Draft'}]);
});
