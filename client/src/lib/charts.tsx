import { useState, type ReactNode } from "react";

/**
 * Small SVG charts for the dashboards. One y-axis, thin marks, a legend for 2+ series, a hover tooltip,
 * and a "Show as table" switch so nothing depends on colour alone. Palette checked for colour-blind separation
 * in light and dark (see --c1..--c4 in styles.css). Series colours follow the series, never their rank.
 */
export const SERIES = ["var(--c1)", "var(--c2)", "var(--c3)", "var(--c4)"];
export type Series = { name: string; values: (number | null)[] };

function Legend({ series }: { series: Series[] }) {
  if (series.length < 2) return null;
  return <div className="ch-legend">{series.map((s, i) => <span key={s.name}><i style={{ background: SERIES[i % 4] }} />{s.name}</span>)}</div>;
}
function TableView({ labels, series, fmt }: { labels: string[]; series: Series[]; fmt: (n: number) => string }) {
  return <table className="t ch-table"><thead><tr><th></th>{series.map((s) => <th key={s.name}>{s.name}</th>)}</tr></thead>
    <tbody>{labels.map((l, i) => <tr key={l}><td>{l}</td>{series.map((s) => <td key={s.name}>{s.values[i] == null ? "Hidden (fewer than 5)" : fmt(s.values[i]!)}</td>)}</tr>)}</tbody></table>;
}

function Frame({ title, note, labels, series, fmt, children, tip }: { title: string; note?: ReactNode; labels: string[]; series: Series[]; fmt: (n: number) => string; children: ReactNode; tip: ReactNode }) {
  const [table, setTable] = useState(false);
  return (
    <figure className="ch">
      <figcaption><b>{title}</b><button type="button" className="ch-sw" onClick={() => setTable(!table)}>{table ? "Show chart" : "Show as table"}</button></figcaption>
      {table ? <TableView labels={labels} series={series} fmt={fmt} /> : <div className="ch-plot">{children}{tip}</div>}
      <Legend series={series} />
      {note && <p className="k" style={{ margin: "6px 0 0" }}>{note}</p>}
    </figure>
  );
}

const W = 520, H = 200, P = { l: 44, r: 8, t: 12, b: 24 };
function niceMax(v: number) { if (v <= 0) return 1; const e = 10 ** Math.floor(Math.log10(v)); const f = v / e; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * e; }
function Axis({ max, fmt, labels, every = 1 }: { max: number; fmt: (n: number) => string; labels: string[]; every?: number }) {
  const ticks = Number.isInteger(max / 2) || max < 1 || max >= 100 ? [0, max / 2, max] : [0, max];
  const gw = (W - P.l - P.r) / labels.length;
  return <g className="ch-axis">
    {ticks.map((t) => { const y = H - P.b - ((H - P.t - P.b) * t) / max; return <g key={t}><line x1={P.l} x2={W - P.r} y1={y} y2={y} /><text x={P.l - 6} y={y + 4} textAnchor="end">{fmt(t)}</text></g>; })}
    {labels.map((l, i) => i % every === 0 && <text key={l} x={P.l + i * gw + gw / 2} y={H - 6} textAnchor="middle">{l}</text>)}
  </g>;
}
function Tip({ at, label, rows }: { at: number | null; label: string; rows: [string, string, string][] }) {
  if (at == null) return null;
  return <div className="ch-tip" style={{ left: `${Math.min(80, Math.max(8, at * 100))}%` }}><b>{label}</b>{rows.map(([n, c, v]) => <div key={n}><i style={{ background: c }} />{n}<span>{v}</span></div>)}</div>;
}

/** Bars per label; several series are stacked when `stack`, otherwise grouped. */
export function BarChart({ title, labels, series, fmt = (n) => n.toLocaleString("en-IN"), stack = false, note }: { title: string; labels: string[]; series: Series[]; fmt?: (n: number) => string; stack?: boolean; note?: ReactNode }) {
  const [hi, setHi] = useState<number | null>(null);
  const tot = labels.map((_, i) => stack ? series.reduce((a, s) => a + (s.values[i] ?? 0), 0) : Math.max(0, ...series.map((s) => s.values[i] ?? 0)));
  const max = niceMax(Math.max(...tot, 0));
  const gw = (W - P.l - P.r) / labels.length, ih = H - P.t - P.b;
  const bw = stack ? Math.min(28, gw * 0.6) : Math.min(18, (gw * 0.7) / series.length);
  const y = (v: number) => (ih * v) / max;
  const every = Math.max(1, Math.ceil(labels.length / 12));
  return (
    <Frame title={title} note={note} labels={labels} series={series} fmt={fmt}
      tip={<Tip at={hi == null ? null : (P.l + hi * gw + gw / 2) / W} label={hi == null ? "" : labels[hi]} rows={hi == null ? [] : series.map((s, j) => [s.name, SERIES[j % 4], s.values[hi] == null ? "Fewer than 5" : fmt(s.values[hi]!)])} />}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} onMouseLeave={() => setHi(null)}>
        <Axis max={max} fmt={fmt} labels={labels} every={every} />
        {labels.map((l, i) => {
          const x0 = P.l + i * gw + (gw - (stack ? bw : bw * series.length)) / 2;
          let base = H - P.b;
          return <g key={l} opacity={hi == null || hi === i ? 1 : 0.45}>
            {series.map((s, j) => {
              const v = s.values[i] ?? 0, h = y(v);
              if (stack) { base -= h; return h > 0 ? <rect key={s.name} x={x0} y={base} width={bw} height={Math.max(0, h - (j < series.length - 1 ? 0 : 0))} fill={SERIES[j % 4]} stroke="var(--ch-surface)" strokeWidth={1} rx={j === series.length - 1 || series.slice(j + 1).every((t) => !(t.values[i] ?? 0)) ? 3 : 0} /> : null; }
              return h > 0 ? <rect key={s.name} x={x0 + j * bw} y={H - P.b - h} width={bw - 2} height={h} fill={SERIES[j % 4]} rx={3} /> : null;
            })}
            <rect x={P.l + i * gw} y={P.t} width={gw} height={ih} fill="transparent" onMouseEnter={() => setHi(i)} />
          </g>;
        })}
      </svg>
    </Frame>
  );
}

/** Lines over time with a crosshair. Null values break the line (hidden points). */
export function LineChart({ title, labels, series, fmt = (n) => n.toLocaleString("en-IN"), max: fixedMax, note }: { title: string; labels: string[]; series: Series[]; fmt?: (n: number) => string; max?: number; note?: ReactNode }) {
  const [hi, setHi] = useState<number | null>(null);
  const max = fixedMax ?? niceMax(Math.max(0, ...series.flatMap((s) => s.values.map((v) => v ?? 0))));
  const gw = (W - P.l - P.r) / labels.length, ih = H - P.t - P.b;
  const x = (i: number) => P.l + i * gw + gw / 2, y = (v: number) => H - P.b - (ih * v) / max;
  const every = labels.length > 12 ? Math.ceil(labels.length / 8) : 1;
  return (
    <Frame title={title} note={note} labels={labels} series={series} fmt={fmt}
      tip={<Tip at={hi == null ? null : x(hi) / W} label={hi == null ? "" : labels[hi]} rows={hi == null ? [] : series.map((s, j) => [s.name, SERIES[j % 4], s.values[hi] == null ? "Fewer than 5" : fmt(s.values[hi]!)])} />}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} onMouseLeave={() => setHi(null)}>
        <Axis max={max} fmt={fmt} labels={labels} every={every} />
        {hi != null && <line className="ch-cross" x1={x(hi)} x2={x(hi)} y1={P.t} y2={H - P.b} />}
        {series.map((s, j) => {
          const segs: string[] = []; let cur = "";
          s.values.forEach((v, i) => { if (v == null) { if (cur) segs.push(cur); cur = ""; } else cur += `${cur ? "L" : "M"}${x(i)},${y(v)}`; });
          if (cur) segs.push(cur);
          return <g key={s.name}>{segs.map((d, k) => <path key={k} d={d} fill="none" stroke={SERIES[j % 4]} strokeWidth={2} strokeLinejoin="round" />)}
            {s.values.map((v, i) => v != null && (hi === i || s.values.length <= 12) ? <circle key={i} cx={x(i)} cy={y(v)} r={hi === i ? 4.5 : 3} fill={SERIES[j % 4]} stroke="var(--ch-surface)" strokeWidth={2} /> : null)}</g>;
        })}
        {labels.map((l, i) => <rect key={l} x={P.l + i * gw} y={P.t} width={gw} height={ih} fill="transparent" onMouseEnter={() => setHi(i)} />)}
      </svg>
    </Frame>
  );
}

/** A single number with a short label. */
export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return <div className="card stat"><div className="k">{label}</div><div className="stat-v">{value}</div>{sub && <div className="k">{sub}</div>}</div>;
}

/** Horizontal bars for a ranked breakdown (departments, reasons). */
export function RankBars({ title, rows, fmt = (n) => n.toLocaleString("en-IN"), note }: { title: string; rows: { name: string; value: number }[]; fmt?: (n: number) => string; note?: ReactNode }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return <figure className="ch"><figcaption><b>{title}</b></figcaption>
    {rows.length ? <div className="rank">{rows.map((r) => <div key={r.name} className="rank-row" title={`${r.name}: ${fmt(r.value)}`}><span className="rank-n">{r.name}</span><span className="rank-bar"><i style={{ width: `${(r.value / max) * 100}%` }} /></span><span className="rank-v">{fmt(r.value)}</span></div>)}</div> : <p className="k">Nothing to show yet.</p>}
    {note && <p className="k" style={{ margin: "6px 0 0" }}>{note}</p>}</figure>;
}
