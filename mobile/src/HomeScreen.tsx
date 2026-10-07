import {Text, Pressable, GradientButton, Icon, Glyph, IconButton, IconTile, LinkLabel, StatusBadge, cardSurface, colors, glass, radius, textStyles, tint, typeScale} from './Design';
import BrandingSlider from './BrandingSlider';
import type {Connection} from './api';
import React from 'react';
import {View, StyleSheet} from 'react-native';
import type {Workspace, Complaint} from '../shared/domain';
import {Chakra} from './Brand';
import {SupportCard} from './Support';
import {tileVisible, visibleUnread} from './appConfig';
import {useAppConfig} from './appConfigContext';
import {categoryLabel, residentPlace, translator, type IconName} from './labels';

type Props = {connection: Connection; data: Workspace; hindi: boolean; name: string; navigate: (page: string) => void; openComplaint: (c: Complaint) => void};

type Stat = {key: string; label: string; n: number; icon: IconName; fg: string; bg: string; accent: string};
type Service = {page: string; icon: IconName; label: string; caption: string; color: string; tile: 'classifieds' | 'activities' | 'city' | 'notices'};

export default function HomeScreen({connection, data, hindi, name, navigate, openComplaint}: Props) {
  const t = translator(hindi);
  const config = useAppConfig();
  // Unread notifications of switched-off sections (Ads, Activities) cannot be opened, so they are not counted.
  const unread = data.unread ? visibleUnread(data.unread, config) : (data.notifications?.filter(n => !n.read).length ?? 0);
  const place = residentPlace(data.ward, hindi);
  const stats: Stat[] = [
    {
      key: 'progress',
      label: t('In progress', 'प्रगति में'),
      n: data.complaints.filter(c => !['Closed', 'Resolution Proposed', 'Rejected / Duplicate'].includes(c.status)).length,
      icon: 'hourglass-outline',
      fg: colors.saffronText,
      bg: colors.saffronSoft,
      accent: colors.saffron,
    },
    {
      key: 'confirm',
      label: t('To confirm', 'पुष्टि करें'),
      n: data.complaints.filter(c => c.status === 'Resolution Proposed').length,
      icon: 'checkmark-done-outline',
      fg: colors.info,
      bg: colors.infoBg,
      accent: colors.navySoft,
    },
    {
      key: 'resolved',
      label: t('Resolved', 'समाधान हुआ'),
      n: data.complaints.filter(c => c.status === 'Closed').length,
      icon: 'shield-checkmark-outline',
      fg: colors.success,
      bg: colors.successBg,
      accent: colors.green,
    },
  ];
  const services = (
    [
      {page: 'classifieds', tile: 'classifieds', icon: 'pricetags-outline', label: t('Classifieds', 'विज्ञापन'), caption: t('Local opportunities', 'स्थानीय अवसर'), color: colors.saffron},
      {page: 'activities', tile: 'activities', icon: 'calendar-outline', label: t('Activities', 'गतिविधियाँ'), caption: t('Campaigns & programmes', 'अभियान और कार्यक्रम'), color: colors.green},
      {page: 'city', tile: 'city', icon: 'compass-outline', label: t('Explore city', 'अपना शहर'), caption: t('Places & heritage', 'स्थल और विरासत'), color: colors.navySoft},
      {page: 'notices', tile: 'notices', icon: 'megaphone-outline', label: t('Ward updates', 'वार्ड की खबर'), caption: t('Stay informed', 'नई जानकारी'), color: colors.green},
    ] satisfies Service[]
  ).filter(service => tileVisible(config, service.tile));

  return (
    <>
      <View style={s.greeting}>
        <View style={s.flex}>
          <Text style={s.eyebrow}>{t('WELCOME TO YOUR WARD', 'आपके वार्ड में स्वागत है')}</Text>
          <Text accessibilityRole="header" style={s.hello}>
            {t(`Welcome, ${name}`, `स्वागत है, ${name}`)}
          </Text>
          {!!place && (
            <View style={s.place}>
              <Icon name="location-outline" size={15} color={colors.textSecondary} />
              <Text style={s.placeText}>{place}</Text>
            </View>
          )}
          <Text style={s.welcomeCopy}>{t('Glad to have you with us. Report a problem, follow its progress and stay close to your ward.', 'आपका साथ पाकर अच्छा लगा। शिकायत दर्ज करें, उसकी प्रगति देखें और अपने वार्ड से जुड़े रहें।')}</Text>
        </View>
        <IconButton
          round
          size={48}
          badge={unread}
          icon="notifications-outline"
          label={hindi ? `सूचनाएं, ${unread} अपठित` : `Notifications, ${unread} unread`}
          onPress={() => navigate('notifications')}
          style={s.bell}
        />
      </View>

      <BrandingSlider settings={data.settings} connection={connection} hindi={hindi} />

      <View style={s.reportRow}>
        <View style={s.flex}>
          <Text accessibilityRole="header" style={s.reportTitle}>{t('Have a problem in your ward?', 'आपके वार्ड में कोई समस्या है?')}</Text>
          <Text style={s.reportCaption}>{t('Report it in a minute.', 'एक मिनट में दर्ज करें।')}</Text>
        </View>
        <GradientButton tone="saffron" level="sm" accessibilityLabel={t('Report a problem', 'शिकायत दर्ज करें')} onPress={() => navigate('report')} style={s.reportButton}>
          <Icon name="megaphone" size={18} color={colors.ink} />
          <Text style={s.reportButtonText}>{t('Report', 'शिकायत')}</Text>
        </GradientButton>
      </View>

      <View style={s.stats}>
        {stats.map(stat => (
          <View accessible accessibilityLabel={`${stat.label}: ${stat.n}`} style={[s.stat, {backgroundColor: glass(0.92, stat.bg), borderColor: tint(stat.accent, 0.6)}]} key={stat.key}>
            <IconTile name={stat.icon} size={36} color={stat.accent} />
            <Text style={[s.statNumber, {color: stat.fg}]}>{stat.n.toString().padStart(2, '0')}</Text>
            <Text style={s.statLabel}>{stat.label}</Text>
          </View>
        ))}
      </View>

      {services.length > 0 && (
        <>
          <View style={s.section}>
            <Text accessibilityRole="header" style={s.sectionTitle}>
              {t('Your city, connected', 'अपने शहर से जुड़ें')}
            </Text>
            <Chakra size={22} />
          </View>
          <View style={s.services}>
            {services.map(service => (
              <Pressable accessibilityRole="button" key={service.page} onPress={() => navigate(service.page)} style={s.service}>
                <IconTile name={service.icon} size={48} color={service.color} style={s.serviceIcon} />
                <Text style={s.serviceName}>{service.label}</Text>
                <Text style={s.serviceCaption}>{service.caption}</Text>
              </Pressable>
            ))}
          </View>
        </>
      )}

      <View style={s.section}>
        <Text accessibilityRole="header" style={s.sectionTitle}>
          {t('My recent complaints', 'मेरी हाल की शिकायतें')}
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel={t('View all complaints', 'सभी शिकायतें देखें')} hitSlop={8} onPress={() => navigate('complaints')}>
          <LinkLabel>{t('View all', 'सभी देखें')}</LinkLabel>
        </Pressable>
      </View>
      {!data.complaints.length && <Text style={s.empty}>{t('Your first step towards a better neighbourhood starts here.', 'बेहतर मोहल्ले की ओर पहला कदम यहीं से शुरू करें।')}</Text>}
      {data.complaints.slice(0, 3).map(c => (
        <Pressable accessibilityRole="button" accessibilityLabel={`${c.title}. ${categoryLabel(c, data.categories, hindi)}`} style={s.complaint} key={c.id} onPress={() => openComplaint(c)}>
          <View style={s.complaintTop}>
            <Text style={s.category}>{categoryLabel(c, data.categories, hindi)}</Text>
            <StatusBadge status={c.status} hindi={hindi} />
          </View>
          <Text style={s.complaintTitle}>{c.title}</Text>
          <View style={s.complaintBottom}>
            <Icon name="location-outline" size={15} color={colors.textSecondary} />
            <Text style={s.address}>{c.locality}</Text>
            <Glyph name="forward" size={18} color={colors.navy} />
          </View>
        </Pressable>
      ))}
      <SupportCard hindi={hindi} />
      <View style={s.footer}>
        <View style={[s.footerLine, {backgroundColor: colors.saffron}]} />
        <Text style={s.footerText}>जनता की बात, समाधान के साथ</Text>
        <View style={[s.footerLine, {backgroundColor: colors.flagGreen}]} />
      </View>
    </>
  );
}

const s = StyleSheet.create({
  reportRow: {...cardSurface(glass(0.92), {radius: radius.lg}), flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 16, marginTop: 18},
  reportTitle: {fontSize: typeScale.bodyMd.fontSize, lineHeight: 22, fontWeight: '700', color: colors.navy},
  reportCaption: {fontSize: 13, lineHeight: 19, color: colors.textSecondary, marginTop: 2},
  reportButton: {paddingVertical: 10, paddingHorizontal: 14, borderRadius: radius.pill},
  reportButtonText: {fontSize: 14, fontWeight: '700', color: colors.ink},
  flex: {flex: 1},
  greeting: {flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginTop: 8, marginBottom: 18},
  bell: {marginTop: 8, marginRight: 4},
  eyebrow: {...textStyles.eyebrow, color: colors.saffronText},
  hello: {...textStyles.h1, marginTop: 8, marginBottom: 0},
  place: {flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6},
  placeText: {...textStyles.caption, flexShrink: 1},
  welcomeCopy: {...textStyles.body, marginTop: 8},
  stats: {flexDirection: 'row', gap: 10, marginTop: 18},
  stat: {...cardSurface(colors.surface, {radius: radius.lg}), flex: 1, padding: 14, gap: 4},
  statNumber: {fontSize: 28, lineHeight: 36, fontWeight: '700', marginTop: 8},
  statLabel: {fontSize: 12, lineHeight: 17, color: colors.textSecondary},
  section: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 28, marginBottom: 14, gap: 10},
  sectionTitle: {...textStyles.h2, flexShrink: 1},
  // Four tiles: a 2 x 2 grid (a single row would leave each caption about 60 px wide).
  services: {flexDirection: 'row', flexWrap: 'wrap', gap: 10},
  service: {...cardSurface(glass(0.9)), flexGrow: 1, flexBasis: '45%', paddingVertical: 16, paddingHorizontal: 6, alignItems: 'center'},
  serviceIcon: {marginBottom: 12},
  serviceName: {fontSize: 13, lineHeight: 19, textAlign: 'center', fontWeight: '700', color: colors.navy},
  serviceCaption: {fontSize: 12, lineHeight: 17, textAlign: 'center', paddingHorizontal: 4, color: colors.textSecondary, marginTop: 5},
  complaint: {...cardSurface(glass(0.9)), padding: 16, marginBottom: 12},
  complaintTop: {flexDirection: 'row', justifyContent: 'space-between', gap: 10, alignItems: 'center'},
  category: {fontSize: 12, lineHeight: 17, color: colors.textSecondary, flex: 1},
  complaintTitle: {fontSize: typeScale.bodyMd.fontSize, lineHeight: 23, fontWeight: '600', color: colors.navy, marginVertical: 12},
  complaintBottom: {flexDirection: 'row', alignItems: 'center', gap: 6},
  address: {fontSize: 12, lineHeight: 17, color: colors.textSecondary, flex: 1},
  empty: {...textStyles.body},
  footer: {flexDirection: 'row', alignItems: 'center', gap: 12, justifyContent: 'center', marginTop: 24},
  footerLine: {height: 2, width: 22, borderRadius: 1},
  footerText: {fontSize: 12, color: colors.textSecondary},
});
