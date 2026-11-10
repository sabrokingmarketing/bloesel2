import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Confetti } from '../../components/Confetti';
import { Icon } from '../../components/Icon';
import { Sticker } from '../../components/Sticker';
import type { Customer, Settings } from '../../data/types';

export type StampEvent = { kind: 'stamp'; index: number; complete: boolean; key: number } | { kind: 'redeem'; key: number };

/**
 * Watches the signed-in customer's card. When a barista adds a sticker or
 * redeems a reward (from any device, synced through the store), it emits a
 * short-lived event the UI celebrates.
 */
export function useStampWatcher(customer: Customer | undefined, settings: Settings) {
  const prev = useRef<{ id: string; stamps: number; redeemed: number } | null>(null);
  const [event, setEvent] = useState<StampEvent | null>(null);

  useEffect(() => {
    if (!customer) return;
    const p = prev.current;
    prev.current = { id: customer.id, stamps: customer.stamps, redeemed: customer.rewardsRedeemed };
    if (!p || p.id !== customer.id) return;
    if (customer.stamps > p.stamps) {
      setEvent({ kind: 'stamp', index: customer.stamps - 1, complete: customer.stamps >= settings.stampsRequired, key: Date.now() });
      navigator.vibrate?.([18, 40, 28]);
    } else if (customer.rewardsRedeemed > p.redeemed) {
      setEvent({ kind: 'redeem', key: Date.now() });
      navigator.vibrate?.([30, 50, 30, 50, 60]);
    }
  }, [customer, settings.stampsRequired]);

  useEffect(() => {
    if (!event) return;
    const t = window.setTimeout(() => setEvent(null), event.kind === 'stamp' && !event.complete ? 4200 : 6500);
    return () => window.clearTimeout(t);
  }, [event]);

  return event;
}

export function StampCelebration({ event, customer, settings }: { event: StampEvent | null; customer: Customer; settings: Settings }) {
  const [dismissed, setDismissed] = useState<number | null>(null);
  if (!event || dismissed === event.key) return null;
  const close = () => setDismissed(event.key);
  const max = settings.stampsRequired;

  if (event.kind === 'redeem') {
    return (
      <div className="celebrate" role="alertdialog" aria-label="Reward redeemed" onClick={close}>
        <Confetti seed={event.key} />
        <div className="celebrate-card is-reward" onClick={(e) => e.stopPropagation()}>
          <div className="celebrate-sticker">
            <Sticker index={max - 1} filled isReward isNew />
          </div>
          <p className="eyebrow">Reward redeemed</p>
          <h2 className="display celebrate-title">Enjoy, it's on us.</h2>
          <p className="muted">Your card is fresh again. Sticker one starts with your next cup.</p>
          <button className="btn btn-dark btn-block" onClick={close}>
            Dankie!
          </button>
        </div>
      </div>
    );
  }

  const left = max - (event.index + 1);
  return (
    <div className="celebrate" role="alertdialog" aria-label="Sticker added" onClick={close}>
      {event.complete && <Confetti seed={event.key} />}
      <div className={`celebrate-card ${event.complete ? 'is-reward' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="celebrate-rings" aria-hidden="true">
          <span />
          <span />
        </div>
        <div className="celebrate-sticker">
          <Sticker index={event.index} filled isReward={event.complete} isNew />
        </div>
        <p className="eyebrow">
          Sticker {event.index + 1} of {max}
        </p>
        <h2 className="display celebrate-title">{event.complete ? 'Your free coffee is ready!' : 'Fresh sticker, just for you.'}</h2>
        <p className="muted">
          {event.complete
            ? `${settings.rewardName}. Show your QR at the counter to claim it.`
            : left === 1
              ? 'One more cup and the next one is free.'
              : `${left} more cups to your free coffee, ${customer.name.split(' ')[0]}.`}
        </p>
        {event.complete ? (
          <Link to="/app/rewards" className="btn btn-primary btn-block" onClick={close}>
            <Icon name="gift" /> See my reward
          </Link>
        ) : (
          <button className="btn btn-dark btn-block" onClick={close}>
            Lekker, thanks
          </button>
        )}
      </div>
    </div>
  );
}
