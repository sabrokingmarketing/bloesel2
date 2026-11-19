import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon, type IconName } from '../../components/Icon';
import { useAdminDB } from '../../data/store';
import { closeToReward, kpis, series } from '../../lib/analytics';
import { initials, pct, timeAgo } from '../../lib/format';
import { AreaChart } from './AreaChart';
import { StampDots } from './StampDots';

function KpiCard({ icon, label, value, delta, caption, tone = 'rose' }: { icon: IconName; label: string; value: string | number; delta: number; caption: string; tone?: 'rose' | 'dark' | 'caramel' }) {
  const up = delta >= 0;
  return (
    <article className="kpi card">
      <div className="kpi-head">
        <span className={`kpi-icon ${tone}`}>
          <Icon name={icon} />
        </span>
        <span className="kpi-label">{label}</span>
      </div>
      <strong className="kpi-num tabular">{value}</strong>
      <div className="kpi-foot">
        <em className={`kpi-delta ${up ? 'up' : 'down'}`}>{pct(delta)}</em>
        <small className="kpi-caption">{caption}</small>
      </div>
    </article>
  );
}

const FIRST_PAGE = 5;
const PAGE = 10;

export function Dashboard() {
  const db = useAdminDB();
  const [range, setRange] = useState<'today' | '7d' | '30d'>('7d');
  const k = useMemo(() => kpis(db), [db]);
  const data = useMemo(() => series(db, range), [db, range]);
  const close = useMemo(() => closeToReward(db.customers, db.settings.stampsRequired).slice(0, 5), [db]);
  const byId = useMemo(() => new Map(db.customers.map((c) => [c.id, c])), [db.customers]);
  const [shown, setShown] = useState(FIRST_PAGE);
  const allRecent = useMemo(() => db.activity.filter((a) => a.type !== 'join' && byId.has(a.customerId)), [db.activity, byId]);
  const recent = allRecent.slice(0, shown);
  const total = data.reduce((s, d) => s + d.value, 0);

  return (
    <div className="dash">
      <section className="kpi-row">
        <KpiCard icon="bean" label="Stickers today" value={k.today.value} delta={k.today.delta} caption={k.today.caption} />
        <KpiCard icon="users" label="Active members" value={k.active.value} delta={k.active.delta} caption={k.active.caption} tone="dark" />
        <KpiCard icon="gift" label="Free cups given" value={k.redeemed.value} delta={k.redeemed.delta} caption={k.redeemed.caption} tone="caramel" />
        <KpiCard icon="userPlus" label="New members" value={k.joined.value} delta={k.joined.delta} caption={k.joined.caption} />
      </section>

      <section className="dash-chart">
        <article className="card card-pad chart-card">
          <div className="card-head">
            <div>
              <h2 className="card-title">Visit analytics</h2>
              <p className="faint chart-sub">
                <strong className="tabular">{total}</strong> stickers and rewards {range === 'today' ? 'today' : `in the last ${range === '7d' ? '7' : '30'} days`}
              </p>
            </div>
            <div className="segmented" role="group" aria-label="Range">
              {(
                [
                  ['today', 'Today'],
                  ['7d', '7 days'],
                  ['30d', '30 days'],
                ] as const
              ).map(([v, l]) => (
                <button key={v} aria-pressed={range === v} onClick={() => setRange(v)}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          {total === 0 ? (
            <div className="chart-empty">
              <Icon name="chart" />
              <strong>No visits {range === 'today' ? 'yet today' : 'in this period yet'}</strong>
              <span>Stickers and free coffees will show up here as they happen.</span>
            </div>
          ) : (
            <AreaChart data={data} />
          )}
        </article>

      </section>

      <section className="dash-bottom">
        <article className="card card-pad recent-card">
          <div className="card-head">
            <h2 className="card-title">Recent activity</h2>
            <Link to="/admin/customers" className="link">
              See all
            </Link>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Activity</th>
                  <th className="hide-sm">Card</th>
                  <th className="t-right">When</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((a) => {
                  const c = byId.get(a.customerId);
                  if (!c) return null;
                  return (
                    <tr key={a.id}>
                      <td>
                        <Link to={`/admin/customers?open=${c.id}`} className="t-member">
                          <span className="avatar">{initials(c.name)}</span>
                          <span>
                            <strong>{c.name}</strong>
                            <small className="tabular">{c.code}</small>
                          </span>
                        </Link>
                      </td>
                      <td>
                        {a.type === 'stamp' && (
                          <span className="chip">
                            <Icon name={a.note === 'Counter QR' ? 'qr' : 'plus'} /> {a.note === 'Counter QR' ? 'Counter QR' : a.drink ?? 'Sticker'}
                          </span>
                        )}
                        {a.type === 'redeem' && (
                          <span className="chip chip-caramel">
                            <Icon name="gift" /> Free coffee
                          </span>
                        )}
                        {a.type === 'adjust' && (
                          <span className="chip chip-neutral">
                            <Icon name="edit" /> Adjusted {a.delta && a.delta > 0 ? '+' : ''}
                            {a.delta}
                          </span>
                        )}
                      </td>
                      <td className="hide-sm">
                        <StampDots value={c.stamps} max={db.settings.stampsRequired} />
                      </td>
                      <td className="t-right faint t-when">{timeAgo(a.at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {allRecent.length === 0 && (
            <div className="empty">
              <Icon name="clock" />
              <p>No stickers or rewards yet.</p>
            </div>
          )}
          {allRecent.length > shown && (
            <button className="btn btn-ghost btn-block load-more" onClick={() => setShown((n) => n + PAGE)}>
              <Icon name="chevronDown" /> Load more
              <span className="faint tabular no-caps">
                {shown} of {allRecent.length}
              </span>
            </button>
          )}
        </article>

        <article className="card card-pad nudge-card">
          <div className="card-head">
            <div>
              <h2 className="card-title">Almost blooming</h2>
              <p className="faint chart-sub">Free coffees waiting, and members one or two cups away</p>
            </div>
          </div>
          {close.length === 0 ? (
            <div className="empty">
              <Icon name="sparkle" />
              <p>No one is close yet.</p>
            </div>
          ) : (
            <ul className="nudge-list">
              {close.map((c) => {
                const left = db.settings.stampsRequired - c.stamps;
                return (
                  <li key={c.id}>
                    <span className="avatar">{initials(c.name)}</span>
                    <div>
                      <strong>{c.name}</strong>
                      <span>{left <= 0 ? 'Free coffee ready' : `Last seen ${timeAgo(c.lastVisit).toLowerCase()}`}</span>
                    </div>
                    {left <= 0 ? (
                      <Link to={`/admin/scan?code=${c.code}`} className="btn btn-sm btn-dark">
                        Redeem
                      </Link>
                    ) : (
                      <span className="chip chip-neutral tabular">{left} to go</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </article>
      </section>
    </div>
  );
}
