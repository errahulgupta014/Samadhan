/**
 * Pure, dependency-free filtering helpers for the admin tables (no React, no DOM), so they can be unit tested with tests/build-ts.mjs
 * (tests/table-filters.test.mjs). The toolbar component that drives them is `FilterToolbar` in app/form-bits.tsx, which re-exports everything here.
 *
 * State shape (what the toolbar edits):
 *   {query: 'free text', values: {status: 'Published', ...}, ranges: {endsAt: {from: '2026-10-01', to: '2026-10-31'}}}
 * Dates in a range are 'YYYY-MM-DD' strings as produced by <input type="date">, interpreted as whole LOCAL days (From = start of that day, To = end of that day).
 * An empty string means "no limit". A range whose From is after its To is invalid: `rangeProblem` explains it and `applyFilters` ignores that range until it is fixed.
 */

export type DateRange = {from: string; to: string};
export type FilterState = {query: string; values: Record<string, string>; ranges: Record<string, DateRange>};

/** What a row offers to a date-range filter: one instant (ISO string) that must fall inside the range, or a {start, end} interval that must overlap it. Missing/invalid values never match an active range. */
export type DateValue = string | null | undefined | {start?: string | null; end?: string | null};

export type FilterSpec<T> = {
 /** Text of the row that the search box looks at. Every word typed must appear (case-insensitive, any order, any field). */
 search?: (row: T) => ReadonlyArray<string | null | undefined>;
 /** One getter per select filter key: the row's value for it. A select filter matches when this equals the chosen option value exactly. */
 selects?: Record<string, (row: T) => string | null | undefined>;
 /** One getter per date-range filter key. */
 ranges?: Record<string, (row: T) => DateValue>;
};

export const emptyFilters = (): FilterState => ({query: '', values: {}, ranges: {}});

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Milliseconds at the start (or, with `end`, the last millisecond) of a local calendar day 'YYYY-MM-DD'; NaN when the text is not a real date. */
export function dayBound(ymd: string, end = false): number {
 const m = DAY.exec(ymd ?? ''); if (!m) return NaN;
 const y = +m[1], mo = +m[2] - 1, d = +m[3], date = new Date(y, mo, d, end ? 23 : 0, end ? 59 : 0, end ? 59 : 0, end ? 999 : 0);
 return date.getFullYear() === y && date.getMonth() === mo && date.getDate() === d ? +date : NaN;
}

export const rangeActive = (r?: DateRange | null) => !!r && (!!r.from || !!r.to);
/** '' when the range is usable (including empty); otherwise a sentence for the user. */
export function rangeProblem(r?: DateRange | null): string {
 if (!r) return '';
 if ((r.from && !Number.isFinite(dayBound(r.from))) || (r.to && !Number.isFinite(dayBound(r.to)))) return 'Enter a valid date.';
 if (r.from && r.to && dayBound(r.from) > dayBound(r.to, true)) return 'The From date must be on or before the To date.';
 return '';
}

/** Number of additional filters in use (selects with a choice, date ranges with a From or To). The search text is not counted. */
export function activeFilterCount(state: FilterState): number {
 return Object.values(state.values).filter(v => !!v).length + Object.values(state.ranges).filter(rangeActive).length;
}
/** True when anything at all (search text or a filter) narrows the list: this is what enables "Clear filters". */
export const hasActiveFilters = (state: FilterState) => !!state.query.trim() || activeFilterCount(state) > 0;
/** Stable string for "did the filters change?", e.g. to send a paged list back to its first page. */
export const filterKey = (state: FilterState) => JSON.stringify([state.query.trim().toLowerCase(), Object.entries(state.values).filter(([, v]) => v).sort(), Object.entries(state.ranges).filter(([, r]) => rangeActive(r)).sort()]);

function inRange(value: DateValue, range: DateRange): boolean {
 const lo = range.from ? dayBound(range.from) : -Infinity, hi = range.to ? dayBound(range.to, true) : Infinity;
 if (value && typeof value === 'object') {
  const s = value.start ? +new Date(value.start) : NaN, e = value.end ? +new Date(value.end) : NaN;
  if (Number.isNaN(s) && Number.isNaN(e)) return false;
  return (Number.isNaN(e) ? Infinity : e) >= lo && (Number.isNaN(s) ? -Infinity : s) <= hi; // overlap
 }
 const t = value ? +new Date(value) : NaN;
 return Number.isFinite(t) && t >= lo && t <= hi;
}

/** Rows that satisfy the search text AND every chosen select AND every valid date range. Returns a new array in the original order; `rows` is not modified. */
export function applyFilters<T>(rows: readonly T[], state: FilterState, spec: FilterSpec<T>): T[] {
 const words = state.query.toLowerCase().split(/\s+/).filter(Boolean);
 const selects = Object.entries(state.values).filter(([k, v]) => v && spec.selects?.[k]);
 const ranges = Object.entries(state.ranges).filter(([k, r]) => rangeActive(r) && !rangeProblem(r) && spec.ranges?.[k]);
 return rows.filter(row => {
  if (words.length && spec.search) {const hay = spec.search(row).map(t => (t ?? '').toLowerCase()).join(' \n '); if (!words.every(w => hay.includes(w))) return false;}
  for (const [k, v] of selects) if ((spec.selects![k](row) ?? '') !== v) return false;
  for (const [k, r] of ranges) if (!inRange(spec.ranges![k](row), r)) return false;
  return true;
 });
}

/** Distinct non-empty values of a text field as select options, sorted A to Z (e.g. all advertisers in the data). */
export function distinctOptions<T>(rows: readonly T[], get: (row: T) => string | null | undefined): {value: string; label: string}[] {
 return [...new Set(rows.map(r => (get(r) ?? '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)).map(v => ({value: v, label: v}));
}

/** {value, label} options from plain strings (value and label are the same text). */
export const plainOptions = (values: readonly string[]) => values.map(v => ({value: v, label: v}));
