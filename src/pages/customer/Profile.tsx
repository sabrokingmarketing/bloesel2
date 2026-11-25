import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Sheet, useToast } from '../../components/Feedback';
import { Icon } from '../../components/Icon';
import { PinField, pinProblem } from '../../components/PinField';
import { TransferSheet, type Transfer } from '../../components/TransferSheet';
import { deleteMyCard, removeCardFromDevice, requestTransfer, setPin, signOutOtherPhones, updateProfile, type ApiError } from '../../data/store';
import { initials, shortDate } from '../../lib/format';
import { useCustomerCtx } from './CustomerLayout';

const validPhone = (p: string) => {
  const d = p.replace(/\D/g, '');
  return d.length >= 9 && d.length <= 15;
};

export function Profile() {
  const { customer } = useCustomerCtx();
  const toast = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const hasPin = !!customer.hasPin;

  // Details
  const [name, setName] = useState(customer.name);
  const [phone, setPhone] = useState(customer.phone);
  const [email, setEmail] = useState(customer.email ?? '');
  const [detailsPin, setDetailsPin] = useState('');
  const [detailsError, setDetailsError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const phoneChanged = phone.trim() !== customer.phone;
  const emailChanged = email.trim().toLowerCase() !== (customer.email ?? '').toLowerCase();
  // The number signs in and the email receives reset links, so changing either needs the current PIN.
  const needsPinForDetails = hasPin && (phoneChanged || emailChanged);
  const dirty = name.trim() !== customer.name || phoneChanged || emailChanged;

  // Sheets
  const [transfer, setTransfer] = useState<Transfer | null>(null);
  const [sheet, setSheet] = useState<null | 'pin' | 'remove' | 'delete'>(null);
  const [newPin, setNewPin] = useState('');
  const [currentPin, setCurrentPin] = useState('');
  const [sheetError, setSheetError] = useState<string | undefined>();
  const [sheetBusy, setSheetBusy] = useState(false);

  const openSheet = (s: 'pin' | 'remove' | 'delete') => {
    setSheet(s);
    setNewPin('');
    setCurrentPin('');
    setSheetError(undefined);
  };

  // /app/profile?pin=1 (from the card page nudge) opens the PIN sheet straight away.
  useEffect(() => {
    if (params.get('pin')) {
      openSheet('pin');
      params.delete('pin');
      setParams(params, { replace: true });
    }
  }, [params, setParams]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (name.trim().length < 2) return setDetailsError('Please add your name');
    if (!validPhone(phone)) return setDetailsError('Enter a valid mobile number');
    if (emailChanged && !email.trim()) return setDetailsError('Your card needs an email address, so you can reset your PIN');
    if (emailChanged && !/^\S+@\S+\.\S+$/.test(email.trim())) return setDetailsError('That email looks off');
    if (needsPinForDetails && !/^\d{4}$/.test(detailsPin)) return setDetailsError('Enter your current PIN to change your number or email');
    setDetailsError(undefined);
    setBusy(true);
    try {
      await updateProfile({
        name: name.trim(),
        ...(phoneChanged ? { phone: phone.trim() } : {}),
        ...(emailChanged ? { email: email.trim() } : {}),
        ...(needsPinForDetails ? { currentPin: detailsPin } : {}),
      });
      setDetailsPin('');
      toast('Profile saved');
    } catch (err) {
      setDetailsError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  const savePin = async (e: FormEvent) => {
    e.preventDefault();
    if (hasPin && !/^\d{4}$/.test(currentPin)) return setSheetError('Enter your current PIN');
    const problem = pinProblem(newPin);
    if (problem) return setSheetError(problem);
    setSheetBusy(true);
    try {
      await setPin(newPin, hasPin ? currentPin : undefined);
      toast(hasPin ? 'PIN changed. Other phones were signed out.' : 'PIN set. You can now sign in on any phone.', 'check');
      setSheet(null);
    } catch (err) {
      setSheetError((err as ApiError).message);
    } finally {
      setSheetBusy(false);
    }
  };

  const deleteCard = async (e: FormEvent) => {
    e.preventDefault();
    if (hasPin && !/^\d{4}$/.test(currentPin)) return setSheetError('Enter your PIN to confirm');
    setSheetBusy(true);
    try {
      await deleteMyCard(hasPin ? currentPin : undefined);
      toast('Your card and data were deleted.', 'check');
      navigate('/');
    } catch (err) {
      setSheetError((err as ApiError).message);
    } finally {
      setSheetBusy(false);
    }
  };

  const startTransfer = async () => {
    try {
      setTransfer(await requestTransfer());
    } catch (err) {
      toast((err as ApiError).message, 'info');
    }
  };

  const signOutOthers = async () => {
    try {
      const { signedOut } = await signOutOtherPhones();
      toast(signedOut ? `Signed out ${signedOut} other ${signedOut === 1 ? 'phone' : 'phones'}` : 'No other phones were signed in', 'check');
    } catch (err) {
      toast((err as ApiError).message, 'info');
    }
  };

  return (
    <div className="cx-page">
      <header className="profile-head rise">
        <span className="avatar profile-avatar">{initials(customer.name)}</span>
        <div>
          <h1 className="display cx-page-title">{customer.name}</h1>
          <p className="muted">Member since {shortDate(customer.joinedAt)}</p>
        </div>
      </header>

      <div className="profile-grid">
        <div className="member-pass rise rise-1">
          <div>
            <span className="eyebrow">Member code</span>
            <strong className="tabular">{customer.code}</strong>
          </div>
          <span className="member-pass-icon">
            <Icon name="card" />
          </span>
        </div>

        <form className="card card-pad profile-form rise rise-2" onSubmit={save} noValidate>
          <h2 className="card-title">Your details</h2>
          <div className="field">
            <label htmlFor="p-name">Name</label>
            <input id="p-name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </div>
          <div className="field">
            <label htmlFor="p-phone">Mobile number</label>
            <input id="p-phone" className="input" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" />
          </div>
          <div className="field">
            <label htmlFor="p-email">Email (to reset your PIN)</label>
            <input id="p-email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} inputMode="email" autoComplete="email" />
          </div>
          {needsPinForDetails && (
            <PinField id="p-details-pin" label="Current PIN" value={detailsPin} onChange={setDetailsPin} hint="Needed to change your number or email." />
          )}
          {detailsError && <p className="field-error">{detailsError}</p>}
          <button className="btn btn-dark" disabled={!dirty || busy}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </form>

        <section className="card settings-list rise rise-3" aria-label="Security">
          <button className="settings-row" onClick={() => openSheet('pin')}>
            <Icon name="lock" />
            <span>{hasPin ? 'Change sign-in PIN' : 'Set a sign-in PIN'}</span>
            {!hasPin && <span className="settings-badge">New</span>}
            <Icon name="chevronRight" className="settings-chev" />
          </button>
          <button className="settings-row" onClick={startTransfer}>
            <Icon name="phone" />
            <span>Move to a new phone</span>
            <Icon name="chevronRight" className="settings-chev" />
          </button>
          <button className="settings-row" onClick={signOutOthers}>
            <Icon name="shield" />
            <span>Sign out other phones</span>
            <Icon name="chevronRight" className="settings-chev" />
          </button>
        </section>

        <section className="card settings-list rise rise-4" aria-label="More">
          <a href="https://bloeiselkoffie.co.za" target="_blank" rel="noreferrer" className="settings-row">
            <Icon name="bean" />
            <span className="no-caps">Visit bloeiselkoffie.co.za</span>
            <Icon name="chevronRight" className="settings-chev" />
          </a>
          <Link to="/" className="settings-row">
            <Icon name="info" />
            <span>About the loyalty card</span>
            <Icon name="chevronRight" className="settings-chev" />
          </Link>
          <button className="settings-row danger" onClick={() => openSheet('remove')}>
            <Icon name="logout" />
            <span>Sign out on this phone</span>
          </button>
          <button className="settings-row danger" onClick={() => openSheet('delete')}>
            <Icon name="trash" />
            <span>Delete my card and data</span>
          </button>
        </section>
      </div>

      <TransferSheet transfer={transfer} onClose={() => setTransfer(null)} who="your" />

      <Sheet open={sheet === 'pin'} onClose={() => setSheet(null)} title={hasPin ? 'Change your PIN' : 'Set a sign-in PIN'}>
        <form className="pin-sheet" onSubmit={savePin} noValidate>
          <p className="muted">
            {hasPin
              ? 'For your security, every other phone signed in to your card will be signed out.'
              : "With your mobile number and this PIN you can open your card on any phone. You'll stay signed in for 120 days."}
          </p>
          {hasPin && <PinField id="p-current" label="Current PIN" value={currentPin} onChange={setCurrentPin} />}
          <PinField id="p-pin" label="New 4-digit PIN" value={newPin} onChange={setNewPin} isNew />
          {sheetError && <p className="field-error">{sheetError}</p>}
          <button className="btn btn-primary btn-block btn-cta" disabled={sheetBusy}>
            {sheetBusy ? 'Saving…' : 'Save PIN'}
            <span className="btn-orb">
              <Icon name="check" />
            </span>
          </button>
        </form>
      </Sheet>

      <Sheet open={sheet === 'remove'} onClose={() => setSheet(null)} title="Sign out on this phone?">
        <div className="confirm">
          <p className="muted">
            Your card and stickers stay safe.{' '}
            {hasPin ? 'Sign in again any time with your mobile number and PIN.' : 'Set a PIN first, or you will need your barista to send the card back to you.'}
          </p>
          <div className="confirm-actions">
            <button className="btn btn-ghost" onClick={() => setSheet(null)}>
              Stay signed in
            </button>
            <button
              className="btn btn-danger"
              onClick={async () => {
                await removeCardFromDevice();
                navigate('/app/join?mode=signin');
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      </Sheet>

      <Sheet open={sheet === 'delete'} onClose={() => setSheet(null)} title="Delete your card?">
        <form className="pin-sheet" onSubmit={deleteCard} noValidate>
          <p className="muted">
            This permanently deletes your card, your {customer.stamps} {customer.stamps === 1 ? 'sticker' : 'stickers'}, your visit history and your details. It
            can't be undone.
          </p>
          {hasPin && <PinField id="p-delete-pin" label="Enter your PIN to confirm" value={currentPin} onChange={setCurrentPin} />}
          {sheetError && <p className="field-error">{sheetError}</p>}
          <div className="confirm-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setSheet(null)}>
              Keep my card
            </button>
            <button className="btn btn-danger" disabled={sheetBusy}>
              {sheetBusy ? 'Deleting…' : 'Delete forever'}
            </button>
          </div>
        </form>
      </Sheet>
    </div>
  );
}
