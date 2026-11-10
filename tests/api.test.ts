import { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { fromPglite, setDb } from '../server/db';
import { handle } from '../server/routes';
import { resetSchemaCache } from '../server/schema';

type Opts = { body?: unknown; token?: string; cookie?: string; ip?: string };

async function call(method: string, path: string, opts: Opts = {}) {
  const headers = new Headers({ 'x-forwarded-for': opts.ip ?? '10.0.0.1' });
  if (opts.body !== undefined) headers.set('content-type', 'application/json');
  if (opts.token) headers.set('authorization', `Bearer ${opts.token}`);
  if (opts.cookie) headers.set('cookie', opts.cookie);
  const res = await handle(
    new Request(`http://test${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }),
  );
  const text = await res.text();
  return { status: res.status, headers: res.headers, data: text ? JSON.parse(text) : null };
}

let n = 0;
async function join(extra: Record<string, unknown> = {}) {
  n++;
  const res = await call('POST', '/api/join', { body: { name: `Member ${n}`, phone: `+27 82 000 ${String(1000 + n)}`, ...extra }, ip: `10.1.0.${n}` });
  expect(res.status).toBe(201);
  return res.data as { token: string; customer: { id: string; code: string; stamps: number } };
}

async function staff() {
  const res = await call('POST', '/api/admin/login', { body: { pin: '1234' }, ip: '10.9.9.9' });
  expect(res.status).toBe(200);
  return res.headers.get('set-cookie')!.split(';')[0]!;
}

beforeEach(() => {
  setDb(fromPglite(new PGlite()));
  resetSchemaCache();
});

describe('customer cards', () => {
  it('creates a card bound to the phone that joined', async () => {
    const { token, customer } = await join();
    expect(customer.code).toMatch(/^BK-[A-Z2-9]{6}$/);
    const me = await call('GET', '/api/me', { token });
    expect(me.status).toBe(200);
    expect(me.data.customer.id).toBe(customer.id);
    expect(me.data.activity[0].type).toBe('join');
    expect(me.data.settings).toEqual({ storeName: 'Bloeisel Koffie', stampsRequired: 10, rewardName: 'Any coffee, on us' });
  });

  it('rejects missing or forged device tokens', async () => {
    await join();
    expect((await call('GET', '/api/me')).status).toBe(401);
    expect((await call('GET', '/api/me', { token: 'not-a-real-token' })).status).toBe(401);
  });

  it('will not let a phone number be used to take over an existing card', async () => {
    await call('POST', '/api/join', { body: { name: 'Thandi', phone: '+27 82 555 0101' } });
    const again = await call('POST', '/api/join', { body: { name: 'Someone else', phone: '082 555 0101' }, ip: '10.2.2.2' });
    expect(again.status).toBe(409);
    expect(again.data.error.code).toBe('phone_taken');
    expect(again.data.token).toBeUndefined();
  });

  it('validates sign-up input', async () => {
    const bad = await call('POST', '/api/join', { body: { name: 'A', phone: '123' } });
    expect(bad.status).toBe(400);
  });

  it('rejects a profile phone number that belongs to another member', async () => {
    const a = await join();
    await call('POST', '/api/join', { body: { name: 'Other', phone: '+27 71 444 0000' }, ip: '10.3.3.3' });
    const res = await call('PATCH', '/api/me', { token: a.token, body: { phone: '071 444 0000' } });
    expect(res.status).toBe(409);
  });

  it('moves a card to a new phone with a one-time link and signs the old phone out', async () => {
    const { token: oldPhone, customer } = await join();
    const link = await call('POST', '/api/me/transfer', { token: oldPhone });
    expect(link.status).toBe(201);
    const claimed = await call('POST', '/api/claim', { body: { token: link.data.token } });
    expect(claimed.status).toBe(200);
    expect(claimed.data.customer.id).toBe(customer.id);
    expect((await call('GET', '/api/me', { token: claimed.data.token })).status).toBe(200);
    expect((await call('GET', '/api/me', { token: oldPhone })).status).toBe(401);
    // The link only works once.
    expect((await call('POST', '/api/claim', { body: { token: link.data.token } })).status).toBe(410);
  });

  it('only the newest transfer link works', async () => {
    const { token } = await join();
    const first = await call('POST', '/api/me/transfer', { token });
    await call('POST', '/api/me/transfer', { token });
    expect((await call('POST', '/api/claim', { body: { token: first.data.token } })).status).toBe(410);
  });
});

describe('staff portal', () => {
  it('keeps staff endpoints behind the PIN', async () => {
    const { token, customer } = await join();
    expect((await call('GET', '/api/admin/snapshot')).status).toBe(401);
    // A customer's device token is not a staff credential.
    expect((await call('POST', `/api/admin/customers/${customer.id}/stamp`, { token, body: { idempotencyKey: 'k-00000001' } })).status).toBe(401);
    expect((await call('GET', '/api/admin/snapshot', { cookie: 'bk_staff=forged.value.sig' })).status).toBe(401);
  });

  it('locks out PIN guessing after five wrong tries', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await call('POST', '/api/admin/login', { body: { pin: '0000' }, ip: '10.5.5.5' })).status).toBe(401);
    }
    const locked = await call('POST', '/api/admin/login', { body: { pin: '1234' }, ip: '10.5.5.5' });
    expect(locked.status).toBe(429);
    // Another till on a different network is unaffected.
    expect((await call('POST', '/api/admin/login', { body: { pin: '1234' }, ip: '10.6.6.6' })).status).toBe(200);
  });

  it('stamps a card, ignores a retried tap, and stops at the reward', async () => {
    const cookie = await staff();
    const { token, customer } = await join();
    const stamp = (key: string) => call('POST', `/api/admin/customers/${customer.id}/stamp`, { cookie, body: { drink: 'Flat White', idempotencyKey: key } });

    const first = await stamp('tap-0000001');
    expect(first.data.customer.stamps).toBe(1);
    const retry = await stamp('tap-0000001');
    expect(retry.data.replayed).toBe(true);
    expect(retry.data.customer.stamps).toBe(1);

    for (let i = 2; i <= 10; i++) await stamp(`tap-${String(i).padStart(7, '0')}`);
    const me = await call('GET', '/api/me', { token });
    expect(me.data.customer.stamps).toBe(10);
    expect(me.data.customer.rewardsEarned).toBe(1);
    expect(me.data.customer.favourite).toBe('Flat White');

    const full = await stamp('tap-0000011');
    expect(full.status).toBe(409);
    expect(full.data.error.code).toBe('card_full');
  });

  it('handles two tills stamping the same card at once', async () => {
    const cookie = await staff();
    const { customer } = await join();
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) => call('POST', `/api/admin/customers/${customer.id}/stamp`, { cookie, body: { idempotencyKey: `race-${i}-0000` } })),
    );
    expect(results.every((r) => r.status === 200)).toBe(true);
    const snap = await call('GET', '/api/admin/snapshot', { cookie });
    expect(snap.data.customers.find((c: { id: string }) => c.id === customer.id).stamps).toBe(6);
  });

  it('redeems only a full card and carries extra stickers over', async () => {
    const cookie = await staff();
    const { customer } = await join();
    const early = await call('POST', `/api/admin/customers/${customer.id}/redeem`, { cookie, body: { idempotencyKey: 'redeem-early' } });
    expect(early.status).toBe(409);

    await call('POST', `/api/admin/customers/${customer.id}/adjust`, { cookie, body: { delta: 7 } });
    await call('PATCH', '/api/admin/settings', { cookie, body: { stampsRequired: 5 } });
    const redeemed = await call('POST', `/api/admin/customers/${customer.id}/redeem`, { cookie, body: { idempotencyKey: 'redeem-0001' } });
    expect(redeemed.status).toBe(200);
    expect(redeemed.data.customer.stamps).toBe(2);
    expect(redeemed.data.customer.rewardsRedeemed).toBe(1);
  });

  it('manual corrections never clamp a card above a lowered threshold', async () => {
    const cookie = await staff();
    const { customer } = await join();
    await call('POST', `/api/admin/customers/${customer.id}/adjust`, { cookie, body: { delta: 7 } });
    await call('PATCH', '/api/admin/settings', { cookie, body: { stampsRequired: 5 } });
    const res = await call('POST', `/api/admin/customers/${customer.id}/adjust`, { cookie, body: { delta: -1, note: 'fix' } });
    expect(res.data.customer.stamps).toBe(6);
    expect(res.data.customer.totalStamps).toBe(6);
  });

  it('looks members up by the code in their QR', async () => {
    const cookie = await staff();
    const { customer } = await join();
    const res = await call('POST', '/api/admin/lookup', { cookie, body: { code: `BLOEISEL:${customer.code}` } });
    expect(res.data.customer.id).toBe(customer.id);
    expect((await call('POST', '/api/admin/lookup', { cookie, body: { code: 'BK-ZZZZZZ' } })).status).toBe(404);
  });

  it('staff can move a card to a new phone at the till', async () => {
    const cookie = await staff();
    const { token: lostPhone, customer } = await join();
    const link = await call('POST', `/api/admin/customers/${customer.id}/transfer`, { cookie });
    const claimed = await call('POST', '/api/claim', { body: { token: link.data.token } });
    expect(claimed.data.customer.id).toBe(customer.id);
    expect((await call('GET', '/api/me', { token: lostPhone })).status).toBe(401);
  });

  it('changing the PIN signs out other tills but keeps this one in', async () => {
    const otherTill = await staff();
    const thisTill = await staff();
    const res = await call('PATCH', '/api/admin/settings', { cookie: thisTill, body: { pin: '482915' } });
    const renewed = res.headers.get('set-cookie')!.split(';')[0]!;
    expect((await call('GET', '/api/admin/snapshot', { cookie: renewed })).status).toBe(200);
    expect((await call('GET', '/api/admin/snapshot', { cookie: otherTill })).status).toBe(401);
    expect((await call('POST', '/api/admin/login', { body: { pin: '1234' }, ip: '10.7.7.7' })).status).toBe(401);
    expect((await call('POST', '/api/admin/login', { body: { pin: '482915' }, ip: '10.7.7.7' })).status).toBe(200);
  });
});

describe('printed QR codes', () => {
  it('counts scans and redirects; paused codes stop counting', async () => {
    const cookie = await staff();
    const created = await call('POST', '/api/admin/campaigns', { cookie, body: { name: 'Market stall', kind: 'join', placement: 'Gazebo' } });
    const id = created.data.campaign.id;
    const scan = await handle(new Request(`http://test/q/${id}`));
    expect(scan.status).toBe(302);
    expect(scan.headers.get('location')).toBe(`/app/join?src=${id}`);

    await call('PATCH', `/api/admin/campaigns/${id}`, { cookie, body: { active: false } });
    const paused = await handle(new Request(`http://test/q/${id}`));
    expect(paused.headers.get('location')).toBe('/');
    const snap = await call('GET', '/api/admin/snapshot', { cookie });
    expect(snap.data.campaigns[0].scans).toBe(1);

    expect((await handle(new Request('http://test/q/not-a-uuid'))).headers.get('location')).toBe('/');
  });

  it('rejects non-http links', async () => {
    const cookie = await staff();
    const res = await call('POST', '/api/admin/campaigns', { cookie, body: { name: 'Bad', kind: 'custom', targetUrl: 'javascript:alert(1)' } });
    expect(res.status).toBe(400);
  });
});

describe('counter QR (customer scans to collect a sticker)', () => {
  const counter = async (cookie: string) => (await call('GET', '/api/admin/snapshot', { cookie })).data.counter as { code: string; enabled: boolean; cooldownMinutes: number };
  const scan = (token: string, code: string, key = `scan-${Math.random()}`) =>
    call('POST', '/api/me/counter-stamp', { token, body: { code, idempotencyKey: key } });

  it('gives one sticker per visit, then makes the customer wait', async () => {
    const cookie = await staff();
    const { code, cooldownMinutes } = await counter(cookie);
    expect(cooldownMinutes).toBe(180);
    const { token } = await join();
    const first = await scan(token, code);
    expect(first.status).toBe(200);
    expect(first.data.customer.stamps).toBe(1);
    const again = await scan(token, code);
    expect(again.status).toBe(429);
    expect(again.data.error.code).toBe('too_soon');
    const me = await call('GET', '/api/me', { token });
    expect(me.data.customer.stamps).toBe(1);
    expect(me.data.activity[0].note).toBe('Counter QR');
  });

  it('rejects a wrong or replaced code', async () => {
    const cookie = await staff();
    const old = (await counter(cookie)).code;
    const { token } = await join();
    expect((await scan(token, 'not-the-real-code-123')).status).toBe(403);
    await call('PATCH', '/api/admin/counter', { cookie, body: { replaceCode: true } });
    const res = await scan(token, old);
    expect(res.status).toBe(403);
    expect(res.data.error.code).toBe('bad_code');
    expect((await scan(token, (await counter(cookie)).code)).status).toBe(200);
  });

  it('needs a card on the phone, and staff can switch it off', async () => {
    const cookie = await staff();
    const { code } = await counter(cookie);
    expect((await call('POST', '/api/me/counter-stamp', { body: { code, idempotencyKey: 'no-card-0001' } })).status).toBe(401);
    await call('PATCH', '/api/admin/counter', { cookie, body: { enabled: false } });
    const { token } = await join();
    expect((await scan(token, code)).data.error.code).toBe('self_scan_off');
  });

  it('with no time limit, still stops at a full card', async () => {
    const cookie = await staff();
    await call('PATCH', '/api/admin/counter', { cookie, body: { cooldownMinutes: 0 } });
    const { code } = await counter(cookie);
    const { token } = await join();
    for (let i = 0; i < 10; i++) expect((await scan(token, code)).status).toBe(200);
    const full = await scan(token, code);
    expect(full.status).toBe(409);
    expect(full.data.error.code).toBe('card_full');
  });

  it('customers cannot change the counter settings', async () => {
    const { token } = await join();
    expect((await call('PATCH', '/api/admin/counter', { token, body: { cooldownMinutes: 0 } })).status).toBe(401);
  });
});
