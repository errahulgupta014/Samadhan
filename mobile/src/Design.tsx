/**
 * SAMADHAN design primitives.
 *
 *  - Text / TextInput / Pressable: drop-in replacements for the React Native
 *    ones (existing imports keep working).
 *  - depth, raised(fill), pressedState, insetStyle, barSurface: the layered
 *    "3D" look (raised lip + coloured shadow, collapsing press, inset fields).
 *  - GradientFill, GradientButton, IconTile, Tilt: gradient and perspective.
 *  - Glyph / Arrow: icons for characters Poppins lacks (arrows, crosshair, tick).
 *  - CivicWatermark / CivicMotif: re-exported from CivicArt.tsx.
 *
 * Tokens live in theme.ts and are re-exported from here.
 */
import React, {createContext, useContext, useEffect, useState, type ComponentProps, type ReactNode} from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Platform,
  Text as NativeText,
  TextInput as NativeInput,
  Pressable as NativePressable,
  StyleSheet,
  View,
  type PressableProps,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type TextStyle,
  type ViewProps,
  type ViewStyle,
} from 'react-native';
import {LinearGradient} from 'expo-linear-gradient';
import Ionicons from '@expo/vector-icons/Ionicons';
import {
  DEVANAGARI_LINE_HEIGHT,
  DEVANAGARI_RE,
  MIN_FONT,
  MIN_FONT_DEVANAGARI,
  bevel,
  colors,
  elevationFor,
  fontFamilyFor,
  gradientFor,
  luminance,
  onFill,
  radius,
  rgba,
  scaleShadows,
  shadowLayers,
  lipColor,
  shade,
  toneFill,
  typeScale,
  type ShadowLevel,
  type Tone,
} from './theme';
import {statusLabel, statusMeta, type IconName, type StatusTone} from './labels';

export * from './theme';
export {CivicWatermark, CivicMotif} from './CivicArt';
export type {CivicWatermarkProps, MotifName, MotifProps} from './CivicArt';

export const FontsReady = createContext(false);

/* ------------------------------------------------------------------ depth */

/**
 * Layered raised surface for neutral (white / light) cards and controls. It is
 * the successor of the old flat `depth` and is spread into styles exactly the
 * same way. Pressables that spread it on top of a dark `backgroundColor`
 * automatically get a per-fill lip and coloured shadow (see adaptDepth), so
 * existing screens pick up the 3D look without edits.
 */
export const depth = {...bevel(colors.white, {lip: 3, level: 'sm'}), borderBottomColor: colors.border};

/**
 * A raised, tactile surface for any fill colour: backgroundColor, a darker
 * per-fill bottom lip (borderBottomWidth), and a layered shadow (coloured drop
 * shadow, contact shadow, top highlight, soft inner base). Android below API 28
 * gets `elevation` instead of boxShadow.
 */
export function raised(fill: string, options: {lip?: number; level?: ShadowLevel} = {}): ViewStyle {
  return {backgroundColor: fill, ...bevel(fill, options)};
}

/** Surface for a bottom tab bar / toolbar: shadow cast upwards, bright top edge. */
export function barSurface(fill: string = colors.surface): ViewStyle {
  const elevation = elevationFor('md');
  return {
    backgroundColor: fill,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    boxShadow: [
      {offsetX: 0, offsetY: -4, blurRadius: 16, spreadDistance: -4, color: rgba(colors.navy, 0.09)},
      {inset: true, offsetX: 0, offsetY: 1, blurRadius: 0, color: rgba(colors.white, 0.5)},
    ],
    ...(elevation == null ? null : {elevation}),
  };
}

/**
 * Style overrides for the pressed state of a raised control: the lip collapses
 * to 1px (the face moves down into it), the outer shadow shrinks, and the
 * control scales slightly. A matching marginBottom keeps the layout still, so
 * siblings never jump. Pass the control's flattened resting style.
 */
export function pressedState(flat?: ViewStyle | null): ViewStyle {
  const base = flat ?? {};
  const lip = typeof base.borderBottomWidth === 'number' ? base.borderBottomWidth : 0;
  const collapse = lip >= 2 && typeof base.height !== 'number' ? lip - 1 : 0;
  const out: ViewStyle = {opacity: (typeof base.opacity === 'number' ? base.opacity : 1) * 0.94};
  const press = [{translateY: collapse || 2}, {scale: 0.985}];
  out.transform = Array.isArray(base.transform) ? [...base.transform, ...press] : press;
  if (collapse) {
    out.borderBottomWidth = lip - collapse;
    const mb = base.marginBottom ?? base.marginVertical ?? base.margin ?? 0;
    if (typeof mb === 'number') out.marginBottom = mb + collapse;
  }
  if (Array.isArray(base.boxShadow)) out.boxShadow = scaleShadows(base.boxShadow, 0.3);
  else if (base.boxShadow) out.boxShadow = [{offsetX: 0, offsetY: 1, blurRadius: 2, color: rgba(colors.ink, 0.12)}];
  if (typeof base.elevation === 'number') out.elevation = Math.min(base.elevation, 1);
  return out;
}

/** `...depth` on a dark fill gets that fill's own lip and coloured shadow. */
function adaptDepth(flat?: ViewStyle | null): ViewStyle | null | undefined {
  if (!flat || flat.boxShadow !== depth.boxShadow) return flat;
  const fill = flat.backgroundColor;
  if (typeof fill !== 'string' || luminance(fill) > 0.6) return flat;
  return {...flat, borderBottomColor: lipColor(fill), boxShadow: shadowLayers(fill, 'sm')};
}

export type InsetState = {focused?: boolean; invalid?: boolean; disabled?: boolean};

/**
 * Recessed (inset) field look for text inputs: sunken background, darker top
 * edge and inner shadow, white lower highlight, a focus ring and an error
 * state. Works without inset-shadow support (older Android) because the top
 * edge is a real border; no elevation is used so the field never looks raised.
 */
export function insetStyle({focused = false, invalid = false, disabled = false}: InsetState = {}): TextStyle {
  const accent = invalid ? colors.error : focused ? colors.focus : null;
  return {
    backgroundColor: disabled ? colors.paperDeep : colors.inset,
    borderWidth: 1,
    borderTopWidth: 2,
    borderColor: accent ?? colors.borderStrong,
    borderTopColor: accent ?? colors.borderStrong,
    borderRadius: radius.md,
    elevation: 0,
    boxShadow: [
      ...(accent ? [{offsetX: 0, offsetY: 0, blurRadius: 0, spreadDistance: 3, color: rgba(accent, 0.28)}] : []),
      {inset: true, offsetX: 0, offsetY: 1, blurRadius: 3, color: rgba(colors.ink, 0.06)},
      ...(accent ? [] : [{offsetX: 0, offsetY: 1, blurRadius: 0, color: rgba(colors.white, 0.7)}]),
    ],
  };
}

/* ------------------------------------------------------------------- text */

const TextNesting = createContext(false);

function textOf(node: ReactNode, level = 0): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (level > 6) return '';
  if (Array.isArray(node)) return node.map(n => textOf(n, level + 1)).join('');
  if (React.isValidElement(node)) return textOf((node.props as {children?: ReactNode}).children, level + 1);
  return '';
}

function weightOf(value: TextStyle['fontWeight']): number | undefined {
  if (value == null) return undefined;
  if (value === 'bold') return 700;
  if (value === 'normal') return 400;
  const n = Number(value);
  return Number.isFinite(n) ? n : 400;
}

const DEFAULT_SIZE = 14;
const TEXT_MAX_SCALE = 1.5;
const INPUT_MAX_SCALE = 1.4;

/**
 * Poppins by weight for all text; the bundled Poppins files include Devanagari,
 * so Hindi strings use the same family and weights as English. Also:
 * zero letter-spacing and >= 1.5x line height for Devanagari, a 12px (13px
 * Devanagari) floor on declared font sizes, default ink colour and 14px only
 * on top-level Text (nested Text inherits from its parent), and a capped
 * maxFontSizeMultiplier so large system fonts cannot break layouts.
 */
export function Text({style, children, maxFontSizeMultiplier = TEXT_MAX_SCALE, ...props}: TextProps) {
  const ready = useContext(FontsReady);
  const nested = useContext(TextNesting);
  const flat = (StyleSheet.flatten(style) ?? {}) as TextStyle;
  const devanagari = DEVANAGARI_RE.test(textOf(children));

  const declared = typeof flat.fontSize === 'number' ? flat.fontSize : undefined;
  const floor = devanagari ? MIN_FONT_DEVANAGARI : MIN_FONT;
  const base = declared ?? (nested ? undefined : DEFAULT_SIZE);
  const size = base == null ? undefined : Math.max(base, floor);

  const overrides: TextStyle = {};
  if (size != null && size !== declared) overrides.fontSize = size;

  let lineHeight = flat.lineHeight;
  if (typeof lineHeight === 'number' && declared != null && size != null && size !== declared) {
    lineHeight = Math.round((lineHeight * size) / declared);
  }
  if (devanagari && size != null) lineHeight = Math.max(lineHeight ?? 0, Math.ceil(size * DEVANAGARI_LINE_HEIGHT));
  if (lineHeight !== flat.lineHeight) overrides.lineHeight = lineHeight;
  if (devanagari && flat.letterSpacing) overrides.letterSpacing = 0;

  const weight = weightOf(flat.fontWeight);
  if (ready && (!nested || weight != null)) {
    overrides.fontFamily = fontFamilyFor(weight ?? 400);
    overrides.fontWeight = 'normal';
  }

  const content = !nested && typeof children !== 'string' && typeof children !== 'number'
    ? <TextNesting.Provider value>{children}</TextNesting.Provider>
    : children;

  return (
    <NativeText
      {...props}
      maxFontSizeMultiplier={maxFontSizeMultiplier}
      style={[nested ? null : {color: colors.ink}, style, overrides]}>
      {content}
    </NativeText>
  );
}

// Inset fields draw their own focus ring (insetStyle), so the browser's default outline would be a second, mismatched ring on web.
const NO_OUTLINE: TextStyle = {outlineWidth: 0};

export type TextInputPropsEx = TextInputProps & {
  /** Opt in to the recessed (inset) field look with focus ring and error state. */
  inset?: boolean;
  /** Error state (red border and ring) for inset fields; also sets aria-invalid. */
  invalid?: boolean;
};

export function TextInput({
  style,
  inset,
  invalid,
  onFocus,
  onBlur,
  editable,
  placeholderTextColor = colors.textTertiary,
  maxFontSizeMultiplier = INPUT_MAX_SCALE,
  ...props
}: TextInputPropsEx) {
  const ready = useContext(FontsReady);
  const [focused, setFocused] = useState(false);
  const flat = (StyleSheet.flatten(style) ?? {}) as TextStyle;
  const sample = (typeof props.value === 'string' ? props.value : '') || props.defaultValue || props.placeholder || '';
  const devanagari = DEVANAGARI_RE.test(sample);
  const weight = weightOf(flat.fontWeight);
  const floor = devanagari ? MIN_FONT_DEVANAGARI : MIN_FONT;

  const overrides: TextStyle = {};
  if (typeof flat.fontSize === 'number' && flat.fontSize < floor) overrides.fontSize = floor;
  if (devanagari && flat.letterSpacing) overrides.letterSpacing = 0;
  if (devanagari && props.multiline) {
    const size = overrides.fontSize ?? (typeof flat.fontSize === 'number' ? flat.fontSize : DEFAULT_SIZE);
    overrides.lineHeight = Math.max(flat.lineHeight ?? 0, Math.ceil(size * DEVANAGARI_LINE_HEIGHT));
  }
  if (ready) {
    overrides.fontFamily = fontFamilyFor(weight ?? 400);
    overrides.fontWeight = 'normal';
  }

  return (
    <NativeInput
      aria-invalid={invalid || undefined}
      {...props}
      editable={editable}
      placeholderTextColor={placeholderTextColor}
      maxFontSizeMultiplier={maxFontSizeMultiplier}
      onFocus={e => {
        setFocused(true);
        onFocus?.(e);
      }}
      onBlur={e => {
        setFocused(false);
        onBlur?.(e);
      }}
      style={[inset ? insetStyle({focused, invalid, disabled: editable === false}) : null, inset ? NO_OUTLINE : null, style, overrides]}
    />
  );
}

/* -------------------------------------------------------------- pressable */

export type PressableFeedback = 'auto' | 'none';

/**
 * Shared tactile response (also for keyboard presses). Raised controls (any
 * style with a borderBottomWidth lip) collapse their lip and shadow and sink
 * into it; flat controls just dip and scale slightly. `feedback="none"` opts out.
 */
export function Pressable({style, feedback = 'auto', ...props}: PressableProps & {feedback?: PressableFeedback}) {
  return (
    <NativePressable
      {...props}
      style={state => {
        const flat = StyleSheet.flatten(typeof style === 'function' ? style(state) : style) as ViewStyle | undefined;
        const resting = adaptDepth(flat);
        if (!state.pressed || props.disabled || feedback === 'none') return resting;
        return [resting, pressedState(resting)];
      }}
    />
  );
}

/* ------------------------------------------------------------------ icons */

export type {IconName};

const GLYPHS = {
  forward: {name: 'arrow-forward'},
  back: {name: 'arrow-back'},
  up: {name: 'arrow-up'},
  down: {name: 'arrow-down'},
  'up-right': {name: 'arrow-up', rotate: 45},
  crosshair: {name: 'locate'},
  check: {name: 'checkmark'},
  'check-circle': {name: 'checkmark-circle'},
  close: {name: 'close'},
  'chevron-forward': {name: 'chevron-forward'},
  'chevron-back': {name: 'chevron-back'},
  'chevron-down': {name: 'chevron-down'},
} as const satisfies Record<string, {name: IconName; rotate?: number}>;

export type GlyphName = keyof typeof GLYPHS;

export type GlyphProps = {name: GlyphName; size?: number; color?: string; style?: StyleProp<TextStyle>};

/**
 * Icon for characters Poppins does not have (arrows, up-right arrow,
 * crosshair, check). Use instead of typing →, ←, ↗, ⌖, ✓ into Text.
 * Decorative: hidden from screen readers (label the parent control).
 */
export function Glyph({name, size = 18, color = colors.ink, style}: GlyphProps) {
  const spec: {name: IconName; rotate?: number} = GLYPHS[name];
  return (
    <Ionicons
      name={spec.name}
      size={size}
      color={color}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[style, spec.rotate ? {transform: [{rotate: `${spec.rotate}deg`}]} : null]}
    />
  );
}

export type ArrowDirection = 'forward' | 'back' | 'up' | 'down' | 'up-right';

/** Arrow glyph: <Arrow/> is a right arrow, <Arrow direction="up-right"/> is the external-link arrow. */
export function Arrow({direction = 'forward', ...props}: Omit<GlyphProps, 'name'> & {direction?: ArrowDirection}) {
  return <Glyph name={direction} {...props} />;
}

/* -------------------------------------------------------------- gradients */

type GradientColors = ComponentProps<typeof LinearGradient>['colors'];
export type GradientDirection = 'vertical' | 'diagonal' | 'horizontal';

const DIRECTIONS = {
  vertical: {start: {x: 0.5, y: 0}, end: {x: 0.5, y: 1}},
  diagonal: {start: {x: 0, y: 0}, end: {x: 1, y: 1}},
  horizontal: {start: {x: 0, y: 0.5}, end: {x: 1, y: 0.5}},
} as const;

export type GradientFillProps = Omit<ComponentProps<typeof LinearGradient>, 'colors' | 'start' | 'end' | 'locations'> & {
  /** Explicit stops (two or more). Wins over `color`. */
  colors?: GradientColors;
  /** Base colour: stops become highlight -> colour -> shade (see gradientFor). */
  color?: string;
  direction?: GradientDirection;
  /** Fill the parent (position absolute, all edges). Place it first in the parent. */
  absolute?: boolean;
};

/**
 * expo-linear-gradient with brand defaults. On web it is a CSS linear-gradient
 * (only the angle of start/end is honoured, so the three directions are
 * expressed as angles that work identically on both platforms).
 */
export function GradientFill({colors: stops, color, direction = 'vertical', absolute = false, style, children, ...rest}: GradientFillProps) {
  const {start, end} = DIRECTIONS[direction];
  return (
    <LinearGradient
      importantForAccessibility={absolute && !children ? 'no' : undefined}
      {...rest}
      colors={stops ?? gradientFor(color ?? colors.navy)}
      start={start}
      end={end}
      style={[absolute ? StyleSheet.absoluteFill : null, style]}>
      {children}
    </LinearGradient>
  );
}

export type GradientButtonProps = Omit<PressableProps, 'style' | 'children'> & {
  title?: string;
  /** Custom content instead of `title`. */
  children?: ReactNode;
  tone?: Tone;
  /** Any fill colour; wins over `tone`. */
  color?: string;
  /** Trailing icon, or 'arrow' for the standard forward arrow. */
  icon?: ReactNode | 'arrow';
  level?: ShadowLevel;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
};

/**
 * Primary / hero button: gradient face, per-fill raised lip and coloured
 * shadow, collapsing press. Label colour is chosen for contrast (white on navy
 * and green, ink on saffron).
 */
export function GradientButton({
  title,
  children,
  tone = 'navy',
  color,
  icon,
  level = 'md',
  style,
  textStyle,
  disabled,
  accessibilityLabel,
  ...rest
}: GradientButtonProps) {
  const fill = color ?? toneFill[tone];
  const fg = onFill(fill);
  const trailing = icon === 'arrow' ? <Arrow color={fg} size={20} /> : icon;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{disabled: !!disabled}}
      disabled={disabled}
      {...rest}
      style={[buttonBase, raised(fill, {lip: 4, level}), disabled ? {opacity: 0.5} : null, style]}>
      <GradientFill color={fill} absolute />
      <View style={[buttonRow, {justifyContent: trailing ? 'space-between' : 'center'}]}>
        {children ?? <Text style={[buttonLabel, trailing ? null : centeredLabel, {color: fg}, textStyle]}>{title}</Text>}
        {trailing}
      </View>
    </Pressable>
  );
}

const buttonBase: ViewStyle = {borderRadius: radius.md, overflow: 'hidden', paddingVertical: 15, paddingHorizontal: 20};
const buttonRow: ViewStyle = {flexDirection: 'row', alignItems: 'center', gap: 10};
const buttonLabel: TextStyle = {fontSize: 16, fontWeight: '600', flexShrink: 1};
const centeredLabel: TextStyle = {textAlign: 'center'};
const buttonSpacing: ViewStyle = {marginVertical: 8};

export type IconTileProps = {
  name: IconName;
  size?: number;
  tone?: Tone;
  color?: string;
  iconColor?: string;
  style?: StyleProp<ViewStyle>;
};

/** Raised gradient tile with an Ionicons glyph, for feature rows and category chips. */
export function IconTile({name, size = 44, tone = 'navy', color, iconColor, style}: IconTileProps) {
  const fill = color ?? toneFill[tone];
  return (
    <View
      style={[
        {width: size, height: size, borderRadius: Math.round(size * 0.3), overflow: 'hidden', alignItems: 'center', justifyContent: 'center'},
        raised(fill, {lip: 3, level: 'sm'}),
        style,
      ]}>
      <GradientFill color={fill} direction="diagonal" absolute />
      <Ionicons name={name} size={Math.round(size * 0.5)} color={iconColor ?? onFill(fill)} />
    </View>
  );
}

/* ------------------------------------------------------------------- tilt */

export type TiltProps = ViewProps & {
  /** Backwards lean in degrees; keep it small (1.5-4). */
  deg?: number;
  perspective?: number;
  /** 'bottom' keeps the bottom edge planted and leans the top away. */
  origin?: 'center' | 'bottom';
};

/**
 * Subtle perspective tilt (perspective + rotateX) for hero art and key cards.
 * Uses only the transform array, so it is identical on iOS, Android and web.
 * Decorative surfaces only: do not wrap ScrollViews or TextInputs in it.
 */
export function Tilt({deg = 2.5, perspective = 900, origin = 'bottom', style, ...rest}: TiltProps) {
  return (
    <View
      {...rest}
      style={[style, {transform: [{perspective}, {rotateX: `${deg}deg`}], transformOrigin: origin === 'bottom' ? '50% 100%' : '50% 50%'}]}
    />
  );
}

/* ======================================================================== */
/* Shared screen kit: glass cards, text styles, icon, buttons, fields,       */
/* chips, badges, notices, switch, selection marks, step dots.               */
/* ======================================================================== */

/**
 * A white (or tinted) surface that is slightly see-through, so CivicWatermark
 * shows faintly behind content-heavy screens. The watermark never exceeds 10%
 * alpha, so a 0.86-0.94 surface keeps text contrast above the token floor.
 */
export const glass = (alpha = 0.9, fill: string = colors.surface): string => rgba(fill, alpha);

/**
 * Raised card: translucent fill, hairline edge, per-fill lip and layered
 * shadow. Spread into a style (or pass to Pressable) exactly like `depth`.
 */
export function cardSurface(
  fill: string = glass(),
  options: {lip?: number; level?: ShadowLevel; radius?: number; border?: string} = {},
): ViewStyle {
  const {lip = 3, level = 'sm', radius: corner = radius.lg} = options;
  const edge = options.border ?? (luminance(fill) > 0.97 ? colors.border : shade(fill, 0.1));
  return {...raised(fill, {lip, level}), borderWidth: 1, borderColor: edge, borderRadius: corner};
}

/** Shared text styles built from the type scale. Hindi rules are applied by <Text>. */
export const textStyles = StyleSheet.create({
  display: {...typeScale.display, fontWeight: '700', color: colors.navy, letterSpacing: -0.6},
  h1: {...typeScale.h1, fontWeight: '700', color: colors.navy},
  h2: {...typeScale.title, fontWeight: '600', color: colors.navy},
  h3: {...typeScale.bodyLg, fontWeight: '600', color: colors.navy},
  body: {fontSize: 14, lineHeight: 23, color: colors.textSecondary},
  bodyLg: {fontSize: 16, lineHeight: 26, color: colors.textSecondary},
  caption: {...typeScale.caption, color: colors.textSecondary},
  tertiary: {...typeScale.caption, color: colors.textTertiary},
  eyebrow: {fontSize: 12, lineHeight: 18, letterSpacing: 1.3, fontWeight: '700', color: colors.greenText},
  label: {fontSize: 13, lineHeight: 19, fontWeight: '600', color: colors.ink},
  link: {fontSize: 13, lineHeight: 19, fontWeight: '600', color: colors.greenText},
});

/** Decorative Ionicons glyph, hidden from screen readers (label the parent control). */
export function Icon({name, size = 18, color = colors.ink, style}: {name: IconName; size?: number; color?: string; style?: StyleProp<TextStyle>}) {
  return (
    <Ionicons
      name={name}
      size={size}
      color={color}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={style}
    />
  );
}

/** Text link with a trailing arrow icon (replaces "View all ->", "Read source ->" strings). */
export function LinkLabel({
  children,
  glyph = 'forward',
  color = colors.greenText,
  size = 13,
  style,
}: {
  children: ReactNode;
  glyph?: GlyphName;
  color?: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[{flexDirection: 'row', alignItems: 'center', gap: 5}, style]}>
      <Text style={{fontSize: size, lineHeight: size + 7, fontWeight: '600', color}}>{children}</Text>
      <Glyph name={glyph} size={size + 4} color={color} />
    </View>
  );
}

/* ---------------------------------------------------------------- buttons */

export type ButtonVariant = 'primary' | 'success' | 'accent' | 'secondary';

export type ButtonProps = Omit<GradientButtonProps, 'tone' | 'color' | 'children'> & {
  /**
   * primary = navy (default action), success = green (confirm / save),
   * accent = saffron (the one highlight CTA on a screen: report, get started,
   * submit), secondary = raised light surface (neutral alternative).
   */
  variant?: ButtonVariant;
  /** Show a spinner in place of the trailing icon. */
  loading?: boolean;
};

const VARIANT_TONE: Record<Exclude<ButtonVariant, 'secondary'>, Tone> = {primary: 'navy', success: 'green', accent: 'saffron'};

/** The single button used across screens. Filled variants are GradientButtons. */
export function Button({title, variant = 'primary', icon, loading = false, disabled, style, textStyle, level, ...rest}: ButtonProps) {
  const fg = variant === 'secondary' ? colors.navy : onFill(toneFill[VARIANT_TONE[variant]]);
  const trailing = loading ? <ActivityIndicator color={fg} /> : icon === 'arrow' ? <Arrow color={fg} size={20} /> : icon;
  if (variant === 'secondary') {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={rest.accessibilityLabel ?? title}
        accessibilityState={{disabled: !!disabled, busy: loading}}
        disabled={disabled}
        {...rest}
        style={[buttonBase, buttonSpacing, cardSurface(glass(0.96), {lip: 4, level: level ?? 'sm', radius: radius.md}), disabled ? {opacity: 0.5} : null, style]}>
        <View style={[buttonRow, {justifyContent: trailing ? 'space-between' : 'center'}]}>
          <Text style={[buttonLabel, trailing ? null : centeredLabel, {color: fg}, textStyle]}>{title}</Text>
          {trailing}
        </View>
      </Pressable>
    );
  }
  return (
    <GradientButton
      tone={VARIANT_TONE[variant]}
      title={title}
      icon={trailing}
      disabled={disabled}
      level={level}
      style={[buttonSpacing, style]}
      textStyle={textStyle}
      accessibilityState={{disabled: !!disabled, busy: loading}}
      {...rest}
    />
  );
}

/** "7", "99+" (counts above 99 are capped for display). */
export const countLabel = (count: number) => (count > 99 ? '99+' : String(count));

/**
 * Unread-count pill (red, white edge, small lip): a bell, a tab icon. Renders nothing for 0. Decorative for screen readers:
 * the control it sits on must carry the count in its accessibility label.
 */
export function CountBadge({count, style}: {count: number; style?: StyleProp<ViewStyle>}) {
  if (!(count > 0)) return null;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        {
          minWidth: 20,
          height: 20,
          paddingHorizontal: 5,
          borderRadius: 10,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.error,
          borderWidth: 2,
          borderColor: colors.white,
          boxShadow: [{offsetX: 0, offsetY: 1, blurRadius: 2, color: rgba(colors.error, 0.45)}],
        },
        style,
      ]}>
      <Text style={{fontSize: 12, lineHeight: 15, fontWeight: '700', color: colors.white, textAlign: 'center'}}>{countLabel(count)}</Text>
    </View>
  );
}

export type IconButtonProps = Omit<PressableProps, 'style' | 'children'> & {
  /** An Ionicons name, or any node. */
  icon: IconName | ReactNode;
  /** Accessible name (required: the control has no visible text). */
  label: string;
  tone?: 'light' | 'navy' | 'green' | 'saffron';
  size?: number;
  round?: boolean;
  /** Small notification dot (light tone only), or an unread count (shown as a pill, capped at 99+). */
  badge?: boolean | number;
  style?: StyleProp<ViewStyle>;
};

const ICON_FILL = {navy: colors.navy, green: colors.green, saffron: colors.saffron} as const;

/** Square (or round) raised icon-only control: back, home, bell, remove. 44px by default. */
export function IconButton({icon, label, tone = 'light', size = 44, round = false, badge = false, disabled, style, ...rest}: IconButtonProps) {
  const corner = round ? size / 2 : Math.round(size * 0.32);
  const solid = tone !== 'light';
  const fill = solid ? ICON_FILL[tone] : glass(0.96);
  const fg = solid ? onFill(fill) : colors.navy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      {...rest}
      style={[
        {width: size, height: size, alignItems: 'center', justifyContent: 'center'},
        solid ? {...raised(fill, {lip: 3, level: 'sm'}), borderRadius: corner, overflow: 'hidden'} : cardSurface(fill, {lip: 3, level: 'sm', radius: corner}),
        disabled ? {opacity: 0.5} : null,
        style,
      ]}>
      {solid ? <GradientFill color={fill} direction="diagonal" absolute /> : null}
      {typeof icon === 'string' ? <Icon name={icon as IconName} size={Math.round(size * 0.5)} color={fg} /> : icon}
      {typeof badge === 'number' ? (
        <CountBadge count={badge} style={{position: 'absolute', top: -6, right: -6}} />
      ) : badge ? (
        <View
          style={{
            position: 'absolute',
            top: 8,
            right: 10,
            width: 12,
            height: 12,
            borderRadius: 6,
            backgroundColor: colors.saffron,
            borderWidth: 2,
            borderColor: colors.white,
            boxShadow: [{offsetX: 0, offsetY: 1, blurRadius: 2, color: rgba(colors.saffronDeep, 0.5)}],
          }}
        />
      ) : null}
    </Pressable>
  );
}

/* ----------------------------------------------------------------- fields */

export type FieldProps = Omit<TextInputPropsEx, 'style' | 'inset' | 'invalid' | 'secureTextEntry'> & {
  label: string;
  /** Helper text under the field. */
  hint?: string;
  /** Error text under the field; also turns the field's border and ring red. */
  error?: string;
  /** Number pad with punctuation (coordinates, codes). */
  numeric?: boolean;
  /** Password-style entry (hidden text, no auto-capitalisation). */
  secret?: boolean;
  containerStyle?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
};

/**
 * The one labelled text field used app-wide: label, recessed (inset) input
 * with focus ring and error state, optional hint or error line.
 */
export function Field({
  label,
  hint,
  error,
  numeric = false,
  secret = false,
  multiline = false,
  containerStyle,
  inputStyle,
  accessibilityLabel,
  autoCapitalize,
  keyboardType,
  ...rest
}: FieldProps) {
  return (
    <View style={[{marginVertical: 10}, containerStyle]}>
      <Text style={fieldLabel}>{label}</Text>
      <TextInput
        inset
        invalid={!!error}
        accessibilityLabel={accessibilityLabel ?? label}
        multiline={multiline}
        secureTextEntry={secret}
        keyboardType={numeric ? 'numbers-and-punctuation' : (keyboardType ?? 'default')}
        autoCapitalize={autoCapitalize ?? (secret ? 'none' : 'sentences')}
        style={[fieldInput, multiline ? fieldMultiline : null, inputStyle]}
        {...rest}
      />
      {error ? (
        <Text accessibilityRole="alert" style={fieldError}>
          {error}
        </Text>
      ) : hint ? (
        <Text style={fieldHint}>{hint}</Text>
      ) : null}
    </View>
  );
}

const fieldLabel: TextStyle = {fontSize: 13, lineHeight: 19, fontWeight: '600', color: colors.ink, marginBottom: 8};
const fieldInput: TextStyle = {fontSize: typeScale.bodyMd.fontSize, color: colors.ink, paddingVertical: 13, paddingHorizontal: 14, minHeight: 48};
const fieldMultiline: TextStyle = {minHeight: 120, maxHeight: 240, textAlignVertical: 'top'};
const fieldHint: TextStyle = {fontSize: 12, lineHeight: 18, color: colors.textSecondary, marginTop: 6};
const fieldError: TextStyle = {fontSize: 12, lineHeight: 18, color: colors.error, marginTop: 6};

/* ------------------------------------------------------------------ chips */

export type ChipProps = Omit<PressableProps, 'style' | 'children'> & {
  label: string;
  selected?: boolean;
  style?: StyleProp<ViewStyle>;
};

/** Filter chip: raised light pill, or a raised green pill with a gradient when selected. */
export function Chip({label, selected = false, style, ...rest}: ChipProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{selected}}
      {...rest}
      style={[
        chipBase,
        selected ? {...raised(colors.green, {lip: 3, level: 'sm'}), borderRadius: radius.pill} : cardSurface(glass(0.94), {lip: 3, level: 'sm', radius: radius.pill}),
        style,
      ]}>
      {selected ? <GradientFill color={colors.green} absolute /> : null}
      <Text style={{fontSize: 13, fontWeight: selected ? '700' : '500', color: selected ? colors.white : colors.ink}}>{label}</Text>
    </Pressable>
  );
}

const chipBase: ViewStyle = {minHeight: 44, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', overflow: 'hidden'};

/* ----------------------------------------------------------------- badges */

const BADGE_TONES: Record<StatusTone, {fg: string; bg: string}> = {
  info: {fg: colors.info, bg: colors.infoBg},
  progress: {fg: colors.warning, bg: colors.warningBg},
  attention: {fg: colors.saffronText, bg: colors.saffronSoft},
  success: {fg: colors.success, bg: colors.successBg},
  danger: {fg: colors.error, bg: colors.errorBg},
  neutral: {fg: colors.textSecondary, bg: colors.inset},
};

/** Complaint status pill: tone colour, icon (so meaning never relies on colour alone), localised text, small lip. */
export function StatusBadge({status, hindi = false, style}: {status: string; hindi?: boolean; style?: StyleProp<ViewStyle>}) {
  const meta = statusMeta(status);
  const tone = BADGE_TONES[meta.tone];
  return (
    <View
      style={[
        {flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', flexShrink: 1, paddingVertical: 4, paddingHorizontal: 9, borderRadius: radius.sm},
        {backgroundColor: tone.bg, ...bevel(tone.bg, {lip: 2, level: 'flat'})},
        style,
      ]}>
      <Icon name={meta.icon} size={14} color={tone.fg} />
      <Text style={{fontSize: 12, lineHeight: 17, fontWeight: '600', color: tone.fg, flexShrink: 1}}>{statusLabel(status, hindi)}</Text>
    </View>
  );
}

export type NoticeTone = 'error' | 'info' | 'success' | 'warning';

const NOTICE_TONES: Record<NoticeTone, {fg: string; bg: string; icon: IconName}> = {
  error: {fg: colors.error, bg: colors.errorBg, icon: 'alert-circle'},
  info: {fg: colors.info, bg: colors.infoBg, icon: 'information-circle'},
  success: {fg: colors.success, bg: colors.successBg, icon: 'checkmark-circle'},
  warning: {fg: colors.warning, bg: colors.warningBg, icon: 'warning'},
};

/** Inline message box with an icon: error (announced as an alert), info, success (live region) and warning. */
export function Notice({tone = 'info', children, style}: {tone?: NoticeTone; children: ReactNode; style?: StyleProp<ViewStyle>}) {
  const spec = NOTICE_TONES[tone];
  return (
    <View
      accessibilityRole={tone === 'error' ? 'alert' : undefined}
      accessibilityLiveRegion={tone === 'success' ? 'polite' : undefined}
      style={[
        cardSurface(glass(0.94, spec.bg), {lip: 2, level: 'flat', radius: radius.md}),
        {flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 13, marginVertical: 8},
        style,
      ]}>
      <Icon name={spec.icon} size={20} color={spec.fg} style={{marginTop: 1}} />
      <Text style={{flex: 1, fontSize: 13, lineHeight: 20, color: spec.fg}}>{children}</Text>
    </View>
  );
}

/* ----------------------------------------------------------------- switch */

const TRACK_W = 56;
const TRACK_H = 32;
const THUMB = 26;

/**
 * 3D switch: a recessed (inset) track that fills green when on, with a raised
 * thumb. Same contract as RN's Switch (value / onValueChange), 44px tall hit area.
 */
export function Toggle({
  value,
  onValueChange,
  accessibilityLabel,
  disabled = false,
  style,
}: {
  value: boolean;
  onValueChange: (next: boolean) => void;
  accessibilityLabel: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const [progress] = useState(() => new Animated.Value(value ? 1 : 0));
  useEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: value ? 1 : 0,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: Platform.OS !== 'web',
    });
    animation.start();
    return () => animation.stop();
  }, [value, progress]);
  const thumbX = progress.interpolate({inputRange: [0, 1], outputRange: [3, TRACK_W - THUMB - 3]});
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{checked: value, disabled}}
      disabled={disabled}
      hitSlop={{top: 6, bottom: 6, left: 6, right: 6}}
      onPress={() => onValueChange(!value)}
      style={[{width: TRACK_W, height: TRACK_H, opacity: disabled ? 0.5 : 1}, style]}>
      <View style={[StyleSheet.absoluteFill, toggleTrack]} />
      <Animated.View style={[StyleSheet.absoluteFill, toggleTrackOn, {opacity: progress}]}>
        <GradientFill color={colors.green} direction="horizontal" absolute />
      </Animated.View>
      <Animated.View
        style={[
          {position: 'absolute', top: (TRACK_H - THUMB) / 2 - 1, left: 0, width: THUMB, height: THUMB, borderRadius: THUMB / 2},
          raised(colors.white, {lip: 2, level: 'sm'}),
          {transform: [{translateX: thumbX}]},
        ]}
      />
    </Pressable>
  );
}

const toggleTrack: ViewStyle = {
  borderRadius: TRACK_H / 2,
  backgroundColor: colors.inset,
  borderWidth: 1,
  borderTopWidth: 2,
  borderColor: colors.borderStrong,
  borderTopColor: colors.borderStrong,
  boxShadow: [{inset: true, offsetX: 0, offsetY: 1, blurRadius: 3, color: rgba(colors.ink, 0.08)}],
};
const toggleTrackOn: ViewStyle = {
  borderRadius: TRACK_H / 2,
  overflow: 'hidden',
  borderBottomWidth: 2,
  borderBottomColor: lipColor(colors.green),
  boxShadow: [{inset: true, offsetX: 0, offsetY: 1, blurRadius: 3, color: rgba(colors.navyDeep, 0.16)}],
};

/* ------------------------------------------------------- selection / steps */

/**
 * Checkbox or radio mark (visual only: the surrounding row carries the
 * checkbox / radio role). Unchecked is recessed, checked is a raised green
 * tile with a tick (or a dot for radios).
 */
export function SelectionMark({kind = 'checkbox', selected, size = 24}: {kind?: 'checkbox' | 'radio'; selected: boolean; size?: number}) {
  const corner = kind === 'radio' ? size / 2 : Math.round(size * 0.3);
  if (!selected) {
    return (
      <View
        style={{
          width: size,
          height: size,
          borderRadius: corner,
          backgroundColor: colors.inset,
          borderWidth: 1.5,
          borderColor: colors.borderStrong,
          boxShadow: [{inset: true, offsetX: 0, offsetY: 2, blurRadius: 3, color: rgba(colors.ink, 0.07)}],
        }}
      />
    );
  }
  return (
    <View style={[{width: size, height: size, borderRadius: corner, overflow: 'hidden', alignItems: 'center', justifyContent: 'center'}, raised(colors.green, {lip: 2, level: 'sm'})]}>
      <GradientFill color={colors.green} direction="diagonal" absolute />
      {kind === 'radio' ? (
        <View style={{width: size * 0.34, height: size * 0.34, borderRadius: size * 0.17, backgroundColor: colors.white}} />
      ) : (
        <Glyph name="check" size={Math.round(size * 0.72)} color={colors.white} />
      )}
    </View>
  );
}

/** Onboarding / wizard progress: the active step is a raised green pill, finished steps are tinted dots, upcoming steps are recessed. */
export function StepDots({count, active, label, style}: {count: number; active: number; label?: string; style?: StyleProp<ViewStyle>}) {
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{min: 1, max: count, now: active + 1}}
      style={[{flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7}, style]}>
      {Array.from({length: count}, (_, i) =>
        i === active ? (
          <View key={i} style={[{width: 30, height: 10, borderRadius: 5, overflow: 'hidden'}, raised(colors.green, {lip: 2, level: 'sm'})]}>
            <GradientFill color={colors.green} direction="horizontal" absolute />
          </View>
        ) : (
          <View
            key={i}
            style={{
              width: 10,
              height: 10,
              borderRadius: 5,
              backgroundColor: i < active ? colors.greenSoft : colors.border,
              borderWidth: 1,
              borderColor: i < active ? colors.green : colors.borderStrong,
              boxShadow: i < active ? undefined : [{inset: true, offsetX: 0, offsetY: 1.5, blurRadius: 2, color: rgba(colors.ink, 0.18)}],
            }}
          />
        ),
      )}
    </View>
  );
}

/* ----------------------------------------------------------- language */

const languagePill: ViewStyle = {
  ...cardSurface(glass(0.96), {lip: 3, level: 'sm', radius: radius.pill}),
  minHeight: 44,
  flexDirection: 'row',
  alignItems: 'center',
  gap: 6,
  paddingHorizontal: 14,
};

/** English / Hindi switch (raised pill). Shows the language you will switch to. */
export function LanguageToggle({hindi, onPress, style}: {hindi: boolean; onPress: () => void; style?: StyleProp<ViewStyle>}) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={hindi ? 'Switch to English' : 'हिन्दी में बदलें'} onPress={onPress} style={[languagePill, style]}>
      <Icon name="language" size={17} color={colors.navy} />
      <Text style={{fontSize: 13, fontWeight: '600', color: colors.navy}}>{hindi ? 'English' : 'हिन्दी'}</Text>
    </Pressable>
  );
}
