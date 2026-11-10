import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useToast } from '../../components/Feedback';
import { Icon } from '../../components/Icon';
import { Logo } from '../../components/Logo';
import { claimCard, type ApiError } from '../../data/store';

/** Opens a one-time transfer link (/app/claim#token) and moves the card onto this phone. */
export function Claim() {
  const navigate = useNavigate();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = window.location.hash.slice(1);
    // Drop the token from the address bar and history straight away.
    window.history.replaceState(null, '', '/app/claim');
    if (!token) {
      setError('This link is missing its code. Ask for a new one.');
      return;
    }
    claimCard(token)
      .then((c) => {
        toast(`Welcome back, ${c.name.split(' ')[0]}. Your card is on this phone now.`, 'heart');
        navigate('/app', { replace: true });
      })
      .catch((err: ApiError) => setError(err.message));
  }, [navigate, toast]);

  return (
    <main className="claim">
      <Logo />
      {error ? (
        <div className="card card-pad claim-card rise">
          <span className="claim-icon is-error">
            <Icon name="info" />
          </span>
          <h1 className="display">That link didn't work</h1>
          <p className="muted">{error}</p>
          <p className="muted">Links work once and expire after 15 minutes. Your barista can make a new one at the counter.</p>
          <Link to="/app/join" className="btn btn-primary btn-block btn-cta">
            Back to Bloeisel
            <span className="btn-orb">
              <Icon name="arrowRight" />
            </span>
          </Link>
        </div>
      ) : (
        <div className="card card-pad claim-card rise">
          <span className="claim-icon">
            <Icon name="card" />
          </span>
          <h1 className="display">Moving your card…</h1>
          <p className="muted">Bringing your stickers over to this phone.</p>
        </div>
      )}
    </main>
  );
}
