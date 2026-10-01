import type {Principal} from './server';
import type {StoredWorkspace} from './service';
import type {CommunityState} from './community-service';
import {visibleClassified} from '../shared/community';
export function canReadMedia(state:StoredWorkspace&CommunityState,who:Principal,id:string,uploader?:string|null){
 const has=(permission:string)=>who.role==='admin'&&who.viewer.permissions.some(p=>p===permission);
 if(state.settings.splashImageId===id)return true;
 if(uploader===who.residentId)return true;
 if(state.complaints.some(c=>(c.media.includes(id)||c.afterMedia.includes(id))&&(has('complaints.read')||((c as any).residentId??'demo-resident')===who.residentId)))return true;
 if(state.classifieds?.some(ad=>ad.imageId===id&&(has('classifieds.manage')||visibleClassified(ad))))return true;
 return !!state.places?.some(p=>p.imageId===id&&(has('city.manage')||p.published));
}
