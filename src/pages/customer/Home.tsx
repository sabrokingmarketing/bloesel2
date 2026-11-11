import { Link } from 'react-router-dom';
import { CoffeeBreak } from '../../components/CoffeeBreak';
import { Icon } from '../../components/Icon';
import { LoyaltyCard } from '../../components/LoyaltyCard';
import { MiniSticker } from '../../components/Sticker';
import { firstName, timeAgo } from '../../lib/format';
import { useCustomerCtx } from './CustomerLayout';

const today = () => new Date().toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long' });

export function Home() {
  const { customer, activity, settings, newIndex } = useCustomerCtx();
  const max = settings.stampsRequired;
  const complete = customer.stamps >= max;
  const recent = activity.filter((a) => a.type !== 'join').slice(0, 3);

  return (
    <div className="home">
      <header className="home-head rise">
        <div>
          <p className="home-date">{today()}</p>
          <h1 className="home-title">Hi, {firstName(customer.name)}</h1>
        </div>
        <div className="home-art" aria-hidden="true">
          <CoffeeBreak />
        </div>
      </header>

      <section className="rise rise-1" aria-label="My loyalty card">
        <LoyaltyCard customer={customer} settings={settings} newIndex={newIndex} />
      </section>

      <section className="rise rise-2" aria-label={complete ? 'Your reward' : 'Collect a sticker'}>
        {complete ? (
          <Link to="/app/rewards" className="group group-link">
            <span className="group-icon is-gold">
              <Icon name="gift" />
            </span>
            <span className="group-text">
              <strong>Claim your free coffee</strong>
              <span>Show your reward QR to the barista.</span>
            </span>
            <Icon name="chevronRight" className="group-chev" />
          </Link>
        ) : (
          <div className="group scan-hint">
            <span className="group-icon scan-hint-icon">
              <Icon name="camera" />
            </span>
            <span className="group-text">
              <strong>Collect a sticker</strong>
              <span>After you pay, point your phone camera at the QR code by the till.</span>
            </span>
          </div>
        )}
      </section>

      <section className="rise rise-3" aria-labelledby="recent">
        <div className="list-head">
          <h2 id="recent" className="list-title">
            Recent visits
          </h2>
          {recent.length > 0 && (
            <Link to="/app/history" className="link">
              See all
            </Link>
          )}
        </div>
        {recent.length === 0 ? (
          <div className="group group-empty">
            <Icon name="bean" />
            <span>Your first sticker is one coffee away.</span>
          </div>
        ) : (
          <ul className="group group-list">
            {recent.map((a, i) => (
              <li key={a.id}>
                <MiniSticker index={i * 3 + 1} size={34} />
                <span className="group-text">
                  <strong>{a.type === 'redeem' ? 'Free coffee' : a.type === 'adjust' ? 'Card adjusted' : a.drink ?? (a.note === 'Counter QR' ? 'Sticker' : 'Coffee')}</strong>
                  <span>{a.type === 'redeem' ? 'Reward redeemed' : a.type === 'adjust' ? a.note ?? 'By the team' : '+1 sticker'}</span>
                </span>
                <time className="group-meta">{timeAgo(a.at)}</time>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rise rise-4" aria-labelledby="how">
        <h2 id="how" className="list-title list-head">
          How it works
        </h2>
        <ol className="group group-list group-steps">
          <li>
            <span className="step-dot">1</span>
            <span className="group-text">
              <strong>Order any coffee</strong>
              <span>Every drink on the menu counts.</span>
            </span>
          </li>
          <li>
            <span className="step-dot">2</span>
            <span className="group-text">
              <strong>Scan the counter QR</strong>
              <span>A sticker lands on your card.</span>
            </span>
          </li>
          <li>
            <span className="step-dot">3</span>
            <span className="group-text">
              <strong>Enjoy cup {max} on us</strong>
              <span>Show your reward QR at the till.</span>
            </span>
          </li>
        </ol>
      </section>
    </div>
  );
}
