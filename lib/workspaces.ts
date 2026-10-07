import { seedWorkspace } from '@/shared/domain';
import { database } from './server';
import { upgradeLiveContent } from './live-content';
type Row = {body:string;version:number};
const read = (owner:string) => database().prepare('SELECT body, version FROM workspaces WHERE owner = ?').bind(owner).first<Row>();
export async function loadWorkspace(owner:string){
 const db=database();
 let row=await read(owner);
 if(!row){
  await db.prepare('INSERT OR IGNORE INTO workspaces (owner, body, version) VALUES (?, ?, 1)').bind(owner,JSON.stringify(seedWorkspace())).run();
  row=await read(owner);
 }
 // One-time, version-marked removal of seeded test content from workspaces stored before go-live (lib/live-content.ts).
 // Optimistic concurrency like every other write: if another request saved first, re-read and re-check instead of overwriting it.
 for(let attempt=0;attempt<3;attempt++){
  const state=JSON.parse(row!.body);
  if(!upgradeLiveContent(state))break;
  const saved=await db.prepare('UPDATE workspaces SET body = ?, version = version + 1 WHERE owner = ? AND version = ?').bind(JSON.stringify(state),owner,row!.version).run();
  row=await read(owner);
  if(saved.meta.changes)break;
 }
 return row!;
}
