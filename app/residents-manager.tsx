'use client';
import {useEffect,useMemo,useRef,useState,type FormEvent} from 'react';
import {RefreshCw,UserRound} from 'lucide-react';
import {Table,TableBody,TableCaption,TableCell,TableHead,TableHeader,TableRow} from '@/components/ui/table';
import type {AdminResident,Ward} from '@/shared/community';
import type {Workspace} from '@/shared/domain';
import {compareWards} from '@/lib/wards';
import {wardLabelOf} from '@/lib/resident-profile';
import {ConfirmDelete,FilterEmpty,FilterToolbar,ShowMore,distinctOptions,plainOptions,useIsSuperAdmin,usePaged,useTableFilters,type FilterDef,type FilterSpec} from './form-bits';
import {Busy,ConfirmDialog,DialogBody,DialogFoot,DialogForm,FormError,RecordDialog,RowActions,StatusChip,ViewFields,dateOf,dateTimeOf,plural} from './record-bits';
import './record-tables.css';
import './residents-manager.css';

/**
 * The App users page (permission residents.manage): everyone registered in the mobile app, newest first, with search and an All / Active / Blocked filter.
 * Every row offers View, Edit, Active/Blocked and Delete; viewing and editing happen in a popup.
 * Admins correct a person's details (save-resident), block or unblock them (block-resident, blocking needs a reason) and delete them (delete-resident);
 * the mobile number is read-only because it is the login.
 * The server re-checks the permission and every rule; its plain-English message is what this page shows when it disagrees.
 */
type Act=(body:Record<string,unknown>)=>Promise<unknown>;
type Modal={kind:'view'|'edit'|'block'|'unblock'|'delete';id:string}|null;
type Call=(body:Record<string,unknown>)=>Promise<unknown>;
const PAGE=50;
const phone=(m:string)=>/^\d{10}$/.test(m)?`+91 ${m.slice(0,5)} ${m.slice(5)}`:m;
const initials=(name:string)=>name.split(/\s+/).filter(Boolean).slice(0,2).map(p=>p[0].toUpperCase()).join('')||'?';
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LANGUAGE={en:'English',hi:'हिन्दी (Hindi)'} as const;
const SPEC:FilterSpec<AdminResident>={
 search:r=>[r.name,r.email,r.wardLabel,r.address,r.mobile,phone(r.mobile)],
 selects:{status:r=>r.blocked?'Blocked':'Active',ward:r=>r.wardLabel,language:r=>LANGUAGE[r.language]??r.language,complaints:r=>r.complaintCount>0?'Has complaints':'No complaints'},
 ranges:{registered:r=>r.registeredAt},
};

export default function ResidentsManager({data,act,busy,refresh}:{data:Workspace;act:Act;busy:boolean;refresh?:()=>Promise<void>}){
 const residents=data.residents;
 const canManage=data.viewer?data.viewer.permissions.includes('residents.manage'):true;
 const superAdmin=useIsSuperAdmin(data),canDelete=canManage&&superAdmin;// only a Super Admin may delete: nobody else gets a Delete button
 const [modal,setModal]=useState<Modal>(null),[notice,setNotice]=useState(''),[error,setError]=useState(''),[refreshing,setRefreshing]=useState(false),[gone,setGone]=useState<string[]>([]);
 const actRef=useRef(act);
 useEffect(()=>{actRef.current=act;});
 async function reload(){if(!refresh)return;setRefreshing(true);try{await refresh();}finally{setRefreshing(false);}}
 // New people register while the portal is open: look again whenever this page opens.
 // (the portal's refresh updates its own state after the fetch, so nothing is set synchronously here)
 // eslint-disable-next-line react-hooks/exhaustive-deps
 useEffect(()=>{void refresh?.();},[]);
 /** One workspace version covers everything, so an unrelated change (a resident opening the app) can make a save arrive stale. The portal has refreshed by then: try once more. */
 const call:Call=async body=>{
  try{return await actRef.current(body);}
  catch(e){
   if(/changed in another window|saved first/i.test((e as Error).message)){await new Promise(r=>setTimeout(r,400));return await actRef.current(body);}
   throw e;
  }
 };
 const all=useMemo(()=>(residents??[]).filter(r=>!gone.includes(r.id)),[residents,gone]);
 const counts=useMemo(()=>({all:all.length,blocked:all.filter(r=>r.blocked).length}),[all]);
 const f=useTableFilters(all,SPEC);
 const paged=usePaged(f.rows,f.key,PAGE);
 const filters=useMemo<FilterDef[]>(()=>[
  {key:'status',label:'Status',allLabel:'All statuses',options:plainOptions(['Active','Blocked'])},
  {key:'ward',label:'Ward',allLabel:'All wards',options:distinctOptions(all,r=>r.wardLabel)},
  {key:'language',label:'App language',allLabel:'Any language',options:plainOptions([LANGUAGE.en,LANGUAGE.hi])},
  {type:'dateRange',key:'registered',label:'Registered between'},
  {key:'complaints',label:'Complaints',allLabel:'Any number',options:plainOptions(['Has complaints','No complaints'])},
 ],[all]);
 const selected=modal&&all.find(r=>r.id===modal.id)||null;
 const close=()=>setModal(null);
 const open=(kind:'view'|'edit'|'block'|'unblock'|'delete',r:AdminResident)=>{setNotice('');setError('');setModal({kind,id:r.id});};
 return <section className="admin-section res-page rt-page">
  <div className="section-title"><div><h2>App users</h2><p>Everyone who has registered in the mobile app. View or correct their details, block someone who should no longer use the app, or delete a user. A blocked person is signed out, gets no notifications and cannot sign in until you unblock them; their complaints stay with the ward office.</p></div><button type="button" className="button res-refresh" onClick={()=>void reload()} disabled={refreshing||!refresh}><RefreshCw size={15} className={refreshing?'spin':undefined}/> {refreshing?'Refreshing…':'Refresh'}</button></div>
  {error&&<p className="error" role="alert">{error}</p>}
  {notice&&<p className="created-note" role="status">{notice}</p>}
  {!residents?<p className="empty-state" role="status">Loading app users…</p>:<>
   <div className="res-summary" aria-label="Summary"><div className="res-stat"><b>{counts.all}</b>registered</div><div className="res-stat"><b>{counts.all-counts.blocked}</b>active</div><div className="res-stat blocked"><b>{counts.blocked}</b>blocked</div></div>
   <FilterToolbar noun="app users" filters={filters} state={f.state} onChange={f.setState} total={all.length} filtered={f.rows.length} shown={paged.shown} searchPlaceholder="Search by name, mobile, ward or email…"/>
   <div className="panel rt-panel">
    <Table className="rt-table rt-dense">
     <TableCaption className="sr-only">App users, newest first</TableCaption>
     <TableHeader><TableRow><TableHead>User</TableHead><TableHead className="rt-md">Mobile</TableHead><TableHead className="rt-md">Ward</TableHead><TableHead className="rt-lg">Registered</TableHead><TableHead className="rt-lg rt-num">Complaints</TableHead><TableHead>Status</TableHead><TableHead className="rt-right">Actions</TableHead></TableRow></TableHeader>
     <TableBody>
      {paged.rows.map(r=><TableRow key={r.id} className={r.blocked?'is-bad':undefined}>
       <TableCell><div className="rt-name"><span className="rt-thumb round" aria-hidden="true" style={r.blocked?{background:'#fde8e5',color:'#b42318'}:{background:'#e6f2ec',color:'#086347'}}>{initials(r.name)}</span><span><b>{r.name}</b><span className="rt-sub">{r.email||'No email'}</span>{r.blocked&&r.blockedReason&&<span className="rt-sub bad">Reason: {r.blockedReason}</span>}</span></div></TableCell>
       <TableCell className="rt-md" style={{whiteSpace:'nowrap'}}>{phone(r.mobile)}</TableCell>
       <TableCell className="rt-md">{r.wardLabel||'—'}</TableCell>
       <TableCell className="rt-lg" style={{whiteSpace:'nowrap'}}>{dateOf(r.registeredAt)||'—'}</TableCell>
       <TableCell className="rt-lg rt-num">{r.complaintCount}</TableCell>
       <TableCell className="rt-status"><StatusChip tone={r.blocked?'bad':'on'}>{r.blocked?'Blocked':'Active'}</StatusChip></TableCell>
       <TableCell className="rt-actions-cell"><RowActions name={r.name} busy={busy} onView={()=>open('view',r)}
        edit={canManage?{onClick:()=>open('edit',r)}:undefined}
        toggle={canManage?{on:!r.blocked,onLabel:'Active',offLabel:'Blocked',onChange:()=>open(r.blocked?'unblock':'block',r)}:undefined}
        del={canDelete?{onClick:()=>open('delete',r)}:undefined}/></TableCell>
      </TableRow>)}
     </TableBody>
    </Table>
    {!counts.all&&<p className="rt-empty">No one has registered in the mobile app yet. People appear here after they sign up with their mobile number.</p>}
    {!!counts.all&&!f.rows.length&&<div className="rt-empty"><FilterEmpty onClear={f.clear}/></div>}
    <ShowMore remaining={paged.remaining} size={paged.size} onMore={paged.more}/>
   </div>
   {canManage&&<p className="rt-note">Active / Blocked: turning the switch to Blocked asks for a reason and signs the person out; turning it back on lets them sign in again.{canDelete?' Delete removes the person completely, so block someone instead when you may need their record again.':''}</p>}
  </>}
  {modal?.kind==='view'&&selected&&<ViewDialog key={selected.id} resident={selected} onClose={close}/>}
  {canManage&&modal?.kind==='edit'&&selected&&<EditDialog key={selected.id} resident={selected} wards={data.wards??[]} call={call} onClose={close} onSaved={name=>{close();setNotice(`Saved the details of ${name}.`);}}/>}
  {canManage&&modal?.kind==='block'&&selected&&<BlockDialog key={selected.id} resident={selected} call={call} onClose={close} onBlocked={name=>{close();setNotice(`${name} is now blocked. They are signed out, will not receive notifications and cannot sign in until you unblock them. Their complaints stay visible to the ward office.`);}}/>}
  {canManage&&modal?.kind==='unblock'&&selected&&<UnblockDialog key={selected.id} resident={selected} call={call} onClose={close} onUnblocked={name=>{close();setNotice(`${name} is unblocked. They can sign in to the app again with an OTP sent to their mobile number.`);}}/>}
  {canDelete&&modal?.kind==='delete'&&selected&&<DeleteDialog key={selected.id} resident={selected} call={call} onClose={close} onDeleted={r=>{close();setGone(g=>[...g,r.id]);setNotice(`${r.name} was deleted. Their complaints stay in the system under the name Former resident.`);void refresh?.();}}/>}
 </section>;
}

function Photo({resident,className}:{resident:AdminResident;className:string}){
 const [failed,setFailed]=useState(false);
 return <div className={className}>{resident.photoId&&!failed?<img src={`/api/media?id=${encodeURIComponent(resident.photoId)}`} alt={`Photo of ${resident.name}`} onError={()=>setFailed(true)}/>:<UserRound size={34} aria-label="No photo"/>}</div>;
}

/** Read-only popup: every field of the app user, no inputs. */
function ViewDialog({resident:r,onClose}:{resident:AdminResident;onClose:()=>void}){
 return <RecordDialog open onClose={onClose} wide title={r.name} description="App user details. Nothing here can be changed; use Edit for that.">
  <DialogBody>
   <Photo resident={r} className="rt-view-photo"/>
   <ViewFields items={[
    {label:'Name',value:r.name},{label:'Mobile number',value:phone(r.mobile)},{label:'Email',value:r.email},{label:'Address',value:r.address},
    {label:'Ward',value:r.wardLabel},{label:'App language',value:LANGUAGE[r.language]??r.language},
    {label:'Ad notifications',value:r.classifiedNotifications?'On':'Off'},{label:'Activity notifications',value:r.activityNotifications?'On':'Off'},
    {label:'Status',value:<StatusChip tone={r.blocked?'bad':'on'}>{r.blocked?'Blocked':'Active'}</StatusChip>},
    ...(r.blocked?[{label:'Blocked on',value:dateTimeOf(r.blockedAt)},{label:'Reason for blocking',value:r.blockedReason||'No reason was recorded.'}]:[]),
    {label:'Registered',value:dateTimeOf(r.registeredAt)},{label:'Complaints',value:String(r.complaintCount)},
   ]}/>
  </DialogBody>
  <DialogFoot><button type="button" className="button" onClick={onClose}>Close</button></DialogFoot>
 </RecordDialog>;
}

function EditDialog({resident,wards,call,onClose,onSaved}:{resident:AdminResident;wards:Ward[];call:Call;onClose:()=>void;onSaved:(name:string)=>void}){
 const [f,setF]=useState({name:resident.name,email:resident.email,address:resident.address,wardId:resident.wardId,language:resident.language,classified:resident.classifiedNotifications,activity:resident.activityNotifications});
 const [working,setWorking]=useState(false),[error,setError]=useState('');
 const options=useMemo(()=>{
  const active=wards.filter(w=>w.active).sort(compareWards),current=wards.find(w=>w.id===resident.wardId);
  const all=current&&!current.active?[current,...active]:active;
  return all.length?all.map(w=>({id:w.id,label:wardLabelOf(w)+(w.active?'':' (inactive)')})):[{id:resident.wardId,label:resident.wardLabel||'Current ward'}];
 },[wards,resident.wardId,resident.wardLabel]);
 const dirty=f.name!==resident.name||f.email!==resident.email||f.address!==resident.address||f.wardId!==resident.wardId||f.language!==resident.language||f.classified!==resident.classifiedNotifications||f.activity!==resident.activityNotifications;
 /** Mirrors the server rules that can be checked before sending; the server stays the authority. */
 function problem(){
  const name=f.name.trim(),email=f.email.trim(),address=f.address.trim();
  if(name.length<2||name.length>80)return 'Name must be 2 to 80 characters.';
  if(email&&(email.length>150||!EMAIL.test(email)))return 'Enter a valid email address, or leave the email empty.';
  if(address.length<5||address.length>300)return 'Address must be 5 to 300 characters.';
  if(!f.wardId)return 'Choose a ward.';
  return '';
 }
 async function submit(event:FormEvent){
  event.preventDefault();if(working||!dirty)return;
  const issue=problem();if(issue){setError(issue);return;}
  setWorking(true);setError('');
  try{await call({action:'save-resident',id:resident.id,name:f.name.trim(),email:f.email.trim(),address:f.address.trim(),wardId:f.wardId,language:f.language,classifiedNotifications:f.classified,activityNotifications:f.activity});onSaved(f.name.trim());}
  catch(e){setError((e as Error).message);setWorking(false);}
 }
 return <RecordDialog open onClose={onClose} locked={working} wide title={`Edit ${resident.name}`} description="Changes apply to the app straight away; the person can still change their photo and notification choices in the app.">
  <DialogForm onSubmit={e=>void submit(e)}>
   <DialogBody>
    <div className="res-profile">
     <Photo resident={resident} className="res-photo"/>
     <dl className="res-facts"><dt>Status</dt><dd><StatusChip tone={resident.blocked?'bad':'on'}>{resident.blocked?'Blocked':'Active'}</StatusChip></dd><dt>Registered</dt><dd>{dateTimeOf(resident.registeredAt)||'—'}</dd><dt>Complaints</dt><dd>{resident.complaintCount}</dd></dl>
    </div>
    {resident.blocked&&<p className="rt-callout bad" role="note"><b>Blocked {resident.blockedAt?`on ${dateTimeOf(resident.blockedAt)}`:''}.</b> {resident.blockedReason?`Reason: ${resident.blockedReason}`:'No reason was recorded.'} Use the Active / Blocked switch in the table to unblock.</p>}
    <div className="rt-field"><label htmlFor="res-mobile">Mobile number</label><input id="res-mobile" type="text" value={phone(resident.mobile)} readOnly disabled/><small className="rt-hint">This is how the person signs in to the app, so it cannot be changed here.</small></div>
    <div className="rt-field"><label htmlFor="res-name">Name</label><input id="res-name" type="text" value={f.name} onChange={e=>setF({...f,name:e.target.value})} maxLength={80} required autoComplete="off"/><small className="rt-hint">Open complaints show the new name. Closed ones keep the name they were filed under.</small></div>
    <div className="rt-field"><label htmlFor="res-email">Email (optional)</label><input id="res-email" type="email" value={f.email} onChange={e=>setF({...f,email:e.target.value})} maxLength={150} autoComplete="off"/></div>
    <div className="rt-field"><label htmlFor="res-address">Address</label><textarea id="res-address" value={f.address} onChange={e=>setF({...f,address:e.target.value})} maxLength={300} required/></div>
    <div className="rt-two"><div className="rt-field"><label htmlFor="res-ward">Ward</label><select id="res-ward" value={f.wardId} onChange={e=>setF({...f,wardId:e.target.value})}>{options.map(o=><option key={o.id} value={o.id}>{o.label}</option>)}</select></div>
     <div className="rt-field"><label htmlFor="res-language">App language</label><select id="res-language" value={f.language} onChange={e=>setF({...f,language:e.target.value as 'en'|'hi'})}><option value="en">English</option><option value="hi">हिन्दी (Hindi)</option></select></div></div>
    <label className="rt-check"><input type="checkbox" checked={f.classified} onChange={e=>setF({...f,classified:e.target.checked})}/><span>Send notifications about new ads</span></label>
    <label className="rt-check"><input type="checkbox" checked={f.activity} onChange={e=>setF({...f,activity:e.target.checked})}/><span>Send notifications about new activities</span></label>
    <FormError>{error}</FormError>
   </DialogBody>
   <DialogFoot><button className="button" type="button" onClick={onClose} disabled={working}>Cancel</button><button className="button primary" type="submit" disabled={working||!dirty}><Busy working={working} label="Saving…">Save changes</Busy></button></DialogFoot>
  </DialogForm>
 </RecordDialog>;
}

function BlockDialog({resident,call,onClose,onBlocked}:{resident:AdminResident;call:Call;onClose:()=>void;onBlocked:(name:string)=>void}){
 const [reason,setReason]=useState(''),[working,setWorking]=useState(false),[error,setError]=useState('');
 async function submit(event:FormEvent){
  event.preventDefault();if(working)return;
  const text=reason.replace(/\s+/g,' ').trim();
  if(!text){setError('Enter a reason for blocking this user.');return;}
  if(text.length>200){setError('The reason can be at most 200 characters.');return;}
  setWorking(true);setError('');
  try{await call({action:'block-resident',id:resident.id,blocked:true,reason:text});onBlocked(resident.name);}
  catch(e){setError((e as Error).message);setWorking(false);}
 }
 return <RecordDialog open onClose={onClose} locked={working} title={`Block ${resident.name}?`} description="They are signed out of the app and cannot use it or sign in again until you unblock them. They stop receiving notifications. Their complaints stay visible to you and you can keep working on them.">
  <DialogForm onSubmit={e=>void submit(e)}>
   <DialogBody>
    <div className="rt-field"><label htmlFor="res-reason">Reason for blocking (required)</label><textarea id="res-reason" value={reason} onChange={e=>setReason(e.target.value)} maxLength={200} required autoFocus/><small className="rt-hint" style={{alignSelf:'flex-end'}}>{reason.length}/200 · Kept in the audit log; the person does not see it.</small></div>
    <FormError>{error}</FormError>
   </DialogBody>
   <DialogFoot><button className="button" type="button" onClick={onClose} disabled={working}>Cancel</button><button className="button primary rt-danger" type="submit" disabled={working}><Busy working={working} label="Blocking…">Block user</Busy></button></DialogFoot>
  </DialogForm>
 </RecordDialog>;
}

function UnblockDialog({resident,call,onClose,onUnblocked}:{resident:AdminResident;call:Call;onClose:()=>void;onUnblocked:(name:string)=>void}){
 const [working,setWorking]=useState(false),[error,setError]=useState('');
 async function confirm(){
  if(working)return;setWorking(true);setError('');
  try{await call({action:'block-resident',id:resident.id,blocked:false});onUnblocked(resident.name);}
  catch(e){setError((e as Error).message);setWorking(false);}
 }
 return <ConfirmDialog open tone="primary" busy={working} error={error} title={`Unblock ${resident.name}?`} confirmLabel="Unblock user" workingLabel="Unblocking…" onConfirm={()=>void confirm()} onCancel={onClose}
  description={`They will be able to sign in to the app again with an OTP sent to their mobile number, and will receive notifications again.${resident.blockedReason?` Blocked for: ${resident.blockedReason}`:''}`}/>;
}

/** Delete calls delete-resident {id} (permission residents.manage); the server answers {id, deleted:true}. */
function DeleteDialog({resident,call,onClose,onDeleted}:{resident:AdminResident;call:Call;onClose:()=>void;onDeleted:(r:AdminResident)=>void}){
 const [working,setWorking]=useState(false),[error,setError]=useState('');
 async function confirm(){
  if(working)return;setWorking(true);setError('');
  try{await call({action:'delete-resident',id:resident.id});onDeleted(resident);}
  catch(e){setError((e as Error).message);setWorking(false);}
 }
 return <ConfirmDelete open busy={working} error={error} title={`Delete “${resident.name}”?`} onConfirm={()=>void confirm()} onCancel={onClose}
  description="This permanently removes the user’s profile, login sessions, notifications and push registrations. Their complaints stay in the system under the name Former resident with the phone number masked. The person can register again later.">
  {resident.complaintCount>0&&<p className="ct-callout">{resident.name} has {plural(resident.complaintCount,'complaint')}. They stay with the ward office.</p>}
 </ConfirmDelete>;
}
