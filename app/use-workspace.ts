'use client';
import {useEffect,useState} from 'react';
import type {Workspace} from '@/shared/domain';
export function useWorkspace(){const [data,setData]=useState<Workspace|null>(null);const [version,setVersion]=useState(0);const [error,setError]=useState('');const [auth,setAuth]=useState(false);const [busy,setBusy]=useState(false);
 async function refresh(){try{const r=await fetch('/api/workspace');const j:any=await r.json();setAuth(r.status===401);if(!r.ok)throw new Error(j.error);setData(j.data);setVersion(j.version);setError('');}catch(e){setError((e as Error).message);}}
 useEffect(()=>{void refresh();},[]);
 async function act(body:Record<string,unknown>){setBusy(true);setError('');try{const r=await fetch('/api/workspace',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,version})});const j:any=await r.json();if(j.data){setData(j.data);setVersion(j.version);}if(!r.ok){if(r.status===409)await refresh();throw new Error(j.error);}if(body.action==='save-admin')await refresh();return j;}catch(e){setError((e as Error).message);throw e;}finally{setBusy(false);}}
 return {data,version,error,auth,busy,act,refresh};}
export async function uploadPhoto(file:File){if(file.size>5*1024*1024)throw new Error('Photo must be smaller than 5 MB.');const form=new FormData();form.append('file',file);const r=await fetch('/api/media',{method:'POST',body:form});const j:any=await r.json();if(!r.ok)throw new Error(j.error);return j.id as string;}
