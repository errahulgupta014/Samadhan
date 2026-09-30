import {useCallback,useEffect,useRef,useState} from 'react';
import type {IssueCategory} from '../shared/domain';
import type {Connection} from './api';
export function useCategories(connection:Connection){
 const [categories,setCategories]=useState<IssueCategory[]>([]);
 const [loading,setLoading]=useState(true);const [error,setError]=useState('');
 const controller=useRef<AbortController|null>(null);
 const refresh=useCallback(async()=>{
  controller.current?.abort();const current=new AbortController();controller.current=current;
  setLoading(true);setError('');
  try{
   const response=await fetch(connection.url.replace(/\/$/,'')+'/api/categories',{headers:connection.token?{Authorization:`Bearer ${connection.token}`}:{},signal:current.signal});
   const result=await response.json();
   if(!response.ok)throw new Error(result.error||'Unable to load issue categories.');
   if(!Array.isArray(result.categories))throw new Error('Invalid category response. Please try again.');
   if(!current.signal.aborted)setCategories(result.categories);
  }catch(e){if(!current.signal.aborted)setError((e as Error).message);}
  finally{if(!current.signal.aborted)setLoading(false);}
 },[connection.url,connection.token]);
 // This effect starts an external catalog request; loading is its request status.
 // eslint-disable-next-line react-hooks/set-state-in-effect
 useEffect(()=>{void refresh();return()=>controller.current?.abort();},[refresh]);
 return {categories,loading,error,refresh};
}
