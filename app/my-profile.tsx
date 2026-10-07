'use client';
import {useEffect,useRef,useState,type ChangeEvent} from 'react';
import {Camera,LoaderCircle,Trash2} from 'lucide-react';
import type {AdminUserView} from '@/lib/admin-policy';
import {adminCall,avatarUrl,useAdminSession} from './admin-login';
import {PERMISSION_TEXT} from './admin-users-manager';

const when=(iso:string|null)=>iso?new Date(iso).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'}):'Not available';
const PHOTO_TYPES=['image/jpeg','image/png','image/webp'];

/** "My profile": the signed-in administrator's own account, read only except for the profile photo. Passwords are changed from the account menu (top right). */
export default function MyProfile(){
 const session=useAdminSession();const fileInput=useRef<HTMLInputElement>(null);
 const [user,setUser]=useState<AdminUserView|null>(null);const [error,setError]=useState('');
 const [photoBusy,setPhotoBusy]=useState(false);const [photoError,setPhotoError]=useState('');
 useEffect(()=>{let alive=true;adminCall<{user:AdminUserView|null}>({action:'me'}).then(r=>{if(alive){if(r.user)setUser(r.user);else setError('Your session has ended. Please sign in again.');}}).catch((e:Error)=>{if(alive)setError(e.message);});return()=>{alive=false;};},[]);
 const saved=(next:AdminUserView)=>{setUser(next);session?.updateUser(next);};
 async function choosePhoto(e:ChangeEvent<HTMLInputElement>){
  const file=e.target.files?.[0];e.target.value='';if(!file)return;
  setPhotoError('');
  if(!PHOTO_TYPES.includes(file.type)){setPhotoError('Choose a JPG, PNG or WebP photo.');return;}
  if(file.size>5*1024*1024){setPhotoError('The photo must be smaller than 5 MB.');return;}
  setPhotoBusy(true);
  try{
   const form=new FormData();form.append('file',file);
   const upload=await fetch('/api/media',{method:'POST',body:form,headers:{'x-samadhan-portal':'1'}});
   const uploaded=(await upload.json().catch(()=>({})))as {id?:string;error?:string};
   if(!upload.ok||!uploaded.id)throw new Error(typeof uploaded.error==='string'&&uploaded.error?uploaded.error:'The photo could not be uploaded. Please try again.');
   const result=await adminCall<{user:AdminUserView}>({action:'set-avatar',mediaId:uploaded.id});
   saved(result.user);
  }catch(err){setPhotoError((err as Error).message);}
  finally{setPhotoBusy(false);}
 }
 async function removePhoto(){
  setPhotoError('');setPhotoBusy(true);
  try{const result=await adminCall<{user:AdminUserView}>({action:'set-avatar',mediaId:null});saved(result.user);}
  catch(err){setPhotoError((err as Error).message);}
  finally{setPhotoBusy(false);}
 }
 if(error)return <p className="error" role="alert">{error}</p>;
 if(!user)return <p className="empty-state"><LoaderCircle className="spin" size={18}/> Loading your profile…</p>;
 const photo=avatarUrl(user.avatarMediaId);
 const rows:[string,string][]=[['Full name',user.name||'—'],['Username',user.username],['Email',user.email||'Not provided'],['Role',user.role],['Account status',user.active?'Active':'Disabled'],['Last sign-in',when(user.lastLoginAt)],['Account created',when(user.createdAt)]];
 return <section className="panel my-profile" aria-label="My profile">
  <div className="my-profile-head">
   <span className="my-profile-avatar" aria-hidden="true">{photo?<img src={photo} alt=""/>:(user.name||user.username).trim().charAt(0).toUpperCase()}</span>
   <div className="my-profile-head-text"><h2>{user.name||user.username}</h2><p>{user.role}</p>
    <div className="my-profile-photo-actions">
     <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={e=>void choosePhoto(e)} aria-label="Choose a profile photo"/>
     <button type="button" className="button" disabled={photoBusy} onClick={()=>fileInput.current?.click()}>{photoBusy?<LoaderCircle className="spin" size={15}/>:<Camera size={15}/>}{photo?'Change photo':'Add photo'}</button>
     {photo&&<button type="button" className="button" disabled={photoBusy} onClick={()=>void removePhoto()}><Trash2 size={15}/>Remove photo</button>}
    </div>
    <small className="my-profile-hint">JPG, PNG or WebP, up to 5 MB.</small>
    {photoError&&<p className="error" role="alert">{photoError}</p>}
   </div>
  </div>
  <dl className="my-profile-grid">{rows.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
  <h3 className="my-profile-sub">What you can do</h3>
  <ul className="my-profile-perms">{user.permissions.length?user.permissions.map(p=><li key={p}><b>{PERMISSION_TEXT[p]?.label??p}</b><small>{PERMISSION_TEXT[p]?.help??''}</small></li>):<li><small>No permissions assigned.</small></li>}</ul>
  <p className="my-profile-note">Apart from your photo, these details can only be changed by a Super Admin from the Admin Users page. To change your password, use the account menu at the top right.</p>
 </section>;
}
