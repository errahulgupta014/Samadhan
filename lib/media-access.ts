import type {Principal} from './server';
import type {StoredWorkspace} from './service';
import type {CommunityState} from './community-service';
import {visibleClassified, visibleActivity} from '../shared/community';
/**
 * Whether `who` may read media `id` (uploaded by `uploader`); purpose 'attach' asks whether it may be referenced from new or edited content.
 * Content references decide first. The uploader shortcut at the end applies ONLY to an upload that no workspace content references at all:
 * artwork used by a hidden banner, a draft ad, an unpublished place, a ward or any complaint can never be read just because the caller uploaded it
 * (the owner and a paired test device share "demo-resident"; a demoted staff member keeps no access to what they once uploaded).
 * A deleted resident's profile photo is such an unreferenced upload (delete-resident also rewrites its uploader to 'deleted:<id>'): no administrator role reads it, and neither does anyone who
 * registers the same mobile again. Complaint evidence stays readable through the complaint, which is kept.
 */
export function canReadMedia(state: StoredWorkspace & CommunityState, who: Pick<Principal, 'role' | 'residentId' | 'viewer'>, id: string, uploader?: string | null, purpose: 'read' | 'attach' = 'read') {
 const has = (permission: string) => who.role === 'admin' && who.viewer.permissions.some(p => p === permission);
 if (state.settings.splashImageId === id) return true;
 if (state.settings.brandingBanners?.some(b => b.imageId === id && (b.enabled || has('settings.manage')))) return true;
 if (state.complaints.some(c => (c.media.includes(id) || c.afterMedia.includes(id)) && (has('complaints.read') || (!!who.residentId && (c as any).residentId === who.residentId)))) return true;
 if (state.classifieds?.some(ad => ad.imageId === id && (has('classifieds.manage') || visibleClassified(ad)))) return true;
 // Activity images follow the activity: residents read them only while it is published and not ended; activities.manage sees drafts and archived ones.
 if (state.activities?.some(a => a.imageId === id && (has('activities.manage') || visibleActivity(a)))) return true;
 if (state.places?.some(p => p.imageId === id && (has('city.manage') || p.published))) return true;
 // Ward member photos are public (served by /api/wards/photo) while the ward is active; settings admins can always preview them.
 if (state.wards?.some(w => w.memberPhotoId === id && (w.active || has('settings.manage')))) return true;
 if (!!who.residentId && state.residentProfiles?.[who.residentId]?.photoId === id) return true;
 // Administrators with residents.manage may open any registered resident's profile photo (the App users page); residents still read only their own.
 // Reading only: a resident's photo can never be attached to content (an ad, an activity, a ward...), which would publish it (POST /api/workspace passes purpose 'attach').
 if (purpose === 'read' && has('residents.manage') && Object.values(state.residentProfiles ?? {}).some(p => p.photoId === id)) return true;
 const referenced = state.settings.brandingBanners?.some(b => b.imageId === id) || state.complaints.some(c => c.media.includes(id) || c.afterMedia.includes(id)) || state.classifieds?.some(ad => ad.imageId === id) || state.activities?.some(a => a.imageId === id) || state.places?.some(p => p.imageId === id) || state.wards?.some(w => w.memberPhotoId === id) || Object.values(state.residentProfiles ?? {}).some(p => p.photoId === id);
 if (referenced) return false;
 return !!uploader && uploader === who.residentId;
}
