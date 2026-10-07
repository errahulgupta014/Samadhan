'use client';
import {useEffect,useState} from 'react';
import type {Workspace} from '@/shared/domain';
import {publishViewerRole} from './super-admin'; // the pages that only get a slice of the workspace read the viewer's role from there (useIsSuperAdmin)
// The portal talks to the API with the administrator session only: this marker stops the server from answering with the platform identity, and a 401 sends the portal back to the sign-in page (app/admin-login.tsx).
const portal={'x-samadhan-portal':'1'};
const sessionLost=()=>{if(typeof window!=='undefined')window.dispatchEvent(new Event('samadhan:admin-session-lost'));};
export function useWorkspace(){const [data,setData]=useState<Workspace|null>(null);const [version,setVersion]=useState(0);const [error,setError]=useState('');const [auth,setAuth]=useState(false);const [busy,setBusy]=useState(false);
 async function refresh(){try{const r=await fetch('/api/workspace',{headers:portal});const j:any=await r.json();setAuth(r.status===401);if(r.status===401)sessionLost();if(!r.ok)throw new Error(j.error);publishViewerRole(j.data?.viewer?.role);setData(j.data);setVersion(j.version);setError('');}catch(e){setError((e as Error).message);}}
 useEffect(()=>{void refresh();},[]);
 async function act(body:Record<string,unknown>){setBusy(true);setError('');try{const r=await fetch('/api/workspace',{method:'POST',headers:{'Content-Type':'application/json',...portal},body:JSON.stringify({...body,version})});const j:any=await r.json();if(j.data){publishViewerRole(j.data.viewer?.role);setData(j.data);setVersion(j.version);}if(!r.ok){if(r.status===401)sessionLost();if(r.status===409)await refresh();throw new Error(j.error);}if(body.action==='save-admin')await refresh();return j;}catch(e){setError((e as Error).message);throw e;}finally{setBusy(false);}}
 return {data,version,error,auth,busy,act,refresh};}
export async function uploadPhoto(file:File){if(file.size>5*1024*1024)throw new Error('Photo must be smaller than 5 MB.');const form=new FormData();form.append('file',file);const r=await fetch('/api/media',{method:'POST',headers:portal,body:form});const j:any=await r.json();if(!r.ok){if(r.status===401)sessionLost();throw new Error(j.error);}return j.id as string;}
