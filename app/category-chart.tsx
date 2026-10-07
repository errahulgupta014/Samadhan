'use client';
import {activeCategories,type Complaint,type IssueCategory} from '@/shared/domain';

type Group={key:string;name:string;color:string;count:number};
const spare=['#16765a','#1565a4','#f39b36','#8593da','#b6cedc','#c2566a','#7a5aa6','#3d8f8f','#a0a84a','#d1783a'];
export const MAX_GROUPS=12;
/**
 * Complaints grouped by the live category list: every category (including ones an administrator created, and disabled ones) keeps its own slice and its own colour.
 * Complaints whose category was removed from the list are grouped by their stored name. Only beyond MAX_GROUPS slices do the smallest merge into "More categories".
 * With no complaints yet the legend lists the first enabled categories with zero.
 */
export function categoryGroups(complaints:Complaint[],categories:IssueCategory[]):Group[]{
 const map=new Map<string,Group>();let extra=0;
 for(const c of complaints){
  const cat=categories.find(x=>c.categoryId?x.id===c.categoryId:x.nameEn===c.category)??categories.find(x=>x.nameEn===c.category);
  const key=cat?`id:${cat.id}`:`name:${c.category||'Uncategorised'}`;
  const group=map.get(key)??{key,name:cat?.nameEn??(c.category||'Uncategorised'),color:cat?.color??spare[extra++%spare.length],count:0};
  group.count++;map.set(key,group);
 }
 const groups=[...map.values()].sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name));
 if(!groups.length)return activeCategories(categories).slice(0,5).map(c=>({key:`id:${c.id}`,name:c.nameEn,color:c.color,count:0}));
 if(groups.length<=MAX_GROUPS)return groups;
 const head=groups.slice(0,MAX_GROUPS-1),tail=groups.slice(MAX_GROUPS-1);
 return [...head,{key:'more',name:'More categories',color:'#b6cedc',count:tail.reduce((n,g)=>n+g.count,0)}];
}
export default function CategoryChart({complaints,categories}:{complaints:Complaint[];categories:IssueCategory[]}){
 const groups=categoryGroups(complaints,categories),total=complaints.length;let n=0;
 const gradient=total?`conic-gradient(${groups.map(g=>{const a=n;n+=g.count/total*100;return `${g.color} ${a}% ${n}%`;}).join(',')})`:'#e9edf1';
 return <div className="category-chart"><div className="donut" style={{background:gradient}}><div><strong>{total}</strong><small>complaints</small></div></div><div className="category-legend">{groups.map(g=><div key={g.key} style={groups.length>6?{margin:'7px 0'}:undefined}><i style={{background:g.color}}/><span>{g.name}</span><b>{g.count}</b></div>)}</div></div>;
}
