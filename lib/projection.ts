import {publicWorkspace,type StoredWorkspace} from './service';
import {communityView,type CommunityState} from './community-service';
import type {Principal} from './server';
export function projectWorkspace(state:StoredWorkspace&CommunityState,who:Principal,resident:boolean){
 const data=publicWorkspace(state);const can=(p:string)=>!resident&&who.viewer.permissions.some(v=>v===p);
 const {residentProfiles,...safe}=data as typeof data&CommunityState;
 return {...safe,...communityView(state,who.residentId,who.viewer,resident),
  complaints:resident?data.complaints.filter(c=>(c as any).residentId===who.residentId||!(c as any).residentId&&who.residentId==='demo-resident'):can('complaints.read')?data.complaints:[],
  audit:can('audit.read')?data.audit:[],communications:can('communications.read')?data.communications:[],
  categories:can('categories.manage')?data.categories:data.categories.filter(c=>c.enabled),
  viewer:resident?{role:'Resident' as const,permissions:[]}:who.viewer,
 };
}
