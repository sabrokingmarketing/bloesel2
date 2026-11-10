/**
 * Bloeisel Koffie mark: a five-petal blossom ("bloeisel") cradling a coffee
 * bean. Placeholder for the official logo: swap this file for the real
 * artwork and every screen updates.
 */
export function BlossomMark({ size = 32, petal = 'var(--rose-500)', bean = 'var(--espresso-900)', crease = 'var(--caramel-400)', className }: {
  size?: number;
  petal?: string;
  bean?: string;
  crease?: string;
  className?: string;
}) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={className} aria-hidden="true">
      <g fill={petal}>
        {[0, 72, 144, 216, 288].map((r) => (
          <ellipse key={r} cx="32" cy="17" rx="8.5" ry="12.5" transform={`rotate(${r} 32 32)`} />
        ))}
      </g>
      <g transform="rotate(-25 32 32)">
        <ellipse cx="32" cy="32" rx="7.2" ry="9.6" fill={bean} />
        <path d="M29.3 25c3.4 3.6 3.4 10.4 0 14" stroke={crease} strokeWidth="1.8" fill="none" strokeLinecap="round" />
      </g>
    </svg>
  );
}

export function Logo({ tone = 'dark', size = 'md', stacked = false }: { tone?: 'dark' | 'light'; size?: 'sm' | 'md' | 'lg'; stacked?: boolean }) {
  const light = tone === 'light';
  const mark = { sm: 26, md: 34, lg: 52 }[size];
  return (
    <span className={`logo logo-${size} ${stacked ? 'logo-stacked' : ''} ${light ? 'logo-light' : ''}`}>
      <BlossomMark
        size={mark}
        petal={light ? '#fff' : 'var(--rose-500)'}
        bean={light ? 'var(--rose-700)' : 'var(--espresso-900)'}
        crease={light ? 'var(--blush-200)' : 'var(--caramel-400)'}
      />
      <span className="logo-words">
        <span className="logo-name">Bloeisel</span>
        <span className="logo-sub">Koffie</span>
      </span>
    </span>
  );
}
