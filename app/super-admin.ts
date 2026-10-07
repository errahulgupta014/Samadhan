'use client';
import {useSyncExternalStore} from 'react';

/**
 * Only a Super Admin may delete records (the server answers 403 "Only a Super Admin can delete records." to everyone else), so every Delete control is left out of the page,
 * never just disabled, for any other role. Call `useIsSuperAdmin(data)` where the page has the workspace; its role is `data.viewer?.role`.
 * Pages that only receive a slice of the workspace (Categories, Banners, Wards, Admin Users) call `useIsSuperAdmin()`: the portal publishes the viewer's role here each time a workspace
 * arrives (use-workspace.ts), so it is the same value. Without a viewer nobody may delete. A stale page that still offers Delete gets the server's refusal shown inside the confirmation dialog.
 */
let published: string | undefined;
const listeners = new Set<() => void>();
export function publishViewerRole(role: string | undefined) {if (role === published) return; published = role; listeners.forEach(l => l());}
const subscribe = (l: () => void) => {listeners.add(l); return () => {listeners.delete(l);};};

export function useIsSuperAdmin(data?: {viewer?: {role?: string} | null} | null): boolean {
 const live = useSyncExternalStore(subscribe, () => published, () => undefined);
 return (data ? data.viewer?.role : live) === 'Super Admin';
}
