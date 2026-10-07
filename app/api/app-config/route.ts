import {apiError, mainOwner} from '@/lib/server';
import {loadWorkspace} from '@/lib/workspaces';
import {publicAppConfig} from '@/lib/community-service';
export const dynamic = 'force-dynamic';
/**
 * Public, unauthenticated: the app configuration residents' devices need before anyone has signed in (maintenance notice, minimum app version,
 * terms and privacy links, support details, which tabs exist). Configuration only: no resident, complaint or content data is reachable here.
 * GET /api/app-config -> { appConfig, ward, city, contact }. Cached for a short time so a busy launch day does not hit the database per device.
 */
export async function GET() {
 try {
  const owner = await mainOwner();
  const settings = owner ? JSON.parse((await loadWorkspace(owner)).body).settings : null;
  return Response.json(publicAppConfig(settings), {headers: {'Cache-Control': 'public, max-age=30'}});
 } catch (e) {return apiError(e);}
}
