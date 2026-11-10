import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '../../components/Feedback';
import { Icon, type IconName } from '../../components/Icon';
import { MiniSticker } from '../../components/Sticker';
import { useAdminDB } from '../../data/store';
import { closeToReward, kpis, series, topDrinks } from '../../lib/analytics';
import { initials, pct, timeAgo } from '../../lib/format';
import { AreaChart } from './AreaChart';
import { StampDots } from './StampDots';

function KpiCard({ icon, label, value, delta, progress, caption, tone = 'rose' }: { icon: IconName; label: string; value: string | number; delta: number; progress: number; caption: string; tone?: 'rose' | 'dark' | 'caramel' }) {
  const up = delta >= 0;
  return (
    <article className="kpi card">
      <div className="kpi-head">
        <span className={`kpi-icon ${tone}`}>
          <Icon name={icon} />
        </span>
        <div className="kpi-label">
          <span>{label}</span>
          <em className={up ? 'up' : 'down'}>{pct(delta)}</em>
        </div>
      </div>
      <div className="kpi-value">
        <strong className="tabular">{value}</strong>
        <div className="kpi-bar">
          <div className="progress">
            <span style={{ width: `${Math.max(4, progress * 100)}%` }} />
          </div>
          <small>{caption}</small>
        </div>
      </div>
    </article>
  );
}

export function Dashboard() {
  const db = useAdminDB();
  const toast = useToast();
  const [range, setRange] = useState<'today' | '7d' | '30d'>('7d');
  const k = useMemo(() => kpis(db), [db]);
  const data = useMemo(() => series(db, range), [db, range]);
  const drinks = useMemo(() => topDrinks(db).slice(0, 5), [db]);
  const close = useMemo(() => closeToReward(db.customers, db.settings.stampsRequired).slice(0, 5), [db]);
  const byId = useMemo(() => new Map(db.customers.map((c) => [c.id, c])), [db.customers]);
  const recent = db.activity.filter((a) => a.type !== 'join').slice(0, 7);
  const total = data.reduce((s, d) => s + d.value, 0);
  const maxDrink = drinks[0]?.count ?? 1;

  return (
    <div className="dash">
      <section className="kpi-row">
        <KpiCard icon="bean" label="Stickers today" value={k.today.value} delta={k.today.delta} progress={k.today.progress} caption={k.today.caption} />
        <KpiCard icon="users" label="Active members" value={k.active.value} delta={k.active.delta} progress={k.active.progress} caption={k.active.caption} tone="dark" />
        <KpiCard icon="gift" label="Free cups given" value={k.redeemed.value} delta={k.redeemed.delta} progress={k.redeemed.progress} caption={k.redeemed.caption} tone="caramel" />
        <KpiCard icon="sparkle" label="New members" value={k.joined.value} delta={k.joined.delta} progress={k.joined.progress} caption={k.joined.caption} />
      </section>

      <section className="dash-mid">
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
          <AreaChart data={data} />
        </article>

        <article className="card card-pad">
          <div className="card-head">
            <h2 className="card-title">Trending coffee</h2>
            <span className="faint chart-sub">30 days</span>
          </div>
          <ul className="drink-list">
            {drinks.map((d, i) => (
              <li key={d.name}>
                <MiniSticker index={[0, 1, 2, 4, 3][i] ?? i} size={40} />
                <div className="drink-meta">
                  <div className="drink-row">
                    <strong>{d.name}</strong>
                    <span className="tabular">{d.count}</span>
                  </div>
                  <div className="drink-bar">
                    <span style={{ width: `${(d.count / maxDrink) * 100}%` }} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
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
                            <Icon name="plus" /> {a.drink ?? 'Sticker'}
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
        </article>

        <article className="card card-pad nudge-card">
          <div className="card-head">
            <div>
              <h2 className="card-title">Almost blooming</h2>
              <p className="faint chart-sub">Members one or two cups from a reward</p>
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
                      <span>{left <= 0 ? 'Reward ready to redeem' : `${left} to go · last seen ${timeAgo(c.lastVisit).toLowerCase()}`}</span>
                    </div>
                    {left <= 0 ? (
                      <Link to={`/admin/scan?code=${c.code}`} className="btn btn-sm btn-dark">
                        Redeem
                      </Link>
                    ) : (
                      <button className="btn btn-sm btn-soft" onClick={() => toast(`Reminder queued for ${c.name.split(' ')[0]}`, 'heart')}>
                        Nudge
                      </button>
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
