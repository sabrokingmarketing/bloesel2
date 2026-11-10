import type { CSSProperties } from 'react';
import { CupIcon, CUP_PATHS } from './CupIcon';
import { Icon } from './Icon';

/** Rhythm of sticker colourways across the card: never two alike side by side. */
const VARIANTS = ['rose', 'espresso', 'blush', 'rose', 'caramel', 'espresso', 'rose', 'blush', 'espresso'] as const;
type Variant = (typeof VARIANTS)[number] | 'reward';

const FILL: Record<Variant, { base: string; deep: string; icon: string }> = {
  rose: { base: '#ff70c8', deep: '#d42f8f', icon: '#fff6f3' },
  espresso: { base: '#56332a', deep: '#2e1a16', icon: '#ffc1e5' },
  blush: { base: '#ffd1ec', deep: '#ffb0de', icon: '#8c1f5e' },
  caramel: { base: '#f0c584', deep: '#d49a4c', icon: '#3e241e' },
  reward: { base: '#f4d08f', deep: '#c98c3d', icon: '#3e241e' },
};

/** Scalloped "blossom" die-cut: 14 soft bumps around the edge. */
function scallop(cx: number, cy: number, r: number, bumps = 14, depth = 2.6) {
  const pts: string[] = [];
  const steps = bumps * 8;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const rr = r - depth + depth * Math.cos(a * bumps);
    pts.push(`${(cx + rr * Math.cos(a)).toFixed(2)},${(cy + rr * Math.sin(a)).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
}
const OUTER = scallop(50, 50, 48);
const INNER = scallop(50, 50, 41.5, 14, 2.1);

/** Stable, slightly playful tilt per slot. */
export function tiltFor(i: number) {
  const t = [-8, 6, -3, 9, -6, 4, -10, 7, -4, 0, 5, -7];
  return t[i % t.length];
}

export function variantFor(i: number, isReward: boolean): Variant {
  return isReward ? 'reward' : VARIANTS[i % VARIANTS.length];
}

type Props = {
  index: number;
  filled: boolean;
  isReward?: boolean;
  isNew?: boolean;
  size?: number | string;
  label?: string;
};

export function Sticker({ index, filled, isReward = false, isNew = false, size = '100%', label }: Props) {
  const v = variantFor(index, isReward);
  const f = FILL[v];
  const gid = `stk-${index}-${v}`;
  const style = { '--tilt': `${tiltFor(index)}deg`, width: size } as CSSProperties;

  if (!filled) {
    return (
      <div className={`sticker-slot ${isReward ? 'is-reward' : ''}`} style={{ width: size }} aria-label={label}>
        <svg viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="45" className="slot-ring" />
          {!isReward && (
            <g transform="translate(26 24)" className="slot-cup">
              {CUP_PATHS.map((d, i) => (
                <path key={i} d={d} />
              ))}
            </g>
          )}
        </svg>
        {isReward && (
          <>
            <Icon name="gift" className="slot-gift" />
            <span className="slot-free">Free</span>
          </>
        )}
      </div>
    );
  }

  return (
    <div className={`sticker ${isNew ? 'is-new' : ''} ${isReward ? 'is-reward' : ''}`} style={style} aria-label={label}>
      <svg viewBox="0 0 100 100" className="sticker-art">
        <defs>
          <radialGradient id={`${gid}-g`} cx="35%" cy="28%" r="80%">
            <stop offset="0%" stopColor={f.base} />
            <stop offset="100%" stopColor={f.deep} />
          </radialGradient>
          <linearGradient id={`${gid}-sheen`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.55" />
            <stop offset="45%" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* White vinyl die-cut border */}
        <path d={OUTER} fill="#fffdfb" />
        <path d={INNER} fill={`url(#${gid}-g)`} />
        {/* Hand-printed ring */}
        <circle cx="50" cy="50" r="33" fill="none" stroke={f.icon} strokeOpacity="0.28" strokeWidth="0.9" strokeDasharray="1.6 2.4" />
        <g transform="translate(23 22) scale(1.12)" fill={f.icon}>
          {CUP_PATHS.map((d, i) => (
            <path key={i} d={d} />
          ))}
        </g>
        {isReward && (
          <g fill="#fff8ec">
            <path d="M75 20c.5 3.6 2 5.1 5.6 5.6-3.6.5-5.1 2-5.6 5.6-.5-3.6-2-5.1-5.6-5.6 3.6-.5 5.1-2 5.6-5.6z" />
            <path d="M24 70c.35 2.4 1.3 3.4 3.7 3.7-2.4.35-3.4 1.3-3.7 3.7-.35-2.4-1.3-3.4-3.7-3.7 2.4-.35 3.4-1.3 3.7-3.7z" />
          </g>
        )}
        {/* Gloss */}
        <path d={INNER} fill={`url(#${gid}-sheen)`} />
      </svg>
      {isNew && (
        <span className="sticker-burst" aria-hidden="true">
          {Array.from({ length: 10 }).map((_, i) => (
            <i key={i} style={{ '--a': `${i * 36}deg`, '--d': `${i % 2 ? 58 : 72}%` } as CSSProperties} />
          ))}
        </span>
      )}
    </div>
  );
}

/** Small inline cup sticker used in lists and toasts. */
export function MiniSticker({ index = 0, size = 36 }: { index?: number; size?: number }) {
  return (
    <span className="mini-sticker" style={{ width: size, height: size, transform: `rotate(${tiltFor(index)}deg)` }}>
      <Sticker index={index} filled size={size} />
    </span>
  );
}

export { CupIcon };
