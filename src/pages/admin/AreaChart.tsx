import { useId, useMemo, useRef, useState } from 'react';
import type { Point } from '../../lib/analytics';

/**
 * Smooth area chart in the reference style: soft rose gradient, dashed grid,
 * a peak marker with a value pill, and a hover cursor that follows the data.
 */
export function AreaChart({ data, height = 260, unit = 'stickers' }: { data: Point[]; height?: number; unit?: string }) {
  const id = useId().replace(/:/g, '');
  const wrap = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const W = 720;
  const H = height;
  const pad = { l: 36, r: 16, t: 34, b: 30 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;

  const { max, ticks, pts, line, area, peak } = useMemo(() => {
    const raw = Math.max(4, ...data.map((d) => d.value));
    const step = Math.ceil(raw / 4 / 5) * 5 || 1;
    const max = step * 4;
    const ticks = [0, 1, 2, 3, 4].map((i) => i * step);
    const n = data.length;
    const pts = data.map((d, i) => ({
      x: pad.l + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW),
      y: pad.t + innerH - (d.value / max) * innerH,
    }));
    // Monotone cubic interpolation: smooth, never overshoots below zero.
    const dx = pts.map((p, i) => (i < n - 1 ? pts[i + 1].x - p.x : 0));
    const dy = pts.map((p, i) => (i < n - 1 ? pts[i + 1].y - p.y : 0));
    const m = dx.map((x, i) => (x ? dy[i] / x : 0));
    const t = pts.map((_, i) => {
      if (i === 0) return m[0];
      if (i === n - 1) return m[n - 2];
      if (m[i - 1] * m[i] <= 0) return 0;
      return (m[i - 1] + m[i]) / 2;
    });
    let line = `M${pts[0].x},${pts[0].y}`;
    for (let i = 0; i < n - 1; i++) {
      const h = dx[i] / 3;
      line += ` C${pts[i].x + h},${pts[i].y + t[i] * h} ${pts[i + 1].x - h},${pts[i + 1].y - t[i + 1] * h} ${pts[i + 1].x},${pts[i + 1].y}`;
    }
    const area = `${line} L${pts[n - 1].x},${pad.t + innerH} L${pts[0].x},${pad.t + innerH} Z`;
    let peak = 0;
    data.forEach((d, i) => d.value > data[peak].value && (peak = i));
    return { max, ticks, pts, line, area, peak };
  }, [data, innerH, innerW, pad.l, pad.t]);

  const labelEvery = Math.ceil(data.length / 7);
  const active = hover ?? peak;
  const ap = pts[active];

  const onMove = (e: React.PointerEvent) => {
    const r = wrap.current!.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    pts.forEach((p, i) => Math.abs(p.x - x) < Math.abs(pts[best].x - x) && (best = i));
    setHover(best);
  };

  return (
    <div className="area-chart" ref={wrap} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Chart of ${unit}, peak ${data[peak]?.value} at ${data[peak]?.full}`}>
        <defs>
          <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#d9617f" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#d9617f" stopOpacity="0" />
          </linearGradient>
          <filter id={`${id}-glow`} x="-10%" y="-30%" width="120%" height="160%">
            <feDropShadow dx="0" dy="6" stdDeviation="6" floodColor="#bf4867" floodOpacity="0.25" />
          </filter>
        </defs>
        {ticks.map((t) => {
          const y = pad.t + innerH - (t / max) * innerH;
          return (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y} y2={y} className="ac-grid" />
              <text x={pad.l - 10} y={y + 4} className="ac-y">
                {t}
              </text>
            </g>
          );
        })}
        <path d={area} fill={`url(#${id}-fill)`} />
        <path d={line} className="ac-line" filter={`url(#${id}-glow)`} vectorEffect="non-scaling-stroke" />
        {data.map((d, i) =>
          i % labelEvery === 0 || i === data.length - 1 ? (
            <text key={i} x={pts[i].x} y={H - 8} className="ac-x">
              {d.label}
            </text>
          ) : null,
        )}
        {ap && <line x1={ap.x} x2={ap.x} y1={ap.y} y2={pad.t + innerH} className="ac-cursor" />}
      </svg>
      {ap && (
        <>
          <span className="ac-dot" style={{ left: `${(ap.x / W) * 100}%`, top: `${(ap.y / H) * 100}%` }} />
          <span className="ac-pill" style={{ left: `${(ap.x / W) * 100}%`, top: `${(ap.y / H) * 100}%` }}>
            <strong>{data[active].value}</strong>
            {hover !== null && <span>{data[active].full}</span>}
          </span>
        </>
      )}
    </div>
  );
}
