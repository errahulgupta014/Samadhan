import {Icon, IconTile, Text, bevel, cardSurface, colors, glass, radius, textStyles} from './Design';
import React from 'react';
import {StyleSheet, View} from 'react-native';
import type {Announcement, Workspace} from '../shared/domain';
import {visibleAnnouncements} from './appConfig';
import {formatDate, localized, noticeLabel, residentPlace, translator, type IconName} from './labels';

type Look = {fg: string; bg: string; edge: string; icon: IconName};

/** Priority look. Emergency and Important stand apart (red / saffron); every chip also carries an icon, so meaning never relies on colour alone. */
const LOOK: Record<string, Look> = {
  Emergency: {fg: colors.error, bg: colors.errorBg, edge: colors.error, icon: 'warning'},
  Important: {fg: colors.saffronText, bg: colors.saffronSoft, edge: colors.saffron, icon: 'alert-circle'},
  Event: {fg: colors.info, bg: colors.infoBg, edge: colors.info, icon: 'calendar'},
  'Service notice': {fg: colors.greenText, bg: colors.greenSoft, edge: colors.green, icon: 'megaphone'},
};
const NEUTRAL: Look = {fg: colors.textSecondary, bg: colors.inset, edge: colors.borderStrong, icon: 'information-circle'};
const lookOf = (priority: string): Look => LOOK[priority] ?? NEUTRAL;

/** Priority pill (Emergency / Important / Event / Service notice) in the active language. */
export function PriorityChip({priority, hindi}: {priority: string; hindi: boolean}) {
  const look = lookOf(priority);
  return (
    <View style={[s.chip, {backgroundColor: look.bg, ...bevel(look.bg, {lip: 2, level: 'flat'})}]}>
      <Icon name={look.icon} size={14} color={look.fg} />
      <Text style={[s.chipText, {color: look.fg}]}>{noticeLabel(priority, hindi)}</Text>
    </View>
  );
}

/**
 * Ward updates: the admin's published notices, newest first, in the resident's language (English when no Hindi was written).
 * Expired and archived notices are not shown.
 */
export default function WardUpdates({data, hindi}: {data: Workspace; hindi: boolean}) {
  const t = translator(hindi);
  const notices = visibleAnnouncements(data.announcements);
  const place = residentPlace(data.ward, hindi);
  return (
    <>
      {!!place && <Text style={s.eyebrow}>{place.toUpperCase()}</Text>}
      <Text accessibilityRole="header" style={s.h1}>
        {t('Ward updates', 'वार्ड की सूचनाएं')}
      </Text>
      {!notices.length && (
        <View style={s.empty}>
          <IconTile name="megaphone-outline" size={52} tone="green" />
          <Text style={s.emptyText}>{t('No ward updates right now. Announcements from your ward team will appear here.', 'अभी कोई सूचना नहीं है। वार्ड टीम की घोषणाएं यहां दिखाई देंगी।')}</Text>
        </View>
      )}
      {notices.map(notice => (
        <NoticeCard key={notice.id} notice={notice} hindi={hindi} />
      ))}
      {!!data.settings.contact && (
        <View style={s.contactRow}>
          <Icon name="call-outline" size={18} color={colors.textSecondary} />
          <Text style={[s.contact, s.flex]}>{data.settings.contact}</Text>
        </View>
      )}
    </>
  );
}

function NoticeCard({notice, hindi}: {notice: Announcement; hindi: boolean}) {
  const t = translator(hindi);
  const look = lookOf(notice.priority);
  const title = localized(hindi, notice.title, notice.titleHi);
  const body = localized(hindi, notice.body, notice.bodyHi);
  const posted = Number.isFinite(new Date(notice.at).getTime()) ? formatDate(notice.at, hindi) : '';
  const until = notice.endsAt && Number.isFinite(new Date(notice.endsAt).getTime()) ? formatDate(notice.endsAt, hindi) : '';
  const urgent = notice.priority === 'Emergency';
  return (
    <View
      accessible
      accessibilityLabel={`${noticeLabel(notice.priority, hindi)}. ${title}. ${body}${posted ? `. ${posted}` : ''}${until ? `. ${t('Valid until', 'मान्य तिथि')} ${until}` : ''}`}
      style={[s.card, {...cardSurface(glass(0.92, look.bg), {border: urgent || notice.priority === 'Important' ? look.edge : undefined})}]}>
      <View style={s.head}>
        <PriorityChip priority={notice.priority} hindi={hindi} />
        {!!posted && <Text style={s.date}>{posted}</Text>}
      </View>
      <Text style={s.title}>{title}</Text>
      {!!body && <Text style={s.body}>{body}</Text>}
      {!!until && (
        <View style={s.untilRow}>
          <Icon name="time-outline" size={14} color={colors.textSecondary} />
          <Text style={s.date}>
            {t('Valid until', 'मान्य तिथि')} {until}
          </Text>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  flex: {flex: 1},
  eyebrow: {...textStyles.eyebrow, marginTop: 10},
  h1: {...textStyles.h1, marginVertical: 13},
  empty: {alignItems: 'center', gap: 14, paddingVertical: 36},
  emptyText: {...textStyles.body, textAlign: 'center'},
  card: {padding: 18, marginTop: 14},
  head: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10},
  chip: {flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', flexShrink: 1, paddingVertical: 4, paddingHorizontal: 10, borderRadius: radius.pill},
  chipText: {fontSize: 12, lineHeight: 17, fontWeight: '700', flexShrink: 1},
  date: {...textStyles.caption},
  title: {...textStyles.h2, marginTop: 12},
  body: {...textStyles.body, marginTop: 6},
  untilRow: {flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12},
  contactRow: {flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 14},
  contact: {...textStyles.body},
});
