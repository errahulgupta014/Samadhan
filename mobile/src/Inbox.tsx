import {Text, Pressable, Button, Chip, Icon, IconTile, Notice, cardSurface, colors, glass, radius, textStyles} from './Design';
import {errorText} from './errors';
import {useAppConfig} from './appConfigContext';
import {timeAgo, translator, type IconName} from './labels';
import React, {useState} from 'react';
import {StyleSheet, View} from 'react-native';
import type {Workspace} from '../shared/domain';
import type {ResidentNotification} from '../shared/community';

type Props = {
  data: Workspace;
  hindi: boolean;
  act: (body: Record<string, unknown>) => Promise<any>;
  navigate: (page: string, id?: string) => void;
  openComplaint: (id: string) => void;
};

type Kind = ResidentNotification['kind'];
type Filter = 'all' | Kind;
const FILTERS: Filter[] = ['all', 'complaint', 'classified', 'activity'];
/** Classified and activity alerts have nowhere to go while their tab is switched off, so they are neither listed nor offered as a filter. */
const hiddenKind = (kind: Kind, tabs: {classifieds: boolean; activities: boolean}) => (kind === 'classified' && !tabs.classifieds) || (kind === 'activity' && !tabs.activities);

const kindOf = (n: ResidentNotification): Kind => n.kind ?? (n.complaintId ? 'complaint' : n.activityId ? 'activity' : 'classified');

const KIND_ICON: Record<Kind, {name: IconName; tone: 'navy' | 'saffron' | 'green'}> = {
  complaint: {name: 'document-text-outline', tone: 'navy'},
  classified: {name: 'pricetags-outline', tone: 'saffron'},
  activity: {name: 'calendar-outline', tone: 'green'},
};

/**
 * Notifications page: complaint updates, classified alerts and activity alerts, newest first, with an unread marker. Tapping one marks
 * it read and opens the complaint, the ad or the activity; "Mark all as read" clears the current filter.
 */
export default function Inbox({data, hindi, act, navigate, openComplaint}: Props) {
  const t = translator(hindi);
  const {tabs} = useAppConfig();
  const [filter, setFilter] = useState<Filter>('all');
  const [working, setWorking] = useState('');
  const [bulk, setBulk] = useState(false);
  const [error, setError] = useState('');

  const all = (data.notifications ?? []).filter(n => !hiddenKind(kindOf(n), tabs)).sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  const filters = FILTERS.filter(f => f === 'all' || !hiddenKind(f, tabs));
  // The chosen filter can disappear while the screen is open (the admin switches a tab off): fall back to "All".
  const active: Filter = filters.includes(filter) ? filter : 'all';
  const shown = active === 'all' ? all : all.filter(n => kindOf(n) === active);
  const unreadShown = shown.filter(n => !n.read).length;
  const filterLabel = (f: Filter) => (f === 'all' ? t('All', 'सभी') : f === 'complaint' ? t('Complaints', 'शिकायतें') : f === 'classified' ? t('Classifieds', 'विज्ञापन') : t('Activities', 'गतिविधियाँ'));

  async function open(n: ResidentNotification) {
    if (working) return;
    setError('');
    setWorking(n.id);
    try {
      if (!n.read) await act({action: 'read-notification', id: n.id});
    } catch (e) {
      // Marking as read is not worth blocking the resident from the complaint or ad itself.
      setError(errorText(e, t));
    } finally {
      setWorking('');
    }
    if (kindOf(n) === 'complaint') {
      if (n.complaintId) openComplaint(n.complaintId);
      else navigate('complaints');
    } else if (kindOf(n) === 'activity') {
      if (n.activityId) navigate('activity-detail', n.activityId);
      else navigate('activities');
    } else if (n.classifiedId) navigate('ad-detail', n.classifiedId);
    else navigate('classifieds');
  }

  async function markAll() {
    setError('');
    setBulk(true);
    try {
      await act({action: 'read-all-notifications', ...(active === 'all' ? {} : {kind: active})});
    } catch (e) {
      setError(errorText(e, t));
    } finally {
      setBulk(false);
    }
  }

  return (
    <>
      <Text style={s.eyebrow}>{t('FOR YOU', 'आपके लिए')}</Text>
      <Text accessibilityRole="header" style={s.h1}>
        {t('Notifications', 'सूचनाएं')}
      </Text>
      <View style={s.chips}>
        {filters.map(f => (
          <Chip key={f} label={filterLabel(f)} selected={active === f} onPress={() => setFilter(f)} />
        ))}
      </View>
      {tabs.classifieds && !data.profile?.classifiedNotifications && (active === 'all' || active === 'classified') && (
        <View style={s.notice}>
          <Text style={s.body}>{t('Turn on classified notifications in your profile to receive new local advertisements here.', 'नए स्थानीय विज्ञापनों की सूचना पाने के लिए प्रोफ़ाइल में विज्ञापन सूचनाएं चालू करें।')}</Text>
          <Button variant="secondary" title={t('Open profile', 'प्रोफ़ाइल खोलें')} onPress={() => navigate('profile')} />
        </View>
      )}
      {tabs.activities && data.profile?.activityNotifications === false && (active === 'all' || active === 'activity') && (
        <View style={s.notice}>
          <Text style={s.body}>{t('Turn on activity notifications in your profile to receive new campaigns and programmes here.', 'नए अभियानों और कार्यक्रमों की सूचना पाने के लिए प्रोफ़ाइल में गतिविधि सूचनाएं चालू करें।')}</Text>
          <Button variant="secondary" title={t('Open profile', 'प्रोफ़ाइल खोलें')} onPress={() => navigate('profile')} />
        </View>
      )}
      {unreadShown > 0 && (
        <Button
          variant="secondary"
          loading={bulk}
          disabled={bulk}
          icon={<Icon name="checkmark-done-outline" size={20} color={colors.navy} />}
          title={t('Mark all as read', 'सभी को पढ़ा हुआ चिह्नित करें')}
          onPress={() => void markAll()}
        />
      )}
      {!!error && <Notice tone="error">{error}</Notice>}
      {!shown.length && (
        <View style={s.empty}>
          <IconTile name="notifications-outline" size={56} tone="green" />
          <Text style={s.h2}>{t('You’re all caught up', 'आप अप टू डेट हैं')}</Text>
          <Text style={[s.muted, s.centered]}>{t('Updates on your complaints, local classifieds and activities will appear here.', 'आपकी शिकायतों, स्थानीय विज्ञापनों और गतिविधियों की जानकारी यहां दिखाई देगी।')}</Text>
        </View>
      )}
      {shown.map(n => {
        const kind = kindOf(n);
        const title = hindi && n.titleHi ? n.titleHi : n.title;
        const body = hindi && n.bodyHi ? n.bodyHi : n.body;
        const when = timeAgo(n.createdAt, hindi);
        return (
          <Pressable
            key={n.id}
            disabled={!!working}
            accessibilityRole="button"
            accessibilityLabel={`${n.read ? '' : t('Unread. ', 'अपठित। ')}${kind === 'complaint' ? t('Complaint', 'शिकायत') : kind === 'activity' ? t('Activity', 'गतिविधि') : t('Classified', 'विज्ञापन')}. ${title}. ${body}. ${when}`}
            style={[s.card, !n.read && s.unread]}
            onPress={() => void open(n)}>
            <IconTile name={KIND_ICON[kind].name} size={44} tone={KIND_ICON[kind].tone} />
            <View style={s.content}>
              <View style={s.titleRow}>
                <Text style={[s.title, !n.read && s.titleUnread]}>{title}</Text>
                {!n.read ? <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={s.dot} /> : null}
              </View>
              {!!body && (
                <Text numberOfLines={3} style={s.body}>
                  {body}
                </Text>
              )}
              <Text style={s.when}>{when}</Text>
            </View>
          </Pressable>
        );
      })}
    </>
  );
}

const s = StyleSheet.create({
  centered: {textAlign: 'center'},
  eyebrow: {...textStyles.eyebrow, marginVertical: 10},
  h1: {...textStyles.h1, marginBottom: 14},
  h2: {...textStyles.h2, marginVertical: 8},
  chips: {flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12},
  muted: {fontSize: 13, lineHeight: 20, color: colors.textSecondary},
  notice: {...cardSurface(glass(0.92, colors.greenSoft), {radius: radius.md}), padding: 16, marginVertical: 10},
  empty: {alignItems: 'center', paddingVertical: 35, paddingHorizontal: 20, gap: 10},
  card: {...cardSurface(glass(0.9), {radius: 22}), padding: 16, marginVertical: 8, flexDirection: 'row', gap: 14, alignItems: 'flex-start'},
  unread: {...cardSurface(glass(0.92, colors.greenSoft), {radius: 22, border: colors.green})},
  content: {flex: 1},
  titleRow: {flexDirection: 'row', alignItems: 'flex-start', gap: 8},
  title: {flex: 1, fontSize: 15, lineHeight: 22, fontWeight: '500', color: colors.navy},
  titleUnread: {fontWeight: '700'},
  dot: {width: 10, height: 10, borderRadius: 5, marginTop: 7, backgroundColor: colors.green, borderWidth: 2, borderColor: colors.white},
  body: {...textStyles.body, marginTop: 4},
  when: {fontSize: 12, lineHeight: 18, color: colors.textSecondary, marginTop: 8},
});
