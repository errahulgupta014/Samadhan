import {Icon, IconTile, LanguageToggle, Text, colors, cardSurface, glass, radius, textStyles} from './Design';
import {TirangaBand} from './Brand';
import React from 'react';
import {ScrollView, StyleSheet, View} from 'react-native';
import {translator} from './labels';

/**
 * Maintenance banner: a slim, non-blocking, non-dismissible strip at the very top of the app (signed in or not) carrying the
 * admin's message in the active language. The app stays fully usable underneath.
 */
export function MaintenanceBanner({message}: {message: string}) {
  return (
    <View accessibilityRole="alert" style={s.banner}>
      <Icon name="construct" size={18} color={colors.warning} style={s.bannerIcon} />
      <Text style={s.bannerText}>{message}</Text>
    </View>
  );
}

/**
 * Blocks the whole app when the installed version is older than the configured minimum. There is no store link yet, so it only
 * explains what to do; the language can still be switched so the message is readable.
 */
export function UpdateRequired({hindi, installed, required, onToggleLanguage}: {hindi: boolean; installed: string; required: string; onToggleLanguage: () => void}) {
  const t = translator(hindi);
  return (
    <View style={s.fill}>
      <TirangaBand />
      <ScrollView contentContainerStyle={s.page}>
        <View style={s.top}>
          <LanguageToggle hindi={hindi} onPress={onToggleLanguage} />
        </View>
        <View style={s.card}>
          <IconTile name="cloud-download-outline" size={72} tone="saffron" />
          <Text accessibilityRole="header" style={s.title}>
            {t('Please update the app', 'कृपया ऐप अपडेट करें')}
          </Text>
          <Text style={s.body}>
            {t(
              'This version of SAMADHAN is no longer supported. Please install the latest version of the app to continue.',
              'SAMADHAN का यह संस्करण अब समर्थित नहीं है। जारी रखने के लिए कृपया ऐप का नवीनतम संस्करण इंस्टॉल करें।',
            )}
          </Text>
          <Text style={s.versions}>
            {t(`Installed version ${installed || '-'} · Required ${required}`, `इंस्टॉल किया गया संस्करण ${installed || '-'} · आवश्यक ${required}`)}
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  fill: {flex: 1},
  banner: {flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 9, paddingHorizontal: 16, backgroundColor: colors.warningBg, borderBottomWidth: 2, borderBottomColor: colors.saffron, zIndex: 3},
  bannerIcon: {marginTop: 2},
  bannerText: {flex: 1, fontSize: 13, lineHeight: 19, fontWeight: '600', color: colors.warning},
  page: {flexGrow: 1, padding: 20, justifyContent: 'center'},
  top: {alignItems: 'flex-end', marginBottom: 12},
  card: {...cardSurface(glass(0.94), {radius: radius.xl}), alignItems: 'center', gap: 14, paddingVertical: 36, paddingHorizontal: 24},
  title: {...textStyles.h1, textAlign: 'center', marginTop: 8},
  body: {...textStyles.bodyLg, textAlign: 'center'},
  versions: {...textStyles.caption, textAlign: 'center', marginTop: 6},
});
