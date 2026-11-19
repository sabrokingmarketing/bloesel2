import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useToast } from '../../components/Feedback';
import { Icon } from '../../components/Icon';
import { Logo } from '../../components/Logo';
import { PinField, pinProblem } from '../../components/PinField';
import { resetPin, type ApiError } from '../../data/store';

/** Opened from the PIN reset email (/app/reset#TOKEN): choose a new PIN; this phone is signed in. */
export function ResetPin() {
  const navigate = useNavigate();
  const toast = useToast();
  // Read the single-use token once, then remove it from the address bar and history.
  const [token] = useState(() => {
    const t = window.location.hash.slice(1);
    window.history.replaceState(null, '', '/app/reset');
    return t;
  });
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [dead, setDead] = useState<string | null>(token ? null : 'This link is missing its code. Ask for a new one.');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const pp = pinProblem(pin);
    if (pp) return setErrors({ pin: pp });
    if (confirm !== pin) return setErrors({ confirm: "The two PINs don't match" });
    setErrors({});
    setBusy(true);
    try {
      const c = await resetPin(token, pin);
      toast(`PIN changed. Welcome back, ${c.name.split(' ')[0]}.`, 'check');
      navigate('/app', { replace: true });
    } catch (err) {
      const e = err as ApiError;
      if (e.code === 'link_expired') setDead(e.message);
      else setErrors({ pin: e.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="claim">
      <Logo size="lg" />
      <div className="card card-pad claim-card reset-card rise">
        {dead ? (
          <>
            <span className="claim-icon is-error">
              <Icon name="info" />
            </span>
            <h1 className="display">That Link Didn't Work</h1>
            <p className="muted">{dead}</p>
            <Link to="/app/join?mode=signin" className="btn btn-primary btn-block btn-cta">
              Back to sign in
              <span className="btn-orb">
                <Icon name="arrowRight" />
              </span>
            </Link>
          </>
        ) : (
          <>
            <span className="claim-icon">
              <Icon name="shield" />
            </span>
            <h1 className="display">Choose A New PIN</h1>
            <p className="muted">For your security, any other phones signed in to your card will be signed out.</p>
            <form className="join-form reset-form" onSubmit={submit} noValidate>
              <PinField id="r-pin" label="New 4-digit PIN" value={pin} onChange={setPin} error={errors.pin} isNew />
              <PinField id="r-confirm" label="Type it again" value={confirm} onChange={setConfirm} error={errors.confirm} isNew />
              <button className="btn btn-primary btn-lg btn-block btn-cta" disabled={busy}>
                {busy ? 'Saving…' : 'Save my new PIN'}
                <span className="btn-orb">
                  <Icon name="check" />
                </span>
              </button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
