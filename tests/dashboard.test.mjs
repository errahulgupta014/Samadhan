import test from 'node:test';
import assert from 'node:assert/strict';
import {buildModules} from './build-ts.mjs';
buildModules(['lib/date-range'], 'tests/.generated');
const R = await import('./.generated/date-range.mjs');

// Local-time instants: these tests hold in any time zone because every instant is built from local calendar parts.
const at = (y, m, d, h = 12, mi = 0, s = 0) => new Date(y, m - 1, d, h, mi, s);
const now = at(2026, 10, 6); // Tuesday 6 October 2026
const complaint = (date, extra = {}) => ({createdAt: date.toISOString(), status: 'Submitted', dueAt: at(2026, 10, 20).toISOString(), ...extra});

test('presets: this month is the default and runs from the 1st to the last day of the month', () => {
 assert.equal(R.DEFAULT_PRESET, 'thisMonth');
 assert.deepEqual(R.makeRange('thisMonth', now), {preset: 'thisMonth', from: '2026-10-01', to: '2026-10-31'});
 assert.deepEqual(R.presetRange('thisMonth', at(2026, 2, 10)), {from: '2026-02-01', to: '2026-02-28'});
 assert.deepEqual(R.presetRange('thisMonth', at(2024, 2, 10)), {from: '2024-02-01', to: '2024-02-29'}, 'leap year');
 assert.deepEqual(R.presetRange('thisMonth', at(2026, 12, 31, 23, 59)), {from: '2026-12-01', to: '2026-12-31'});
 assert.deepEqual(R.RANGE_PRESETS.map(p => p.label), ['This month', 'Today', 'Last 7 days', 'Last 30 days', 'Last month', 'This year', 'Custom range']);
});
test('presets: today, last 7 / 30 days (inclusive of today), last month, this year', () => {
 assert.deepEqual(R.presetRange('today', now), {from: '2026-10-06', to: '2026-10-06'});
 assert.deepEqual(R.presetRange('last7', now), {from: '2026-09-30', to: '2026-10-06'}); assert.equal(R.dayCount('2026-09-30', '2026-10-06'), 7);
 assert.deepEqual(R.presetRange('last30', now), {from: '2026-09-07', to: '2026-10-06'}); assert.equal(R.dayCount('2026-09-07', '2026-10-06'), 30);
 assert.deepEqual(R.presetRange('lastMonth', now), {from: '2026-09-01', to: '2026-09-30'});
 assert.deepEqual(R.presetRange('lastMonth', at(2026, 1, 15)), {from: '2025-12-01', to: '2025-12-31'}, 'across the year boundary');
 assert.deepEqual(R.presetRange('lastMonth', at(2024, 3, 31)), {from: '2024-02-01', to: '2024-02-29'}, 'the 31st does not skip a short month');
 assert.deepEqual(R.presetRange('thisYear', now), {from: '2026-01-01', to: '2026-12-31'});
 assert.equal(R.dayCount('2024-01-01', '2024-12-31'), 366); assert.equal(R.rangeProblem('2024-01-01', '2024-12-31'), '', 'a full leap year is allowed');
 assert.deepEqual(R.presetRange('last7', at(2026, 1, 3)), {from: '2025-12-28', to: '2026-01-03'});
 for (const p of R.RANGE_PRESETS.filter(p => p.id !== 'custom')) {const r = R.makeRange(p.id, now); assert.equal(R.rangeProblem(r.from, r.to), '', p.id);}
});
test('parseYmd accepts only real calendar dates', () => {
 for (const bad of ['', 'x', '2026-02-30', '2026-13-01', '2026-00-10', '2026-1-5', '26-01-01', '2026/01/01', '2026-01-01T00:00', ' 2026-01-01', null, undefined, 5, '1969-12-31', '2201-01-01']) assert.equal(R.parseYmd(bad), null, String(bad));
 assert.equal(R.toYmd(R.parseYmd('2026-02-28')), '2026-02-28'); assert.equal(R.parseYmd('2024-02-29').getDate(), 29); assert.equal(R.parseYmd('2026-02-29'), null);
 assert.equal(R.addDays('2026-02-28', 1), '2026-03-01'); assert.equal(R.addDays('2026-01-01', -1), '2025-12-31'); assert.equal(R.addDays('2026-10-25', 7), '2026-11-01');
});
test('range validation gives plain-English problems: empty, invalid, reversed, too long; one day and 366 days are fine', () => {
 assert.equal(R.rangeProblem('', '2026-10-01'), 'Choose both a From date and a To date.'); assert.equal(R.rangeProblem('2026-10-01', ''), 'Choose both a From date and a To date.');
 assert.equal(R.rangeProblem('2026-02-30', '2026-03-01'), 'Enter valid dates.');
 assert.equal(R.rangeProblem('2026-10-10', '2026-10-09'), 'The From date must be on or before the To date.');
 assert.equal(R.rangeProblem('2026-10-10', '2026-10-10'), '', 'both ends are inclusive: one day is a valid range');
 assert.equal(R.rangeProblem('2026-01-01', '2026-12-31'), '');
 assert.equal(R.rangeProblem('2025-01-01', '2026-01-01'), '', '2025-01-01 to 2026-01-01 inclusive is exactly 366 days: allowed');
 assert.equal(R.rangeProblem('2025-01-01', '2026-01-02'), 'Choose a range of up to 366 days. This one covers 367 days.');
 assert.match(R.rangeProblem('2020-01-01', '2026-01-01'), /up to 366 days/);
 assert.equal(R.rangeProblem('2026-10-01', '2027-03-01'), '', 'future dates are allowed');
});
test('rangeLabel reads like 1 Oct 2026 – 31 Oct 2026; a single day shows once; invalid dates give nothing', () => {
 assert.equal(R.rangeLabel('2026-10-01', '2026-10-31'), '1 Oct 2026 – 31 Oct 2026');
 assert.equal(R.rangeLabel('2025-12-28', '2026-01-03'), '28 Dec 2025 – 3 Jan 2026');
 assert.equal(R.rangeLabel('2026-10-06', '2026-10-06'), '6 Oct 2026');
 assert.equal(R.rangeLabel('', '2026-10-06'), ''); assert.equal(R.rangeLabel('nope', 'nope'), '');
});
test('a complaint belongs to the range by the local day it was created: both ends inclusive, midnight edges exact', () => {
 const from = '2026-10-01', to = '2026-10-31';
 assert.equal(R.inRange(at(2026, 10, 1, 0, 0, 0).toISOString(), from, to), true, 'first instant of the first day');
 assert.equal(R.inRange(at(2026, 10, 31, 23, 59, 59).toISOString(), from, to), true, 'last second of the last day');
 assert.equal(R.inRange(at(2026, 9, 30, 23, 59, 59).toISOString(), from, to), false);
 assert.equal(R.inRange(at(2026, 11, 1, 0, 0, 0).toISOString(), from, to), false);
 assert.equal(R.inRange('not a date', from, to), false); assert.equal(R.inRange('', from, to), false);
 const items = [complaint(at(2026, 10, 5), {id: 'a'}), complaint(at(2026, 9, 30), {id: 'b'}), complaint(at(2026, 10, 31, 23, 30), {id: 'c'}), complaint(at(2026, 11, 1), {id: 'd'}), complaint(at(2026, 10, 1, 0, 5), {id: 'e'})];
 assert.deepEqual(R.filterByRange(items, from, to).map(c => c.id), ['a', 'c', 'e'], 'original order kept');
 assert.deepEqual(R.filterByRange(items, '2026-10-05', '2026-10-05').map(c => c.id), ['a'], 'a single day');
 assert.deepEqual(R.filterByRange([], from, to), []);
});
test('chart unit: one bar per day up to 31 days, per week up to 122 days, per month beyond', () => {
 for (const [days, unit] of [[1, 'day'], [7, 'day'], [31, 'day'], [32, 'week'], [90, 'week'], [122, 'week'], [123, 'month'], [366, 'month']]) assert.equal(R.bucketUnit(days), unit, `${days} days`);
 const oct = R.buckets('2026-10-01', '2026-10-31'); assert.equal(oct.unit, 'day'); assert.equal(oct.buckets.length, 31);
 assert.deepEqual([oct.buckets[0].label, oct.buckets[0].title, oct.buckets[30].label], ['1 Oct', '1 Oct 2026', '31 Oct']);
 assert.equal(R.buckets('2026-10-06', '2026-10-06').buckets.length, 1); assert.deepEqual(R.buckets('2026-10-10', '2026-10-09').buckets, []); assert.deepEqual(R.buckets('', '').buckets, []);
 assert.equal(R.buckets('2026-09-30', '2026-10-30').buckets.length, 31, 'across a month end');
});
test('weekly buckets are Monday-to-Sunday weeks clipped to the range, contiguous and covering every day once', () => {
 const w = R.buckets('2026-10-01', '2026-11-30'); assert.equal(w.unit, 'week');
 assert.deepEqual([w.buckets[0].from, w.buckets[0].to, w.buckets[0].label], ['2026-10-01', '2026-10-04', '1 Oct'], 'Thursday to Sunday');
 assert.deepEqual([w.buckets[1].from, w.buckets[1].to], ['2026-10-05', '2026-10-11']);
 assert.deepEqual([w.buckets.at(-1).from, w.buckets.at(-1).to], ['2026-11-30', '2026-11-30'], 'the last Monday is a one-day bucket');
 assert.equal(w.buckets[1].title, '5 Oct 2026 – 11 Oct 2026');
 let days = 0; w.buckets.forEach((b, i) => {days += R.dayCount(b.from, b.to); if (i) assert.equal(R.addDays(w.buckets[i - 1].to, 1), b.from, 'no gaps or overlaps');}); assert.equal(days, 61);
 const long = R.buckets('2026-01-01', '2026-05-02'); assert.equal(long.unit, 'week'); assert.ok(long.buckets.length <= 19, `${long.buckets.length} weekly bars stay readable`);
});
test('monthly buckets are calendar months clipped to the range, with short labels', () => {
 const y = R.buckets('2026-01-01', '2026-12-31'); assert.equal(y.unit, 'month'); assert.equal(y.buckets.length, 12);
 assert.deepEqual([y.buckets[0].label, y.buckets[0].from, y.buckets[0].to, y.buckets[11].label, y.buckets[11].to], ['Jan 26', '2026-01-01', '2026-01-31', 'Dec 26', '2026-12-31']);
 assert.equal(y.buckets[1].to, '2026-02-28', 'February');
 const part = R.buckets('2026-03-15', '2026-10-14'); assert.equal(part.unit, 'month'); assert.deepEqual([part.buckets[0].from, part.buckets[0].to, part.buckets.at(-1).from, part.buckets.at(-1).to, part.buckets.length], ['2026-03-15', '2026-03-31', '2026-10-01', '2026-10-14', 8]);
 const full = R.buckets('2025-10-06', '2026-10-06'); assert.equal(full.unit, 'month'); assert.equal(full.buckets.length, 13); assert.equal(full.buckets[0].label, 'Oct 25'); assert.equal(full.buckets.at(-1).label, 'Oct 26');
 let days = 0; full.buckets.forEach(b => days += R.dayCount(b.from, b.to)); assert.equal(days, 366);
});
test('countByBucket counts complaints per bucket, ignores the ones outside the range and flags future buckets', () => {
 const items = [complaint(at(2026, 10, 1)), complaint(at(2026, 10, 1, 23, 59)), complaint(at(2026, 10, 6)), complaint(at(2026, 10, 31, 23, 59)), complaint(at(2026, 9, 30, 23, 59)), complaint(at(2026, 11, 1)), {createdAt: 'garbage'}];
 const day = R.countByBucket(items, '2026-10-01', '2026-10-31', now);
 assert.equal(day.total, 4); assert.deepEqual([day.buckets[0].count, day.buckets[5].count, day.buckets[30].count, day.buckets[1].count], [2, 1, 1, 0]);
 assert.equal(day.buckets.reduce((n, b) => n + b.count, 0), day.total);
 assert.deepEqual([day.buckets[5].future, day.buckets[6].future], [false, true], 'days after today are future');
 const week = R.countByBucket(items, '2026-10-01', '2026-11-30', now); assert.equal(week.unit, 'week'); assert.equal(week.total, 5, 'November 1 is inside this longer range and shares the Mon 26 Oct week with 31 Oct');
 assert.deepEqual([week.buckets[0].count, week.buckets[1].count, week.buckets[4].count], [2, 1, 2]);
 const year = R.countByBucket(items, '2026-01-01', '2026-12-31', now); assert.equal(year.unit, 'month'); assert.equal(year.total, 6); assert.deepEqual([year.buckets[8].count, year.buckets[9].count, year.buckets[10].count], [1, 4, 1]);
 assert.deepEqual(R.countByBucket([], '2026-10-01', '2026-10-31', now).total, 0);
 assert.equal(R.countByBucket(items, '2026-10-31', '2026-10-01', now).buckets.length, 0, 'a reversed range has no bars');
});
test('label step keeps about eight axis labels', () => {
 assert.deepEqual([1, 7, 8, 9, 16, 17, 31].map(n => R.labelStep(n)), [1, 1, 1, 2, 2, 3, 4]);
 for (const n of [1, 7, 13, 18, 31, 53]) assert.ok(Math.ceil(n / R.labelStep(n)) <= 8, `${n} bars`);
});
test('summarize: needs attention excludes closed and rejected, overdue is open and past target, resolved is closed, rate is a rounded percentage', () => {
 const past = at(2026, 10, 1).toISOString(), future = at(2026, 10, 20).toISOString();
 const items = [{status: 'Submitted', dueAt: past}, {status: 'In Progress', dueAt: future}, {status: 'In Progress', dueAt: past}, {status: 'Closed', dueAt: past}, {status: 'Rejected / Duplicate', dueAt: past}, {status: 'Resolution Proposed', dueAt: future}];
 assert.deepEqual(R.summarize(items, +now), {total: 6, open: 4, overdue: 2, inProgress: 2, closed: 1, rate: 17});
 assert.deepEqual(R.summarize([], +now), {total: 0, open: 0, overdue: 0, inProgress: 0, closed: 0, rate: 0});
 assert.equal(R.summarize([{status: 'Closed', dueAt: past}, {status: 'Closed', dueAt: past}, {status: 'Submitted', dueAt: future}], +now).rate, 67);
});
test('the chosen range is stored by preset name (custom with its dates) and an invalid stored value falls back to this month', () => {
 const custom = {preset: 'custom', from: '2026-09-15', to: '2026-10-02'};
 assert.equal(R.serializeRange(R.makeRange('last7', now)), '{"preset":"last7"}'); assert.equal(R.serializeRange(custom), '{"preset":"custom","from":"2026-09-15","to":"2026-10-02"}');
 assert.deepEqual(R.parseStoredRange(R.serializeRange(custom), now), custom);
 assert.deepEqual(R.parseStoredRange(R.serializeRange(R.makeRange('last7', at(2026, 8, 1))), now), R.makeRange('last7', now), 'presets are recomputed from today, not frozen');
 const fallback = R.makeRange('thisMonth', now);
 for (const bad of [null, undefined, '', 'not json', '{}', '[]', '5', '{"preset":"nope"}', '{"preset":"custom"}', '{"preset":"custom","from":"2026-10-10","to":"2026-10-01"}', '{"preset":"custom","from":"2020-01-01","to":"2026-10-01"}', '{"preset":"custom","from":1,"to":2}']) assert.deepEqual(R.parseStoredRange(bad, now), fallback, String(bad));
 assert.deepEqual(R.parseStoredRange(undefined, now), {preset: 'thisMonth', from: '2026-10-01', to: '2026-10-31'});
});
