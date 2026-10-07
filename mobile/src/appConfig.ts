/**
 * Remote app configuration (edited in the admin portal): pure, UI-free rules shared by every screen.
 *
 * The server sends it twice: publicly before login (GET /api/app-config) and inside the workspace after login
 * (data.settings.appConfig). Either way it is read through sanitizeAppConfig(), so a missing, partial or malformed payload
 * can only ever fall back to the defaults (everything visible, no support block, no maintenance, no minimum version).
 */
import {defaultAppConfig, resolveAppConfig, type Announcement, type AppConfig} from '../shared/domain';
import type {UnreadCounts} from '../shared/community';

const record = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
/** A section is hidden only by an explicit `false`; a missing or malformed flag keeps it visible. */
const flag = (value: unknown) => value !== false;
/** Links open only as https, whatever the server sends. */
export const httpsUrl = (value: unknown) => {
  const raw = text(value);
  return raw.length <= 2000 && /^https:\/\/[^\s/?#][^\s]*$/i.test(raw) ? raw : '';
};

/** Resolves a raw server value into a complete, well-typed AppConfig. */
export function sanitizeAppConfig(raw: unknown): AppConfig {
  const c = resolveAppConfig(record(raw) as Partial<AppConfig>);
  const org = record(c.orgLabel);
  const support = record(c.support);
  const tabs = record(c.tabs);
  const tiles = record(c.tiles);
  const maintenance = record(c.maintenance);
  return {
    orgLabel: {en: text(org.en), hi: text(org.hi)},
    support: {phone: text(support.phone), email: text(support.email), hoursEn: text(support.hoursEn), hoursHi: text(support.hoursHi)},
    termsUrl: httpsUrl(c.termsUrl),
    privacyUrl: httpsUrl(c.privacyUrl),
    tabs: {classifieds: flag(tabs.classifieds), activities: flag(tabs.activities), city: flag(tabs.city)},
    tiles: {classifieds: flag(tiles.classifieds), activities: flag(tiles.activities), city: flag(tiles.city), notices: flag(tiles.notices)},
    maintenance: {enabled: maintenance.enabled === true, messageEn: text(maintenance.messageEn), messageHi: text(maintenance.messageHi)},
    minAppVersion: text(c.minAppVersion),
  };
}

/** Stable text form of a config, to tell whether anything changed. */
export const configSignature = (config: AppConfig) => JSON.stringify(config);

/* ------------------------------------------------------------------ labels */

/** Active-language text with fallback to the other language, so one filled-in language is never lost. */
const either = (hindi: boolean, en: string, hi: string) => (hindi ? hi || en : en || hi);

/** The authority's name in the active language ("Panchayat Samiti and Nagar Parishad" by default). */
export function orgLabel(config: AppConfig, hindi: boolean): string {
  const {orgLabel: org} = config;
  if (!org.en && !org.hi) return either(hindi, defaultAppConfig().orgLabel.en, defaultAppConfig().orgLabel.hi);
  return either(hindi, org.en, org.hi);
}

export const supportHours = (config: AppConfig, hindi: boolean) => either(hindi, config.support.hoursEn, config.support.hoursHi);

/** Message of the maintenance banner, or '' when the app is not in maintenance. */
export function maintenanceMessage(config: AppConfig, hindi: boolean): string {
  if (!config.maintenance.enabled) return '';
  return (
    either(hindi, config.maintenance.messageEn, config.maintenance.messageHi) ||
    (hindi ? 'SAMADHAN का रखरखाव चल रहा है। कुछ सुविधाएं अभी उपलब्ध नहीं हो सकती हैं।' : 'SAMADHAN is under maintenance. Some features may be unavailable for now.')
  );
}

/* ----------------------------------------------------------------- support */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const validEmail = (value: string) => value.length <= 254 && EMAIL_RE.test(value);

/** Dialable form of a free-text phone number ("+91 98765-43210" -> "+919876543210"), or '' when it has too few digits to call. */
export const dialable = (phone: string) => {
  const digits = phone.replace(/[^0-9]/g, '');
  return digits.length >= 3 ? `${phone.trim().startsWith('+') ? '+' : ''}${digits}` : '';
};

/** True when the "Need help?" card has anything to show. */
export const hasSupport = (config: AppConfig) => {
  const s = config.support;
  return !!(s.phone || validEmail(s.email) || s.hoursEn || s.hoursHi);
};

/* ---------------------------------------------------------------- sections */

/** Every screen the app can show; anything else in `?section=` is treated as Home. */
const SECTIONS = ['home', 'complaints', 'report', 'detail', 'notifications', 'profile', 'classifieds', 'activities', 'city', 'ad-detail', 'activity-detail', 'place-detail', 'notices'];

/**
 * Whether a screen may be shown. The Ads / Activities / City tabs (and their detail pages) follow `tabs`; Ward updates follows its
 * Home tile (it has no tab). Home, Complaints, Profile, the report flow and the notifications inbox are always available.
 */
export function sectionAvailable(config: AppConfig, section: string): boolean {
  switch (section) {
    case 'classifieds':
    case 'ad-detail':
      return config.tabs.classifieds;
    case 'activities':
    case 'activity-detail':
      return config.tabs.activities;
    case 'city':
    case 'place-detail':
      return config.tabs.city;
    case 'notices':
      return config.tiles.notices;
    default:
      return SECTIONS.includes(section);
  }
}

/** The screen to show for a requested one: unknown or switched-off sections (old deep links, stale history) land on Home. */
export const resolveSection = (config: AppConfig, section: string | undefined) => (section && sectionAvailable(config, section) ? section : 'home');

/** A Home tile needs its Home switch and, for Ads / Activities / City, its tab (a tile must never lead to a hidden section). */
export const tileVisible = (config: AppConfig, tile: keyof AppConfig['tiles']) => (tile === 'notices' ? config.tiles.notices : config.tiles[tile] && config.tabs[tile]);

/** Unread notifications the resident can actually open: those of switched-off sections are left out. */
export function visibleUnread(unread: UnreadCounts | undefined, config: AppConfig): number {
  if (!unread) return 0;
  return Math.max(0, unread.total - (config.tabs.classifieds ? 0 : unread.classifieds) - (config.tabs.activities ? 0 : (unread.activities ?? 0)));
}

/* ----------------------------------------------------------------- version */

/** "1.2.3" -> [1, 2, 3]. A trailing suffix ("1.2.3-beta.1") is ignored; missing parts count as 0. Anything else -> null. */
export function parseVersion(value: string | undefined | null): [number, number, number] | null {
  const match = /^\s*v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?![\d.])/.exec(value ?? '');
  return match ? [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)] : null;
}

/** Numeric (not text) comparison: negative when a < b, 0 when equal, positive when a > b. NaN when either is not a version. */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return NaN;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/**
 * True when the installed app is older than `minAppVersion`. The minimum must be a strict x.y.z (an empty or malformed value never
 * blocks), and an unknown installed version never blocks either: a configuration slip must not lock every resident out.
 */
export function updateRequired(installed: string | undefined | null, minAppVersion: string): boolean {
  if (!/^\d+\.\d+\.\d+$/.test(minAppVersion.trim())) return false;
  return compareVersions(installed ?? '', minAppVersion.trim()) < 0;
}

/* ----------------------------------------------------------- ward updates */

/** Moment a notice stops being shown. A date-only value ("2026-10-31") lasts until the end of that day. */
function expiryOf(endsAt: string | undefined): number | null {
  const raw = (endsAt ?? '').trim();
  if (!raw) return null;
  const time = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T23:59:59.999`).getTime() : new Date(raw).getTime();
  return Number.isFinite(time) ? time : null;
}

/** Published, unexpired ward updates, newest first. The server already filters; this guards against a stale list or clock drift. */
export function visibleAnnouncements(list: Announcement[] | undefined, now = Date.now()): Announcement[] {
  const stamp = (a: Announcement) => {
    const time = new Date(a.at).getTime();
    return Number.isFinite(time) ? time : 0;
  };
  return (list ?? [])
    .filter(a => (a.status === undefined || a.status === 'published') && (expiryOf(a.endsAt) ?? Infinity) > now)
    .map((a, index) => ({a, index}))
    .sort((x, y) => stamp(y.a) - stamp(x.a) || x.index - y.index)
    .map(({a}) => a);
}
