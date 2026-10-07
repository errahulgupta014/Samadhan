'use client';
import {useState} from 'react';
import {CalendarRange} from 'lucide-react';
import {RANGE_PRESETS,dayCount,makeRange,parseYmd,rangeLabel,rangeProblem,toYmd,type DateRange} from '@/lib/date-range';
import './dashboard.css';

/**
 * Date-range picker for the dashboard: presets (This month is the default) and a custom From/To range.
 * Both dates are inclusive and in the viewer's local time zone. A custom range is applied as soon as it is valid; until then the previous range stays in force
 * and the reason is shown in plain English. Ranges that reach into the future are allowed (days that have not happened simply have no complaints).
 */
export default function DateRangeControl({value,onChange,matching,scopeNote,children}:{value:DateRange;onChange:(range:DateRange)=>void;/** Complaints created inside the range (and any other active filter), shown next to the label. */matching?:number;/** Another filter that is narrowing the count, e.g. the chosen ward; shown after the count. */scopeNote?:string;/** Extra filters shown under the presets (the ward filter), inside the same panel. */children?:React.ReactNode}){
 // The dates being typed live in `draft` until they form a valid range; applying a range (or choosing a preset) clears the draft so the inputs follow the applied range again.
 const [draft,setDraft]=useState<{from:string;to:string}|null>(null),[touched,setTouched]=useState(false);
 const from=draft?.from??value.from,to=draft?.to??value.to;
 const custom=value.preset==='custom',problem=rangeProblem(from,to);
 // "Enter valid dates" / "Choose both" would flash while a date is still being typed: show them once the field is left; ordering and length problems show at once.
 const complete=!!parseYmd(from)&&!!parseYmd(to),shown=problem&&(complete||touched)?problem:'';
 const apply=(range:DateRange)=>{setDraft(null);setTouched(false);onChange(range);};
 const edit=(nextFrom:string,nextTo:string)=>{if(rangeProblem(nextFrom,nextTo))setDraft({from:nextFrom,to:nextTo});else apply({preset:'custom',from:nextFrom,to:nextTo});};
 const today=toYmd(new Date()),future=!problem&&value.to>today;
 return <section className="range-bar panel" aria-label="Dashboard date range">
  <div className="range-summary"><span className="range-icon"><CalendarRange size={19}/></span><div><small>Showing complaints created</small><strong data-testid="range-label">{rangeLabel(value.from,value.to)}</strong><small className="range-meta">{dayCount(value.from,value.to)} {dayCount(value.from,value.to)===1?'day':'days'}{matching===undefined?'':` · ${matching} ${matching===1?'complaint':'complaints'}`}{scopeNote?` · ${scopeNote}`:''}</small></div></div>
  <div className="range-presets" role="group" aria-label="Choose a period">{RANGE_PRESETS.map(p=>{const active=value.preset===p.id;return <button type="button" key={p.id} className={`range-chip${active?' active':''}`} aria-pressed={active} onClick={()=>apply(p.id==='custom'?{preset:'custom',from:value.from,to:value.to}:makeRange(p.id,new Date()))}>{p.label}</button>;})}</div>
  {custom&&<div className="range-custom"><label>From<input type="date" value={from} min="1970-01-01" max="2200-12-31" aria-invalid={!!shown} aria-describedby={shown?'range-problem':undefined} onChange={e=>edit(e.target.value,to)} onBlur={()=>setTouched(true)}/></label><label>To<input type="date" value={to} min="1970-01-01" max="2200-12-31" aria-invalid={!!shown} aria-describedby={shown?'range-problem':undefined} onChange={e=>edit(from,e.target.value)} onBlur={()=>setTouched(true)}/></label></div>}
  {children&&<div className="range-extra">{children}</div>}
  {shown&&<p id="range-problem" role="alert" className="range-problem">{shown}</p>}
  {!shown&&future&&<p className="range-hint">This range includes dates after today; those days have no complaints yet.</p>}
 </section>;
}
