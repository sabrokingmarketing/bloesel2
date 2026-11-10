import { Link } from 'react-router-dom';
import { CoffeeBreak } from '../components/CoffeeBreak';
import { Icon } from '../components/Icon';
import { Logo } from '../components/Logo';
import { Sticker } from '../components/Sticker';

/** Customer-facing landing page: one action, open my card. Staff get a quiet link top right. */
export function Landing() {
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
              Collect a sticker with every coffee. Fill your card with ten, and your next cup is on us. No paper, no app store, just your phone.
            </p>
            <div className="landing-actions">
              <Link to="/app" className="btn btn-primary btn-lg btn-cta">
                Open my card
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
              <span className="landing-stickers-note">10 stickers = 1 free coffee</span>
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
