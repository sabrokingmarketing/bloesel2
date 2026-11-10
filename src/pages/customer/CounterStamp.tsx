import { useEffect, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Confetti } from '../../components/Confetti';
import { Icon } from '../../components/Icon';
import { Logo } from '../../components/Logo';
import { Sticker } from '../../components/Sticker';
import { counterStamp, getPendingCounterCode, setPendingCounterCode, useMe, useMeSync, type ApiError } from '../../data/store';
import type { Customer } from '../../data/types';

type Result =
  | { kind: 'working' }
  | { kind: 'done'; customer: Customer; completed: boolean }
  | { kind: 'error'; code: string; message: string };

/** Takes the code from #c=… (then clears it from the address bar), or the one saved before sign-up. */
function readScannedCode() {
  const fromHash = new URLSearchParams(window.location.hash.slice(1)).get('c');
  if (fromHash) {
    setPendingCounterCode(fromHash);
    window.history.replaceState(null, '', '/app/stamp');
  }
  return fromHash ?? getPendingCounterCode();
}

/**
 * Opened by the printed counter QR (/app/stamp#c=CODE). Adds one sticker to
 * this phone's card. First-timers are sent to sign up, then brought back here.
 */
export function CounterStamp() {
  const me = useMe();
  useMeSync(60_000);
  const [result, setResult] = useState<Result>({ kind: 'working' });
  // Each scan gets its own attempt id, so a second scan while this page is open runs again.
  const [scan, setScan] = useState(() => ({ id: 0, code: readScannedCode() }));
  const handled = useRef(-1);
  const code = scan.code;

  // Opening the counter link again while this page is open only changes the #fragment: no reload.
  useEffect(() => {
    const onHash = () => {
      const next = readScannedCode();
      if (next) {
        setResult({ kind: 'working' });
        setScan((s) => ({ id: s.id + 1, code: next }));
      }
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    if (me.status !== 'ready' || !code || handled.current === scan.id) return;
    handled.current = scan.id;
    counterStamp(code, crypto.randomUUID())
      .then((res) => {
        setResult({ kind: 'done', customer: res.customer, completed: res.completed });
        navigator.vibrate?.([18, 40, 28]);
      })
      .catch((err: ApiError) => setResult({ kind: 'error', code: err.code, message: err.message }))
      .finally(() => setPendingCounterCode(null));
  }, [me.status, code, scan.id]);

  if (!code) return <Navigate to="/app" replace />;
  // No card yet: sign up first; Join brings them back here with the code still pending.
  if (me.status === 'none') return <Navigate to="/app/join?then=stamp" replace />;

  const max = me.data?.settings.stampsRequired ?? 10;

  return (
    <main className="counter">
      {result.kind === 'done' && result.completed && <Confetti />}
      <Logo size="lg" />

      {result.kind === 'working' && (
        <div className="card card-pad counter-card rise">
          <span className="claim-icon">
            <Icon name="qr" />
          </span>
          <h1 className="display">Adding your sticker…</h1>
        </div>
      )}

      {result.kind === 'done' && (
        <div className="card card-pad counter-card rise">
          <div className="counter-sticker">
            <Sticker index={Math.min(result.customer.stamps, max) - 1} filled isReward={result.completed} isNew />
          </div>
          <p className="eyebrow">
            Sticker {Math.min(result.customer.stamps, max)} of {max}
          </p>
          <h1 className="display">{result.completed ? 'Your free coffee is ready!' : 'Sticker collected!'}</h1>
          <p className="muted">
            {result.completed
              ? 'Show your QR to the barista next time to claim it.'
              : `${max - result.customer.stamps} more ${max - result.customer.stamps === 1 ? 'cup' : 'cups'} to your free coffee.`}
          </p>
          <Link to="/app" className="btn btn-primary btn-lg btn-block btn-cta">
            See my card
            <span className="btn-orb">
              <Icon name="arrowRight" />
            </span>
          </Link>
        </div>
      )}

      {result.kind === 'error' && (
        <div className="card card-pad counter-card rise">
          <span className={`claim-icon ${result.code === 'too_soon' ? '' : 'is-error'}`}>
            <Icon name={result.code === 'too_soon' ? 'clock' : result.code === 'card_full' ? 'gift' : 'info'} />
          </span>
          <h1 className="display">
            {result.code === 'too_soon' ? 'Already Collected' : result.code === 'card_full' ? 'Your Card Is Full' : "That Didn't Work"}
          </h1>
          <p className="muted">{result.message}</p>
          <Link to={result.code === 'card_full' ? '/app/qr' : '/app'} className="btn btn-primary btn-lg btn-block btn-cta">
            {result.code === 'card_full' ? 'Show my QR' : 'See my card'}
            <span className="btn-orb">
              <Icon name={result.code === 'card_full' ? 'qr' : 'arrowRight'} />
            </span>
          </Link>
        </div>
      )}
    </main>
  );
}
