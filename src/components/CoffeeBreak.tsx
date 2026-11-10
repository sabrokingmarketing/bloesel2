import { useEffect, useRef } from 'react';
import { COFFEE_BREAK_BRAND_MAP, recolorLottie } from '../lib/recolorLottie';

/**
 * The "Coffee Break" Lottie illustration, recoloured to the Bloeisel palette.
 * The player and the 300 KB animation load lazily so they never block first paint.
 */
let cached: Promise<[unknown, typeof import('lottie-web').default]> | null = null;
function loadAssets() {
  if (!cached) {
    cached = Promise.all([
      import('../assets/coffee-break.json').then((m) => recolorLottie(m.default, COFFEE_BREAK_BRAND_MAP)),
      import('lottie-web/build/player/lottie_light').then((m) => m.default),
    ]);
  }
  return cached;
}

export function CoffeeBreak({ className, loop = true }: { className?: string; loop?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let anim: { destroy: () => void } | undefined;
    let cancelled = false;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    loadAssets().then(([data, lottie]) => {
      if (cancelled || !ref.current) return;
      const a = lottie.loadAnimation({
        container: ref.current,
        renderer: 'svg',
        loop,
        autoplay: !reduce,
        animationData: data,
        rendererSettings: { preserveAspectRatio: 'xMidYMid meet', progressiveLoad: true },
      });
      if (reduce) a.goToAndStop(45, true);
      anim = a;
    });
    return () => {
      cancelled = true;
      anim?.destroy();
    };
  }, [loop]);

  return <div ref={ref} className={`coffee-break ${className ?? ''}`} role="img" aria-label="Friends sharing a coffee break with a donut" />;
}
