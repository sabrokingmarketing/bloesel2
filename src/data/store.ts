/**
 * Client data layer. Talks to the API (see /server) and keeps a small cache
 * that React reads through useSyncExternalStore.
 *
 * Sync across devices is by polling: the customer's phone polls /api/me every
 * few seconds while the QR is on screen, so a sticker added at the till shows
 * up almost immediately. Staff screens poll a snapshot.
 */
import { useEffect, useSyncExternalStore } from 'react';
import type { Activity, Campaign, CampaignKind, CounterSettings, Customer, DB, Settings } from './types';

/* ======================= HTTP ======================= */

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

const DEVICE_KEY = 'bloeisel.device.v1';

function readToken() {
  try {
    return localStorage.getItem(DEVICE_KEY);
  } catch {
    return null;
  }
}
function writeToken(token: string | null) {
  try {
    if (token) localStorage.setItem(DEVICE_KEY, token);
    else localStorage.removeItem(DEVICE_KEY);
  } catch {
    /* private mode: the card lasts for this tab only */
  }
}

async function api<T>(method: string, path: string, body?: unknown, opts: { device?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (opts.device) {
    const t = readToken();
    if (t) headers.authorization = `Bearer ${t}`;
  }
  let res: Response;
  try {
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'offline', "Can't reach Bloeisel right now. Check your connection.");
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // An HTML page instead of JSON means the request never reached the API (e.g. a routing problem).
    if (res.ok) throw new ApiError(502, 'bad_response', "Bloeisel's server sent an unexpected reply. Please try again shortly.");
  }
  if (!res.ok) {
    const e = (data as { error?: { code: string; message: string } })?.error;
    throw new ApiError(res.status, e?.code ?? 'error', e?.message ?? 'Something went wrong. Please try again.');
  }
  return data as T;
}

/** Retries a till action once on a dropped connection, with the same key so it can't double-stamp. */
async function withRetry<T>(fn: (key: string) => Promise<T>) {
  const key = crypto.randomUUID();
  try {
    return await fn(key);
  } catch (err) {
    if (err instanceof ApiError && err.status === 0) return fn(key);
    throw err;
  }
}

/* ======================= Store plumbing ======================= */

type MeData = { customer: Customer; activity: Activity[]; settings: Settings };
type MeState = { status: 'loading' | 'none' | 'ready'; data?: MeData; offline: boolean };
type AdminState = { auth: 'unknown' | 'out' | 'in'; db?: DB; offline: boolean };

let me: MeState = { status: readToken() ? 'loading' : 'none', offline: false };
let admin: AdminState = { auth: 'unknown', offline: false };

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
function setMe(next: Partial<MeState>) {
  me = { ...me, ...next };
  emit();
}
function setAdmin(next: Partial<AdminState>) {
  admin = { ...admin, ...next };
  emit();
}

/** Polls `refresh` every `ms` while mounted, and right away when the tab comes back into view. */
function usePolling(refresh: () => void, ms: number, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    refresh();
    const id = window.setInterval(() => document.visibilityState === 'visible' && refresh(), ms);
    const onVis = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onVis);
    window.addEventListener('online', onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onVis);
      window.removeEventListener('online', onVis);
    };
  }, [refresh, ms, enabled]);
}

/* ======================= Customer ======================= */

export function useMe() {
  return useSyncExternalStore(subscribe, () => me);
}

/** Convenience for screens that only need the signed-in card. */
export function useSessionCustomer() {
  return useMe().data?.customer;
}

let meInFlight: Promise<void> | null = null;
export function refreshMe() {
  if (!readToken()) {
    setMe({ status: 'none', data: undefined });
    return Promise.resolve();
  }
  if (meInFlight) return meInFlight;
  meInFlight = api<MeData>('GET', '/api/me', undefined, { device: true })
    .then((data) => setMe({ status: 'ready', data, offline: false }))
    .catch((err: ApiError) => {
      if (err.status === 401) {
        writeToken(null);
        setMe({ status: 'none', data: undefined, offline: false });
      } else {
        // Keep showing the last card we had; just flag that we're out of date.
        setMe({ offline: true, status: me.data ? 'ready' : 'loading' });
      }
    })
    .finally(() => (meInFlight = null));
  return meInFlight;
}

export function useMeSync(ms: number) {
  usePolling(refreshMe, ms);
}

export function qrPayload(c: Customer) {
  return `BLOEISEL:${c.code}`;
}

export async function joinProgramme(input: { name: string; phone: string; email?: string; marketingOptIn?: boolean }) {
  const res = await api<MeData & { token: string }>('POST', '/api/join', input);
  writeToken(res.token);
  setMe({ status: 'ready', data: { customer: res.customer, activity: res.activity, settings: res.settings }, offline: false });
  return res.customer;
}

export async function claimCard(token: string) {
  const res = await api<MeData & { token: string }>('POST', '/api/claim', { token });
  writeToken(res.token);
  setMe({ status: 'ready', data: { customer: res.customer, activity: res.activity, settings: res.settings }, offline: false });
  return res.customer;
}

export async function updateProfile(patch: { name?: string; phone?: string; email?: string }) {
  const data = await api<MeData>('PATCH', '/api/me', patch, { device: true });
  setMe({ status: 'ready', data });
}

export function requestTransfer() {
  return api<{ token: string; expiresAt: string }>('POST', '/api/me/transfer', undefined, { device: true });
}

export async function removeCardFromDevice() {
  await api('DELETE', '/api/me/device', undefined, { device: true }).catch(() => {});
  writeToken(null);
  setMe({ status: 'none', data: undefined });
}

/* ---------- Counter QR: the customer scans to collect a sticker ---------- */

const PENDING_KEY = 'bloeisel.pendingCounterCode';

/** Remembers a scanned counter code while a first-time customer signs up. */
export function setPendingCounterCode(code: string | null) {
  try {
    if (code) sessionStorage.setItem(PENDING_KEY, code);
    else sessionStorage.removeItem(PENDING_KEY);
  } catch {
    /* ignore */
  }
}
export function getPendingCounterCode() {
  try {
    return sessionStorage.getItem(PENDING_KEY);
  } catch {
    return null;
  }
}

export async function counterStamp(code: string, idempotencyKey: string) {
  const res = await api<{ customer: Customer; completed: boolean }>('POST', '/api/me/counter-stamp', { code, idempotencyKey }, { device: true });
  if (me.data) setMe({ data: { ...me.data, customer: res.customer } });
  void refreshMe();
  return res;
}

/** What the printed counter QR encodes. The code rides in the fragment, so it never lands in server logs. */
export function counterQrUrl(code: string) {
  return `${window.location.origin}/app/stamp#c=${code}`;
}

export function claimUrl(token: string) {
  // The token travels in the fragment, so it never reaches server logs or referrers.
  return `${window.location.origin}/app/claim#${token}`;
}

/* ======================= Staff ======================= */

export function useAdmin() {
  return useSyncExternalStore(subscribe, () => admin);
}

/** For screens inside the staff portal, which only render once the snapshot has loaded. */
export function useAdminDB(): DB {
  const db = useAdmin().db;
  if (!db) throw new Error('useAdminDB used before the staff snapshot loaded');
  return db;
}

export async function checkAdminSession() {
  try {
    const { authed } = await api<{ authed: boolean }>('GET', '/api/admin/session');
    if (!authed) return setAdmin({ auth: 'out', db: undefined });
    await refreshSnapshot();
    setAdmin({ auth: 'in' });
  } catch {
    setAdmin({ auth: 'out', offline: true });
  }
}

let snapInFlight: Promise<void> | null = null;
export function refreshSnapshot() {
  if (snapInFlight) return snapInFlight;
  snapInFlight = api<DB>('GET', '/api/admin/snapshot')
    .then((db) => setAdmin({ db, offline: false }))
    .catch((err: ApiError) => {
      if (err.status === 401) setAdmin({ auth: 'out', db: undefined });
      else setAdmin({ offline: true });
    })
    .finally(() => (snapInFlight = null));
  return snapInFlight;
}

export function useAdminSync(ms = 10_000) {
  usePolling(refreshSnapshot, ms, useAdmin().auth === 'in');
}

export async function adminSignIn(pin: string) {
  await api('POST', '/api/admin/login', { pin });
  await refreshSnapshot();
  setAdmin({ auth: 'in' });
}

export async function adminSignOut() {
  await api('POST', '/api/admin/logout').catch(() => {});
  setAdmin({ auth: 'out', db: undefined });
}

/** Puts a fresh customer row into the cached snapshot straight away, then refreshes the rest. */
function upsertCustomer(c: Customer) {
  if (admin.db) {
    const exists = admin.db.customers.some((x) => x.id === c.id);
    const customers = exists ? admin.db.customers.map((x) => (x.id === c.id ? c : x)) : [c, ...admin.db.customers];
    setAdmin({ db: { ...admin.db, customers } });
  }
  void refreshSnapshot();
  return c;
}

export async function lookupMember(raw: string) {
  const { customer } = await api<{ customer: Customer }>('POST', '/api/admin/lookup', { code: raw });
  return upsertCustomer(customer);
}

export async function addStamp(customerId: string, drink?: string) {
  const res = await withRetry((key) =>
    api<{ customer: Customer; completed: boolean }>('POST', `/api/admin/customers/${customerId}/stamp`, { drink, idempotencyKey: key }),
  );
  upsertCustomer(res.customer);
  return res;
}

export async function redeemReward(customerId: string) {
  const res = await withRetry((key) => api<{ customer: Customer }>('POST', `/api/admin/customers/${customerId}/redeem`, { idempotencyKey: key }));
  return upsertCustomer(res.customer);
}

export async function adjustStamps(customerId: string, delta: number, note?: string) {
  const res = await api<{ customer: Customer }>('POST', `/api/admin/customers/${customerId}/adjust`, { delta, note });
  return upsertCustomer(res.customer);
}

export function staffTransfer(customerId: string) {
  return api<{ token: string; expiresAt: string }>('POST', `/api/admin/customers/${customerId}/transfer`);
}

export async function deleteCustomer(customerId: string) {
  await api('DELETE', `/api/admin/customers/${customerId}`);
  if (admin.db) setAdmin({ db: { ...admin.db, customers: admin.db.customers.filter((c) => c.id !== customerId) } });
  void refreshSnapshot();
}

function upsertCampaign(c: Campaign) {
  if (admin.db) {
    const exists = admin.db.campaigns.some((x) => x.id === c.id);
    const campaigns = exists ? admin.db.campaigns.map((x) => (x.id === c.id ? c : x)) : [c, ...admin.db.campaigns];
    setAdmin({ db: { ...admin.db, campaigns } });
  }
  return c;
}

export async function createCampaign(input: { name: string; kind: CampaignKind; placement: string; targetUrl?: string }) {
  const { campaign } = await api<{ campaign: Campaign }>('POST', '/api/admin/campaigns', input);
  return upsertCampaign(campaign);
}

export async function updateCampaign(id: string, patch: Partial<Pick<Campaign, 'name' | 'placement' | 'active'>>) {
  const { campaign } = await api<{ campaign: Campaign }>('PATCH', `/api/admin/campaigns/${id}`, patch);
  return upsertCampaign(campaign);
}

export async function deleteCampaign(id: string) {
  await api('DELETE', `/api/admin/campaigns/${id}`);
  if (admin.db) setAdmin({ db: { ...admin.db, campaigns: admin.db.campaigns.filter((c) => c.id !== id) } });
}

export async function updateCounter(patch: Partial<Pick<CounterSettings, 'enabled' | 'cooldownMinutes'>> & { replaceCode?: boolean }) {
  const { counter } = await api<{ counter: CounterSettings }>('PATCH', '/api/admin/counter', patch);
  if (admin.db) setAdmin({ db: { ...admin.db, counter } });
  return counter;
}

/** The address printed on a campaign's QR code. Scans are counted server-side before redirecting. */
export function campaignQrUrl(c: Campaign) {
  return `${window.location.origin}/q/${c.id}`;
}

export async function updateSettings(patch: Partial<Settings> & { pin?: string }) {
  const { settings } = await api<{ settings: Settings }>('PATCH', '/api/admin/settings', patch);
  if (admin.db) setAdmin({ db: { ...admin.db, settings } });
  return settings;
}
