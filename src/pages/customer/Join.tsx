import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { CoffeeBreak } from '../../components/CoffeeBreak';
import { useToast } from '../../components/Feedback';
import { Icon } from '../../components/Icon';
import { Logo } from '../../components/Logo';
import { createCustomer, findByPhone, recordCampaignScan, signIn, signInDemo, useSessionCustomer } from '../../data/store';

export function Join() {
  const existing = useSessionCustomer();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [mode, setMode] = useState<'join' | 'find'>('join');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    // Count a scan when someone arrives from a printed QR (e.g. ?src=counter), once per session.
    const src = params.get('src');
    const key = `bloeisel.scan.${src}`;
    if (src && !sessionStorage.getItem(key)) {
      sessionStorage.setItem(key, '1');
      recordCampaignScan(src);
    }
  }, [params]);

  if (existing) return <Navigate to="/app" replace />;

  const validPhone = (p: string) => p.replace(/\D/g, '').length >= 9;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (mode === 'join' && name.trim().length < 2) errs.name = 'Tell us what to call you';
    if (!validPhone(phone)) errs.phone = 'Enter a valid mobile number';
    if (mode === 'join' && email && !/^\S+@\S+\.\S+$/.test(email)) errs.email = 'That email looks off';
    setErrors(errs);
    if (Object.keys(errs).length) return;

    const found = findByPhone(phone);
    if (mode === 'find') {
      if (!found) return setErrors({ phone: "We couldn't find a card for that number" });
      signIn(found.id);
      toast(`Welcome back, ${found.name.split(' ')[0]}`, 'heart');
      return navigate('/app');
    }
    if (found) {
      signIn(found.id);
      toast('You already have a card. Welcome back!', 'heart');
      return navigate('/app');
    }
    const c = createCustomer({ name, phone, email });
    signIn(c.id);
    toast('Your card is ready. First sticker on us at the till!', 'sparkle');
    navigate('/app');
  };

  return (
    <div className="join">
      <section className="join-art">
        <div className="join-art-inner">
          <Logo tone="light" />
          <div className="join-lottie">
            <CoffeeBreak />
          </div>
          <div className="join-art-copy">
            <h2 className="display">
              Ten stickers. <span className="display-italic">One free cup.</span>
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
            <button type="button" aria-pressed={mode === 'join'} onClick={() => (setMode('join'), setErrors({}))}>
              New card
            </button>
            <button type="button" aria-pressed={mode === 'find'} onClick={() => (setMode('find'), setErrors({}))}>
              I have a card
            </button>
          </div>

          <h1 className="display join-title">{mode === 'join' ? 'Start your card' : 'Find your card'}</h1>
          <p className="muted join-lede">
            {mode === 'join' ? 'It takes ten seconds. Your first sticker is waiting at the counter.' : 'Enter the mobile number you signed up with.'}
          </p>

          <form className="join-form" onSubmit={submit} noValidate>
            {mode === 'join' && (
              <div className="field">
                <label htmlFor="j-name">Your name</label>
                <input
                  id="j-name"
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Lerato Mokoena"
                  autoComplete="name"
                  aria-invalid={!!errors.name}
                />
                {errors.name && <span className="field-error">{errors.name}</span>}
              </div>
            )}
            <div className="field">
              <label htmlFor="j-phone">Mobile number</label>
              <input
                id="j-phone"
                className="input"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+27 82 123 4567"
                inputMode="tel"
                autoComplete="tel"
                aria-invalid={!!errors.phone}
              />
              {errors.phone && <span className="field-error">{errors.phone}</span>}
            </div>
            {mode === 'join' && (
              <>
                <div className="field">
                  <label htmlFor="j-email">
                    Email <span className="faint">(optional)</span>
                  </label>
                  <input
                    id="j-email"
                    className="input"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    inputMode="email"
                    autoComplete="email"
                    aria-invalid={!!errors.email}
                  />
                  {errors.email && <span className="field-error">{errors.email}</span>}
                </div>
                <label className="check">
                  <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                  <span className="check-box">
                    <Icon name="check" />
                  </span>
                  <span>Send me the odd treat and new-menu news. No spam, promise.</span>
                </label>
              </>
            )}
            <button className="btn btn-primary btn-lg btn-block">
              {mode === 'join' ? 'Create my card' : 'Open my card'} <Icon name="arrowRight" />
            </button>
          </form>

          <div className="join-demo">
            <span className="divider" />
            <span className="faint">or</span>
            <span className="divider" />
          </div>
          <button
            className="btn btn-ghost btn-block"
            onClick={() => {
              signInDemo();
              navigate('/app');
            }}
          >
            <Icon name="eye" /> Explore the demo card
          </button>
          <p className="join-foot faint">
            Working at Bloeisel? <Link to="/admin" className="link">Staff portal</Link>
          </p>
        </div>
      </section>
    </div>
  );
}
