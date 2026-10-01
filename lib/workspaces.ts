import { seedWorkspace } from '@/shared/domain';
import { database } from './server';
import {addDemoCommunity} from './demo-community';
export async function loadWorkspace(owner:string){
 const db=database();
 let row=await db.prepare('SELECT body, version FROM workspaces WHERE owner = ?').bind(owner).first<{body:string;version:number}>();
 if(!row){
  await db.prepare('INSERT OR IGNORE INTO workspaces (owner, body, version) VALUES (?, ?, 1)').bind(owner,JSON.stringify(seedWorkspace())).run();
  row=await db.prepare('SELECT body, version FROM workspaces WHERE owner = ?').bind(owner).first<{body:string;version:number}>();
 }
 // One-time user-requested sample-content backfill, with optimistic concurrency.
 // The marker prevents archived or edited samples from being re-created later.
 const state=JSON.parse(row!.body);
 if(state.demoContentVersion!==1){
  addDemoCommunity(state);state.demoContentVersion=1;
  await db.prepare('UPDATE workspaces SET body = ?, version = version + 1 WHERE owner = ? AND version = ?').bind(JSON.stringify(state),owner,row!.version).run();
  row=await db.prepare('SELECT body, version FROM workspaces WHERE owner = ?').bind(owner).first<{body:string;version:number}>();
 }
 return row!;
}
