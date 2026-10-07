import {env} from 'cloudflare:workers';
import {apiError, database, mainOwner} from './server';
import {loadWorkspace} from './workspaces';
import {activePublicWards} from './wards';
import type {Ward, ResidentProfile} from '../shared/community';

/**
 * Public, unauthenticated endpoints that the sign-up screen needs before a resident exists (docs/RESIDENT_AUTH_API.md):
 *   GET /api/wards              -> { wards: PublicWard[] } (active wards, numeric order)
 *   GET /api/wards/photo?id=... -> the ward member's photo bytes; nothing else in storage is reachable this way.
 */
async function wardState() {
 const owner = await mainOwner();
 if (!owner) return null;
 const state = JSON.parse((await loadWorkspace(owner)).body) as {wards?: Ward[]; residentProfiles?: Record<string, ResidentProfile>};
 return {owner, wards: state.wards ?? [], profiles: Object.values(state.residentProfiles ?? {})};
}

export async function listWards() {
 try {
  const state = await wardState();
  return Response.json({wards: activePublicWards(state?.wards)}, {headers: {'Cache-Control': 'no-store'}});
 } catch (e) {return apiError(e);}
}

export async function wardPhoto(request: Request) {
 try {
  const id = new URL(request.url).searchParams.get('id');
  const notFound = () => new Response(null, {status: 404, headers: {'Cache-Control': 'no-store'}});
  const state = id ? await wardState() : null;
  const ward = state?.wards.find(w => w.id === id);
  // Serve an inactive ward's photo only to the residents who registered in it (their app still shows their ward).
  if (!state || !ward || !ward.memberPhotoId || !(ward.active || state.profiles.some(p => p.wardId === ward.id)) || !env.BUCKET) return notFound();
  const media = await database().prepare('SELECT content_type FROM media WHERE id = ? AND owner = ?').bind(ward.memberPhotoId, state.owner).first<{content_type: string}>();
  if (!media) return notFound();
  // Media is immutable per id, so the media id is the ETag: replacing the photo changes the validator immediately.
  const etag = `"ward-${ward.memberPhotoId}"`, headers = {'Cache-Control': 'public, max-age=60', ETag: etag, 'X-Content-Type-Options': 'nosniff'};
  if (request.headers.get('If-None-Match')?.split(',').some(v => v.trim().replace(/^W\//, '') === etag)) return new Response(null, {status: 304, headers});
  const file = await env.BUCKET.get(ward.memberPhotoId);
  if (!file) return notFound();
  return new Response(file.body, {headers: {...headers, 'Content-Type': media.content_type}});
 } catch (e) {return apiError(e);}
}
