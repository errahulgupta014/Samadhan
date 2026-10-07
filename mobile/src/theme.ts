/**
 * SAMADHAN design tokens.
 *
 * One source of truth for colour, type, radius, spacing and the layered
 * "raised" (3D) shadow helpers. Pure data + pure functions only, so it can be
 * imported from any module (including Design.tsx and CivicArt.tsx) without
 * creating an import cycle.
 *
 * Accessibility contract (checked with a contrast script, WCAG 2.x):
 *  - ink / navy / textSecondary / textTertiary are >= 4.5:1 on paper, white,
 *    paperDeep and the tinted surfaces (greenSoft, saffronSoft).
 *  - textTertiary stays >= 4.5:1 even on the darkest CivicWatermark blend
 *    (paper + 10% navy), see WATERMARK_MAX_ALPHA below.
 *  - Never put white text on saffron: use onFill(fill) which picks the more
 *    legible of white / ink for any fill.
 */
import {Platform, type BoxShadowValue} from 'react-native';

/* ------------------------------------------------------------------ colour */

export const colors = {
  // Brand. #152B50 is retired: navy is #193753 everywhere.
  navy: '#193753',
  navyDeep: '#0F2438',
  navySoft: '#2A5278',
  green: '#12754F',
  greenDeep: '#0C5A3C',
  greenSoft: '#E4F2EA',
  saffron: '#FF9933',
  saffronDeep: '#C2610A',
  saffronSoft: '#FFF0DC',
  // Flag stripes (decorative only; use `green` for text and controls).
  flagGreen: '#138808',
  white: '#FFFFFF',

  // Surfaces
  paper: '#FFFEFA',
  paperDeep: '#F8F8F1',
  surface: '#FFFFFF',
  inset: '#F1F4F1',

  // Text. All >= 4.5:1 on paper / white.
  ink: '#14283D',
  textSecondary: '#4B5B66',
  textTertiary: '#5A6875',
  textInverse: '#FFFFFF',
  // Text-safe accents (saffron / green are fills; these are for copy).
  saffronText: '#8A4B06',
  greenText: '#0E6B49',

  // Lines
  border: '#D5DFD8', // decorative dividers / card edges
  borderStrong: '#7C8B96', // input and control boundaries, >= 3:1
  divider: '#E6ECE8',
  focus: '#12754F',

  // Semantic. `x` is text-safe (>= 4.5:1 on white), `xBg` is a soft surface.
  success: '#176B48',
  successBg: '#E4F2EA',
  warning: '#7A4B00',
  warningBg: '#FFF4DC',
  error: '#B3261E',
  errorBg: '#FDECEA',
  info: '#1F5F8B',
  infoBg: '#E6F0F8',
} as const;

export type ColorToken = keyof typeof colors;

/** Highest effective alpha CivicWatermark may paint with a navy tone. */
export const WATERMARK_MAX_ALPHA = 0.1;
/** Accent (saffron / flag-green) watermark strokes are thin, so they may be slightly stronger. */
export const WATERMARK_ACCENT_MAX_ALPHA = 0.2;

type RGB = readonly [number, number, number];

const clamp = (n: number, lo = 0, hi = 255) => Math.min(hi, Math.max(lo, n));
const hex2 = (n: number) => Math.round(clamp(n)).toString(16).padStart(2, '0');

/** Parses #rgb, #rrggbb, #rrggbbaa, rgb() and rgba(). Returns null otherwise. */
export function parseColor(input: string): RGB | null {
  const c = input.trim();
  if (c[0] === '#') {
    const h = c.slice(1);
    if (h.length === 3 || h.length === 4) {
      return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16)];
    }
    if (h.length === 6 || h.length === 8) {
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    }
    return null;
  }
  const m = c.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Colour with alpha, as an rgba() string. Non-parsable input is returned unchanged. */
export function rgba(color: string, alpha: number): string {
  const rgb = parseColor(color);
  return rgb ? `rgba(${Math.round(rgb[0])}, ${Math.round(rgb[1])}, ${Math.round(rgb[2])}, ${alpha})` : color;
}

/** Linear mix of two colours, t = 0 -> a, t = 1 -> b. */
export function mix(a: string, b: string, t: number): string {
  const x = parseColor(a);
  const y = parseColor(b);
  if (!x || !y) return a;
  return `#${hex2(x[0] + (y[0] - x[0]) * t)}${hex2(x[1] + (y[1] - x[1]) * t)}${hex2(x[2] + (y[2] - x[2]) * t)}`;
}

const SHADE_TARGET = '#08131F';

/** Darker version of a colour (mixed towards a deep ink so hue stays natural). */
export const shade = (color: string, amount: number) => mix(color, SHADE_TARGET, amount);
/** Lighter version of a colour. */
export const tint = (color: string, amount: number) => mix(color, '#FFFFFF', amount);

/** WCAG relative luminance, 0 (black) .. 1 (white). */
export function luminance(color: string): number {
  const rgb = parseColor(color);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map(v => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colours (1 .. 21). */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** The legible foreground (white or ink) for a given fill colour. */
export function onFill(fill: string): string {
  return contrastRatio(colors.white, fill) >= contrastRatio(colors.ink, fill) ? colors.white : colors.ink;
}

/* -------------------------------------------------------------------- type */

export const MIN_FONT = 12;
export const MIN_FONT_DEVANAGARI = 13;
export const DEVANAGARI_LINE_HEIGHT = 1.5;
export const DEVANAGARI_RE = /[ऀ-ॿ]/;

export const fonts = {
  regular: 'Poppins_400Regular',
  medium: 'Poppins_500Medium',
  semibold: 'Poppins_600SemiBold',
  bold: 'Poppins_700Bold',
} as const;

/** Poppins family for a numeric / keyword fontWeight. */
export function fontFamilyFor(weight: number): (typeof fonts)[keyof typeof fonts] {
  return weight >= 700 ? fonts.bold : weight >= 600 ? fonts.semibold : weight >= 500 ? fonts.medium : fonts.regular;
}

/** Type scale. Nothing below 12px; Devanagari bumps to 13px+ via hindiType(). */
export const typeScale = {
  caption: {fontSize: 12, lineHeight: 18},
  small: {fontSize: 13, lineHeight: 19},
  body: {fontSize: 14, lineHeight: 21},
  bodyMd: {fontSize: 15, lineHeight: 22},
  bodyLg: {fontSize: 16, lineHeight: 24},
  titleSm: {fontSize: 17, lineHeight: 24},
  title: {fontSize: 18, lineHeight: 26},
  titleMd: {fontSize: 19, lineHeight: 26},
  heading: {fontSize: 22, lineHeight: 30},
  h2: {fontSize: 26, lineHeight: 34},
  h1: {fontSize: 28, lineHeight: 37},
  hero: {fontSize: 30, lineHeight: 38},
  display: {fontSize: 34, lineHeight: 43},
} as const;

export type TypeStep = keyof typeof typeScale;

/** The Devanagari-safe version of a type step: >= 13px, line height >= 1.5x, no tracking. */
export function hindiType(step: TypeStep): {fontSize: number; lineHeight: number; letterSpacing: 0} {
  const fontSize = Math.max(MIN_FONT_DEVANAGARI, typeScale[step].fontSize);
  return {fontSize, lineHeight: Math.ceil(fontSize * DEVANAGARI_LINE_HEIGHT), letterSpacing: 0};
}

/* ------------------------------------------------------------ radius / space */

export const radius = {xs: 6, sm: 10, md: 14, lg: 18, xl: 24, pill: 999} as const;
export const spacing = {xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48} as const;

/* ------------------------------------------------------------ raised / bevel */

export type ShadowLevel = 'flat' | 'sm' | 'md' | 'lg';

const LEVELS: Record<ShadowLevel, {y: number; blur: number; spread: number; alpha: number; elevation: number}> = {
  flat: {y: 0, blur: 0, spread: 0, alpha: 0, elevation: 0},
  sm: {y: 2, blur: 8, spread: -2, alpha: 0.1, elevation: 1},
  md: {y: 4, blur: 14, spread: -4, alpha: 0.14, elevation: 3},
  lg: {y: 8, blur: 22, spread: -6, alpha: 0.18, elevation: 5},
};

const AMBIENT = '#10202E';

/** Android before API 28 has no boxShadow; fall back to the elevation API there only. */
export const NEEDS_ELEVATION_FALLBACK = Platform.OS === 'android' && Number(Platform.Version) < 28;

/** Android elevation for a level, or undefined when boxShadow already does the job. */
export const elevationFor = (level: ShadowLevel): number | undefined =>
  NEEDS_ELEVATION_FALLBACK ? LEVELS[level].elevation : undefined;

/** Darker edge ("lip") colour for a fill. Light fills get a gentler lip. */
export const lipColor = (fill: string): string => shade(fill, luminance(fill) > 0.6 ? 0.08 : 0.2);

/**
 * Layered shadow stack for a raised surface of the given fill:
 *  1. coloured drop shadow (a darkened version of the fill),
 *  2. tight ambient contact shadow,
 *  3. inner top highlight,
 *  4. soft inner bottom shade above the lip.
 */
export function shadowLayers(fill: string, level: ShadowLevel = 'md'): BoxShadowValue[] {
  const spec = LEVELS[level];
  const light = luminance(fill) > 0.6;
  const base = light ? '#2A4A5E' : fill;
  const layers: BoxShadowValue[] = [];
  if (spec.alpha > 0) {
    layers.push({
      offsetX: 0,
      offsetY: spec.y,
      blurRadius: spec.blur,
      spreadDistance: spec.spread,
      color: rgba(shade(base, 0.3), light ? spec.alpha * 0.55 : spec.alpha),
    });
    layers.push({offsetX: 0, offsetY: 1, blurRadius: 2, color: rgba(AMBIENT, 0.05)});
  }
  layers.push({inset: true, offsetX: 0, offsetY: 1.5, blurRadius: 0, color: rgba('#FFFFFF', light ? 0.6 : 0.16)});
  layers.push({inset: true, offsetX: 0, offsetY: -2, blurRadius: 3, color: rgba(shade(fill, 0.45), light ? 0.04 : 0.08)});
  return layers;
}

/** Scales the outer shadows of a stack (used for the pressed state). Inset layers are kept. */
export function scaleShadows(layers: readonly BoxShadowValue[], factor: number): BoxShadowValue[] {
  const n = (v: number | string | undefined) => (typeof v === 'number' ? v * factor : v);
  return layers.map(l =>
    l.inset ? l : {...l, offsetY: n(l.offsetY) ?? 0, blurRadius: n(l.blurRadius), spreadDistance: n(l.spreadDistance)},
  );
}

export type Bevel = {
  borderBottomWidth: number;
  borderBottomColor: string;
  boxShadow: BoxShadowValue[];
  elevation?: number;
};

/**
 * Per-fill bevel: a darker bottom lip (borderBottomWidth + per-fill darker
 * colour) plus the layered shadow stack. Spread it next to the fill's
 * backgroundColor, or use raised(fill) from Design.tsx which does both.
 */
export function bevel(fill: string, options: {lip?: number; level?: ShadowLevel} = {}): Bevel {
  const {lip: requestedLip = 4, level = 'md'} = options;
  // Subtle depth: the edge is a fine line, not a thick slab (callers keep passing their original lip sizes).
  const lip = requestedLip > 0 ? Math.max(1, Math.round(requestedLip / 2)) : 0;
  const elevation = elevationFor(level);
  return {
    borderBottomWidth: lip,
    borderBottomColor: lipColor(fill),
    boxShadow: shadowLayers(fill, level),
    ...(elevation == null ? null : {elevation}),
  };
}

/* ---------------------------------------------------------------- gradients */

export type GradientStops = readonly [string, string, string];

/** Highlight -> base -> shade stops for a fill, used by GradientFill / GradientButton. */
export const gradientFor = (fill: string): GradientStops =>
  luminance(fill) > 0.6 ? [tint(fill, 0.3), fill, shade(fill, 0.03)] : [tint(fill, 0.07), fill, shade(fill, 0.08)];

export const gradients = {
  navy: gradientFor(colors.navy),
  green: gradientFor(colors.green),
  saffron: gradientFor(colors.saffron),
  /** Brand hero: navy sliding to a lighter blue, with a hint of the greens. */
  hero: [colors.navySoft, colors.navy, colors.navyDeep] as GradientStops,
} as const;

export type Tone = 'navy' | 'green' | 'saffron';

export const toneFill: Record<Tone, string> = {navy: colors.navy, green: colors.green, saffron: colors.saffron};

/** Flag stripes in order, for TirangaBand-style decoration. */
export const tricolour = [colors.saffron, colors.white, colors.flagGreen] as const;
