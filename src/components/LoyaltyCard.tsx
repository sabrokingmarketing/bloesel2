import type { Customer, Settings } from '../data/types';
import { shortDate } from '../lib/format';
import { Logo } from './Logo';
import { Sticker } from './Sticker';

type Props = {
  customer: Customer;
  settings: Settings;
  /** Index of a sticker that should play the "just stamped" animation. */
  newIndex?: number | null;
  compact?: boolean;
};

export function LoyaltyCard({ customer, settings, newIndex = null, compact = false }: Props) {
  const max = settings.stampsRequired;
  const have = Math.min(customer.stamps, max);
  const left = max - have;
  const complete = left === 0;

  return (
    <article className={`loyalty-card ${complete ? 'is-complete' : ''} ${compact ? 'is-compact' : ''}`} aria-label={`Loyalty card: ${have} of ${max} stickers`}>
      <header className="lc-head">
        <div className="lc-pattern" aria-hidden="true" />
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

      <div className="lc-perf" aria-hidden="true" />

      <footer className="lc-foot">
        <div className="lc-count">
          <span className="display lc-num tabular">
            <em>{have}</em> of {max}
          </span>
          <span className="lc-count-label">stickers collected</span>
        </div>
        <div className="lc-status">
          {complete ? (
            <span className="chip chip-caramel">Free coffee ready</span>
          ) : (
            <span className="lc-left">
              <strong>{left}</strong> more to a free cup
            </span>
          )}
          {!compact && <span className="lc-since">Since {shortDate(customer.joinedAt)}</span>}
        </div>
      </footer>
    </article>
  );
}
