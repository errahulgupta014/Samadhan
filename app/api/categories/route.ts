import { activeCategories } from '@/shared/domain';
import { loadWorkspace } from '@/lib/workspaces';
import { identity, apiError } from '@/lib/server';
import { publicWorkspace } from '@/lib/service';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 try{const who=await identity(request);const row=await loadWorkspace(who.owner);const data=publicWorkspace(JSON.parse(row.body));return Response.json({categories:activeCategories(data.categories),version:row.version},{headers:{'Cache-Control':'no-store'}});}
 catch(e){return apiError(e);}
}
