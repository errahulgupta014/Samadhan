/**
 * Typed client for the SAMADHAN portal API (contract: docs/RESIDENT_AUTH_API.md).
 *
 * Every call goes through `call()`, which owns the timeout, JSON parsing and error shape (ApiError). A 401 on a call made with a
 * session token is reported to the app (onUnauthorized) so it can clear the session and show the login screen from anywhere.
 */
import {Platform} from 'react-native';
import Constants from 'expo-constants';
import type {AppConfig, Workspace} from '../shared/domain';
import type {PublicWard} from '../shared/community';
import {sanitizeAppConfig} from './appConfig';

/** The portal origin plus the bearer token (resident session, or the short-lived registration token during sign-up). */
export type Connection = {url: string; token: string};

/** Native default for local development: the Android emulator reaches the host machine at 10.0.2.2. */
const DEV_API = Platform.OS === 'android' ? 'http://10.0.2.2:5173' : 'http://localhost:5173';

/** Portal origin. Web: the origin that serves the app. Native: `extra.apiUrl` (EXPO_PUBLIC_API_URL in app.config.js), else the dev default. */
export function getApiBase(): string {
  if (Platform.OS === 'web') return typeof window !== 'undefined' ? window.location.origin : '';
  const configured: unknown = Constants.expoConfig?.extra?.apiUrl;
  const base = typeof configured === 'string' && configured.trim() ? configured.trim() : DEV_API;
  return base.replace(/\/+$/, '');
}

/* ------------------------------------------------------------------ errors */

export type ApiErrorKind = 'network' | 'timeout' | 'http';

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number;
  /** Latest workspace snapshot the server sends with a rejected (e.g. version-conflict) action. */
  readonly data?: Workspace;
  readonly version?: number;
  readonly retryAfter?: number;
  /** Machine-readable reason from the server, e.g. 'account_blocked'. */
  readonly code?: string;
  constructor(message: string, init: {kind?: ApiErrorKind; status?: number; data?: Workspace; version?: number; retryAfter?: number; code?: string} = {}) {
    super(message);
    this.name = 'ApiError';
    this.kind = init.kind ?? 'http';
    this.status = init.status ?? 0;
    this.data = init.data;
    this.version = init.version;
    this.retryAfter = init.retryAfter;
    this.code = init.code;
  }
}

let unauthorizedHandler: ((token: string, reason?: 'blocked') => void) | null = null;
/** Registers the app-wide reaction to a 401 (called with the token that was rejected). */
export function onUnauthorized(handler: ((token: string, reason?: 'blocked') => void) | null) {
  unauthorizedHandler = handler;
}
/** For callers that use fetch directly (e.g. the category catalogue). */
export function reportUnauthorized(token: string, reason?: 'blocked') {
  if (token) unauthorizedHandler?.(token, reason);
}

const CALL_TIMEOUT_MS = 12000;
const UPLOAD_TIMEOUT_MS = 40000;
/** The pre-login configuration is a nicety: it gets a short leash and never delays anything. */
const PUBLIC_CONFIG_TIMEOUT_MS = 5000;

type CallOptions = {method?: 'GET' | 'POST'; token?: string; body?: unknown; form?: FormData; timeoutMs?: number};

async function call<T>(base: string, path: string, {method, token, body, form, timeoutMs = CALL_TIMEOUT_MS}: CallOptions = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(base.replace(/\/+$/, '') + path, {
      method: method ?? (body !== undefined || form ? 'POST' : 'GET'),
      signal: controller.signal,
      headers: {...(token ? {Authorization: `Bearer ${token}`} : {}), ...(body !== undefined ? {'Content-Type': 'application/json'} : {})},
      ...(form ? {body: form} : body !== undefined ? {body: JSON.stringify(body)} : {}),
    });
  } catch (e) {
    if (controller.signal.aborted) throw new ApiError('The request timed out.', {kind: 'timeout'});
    throw new ApiError(e instanceof Error ? e.message : 'Network request failed.', {kind: 'network'});
  } finally {
    clearTimeout(timer);
  }
  let json: any = null;
  try {
    json = await response.json();
  } catch {
    // Non-JSON body (proxy error page, empty 204): handled below by status.
  }
  if (!response.ok) {
    if (response.status === 401 && token) reportUnauthorized(token);
    // An administrator blocked this account: end the session everywhere and say why on the login screen.
    if (response.status === 403 && json?.code === 'account_blocked' && token) reportUnauthorized(token, 'blocked');
    const retry = Number(response.headers.get('Retry-After') ?? json?.retryAfter);
    throw new ApiError(typeof json?.error === 'string' && json.error ? json.error : `Request failed (${response.status}).`, {
      status: response.status,
      data: json?.data,
      version: json?.version,
      code: typeof json?.code === 'string' ? json.code : undefined,
      retryAfter: Number.isFinite(retry) && retry > 0 ? retry : undefined,
    });
  }
  return json as T;
}

/* ------------------------------------------------------------------ mobile */

/** Indian mobile number rules shared with the server: strip spaces, +91 and a leading 0, then ^[6-9]\d{9}$. */
export function cleanMobile(raw: string): string {
  let digits = raw.replace(/\D/g, '');
  if (digits.length > 10 && digits.startsWith('91')) digits = digits.slice(2);
  if (digits.length > 10 && digits.startsWith('0')) digits = digits.slice(1);
  return digits.slice(0, 10);
}
export const isValidMobile = (digits: string) => /^[6-9]\d{9}$/.test(digits);

/* ------------------------------------------------------- public (no auth) */

export async function fetchWards(base: string): Promise<PublicWard[]> {
  const result = await call<{wards?: PublicWard[]}>(base, '/api/wards');
  if (!Array.isArray(result?.wards)) throw new ApiError('Invalid ward list.', {status: 500});
  return result.wards;
}

/** Absolute URL of a ward member's public photo, or undefined when the ward has none. */
export const wardPhotoUri = (base: string, ward?: Pick<PublicWard, 'memberPhotoUrl'> | null) => (ward?.memberPhotoUrl ? base.replace(/\/+$/, '') + ward.memberPhotoUrl : undefined);

/** GET /api/app-config: the remote configuration before login (tabs, org label, support, maintenance, minimum version). Always sanitised. */
export type PublicConfig = {appConfig: AppConfig};
export async function fetchPublicConfig(base: string): Promise<PublicConfig> {
  const result = await call<{appConfig?: unknown}>(base, '/api/app-config', {timeoutMs: PUBLIC_CONFIG_TIMEOUT_MS});
  if (!result || typeof result !== 'object' || !result.appConfig || typeof result.appConfig !== 'object') throw new ApiError('Invalid app configuration.', {status: 500});
  // The response also carries legacy ward / city / contact labels; the app never shows them (a resident's ward comes from their own profile).
  return {appConfig: sanitizeAppConfig(result.appConfig)};
}

export const sendOtp = (base: string, mobile: string) => call<{ok: true; expiresIn: number; retryAfter: number}>(base, '/api/resident-auth', {body: {action: 'send-otp', mobile}});

/** registered:true -> `token` is a resident session. registered:false -> `token` is a 30-minute registration token (photo upload + register only). */
export const verifyOtp = (base: string, mobile: string, code: string) => call<{token: string; registered: boolean}>(base, '/api/resident-auth', {body: {action: 'verify-otp', mobile, code}});

export type Registration = {name: string; wardId: string; email?: string; address: string; photoId: string; consent: true};

export const registerResident = (base: string, registrationToken: string, details: Registration) =>
  call<{token: string}>(base, '/api/resident-auth', {token: registrationToken, body: {action: 'register', ...details}});

/* --------------------------------------------------- authenticated session */

export const logoutRemote = (c: Connection) => call<{ok: true}>(c.url, '/api/resident-auth', {token: c.token, body: {action: 'logout'}});

/** GET (no body) or POST an action to the resident workspace. Rejections carry the latest `data` and `version` when the server sends them. */
export async function request(c: Connection, body?: Record<string, unknown>): Promise<{data: Workspace; version: number} & Record<string, any>> {
  return call(c.url, '/api/workspace?view=resident', {token: c.token, ...(body ? {body} : {})});
}

/** Uploads an image (camera or gallery) and returns its media id. */
export async function upload(c: Connection, uri: string, mime = 'image/jpeg'): Promise<string> {
  const form = new FormData();
  if (Platform.OS === 'web') {
    const blob = await (await fetch(uri)).blob();
    form.append('file', blob, mime === 'image/png' ? 'photo.png' : 'photo.jpg');
  } else {
    form.append('file', {uri, type: mime, name: mime === 'image/png' ? 'photo.png' : 'photo.jpg'} as any);
  }
  const result = await call<{id?: string}>(c.url, '/api/media', {token: c.token, form, timeoutMs: UPLOAD_TIMEOUT_MS});
  if (!result?.id) throw new ApiError('Photo upload failed.', {status: 500});
  return result.id;
}

/** Image source for a private media id (resident photo, complaint evidence, ad image). */
export const mediaSource = (c: Connection, id: string) => ({
  uri: `${c.url}/api/media?id=${encodeURIComponent(id)}`,
  headers: c.token ? {Authorization: `Bearer ${c.token}`} : undefined,
});
