// Web has no phone push: residents use the in-app notifications page. Same exports as notifications.ts, all no-ops.
import type {PushTarget} from './pushTarget';
export type {PushTarget} from './pushTarget';
export async function registerPush(_send: (token: string) => Promise<unknown>): Promise<void> {}
export async function unregisterPush(_send: (token: string) => Promise<unknown>): Promise<void> {}
export async function setAppBadge(_count: number): Promise<void> {}
export function usePushEvents(_events: {enabled: boolean; onTap: (target: PushTarget) => void; onReceive: () => void}) {}
