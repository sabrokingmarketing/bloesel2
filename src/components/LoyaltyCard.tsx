import type { Customer, Settings } from '../data/types';
import { Logo } from './Logo';
import { Sticker } from './Sticker';

type Props = {
  customer: Customer;
  settings: Settings;
  /** Index of a sticker that should play the "just stamped" animation. */
  newIndex?: number | null;
  compact?: boolean;
};

/**
 * The loyalty card, styled like a wallet pass: brand header, sticker grid,
 * and a single progress line. Nothing decorative that doesn't carry meaning.
 */
export function LoyaltyCard({ customer, settings, newIndex = null, compact = false }: Props) {
  const max = settings.stampsRequired;
  const have = Math.min(customer.stamps, max);
  const left = max - have;
  const complete = left === 0;

  return (
    <article className={`loyalty-card ${complete ? 'is-complete' : ''} ${compact ? 'is-compact' : ''}`} aria-label={`Loyalty card: ${have} of ${max} stickers`}>
      <header className="lc-head">
        <Logo tone="light" size="sm" />
        <div className="lc-member">
          <span className="lc-member-label">Member</span>
          <span className="lc-member-name">{customer.name}</span>
        </div>
      </header>

      <div className="lc-body">
        <div className="lc-grid" style={{ gridTemplateColumns: `repeat(${Math.min(5, max)}, 1fr)` }}>
          {Array.from({ length: max }).map((_, i) => {
            const isReward = i === max - 1;
            const filled = i < have;
            return (
              <div className="lc-cell" key={i}>
                <Sticker
                  index={i}
                  filled={filled}
                  isReward={isReward}
                  isNew={newIndex === i}
                  label={filled ? `Sticker ${i + 1} collected` : isReward ? 'Free coffee slot' : `Sticker ${i + 1} empty`}
                />
              </div>
            );
          })}
        </div>
      </div>

      <footer className="lc-foot">
        <div className="lc-bar" role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={have} aria-label="Stickers collected">
          <span style={{ width: `${(have / max) * 100}%` }} />
        </div>
        <div className="lc-foot-row">
          <span className="lc-count tabular">
            <strong>{have}</strong> of {max} stickers
          </span>
          <span className={`lc-left ${complete ? 'is-ready' : ''}`}>{complete ? 'Free coffee ready' : `${left} to go`}</span>
        </div>
      </footer>
    </article>
  );
}
