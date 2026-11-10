import { Link } from 'react-router-dom';
import { CoffeeBreak } from '../../components/CoffeeBreak';
import { Icon } from '../../components/Icon';
import { LoyaltyCard } from '../../components/LoyaltyCard';
import { MiniSticker } from '../../components/Sticker';
import { firstName, greeting, timeAgo } from '../../lib/format';
import { useCustomerCtx } from './CustomerLayout';

export function Home() {
  const { customer, activity, settings, newIndex } = useCustomerCtx();
  const max = settings.stampsRequired;
  const complete = customer.stamps >= max;
  const recent = activity.filter((a) => a.type !== 'join').slice(0, 4);

  return (
    <div className="cx-home">
      <section className="cx-hero rise">
        <div className="cx-hero-copy">
          <p className="eyebrow cx-hero-eyebrow">{greeting()}</p>
          <h1 className="display cx-hero-title">
            {firstName(customer.name)}, time for a <span className="display-italic">koffie</span> break?
          </h1>
        </div>
        <div className="cx-hero-art">
          <CoffeeBreak />
        </div>
      </section>

      <div className="cx-home-grid">
        <section className="cx-card-wrap rise rise-1" aria-labelledby="my-card">
          <h2 id="my-card" className="sr-only">
            My loyalty card
          </h2>
          <LoyaltyCard customer={customer} settings={settings} newIndex={newIndex} />
          <Link to={complete ? '/app/rewards' : '/app/qr'} className={`btn btn-lg btn-block cx-card-cta ${complete ? 'btn-dark' : 'btn-primary'}`}>
            <Icon name={complete ? 'gift' : 'qr'} />
            {complete ? 'Claim my free coffee' : 'Show my QR to collect'}
          </Link>
        </section>

        <aside className="cx-side">
          <section className="card card-pad rise rise-2" aria-labelledby="how">
            <div className="card-head">
              <h2 id="how" className="card-title">
                How it works
              </h2>
            </div>
            <ol className="steps">
              <li>
                <span className="step-num">1</span>
                <div>
                  <strong>Order your coffee</strong>
                  <p>Any drink on the menu counts.</p>
                </div>
              </li>
              <li>
                <span className="step-num">2</span>
                <div>
                  <strong>Show your QR</strong>
                  <p>Your barista scans it at the till.</p>
                </div>
              </li>
              <li>
                <span className="step-num">3</span>
                <div>
                  <strong>Collect & bloom</strong>
                  <p>Sticker {max} is a free cup, on us.</p>
                </div>
              </li>
            </ol>
          </section>

          <section className="card card-pad rise rise-3" aria-labelledby="recent">
            <div className="card-head">
              <h2 id="recent" className="card-title">
                Recent visits
              </h2>
              <Link to="/app/history" className="link">
                See all
              </Link>
            </div>
            {recent.length === 0 ? (
              <div className="empty">
                <Icon name="bean" />
                <p>Your first sticker is one coffee away.</p>
              </div>
            ) : (
              <ul className="visit-list">
                {recent.map((a, i) => (
                  <li key={a.id}>
                    <MiniSticker index={i * 3 + 1} size={36} />
                    <div className="visit-text">
                      <strong>{a.type === 'redeem' ? 'Free coffee enjoyed' : a.type === 'adjust' ? 'Card adjusted' : a.drink ?? 'Coffee'}</strong>
                      <span>{a.type === 'redeem' ? 'Reward redeemed' : a.type === 'adjust' ? a.note ?? 'By the team' : '+1 sticker'}</span>
                    </div>
                    <time className="visit-time">{timeAgo(a.at)}</time>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
