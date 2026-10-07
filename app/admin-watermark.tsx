import type {CSSProperties, ReactNode} from 'react';
import {Building2, Construction, Droplets, Lamp, MapPin, Trash2, Waves} from 'lucide-react';

/**
 * Faint civic watermark behind the administrator sign-in (the web twin of the mobile app's CivicWatermark):
 * a streetlight, road works, a tap, a drain, a bin, a ward pin, the municipal building and the Ashoka chakra,
 * drawn as thin line art at very low opacity along the two screen edges so it never competes with the form.
 * Decorative only: aria-hidden, no pointer events, and the card on top stays fully readable.
 */
const NAVY = '#172D4F';
const GREEN = '#197448';
const SAFFRON = '#F3A24C';

type Motif = {key: string; node: (size: number) => ReactNode; side: 'left' | 'right'; top: number; edge: number; size: number; rotate: number; tone: string; alpha: number};
const stroke = (size: number) => ({size, strokeWidth: 1.4, absoluteStrokeWidth: false});

function Chakra({size}: {size: number}) {
  const spokes = Array.from({length: 24}, (_, i) => (i * 360) / 24);
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <circle cx="50" cy="50" r="46" />
      <circle cx="50" cy="50" r="8" />
      {spokes.map(a => (
        <line key={a} x1="50" y1="42" x2="50" y2="6" transform={`rotate(${a} 50 50)`} />
      ))}
    </svg>
  );
}

const MOTIFS: Motif[] = [
  {key: 'chakra', node: s => <Chakra size={s} />, side: 'left', top: 4, edge: -34, size: 150, rotate: 8, tone: SAFFRON, alpha: 0.2},
  {key: 'light', node: s => <Lamp {...stroke(s)} />, side: 'left', top: 26, edge: 28, size: 84, rotate: -6, tone: NAVY, alpha: 0.085},
  {key: 'tap', node: s => <Droplets {...stroke(s)} />, side: 'left', top: 47, edge: -8, size: 96, rotate: 10, tone: GREEN, alpha: 0.09},
  {key: 'building', node: s => <Building2 {...stroke(s)} />, side: 'left', top: 68, edge: 34, size: 110, rotate: 0, tone: NAVY, alpha: 0.085},
  {key: 'bin', node: s => <Trash2 {...stroke(s)} />, side: 'left', top: 88, edge: -6, size: 72, rotate: -8, tone: GREEN, alpha: 0.09},
  {key: 'road', node: s => <Construction {...stroke(s)} />, side: 'right', top: 6, edge: 20, size: 100, rotate: 6, tone: NAVY, alpha: 0.085},
  {key: 'pin', node: s => <MapPin {...stroke(s)} />, side: 'right', top: 27, edge: -10, size: 92, rotate: -10, tone: SAFFRON, alpha: 0.2},
  {key: 'drain', node: s => <Waves {...stroke(s)} />, side: 'right', top: 49, edge: 30, size: 88, rotate: 0, tone: GREEN, alpha: 0.09},
  {key: 'chakra2', node: s => <Chakra size={s} />, side: 'right', top: 70, edge: -40, size: 130, rotate: -12, tone: GREEN, alpha: 0.12},
  {key: 'light2', node: s => <Lamp {...stroke(s)} />, side: 'right', top: 90, edge: 24, size: 70, rotate: 8, tone: NAVY, alpha: 0.085},
];

export default function AdminWatermark() {
  return (
    <div className="admin-watermark" aria-hidden="true">
      {MOTIFS.map(m => {
        const style: CSSProperties = {top: `${m.top}%`, [m.side]: m.edge, color: m.tone, opacity: m.alpha, transform: `rotate(${m.rotate}deg)`};
        return (
          <span key={m.key} className={`admin-watermark-item admin-watermark-${m.side}`} style={style}>
            {m.node(m.size)}
          </span>
        );
      })}
    </div>
  );
}
