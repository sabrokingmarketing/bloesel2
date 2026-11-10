import { Link } from 'react-router-dom';
import { CoffeeBreak } from '../components/CoffeeBreak';
import { Icon } from '../components/Icon';
import { Logo } from '../components/Logo';
import { Sticker } from '../components/Sticker';

export function Landing() {
  return (
    <main className="landing">
      <div className="landing-glow" aria-hidden="true" />
      <header className="landing-top">
        <Logo />
        <Link to="/admin" className="btn btn-ghost btn-sm">
          <Icon name="shield" /> Staff
        </Link>
      </header>

      <section className="landing-hero">
        <div className="landing-copy rise">
          <span className="chip">
            <Icon name="sparkle" /> The Bloeisel loyalty card
          </span>
          <h1 className="display landing-title">
            Every cup <span className="display-italic">blooms</span> into a free one.
          </h1>
          <p className="landing-lede">
            Collect a sticker with every coffee. Fill your card with ten, and your next cup is on us. No paper, no app store, just your phone.
          </p>
          <div className="landing-actions">
            <Link to="/app" className="btn btn-primary btn-lg">
              Open my card <Icon name="arrowRight" />
            </Link>
            <Link to="/admin" className="btn btn-ghost btn-lg">
              Staff portal
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

      <section className="landing-portals">
        <Link to="/app" className="portal-card portal-customer rise rise-3">
          <span className="portal-icon">
            <Icon name="card" />
          </span>
          <span className="portal-text">
            <strong>I'm a customer</strong>
            <span>See your stickers, show your QR, claim your free coffee.</span>
          </span>
          <Icon name="chevronRight" className="portal-arrow" />
        </Link>
        <Link to="/admin" className="portal-card portal-staff rise rise-4">
          <span className="portal-icon">
            <Icon name="scan" />
          </span>
          <span className="portal-text">
            <strong>I'm on the team</strong>
            <span>Scan cards, add stickers, manage QR codes and members.</span>
          </span>
          <Icon name="chevronRight" className="portal-arrow" />
        </Link>
      </section>
    </main>
  );
}
