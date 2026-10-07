import {Text, Button, Icon, Glyph, IconTile, Notice, cardSurface, colors, glass, onFill, raised, textStyles} from './Design';
import React, {useState} from 'react';
import {MediaImage} from './MediaImage';
import {View, StyleSheet, Linking} from 'react-native';
import type {Workspace} from '../shared/domain';
import {visibleActivity} from '../shared/community';
import {mediaSource, type Connection} from './api';
import {dialable} from './appConfig';
import {formatDateTimeShort, localized, translator, type IconName} from './labels';

export default function CommunityDetail({kind, id, data, connection, hindi}: {kind: 'ad' | 'place'; id?: string; data: Workspace; connection: Connection; hindi: boolean}) {
  const [error, setError] = useState('');
  const t = translator(hindi);
  // The server decides how long an ad is visible (its dates are never shown here): whatever it still lists can be opened, and an ad it dropped shows the "No longer available" screen.
  const ad = kind === 'ad' ? data.classifieds?.find(a => a.id === id && a.status === 'published') : undefined;
  const place = kind === 'place' ? data.places?.find(p => p.id === id && p.published) : undefined;
  const item = ad ?? place;
  if (!item) return <Unavailable hindi={hindi} />;
  const title = ad ? (hindi && ad.titleHi ? ad.titleHi : ad.title) : hindi && place!.nameHi ? place!.nameHi : place!.name;
  const description = hindi && item.descriptionHi ? item.descriptionHi : item.description;
  // Advertiser links are the saffron highlight CTA; place links are green.
  const linkFill = kind === 'ad' ? colors.saffron : colors.green;
  const external = (label: string, url: string) => (
    <Button
      variant={kind === 'ad' ? 'accent' : 'success'}
      title={label}
      icon={<Glyph name="up-right" size={20} color={onFill(linkFill)} />}
      style={s.button}
      onPress={async () => {
        setError('');
        try {
          if (!url.startsWith('https://')) throw new Error();
          await Linking.openURL(url);
        } catch {
          setError(t('Unable to open this link. Please try again.', 'लिंक नहीं खुला। कृपया फिर से प्रयास करें।'));
        }
      }}
    />
  );
  return (
    <>
      {item.imageId ? (
        <View style={s.photoFrame}>
          <MediaImage accessibilityLabel={title} resizeMode="contain" style={s.photo} source={mediaSource(connection, item.imageId)} />
        </View>
      ) : (
        <View style={[s.hero, kind === 'place' && s.heroPlace]}>
          <IconTile name={kind === 'ad' ? 'pricetags-outline' : 'compass-outline'} size={64} tone={kind === 'ad' ? 'saffron' : 'green'} />
          <Text style={s.heroText}>{kind === 'ad' ? t('FROM YOUR COMMUNITY', 'आपके समुदाय से') : t('EXPLORE YOUR CITY', 'अपना शहर जानें')}</Text>
        </View>
      )}
      <Text style={s.eyebrow}>{kind === 'ad' ? t('ADVERTISEMENT DETAILS', 'विज्ञापन का विवरण') : t('PLACE DETAILS', 'स्थान का विवरण')}</Text>
      <Text accessibilityRole="header" style={s.title}>
        {title}
      </Text>
      {ad && (
        <Text style={s.publisher}>
          {t('Published by', 'प्रकाशक')} · {localized(hindi, ad.advertiser, ad.advertiserHi)}
        </Text>
      )}
      <Text selectable style={s.body}>
        {description}
      </Text>
      {ad ? (
        !!ad.contactPhone && (
          <View style={s.info}>
            <InfoLine icon="call-outline" label={t('Contact number', 'संपर्क नंबर')} value={ad.contactPhone} selectable last />
          </View>
        )
      ) : (
        <View style={s.info}>
          <InfoLine icon="location-outline" label={t('Address', 'पता')} value={localized(hindi, place!.address, place!.addressHi)} selectable last={!place!.hours} />
          {!!place!.hours && <InfoLine icon="time-outline" label={t('Visiting hours', 'खुलने का समय')} value={localized(hindi, place!.hours, place!.hoursHi)} last />}
        </View>
      )}
      {ad?.url && external(t('Visit advertiser website', 'विज्ञापनदाता की वेबसाइट देखें'), ad.url)}
      {place?.mapUrl && external(t('Get directions', 'रास्ता देखें'), place.mapUrl)}
      {place?.sourceUrl && external(t('More information', 'और जानकारी'), place.sourceUrl)}
      {!!error && <Notice tone="error">{error}</Notice>}
    </>
  );
}

function Unavailable({hindi}: {hindi: boolean}) {
  const t = translator(hindi);
  return (
    <View style={s.empty}>
      <IconTile name="information-circle-outline" size={56} tone="navy" />
      <Text accessibilityRole="header" style={s.title}>
        {t('No longer available', 'अब उपलब्ध नहीं है')}
      </Text>
      <Text style={s.body}>
        {t(
          'This item may have expired or been unpublished. Go back to browse the latest listings.',
          'यह सामग्री समाप्त हो गई है या हटा दी गई है। नवीनतम सूची देखने के लिए वापस जाएं।',
        )}
      </Text>
    </View>
  );
}

/** A campaign / programme by the local authority (appConfig.orgLabel): image, organizer, description, times, venue, tap-to-call phone and an optional https link. */
export function ActivityDetail({id, data, connection, hindi}: {id?: string; data: Workspace; connection: Connection; hindi: boolean}) {
  const [error, setError] = useState('');
  const t = translator(hindi);
  const activity = data.activities?.find(a => a.id === id && visibleActivity(a));
  if (!activity) return <Unavailable hindi={hindi} />;
  const title = localized(hindi, activity.title, activity.titleHi);
  const venue = localized(hindi, activity.venue, activity.venueHi);
  const phone = activity.contactPhone.trim();
  const dial = dialable(phone);
  const linkError = t('Unable to open this link. Please try again.', 'लिंक नहीं खुला। कृपया फिर से प्रयास करें।');
  // Start/end times and the venue are always shown; a contact number only when it is too short to dial (otherwise it becomes the Call button).
  const rows: {icon: IconName; label: string; value: string; selectable?: boolean}[] = [
    {icon: 'calendar-outline', label: t('Starts', 'प्रारंभ'), value: formatDateTimeShort(activity.startsAt, hindi)},
    {icon: 'calendar', label: t('Ends', 'समाप्ति'), value: formatDateTimeShort(activity.endsAt, hindi)},
    ...(venue ? [{icon: 'location-outline' as IconName, label: t('Venue', 'स्थान'), value: venue, selectable: true}] : []),
    ...(phone && !dial ? [{icon: 'call-outline' as IconName, label: t('Contact number', 'संपर्क नंबर'), value: phone, selectable: true}] : []),
  ];
  const open = async (url: string, failure: string) => {
    setError('');
    try {
      await Linking.openURL(url);
    } catch {
      setError(failure);
    }
  };
  return (
    <>
      {activity.imageId ? (
        <View style={s.photoFrame}>
          <MediaImage accessibilityLabel={title} resizeMode="contain" style={s.photo} source={mediaSource(connection, activity.imageId)} />
        </View>
      ) : (
        <View style={[s.hero, s.heroPlace]}>
          <IconTile name="calendar-outline" size={64} tone="green" />
          <Text style={s.heroText}>{t('CAMPAIGNS & PROGRAMMES', 'अभियान और कार्यक्रम')}</Text>
        </View>
      )}
      <Text style={s.eyebrow}>{t('ACTIVITY DETAILS', 'गतिविधि का विवरण')}</Text>
      <Text accessibilityRole="header" style={s.title}>
        {title}
      </Text>
      <Text style={s.publisher}>
        {t('Organised by', 'आयोजक')} · {localized(hindi, activity.organizer, activity.organizerHi)}
      </Text>
      <Text selectable style={s.body}>
        {localized(hindi, activity.description, activity.descriptionHi)}
      </Text>
      <View style={s.info}>
        {rows.map((row, i) => (
          <InfoLine key={row.label} icon={row.icon} label={row.label} value={row.value} selectable={row.selectable} last={i === rows.length - 1} />
        ))}
      </View>
      {!!dial && (
        <Button
          variant="success"
          title={`${t('Call', 'कॉल करें')} ${phone}`}
          icon={<Icon name="call-outline" size={20} color={onFill(colors.green)} />}
          style={s.button}
          onPress={() => void open(`tel:${dial}`, t('Unable to start the call. Please dial the number manually.', 'कॉल शुरू नहीं हो सकी। कृपया नंबर खुद डायल करें।'))}
        />
      )}
      {!!activity.url && (
        <Button
          variant="secondary"
          title={t('More information', 'और जानकारी')}
          icon={<Glyph name="up-right" size={20} color={colors.navy} />}
          style={s.button}
          onPress={() => (activity.url.startsWith('https://') ? void open(activity.url, linkError) : setError(linkError))}
        />
      )}
      {!!error && <Notice tone="error">{error}</Notice>}
    </>
  );
}

function InfoLine({icon, label, value, selectable = false, last = false}: {icon: IconName; label: string; value: string; selectable?: boolean; last?: boolean}) {
  return (
    <View style={[s.infoLine, last && s.infoLast]}>
      <Icon name={icon} size={20} color={colors.navy} style={s.infoIcon} />
      <View style={s.flex}>
        <Text style={s.label}>{label}</Text>
        <Text selectable={selectable} style={s.value}>
          {value}
        </Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  flex: {flex: 1},
  photoFrame: {...cardSurface(colors.white, {lip: 4, level: 'md', radius: 22}), padding: 4, marginBottom: 24},
  photo: {height: 260, width: '100%', borderRadius: 18, backgroundColor: colors.inset},
  hero: {...raised(colors.saffronSoft, {lip: 4, level: 'md'}), height: 160, borderRadius: 22, alignItems: 'center', justifyContent: 'center', gap: 14, marginBottom: 22},
  heroPlace: {...raised(colors.greenSoft, {lip: 4, level: 'md'})},
  heroText: {fontSize: 12, letterSpacing: 1.4, fontWeight: '700', color: colors.textSecondary},
  eyebrow: {...textStyles.eyebrow, marginBottom: 10},
  title: {...textStyles.h1, marginBottom: 12},
  publisher: {fontSize: 13, lineHeight: 19, color: colors.textSecondary, marginBottom: 18},
  body: {...textStyles.bodyLg, marginBottom: 20},
  info: {...cardSurface(glass(0.9), {radius: 20}), padding: 18, marginVertical: 8},
  infoLine: {flexDirection: 'row', gap: 12, paddingBottom: 14, marginBottom: 14, borderBottomWidth: 1, borderBottomColor: colors.divider},
  infoLast: {paddingBottom: 0, marginBottom: 0, borderBottomWidth: 0},
  infoIcon: {marginTop: 2},
  label: {fontSize: 12, lineHeight: 17, color: colors.textSecondary, marginBottom: 3},
  value: {fontSize: 16, lineHeight: 24, color: colors.navy},
  button: {marginTop: 12},
  empty: {paddingVertical: 40, gap: 16, alignItems: 'center'},
});
