import {Text, TextInput, Pressable, Button, Glyph, Icon, IconTile, Notice, SelectionMark, cardSurface, colors, glass, insetStyle, radius, textStyles} from './Design';
import {Avatar} from './Avatar';
import {wardPhotoUri} from './api';
import {translator, wardMember, wardMemberLine, wardTitle} from './labels';
import React, {useState} from 'react';
import {ScrollView, StyleSheet, View} from 'react-native';
import type {PublicWard} from '../shared/community';

type Props = {
  label: string;
  wards: PublicWard[];
  /** Selected ward id ('' = none yet). */
  value: string;
  onChange: (wardId: string) => void;
  hindi: boolean;
  /** API base, used to build the ward member photo addresses. */
  base: string;
  loading?: boolean;
  /** Load failure (shown with a retry button). */
  loadError?: string;
  onRetry?: () => void;
  /** Validation message under the field. */
  error?: string;
};

/** The search box only appears for long lists. */
const SEARCH_FROM = 8;

/**
 * Ward dropdown. Every option shows the ward member's round photo (initials when the ward has none), the ward number and name, and
 * the ward member's name. The panel opens inline under the field so it behaves the same on web and native.
 */
export default function WardPicker({label, wards, value, onChange, hindi, base, loading = false, loadError, onRetry, error}: Props) {
  const t = translator(hindi);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = wards.find(w => w.id === value);
  const needle = query.trim().toLowerCase();
  /** The server has no active ward to offer (administrators have not added one yet): a friendly empty state instead of an empty dropdown. */
  const empty = !loading && !loadError && wards.length === 0;
  const shown = needle
    ? wards.filter(w => [w.number, w.name, w.nameHi, w.city, w.memberName, w.memberNameHi].some(part => part.toLowerCase().includes(needle)))
    : wards;

  return (
    <View style={s.wrap}>
      <Text style={s.label}>{label}</Text>
      {loadError ? (
        <>
          <Notice tone="error">{loadError}</Notice>
          <Button variant="secondary" title={t('Try again', 'फिर से प्रयास करें')} onPress={onRetry} />
        </>
      ) : empty ? (
        <View accessibilityRole="alert" style={s.emptyState}>
          <IconTile name="location-outline" size={44} tone="saffron" />
          <Text style={s.emptyText}>{t('No wards are available yet. Please try again later or contact the ward office.', 'अभी कोई वार्ड उपलब्ध नहीं है। कृपया बाद में पुनः प्रयास करें या वार्ड कार्यालय से संपर्क करें।')}</Text>
          {onRetry ? <Button variant="secondary" title={t('Check again', 'फिर से देखें')} onPress={onRetry} /> : null}
        </View>
      ) : (
        <>
          <Pressable
            accessibilityRole="combobox"
            accessibilityLabel={label}
            accessibilityHint={t('Opens the list of wards', 'वार्ड की सूची खोलता है')}
            accessibilityState={{expanded: open, disabled: loading}}
            disabled={loading}
            feedback="none"
            onPress={() => {
              setOpen(!open);
              setQuery('');
            }}
            style={[s.trigger, insetStyle({focused: open, invalid: !!error, disabled: loading})]}>
            {selected ? (
              <WardRow ward={selected} hindi={hindi} base={base} />
            ) : (
              <View style={s.row}>
                <View style={s.placeholderIcon}>
                  <Icon name="location-outline" size={22} color={colors.textSecondary} />
                </View>
                <Text style={s.placeholder}>{loading ? t('Loading wards…', 'वार्ड लोड हो रहे हैं…') : t('Select your ward', 'अपना वार्ड चुनें')}</Text>
              </View>
            )}
            <Glyph name={open ? 'up' : 'chevron-down'} size={20} color={colors.navy} />
          </Pressable>
          {error ? (
            <Text accessibilityRole="alert" style={s.error}>
              {error}
            </Text>
          ) : null}
          {open ? (
            <View style={s.panel}>
              {wards.length > SEARCH_FROM ? (
                <TextInput
                  inset
                  accessibilityLabel={t('Search wards', 'वार्ड खोजें')}
                  placeholder={t('Search by ward, member or city', 'वार्ड, सदस्य या शहर से खोजें')}
                  value={query}
                  onChangeText={setQuery}
                  autoCapitalize="none"
                  style={s.search}
                />
              ) : null}
              <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" style={s.list}>
                {!shown.length ? <Text style={s.empty}>{wards.length ? t('No ward matches your search.', 'खोज से कोई वार्ड नहीं मिला।') : t('No wards are available right now.', 'अभी कोई वार्ड उपलब्ध नहीं है।')}</Text> : null}
                {shown.map(ward => {
                  const chosen = ward.id === value;
                  return (
                    <Pressable
                      key={ward.id}
                      accessibilityRole="radio"
                      accessibilityState={{checked: chosen, selected: chosen}}
                      accessibilityLabel={`${wardTitle(ward, hindi)}. ${wardMemberLine(ward, hindi)}`}
                      onPress={() => {
                        onChange(ward.id);
                        setOpen(false);
                        setQuery('');
                      }}
                      style={[s.option, chosen && s.optionChosen]}>
                      <WardRow ward={ward} hindi={hindi} base={base} />
                      <SelectionMark kind="radio" selected={chosen} size={22} />
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

/** Photo, "Ward 7 · Name", and the ward member underneath. */
function WardRow({ward, hindi, base}: {ward: PublicWard; hindi: boolean; base: string}) {
  const uri = wardPhotoUri(base, ward);
  const member = wardMember(ward, hindi);
  return (
    <View style={s.row}>
      <Avatar size={46} name={member} source={uri ? {uri} : null} />
      <View style={s.text}>
        <Text numberOfLines={2} style={s.title}>
          {wardTitle(ward, hindi)}
        </Text>
        <Text numberOfLines={1} style={s.sub}>
          {wardMemberLine(ward, hindi)}
        </Text>
        {ward.city ? (
          <Text numberOfLines={1} style={s.sub}>
            {ward.city}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {marginVertical: 10},
  label: {...textStyles.label, marginBottom: 8},
  trigger: {minHeight: 64, paddingVertical: 8, paddingLeft: 10, paddingRight: 14, flexDirection: 'row', alignItems: 'center', gap: 8},
  row: {flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12},
  text: {flex: 1},
  title: {fontSize: 15, lineHeight: 21, fontWeight: '600', color: colors.navy},
  sub: {fontSize: 12, lineHeight: 18, color: colors.textSecondary},
  placeholder: {fontSize: 15, color: colors.textTertiary, flex: 1},
  placeholderIcon: {width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.paperDeep},
  error: {fontSize: 12, lineHeight: 18, color: colors.error, marginTop: 6},
  panel: {...cardSurface(glass(0.98), {radius: radius.md, lip: 3}), marginTop: 10, padding: 6, overflow: 'hidden'},
  search: {fontSize: 14, paddingVertical: 10, paddingHorizontal: 12, margin: 4, marginBottom: 8, minHeight: 44},
  list: {maxHeight: 330},
  option: {flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 8, borderRadius: radius.sm},
  optionChosen: {backgroundColor: colors.greenSoft},
  empty: {...textStyles.body, textAlign: 'center', padding: 16},
  emptyState: {...cardSurface(glass(0.94), {radius: radius.md, lip: 2}), alignItems: 'center', gap: 12, padding: 18},
  emptyText: {...textStyles.body, textAlign: 'center'},
});
