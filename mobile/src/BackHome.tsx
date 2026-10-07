import {Text, Pressable, IconButton, Glyph, cardSurface, colors, glass, radius} from './Design';
import {View, StyleSheet} from 'react-native';

/** Back pill (raised, glass) and a saffron home button. Both are 44px touch targets. */
export default function BackHome({back, home, hindi = false, disabled = false}: {back: () => void; home: () => void; hindi?: boolean; disabled?: boolean}) {
  return (
    <View style={s.bar}>
      <Pressable
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={hindi ? 'वापस जाएं' : 'Go back'}
        onPress={back}
        style={[s.back, disabled && s.disabled]}>
        <Glyph name="back" size={20} color={colors.navy} />
        <Text style={s.text}>{hindi ? 'वापस' : 'Back'}</Text>
      </Pressable>
      <IconButton tone="saffron" icon="home" label={hindi ? 'होम पर जाएं' : 'Go to home'} disabled={disabled} onPress={home} />
    </View>
  );
}

const s = StyleSheet.create({
  bar: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12},
  back: {
    ...cardSurface(glass(0.96), {lip: 3, level: 'sm', radius: radius.pill}),
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 14,
    paddingRight: 18,
  },
  disabled: {opacity: 0.5},
  text: {fontSize: 14, fontWeight: '600', color: colors.navy},
});
