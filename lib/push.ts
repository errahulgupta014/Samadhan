/**
 * Expo push client (https://docs.expo.dev/push-notifications/sending-notifications/). No credentials are needed.
 * Best effort by design: it never throws, never blocks a request on failure, and reports what happened so the caller can record it in push_jobs.
 */
export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
export const EXPO_BATCH_SIZE = 100;
export const EXPO_TOKEN_PATTERN = /^(Exponent|Expo)PushToken\[[A-Za-z0-9_\-:.]{8,200}\]$/;

export type PushMessage = {to: string; title: string; body: string; channelId?: string; data?: Record<string, unknown>; sound?: 'default' | null; priority?: 'default' | 'normal' | 'high'};
export type PushResult = {status: 'sent' | 'partial' | 'failed' | 'skipped'; sent: number; failed: number; invalidTokens: string[]; errors: string[]};
export type PushOptions = {fetcher?: typeof fetch; timeoutMs?: number; url?: string};

/** True for an `ExponentPushToken[...]` / `ExpoPushToken[...]` string. */
export const isExpoPushToken = (token: unknown): token is string => typeof token === 'string' && EXPO_TOKEN_PATTERN.test(token);

export async function sendExpoPush(messages: PushMessage[], options: PushOptions = {}): Promise<PushResult> {
 const result: PushResult = {status: 'skipped', sent: 0, failed: 0, invalidTokens: [], errors: []};
 const valid = messages.filter(m => isExpoPushToken(m.to));
 result.failed += messages.length - valid.length;
 if (messages.length > valid.length) result.errors.push(`${messages.length - valid.length} malformed push tokens skipped`);
 const fetcher = options.fetcher ?? fetch, timeoutMs = options.timeoutMs ?? 8000;
 for (let i = 0; i < valid.length; i += EXPO_BATCH_SIZE) {
  const batch = valid.slice(i, i + EXPO_BATCH_SIZE);
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
   const response = await fetcher(options.url ?? EXPO_PUSH_URL, {method: 'POST', signal: controller.signal, headers: {Accept: 'application/json', 'Content-Type': 'application/json'}, body: JSON.stringify(batch.map(m => ({sound: 'default', priority: 'high', ...m})))});
   const json: any = await response.json().catch(() => null);
   if (!response.ok || !Array.isArray(json?.data)) {result.failed += batch.length; result.errors.push(`Expo responded ${response.status}${json?.errors?.[0]?.message ? `: ${String(json.errors[0].message).slice(0, 120)}` : ''}`); continue;}
   json.data.forEach((ticket: any, index: number) => {
    if (ticket?.status === 'ok') {result.sent++; return;}
    result.failed++;
    if (ticket?.details?.error === 'DeviceNotRegistered' && batch[index]) result.invalidTokens.push(batch[index].to);
    else if (result.errors.length < 5) result.errors.push(String(ticket?.message ?? ticket?.details?.error ?? 'Unknown push error').slice(0, 120));
   });
   // A malformed ticket list shorter than the batch counts the remainder as failed.
   if (json.data.length < batch.length) result.failed += batch.length - json.data.length;
  } catch (e) {
   result.failed += batch.length;
   if (result.errors.length < 5) result.errors.push(controller.signal.aborted ? 'Expo push timed out' : String((e as Error)?.message ?? e).slice(0, 120));
  } finally {
   clearTimeout(timer);
  }
 }
 result.status = !valid.length ? (result.failed ? 'failed' : 'skipped') : result.failed === 0 ? 'sent' : result.sent > 0 ? 'partial' : 'failed';
 return result;
}
