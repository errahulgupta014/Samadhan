'use client';
import {useCallback,useEffect,useState,type FormEvent,type ReactNode} from 'react';
import {UserPlus,Eye,EyeOff,WandSparkles,KeyRound,RotateCcw} from 'lucide-react';
import {Table,TableBody,TableCaption,TableCell,TableHead,TableHeader,TableRow} from '@/components/ui/table';
import {rolePresets,type AdminRole,type Permission} from '@/shared/access';
import type {AdminUserView} from '@/lib/admin-policy';
import {defaultForm,formForUser,payload,pickRole,problem,toggle,type PermissionForm} from '@/lib/admin-permission-form';
import {adminCall,useAdminSession} from './admin-login';
import {ConfirmDelete,FilterEmpty,FilterToolbar,plainOptions,useIsSuperAdmin,useTableFilters,type FilterDef,type FilterSpec} from './form-bits';
import {Busy,ConfirmDialog,DialogBody,DialogFoot,DialogForm,FormError,RecordDialog,RowActions,StatusChip,ViewFields,dateTimeOf} from './record-bits';
import './record-tables.css';

/**
 * The Admin Users page: portal accounts and what each may do (POST /api/admin-auth list-users / create-user / update-user / reset-password / delete-user).
 * Every row offers View, Edit, Active/Inactive and Delete; adding, viewing and editing happen in a popup. Reset password lives in the Edit popup.
 * Only a Super Admin gets here (permission admins.manage); the server re-checks every call.
 */
export const PERMISSION_TEXT:Record<Permission,{label:string;help:string}>={
 'complaints.read':{label:'See complaints',help:'Open complaints, resident names and phone numbers, and the reports.'},
 'complaints.manage':{label:'Handle complaints',help:'Assign teams, change status and add updates for residents. Needs “See complaints”.'},
 'categories.manage':{label:'Manage complaint categories',help:'Add, rename, hide and reorder the issue categories residents choose from.'},
 'announcements.manage':{label:'Publish ward announcements',help:'Write, edit, archive and delete the notices residents see.'},
 'classifieds.manage':{label:'Manage classified ads',help:'Create, edit, publish and remove community ads.'},
 'activities.manage':{label:'Manage activities',help:'Create, edit, publish and remove events and activities.'},
 'residents.manage':{label:'Manage app users',help:'See everyone registered in the mobile app, correct their details and block or unblock them.'},
 'appconfig.manage':{label:'Edit app settings',help:'Support contact details, visible tabs, maintenance notice and minimum app version.'},
 'city.manage':{label:'Manage city information and places',help:'The municipality profile and the places to visit.'},
 'communications.read':{label:'See the communication log',help:'Messages and notifications sent to residents.'},
 'audit.read':{label:'See the audit log',help:'Who changed what, including sign-ins and user changes.'},
 'settings.manage':{label:'Ward settings, teams and banners',help:'Ward details, teams, banners, ward members and pairing the mobile test app.'},
 'admins.manage':{label:'Manage admin users',help:'Create admin users and decide what they can do. Only a Super Admin can have this.'},
};
const GROUPS:{title:string;items:Permission[]}[]=[
 {title:'Complaints',items:['complaints.read','complaints.manage','categories.manage']},
 {title:'Content for residents',items:['announcements.manage','classifieds.manage','activities.manage','city.manage']},
 {title:'App users',items:['residents.manage']},
 {title:'App and ward settings',items:['appconfig.manage','settings.manage']},
 {title:'Administration',items:['admins.manage']},
];
const ROLE_HELP:Record<AdminRole,string>={
 'Super Admin':'Everything, including creating and managing admin users.',
 'Ward Admin':'Everything except managing admin users.',
 'Complaint Officer':'Reads and handles complaints and sees the communication log.',
 'Content Editor':'Publishes announcements, ads, activities, city information and app settings.',
 'Auditor':'Read-only access to complaints, the communication log and the audit log.',
 'Custom':'Choose exactly what this person can do.',
};
const ADMINS_ONLY_SUPER='Only the Super Admin role can manage administrators.';
const LAST_SUPER='The last active Super Admin cannot be deleted, made inactive or downgraded.';
// The log pages were removed from the portal, so the log-only Auditor preset is no longer offered for new admin users.
const ROLES:AdminRole[]=(Object.keys(rolePresets) as AdminRole[]).filter(r=>r!=='Auditor');
const ALPHABET={upper:'ABCDEFGHJKLMNPQRSTUVWXYZ',lower:'abcdefghijkmnopqrstuvwxyz',digit:'23456789'};
function randomIndex(max:number){const buffer=new Uint32Array(1);crypto.getRandomValues(buffer);return buffer[0]%max;}
/** 14 easy-to-read characters with upper case, lower case and digits. */
function generatePassword(){
 const all=ALPHABET.upper+ALPHABET.lower+ALPHABET.digit;
 const chars=[ALPHABET.upper,ALPHABET.lower,ALPHABET.digit].map(set=>set[randomIndex(set.length)]);
 while(chars.length<14)chars.push(all[randomIndex(all.length)]);
 for(let i=chars.length-1;i>0;i--){const j=randomIndex(i+1);[chars[i],chars[j]]=[chars[j],chars[i]];}
 return chars.join('');
}
const when=(iso:string|null)=>dateTimeOf(iso)||'Never';

/** Where an account's last sign-in falls: never, within the last 30 days, or longer ago. */
const DAY_MS=86400000;
function signInBucket(iso:string|null):string{
 const at=+new Date(iso??'');
 if(!Number.isFinite(at))return 'Never signed in';
 return Date.now()-at<=30*DAY_MS?'Last 30 days':'Longer ago';
}
const FILTERS:FilterDef[]=[
 {key:'role',label:'Role',allLabel:'All roles',options:plainOptions(Object.keys(rolePresets))},
 {key:'status',label:'Status',allLabel:'All statuses',options:plainOptions(['Active','Inactive'])},
 {key:'signin',label:'Last sign-in',allLabel:'Any time',options:plainOptions(['Never signed in','Last 30 days','Longer ago'])},
];
const SPEC:FilterSpec<AdminUserView>={
 search:u=>[u.name,u.username,u.email,u.role],
 selects:{role:u=>u.role,status:u=>u.active?'Active':'Inactive',signin:u=>signInBucket(u.lastLoginAt)},
};

type Modal={kind:'create'}|{kind:'view'|'edit'|'reset'|'toggle'|'delete';user:AdminUserView}|null;

export default function AdminUsersManager(){
 const session=useAdminSession();
 const canDelete=useIsSuperAdmin();// only a Super Admin may delete: nobody else gets a Delete button
 const [users,setUsers]=useState<AdminUserView[]|null>(null);const [error,setError]=useState('');const [modal,setModal]=useState<Modal>(null);
 const [notice,setNotice]=useState<ReactNode>(null);
 const [version,setVersion]=useState(0);
 /** Ask the server for the list again (after a change). */
 const load=useCallback(()=>setVersion(v=>v+1),[]);
 useEffect(()=>{
  let live=true;
  adminCall<{users:AdminUserView[]}>({action:'list-users'})
   .then(result=>{if(live){setUsers(result.users);setError('');}})
   .catch(e=>{if(live){setError((e as Error).message);setUsers(current=>current??[]);}});
  return()=>{live=false;};
 },[version]);
 const f=useTableFilters(users??[],SPEC);
 const me=session?.user.id;
 const close=()=>setModal(null);
 const open=(next:Modal)=>{setNotice(null);setModal(next);};
 function done(message:ReactNode){close();setNotice(message);load();}
 const lastSuper=(user:AdminUserView)=>user.role==='Super Admin'&&user.active&&(users??[]).filter(u=>u.role==='Super Admin'&&u.active).length<=1;
 return <section className="admin-section users-page rt-page">
  <div className="section-title"><div><h2>Admin Users</h2><p>People who can sign in to this portal, and exactly what each may do. Use Edit to change access or reset a password.</p></div><button type="button" className="button primary" onClick={()=>open({kind:'create'})}><UserPlus size={16}/> Add admin user</button></div>
  {error&&<p className="error" role="alert">{error}</p>}
  {notice&&<p className="created-note" role="status">{notice}</p>}
  <FilterToolbar noun="admin users" filters={FILTERS} state={f.state} onChange={f.setState} total={users?.length??0} filtered={f.rows.length} searchPlaceholder="Search by name, username or email…"/>
  <div className="panel rt-panel">
   {users===null?<p className="empty-state" role="status">Loading admin users…</p>:<Table className="rt-table rt-dense">
    <TableCaption className="sr-only">Admin users and what each may do</TableCaption>
    <TableHeader><TableRow><TableHead>Admin user</TableHead><TableHead className="rt-md">Role</TableHead><TableHead>Status</TableHead><TableHead className="rt-lg">Last sign-in</TableHead><TableHead className="rt-right">Actions</TableHead></TableRow></TableHeader>
    <TableBody>
     {f.rows.map(user=>{
      const own=user.id===me,last=lastSuper(user);
      return <TableRow key={user.id} className={user.active?undefined:'is-off'}>
       <TableCell><div className="rt-name"><span><b>{user.name}{own&&<> <StatusChip tone="info">You</StatusChip></>}</b><span className="rt-sub">{user.username}{user.email?` · ${user.email}`:''}</span>{(user.isDefaultPassword||user.mustChangePassword)&&<span className="rt-chips" style={{marginTop:4}}>{user.isDefaultPassword&&<StatusChip tone="warn">Default password</StatusChip>}{user.mustChangePassword&&<StatusChip tone="warn">Must choose new password</StatusChip>}</span>}</span></div></TableCell>
       <TableCell className="rt-md"><b>{user.role}</b><span className="rt-sub">{user.role==='Custom'||user.role==='Super Admin'?`${user.permissions.length} permissions`:ROLE_HELP[user.role]}</span></TableCell>
       <TableCell className="rt-status"><StatusChip tone={user.active?'on':'off'}>{user.active?'Active':'Inactive'}</StatusChip></TableCell>
       <TableCell className="rt-lg">{when(user.lastLoginAt)}</TableCell>
       <TableCell className="rt-actions-cell"><RowActions name={user.name} onView={()=>open({kind:'view',user})}
        edit={{onClick:()=>open({kind:'edit',user})}}
        toggle={{on:user.active,onLabel:'Active',offLabel:'Inactive',onChange:()=>open({kind:'toggle',user}),disabled:own||(last&&user.active),reason:own?'You cannot make your own account inactive':last&&user.active?LAST_SUPER:undefined}}
        del={canDelete?{onClick:()=>open({kind:'delete',user}),disabled:own||last,reason:own?'You cannot delete your own account':last?LAST_SUPER:undefined}:undefined}/></TableCell>
      </TableRow>;
     })}
    </TableBody></Table>}
   {users&&!users.length&&!error&&<p className="rt-empty">No admin users yet.</p>}
   {!!users?.length&&!f.rows.length&&<div className="rt-empty"><FilterEmpty onClear={f.clear}/></div>}
  </div>
  <p className="rt-note">An inactive admin user cannot sign in and is signed out straight away. You cannot make your own account inactive or delete it, and the last active Super Admin is always protected.</p>

  <RecordDialog open={modal?.kind==='create'} onClose={close} wide title="Add an admin user" description="They sign in on the administrator sign-in page with this username and the initial password you set.">
   {modal?.kind==='create'&&<UserForm key="create" me={me} onCancel={close} onSaved={u=>void done(<>Created <b>{u.name}</b>. They sign in with the username <b>{u.username}</b> and the initial password you set{u.mustChangePassword?', and will be asked to choose their own first':''}. Share the password with them privately.</>)}/>}
  </RecordDialog>
  <RecordDialog open={modal?.kind==='edit'} onClose={close} wide title={`Edit ${modal?.kind==='edit'?modal.user.name:'admin user'}`} description="Changing a role or permissions signs the person out immediately; they sign in again with the new access.">
   {modal?.kind==='edit'&&<UserForm key={modal.user.id} me={me} user={modal.user} onCancel={close} onReset={()=>open({kind:'reset',user:modal.user})} onSaved={u=>void done(<>Saved changes for <b>{u.name}</b>.</>)}/>}
  </RecordDialog>
  <RecordDialog open={modal?.kind==='view'} onClose={close} wide title={modal?.kind==='view'?modal.user.name:'Admin user'} description="Admin user details. Nothing here can be changed; use Edit for that.">
   {modal?.kind==='view'&&<><DialogBody><UserView user={modal.user} own={modal.user.id===me}/></DialogBody><DialogFoot><button type="button" className="button" onClick={close}>Close</button></DialogFoot></>}
  </RecordDialog>
  <RecordDialog open={modal?.kind==='reset'} onClose={close} title="Reset password" description={modal?.kind==='reset'?`Set a new password for ${modal.user.name} (${modal.user.username}). They are signed out everywhere.`:''}>
   {modal?.kind==='reset'&&<ResetForm key={modal.user.id} user={modal.user} onCancel={close} onSaved={u=>void done(<>Password reset for <b>{u.name}</b>. Share the new password with them privately.</>)}/>}
  </RecordDialog>
  {modal?.kind==='toggle'&&<ToggleConfirm key={modal.user.id} user={modal.user} onCancel={close} onDone={message=>void done(message)}/>}
  {canDelete&&modal?.kind==='delete'&&<DeleteConfirm key={modal.user.id} user={modal.user} onCancel={close} onDeleted={()=>void done(<>Deleted <b>{modal.user.name}</b>.</>)}/>}
 </section>;
}

/** Read-only popup: every field of the account, no inputs. */
function UserView({user,own}:{user:AdminUserView;own:boolean}){
 const grouped=GROUPS.map(g=>({title:g.title,items:g.items.filter(p=>user.permissions.includes(p))})).filter(g=>g.items.length);
 return <ViewFields items={[
  {label:'Name',value:<>{user.name}{own&&<> <StatusChip tone="info">You</StatusChip></>}</>},
  {label:'Username',value:user.username},
  {label:'Email',value:user.email},
  {label:'Status',value:<StatusChip tone={user.active?'on':'off'}>{user.active?'Active':'Inactive'}</StatusChip>},
  {label:'Role',value:<>{user.role}<span className="rt-sub">{ROLE_HELP[user.role]}</span></>},
  {label:'Allowed to do',value:grouped.length?<>{grouped.map(g=><div key={g.title}><b>{g.title}</b><ul className="rt-perm-list">{g.items.map(p=><li key={p}>{PERMISSION_TEXT[p].label}</li>)}</ul></div>)}</>:'Nothing yet: this person can only open My profile.'},
  {label:'Last sign-in',value:when(user.lastLoginAt)},
  {label:'Password',value:<>{user.isDefaultPassword?'Still the default password':'Set by the person or an administrator'}{user.mustChangePassword&&<span className="rt-sub">Must choose a new password at the next sign-in.</span>}</>},
  {label:'Created',value:dateTimeOf(user.createdAt)},
 ]}/>;
}

function Password({id,label,value,onChange,hint}:{id:string;label:string;value:string;onChange:(v:string)=>void;hint?:string}){
 const [shown,setShown]=useState(false);
 return <div className="admin-field"><label htmlFor={id}>{label}</label><div className="password-row"><div className="admin-password"><input id={id} name={id} type={shown?'text':'password'} value={value} onChange={e=>onChange(e.target.value)} autoComplete="new-password" spellCheck={false} autoCapitalize="none" required/><button type="button" className="admin-eye" onClick={()=>setShown(!shown)} aria-label={shown?'Hide password':'Show password'} aria-pressed={shown}>{shown?<EyeOff size={18}/>:<Eye size={18}/>}</button></div><button type="button" className="button" onClick={()=>{onChange(generatePassword());setShown(true);}}><WandSparkles size={15}/> Generate</button></div>{hint&&<small>{hint}</small>}</div>;
}

function UserForm({user,me,onSaved,onCancel,onReset}:{user?:AdminUserView;me?:string;onSaved:(user:AdminUserView)=>void;onCancel:()=>void;onReset?:()=>void}){
 const own=!!user&&user.id===me;
 const start=()=>user?formForUser(user):defaultForm();
 const [name,setName]=useState(user?.name??'');const [username,setUsername]=useState('');const [email,setEmail]=useState(user?.email??'');const [password,setPassword]=useState('');
 const [form,setForm]=useState<PermissionForm>(start);const [note,setNote]=useState('');
 const [mustChange,setMustChange]=useState(true);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 const locked=own;
 const tick=(permission:Permission,on:boolean)=>{const next=toggle(form,permission,on);setForm(next.form);setNote(next.note);setError('');};
 const chooseRole=(role:AdminRole)=>{setForm(pickRole(form,role));setNote('');setError('');};
 const hint=form.role==='Custom'
  ?form.basedOn?`Customised from ${form.basedOn}.`:user?'':'Starts from the recommended set for a new admin user (complaint desk and notices) — adjust as needed.'
  :form.basedOn===form.role?`Starts from the ${form.role} preset — adjust as needed.`:'';
 const empty=problem(form,GROUPS.flatMap(g=>g.items));
 async function submit(event:FormEvent){
  event.preventDefault();if(busy)return;setError('');
  if(!user){
   if(!/^[A-Za-z0-9._-]{3,32}$/.test(username.trim()))return setError('Username must be 3 to 32 characters: letters, numbers, dot, dash or underscore.');
   if(password.length<8)return setError('The initial password must be at least 8 characters.');
  }
  if(empty)return setError(empty);
  setBusy(true);
  try{
   const result=user
    ?await adminCall<{user:AdminUserView}>({action:'update-user',id:user.id,name,email,...payload(form),active:user.active})
    :await adminCall<{user:AdminUserView}>({action:'create-user',username:username.trim(),name,email,password,...payload(form),mustChangePassword:mustChange});
   onSaved(result.user);
  }catch(e){setError((e as Error).message);setBusy(false);}
 }
 return <DialogForm onSubmit={e=>void submit(e)}>
  <DialogBody><div className="user-form">
   <div className="two"><div className="admin-field"><label htmlFor="user-name">Full name</label><input id="user-name" type="text" value={name} onChange={e=>setName(e.target.value)} maxLength={80} required autoComplete="off"/></div>
    {user?<div className="admin-field"><label htmlFor="user-username">Username</label><input id="user-username" type="text" value={user.username} readOnly disabled/></div>:<div className="admin-field"><label htmlFor="user-username">Username</label><input id="user-username" type="text" value={username} onChange={e=>setUsername(e.target.value)} maxLength={32} required autoComplete="off" spellCheck={false} autoCapitalize="none"/><small>Letters, numbers, dot, dash or underscore. Not case-sensitive.</small></div>}</div>
   <div className="admin-field"><label htmlFor="user-email">Email (optional)</label><input id="user-email" type="email" value={email} onChange={e=>setEmail(e.target.value)} maxLength={180} autoComplete="off"/></div>
   {!user&&<><Password id="user-password" label="Initial password" value={password} onChange={setPassword} hint="At least 8 characters. Use Generate for a strong one, then share it privately."/><label className="check-row"><input type="checkbox" checked={mustChange} onChange={e=>setMustChange(e.target.checked)}/><span>Ask them to choose their own password the first time they sign in (recommended)</span></label></>}
   <div className="admin-field"><label htmlFor="user-role">Role</label><select id="user-role" value={form.role} onChange={e=>chooseRole(e.target.value as AdminRole)} disabled={locked}>{(ROLES.includes(form.role)?ROLES:[...ROLES,form.role]).map(r=><option key={r} value={r}>{r}</option>)}</select></div>
   <p className="role-help">{ROLE_HELP[form.role]}{locked&&' Another Super Admin must change your own role or permissions.'}</p>
   {hint&&<p className="role-help" role="status" data-testid="role-hint" style={{fontWeight:600,color:'#3d6a56'}}>{hint}</p>}
   {GROUPS.map(group=><fieldset className="permission-group" key={group.title}><legend>{group.title}</legend>{group.items.map(permission=>{
    const adminsOnly=permission==='admins.manage',isLocked=locked||adminsOnly,text=PERMISSION_TEXT[permission];
    return <label key={permission} className={`permission-item${isLocked?' locked':''}`}><input type="checkbox" checked={form.permissions.includes(permission)} disabled={isLocked} onChange={e=>tick(permission,e.target.checked)}/><span>{text.label}<small>{adminsOnly?ADMINS_ONLY_SUPER:text.help}</small></span></label>;
   })}</fieldset>)}
   <p className="rt-hint" role="status">{note}</p>
   {empty&&<p className="rt-error" role="alert">{empty}. A person with no permission could only open My profile.</p>}
   <div style={{display:'flex',flexWrap:'wrap',gap:8,marginTop:10}}><button type="button" className="button" disabled={locked} onClick={()=>{setForm(start());setNote('');setError('');}}><RotateCcw size={14}/> {user?'Undo permission changes':'Reset to defaults'}</button></div>
   <FormError>{error}</FormError>
  </div></DialogBody>
  <DialogFoot>{onReset&&<button type="button" className="button rt-foot-left" onClick={onReset} disabled={own||busy} title={own?'Use Change password in the top bar for your own account':undefined}><KeyRound size={14}/> Reset password</button>}<button className="button" type="button" onClick={onCancel} disabled={busy}>Cancel</button><button className="button primary" type="submit" disabled={busy||!!empty}><Busy working={busy} label="Saving…">{user?'Save changes':'Create admin user'}</Busy></button></DialogFoot>
 </DialogForm>;
}

function ResetForm({user,onSaved,onCancel}:{user:AdminUserView;onSaved:(user:AdminUserView)=>void;onCancel:()=>void}){
 const [password,setPassword]=useState('');const [mustChange,setMustChange]=useState(true);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 async function submit(event:FormEvent){
  event.preventDefault();if(busy)return;setError('');
  if(password.length<8)return setError('The new password must be at least 8 characters.');
  setBusy(true);
  try{const result=await adminCall<{user:AdminUserView}>({action:'reset-password',id:user.id,newPassword:password,mustChangePassword:mustChange});onSaved(result.user);}
  catch(e){setError((e as Error).message);setBusy(false);}
 }
 return <DialogForm onSubmit={e=>void submit(e)}>
  <DialogBody><div className="user-form">
   <Password id="reset-password" label="New password" value={password} onChange={setPassword} hint="At least 8 characters, and not the username."/>
   <label className="check-row"><input type="checkbox" checked={mustChange} onChange={e=>setMustChange(e.target.checked)}/><span>Ask them to choose their own password at next sign-in (recommended)</span></label>
   <FormError>{error}</FormError>
  </div></DialogBody>
  <DialogFoot><button className="button" type="button" onClick={onCancel} disabled={busy}>Cancel</button><button className="button primary" type="submit" disabled={busy}><Busy working={busy} label="Saving…">Reset password</Busy></button></DialogFoot>
 </DialogForm>;
}

/** Active ↔ Inactive. Making someone inactive signs them out, so it asks first; the server keeps its own protections (own account, last Super Admin). */
function ToggleConfirm({user,onDone,onCancel}:{user:AdminUserView;onDone:(message:ReactNode)=>void;onCancel:()=>void}){
 const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 async function run(){
  setBusy(true);setError('');
  try{await adminCall({action:'update-user',id:user.id,name:user.name,email:user.email??'',role:user.role,permissions:user.role==='Custom'?user.permissions:[],active:!user.active});onDone(<>{user.name} {user.active?'is now inactive and was signed out.':'is active and can sign in again.'}</>);}
  catch(e){setError((e as Error).message);setBusy(false);}
 }
 return <ConfirmDialog open title={`${user.active?'Make inactive':'Make active'}: ${user.name}?`} tone={user.active?'danger':'primary'} busy={busy} error={error} confirmLabel={user.active?'Make inactive':'Make active'} workingLabel="Saving…" onConfirm={()=>void run()} onCancel={onCancel}
  description={user.active?'They are signed out immediately and cannot sign in until you make the account active again.':'They will be able to sign in again.'}/>;
}

function DeleteConfirm({user,onDeleted,onCancel}:{user:AdminUserView;onDeleted:()=>void;onCancel:()=>void}){
 const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 async function remove(){setBusy(true);setError('');try{await adminCall({action:'delete-user',id:user.id});onDeleted();}catch(e){setError((e as Error).message);setBusy(false);}}
 return <ConfirmDelete open title={`Delete “${user.name}”?`} busy={busy} error={error} onConfirm={()=>void remove()} onCancel={onCancel}
  description={`${user.name} (${user.username}) is signed out immediately and the account is removed. Their earlier changes to content stay as they are.`}/>;
}
