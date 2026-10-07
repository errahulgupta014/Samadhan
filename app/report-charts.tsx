'use client';
import {useEffect,useRef,useState} from 'react';
import {chartTable, describeChart, fmtNum, type ChartSpec, type ChartUnit} from '@/lib/report-engine';

/**
 * Charts of the Reports page, drawn from the chart data the report engine returns (lib/report-engine.ts). Hand-built HTML and SVG instead of a chart library:
 * labels stay at a readable size on a phone (wide charts scroll inside their own box), colours print (see reports.css), and every chart has a spoken description (aria-label)
 * plus a plain table of the same values ("View as table").
 *   bar     horizontal bars, one per group (HTML)
 *   donut   shares of a whole (SVG ring + legend)
 *   line    trends over time, up to four lines (SVG)
 *   stacked horizontal stacked bars for Group by x Then by (HTML)
 */
type Of<K extends ChartSpec['kind']> = Extract<ChartSpec, {kind: K}>;
const fmt = (n: number | null, unit: ChartUnit) => n === null ? '—' : unit === 'pct' ? `${fmtNum(n)}%` : fmtNum(n);
/** White or navy text, whichever reads on the given #rrggbb colour. */
function inkFor(color: string) {
 const m = /^#([0-9a-f]{6})$/i.exec(color); if (!m) return '#fff';
 const n = parseInt(m[1], 16); return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 150 ? '#172D4F' : '#fff';
}

function BarChart({spec}: {spec: Of<'bar'>}) {
 const max = spec.unit === 'pct' ? 100 : Math.max(1, ...spec.items.map(i => i.value));
 return <div className="rp-bars" role="img" aria-label={describeChart(spec)}>
  {spec.items.map(i => <div className="rp-bar-row" key={i.key}>
   <span className="rp-bar-label" title={i.label}>{i.label}</span>
   <span className="rp-bar-track"><span className="rp-bar-fill" style={{width: `${i.value > 0 ? Math.max(1.5, i.value / max * 100) : 0}%`, ...(i.color ? {background: i.color} : {})}}/></span>
   <b className="rp-bar-value">{fmt(i.value, spec.unit)}</b>
  </div>)}
 </div>;
}

function DonutChart({spec}: {spec: Of<'donut'>}) {
 const R = 70, C = 2 * Math.PI * R, total = spec.total || 1;
 const arcs = spec.items.reduce<{item: (typeof spec.items)[number]; start: number; len: number}[]>((list, item) => {
  const start = list.length ? list[list.length - 1].start + list[list.length - 1].len : 0; return [...list, {item, start, len: item.value / total * C}];
 }, []);
 return <div className="rp-donut-wrap" role="img" aria-label={describeChart(spec)}>
  <svg className="rp-donut" viewBox="0 0 200 200" aria-hidden="true" focusable="false">
   <circle cx="100" cy="100" r={R} fill="none" stroke="#EEF1F3" strokeWidth="34"/>
   <g transform="rotate(-90 100 100)">{arcs.map(a => <circle key={a.item.key} cx="100" cy="100" r={R} fill="none" stroke={a.item.color ?? '#197448'} strokeWidth="34" strokeDasharray={`${a.len} ${C - a.len}`} strokeDashoffset={-a.start}/>)}</g>
   <text x="100" y="101" textAnchor="middle" className="rp-donut-total">{spec.total}</text>
   <text x="100" y="121" textAnchor="middle" className="rp-donut-sub">{spec.centerLabel}</text>
  </svg>
  <ul className="rp-legend">{spec.items.map(i => <li key={i.key}><i style={{background: i.color ?? '#197448'}}/><span>{i.label}</span><b>{i.value}</b><em>{fmtNum(i.value / total * 100)}%</em></li>)}</ul>
 </div>;
}

/** A top value so the axis has four even steps: whole numbers for counts, a 1-2-2.5-5 step for averages. */
function axisTop(peak: number, unit: ChartUnit) {
 if (unit === 'pct') return 100;
 if (unit === 'count') return peak <= 4 ? 4 : Math.ceil(peak / 4) * 4;
 if (peak <= 0) return 4;
 const raw = peak / 4, mag = Math.pow(10, Math.floor(Math.log10(raw)));
 return 4 * ([1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw - 1e-9) ?? 10 * mag);
}
/** Width of an element, kept up to date as it resizes (the line chart is drawn at 1:1 so its text stays readable at any width). */
function useWidth(initial: number) {
 const ref = useRef<HTMLDivElement>(null), [width, setWidth] = useState(initial);
 useEffect(() => {
  const el = ref.current; if (!el || typeof ResizeObserver === 'undefined') return;
  const watch = new ResizeObserver(entries => {const w = Math.round(entries[0]?.contentRect.width ?? 0); if (w > 0) setWidth(w);});
  watch.observe(el); return () => watch.disconnect();
 }, []);
 return [ref, width] as const;
}
function LineChart({spec}: {spec: Of<'line'>}) {
 const [box, boxWidth] = useWidth(720);
 const W = Math.max(300, Math.min(960, boxWidth)), H = W < 420 ? 240 : 280, L = 44, R = 14, T = 14, B = 44, n = spec.points.length;
 const peak = Math.max(0, ...spec.series.flatMap(s => s.values).filter((v): v is number => v !== null)), top = axisTop(peak, spec.unit);
 const x = (i: number) => n === 1 ? L + (W - L - R) / 2 : L + i * (W - L - R) / (n - 1), y = (v: number) => T + (1 - v / top) * (H - T - B);
 const spacing = n > 1 ? (W - L - R) / (n - 1) : W, step = Math.max(1, Math.ceil(58 / spacing)), dots = spacing >= 14;
 const segments = (values: (number | null)[]) => {const out: {i: number; v: number}[][] = []; let cur: {i: number; v: number}[] = []; values.forEach((v, i) => {if (v === null) {if (cur.length) out.push(cur); cur = [];} else cur.push({i, v});}); if (cur.length) out.push(cur); return out;};
 const path = (seg: {i: number; v: number}[]) => seg.map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ');
 return <div className="rp-line" role="img" aria-label={describeChart(spec)}>
  {spec.series.length > 1 && <ul className="rp-legend rp-legend-inline">{spec.series.map(s => <li key={s.id}><i style={{background: s.color}}/><span>{s.name}</span></li>)}</ul>}
  <div className="rp-line-box" ref={box}><svg className="rp-line-svg" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true" focusable="false">
   {[0, 1, 2, 3, 4].map(k => {const v = top * k / 4, yy = y(v); return <g key={k}><line x1={L} x2={W - R} y1={yy} y2={yy} className="rp-gridline"/><text x={L - 8} y={yy + 4} textAnchor="end" className="rp-tick">{fmt(v, spec.unit)}</text></g>;})}
   {spec.points.map((p, i) => i % step === 0 && <text key={p.key} x={x(i)} y={H - B + 20} textAnchor="middle" className="rp-tick">{p.label}</text>)}
   {spec.series.map((s, si) => <g key={s.id}>
    {si === 0 && segments(s.values).map((seg, k) => seg.length > 1 && <path key={k} d={`${path(seg)} L${x(seg[seg.length - 1].i).toFixed(1)} ${y(0)} L${x(seg[0].i).toFixed(1)} ${y(0)} Z`} fill={s.color} opacity=".12"/>)}
    {segments(s.values).map((seg, k) => <path key={k} d={path(seg)} fill="none" stroke={s.color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"/>)}
    {dots && s.values.map((v, i) => v !== null && <circle key={i} cx={x(i)} cy={y(v)} r="3.5" fill="#fff" stroke={s.color} strokeWidth="2"><title>{`${spec.points[i].title}: ${s.name} ${fmt(v, spec.unit)}`}</title></circle>)}
   </g>)}
  </svg></div>
 </div>;
}

function StackedChart({spec}: {spec: Of<'stacked'>}) {
 const max = Math.max(1, ...spec.rows.map(r => r.total));
 return <div className="rp-stack" role="img" aria-label={describeChart(spec)}>
  <ul className="rp-legend rp-legend-inline">{spec.series.map(s => <li key={s.key}><i style={{background: s.color}}/><span>{s.label}</span></li>)}</ul>
  <div className="rp-stack-rows">{spec.rows.map(r => <div className="rp-stack-row" key={r.key}>
   <span className="rp-bar-label" title={r.label}>{r.label}</span>
   <span className="rp-bar-track"><span className="rp-stack-bar" style={{width: `${r.total ? Math.max(2, r.total / max * 100) : 0}%`}}>{r.values.map((v, i) => v > 0 && <span key={spec.series[i].key} className="rp-seg" style={{flexGrow: v, background: spec.series[i].color, color: inkFor(spec.series[i].color)}} title={`${r.label} · ${spec.series[i].label}: ${v}`}>{v / r.total >= 0.14 && r.total / max >= 0.25 ? v : ''}</span>)}</span></span>
   <b className="rp-bar-value">{r.total}</b>
  </div>)}</div>
 </div>;
}

/** The values behind a chart as a plain table. */
export function ChartDataTable({spec}: {spec: ChartSpec}) {
 const t = chartTable(spec);
 return <div className="rp-scroll"><table className="rp-chart-table"><caption>{spec.title}</caption><thead><tr>{t.columns.map(c => <th key={c} scope="col">{c}</th>)}</tr></thead>
  <tbody>{t.rows.map((r, i) => <tr key={i}>{r.map((c, k) => k ? <td key={k}>{c}</td> : <th key={k} scope="row">{c}</th>)}</tr>)}</tbody></table></div>;
}

/** The chart of a report. With `asTable` the same values are shown as a table; in print the chart is always drawn (reports.css). */
export default function ReportChart({spec, asTable}: {spec: ChartSpec; asTable: boolean}) {
 const note = 'note' in spec ? spec.note : undefined;
 return <div className="rp-chart" data-kind={spec.kind}>
  <div className="rp-chart-view" hidden={asTable}>
   {spec.kind === 'bar' ? <BarChart spec={spec}/> : spec.kind === 'donut' ? <DonutChart spec={spec}/> : spec.kind === 'line' ? <LineChart spec={spec}/> : spec.kind === 'stacked' ? <StackedChart spec={spec}/> : <p className="rp-chart-empty">{spec.message}</p>}
  </div>
  {asTable && <div className="rp-chart-data"><ChartDataTable spec={spec}/></div>}
  {note && <p className="rp-chart-note">{note}</p>}
 </div>;
}
