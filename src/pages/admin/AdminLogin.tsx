import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CoffeeBreak } from '../../components/CoffeeBreak';
import { Icon } from '../../components/Icon';
import { Logo } from '../../components/Logo';
import { adminSignIn, type ApiError } from '../../data/store';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'go', '0', 'del'];
const MIN = 4;
const MAX = 8;

export function AdminLogin() {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (pin.length < MIN || busy) return;
    setBusy(true);
    try {
      await adminSignIn(pin);
    } catch (err) {
      setError((err as ApiError).message);
      navigator.vibrate?.(120);
      window.setTimeout(() => {
        setPin('');
        setError(null);
      }, 1400);
    } finally {
      setBusy(false);
    }
  };

  const press = (k: string) => {
    if (error || busy) return;
    if (k === 'go') void submit();
    else if (k === 'del') setPin((p) => p.slice(0, -1));
    else if (pin.length < MAX) setPin((p) => p + k);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      if (e.key === 'Backspace') press('del');
      if (e.key === 'Enter') press('go');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="ad-login">
      <section className="ad-login-art">
        <Logo size="lg" />
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
          <p className="muted">The PIN is set by your manager in Settings.</p>
          <div className={`pin-dots ${error ? 'is-error' : ''}`} aria-live="polite" aria-label={`${pin.length} digits entered`}>
            {Array.from({ length: Math.max(MIN, pin.length) }, (_, i) => i).map((i) => (
              <span key={i} className={i < pin.length ? 'on' : ''} />
            ))}
          </div>
          <p className="field-error pin-error" role="alert">
            {error ?? (busy ? 'Checking…' : '\u00a0')}
          </p>
          <div className="pin-pad">
            {KEYS.map((k, i) =>
              k === 'go' ? (
                <button key={i} type="button" onClick={() => press(k)} className="is-go" disabled={pin.length < MIN || busy} aria-label="Sign in">
                  <Icon name="arrowRight" />
                </button>
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
