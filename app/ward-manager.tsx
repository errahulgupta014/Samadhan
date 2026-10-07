'use client';
import {useState,type FormEvent} from 'react';
import {Plus} from 'lucide-react';
import {Table,TableBody,TableCaption,TableCell,TableHead,TableHeader,TableRow} from '@/components/ui/table';
import type {Ward} from '../shared/community';
import {uploadPhoto} from './use-workspace';
import {ConfirmDelete,FilterEmpty,FilterToolbar,distinctOptions,plainOptions,useIsSuperAdmin,useTableFilters,type FilterDef,type FilterSpec} from './form-bits';
import {Busy,DialogBody,DialogFoot,DialogForm,FormError,RecordDialog,RowActions,StatusChip,ViewFields} from './record-bits';
import './record-tables.css';

// Wards are what a resident picks at registration; the ward member's name and photo are shown in the resident app (docs/RESIDENT_AUTH_API.md).
/** A new ward starts empty; the city is pre-filled from the first existing ward (wards of one city share it) and can be changed. No ward or city is assumed. */
const blank=(city=''):Omit<Ward,'id'>&{id?:string}=>({number:'',name:'',nameHi:'',city,memberName:'',memberNameHi:'',memberPhotoId:'',active:true});
type Draft=ReturnType<typeof blank>;
const byNumber=(a:Ward,b:Ward)=>{const na=parseInt(a.number,10),nb=parseInt(b.number,10);return (Number.isNaN(na)?1e9:na)-(Number.isNaN(nb)?1e9:nb)||a.number.localeCompare(b.number)||a.name.localeCompare(b.name);};
const SPEC:FilterSpec<Ward>={
 search:w=>[w.number,w.name,w.nameHi,w.city,w.memberName,w.memberNameHi],
 selects:{status:w=>w.active?'Active':'Inactive',city:w=>w.city},
};
const photoUrl=(id:string)=>`/api/media?id=${encodeURIComponent(id)}`;

/**
 * Wards and ward members. Every row offers View, Edit, Active/Inactive (save-ward active flag) and Delete (delete-ward: a ward that residents belong to is made inactive instead);
 * adding, editing and viewing happen in a popup. Inactive wards are not offered at sign-up; residents already in them are not affected.
 */
export default function WardManager({wards,act,busy,canEdit=true}:{wards?:Ward[];act:(body:Record<string,unknown>)=>Promise<unknown>;busy:boolean;canEdit?:boolean}){
 const list=[...(wards??[])].sort(byNumber);
 const superAdmin=useIsSuperAdmin(),canDelete=canEdit&&superAdmin;// only a Super Admin may delete: nobody else gets a Delete button
 const [draft,setDraft]=useState<Draft|null>(null),[viewing,setViewing]=useState<string|null>(null),[toDelete,setToDelete]=useState<Ward|null>(null);
 const [uploading,setUploading]=useState(false),[working,setWorking]=useState(false),[error,setError]=useState(''),[formError,setFormError]=useState(''),[deleteError,setDeleteError]=useState(''),[notice,setNotice]=useState('');
 const f=useTableFilters(list,SPEC);
 const filters:FilterDef[]=[
  {key:'status',label:'Status',allLabel:'All statuses',options:plainOptions(['Active','Inactive'])},
  {key:'city',label:'City',allLabel:'All cities',options:distinctOptions(list,w=>w.city)},
 ];
 const viewed=viewing?list.find(w=>w.id===viewing)??null:null;
 const patch=(fields:Partial<Draft>)=>{setDraft(d=>d&&{...d,...fields});};
 const reset=()=>{setError('');setFormError('');setDeleteError('');setNotice('');};
 /** What the server would refuse for the form, in plain English, or ''. */
 const problem=(d:Draft)=>!d.number.trim()?'Enter the ward number.':d.name.trim().length<2?'Enter the ward name (at least 2 characters).':d.city.trim().length<2?'Enter the city (at least 2 characters).':'';
 async function save(e:FormEvent){
  e.preventDefault();if(!draft||working||uploading)return;setFormError('');setNotice('');
  const issue=problem(draft);if(issue){setFormError(issue);return;}
  const ward={...draft,number:draft.number.trim(),name:draft.name.trim(),nameHi:draft.nameHi.trim(),city:draft.city.trim(),memberName:draft.memberName.trim(),memberNameHi:draft.memberNameHi.trim()};
  setWorking(true);
  try{await act({action:'save-ward',ward});setNotice(`Saved ${ward.name}.`);setDraft(null);}catch(err){setFormError((err as Error).message);}
  finally{setWorking(false);}
 }
 async function toggle(w:Ward){
  reset();
  try{await act({action:'save-ward',ward:{...w,active:!w.active}});setNotice(w.active?`${w.name} is now inactive and no longer offered at sign-up. Residents already in it are not affected.`:`${w.name} is active and offered to residents at sign-up.`);}
  catch(err){setError((err as Error).message);}
 }
 async function remove(w:Ward){
  setWorking(true);setDeleteError('');
  try{const r=await act({action:'delete-ward',id:w.id}) as {deactivated?:boolean}|undefined;setNotice(r?.deactivated?`${w.name} has residents, so it was made inactive and is no longer offered at sign-up.`:`Removed ${w.name}.`);setToDelete(null);}
  catch(err){setDeleteError((err as Error).message);}
  finally{setWorking(false);}
 }
 return <section className="admin-section rt-page ward-manager">
  <div className="section-title"><div><div className="eyebrow">RESIDENT SIGN-UP</div><h2>Wards and ward members</h2><p>Residents choose their ward when they register in the app and cannot change it afterwards. Each ward shows its member’s name and photo to the residents who belong to it. Make a ward inactive to stop new registrations without affecting existing residents.</p></div>{canEdit&&<button type="button" className="button primary" disabled={busy} onClick={()=>{reset();setDraft(blank(list[0]?.city??''));}}><Plus size={15}/> Add ward</button>}</div>
  {notice&&<p role="status" className="branding-success">{notice}</p>}{error&&<p className="error" role="alert">{error}</p>}
  <FilterToolbar noun="wards" filters={filters} state={f.state} onChange={f.setState} total={list.length} filtered={f.rows.length} searchPlaceholder="Search by ward, city or ward member…"/>
  <div className="panel rt-panel">
   <Table className="rt-table rt-dense">
    <TableCaption className="sr-only">Wards and their ward members</TableCaption>
    <TableHeader><TableRow><TableHead>Ward</TableHead><TableHead className="rt-md">City</TableHead><TableHead className="rt-md">Ward member</TableHead><TableHead>Status</TableHead><TableHead className="rt-right">Actions</TableHead></TableRow></TableHeader>
    <TableBody>
     {f.rows.map(w=><TableRow key={w.id} className={w.active?undefined:'is-off'}>
      <TableCell><div className="rt-name">{w.memberPhotoId?<img className="rt-thumb round" src={photoUrl(w.memberPhotoId)} alt={w.memberName?`Photo of ${w.memberName}`:'Ward member photo'}/>:<span className="rt-thumb round" aria-hidden="true">{w.number}</span>}<span><b>{w.name}</b>{w.nameHi&&<span className="rt-sub">{w.nameHi}</span>}<span className="rt-sub">Ward {w.number}</span></span></div></TableCell>
      <TableCell className="rt-md">{w.city}</TableCell>
      <TableCell className="rt-md">{w.memberName?<>{w.memberName}{w.memberNameHi&&<span className="rt-sub">{w.memberNameHi}</span>}</>:<span className="rt-muted">Not set</span>}</TableCell>
      <TableCell className="rt-status"><StatusChip tone={w.active?'on':'off'}>{w.active?'Active':'Inactive'}</StatusChip>{!w.active&&<span className="rt-sub">Hidden from sign-up</span>}</TableCell>
      <TableCell className="rt-actions-cell"><RowActions name={w.name} busy={busy||working||uploading} onView={()=>{reset();setViewing(w.id);}}
       edit={canEdit?{onClick:()=>{reset();setDraft({...w});}}:undefined}
       toggle={canEdit?{on:w.active,onChange:()=>void toggle(w)}:undefined}
       del={canDelete?{onClick:()=>{reset();setToDelete(w);}}:undefined}/></TableCell>
     </TableRow>)}
    </TableBody>
   </Table>
   {!list.length&&<p className="rt-empty">No wards yet. Residents cannot register until you add and activate at least one ward.</p>}
   {!!list.length&&!f.rows.length&&<div className="rt-empty"><FilterEmpty onClear={f.clear}/></div>}
  </div>
  {canEdit&&<p className="rt-note">{canDelete?'Deleting a ward that residents belong to makes it inactive instead, so those residents keep their ward. ':''}An inactive ward is hidden from sign-up.</p>}

  <RecordDialog open={!!viewed} onClose={()=>setViewing(null)} wide title={viewed?.name??'Ward'} description="Ward details. Nothing here can be changed; use Edit for that.">
   {viewed&&<><DialogBody>
    {viewed.memberPhotoId&&<img className="rt-view-photo" style={{objectFit:'cover'}} src={photoUrl(viewed.memberPhotoId)} alt={viewed.memberName?`Photo of ${viewed.memberName}`:'Ward member photo'}/>}
    <ViewFields items={[
     {label:'Ward number',value:viewed.number},{label:'City',value:viewed.city},{label:'Ward name',value:viewed.name},{label:'Ward name (Hindi)',value:viewed.nameHi},
     {label:'Ward member',value:viewed.memberName},{label:'Ward member (Hindi)',value:viewed.memberNameHi},
     {label:'Member photo',value:viewed.memberPhotoId?'Added (shown to residents of this ward)':''},
     {label:'Status',value:<><StatusChip tone={viewed.active?'on':'off'}>{viewed.active?'Active':'Inactive'}</StatusChip><span className="rt-sub">{viewed.active?'Offered to residents at sign-up.':'Hidden from sign-up. Residents already in this ward are not affected.'}</span></>},
    ]}/>
   </DialogBody><DialogFoot><button type="button" className="button" onClick={()=>setViewing(null)}>Close</button></DialogFoot></>}
  </RecordDialog>

  <RecordDialog open={canEdit&&!!draft} onClose={()=>{setDraft(null);setFormError('');}} locked={working||uploading} wide title={draft?.id?'Edit ward':'New ward'} description="Residents see the ward name, and the ward member’s name and photo.">
   {canEdit&&draft&&<DialogForm onSubmit={e=>void save(e)} noValidate>
    <DialogBody>
     <div className="rt-two"><label className="rt-field">Ward number<input required maxLength={10} value={draft.number} placeholder="e.g. 7" onChange={e=>patch({number:e.target.value})}/></label><label className="rt-field">City<input required minLength={2} maxLength={80} value={draft.city} onChange={e=>patch({city:e.target.value})}/></label></div>
     <div className="rt-two"><label className="rt-field">Ward name (English)<input required minLength={2} maxLength={80} value={draft.name} placeholder="e.g. Ward 7" onChange={e=>patch({name:e.target.value})}/></label><label className="rt-field">Ward name (Hindi)<input maxLength={80} value={draft.nameHi} placeholder="e.g. वार्ड 7" onChange={e=>patch({nameHi:e.target.value})}/></label></div>
     <div className="rt-two"><label className="rt-field">Ward member name (English)<input maxLength={80} value={draft.memberName} onChange={e=>patch({memberName:e.target.value})}/></label><label className="rt-field">Ward member name (Hindi)<input maxLength={80} value={draft.memberNameHi} onChange={e=>patch({memberNameHi:e.target.value})}/></label></div>
     <div className="rt-photo-row">
      {draft.memberPhotoId?<img className="rt-thumb round" src={photoUrl(draft.memberPhotoId)} alt="Ward member preview"/>:<div className="rt-thumb round" aria-hidden="true"/>}
      <div><label className="rt-field" style={{margin:0}}>Ward member photo (JPG, PNG or WebP, up to 5 MB)<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy||uploading||working} onChange={async e=>{const input=e.target;const file=input.files?.[0];if(!file)return;setUploading(true);setFormError('');try{patch({memberPhotoId:await uploadPhoto(file)});}catch(err){setFormError((err as Error).message);}finally{setUploading(false);input.value='';}}}/></label>
       {draft.memberPhotoId&&<div style={{marginTop:8}}><button type="button" className="button" disabled={busy||uploading||working} onClick={()=>patch({memberPhotoId:''})}>Remove photo</button></div>}
       <p className="rt-hint">The ward member photo is public: anyone can see it, including before signing in.</p></div>
     </div>
     <label className="rt-check"><input type="checkbox" checked={draft.active} onChange={e=>patch({active:e.target.checked})}/><span>Active: offered to residents at sign-up</span></label>
     <FormError>{formError}</FormError>
    </DialogBody>
    <DialogFoot><button type="button" className="button" disabled={working||uploading} onClick={()=>{setDraft(null);setFormError('');}}>Cancel</button><button className="button primary" disabled={busy||uploading||working}><Busy working={working||uploading} label={uploading?'Uploading…':'Saving…'}>Save ward</Busy></button></DialogFoot>
   </DialogForm>}
  </RecordDialog>

  {canDelete&&<ConfirmDelete open={!!toDelete} busy={working} error={deleteError} title={toDelete?`Delete “${toDelete.name}”?`:'Delete this ward?'} onCancel={()=>{setToDelete(null);setDeleteError('');}} onConfirm={()=>{if(toDelete)void remove(toDelete);}}
   description={toDelete?`Ward ${toDelete.number} will be removed from the ward list. If residents belong to it, it is hidden from sign-up instead, so they keep their ward.`:''}/>}
 </section>;
}
