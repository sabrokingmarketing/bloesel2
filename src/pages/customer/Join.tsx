import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { CoffeeBreak } from '../../components/CoffeeBreak';
import { useToast } from '../../components/Feedback';
import { Icon } from '../../components/Icon';
import { Logo } from '../../components/Logo';
import { ApiError, getPendingCounterCode, joinProgramme, useMe } from '../../data/store';

const validPhone = (p: string) => {
  const d = p.replace(/\D/g, '');
  return d.length >= 9 && d.length <= 15;
};

export function Join() {
  const me = useMe();
  const navigate = useNavigate();
  const toast = useToast();
  const [mode, setMode] = useState<'join' | 'find'>('join');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const collecting = !!getPendingCounterCode();
  if (me.status === 'ready') return <Navigate to={collecting ? '/app/stamp' : '/app'} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (name.trim().length < 2) errs.name = 'Tell us what to call you';
    if (!validPhone(phone)) errs.phone = 'Enter a valid mobile number';
    if (email && !/^\S+@\S+\.\S+$/.test(email)) errs.email = 'That email looks off';
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setBusy(true);
    try {
      await joinProgramme({ name: name.trim(), phone: phone.trim(), email: email.trim() || undefined, marketingOptIn: consent });
      if (collecting) {
        // They scanned the counter QR before having a card: collect that sticker now.
        navigate('/app/stamp');
      } else {
        toast('Your card is ready! Scan the QR by the till for your first sticker.', 'sparkle');
        navigate('/app');
      }
    } catch (err) {
      const e = err as ApiError;
      if (e.code === 'phone_taken') setErrors({ phone: e.message });
      else toast(e.message, 'info');
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
          <div className="segmented join-tabs" role="group" aria-label="Choose">
            <button type="button" aria-pressed={mode === 'join'} onClick={() => setMode('join')}>
              New card
            </button>
            <button type="button" aria-pressed={mode === 'find'} onClick={() => setMode('find')}>
              I have a card
            </button>
          </div>

          {mode === 'join' ? (
            <>
              <h1 className="display join-title">Start your card</h1>
              <p className="muted join-lede">
                {collecting
                  ? 'Create your card in ten seconds and today’s sticker goes straight onto it.'
                  : 'It takes ten seconds. Your first sticker is waiting at the counter.'}
              </p>

              <form className="join-form" onSubmit={submit} noValidate>
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
                <div className="field">
                  <label htmlFor="j-email">
                    Email <span className="faint">(optional)</span>
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
          ) : (
            <>
              <h1 className="display join-title">Bring your card over</h1>
              <p className="muted join-lede">Your card lives on the phone you signed up with. Here is how to move it to this one.</p>
              <ol className="move-steps">
                <li>
                  <span className="step-dot">1</span>
                  <div>
                    <strong>Still have your old phone?</strong>
                    <p>
                      Open your card there, go to <b>Profile</b> and tap <b>Move to a new phone</b>. Scan the code it shows with this phone.
                    </p>
                  </div>
                </li>
                <li>
                  <span className="step-dot">2</span>
                  <div>
                    <strong>Lost it or changed numbers?</strong>
                    <p>Ask your barista at the counter. They can send your card to this phone in seconds, stickers and all.</p>
                  </div>
                </li>
              </ol>
              <p className="field-hint move-note">
                <Icon name="shield" size={14} /> This keeps anyone else from claiming your free coffee with just your number.
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
