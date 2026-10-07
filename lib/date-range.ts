/**
 * Date-range helpers for the admin dashboard (Overview): presets, validation, filtering, chart bucketing and the stat-card summary.
 * Pure and dependency-free so it can be unit-tested (tests/dashboard.test.mjs) and shared by the portal and its chart components.
 *
 * Conventions
 *  - Dates are local calendar dates written YYYY-MM-DD ("ymd"); both ends of a range are inclusive and the viewer's time zone decides which day an instant belongs to.
 *  - A complaint belongs to the range by its `createdAt` day.
 *  - A range may reach into the future ("This month" runs to the end of the month); days that have not happened simply have no complaints yet.
 *  - A range covers at most MAX_RANGE_DAYS days.
 */
export type RangePreset = 'thisMonth' | 'today' | 'last7' | 'last30' | 'lastMonth' | 'thisYear' | 'custom';
export type DateRange = {preset: RangePreset; from: string; to: string};
export const RANGE_PRESETS: {id: RangePreset; label: string}[] = [
 {id: 'thisMonth', label: 'This month'}, {id: 'today', label: 'Today'}, {id: 'last7', label: 'Last 7 days'}, {id: 'last30', label: 'Last 30 days'},
 {id: 'lastMonth', label: 'Last month'}, {id: 'thisYear', label: 'This year'}, {id: 'custom', label: 'Custom range'},
];
export const DEFAULT_PRESET: RangePreset = 'thisMonth';
export const MAX_RANGE_DAYS = 366;
/** Charts show one bar per day up to this many days, one per week up to WEEKLY_MAX_DAYS, and one per month beyond that. */
export const DAILY_MAX_DAYS = 31;
export const WEEKLY_MAX_DAYS = 122;
export const RANGE_STORAGE_KEY = 'samadhan.dashboard.range';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');
/** Local calendar date of a Date as YYYY-MM-DD. */
export function toYmd(d: Date): string {return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;}
/** Parses a real calendar date (YYYY-MM-DD, years 1970–2200) to local midnight; anything else (2026-02-30, 2026-1-5, '') is null. */
export function parseYmd(value: unknown): Date | null {
 if (typeof value !== 'string') return null;
 const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value); if (!m) return null;
 const y = +m[1], mo = +m[2], d = +m[3]; if (y < 1970 || y > 2200) return null;
 const date = new Date(y, mo - 1, d); return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d ? date : null;
}
export function addDays(ymd: string, days: number): string {const d = parseYmd(ymd)!; d.setDate(d.getDate() + days); return toYmd(d);}
/** Number of calendar days from..to, both inclusive (0 when either date is invalid or from is after to). */
export function dayCount(from: string, to: string): number {
 const a = parseYmd(from), b = parseYmd(to); if (!a || !b) return 0;
 const n = Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86400000) + 1; return n > 0 ? n : 0;
}
/** The from/to dates of a preset as seen at `now` (local time). `custom` has no dates of its own: it falls back to the default preset. */
export function presetRange(preset: RangePreset, now = new Date()): {from: string; to: string} {
 const today = toYmd(now), y = now.getFullYear(), m = now.getMonth();
 switch (preset) {
  case 'today': return {from: today, to: today};
  case 'last7': return {from: addDays(today, -6), to: today};
  case 'last30': return {from: addDays(today, -29), to: today};
  case 'lastMonth': return {from: toYmd(new Date(y, m - 1, 1)), to: toYmd(new Date(y, m, 0))};
  case 'thisYear': return {from: `${y}-01-01`, to: `${y}-12-31`};
  default: return {from: toYmd(new Date(y, m, 1)), to: toYmd(new Date(y, m + 1, 0))};
 }
}
/** A complete range value for a preset (use the custom form {preset: 'custom', from, to} for chosen dates). */
export function makeRange(preset: RangePreset, now = new Date()): DateRange {return {preset, ...presetRange(preset === 'custom' ? DEFAULT_PRESET : preset, now)};}
/** Plain-English reason a from/to pair cannot be used, or '' when it is fine. */
export function rangeProblem(from: string, to: string): string {
 if (!from || !to) return 'Choose both a From date and a To date.';
 if (!parseYmd(from) || !parseYmd(to)) return 'Enter valid dates.';
 if (from > to) return 'The From date must be on or before the To date.';
 const days = dayCount(from, to);
 if (days > MAX_RANGE_DAYS) return `Choose a range of up to ${MAX_RANGE_DAYS} days. This one covers ${days} days.`;
 return '';
}
const dayLabel = (d: Date) => `${d.getDate()} ${MONTHS[d.getMonth()]}`;
const fullLabel = (d: Date) => `${dayLabel(d)} ${d.getFullYear()}`;
/** Readable range, e.g. "1 Oct 2026 – 31 Oct 2026" (a single day reads "6 Oct 2026"). */
export function rangeLabel(from: string, to: string): string {
 const a = parseYmd(from), b = parseYmd(to); if (!a || !b) return '';
 return from === to ? fullLabel(a) : `${fullLabel(a)} – ${fullLabel(b)}`;
}
/** True when the instant falls on a local day inside the range (from and to inclusive). Invalid dates are never inside. */
export function inRange(iso: string, from: string, to: string): boolean {
 const t = new Date(iso); if (Number.isNaN(+t)) return false;
 const day = toYmd(t); return day >= from && day <= to;
}
/** Items created inside the range (by `createdAt`), original order kept. */
export function filterByRange<T extends {createdAt: string}>(items: T[], from: string, to: string): T[] {return items.filter(c => inRange(c.createdAt, from, to));}

export type BucketUnit = 'day' | 'week' | 'month';
export type Bucket = {key: string; from: string; to: string; label: string; title: string};
export type CountedBucket = Bucket & {count: number; future: boolean};
/** Day buckets up to 31 days, calendar weeks (Monday to Sunday, the first and last clipped to the range) up to 122 days, calendar months beyond. */
export function bucketUnit(days: number): BucketUnit {return days <= DAILY_MAX_DAYS ? 'day' : days <= WEEKLY_MAX_DAYS ? 'week' : 'month';}
export function buckets(from: string, to: string): {unit: BucketUnit; buckets: Bucket[]} {
 const days = dayCount(from, to), unit = bucketUnit(days), out: Bucket[] = []; if (!days) return {unit, buckets: out};
 if (unit === 'day') {for (let i = 0; i < days; i++) {const day = addDays(from, i), d = parseYmd(day)!; out.push({key: day, from: day, to: day, label: dayLabel(d), title: fullLabel(d)});}}
 else {
  let start = from;
  while (start <= to) {
   const d = parseYmd(start)!; let end: string;
   if (unit === 'week') end = addDays(start, (7 - ((d.getDay() + 6) % 7)) - 1); // up to the Sunday of this week
   else end = toYmd(new Date(d.getFullYear(), d.getMonth() + 1, 0));
   if (end > to) end = to;
   out.push({key: start, from: start, to: end, label: unit === 'week' ? dayLabel(d) : `${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`, title: rangeLabel(start, end)});
   start = addDays(end, 1);
  }
 }
 return {unit, buckets: out};
}
/** Complaint counts per chart bucket for the range. `future` marks buckets that start after today. Complaints outside the range are ignored. */
export function countByBucket(items: {createdAt: string}[], from: string, to: string, now = new Date()): {unit: BucketUnit; buckets: CountedBucket[]; total: number} {
 const {unit, buckets: list} = buckets(from, to), today = toYmd(now);
 const counted: CountedBucket[] = list.map(b => ({...b, count: 0, future: b.from > today}));
 const index = new Map<string, number>(); counted.forEach((b, i) => {for (let day = b.from; day <= b.to; day = addDays(day, 1)) index.set(day, i);});
 let total = 0;
 for (const c of items) {const t = new Date(c.createdAt); if (Number.isNaN(+t)) continue; const i = index.get(toYmd(t)); if (i !== undefined) {counted[i].count++; total++;}}
 return {unit, buckets: counted, total};
}
/** Show at most about 8 axis labels so they stay readable at phone width. */
export function labelStep(count: number, maxLabels = 8): number {return Math.max(1, Math.ceil(count / maxLabels));}

export type SummaryItem = {status: string; dueAt: string};
/** Dashboard stat cards for a set of complaints: needs attention = not closed and not rejected/duplicate; overdue = needs attention and past its resolution target; resolved = closed. */
export function summarize(items: SummaryItem[], now = Date.now()) {
 const open = items.filter(c => !['Closed', 'Rejected / Duplicate'].includes(c.status));
 const overdue = open.filter(c => +new Date(c.dueAt) < now).length, closed = items.filter(c => c.status === 'Closed').length;
 return {total: items.length, open: open.length, overdue, inProgress: items.filter(c => c.status === 'In Progress').length, closed, rate: items.length ? Math.round(closed / items.length * 100) : 0};
}

/** What is kept in sessionStorage: presets are stored by name only (so "This month" is still the current month after midnight); custom ranges with their dates. */
export function serializeRange(range: DateRange): string {return JSON.stringify(range.preset === 'custom' ? {preset: 'custom', from: range.from, to: range.to} : {preset: range.preset});}
/** Reads a stored range back; anything missing, malformed or invalid yields the default (This month). */
export function parseStoredRange(raw: string | null | undefined, now = new Date()): DateRange {
 try {
  const v = raw ? JSON.parse(raw) : null;
  if (v && typeof v === 'object' && RANGE_PRESETS.some(p => p.id === v.preset)) {
   if (v.preset !== 'custom') return makeRange(v.preset, now);
   if (typeof v.from === 'string' && typeof v.to === 'string' && !rangeProblem(v.from, v.to)) return {preset: 'custom', from: v.from, to: v.to};
  }
 } catch { /* fall through to the default */ }
 return makeRange(DEFAULT_PRESET, now);
}
