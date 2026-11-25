import { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { fromPglite, setDb } from '../server/db';
import { outbox } from '../server/email';
import { handle } from '../server/routes';
import { resetSchemaCache } from '../server/schema';

/** `token` is the phone's card session (sent as the bk_card cookie); `bearer` is the pre-cookie legacy header. */
type Opts = { body?: unknown; token?: string; bearer?: string; cookie?: string; ip?: string };

async function call(method: string, path: string, opts: Opts = {}) {
  const headers = new Headers({ 'x-forwarded-for': opts.ip ?? '10.0.0.1' });
  if (opts.body !== undefined) headers.set('content-type', 'application/json');
  if (opts.bearer) headers.set('authorization', `Bearer ${opts.bearer}`);
  const cookies = [opts.cookie, opts.token ? `bk_card=${opts.token}` : ''].filter(Boolean).join('; ');
  if (cookies) headers.set('cookie', cookies);
  const res = await handle(
    new Request(`http://test${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }),
  );
  const text = await res.text();
  const json = (res.headers.get('content-type') ?? '').includes('json');
  return { status: res.status, headers: res.headers, text, data: text && json ? JSON.parse(text) : null };
}

/** The card session a response signed this phone in to (from its Set-Cookie), or undefined. */
function cardCookie(res: { headers: Headers }) {
  for (const c of res.headers.getSetCookie()) {
    const m = c.match(/^bk_card=([^;]*)/);
    if (m) return { value: decodeURIComponent(m[1]!), raw: c };
  }
  return undefined;
}

const PIN = '2580';
let n = 0;
async function join(extra: Record<string, unknown> = {}) {
  n++;
  const phone = `+27 82 000 ${String(1000 + n)}`;
  const res = await call('POST', '/api/join', { body: { name: `Member ${n}`, phone, pin: PIN, ...extra }, ip: `10.1.0.${n}` });
  expect(res.status).toBe(201);
  const token = cardCookie(res)!.value;
  return { token, phone, ...(res.data as { customer: { id: string; code: string; stamps: number; email?: string } }) };
}

async function staff() {
  const res = await call('POST', '/api/admin/login', { body: { pin: '1234' }, ip: '10.9.9.9' });
  expect(res.status).toBe(200);
  return res.headers.get('set-cookie')!.split(';')[0]!;
}

let pg: PGlite;
beforeEach(() => {
  pg = new PGlite();
  setDb(fromPglite(pg));
  resetSchemaCache();
  outbox.length = 0;
});

describe('customer cards', () => {
  it('creates a card bound to the phone that joined', async () => {
    const { token, customer } = await join();
    expect(customer.code).toMatch(/^BK-[A-Z2-9]{6}$/);
    const me = await call('GET', '/api/me', { token });
    expect(me.status).toBe(200);
    expect(me.data.customer.id).toBe(customer.id);
    expect(me.data.activity[0].type).toBe('join');
    expect(me.data.settings).toEqual({ storeName: 'Bloeisel Koffie', stampsRequired: 10, rewardName: 'A free coffee on us' });
  });

  it('rejects missing or forged device tokens', async () => {
    await join();
    // No session at all is a normal state: a quiet "not signed in", not an error.
    const none = await call('GET', '/api/me');
    expect(none.status).toBe(200);
    expect(none.data).toEqual({ signedIn: false });
    expect((await call('GET', '/api/me', { token: 'not-a-real-token' })).status).toBe(401);
  });

  it('will not let a phone number be used to take over an existing card', async () => {
    await call('POST', '/api/join', { body: { name: 'Thandi', phone: '+27 82 555 0101', pin: PIN } });
    const again = await call('POST', '/api/join', { body: { name: 'Someone else', phone: '082 555 0101', pin: '9137' }, ip: '10.2.2.2' });
    expect(again.status).toBe(409);
    expect(again.data.error.code).toBe('phone_taken');
    expect(cardCookie(again)).toBeUndefined();
  });

  it('validates sign-up input', async () => {
    const bad = await call('POST', '/api/join', { body: { name: 'A', phone: '123' } });
    expect(bad.status).toBe(400);
  });

  it('rejects a profile phone number that belongs to another member', async () => {
    const a = await join();
    await call('POST', '/api/join', { body: { name: 'Other', phone: '+27 71 444 0000', pin: PIN }, ip: '10.3.3.3' });
    const res = await call('PATCH', '/api/me', { token: a.token, body: { phone: '071 444 0000', currentPin: PIN } });
    expect(res.status).toBe(409);
  });

  it('moves a card to a new phone with a one-time link and signs the old phone out', async () => {
    const { token: oldPhone, customer } = await join();
    const link = await call('POST', '/api/me/transfer', { token: oldPhone });
    expect(link.status).toBe(201);
    const claimed = await call('POST', '/api/claim', { body: { token: link.data.token } });
    expect(claimed.status).toBe(200);
    expect(claimed.data.customer.id).toBe(customer.id);
    expect((await call('GET', '/api/me', { token: cardCookie(claimed)!.value })).status).toBe(200);
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

describe('member redeems their own free coffee', () => {
  it('only with a full card; the card resets and the history stays', async () => {
    const cookie = await staff();
    const { token, customer } = await join();
    const early = await call('POST', '/api/me/redeem', { token, body: { idempotencyKey: 'self-redeem-early' } });
    expect(early.status).toBe(409);
    expect((await call('POST', '/api/me/redeem', { body: { idempotencyKey: 'self-redeem-nocard' } })).status).toBe(401);
    for (let i = 0; i < 10; i++) await call('POST', `/api/admin/customers/${customer.id}/stamp`, { cookie, body: { idempotencyKey: `fill-${i}-0000` } });
    const res = await call('POST', '/api/me/redeem', { token, body: { idempotencyKey: 'self-redeem-0001' } });
    expect(res.status).toBe(200);
    expect(res.data.customer.stamps).toBe(0);
    expect(res.data.customer.rewardsRedeemed).toBe(1);
    // A retry of the same tap does not redeem twice.
    expect((await call('POST', '/api/me/redeem', { token, body: { idempotencyKey: 'self-redeem-0001' } })).data.customer.rewardsRedeemed).toBe(1);
    const me = await call('GET', '/api/me', { token });
    expect(me.data.activity[0]).toMatchObject({ type: 'redeem', note: 'Redeemed by member', drink: 'A free coffee on us' });
    expect(me.data.activity.filter((a: { type: string }) => a.type === 'stamp')).toHaveLength(10);
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

  it('with no time limit, every scan adds a sticker', async () => {
    const cookie = await staff();
    const { code } = await counter(cookie);
    await call('PATCH', '/api/admin/counter', { cookie, body: { cooldownMinutes: 0 } });
    expect((await counter(cookie)).cooldownMinutes).toBe(0);
    const { token } = await join();
    expect((await scan(token, code)).status).toBe(200);
    const again = await scan(token, code);
    expect(again.status).toBe(200);
    expect(again.data.customer.stamps).toBe(2);
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
    await pg.query('UPDATE settings SET self_scan_cooldown_minutes = 0');
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

describe('PIN sign-in and the 120-day session', () => {
  it('needs a 4-digit PIN that is not trivially guessable to create a card', async () => {
    const body = (pin?: string) => ({ name: 'Pin Test', phone: '+27 83 111 2233', ...(pin === undefined ? {} : { pin }) });
    expect((await call('POST', '/api/join', { body: body() })).status).toBe(400);
    for (const weak of ['1111', '1234', '9876', '0000', '12a4', '123']) {
      expect((await call('POST', '/api/join', { body: body(weak) })).status).toBe(400);
    }
    expect((await call('POST', '/api/join', { body: body('2580') })).status).toBe(201);
  });

  it('keeps the phone signed in for 120 days with a secure cookie, and never returns the token in the body', async () => {
    const res = await call('POST', '/api/join', { body: { name: 'Cookie Test', phone: '+27 83 222 3344', pin: PIN } });
    const c = cardCookie(res)!;
    expect(c.raw).toContain('HttpOnly');
    expect(c.raw).toContain('SameSite=Lax');
    expect(c.raw).toContain(`Max-Age=${120 * 86400}`);
    expect(JSON.stringify(res.data)).not.toContain(c.value);
  });

  it('signs in on a new phone with mobile number + PIN; the first phone stays signed in', async () => {
    const first = await join();
    const res = await call('POST', '/api/signin', { body: { phone: first.phone.replace('+27 ', '0'), pin: PIN }, ip: '10.4.4.4' });
    expect(res.status).toBe(200);
    expect(res.data.customer.id).toBe(first.customer.id);
    expect((await call('GET', '/api/me', { token: cardCookie(res)!.value })).status).toBe(200);
    expect((await call('GET', '/api/me', { token: first.token })).status).toBe(200);
  });

  it('gives the same answer for a wrong number and a wrong PIN', async () => {
    const a = await join();
    const wrongPin = await call('POST', '/api/signin', { body: { phone: a.phone, pin: '9137' } });
    const wrongNumber = await call('POST', '/api/signin', { body: { phone: '+27 83 999 0000', pin: PIN } });
    expect(wrongPin.status).toBe(401);
    expect(wrongNumber.status).toBe(401);
    expect(wrongPin.data).toEqual(wrongNumber.data);
  });

  it('locks a number on a network after 5 wrong PINs, without locking it elsewhere or affecting other numbers', async () => {
    const a = await join();
    const b = await join();
    for (let i = 0; i < 5; i++) expect((await call('POST', '/api/signin', { body: { phone: a.phone, pin: '9137' }, ip: '10.8.0.1' })).status).toBe(401);
    // Even the right PIN is refused from that network while it's locked...
    expect((await call('POST', '/api/signin', { body: { phone: a.phone, pin: PIN }, ip: '10.8.0.1' })).status).toBe(429);
    // ...but a stranger's wrong guesses don't lock the real member out on their own network,
    expect((await call('POST', '/api/signin', { body: { phone: a.phone, pin: PIN }, ip: '10.8.1.1' })).status).toBe(200);
    // and other numbers are unaffected.
    expect((await call('POST', '/api/signin', { body: { phone: b.phone, pin: PIN }, ip: '10.8.0.1' })).status).toBe(200);
  });

  it('caps a number at 20 tries a day across all networks', async () => {
    const a = await join();
    for (let i = 0; i < 20; i++) expect((await call('POST', '/api/signin', { body: { phone: a.phone, pin: '9137' }, ip: `10.9.${i}.1` })).status).toBe(401);
    const capped = await call('POST', '/api/signin', { body: { phone: a.phone, pin: PIN }, ip: '10.9.99.1' });
    expect(capped.status).toBe(429);
    expect(capped.data.error.message).toContain('today');
  });

  it('parallel PIN guesses cannot get past the limit', async () => {
    const a = await join();
    const guesses = Array.from({ length: 30 }, (_, i) => String(1000 + i * 7).padStart(4, '0')).filter((g) => g !== PIN);
    const results = await Promise.all([...guesses, PIN].map((pin) => call('POST', '/api/signin', { body: { phone: a.phone, pin }, ip: '10.10.0.1' })));
    const checked = results.filter((r) => r.status !== 429);
    expect(checked.length).toBeLessThanOrEqual(5);
  });

  it('signs a phone out after 120 days without a visit', async () => {
    const a = await join();
    await pg.query(`UPDATE device_tokens SET last_seen_at = now() - interval '121 days'`);
    const res = await call('GET', '/api/me', { token: a.token });
    expect(res.status).toBe(401);
    expect(res.headers.getSetCookie().join()).toContain('bk_card=;');
  });

  it('moves phones from before the cookie (Bearer header) onto the cookie', async () => {
    const a = await join();
    const res = await call('GET', '/api/me', { bearer: a.token });
    expect(res.status).toBe(200);
    expect(cardCookie(res)!.value).toBe(a.token);
  });

  it('lets a member without a PIN set one, then sign in with it', async () => {
    const a = await join();
    await pg.query('UPDATE customers SET pin_hash = NULL');
    expect((await call('GET', '/api/me', { token: a.token })).data.customer.hasPin).toBe(false);
    expect((await call('POST', '/api/signin', { body: { phone: a.phone, pin: PIN } })).status).toBe(401);
    expect((await call('PUT', '/api/me/pin', { token: a.token, body: { pin: '7193' } })).status).toBe(200);
    expect((await call('POST', '/api/signin', { body: { phone: a.phone, pin: '7193' } })).status).toBe(200);
  });

  it('removing the card from a phone clears its cookie', async () => {
    const a = await join();
    const res = await call('DELETE', '/api/me/device', { token: a.token });
    expect(res.headers.getSetCookie().join()).toContain('bk_card=;');
    expect((await call('GET', '/api/me', { token: a.token })).status).toBe(401);
  });
});

describe('forgot PIN: recovery by email', () => {
  const resetToken = () => outbox.at(-1)!.text.match(/\/app\/reset#([A-Za-z0-9_-]+)/)![1]!;

  it('emails a reset link, with the same reply whether or not the email is on a card', async () => {
    await join({ email: 'lerato@example.com' });
    const known = await call('POST', '/api/pin/forgot', { body: { email: 'Lerato@Example.com' } });
    const unknown = await call('POST', '/api/pin/forgot', { body: { email: 'nobody@example.com' } });
    expect(known.status).toBe(200);
    expect(unknown.data).toEqual(known.data);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.to).toBe('lerato@example.com');
    expect(outbox[0]!.html).toContain('/app/reset#');
  });

  it('a reset link sets a new PIN, signs in this phone, signs out every other phone, and works once', async () => {
    const a = await join({ email: 'mia@example.com' });
    await call('POST', '/api/pin/forgot', { body: { email: 'mia@example.com' } });
    const token = resetToken();
    const res = await call('POST', '/api/pin/reset', { body: { token, pin: '6402' } });
    expect(res.status).toBe(200);
    expect(res.data.customer.id).toBe(a.customer.id);
    expect((await call('GET', '/api/me', { token: cardCookie(res)!.value })).status).toBe(200);
    expect((await call('GET', '/api/me', { token: a.token })).status).toBe(401);
    expect((await call('POST', '/api/signin', { body: { phone: a.phone, pin: '6402' } })).status).toBe(200);
    expect((await call('POST', '/api/pin/reset', { body: { token, pin: '7319' } })).status).toBe(410);
  });

  it('reset links expire after 30 minutes', async () => {
    await join({ email: 'old@example.com' });
    await call('POST', '/api/pin/forgot', { body: { email: 'old@example.com' } });
    await pg.query(`UPDATE pin_resets SET expires_at = now() - interval '1 minute'`);
    expect((await call('POST', '/api/pin/reset', { body: { token: resetToken(), pin: '6402' } })).status).toBe(410);
  });

  it('a reset also lifts a wrong-PIN lockout', async () => {
    const a = await join({ email: 'locked@example.com' });
    for (let i = 0; i < 5; i++) await call('POST', '/api/signin', { body: { phone: a.phone, pin: '9137' } });
    await call('POST', '/api/pin/forgot', { body: { email: 'locked@example.com' } });
    await call('POST', '/api/pin/reset', { body: { token: resetToken(), pin: '6402' } });
    expect((await call('POST', '/api/signin', { body: { phone: a.phone, pin: '6402' } })).status).toBe(200);
  });

  it('caps reset emails per address without changing the reply', async () => {
    await join({ email: 'spam@example.com' });
    const replies = [];
    for (let i = 0; i < 5; i++) replies.push((await call('POST', '/api/pin/forgot', { body: { email: 'spam@example.com' }, ip: `10.6.0.${i}` })).data);
    expect(outbox).toHaveLength(3);
    expect(new Set(replies.map((r) => JSON.stringify(r))).size).toBe(1);
  });

  it('builds the link from APP_URL, never from the request Host header', async () => {
    await join({ email: 'host@example.com' });
    process.env.APP_URL = 'https://bloesel2.vercel.app';
    try {
      const headers = new Headers({ 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.9' });
      await handle(new Request('http://evil.example/api/pin/forgot', { method: 'POST', headers, body: JSON.stringify({ email: 'host@example.com' }) }));
    } finally {
      delete process.env.APP_URL;
    }
    expect(outbox[0]!.text).toContain('https://bloesel2.vercel.app/app/reset#');
    expect(outbox[0]!.text).not.toContain('evil.example');
  });
});

describe('personal data', () => {
  it('staff never receive full email addresses, and no response carries a PIN or token hash', async () => {
    const cookie = await staff();
    const a = await join({ email: 'private.person@example.com' });
    const snapshot = await call('GET', '/api/admin/snapshot', { cookie });
    const lookup = await call('POST', '/api/admin/lookup', { cookie, body: { code: a.customer.code } });
    for (const res of [snapshot, lookup]) {
      const text = JSON.stringify(res.data);
      expect(text).not.toContain('private.person@example.com');
      expect(text).not.toMatch(/scrypt\$|pin_hash|token_hash/);
    }
    expect(lookup.data.customer.email).toBe('p••••••••@example.com');
    // The member sees their own address in full, but still no hashes.
    const me = await call('GET', '/api/me', { token: a.token });
    expect(me.data.customer.email).toBe('private.person@example.com');
    expect(JSON.stringify(me.data)).not.toMatch(/scrypt\$|pin_hash|token_hash/);
  });
});

describe('deployment config', () => {
  it('vercel.json sends exactly the security headers the app defines', async () => {
    const { SECURITY_HEADERS } = await import('../server/headers');
    const fs = await import('node:fs');
    const v = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
    const sent = Object.fromEntries(v.headers[0].headers.map((h: { key: string; value: string }) => [h.key, h.value]));
    expect(v.headers[0].source).toBe('/(.*)');
    expect(sent).toEqual(SECURITY_HEADERS);
  });
});

describe('protecting a card once someone is signed in', () => {
  it('changing the PIN needs the current PIN and signs out every other phone', async () => {
    const a = await join();
    const other = await call('POST', '/api/signin', { body: { phone: a.phone, pin: PIN }, ip: '10.11.0.1' });
    const otherToken = cardCookie(other)!.value;
    expect((await call('PUT', '/api/me/pin', { token: a.token, body: { pin: '7193' } })).status).toBe(401);
    expect((await call('PUT', '/api/me/pin', { token: a.token, body: { pin: '7193', currentPin: '9999' } })).status).toBe(401);
    expect((await call('PUT', '/api/me/pin', { token: a.token, body: { pin: '7193', currentPin: PIN } })).status).toBe(200);
    expect((await call('GET', '/api/me', { token: a.token })).status).toBe(200);
    expect((await call('GET', '/api/me', { token: otherToken })).status).toBe(401);
  });

  it('changing the email or phone needs the current PIN, and the old address is told', async () => {
    const a = await join({ email: 'owner@example.com' });
    expect((await call('PATCH', '/api/me', { token: a.token, body: { email: 'thief@example.com' } })).status).toBe(401);
    expect((await call('PATCH', '/api/me', { token: a.token, body: { phone: '+27 83 777 1212' } })).status).toBe(401);
    const ok = await call('PATCH', '/api/me', { token: a.token, body: { email: 'new@example.com', currentPin: PIN } });
    expect(ok.data.customer.email).toBe('new@example.com');
    expect(outbox.map((m) => m.to)).toEqual(['owner@example.com']);
    expect(outbox[0]!.subject).toContain('changed');
  });

  it('updating just the name keeps the email', async () => {
    const a = await join({ email: 'keep@example.com' });
    const res = await call('PATCH', '/api/me', { token: a.token, body: { name: 'New Name' } });
    expect(res.data.customer.name).toBe('New Name');
    expect(res.data.customer.email).toBe('keep@example.com');
  });

  it('a member can sign out every other phone', async () => {
    const a = await join();
    const other = cardCookie(await call('POST', '/api/signin', { body: { phone: a.phone, pin: PIN }, ip: '10.12.0.1' }))!.value;
    const res = await call('POST', '/api/me/signout-others', { token: a.token });
    expect(res.data.signedOut).toBe(1);
    expect((await call('GET', '/api/me', { token: other })).status).toBe(401);
    expect((await call('GET', '/api/me', { token: a.token })).status).toBe(200);
  });

  it('a member can delete their card and data with their PIN', async () => {
    const cookie = await staff();
    const a = await join();
    expect((await call('DELETE', '/api/me', { token: a.token, body: {} })).status).toBe(401);
    const res = await call('DELETE', '/api/me', { token: a.token, body: { currentPin: PIN } });
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie().join()).toContain('bk_card=;');
    expect((await call('POST', '/api/admin/lookup', { cookie, body: { code: a.customer.code } })).status).toBe(404);
  });
});

describe('staff sign-in hardening', () => {
  it('keeps a till signed in for 30 days, slides with use, and caps at 90 days', async () => {
    const { issueStaffSession, verifyStaffSession, renewStaffSession } = await import('../server/security');
    const DAY = 86_400_000;
    const t0 = Date.UTC(2026, 0, 1);
    const s = issueStaffSession('hash', 0, t0);
    expect(s.maxAge).toBe(30 * 86_400);
    expect(verifyStaffSession(s.value, 'hash', 0, t0 + 29 * DAY)).not.toBeNull();
    expect(verifyStaffSession(s.value, 'hash', 0, t0 + 30 * DAY + 1)).toBeNull();
    // Used within the first day: no new cookie needed yet.
    expect(renewStaffSession(verifyStaffSession(s.value, 'hash', 0, t0 + 3_600_000)!, 'hash', 0, t0 + 3_600_000)).toBeNull();
    // Keep using it every 20 days: it stays signed in, until 90 days after sign-in.
    let cur = s.value;
    for (let day = 20; day < 90; day += 20) {
      const sess = verifyStaffSession(cur, 'hash', 0, t0 + day * DAY)!;
      expect(sess).not.toBeNull();
      // Near the 90-day cap there is nothing left to extend, so no new cookie is issued.
      cur = renewStaffSession(sess, 'hash', 0, t0 + day * DAY)?.value ?? cur;
    }
    expect(verifyStaffSession(cur, 'hash', 0, t0 + 89 * DAY)).not.toBeNull();
    expect(verifyStaffSession(cur, 'hash', 0, t0 + 90 * DAY + 1)).toBeNull();
    // A changed PIN or "sign out all tills" ends it immediately.
    expect(verifyStaffSession(s.value, 'other-hash', 0, t0)).toBeNull();
    expect(verifyStaffSession(s.value, 'hash', 1, t0)).toBeNull();
  });

  it('rejects tampered, forged and old-format staff cookies', async () => {
    const { issueStaffSession, verifyStaffSession } = await import('../server/security');
    const now = Date.now();
    const s = issueStaffSession('hash', 0, now);
    const [v, iat, , ver, sig] = s.value.split('.');
    // Pushing the expiry out invalidates the signature.
    expect(verifyStaffSession([v, iat, now + 400 * 86_400_000, ver, sig].join('.'), 'hash', 0, now)).toBeNull();
    expect(verifyStaffSession(s.value.slice(0, -2) + 'xx', 'hash', 0, now)).toBeNull();
    expect(verifyStaffSession(`${now + 3_600_000}.${ver}.${sig}`, 'hash', 0, now)).toBeNull();
    expect(verifyStaffSession('', 'hash', 0, now)).toBeNull();
    expect(verifyStaffSession('a'.repeat(5000), 'hash', 0, now)).toBeNull();
  });

  it('sets a 30-day staff cookie on sign-in', async () => {
    const res = await call('POST', '/api/admin/login', { body: { pin: '1234' }, ip: '10.9.9.8' });
    const raw = res.headers.get('set-cookie')!;
    expect(raw).toContain(`Max-Age=${30 * 86_400}`);
    expect(raw).toContain('HttpOnly');
    expect(raw).toContain('SameSite=Strict');
    const cookie = raw.split(';')[0]!;
    expect((await call('GET', '/api/admin/session', { cookie })).data).toEqual({ authed: true });
  });

  it('parallel staff PIN guesses cannot get past the limit', async () => {
    const results = await Promise.all(Array.from({ length: 25 }, (_, i) => call('POST', '/api/admin/login', { body: { pin: String(100000 + i) }, ip: '10.20.0.1' })));
    expect(results.filter((r) => r.status === 401).length).toBeLessThanOrEqual(5);
  });

  it('"sign out all tills" ends other staff sessions and keeps this one', async () => {
    const otherTill = await staff();
    const thisTill = await staff();
    const res = await call('POST', '/api/admin/logout-all', { cookie: thisTill });
    const renewed = res.headers.get('set-cookie')!.split(';')[0]!;
    expect((await call('GET', '/api/admin/snapshot', { cookie: renewed })).status).toBe(200);
    expect((await call('GET', '/api/admin/snapshot', { cookie: otherTill })).status).toBe(401);
  });

  it('exports members as CSV for staff only, without PINs or full emails', async () => {
    await join({ name: '=HYPERLINK("x") Lerato', email: 'lerato@example.com' });
    expect((await call('GET', '/api/admin/export')).status).toBe(401);
    const res = await call('GET', '/api/admin/export', { cookie: await staff() });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toMatch(/attachment; filename="bloeisel-members-\d{4}-\d{2}-\d{2}\.csv"/);
    const text = res.text;
    expect(text).toContain('"\'=HYPERLINK(""x"") Lerato"');
    expect(text).toMatch(/"l•+@example\.com"/);
    expect(text).not.toContain('lerato@example.com');
    expect(text).not.toMatch(/scrypt|pin_hash|\$/);
    expect(text.trim().split('\r\n')).toHaveLength(2);
  });

  it('new team PINs need 6 to 8 digits', async () => {
    const cookie = await staff();
    expect((await call('PATCH', '/api/admin/settings', { cookie, body: { pin: '4829' } })).status).toBe(400);
  });

  it('the counter QR time limit is either off or at least 30 minutes', async () => {
    const cookie = await staff();
    expect((await call('PATCH', '/api/admin/counter', { cookie, body: { cooldownMinutes: 10 } })).status).toBe(400);
    expect((await call('PATCH', '/api/admin/counter', { cookie, body: { cooldownMinutes: 0 } })).status).toBe(200);
    expect((await call('PATCH', '/api/admin/counter', { cookie, body: { cooldownMinutes: 60 } })).status).toBe(200);
  });
});

describe('forgot PIN timing', () => {
  it('pads every reply to the same minimum time', async () => {
    const prev = process.env.FORGOT_MIN_MS;
    process.env.FORGOT_MIN_MS = '400';
    try {
      const t0 = Date.now();
      await handle(new Request('http://test/api/pin/forgot', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.30.0.1' }, body: JSON.stringify({ email: 'nobody@example.com' }) }));
      expect(Date.now() - t0).toBeGreaterThanOrEqual(380);
    } finally {
      process.env.FORGOT_MIN_MS = prev;
    }
  });
});
