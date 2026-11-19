import { useState } from 'react';
import { Sheet, useToast } from '../../components/Feedback';
import { Icon } from '../../components/Icon';
import { Sticker } from '../../components/Sticker';
import { redeemMyReward, type ApiError } from '../../data/store';
import { useCustomerCtx } from './CustomerLayout';

/** "19 Nov 2026 at 14:05" */
function redeemedAt(iso: string) {
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })} at ${d.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}`;
}

const dayOf = (iso: string) => new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' });

/** The reward name on two balanced lines: "A free coffee" / "on us". */
function RewardTitle({ name }: { name: string }) {
  const m = name.match(/^(.*?)[,\s]+(on us[.!]?)$/i);
  return (
    <h2 className="display rt-title">
      {m ? (
        <>
          <span>{m[1]}</span>
          <span>{m[2]}</span>
        </>
      ) : (
        <span>{name}</span>
      )}
    </h2>
  );
}

/** How long the gold "Redeemed" ticket stays on screen after a free coffee. */
const SHOW_REDEEMED_MS = 24 * 3600_000;

export function Rewards() {
  const { customer, activity, settings } = useCustomerCtx();
  const max = settings.stampsRequired;
  const have = Math.min(customer.stamps, max);
  const complete = have >= max;
  const pct = have / max;
  const R = 62;
  const C = 2 * Math.PI * R;
  const redeemed = activity.filter((a) => a.type === 'redeem');
  const last = redeemed[0];
  const justRedeemed = !complete && last && Date.now() - new Date(last.at).getTime() < SHOW_REDEEMED_MS;
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const redeem = async () => {
    setBusy(true);
    try {
      await redeemMyReward();
      setConfirm(false);
    } catch (err) {
      toast((err as ApiError).message, 'info');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cx-page">
      <header className="cx-page-head rise">
        <p className="eyebrow">Rewards</p>
        <h1 className="display cx-page-title">{complete ? 'Your free coffee is ready' : 'Your next free coffee'}</h1>
      </header>

      <div className="rewards-grid">
        {complete ? (
          <section className="reward-ticket rise rise-1" aria-label="Reward ready">
            <div className="rt-head">
              <span className="rt-badge">
                <Icon name="sparkle" size={14} /> Ready to redeem
              </span>
              <div className="rt-sticker">
                <Sticker index={max - 1} filled isReward />
              </div>
            </div>
            <RewardTitle name={settings.rewardName} />
            <p className="rt-note">Show this screen at the counter, then tap the button below as your barista hands you your coffee.</p>
            <div className="reward-perf" aria-hidden="true" />
            <dl className="rt-details">
              <div>
                <dt>Name</dt>
                <dd>{customer.name}</dd>
              </div>
              <div>
                <dt>Member code</dt>
                <dd className="tabular">{customer.code}</dd>
              </div>
            </dl>
            <button className="rt-btn" onClick={() => setConfirm(true)}>
              <span className="rt-btn-icon">
                <Icon name="gift" />
              </span>
              <span className="rt-btn-text">
                <strong>Mark as redeemed</strong>
                <small>Tap at the counter</small>
              </span>
              <Icon name="chevronRight" className="rt-btn-chev" />
            </button>
          </section>
        ) : (
          <>
          {justRedeemed && (
            <section className="reward-ticket is-redeemed rise rise-1" aria-label="Free coffee redeemed">
              <div className="rt-head">
                <span className="rt-badge is-done">
                  <Icon name="check" size={14} /> Redeemed
                </span>
                <div className="rt-sticker">
                  <Sticker index={max - 1} filled isReward />
                  <span className="rt-sticker-check" aria-hidden="true">
                    <Icon name="check" />
                  </span>
                </div>
              </div>
              <RewardTitle name={last.drink ?? settings.rewardName} />
              <p className="rt-note">Enjoy! Your new card has already started.</p>
              <div className="reward-perf" aria-hidden="true" />
              <dl className="rt-details">
                <div>
                  <dt>Redeemed on</dt>
                  <dd className="tabular">{dayOf(last.at)}</dd>
                </div>
                <div>
                  <dt>Time</dt>
                  <dd className="tabular">{timeOf(last.at)}</dd>
                </div>
                <div className="rt-wide">
                  <dt>Member</dt>
                  <dd>{customer.name}</dd>
                </div>
              </dl>
            </section>
          )}
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
                You have {have} of {max} stickers. Fill your card and your next coffee is on us.
              </p>
              <p className="reward-scan-tip">
                <Icon name="camera" /> Scan the QR code by the till after you pay.
              </p>
            </div>
          </section>
          </>
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
                    <strong>{r.drink ?? settings.rewardName}</strong>
                    <span>{redeemedAt(r.at)}</span>
                  </div>
                  <span className="chip chip-success">Redeemed</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <Sheet open={confirm} onClose={() => !busy && setConfirm(false)} title="Redeem your free coffee?">
        <div className="pin-sheet">
          <p className="muted">
            Only tap this at the counter, when your barista is giving you your free coffee. Your card starts again at 0 stickers, and all your history stays.
          </p>
          <button className="btn btn-primary btn-block" disabled={busy} onClick={redeem}>
            <Icon name="gift" /> {busy ? 'Redeeming…' : 'Yes, redeemed'}
          </button>
          <button className="btn btn-ghost btn-block" disabled={busy} onClick={() => setConfirm(false)}>
            Not yet
          </button>
        </div>
      </Sheet>
    </div>
  );
}
