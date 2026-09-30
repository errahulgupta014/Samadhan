import fs from 'node:fs';
const change=(file,fn)=>fs.writeFileSync(file,fn(fs.readFileSync(file,'utf8')));
change('app/community-panels.tsx',s=>s.replace('const j=await r.json();','const j=await r.json() as {error?:string;admins:Admin[]};'));
change('db/schema.ts',s=>s.replace("contentType:text('content_type').notNull()","contentType:text('content_type').notNull(),uploader:text('uploader')")+"\nexport const adminAccessEvents=sqliteTable('admin_access_events',{id:text('id').primaryKey(),owner:text('owner').notNull(),actor:text('actor').notNull(),subject:text('subject').notNull(),detail:text('detail').notNull(),createdAt:text('created_at').notNull()});\n");
change('lib/access-service.ts',s=>{
 s="import {validateAdminGrant} from './access-policy';\n"+s;
 const from=s.indexOf(' const email=');const to=s.indexOf(' await database().prepare(\'INSERT INTO admin_access',from);
 s=s.slice(0,from)+" const root=await database().prepare('SELECT email FROM platform_owner WHERE id = ?').bind('main').first<{email:string}>();\n const grant=validateAdminGrant(who.viewer,root!.email,input);const {email,role,permissions:allowed,active}=grant;const at=new Date().toISOString();\n"+s.slice(to);
 s=s.replace("await database().prepare('INSERT INTO admin_access", "await database().batch([database().prepare('INSERT INTO admin_access");
 s=s.replace("input.role,JSON.stringify([...new Set(allowed)]),input.active?1:0,new Date().toISOString()).run();", "role,JSON.stringify(allowed),active?1:0,at),database().prepare('INSERT INTO admin_access_events (id,owner,actor,subject,detail,created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(),who.owner,who.viewer.email??who.userId,email,JSON.stringify(grant),at)]);");
 return s;
});
change('lib/server.ts',s=>"import {requireAction} from './access-policy';\n"+s.replace("if(who.role!=='admin'||!who.viewer.permissions.includes(permission))throw new ServiceError('Your role does not have permission for this action.',403);", "requireAction(who.viewer,permission);"));
change('app/api/media/route.ts',s=>{
 s="import {loadWorkspace} from '@/lib/workspaces';\nimport {canReadMedia} from '@/lib/media-access';\n"+s;
 s=s.replace("INSERT INTO media (id, owner, content_type) VALUES (?, ?, ?)","INSERT INTO media (id, owner, content_type, uploader) VALUES (?, ?, ?, ?)").replace('.bind(id,who.owner,type).run()', '.bind(id,who.owner,type,who.residentId).run()');
 s=s.replace('SELECT content_type FROM media', 'SELECT content_type,uploader FROM media').replace('first<{content_type:string}>()', 'first<{content_type:string;uploader:string|null}>()');
 s=s.replace("const file=await env.BUCKET.get(id!);", "const state=JSON.parse((await loadWorkspace(who.owner)).body);if(!canReadMedia(state,who,id!,row.uploader))throw new ServiceError('Photograph not found.',404);const file=await env.BUCKET.get(id!);");
 s=s.replace("'Cache-Control':'private, max-age=60'", "'Cache-Control':'private, no-store'");return s;
});
change('lib/workspace-api.ts',s=>{
 s=s.replace("import {loadWorkspace}","import {canReadMedia} from './media-access';\nimport {loadWorkspace}");
 s=s.replace("if(!await database().prepare('SELECT id FROM media WHERE id = ? AND owner = ?').bind(id,who.owner).first())throw new ServiceError('Image not found in this workspace.',403);", "const media=await database().prepare('SELECT uploader FROM media WHERE id = ? AND owner = ?').bind(id,who.owner).first<{uploader:string|null}>();if(!media||!canReadMedia(state,who,id,media.uploader))throw new ServiceError('Image not found in this workspace.',403);");
 const from=s.indexOf(' const statements=[');const to=s.indexOf(' return Response.json({...result',from);
 s=s.slice(0,from)+` const statements=[];
 if(result.notificationCreated)statements.push(database().prepare('INSERT INTO push_jobs (id,owner,classified_id,status,created_at,detail) SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM workspaces WHERE owner = ? AND version = ?)').bind(crypto.randomUUID(),who.owner,result.classifiedId,'awaiting-provider',new Date().toISOString(),'In-app notification published. Remote push delivery requires Expo project credentials and a dispatcher.',who.owner,row.version));
 statements.push(database().prepare('UPDATE workspaces SET body = ?, version = version + 1 WHERE owner = ? AND version = ?').bind(JSON.stringify(state),who.owner,row.version));
 const saved=await database().batch(statements);if(!saved[saved.length-1].meta.changes)throw new ServiceError('Another update was saved first. Refresh and retry.',409);
`+s.slice(to);
 return s;
});
change('app/api/logout/route.ts',s=>s.replace("return Response.json({loggedOut:true", "await database().prepare('DELETE FROM resident_push_tokens WHERE owner = ? AND resident_id = ?').bind(who.owner,who.residentId).run();return Response.json({loggedOut:true"));
