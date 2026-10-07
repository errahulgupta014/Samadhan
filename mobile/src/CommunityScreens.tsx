import {Text, Pressable, Button, Chip, Glyph, Icon, IconTile, LinkLabel, Notice, Toggle, cardSurface, colors, glass, radius, rgba, textStyles} from './Design';
import {Avatar} from './Avatar';
import React, {useState} from 'react';
import {MediaImage} from './MediaImage';
import {View, StyleSheet, Linking, ActivityIndicator} from 'react-native';
import type {Workspace} from '../shared/domain';
import {visibleActivity} from '../shared/community';
import {mediaSource, upload, wardPhotoUri, type Connection} from './api';
import {errorText} from './errors';
import {pickPhoto} from './photo';
import {LegalLinks, SupportCard} from './Support';
import {orgLabel} from './appConfig';
import {useAppConfig} from './appConfigContext';
import {formatDateRange, localized, residentPlace, translator, wardMember, wardMemberLine, wardTitle, type IconName} from './labels';

type Props = {
  data: Workspace;
  connection: Connection;
  hindi: boolean;
  busy: boolean;
  act: (b: Record<string, unknown>) => Promise<any>;
  navigate: (page: string, id?: string) => void;
  setLanguage: (hindi: boolean) => void;
  logout: () => Promise<void>;
};

export function CommunityScreen({page, ...props}: Props & {page: string}) {
  switch (page) {
    case 'profile':
      return <Profile {...props} />;
    case 'classifieds':
      return <Classifieds {...props} />;
    case 'activities':
      return <Activities {...props} />;
    case 'city':
      return <City {...props} />;
    default:
      return null;
  }
}

/** The resident's notification switches (saved with `save-profile`). */
type SwitchKey = 'classifiedNotifications' | 'activityNotifications';

/** "9876543210" -> "+91 98765 43210". */
const displayMobile = (mobile: string) => (/^\d{10}$/.test(mobile) ? `+91 ${mobile.slice(0, 5)} ${mobile.slice(5)}` : mobile);

/**
 * The resident's registered details are read-only here. Only four things can change, and each saves as soon as it is changed:
 * the profile photo, the classified-notifications and activity-notifications switches, and the language.
 */
function Profile({data, connection, hindi, busy, act, logout, setLanguage}: Props) {
  const profile = data.profile;
  const ward = data.ward;
  const t = translator(hindi);
  const config = useAppConfig();
  const org = orgLabel(config, hindi);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [photoBusy, setPhotoBusy] = useState(false);
  // Value of a notification switch that is being saved (shown immediately, and the switch is disabled meanwhile).
  const [pendingSwitch, setPendingSwitch] = useState<Partial<Record<SwitchKey, boolean>>>({});
  const switchOn = (key: SwitchKey) => pendingSwitch[key] ?? profile?.[key] ?? true;

  async function changePhoto(camera: boolean) {
    setError('');
    setMessage('');
    setPhotoBusy(true);
    try {
      const picked = await pickPhoto(camera, t, true);
      if (!picked) return;
      const photoId = await upload(connection, picked.uri, picked.mimeType);
      await act({action: 'save-profile', profile: {photoId}});
      setMessage(t('Profile photo updated.', 'प्रोफ़ाइल फोटो बदल दी गई।'));
    } catch (e) {
      setError(errorText(e, t));
    } finally {
      setPhotoBusy(false);
    }
  }

  async function changeSwitch(key: SwitchKey, next: boolean, confirmation: string) {
    setError('');
    setMessage('');
    setPendingSwitch(current => ({...current, [key]: next}));
    try {
      await act({action: 'save-profile', profile: {[key]: next}});
      setMessage(confirmation);
    } catch (e) {
      setError(errorText(e, t));
    } finally {
      setPendingSwitch(({[key]: _saved, ...rest}) => rest);
    }
  }

  if (!profile) {
    return (
      <Notice tone="error">{t('Your profile could not be loaded. Pull down to refresh.', 'आपकी प्रोफ़ाइल लोड नहीं हो सकी। रिफ्रेश करने के लिए नीचे खींचें।')}</Notice>
    );
  }

  const photo = profile.photoId ? mediaSource(connection, profile.photoId) : null;
  const rows: {icon: IconName; label: string; value: string}[] = [
    {icon: 'person-outline', label: t('Full name', 'पूरा नाम'), value: profile.name},
    {icon: 'call-outline', label: t('Mobile number', 'मोबाइल नंबर'), value: displayMobile(profile.mobile)},
    ...(profile.email ? [{icon: 'mail-outline' as IconName, label: t('Email', 'ईमेल'), value: profile.email}] : []),
    {icon: 'home-outline', label: t('Address', 'पता'), value: profile.address},
  ];

  return (
    <>
      <Text style={s.eyebrow}>{t('YOUR ACCOUNT', 'आपका खाता')}</Text>
      <Text accessibilityRole="header" style={s.h1}>
        {t('My profile', 'मेरी प्रोफ़ाइल')}
      </Text>

      <View style={s.identity}>
        <View>
          <Avatar size={84} name={profile.name} source={photo} decorative={false} />
          {photoBusy ? (
            <View style={s.photoBusy}>
              <ActivityIndicator color={colors.white} />
            </View>
          ) : null}
        </View>
        <View style={s.flex}>
          <Text style={s.h2}>{profile.name}</Text>
          <Text style={s.muted}>{displayMobile(profile.mobile)}</Text>
          {residentPlace(ward, hindi) ? <Text style={s.muted}>{residentPlace(ward, hindi)}</Text> : null}
        </View>
      </View>
      <View style={s.photoActions}>
        <Button
          variant="secondary"
          disabled={photoBusy || busy}
          icon={<Icon name="camera-outline" size={20} color={colors.navy} />}
          title={t('Take a photo', 'फोटो लें')}
          onPress={() => void changePhoto(true)}
          style={s.flex}
        />
        <Button
          variant="secondary"
          disabled={photoBusy || busy}
          icon={<Icon name="images-outline" size={20} color={colors.navy} />}
          title={t('From gallery', 'गैलरी से')}
          onPress={() => void changePhoto(false)}
          style={s.flex}
        />
      </View>

      <View style={s.card}>
        {ward ? (
          <View style={[s.detail, s.detailBorder]}>
            <Avatar size={46} name={wardMember(ward, hindi)} source={wardPhotoUri(connection.url, ward) ? {uri: wardPhotoUri(connection.url, ward)!} : null} />
            <View style={s.flex}>
              <Text style={s.label}>{t('Ward', 'वार्ड')}</Text>
              <Text style={s.value}>{wardTitle(ward, hindi)}</Text>
              <Text style={s.muted}>
                {wardMemberLine(ward, hindi)}
                {ward.city ? ` · ${ward.city}` : ''}
              </Text>
            </View>
          </View>
        ) : null}
        {rows.map((row, i) => (
          <View key={row.label} style={[s.detail, i < rows.length - 1 && s.detailBorder]}>
            <Icon name={row.icon} size={22} color={colors.navy} style={s.detailIcon} />
            <View style={s.flex}>
              <Text style={s.label}>{row.label}</Text>
              <Text selectable style={s.value}>
                {row.value}
              </Text>
            </View>
          </View>
        ))}
      </View>
      <Text style={s.muted}>{t('These details were saved when you registered. To correct them, please contact your ward office.', 'ये जानकारी पंजीकरण के समय सहेजी गई थी। इन्हें सुधारने के लिए कृपया अपने वार्ड कार्यालय से संपर्क करें।')}</Text>

      <Text style={s.sectionLabel}>{t('Preferred language', 'पसंदीदा भाषा')}</Text>
      <View style={s.row}>
        {(['en', 'hi'] as const).map(language => (
          <Chip
            key={language}
            style={s.flex}
            accessibilityRole="radio"
            accessibilityState={{checked: (language === 'hi') === hindi}}
            label={language === 'en' ? 'English' : 'हिन्दी'}
            selected={(language === 'hi') === hindi}
            onPress={() => setLanguage(language === 'hi')}
          />
        ))}
      </View>

      {config.tabs.classifieds && (
        <View style={s.card}>
          <View style={s.row}>
            <View style={s.flex}>
              <Text style={s.h2}>{t('Classified notifications', 'विज्ञापन सूचनाएं')}</Text>
              <Text style={s.muted}>{t('Get notified when new local classified ads are published. Complaint updates are always sent.', 'नए स्थानीय विज्ञापन प्रकाशित होने पर सूचना पाएं। शिकायत की जानकारी हमेशा भेजी जाती है।')}</Text>
            </View>
            <Toggle
              accessibilityLabel={t('Classified notifications', 'विज्ञापन सूचनाएं')}
              value={switchOn('classifiedNotifications')}
              disabled={busy || pendingSwitch.classifiedNotifications !== undefined}
              onValueChange={v => void changeSwitch('classifiedNotifications', v, v ? t('Classified notifications are on.', 'विज्ञापन सूचनाएं चालू हैं।') : t('Classified notifications are off.', 'विज्ञापन सूचनाएं बंद हैं।'))}
            />
          </View>
        </View>
      )}

      {config.tabs.activities && (
        <View style={s.card}>
          <View style={s.row}>
            <View style={s.flex}>
              <Text style={s.h2}>{t('Activity notifications', 'गतिविधि सूचनाएं')}</Text>
              <Text style={s.muted}>{t(`Get notified about new campaigns and programmes by your ${org}.`, `${org} के नए अभियानों और कार्यक्रमों की सूचना पाएं।`)}</Text>
            </View>
            <Toggle
              accessibilityLabel={t('Activity notifications', 'गतिविधि सूचनाएं')}
              value={switchOn('activityNotifications')}
              disabled={busy || pendingSwitch.activityNotifications !== undefined}
              onValueChange={v => void changeSwitch('activityNotifications', v, v ? t('Activity notifications are on.', 'गतिविधि सूचनाएं चालू हैं।') : t('Activity notifications are off.', 'गतिविधि सूचनाएं बंद हैं।'))}
            />
          </View>
        </View>
      )}

      {!!error && <Notice tone="error">{error}</Notice>}
      {!!message && <Notice tone="success">{message}</Notice>}
      <SupportCard hindi={hindi} style={s.support} />
      <Button
        variant="secondary"
        disabled={busy}
        title={t('Log out', 'लॉग आउट')}
        icon={<Icon name="log-out-outline" size={20} color={colors.navy} />}
        onPress={async () => {
          setError('');
          try {
            await logout();
          } catch (e) {
            setError(errorText(e, t));
          }
        }}
      />
      <LegalLinks hindi={hindi} style={s.legal} />
    </>
  );
}

function Classifieds({data, connection, hindi, navigate}: Props) {
  const t = translator(hindi);
  return (
    <>
      <Text style={[s.eyebrow, s.eyebrowSaffron]}>{t('FROM YOUR COMMUNITY', 'आपके समुदाय से')}</Text>
      <Text accessibilityRole="header" style={s.h1}>
        {t('Classifieds', 'विज्ञापन')}
      </Text>
      <Text style={s.muted}>{t('Local advertisements and opportunities published by your administration.', 'प्रशासन द्वारा प्रकाशित स्थानीय विज्ञापन और सूचनाएं।')}</Text>
      {!data.classifieds?.length && (
        <Empty
          icon="pricetags-outline"
          tone="saffron"
          title={t('No classifieds yet', 'अभी कोई विज्ञापन नहीं')}
          body={t('New advertisements will appear here when your administration publishes them.', 'नए विज्ञापन प्रकाशित होने पर यहां दिखाई देंगे।')}
        />
      )}
      {data.classifieds?.map(ad => (
        <Pressable
          key={ad.id}
          accessibilityRole="button"
          accessibilityLabel={`${t('View details', 'विवरण देखें')}: ${hindi && ad.titleHi ? ad.titleHi : ad.title}`}
          onPress={() => navigate('ad-detail', ad.id)}
          style={s.card}>
          <Photo id={ad.imageId} connection={connection} />
          <Text style={[s.eyebrow, s.eyebrowSaffron]}>
            {t('ADVERTISEMENT', 'विज्ञापन')} · {localized(hindi, ad.advertiser, ad.advertiserHi)}
          </Text>
          <Text style={s.h2}>{hindi && ad.titleHi ? ad.titleHi : ad.title}</Text>
          <Text numberOfLines={2} style={s.body}>
            {hindi && ad.descriptionHi ? ad.descriptionHi : ad.description}
          </Text>
          <LinkLabel style={s.link}>{t('View details', 'पूरा विवरण देखें')}</LinkLabel>
        </Pressable>
      ))}
    </>
  );
}

/** Campaigns and programmes by the local authority (named by appConfig.orgLabel). The server already filters and sorts; visibleActivity() guards against a stale list. */
function Activities({data, connection, hindi, navigate}: Props) {
  const t = translator(hindi);
  const org = orgLabel(useAppConfig(), hindi);
  const activities = (data.activities ?? []).filter(a => visibleActivity(a));
  return (
    <>
      <Text style={s.eyebrow}>{t('CAMPAIGNS & PROGRAMMES', 'अभियान और कार्यक्रम')}</Text>
      <Text accessibilityRole="header" style={s.h1}>
        {t('Activities', 'गतिविधियाँ')}
      </Text>
      <Text style={s.muted}>{t(`Campaigns and programmes by your ${org}.`, `${org} के अभियान और कार्यक्रम।`)}</Text>
      {!activities.length && (
        <Empty
          icon="calendar-outline"
          tone="green"
          title={t('No activities yet', 'अभी कोई गतिविधि नहीं')}
          body={t('Upcoming campaigns and programmes will appear here when they are published.', 'आगामी अभियान और कार्यक्रम प्रकाशित होने पर यहां दिखाई देंगे।')}
        />
      )}
      {activities.map(activity => {
        const title = localized(hindi, activity.title, activity.titleHi);
        const venue = localized(hindi, activity.venue, activity.venueHi);
        return (
          <Pressable
            key={activity.id}
            accessibilityRole="button"
            accessibilityLabel={`${t('View details', 'विवरण देखें')}: ${title}`}
            onPress={() => navigate('activity-detail', activity.id)}
            style={s.card}>
            <Photo id={activity.imageId} connection={connection} />
            <View style={s.organizerChip}>
              <Icon name="business-outline" size={14} color={colors.greenText} />
              <Text style={s.organizerText}>{localized(hindi, activity.organizer, activity.organizerHi) || org}</Text>
            </View>
            <Text style={s.h2}>{title}</Text>
            <View style={s.metaRow}>
              <Icon name="calendar-outline" size={15} color={colors.textSecondary} />
              <Text style={[s.muted, s.flex]}>{formatDateRange(activity.startsAt, activity.endsAt, hindi)}</Text>
            </View>
            {!!venue && (
              <View style={s.metaRow}>
                <Icon name="location-outline" size={15} color={colors.textSecondary} />
                <Text style={[s.muted, s.flex]}>{venue}</Text>
              </View>
            )}
            <Text numberOfLines={2} style={s.body}>
              {localized(hindi, activity.description, activity.descriptionHi)}
            </Text>
            <LinkLabel style={s.link}>{t('View details', 'पूरा विवरण देखें')}</LinkLabel>
          </Pressable>
        );
      })}
    </>
  );
}

function City({data, connection, hindi, navigate}: Props) {
  const city = data.municipality;
  const t = translator(hindi);
  return (
    <>
      <Text style={s.eyebrow}>{t('KNOW YOUR CITY', 'अपना शहर जानें')}</Text>
      <Text accessibilityRole="header" style={s.h1}>
        {city?.published ? (hindi && city.nameHi ? city.nameHi : city.name) : t('Explore your city', 'अपना शहर')}
      </Text>
      {!city?.published ? (
        <Empty
          icon="compass-outline"
          tone="green"
          title={t('Your city’s story is coming', 'स्थानीय जानकारी जल्द आएगी')}
          body={t('The administration can publish verified municipality information and local history from the portal.', 'प्रशासन जल्द नगर का परिचय और इतिहास प्रकाशित करेगा।')}
        />
      ) : (
        <>
          <Text style={s.muted}>{[localized(hindi, city.district, city.districtHi), localized(hindi, city.state, city.stateHi)].filter(Boolean).join(', ')}</Text>
          <Text style={s.body}>{hindi && city.aboutHi ? city.aboutHi : city.about}</Text>
          <View style={s.card}>
            <IconTile name="library-outline" size={48} tone="saffron" />
            <Text style={s.h2}>{t('Our history', 'हमारा इतिहास')}</Text>
            <Text style={s.body}>{hindi && city.historyHi ? city.historyHi : city.history}</Text>
            {city.sourceUrl && (
              <Button variant="secondary" title={t('Read source', 'स्रोत देखें')} icon={<Glyph name="up-right" size={20} color={colors.navy} />} onPress={() => void Linking.openURL(city.sourceUrl)} />
            )}
          </View>
        </>
      )}
      <Text style={s.h2}>{t('Places to visit', 'घूमने की जगहें')}</Text>
      {!data.places?.length && <Text style={s.muted}>{t('Local sights and visitor information will appear here when published.', 'प्रशासन जल्द घूमने की जगहें जोड़ेगा।')}</Text>}
      {data.places?.map(place => (
        <Pressable
          key={place.id}
          accessibilityRole="button"
          accessibilityLabel={`${t('Explore place', 'स्थान देखें')}: ${hindi && place.nameHi ? place.nameHi : place.name}`}
          onPress={() => navigate('place-detail', place.id)}
          style={s.card}>
          <Photo id={place.imageId} connection={connection} />
          <Text style={s.h2}>{hindi && place.nameHi ? place.nameHi : place.name}</Text>
          <Text numberOfLines={2} style={s.body}>
            {hindi && place.descriptionHi ? place.descriptionHi : place.description}
          </Text>
          <View style={s.metaRow}>
            <Icon name="location-outline" size={15} color={colors.textSecondary} />
            <Text style={[s.muted, s.flex]}>{localized(hindi, place.address, place.addressHi)}</Text>
          </View>
          <LinkLabel style={s.link}>{t('Explore this place', 'स्थान का विवरण देखें')}</LinkLabel>
        </Pressable>
      ))}
    </>
  );
}

function Photo({id, connection}: {id: string; connection: Connection}) {
  return id ? (
    <View style={s.photoFrame}>
      <MediaImage style={s.photo} source={mediaSource(connection, id)} />
    </View>
  ) : null;
}

function Empty({icon, tone, title, body}: {icon: IconName; tone: 'green' | 'saffron'; title: string; body: string}) {
  return (
    <View style={s.empty}>
      <IconTile name={icon} size={56} tone={tone} />
      <Text style={s.h2}>{title}</Text>
      <Text style={[s.muted, s.centered]}>{body}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  flex: {flex: 1},
  centered: {textAlign: 'center'},
  eyebrow: {...textStyles.eyebrow, marginVertical: 10},
  eyebrowSaffron: {color: colors.saffronText},
  h1: {...textStyles.h1, marginBottom: 14},
  h2: {...textStyles.h2, marginVertical: 8},
  body: {...textStyles.body, marginVertical: 8},
  muted: {fontSize: 13, lineHeight: 20, color: colors.textSecondary},
  label: {fontSize: 12, lineHeight: 18, color: colors.textSecondary, marginBottom: 2},
  value: {fontSize: 15, lineHeight: 22, fontWeight: '600', color: colors.navy},
  sectionLabel: {...textStyles.label, marginTop: 22, marginBottom: 10},
  card: {...cardSurface(glass(0.9), {radius: 22}), padding: 18, marginVertical: 12},
  photoFrame: {...cardSurface(colors.white, {lip: 3, level: 'sm', radius: radius.md}), padding: 3, marginBottom: 12},
  photo: {height: 175, width: '100%', borderRadius: radius.sm},
  row: {flexDirection: 'row', alignItems: 'center', gap: 12},
  metaRow: {flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4},
  organizerChip: {alignSelf: 'flex-start', maxWidth: '100%', flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 5, paddingHorizontal: 10, borderRadius: radius.pill, backgroundColor: colors.greenSoft, marginBottom: 6},
  organizerText: {...textStyles.eyebrow, flexShrink: 1, fontSize: 12, lineHeight: 17, letterSpacing: 0.8, textTransform: 'uppercase'},
  identity: {...cardSurface(glass(0.92, colors.saffronSoft), {radius: radius.lg}), flexDirection: 'row', alignItems: 'center', gap: 16, padding: 16, marginBottom: 6},
  photoActions: {flexDirection: 'row', gap: 12},
  photoBusy: {position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 42, alignItems: 'center', justifyContent: 'center', backgroundColor: rgba(colors.navy, 0.55)},
  detail: {flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12},
  detailBorder: {borderBottomWidth: 1, borderBottomColor: colors.divider},
  detailIcon: {width: 46, textAlign: 'center'},
  empty: {alignItems: 'center', paddingVertical: 35, paddingHorizontal: 20, gap: 10},
  link: {marginTop: 12},
  support: {marginTop: 12, marginBottom: 10},
  legal: {marginTop: 14},
});
