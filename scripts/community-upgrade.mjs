import fs from 'node:fs';
fs.writeFileSync('app/api/workspace/route.ts',"export {GET,POST} from '@/lib/workspace-api';\nexport const dynamic='force-dynamic';\n");
let domain=fs.readFileSync('shared/domain.ts','utf8').replace('export type Workspace = { categories:', 'export type Workspace = { profile?:ResidentProfile; classifiedNotifications?:boolean; classifieds?:Classified[]; places?:Place[]; municipality?:Municipality; notifications?:ResidentNotification[]; viewer?:Viewer; categories:');
fs.writeFileSync('shared/domain.ts',domain);
let source=fs.readFileSync('scripts/mobile-web.mjs','utf8').replace("cpSync('shared/domain.ts','mobile/shared/domain.ts');","cpSync('shared','mobile/shared',{recursive:true});");fs.writeFileSync('scripts/mobile-web.mjs',source);
// An independent resident API projection prevents the citizen app reading admin-only data.
let api=fs.readFileSync('mobile/src/api.ts','utf8').replace("+'/api/workspace'","+'/api/workspace?view=resident'");
api=api.replace("throw new Error(result.error||'Unable to connect to your ward.')","throw Object.assign(new Error(result.error||'Unable to connect to your ward.'),{status:response.status})");
api=api.replace("if(Platform.OS==='web')return {url:window.location.origin,token:''};", "if(Platform.OS==='web')return {url:window.location.origin,token:''};");
fs.writeFileSync('mobile/src/api.ts',api);
fs.cpSync('shared','mobile/shared',{recursive:true});
