import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Icon, type IconName } from '../../components/Icon';
import { BlossomMark, Logo } from '../../components/Logo';
import { adminSignOut, useAdmin, useAdminDB } from '../../data/store';
import { initials } from '../../lib/format';

const NAV: Array<{ to: string; label: string; icon: IconName; end?: boolean }> = [
  { to: '/admin', label: 'Dashboard', icon: 'home', end: true },
  { to: '/admin/scan', label: 'Scan & stamp', icon: 'scan' },
  { to: '/admin/customers', label: 'Customers', icon: 'users' },
  { to: '/admin/qr-codes', label: 'QR codes', icon: 'qr' },
  { to: '/admin/settings', label: 'Settings', icon: 'settings' },
];

const TITLES: Record<string, [string, string]> = {
  '/admin': ['Welcome back', 'Here is how the bar is blooming today'],
  '/admin/scan': ['Scan & stamp', 'Scan a member QR to add a sticker'],
  '/admin/customers': ['Customers', 'Everyone collecting stickers at Bloeisel'],
  '/admin/qr-codes': ['QR codes', 'Branded codes for your counter, tables and windows'],
  '/admin/settings': ['Settings', 'Shape the loyalty programme'],
};

export function AdminLayout() {
  const db = useAdminDB();
  const { offline } = useAdmin();
  const location = useLocation();
  const navigate = useNavigate();
  const [drawer, setDrawer] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('bloeisel.sidebar') === '1';
    } catch {
      return false;
    }
  });
  const [q, setQ] = useState('');

  useEffect(() => setDrawer(false), [location.pathname]);
  useEffect(() => {
    try {
      localStorage.setItem('bloeisel.sidebar', collapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  const [title, sub] = TITLES[location.pathname] ?? TITLES['/admin'];
  const readyCount = db.customers.filter((c) => c.stamps >= db.settings.stampsRequired).length;

  const search = (e: React.FormEvent) => {
    e.preventDefault();
    navigate(`/admin/customers?q=${encodeURIComponent(q)}`);
  };

  return (
    <div className={`ad ${collapsed ? 'is-collapsed' : ''}`}>
      <aside className={`ad-side ${drawer ? 'is-open' : ''}`} aria-label="Staff navigation">
        <div className="ad-side-brand">
          <Link to="/admin" className="ad-side-logo">
            {collapsed ? <BlossomMark size={34} /> : <Logo />}
          </Link>
          <button className="icon-btn ghost ad-drawer-close" onClick={() => setDrawer(false)} aria-label="Close menu">
            <Icon name="close" />
          </button>
        </div>
        <nav className="ad-nav">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className="ad-nav-link" title={collapsed ? n.label : undefined}>
              <Icon name={n.icon} />
              <span>{n.label}</span>
              {n.to === '/admin/customers' && readyCount > 0 && <em className="ad-nav-badge">{readyCount}</em>}
            </NavLink>
          ))}
        </nav>
        <div className="ad-side-promo">
          <BlossomMark size={30} />
          <p>
            <strong>Open the customer card</strong>
            <span>See exactly what members see.</span>
          </p>
          <Link to="/app" target="_blank" className="btn btn-white btn-sm">
            Preview <Icon name="arrowRight" />
          </Link>
        </div>
        <div className="ad-side-foot">
          <button className="ad-nav-link" onClick={() => void adminSignOut()} title={collapsed ? 'Log out' : undefined}>
            <Icon name="logout" />
            <span>Log out</span>
          </button>
          <button className="ad-collapse" onClick={() => setCollapsed((c) => !c)} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            <Icon name={collapsed ? 'chevronRight' : 'chevronLeft'} />
          </button>
        </div>
      </aside>
      {drawer && <div className="scrim ad-scrim" onClick={() => setDrawer(false)} />}

      <div className="ad-body">
        <header className="ad-top">
          <button className="icon-btn ad-menu" onClick={() => setDrawer(true)} aria-label="Open menu">
            <Icon name="menu" />
          </button>
          <div className="ad-title">
            <h1>{title}</h1>
            <p>{sub}</p>
          </div>
          <form className="ad-search" onSubmit={search} role="search">
            <Icon name="search" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search members, codes, phones" aria-label="Search members" />
          </form>
          <div className="ad-top-right">
            <Link to="/admin/customers?filter=ready" className="icon-btn" aria-label={`${readyCount} rewards ready`}>
              <Icon name="bell" />
              {readyCount > 0 && <span className="ad-bell-dot" />}
            </Link>
            <div className="ad-user">
              <span className="avatar">{initials('Bloeisel Barista')}</span>
              <div>
                <span className="ad-user-role">On shift</span>
                <strong>{db.settings.storeName}</strong>
              </div>
            </div>
          </div>
        </header>
        {offline && (
          <div className="offline-bar ad-offline" role="status">
            <Icon name="refresh" /> Can't reach the server. Showing the last data; actions will fail until it's back.
          </div>
        )}
        <main className="ad-main">
          <Outlet />
        </main>
      </div>

      {location.pathname !== '/admin/scan' && (
        <Link to="/admin/scan" className="ad-fab" aria-label="Scan a member">
          <Icon name="scan" />
        </Link>
      )}
    </div>
  );
}
