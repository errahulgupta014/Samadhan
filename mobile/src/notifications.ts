/**
 * Phone push (native only; notifications.web.ts is the no-op web twin with the same exports).
 *
 * Push is a best-effort extra on top of the in-app notifications page: every function here swallows failures (permission denied,
 * simulator, no EAS project id, offline), so it can never break sign-in or crash the app. The token is registered per device and
 * the server decides what to send (complaint updates always, classifieds and activities only when the resident has them switched on).
 */
import {Platform} from 'react-native';
import {useEffect, useRef} from 'react';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import {clearPushToken, loadPushToken, savePushToken} from './session';
import {parsePushTarget, type PushTarget} from './pushTarget';

export type {PushTarget} from './pushTarget';

try {
  // Show pushes that arrive while the app is open (as a banner) so the resident sees the update immediately.
  Notifications.setNotificationHandler({
    handleNotification: async () => ({shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false}),
  });
} catch {
  // Notification module unavailable in this runtime: nothing to configure.
}

async function ensureChannels() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', {name: 'General', importance: Notifications.AndroidImportance.DEFAULT});
  await Notifications.setNotificationChannelAsync('complaints', {name: 'Complaint updates', importance: Notifications.AndroidImportance.HIGH});
  await Notifications.setNotificationChannelAsync('classifieds', {name: 'Community classifieds', importance: Notifications.AndroidImportance.DEFAULT});
  await Notifications.setNotificationChannelAsync('activities', {name: 'Campaigns and programmes', importance: Notifications.AndroidImportance.DEFAULT});
}

const isGranted = (p: Notifications.NotificationPermissionsStatus) =>
  p.granted ||
  p.ios?.status === Notifications.IosAuthorizationStatus.AUTHORIZED ||
  p.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL ||
  p.ios?.status === Notifications.IosAuthorizationStatus.EPHEMERAL;

/**
 * Asks for permission once (never nags after a refusal), gets this phone's Expo push token and hands it to `send`
 * (which calls the `register-push` workspace action). Silently does nothing on simulators, without an EAS project id,
 * or when the resident declined notifications.
 */
export async function registerPush(send: (token: string) => Promise<unknown>): Promise<void> {
  try {
    if (Platform.OS === 'web' || !Device.isDevice) return;
    const projectId: unknown = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (typeof projectId !== 'string' || !projectId) return;
    await ensureChannels();
    let permission = await Notifications.getPermissionsAsync();
    if (!isGranted(permission) && permission.status === Notifications.PermissionStatus.UNDETERMINED) permission = await Notifications.requestPermissionsAsync();
    if (!isGranted(permission)) return;
    const token = (await Notifications.getExpoPushTokenAsync({projectId})).data;
    await send(token);
    await savePushToken(token);
  } catch {
    // Best effort: the notifications page works without push.
  }
}

/** Removes this phone's token from the signed-in resident (logout). Never throws; the stored token is forgotten either way. */
export async function unregisterPush(send: (token: string) => Promise<unknown>): Promise<void> {
  try {
    const token = await loadPushToken();
    if (token) await send(token);
  } catch {
    // Offline or already signed out: the session is revoked right after this anyway.
  } finally {
    await clearPushToken();
  }
}

/** Mirrors the unread total on the app icon where the platform allows it. */
export async function setAppBadge(count: number): Promise<void> {
  try {
    await Notifications.setBadgeCountAsync(Math.max(0, count));
  } catch {
    // No badge permission or unsupported launcher.
  }
}

/**
 * Push events while signed in: `onTap` fires once per tapped notification (including the one that cold-started the app, once
 * `enabled` is true), `onReceive` fires when a push arrives while the app is open so counts can refresh.
 */
export function usePushEvents({enabled, onTap, onReceive}: {enabled: boolean; onTap: (target: PushTarget) => void; onReceive: () => void}) {
  const last = Notifications.useLastNotificationResponse();
  const handled = useRef<string | null>(null);
  // The handlers change on every render of the app; keep the newest ones in a ref so the subscriptions below stay put.
  const latest = useRef({onTap, onReceive});
  useEffect(() => {
    latest.current = {onTap, onReceive};
  });
  useEffect(() => {
    if (!enabled || !last || last.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const id = last.notification.request.identifier;
    if (handled.current === id) return;
    handled.current = id;
    latest.current.onTap(parsePushTarget(last.notification.request.content.data));
  }, [enabled, last]);
  useEffect(() => {
    if (!enabled) return;
    const subscription = Notifications.addNotificationReceivedListener(() => latest.current.onReceive());
    return () => subscription.remove();
  }, [enabled]);
}
