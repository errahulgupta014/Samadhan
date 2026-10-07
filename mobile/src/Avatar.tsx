import {Icon, Text, cardSurface, colors, glass} from './Design';
import React, {useState} from 'react';
import {MediaImage} from './MediaImage';
import {View, type ImageSourcePropType, type StyleProp, type ViewStyle} from 'react-native';

/** "Anita Sharma" -> "AS", "अनीता" -> "अ". Works per code point so Devanagari is never split mid-character. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  const first = Array.from(words[0])[0] ?? '';
  const last = words.length > 1 ? (Array.from(words[words.length - 1])[0] ?? '') : '';
  return (first + last).toUpperCase();
}

type Props = {
  /** Image address, or an image source with auth headers (private media). Nothing / a failed load shows the initials. */
  source?: ImageSourcePropType | null;
  /** Used for the initials fallback and the accessibility label. With no name a neutral person icon is shown instead. */
  name: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
  /** Decorative when the row around it already reads the name. */
  decorative?: boolean;
};

/** Round raised avatar: photo with an initials fallback (also shown while there is no photo or when it fails to load). */
export function Avatar({source, name, size = 48, style, decorative = true}: Props) {
  // Remount the image state when the photo changes so an earlier failure never hides a new picture.
  const key = source && typeof source === 'object' && 'uri' in source ? String(source.uri) : 'none';
  return (
    <AvatarFace key={key} source={source} name={name} size={size} style={style} decorative={decorative} />
  );
}

function AvatarFace({source, name, size, style, decorative}: Required<Pick<Props, 'size' | 'decorative'>> & Omit<Props, 'size' | 'decorative'>) {
  const [failed, setFailed] = useState(false);
  const letters = initials(name);
  const showImage = !!source && !failed;
  return (
    <View
      accessible={!decorative}
      accessibilityRole={decorative ? undefined : 'image'}
      accessibilityLabel={decorative ? undefined : name}
      importantForAccessibility={decorative ? 'no-hide-descendants' : undefined}
      accessibilityElementsHidden={decorative}
      style={[
        cardSurface(colors.greenSoft, {lip: 3, level: 'sm', radius: size / 2, border: colors.white}),
        {width: size, height: size, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', borderWidth: 2},
        style,
      ]}>
      {showImage ? (
        <MediaImage source={source} resizeMode="cover" onError={() => setFailed(true)} style={{width: '100%', height: '100%', backgroundColor: glass(1, colors.greenSoft)}} />
      ) : letters ? (
        <Text style={{fontSize: Math.max(13, Math.round(size * 0.36)), lineHeight: Math.round(size * 0.5), fontWeight: '700', color: colors.greenText, textAlign: 'center'}}>{letters}</Text>
      ) : (
        <Icon name="person" size={Math.round(size * 0.55)} color={colors.greenText} />
      )}
    </View>
  );
}
