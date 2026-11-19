import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { CoffeeBreak } from '../../components/CoffeeBreak';
import { useToast } from '../../components/Feedback';
import { Icon } from '../../components/Icon';
import { Logo } from '../../components/Logo';
import { PinField, pinProblem } from '../../components/PinField';
import { ApiError, forgotPin, getPendingCounterCode, joinProgramme, refreshMe, signIn, useMe } from '../../data/store';

const validPhone = (p: string) => {
  const d = p.replace(/\D/g, '');
  return d.length >= 9 && d.length <= 15;
};

type Mode = 'join' | 'signin' | 'forgot';

export function Join() {
  const me = useMe();
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const [mode, setMode] = useState<Mode>(params.get('mode') === 'signin' ? 'signin' : 'join');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [pin, setPin] = useState('');
  const [consent, setConsent] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  // Already signed in on this phone (the session cookie is invisible to scripts, so ask).
  useEffect(() => {
    void refreshMe();
  }, []);

  const collecting = !!getPendingCounterCode();
  if (me.status === 'ready') return <Navigate to={collecting ? '/app/stamp' : '/app'} replace />;

  const go = (m: Mode) => {
    setMode(m);
    setErrors({});
    setSent(null);
  };

  const afterSignIn = (welcome: string) => {
    if (collecting) {
      // They scanned the counter QR first: collect that sticker now.
      navigate('/app/stamp');
    } else {
      toast(welcome, 'sparkle');
      navigate('/app');
    }
  };

  const submitJoin = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (name.trim().length < 2) errs.name = 'Tell us what to call you';
    if (!validPhone(phone)) errs.phone = 'Enter a valid mobile number';
    if (email && !/^\S+@\S+\.\S+$/.test(email)) errs.email = 'That email looks off';
    const pp = pinProblem(pin);
    if (pp) errs.pin = pp;
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setBusy(true);
    try {
      await joinProgramme({ name: name.trim(), phone: phone.trim(), pin, email: email.trim() || undefined, marketingOptIn: consent });
      afterSignIn('Your card is ready! Scan the QR by the till for your first sticker.');
    } catch (err) {
      const e = err as ApiError;
      if (e.code === 'phone_taken') {
        // They already have a card: take them to sign in with the number filled in.
        setPin('');
        go('signin');
        toast('That number already has a card. Sign in with your PIN.', 'info');
      } else toast(e.message, 'info');
    } finally {
      setBusy(false);
    }
  };

  const submitSignIn = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!validPhone(phone)) errs.phone = 'Enter your mobile number';
    if (!/^\d{4}$/.test(pin)) errs.pin = 'Your PIN is 4 digits';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const c = await signIn(phone.trim(), pin);
      afterSignIn(`Welcome back, ${c.name.split(' ')[0]}`);
    } catch (err) {
      setErrors({ pin: (err as ApiError).message });
    } finally {
      setBusy(false);
    }
  };

  const submitForgot = async (e: FormEvent) => {
    e.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email)) return setErrors({ email: 'Enter the email on your card' });
    setErrors({});
    setBusy(true);
    try {
      setSent((await forgotPin(email.trim())).message);
    } catch (err) {
      setErrors({ email: (err as ApiError).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="join">
      <section className="join-art">
        <div className="join-art-inner">
          <Logo size="lg" />
          <div className="join-lottie">
            <CoffeeBreak />
          </div>
          <div className="join-art-copy">
            <h2 className="display">
              Ten stickers. <span className="heading-accent">One free cup.</span>
            </h2>
            <p>Your Bloeisel card lives on your phone. Nothing to download, nothing to lose.</p>
          </div>
        </div>
      </section>

      <section className="join-form-wrap">
        <div className="join-mobile-brand">
          <Logo />
        </div>
        <div className="join-form-inner rise">
          {mode !== 'forgot' && (
            <div className="segmented join-tabs" role="group" aria-label="Choose">
              <button type="button" aria-pressed={mode === 'join'} onClick={() => go('join')}>
                New card
              </button>
              <button type="button" aria-pressed={mode === 'signin'} onClick={() => go('signin')}>
                I have a card
              </button>
            </div>
          )}

          {mode === 'join' && (
            <>
              <h1 className="display join-title">Start your card</h1>
              <p className="muted join-lede">
                {collecting
                  ? 'Create your card in ten seconds and today’s sticker goes straight onto it.'
                  : 'It takes ten seconds. Your first sticker is waiting at the counter.'}
              </p>
              <form className="join-form" onSubmit={submitJoin} noValidate>
                <div className="field">
                  <label htmlFor="j-name">Your name</label>
                  <input id="j-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Lerato Mokoena" autoComplete="name" aria-invalid={!!errors.name} />
                  {errors.name && <span className="field-error">{errors.name}</span>}
                </div>
                <div className="field">
                  <label htmlFor="j-phone">Mobile number</label>
                  <input id="j-phone" className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+27 82 123 4567" inputMode="tel" autoComplete="tel" aria-invalid={!!errors.phone} />
                  {errors.phone && <span className="field-error">{errors.phone}</span>}
                </div>
                <PinField id="j-pin" label="Choose a 4-digit PIN" value={pin} onChange={setPin} error={errors.pin} hint="You'll use it to sign in on another phone." isNew />
                <div className="field">
                  <label htmlFor="j-email">
                    Email <span className="faint">(optional, to reset your PIN)</span>
                  </label>
                  <input id="j-email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" inputMode="email" autoComplete="email" aria-invalid={!!errors.email} />
                  {errors.email && <span className="field-error">{errors.email}</span>}
                </div>
                <label className="check">
                  <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                  <span className="check-box">
                    <Icon name="check" />
                  </span>
                  <span>Send me the odd treat and new-menu news. No spam, promise.</span>
                </label>
                <button className="btn btn-primary btn-lg btn-block btn-cta" disabled={busy}>
                  {busy ? 'Creating your card…' : 'Create my card'}
                  <span className="btn-orb">
                    <Icon name="arrowRight" />
                  </span>
                </button>
              </form>
            </>
          )}

          {mode === 'signin' && (
            <>
              <h1 className="display join-title">Welcome back</h1>
              <p className="muted join-lede">Sign in with your mobile number and PIN. You'll stay signed in on this phone.</p>
              <form className="join-form" onSubmit={submitSignIn} noValidate>
                <div className="field">
                  <label htmlFor="s-phone">Mobile number</label>
                  <input id="s-phone" className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+27 82 123 4567" inputMode="tel" autoComplete="tel" aria-invalid={!!errors.phone} />
                  {errors.phone && <span className="field-error">{errors.phone}</span>}
                </div>
                <PinField id="s-pin" label="PIN" value={pin} onChange={setPin} error={errors.pin} />
                <button className="btn btn-primary btn-lg btn-block btn-cta" disabled={busy}>
                  {busy ? 'Signing in…' : 'Sign in'}
                  <span className="btn-orb">
                    <Icon name="arrowRight" />
                  </span>
                </button>
              </form>
              <button type="button" className="link join-forgot" onClick={() => go('forgot')}>
                Forgot your PIN?
              </button>
            </>
          )}

          {mode === 'forgot' && (
            <>
              <button type="button" className="link join-back" onClick={() => go('signin')}>
                <Icon name="arrowLeft" size={16} /> Back to sign in
              </button>
              <h1 className="display join-title">Reset your PIN</h1>
              {sent ? (
                <div className="join-sent" role="status">
                  <span className="group-icon">
                    <Icon name="mail" />
                  </span>
                  <p>{sent}</p>
                </div>
              ) : (
                <>
                  <p className="muted join-lede">Enter the email on your card and we'll send you a link to choose a new PIN.</p>
                  <form className="join-form" onSubmit={submitForgot} noValidate>
                    <div className="field">
                      <label htmlFor="f-email">Email</label>
                      <input id="f-email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" inputMode="email" autoComplete="email" aria-invalid={!!errors.email} />
                      {errors.email && <span className="field-error">{errors.email}</span>}
                    </div>
                    <button className="btn btn-primary btn-lg btn-block btn-cta" disabled={busy}>
                      {busy ? 'Sending…' : 'Send reset link'}
                      <span className="btn-orb">
                        <Icon name="mail" />
                      </span>
                    </button>
                  </form>
                </>
              )}
              <p className="field-hint move-note">
                <Icon name="shield" size={14} /> No email on your card? Ask your barista to send your card to this phone.
              </p>
            </>
          )}

          <p className="join-foot faint">
            Working at Bloeisel? <Link to="/admin" className="link">Staff portal</Link>
          </p>
        </div>
      </section>
    </div>
  );
}
