'use client';
import {useState,type FormEvent} from 'react';
import {Plus,RotateCcw} from 'lucide-react';
import {Table,TableBody,TableCaption,TableCell,TableHead,TableHeader,TableRow} from '@/components/ui/table';
import type {BrandingBanner} from '../shared/domain';
import {uploadPhoto} from './use-workspace';
import {ConfirmDelete,FilterEmpty,FilterToolbar,HindiHint,plainOptions,useIsSuperAdmin,useTableFilters,type FilterDef,type FilterSpec} from './form-bits';
import {Busy,ConfirmDialog,DialogBody,DialogFoot,DialogForm,FormError,RecordDialog,RowActions,StatusChip,ViewFields} from './record-bits';
import './record-tables.css';

const MAX_BANNERS=5;
// Residents' devices only open https links; the server enforces the same rule.
const validLink=(value?:string)=>{const raw=(value??'').trim();if(!raw)return true;if(raw.length>1000||!/^https:\/\/[^/\\?#]/i.test(raw)||/[\s\u0000-\u001f\u007f\\]/u.test(raw))return false;try{const url=new URL(raw);return url.protocol==='https:'&&!!url.hostname&&!url.username&&!url.password;}catch{return false;}};
const imageUrl=(id:string)=>`/api/media?id=${encodeURIComponent(id)}`;
const hostOf=(link?:string)=>{try{return link?new URL(link).hostname:'';}catch{return '';}};
/** What publishing sends: trimmed text, an empty label falls back to 'Banner N', empty optional fields are dropped. */
const toPayload=(list:BrandingBanner[])=>list.map((b,i)=>({id:b.id,imageId:b.imageId,title:b.title.trim()||`Banner ${i+1}`,enabled:b.enabled,...(b.caption?.trim()?{caption:b.caption.trim()}:{}),...(b.captionHi?.trim()?{captionHi:b.captionHi.trim()}:{}),...(b.linkUrl?.trim()?{linkUrl:b.linkUrl.trim()}:{})}));
const FILTERS:FilterDef[]=[{key:'status',label:'Status',allLabel:'All statuses',options:plainOptions(['Active','Inactive'])}];
const SPEC:FilterSpec<BrandingBanner>={search:b=>[b.title,b.caption,b.captionHi,b.linkUrl],selects:{status:b=>b.enabled?'Active':'Inactive'}};
type Draft={id?:string;imageId:string;title:string;caption:string;captionHi:string;linkUrl:string;enabled:boolean;position:number};

/**
 * Home-screen banner slider. Every row offers View, Edit, Active/Inactive (the banner's enabled flag) and Delete (remove from the slider);
 * adding and editing happen in a popup, and each change is published straight away (save-banners). At most five banners; their order is set in the popup.
 * "Restore supplied banners" goes back to the supplied splash artwork and SAMADHAN community banner.
 */
export default function BannerManager({banners,act,busy,canEdit=true}:{banners?:BrandingBanner[];act:(body:Record<string,unknown>)=>Promise<unknown>;busy:boolean;canEdit?:boolean}){
 const list=banners??[];
 const superAdmin=useIsSuperAdmin(),canDelete=canEdit&&superAdmin;// removing a banner (and restoring the supplied ones, which removes the custom ones) is a deletion: Super Admin only
 const isDefault=banners===undefined;
 const f=useTableFilters(list,SPEC);
 const [draft,setDraft]=useState<Draft|null>(null),[viewing,setViewing]=useState<string|null>(null),[toDelete,setToDelete]=useState<BrandingBanner|null>(null),[restoring,setRestoring]=useState(false);
 const [uploading,setUploading]=useState(false),[working,setWorking]=useState(false),[error,setError]=useState(''),[formError,setFormError]=useState(''),[dialogError,setDialogError]=useState(''),[notice,setNotice]=useState('');
 const viewed=viewing?list.find(b=>b.id===viewing)??null:null;
 const full=list.length>=MAX_BANNERS;
 const FULL=`You can have up to five banners. ${canDelete?'Delete':'Ask a Super Admin to delete'} one to add another.`;
 const reset=()=>{setError('');setFormError('');setDialogError('');setNotice('');};
 /** Publishes the whole list; throws the server's message when it refuses. */
 const publish=(next:BrandingBanner[])=>act({action:'save-banners',banners:toPayload(next)});
 const patch=(fields:Partial<Draft>)=>setDraft(d=>d&&{...d,...fields});
 function startAdd(){reset();setDraft({imageId:'',title:'',caption:'',captionHi:'',linkUrl:'',enabled:true,position:list.length+1});}
 function startEdit(b:BrandingBanner){reset();setDraft({id:b.id,imageId:b.imageId,title:b.title,caption:b.caption??'',captionHi:b.captionHi??'',linkUrl:b.linkUrl??'',enabled:b.enabled,position:list.findIndex(x=>x.id===b.id)+1});}
 async function save(e:FormEvent){
  e.preventDefault();if(!draft||working||uploading)return;setFormError('');
  if(!draft.imageId){setFormError('Choose a banner image first.');return;}
  if(!validLink(draft.linkUrl)){setFormError('Fix the banner link: it must start with https:// and contain no spaces.');return;}
  if(!draft.id&&full){setFormError(FULL);return;}
  const entry:BrandingBanner={id:draft.id??crypto.randomUUID(),imageId:draft.imageId,title:draft.title,enabled:draft.enabled,caption:draft.caption,captionHi:draft.captionHi,linkUrl:draft.linkUrl};
  const rest=list.filter(b=>b.id!==draft.id);
  const at=Math.min(Math.max(draft.position-1,0),rest.length);
  const next=[...rest.slice(0,at),entry,...rest.slice(at)];
  setWorking(true);
  try{await publish(next);setNotice(draft.id?'Banner saved. Residents see the change when they refresh the app.':'Banner added. Residents see it when they refresh the app.');setDraft(null);}
  catch(err){setFormError((err as Error).message);}
  finally{setWorking(false);}
 }
 async function toggle(b:BrandingBanner){
  reset();
  try{await publish(list.map(x=>x.id===b.id?{...x,enabled:!x.enabled}:x));setNotice(b.enabled?`“${b.title}” is now inactive and hidden from residents.`:`“${b.title}” is active and shown to residents.`);}
  catch(err){setError((err as Error).message);}
 }
 async function remove(b:BrandingBanner){
  setWorking(true);setDialogError('');
  try{await publish(list.filter(x=>x.id!==b.id));setNotice(list.length===1?`“${b.title}” was deleted. With no banners the slider is hidden from residents.`:`“${b.title}” was deleted from the slider.`);setToDelete(null);}
  catch(err){setDialogError((err as Error).message);}
  finally{setWorking(false);}
 }
 async function restore(){
  setWorking(true);setDialogError('');
  try{await act({action:'save-banners',restoreDefault:true});setNotice('The supplied splash artwork and SAMADHAN community banner are back.');setRestoring(false);}
  catch(err){setDialogError((err as Error).message);}
  finally{setWorking(false);}
 }
 return <section className="admin-section rt-page banner-manager">
  <div className="section-title"><div><div className="eyebrow">HOME SCREEN BRANDING</div><h2>Branding banner slider</h2><p>Publish personal or political artwork on the mobile home screen after sign-in. Add up to five images, set their order, or make individual banners inactive. Residents can swipe between banners, and the slider keeps rotating by itself.</p></div>
   {canEdit&&<div className="action-buttons" style={{margin:0}}>{canDelete&&<button type="button" className="button" disabled={busy||working} onClick={()=>{reset();setRestoring(true);}}><RotateCcw size={15}/> Restore supplied banners</button>}<button type="button" className="button primary" disabled={busy||working||full} title={full?FULL:undefined} onClick={startAdd}><Plus size={15}/> Add banner</button></div>}</div>
  <p className="rt-note" style={{margin:'0 0 12px'}}>Landscape artwork (1200 × 600 px) works best. Portrait images are displayed in full. JPG, PNG or WebP, up to 5 MB per image. A caption appears in a bar beneath the artwork; add an https link and the banner becomes tappable. Changes reach residents when they refresh the app.{canEdit&&full?` You have five banners, the most allowed: ${canDelete?'delete':'ask a Super Admin to delete'} one to add another.`:''}</p>
  {notice&&<p className="info-note" role="status">{notice}</p>}{error&&<p className="error" role="alert">{error}</p>}
  <FilterToolbar noun="banners" filters={FILTERS} state={f.state} onChange={f.setState} total={list.length} filtered={f.rows.length} searchPlaceholder="Search by label, caption or link…"/>
  <div className="panel rt-panel">
   <Table className="rt-table">
    <TableCaption className="sr-only">Home screen banners in the order residents see them</TableCaption>
    <TableHeader><TableRow><TableHead>Banner</TableHead><TableHead className="rt-md rt-num">Order</TableHead><TableHead className="rt-lg">Link</TableHead><TableHead>Status</TableHead><TableHead className="rt-right">Actions</TableHead></TableRow></TableHeader>
    <TableBody>
     {f.rows.map(b=><TableRow key={b.id} className={b.enabled?undefined:'is-off'}>
      <TableCell><div className="rt-name"><img className="rt-thumb contain wide" src={imageUrl(b.imageId)} alt={b.caption||b.title||'Banner preview'}/><span><b>{b.title}</b>{b.caption&&<span className="rt-sub">{b.caption}</span>}<span className="rt-sub rt-hi-sub">Position {list.indexOf(b)+1} of {list.length}</span></span></div></TableCell>
      <TableCell className="rt-md rt-num">{list.indexOf(b)+1}</TableCell>
      <TableCell className="rt-lg">{b.linkUrl?hostOf(b.linkUrl)||b.linkUrl:<span className="rt-muted">No link</span>}</TableCell>
      <TableCell className="rt-status"><StatusChip tone={b.enabled?'on':'off'}>{b.enabled?'Active':'Inactive'}</StatusChip></TableCell>
      <TableCell className="rt-actions-cell"><RowActions name={b.title} busy={busy||working||uploading} onView={()=>{reset();setViewing(b.id);}}
       edit={canEdit?{onClick:()=>startEdit(b)}:undefined}
       toggle={canEdit?{on:b.enabled,onChange:()=>void toggle(b)}:undefined}
       del={canDelete?{onClick:()=>{reset();setToDelete(b);}}:undefined}/></TableCell>
     </TableRow>)}
    </TableBody>
   </Table>
   {!!list.length&&!f.rows.length&&<div className="rt-empty"><FilterEmpty onClear={f.clear}/></div>}
   {!list.length&&<p className="rt-empty">{isDefault?'The supplied splash artwork and SAMADHAN community banner appear until you publish your own selection.':'No custom banners. With none, the slider is hidden from residents.'}{canEdit?' Choose Add banner to publish your own.':''}</p>}
  </div>

  <RecordDialog open={!!viewed} onClose={()=>setViewing(null)} wide title={viewed?.title??'Banner'} description="Banner details. Nothing here can be changed; use Edit for that.">
   {viewed&&<><DialogBody>
    <img className="rt-view-image" src={imageUrl(viewed.imageId)} alt={viewed.caption||viewed.title||'Banner preview'}/>
    <ViewFields items={[
     {label:'Label (admin only)',value:viewed.title},{label:'Caption',value:viewed.caption},{label:'Caption in Hindi',value:viewed.captionHi},
     {label:'Link',value:viewed.linkUrl?(validLink(viewed.linkUrl)?<a href={viewed.linkUrl} target="_blank" rel="noopener noreferrer">{viewed.linkUrl}</a>:viewed.linkUrl):''},
     {label:'Order',value:`${list.findIndex(b=>b.id===viewed.id)+1} of ${list.length}`},
     {label:'Status',value:<><StatusChip tone={viewed.enabled?'on':'off'}>{viewed.enabled?'Active':'Inactive'}</StatusChip><span className="rt-sub">{viewed.enabled?'Shown to residents.':'Hidden from residents.'}</span></>},
    ]}/>
   </DialogBody><DialogFoot><button type="button" className="button" onClick={()=>setViewing(null)}>Close</button></DialogFoot></>}
  </RecordDialog>

  <RecordDialog open={canEdit&&!!draft} onClose={()=>{setDraft(null);setFormError('');}} locked={working||uploading} wide title={draft?.id?'Edit banner':'Add banner'} description="Changes are published to the app as soon as you save. Residents see them when they refresh the app.">
   {canEdit&&draft&&<DialogForm onSubmit={e=>void save(e)} noValidate>
    <DialogBody>
     <div className="rt-photo-row" style={{gridTemplateColumns:'110px minmax(0,1fr)'}}>
      {draft.imageId?<img className="rt-thumb contain" style={{width:110,height:80}} src={imageUrl(draft.imageId)} alt="Banner preview"/>:<div className="rt-thumb" style={{width:110,height:80}} aria-hidden="true"/>}
      <div><label className="rt-field" style={{margin:0}}>{draft.imageId?'Replace image':'Banner image'} (JPG, PNG or WebP, up to 5 MB)<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy||uploading||working} onChange={async e=>{const input=e.target;const file=input.files?.[0];if(!file)return;setUploading(true);setFormError('');try{patch({imageId:await uploadPhoto(file)});}catch(err){setFormError((err as Error).message);}finally{setUploading(false);input.value='';}}}/></label>{uploading&&<p className="rt-hint">Uploading…</p>}</div>
     </div>
     <label className="rt-field">Label (admin only, not shown to residents)<input value={draft.title} maxLength={100} placeholder="e.g. Councillor meet" onChange={e=>patch({title:e.target.value})}/></label>
     <label className="rt-field">Caption shown on the banner (optional)<input value={draft.caption} maxLength={140} placeholder="e.g. Meet your ward councillor" onChange={e=>patch({caption:e.target.value})}/></label>
     <label className="rt-field">Caption in Hindi (हिन्दी, optional)<input value={draft.captionHi} maxLength={140} placeholder="e.g. अपने वार्ड पार्षद से मिलें" onChange={e=>patch({captionHi:e.target.value})}/>{draft.caption.trim()&&!draft.captionHi.trim()&&<HindiHint value=""/>}</label>
     <label className="rt-field">Link opened when residents tap the banner (optional, https only)<input type="url" inputMode="url" value={draft.linkUrl} maxLength={1000} placeholder="https://example.org/campaign" aria-invalid={!validLink(draft.linkUrl)} onChange={e=>patch({linkUrl:e.target.value})}/>{!validLink(draft.linkUrl)&&<span className="error" role="alert" style={{margin:0}}>Links must start with https:// and contain no spaces.</span>}</label>
     <label className="rt-field">Position in the slider<select value={draft.position} onChange={e=>patch({position:Number(e.target.value)})}>{Array.from({length:draft.id?list.length:list.length+1},(_,i)=><option key={i+1} value={i+1}>{i+1}{i===0?' (first)':''}</option>)}</select></label>
     <label className="rt-check"><input type="checkbox" checked={draft.enabled} onChange={e=>patch({enabled:e.target.checked})}/><span>Active: shown to residents</span></label>
     <FormError>{formError}</FormError>
    </DialogBody>
    <DialogFoot><button type="button" className="button" disabled={working||uploading} onClick={()=>{setDraft(null);setFormError('');}}>Cancel</button><button className="button primary" disabled={busy||uploading||working}><Busy working={working||uploading} label={uploading?'Uploading…':'Publishing…'}>{draft.id?'Save banner':'Add banner'}</Busy></button></DialogFoot>
   </DialogForm>}
  </RecordDialog>

  {canDelete&&<ConfirmDelete open={!!toDelete} busy={working} error={dialogError} title={toDelete?`Delete “${toDelete.title}”?`:'Delete this banner?'} onCancel={()=>{setToDelete(null);setDialogError('');}} onConfirm={()=>{if(toDelete)void remove(toDelete);}}
   description={toDelete?`This banner is removed from the slider. ${list.length===1?'It is the last one, so the slider will be hidden from residents. ':''}To keep it but stop showing it, make it inactive instead.`:''}/>}
  {canDelete&&<ConfirmDialog open={restoring} busy={working} error={dialogError} title="Restore the supplied banners?" confirmLabel="Restore supplied banners" workingLabel="Restoring…" onCancel={()=>{setRestoring(false);setDialogError('');}} onConfirm={()=>void restore()}
   description="All the banners you published are deleted and residents see the supplied splash artwork and SAMADHAN community banner again. This cannot be undone."/>}
 </section>;
}
