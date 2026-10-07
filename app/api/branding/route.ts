import {database,apiError} from '@/lib/server';
export const dynamic='force-dynamic';
// Only the explicitly published splash image is discoverable before sign-in.
export async function GET(){try{const row=await database().prepare("SELECT w.body FROM workspaces w JOIN platform_owner p ON w.owner = p.user_id WHERE p.id = 'main'").first<{body:string}>();const id=row?JSON.parse(row.body).settings?.splashImageId:null;return Response.json({imageUrl:id?`/api/branding/image?v=${encodeURIComponent(id)}`:null},{headers:{'Cache-Control':'no-store'}});}catch(e){return apiError(e);}}
