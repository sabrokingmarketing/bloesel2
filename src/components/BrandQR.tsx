import { useMemo } from 'react';
import { qrMatrix } from '../lib/qr';

/**
 * A branded QR code: round "bean" modules, soft finder eyes and the blossom
 * mark in the centre. Uses error-correction level H so the centre mark never
 * hurts scanning.
 */
export function BrandQR({
  value,
  fg = 'var(--espresso-900)',
  eye = 'var(--rose-500)',
  bg = '#fff',
  className,
  label,
}: {
  value: string;
  fg?: string;
  eye?: string;
  bg?: string;
  className?: string;
  label?: string;
}) {
  const { size, dots } = useMemo(() => {
    const m = qrMatrix(value);
    const inFinder = (x: number, y: number) => (x < 7 && y < 7) || (x >= m.size - 7 && y < 7) || (x < 7 && y >= m.size - 7);
    const c = m.size / 2;
    const hole = m.size * 0.13;
    const dots: Array<[number, number]> = [];
    for (let y = 0; y < m.size; y++)
      for (let x = 0; x < m.size; x++) {
        if (!m.get(x, y) || inFinder(x, y)) continue;
        if (Math.abs(x + 0.5 - c) < hole && Math.abs(y + 0.5 - c) < hole) continue;
        dots.push([x, y]);
      }
    return { size: m.size, dots };
  }, [value]);

  const q = 2; // quiet zone in modules
  const vb = size + q * 2;
  const c = vb / 2;
  const r = size * 0.13 * 0.95;
  const finders: Array<[number, number]> = [
    [0, 0],
    [size - 7, 0],
    [0, size - 7],
  ];

  return (
    <svg viewBox={`0 0 ${vb} ${vb}`} className={className} role="img" aria-label={label ?? 'QR code'} shapeRendering="geometricPrecision">
      <rect width={vb} height={vb} fill={bg} rx={2} />
      <g fill={fg}>
        {dots.map(([x, y]) => (
          <circle key={`${x}-${y}`} cx={x + q + 0.5} cy={y + q + 0.5} r={0.43} />
        ))}
      </g>
      {finders.map(([fx, fy]) => (
        <g key={`${fx}-${fy}`} transform={`translate(${fx + q} ${fy + q})`}>
          <rect width="7" height="7" rx="2.2" fill={eye} />
          <rect x="1" y="1" width="5" height="5" rx="1.5" fill={bg} />
          <rect x="2" y="2" width="3" height="3" rx="0.9" fill={fg} />
        </g>
      ))}
      <circle cx={c} cy={c} r={r * 1.18} fill={bg} />
      <g fill={eye}>
        {[0, 72, 144, 216, 288].map((a) => (
          <ellipse key={a} cx={c} cy={c - r * 0.48} rx={r * 0.34} ry={r * 0.5} transform={`rotate(${a} ${c} ${c})`} />
        ))}
      </g>
      <ellipse cx={c} cy={c} rx={r * 0.26} ry={r * 0.34} fill={fg} transform={`rotate(-25 ${c} ${c})`} />
    </svg>
  );
}
