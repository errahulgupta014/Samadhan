/**
 * Local persistence: the resident session (token + the API base URL it belongs to), the language choice and the registered push token.
 * SecureStore on native; localStorage on web. Every access is wrapped: storage can be unavailable (private windows, blocked site data),
 * and then the app still works for the current run, it just cannot remember anything.
 */
import {Platform} from 'react-native';
import * as SecureStore from 'expo-secure-store';
import {getApiBase, type Connection} from './api';
import {sanitizeAppConfig} from './appConfig';
import type {AppConfig} from '../shared/domain';

const SESSION_KEY = 'samadhan.session';
const LANGUAGE_KEY = 'samadhan.language';
const PUSH_KEY = 'samadhan.push';
const CONFIG_KEY = 'samadhan.appconfig';
// The previous build stored a manually pasted pairing connection under this key. It is never used again and is removed.
const LEGACY_KEY = 'samadhan.connection';

async function read(key: string): Promise<string | null> {
  try {
    return Platform.OS === 'web' ? window.localStorage.getItem(key) : await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

async function write(key: string, value: string): Promise<void> {
  try {
    if (Platform.OS === 'web') window.localStorage.setItem(key, value);
    else await SecureStore.setItemAsync(key, value);
  } catch {
    // Storage unavailable: keep going with in-memory state only.
  }
}

async function remove(key: string): Promise<void> {
  try {
    if (Platform.OS === 'web') window.localStorage.removeItem(key);
    else await SecureStore.deleteItemAsync(key);
  } catch {
    // Nothing to clean up.
  }
}

/**
 * The saved session, or null. A token only works on the server that issued it, so a session saved for a different API base
 * (for example after EXPO_PUBLIC_API_URL changed) is discarded instead of being sent to the wrong host.
 */
export async function loadSession(): Promise<Connection | null> {
  void remove(LEGACY_KEY);
  const raw = await read(SESSION_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<Connection>;
    if (typeof value.url === 'string' && typeof value.token === 'string' && value.token && value.url === getApiBase()) return {url: value.url, token: value.token};
  } catch {
    // Corrupt entry: fall through and clear it.
  }
  await remove(SESSION_KEY);
  return null;
}

export const saveSession = (connection: Connection) => write(SESSION_KEY, JSON.stringify({url: connection.url, token: connection.token}));
export const clearSession = () => remove(SESSION_KEY);

export async function loadLanguage(): Promise<boolean | null> {
  const value = await read(LANGUAGE_KEY);
  return value === 'hi' ? true : value === 'en' ? false : null;
}
export const saveLanguage = (hindi: boolean) => write(LANGUAGE_KEY, hindi ? 'hi' : 'en');

export const loadPushToken = () => read(PUSH_KEY);
export const savePushToken = (token: string) => write(PUSH_KEY, token);
export const clearPushToken = () => remove(PUSH_KEY);

/** Last good remote configuration for this API base, so maintenance, the minimum version and hidden tabs hold even when the next fetch fails. */
export async function loadConfigCache(base: string): Promise<AppConfig | null> {
  const raw = await read(CONFIG_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as {base?: unknown; appConfig?: unknown};
    if (value.base === base && value.appConfig && typeof value.appConfig === 'object') return sanitizeAppConfig(value.appConfig);
  } catch {
    // Corrupt entry: ignore it, the next successful fetch overwrites it.
  }
  return null;
}
export const saveConfigCache = (base: string, appConfig: AppConfig) => write(CONFIG_KEY, JSON.stringify({base, appConfig}));
