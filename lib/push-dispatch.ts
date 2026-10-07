import * as workers from 'cloudflare:workers';
import {database} from './server';
import {sendExpoPush, type PushMessage} from './push';
import {pushChannelFor, type PushItem} from './notifications';

/**
 * Server side of push: looks up the Expo tokens registered by residents (resident_push_tokens), sends via lib/push.ts and records the outcome in
 * push_jobs (token values are never stored there). Entirely best effort: every failure is swallowed so the request that caused it never fails.
 */
const KEEP_JOBS_MS = 30 * 24 * 3600 * 1000;

export async function runPush(owner: string, items: PushItem[], now = Date.now()): Promise<void> {
 try {
  if (!items.length) return;
  const db = database();
  const {results} = await db.prepare('SELECT token,resident_id FROM resident_push_tokens WHERE owner = ?').bind(owner).all<{token: string; resident_id: string}>();
  const tokens = new Map<string, string[]>();
  for (const row of results) tokens.set(row.resident_id, [...(tokens.get(row.resident_id) ?? []), row.token]);
  const messages: PushMessage[] = items.flatMap(item => (tokens.get(item.residentId) ?? []).map(to => ({to, title: item.title, body: item.body, channelId: pushChannelFor(item.data.kind), data: item.data})));
  if (!messages.length) return;
  const result = await sendExpoPush(messages);
  const kind = (items[0].data.type as string) ?? 'push', at = new Date(now).toISOString();
  const statements = [
   db.prepare('INSERT INTO push_jobs (id,owner,classified_id,status,created_at,detail) VALUES (?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), owner, items[0].subject, result.status, at, JSON.stringify({kind, devices: messages.length, sent: result.sent, failed: result.failed, unregistered: result.invalidTokens.length, errors: result.errors})),
   db.prepare('DELETE FROM push_jobs WHERE owner = ? AND created_at < ?').bind(owner, new Date(now - KEEP_JOBS_MS).toISOString()),
   ...[...new Set(result.invalidTokens)].map(token => db.prepare('DELETE FROM resident_push_tokens WHERE owner = ? AND token = ?').bind(owner, token)),
  ];
  await db.batch(statements);
 } catch (e) {
  console.error('SAMADHAN push dispatch failed', (e as Error)?.message);
 }
}

/** Runs the push after the response using the platform's waitUntil; without it, awaits briefly so the work is not cancelled with the request. */
export async function pushInBackground(owner: string, items: PushItem[]): Promise<void> {
 if (!items.length) return;
 const work = runPush(owner, items);
 const waitUntil = (workers as unknown as {waitUntil?: (promise: Promise<unknown>) => void}).waitUntil;
 if (typeof waitUntil === 'function') {
  try {waitUntil(work); return;} catch {/* no active request context: fall through */}
 }
 await Promise.race([work, new Promise(resolve => setTimeout(resolve, 3000))]);
}
