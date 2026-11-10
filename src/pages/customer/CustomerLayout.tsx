import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, NavLink, Outlet, useLocation, useOutletContext } from 'react-router-dom';
import { Icon, type IconName } from '../../components/Icon';
import { Logo } from '../../components/Logo';
import { useMe, useMeSync } from '../../data/store';
import type { Activity, Customer, Settings } from '../../data/types';
import { initials } from '../../lib/format';
import { StampCelebration, useStampWatcher } from './StampCelebration';

export type CustomerCtx = { customer: Customer; activity: Activity[]; settings: Settings; newIndex: number | null };
export const useCustomerCtx = () => useOutletContext<CustomerCtx>();

const NAV: Array<{ to: string; label: string; icon: IconName; end?: boolean }> = [
  { to: '/app', label: 'Card', icon: 'home', end: true },
  { to: '/app/rewards', label: 'Rewards', icon: 'gift' },
  { to: '/app/history', label: 'Visits', icon: 'clock' },
  { to: '/app/profile', label: 'Profile', icon: 'user' },
];

export function CustomerLayout() {
  const me = useMe();
  useMeSync(15_000);
  const customer = me.data?.customer;
  const settings = me.data?.settings;
  const location = useLocation();
  const event = useStampWatcher(customer, settings);
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

  if (me.status === 'none') return <Navigate to={`/app/join${location.search}`} replace />;
  if (!customer || !settings || !me.data) return <div className="page-loading" aria-label="Loading your card" />;

  const ctx: CustomerCtx = {
    customer,
    activity: me.data.activity,
    settings,
    newIndex: event?.kind === 'stamp' ? event.index : null,
  };

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
            <Link to="/app/profile" className="avatar cx-avatar" aria-label="Profile">
              {initials(customer.name)}
            </Link>
          </div>
        </div>
      </header>

      {me.offline && (
        <div className="offline-bar" role="status">
          <Icon name="refresh" /> Offline. Showing your last saved card.
        </div>
      )}
      <main className="cx-main" ref={mainRef}>
        <Outlet context={ctx} />
      </main>

      <nav className="cx-tabbar" aria-label="Main">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className="cx-tab">
            <Icon name={n.icon} />
            <span>{n.label}</span>
          </NavLink>
        ))}
      </nav>

      <StampCelebration event={event} customer={customer} settings={settings} />
    </div>
  );
}
