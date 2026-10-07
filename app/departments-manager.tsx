'use client';
import {useState,type FormEvent} from 'react';
import {Plus,Phone} from 'lucide-react';
import {Table,TableBody,TableCaption,TableCell,TableHead,TableHeader,TableRow} from '@/components/ui/table';
import type {Communication,Complaint,Department,Workspace} from '@/shared/domain';
import {MAX_DEPARTMENTS,departmentFor,departmentsOf,formatPhone,validateDepartments} from '@/lib/service';
import {ConfirmDelete,FilterEmpty,FilterToolbar,plainOptions,useIsSuperAdmin,useTableFilters,type FilterDef,type FilterSpec} from './form-bits';
import {Busy,DialogBody,DialogFoot,DialogForm,FormError,RecordDialog,RowActions,StatusChip,ViewFields,plural} from './record-bits';
import './record-tables.css';
import './departments.css';

type Act=(body:Record<string,unknown>)=>Promise<unknown>;
type Draft={id:string;name:string;nameHi:string;contactName:string;contactPhone:string;contactEmail:string;active:boolean};
const blank:Draft={id:'',name:'',nameHi:'',contactName:'',contactPhone:'',contactEmail:'',active:true};
const toDraft=(d:Department):Draft=>({id:d.id,name:d.name,nameHi:d.nameHi??'',contactName:d.contactName,contactPhone:d.contactPhone?formatPhone(d.contactPhone):'',contactEmail:d.contactEmail??'',active:d.active});
const DELIVERY_NOTE='Complaint updates for this department are recorded against this number.';
const OPEN_DONE=['Closed','Rejected / Duplicate'];
/** Same rules as the server (lib/service.ts validateDepartments) so mistakes show before sending; the server stays the authority and its message is shown when it disagrees. Returns '' when fine. */
function listProblem(list:Department[],saved:Department[],complaints:Complaint[]):string{
 try{validateDepartments(list,saved,complaints);return '';}
 catch(e){return e instanceof TypeError?'':(e as Error).message;} // a TypeError means this browser cannot generate ids (insecure page): let the server check instead
}

/**
 * Read-only line in the complaint detail: who receives updates for the department the complaint is assigned to.
 * Nothing is sent: no WhatsApp/SMS provider is connected, so updates are only recorded (see the communication log).
 */
export function DepartmentContactLine({complaint:c,departments,communications}:{complaint:Complaint;departments?:Department[];communications?:Communication[]}){
 if(!c.assignee)return <p className="muted dept-contact-line">Not assigned to a department yet. When you assign one, an update is recorded for its contact number.</p>;
 const d=departmentFor({departments},c);
 const recorded=(communications??[]).filter(m=>m.complaintId===c.id&&m.template==='Department update').length;
 if(!d)return <p className="muted dept-contact-line">“{c.assignee}” is no longer in the department list, so no contact is shown and no updates are recorded for this complaint.</p>;
 return <p className="muted dept-contact-line" data-testid="department-contact">
  <b>{d.name}{d.name!==c.assignee?` (listed on this complaint as “${c.assignee}”)`:''}{d.active?'':' · inactive'}</b><br/>
  {d.contactPhone?<>Primary contact: {d.contactName} · <span className="phone">{formatPhone(d.contactPhone)}</span><br/>{DELIVERY_NOTE}{communications?` ${recorded?`${plural(recorded,'update')} recorded for this complaint.`:'No updates recorded for this complaint yet.'}`:''}</>:<>No contact person or phone number is set for this department, so updates cannot be recorded. Add them under Departments.</>}
 </p>;
}

const FILTERS:FilterDef[]=[
 {key:'status',label:'Status',allLabel:'All statuses',options:plainOptions(['Active','Inactive'])},
 {key:'phone',label:'Phone for updates',allLabel:'Any phone status',options:plainOptions(['Has phone','No phone yet'])},
];
const SPEC:FilterSpec<Department>={
 search:d=>[d.name,d.nameHi,d.contactName,d.contactEmail,d.contactPhone,d.contactPhone?formatPhone(d.contactPhone):''],
 selects:{status:d=>d.active?'Active':'Inactive',phone:d=>d.contactPhone?'Has phone':'No phone yet'},
};

type Dialog={kind:'view'|'delete';id:string}|{kind:'edit'}|null;

/**
 * Departments: everyone who can read complaints sees each department's contact and workload; administrators with settings.manage also add, edit, make inactive and delete departments.
 * Every row offers View, Edit, Active/Inactive and Delete (people without settings.manage get View only); adding, editing and viewing happen in a popup.
 * Each department has a primary contact person and a phone number for complaint updates (recorded, not yet delivered: no WhatsApp/SMS provider is connected).
 * Renaming or deactivating a department never changes complaints already assigned to it: they keep the name they were given.
 */
export default function DepartmentsManager({data,act,busy}:{data:Workspace;act:Act;busy:boolean}){
 const canEdit=!!data.viewer?.permissions.includes('settings.manage'),superAdmin=useIsSuperAdmin(data),canDelete=canEdit&&superAdmin;// only a Super Admin may delete: nobody else gets a Delete button
 const saved=departmentsOf(data.settings);
 const complaints=data.complaints;
 const [draft,setDraft]=useState<Draft|null>(null),[dialog,setDialog]=useState<Dialog>(null),[formError,setFormError]=useState(''),[error,setError]=useState(''),[message,setMessage]=useState(''),[working,setWorking]=useState(false),[deleteError,setDeleteError]=useState('');
 const f=useTableFilters(saved,SPEC);
 const assignedTo=(d:Department)=>complaints.filter(c=>c.assignee&&departmentFor({departments:saved},c)?.id===d.id);
 const open=(c:Complaint[])=>c.filter(x=>!OPEN_DONE.includes(x.status)).length;
 const former=Array.from(new Set(complaints.filter(c=>c.assignee&&!departmentFor({departments:saved},c)).map(c=>c.assignee)));
 const activeCount=saved.filter(d=>d.active).length;
 const needsContact=saved.filter(d=>d.active&&!d.contactPhone);
 const reset=()=>{setError('');setFormError('');setMessage('');setDeleteError('');};
 const closeDialog=()=>{setDialog(null);setDraft(null);setFormError('');setDeleteError('');};
 /** Sends the whole list; returns true when saved. */
 async function save(list:Department[],done:string,report:(m:string)=>void=setError){
  const issue=listProblem(list,saved,complaints);if(issue){report(issue);return false;}
  try{await act({action:'save-departments',departments:list});setMessage(done);return true;}catch(e){report((e as Error).message);return false;}
 }
 async function submit(e:FormEvent){
  e.preventDefault();if(!draft||working)return;reset();
  const entry={id:draft.id||undefined,name:draft.name,nameHi:draft.nameHi,contactName:draft.contactName,contactPhone:draft.contactPhone,contactEmail:draft.contactEmail,active:draft.active} as unknown as Department;
  const list=draft.id?saved.map(d=>d.id===draft.id?entry:d):[...saved,entry];
  if(!draft.id&&saved.length>=MAX_DEPARTMENTS){setFormError(`You can have up to ${MAX_DEPARTMENTS} departments. ${canDelete?'Delete or reuse one first.':'Reuse an existing one instead.'}`);return;}
  setWorking(true);
  const ok=await save(list,draft.id?'Department saved.':'Department added.',setFormError);
  setWorking(false);
  if(ok)closeDialog();
 }
 function toggle(d:Department){
  reset();if(d.active&&activeCount<=1){setError('Keep at least one active department so complaints can still be assigned.');return;}
  void save(saved.map(x=>x.id===d.id?{...x,active:!d.active}:x),d.active?`“${d.name}” is now inactive. It cannot be assigned to new complaints; existing complaints keep it.`:`“${d.name}” is active again.`);
 }
 /** Delete = remove when nothing refers to the department; otherwise deactivate it (history must stay readable) and say why. */
 function remove(d:Department){
  reset();const used=assignedTo(d).length;
  if(d.active&&activeCount<=1){setError('Keep at least one active department so complaints can still be assigned.');return;}
  if(!used){setDialog({kind:'delete',id:d.id});return;}
  if(!d.active){setMessage(`“${d.name}” is already inactive. It stays in the list because ${plural(used,'complaint')} refer to it.`);return;}
  void save(saved.map(x=>x.id===d.id?{...x,active:false}:x),`“${d.name}” has ${plural(used,'complaint')} assigned, so it was made inactive instead of being deleted. It stays on those complaints but cannot be assigned to new ones.`);
 }
 async function confirmDelete(d:Department){
  setWorking(true);setDeleteError('');
  const ok=await save(saved.filter(x=>x.id!==d.id),`“${d.name}” was deleted.`,setDeleteError);
  setWorking(false);
  if(ok)closeDialog();
 }
 const viewing=dialog&&dialog.kind==='view'?saved.find(d=>d.id===dialog.id)??null:null;
 const deleting=dialog&&dialog.kind==='delete'?saved.find(d=>d.id===dialog.id)??null:null;
 return <section className="admin-section departments rt-page">
  <div className="section-title"><div><h2>Departments</h2><p>Each department has one primary contact person and the phone number on which its complaint updates will be sent.</p></div>{canEdit&&<button type="button" className="button primary" disabled={busy||saved.length>=MAX_DEPARTMENTS} onClick={()=>{reset();setDraft({...blank});setDialog({kind:'edit'});}}><Plus size={15}/> Add department</button>}</div>
  <div className="rt-strip" aria-label="Department summary"><span><b>{saved.length}</b> departments</span><span><b>{activeCount}</b> active</span><span><b>{open(complaints.filter(c=>c.assignee))}</b> open assignments</span></div>
  <p className="info-note" role="note"><Phone size={15} style={{display:'inline',verticalAlign:'-2px',marginRight:6}}/>{DELIVERY_NOTE} Each time a complaint is assigned to a department, or its status changes, an update is recorded for that number. Residents’ phone numbers and addresses are never included.</p>
  {canEdit&&needsContact.length>0&&<p className="info-note dept-warning" role="status">{needsContact.length===1?`“${needsContact[0].name}” has`:`${needsContact.length} active departments have`} no contact person or phone number yet, so no updates are recorded for {needsContact.length===1?'it':'them'}. Choose Edit to add {needsContact.length===1?'one':'them'}.</p>}
  {error&&<p role="alert" className="error">{error}</p>}{message&&<p role="status" className="info-note">{message}</p>}
  <FilterToolbar noun="departments" filters={FILTERS} state={f.state} onChange={f.setState} total={saved.length} filtered={f.rows.length} searchPlaceholder="Search by department, contact or phone…"/>
  <div className="panel rt-panel"><Table className="rt-table">
   <TableCaption className="sr-only">Departments, their contacts and workload</TableCaption>
   <TableHeader><TableRow><TableHead>Department</TableHead><TableHead className="rt-md">Primary contact</TableHead><TableHead className="rt-md">Phone for updates</TableHead><TableHead className="rt-lg">Workload</TableHead><TableHead>Status</TableHead><TableHead className="rt-right">Actions</TableHead></TableRow></TableHeader>
   <TableBody>
    {f.rows.map(d=>{const a=assignedTo(d),used=a.length;return <TableRow key={d.id} className={d.active?undefined:'is-off'}>
     <TableCell><b>{d.name}</b>{d.nameHi&&<span className="rt-sub">{d.nameHi}</span>}</TableCell>
     <TableCell className="rt-md">{d.contactName?<>{d.contactName}{d.contactEmail&&<span className="rt-sub">{d.contactEmail}</span>}</>:<span className="rt-muted">Not set yet</span>}</TableCell>
     <TableCell className="rt-md">{d.contactPhone?<span className="phone">{formatPhone(d.contactPhone)}</span>:<span className="rt-muted">Not set yet</span>}</TableCell>
     <TableCell className="rt-lg">{open(a)} open · {a.length-open(a)} closed</TableCell>
     <TableCell className="rt-status"><StatusChip tone={d.active?'on':'off'}>{d.active?'Active':'Inactive'}</StatusChip>{used>0&&<span className="rt-sub">{plural(used,'complaint')}</span>}</TableCell>
     <TableCell className="rt-actions-cell"><RowActions name={d.name} busy={busy||working} onView={()=>{reset();setDialog({kind:'view',id:d.id});}}
      edit={canEdit?{onClick:()=>{reset();setDraft(toDraft(d));setDialog({kind:'edit'});}}:undefined}
      toggle={canEdit?{on:d.active,onChange:()=>toggle(d)}:undefined}
      del={canDelete?{onClick:()=>remove(d)}:undefined}/></TableCell>
    </TableRow>;})}
   </TableBody></Table>
   {!saved.length&&<p className="rt-empty">No departments yet.{canEdit?' Choose Add department to create the first one.':''}</p>}
   {!!saved.length&&!f.rows.length&&<div className="rt-empty"><FilterEmpty onClear={f.clear}/></div>}
  </div>
  {former.length>0&&<p className="rt-note">Complaints are still assigned to {former.length===1?'a department':'departments'} no longer in this list: {former.map(name=>`${name} (${open(complaints.filter(c=>c.assignee===name))} open)`).join(', ')}. They keep the name they were given.</p>}
  {canEdit&&<p className="rt-note">Making a department inactive stops new assignments to it.{canDelete?' Deleting one that complaints refer to makes it inactive instead, so complaint history stays readable.':''} Renaming a department does not change the name on complaints already assigned to it.</p>}

  <RecordDialog open={dialog?.kind==='view'&&!!viewing} onClose={closeDialog} wide title={viewing?.name??'Department'} description="Department details. Nothing here can be changed; use Edit for that.">
   {viewing&&<><DialogBody><ViewFields items={[
    {label:'Department name',value:viewing.name},{label:'Name in Hindi',value:viewing.nameHi},
    {label:'Status',value:<StatusChip tone={viewing.active?'on':'off'}>{viewing.active?'Active':'Inactive'}</StatusChip>},
    {label:'Primary contact',value:viewing.contactName},{label:'Phone for updates',value:viewing.contactPhone?<span className="phone">{formatPhone(viewing.contactPhone)}</span>:''},{label:'Contact email',value:viewing.contactEmail},
    {label:'Complaints assigned',value:(()=>{const a=assignedTo(viewing);return `${open(a)} open · ${a.length-open(a)} closed`;})()},
    {label:'Updates',value:DELIVERY_NOTE},
   ]}/></DialogBody><DialogFoot><button type="button" className="button" onClick={closeDialog}>Close</button></DialogFoot></>}
  </RecordDialog>

  <RecordDialog open={canEdit&&dialog?.kind==='edit'&&!!draft} onClose={closeDialog} locked={working} wide title={draft?.id?'Edit department':'Add department'} description="The contact person and phone number receive the recorded complaint updates for this department.">
   {canEdit&&draft&&<DialogForm onSubmit={e=>void submit(e)} noValidate>
    <DialogBody>
     <label className="rt-field">Department name<input required maxLength={60} value={draft.name} autoComplete="off" onChange={e=>setDraft({...draft,name:e.target.value})}/></label>
     <label className="rt-field">Department name in Hindi (optional)<input maxLength={60} value={draft.nameHi} autoComplete="off" onChange={e=>setDraft({...draft,nameHi:e.target.value})}/></label>
     <label className="rt-field">Primary contact person<input required maxLength={80} value={draft.contactName} autoComplete="off" onChange={e=>setDraft({...draft,contactName:e.target.value})}/></label>
     <label className="rt-field">Phone number for updates<input required type="tel" inputMode="tel" maxLength={25} value={draft.contactPhone} autoComplete="off" placeholder="98765 43210" onChange={e=>setDraft({...draft,contactPhone:e.target.value})}/><small className="rt-hint">A 10-digit mobile number (+91 or 0 in front is fine) or a landline with its STD code. {DELIVERY_NOTE}</small></label>
     <label className="rt-field">Contact email (optional)<input type="email" maxLength={120} value={draft.contactEmail} autoComplete="off" onChange={e=>setDraft({...draft,contactEmail:e.target.value})}/></label>
     <label className="rt-check"><input type="checkbox" checked={draft.active} onChange={e=>setDraft({...draft,active:e.target.checked})}/><span>Active: complaints can be assigned to this department</span></label>
     <FormError>{formError}</FormError>
    </DialogBody>
    <DialogFoot><button type="button" className="button" onClick={closeDialog} disabled={working}>Cancel</button><button className="button primary" type="submit" disabled={busy||working}><Busy working={working} label="Saving…">{draft.id?'Save changes':'Add department'}</Busy></button></DialogFoot>
   </DialogForm>}
  </RecordDialog>

  {canDelete&&<ConfirmDelete open={!!deleting} busy={working} error={deleteError} title={deleting?`Delete “${deleting.name}”?`:'Delete this department?'} description={deleting?`This department will be removed from the list. No complaint is assigned to it. To keep it for reference but stop new assignments, make it inactive instead.`:''} onCancel={closeDialog} onConfirm={()=>{if(deleting)void confirmDelete(deleting);}}/>}
 </section>;
}
