import { seedWorkspace } from '@/shared/domain';
import { database } from './server';
export async function loadWorkspace(owner:string){
 const db=database();
 let row=await db.prepare('SELECT body, version FROM workspaces WHERE owner = ?').bind(owner).first<{body:string;version:number}>();
 if(!row){
  await db.prepare('INSERT OR IGNORE INTO workspaces (owner, body, version) VALUES (?, ?, 1)').bind(owner,JSON.stringify(seedWorkspace())).run();
  row=await db.prepare('SELECT body, version FROM workspaces WHERE owner = ?').bind(owner).first<{body:string;version:number}>();
 }
 return row!;
}
