'use client';
import {useState} from 'react';
import type {Activity} from '@/shared/community';
import type {Workspace} from '@/shared/domain';
import {Photo} from './community-panels';
import {ActiveToggle,ConfirmDelete,ContentHead,DataTable,Fact,FactHi,FactImage,FactLink,FilterEmpty,FilterToolbar,FormDialog,HINDI_HINT,HindiMissing,PageNotices,RowActions,ShowMore,StatusCell,StatusChip,Thumb,ViewDialog,canEdit,showDate,toLocalInput,useDeleteFlow,useIsSuperAdmin,useRunner,usePaged,useTableFilters,plainOptions,distinctOptions,type Act,type Col,type FilterDef,type FilterSpec,type Tone} from './form-bits';
import './content-tables.css';

/** A new activity starts tomorrow 10:00 and ends 17:00 the same day (local time); the editor saves ISO instants. */
const blankActivity=():Activity=>{const start=new Date();start.setDate(start.getDate()+1);start.setHours(10,0,0,0);const end=new Date(start);end.setHours(17,0,0,0);return {id:'',title:'',titleHi:'',description:'',descriptionHi:'',organizer:'',organizerHi:'',venue:'',venueHi:'',startsAt:start.toISOString(),endsAt:end.toISOString(),imageId:'',contactPhone:'',url:'',status:'draft',publishedAt:null};};
const ended=(a:Activity)=>+new Date(a.endsAt)<=Date.now();
const stateOf=(a:Activity):{label:'Published'|'Ended'|'Draft'|'Archived';tone:Tone}=>a.status==='published'?(ended(a)?{label:'Ended',tone:'warn'}:{label:'Published',tone:'live'}):a.status==='archived'?{label:'Archived',tone:'off'}:{label:'Draft',tone:'draft'};
/** Upcoming / Ongoing / Past by the activity's own dates (whatever its publication status). */
const timing=(a:Activity)=>{const now=Date.now();return +new Date(a.startsAt)>now?'upcoming':+new Date(a.endsAt)<=now?'past':'ongoing';};
const SPEC:FilterSpec<Activity>={search:a=>[a.title,a.titleHi,a.organizer,a.organizerHi,a.venue,a.venueHi,a.description],selects:{status:a=>stateOf(a).label,organizer:a=>(a.organizer??'').trim(),when:timing},ranges:{starts:a=>a.startsAt}};
const STATUS_OPTIONS=plainOptions(['Published','Draft','Archived','Ended']);
const WHEN_OPTIONS=[{value:'upcoming',label:'Upcoming (not started)'},{value:'ongoing',label:'Ongoing (now)'},{value:'past',label:'Past (ended)'}];
/** Mirrors the server rules that can be checked before sending; the server remains the authority and its message is shown when it disagrees. */
function problem(a:Activity){
 if(!(+new Date(a.endsAt)>+new Date(a.startsAt)))return 'End date must be later than the start date.';
 if(a.url.trim()&&!/^https:\/\/\S+$/i.test(a.url.trim()))return 'Links must use HTTPS (start with https://).';
 return '';
}
function TextField({label,value,onChange,area=false,required=false,min,max,type='text',hint,pattern}:{label:string;value:string;onChange:(v:string)=>void;area?:boolean;required?:boolean;min?:number;max?:number;type?:string;hint?:string;pattern?:string}){
 return <label>{label}{area?<textarea rows={5} required={required} minLength={min} maxLength={max} value={value} onChange={e=>onChange(e.target.value)}/>:<input type={type} required={required} minLength={min} maxLength={max} pattern={pattern} value={value} onChange={e=>onChange(e.target.value)}/>}{hint&&<small className="muted">{hint}</small>}</label>;
}
const dates=(a:Activity)=><><span className="ct-line">{showDate(a.startsAt)}</span><span className="ct-line ct-sub">to {showDate(a.endsAt)}</span></>;

/** Campaigns and programmes: a table with View, Edit, Active/Inactive and Delete per row; add and edit happen in a popup. New activities start as drafts and editing never changes whether one is published. */
export default function ActivitiesManager({data,act,busy}:{data:Workspace;act:Act;busy:boolean}){
 const canManage=canEdit(data.viewer,'activities.manage'),superAdmin=useIsSuperAdmin(data),canDelete=canManage&&superAdmin;
 const {error,message,working,pending,run,clear}=useRunner(act);
 const del=useDeleteFlow<Activity>({run,clear});
 const [draft,setDraft]=useState<Activity|null>(null),[formError,setFormError]=useState(''),[uploading,setUploading]=useState(false),[viewing,setViewing]=useState<Activity|null>(null);
 const all=[...(data.activities??[])].sort((a,b)=>+new Date(b.startsAt)-+new Date(a.startsAt));
 const f=useTableFilters(all,SPEC);
 const paged=usePaged(f.rows,f.key);
 const filters:FilterDef[]=[
  {key:'status',label:'Status',allLabel:'All statuses',options:STATUS_OPTIONS},
  {key:'when',label:'Timing',allLabel:'Any time',options:WHEN_OPTIONS},
  {key:'organizer',label:'Organizer',allLabel:'All organizers',options:distinctOptions(all,a=>a.organizer)},
  {type:'dateRange',key:'starts',label:'Starts between'},
 ];
 const openForm=(a:Activity)=>{clear();setFormError('');setUploading(false);setDraft(a);};
 const closeForm=()=>{setDraft(null);setFormError('');setUploading(false);};
 const toggle=(a:Activity)=>a.status==='published'
  ?run({action:'publish-activity',id:a.id,status:'archived'},'Activity archived. It is hidden from residents.',{key:a.id})
  :run({action:'publish-activity',id:a.id,status:'published'},'Activity published. Residents can see it until it ends; opted-in residents are notified on the first publication.',{key:a.id});
 async function save(d:Activity){
  const issue=problem(d);if(issue){setFormError(issue);return;}
  setFormError('');
  if(await run({action:'save-activity',activity:{id:d.id||undefined,title:d.title,titleHi:d.titleHi,description:d.description,descriptionHi:d.descriptionHi,organizer:d.organizer,organizerHi:d.organizerHi,venue:d.venue,venueHi:d.venueHi,startsAt:d.startsAt,endsAt:d.endsAt,imageId:d.imageId,contactPhone:d.contactPhone,url:d.url.trim()}},d.id?`Changes saved. The activity stays ${d.status}.`:'Draft saved. Switch it to Active when it is ready for residents.',{report:setFormError}))closeForm();
 }
 const cols:Col<Activity>[]=[
  {id:'thumb',head:'Photo',hiddenHead:true,cls:'ct-hide-sm ct-col-thumb',cell:a=><Thumb id={a.imageId}/>},
  {id:'title',head:'Title',rowHeader:true,cell:a=><><span className="ct-title">{a.title}</span>{a.titleHi?<span className="ct-sub" lang="hi">{a.titleHi}</span>:<HindiMissing value=""/>}<span className="ct-narrow-meta">{a.organizer} · {showDate(a.startsAt)}</span></>},
  {id:'organizer',head:'Organizer',cls:'ct-hide-md',cell:a=>a.organizer},
  {id:'venue',head:'Venue',cls:'ct-hide-lg',cell:a=>a.venue||<span className="ct-none">—</span>},
  {id:'when',head:'Starts – ends',cls:'ct-hide-sm',cell:a=><span className="ct-date">{dates(a)}</span>},
  {id:'status',head:'Status',cell:a=>{const s=stateOf(a);return <StatusCell tone={s.tone} label={s.label} toggle={canManage&&<ActiveToggle name={a.title} on={a.status==='published'} disabled={busy||working} pending={pending===a.id} hint={a.status==='published'?'Switch off to archive this activity (hidden from residents)':a.publishedAt?'Switch on to publish this activity':'Switch on to publish this activity and notify residents'} onToggle={()=>void toggle(a)}/>}/>;}},
  {id:'actions',head:'Actions',hiddenHead:true,cls:'ct-col-actions',cell:a=><RowActions name={a.title} canManage={canManage} canDelete={canDelete} disabled={busy||working} onView={()=>{clear();setViewing(a);}} onEdit={()=>openForm({...a})} onDelete={()=>del.ask(a)}/>},
 ];
 return <section className="admin-section ct-page">
  <ContentHead title="Activities · गतिविधियाँ" description="Campaigns, drives and programmes run by the Panchayat Samiti or Nagar Parishad. New activities start as drafts: switch one to Active to publish it." newLabel="New activity" onNew={canManage?()=>openForm(blankActivity()):undefined} disabled={busy||working}/>
  <PageNotices error={error} message={message}/>
  <FilterToolbar noun="activities" filters={filters} state={f.state} onChange={f.setState} total={all.length} filtered={f.rows.length} shown={paged.shown}/>
  <DataTable label="Activities" cols={cols} rows={paged.rows} rowKey={a=>a.id} rowClass={a=>stateOf(a).label==='Published'?undefined:'ct-row-off'} empty={all.length?<FilterEmpty onClear={f.clear}/>:canManage?'No activities yet. Choose “New activity” to create the first campaign or programme.':'No activities yet.'}/>
  <ShowMore remaining={paged.remaining} size={paged.size} onMore={paged.more}/>

  {draft&&<FormDialog title={draft.id?'Edit activity':'New activity'} description={draft.id?`Status: ${stateOf(draft).label}. Saving changes keeps it ${draft.status}; use the Active switch in the list to change that.`:'Saving creates a draft; switch it to Active in the list to publish it.'} saving={working||uploading} submitLabel={draft.id?'Save changes':'Save draft'} error={formError} onClose={closeForm} onSubmit={()=>save(draft)}>
   <p className="info-note ct-note">Residents see an activity while it is published and has not ended. The first publication sends one notification to residents who have activity notifications on (the default); republishing does not send duplicates.</p>
   <TextField label="Title (English)" value={draft.title} required min={4} max={120} onChange={v=>setDraft({...draft,title:v})}/>
   <TextField label="Title (हिन्दी)" hint={draft.titleHi.trim()?undefined:HINDI_HINT} value={draft.titleHi} max={120} onChange={v=>setDraft({...draft,titleHi:v})}/>
   <TextField label="Organizer, e.g. Nagar Parishad" value={draft.organizer} required min={2} max={150} onChange={v=>setDraft({...draft,organizer:v})}/>
   <TextField label="Organizer (हिन्दी)" hint={draft.organizerHi.trim()?undefined:HINDI_HINT} value={draft.organizerHi} max={150} onChange={v=>setDraft({...draft,organizerHi:v})}/>
   <TextField label="Description (English)" value={draft.description} area required min={10} max={4000} onChange={v=>setDraft({...draft,description:v})}/>
   <TextField label="Description (हिन्दी)" hint={draft.descriptionHi.trim()?undefined:HINDI_HINT} value={draft.descriptionHi} area max={4000} onChange={v=>setDraft({...draft,descriptionHi:v})}/>
   <div className="two-fields">
    <TextField label="Starts at" type="datetime-local" required value={toLocalInput(draft.startsAt)} onChange={v=>{if(v)setDraft({...draft,startsAt:new Date(v).toISOString()});}}/>
    <TextField label="Ends at" type="datetime-local" required value={toLocalInput(draft.endsAt)} hint="Residents stop seeing the activity at this time." onChange={v=>{if(v)setDraft({...draft,endsAt:new Date(v).toISOString()});}}/>
   </div>
   <TextField label="Venue" value={draft.venue} max={200} onChange={v=>setDraft({...draft,venue:v})}/>
   <TextField label="Venue (हिन्दी)" hint={draft.venueHi.trim()?undefined:HINDI_HINT} value={draft.venueHi} max={200} onChange={v=>setDraft({...draft,venueHi:v})}/>
   <TextField label="Contact phone" type="tel" value={draft.contactPhone} max={30} onChange={v=>setDraft({...draft,contactPhone:v})}/>
   <TextField label="Link (HTTPS)" type="url" value={draft.url} max={1000} pattern="https://\S+" hint="Optional. Opens outside the app; must start with https://." onChange={v=>setDraft({...draft,url:v})}/>
   <Photo id={draft.imageId} onChange={v=>setDraft(d=>d?{...d,imageId:v}:d)} onBusy={setUploading}/>
  </FormDialog>}

  {viewing&&(()=>{const a=viewing,s=stateOf(a);return <ViewDialog title={a.title} subtitle="Activity details (read-only)" onClose={()=>setViewing(null)} onEdit={canManage?()=>{setViewing(null);openForm({...a});}:undefined}>
   <FactImage id={a.imageId} name={a.title}/>
   <Fact label="Title (English)" wide>{a.title}</Fact>
   <FactHi label="Title (हिन्दी)" value={a.titleHi} wide/>
   <Fact label="Organizer (English)">{a.organizer}</Fact>
   <FactHi label="Organizer (हिन्दी)" value={a.organizerHi}/>
   <Fact label="Description (English)" wide><span className="ct-prewrap">{a.description}</span></Fact>
   <FactHi label="Description (हिन्दी)" value={a.descriptionHi} wide/>
   <Fact label="Starts at">{showDate(a.startsAt)}</Fact>
   <Fact label="Ends at">{showDate(a.endsAt)}</Fact>
   <Fact label="Venue (English)">{a.venue}</Fact>
   <FactHi label="Venue (हिन्दी)" value={a.venueHi}/>
   <Fact label="Contact phone">{a.contactPhone}</Fact>
   <FactLink label="Link" href={a.url}/>
   <Fact label="Status"><StatusChip tone={s.tone}>{s.label}</StatusChip></Fact>
   <Fact label="Visible to residents now">{s.label==='Published'?'Yes':'No'}</Fact>
   <Fact label="First published on">{a.publishedAt?showDate(a.publishedAt):'Not published yet'}</Fact>
  </ViewDialog>;})()}

  {canDelete&&<ConfirmDelete open={!!del.target} busy={busy||working} error={del.error} title={del.shown?`Delete “${del.shown.title}”?`:'Delete this activity?'} description={del.shown?`This activity and its inbox notifications will be removed for good. Its photo stays in storage but is no longer used. To hide it but keep it, switch it to Inactive (archive) instead.`:''} onCancel={del.cancel} onConfirm={()=>{if(del.target)void del.confirm({action:'delete-activity',id:del.target.id},'Activity deleted.');}}/>}
 </section>;
}
