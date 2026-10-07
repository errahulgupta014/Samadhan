'use client';
import {useEffect,useId,useMemo,useRef,useState} from 'react';
import {flushSync} from 'react-dom';
import {ArrowDown,ArrowUp,ChartColumn,ChevronDown,ChevronsUpDown,FileJson,FileSpreadsheet,FileText,Play,Printer,RotateCcw,SlidersHorizontal,Table2} from 'lucide-react';
import {Table,TableBody,TableCell,TableFooter,TableHead,TableHeader,TableRow} from '@/components/ui/table';
import type {Workspace} from '@/shared/domain';
import {RANGE_PRESETS,makeRange} from '@/lib/date-range';
import {CONFIG_STORAGE_KEY,DIMENSIONS,METRICS,REPORT_TYPES,RESOLUTION_BREAKDOWNS,THEN_BY_DIMENSIONS,TREND_UNITS,USER_DIMENSIONS,activeFilterCount,buildReport,configProblem,defaultConfig,defaultFilters,displayCell,exportFileName,isNumericColumn,parseStoredConfig,reconcileFilters,reportFilterOptions,sameConfig,serializeConfig,sortRows,toCsv,toJson,toXlsx,type Dim,type MetricId,type Report,type ReportConfig,type ReportFilters,type ReportInput,type SortState,type TrendUnit,type UserDim} from '@/lib/report-engine';
import {ShowMore,usePaged} from './form-bits';
import ReportChart from './report-charts';
import './reports.css';

/**
 * The Reports page (permission complaints.read): choose a report, narrow it with filters, press Generate report, then read it as cards, a chart and a table and export it exactly as shown.
 * Everything is computed in this browser from the workspace already loaded (lib/report-engine.ts); large workspaces will need server-side reports later.
 *
 * How the page follows the filters (decided: LIVE by default, with a switch):
 *  - Nothing is shown until Generate report is pressed once; the export buttons stay disabled until then.
 *  - With "Update the report as I change filters" ON (the default) every change to the report type, its options or a filter regenerates the report straight away, so the cards, chart and table
 *    always match the filters on screen. The generated time shows when the numbers were last worked out.
 *  - With it OFF the report on screen stays as generated; a banner reads "Filters changed — Generate again" until you press Generate. Exports always match the report on screen.
 * The last settings are remembered for the browser session (sessionStorage); the "Include resident details" choice never is.
 */
type Generated={config:ReportConfig;at:number;report:Report};
const PRINT_ROW_LIMIT=2000;
const singular=(noun:string)=>noun.replace(/s$/,'');
const when=(iso:string)=>new Date(iso).toLocaleString('en-IN',{day:'numeric',month:'short',year:'numeric',hour:'numeric',minute:'2-digit'});

/** The clock lives outside the component so event handlers can read it (rendering itself stays pure). */
function currentTime(){return Date.now();}
function download(name:string,type:string,part:BlobPart){
 const url=URL.createObjectURL(new Blob([part],{type})),a=document.createElement('a');
 a.href=url;a.download=name;a.rel='noopener';document.body.appendChild(a);a.click();a.remove();
 window.setTimeout(()=>URL.revokeObjectURL(url),4000);
}
function readStored(allowUsers:boolean,options:ReturnType<typeof reportFilterOptions>){
 let raw:string|null=null;try{raw=window.sessionStorage.getItem(CONFIG_STORAGE_KEY);}catch{/* storage unavailable: start from the defaults */}
 const {config,live}=parseStoredConfig(raw,new Date(),{allowUsers});
 return {config:{...config,filters:reconcileFilters(config.filters,options)},live};
}
function Field({label,wide,children}:{label:string;wide?:boolean;children:(id:string)=>React.ReactNode}){const id=useId();return <div className={`rp-field${wide?' rp-wide-field':''}`}><label htmlFor={id} className="rp-label">{label}</label>{children(id)}</div>;}

export default function ReportsManager({data}:{data:Workspace}){
 const perms=data.viewer?.permissions??[],canRead=perms.includes('complaints.read'),canUsers=perms.includes('residents.manage')&&Array.isArray(data.residents);
 // App users enter the engine as counts-only rows: names, mobile numbers, e-mails and addresses are dropped here, before any report is built.
 const input=useMemo<ReportInput>(()=>({complaints:data.complaints,categories:data.categories,departments:data.settings.departments,wards:data.wards,slaHours:data.settings.slaHours,
  residents:canUsers?data.residents!.map(r=>({registeredAt:r.registeredAt,wardId:r.wardId,wardLabel:r.wardLabel,language:r.language,blocked:r.blocked,complaintCount:r.complaintCount})):undefined}),[data.complaints,data.categories,data.settings.departments,data.settings.slaHours,data.wards,data.residents,canUsers]);
 const options=useMemo(()=>reportFilterOptions(input),[input]);
 const [boot]=useState(()=>readStored(canUsers,options));
 const [stored,setConfig]=useState<ReportConfig>(boot.config),[live,setLive]=useState(boot.live),[gen,setGen]=useState<Generated|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [sort,setSort]=useState<SortState>(null),[asTable,setAsTable]=useState(false),[settingsOpen,setSettingsOpen]=useState(true),[printing,setPrinting]=useState(false);
 const bodyId=useId(),outputRef=useRef<HTMLHeadingElement>(null);
 // a filter value that no longer exists (a department or ward that was removed) quietly becomes "All"
 const config=useMemo<ReportConfig>(()=>({...stored,filters:reconcileFilters(stored.filters,options)}),[stored,options]);
 const f=config.filters,problem=configProblem(config),stale=!!gen&&!sameConfig(gen.config,config);
 const users=config.type==='users';

 useEffect(()=>{document.body.classList.add('rp-active');return()=>document.body.classList.remove('rp-active');},[]); // scopes the print stylesheet to this page
 useEffect(()=>{ // the browser's own Print (Ctrl+P) and the Print button both draw every row of the table, not only the first page
  const before=()=>flushSync(()=>setPrinting(true)),after=()=>setPrinting(false);
  window.addEventListener('beforeprint',before);window.addEventListener('afterprint',after);
  return()=>{window.removeEventListener('beforeprint',before);window.removeEventListener('afterprint',after);};
 },[]);

 const save=(c:ReportConfig,l:boolean)=>{try{window.sessionStorage.setItem(CONFIG_STORAGE_KEY,serializeConfig(c,l));}catch{/* storage unavailable: the settings simply are not remembered */}};
 /** Works the report out from the data on screen now. Returns false when the settings cannot be used (the problem is shown next to them). */
 const run=(c:ReportConfig)=>{
  if(configProblem(c))return false;
  try{const at=currentTime();setGen({config:c,at,report:buildReport(input,c,at)});setError('');setNotice('');return true;}
  catch{setError('This report could not be built. Please try again; if it keeps happening, reload the page.');return false;}
 };
 const update=(patch:Partial<ReportConfig>)=>{
  const next:ReportConfig={...config,...patch};
  if(next.thenBy&&next.thenBy===next.group)next.thenBy='';
  if(patch.type!==undefined&&patch.type!==config.type)setSort(null);
  setConfig(next);save(next,live);if(live&&gen)run(next);
 };
 const updateFilters=(patch:Partial<ReportFilters>)=>update({filters:{...f,...patch}});
 const generate=()=>{
  if(!run(config))return;
  setSettingsOpen(false);
  window.requestAnimationFrame(()=>{const h=outputRef.current;if(!h)return;h.focus({preventScroll:true});h.scrollIntoView({block:'start',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});});
 };
 const reset=()=>{const d=defaultConfig(new Date());setConfig(d);setLive(true);save(d,true);setGen(null);setSort(null);setError('');setNotice('');setSettingsOpen(true);};
 const changeLive=(on:boolean)=>{setLive(on);save(config,on);if(on&&gen&&stale)run(config);};
 const choosePreset=(preset:string)=>{
  if(preset==='custom')updateFilters({range:{preset:'custom',from:f.range.from,to:f.range.to}});
  else updateFilters({range:makeRange(preset as Parameters<typeof makeRange>[0],new Date())});
 };
 const setDates=(from:string,to:string)=>updateFilters({range:{preset:'custom',from,to}});

 const report=gen?.report??null,activeSort=sort&&report&&report.columns.some(c=>c.id===sort.col)?sort:null;
 const sorted=useMemo(()=>report?sortRows(report.columns,report.rows,activeSort):[],[report,activeSort]);
 const paged=usePaged(sorted,`${gen?.at??0}|${activeSort?.col??''}|${activeSort?.dir??''}`,25);
 const shownRows=printing?sorted.slice(0,PRINT_ROW_LIMIT):paged.rows;
 const empty=!!report&&report.recordCount===0,canExport=!!report&&!empty;
 const filtersOn=activeFilterCount(f);
 const sortBy=(id:string)=>setSort(activeSort?.col!==id?{col:id,dir:'asc'}:activeSort.dir==='asc'?{col:id,dir:'desc'}:null);
 const exportAs=(kind:'csv'|'xlsx'|'json')=>{
  if(!report)return;
  try{
   const name=exportFileName(report,kind);
   if(kind==='csv')download(name,'text/csv;charset=utf-8',toCsv(report,sorted));
   else if(kind==='xlsx')download(name,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',toXlsx(report,sorted));
   else download(name,'application/json;charset=utf-8',toJson(report,sorted));
   setNotice(`Download started: ${name}`);setError('');
  }catch{setError('The file could not be created. Please try again.');}
 };

 if(!canRead)return <p className="empty-state" role="alert">You do not have permission to view reports.</p>;
 const types=REPORT_TYPES.filter(t=>!t.usersOnly||canUsers),typeMeta=types.find(t=>t.id===config.type);
 const groupDims=DIMENSIONS,thenDims=THEN_BY_DIMENSIONS.filter(d=>d.id!==config.group);
 const metricsOn=new Set<MetricId>(config.metrics);
 const toggleMetric=(id:MetricId,on:boolean)=>update({metrics:METRICS.map(m=>m.id).filter(m=>m===id?on:metricsOn.has(m))});
 const resetFilters=()=>update({filters:defaultFilters(new Date())});
 const noun=report?.recordNoun??'complaints';

 return <div className="rp-page">
  {printing&&<style>{'@page{size:A4 landscape;margin:11mm}'}</style>}
  <section className="panel rp-builder" aria-label="Report builder">
   <button type="button" className="rp-settings-toggle" aria-expanded={settingsOpen} aria-controls={bodyId} onClick={()=>setSettingsOpen(o=>!o)}>
    <SlidersHorizontal size={16} aria-hidden="true"/><span><b>Report settings</b><small>{typeMeta?.label}{filtersOn?` · ${filtersOn} ${filtersOn===1?'filter':'filters'}`:''}</small></span><ChevronDown size={18} aria-hidden="true" className="rp-chevron"/>
   </button>
   <div id={bodyId} className="rp-builder-body" data-open={settingsOpen}>
    <div className="rp-builder-head"><h2>Build a report</h2><p>Pick a report, narrow it with filters, then press Generate report. The cards, chart and table below follow your choices, and you can export what you see.</p></div>
    {data.complaints.length===0&&<p className="info-note rp-note" role="status">No complaints have been filed yet, so reports will be empty for now.</p>}
    <fieldset className="rp-fieldset">
     <legend>Report type</legend>
     <div className="rp-types">{types.map(t=><label key={t.id} className="rp-type"><input type="radio" name="rp-type" value={t.id} checked={config.type===t.id} onChange={()=>update({type:t.id})}/><span><b>{t.label}</b><small>{t.hint}</small></span></label>)}</div>
    </fieldset>

    {config.type==='custom'&&<fieldset className="rp-fieldset">
     <legend>Custom report</legend>
     <div className="rp-grid">
      <Field label="Group by">{id=><select id={id} value={config.group} onChange={e=>update({group:e.target.value as Dim})}>{groupDims.map(d=><option key={d.id} value={d.id}>{d.label}</option>)}</select>}</Field>
      <Field label="Then by (optional)">{id=><select id={id} value={config.thenBy} onChange={e=>update({thenBy:e.target.value as Dim|''})}><option value="">None</option>{thenDims.map(d=><option key={d.id} value={d.id}>{d.label}</option>)}</select>}</Field>
      {config.thenBy&&<Field label="Show in each cell">{id=><select id={id} value={config.cellMetric} onChange={e=>update({cellMetric:e.target.value as MetricId})}>{METRICS.filter(m=>m.additive).map(m=><option key={m.id} value={m.id}>{m.label}</option>)}</select>}</Field>}
     </div>
     {config.thenBy?<p className="rp-hint">A cross-tab counts complaints: each column is a value of the second grouping. SLA and averages are available without “Then by”.</p>
      :<div className="rp-metrics" role="group" aria-label="Metrics"><span className="rp-label">Metrics</span><div>{METRICS.map(m=><label key={m.id} className="rp-check"><input type="checkbox" checked={metricsOn.has(m.id)} onChange={e=>toggleMetric(m.id,e.target.checked)}/>{m.label}</label>)}</div></div>}
    </fieldset>}
    {config.type==='trend'&&<fieldset className="rp-fieldset"><legend>Trend options</legend><div className="rp-grid"><Field label="Period">{id=><select id={id} value={config.trendUnit} onChange={e=>update({trendUnit:e.target.value as TrendUnit})}>{TREND_UNITS.map(u=><option key={u.id} value={u.id}>{u.id==='auto'?'Automatic (by length of range)':u.label}</option>)}</select>}</Field></div></fieldset>}
    {config.type==='resolution'&&<fieldset className="rp-fieldset"><legend>Resolution options</legend><div className="rp-grid"><Field label="Break down by">{id=><select id={id} value={config.resolutionBy} onChange={e=>update({resolutionBy:e.target.value as Dim})}>{RESOLUTION_BREAKDOWNS.map(d=><option key={d} value={d}>{DIMENSIONS.find(x=>x.id===d)?.label}</option>)}</select>}</Field></div></fieldset>}
    {config.type==='users'&&<fieldset className="rp-fieldset"><legend>App users options</legend><div className="rp-grid"><Field label="Group by">{id=><select id={id} value={config.userGroup} onChange={e=>update({userGroup:e.target.value as UserDim})}>{USER_DIMENSIONS.map(u=><option key={u.id} value={u.id}>{u.label}</option>)}</select>}</Field></div><p className="rp-hint">Counts only. Names, mobile numbers and other personal details are never included. Only the date and ward filters apply.</p></fieldset>}
    {config.type==='register'&&<fieldset className="rp-fieldset"><legend>Register options</legend>
     <label className="rp-check"><input type="checkbox" checked={config.includeResident} onChange={e=>update({includeResident:e.target.checked})}/>Include resident details (name and mobile number)</label>
     <p className="rp-hint">Off by default. Turn it on only when you need to contact residents; the file will then contain personal details.</p>
    </fieldset>}

    <fieldset className="rp-fieldset">
     <legend>Filters</legend>
     <div className="rp-grid rp-filters">
      <div className="rp-field rp-range" role="group" aria-label={users?'Registered between':'Created between'}>
       <span className="rp-label">{users?'Registered between':'Created between'}</span>
       <div className="rp-range-row">
        <select aria-label="Date period" value={f.range.preset} onChange={e=>choosePreset(e.target.value)}>{RANGE_PRESETS.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select>
        <label><span>From</span><input type="date" value={f.range.from} min="1970-01-01" max="2200-12-31" aria-invalid={!!problem||undefined} aria-describedby={problem?'rp-problem':undefined} onChange={e=>setDates(e.target.value,f.range.to)}/></label>
        <label><span>To</span><input type="date" value={f.range.to} min="1970-01-01" max="2200-12-31" aria-invalid={!!problem||undefined} aria-describedby={problem?'rp-problem':undefined} onChange={e=>setDates(f.range.from,e.target.value)}/></label>
       </div>
       {problem&&<p id="rp-problem" role="alert" className="rp-error">{problem}</p>}
      </div>
      {!users&&<Field label="Status">{id=><select id={id} value={f.status} onChange={e=>updateFilters({status:e.target.value})}><option value="">All statuses</option>{options.status.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select>}</Field>}
      {!users&&<Field label="Category">{id=><select id={id} value={f.category} onChange={e=>updateFilters({category:e.target.value})}><option value="">All categories</option>{options.category.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select>}</Field>}
      {!users&&<Field label="Priority">{id=><select id={id} value={f.priority} onChange={e=>updateFilters({priority:e.target.value})}><option value="">All priorities</option>{options.priority.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select>}</Field>}
      {!users&&<Field label="Department">{id=><select id={id} value={f.department} onChange={e=>updateFilters({department:e.target.value})}><option value="">All departments</option>{options.department.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select>}</Field>}
      {options.ward.length>0&&<Field label="Ward">{id=><select id={id} value={f.ward} onChange={e=>updateFilters({ward:e.target.value})}><option value="">All wards</option>{options.ward.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select>}</Field>}
      {!users&&<Field label="Search" wide>{id=><input id={id} type="search" maxLength={200} placeholder="Complaint ID, title or locality" value={f.query} onChange={e=>updateFilters({query:e.target.value})}/>}</Field>}
      {!users&&<label className="rp-check rp-overdue"><input type="checkbox" checked={f.overdueOnly} onChange={e=>updateFilters({overdueOnly:e.target.checked})}/>Overdue only</label>}
     </div>
    </fieldset>

    <div className="rp-actions">
     <button type="button" className="button primary rp-generate" disabled={!!problem} aria-describedby={problem?'rp-problem':undefined} onClick={generate}><Play size={16} aria-hidden="true"/>Generate report</button>
     <button type="button" className="button" onClick={reset}><RotateCcw size={16} aria-hidden="true"/>Reset</button>
     <label className="rp-check rp-live"><input type="checkbox" checked={live} onChange={e=>changeLive(e.target.checked)}/>Update the report as I change filters</label>
    </div>
    <p className="rp-hint rp-live-hint">{live?'Live: once generated, the cards, chart and table refresh as soon as you change a setting.':'Manual: the report stays as generated until you press Generate report again.'}</p>
   </div>
  </section>

  <section className="rp-output" aria-labelledby="rp-title" data-stale={!live&&stale}>
   <div className="rp-bar">
    <div className="rp-bar-text">
     <p className="rp-print-brand" aria-hidden="true">SAMADHAN · Ward complaint reports</p>
     <h2 id="rp-title" ref={outputRef} tabIndex={-1}>{report?report.headline:'Your report'}</h2>
     <p className="rp-meta" role="status" aria-live="polite" aria-atomic="true">{report&&gen?`Generated ${when(report.generatedAt)} · ${report.recordCount} ${report.recordCount===1?singular(noun):noun}`:'Choose a report and filters above, then press Generate report.'}</p>
    </div>
    <div className="rp-export rp-noprint" role="group" aria-label="Export this report">
     <button type="button" className="button" disabled={!canExport} onClick={()=>exportAs('csv')} title={canExport?'Download as CSV':report?'Nothing to export':'Generate a report first'}><FileText size={16} aria-hidden="true"/>CSV</button>
     <button type="button" className="button" disabled={!canExport} onClick={()=>exportAs('xlsx')} title={canExport?'Download as Excel workbook (.xlsx)':report?'Nothing to export':'Generate a report first'}><FileSpreadsheet size={16} aria-hidden="true"/>Excel</button>
     <button type="button" className="button" disabled={!canExport} onClick={()=>window.print()} title={canExport?'Print or save as PDF':report?'Nothing to print':'Generate a report first'}><Printer size={16} aria-hidden="true"/>PDF / Print</button>
     <button type="button" className="button" disabled={!canExport} onClick={()=>exportAs('json')} title={canExport?'Download as JSON':report?'Nothing to export':'Generate a report first'}><FileJson size={16} aria-hidden="true"/>JSON</button>
    </div>
   </div>
   {notice&&<p className="rp-saved rp-noprint" role="status">{notice}</p>}
   {error&&<p className="error rp-noprint" role="alert">{error}</p>}
   {!live&&stale&&<div className="rp-stale rp-noprint" role="status"><span>Filters changed — Generate again</span><button type="button" className="button" disabled={!!problem} onClick={generate}>Generate</button></div>}

   {!report?<div className="rp-placeholder panel"><ChartColumn size={28} aria-hidden="true"/><p><b>No report yet</b></p><p>Pick a report type and press <b>Generate report</b>. Export buttons unlock once a report exists.</p></div>:<div className="rp-body">
    <div className="rp-kpis-wrap"><ul className="rp-kpis" data-count={report.kpis.length} aria-label="Report summary">{report.kpis.map(k=><li key={k.id} className="rp-kpi" data-tone={k.tone}><span className="rp-kpi-label">{k.label}</span><strong>{k.value}</strong><small>{k.caption}</small></li>)}</ul></div>
    <section className="panel rp-panel rp-chart-panel" aria-label="Chart">
     <div className="rp-panel-head"><div><h3>{report.chart.title}</h3><p>{report.filterParts[0]}</p></div>
      <button type="button" className="button rp-noprint" aria-pressed={asTable} onClick={()=>setAsTable(v=>!v)}>{asTable?<ChartColumn size={16} aria-hidden="true"/>:<Table2 size={16} aria-hidden="true"/>}{asTable?'View as chart':'View as table'}</button></div>
     <ReportChart spec={report.chart} asTable={asTable}/>
    </section>
    <section className="panel rp-panel rp-table-panel" aria-label="Results">
     <div className="rp-panel-head"><div><h3>Results</h3><p>{empty?'Nothing to list':`${plural(report.rows.length,'row')}${report.totals?' plus a totals row':''} · click a column heading to sort`}{activeSort&&` · sorted by ${report.columns.find(c=>c.id===activeSort.col)?.label}, ${activeSort.dir==='asc'?'ascending':'descending'}`}</p></div></div>
     {empty?<div className="rp-empty"><p><b>{report.recordNoun==='app users'?'No app users match these filters':'No complaints match these filters'}</b></p><p>{report.recordNoun==='open complaints'?'Only open complaints are listed here. Try a wider date range or fewer filters.':'Try a wider date range or fewer filters.'}</p>{(filtersOn>0||f.range.preset!=='thisMonth')&&<button type="button" className="button" onClick={resetFilters}>Clear filters</button>}</div>
     :<>
      <Table className="rp-table" aria-label={report.title}>
       <TableHeader><TableRow>{report.columns.map(c=>{const on=activeSort?.col===c.id;return <TableHead key={c.id} scope="col" aria-sort={on?(activeSort.dir==='asc'?'ascending':'descending'):'none'} className={isNumericColumn(c)?'rp-num':c.wide?'rp-wide':undefined}>
        <button type="button" className="rp-sort" data-on={on} onClick={()=>sortBy(c.id)}>{c.label}<span className="rp-sort-icon" aria-hidden="true">{on?(activeSort.dir==='asc'?<ArrowUp size={13}/>:<ArrowDown size={13}/>):<ChevronsUpDown size={13}/>}</span></button></TableHead>;})}</TableRow></TableHeader>
       <TableBody>{shownRows.map(row=><TableRow key={row.key}>{row.cells.map((cell,i)=>{const c=report.columns[i],cls=isNumericColumn(c)?'rp-num':c.wide?'rp-wide':undefined,text=displayCell(cell,c);return i===0?<TableHead key={c.id} scope="row" className={cls}>{text}</TableHead>:<TableCell key={c.id} className={cls}>{cell===null||cell===''?<span className="rp-none">{text}</span>:text}</TableCell>;})}</TableRow>)}</TableBody>
       {report.totals&&<TableFooter><TableRow className="rp-total">{report.totals.map((cell,i)=>{const c=report.columns[i],cls=isNumericColumn(c)?'rp-num':undefined;return i===0?<TableHead key={c.id} scope="row" className={cls}>{displayCell(cell,c)}</TableHead>:<TableCell key={c.id} className={cls}>{displayCell(cell,c)}</TableCell>;})}</TableRow></TableFooter>}
      </Table>
      {!printing&&<ShowMore remaining={paged.remaining} size={paged.size} onMore={paged.more}/>}
      {printing&&sorted.length>PRINT_ROW_LIMIT&&<p className="rp-hint rp-print-cap">Printing the first {PRINT_ROW_LIMIT} of {sorted.length} rows. Export the CSV for all of them.</p>}
     </>}
    </section>
    {report.notes.length>0&&<ul className="rp-notes">{report.notes.map(n=><li key={n}>{n}</li>)}</ul>}
   </div>}
   <p className="rp-foot">Reports are calculated in this browser from the complaints loaded in the workspace{canUsers?' (and the app users you may see)':''}. Large workspaces will need server-side reports later.</p>
  </section>
 </div>;
}
function plural(n:number,one:string){return `${n} ${n===1?one:one+'s'}`;}
