import { Link } from 'react-router-dom';
import { BrandQR } from '../../components/BrandQR';
import { Icon } from '../../components/Icon';
import { Sticker } from '../../components/Sticker';
import { qrPayload } from '../../data/store';
import { shortDate } from '../../lib/format';
import { useCustomerCtx } from './CustomerLayout';

export function Rewards() {
  const { customer, activity, settings } = useCustomerCtx();
  const max = settings.stampsRequired;
  const have = Math.min(customer.stamps, max);
  const complete = have >= max;
  const pct = have / max;
  const R = 62;
  const C = 2 * Math.PI * R;
  const redeemed = activity.filter((a) => a.type === 'redeem');

  return (
    <div className="cx-page">
      <header className="cx-page-head rise">
        <p className="eyebrow">Rewards</p>
        <h1 className="display cx-page-title">{complete ? 'A free cup, on us' : 'Your next free cup'}</h1>
      </header>

      <div className="rewards-grid">
        {complete ? (
          <section className="reward-ticket rise rise-1" aria-label="Reward ready">
            <div className="reward-ticket-top">
              <div className="reward-ticket-sticker">
                <Sticker index={max - 1} filled isReward />
              </div>
              <div>
                <p className="eyebrow reward-eyebrow">Ready to redeem</p>
                <h2 className="display reward-name">{settings.rewardName}</h2>
                <p className="reward-note">Show this at the counter. Your barista will redeem it and start a fresh card.</p>
              </div>
            </div>
            <div className="reward-perf" aria-hidden="true" />
            <div className="reward-ticket-bottom">
              <BrandQR value={qrPayload(customer)} className="reward-qr" label="Reward QR code" />
              <div className="reward-code">
                <span className="eyebrow">Member code</span>
                <strong className="tabular">{customer.code}</strong>
                <Link to="/app/qr" className="btn btn-dark btn-sm">
                  <Icon name="qr" /> Full screen
                </Link>
              </div>
            </div>
          </section>
        ) : (
          <section className="card reward-progress rise rise-1" aria-label="Progress to free coffee">
            <div className="ring">
              <svg viewBox="0 0 160 160" aria-hidden="true">
                <defs>
                  <linearGradient id="ring-g" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0" stopColor="var(--rose-400)" />
                    <stop offset="1" stopColor="var(--rose-600)" />
                  </linearGradient>
                </defs>
                <circle cx="80" cy="80" r={R} className="ring-track" />
                <circle
                  cx="80"
                  cy="80"
                  r={R}
                  className="ring-fill"
                  stroke="url(#ring-g)"
                  strokeDasharray={C}
                  strokeDashoffset={C * (1 - pct)}
                />
              </svg>
              <div className="ring-center">
                <span className="display ring-num tabular">{max - have}</span>
                <span className="ring-label">{max - have === 1 ? 'cup to go' : 'cups to go'}</span>
              </div>
            </div>
            <div className="reward-progress-copy">
              <h2 className="card-title">{settings.rewardName}</h2>
              <p className="muted">
                You have {have} of {max} stickers. Keep collecting and your {max}th coffee is free.
              </p>
              <p className="reward-scan-tip">
                <Icon name="camera" /> Scan the QR code by the till after you pay.
              </p>
            </div>
          </section>
        )}

        <section className="stat-trio rise rise-2" aria-label="Your stats">
          <div className="stat">
            <span className="stat-icon">
              <Icon name="bean" />
            </span>
            <strong className="display tabular">{customer.totalStamps}</strong>
            <span>Stickers collected</span>
          </div>
          <div className="stat">
            <span className="stat-icon caramel">
              <Icon name="gift" />
            </span>
            <strong className="display tabular">{customer.rewardsRedeemed}</strong>
            <span>Free cups enjoyed</span>
          </div>
          <div className="stat">
            <span className="stat-icon dark">
              <Icon name="heart" />
            </span>
            <strong className="display stat-text">{customer.favourite ?? '—'}</strong>
            <span>Your usual</span>
          </div>
        </section>

        <section className="card card-pad rise rise-3" aria-labelledby="past">
          <div className="card-head">
            <h2 id="past" className="card-title">
              Rewards enjoyed
            </h2>
            <span className="chip chip-neutral tabular">{redeemed.length}</span>
          </div>
          {redeemed.length === 0 ? (
            <div className="empty">
              <Icon name="gift" />
              <p>Your first free coffee will show up here.</p>
            </div>
          ) : (
            <ul className="reward-history">
              {redeemed.map((r) => (
                <li key={r.id}>
                  <span className="reward-history-icon">
                    <Icon name="gift" />
                  </span>
                  <div>
                    <strong>{settings.rewardName}</strong>
                    <span>{shortDate(r.at)}</span>
                  </div>
                  <span className="chip chip-success">Redeemed</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
