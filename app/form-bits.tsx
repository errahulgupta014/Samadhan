'use client';
import {useId,useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {Eye,ImageIcon,LoaderCircle,Pencil,Plus,Search,SlidersHorizontal,Trash2,X} from 'lucide-react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {Table,TableBody,TableCell,TableHead,TableHeader,TableRow} from '@/components/ui/table';
import {activeFilterCount,applyFilters,emptyFilters,filterKey,hasActiveFilters,rangeActive,rangeProblem,type DateRange,type FilterSpec,type FilterState} from './table-filters';

// The pure filtering helpers (applyFilters, emptyFilters, rangeProblem, distinctOptions, plainOptions, ...) live in ./table-filters.ts so they can be unit tested; they are re-exported so pages import everything from './form-bits'.
export * from './table-filters';

export type Act=(body:Record<string,unknown>)=>Promise<unknown>;

/** Gentle hint under an optional Hindi field: the mobile app falls back to the English text, so an empty Hindi field is allowed. */
export const HINDI_HINT = 'Hindi missing — the app will show English.';
export function HindiHint({value}: {value?: string | null}) {return value && value.trim() ? null : <small className="muted" role="note">{HINDI_HINT}</small>;}

/** Only a Super Admin may delete records: `useIsSuperAdmin(data)` (see ./super-admin) decides whether a page renders its Delete controls at all. */
export {useIsSuperAdmin} from './super-admin';

/** Radix hands focus back only to a DialogTrigger; these popups open from ordinary buttons, so remember the opener and focus it again on close (or the page heading when that row no longer exists). */
export function useFocusReturn(open = true) {
 const opener = useRef<HTMLElement | null>(null);
 useLayoutEffect(() => {if (open) opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;}, [open]);
 return (e: Event) => {
  e.preventDefault();
  const el = opener.current;
  if (el && el.isConnected && el !== document.body) {el.focus(); return;}
  const heading = document.querySelector<HTMLElement>('.ct-head h2, .section-title h2');
  if (heading) {if (!heading.hasAttribute('tabindex')) heading.tabIndex = -1; heading.focus();}
 };
}

/**
 * Confirmation before a hard delete: the title names the record, `description` says what goes with it, "This cannot be undone." is always added, and the footer has Cancel and a red Delete.
 * The Delete button is the only way through; Escape, the overlay, the X and Cancel all keep the record. While the request runs (`busy`) the dialog stays open and refuses to close.
 * A refusal is shown inside the dialog through `error` (for example the server's 403 for a page that was still showing Delete to a non-Super Admin), and the dialog closes only when the
 * caller sets `open` to false after a success. Focus returns to the row's action button on close. Render it only for a Super Admin.
 */
export function ConfirmDelete({open, title, description, children, confirmLabel = 'Delete', busy, error, onConfirm, onCancel}: {open: boolean; title: string; description: string; children?: ReactNode; confirmLabel?: string; busy?: boolean; error?: string; onConfirm: () => void; onCancel: () => void}) {
 const returnFocus = useFocusReturn(open);
 return <Dialog open={open} onOpenChange={v => {if (!v && !busy) onCancel();}}>
  <DialogContent className="ct-dialog ct-confirm" showCloseButton={!busy} onCloseAutoFocus={returnFocus} onEscapeKeyDown={e => {if (busy) e.preventDefault();}} onInteractOutside={e => {if (busy) e.preventDefault();}}>
   <DialogHeader className="ct-dialog-head"><DialogTitle>{title}</DialogTitle><DialogDescription>{description} <b>This cannot be undone.</b></DialogDescription></DialogHeader>
   {(children || error) && <div className="ct-dialog-body">{children}{error && <p role="alert" className="error ct-note">{error}</p>}</div>}
   <div className="ct-dialog-foot"><button type="button" className="button" disabled={busy} onClick={onCancel}>Cancel</button><button type="button" className="button ct-danger" disabled={busy} aria-busy={busy || undefined} onClick={onConfirm}>{busy ? <><LoaderCircle size={15} className="ct-spin" aria-hidden="true"/> Deleting…</> : confirmLabel}</button></div>
  </DialogContent>
 </Dialog>;
}

/** An ISO instant as the value of a datetime-local input (local time), or '' when it is not a date. */
export function toLocalInput(iso?: string) {const d = new Date(iso ?? ''); return Number.isFinite(+d) ? new Date(+d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';}
export function showDate(iso?: string) {const d = new Date(iso ?? ''); return Number.isFinite(+d) ? d.toLocaleString('en-IN', {dateStyle: 'medium', timeStyle: 'short'}) : iso ?? '';}
/** Date only, for compact table cells. */
export function shortDate(iso?: string | null) {const d = new Date(iso ?? ''); return Number.isFinite(+d) ? d.toLocaleDateString('en-IN', {day: 'numeric', month: 'short', year: 'numeric'}) : iso ?? '';}

/* ------------------------------------------------------------------ */
/* Shared pieces of the content pages: Announcements, Classifieds,     */
/* Activities and City & places (styles: app/content-tables.css).      */
/* ------------------------------------------------------------------ */

/** Runs an admin action with the busy/error/success bookkeeping every content page needs. `report` redirects the error (e.g. into an open dialog); `key` marks which row is in flight. */
export function useRunner(act: Act) {
 const [error, setError] = useState(''), [message, setMessage] = useState(''), [working, setWorking] = useState(false), [pending, setPending] = useState('');
 const clear = () => {setError(''); setMessage('');};
 async function run(body: Record<string, unknown>, done: string, opts: {report?: (m: string) => void; key?: string} = {}) {
  setError(''); setMessage(''); setWorking(true); setPending(opts.key ?? '');
  try {await act(body); setMessage(done); return true;}
  catch (e) {(opts.report ?? setError)((e as Error).message); return false;}
  finally {setWorking(false); setPending('');}
 }
 return {error, message, working, pending, run, clear, setError, setMessage};
}

/**
 * The "Delete …?" confirmation of a content table (render <ConfirmDelete open={!!d.target} error={d.error} .../> only for a Super Admin).
 * `ask(row)` opens it, `cancel()` closes it without deleting, `confirm(body, done)` runs the delete and closes only on success: a refusal stays in the dialog as `error`.
 */
export function useDeleteFlow<T>(runner: Pick<ReturnType<typeof useRunner>, 'run' | 'clear'>) {
 const [target, setTarget] = useState<T | null>(null), [last, setLast] = useState<T | null>(null), [error, setError] = useState('');
 return {
  target, error,
  /** The row the dialog is about, kept while it fades out so its text does not change under the eye. */
  shown: target ?? last,
  ask: (row: T) => {runner.clear(); setError(''); setLast(row); setTarget(row);},
  cancel: () => {setTarget(null); setError('');},
  confirm: async (body: Record<string, unknown>, done: string) => {setError(''); if (await runner.run(body, done, {report: setError})) setTarget(null);},
 };
}

/** Whether the signed-in administrator may change this kind of content. Without a viewer the page is read-only. */
export const canEdit = (viewer: {permissions: readonly string[]} | undefined, permission: string) => !!viewer?.permissions.includes(permission);

export function PageNotices({error, message}: {error: string; message: string}) {
 return <>{error && <p role="alert" className="error ct-note">{error}</p>}{message && <p role="status" className="info-note ct-note">{message}</p>}</>;
}

/** Heading row: title, one-line description and the primary "New …" button (hidden for read-only users). */
export function ContentHead({title, description, newLabel, onNew, disabled}: {title: string; description: string; newLabel?: string; onNew?: () => void; disabled?: boolean}) {
 return <div className="ct-head"><div><h2 tabIndex={-1}>{title}</h2><p>{description}</p></div>
  {onNew && <button type="button" className="button primary ct-new" disabled={disabled} onClick={onNew}><Plus size={16} aria-hidden="true"/>{newLabel}</button>}</div>;
}

/** Search box, status filter and result count above a table. */
export function ListToolbar({noun, query, onQuery, status, onStatus, options, total, filtered, shown}: {noun: string; query: string; onQuery: (v: string) => void; status: string; onStatus: (v: string) => void; options: string[]; total: number; filtered: number; shown: number}) {
 const narrowed = filtered !== total;
 const count = !total ? `No ${noun} yet` : `${narrowed ? `${filtered} of ${total}` : total} ${noun}${shown < filtered ? ` · showing first ${shown}` : ''}`;
 return <div className="ct-toolbar">
  <label className="ct-search"><Search size={16} aria-hidden="true"/><input type="search" aria-label={`Search ${noun}`} placeholder={`Search ${noun}…`} value={query} onChange={e => onQuery(e.target.value)}/></label>
  <select className="ct-select" aria-label="Filter by status" value={status} onChange={e => onStatus(e.target.value)}>{options.map(o => <option key={o} value={o}>{o === 'All' ? 'All statuses' : o}</option>)}</select>
  <p className="ct-count" role="status" aria-live="polite">{count}</p>
 </div>;
}

/**
 * FILTER TOOLBAR for any admin table: search box (always there) + extra filters declared as data + Clear filters + active-filter chips + result count.
 *
 *   import {FilterToolbar,FilterEmpty,useTableFilters,usePaged,DataTable,plainOptions,distinctOptions,type FilterDef,type FilterSpec} from './form-bits';
 *
 *   // 1. Declare the filters (module level if the options are constant, else build them from the data).
 *   const FILTERS: FilterDef[] = [
 *    {key: 'status', label: 'Status', allLabel: 'All statuses', options: plainOptions(['Published', 'Draft'])},   // select: options [{value,label}]; the "all" choice is added for you
 *    {key: 'org', label: 'Organizer', allLabel: 'All organizers', options: distinctOptions(rows, r => r.organizer)},
 *    {type: 'dateRange', key: 'starts', label: 'Starts between'},                                                 // From / To <input type="date">, validated From <= To
 *   ];
 *   // 2. Say how each filter reads a row. search = the text the search box looks at; selects[key] returns the row's value (compared with ===);
 *   //    ranges[key] returns an ISO date string (must fall inside the range) or {start, end} (must overlap it). Rows without a date never match an active range.
 *   const SPEC: FilterSpec<Row> = {search: r => [r.title, r.titleHi], selects: {status: r => r.status, org: r => r.organizer}, ranges: {starts: r => r.startsAt}};
 *
 *   // 3. In the component:
 *   const f = useTableFilters(rows, SPEC);               // {state, setState, rows (filtered), key, clear}
 *   const paged = usePaged(f.rows, f.key);               // optional paging; the key sends it back to page 1 when filters change
 *   <FilterToolbar noun="activities" filters={FILTERS} state={f.state} onChange={f.setState} total={rows.length} filtered={f.rows.length} shown={paged.shown}/>
 *   <DataTable ... rows={paged.rows} empty={rows.length ? <FilterEmpty onClear={f.clear}/> : 'No activities yet.'}/>
 *
 * Props: noun (plural, used in the placeholder and the count), filters (FilterDef[], may be empty), state / onChange (a FilterState: {query, values, ranges}),
 * total (rows before filtering), filtered (rows after), shown (rows on screen when paged; optional), searchPlaceholder (optional).
 * Narrow screens: the extra filters fold under a "Filters (n)" button; active filters stay visible as removable chips. Pure helpers: ./table-filters.ts.
 */
/** 'admin users' -> 'admin user', 'activities' -> 'activity' (used when the count is exactly 1). */
function singularNoun(noun: string): string {return /ies$/.test(noun) ? noun.replace(/ies$/, 'y') : noun.replace(/s$/, '');}
export type FilterOption = {value: string; label: string};
export type SelectFilterDef = {type?: 'select'; key: string; label: string; options: FilterOption[]; /** Text of the "no filter" choice, default "All". */ allLabel?: string};
export type DateRangeFilterDef = {type: 'dateRange'; key: string; label: string};
export type FilterDef = SelectFilterDef | DateRangeFilterDef;

const fmtDay = (ymd: string) => {const d = new Date(ymd + 'T00:00:00'); return Number.isFinite(+d) ? d.toLocaleDateString('en-IN', {day: 'numeric', month: 'short', year: 'numeric'}) : ymd;};
const rangeText = (r: DateRange) => r.from && r.to ? fmtDay(r.from) + ' – ' + fmtDay(r.to) : r.from ? 'from ' + fmtDay(r.from) : 'until ' + fmtDay(r.to);

export function FilterToolbar({noun, filters = [], state, onChange, total, filtered, shown, searchPlaceholder}: {noun: string; filters?: FilterDef[]; state: FilterState; onChange: (next: FilterState) => void; total: number; filtered: number; shown?: number; searchPlaceholder?: string}) {
 const panelId = useId(), [open, setOpen] = useState(false);
 const count = activeFilterCount(state), any = hasActiveFilters(state);
 const setValue = (key: string, value: string) => onChange({...state, values: {...state.values, [key]: value}});
 const setRange = (key: string, next: Partial<DateRange>) => onChange({...state, ranges: {...state.ranges, [key]: {...(state.ranges[key] ?? {from: '', to: ''}), ...next}}});
 const chips: {id: string; text: string; remove: () => void}[] = [];
 for (const def of filters) {
  if (def.type === 'dateRange') {const r = state.ranges[def.key]; if (rangeActive(r)) chips.push({id: 'r:' + def.key, text: def.label + ': ' + rangeText(r) + (rangeProblem(r) ? ' (not applied)' : ''), remove: () => setRange(def.key, {from: '', to: ''})});}
  else {const v = state.values[def.key]; if (v) chips.push({id: 'v:' + def.key, text: def.label + ': ' + (def.options.find(o => o.value === v)?.label ?? v), remove: () => setValue(def.key, '')});}
 }
 const text = !total ? 'No ' + noun + ' yet' : (filtered !== total ? filtered + ' of ' + total : total) + ' ' + (total === 1 ? singularNoun(noun) : noun) + (shown !== undefined && shown < filtered ? ' · showing first ' + shown : '');
 return <div className="ct-ftb" data-open={open}>
  <div className="ct-ftb-bar">
   <label className="ct-search"><Search size={16} aria-hidden="true"/><input type="search" aria-label={'Search ' + noun} placeholder={searchPlaceholder ?? 'Search ' + noun + '…'} value={state.query} onChange={e => onChange({...state, query: e.target.value})}/></label>
   {filters.length > 0 && <button type="button" className="ct-ftb-toggle" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(o => !o)}><SlidersHorizontal size={16} aria-hidden="true"/>Filters{count > 0 && <span className="ct-badge">{count}<span className="ct-sr"> active</span></span>}</button>}
   <button type="button" className="ct-clear" disabled={!any} onClick={() => onChange(emptyFilters())}>Clear filters</button>
   <p className="ct-count" role="status" aria-live="polite">{text}</p>
  </div>
  {filters.length > 0 && <div id={panelId} className="ct-ftb-panel">{filters.map(def => {
   if (def.type === 'dateRange') {
    const r = state.ranges[def.key] ?? {from: '', to: ''}, problem = rangeProblem(r), err = panelId + def.key;
    return <div key={def.key} role="group" aria-label={def.label} className="ct-f ct-f-range">
     <span className="ct-f-legend">{def.label}</span>
     <div className="ct-f-pair">
      <label className="ct-f"><span>From</span><input type="date" value={r.from} max={r.to || undefined} aria-invalid={!!problem || undefined} aria-describedby={problem ? err : undefined} onChange={e => setRange(def.key, {from: e.target.value})}/></label>
      <label className="ct-f"><span>To</span><input type="date" value={r.to} min={r.from || undefined} aria-invalid={!!problem || undefined} aria-describedby={problem ? err : undefined} onChange={e => setRange(def.key, {to: e.target.value})}/></label>
     </div>
     {problem && <p id={err} role="alert" className="ct-f-err">{problem}</p>}
    </div>;
   }
   return <label key={def.key} className="ct-f"><span>{def.label}</span><select value={state.values[def.key] ?? ''} onChange={e => setValue(def.key, e.target.value)}><option value="">{def.allLabel ?? 'All'}</option>{def.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>;
  })}</div>}
  {chips.length > 0 && <ul className="ct-chips" aria-label="Active filters">{chips.map(c => <li key={c.id} className="ct-fchip"><span>{c.text}</span><button type="button" aria-label={'Remove filter ' + c.text} onClick={c.remove}><X size={14} aria-hidden="true"/></button></li>)}</ul>}
 </div>;
}

/** Empty state for a table whose rows were all filtered out: say so and offer Clear filters. */
export function FilterEmpty({onClear}: {onClear: () => void}) {
 return <div className="ct-nomatch"><p>No records match these filters.</p><button type="button" className="button" onClick={onClear}>Clear filters</button></div>;
}

/** Holds the FilterState and returns the filtered rows. `key` changes whenever the filters do (feed it to usePaged); `clear` resets search and filters. */
export function useTableFilters<T>(rows: readonly T[], spec: FilterSpec<T>) {
 const [state, setState] = useState<FilterState>(emptyFilters);
 return {state, setState, rows: applyFilters(rows, state, spec), key: filterKey(state), clear: () => setState(emptyFilters())};
}

/** First page of rows plus a "Show more" step; paging restarts from the top whenever `resetKey` (search/filter) changes. */
export function usePaged<T>(rows: T[], resetKey: string, size = 25) {
 const [state, setState] = useState({key: resetKey, n: size});
 const n = state.key === resetKey ? state.n : size;
 return {rows: rows.slice(0, n), shown: Math.min(n, rows.length), remaining: Math.max(0, rows.length - n), more: () => setState({key: resetKey, n: n + size}), size};
}
export function ShowMore({remaining, size, onMore}: {remaining: number; size: number; onMore: () => void}) {
 return remaining > 0 ? <div className="ct-more"><button type="button" className="button" onClick={onMore}>Show {Math.min(size, remaining)} more ({remaining} remaining)</button></div> : null;
}

export type Tone = 'live' | 'draft' | 'off' | 'warn';
/** Status as text (never colour alone). */
export function StatusChip({tone, children}: {tone: Tone; children: ReactNode}) {return <span className={`ct-chip ct-chip-${tone}`}>{children}</span>;}
export function Chip({className, children}: {className?: string; children: ReactNode}) {return <span className={`ct-chip ${className ?? ''}`}>{children}</span>;}

/** The small "Hindi missing" hint under a title in a table row. */
export function HindiMissing({value}: {value?: string | null}) {return value && value.trim() ? null : <span className="ct-hi-missing" title={HINDI_HINT}>Hindi missing</span>;}

export function Thumb({id}: {id?: string}) {
 const [bad, setBad] = useState(false);
 return <span className="ct-thumb" aria-hidden="true">{id && !bad ? <img src={`/api/media?id=${id}`} alt="" loading="lazy" onError={() => setBad(true)}/> : <ImageIcon size={18}/>}</span>;
}

export type Col<T> = {id: string; head: string; cell: (row: T) => ReactNode; cls?: string; rowHeader?: boolean; hiddenHead?: boolean};
/** A real table inside a horizontally scrollable container. `cls` carries the responsive hide classes (ct-hide-lg / ct-hide-md / ct-hide-sm). */
export function DataTable<T>({label, cols, rows, rowKey, rowClass, empty}: {label: string; cols: Col<T>[]; rows: T[]; rowKey: (r: T) => string; rowClass?: (r: T) => string | undefined; empty: ReactNode}) {
 return <div className="ct-panel"><Table className="ct-table" aria-label={label}>
  <TableHeader><TableRow>{cols.map(c => <TableHead key={c.id} scope="col" className={c.cls}>{c.hiddenHead ? <span className="ct-sr">{c.head}</span> : c.head}</TableHead>)}</TableRow></TableHeader>
  <TableBody>
   {rows.map(r => <TableRow key={rowKey(r)} className={rowClass?.(r)}>{cols.map(c => c.rowHeader ? <TableHead key={c.id} scope="row" className={c.cls}>{c.cell(r)}</TableHead> : <TableCell key={c.id} className={c.cls}>{c.cell(r)}</TableCell>)}</TableRow>)}
   {!rows.length && <TableRow><TableCell colSpan={cols.length} className="ct-empty">{empty}</TableCell></TableRow>}
  </TableBody>
 </Table></div>;
}

/** One switch per row: Active / Inactive in words, aria-checked for assistive tech, no confirmation. `hint` is the tooltip that says what flipping it does. */
export function ActiveToggle({name, on, onToggle, disabled, pending, hint}: {name: string; on: boolean; onToggle: () => void; disabled?: boolean; pending?: boolean; hint: string}) {
 return <button type="button" role="switch" aria-checked={on} aria-label={`Active: ${name}`} aria-busy={pending || undefined} className="ct-toggle" title={hint} disabled={disabled || pending} onClick={onToggle}>
  <span className="ct-track" aria-hidden="true">{pending && <LoaderCircle size={12} className="ct-spin"/>}</span><span className="ct-toggle-text">{on ? 'Active' : 'Inactive'}</span>
 </button>;
}

/** Status chip with the Active/Inactive switch beneath it. Read-only users only get the chip. */
export function StatusCell({tone, label, toggle}: {tone: Tone; label: string; toggle?: ReactNode}) {
 return <div className="ct-status"><StatusChip tone={tone}>{label}</StatusChip>{toggle}</div>;
}

/** View, Edit and Delete icon buttons (labels appear on wide screens, tooltips and aria-labels always). Read-only users only get View; Delete is not rendered at all unless `canDelete` (Super Admin) is true. */
export function RowActions({name, canManage, canDelete = false, disabled, onView, onEdit, onDelete}: {name: string; canManage: boolean; canDelete?: boolean; disabled?: boolean; onView: () => void; onEdit?: () => void; onDelete?: () => void}) {
 return <div className="ct-actions" role="group" aria-label={`Actions for ${name}`}>
  <button type="button" className="ct-icon" aria-label={`View ${name}`} title="View" onClick={onView}><Eye size={16} aria-hidden="true"/><span className="ct-lbl">View</span></button>
  {canManage && onEdit && <button type="button" className="ct-icon" aria-label={`Edit ${name}`} title="Edit" disabled={disabled} onClick={onEdit}><Pencil size={16} aria-hidden="true"/><span className="ct-lbl">Edit</span></button>}
  {canManage && canDelete && onDelete && <button type="button" className="ct-icon danger" aria-label={`Delete ${name}`} title="Delete" disabled={disabled} onClick={onDelete}><Trash2 size={16} aria-hidden="true"/><span className="ct-lbl">Delete</span></button>}
 </div>;
}

/** Popup with a form: fixed header, scrolling body, sticky Save / Cancel. Escape, outside click, the X and Cancel are all ignored while a save or upload is running. */
export function FormDialog({title, description, saving, submitLabel, onSubmit, onClose, error, note, children}: {title: string; description: string; saving: boolean; submitLabel: string; onSubmit: () => void | Promise<void>; onClose: () => void; error?: string; note?: string; children: ReactNode}) {
 const returnFocus = useFocusReturn();
 return <Dialog open onOpenChange={v => {if (!v && !saving) onClose();}}>
  <DialogContent className="ct-dialog" showCloseButton={!saving} onCloseAutoFocus={returnFocus} onEscapeKeyDown={e => {if (saving) e.preventDefault();}} onInteractOutside={e => {if (saving) e.preventDefault();}}>
   <DialogHeader className="ct-dialog-head"><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
   <form className="ct-form form-stack" onSubmit={e => {e.preventDefault(); if (!saving) void onSubmit();}}>
    <div className="ct-dialog-body">{note && <p role="status" className="info-note ct-note">{note}</p>}{children}{error && <p role="alert" className="error ct-note">{error}</p>}</div>
    <div className="ct-dialog-foot"><button type="button" className="button" disabled={saving} onClick={onClose}>Cancel</button><button type="submit" className="button primary" disabled={saving}>{saving ? 'Saving…' : submitLabel}</button></div>
   </form>
  </DialogContent>
 </Dialog>;
}

/** Read-only popup listing every field of a record. */
export function ViewDialog({title, subtitle, onClose, onEdit, children}: {title: string; subtitle: string; onClose: () => void; onEdit?: () => void; children: ReactNode}) {
 const returnFocus = useFocusReturn(), closeRef = useRef<HTMLButtonElement>(null);
 return <Dialog open onOpenChange={v => {if (!v) onClose();}}>
  <DialogContent className="ct-dialog" onCloseAutoFocus={returnFocus} onOpenAutoFocus={e => {e.preventDefault(); closeRef.current?.focus();}}>
   <DialogHeader className="ct-dialog-head"><DialogTitle>{title}</DialogTitle><DialogDescription>{subtitle}</DialogDescription></DialogHeader>
   <div className="ct-dialog-body"><dl className="ct-facts">{children}</dl></div>
   <div className="ct-dialog-foot">{onEdit && <button type="button" className="button" onClick={onEdit}><Pencil size={15} aria-hidden="true"/>Edit</button>}<button type="button" ref={closeRef} className="button primary" onClick={onClose}>Close</button></div>
  </DialogContent>
 </Dialog>;
}
/** One label/value pair in a ViewDialog. Empty values show a dash. */
export function Fact({label, children, wide}: {label: string; children?: ReactNode; wide?: boolean}) {
 const empty = children === undefined || children === null || children === '' || children === false;
 return <div className={`ct-fact${wide ? ' wide' : ''}`}><dt>{label}</dt><dd>{empty ? <span className="ct-none">—</span> : children}</dd></div>;
}
/** A Hindi value in a ViewDialog; when it is empty it says what residents will see instead. */
export function FactHi({label, value, wide}: {label: string; value?: string | null; wide?: boolean}) {
 return <Fact label={label} wide={wide}>{value && value.trim() ? <span lang="hi">{value}</span> : <span className="ct-none">Not provided — the app will show English.</span>}</Fact>;
}
export function FactLink({label, href}: {label: string; href?: string}) {
 return <Fact label={label} wide>{href ? (/^https:\/\//i.test(href) ? <a href={href} target="_blank" rel="noopener noreferrer">{href}</a> : href) : ''}</Fact>;
}
export function FactImage({label = 'Photograph', id, name}: {label?: string; id?: string; name: string}) {
 return <Fact label={label} wide>{id ? <img className="ct-view-img" src={`/api/media?id=${id}`} alt={`Photograph of ${name}`}/> : ''}</Fact>;
}
