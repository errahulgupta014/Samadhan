import type {Complaint, Department} from '../shared/domain';
import type {FilterSpec} from '../app/table-filters';
import {departmentFor} from './service';
import {ALL_WARDS, NO_WARD, wardFilterOptions} from './complaint-wards';

/**
 * Pure filter rules for the admin Complaints table (no React, no I/O), used with `applyFilters` from app/table-filters.ts and unit tested in tests/complaint-filters.test.mjs.
 *
 * Filter keys (the keys of the FilterState the shared FilterToolbar edits):
 *   selects: status, priority, category, department, ward, stage (needs attention / resolved), overdue
 *   range:   created (the day the complaint was created, From and To inclusive, in the viewer's local time like lib/date-range.ts)
 *   search:  every typed word must appear in the complaint id, title, locality, department or ward label
 */
export const PRIORITIES = ['Low', 'Normal', 'High', 'Critical'] as const;
/** A complaint in one of these statuses needs no more work from the ward office. */
export const FINISHED_STATUSES: readonly string[] = ['Closed', 'Rejected / Duplicate'];
export const UNASSIGNED = 'unassigned';
export type FilterOption = {value: string; label: string};

type Row = Pick<Complaint, 'id' | 'title' | 'locality' | 'status' | 'priority' | 'category' | 'assignee' | 'createdAt' | 'dueAt'> & {assigneeId?: string; wardId?: string; wardLabel?: string};

export const isOpenComplaint = (c: {status: string}) => !FINISHED_STATUSES.includes(c.status);
/** Not finished and past its resolution target. */
export const isOverdueComplaint = (c: {status: string; dueAt: string}, now = Date.now()) => isOpenComplaint(c) && +new Date(c.dueAt) < now;

/**
 * The department filter value of a complaint: `dept:<id>` for a department that still exists (found by the stored department id, so a renamed department keeps its complaints,
 * else by name), `name:<assignee>` for a name that matches no department, and UNASSIGNED when nobody is assigned.
 */
export function assigneeValue(c: {assignee?: string; assigneeId?: string}, departments?: Department[]): string {
 if (!c.assignee && !c.assigneeId) return UNASSIGNED;
 const department = departmentFor({departments}, c);
 return department ? `dept:${department.id}` : c.assignee ? `name:${c.assignee}` : UNASSIGNED;
}

/**
 * Department choices: Unassigned, every active department, and any inactive one that complaints still refer to (marked), then assignee names that match no department (marked).
 * Departments nobody refers to and that are inactive are left out, so the list stays short.
 */
export function departmentFilterOptions(departments: Department[] | undefined, complaints: {assignee?: string; assigneeId?: string}[]): FilterOption[] {
 const list = departments ?? [], used = new Set(complaints.map(c => assigneeValue(c, list)));
 const options: FilterOption[] = [{value: UNASSIGNED, label: 'Unassigned'}];
 for (const d of [...list].sort((a, b) => a.name.localeCompare(b.name))) if (d.active || used.has(`dept:${d.id}`)) options.push({value: `dept:${d.id}`, label: d.name + (d.active ? '' : ' (inactive)')});
 const former = [...used].filter(v => v.startsWith('name:')).map(v => v.slice(5)).sort((a, b) => a.localeCompare(b));
 for (const name of former) options.push({value: `name:${name}`, label: `${name} (not in the department list)`});
 return options;
}

const plain = (values: readonly string[]): FilterOption[] => values.map(v => ({value: v, label: v}));

/** Option lists for every select filter. `ward` is empty unless there are two or more wards (the filter is hidden for none or one). */
export function complaintFilterOptions(input: {categories?: {nameEn: string}[]; wards?: Parameters<typeof wardFilterOptions>[0]; departments?: Department[]; complaints: Row[]; statuses: readonly string[]}) {
 const {complaints} = input;
 const categories = [...new Set([...(input.categories ?? []).map(c => c.nameEn), ...complaints.map(c => c.category)].filter(Boolean))];
 const priorities = [...PRIORITIES, ...[...new Set(complaints.map(c => c.priority))].filter(p => p && !(PRIORITIES as readonly string[]).includes(p))];
 const wards = (input.wards?.length ?? 0) >= 2 ? wardFilterOptions(input.wards, complaints).filter(o => o.value !== ALL_WARDS) : [];
 return {
  status: plain(input.statuses), priority: plain(priorities), category: plain(categories), department: departmentFilterOptions(input.departments, complaints), ward: wards,
  stage: [{value: 'attention', label: 'Needs attention (not closed or rejected)'}, {value: 'resolved', label: 'Resolved (closed)'}] as FilterOption[],
  overdue: [{value: 'yes', label: 'Overdue only'}] as FilterOption[],
 };
}

/** How the Complaints table reads each complaint for the shared toolbar. `now` is read when the filters run, so "overdue" follows the clock. */
export function complaintFilterSpec(departments?: Department[], now: () => number = Date.now): FilterSpec<Row> {
 return {
  search: c => [c.id, c.title, c.locality, c.assignee, c.wardLabel],
  selects: {
   status: c => c.status, priority: c => c.priority, category: c => c.category,
   department: c => assigneeValue(c, departments),
   ward: c => c.wardId || NO_WARD,
   stage: c => c.status === 'Closed' ? 'resolved' : isOpenComplaint(c) ? 'attention' : 'rejected',
   overdue: c => isOverdueComplaint(c, now()) ? 'yes' : 'no',
  },
  ranges: {created: c => c.createdAt},
 };
}
