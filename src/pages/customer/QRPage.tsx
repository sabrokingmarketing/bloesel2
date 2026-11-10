import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { BrandQR } from '../../components/BrandQR';
import { useToast } from '../../components/Feedback';
import { Icon } from '../../components/Icon';
import { Logo } from '../../components/Logo';
import { addStamp, qrPayload, redeemReward, useDB, useSessionCustomer } from '../../data/store';
import { firstName } from '../../lib/format';
import { StampCelebration, useStampWatcher } from './StampCelebration';

type WakeLockSentinelLike = { release: () => Promise<void> };

/** Keeps the screen awake while the QR is on show, so it never dims at the till. */
function useWakeLock() {
  useEffect(() => {
    let lock: WakeLockSentinelLike | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<WakeLockSentinelLike> } };
    const acquire = () => nav.wakeLock?.request('screen').then((l) => (lock = l)).catch(() => {});
    acquire();
    const onVis = () => document.visibilityState === 'visible' && acquire();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      lock?.release().catch(() => {});
    };
  }, []);
}

export function QRPage() {
  const db = useDB();
  const customer = useSessionCustomer();
  const navigate = useNavigate();
  const toast = useToast();
  const event = useStampWatcher(customer, db.settings);
  const [copied, setCopied] = useState(false);
  useWakeLock();

  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    const prev = meta?.getAttribute('content');
    meta?.setAttribute('content', '#d9617f');
    return () => {
      if (prev) meta?.setAttribute('content', prev);
    };
  }, []);

  if (!customer) return <Navigate to="/app/join" replace />;

  const max = db.settings.stampsRequired;
  const complete = customer.stamps >= max;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(customer.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      toast('Could not copy, read the code out instead', 'info');
    }
  };

  const simulate = () => {
    if (complete) redeemReward(customer.id);
    else addStamp(customer.id, customer.favourite ?? 'Cappuccino');
  };

  return (
    <div className="qr-page">
      <div className="qr-bg" aria-hidden="true">
        <span className="qr-blob b1" />
        <span className="qr-blob b2" />
        <span className="qr-blob b3" />
        {Array.from({ length: 9 }).map((_, i) => (
          <i key={i} className="qr-float" style={{ left: `${8 + i * 10.5}%`, animationDelay: `${i * 1.3}s`, animationDuration: `${11 + (i % 4) * 2.5}s` }} />
        ))}
      </div>

      <header className="qr-top">
        <button className="qr-close" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/app'))} aria-label="Close">
          <Icon name="close" />
        </button>
        <Logo tone="light" size="sm" />
        <span className="qr-close-spacer" />
      </header>

      <main className="qr-main">
        <div className="qr-intro rise">
          <h1 className="display qr-title">{complete ? 'Your free cup awaits' : 'Scan to collect'}</h1>
          <p className="qr-sub">
            {complete ? 'Show this to your barista to claim your reward.' : `Hold your phone up to the barista, ${firstName(customer.name)}.`}
          </p>
        </div>

        <div className={`qr-ticket rise rise-1 ${complete ? 'is-reward' : ''}`}>
          <div className="qr-pulse" aria-hidden="true">
            <span />
            <span />
          </div>
          <div className="qr-code-frame">
            <BrandQR value={qrPayload(customer)} className="qr-code" label={`Member QR code for ${customer.name}`} />
            <span className="qr-corner tl" />
            <span className="qr-corner tr" />
            <span className="qr-corner bl" />
            <span className="qr-corner br" />
          </div>

          <div className="qr-who">
            <span className="qr-name">{customer.name}</span>
            <button className="qr-code-text" onClick={copy} aria-label={`Member code ${customer.code}, tap to copy`}>
              <span className="tabular">{customer.code}</span>
              <Icon name={copied ? 'check' : 'copy'} />
            </button>
          </div>

          <div className="qr-perf" aria-hidden="true" />

          <div className="qr-progress" aria-label={`${customer.stamps} of ${max} stickers`}>
            <div className="qr-dots">
              {Array.from({ length: max }).map((_, i) => (
                <span key={i} className={`qr-dot ${i < customer.stamps ? 'on' : ''} ${i === max - 1 ? 'gift' : ''}`}>
                  {i === max - 1 && <Icon name="gift" />}
                </span>
              ))}
            </div>
            <span className="qr-progress-text">
              {complete ? (
                <strong>Reward ready</strong>
              ) : (
                <>
                  <strong className="tabular">{customer.stamps}</strong> of {max} · {max - customer.stamps} to go
                </>
              )}
            </span>
          </div>
        </div>

        <p className="qr-tip rise rise-2">
          <Icon name="sun" /> Turn up your brightness for a faster scan
        </p>

        <div className="qr-actions rise rise-3">
          <Link to="/app" className="btn btn-white btn-block">
            <Icon name="card" /> Back to my card
          </Link>
          <button className="qr-demo" onClick={simulate}>
            Demo: simulate the barista {complete ? 'redeeming' : 'scanning'}
          </button>
        </div>
      </main>

      <StampCelebration event={event} customer={customer} settings={db.settings} />
    </div>
  );
}
