'use client';
import {createContext,useCallback,useContext,useEffect,useRef,useState,type FormEvent,type ReactNode} from 'react';
import {Eye,EyeOff,LogOut,KeyRound,ShieldAlert,ChevronDown,LoaderCircle,UserRound} from 'lucide-react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import type {AdminUserView} from '@/lib/admin-policy';
import AdminWatermark from './admin-watermark';

/**
 * Administrator sign-in for the portal (/admin). <AdminGate> asks POST /api/admin-auth {action:'me'}; with no session it shows the login page,
 * otherwise it renders the portal and offers the signed-in account through useAdminSession() (top-bar menu, change password, sign out, default-password warning).
 * The portal only ever uses this session (its requests carry x-samadhan-portal: 1, which the server never answers from the platform identity).
 * Nothing here knows, pre-fills or displays any default credentials.
 */
export const SESSION_LOST = 'samadhan:admin-session-lost';
export class AdminApiError extends Error {constructor(message:string,public status:number,public retryAfter?:number){super(message);}}
/** One call to POST /api/admin-auth. Throws AdminApiError with the server's plain-English message. */
export async function adminCall<T=any>(body:Record<string,unknown>):Promise<T>{
 let response:Response;
 try{response=await fetch('/api/admin-auth',{method:'POST',headers:{'Content-Type':'application/json','x-samadhan-portal':'1'},body:JSON.stringify(body)});}
 catch{throw new AdminApiError('Could not reach the server. Check your connection and try again.',0);}
 let json:any={};try{json=await response.json();}catch{}
 if(!response.ok){
  if(response.status===401&&body.action!=='login'&&body.action!=='me')window.dispatchEvent(new Event(SESSION_LOST));
  throw new AdminApiError(typeof json.error==='string'&&json.error?json.error:'Something went wrong. Please try again.',response.status,typeof json.retryAfter==='number'?json.retryAfter:undefined);
 }
 return json as T;
}

export type AdminSession={user:AdminUserView;defaultPassword:boolean;signOut:()=>Promise<void>;openChangePassword:()=>void;updateUser:(user:AdminUserView)=>void};
/** URL of an administrator's profile photo (served by /api/media with the session cookie), or null. */
export const avatarUrl=(id:string|null|undefined)=>id?`/api/media?id=${encodeURIComponent(id)}`:null;
const SessionContext=createContext<AdminSession|null>(null);
export const useAdminSession=()=>useContext(SessionContext);

type Phase={kind:'loading'}|{kind:'anon';notice:string}|{kind:'authed';user:AdminUserView;defaultPassword:boolean}|{kind:'error';message:string};
const sameSession=(a:Phase,b:Phase)=>a.kind==='authed'&&b.kind==='authed'&&a.user.id===b.user.id&&a.defaultPassword===b.defaultPassword&&a.user.mustChangePassword===b.user.mustChangePassword&&a.user.role===b.user.role&&a.user.name===b.user.name&&a.user.avatarMediaId===b.user.avatarMediaId&&a.user.permissions.join()===b.user.permissions.join();

export function AdminGate({children}:{children:ReactNode}){
 const [phase,setPhase]=useState<Phase>({kind:'loading'});const [changing,setChanging]=useState(false);const [flash,setFlash]=useState('');
 const check=useCallback(async(quiet:boolean)=>{
  try{
   const result=await adminCall<{user:AdminUserView|null;defaultPassword:boolean}>({action:'me'});
   setPhase(previous=>{
    const next:Phase=result.user?{kind:'authed',user:result.user,defaultPassword:!!result.defaultPassword}:{kind:'anon',notice:quiet&&previous.kind==='authed'?'Your session has ended. Sign in again.':previous.kind==='anon'?previous.notice:''};
    return sameSession(previous,next)?previous:next;
   });
  }catch(error){if(!quiet)setPhase({kind:'error',message:(error as Error).message});}
 },[]);
 useEffect(()=>{void check(false);},[check]);
 // Keep the session honest: re-check when the tab regains focus, every few minutes (this also renews the 12-hour cookie), and whenever an API call reports it is gone.
 useEffect(()=>{
  const recheck=()=>{if(document.visibilityState==='visible')void check(true);};
  window.addEventListener('focus',recheck);document.addEventListener('visibilitychange',recheck);window.addEventListener(SESSION_LOST,recheck);
  const timer=window.setInterval(recheck,5*60*1000);
  return()=>{window.removeEventListener('focus',recheck);document.removeEventListener('visibilitychange',recheck);window.removeEventListener(SESSION_LOST,recheck);window.clearInterval(timer);};
 },[check]);
 useEffect(()=>{if(!flash)return;const timer=window.setTimeout(()=>setFlash(''),6000);return()=>window.clearTimeout(timer);},[flash]);
 const signOut=useCallback(async()=>{try{await adminCall({action:'logout'});}catch{}setChanging(false);setPhase({kind:'anon',notice:'You have been signed out.'});},[]);

 if(phase.kind==='loading')return <div className="admin-gate" role="status" aria-live="polite"><img src="/samadhan-logo.png" alt="SAMADHAN"/><p><LoaderCircle className="spin" size={18}/> Opening the administrator portal…</p></div>;
 if(phase.kind==='error')return <div className="admin-gate"><img src="/samadhan-logo.png" alt="SAMADHAN"/><p role="alert">{phase.message}</p><button className="button primary" onClick={()=>{setPhase({kind:'loading'});void check(false);}}>Try again</button></div>;
 if(phase.kind==='anon')return <AdminLogin notice={phase.notice} onSignedIn={(user,defaultPassword)=>setPhase({kind:'authed',user,defaultPassword})}/>;
 const session:AdminSession={user:phase.user,defaultPassword:phase.defaultPassword,signOut,openChangePassword:()=>setChanging(true),updateUser:(user)=>setPhase(previous=>previous.kind==='authed'?{...previous,user}:previous)};
 // An account created or reset by an administrator must choose its own password before anything else opens (the server enforces this too).
 if(phase.user.mustChangePassword)return <div className="admin-login"><AdminWatermark/><div className="admin-card"><PasswordCard forced user={phase.user} onDone={(user)=>{setPhase({kind:'authed',user,defaultPassword:false});setFlash('Password changed. Welcome.');}} onSignOut={signOut}/></div></div>;
 return <SessionContext.Provider value={session}>
  {children}
  <Dialog open={changing} onOpenChange={setChanging}><DialogContent className="admin-dialog"><DialogHeader><DialogTitle>Change password</DialogTitle><DialogDescription>Signed in as {phase.user.name} ({phase.user.username}). Your other sessions will be signed out.</DialogDescription></DialogHeader>
   <PasswordCard user={phase.user} onCancel={()=>setChanging(false)} onDone={(user)=>{setPhase({kind:'authed',user,defaultPassword:false});setChanging(false);setFlash('Password changed. Your other sessions were signed out.');}}/></DialogContent></Dialog>
  {flash&&<div className="admin-flash" role="status">{flash}</div>}
 </SessionContext.Provider>;
}

function PasswordField({id,label,value,onChange,autoComplete,hint,autoFocus=false}:{id:string;label:string;value:string;onChange:(v:string)=>void;autoComplete:string;hint?:string;autoFocus?:boolean}){
 const [shown,setShown]=useState(false);
 return <div className="admin-field"><label htmlFor={id}>{label}</label><div className="admin-password"><input id={id} name={id} type={shown?'text':'password'} value={value} onChange={e=>onChange(e.target.value)} autoComplete={autoComplete} autoFocus={autoFocus} spellCheck={false} autoCapitalize="none" autoCorrect="off" required/><button type="button" className="admin-eye" onClick={()=>setShown(!shown)} aria-label={shown?`Hide ${label.toLowerCase()}`:`Show ${label.toLowerCase()}`} aria-pressed={shown}>{shown?<EyeOff size={18}/>:<Eye size={18}/>}</button></div>{hint&&<small>{hint}</small>}</div>;
}

export function AdminLogin({notice,onSignedIn}:{notice:string;onSignedIn:(user:AdminUserView,defaultPassword:boolean)=>void}){
 const [username,setUsername]=useState('');const [password,setPassword]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 const [lockedUntil,setLockedUntil]=useState(0);const [now,setNow]=useState(Date.now());const userRef=useRef<HTMLInputElement>(null);
 useEffect(()=>{userRef.current?.focus();},[]);
 useEffect(()=>{if(lockedUntil<=Date.now())return;const timer=window.setInterval(()=>{setNow(Date.now());if(Date.now()>=lockedUntil){setLockedUntil(0);setError('');}},1000);return()=>window.clearInterval(timer);},[lockedUntil]);
 const wait=Math.max(0,Math.ceil((lockedUntil-now)/1000));
 async function submit(event:FormEvent){
  event.preventDefault();if(busy||wait>0)return;setBusy(true);setError('');
  try{
   const result=await adminCall<{user:AdminUserView;defaultPassword:boolean}>({action:'login',username:username.trim(),password});
   setPassword('');onSignedIn(result.user,!!result.defaultPassword);
  }catch(e){
   const failure=e as AdminApiError;setPassword('');
   if(failure.status===429&&failure.retryAfter){setLockedUntil(Date.now()+failure.retryAfter*1000);setNow(Date.now());setError('Too many failed attempts. Sign-in is paused for this account.');}
   else setError(failure.message);
   setBusy(false);return;
  }
 }
 const clock=`${Math.floor(wait/60)}:${String(wait%60).padStart(2,'0')}`;
 return <main className="admin-login"><AdminWatermark/><div className="admin-card">
  <img className="admin-logo" src="/samadhan-logo.png" alt="SAMADHAN समाधान"/>
  <h1>Administrator sign-in</h1><p className="admin-sub">SAMADHAN ward workspace</p>
  {notice&&!error&&<p className="admin-notice" role="status">{notice}</p>}
  <form onSubmit={submit} noValidate={false}>
   <div className="admin-field"><label htmlFor="admin-username">Username</label><input ref={userRef} id="admin-username" name="username" value={username} onChange={e=>setUsername(e.target.value)} autoComplete="username" spellCheck={false} autoCapitalize="none" autoCorrect="off" maxLength={64} required/></div>
   <PasswordField id="admin-password" label="Password" value={password} onChange={setPassword} autoComplete="current-password"/>
   {error&&<p className="admin-error" role="alert">{error}{wait>0&&<> Try again in <b>{clock}</b>.</>}</p>}
   <button className="button primary admin-submit" type="submit" disabled={busy||wait>0||!username.trim()||!password}>{busy?<><LoaderCircle className="spin" size={16}/> Signing in…</>:wait>0?`Try again in ${clock}`:'Sign in'}</button>
  </form>
  <p className="admin-foot">For ward administrators only. Residents use the SAMADHAN mobile app.</p>
 </div></main>;
}

/** Change-password form: a dialog body, or the full-page card when the administrator has set a temporary password (forced). */
function PasswordCard({user,forced=false,onDone,onCancel,onSignOut}:{user:AdminUserView;forced?:boolean;onDone:(user:AdminUserView)=>void;onCancel?:()=>void;onSignOut?:()=>void}){
 const [current,setCurrent]=useState('');const [next,setNext]=useState('');const [again,setAgain]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 async function submit(event:FormEvent){
  event.preventDefault();if(busy)return;setError('');
  if(next.length<8)return setError('The new password must be at least 8 characters.');
  if(next!==again)return setError('The two new passwords do not match.');
  setBusy(true);
  try{const result=await adminCall<{user:AdminUserView}>({action:'change-password',currentPassword:current,newPassword:next});setCurrent('');setNext('');setAgain('');onDone(result.user);}
  catch(e){setError((e as Error).message);setBusy(false);}
 }
 return <form onSubmit={submit} className="admin-password-form">
  {forced&&<><img className="admin-logo" src="/samadhan-logo.png" alt="SAMADHAN समाधान"/><h1>Choose a new password</h1><p className="admin-sub">Hello {user.name}. An administrator set a temporary password for <b>{user.username}</b>. Choose your own to continue.</p></>}
  <PasswordField id="admin-current-password" label={forced?'Temporary password':'Current password'} value={current} onChange={setCurrent} autoComplete="current-password" autoFocus/>
  <PasswordField id="admin-new-password" label="New password" value={next} onChange={setNext} autoComplete="new-password" hint="At least 8 characters. Not your username, and not the password you use now."/>
  <PasswordField id="admin-confirm-password" label="Confirm new password" value={again} onChange={setAgain} autoComplete="new-password"/>
  {error&&<p className="admin-error" role="alert">{error}</p>}
  <div className="admin-actions"><button className="button primary" type="submit" disabled={busy||!current||!next||!again}>{busy?<><LoaderCircle className="spin" size={16}/> Saving…</>:'Change password'}</button>{forced?<button className="button" type="button" onClick={onSignOut}>Sign out</button>:<button className="button" type="button" onClick={onCancel}>Cancel</button>}</div>
 </form>;
}

const initials=(name:string)=>name.split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0]!.toUpperCase()).join('')||'?';
/** Top-bar account menu: name and role, Change password, Sign out. */
export function UserMenu({onOpenProfile}:{onOpenProfile?:()=>void}={}){
 const session=useAdminSession();const [open,setOpen]=useState(false);const box=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  if(!open)return;
  const away=(e:MouseEvent)=>{if(!box.current?.contains(e.target as Node))setOpen(false);};const esc=(e:KeyboardEvent)=>{if(e.key==='Escape')setOpen(false);};
  document.addEventListener('mousedown',away);document.addEventListener('keydown',esc);return()=>{document.removeEventListener('mousedown',away);document.removeEventListener('keydown',esc);};
 },[open]);
 if(!session)return null;
 return <div className="user-menu" ref={box}>
  <button type="button" className="user-menu-trigger" aria-haspopup="menu" aria-expanded={open} onClick={()=>setOpen(!open)}><span className="avatar small-avatar" aria-hidden="true">{avatarUrl(session.user.avatarMediaId)?<img className="avatar-img" src={avatarUrl(session.user.avatarMediaId)!} alt=""/>:initials(session.user.name)}</span><span className="user-menu-text"><b>{session.user.name}</b><small>{session.user.role}</small></span><ChevronDown size={15} aria-hidden="true"/></button>
  {open&&<div className="user-menu-panel" role="menu"><div className="user-menu-head"><b>{session.user.name}</b><small>{session.user.username} · {session.user.role}</small></div>{onOpenProfile&&<button role="menuitem" type="button" onClick={()=>{setOpen(false);onOpenProfile();}}><UserRound size={16}/> My profile</button>}<button role="menuitem" type="button" onClick={()=>{setOpen(false);session.openChangePassword();}}><KeyRound size={16}/> Change password</button><button role="menuitem" type="button" onClick={()=>{setOpen(false);void session.signOut();}}><LogOut size={16}/> Sign out</button></div>}
 </div>;
}

/** Shown on every page while the built-in default password is still in use. It cannot be dismissed; only changing the password removes it. */
export function DefaultPasswordBanner(){
 const session=useAdminSession();
 if(!session?.defaultPassword)return null;
 return <div className="default-password-banner" role="alert"><ShieldAlert size={22} aria-hidden="true"/><div><b>Security warning: this account still uses the default password.</b><p>Anyone who knows it can sign in as {session.user.role}. Choose your own password now.</p></div><button type="button" className="button primary" onClick={session.openChangePassword}><KeyRound size={16}/> Change password</button></div>;
}
