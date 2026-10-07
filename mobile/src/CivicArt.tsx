/**
 * Civic-services artwork for SAMADHAN: line-art motifs (streetlight, road and
 * pothole, water tap, drain, garbage bin, ward pin, municipal building, Ashoka
 * chakra) drawn with plain Views, plus <CivicWatermark/> which anchors them in
 * the screen margins at very low opacity.
 *
 * Deliberately has no dependency on Design.tsx (Design re-exports
 * CivicWatermark), so there is no import cycle and no icon-font load.
 *
 * Contrast: every motif group is painted at <= WATERMARK_MAX_ALPHA (10%) in
 * navy / green (saffron and flag-green accents are lighter than the paper, so
 * they cost less contrast). On the worst blend (paper + 10% navy) the
 * textTertiary token is still 4.7:1 and textSecondary 5.8:1.
 */
import React, {memo, useMemo, useState, useCallback, type ReactNode} from 'react';
import {View, StyleSheet, type LayoutChangeEvent, type StyleProp, type ViewStyle} from 'react-native';
import {WATERMARK_ACCENT_MAX_ALPHA, WATERMARK_MAX_ALPHA, colors, contrastRatio, mix} from './theme';

/* ------------------------------------------------------------------ motifs */

// Every motif is drawn on a 48 x 48 grid and scaled to `size`.
const GRID = 48;

const at = (left: number, top: number, width: number, height: number, extra?: ViewStyle): ViewStyle => ({
  position: 'absolute',
  left,
  top,
  width,
  height,
  ...extra,
});

const solid = (color: string, radius = 0): ViewStyle => ({backgroundColor: color, borderRadius: radius});

type Drawing = {base: ReactNode; accent?: ReactNode; accentAlpha?: number};

const bars = (n: number, make: (i: number) => ViewStyle) =>
  Array.from({length: n}, (_, i) => <View key={i} style={make(i)} />);

/** Draws a motif in `c`. Accents are painted separately, in their own colour and alpha. */
const DRAW = {
  streetlight: (c: string): Drawing => ({
    base: (
      <>
        <View style={at(9, 9, 3, 37, solid(c, 1.5))} />
        <View style={at(5, 44, 11, 3, solid(c, 1.5))} />
        <View style={at(9, 7, 24, 14, {borderTopWidth: 3, borderRightWidth: 3, borderColor: c, borderTopRightRadius: 14})} />
        <View
          style={at(25, 20, 14, 6, {
            backgroundColor: c,
            borderTopLeftRadius: 7,
            borderTopRightRadius: 7,
            borderBottomLeftRadius: 2,
            borderBottomRightRadius: 2,
          })}
        />
      </>
    ),
    // Cone of light under the lamp.
    accent: (
      <View
        style={at(20, 27, 0, 0, {
          borderLeftWidth: 12,
          borderRightWidth: 12,
          borderBottomWidth: 18,
          borderLeftColor: 'transparent',
          borderRightColor: 'transparent',
          borderBottomColor: colors.saffron,
        })}
      />
    ),
    accentAlpha: 0.2,
  }),

  road: (c: string): Drawing => ({
    base: (
      <>
        <View style={at(11, 0, 2.5, 46, {...solid(c, 1), transform: [{rotate: '16deg'}]})} />
        <View style={at(34.5, 0, 2.5, 46, {...solid(c, 1), transform: [{rotate: '-16deg'}]})} />
        <View style={at(22.4, 2, 1.8, 4, solid(c))} />
        <View style={at(22.1, 10, 2.4, 6, solid(c))} />
        <View style={at(21.7, 19, 3, 8, solid(c))} />
        <View style={at(13, 33, 22, 11, {borderWidth: 2.5, borderColor: c, borderRadius: 11})} />
      </>
    ),
    // The pothole itself.
    accent: <View style={at(17, 36.5, 14, 6, solid(colors.saffron, 7))} />,
    accentAlpha: 0.2,
  }),

  tap: (c: string): Drawing => ({
    base: (
      <>
        <View style={at(15, 3, 16, 3, solid(c, 1.5))} />
        <View style={at(22, 5, 3, 6, solid(c))} />
        <View style={at(4, 10, 32, 9, {borderWidth: 2.5, borderColor: c, borderRadius: 3})} />
        <View
          style={at(29, 19, 9, 9, {
            borderLeftWidth: 2.5,
            borderRightWidth: 2.5,
            borderBottomWidth: 2.5,
            borderColor: c,
            borderBottomLeftRadius: 4,
            borderBottomRightRadius: 4,
          })}
        />
      </>
    ),
    accent: (
      <>
        <View style={at(29.5, 31, 9, 9, {...solid(colors.flagGreen, 4.5), borderTopLeftRadius: 0, transform: [{rotate: '45deg'}]})} />
        <View style={at(37, 41, 6, 6, {...solid(colors.flagGreen, 3), borderTopLeftRadius: 0, transform: [{rotate: '45deg'}]})} />
      </>
    ),
    accentAlpha: 0.14,
  }),

  drain: (c: string): Drawing => ({
    base: (
      <>
        <View style={at(2, 8, 44, 28, {borderWidth: 3, borderColor: c, borderRadius: 5})} />
        {bars(6, i => at(8.5 + i * 6, 13, 2.6, 18, solid(c, 1.3)))}
      </>
    ),
    // Water running off the kerb.
    accent: (
      <>
        <View style={at(8, 41, 9, 3, solid(colors.flagGreen, 1.5))} />
        <View style={at(21, 42, 15, 3, solid(colors.flagGreen, 1.5))} />
        <View style={at(40, 41, 4, 3, solid(colors.flagGreen, 1.5))} />
      </>
    ),
    accentAlpha: 0.14,
  }),

  bin: (c: string): Drawing => ({
    base: (
      <>
        <View
          style={at(18, 2, 12, 7, {
            borderTopWidth: 2.5,
            borderLeftWidth: 2.5,
            borderRightWidth: 2.5,
            borderColor: c,
            borderTopLeftRadius: 3,
            borderTopRightRadius: 3,
          })}
        />
        <View style={at(5, 8, 38, 5, solid(c, 2.5))} />
        <View
          style={at(9, 15, 30, 31, {
            borderWidth: 2.5,
            borderColor: c,
            borderBottomLeftRadius: 7,
            borderBottomRightRadius: 7,
          })}
        />
      </>
    ),
    accent: <>{bars(3, i => at(16.5 + i * 6.3, 20, 2.4, 20, solid(colors.saffron, 1.2)))}</>,
    accentAlpha: 0.2,
  }),

  pin: (c: string): Drawing => ({
    base: (
      <>
        <View
          style={at(10, 2, 28, 28, {
            borderWidth: 3,
            borderColor: c,
            borderRadius: 14,
            borderBottomLeftRadius: 0,
            transform: [{rotate: '-45deg'}],
          })}
        />
        <View style={at(19, 11, 10, 10, {borderWidth: 2.5, borderColor: c, borderRadius: 5})} />
      </>
    ),
    // Ground shadow / ward patch under the pin.
    accent: <View style={at(10, 40, 28, 6, solid(colors.saffron, 3))} />,
    accentAlpha: 0.2,
  }),

  building: (c: string): Drawing => ({
    base: (
      <>
        <View
          style={at(4, 10, 0, 0, {
            borderLeftWidth: 20,
            borderRightWidth: 20,
            borderBottomWidth: 11,
            borderLeftColor: 'transparent',
            borderRightColor: 'transparent',
            borderBottomColor: c,
          })}
        />
        <View style={at(5, 21, 38, 3, solid(c))} />
        {bars(4, i => at(8 + i * 10.5, 25, 4, 16, solid(c, 1)))}
        <View style={at(3, 41, 42, 3, solid(c))} />
        <View style={at(0, 45, 48, 3, solid(c))} />
      </>
    ),
    // Flag on the roof.
    accent: (
      <>
        <View style={at(23.2, 1, 1.6, 9, solid(colors.saffron))} />
        <View style={at(24.8, 1, 8, 2.5, solid(colors.saffron))} />
        <View style={at(24.8, 3.5, 8, 2.5, solid(colors.flagGreen))} />
      </>
    ),
    accentAlpha: 0.2,
  }),

  chakra: (c: string): Drawing => ({
    base: (
      <>
        <View style={at(1, 1, 46, 46, {borderWidth: 2.5, borderColor: c, borderRadius: 23})} />
        {bars(12, i => at(23.25, 4.5, 1.5, 39, {backgroundColor: c, transform: [{rotate: `${i * 15}deg`}]}))}
        <View style={at(19, 19, 10, 10, solid(c, 5))} />
      </>
    ),
  }),
} as const;

export type MotifName = keyof typeof DRAW;

/** Every layer is clamped: base strokes by WATERMARK_MAX_ALPHA, accents by WATERMARK_ACCENT_MAX_ALPHA. */
const BASE_ALPHA = {navy: Math.min(0.085, WATERMARK_MAX_ALPHA), green: Math.min(0.09, WATERMARK_MAX_ALPHA)} as const;
const accentAlphaOf = (alpha = 0.15) => Math.min(alpha, WATERMARK_ACCENT_MAX_ALPHA);

// Dev guard: tertiary text must stay >= 4.5:1 on paper under the strongest allowed navy stroke.
if (__DEV__ && contrastRatio(colors.textTertiary, mix(colors.paper, colors.navy, WATERMARK_MAX_ALPHA)) < 4.5) {
  console.warn('CivicWatermark: WATERMARK_MAX_ALPHA breaks the 4.5:1 text contrast on tertiary text.');
}

export type MotifProps = {
  name: MotifName;
  size?: number;
  /** Line colour of the motif. Accents keep their own tricolour colours. */
  tone?: 'navy' | 'green';
  rotate?: number;
  /** Overall multiplier (0..1) on the motif's alphas; default 1. Never raises the contrast cap. */
  strength?: number;
  style?: StyleProp<ViewStyle>;
};

const FILL: ViewStyle = {position: 'absolute', left: 0, top: 0, width: GRID, height: GRID};

/**
 * One motif. Painted as two groups (line art, then accent), each composited as
 * a single layer so overlapping strokes never double up and the effective
 * opacity really is the stated one (including on Android).
 */
export const CivicMotif = memo(function CivicMotif({name, size = 64, tone = 'navy', rotate = 0, strength = 1, style}: MotifProps) {
  const lineColor = tone === 'green' ? colors.green : colors.navy;
  const drawing = DRAW[name](lineColor);
  const k = size / GRID;
  const s = Math.min(1, Math.max(0, strength));
  return (
    <View
      aria-hidden
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{position: 'absolute', width: size, height: size, pointerEvents: 'none'}, style]}>
      <View
        style={{
          position: 'absolute',
          left: (size - GRID) / 2,
          top: (size - GRID) / 2,
          width: GRID,
          height: GRID,
          transform: [{rotate: `${rotate}deg`}, {scale: k}],
        }}>
        <View needsOffscreenAlphaCompositing style={[FILL, {opacity: BASE_ALPHA[tone] * s}]}>
          {drawing.base}
        </View>
        {drawing.accent ? (
          <View needsOffscreenAlphaCompositing style={[FILL, {opacity: accentAlphaOf(drawing.accentAlpha) * s}]}>
            {drawing.accent}
          </View>
        ) : null}
      </View>
    </View>
  );
});

/* --------------------------------------------------------------- watermark */

type Side = 'left' | 'right';
type Placement = {key: string; name: MotifName; side: Side; edge: number; top: number; size: number; rotate: number; tone: 'navy' | 'green'; style?: ViewStyle};

const RIGHT_COLUMN: MotifName[] = ['streetlight', 'pin', 'tap', 'bin', 'drain', 'building', 'road'];
const LEFT_COLUMN: MotifName[] = ['building', 'road', 'chakra', 'tap', 'streetlight', 'pin', 'bin'];
const TILTS = [-9, 6, -4, 10, -7, 3];

/**
 * Two edge columns of motifs, left staggered half a row against the right.
 * Deterministic (no randomness) so renders are stable. Horizontal placement is
 * from the nearest edge only, never from window width, so it also behaves in a
 * narrow centred web preview.
 */
function placements(height: number, sparse: boolean): Placement[] {
  const rows = Math.max(3, Math.round(height / (sparse ? 200 : 130)));
  const slot = height / rows;
  const out: Placement[] = [];
  for (let i = 0; i < rows; i++) {
    const size = 58 + ((i * 17) % 5) * 5;
    out.push({
      key: `r${i}`,
      name: RIGHT_COLUMN[i % RIGHT_COLUMN.length],
      side: 'right',
      edge: -(8 + ((i * 11) % 20)),
      top: Math.round((i + 0.5) * slot - size / 2),
      size,
      rotate: TILTS[i % TILTS.length],
      tone: i % 2 === 0 ? 'navy' : 'green',
    });
    const lsize = 56 + ((i * 13) % 5) * 5;
    const ltop = Math.round((i + 1) * slot - lsize / 2);
    if (ltop < height - 36) {
      out.push({
        key: `l${i}`,
        name: LEFT_COLUMN[i % LEFT_COLUMN.length],
        side: 'left',
        edge: -(10 + ((i * 13) % 22)),
        top: ltop,
        size: lsize,
        rotate: TILTS[(i + 3) % TILTS.length],
        tone: i % 2 === 0 ? 'green' : 'navy',
      });
    }
  }
  return out.map(p=>({...p,style:{top:p.top,[p.side]:p.edge}}));
}

export type CivicWatermarkProps = {
  /** 'sparse' roughly halves the motif count (small or busy screens). */
  density?: 'regular' | 'sparse';
  /** Hide the soft saffron / green colour washes behind the motifs. */
  plain?: boolean;
  /** Actual laid-out tab bar height; keep the bottom row above navigation. */
  bottomInset?: number;
};

/**
 * Low-opacity civic-services watermark. Render it as the FIRST child of a
 * screen root (behind content and outside KeyboardAvoidingView). Its own layout
 * reflects safe-area padding, the real container size and the measured tab bar.
 * Memoisation isolates this decorative tree from form/slider state changes.
 */
export const CivicWatermark = memo(function CivicWatermark({density = 'regular', plain = false, bottomInset = 0}: CivicWatermarkProps = {}) {
  const [size,setSize]=useState({width:0,height:0});
  const onLayout=useCallback((event:LayoutChangeEvent)=>{const {width,height}=event.nativeEvent.layout;setSize(old=>old.width===width&&old.height===height?old:{width,height});},[]);
  const items = useMemo(() => size.height>0?placements(size.height, density === 'sparse'):[], [size.height, density]);
  return (
    <View
      aria-hidden
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID="civic-watermark"
      onLayout={onLayout}
      style={[StyleSheet.absoluteFill,{bottom:bottomInset,overflow:'hidden',pointerEvents:'none'}]}>
      {plain ? null : (
        <>
          <View
            style={{
              position: 'absolute',
              width: 300,
              height: 300,
              borderRadius: 150,
              backgroundColor: colors.saffronSoft,
              opacity: 0.32,
              right: -160,
              top: 40,
            }}
          />
          <View
            style={{
              position: 'absolute',
              width: 260,
              height: 260,
              borderRadius: 130,
              backgroundColor: colors.greenSoft,
              opacity: 0.38,
              left: -170,
              bottom: 20,
            }}
          />
        </>
      )}
      {items.map(p => (
        <CivicMotif
          key={p.key}
          name={p.name}
          size={p.size}
          tone={p.tone}
          rotate={p.rotate}
          style={p.style}
        />
      ))}
    </View>
  );
});
