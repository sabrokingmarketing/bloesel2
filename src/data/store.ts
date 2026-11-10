/**
 * Local-first data store.
 *
 * Everything persists in localStorage and syncs live between tabs via the
 * `storage` event, so a barista stamping a card in the admin tab updates the
 * customer's phone tab instantly in the demo. All writes go through the
 * functions below, which is the seam to swap for a real API later.
 */
import { useSyncExternalStore } from 'react';
import { createSeed, DEMO_CUSTOMER_ID, makeCode, uid } from './seed';
import type { Activity, Campaign, Customer, DB, Settings } from './types';

const DB_KEY = 'bloeisel.db.v1';
const SESSION_KEY = 'bloeisel.session.v1';
const ADMIN_KEY = 'bloeisel.admin.v1';

type Listener = () => void;
const listeners = new Set<Listener>();

function load(): DB {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DB;
      if (parsed.version === 1 && Array.isArray(parsed.customers)) return parsed;
    }
  } catch {
    /* fall through to a fresh seed */
  }
  const seeded = createSeed();
  persist(seeded);
  return seeded;
}

function persist(db: DB) {
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
  } catch {
    /* storage may be unavailable (private mode); state stays in memory */
  }
}

let state: DB = load();

function emit() {
  listeners.forEach((l) => l());
}

function commit(next: DB) {
  state = next;
  persist(next);
  emit();
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === DB_KEY) {
      state = load();
      emit();
    }
    if (e.key === SESSION_KEY || e.key === ADMIN_KEY) emit();
  });
}

export function subscribe(l: Listener) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function getDB() {
  return state;
}

export function useDB() {
  return useSyncExternalStore(subscribe, getDB, getDB);
}

/* ---------------- Session (customer) ---------------- */

function readKey(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeKey(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
  emit();
}

export function useSessionCustomer(): Customer | undefined {
  const db = useDB();
  const id = useSyncExternalStore(subscribe, () => readKey(SESSION_KEY), () => null);
  return id ? db.customers.find((c) => c.id === id) : undefined;
}

export function signIn(customerId: string) {
  writeKey(SESSION_KEY, customerId);
}
export function signOut() {
  writeKey(SESSION_KEY, null);
}
export function signInDemo() {
  signIn(DEMO_CUSTOMER_ID);
}

/* ---------------- Admin session ---------------- */

export function useAdminAuthed() {
  return useSyncExternalStore(subscribe, () => readKey(ADMIN_KEY) === '1', () => false);
}
export function adminSignIn(pin: string) {
  if (pin === state.settings.adminPin) {
    writeKey(ADMIN_KEY, '1');
    return true;
  }
  return false;
}
export function adminSignOut() {
  writeKey(ADMIN_KEY, null);
}

/* ---------------- Customers ---------------- */

export function findByCode(raw: string): Customer | undefined {
  const text = raw.trim().toUpperCase();
  // Accept the QR payload ("BLOEISEL:BK-XXXXXX"), a bare code, or a code without the prefix.
  const match = text.match(/BK-?([A-Z0-9]{6})/) ?? text.match(/^([A-Z0-9]{6})$/);
  if (!match) return undefined;
  const code = `BK-${match[1]}`;
  return state.customers.find((c) => c.code === code);
}

export function qrPayload(c: Customer) {
  return `BLOEISEL:${c.code}`;
}

export function createCustomer(input: { name: string; phone: string; email?: string }): Customer {
  const now = new Date().toISOString();
  let code = makeCode();
  while (state.customers.some((c) => c.code === code)) code = makeCode();
  const c: Customer = {
    id: uid('cus_'),
    code,
    name: input.name.trim(),
    phone: input.phone.trim(),
    email: input.email?.trim() || undefined,
    stamps: 0,
    totalStamps: 0,
    rewardsEarned: 0,
    rewardsRedeemed: 0,
    joinedAt: now,
  };
  const act: Activity = { id: uid('act_'), customerId: c.id, type: 'join', at: now };
  commit({ ...state, customers: [c, ...state.customers], activity: [act, ...state.activity] });
  return c;
}

export function findByPhone(phone: string) {
  const digits = phone.replace(/\D/g, '').slice(-9);
  if (digits.length < 9) return undefined;
  return state.customers.find((c) => c.phone.replace(/\D/g, '').endsWith(digits));
}

function updateCustomer(id: string, fn: (c: Customer) => Customer, act?: Omit<Activity, 'id' | 'at' | 'customerId'>) {
  const now = new Date().toISOString();
  const customers = state.customers.map((c) => (c.id === id ? fn(c) : c));
  const activity = act ? [{ id: uid('act_'), customerId: id, at: now, ...act }, ...state.activity] : state.activity;
  commit({ ...state, customers, activity });
  return customers.find((c) => c.id === id);
}

export type StampResult =
  | { ok: true; customer: Customer; completed: boolean }
  | { ok: false; reason: 'full' | 'missing' };

export function addStamp(customerId: string, drink?: string): StampResult {
  const c = state.customers.find((x) => x.id === customerId);
  if (!c) return { ok: false, reason: 'missing' };
  const max = state.settings.stampsRequired;
  if (c.stamps >= max) return { ok: false, reason: 'full' };
  const now = new Date().toISOString();
  const next = updateCustomer(
    customerId,
    (x) => {
      const stamps = x.stamps + 1;
      return {
        ...x,
        stamps,
        totalStamps: x.totalStamps + 1,
        rewardsEarned: x.rewardsEarned + (stamps === max ? 1 : 0),
        favourite: drink ?? x.favourite,
        lastVisit: now,
      };
    },
    { type: 'stamp', drink },
  )!;
  return { ok: true, customer: next, completed: next.stamps === max };
}

export function redeemReward(customerId: string) {
  const c = state.customers.find((x) => x.id === customerId);
  if (!c || c.stamps < state.settings.stampsRequired) return false;
  updateCustomer(
    customerId,
    (x) => ({ ...x, stamps: 0, rewardsRedeemed: x.rewardsRedeemed + 1, lastVisit: new Date().toISOString() }),
    { type: 'redeem', drink: state.settings.rewardName },
  );
  return true;
}

export function adjustStamps(customerId: string, delta: number, note?: string) {
  const max = state.settings.stampsRequired;
  updateCustomer(
    customerId,
    (x) => {
      const stamps = Math.max(0, Math.min(max, x.stamps + delta));
      const applied = stamps - x.stamps;
      return {
        ...x,
        stamps,
        totalStamps: Math.max(0, x.totalStamps + applied),
        rewardsEarned: x.rewardsEarned + (stamps === max && x.stamps < max ? 1 : 0),
      };
    },
    { type: 'adjust', delta, note },
  );
}

export function updateProfile(customerId: string, patch: Partial<Pick<Customer, 'name' | 'phone' | 'email'>>) {
  updateCustomer(customerId, (x) => ({ ...x, ...patch }));
}

export function deleteCustomer(customerId: string) {
  commit({
    ...state,
    customers: state.customers.filter((c) => c.id !== customerId),
    activity: state.activity.filter((a) => a.customerId !== customerId),
  });
}

/* ---------------- Campaign QR codes ---------------- */

export function createCampaign(input: Omit<Campaign, 'id' | 'scans' | 'createdAt' | 'active'>) {
  const c: Campaign = { ...input, id: uid('qr_'), scans: 0, active: true, createdAt: new Date().toISOString() };
  commit({ ...state, campaigns: [c, ...state.campaigns] });
  return c;
}
export function updateCampaign(id: string, patch: Partial<Campaign>) {
  commit({ ...state, campaigns: state.campaigns.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
}
export function deleteCampaign(id: string) {
  commit({ ...state, campaigns: state.campaigns.filter((c) => c.id !== id) });
}
export function recordCampaignScan(src: string | null) {
  if (!src) return;
  const match = state.campaigns.find((c) => c.active && c.url.includes(`src=${src}`));
  if (match) updateCampaign(match.id, { scans: match.scans + 1 });
}

/* ---------------- Settings ---------------- */

export function updateSettings(patch: Partial<Settings>) {
  commit({ ...state, settings: { ...state.settings, ...patch } });
}

export function resetDemoData() {
  commit(createSeed());
}
