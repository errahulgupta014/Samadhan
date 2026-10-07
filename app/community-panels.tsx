'use client';
import {useState} from 'react';
import {defaultMunicipality,type Classified,type Place,type Municipality} from '@/shared/community';
import type {Workspace} from '@/shared/domain';
import {uploadPhoto} from './use-workspace';
import {ActiveToggle,ConfirmDelete,ContentHead,DataTable,Fact,FactHi,FactImage,FactLink,FilterEmpty,FilterToolbar,FormDialog,HINDI_HINT,HindiMissing,PageNotices,RowActions,ShowMore,StatusCell,StatusChip,Thumb,ViewDialog,canEdit,shortDate,showDate,toLocalInput,useDeleteFlow,useIsSuperAdmin,useRunner,usePaged,useTableFilters,plainOptions,distinctOptions,type Act,type Col,type FilterDef,type FilterSpec,type Tone} from './form-bits';
import './content-tables.css';

const blankAd=():Classified=>({id:'',title:'',titleHi:'',description:'',descriptionHi:'',advertiser:'',advertiserHi:'',contactPhone:'',url:'',imageId:'',startsAt:new Date().toISOString(),endsAt:new Date(Date.now()+30*86400000).toISOString(),status:'draft',publishedAt:null});
const blankPlace=():Place=>({id:'',name:'',nameHi:'',description:'',descriptionHi:'',address:'',addressHi:'',hours:'',hoursHi:'',sourceUrl:'',mapUrl:'',imageId:'',published:false,sortOrder:10});
function Field({label,value,onChange,area=false,type='text',required=false,hint,min,step}:{label:string;value:string;onChange:(v:string)=>void;area?:boolean;type?:string;required?:boolean;hint?:string;min?:number;step?:number}){return <label>{label}{area?<textarea rows={5} required={required} value={value} onChange={e=>onChange(e.target.value)}/>:<input type={type} required={required} min={min} step={step} value={value} onChange={e=>onChange(e.target.value)}/>}{hint&&<small className="muted" role="note">{hint}</small>}</label>;}

/** Photograph picker used by the content dialogs. `onBusy` reports a running upload so the dialog can refuse to close or save meanwhile. */
export function Photo({id,onChange,onBusy}:{id:string;onChange:(v:string)=>void;onBusy?:(busy:boolean)=>void}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 return <div>{id&&<img alt="Content preview" src={`/api/media?id=${id}`} style={{maxHeight:160,borderRadius:10}}/>}
  <label>Photograph<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={async e=>{const file=e.target.files?.[0];if(!file)return;setBusy(true);onBusy?.(true);setError('');try{onChange(await uploadPhoto(file));}catch(err){setError((err as Error).message);}finally{setBusy(false);onBusy?.(false);}}}/></label>
  {busy&&<p>Uploading…</p>}{error&&<p role="alert" className="error">{error}</p>}{id&&<button type="button" className="text-button" onClick={()=>onChange('')}>Remove photograph</button>}</div>;
}

/** Classifieds (Ads) and City & places. Both are tables with View, Edit, Active/Inactive and Delete per row; add and edit happen in a popup. */
export default function CommunityPanel({page,data,act,busy}:{page:string;data:Workspace;act:Act;busy:boolean}){
 return page==='Classifieds'?<ClassifiedsPanel data={data} act={act} busy={busy}/>:page==='City & places'?<CityPanel data={data} act={act} busy={busy}/>:null;
}

type PanelProps={data:Workspace;act:Act;busy:boolean};

/* ----------------------------- Classifieds ----------------------------- */
const adExpired=(a:Classified)=>+new Date(a.endsAt)<=Date.now();
const adState=(a:Classified):{label:'Published'|'Expired'|'Draft'|'Archived';tone:Tone}=>a.status==='published'?(adExpired(a)?{label:'Expired',tone:'warn'}:{label:'Published',tone:'live'}):a.status==='archived'?{label:'Archived',tone:'off'}:{label:'Draft',tone:'draft'};
const AD_SPEC:FilterSpec<Classified>={search:a=>[a.title,a.titleHi,a.advertiser,a.advertiserHi,a.description],selects:{status:a=>adState(a).label,advertiser:a=>(a.advertiser??'').trim()},ranges:{valid:a=>({start:a.startsAt,end:a.endsAt})}};
const AD_STATUS_OPTIONS=plainOptions(['Published','Draft','Archived','Expired']);
const AD_FIELDS=['title','titleHi','advertiser','advertiserHi','description','descriptionHi','contactPhone','url'] as const;
const AD_LABELS={title:'Title (English)',titleHi:'Title (हिन्दी)',advertiser:'Advertiser / organisation',advertiserHi:'Advertiser / organisation (हिन्दी)',description:'Description (English)',descriptionHi:'Description (हिन्दी)',contactPhone:'Contact phone',url:'Website (HTTPS)'};

function ClassifiedsPanel({data,act,busy}:PanelProps){
 const canManage=canEdit(data.viewer,'classifieds.manage'),superAdmin=useIsSuperAdmin(data),canDelete=canManage&&superAdmin;
 const {error,message,working,pending,run,clear}=useRunner(act);
 const del=useDeleteFlow<Classified>({run,clear});
 const [ad,setAd]=useState<Classified|null>(null),[formError,setFormError]=useState(''),[uploading,setUploading]=useState(false),[viewing,setViewing]=useState<Classified|null>(null);
 const all=[...(data.classifieds??[])].sort((a,b)=>+new Date(b.startsAt)-+new Date(a.startsAt));
 const f=useTableFilters(all,AD_SPEC);
 const paged=usePaged(f.rows,f.key);
 const filters:FilterDef[]=[
  {key:'status',label:'Status',allLabel:'All statuses',options:AD_STATUS_OPTIONS},
  {key:'advertiser',label:'Advertiser',allLabel:'All advertisers',options:distinctOptions(all,a=>a.advertiser)},
  {type:'dateRange',key:'valid',label:'Valid on / between'},
 ];
 const openForm=(a:Classified)=>{clear();setFormError('');setUploading(false);setAd(a);};
 const closeForm=()=>{setAd(null);setFormError('');setUploading(false);};
 const toggle=(a:Classified)=>a.status==='published'
  ?run({action:'publish-classified',id:a.id,status:'archived'},'Ad archived. It is hidden from residents.',{key:a.id})
  :run({action:'publish-classified',id:a.id,status:'published'},a.publishedAt?'Ad published. Residents can see it until it expires.':'Ad published. Residents can see it until it expires; opted-in residents are notified once.',{key:a.id});
 async function save(d:Classified){
  if(!(+new Date(d.endsAt)>+new Date(d.startsAt))){setFormError('End date must be later than the start date.');return;}
  setFormError('');
  if(await run({action:'save-classified',classified:d},d.id?`Changes saved. The ad stays ${d.status}.`:'Draft saved. Switch it to Active when it is ready.',{report:setFormError}))closeForm();
 }
 const cols:Col<Classified>[]=[
  {id:'thumb',head:'Photo',hiddenHead:true,cls:'ct-hide-sm ct-col-thumb',cell:a=><Thumb id={a.imageId}/>},
  {id:'title',head:'Title',rowHeader:true,cell:a=><><span className="ct-title">{a.title}</span>{a.titleHi?<span className="ct-sub" lang="hi">{a.titleHi}</span>:<HindiMissing value=""/>}<span className="ct-narrow-meta">{a.advertiser} · until {shortDate(a.endsAt)}</span></>},
  {id:'advertiser',head:'Advertiser',cls:'ct-hide-md',cell:a=>a.advertiser},
  {id:'status',head:'Status',cell:a=>{const s=adState(a);return <StatusCell tone={s.tone} label={s.label} toggle={canManage&&<ActiveToggle name={a.title} on={a.status==='published'} disabled={busy||working} pending={pending===a.id} hint={a.status==='published'?'Switch off to archive this ad (hidden from residents)':a.publishedAt?'Switch on to publish this ad':'Switch on to publish this ad and notify residents'} onToggle={()=>void toggle(a)}/>}/>;}},
  {id:'valid',head:'Valid from – until',cls:'ct-hide-sm',cell:a=><span className="ct-date"><span className="ct-line">{shortDate(a.startsAt)}</span><span className="ct-line ct-sub">to {shortDate(a.endsAt)}</span></span>},
  {id:'published',head:'Published on',cls:'ct-hide-lg',cell:a=><span className="ct-date">{a.publishedAt?shortDate(a.publishedAt):<span className="ct-none">Not yet</span>}</span>},
  {id:'actions',head:'Actions',hiddenHead:true,cls:'ct-col-actions',cell:a=><RowActions name={a.title} canManage={canManage} canDelete={canDelete} disabled={busy||working} onView={()=>{clear();setViewing(a);}} onEdit={()=>openForm({...a})} onDelete={()=>del.ask(a)}/>},
 ];
 return <section className="admin-section ct-page">
  <ContentHead title="Classifieds" description="Community ads for the mobile app. Draft an ad, then switch it to Active to publish it and notify opted-in residents." newLabel="New ad" onNew={canManage?()=>openForm(blankAd()):undefined} disabled={busy||working}/>
  <PageNotices error={error} message={message}/>
  <FilterToolbar noun="ads" filters={filters} state={f.state} onChange={f.setState} total={all.length} filtered={f.rows.length} shown={paged.shown}/>
  <DataTable label="Classifieds" cols={cols} rows={paged.rows} rowKey={a=>a.id} rowClass={a=>adState(a).label==='Published'?undefined:'ct-row-off'} empty={all.length?<FilterEmpty onClear={f.clear}/>:canManage?'No ads yet. Choose “New ad” to create your first classified.':'No ads yet.'}/>
  <ShowMore remaining={paged.remaining} size={paged.size} onMore={paged.more}/>
  <p className="muted ct-foot">In-app notifications are active. Phone push delivery needs a configured Expo project and device registration.</p>

  {ad&&<FormDialog title={ad.id?'Edit ad':'New ad'} description={ad.id?`Status: ${adState(ad).label}. Saving changes keeps it ${ad.status}; use the Active switch in the list to change that.`:'Saving creates a draft; switch it to Active in the list to publish it.'} saving={working||uploading} submitLabel={ad.id?'Save changes':'Save draft'} error={formError} onClose={closeForm} onSubmit={()=>save(ad)}>
   <p className="info-note ct-note">Publishing creates one inbox notification; republishing does not send duplicates.</p>
   {AD_FIELDS.map(key=><Field key={key} hint={key.endsWith('Hi')&&!(ad[key]??'').trim()?HINDI_HINT:undefined} label={AD_LABELS[key]} value={ad[key]??''} required={['title','description','advertiser'].includes(key)} area={key.startsWith('description')} onChange={v=>setAd({...ad,[key]:v})}/>)}
   <div className="two-fields">{(['startsAt','endsAt'] as const).map(key=><Field key={key} label={key==='startsAt'?'Starts at':'Expires at'} type="datetime-local" required value={toLocalInput(ad[key])} onChange={v=>{if(v)setAd({...ad,[key]:new Date(v).toISOString()});}}/>)}</div>
   <Photo id={ad.imageId} onChange={v=>setAd(d=>d?{...d,imageId:v}:d)} onBusy={setUploading}/>
  </FormDialog>}

  {viewing&&(()=>{const a=viewing,s=adState(a);return <ViewDialog title={a.title} subtitle="Ad details (read-only)" onClose={()=>setViewing(null)} onEdit={canManage?()=>{setViewing(null);openForm({...a});}:undefined}>
   <FactImage id={a.imageId} name={a.title}/>
   <Fact label="Title (English)" wide>{a.title}</Fact>
   <FactHi label="Title (हिन्दी)" value={a.titleHi} wide/>
   <Fact label="Advertiser (English)">{a.advertiser}</Fact>
   <FactHi label="Advertiser (हिन्दी)" value={a.advertiserHi}/>
   <Fact label="Description (English)" wide><span className="ct-prewrap">{a.description}</span></Fact>
   <FactHi label="Description (हिन्दी)" value={a.descriptionHi} wide/>
   <Fact label="Contact phone">{a.contactPhone}</Fact>
   <FactLink label="Website" href={a.url}/>
   <Fact label="Starts at">{showDate(a.startsAt)}</Fact>
   <Fact label="Expires at">{showDate(a.endsAt)}</Fact>
   <Fact label="Status"><StatusChip tone={s.tone}>{s.label}</StatusChip></Fact>
   <Fact label="Visible to residents now">{s.label==='Published'?'Yes':'No'}</Fact>
   <Fact label="First published on">{a.publishedAt?showDate(a.publishedAt):'Not published yet'}</Fact>
  </ViewDialog>;})()}

  {canDelete&&<ConfirmDelete open={!!del.target} busy={busy||working} error={del.error} title={del.shown?`Delete “${del.shown.title}”?`:'Delete this ad?'} description={del.shown?`This ad and its inbox notifications will be removed for good. Its photo stays in storage but is no longer used. To hide it but keep it, switch it to Inactive (archive) instead.`:''} onCancel={del.cancel} onConfirm={()=>{if(del.target)void del.confirm({action:'delete-classified',id:del.target.id},'Classified deleted.');}}/>}
 </section>;
}

/* ----------------------------- City & places ----------------------------- */
const CITY_FIELDS=['name','nameHi','district','districtHi','state','stateHi','about','aboutHi','history','historyHi','sourceUrl'] as const;
const CITY_LABELS={name:'Municipality name',nameHi:'नगरपालिका / नगरपरिषद का नाम',district:'District',districtHi:'जिला (हिन्दी)',state:'State',stateHi:'राज्य (हिन्दी)',about:'About (English)',aboutHi:'परिचय (हिन्दी)',history:'History (English)',historyHi:'इतिहास (हिन्दी)',sourceUrl:'Official / historical source (HTTPS)'};
const PLACE_FIELDS=['name','nameHi','description','descriptionHi','address','addressHi','hours','hoursHi','mapUrl','sourceUrl'] as const;
const PLACE_LABELS={name:'Name (English)',nameHi:'नाम (हिन्दी)',description:'Description (English)',descriptionHi:'विवरण (हिन्दी)',address:'Address',addressHi:'पता (हिन्दी)',hours:'Visiting hours',hoursHi:'खुलने का समय (हिन्दी)',mapUrl:'Map link (HTTPS)',sourceUrl:'Source (HTTPS)'};
const PLACE_FILTERS:FilterDef[]=[{key:'status',label:'Status',allLabel:'All statuses',options:plainOptions(['Published','Draft'])}];
const PLACE_SPEC:FilterSpec<Place>={search:p=>[p.name,p.nameHi,p.address,p.addressHi,p.description],selects:{status:p=>placeState(p).label}};
const placeState=(p:Place):{label:'Published'|'Draft';tone:Tone}=>p.published?{label:'Published',tone:'live'}:{label:'Draft',tone:'draft'};

function CityPanel({data,act,busy}:PanelProps){
 const canManage=canEdit(data.viewer,'city.manage'),superAdmin=useIsSuperAdmin(data),canDelete=canManage&&superAdmin;
 const {error,message,working,pending,run,clear}=useRunner(act);
 const del=useDeleteFlow<Place>({run,clear});
 const savedCity=data.municipality;
 const [cityDraft,setCityDraft]=useState<Municipality|null>(null),[viewCity,setViewCity]=useState(false),[place,setPlace]=useState<Place|null>(null),[viewing,setViewing]=useState<Place|null>(null),[formError,setFormError]=useState(''),[uploading,setUploading]=useState(false);
 const hasCity=!!savedCity?.name?.trim();
 const all=[...(data.places??[])].sort((a,b)=>a.sortOrder-b.sortOrder||a.name.localeCompare(b.name));
 const f=useTableFilters(all,PLACE_SPEC);
 const paged=usePaged(f.rows,f.key);
 const openCity=()=>{clear();setFormError('');setCityDraft({...defaultMunicipality(),...(savedCity??{})});};
 const closeCity=()=>{setCityDraft(null);setFormError('');};
 const openPlace=(p:Place)=>{clear();setFormError('');setUploading(false);setPlace(p);};
 const closePlace=()=>{setPlace(null);setFormError('');setUploading(false);};
 const toggleCity=()=>{if(!savedCity)return;const next=!savedCity.published;return run({action:'save-municipality',municipality:{...savedCity,published:next}},next?'City profile published in the citizen app.':'City profile unpublished. It is hidden in the citizen app.',{key:'city'});};
 const togglePlace=(p:Place)=>{const next=!p.published;return run({action:'save-place',place:{...p,published:next}},next?'Place published in the City guide.':'Place unpublished. It is hidden from the City guide.',{key:p.id});};
 const cityRows:Municipality[]=hasCity&&savedCity?[savedCity]:[];
 const cityCols:Col<Municipality>[]=[
  {id:'name',head:'Name',rowHeader:true,cell:m=><><span className="ct-title">{m.name}</span>{m.nameHi?<span className="ct-sub" lang="hi">{m.nameHi}</span>:<HindiMissing value=""/>}<span className="ct-narrow-meta">{[m.district,m.state].filter(Boolean).join(', ')}</span></>},
  {id:'district',head:'District',cls:'ct-hide-sm',cell:m=>m.district},
  {id:'state',head:'State',cls:'ct-hide-md',cell:m=>m.state},
  {id:'status',head:'Published',cell:m=>{const on=m.published;return <StatusCell tone={on?'live':'draft'} label={on?'Published':'Draft'} toggle={canManage&&<ActiveToggle name={m.name} on={on} disabled={busy||working} pending={pending==='city'} hint={on?'Switch off to hide the city profile in the citizen app':'Switch on to publish the city profile (needs an overview, history and a source)'} onToggle={()=>void toggleCity()}/>}/>;}},
  {id:'actions',head:'Actions',hiddenHead:true,cls:'ct-col-actions',cell:m=><RowActions name={m.name} canManage={canManage} disabled={busy||working} onView={()=>{clear();setViewCity(true);}} onEdit={openCity}/>},
 ];
 const placeCols:Col<Place>[]=[
  {id:'thumb',head:'Photo',hiddenHead:true,cls:'ct-hide-sm ct-col-thumb',cell:p=><Thumb id={p.imageId}/>},
  {id:'name',head:'Name',rowHeader:true,cell:p=><><span className="ct-title">{p.name}</span>{p.nameHi?<span className="ct-sub" lang="hi">{p.nameHi}</span>:<HindiMissing value=""/>}<span className="ct-narrow-meta">{p.address} · order {p.sortOrder}</span></>},
  {id:'address',head:'Address',cls:'ct-hide-md',cell:p=>p.address},
  {id:'order',head:'Order',cls:'ct-hide-lg ct-num',cell:p=>p.sortOrder},
  {id:'status',head:'Status',cell:p=>{const s=placeState(p);return <StatusCell tone={s.tone} label={s.label} toggle={canManage&&<ActiveToggle name={p.name} on={p.published} disabled={busy||working} pending={pending===p.id} hint={p.published?'Switch off to hide this place from the City guide':'Switch on to publish this place in the City guide'} onToggle={()=>void togglePlace(p)}/>}/>;}},
  {id:'actions',head:'Actions',hiddenHead:true,cls:'ct-col-actions',cell:p=><RowActions name={p.name} canManage={canManage} canDelete={canDelete} disabled={busy||working} onView={()=>{clear();setViewing(p);}} onEdit={()=>openPlace({...p})} onDelete={()=>del.ask(p)}/>},
 ];
 return <section className="admin-section ct-page">
  <ContentHead title="City & places" description="Verified local information about your city and the places worth visiting, in English and Hindi." newLabel="New place" onNew={canManage?()=>openPlace(blankPlace()):undefined} disabled={busy||working}/>
  <PageNotices error={error} message={message}/>

  <div className="ct-subhead"><div><h3>City profile</h3><p>Shown in the “Know your municipality” section of the citizen app.</p></div>{canManage&&<button type="button" className="button" disabled={busy||working} onClick={openCity}>Edit city profile</button>}</div>
  <DataTable label="City profile" cols={cityCols} rows={cityRows} rowKey={m=>m.name} empty={canManage?'No city profile yet. Choose “Edit city profile” to add one.':'No city profile yet.'}/>

  <div className="ct-subhead"><div><h3>Places to visit</h3><p>Local sights, heritage and useful visitor information.</p></div></div>
  <FilterToolbar noun="places" filters={PLACE_FILTERS} state={f.state} onChange={f.setState} total={all.length} filtered={f.rows.length} shown={paged.shown}/>
  <DataTable label="Places to visit" cols={placeCols} rows={paged.rows} rowKey={p=>p.id} rowClass={p=>p.published?undefined:'ct-row-off'} empty={all.length?<FilterEmpty onClear={f.clear}/>:canManage?'No places yet. Choose “New place” to add the first one.':'No places yet.'}/>
  <ShowMore remaining={paged.remaining} size={paged.size} onMore={paged.more}/>

  {cityDraft&&<FormDialog title="Edit city profile" description="Publish verified local information in English and Hindi. Publishing needs an overview, history and an official source." saving={working} submitLabel="Save city profile" error={formError} onClose={closeCity} onSubmit={async()=>{setFormError('');if(await run({action:'save-municipality',municipality:cityDraft},'City profile saved.',{report:setFormError}))closeCity();}}>
   {CITY_FIELDS.map(key=><Field key={key} hint={key.endsWith('Hi')&&!(cityDraft[key]??'').trim()?HINDI_HINT:undefined} label={CITY_LABELS[key]} value={cityDraft[key]??''} area={['about','aboutHi','history','historyHi'].includes(key)} required={['name','district','state'].includes(key)} onChange={v=>setCityDraft({...cityDraft,[key]:v})}/>)}
   <label className="ct-check"><input type="checkbox" checked={cityDraft.published} onChange={e=>setCityDraft({...cityDraft,published:e.target.checked})}/> Publish in citizen app</label>
  </FormDialog>}

  {viewCity&&savedCity&&<ViewDialog title={savedCity.name||'City profile'} subtitle="City profile (read-only)" onClose={()=>setViewCity(false)} onEdit={canManage?()=>{setViewCity(false);openCity();}:undefined}>
   <Fact label="Name (English)">{savedCity.name}</Fact>
   <FactHi label="Name (हिन्दी)" value={savedCity.nameHi}/>
   <Fact label="District (English)">{savedCity.district}</Fact>
   <FactHi label="District (हिन्दी)" value={savedCity.districtHi}/>
   <Fact label="State (English)">{savedCity.state}</Fact>
   <FactHi label="State (हिन्दी)" value={savedCity.stateHi}/>
   <Fact label="About (English)" wide><span className="ct-prewrap">{savedCity.about}</span></Fact>
   <FactHi label="About (हिन्दी)" value={savedCity.aboutHi} wide/>
   <Fact label="History (English)" wide><span className="ct-prewrap">{savedCity.history}</span></Fact>
   <FactHi label="History (हिन्दी)" value={savedCity.historyHi} wide/>
   <FactLink label="Official / historical source" href={savedCity.sourceUrl}/>
   <Fact label="Status"><StatusChip tone={savedCity.published?'live':'draft'}>{savedCity.published?'Published':'Draft'}</StatusChip></Fact>
   <Fact label="Visible to residents now">{savedCity.published?'Yes':'No'}</Fact>
  </ViewDialog>}

  {place&&<FormDialog title={place.id?'Edit place':'New place'} description="Local sights, heritage and visitor information shown in the City guide of the citizen app." saving={working||uploading} submitLabel={place.id?'Save place':'Add place'} error={formError} onClose={closePlace} onSubmit={async()=>{setFormError('');if(await run({action:'save-place',place},place.id?'Place saved.':'Place added.',{report:setFormError}))closePlace();}}>
   {PLACE_FIELDS.map(key=><Field key={key} hint={key.endsWith('Hi')&&!(place[key]??'').trim()?HINDI_HINT:undefined} label={PLACE_LABELS[key]} value={place[key]??''} required={['name','description','address'].includes(key)} area={key.startsWith('description')} onChange={v=>setPlace({...place,[key]:v})}/>)}
   <Photo id={place.imageId} onChange={v=>setPlace(d=>d?{...d,imageId:v}:d)} onBusy={setUploading}/>
   <Field label="Display order" type="number" min={0} step={1} value={String(place.sortOrder)} hint="Smaller numbers are listed first." onChange={v=>setPlace({...place,sortOrder:Number(v)})}/>
   <label className="ct-check"><input type="checkbox" checked={place.published} onChange={e=>setPlace({...place,published:e.target.checked})}/> Published</label>
  </FormDialog>}

  {viewing&&(()=>{const p=viewing,s=placeState(p);return <ViewDialog title={p.name} subtitle="Place details (read-only)" onClose={()=>setViewing(null)} onEdit={canManage?()=>{setViewing(null);openPlace({...p});}:undefined}>
   <FactImage id={p.imageId} name={p.name}/>
   <Fact label="Name (English)">{p.name}</Fact>
   <FactHi label="Name (हिन्दी)" value={p.nameHi}/>
   <Fact label="Description (English)" wide><span className="ct-prewrap">{p.description}</span></Fact>
   <FactHi label="Description (हिन्दी)" value={p.descriptionHi} wide/>
   <Fact label="Address (English)">{p.address}</Fact>
   <FactHi label="Address (हिन्दी)" value={p.addressHi}/>
   <Fact label="Visiting hours (English)">{p.hours}</Fact>
   <FactHi label="Visiting hours (हिन्दी)" value={p.hoursHi}/>
   <FactLink label="Map link" href={p.mapUrl}/>
   <FactLink label="Source" href={p.sourceUrl}/>
   <Fact label="Display order">{String(p.sortOrder)}</Fact>
   <Fact label="Status"><StatusChip tone={s.tone}>{s.label}</StatusChip></Fact>
   <Fact label="Visible to residents now">{p.published?'Yes':'No'}</Fact>
  </ViewDialog>;})()}

  {canDelete&&<ConfirmDelete open={!!del.target} busy={busy||working} error={del.error} title={del.shown?`Delete “${del.shown.name}”?`:'Delete this place?'} description={del.shown?`This place will be removed from the City guide for good. Its photo stays in storage but is no longer used. To hide it but keep it, switch it to Inactive instead.`:''} onCancel={del.cancel} onConfirm={()=>{if(del.target)void del.confirm({action:'delete-place',id:del.target.id},'Place deleted.');}}/>}
 </section>;
}
