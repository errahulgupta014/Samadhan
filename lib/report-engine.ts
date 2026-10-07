import {statuses, type Complaint, type Department, type IssueCategory} from '../shared/domain';
import type {AdminResident, Ward} from '../shared/community';
import {DEFAULT_PRESET, addDays, bucketUnit, dayCount, inRange, makeRange, parseStoredRange, parseYmd, rangeLabel, rangeProblem, toYmd, type BucketUnit, type DateRange} from './date-range';
import {PRIORITIES, UNASSIGNED, assigneeValue, departmentFilterOptions, isOpenComplaint, type FilterOption} from './complaint-filters';
import {departmentFor} from './service';
import {ALL_WARDS, NO_WARD, wardFilterOptions, wardLabelOf} from './complaint-wards';
import {compareWards} from './wards';

/**
 * The report engine behind the admin Reports page: filters, grouping, metrics, KPI cards, chart data, sorting and the CSV / Excel / JSON file builders.
 * Pure and dependency-free (no React, no DOM, no I/O) so it can be unit tested in any time zone (tests/report-engine.test.mjs); every number the page shows comes from here.
 *
 * Definitions (the same ones the Complaints page and the dashboard use):
 *  - A complaint belongs to a report by the local calendar day it was created (lib/date-range.ts, both ends of the range inclusive).
 *  - Open = not Closed and not Rejected / Duplicate. Resolved = status Closed. Overdue = open and past its resolution target (dueAt) at the moment the report is generated.
 *  - Days to close = first 'Closed' entry of the complaint timeline minus createdAt. SLA met = closed on or before the resolution target; the percentage is over closed complaints with a known closing time.
 *  - Ward = the ward stored on the complaint; department = the assigned department (by id, else by name); category = the live category (by id, else by stored name).
 * Privacy: grouped reports never read a resident's name or mobile number. The complaint register adds them only when asked (includeResident). The app-users report is built from counts
 * only: its input type does not even include names, mobile numbers, e-mails or addresses.
 */

export type ReportType = 'register' | 'category' | 'department' | 'ward' | 'status' | 'priority' | 'trend' | 'resolution' | 'ageing' | 'localities' | 'users' | 'custom';
export type Dim = 'category' | 'department' | 'ward' | 'status' | 'priority' | 'locality' | 'day' | 'week' | 'month' | 'outcome';
export type MetricId = 'complaints' | 'open' | 'resolved' | 'overdue' | 'slaPct' | 'avgDays' | 'medianDays';
export type TrendUnit = 'auto' | BucketUnit;
export type UserDim = 'month' | 'ward' | 'language';

export const REPORT_TYPES: {id: ReportType; label: string; hint: string; usersOnly?: boolean}[] = [
 {id: 'register', label: 'Complaint register', hint: 'One row per complaint'},
 {id: 'category', label: 'Summary by Category', hint: 'Counts and performance per category'},
 {id: 'department', label: 'Summary by Department', hint: 'Who is handling what'},
 {id: 'ward', label: 'Summary by Ward', hint: 'Counts and performance per ward'},
 {id: 'status', label: 'Summary by Status', hint: 'Where complaints stand'},
 {id: 'priority', label: 'Summary by Priority', hint: 'Critical to low'},
 {id: 'trend', label: 'Trend over time', hint: 'Complaints per day, week or month'},
 {id: 'resolution', label: 'Resolution performance', hint: 'Resolved vs open, overdue, SLA met, days to close'},
 {id: 'ageing', label: 'Ageing of open complaints', hint: '0–2, 3–7, 8–14 and 15+ days'},
 {id: 'localities', label: 'Locality hotspots', hint: 'Localities with the most complaints'},
 {id: 'users', label: 'App users registrations', hint: 'Registrations by month, ward or language (counts only)', usersOnly: true},
 {id: 'custom', label: 'Custom', hint: 'Pick your own grouping and metrics'},
];
export const DIMENSIONS: {id: Dim; label: string; time?: boolean}[] = [
 {id: 'category', label: 'Category'}, {id: 'department', label: 'Department'}, {id: 'ward', label: 'Ward'}, {id: 'status', label: 'Status'}, {id: 'priority', label: 'Priority'},
 {id: 'locality', label: 'Locality'}, {id: 'day', label: 'Day', time: true}, {id: 'week', label: 'Week', time: true}, {id: 'month', label: 'Month', time: true}, {id: 'outcome', label: 'Resolved / Open'},
];
/** A "Then by" column set would be too wide for days and weeks, so only months may be spread across columns. */
export const THEN_BY_DIMENSIONS = DIMENSIONS.filter(d => d.id !== 'day' && d.id !== 'week');
export const METRICS: {id: MetricId; label: string; kind: 'int' | 'pct' | 'days'; additive: boolean}[] = [
 {id: 'complaints', label: 'Complaints', kind: 'int', additive: true}, {id: 'open', label: 'Open', kind: 'int', additive: true}, {id: 'resolved', label: 'Resolved', kind: 'int', additive: true},
 {id: 'overdue', label: 'Overdue', kind: 'int', additive: true}, {id: 'slaPct', label: 'SLA met %', kind: 'pct', additive: false}, {id: 'avgDays', label: 'Avg days to close', kind: 'days', additive: false},
 {id: 'medianDays', label: 'Median days to close', kind: 'days', additive: false},
];
export const DEFAULT_METRICS: MetricId[] = ['complaints', 'open', 'resolved', 'overdue', 'slaPct', 'avgDays'];
export const RESOLUTION_METRICS: MetricId[] = ['complaints', 'open', 'resolved', 'overdue', 'slaPct', 'avgDays', 'medianDays'];
export const RESOLUTION_BREAKDOWNS: Dim[] = ['department', 'category', 'ward', 'priority', 'month'];
export const USER_DIMENSIONS: {id: UserDim; label: string}[] = [{id: 'month', label: 'Month'}, {id: 'ward', label: 'Ward'}, {id: 'language', label: 'Language'}];
export const TREND_UNITS: {id: TrendUnit; label: string}[] = [{id: 'auto', label: 'Automatic'}, {id: 'day', label: 'Daily'}, {id: 'week', label: 'Weekly'}, {id: 'month', label: 'Monthly'}];
export const AGE_BUCKETS = [{key: '0-2', label: '0–2 days', min: 0, max: 2}, {key: '3-7', label: '3–7 days', min: 3, max: 7}, {key: '8-14', label: '8–14 days', min: 8, max: 14}, {key: '15+', label: '15+ days', min: 15, max: Infinity}];
export const STATUS_OPEN_GROUP = 'group:open';
export const STATUS_RESOLVED_GROUP = 'group:resolved';
export const CONFIG_STORAGE_KEY = 'samadhan.reports.config';
/** The most groups a chart draws before the rest are summed into "Other", and the most "Then by" columns before the rest are merged. */
export const CHART_TOP = 10;
export const CROSS_COLUMNS = 12;
export const CROSS_CHART_ROWS = 15;
export const TIME_CHART_ROWS = 40;
export const DAY_MS = 86400000;

export type ReportFilters = {range: DateRange; status: string; category: string; priority: string; department: string; ward: string; overdueOnly: boolean; query: string};
export type ReportConfig = {
 type: ReportType; group: Dim; thenBy: Dim | ''; metrics: MetricId[]; cellMetric: MetricId; trendUnit: TrendUnit; resolutionBy: Dim; userGroup: UserDim;
 /** Complaint register only: add the resident's name and mobile number. Never remembered, off by default. */
 includeResident: boolean; filters: ReportFilters;
};
export type UserRow = Pick<AdminResident, 'registeredAt' | 'wardId' | 'wardLabel' | 'language' | 'blocked' | 'complaintCount'>;
export type ReportInput = {
 complaints: Complaint[]; categories: IssueCategory[]; departments?: Department[]; wards?: Pick<Ward, 'id' | 'number' | 'name' | 'active'>[]; slaHours?: number;
 /** Only for administrators who hold residents.manage. */
 residents?: UserRow[];
};

export type Cell = string | number | null;
export type ColumnKind = 'text' | 'int' | 'pct' | 'days' | 'date';
export type Column = {id: string; label: string; kind: ColumnKind; wide?: boolean};
/** `cells` follow the column order; `sort` (when present) holds the values to sort by where the shown text would sort wrongly (periods). */
export type ReportRow = {key: string; cells: Cell[]; sort?: (Cell | undefined)[]};
export type Kpi = {id: string; label: string; value: string; raw: number | null; caption: string; tone: 'blue' | 'orange' | 'green' | 'red' | 'purple' | 'navy'};
export type ChartItem = {key: string; label: string; value: number; color?: string};
export type ChartUnit = 'count' | 'pct' | 'days';
export type ChartSpec =
 | {kind: 'bar'; title: string; valueLabel: string; unit: ChartUnit; items: ChartItem[]; note?: string}
 | {kind: 'donut'; title: string; valueLabel: string; items: ChartItem[]; total: number; centerLabel: string; note?: string}
 | {kind: 'line'; title: string; valueLabel: string; unit: ChartUnit; points: {key: string; label: string; title: string}[]; series: {id: string; name: string; color: string; values: (number | null)[]}[]; note?: string}
 | {kind: 'stacked'; title: string; valueLabel: string; series: {key: string; label: string; color: string}[]; rows: {key: string; label: string; values: number[]; total: number}[]; note?: string}
 | {kind: 'empty'; title: string; message: string};
export type Report = {
 type: ReportType; title: string; headline: string; filterParts: string[]; generatedAt: string; from: string; to: string; recordCount: number; recordNoun: string; slug: string;
 kpis: Kpi[]; columns: Column[]; rows: ReportRow[]; totals: Cell[] | null; chart: ChartSpec; notes: string[]; includesResidentDetails: boolean;
};
export type SortState = {col: string; dir: 'asc' | 'desc'} | null;

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const round1 = (n: number) => Math.round(n * 10) / 10;
/** 12 -> "12", 12.5 -> "12.5", 12.04 -> "12". */
export const fmtNum = (n: number, digits = 1) => String(Number(n.toFixed(digits)));
/** "2026-10-06" -> "6 Oct 2026" ('' when it is not a date). */
export function dayLabel(ymd: string): string {const d = parseYmd(ymd); return d ? `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` : '';}
const ms = (iso: unknown): number => typeof iso === 'string' ? Date.parse(iso) : NaN;
const ymdOf = (t: number) => Number.isFinite(t) ? toYmd(new Date(t)) : '';
const median = (values: number[]) => {const s = [...values].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;};
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const dimLabel = (dim: Dim) => DIMENSIONS.find(d => d.id === dim)?.label ?? dim;
const metricMeta = (id: MetricId) => METRICS.find(m => m.id === id) ?? METRICS[0];
const isTimeDim = (dim: Dim) => dim === 'day' || dim === 'week' || dim === 'month';

/** Colours that read on white and sit with the portal's navy / green / saffron. */
export const PALETTE = ['#172D4F', '#197448', '#F3A24C', '#2473a0', '#7a5aa6', '#c2566a', '#3d8f8f', '#a0a84a', '#d1783a', '#8593da', '#6b7c8c', '#b6cedc'];
export const colorAt = (i: number) => PALETTE[i % PALETTE.length];
const STATUS_COLORS: Record<string, string> = {'Submitted': '#2d73b1', 'Acknowledged': '#7663ad', 'Assigned': '#4f5fb8', 'In Progress': '#d9902f', 'On Hold': '#b66548', 'Resolution Proposed': '#147c80', 'Closed': '#23815e', 'Reopened': '#c2566a', 'Rejected / Duplicate': '#8593a0'};
const PRIORITY_COLORS: Record<string, string> = {Critical: '#b3261e', High: '#d9902f', Normal: '#2473a0', Low: '#8ba3b8'};
const OUTCOME_COLORS: Record<string, string> = {Open: '#d9902f', Resolved: '#23815e', 'Rejected / duplicate': '#8593a0'};
const PRIORITY_ORDER = ['Critical', 'High', 'Normal', 'Low'];

/* ------------------------------------------------------------------ */
/* Time buckets                                                        */
/* ------------------------------------------------------------------ */
export type TimeBucket = {key: string; from: string; to: string; /** Axis label: "1 Oct", "Oct 26". */ short: string; /** Table label: "1 Oct 2026", "5 Oct 2026 – 11 Oct 2026", "Oct 2026". */ label: string};
/** Calendar buckets for a range: days, Monday-to-Sunday weeks (the first and last clipped to the range) or calendar months (clipped too). */
export function bucketsForUnit(from: string, to: string, unit: BucketUnit): TimeBucket[] {
 const out: TimeBucket[] = [], days = dayCount(from, to); if (!days) return out;
 const short = (ymd: string) => {const d = parseYmd(ymd)!; return `${d.getDate()} ${MONTHS[d.getMonth()]}`;};
 if (unit === 'day') {for (let i = 0; i < days; i++) {const day = addDays(from, i); out.push({key: day, from: day, to: day, short: short(day), label: dayLabel(day)});} return out;}
 let start = from;
 while (start <= to) {
  const d = parseYmd(start)!; let end = unit === 'week' ? addDays(start, (7 - ((d.getDay() + 6) % 7)) - 1) : toYmd(new Date(d.getFullYear(), d.getMonth() + 1, 0));
  if (end > to) end = to;
  out.push(unit === 'week'
   ? {key: start, from: start, to: end, short: short(start), label: rangeLabel(start, end)}
   : {key: start, from: start, to: end, short: `${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`, label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`});
  start = addDays(end, 1);
 }
 return out;
}
/** The chart unit a trend uses: the chosen one, or (Automatic) days up to 31 days of range, weeks up to 122, months beyond, like the dashboard. */
export const trendUnitFor = (choice: TrendUnit, from: string, to: string): BucketUnit => choice === 'auto' ? bucketUnit(dayCount(from, to)) : choice;

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */
export function defaultFilters(now = new Date()): ReportFilters {return {range: makeRange(DEFAULT_PRESET, now), status: '', category: '', priority: '', department: '', ward: '', overdueOnly: false, query: ''};}
export function defaultConfig(now = new Date()): ReportConfig {
 return {type: 'category', group: 'category', thenBy: '', metrics: [...DEFAULT_METRICS], cellMetric: 'complaints', trendUnit: 'auto', resolutionBy: 'department', userGroup: 'month', includeResident: false, filters: defaultFilters(now)};
}
const orderedMetrics = (list: readonly string[]): MetricId[] => METRICS.map(m => m.id).filter(id => list.includes(id));
/** The dimension each ready-made summary groups by. */
const PRESET_GROUP: Partial<Record<ReportType, Dim>> = {category: 'category', department: 'department', ward: 'ward', status: 'status', priority: 'priority', localities: 'locality'};

/** A configuration with every field made valid (unknown values fall back, "Then by" cannot repeat the group or be days/weeks, the cell metric must be a count). */
export function resolveConfig(config: ReportConfig): ReportConfig {
 const dims = DIMENSIONS.map(d => d.id);
 const group: Dim = PRESET_GROUP[config.type] ?? (dims.includes(config.group) ? config.group : 'category');
 const thenBy: Dim | '' = config.type === 'custom' && THEN_BY_DIMENSIONS.some(d => d.id === config.thenBy) && config.thenBy !== group ? config.thenBy : '';
 const metrics = config.type === 'custom' ? (orderedMetrics(config.metrics).length ? orderedMetrics(config.metrics) : ['complaints' as MetricId]) : config.type === 'resolution' ? RESOLUTION_METRICS : DEFAULT_METRICS;
 const cellMetric = METRICS.some(m => m.id === config.cellMetric && m.additive) ? config.cellMetric : 'complaints';
 return {...config, group, thenBy, metrics, cellMetric, trendUnit: TREND_UNITS.some(u => u.id === config.trendUnit) ? config.trendUnit : 'auto',
  resolutionBy: RESOLUTION_BREAKDOWNS.includes(config.resolutionBy) ? config.resolutionBy : 'department', userGroup: USER_DIMENSIONS.some(u => u.id === config.userGroup) ? config.userGroup : 'month'};
}
/** Plain-English reason the configuration cannot be generated, or '' when it can. */
export function configProblem(config: ReportConfig): string {
 const range = rangeProblem(config.filters.range.from, config.filters.range.to); if (range) return range;
 if (config.type === 'custom' && !config.thenBy && !orderedMetrics(config.metrics).length) return 'Tick at least one metric.';
 return '';
}
export const sameConfig = (a: ReportConfig, b: ReportConfig) => canonical(a) === canonical(b);
function canonical(c: ReportConfig): string {
 const r = resolveConfig(c), f = r.filters;
 return JSON.stringify([r.type, r.group, r.thenBy, r.metrics, r.cellMetric, r.trendUnit, r.resolutionBy, r.userGroup, r.includeResident, f.range.from, f.range.to, f.status, f.category, f.priority, f.department, f.ward, f.overdueOnly, f.query.trim().toLowerCase()]);
}
/** Number of filters narrowing the report (date range excluded: it is always on). */
export function activeFilterCount(f: ReportFilters): number {return [f.status, f.category, f.priority, f.department, f.ward].filter(Boolean).length + (f.overdueOnly ? 1 : 0) + (f.query.trim() ? 1 : 0);}

/** What is kept in sessionStorage: the configuration and the Live switch, never the resident-details choice. Presets of the date range are stored by name so "This month" stays the current month. */
export function serializeConfig(config: ReportConfig, live: boolean): string {
 const r = config.filters.range, f = config.filters;
 return JSON.stringify({v: 1, live, type: config.type, group: config.group, thenBy: config.thenBy, metrics: config.metrics, cellMetric: config.cellMetric, trendUnit: config.trendUnit, resolutionBy: config.resolutionBy, userGroup: config.userGroup,
  filters: {range: r.preset === 'custom' ? {preset: 'custom', from: r.from, to: r.to} : {preset: r.preset}, status: f.status, category: f.category, priority: f.priority, department: f.department, ward: f.ward, overdueOnly: f.overdueOnly, query: f.query}});
}
/** Reads a stored configuration back; anything missing or invalid falls back to the default value of that field. Report types for app users need `allowUsers`. */
export function parseStoredConfig(raw: string | null | undefined, now: Date, opts: {allowUsers: boolean}): {config: ReportConfig; live: boolean} {
 const base = defaultConfig(now); let parsed: unknown = null;
 try {parsed = raw ? JSON.parse(raw) : null;} catch {parsed = null;}
 const isRecord = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
 if (!isRecord(parsed)) return {config: base, live: true};
 const v = parsed;
 const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => allowed.includes(value as T) ? value as T : fallback;
 const text = (value: unknown) => typeof value === 'string' ? value.slice(0, 200) : '';
 const types = REPORT_TYPES.filter(t => opts.allowUsers || !t.usersOnly).map(t => t.id);
 const f: Record<string, unknown> = isRecord(v.filters) ? v.filters : {};
 const metrics = Array.isArray(v.metrics) ? orderedMetrics(v.metrics.filter((m): m is string => typeof m === 'string')) : base.metrics;
 const config: ReportConfig = {
  type: pick(v.type, types, base.type), group: pick(v.group, DIMENSIONS.map(d => d.id), base.group), thenBy: pick(v.thenBy, ['', ...THEN_BY_DIMENSIONS.map(d => d.id)] as (Dim | '')[], ''),
  metrics, cellMetric: pick(v.cellMetric, METRICS.map(m => m.id), base.cellMetric), trendUnit: pick(v.trendUnit, TREND_UNITS.map(u => u.id), 'auto'),
  resolutionBy: pick(v.resolutionBy, RESOLUTION_BREAKDOWNS, 'department'), userGroup: pick(v.userGroup, USER_DIMENSIONS.map(u => u.id), 'month'), includeResident: false,
  filters: {range: parseStoredRange(JSON.stringify(f.range ?? null), now), status: text(f.status), category: text(f.category), priority: text(f.priority), department: text(f.department), ward: text(f.ward), overdueOnly: f.overdueOnly === true, query: text(f.query)},
 };
 return {config, live: v.live !== false};
}

/* ------------------------------------------------------------------ */
/* Filter options                                                      */
/* ------------------------------------------------------------------ */
export type FilterOptions = {status: FilterOption[]; category: FilterOption[]; priority: FilterOption[]; department: FilterOption[]; ward: FilterOption[]};
/** Choices for the report filters. Departments and wards reuse the Complaints page rules (renamed departments keep their complaints; inactive ones are marked). Wards are offered as soon as one exists. */
export function reportFilterOptions(input: Pick<ReportInput, 'complaints' | 'categories' | 'departments' | 'wards'>): FilterOptions {
 const {complaints} = input, used = new Set(complaints.map(c => c.category));
 const known = [...input.categories].sort((a, b) => a.sortOrder - b.sortOrder || a.nameEn.localeCompare(b.nameEn)).filter(c => c.enabled || used.has(c.nameEn)).map(c => c.nameEn);
 const category = [...new Set([...known, ...complaints.map(c => c.category).filter(Boolean)])].map(v => ({value: v, label: v}));
 const extra = [...new Set(complaints.map(c => c.priority))].filter(p => p && !(PRIORITIES as readonly string[]).includes(p));
 return {
  status: [{value: STATUS_OPEN_GROUP, label: 'Open (not closed or rejected)'}, {value: STATUS_RESOLVED_GROUP, label: 'Resolved (closed)'}, ...statuses.map(s => ({value: s as string, label: s as string}))],
  category, priority: [...PRIORITIES, ...extra].map(v => ({value: v, label: v})), department: departmentFilterOptions(input.departments, complaints),
  ward: (input.wards?.length ?? 0) >= 1 ? wardFilterOptions(input.wards, complaints).filter(o => o.value !== ALL_WARDS) : [],
 };
}
/** Clears any filter value that is no longer one of its choices (a department that was removed, a stale stored category). */
export function reconcileFilters(f: ReportFilters, options: FilterOptions): ReportFilters {
 const keep = (value: string, list: FilterOption[]) => list.some(o => o.value === value) ? value : '';
 return {...f, status: keep(f.status, options.status), category: keep(f.category, options.category), priority: keep(f.priority, options.priority), department: keep(f.department, options.department), ward: keep(f.ward, options.ward)};
}

/* ------------------------------------------------------------------ */
/* Rows: what the engine knows about each complaint                    */
/* ------------------------------------------------------------------ */
type Grp = {key: string; label: string; color?: string};
type Row = {
 src: Complaint; id: string; title: string; locality: string; localityKey: string; category: Grp; department: Grp; ward: Grp; priority: string; status: string;
 createdMs: number; createdYmd: string; dueMs: number; closedMs: number | null; open: boolean; resolved: boolean; overdue: boolean; slaMet: boolean | null; closeDays: number | null; ageDays: number | null;
};
type Ctx = {now: number; today: string; from: string; to: string; wardOrder: Map<string, number>; input: ReportInput; options: FilterOptions};

/** First (earliest) 'Closed' entry of the timeline, only for a complaint that is Closed now (a reopened complaint is open again). */
export function closedAtOf(c: Pick<Complaint, 'status' | 'history'>): number | null {
 if (c.status !== 'Closed') return null;
 let first: number | null = null;
 for (const h of c.history ?? []) if (h && h.status === 'Closed') {const t = ms(h.at); if (Number.isFinite(t) && (first === null || t < first)) first = t;}
 return first;
}
function makeRow(c: Complaint, ctx: Ctx): Row {
 const {categories, departments, wards} = ctx.input, slaMs = (ctx.input.slaHours ?? 48) * 3600000;
 const cat = categories.find(x => c.categoryId ? x.id === c.categoryId : x.nameEn === c.category) ?? categories.find(x => x.nameEn === c.category);
 const categoryLabel = cat?.nameEn ?? (c.category || 'Uncategorised');
 const deptKey = assigneeValue(c, departments), dept = deptKey === UNASSIGNED ? undefined : departmentFor({departments}, c);
 const wardId = c.wardId || '', wardRecord = wardId ? wards?.find(w => w.id === wardId) : undefined;
 const wardLabel = c.wardLabel || (wardRecord ? wardLabelOf(wardRecord) : '') || (wardId ? 'Unknown ward' : 'No ward recorded');
 const createdMs = ms(c.createdAt); let dueMs = ms(c.dueAt); if (!Number.isFinite(dueMs) && Number.isFinite(createdMs)) dueMs = createdMs + slaMs;
 const open = isOpenComplaint(c), resolved = c.status === 'Closed', closedMs = closedAtOf(c);
 const overdue = open && Number.isFinite(dueMs) && dueMs < ctx.now;
 const slaMet = resolved && closedMs !== null && Number.isFinite(dueMs) ? closedMs <= dueMs : null;
 const closeDays = resolved && closedMs !== null && Number.isFinite(createdMs) ? Math.max(0, (closedMs - createdMs) / DAY_MS) : null;
 const locality = (c.locality ?? '').replace(/\s+/g, ' ').trim();
 return {
  src: c, id: c.id, title: c.title, locality, localityKey: locality.toLowerCase(), priority: c.priority, status: c.status,
  category: {key: categoryLabel, label: categoryLabel, color: cat?.color}, department: {key: deptKey, label: deptKey === UNASSIGNED ? 'Unassigned' : dept?.name ?? c.assignee ?? 'Unassigned'}, ward: {key: wardId || NO_WARD, label: wardLabel},
  createdMs, createdYmd: ymdOf(createdMs), dueMs, closedMs, open, resolved, overdue, slaMet, closeDays, ageDays: open && Number.isFinite(createdMs) ? Math.max(0, (ctx.now - createdMs) / DAY_MS) : null,
 };
}
function makeCtx(input: ReportInput, filters: ReportFilters, now: number): Ctx {
 const wardOrder = new Map<string, number>(); [...(input.wards ?? [])].sort(compareWards).forEach((w, i) => wardOrder.set(w.id, i));
 return {now, today: toYmd(new Date(now)), from: filters.range.from, to: filters.range.to, wardOrder, input, options: reportFilterOptions(input)};
}
function matches(r: Row, f: ReportFilters, words: string[]): boolean {
 if (!inRange(r.src.createdAt, f.range.from, f.range.to)) return false;
 if (f.status === STATUS_OPEN_GROUP ? !r.open : f.status === STATUS_RESOLVED_GROUP ? !r.resolved : f.status && r.status !== f.status) return false;
 if (f.category && r.category.label !== f.category) return false;
 if (f.priority && r.priority !== f.priority) return false;
 if (f.department && r.department.key !== f.department) return false;
 if (f.ward && r.ward.key !== f.ward) return false;
 if (f.overdueOnly && !r.overdue) return false;
 if (words.length) {const hay = `${r.id}\n${r.title}\n${r.locality}`.toLowerCase(); if (!words.every(w => hay.includes(w))) return false;}
 return true;
}
/** The complaints a report is built from: every filter combined with AND. */
function filteredRows(ctx: Ctx, f: ReportFilters): Row[] {
 const words = f.query.toLowerCase().split(/\s+/).filter(Boolean);
 return ctx.input.complaints.map(c => makeRow(c, ctx)).filter(r => matches(r, f, words));
}

/* ------------------------------------------------------------------ */
/* Aggregation                                                         */
/* ------------------------------------------------------------------ */
type Acc = {n: number; open: number; resolved: number; overdue: number; slaEval: number; slaMet: number; days: number[]};
const newAcc = (): Acc => ({n: 0, open: 0, resolved: 0, overdue: 0, slaEval: 0, slaMet: 0, days: []});
function addRow(a: Acc, r: Row) {a.n++; if (r.open) a.open++; if (r.resolved) a.resolved++; if (r.overdue) a.overdue++; if (r.slaMet !== null) {a.slaEval++; if (r.slaMet) a.slaMet++;} if (r.closeDays !== null) a.days.push(r.closeDays);}
function metricValue(a: Acc, m: MetricId): number | null {
 switch (m) {
  case 'complaints': return a.n; case 'open': return a.open; case 'resolved': return a.resolved; case 'overdue': return a.overdue;
  case 'slaPct': return a.slaEval ? round1(a.slaMet / a.slaEval * 100) : null;
  case 'avgDays': return a.days.length ? round1(a.days.reduce((s, d) => s + d, 0) / a.days.length) : null;
  case 'medianDays': return a.days.length ? round1(median(a.days)) : null;
 }
}
type GroupDef = {key: string; label: string; color?: string; order: number; sort: string; short?: string; future?: boolean};
type Grouping = {time: boolean; natural: boolean; seeded: GroupDef[]; of: (r: Row) => GroupDef};
const OTHER_DATES: GroupDef = {key: '__other', label: 'Other dates', order: 9999, sort: '~'};
function lazy(pick: (r: Row) => Grp, order: (g: Grp) => number = () => 0): (r: Row) => GroupDef {
 const cache = new Map<string, GroupDef>();
 return r => {const g = pick(r); let d = cache.get(g.key); if (!d) {d = {key: g.key, label: g.label, color: g.color, order: order(g), sort: g.label}; cache.set(g.key, d);} return d;};
}
function timeGrouping(unit: BucketUnit, ctx: Ctx): Grouping {
 const idx = new Map<string, number>(), list = bucketsForUnit(ctx.from, ctx.to, unit);
 const seeded: GroupDef[] = list.map((b, i) => {for (let day = b.from; day <= b.to; day = addDays(day, 1)) idx.set(day, i); return {key: b.key, label: b.label, short: b.short, order: i, sort: b.from, future: b.from > ctx.today};});
 return {time: true, natural: true, seeded, of: r => seeded[idx.get(r.createdYmd) ?? -1] ?? OTHER_DATES};
}
function groupingFor(dim: Dim, ctx: Ctx, rows: Row[]): Grouping {
 switch (dim) {
  case 'category': return {time: false, natural: false, seeded: [], of: lazy(r => r.category)};
  case 'department': return {time: false, natural: false, seeded: [], of: lazy(r => r.department)};
  case 'ward': return {time: false, natural: true, seeded: [], of: lazy(r => r.ward, g => g.key === NO_WARD ? 100000 : ctx.wardOrder.get(g.key) ?? 50000)};
  case 'status': return {time: false, natural: true, seeded: [], of: lazy(r => ({key: r.status, label: r.status, color: STATUS_COLORS[r.status]}), g => {const i = (statuses as readonly string[]).indexOf(g.key); return i < 0 ? 100 : i;})};
  case 'priority': return {time: false, natural: true, seeded: [], of: lazy(r => ({key: r.priority, label: r.priority, color: PRIORITY_COLORS[r.priority]}), g => {const i = PRIORITY_ORDER.indexOf(g.key); return i < 0 ? 100 : i;})};
  case 'outcome': return {time: false, natural: true, seeded: [], of: lazy(r => {const label = r.open ? 'Open' : r.resolved ? 'Resolved' : 'Rejected / duplicate'; return {key: label, label, color: OUTCOME_COLORS[label]};}, g => ['Open', 'Resolved', 'Rejected / duplicate'].indexOf(g.key))};
  case 'locality': {
   // Free-text localities are grouped ignoring case and extra spaces; the most common spelling is the label.
   const spellings = new Map<string, Map<string, number>>();
   for (const r of rows) {const m = spellings.get(r.localityKey) ?? new Map<string, number>(); m.set(r.locality, (m.get(r.locality) ?? 0) + 1); spellings.set(r.localityKey, m);}
   const label = (key: string) => key ? [...spellings.get(key)!.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0] : 'Not recorded';
   return {time: false, natural: false, seeded: [], of: lazy(r => ({key: r.localityKey || '__none', label: label(r.localityKey)}))};
  }
  default: return timeGrouping(dim, ctx);
 }
}
type Agg = {groups: GroupDef[]; accs: Map<string, Acc>; total: Acc};
function aggregate(rows: Row[], g: Grouping): Agg {
 const defs = new Map<string, GroupDef>(), accs = new Map<string, Acc>(), total = newAcc();
 for (const d of g.seeded) {defs.set(d.key, d); accs.set(d.key, newAcc());}
 for (const r of rows) {const d = g.of(r); if (!defs.has(d.key)) {defs.set(d.key, d); accs.set(d.key, newAcc());} addRow(accs.get(d.key)!, r); addRow(total, r);}
 const groups = [...defs.values()].filter(d => !(d.future && accs.get(d.key)!.n === 0)); // days that have not happened yet stay out of the report
 groups.sort(g.natural ? (a, b) => a.order - b.order || a.sort.localeCompare(b.sort) : (a, b) => accs.get(b.key)!.n - accs.get(a.key)!.n || a.label.localeCompare(b.label));
 return {groups, accs, total};
}

/* ------------------------------------------------------------------ */
/* Columns, KPI cards, charts                                          */
/* ------------------------------------------------------------------ */
const kpi = (id: string, label: string, raw: number | null, value: string, caption: string, tone: Kpi['tone']): Kpi => ({id, label, raw, value, caption, tone});
const kpiCount = (id: string, label: string, n: number, caption: string, tone: Kpi['tone']) => kpi(id, label, n, String(n), caption, tone);
function standardKpis(a: Acc): Kpi[] {
 const sla = metricValue(a, 'slaPct'), avg = metricValue(a, 'avgDays'), med = metricValue(a, 'medianDays');
 return [
  kpiCount('total', 'Total complaints', a.n, a.n ? 'In this report' : 'None match these filters', 'blue'), kpiCount('open', 'Open', a.open, 'Not yet closed or rejected', 'orange'),
  kpiCount('resolved', 'Resolved', a.resolved, a.n ? `${fmtNum(a.resolved / a.n * 100)}% of the total` : 'Closed complaints', 'green'), kpiCount('overdue', 'Overdue', a.overdue, 'Open and past the resolution target', 'red'),
  kpi('sla', 'SLA met', sla, sla === null ? '—' : `${fmtNum(sla)}%`, a.slaEval ? `${a.slaMet} of ${a.slaEval} closed on time` : 'No closed complaints yet', 'purple'),
  kpi('avgDays', 'Avg days to close', avg, avg === null ? '—' : fmtNum(avg), med === null ? 'No closed complaints yet' : `Median ${fmtNum(med)} days`, 'navy'),
 ];
}
const metricColumn = (m: MetricId): Column => {const meta = metricMeta(m); return {id: m, label: meta.label, kind: meta.kind};};
const share = (n: number, total: number) => total ? round1(n / total * 100) : 0;
type Summary = {columns: Column[]; rows: ReportRow[]; totals: Cell[]; agg: Agg};
/** One row per group with the chosen metrics, plus a "% of complaints" column when Complaints is among them. */
function summaryTable(rows: Row[], g: Grouping, groupLabel: string, metrics: MetricId[], timeSort: boolean): Summary {
 const agg = aggregate(rows, g), withShare = metrics.includes('complaints');
 const columns: Column[] = [{id: 'group', label: groupLabel, kind: 'text', wide: true}, ...metrics.map(metricColumn), ...(withShare ? [{id: 'share', label: '% of complaints', kind: 'pct' as const}] : [])];
 const cellsFor = (a: Acc) => [...metrics.map(m => metricValue(a, m)), ...(withShare ? [share(a.n, agg.total.n)] : [])];
 const out: ReportRow[] = agg.groups.map(d => ({key: d.key, cells: [d.label, ...cellsFor(agg.accs.get(d.key)!)], ...(timeSort ? {sort: [d.sort]} : {})}));
 return {columns, rows: out, totals: ['Total', ...cellsFor(agg.total)], agg};
}
const unitOf = (m: MetricId): ChartUnit => {const k = metricMeta(m).kind; return k === 'int' ? 'count' : k;};
const unitWord: Record<BucketUnit, string> = {day: 'day', week: 'week', month: 'month'};
const emptyChart = (title: string, message = 'There is nothing to chart for these filters.'): ChartSpec => ({kind: 'empty', title, message});

/** Bars for the largest groups (the rest summed into "Other" when the measure can be added up). The order of the groups is kept. */
function barChart(title: string, valueLabel: string, unit: ChartUnit, items: ChartItem[], additive: boolean): ChartSpec {
 const real = items.filter(i => Number.isFinite(i.value)); if (!real.length || real.every(i => i.value === 0)) return emptyChart(title);
 if (real.length <= CHART_TOP) return {kind: 'bar', title, valueLabel, unit, items: real};
 const top = new Set([...real].sort((a, b) => b.value - a.value).slice(0, CHART_TOP)), shown = real.filter(i => top.has(i)), rest = real.filter(i => !top.has(i));
 return {kind: 'bar', title, valueLabel, unit, items: additive ? [...shown, {key: '__other', label: `Other (${plural(rest.length, 'group')})`, value: rest.reduce((n, i) => n + i.value, 0), color: '#b6cedc'}] : shown,
  note: `Showing the ${CHART_TOP} largest of ${real.length} groups${additive ? ', the rest are added together as Other' : ''}. The table lists all of them.`};
}
const LINE_COLORS = ['#197448', '#172D4F', '#F3A24C', '#2473a0'];
function lineChart(title: string, unit: ChartUnit, agg: Agg, series: {id: string; name: string; metric: MetricId}[]): ChartSpec {
 if (!agg.groups.length || agg.total.n === 0) return emptyChart(title);
 const points = agg.groups.map(d => ({key: d.key, label: d.short ?? d.label, title: d.label}));
 return {kind: 'line', title, valueLabel: series.map(s => s.name).join(' and '), unit, points, series: series.map((s, i) => ({id: s.id, name: s.name, color: LINE_COLORS[i % LINE_COLORS.length], values: agg.groups.map(d => metricValue(agg.accs.get(d.key)!, s.metric))}))};
}
/** Shares that read well as a donut: where the groups are few and fixed. */
const DONUT_DIMS: Dim[] = ['status', 'priority', 'outcome'];
/** The chart that fits a one-dimension summary: line for time (three periods or more), donut for status / priority / resolved-open shares (up to eight), bars otherwise. */
function groupChart(title: string, dim: Dim, agg: Agg, metrics: MetricId[], what: string): ChartSpec {
 const primary = metrics[0], meta = metricMeta(primary), unit = unitOf(primary);
 if (agg.total.n === 0) return emptyChart(title);
 if (isTimeDim(dim) && agg.groups.length >= 3) return lineChart(title, unit, agg, metrics.filter(m => unitOf(m) === unit).slice(0, 4).map(m => ({id: m, name: metricMeta(m).label, metric: m})));
 const semantic = DONUT_DIMS.includes(dim);
 const items: ChartItem[] = agg.groups.map((d, i) => ({key: d.key, label: d.label, value: metricValue(agg.accs.get(d.key)!, primary) ?? NaN, color: semantic ? d.color ?? colorAt(i) : undefined}));
 if (semantic && meta.additive && agg.groups.length <= 8) {const parts = items.filter(i => i.value > 0); if (parts.length) return {kind: 'donut', title, valueLabel: meta.label, items: parts, total: parts.reduce((n, i) => n + i.value, 0), centerLabel: what};}
 return barChart(title, meta.label, unit, items, meta.additive);
}

/* ------------------------------------------------------------------ */
/* Titles and filter summaries                                         */
/* ------------------------------------------------------------------ */
function filterParts(f: ReportFilters, ctx: Ctx, complaintFilters: boolean): string[] {
 const parts = [rangeLabel(f.range.from, f.range.to)];
 const labelOf = (list: FilterOption[], v: string) => list.find(o => o.value === v)?.label ?? v;
 if (complaintFilters) {
  if (f.status) parts.push(`Status: ${f.status === STATUS_OPEN_GROUP ? 'Open' : f.status === STATUS_RESOLVED_GROUP ? 'Resolved' : f.status}`);
  if (f.category) parts.push(`Category: ${f.category}`);
  if (f.priority) parts.push(`Priority: ${f.priority}`);
  if (f.department) parts.push(`Department: ${labelOf(ctx.options.department, f.department)}`);
 }
 if (f.ward) parts.push(`Ward: ${labelOf(ctx.options.ward, f.ward)}`);
 if (complaintFilters) {if (f.overdueOnly) parts.push('Overdue only'); if (f.query.trim()) parts.push(`Search: "${f.query.trim()}"`);}
 return parts;
}
const metricTitle = (m: MetricId) => ({complaints: 'Complaints', open: 'Open complaints', resolved: 'Resolved complaints', overdue: 'Overdue complaints', slaPct: 'SLA met %', avgDays: 'Average days to close', medianDays: 'Median days to close'}[m]);
/** The report's name, e.g. "Complaints by Category" or "Resolved complaints by Category and Status". */
export function reportTitle(config: ReportConfig): string {
 const c = resolveConfig(config);
 switch (c.type) {
  case 'register': return 'Complaint register';
  case 'trend': return `Complaint trend (${{day: 'daily', week: 'weekly', month: 'monthly'}[trendUnitFor(c.trendUnit, c.filters.range.from, c.filters.range.to)]})`;
  case 'resolution': return `Resolution performance by ${dimLabel(c.resolutionBy)}`;
  case 'ageing': return 'Ageing of open complaints';
  case 'localities': return 'Locality hotspots';
  case 'users': return `App users registrations by ${USER_DIMENSIONS.find(u => u.id === c.userGroup)?.label ?? 'Month'}`;
  case 'custom': return `${c.thenBy ? metricTitle(c.cellMetric) : c.metrics.length === 1 ? metricTitle(c.metrics[0]) : 'Complaint summary'} by ${dimLabel(c.group)}${c.thenBy ? ` and ${dimLabel(c.thenBy)}` : ''}`;
  default: return `Complaints by ${dimLabel(c.group)}`;
 }
}
function assemble(config: ReportConfig, ctx: Ctx, complaintFilters: boolean, body: Omit<Report, 'type' | 'title' | 'headline' | 'filterParts' | 'generatedAt' | 'from' | 'to' | 'slug' | 'includesResidentDetails'> & {includesResidentDetails?: boolean}): Report {
 const title = reportTitle(config), parts = filterParts(config.filters, ctx, complaintFilters), f = config.filters;
 return {...body, type: config.type, title, headline: [title, ...parts].join(' · '), filterParts: parts, generatedAt: new Date(ctx.now).toISOString(), from: f.range.from, to: f.range.to, slug: slugify(title), includesResidentDetails: body.includesResidentDetails === true};
}

/* ------------------------------------------------------------------ */
/* The reports                                                         */
/* ------------------------------------------------------------------ */
/** Builds a report from the current workspace data. `now` (ms) is the moment of generation: it decides what is overdue, how old open complaints are and which days have not happened yet. */
export function buildReport(input: ReportInput, config: ReportConfig, now: number): Report {
 const c = resolveConfig(config), ctx = makeCtx(input, c.filters, now);
 if (c.type === 'users') return usersReport(c, ctx);
 const rows = filteredRows(ctx, c.filters), total = newAcc(); rows.forEach(r => addRow(total, r));
 const complaintNote = rows.length ? [] : ['No complaints match these filters.'];
 switch (c.type) {
  case 'register': return registerReport(c, ctx, rows, total);
  case 'trend': return trendReport(c, ctx, rows, total);
  case 'resolution': return resolutionReport(c, ctx, rows, total);
  case 'ageing': return ageingReport(c, ctx, rows);
  case 'custom': return customReport(c, ctx, rows, total);
  default: {
   // The ready-made summaries share one shape: group, the six standard metrics and the share of all complaints.
   const dim = c.group, g = groupingFor(dim, ctx, rows), s = summaryTable(rows, g, dimLabel(dim), DEFAULT_METRICS, false), title = reportTitle(c);
   const note = dim === 'ward' && !(input.wards?.length) ? ['No wards are set up yet, so complaints carry no ward.'] : [];
   return assemble(c, ctx, true, {kpis: standardKpis(total), columns: s.columns, rows: s.rows, totals: s.totals, recordCount: rows.length, recordNoun: 'complaints', chart: groupChart(title, dim, s.agg, DEFAULT_METRICS, 'complaints'), notes: [...complaintNote, ...note, ...standardNotes()]});
  }
 }
}
const standardNotes = () => ['Counts follow the day each complaint was created. Open means not closed or rejected; Overdue means open and past its resolution target when this report was generated.'];

function registerReport(c: ReportConfig, ctx: Ctx, rows: Row[], total: Acc): Report {
 const resident = c.includeResident;
 const columns: Column[] = [
  {id: 'id', label: 'ID', kind: 'text'}, {id: 'title', label: 'Title', kind: 'text', wide: true}, {id: 'category', label: 'Category', kind: 'text'}, {id: 'department', label: 'Department', kind: 'text'}, {id: 'ward', label: 'Ward', kind: 'text'},
  {id: 'priority', label: 'Priority', kind: 'text'}, {id: 'status', label: 'Status', kind: 'text'}, {id: 'created', label: 'Created', kind: 'date'}, {id: 'due', label: 'Due', kind: 'date'}, {id: 'closed', label: 'Closed', kind: 'date'},
  {id: 'daysOpen', label: 'Days open', kind: 'days'}, {id: 'daysToClose', label: 'Days to close', kind: 'days'}, {id: 'locality', label: 'Locality', kind: 'text', wide: true},
  ...(resident ? [{id: 'resident', label: 'Resident name', kind: 'text' as const}, {id: 'mobile', label: 'Resident mobile', kind: 'text' as const}] : []),
 ];
 const sorted = [...rows].sort((a, b) => (b.createdMs || 0) - (a.createdMs || 0) || a.id.localeCompare(b.id));
 const sortKeys = (r: Row) => {const s: (Cell | undefined)[] = []; s[7] = r.createdMs; s[8] = Number.isFinite(r.dueMs) ? r.dueMs : null; s[9] = r.closedMs; return s;}; // dates sort by the exact moment, not just the day shown
 const out: ReportRow[] = sorted.map(r => ({key: r.id, sort: sortKeys(r), cells: [
  r.id, r.title, r.category.label, r.department.label, r.ward.label, r.priority, r.status, r.createdYmd || null, Number.isFinite(r.dueMs) ? ymdOf(r.dueMs) : null, r.closedMs !== null ? ymdOf(r.closedMs) : null,
  r.ageDays !== null ? round1(r.ageDays) : null, r.closeDays !== null ? round1(r.closeDays) : null, r.locality || null,
  ...(resident ? [r.src.resident || null, r.src.mobile || null] : []),
 ]}));
 const trend = trendOf(rows, c, ctx);
 return assemble(c, ctx, true, {kpis: standardKpis(total), columns, rows: out, totals: null, recordCount: rows.length, recordNoun: 'complaints', chart: trend.chart, includesResidentDetails: resident,
  notes: [...(rows.length ? [] : ['No complaints match these filters.']), 'Days open is counted for open complaints up to the moment of generation; Days to close uses the first Closed entry in the timeline.', ...(resident ? ['This register includes resident names and mobile numbers. Share the file only with people who need them.'] : ['Resident names and mobile numbers are not included.'])]});
}
/** Complaints received per period and how many of them are resolved: the table of the trend report and the chart of the register. */
function trendOf(rows: Row[], c: ReportConfig, ctx: Ctx) {
 const unit = trendUnitFor(c.trendUnit, ctx.from, ctx.to), g = timeGrouping(unit, ctx), agg = aggregate(rows, g), title = `Complaints received per ${unitWord[unit]}`;
 let chart: ChartSpec;
 if (agg.total.n === 0) chart = emptyChart(title);
 else if (agg.groups.length >= 3) chart = lineChart(title, 'count', agg, [{id: 'received', name: 'Received', metric: 'complaints'}, {id: 'resolved', name: 'Resolved', metric: 'resolved'}]);
 else chart = barChart(title, 'Complaints', 'count', agg.groups.map(d => ({key: d.key, label: d.label, value: agg.accs.get(d.key)!.n})), true);
 return {unit, g, agg, chart};
}
function trendReport(c: ReportConfig, ctx: Ctx, rows: Row[], total: Acc): Report {
 const {unit, g, agg, chart} = trendOf(rows, c, ctx), s = summaryTable(rows, g, 'Period', DEFAULT_METRICS, true);
 const busiest = agg.groups.reduce<GroupDef | null>((best, d) => !best || agg.accs.get(d.key)!.n > agg.accs.get(best.key)!.n ? d : best, null);
 const peak = busiest ? agg.accs.get(busiest.key)!.n : 0, periods = agg.groups.length;
 const kpis = [...standardKpis(total).slice(0, 4), kpi('busiest', `Busiest ${unitWord[unit]}`, peak, peak ? busiest!.short ?? busiest!.label : '—', peak ? `${plural(peak, 'complaint')} · ${busiest!.label}` : 'No complaints', 'navy'),
  kpi('average', `Average per ${unitWord[unit]}`, periods ? round1(total.n / periods) : null, periods ? fmtNum(total.n / periods) : '—', `Over ${plural(periods, unitWord[unit])}`, 'purple')];
 return assemble(c, ctx, true, {kpis, columns: s.columns, rows: s.rows, totals: s.totals, recordCount: rows.length, recordNoun: 'complaints', chart,
  notes: [...(rows.length ? [] : ['No complaints match these filters.']), `One row per ${unitWord[unit]}, by the day each complaint was created. Resolved counts those of the period that are closed now. Days after today are left out.`]});
}
function resolutionReport(c: ReportConfig, ctx: Ctx, rows: Row[], total: Acc): Report {
 const dim = c.resolutionBy, g = groupingFor(dim, ctx, rows), s = summaryTable(rows, g, dimLabel(dim), RESOLUTION_METRICS, isTimeDim(dim));
 const med = metricValue(total, 'medianDays'), avg = metricValue(total, 'avgDays'), sla = metricValue(total, 'slaPct');
 const kpis = [kpiCount('total', 'Total complaints', total.n, 'In this report', 'blue'), kpiCount('resolved', 'Resolved', total.resolved, total.n ? `${fmtNum(total.resolved / total.n * 100)}% of the total` : 'Closed complaints', 'green'),
  kpiCount('open', 'Open', total.open, 'Not yet closed or rejected', 'orange'), kpiCount('overdue', 'Overdue', total.overdue, 'Open and past the resolution target', 'red'),
  kpi('sla', 'SLA met', sla, sla === null ? '—' : `${fmtNum(sla)}%`, total.slaEval ? `${total.slaMet} of ${total.slaEval} closed on time` : 'No closed complaints yet', 'purple'),
  kpi('avgDays', 'Avg days to close', avg, avg === null ? '—' : fmtNum(avg), 'From creation to the first Closed entry', 'navy'), kpi('medianDays', 'Median days to close', med, med === null ? '—' : fmtNum(med), 'Half of the closed complaints took less', 'navy')];
 const parts: ChartItem[] = [
  {key: 'ontime', label: 'Closed on time', value: rows.filter(r => r.resolved && r.slaMet === true).length, color: '#23815e'}, {key: 'late', label: 'Closed late', value: rows.filter(r => r.resolved && r.slaMet === false).length, color: '#e0a33a'},
  {key: 'unknown', label: 'Closed (date unknown)', value: rows.filter(r => r.resolved && r.slaMet === null).length, color: '#a9b8c4'}, {key: 'within', label: 'Open · within target', value: rows.filter(r => r.open && !r.overdue).length, color: '#2d73b1'},
  {key: 'overdue', label: 'Open · overdue', value: rows.filter(r => r.overdue).length, color: '#b3261e'}, {key: 'rejected', label: 'Rejected / duplicate', value: rows.filter(r => !r.open && !r.resolved).length, color: '#8593a0'},
 ].filter(i => i.value > 0);
 const chart: ChartSpec = parts.length ? {kind: 'donut', title: 'How complaints ended up', valueLabel: 'Complaints', items: parts, total: total.n, centerLabel: 'complaints'} : emptyChart('How complaints ended up');
 return assemble(c, ctx, true, {kpis, columns: s.columns, rows: s.rows, totals: s.totals, recordCount: rows.length, recordNoun: 'complaints', chart,
  notes: [...(rows.length ? [] : ['No complaints match these filters.']), 'Days to close run from the day a complaint was created to the first Closed entry in its timeline. SLA met compares that moment with the complaint\'s resolution target; it is counted over closed complaints only.']});
}
function ageingReport(c: ReportConfig, ctx: Ctx, all: Row[]): Report {
 const open = all.filter(r => r.open), total = newAcc(); open.forEach(r => addRow(total, r));
 const bucket = (r: Row) => AGE_BUCKETS.find(b => Math.floor(r.ageDays ?? 0) >= b.min && Math.floor(r.ageDays ?? 0) <= b.max) ?? AGE_BUCKETS[AGE_BUCKETS.length - 1];
 const per = AGE_BUCKETS.map(b => open.filter(r => bucket(r).key === b.key));
 const ages = open.map(r => r.ageDays ?? 0), avg = ages.length ? round1(ages.reduce((n, a) => n + a, 0) / ages.length) : null, oldest = ages.length ? Math.floor(Math.max(...ages)) : null;
 const oldRow = open.length ? open.reduce((a, b) => (b.ageDays ?? 0) > (a.ageDays ?? 0) ? b : a) : null;
 const stats = (list: Row[]) => {const a = list.map(r => r.ageDays ?? 0); return {n: list.length, overdue: list.filter(r => r.overdue).length, oldest: a.length ? Math.floor(Math.max(...a)) : null, avg: a.length ? round1(a.reduce((s, x) => s + x, 0) / a.length) : null};};
 const columns: Column[] = [{id: 'age', label: 'Age', kind: 'text'}, {id: 'open', label: 'Open complaints', kind: 'int'}, {id: 'share', label: '% of open', kind: 'pct'}, {id: 'overdue', label: 'Overdue', kind: 'int'}, {id: 'oldest', label: 'Oldest (days)', kind: 'days'}, {id: 'avg', label: 'Average age (days)', kind: 'days'}];
 const line = (label: string, list: Row[]): Cell[] => {const s = stats(list); return [label, s.n, share(s.n, open.length), s.overdue, s.oldest, s.avg];};
 const over7 = per[2].length + per[3].length;
 const kpis = [kpiCount('open', 'Open complaints', open.length, 'Created in this period', 'orange'), kpiCount('overdue', 'Overdue', total.overdue, 'Past the resolution target', 'red'), kpi('avg', 'Average age', avg, avg === null ? '—' : `${fmtNum(avg)}`, 'Days since created', 'blue'),
  kpi('oldest', 'Oldest open', oldest, oldest === null ? '—' : String(oldest), oldRow ? `Days · ${oldRow.id}` : 'Days', 'navy'), kpiCount('aged15', 'Aged 15+ days', per[3].length, open.length ? `${fmtNum(share(per[3].length, open.length))}% of open` : 'Of open complaints', 'purple'),
  kpi('over7', 'Older than 7 days', open.length ? share(over7, open.length) : null, open.length ? `${fmtNum(share(over7, open.length))}%` : '—', `${plural(over7, 'complaint')} of ${open.length}`, 'green')];
 const colors = ['#23815e', '#d9902f', '#d1783a', '#b3261e'];
 const chart = open.length ? barChart('Open complaints by age', 'Open complaints', 'count', AGE_BUCKETS.map((b, i) => ({key: b.key, label: b.label, value: per[i].length, color: colors[i]})), true) : emptyChart('Open complaints by age', 'No open complaints match these filters.');
 return assemble(c, ctx, true, {kpis, columns, rows: AGE_BUCKETS.map((b, i) => ({key: b.key, cells: line(b.label, per[i])})), totals: line('Total', open), recordCount: open.length, recordNoun: 'open complaints', chart,
  notes: [...(open.length ? [] : ['No open complaints match these filters.']), 'Only open complaints created in the chosen period are counted. Widen "Created between" to include older ones. Age is the number of whole days since a complaint was created, counted at generation.']});
}
function customReport(c: ReportConfig, ctx: Ctx, rows: Row[], total: Acc): Report {
 const title = reportTitle(c);
 if (c.thenBy) return crossReport(c, ctx, rows, total, title);
 const g = groupingFor(c.group, ctx, rows), s = summaryTable(rows, g, dimLabel(c.group), c.metrics, isTimeDim(c.group));
 const note = c.metrics.some(m => !metricMeta(m).additive) ? ['SLA met % and days to close are worked out over closed complaints only; groups without any closed complaint show a dash.'] : [];
 return assemble(c, ctx, true, {kpis: standardKpis(total), columns: s.columns, rows: s.rows, totals: s.totals, recordCount: rows.length, recordNoun: 'complaints',
  chart: groupChart(title, c.group, s.agg, c.metrics, metricMeta(c.metrics[0]).additive ? 'complaints' : metricMeta(c.metrics[0]).label), notes: [...(rows.length ? [] : ['No complaints match these filters.']), ...standardNotes(), ...note]});
}
/** Group by × Then by: one column per value of the second dimension (the most common ones; the rest are merged into Other), every cell showing one count metric. */
function crossReport(c: ReportConfig, ctx: Ctx, rows: Row[], total: Acc, title: string): Report {
 const dimA = c.group, dimB = c.thenBy as Dim, ga = groupingFor(dimA, ctx, rows), gb = groupingFor(dimB, ctx, rows), A = aggregate(rows, ga), B = aggregate(rows, gb), metric = c.cellMetric, meta = metricMeta(metric);
 let colDefs = B.groups, merge = new Set<string>();
 if (!gb.time && B.groups.length > CROSS_COLUMNS) {
  // keep the most common values (in the dimension's own order) and merge the rest
  const common = new Set([...B.groups].sort((a, b) => B.accs.get(b.key)!.n - B.accs.get(a.key)!.n || a.label.localeCompare(b.label)).slice(0, CROSS_COLUMNS - 1).map(d => d.key));
  merge = new Set(B.groups.filter(d => !common.has(d.key)).map(d => d.key));
  colDefs = [...B.groups.filter(d => common.has(d.key)), {key: '__other', label: `Other (${merge.size})`, order: 99999, sort: '~'}];
 }
 const cellAcc = new Map<string, Acc>(), colAcc = new Map<string, Acc>(), bKey = (r: Row) => {const k = gb.of(r).key; return merge.has(k) ? '__other' : k;};
 for (const r of rows) {const a = ga.of(r).key, b = bKey(r), k = `${a}\u0000${b}`; addRow(cellAcc.get(k) ?? cellAcc.set(k, newAcc()).get(k)!, r); addRow(colAcc.get(b) ?? colAcc.set(b, newAcc()).get(b)!, r);}
 const val = (a: Acc | undefined) => metricValue(a ?? newAcc(), metric);
 const columns: Column[] = [{id: 'group', label: dimLabel(dimA), kind: 'text', wide: true}, ...colDefs.map(d => ({id: `b:${d.key}`, label: d.label, kind: meta.kind})), {id: 'total', label: 'Total', kind: meta.kind}];
 const out: ReportRow[] = A.groups.map(d => ({key: d.key, cells: [d.label, ...colDefs.map(b => val(cellAcc.get(`${d.key}\u0000${b.key}`))), val(A.accs.get(d.key))], ...(ga.time ? {sort: [d.sort]} : {})}));
 const totals: Cell[] = ['Total', ...colDefs.map(b => val(colAcc.get(b.key))), val(A.total)];
 const series = colDefs.map((d, i) => ({key: d.key, label: d.label, color: d.color ?? colorAt(i)}));
 const limit = ga.time ? TIME_CHART_ROWS : CROSS_CHART_ROWS, shown = A.groups.slice(0, limit);
 const chartRows = shown.map(d => ({key: d.key, label: d.short && A.groups.length > 14 ? d.short : d.label, values: colDefs.map(b => val(cellAcc.get(`${d.key}\u0000${b.key}`)) ?? 0), total: val(A.accs.get(d.key)) ?? 0}));
 const chart: ChartSpec = total.n && chartRows.some(r => r.total > 0) ? {kind: 'stacked', title, valueLabel: meta.label, series, rows: chartRows,
  note: A.groups.length > limit ? `Showing the first ${limit} of ${A.groups.length} rows. The table lists all of them.` : undefined} : emptyChart(title);
 return assemble(c, ctx, true, {kpis: standardKpis(total), columns, rows: out, totals, recordCount: rows.length, recordNoun: 'complaints', chart,
  notes: [...(rows.length ? [] : ['No complaints match these filters.']), `Each cell shows ${meta.label.toLowerCase()} for the row and column. ${merge.size ? `The ${merge.size + 1} least common ${dimLabel(dimB).toLowerCase()} values are merged into Other. ` : ''}${standardNotes()[0]}`]});
}

/** App users registrations: counts only. The input type carries no names, mobile numbers, e-mails or addresses, and none is ever read. */
function usersReport(c: ReportConfig, ctx: Ctx): Report {
 const f = c.filters, list = (ctx.input.residents ?? []).filter(u => inRange(u.registeredAt ?? '', f.range.from, f.range.to) && (!f.ward || (u.wardId || NO_WARD) === f.ward));
 const wardLabel = (u: UserRow) => u.wardLabel || (u.wardId ? (ctx.input.wards ?? []).filter(w => w.id === u.wardId).map(wardLabelOf)[0] : '') || 'No ward recorded';
 type G = GroupDef & {n: number; blocked: number; withComplaints: number};
 const groups = new Map<string, G>(), monthOf = new Map<string, G>();
 const make = (key: string, label: string, order: number, sort: string, extra: Partial<GroupDef> = {}): G => ({key, label, order, sort, n: 0, blocked: 0, withComplaints: 0, ...extra});
 if (c.userGroup === 'month') bucketsForUnit(f.range.from, f.range.to, 'month').forEach((b, i) => {
  const g = make(b.key, b.label, i, b.from, {short: b.short, future: b.from > ctx.today}); groups.set(g.key, g);
  for (let day = b.from; day <= b.to; day = addDays(day, 1)) monthOf.set(day, g);
 });
 for (const u of list) {
  let g: G | undefined;
  if (c.userGroup === 'month') g = monthOf.get(ymdOf(ms(u.registeredAt)));
  else if (c.userGroup === 'ward') {const key = u.wardId || NO_WARD; g = groups.get(key) ?? make(key, wardLabel(u), key === NO_WARD ? 100000 : ctx.wardOrder.get(key) ?? 50000, wardLabel(u)); groups.set(key, g);}
  else {const key = u.language === 'hi' ? 'hi' : 'en'; g = groups.get(key) ?? make(key, key === 'hi' ? 'Hindi' : 'English', key === 'en' ? 0 : 1, key, {color: key === 'en' ? '#172D4F' : '#F3A24C'}); groups.set(key, g);}
  if (!g) continue; g.n++; if (u.blocked) g.blocked++; if (u.complaintCount > 0) g.withComplaints++;
 }
 const ordered = [...groups.values()].filter(g => !(g.future && g.n === 0)).sort((a, b) => a.order - b.order || a.sort.localeCompare(b.sort));
 const sum = (k: 'n' | 'blocked' | 'withComplaints') => ordered.reduce((n, g) => n + g[k], 0), n = sum('n');
 const cells = (g: {n: number; blocked: number; withComplaints: number}): Cell[] => [g.n, share(g.n, n), g.blocked, g.withComplaints];
 const columns: Column[] = [{id: 'group', label: USER_DIMENSIONS.find(u => u.id === c.userGroup)?.label ?? 'Month', kind: 'text', wide: true}, {id: 'registrations', label: 'Registrations', kind: 'int'}, {id: 'share', label: '% of registrations', kind: 'pct'}, {id: 'blocked', label: 'Blocked', kind: 'int'}, {id: 'withComplaints', label: 'With complaints', kind: 'int'}];
 const hindi = list.filter(u => u.language === 'hi').length;
 const kpis = [kpiCount('registrations', 'Registrations', n, n ? 'In the chosen period' : 'None in this period', 'blue'), kpiCount('blocked', 'Blocked', sum('blocked'), 'Currently blocked', 'red'), kpiCount('withComplaints', 'With complaints', sum('withComplaints'), 'Filed at least one', 'green'),
  kpiCount('hindi', 'Using Hindi', hindi, n ? `${fmtNum(share(hindi, n))}% of registrations` : 'Language of the app', 'purple'), kpiCount('english', 'Using English', n - hindi, n ? `${fmtNum(share(n - hindi, n))}% of registrations` : 'Language of the app', 'navy')];
 const title = reportTitle(c), items: ChartItem[] = ordered.map((g, i) => ({key: g.key, label: g.label, value: g.n, color: g.color ?? colorAt(i)}));
 let chart: ChartSpec;
 if (!n) chart = emptyChart(title);
 else if (c.userGroup === 'language') chart = {kind: 'donut', title, valueLabel: 'Registrations', items: items.filter(i => i.value > 0), total: n, centerLabel: 'users'};
 else if (c.userGroup === 'month' && ordered.length >= 3) chart = {kind: 'line', title, valueLabel: 'Registrations', unit: 'count', points: ordered.map(g => ({key: g.key, label: g.short ?? g.label, title: g.label})), series: [{id: 'registrations', name: 'Registrations', color: '#197448', values: ordered.map(g => g.n)}]};
 else chart = barChart(title, 'Registrations', 'count', items.map(i => ({...i, color: undefined})), true);
 const missing = (ctx.input.residents ?? []).filter(u => !u.registeredAt).length;
 return assemble(c, ctx, false, {kpis, columns, rows: ordered.map(g => ({key: g.key, cells: [g.label, ...cells(g)], ...(c.userGroup === 'month' ? {sort: [g.sort]} : {})})), totals: ['Total', ...cells({n, blocked: sum('blocked'), withComplaints: sum('withComplaints')})], recordCount: n, recordNoun: 'app users', chart,
  notes: [...(n ? [] : ['No app users registered in this period.']), 'Counts only: names, mobile numbers and other personal details are never included. The date range applies to the day each person registered; the ward filter applies as well, the complaint filters do not.', ...(missing ? [`${plural(missing, 'user')} without a registration date ${missing === 1 ? 'is' : 'are'} left out.`] : [])]});
}

/* ------------------------------------------------------------------ */
/* Cells: display, sorting, totals                                      */
/* ------------------------------------------------------------------ */
/** How a cell reads on screen and in print. */
export function displayCell(cell: Cell, col: Column): string {
 if (cell === null || cell === undefined || cell === '') return '—';
 if (typeof cell === 'number') return col.kind === 'pct' ? `${fmtNum(cell)}%` : col.kind === 'days' ? fmtNum(cell) : String(cell);
 return col.kind === 'date' ? dayLabel(cell) || cell : cell;
}
export const isNumericColumn = (col: Column) => col.kind === 'int' || col.kind === 'pct' || col.kind === 'days';
/** Rows ordered by a column (stable; empty cells always last). With no sort the report's own order is kept. */
export function sortRows(columns: Column[], rows: ReportRow[], sort: SortState): ReportRow[] {
 if (!sort) return rows;
 const i = columns.findIndex(c => c.id === sort.col); if (i < 0) return rows;
 const dir = sort.dir === 'asc' ? 1 : -1, pick = (r: ReportRow): Cell => r.sort && r.sort[i] !== undefined ? r.sort[i] : r.cells[i], empty = (v: Cell) => v === null || v === undefined || v === '';
 return rows.map((r, n) => ({r, n, v: pick(r)})).sort((a, b) => {
  if (empty(a.v) || empty(b.v)) return empty(a.v) && empty(b.v) ? a.n - b.n : empty(a.v) ? 1 : -1;
  const x = a.v as string | number, y = b.v as string | number;
  const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'en', {numeric: true, sensitivity: 'base'});
  return c * dir || a.n - b.n;
 }).map(o => o.r);
}
/** Text alternative of a chart: one sentence per value, long lists shortened. */
export function describeChart(spec: ChartSpec): string {
 const fmt = (n: number | null, unit: ChartUnit) => n === null ? 'no data' : unit === 'pct' ? `${fmtNum(n)}%` : fmtNum(n);
 switch (spec.kind) {
  case 'empty': return `${spec.title}. ${spec.message}`;
  case 'bar': return `Bar chart: ${spec.title}. ${spec.items.slice(0, 15).map(i => `${i.label} ${fmt(i.value, spec.unit)}`).join(', ')}${spec.items.length > 15 ? `, and ${spec.items.length - 15} more` : ''}.`;
  case 'donut': return `Donut chart: ${spec.title}. Total ${spec.total}. ${spec.items.map(i => `${i.label} ${i.value} (${fmtNum(share(i.value, spec.total))}%)`).join(', ')}.`;
  case 'line': {
   const first = spec.series[0], values = first.values.filter((v): v is number => v !== null), peak = values.length ? Math.max(...values) : 0, at = first.values.indexOf(peak);
   return `Line chart: ${spec.title}, ${spec.points.length} points from ${spec.points[0]?.title} to ${spec.points[spec.points.length - 1]?.title}. ${first.name} peaks at ${fmt(peak, spec.unit)}${at >= 0 ? ` on ${spec.points[at].title}` : ''}. ${spec.points.length <= 12 ? spec.points.map((p, i) => `${p.title}: ${spec.series.map(s => `${s.name} ${fmt(s.values[i], spec.unit)}`).join(', ')}`).join('; ') + '.' : 'See the table for every value.'}`;
  }
  case 'stacked': return `Stacked bar chart: ${spec.title}. ${spec.rows.slice(0, 12).map(r => `${r.label} ${r.total}: ${spec.series.map((s, i) => `${s.label} ${r.values[i]}`).join(', ')}`).join('; ')}${spec.rows.length > 12 ? `; and ${spec.rows.length - 12} more rows` : ''}.`;
 }
}
/** The values behind a chart as a plain table ("view as table"). */
export function chartTable(spec: ChartSpec): {columns: string[]; rows: string[][]} {
 const fmt = (n: number | null, unit: ChartUnit) => n === null ? '—' : unit === 'pct' ? `${fmtNum(n)}%` : fmtNum(n);
 switch (spec.kind) {
  case 'empty': return {columns: ['Chart'], rows: [[spec.message]]};
  case 'bar': {const total = spec.unit === 'count' ? spec.items.reduce((n, i) => n + i.value, 0) : 0; return {columns: ['Group', spec.valueLabel, ...(spec.unit === 'count' ? ['Share'] : [])], rows: spec.items.map(i => [i.label, fmt(i.value, spec.unit), ...(spec.unit === 'count' ? [`${fmtNum(share(i.value, total))}%`] : [])])};}
  case 'donut': return {columns: ['Group', spec.valueLabel, 'Share'], rows: spec.items.map(i => [i.label, String(i.value), `${fmtNum(share(i.value, spec.total))}%`])};
  case 'line': return {columns: ['Period', ...spec.series.map(s => s.name)], rows: spec.points.map((p, i) => [p.title, ...spec.series.map(s => fmt(s.values[i], spec.unit))])};
  case 'stacked': return {columns: ['Group', ...spec.series.map(s => s.label), 'Total'], rows: spec.rows.map(r => [r.label, ...r.values.map(String), String(r.total)])};
 }
}

/* ------------------------------------------------------------------ */
/* Export files                                                        */
/* ------------------------------------------------------------------ */
/** samadhan-complaints-by-category-2026-10-01_2026-10-31.csv */
export const exportFileName = (report: Pick<Report, 'slug' | 'from' | 'to'>, ext: string) => `samadhan-${report.slug}-${report.from}_${report.to}.${ext}`;
const RISKY_START = /^\s*[=+\-@]|^[\t\r]/;
/** One CSV cell: always quoted, quotes doubled. Text that a spreadsheet could read as a formula (starts with = + - @, a tab or a carriage return) gets an apostrophe in front; real numbers are written as they are. */
export function csvCell(value: Cell): string {
 if (value === null || value === undefined) return '""';
 if (typeof value === 'number') return `"${Number.isFinite(value) ? value : ''}"`;
 return `"${(RISKY_START.test(value) ? `'${value}` : value).replaceAll('"', '""')}"`;
}
/** The report as shown (rows in the order given, totals row last) as UTF-8 CSV with a byte-order mark so Excel reads Hindi and other non-English text correctly. */
export function toCsv(report: Report, rows: ReportRow[] = report.rows): string {
 const lines = [report.columns.map(c => c.label), ...rows.map(r => r.cells), ...(report.totals ? [report.totals] : [])];
 return '﻿' + lines.map(cells => cells.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
/** JSON with the report's title, filters, generated time, KPI cards, columns, rows (keyed by column id, in the order shown) and totals. */
export function toJson(report: Report, rows: ReportRow[] = report.rows): string {
 const obj = (cells: Cell[]) => Object.fromEntries(report.columns.map((c, i) => [c.id, cells[i] ?? null]));
 return JSON.stringify({report: {title: report.title, type: report.type, headline: report.headline, filters: report.filterParts, from: report.from, to: report.to, generatedAt: report.generatedAt, recordCount: report.recordCount, recordNoun: report.recordNoun,
  kpis: report.kpis.map(k => ({id: k.id, label: k.label, value: k.raw, display: k.value, caption: k.caption})), columns: report.columns.map(c => ({id: c.id, label: c.label, kind: c.kind})), rows: rows.map(r => obj(r.cells)), totals: report.totals ? obj(report.totals) : null, notes: report.notes}}, null, 2);
}

const enc = new TextEncoder();
let CRC_TABLE: Uint32Array | null = null;
function crc32(bytes: Uint8Array): number {
 if (!CRC_TABLE) {CRC_TABLE = new Uint32Array(256); for (let n = 0; n < 256; n++) {let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC_TABLE[n] = c >>> 0;}}
 let c = 0xFFFFFFFF; for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
 return (c ^ 0xFFFFFFFF) >>> 0;
}
/** A zip archive with every file stored uncompressed (valid for .xlsx; keeps the writer tiny and dependency-free). */
export function zipStore(files: {name: string; data: Uint8Array}[], when: Date): Uint8Array<ArrayBuffer> {
 const local: Uint8Array[] = [], central: Uint8Array[] = [];
 const time = (when.getUTCHours() << 11) | (when.getUTCMinutes() << 5) | (when.getUTCSeconds() >> 1), date = ((Math.max(1980, when.getUTCFullYear()) - 1980) << 9) | ((when.getUTCMonth() + 1) << 5) | when.getUTCDate();
 let offset = 0;
 for (const f of files) {
  const name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length;
  const lh = new Uint8Array(30 + name.length), l = new DataView(lh.buffer);
  l.setUint32(0, 0x04034b50, true); l.setUint16(4, 20, true); l.setUint16(6, 0x0800, true); l.setUint16(8, 0, true); l.setUint16(10, time, true); l.setUint16(12, date, true);
  l.setUint32(14, crc, true); l.setUint32(18, size, true); l.setUint32(22, size, true); l.setUint16(26, name.length, true); l.setUint16(28, 0, true); lh.set(name, 30);
  const ch = new Uint8Array(46 + name.length), h = new DataView(ch.buffer);
  h.setUint32(0, 0x02014b50, true); h.setUint16(4, 20, true); h.setUint16(6, 20, true); h.setUint16(8, 0x0800, true); h.setUint16(10, 0, true); h.setUint16(12, time, true); h.setUint16(14, date, true);
  h.setUint32(16, crc, true); h.setUint32(20, size, true); h.setUint32(24, size, true); h.setUint16(28, name.length, true); h.setUint16(30, 0, true); h.setUint16(32, 0, true); h.setUint16(34, 0, true); h.setUint16(36, 0, true); h.setUint32(38, 0, true); h.setUint32(42, offset, true); ch.set(name, 46);
  local.push(lh, f.data); central.push(ch); offset += lh.length + size;
 }
 const cdSize = central.reduce((n, p) => n + p.length, 0), end = new Uint8Array(22), e = new DataView(end.buffer);
 e.setUint32(0, 0x06054b50, true); e.setUint16(4, 0, true); e.setUint16(6, 0, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cdSize, true); e.setUint32(16, offset, true); e.setUint16(20, 0, true);
 const parts = [...local, ...central, end], out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0;
 for (const p of parts) {out.set(p, at); at += p.length;}
 return out;
}
const xmlText = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const colName = (i: number) => {let s = ''; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s;};
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
/** Excel serial number of a local calendar date (days since 1899-12-30). */
const excelSerial = (ymd: string) => {const d = parseYmd(ymd); return d ? Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS) + 25569 : null;};
const STYLE = {bold: 1, header: 2, decimal: 3, boldDecimal: 4, date: 5};
function sheetXml(rows: {cells: Cell[]; kinds: ColumnKind[]; style?: 'header' | 'total'}[], widths: number[], freeze: boolean): string {
 const body = rows.map((row, r) => {
  const cells = row.cells.map((value, i) => {
   const ref = `${colName(i)}${r + 1}`, total = row.style === 'total', head = row.style === 'header', kind = row.kinds[i];
   if (value === null || value === undefined || value === '') return '';
   if (typeof value === 'number') return `<c r="${ref}"${kind === 'int' ? (total ? ` s="${STYLE.bold}"` : '') : ` s="${total ? STYLE.boldDecimal : STYLE.decimal}"`}><v>${value}</v></c>`;
   const serial = kind === 'date' && !head ? excelSerial(value) : null;
   if (serial !== null) return `<c r="${ref}" s="${STYLE.date}"><v>${serial}</v></c>`;
   return `<c r="${ref}" t="inlineStr"${head ? ` s="${STYLE.header}"` : total ? ` s="${STYLE.bold}"` : ''}><is><t xml:space="preserve">${xmlText(value)}</t></is></c>`;
  }).join('');
  return `<row r="${r + 1}">${cells}</row>`;
 }).join('');
 return `${XML_HEAD}<worksheet ${NS}>${freeze ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>' : ''}<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${body}</sheetData></worksheet>`;
}
/**
 * A real .xlsx workbook (Office Open XML in an uncompressed zip, no dependency): sheet "Report" holds the table as shown (header row frozen, dates and numbers as real
 * Excel values, totals row last) and sheet "Filters" holds the title, filters, generated time and notes. Text is stored as text, never as a formula.
 */
export function toXlsx(report: Report, rows: ReportRow[] = report.rows): Uint8Array<ArrayBuffer> {
 const kinds = report.columns.map(c => c.kind), table: Parameters<typeof sheetXml>[0] = [{cells: report.columns.map(c => c.label), kinds: kinds.map(() => 'text' as ColumnKind), style: 'header'}, ...rows.map(r => ({cells: r.cells, kinds})), ...(report.totals ? [{cells: report.totals, kinds, style: 'total' as const}] : [])];
 const widths = report.columns.map((c, i) => Math.min(60, Math.max(10, c.label.length + 2, ...rows.slice(0, 200).map(r => String(r.cells[i] ?? '').length + 2))));
 const info: [string, string][] = [['Report', report.title], ['Filters', report.filterParts.join(' · ')], ['Generated', report.generatedAt], ['Records', `${report.recordCount} ${report.recordNoun}`], ...report.notes.map((n, i): [string, string] => [i ? '' : 'Notes', n])];
 const text = ['text' as ColumnKind, 'text' as ColumnKind];
 const files: {name: string; data: Uint8Array}[] = [
  {name: '[Content_Types].xml', data: enc.encode(`${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`)},
  {name: '_rels/.rels', data: enc.encode(`${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`)},
  {name: 'xl/workbook.xml', data: enc.encode(`${XML_HEAD}<workbook ${NS} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Report" sheetId="1" r:id="rId1"/><sheet name="Filters" sheetId="2" r:id="rId2"/></sheets></workbook>`)},
  {name: 'xl/_rels/workbook.xml.rels', data: enc.encode(`${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`)},
  {name: 'xl/styles.xml', data: enc.encode(`${XML_HEAD}<styleSheet ${NS}><numFmts count="2"><numFmt numFmtId="164" formatCode="0.0"/><numFmt numFmtId="165" formatCode="yyyy-mm-dd"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8F3EE"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`)},
  {name: 'xl/worksheets/sheet1.xml', data: enc.encode(sheetXml(table, widths, true))},
  {name: 'xl/worksheets/sheet2.xml', data: enc.encode(sheetXml(info.map(([a, b]) => ({cells: [a, b], kinds: text, style: undefined})), [14, 90], false))},
 ];
 return zipStore(files, new Date(report.generatedAt));
}
