import type { Activity, Customer, DB } from '../data/types';

const DAY = 86_400_000;

export function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function inRange(a: Activity, from: number, to: number) {
  const t = new Date(a.at).getTime();
  return t >= from && t < to;
}

function change(cur: number, prev: number) {
  if (prev === 0) return cur > 0 ? 100 : 0;
  return ((cur - prev) / prev) * 100;
}

export type Kpi = { value: number; delta: number; progress: number; caption: string };

export function kpis(db: DB, now = new Date()) {
  const today = startOfDay(now).getTime();
  const tomorrow = today + DAY;
  const stamps = db.activity.filter((a) => a.type === 'stamp');
  const redeems = db.activity.filter((a) => a.type === 'redeem');

  const todayStamps = stamps.filter((a) => inRange(a, today, tomorrow)).length;
  // Same time window yesterday, for a fair comparison mid-day.
  const elapsed = now.getTime() - today;
  const yStamps = stamps.filter((a) => inRange(a, today - DAY, today - DAY + elapsed)).length;

  const d30 = now.getTime() - 30 * DAY;
  const d60 = now.getTime() - 60 * DAY;
  const activeIds = new Set(db.activity.filter((a) => a.type === 'stamp' && inRange(a, d30, Infinity)).map((a) => a.customerId));
  const prevActive = new Set(db.activity.filter((a) => a.type === 'stamp' && inRange(a, d60, d30)).map((a) => a.customerId));

  const red30 = redeems.filter((a) => inRange(a, d30, Infinity)).length;
  const redPrev = redeems.filter((a) => inRange(a, d60, d30)).length;

  const joins30 = db.customers.filter((c) => new Date(c.joinedAt).getTime() >= d30).length;
  const joinsPrev = db.customers.filter((c) => {
    const t = new Date(c.joinedAt).getTime();
    return t >= d60 && t < d30;
  }).length;

  const dailyGoal = 40;
  return {
    today: { value: todayStamps, delta: change(todayStamps, yStamps), progress: Math.min(1, todayStamps / dailyGoal), caption: `Goal ${dailyGoal} a day` } as Kpi,
    active: {
      value: activeIds.size,
      delta: change(activeIds.size, prevActive.size),
      progress: db.customers.length ? activeIds.size / db.customers.length : 0,
      caption: `of ${db.customers.length} members`,
    } as Kpi,
    redeemed: { value: red30, delta: change(red30, redPrev), progress: Math.min(1, red30 / Math.max(1, red30 + 10)), caption: 'Last 30 days' } as Kpi,
    joined: { value: joins30, delta: change(joins30, joinsPrev), progress: Math.min(1, joins30 / 30), caption: 'Last 30 days' } as Kpi,
  };
}

export type Point = { label: string; value: number; full: string };

export function series(db: DB, range: 'today' | '7d' | '30d', now = new Date()): Point[] {
  const stamps = db.activity.filter((a) => a.type === 'stamp' || a.type === 'redeem');
  if (range === 'today') {
    const base = startOfDay(now);
    return Array.from({ length: 12 }).map((_, i) => {
      const h = 6 + i;
      const from = new Date(base).setHours(h);
      const v = stamps.filter((a) => inRange(a, from, from + 3_600_000)).length;
      const lbl = `${String(h).padStart(2, '0')}:00`;
      return { label: lbl, value: v, full: `${lbl} – ${String(h + 1).padStart(2, '0')}:00` };
    });
  }
  const days = range === '7d' ? 7 : 30;
  const start = startOfDay(now).getTime() - (days - 1) * DAY;
  return Array.from({ length: days }).map((_, i) => {
    const from = start + i * DAY;
    const d = new Date(from);
    const v = stamps.filter((a) => inRange(a, from, from + DAY)).length;
    return {
      label: range === '7d' ? d.toLocaleDateString('en-ZA', { weekday: 'short' }) : d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' }),
      value: v,
      full: d.toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long' }),
    };
  });
}

export function topDrinks(db: DB, days = 30, now = new Date()) {
  const from = now.getTime() - days * DAY;
  const counts = new Map<string, number>();
  for (const a of db.activity) {
    if (a.type !== 'stamp' || !a.drink || new Date(a.at).getTime() < from) continue;
    counts.set(a.drink, (counts.get(a.drink) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
}

export function closeToReward(customers: Customer[], max: number) {
  return customers
    .filter((c) => c.stamps >= max - 2)
    .sort((a, b) => b.stamps - a.stamps || (b.lastVisit ?? '').localeCompare(a.lastVisit ?? ''));
}

export function isLapsed(c: Customer, now = Date.now()) {
  return !c.lastVisit || now - new Date(c.lastVisit).getTime() > 21 * DAY;
}
