import { Link } from 'react-router-dom';
import { CoffeeBreak } from '../components/CoffeeBreak';
import { Icon } from '../components/Icon';
import { Logo } from '../components/Logo';
import { Sticker } from '../components/Sticker';
import { getPendingCounterCode, useConfig } from '../data/store';

/** Customer-facing landing page: one action, open my card. Staff get a quiet link top right. */
export function Landing() {
  const n = useConfig()?.stampsRequired ?? 10;
  // Set when they scanned the counter QR before signing in on this phone.
  const collecting = !!getPendingCounterCode();
  return (
    <div className="landing-page">
      <main className="landing">
        <header className="landing-top">
          <Logo size="lg" />
          <Link to="/admin" className="btn btn-ghost btn-sm">
            <Icon name="shield" /> Staff
          </Link>
        </header>

        <section className="landing-hero">
          <div className="landing-copy rise">
            <h1 className="landing-title">
              Every cup <span className="landing-accent">blooms</span> into a free one.
            </h1>
            <p className="landing-lede">
              Collect a sticker with every coffee. Fill your card with {n}, and your next cup is on us. No paper, no app store, just your phone.
            </p>
            {collecting && (
              <p className="landing-pending" role="status">
                <Icon name="qr" /> Your sticker from the counter is waiting. Open your card to collect it.
              </p>
            )}
            <div className="landing-actions">
              <Link to={collecting ? '/app/join' : '/app'} className="btn btn-primary btn-lg btn-cta">
                {collecting ? 'Collect my sticker' : 'Open my card'}
                <span className="btn-orb">
                  <Icon name="arrowRight" />
                </span>
              </Link>
            </div>
            <div className="landing-stickers" aria-hidden="true">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="landing-sticker" style={{ animationDelay: `${300 + i * 90}ms` }}>
                  <Sticker index={i} filled isReward={i === 4} />
                </div>
              ))}
              <span className="landing-stickers-note">{n} stickers = 1 free coffee</span>
            </div>
          </div>
          <div className="landing-art rise rise-2">
            <div className="landing-art-disc" />
            <CoffeeBreak />
          </div>
        </section>
      </main>
    </div>
  );
}
