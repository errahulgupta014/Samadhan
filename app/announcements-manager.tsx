'use client';
import {useState} from 'react';
import type {Announcement,Workspace} from '@/shared/domain';
import {ActiveToggle,Chip,ConfirmDelete,ContentHead,DataTable,Fact,FactHi,FormDialog,HindiHint,FilterEmpty,FilterToolbar,HindiMissing,PageNotices,RowActions,ShowMore,StatusCell,StatusChip,ViewDialog,canEdit,showDate,toLocalInput,useDeleteFlow,useIsSuperAdmin,useRunner,usePaged,useTableFilters,plainOptions,type Act,type Col,type FilterDef,type FilterSpec,type Tone} from './form-bits';
import './content-tables.css';

const priorities=['Service notice','Important','Event','Emergency'] as const;
const priorityClass:Record<string,string>={Emergency:'ct-pri-emergency',Important:'ct-pri-important',Event:'ct-pri-event','Service notice':'ct-pri-service'};
type Draft={id?:string;title:string;titleHi:string;body:string;bodyHi:string;priority:string;endsAt:string;status:'published'|'archived'};
const blank=():Draft=>({title:'',titleHi:'',body:'',bodyHi:'',priority:'Service notice',endsAt:'',status:'published'});
const fromNotice=(a:Announcement):Draft=>({id:a.id,title:a.title,titleHi:a.titleHi??'',body:a.body,bodyHi:a.bodyHi??'',priority:a.priority,endsAt:a.endsAt??'',status:a.status??'published'});
const expired=(a:Announcement)=>!!a.endsAt&&+new Date(a.endsAt)<=Date.now();
const payload=(d:Draft)=>({...(d.id?{id:d.id}:{}),title:d.title.trim(),titleHi:d.titleHi.trim(),body:d.body.trim(),bodyHi:d.bodyHi.trim(),priority:d.priority,endsAt:d.endsAt,status:d.status});
/** What residents effectively get: archived and expired notices are hidden from the app. */
const stateOf=(a:Announcement):{label:'Published'|'Archived'|'Expired';tone:Tone}=>(a.status??'published')==='archived'?{label:'Archived',tone:'off'}:expired(a)?{label:'Expired',tone:'warn'}:{label:'Published',tone:'live'};
/** Filters above the table. Status uses the effective state (archived and expired notices are hidden from residents); "Valid until" looks at the end time, so notices without one never match a date range. */
const FILTERS:FilterDef[]=[
 {key:'status',label:'Status',allLabel:'All statuses',options:plainOptions(['Published','Archived','Expired'])},
 {key:'priority',label:'Priority',allLabel:'All priorities',options:plainOptions(priorities)},
 {type:'dateRange',key:'until',label:'Valid until'},
];
const SPEC:FilterSpec<Announcement>={search:a=>[a.title,a.titleHi,a.body,a.bodyHi,a.priority],selects:{status:a=>stateOf(a).label,priority:a=>a.priority},ranges:{until:a=>a.endsAt}};
const EXPIRED_NOTE='This notice had an end time that has passed. Choose a new end time or clear it, then save to publish it again.';

/** Ward updates shown in the resident app: a table with View, Edit, Active/Inactive and Delete per row; add and edit happen in a popup. Residents see a notice while it is published and before its end time. */
export default function AnnouncementsManager({data,act,busy}:{data:Workspace;act:Act;busy:boolean}){
 const canManage=canEdit(data.viewer,'announcements.manage'),superAdmin=useIsSuperAdmin(data),canDelete=canManage&&superAdmin;
 const {error,message,working,pending,run,clear}=useRunner(act);
 const del=useDeleteFlow<Announcement>({run,clear});
 const [draft,setDraft]=useState<Draft|null>(null),[note,setNote]=useState(''),[formError,setFormError]=useState(''),[viewing,setViewing]=useState<Announcement|null>(null);
 const all=[...data.announcements].sort((a,b)=>b.at.localeCompare(a.at));
 const f=useTableFilters(all,SPEC);
 const paged=usePaged(f.rows,f.key);
 const openForm=(d:Draft,n='')=>{clear();setFormError('');setNote(n);setDraft(d);};
 const closeForm=()=>{setDraft(null);setFormError('');setNote('');};
 const problem=(d:Draft)=>d.status==='published'&&d.endsAt&&+new Date(d.endsAt)<=Date.now()?'The end time has already passed. Choose a later end time, or set the notice to archived.':'';
 async function toggle(a:Announcement){
  if((a.status??'published')==='archived'){
   if(expired(a)){openForm({...fromNotice(a),status:'published',endsAt:''},EXPIRED_NOTE);return;}
   await run({action:'save-announcement',announcement:payload({...fromNotice(a),status:'published'})},'Notice published again.',{key:a.id});
  }else await run({action:'save-announcement',announcement:payload({...fromNotice(a),status:'archived'})},'Notice archived. Residents no longer see it.',{key:a.id});
 }
 async function save(d:Draft){
  const issue=problem(d);if(issue){setFormError(issue);return;}
  setFormError('');
  if(await run({action:'save-announcement',announcement:{...payload(d),endsAt:d.endsAt||''}},d.id?'Notice saved.':d.status==='published'?'Notice published. Residents see it in the app.':'Notice saved as archived.',{report:setFormError}))closeForm();
 }
 const until=(a:Announcement)=>a.endsAt?showDate(a.endsAt):'No end date';
 const cols:Col<Announcement>[]=[
  {id:'title',head:'Title',rowHeader:true,cell:a=><><span className="ct-title">{a.title}</span>{a.titleHi?<span className="ct-sub" lang="hi">{a.titleHi}</span>:<HindiMissing value=""/>}<span className="ct-narrow-meta">{a.priority} · {a.endsAt?`until ${showDate(a.endsAt)}`:'no end date'}</span></>},
  {id:'priority',head:'Priority',cls:'ct-hide-sm',cell:a=><Chip className={priorityClass[a.priority]??'ct-pri-service'}>{a.priority}</Chip>},
  {id:'status',head:'Status',cell:a=>{const s=stateOf(a);return <StatusCell tone={s.tone} label={s.label} toggle={canManage&&<ActiveToggle name={a.title} on={(a.status??'published')==='published'} disabled={busy||working} pending={pending===a.id} hint={(a.status??'published')==='published'?'Switch off to archive this notice (residents stop seeing it)':'Switch on to publish this notice again'} onToggle={()=>void toggle(a)}/>}/>;}},
  {id:'until',head:'Valid until',cls:'ct-hide-md',cell:a=><span className="ct-date">{until(a)}</span>},
  {id:'at',head:'Created / published',cls:'ct-hide-lg',cell:a=><span className="ct-date">{showDate(a.at)}</span>},
  {id:'actions',head:'Actions',hiddenHead:true,cls:'ct-col-actions',cell:a=><RowActions name={a.title} canManage={canManage} canDelete={canDelete} disabled={busy||working} onView={()=>{clear();setViewing(a);}} onEdit={()=>openForm(fromNotice(a))} onDelete={()=>del.ask(a)}/>},
 ];
 return <section className="admin-section ct-page">
  <ContentHead title="Announcements · वार्ड अपडेट" description="Notices shown on the Ward updates screen of the citizen app. Archived or ended notices disappear from the app." newLabel="New announcement" onNew={canManage?()=>openForm(blank()):undefined} disabled={busy||working}/>
  <PageNotices error={error} message={message}/>
  <FilterToolbar noun="announcements" filters={FILTERS} state={f.state} onChange={f.setState} total={all.length} filtered={f.rows.length} shown={paged.shown}/>
  <DataTable label="Announcements" cols={cols} rows={paged.rows} rowKey={a=>a.id} rowClass={a=>stateOf(a).label==='Published'?undefined:'ct-row-off'} empty={all.length?<FilterEmpty onClear={f.clear}/>:canManage?'No announcements yet. Choose “New announcement” to publish the first notice for residents.':'No announcements yet.'}/>
  <ShowMore remaining={paged.remaining} size={paged.size} onMore={paged.more}/>

  {draft&&<FormDialog title={draft.id?'Edit announcement':'New announcement'} description="Residents see a notice in the app while it is published and before its end time." saving={working} submitLabel={draft.id?'Save changes':draft.status==='published'?'Publish announcement':'Save as archived'} note={note} error={formError} onClose={closeForm} onSubmit={()=>save(draft)}>
   <label>Title (English)<input required minLength={5} maxLength={120} value={draft.title} onChange={e=>setDraft({...draft,title:e.target.value})}/></label>
   <label>Title (हिन्दी)<input maxLength={120} value={draft.titleHi} onChange={e=>setDraft({...draft,titleHi:e.target.value})}/><HindiHint value={draft.titleHi}/></label>
   <label>Notice (English)<textarea required minLength={10} maxLength={2000} rows={5} value={draft.body} onChange={e=>setDraft({...draft,body:e.target.value})}/></label>
   <label>Notice (हिन्दी)<textarea maxLength={2000} rows={5} value={draft.bodyHi} onChange={e=>setDraft({...draft,bodyHi:e.target.value})}/><HindiHint value={draft.bodyHi}/></label>
   <div className="two-fields">
    <label>Priority<select value={draft.priority} onChange={e=>setDraft({...draft,priority:e.target.value})}>{priorities.map(p=><option key={p}>{p}</option>)}</select><small className="muted">Emergency and Important notices stand out in the app.</small></label>
    <label>Visible until (optional)<input type="datetime-local" value={toLocalInput(draft.endsAt)} onChange={e=>setDraft({...draft,endsAt:e.target.value?new Date(e.target.value).toISOString():''})}/><small className="muted">{draft.endsAt?<button type="button" className="text-button" onClick={()=>setDraft({...draft,endsAt:''})}>Clear end time</button>:'Leave empty to keep the notice until you archive it.'}</small></label>
   </div>
   <label className="ct-check"><input type="checkbox" checked={draft.status==='published'} onChange={e=>setDraft({...draft,status:e.target.checked?'published':'archived'})}/> Published (visible to residents)</label>
  </FormDialog>}

  {viewing&&(()=>{const a=viewing,s=stateOf(a);return <ViewDialog title={a.title} subtitle="Announcement details (read-only)" onClose={()=>setViewing(null)} onEdit={canManage?()=>{setViewing(null);openForm(fromNotice(a));}:undefined}>
   <Fact label="Title (English)" wide>{a.title}</Fact>
   <FactHi label="Title (हिन्दी)" value={a.titleHi} wide/>
   <Fact label="Notice (English)" wide><span className="ct-prewrap">{a.body}</span></Fact>
   <FactHi label="Notice (हिन्दी)" value={a.bodyHi} wide/>
   <Fact label="Priority"><Chip className={priorityClass[a.priority]??'ct-pri-service'}>{a.priority}</Chip></Fact>
   <Fact label="Status"><StatusChip tone={s.tone}>{s.label}</StatusChip></Fact>
   <Fact label="Visible to residents now">{s.label==='Published'?'Yes':'No'}</Fact>
   <Fact label="Visible until">{until(a)}</Fact>
   <Fact label="Created / published">{showDate(a.at)}</Fact>
  </ViewDialog>;})()}

  {canDelete&&<ConfirmDelete open={!!del.target} busy={busy||working} error={del.error} title={del.shown?`Delete “${del.shown.title}”?`:'Delete this announcement?'} description={del.shown?`This announcement will be removed from the app and from this list. To hide it but keep it, switch it to Inactive (archive) instead.`:''} onCancel={del.cancel} onConfirm={()=>{if(del.target)void del.confirm({action:'delete-announcement',id:del.target.id},'Notice deleted.');}}/>}
 </section>;
}
