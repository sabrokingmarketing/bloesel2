import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Sheet, useToast } from '../../components/Feedback';
import { Icon } from '../../components/Icon';
import { LoyaltyCard } from '../../components/LoyaltyCard';
import { TransferSheet, type Transfer } from '../../components/TransferSheet';
import { adjustStamps, deleteCustomer, redeemReward, staffTransfer, useAdminDB, type ApiError } from '../../data/store';
import type { Customer } from '../../data/types';
import { isLapsed } from '../../lib/analytics';
import { dateTime, initials, shortDate, timeAgo } from '../../lib/format';
import { StampDots } from './StampDots';

type Filter = 'all' | 'ready' | 'close' | 'new' | 'lapsed';
type Sort = 'recent' | 'stamps' | 'name' | 'lifetime';

const FILTERS: Array<[Filter, string]> = [
  ['all', 'All'],
  ['ready', 'Reward ready'],
  ['close', 'Almost there'],
  ['new', 'New this month'],
  ['lapsed', 'Not seen lately'],
];

export function Customers() {
  const db = useAdminDB();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const filter = (params.get('filter') as Filter) ?? 'all';
  const openId = params.get('open');
  const [sort, setSort] = useState<Sort>('recent');
  const max = db.settings.stampsRequired;

  const set = (k: string, v: string | null) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  const counts = useMemo(() => {
    const month = Date.now() - 30 * 86_400_000;
    return {
      all: db.customers.length,
      ready: db.customers.filter((c) => c.stamps >= max).length,
      close: db.customers.filter((c) => c.stamps >= max - 2 && c.stamps < max).length,
      new: db.customers.filter((c) => new Date(c.joinedAt).getTime() > month).length,
      lapsed: db.customers.filter((c) => isLapsed(c)).length,
    } as Record<Filter, number>;
  }, [db.customers, max]);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    const digits = term.replace(/\D/g, '');
    const month = Date.now() - 30 * 86_400_000;
    const list = db.customers.filter((c) => {
      if (term && !(c.name.toLowerCase().includes(term) || c.code.toLowerCase().includes(term) || (digits.length > 2 && c.phone.replace(/\D/g, '').includes(digits))))
        return false;
      if (filter === 'ready') return c.stamps >= max;
      if (filter === 'close') return c.stamps >= max - 2 && c.stamps < max;
      if (filter === 'new') return new Date(c.joinedAt).getTime() > month;
      if (filter === 'lapsed') return isLapsed(c);
      return true;
    });
    const by: Record<Sort, (a: Customer, b: Customer) => number> = {
      recent: (a, b) => (b.lastVisit ?? b.joinedAt).localeCompare(a.lastVisit ?? a.joinedAt),
      stamps: (a, b) => b.stamps - a.stamps,
      name: (a, b) => a.name.localeCompare(b.name),
      lifetime: (a, b) => b.totalStamps - a.totalStamps,
    };
    return list.sort(by[sort]);
  }, [db.customers, q, filter, sort, max]);

  const open = openId ? db.customers.find((c) => c.id === openId) : undefined;

  return (
    <div className="customers">
      <div className="toolbar">
        <div className="toolbar-search">
          <Icon name="search" />
          <input value={q} onChange={(e) => set('q', e.target.value || null)} placeholder="Search by name, code or phone" aria-label="Search customers" />
          {q && (
            <button className="icon-btn ghost" onClick={() => set('q', null)} aria-label="Clear search">
              <Icon name="close" />
            </button>
          )}
        </div>
        <label className="toolbar-sort">
          <span className="faint">Sort</span>
          <select className="select" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="recent">Last visit</option>
            <option value="stamps">Stickers on card</option>
            <option value="lifetime">Lifetime stickers</option>
            <option value="name">Name</option>
          </select>
        </label>
      </div>

      <div className="filter-chips" role="group" aria-label="Filter">
        {FILTERS.map(([f, label]) => (
          <button key={f} className={`fchip ${filter === f ? 'on' : ''}`} onClick={() => set('filter', f === 'all' ? null : f)} aria-pressed={filter === f}>
            {label} <em className="tabular">{counts[f]}</em>
          </button>
        ))}
      </div>

      <div className="card customers-card">
        {rows.length === 0 ? (
          <div className="empty">
            <Icon name="users" />
            <p>No members match that.</p>
          </div>
        ) : (
          <>
            <table className="table customers-table">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Card</th>
                  <th className="hide-md">Lifetime</th>
                  <th className="hide-md">Usual</th>
                  <th>Last visit</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} onClick={() => set('open', c.id)} className="t-click">
                    <td>
                      <div className="t-member">
                        <span className="avatar">{initials(c.name)}</span>
                        <span>
                          <strong>{c.name}</strong>
                          <small className="tabular">{c.code}</small>
                        </span>
                      </div>
                    </td>
                    <td>
                      {c.stamps >= max ? (
                        <span className="chip chip-caramel">
                          <Icon name="gift" /> Reward ready
                        </span>
                      ) : (
                        <StampDots value={c.stamps} max={max} />
                      )}
                    </td>
                    <td className="hide-md tabular">{c.totalStamps}</td>
                    <td className="hide-md">{c.favourite ?? '—'}</td>
                    <td className="faint">{timeAgo(c.lastVisit)}</td>
                    <td className="t-right">
                      <Icon name="chevronRight" className="t-chev" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <ul className="customer-cards">
              {rows.map((c) => (
                <li key={c.id}>
                  <button onClick={() => set('open', c.id)}>
                    <span className="avatar">{initials(c.name)}</span>
                    <span className="cc-main">
                      <strong>{c.name}</strong>
                      <small className="faint">
                        {c.code} · {timeAgo(c.lastVisit)}
                      </small>
                      {c.stamps >= max ? <span className="chip chip-caramel">Reward ready</span> : <StampDots value={c.stamps} max={max} />}
                    </span>
                    <Icon name="chevronRight" className="t-chev" />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <CustomerSheet key={open?.id ?? 'none'} customer={open} onClose={() => set('open', null)} />
    </div>
  );
}

function CustomerSheet({ customer, onClose }: { customer?: Customer; onClose: () => void }) {
  const db = useAdminDB();
  const toast = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [transfer, setTransfer] = useState<Transfer | null>(null);
  if (!customer) return null;

  const run = async (fn: () => Promise<unknown>, done?: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      if (done) toast(done, 'check');
    } catch (err) {
      toast((err as ApiError).message, 'info');
    } finally {
      setBusy(false);
    }
  };
  const max = db.settings.stampsRequired;
  const acts = db.activity.filter((a) => a.customerId === customer.id).slice(0, 8);

  return (
    <Sheet open onClose={onClose} title={customer.name}>
      <div className="csheet">
        <div className="csheet-meta">
          <span className="chip chip-neutral tabular">{customer.code}</span>
          <a href={`tel:${customer.phone.replace(/\s/g, '')}`} className="chip chip-neutral">
            <Icon name="phone" /> {customer.phone}
          </a>
          {customer.email && (
            <a href={`mailto:${customer.email}`} className="chip chip-neutral">
              <Icon name="mail" /> {customer.email}
            </a>
          )}
        </div>

        <LoyaltyCard customer={customer} settings={db.settings} compact />

        <div className="csheet-actions">
          <div className="stepper" aria-label="Adjust stickers">
            <button onClick={() => run(() => adjustStamps(customer.id, -1, 'Manual correction'))} disabled={busy || customer.stamps <= 0} aria-label="Remove a sticker">
              <Icon name="minus" />
            </button>
            <span className="tabular">
              {customer.stamps}/{max}
            </span>
            <button onClick={() => run(() => adjustStamps(customer.id, 1, 'Manual correction'))} disabled={busy || customer.stamps >= max} aria-label="Add a sticker">
              <Icon name="plus" />
            </button>
          </div>
          {customer.stamps >= max ? (
            <button className="btn btn-dark" disabled={busy} onClick={() => run(() => redeemReward(customer.id), 'Free coffee redeemed')}>
              <Icon name="gift" /> Redeem reward
            </button>
          ) : (
            <Link to={`/admin/scan?code=${customer.code}`} className="btn btn-primary">
              <Icon name="scan" /> Stamp at till
            </Link>
          )}
        </div>

        <button className="btn btn-ghost btn-block" disabled={busy} onClick={() => run(async () => setTransfer(await staffTransfer(customer.id)))}>
          <Icon name="phone" /> Send card to a new phone
        </button>

        <dl className="csheet-stats">
          <div>
            <dt>Lifetime stickers</dt>
            <dd className="tabular">{customer.totalStamps}</dd>
          </div>
          <div>
            <dt>Rewards redeemed</dt>
            <dd className="tabular">{customer.rewardsRedeemed}</dd>
          </div>
          <div>
            <dt>Usual order</dt>
            <dd>{customer.favourite ?? '—'}</dd>
          </div>
          <div>
            <dt>Member since</dt>
            <dd>{shortDate(customer.joinedAt)}</dd>
          </div>
        </dl>

        <div>
          <h3 className="csheet-h">Recent activity</h3>
          <ul className="csheet-acts">
            {acts.map((a) => (
              <li key={a.id}>
                <span className={`csheet-act-icon is-${a.type}`}>
                  <Icon name={a.type === 'stamp' ? 'plus' : a.type === 'redeem' ? 'gift' : a.type === 'join' ? 'sparkle' : 'edit'} />
                </span>
                <span className="csheet-act-text">
                  {a.type === 'stamp' && `Sticker · ${a.note === 'Counter QR' ? 'Counter QR' : a.drink ?? 'Coffee'}`}
                  {a.type === 'redeem' && 'Redeemed free coffee'}
                  {a.type === 'join' && 'Joined the programme'}
                  {a.type === 'adjust' && `Adjusted ${a.delta && a.delta > 0 ? '+' : ''}${a.delta}${a.note ? ` · ${a.note}` : ''}`}
                </span>
                <time className="faint">{dateTime(a.at)}</time>
              </li>
            ))}
          </ul>
        </div>

        <div className="csheet-danger">
          {confirmDelete ? (
            <>
              <span>Remove {customer.name.split(' ')[0]} and their history?</span>
              <button className="btn btn-sm btn-ghost" onClick={() => setConfirmDelete(false)}>
                Keep
              </button>
              <button
                className="btn btn-sm btn-danger"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await deleteCustomer(customer.id);
                    onClose();
                  }, 'Member removed')
                }
              >
                Remove
              </button>
            </>
          ) : (
            <button className="link csheet-remove" onClick={() => setConfirmDelete(true)}>
              <Icon name="trash" size={14} /> Remove member
            </button>
          )}
        </div>
      </div>
      <TransferSheet transfer={transfer} onClose={() => setTransfer(null)} who={`${customer.name.split(' ')[0]}'s`} />
    </Sheet>
  );
}
