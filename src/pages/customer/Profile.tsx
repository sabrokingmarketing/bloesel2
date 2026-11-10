import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useToast } from '../../components/Feedback';
import { Icon } from '../../components/Icon';
import { signOut, updateProfile } from '../../data/store';
import { initials, shortDate } from '../../lib/format';
import { useCustomerCtx } from './CustomerLayout';

export function Profile() {
  const { customer } = useCustomerCtx();
  const toast = useToast();
  const navigate = useNavigate();
  const [name, setName] = useState(customer.name);
  const [phone, setPhone] = useState(customer.phone);
  const [email, setEmail] = useState(customer.email ?? '');
  const dirty = name !== customer.name || phone !== customer.phone || email !== (customer.email ?? '');

  const save = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim().length < 2) return toast('Please add your name', 'info');
    updateProfile(customer.id, { name: name.trim(), phone: phone.trim(), email: email.trim() || undefined });
    toast('Profile saved');
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
        <Link to="/app/qr" className="member-pass rise rise-1">
          <div>
            <span className="eyebrow">Member code</span>
            <strong className="tabular">{customer.code}</strong>
          </div>
          <span className="member-pass-icon">
            <Icon name="qr" />
          </span>
        </Link>

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
          <button className="btn btn-dark" disabled={!dirty}>
            Save changes
          </button>
        </form>

        <section className="card settings-list rise rise-3">
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
          <button
            className="settings-row danger"
            onClick={() => {
              signOut();
              navigate('/app/join');
            }}
          >
            <Icon name="logout" />
            <span>Sign out</span>
          </button>
        </section>
      </div>
    </div>
  );
}
