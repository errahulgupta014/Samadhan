'use client';
import {useMemo} from 'react';
import {countByBucket,labelStep,rangeLabel,type BucketUnit} from '@/lib/date-range';
import './dashboard.css';

const UNIT_WORD:Record<BucketUnit,string>={day:'day',week:'week',month:'month'};
/** Heading for the chart panel: what each bar stands for. */
export const activityCaption=(unit:BucketUnit,from:string,to:string)=>`Reports received per ${UNIT_WORD[unit]}, ${rangeLabel(from,to)}`;
/**
 * Reports received over the selected range (complaints counted by the day they were created, local time): one bar per day up to 31 days,
 * one per week (Monday to Sunday) up to about four months and one per month beyond that. Days that have not happened yet show no bar.
 * Plain HTML/CSS bars rather than an SVG so labels stay at a readable size on a phone; about eight axis labels are shown at most.
 */
export default function ActivityChart({complaints,from,to}:{complaints:{createdAt:string}[];from:string;to:string}){
 const {unit,buckets,total}=useMemo(()=>countByBucket(complaints,from,to),[complaints,from,to]);
 const peak=Math.max(0,...buckets.map(b=>b.count)),top=peak<=4?4:Math.ceil(peak/4)*4,step=labelStep(buckets.length);
 const ticks=[4,3,2,1,0].map(i=>Math.round(top*i/4)),busiest=buckets.find(b=>b.count===peak);
 const cols={gridTemplateColumns:`repeat(${Math.max(buckets.length,1)},minmax(0,1fr))`};
 const summary=`Reports per ${UNIT_WORD[unit]}: ${buckets.filter(b=>!b.future).map(b=>`${b.title} ${b.count}`).join(', ')}`;
 return <div className="activity-bars" data-unit={unit}>
  <div className="bars-body"><div className="bars-axis" aria-hidden="true">{ticks.map((t,i)=><span key={i} style={{top:`${i*25}%`}}>{t}</span>)}</div>
   <div className="bars-main"><div className="bars-plot" style={cols} role="img" aria-label={summary}>{buckets.map(b=><div className={`bar-cell${b.future?' future':''}`} key={b.key} title={b.future?`${b.title}: not reached yet`:`${b.title}: ${b.count} ${b.count===1?'report':'reports'}`}>{b.count>0&&<span className="bar" style={{height:`${b.count/top*100}%`}}>{buckets.length<=16&&<em>{b.count}</em>}</span>}</div>)}</div>
    <div className="bars-labels" style={cols} aria-hidden="true">{buckets.map((b,i)=><span key={b.key} className={b.future?'future':undefined}>{i%step===0?b.label:''}</span>)}</div></div></div>
  <p className="bars-caption">{total?`${total} ${total===1?'report':'reports'} in this period${busiest&&peak>1?` · busiest ${UNIT_WORD[unit]}: ${busiest.title} (${peak})`:''}`:'No reports were received in this period.'}</p>
 </div>;
}
