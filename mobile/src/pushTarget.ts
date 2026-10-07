/** Where a tapped push notification should take the resident. Shared by the native and web notification modules. */
export type PushTarget = {kind: 'complaint'; complaintId: string} | {kind: 'classified'; classifiedId: string} | {kind: 'activity'; activityId: string} | {kind: 'inbox'};

const text = (value: unknown) => (typeof value === 'string' ? value : '');

/**
 * Reads the notification `data` payload sent with the push message: `{kind, complaintId?, classifiedId?, activityId?}`.
 * Anything unrecognised opens the notifications page, so a tap always lands somewhere sensible.
 */
export function parsePushTarget(data: Record<string, unknown> | null | undefined): PushTarget {
  const complaintId = text(data?.complaintId);
  const classifiedId = text(data?.classifiedId);
  const activityId = text(data?.activityId);
  const kind = text(data?.kind) || text(data?.type);
  if (activityId && (kind === 'activity' || (!complaintId && !classifiedId && kind !== 'complaint' && kind !== 'classified'))) return {kind: 'activity', activityId};
  if (complaintId && kind !== 'classified' && kind !== 'activity') return {kind: 'complaint', complaintId};
  if (classifiedId && kind !== 'complaint' && kind !== 'activity') return {kind: 'classified', classifiedId};
  return {kind: 'inbox'};
}
