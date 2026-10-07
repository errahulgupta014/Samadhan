import {assertOrigin,identity,apiError} from '@/lib/server';
import {revokeCurrentToken} from '@/lib/resident-auth';
// Revokes the calling bearer token (resident session or admin pairing token) and the resident's push tokens. Cookie users are signed out in the browser.
export async function POST(request:Request){try{assertOrigin(request);const who=await identity(request,{allowRegistration:true,allowBlocked:true});await revokeCurrentToken(who);return Response.json({loggedOut:true,browserSignOut:who.tokenHash?null:'/signout-with-chatgpt?return_to=/app/'});}catch(e){return apiError(e);}}
