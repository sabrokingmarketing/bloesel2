import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Sheet, useToast } from '../../components/Feedback';
import { Icon } from '../../components/Icon';
import { TransferSheet, type Transfer } from '../../components/TransferSheet';
import { removeCardFromDevice, requestTransfer, updateProfile, type ApiError } from '../../data/store';
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
  const [name, setName] = useState(customer.name);
  const [phone, setPhone] = useState(customer.phone);
  const [email, setEmail] = useState(customer.email ?? '');
  const [busy, setBusy] = useState(false);
  const [transfer, setTransfer] = useState<Transfer | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const dirty = name !== customer.name || phone !== customer.phone || email !== (customer.email ?? '');

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (name.trim().length < 2) return toast('Please add your name', 'info');
    // The phone number identifies the card at the counter, so it must stay valid and unique.
    if (!validPhone(phone)) return toast('Enter a valid mobile number', 'info');
    setBusy(true);
    try {
      await updateProfile({ name: name.trim(), phone: phone.trim(), email: email.trim() });
      toast('Profile saved');
    } catch (err) {
      toast((err as ApiError).message, 'info');
    } finally {
      setBusy(false);
    }
  };

  const startTransfer = async () => {
    try {
      setTransfer(await requestTransfer());
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

        <form className="card card-pad profile-form rise rise-2" onSubmit={save}>
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
            <label htmlFor="p-email">Email (optional)</label>
            <input id="p-email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} inputMode="email" autoComplete="email" />
          </div>
          <button className="btn btn-dark" disabled={!dirty || busy}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </form>

        <section className="card settings-list rise rise-3">
          <button className="settings-row" onClick={startTransfer}>
            <Icon name="phone" />
            <span>Move to a new phone</span>
            <Icon name="chevronRight" className="settings-chev" />
          </button>
          <a href="https://bloeiselkoffie.co.za" target="_blank" rel="noreferrer" className="settings-row">
            <Icon name="bean" />
            <span>Visit bloeiselkoffie.co.za</span>
            <Icon name="chevronRight" className="settings-chev" />
          </a>
          <Link to="/" className="settings-row">
            <Icon name="info" />
            <span>About the loyalty card</span>
            <Icon name="chevronRight" className="settings-chev" />
          </Link>
          <button className="settings-row danger" onClick={() => setConfirmRemove(true)}>
            <Icon name="logout" />
            <span>Remove card from this phone</span>
          </button>
        </section>
      </div>

      <TransferSheet transfer={transfer} onClose={() => setTransfer(null)} who="your" />

      <Sheet open={confirmRemove} onClose={() => setConfirmRemove(false)} title="Remove card from this phone?">
        <div className="confirm">
          <p className="muted">
            Your stickers stay safe on your account, but this phone won't show the card any more. To get it back, ask your barista to send it to
            your phone.
          </p>
          <div className="confirm-actions">
            <button className="btn btn-ghost" onClick={() => setConfirmRemove(false)}>
              Keep it here
            </button>
            <button
              className="btn btn-danger"
              onClick={async () => {
                await removeCardFromDevice();
                navigate('/app/join');
              }}
            >
              Remove
            </button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
