/**
 * Shared, UI-independent label helpers: the in/hi translation helper, complaint
 * status and category labels (English + Hindi), and locale-aware dates.
 *
 * Complaint status strings and category names come from the server in English.
 * Screens route them through statusLabel() / categoryLabel() so Hindi residents
 * never see raw English values.
 */
import type {ComponentProps} from 'react';
import type Ionicons from '@expo/vector-icons/Ionicons';
import type {Complaint, IssueCategory, Status} from '../shared/domain';
import type {PublicWard} from '../shared/community';

export type IconName = ComponentProps<typeof Ionicons>['name'];

/** `t(en, hi)` picks the string for the active language. */
export type Translate = (en: string, hi: string) => string;
export const translator =
  (hindi: boolean): Translate =>
  (en, hi) =>
    hindi ? hi : en;

/* ------------------------------------------------------------------ status */

export type StatusTone = 'info' | 'progress' | 'attention' | 'success' | 'danger' | 'neutral';

type StatusMeta = {hi: string; tone: StatusTone; icon: IconName};

const STATUS: Record<Status, StatusMeta> = {
  Submitted: {hi: 'दर्ज की गई', tone: 'info', icon: 'paper-plane-outline'},
  Acknowledged: {hi: 'स्वीकार की गई', tone: 'info', icon: 'eye-outline'},
  Assigned: {hi: 'टीम को सौंपी गई', tone: 'progress', icon: 'people-outline'},
  'In Progress': {hi: 'प्रगति में', tone: 'progress', icon: 'construct-outline'},
  'On Hold': {hi: 'रुकी हुई', tone: 'neutral', icon: 'pause-circle-outline'},
  'Resolution Proposed': {hi: 'समाधान प्रस्तावित', tone: 'attention', icon: 'help-circle-outline'},
  Closed: {hi: 'बंद', tone: 'success', icon: 'checkmark-circle-outline'},
  Reopened: {hi: 'फिर से खोली गई', tone: 'danger', icon: 'refresh-circle-outline'},
  'Rejected / Duplicate': {hi: 'अस्वीकृत / डुप्लिकेट', tone: 'neutral', icon: 'close-circle-outline'},
};

const UNKNOWN_STATUS: StatusMeta = {hi: '', tone: 'neutral', icon: 'ellipse-outline'};

export function statusMeta(status: string): StatusMeta {
  return STATUS[status as Status] ?? UNKNOWN_STATUS;
}

/** Status text for the active language. Unknown statuses are shown as sent by the server. */
export function statusLabel(status: string, hindi: boolean): string {
  const meta = STATUS[status as Status];
  return hindi && meta ? meta.hi : status;
}

/** Filter keys used by the "My complaints" list. */
export const COMPLAINT_FILTERS = ['All', 'Open', 'To confirm', 'Closed'] as const;
export type ComplaintFilter = (typeof COMPLAINT_FILTERS)[number];

const FILTER_HI: Record<ComplaintFilter, string> = {All: 'सभी', Open: 'खुली', 'To confirm': 'पुष्टि करें', Closed: 'बंद'};
export const filterLabel = (filter: ComplaintFilter, hindi: boolean) => (hindi ? FILTER_HI[filter] : filter);

/* ---------------------------------------------------------------- category */

/**
 * Category name for a complaint. Complaints store the English category name;
 * the workspace category catalogue carries the Hindi one.
 */
export function categoryLabel(
  complaint: Pick<Complaint, 'category' | 'categoryId'>,
  catalogue: IssueCategory[] | undefined,
  hindi: boolean,
): string {
  if (!hindi) return complaint.category;
  const match = catalogue?.find(c => (complaint.categoryId ? c.id === complaint.categoryId : c.nameEn === complaint.category));
  return match?.nameHi || complaint.category;
}

/* ------------------------------------------------------------------- other */

const NOTICE_HI: Record<string, string> = {'Service notice': 'सेवा सूचना', Important: 'महत्वपूर्ण', Event: 'कार्यक्रम', Emergency: 'आपातकालीन'};

/** Announcement priority label: Service notice, Important, Event or Emergency (anything else is shown as sent). */
export const noticeLabel = (value: string, hindi: boolean) => (hindi ? NOTICE_HI[value] ?? value : value);

/** Locale for dates: Hindi (India) or English (India). */
export const localeFor = (hindi: boolean) => (hindi ? 'hi-IN' : 'en-IN');

export const formatDate = (value: string, hindi: boolean) => new Date(value).toLocaleDateString(localeFor(hindi));

export const formatDateTime = (value: string, hindi: boolean) => new Date(value).toLocaleString(localeFor(hindi));

/** Active-language text with English fallback: `localized(hindi, ad.title, ad.titleHi)`. */
export const localized = (hindi: boolean, en: string, hi?: string) => (hindi && hi ? hi : en);

const DATE_PARTS: Intl.DateTimeFormatOptions = {day: 'numeric', month: 'short', year: 'numeric'};
const TIME_PARTS: Intl.DateTimeFormatOptions = {hour: 'numeric', minute: '2-digit'};

/** "10 Oct 2026, 9:00 am": date and time without seconds, for event times. */
export const formatDateTimeShort = (value: string, hindi: boolean) => new Date(value).toLocaleString(localeFor(hindi), {...DATE_PARTS, ...TIME_PARTS});

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/**
 * Compact date range for event cards: "10 Oct 2026, 9:00 am - 1:00 pm" when it starts and ends on the same day,
 * otherwise "10 Oct 2026 - 12 Oct 2026". Unparseable dates fall back to the raw text.
 */
export function formatDateRange(startsAt: string, endsAt: string, hindi: boolean): string {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [startsAt, endsAt].filter(Boolean).join(' – ');
  const locale = localeFor(hindi);
  if (sameDay(start, end)) return `${start.toLocaleDateString(locale, DATE_PARTS)}, ${start.toLocaleTimeString(locale, TIME_PARTS)} – ${end.toLocaleTimeString(locale, TIME_PARTS)}`;
  return `${start.toLocaleDateString(locale, DATE_PARTS)} – ${end.toLocaleDateString(locale, DATE_PARTS)}`;
}

/** Relative time for the notification list ("5 min ago"), falling back to the date after two days. */
export function timeAgo(value: string, hindi: boolean, now: number = Date.now()): string {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return '';
  const minutes = Math.max(0, Math.floor((now - time) / 60000));
  if (minutes < 1) return hindi ? 'अभी' : 'Just now';
  if (minutes < 60) return hindi ? `${minutes} मिनट पहले` : `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hindi ? `${hours} घंटे पहले` : `${hours} hr ago`;
  if (hours < 48) return hindi ? 'कल' : 'Yesterday';
  return formatDate(value, hindi);
}

/* -------------------------------------------------------------------- ward */

type WardNames = Pick<PublicWard, 'number' | 'name' | 'nameHi'>;

/** "Ward 7 · Gandhi Nagar". When the ward's own name already carries its number ("Ward 7") the name is used alone. */
export function wardTitle(ward: WardNames, hindi: boolean): string {
  const name = (hindi && ward.nameHi ? ward.nameHi : ward.name).trim();
  const number = ward.number.trim();
  if (!number) return name;
  const prefix = hindi ? `वार्ड ${number}` : `Ward ${number}`;
  const escaped = number.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return !name || new RegExp(`(^|\\D)${escaped}(\\D|$)`).test(name) ? name || prefix : `${prefix} · ${name}`;
}

/** Ward member name for the active language. */
export const wardMember = (ward: Pick<PublicWard, 'memberName' | 'memberNameHi'>, hindi: boolean) => (hindi && ward.memberNameHi ? ward.memberNameHi : ward.memberName);

/** "Ward member: Name", or a gentle placeholder while the ward has no member recorded yet. */
export const wardMemberLine = (ward: Pick<PublicWard, 'memberName' | 'memberNameHi'>, hindi: boolean) =>
  `${hindi ? 'वार्ड सदस्य' : 'Ward member'}: ${wardMember(ward, hindi) || (hindi ? 'अभी घोषित नहीं' : 'not announced yet')}`;

/**
 * The resident's own ward line ("Ward 7 · Gandhi Nagar · Rampur"), from the ward record the resident registered in (`data.ward`).
 * Nothing else is ever substituted: without a ward record the line is empty and callers show nothing.
 */
export function residentPlace(ward: (WardNames & Pick<PublicWard, 'city'>) | null | undefined, hindi: boolean): string {
  if (!ward) return '';
  return [wardTitle(ward, hindi), ward.city.trim()].filter(Boolean).join(' · ');
}
