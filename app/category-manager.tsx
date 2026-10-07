'use client';
import {useState,type FormEvent} from 'react';
import {Plus} from 'lucide-react';
import {categoryIcons,type Department,type IssueCategory} from '@/shared/domain';
import {Select,SelectTrigger,SelectValue,SelectContent,SelectItem} from '@/components/ui/select';
import {Switch} from '@/components/ui/switch';
import {Table,TableHeader,TableHead,TableRow,TableBody,TableCell,TableCaption} from '@/components/ui/table';
import {FilterEmpty,FilterToolbar,plainOptions,useIsSuperAdmin,useTableFilters,type FilterDef,type FilterSpec} from './form-bits';
import {Busy,DialogBody,DialogFoot,DialogForm,FormError,RecordDialog,RowActions,StatusChip,ViewFields} from './record-bits';
import './record-tables.css';

/**
 * Issue categories residents choose from when they report a problem.
 * Every row offers View, Edit, Active/Inactive (the enabled flag) and, for a Super Admin only, Delete. The server only turns categories off (there is no delete action),
 * so Delete stays in the row as unavailable and says why: past complaints keep their category. Nobody else gets a Delete button.
 * Each category belongs to a department: new complaints in it are assigned to that department automatically (the server checks the choice; a department's contact details are never shown here).
 */
type Props={categories:IssueCategory[];departments?:Department[];busy:boolean;act:(body:Record<string,unknown>)=>Promise<unknown>;canEdit?:boolean};
type Draft=Omit<IssueCategory,'id'>&{id?:string};
const NO_DELETE='Categories can be turned off but not deleted so past complaints keep their category.';
const NO_DEPARTMENT_NAME='Not set';
const NO_DEPARTMENT_FILTER='none';
const PICK_DEPARTMENT='Choose the department that handles this category.';
const iconName=(icon:string)=>icon.replaceAll('-',' ');
const byName=(a:Department,b:Department)=>a.name.localeCompare(b.name);
export default function CategoryManager({categories,departments,busy,act,canEdit=true}:Props){
 const superAdmin=useIsSuperAdmin(),canDelete=canEdit&&superAdmin;// only a Super Admin may delete: nobody else gets a Delete button
 const [draft,setDraft]=useState<Draft|null>(null),[viewing,setViewing]=useState<string|null>(null);
 const [error,setError]=useState(''),[formError,setFormError]=useState(''),[saved,setSaved]=useState(''),[working,setWorking]=useState(false);
 const sorted=[...categories].sort((a,b)=>a.sortOrder-b.sortOrder||a.nameEn.localeCompare(b.nameEn));
 const hasDepartments=departments!==undefined;
 const departmentOf=(c:IssueCategory)=>c.departmentId?departments?.find(d=>d.id===c.departmentId):undefined;
 const filters:FilterDef[]=[
  {key:'status',label:'Status',allLabel:'All statuses',options:plainOptions(['Active','Inactive'])},
  ...(departments?[{key:'department',label:'Department',allLabel:'All departments',options:[...[...departments].sort(byName).map(d=>({value:d.id,label:d.name+(d.active?'':' (inactive)')})),{value:NO_DEPARTMENT_FILTER,label:NO_DEPARTMENT_NAME}]} as FilterDef]:[]),
 ];
 const spec:FilterSpec<IssueCategory>={search:c=>[c.nameEn,c.nameHi,iconName(c.icon),String(c.sortOrder),departmentOf(c)?.name],selects:{status:c=>c.enabled?'Active':'Inactive',department:c=>departmentOf(c)?.id??NO_DEPARTMENT_FILTER}};
 const f=useTableFilters(sorted,spec);
 const viewed=viewing?categories.find(c=>c.id===viewing)??null:null;
 /** What can be chosen in the popup: the active departments, plus the category's current one even when it is inactive. */
 const choices=(current?:string)=>(departments??[]).filter(d=>d.active||d.id===current).sort(byName);
 const reset=()=>{setError('');setFormError('');setSaved('');};
 function edit(category?:IssueCategory){reset();setDraft(category?{...category,departmentId:departmentOf(category)?.id??''}:{nameEn:'',nameHi:'',icon:'ellipsis-horizontal',color:'#247a57',enabled:true,sortOrder:Math.max(-1,...categories.map(c=>c.sortOrder))+1,departmentId:''});}
 async function submit(e:FormEvent){
  e.preventDefault();if(!draft||working)return;setFormError('');
  if(hasDepartments&&!draft.departmentId&&choices(draft.departmentId).length){setFormError(PICK_DEPARTMENT);return;}
  const category:Draft={...draft};if(!category.departmentId)delete category.departmentId;
  setWorking(true);
  try{await act({action:'save-category',category});setDraft(null);setSaved('Category saved. Residents see it when they open or refresh the issue-type screen.');}
  catch(err){setFormError((err as Error).message);}
  finally{setWorking(false);}
 }
 async function toggle(c:IssueCategory){
  reset();
  const category:Partial<IssueCategory>&{enabled:boolean}={...c,enabled:!c.enabled};delete category.departmentId;// the department stays as it is: it is only sent when someone edits it
  try{await act({action:'save-category',category});setSaved(c.enabled?`“${c.nameEn}” is now inactive. Residents can no longer choose it for new reports; existing complaints keep it.`:`“${c.nameEn}” is active. Residents can choose it for new reports.`);}
  catch(err){setError((err as Error).message);}
 }
 const options=draft?choices(draft.departmentId):[];
 const noDepartment=!!draft&&hasDepartments&&!options.length;
 return <section className="admin-section category-manager rt-page">
  <div className="section-title"><div><h2>Issue categories · समस्या के प्रकार</h2><p>The mobile app loads these categories from the server. Changes do not require an app release.</p></div>{canEdit&&<button type="button" className="button primary" disabled={busy} onClick={()=>edit()}><Plus size={15}/> Add category</button>}</div>
  {error&&<p role="alert" className="error">{error}</p>}{saved&&<p className="info-note" role="status">{saved}</p>}
  <FilterToolbar noun="categories" filters={filters} state={f.state} onChange={f.setState} total={sorted.length} filtered={f.rows.length} searchPlaceholder="Search by name or department…"/>
  <div className="panel rt-panel">
   <Table className="rt-table rt-dense">
    <TableCaption className="sr-only">Issue categories in the order residents see them</TableCaption>
    <TableHeader><TableRow><TableHead className="rt-sm rt-num">Order</TableHead><TableHead>Category</TableHead><TableHead className="rt-md">Hindi</TableHead>{hasDepartments&&<TableHead className="rt-md">Department</TableHead>}<TableHead className="rt-lg">Icon</TableHead><TableHead>Status</TableHead><TableHead className="rt-right">Actions</TableHead></TableRow></TableHeader>
    <TableBody>
     {f.rows.map(c=>{const d=departmentOf(c);return <TableRow key={c.id} className={c.enabled?undefined:'is-off'}>
      <TableCell className="rt-sm rt-num">{c.sortOrder}</TableCell>
      <TableCell><b><span className="rt-dot" style={{background:c.color}} aria-hidden="true"/>{c.nameEn}</b><span className="rt-sub rt-hi-sub">{c.nameHi}</span>{hasDepartments&&<span className="rt-sub rt-hi-sub">Department: {d?d.name:NO_DEPARTMENT_NAME}</span>}</TableCell>
      <TableCell className="rt-md">{c.nameHi}</TableCell>
      {hasDepartments&&<TableCell className="rt-md">{d?<>{d.name}{!d.active&&<span className="rt-sub">Inactive department</span>}</>:<StatusChip tone="warn">{NO_DEPARTMENT_NAME}</StatusChip>}</TableCell>}
      <TableCell className="rt-lg">{iconName(c.icon)}</TableCell>
      <TableCell className="rt-status"><StatusChip tone={c.enabled?'on':'off'}>{c.enabled?'Active':'Inactive'}</StatusChip>{!c.enabled&&<span className="rt-sub">Hidden from new reports</span>}</TableCell>
      <TableCell className="rt-actions-cell"><RowActions name={c.nameEn} busy={busy||working} onView={()=>{reset();setViewing(c.id);}}
       edit={canEdit?{onClick:()=>edit(c)}:undefined}
       toggle={canEdit?{on:c.enabled,onChange:()=>void toggle(c)}:undefined}
       del={canDelete?{onClick:()=>{reset();setSaved(NO_DELETE);},unavailable:true,reason:NO_DELETE}:undefined}/></TableCell>
     </TableRow>;})}
    </TableBody>
   </Table>
   {!sorted.length&&<p className="rt-empty">No categories configured.{canEdit?' Add one to enable citizen reporting.':''}</p>}
   {!!sorted.length&&!f.rows.length&&<div className="rt-empty"><FilterEmpty onClear={f.clear}/></div>}
  </div>
  <p className="rt-note">{canDelete?`${NO_DELETE} `:''}Make a category inactive to stop new reports in it; existing complaints keep their original category and history.{hasDepartments?' New complaints in a category are assigned to its department automatically.':''}</p>

  <RecordDialog open={!!viewed} onClose={()=>setViewing(null)} title={viewed?.nameEn??'Category'} description="Category details. Nothing here can be changed; use Edit for that.">
   {viewed&&<><DialogBody><ViewFields items={[
    {label:'English name',value:viewed.nameEn},{label:'Hindi name',value:viewed.nameHi},{label:'Icon',value:iconName(viewed.icon)},
    {label:'Icon color',value:<><span className="rt-dot" style={{background:viewed.color}} aria-hidden="true"/>{viewed.color}</>},
    {label:'Display order',value:String(viewed.sortOrder)},
    ...(hasDepartments?[{label:'Department',value:departmentOf(viewed)?<>{departmentOf(viewed)!.name}{!departmentOf(viewed)!.active&&' (inactive)'}<span className="rt-sub">New complaints in this category are assigned to this department automatically.</span></>:<>{NO_DEPARTMENT_NAME}<span className="rt-sub">No department handles this category yet, so new complaints in it are not assigned automatically. Use Edit to choose one.</span></>}]:[]),
    {label:'Status',value:<><StatusChip tone={viewed.enabled?'on':'off'}>{viewed.enabled?'Active':'Inactive'}</StatusChip><span className="rt-sub">{viewed.enabled?'Residents can choose this category for new reports.':'Hidden from new reports. Existing complaints keep it.'}</span></>},
   ]}/></DialogBody><DialogFoot><button type="button" className="button" onClick={()=>setViewing(null)}>Close</button></DialogFoot></>}
  </RecordDialog>

  <RecordDialog open={canEdit&&!!draft} onClose={()=>setDraft(null)} locked={working} title={draft?.id?'Edit issue category':'Add issue category'} description="Configure the names, icon, display order, department and availability shown to residents.">
   {canEdit&&draft&&<DialogForm onSubmit={e=>void submit(e)}>
    <DialogBody>
     <label className="rt-field">English name<input required minLength={2} maxLength={80} value={draft.nameEn} onChange={e=>setDraft({...draft,nameEn:e.target.value})}/></label>
     <label className="rt-field">Hindi name<input required minLength={2} maxLength={80} value={draft.nameHi} onChange={e=>setDraft({...draft,nameHi:e.target.value})}/></label>
     {hasDepartments&&(noDepartment
      ?<div className="rt-field" role="note">Department that handles this category<p className="rt-hint">Add a department first (Administration → Departments).</p></div>
      :<label className="rt-field">Department that handles this category<select value={draft.departmentId??''} aria-invalid={!draft.departmentId&&!!formError&&formError===PICK_DEPARTMENT} onChange={e=>{setFormError('');setDraft({...draft,departmentId:e.target.value});}}>
        {!draft.departmentId&&<option value="">Choose a department</option>}
        {options.map(d=><option key={d.id} value={d.id}>{d.name}{d.active?'':' (inactive)'}</option>)}
       </select><small className="rt-hint">New complaints in this category are assigned to this department automatically.</small></label>)}
     <div className="rt-field">Icon<Select value={draft.icon} onValueChange={icon=>setDraft({...draft,icon})}><SelectTrigger aria-label="Category icon"><SelectValue/></SelectTrigger><SelectContent>{categoryIcons.map(icon=><SelectItem key={icon} value={icon}>{iconName(icon)}</SelectItem>)}</SelectContent></Select></div>
     <div className="rt-two"><label className="rt-field">Icon color<input type="color" aria-label="Icon color" value={draft.color} onChange={e=>setDraft({...draft,color:e.target.value})}/></label><label className="rt-field">Display order<input type="number" min={0} max={9999} required value={draft.sortOrder} onChange={e=>setDraft({...draft,sortOrder:Number(e.target.value)})}/></label></div>
     <label className="rt-check"><Switch checked={draft.enabled} onCheckedChange={enabled=>setDraft({...draft,enabled})}/><span>Active: available for new complaints</span></label>
     <FormError>{formError}</FormError>
    </DialogBody>
    <DialogFoot><button type="button" className="button" onClick={()=>setDraft(null)} disabled={working}>Cancel</button><button disabled={busy||working||(!draft.id&&noDepartment)} className="button primary"><Busy working={working} label="Saving…">Save category</Busy></button></DialogFoot>
   </DialogForm>}
  </RecordDialog>
 </section>;
}
