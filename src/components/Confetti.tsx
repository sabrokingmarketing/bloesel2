import { useMemo, type CSSProperties } from 'react';

const COLORS = ['#d9617f', '#f5c7d2', '#e8b974', '#2e1a16', '#ee9fb3', '#fffcfa'];

/** Petal confetti: blossom petals and beans falling from the top. */
export function Confetti({ count = 46, seed = 0 }: { count?: number; seed?: number }) {
  const pieces = useMemo(
    () =>
      Array.from({ length: count }).map((_, i) => {
        const r = (n: number) => {
          const x = Math.sin((i + 1) * 9301 + n * 49297 + seed * 233) * 10000;
          return x - Math.floor(x);
        };
        return {
          left: `${r(1) * 100}%`,
          delay: `${r(2) * 0.6}s`,
          dur: `${2.2 + r(3) * 1.8}s`,
          drift: `${(r(4) - 0.5) * 160}px`,
          spin: `${(r(5) - 0.5) * 900}deg`,
          color: COLORS[i % COLORS.length],
          shape: i % 3,
          size: `${8 + r(6) * 8}px`,
        };
      }),
    [count, seed],
  );
  return (
    <div className="confetti" aria-hidden="true">
      {pieces.map((p, i) => (
        <i
          key={i}
          className={`petal petal-${p.shape}`}
          style={
            {
              left: p.left,
              animationDelay: p.delay,
              animationDuration: p.dur,
              '--drift': p.drift,
              '--spin': p.spin,
              '--c': p.color,
              '--s': p.size,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
