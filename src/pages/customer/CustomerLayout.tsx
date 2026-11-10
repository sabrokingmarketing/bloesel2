import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, NavLink, Outlet, useLocation, useOutletContext } from 'react-router-dom';
import { Icon, type IconName } from '../../components/Icon';
import { Logo } from '../../components/Logo';
import { useDB, useSessionCustomer } from '../../data/store';
import type { Customer, Settings } from '../../data/types';
import { initials } from '../../lib/format';
import { StampCelebration, useStampWatcher } from './StampCelebration';

export type CustomerCtx = { customer: Customer; settings: Settings; newIndex: number | null };
export const useCustomerCtx = () => useOutletContext<CustomerCtx>();

const NAV: Array<{ to: string; label: string; icon: IconName; end?: boolean }> = [
  { to: '/app', label: 'Card', icon: 'home', end: true },
  { to: '/app/rewards', label: 'Rewards', icon: 'gift' },
  { to: '/app/history', label: 'Visits', icon: 'clock' },
  { to: '/app/profile', label: 'Profile', icon: 'user' },
];

export function CustomerLayout() {
  const db = useDB();
  const customer = useSessionCustomer();
  const location = useLocation();
  const event = useStampWatcher(customer, db.settings);
  const [scrolled, setScrolled] = useState(false);
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [location.pathname]);

  if (!customer) return <Navigate to={`/app/join${location.search}`} replace />;

  const ctx: CustomerCtx = { customer, settings: db.settings, newIndex: event?.kind === 'stamp' ? event.index : null };

  return (
    <div className="cx">
      <header className={`cx-top ${scrolled ? 'is-scrolled' : ''}`}>
        <div className="cx-top-inner">
          <Link to="/app" aria-label="Bloeisel Koffie home">
            <Logo size="sm" />
          </Link>
          <nav className="cx-topnav" aria-label="Main">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className="cx-topnav-link">
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="cx-top-actions">
            <Link to="/app/qr" className="btn btn-primary btn-sm cx-top-qr">
              <Icon name="qr" /> My QR
            </Link>
            <Link to="/app/profile" className="avatar cx-avatar" aria-label="Profile">
              {initials(customer.name)}
            </Link>
          </div>
        </div>
      </header>

      <main className="cx-main" ref={mainRef}>
        <Outlet context={ctx} />
      </main>

      <nav className="cx-tabbar" aria-label="Main">
        {NAV.slice(0, 2).map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className="cx-tab">
            <Icon name={n.icon} />
            <span>{n.label}</span>
          </NavLink>
        ))}
        <Link to="/app/qr" className="cx-tab-qr" aria-label="Show my QR code">
          <span className="cx-tab-qr-btn">
            <Icon name="qr" />
          </span>
          <span>Scan</span>
        </Link>
        {NAV.slice(2).map((n) => (
          <NavLink key={n.to} to={n.to} className="cx-tab">
            <Icon name={n.icon} />
            <span>{n.label}</span>
          </NavLink>
        ))}
      </nav>

      <StampCelebration event={event} customer={customer} settings={db.settings} />
    </div>
  );
}
