import {Glyph, Icon, IconTile, LinkLabel, Notice, Pressable, Text, cardSurface, colors, glass, radius, textStyles} from './Design';
import React, {useState} from 'react';
import {Linking, StyleSheet, View, type StyleProp, type ViewStyle} from 'react-native';
import {dialable, hasSupport, supportHours, validEmail} from './appConfig';
import {useAppConfig} from './appConfigContext';
import {translator, type IconName} from './labels';

/** Opens an external link; false when the platform refuses (no phone app, no mail app, blocked pop-up). */
async function openExternal(url: string): Promise<boolean> {
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}

type Row = {key: string; icon: IconName; label: string; value: string; url?: string; spoken?: string; failure?: string};

/**
 * "Need help?" card for Home and Profile: tap-to-call phone, email and office hours (EN/HI with fallback to the other language),
 * each only when the admin has set it. Renders nothing at all when no support detail is set.
 */
export function SupportCard({hindi, style}: {hindi: boolean; style?: StyleProp<ViewStyle>}) {
  const config = useAppConfig();
  const t = translator(hindi);
  const [error, setError] = useState('');
  if (!hasSupport(config)) return null;

  const {phone, email} = config.support;
  const dial = dialable(phone);
  const hours = supportHours(config, hindi);
  const rows: Row[] = [
    ...(phone
      ? [
          {
            key: 'phone',
            icon: 'call-outline' as IconName,
            label: t('Call us', 'हमें कॉल करें'),
            value: phone,
            url: dial ? `tel:${dial}` : undefined,
            spoken: `${t('Call', 'कॉल करें')} ${phone}`,
            failure: t('Unable to start the call. Please dial the number manually.', 'कॉल शुरू नहीं हो सकी। कृपया नंबर खुद डायल करें।'),
          },
        ]
      : []),
    ...(validEmail(email)
      ? [
          {
            key: 'email',
            icon: 'mail-outline' as IconName,
            label: t('Email us', 'हमें ईमेल करें'),
            value: email,
            url: `mailto:${email}`,
            spoken: `${t('Send an email to', 'ईमेल भेजें')} ${email}`,
            failure: t('Unable to open your email app. Please write to us manually.', 'ईमेल ऐप नहीं खुला। कृपया खुद ईमेल भेजें।'),
          },
        ]
      : []),
    ...(hours ? [{key: 'hours', icon: 'time-outline' as IconName, label: t('Office hours', 'कार्यालय समय'), value: hours}] : []),
  ];

  return (
    <View style={[s.card, style]}>
      <View style={s.head}>
        <IconTile name="help-buoy-outline" size={44} tone="green" />
        <View style={s.flex}>
          <Text accessibilityRole="header" style={s.title}>
            {t('Need help?', 'मदद चाहिए?')}
          </Text>
          <Text style={s.caption}>{t('We are here to help you.', 'हम आपकी मदद के लिए हैं।')}</Text>
        </View>
      </View>
      {rows.map((row, i) => {
        const body = (
          <>
            <Icon name={row.icon} size={22} color={colors.navy} />
            <View style={s.flex}>
              <Text style={s.label}>{row.label}</Text>
              <Text style={s.value}>{row.value}</Text>
            </View>
            {row.url ? <Glyph name="forward" size={18} color={colors.navy} /> : null}
          </>
        );
        const rowStyle = [s.row, i < rows.length - 1 && s.rowBorder];
        return row.url ? (
          <Pressable
            key={row.key}
            accessibilityRole="link"
            accessibilityLabel={row.spoken}
            style={rowStyle}
            onPress={async () => {
              setError('');
              if (!(await openExternal(row.url!))) setError(row.failure ?? '');
            }}>
            {body}
          </Pressable>
        ) : (
          <View key={row.key} accessible accessibilityLabel={`${row.label}: ${row.value}`} style={rowStyle}>
            {body}
          </View>
        );
      })}
      {!!error && <Notice tone="error">{error}</Notice>}
    </View>
  );
}

/** "Terms of use" and "Privacy policy" links (https only), each shown only when the admin has set it. */
export function LegalLinks({hindi, style}: {hindi: boolean; style?: StyleProp<ViewStyle>}) {
  const config = useAppConfig();
  const t = translator(hindi);
  const [error, setError] = useState('');
  const links = [
    {key: 'terms', label: t('Terms of use', 'उपयोग की शर्तें'), url: config.termsUrl},
    {key: 'privacy', label: t('Privacy policy', 'गोपनीयता नीति'), url: config.privacyUrl},
  ].filter(link => link.url);
  if (!links.length) return null;
  return (
    <View style={style}>
      <View style={s.links}>
        {links.map(link => (
          <Pressable
            key={link.key}
            accessibilityRole="link"
            accessibilityLabel={link.label}
            hitSlop={6}
            style={s.link}
            onPress={async () => {
              setError('');
              if (!(await openExternal(link.url))) setError(t('Unable to open this link. Please try again.', 'लिंक नहीं खुला। कृपया फिर से प्रयास करें।'));
            }}>
            <LinkLabel glyph="up-right">{link.label}</LinkLabel>
          </Pressable>
        ))}
      </View>
      {!!error && <Notice tone="error">{error}</Notice>}
    </View>
  );
}

const s = StyleSheet.create({
  flex: {flex: 1},
  card: {...cardSurface(glass(0.92, colors.greenSoft), {radius: radius.lg}), padding: 16, marginTop: 24},
  head: {flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 6},
  title: {...textStyles.h2},
  caption: {...textStyles.caption, marginTop: 1},
  row: {minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 10},
  rowBorder: {borderBottomWidth: 1, borderBottomColor: colors.divider},
  label: {fontSize: 12, lineHeight: 17, color: colors.textSecondary},
  value: {fontSize: 15, lineHeight: 22, fontWeight: '600', color: colors.navy},
  links: {flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 22},
  link: {minHeight: 44, justifyContent: 'center'},
});
