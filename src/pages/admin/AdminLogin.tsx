import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CoffeeBreak } from '../../components/CoffeeBreak';
import { Icon } from '../../components/Icon';
import { Logo } from '../../components/Logo';
import { adminSignIn } from '../../data/store';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];

export function AdminLogin() {
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);

  useEffect(() => {
    if (pin.length < 4) return;
    if (!adminSignIn(pin)) {
      setError(true);
      navigator.vibrate?.(120);
      const t = window.setTimeout(() => {
        setPin('');
        setError(false);
      }, 650);
      return () => window.clearTimeout(t);
    }
  }, [pin]);

  const press = (k: string) => {
    if (error) return;
    if (k === 'del') setPin((p) => p.slice(0, -1));
    else if (k && pin.length < 4) setPin((p) => p + k);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      if (e.key === 'Backspace') press('del');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="ad-login">
      <section className="ad-login-art">
        <Logo tone="light" />
        <div className="ad-login-lottie">
          <CoffeeBreak />
        </div>
        <p className="display ad-login-quote">
          Pour with love. <span className="display-italic">Stamp with joy.</span>
        </p>
      </section>
      <section className="ad-login-panel">
        <div className="ad-login-inner rise">
          <div className="ad-login-mobile-logo">
            <Logo />
          </div>
          <span className="chip chip-dark">
            <Icon name="shield" /> Staff portal
          </span>
          <h1 className="display ad-login-title">Enter your team PIN</h1>
          <p className="muted">Demo PIN is 1234.</p>
          <div className={`pin-dots ${error ? 'is-error' : ''}`} aria-live="polite" aria-label={`${pin.length} of 4 digits entered`}>
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className={i < pin.length ? 'on' : ''} />
            ))}
          </div>
          <p className="field-error pin-error" role="alert">
            {error ? 'That PIN is not right. Try again.' : ' '}
          </p>
          <div className="pin-pad">
            {KEYS.map((k, i) =>
              k === '' ? (
                <span key={i} />
              ) : (
                <button key={i} type="button" onClick={() => press(k)} className={k === 'del' ? 'is-del' : ''} aria-label={k === 'del' ? 'Delete' : k}>
                  {k === 'del' ? <Icon name="arrowLeft" /> : k}
                </button>
              ),
            )}
          </div>
          <Link to="/" className="link ad-login-back">
            Back to Bloeisel
          </Link>
        </div>
      </section>
    </div>
  );
}
