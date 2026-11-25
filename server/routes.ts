import { z } from 'zod';
import type { Activity, Campaign, Customer, Settings } from '../src/data/types';
import { getDb, type Db, type Queryable, type Row } from './db.js';
import {
  badRequest,
  body,
  conflict,
  cookie,
  errorResponse,
  getCookie,
  HttpError,
  json,
  newCtx,
  notFound,
  tooMany,
  unauthorized,
  type Ctx,
} from './http.js';
import { appUrl, emailChangedNotice, emailConfigured, pinResetEmail, sendEmail } from './email.js';
import { isDeployed } from './env.js';
import { ensureSchema } from './schema.js';
import {
  CARD_COOKIE,
  CARD_SESSION_DAYS,
  clearRateLimit,
  hashPin,
  maskEmail,
  weakPin,
  hashToken,
  hitRateLimit,
  issueStaffSession,
  renewStaffSession,
  memberCode,
  newCounterCode,
  safeEqual,
  takeAttempt,
  newToken,
  phoneKey,
  STAFF_COOKIE,
  verifyPin,
  verifyStaffSession,
} from './security.js';

/* ======================= Row mapping ======================= */

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v ? new Date(String(v)).toISOString() : undefined);

/**
 * Maps a customer row for an API response. Email addresses are masked unless
 * this is the member's own card (`own`); PIN hashes are never included.
 */
function toCustomer(r: Row, own = false): Customer {
  return {
    id: String(r.id),
    code: String(r.code),
    name: String(r.name),
    phone: String(r.phone),
    email: own ? ((r.email as string) ?? undefined) : maskEmail(r.email as string | null),
    hasPin: Boolean(r.pin_hash),
    stamps: Number(r.stamps),
    totalStamps: Number(r.total_stamps),
    rewardsEarned: Number(r.rewards_earned),
    rewardsRedeemed: Number(r.rewards_redeemed),
    favourite: (r.favourite as string) ?? undefined,
    joinedAt: iso(r.joined_at)!,
    lastVisit: iso(r.last_visit),
  };
}

function toActivity(r: Row): Activity {
  return {
    id: String(r.id),
    customerId: String(r.customer_id),
    type: r.type as Activity['type'],
    at: iso(r.at)!,
    drink: (r.drink as string) ?? undefined,
    delta: r.delta == null ? undefined : Number(r.delta),
    note: (r.note as string) ?? undefined,
  };
}

function toCampaign(r: Row): Campaign {
  return {
    id: String(r.id),
    name: String(r.name),
    kind: r.kind as Campaign['kind'],
    // Join codes open the landing page first; its button leads on to sign-up.
    url: r.kind === 'join' ? `/?src=${r.id}` : String(r.target_url),
    placement: String(r.placement),
    scans: Number(r.scans),
    active: Boolean(r.active),
    createdAt: iso(r.created_at)!,
  };
}

type SettingsRow = {
  store_name: string;
  stamps_required: number;
  reward_name: string;
  admin_pin_hash: string;
  counter_code: string;
  self_scan_enabled: boolean;
  self_scan_cooldown_minutes: number;
  staff_session_epoch: number;
};

function toCounter(r: SettingsRow) {
  return { code: r.counter_code, enabled: Boolean(r.self_scan_enabled), cooldownMinutes: Number(r.self_scan_cooldown_minutes) };
}

function toSettings(r: SettingsRow): Settings {
  return { storeName: r.store_name, stampsRequired: Number(r.stamps_required), rewardName: r.reward_name };
}

async function loadSettings(q: Queryable) {
  const [row] = await q.query<SettingsRow>('SELECT * FROM settings WHERE id = 1');
  if (!row) throw new Error('settings row missing');
  return row;
}

/* ======================= Validation ======================= */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idParam = (ctx: Ctx) => {
  const id = ctx.params.id;
  if (!id || !UUID.test(id)) throw notFound();
  return id;
};

const name = z.string().trim().min(2, 'Tell us what to call you').max(80);
const phone = z
  .string()
  .trim()
  .max(32)
  .refine((p) => phoneKey(p) !== null, 'Enter a valid mobile number');
/** Required when creating a card, so every member can reset a forgotten PIN by email. */
const requiredEmail = z.string().trim().min(1, 'Enter your email address').max(254).email('That email looks off');
const drink = z.string().trim().min(1).max(40).optional();
const pin = z
  .string()
  .regex(/^\d{4}$/, 'Your PIN must be 4 digits')
  .refine((v) => !weakPin(v), 'Pick a PIN that is harder to guess than 1234 or 1111');
const idempotencyKey = z.string().trim().min(8).max(100);

/* ======================= Auth ======================= */

/** Checks the staff cookie and, at most once a day, slides its 30-day expiry forward. */
function staffSession(ctx: Ctx, s: SettingsRow) {
  const epoch = Number(s.staff_session_epoch);
  const session = verifyStaffSession(getCookie(ctx.req, STAFF_COOKIE), s.admin_pin_hash, epoch);
  if (!session) return false;
  const renewed = renewStaffSession(session, s.admin_pin_hash, epoch);
  if (renewed) ctx.setHeaders.append('set-cookie', cookie(STAFF_COOKIE, renewed.value, renewed.maxAge));
  return true;
}

async function requireStaff(ctx: Ctx, q: Queryable) {
  const s = await loadSettings(q);
  if (!staffSession(ctx, s)) throw unauthorized('Staff sign-in required');
  return s;
}

const CARD_MAX_AGE = CARD_SESSION_DAYS * 86_400;

function setCardCookie(ctx: Ctx, token: string) {
  // Lax, not Strict: opening the site from a scanned QR (a cross-site navigation) must still see the card.
  ctx.setHeaders.append('set-cookie', cookie(CARD_COOKIE, token, CARD_MAX_AGE, 'Lax'));
}

function clearCardCookie(ctx: Ctx) {
  ctx.setHeaders.append('set-cookie', cookie(CARD_COOKIE, '', 0, 'Lax'));
}

/**
 * The card on this phone. Customers can only ever reach their own card.
 * The device token lives in an HttpOnly cookie that lasts CARD_SESSION_DAYS
 * after the last visit; phones from before the cookie still send it as a
 * Bearer header and are moved onto the cookie here.
 */
async function requireCustomer(ctx: Ctx, q: Queryable) {
  const fromCookie = getCookie(ctx.req, CARD_COOKIE);
  const bearer = (ctx.req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const token = fromCookie || bearer;
  if (!token || token.length > 100) throw unauthorized('No card on this phone');
  const hash = hashToken(token);
  const [row] = await q.query<Row & { device_last_seen: Date }>(
    `SELECT c.*, d.last_seen_at AS device_last_seen FROM device_tokens d JOIN customers c ON c.id = d.customer_id
     WHERE d.token_hash = $1`,
    [hash],
  );
  if (!row) {
    if (fromCookie) clearCardCookie(ctx);
    throw unauthorized('No card on this phone');
  }
  const lastSeen = new Date(String(row.device_last_seen)).getTime();
  if (Date.now() - lastSeen > CARD_MAX_AGE * 1000) {
    await q.query('DELETE FROM device_tokens WHERE token_hash = $1', [hash]);
    clearCardCookie(ctx);
    throw unauthorized('You were signed out after a long break. Sign in again.');
  }
  // Slide the 120 days forward at most once a day, and move Bearer-only phones onto the cookie.
  if (!fromCookie || Date.now() - lastSeen > 86_400_000) {
    await q.query('UPDATE device_tokens SET last_seen_at = now() WHERE token_hash = $1', [hash]);
    setCardCookie(ctx, token);
  }
  return { customer: row, tokenHash: hash };
}

/**
 * Before changing the PIN, phone, email, or deleting the card, a member who has
 * a PIN must type it again, so a borrowed or stolen session can't take the
 * card over. Attempts are limited per card.
 */
async function confirmCurrentPin(db: Db, customer: Row, provided: string | undefined) {
  if (!customer.pin_hash) return;
  if (!provided || !/^\d{4}$/.test(provided)) throw new HttpError(401, 'pin_required', 'Enter your current PIN to make this change.');
  const bucket = `pin-confirm:${customer.id}`;
  if (!(await takeAttempt(db, bucket, 5, 900))) throw tooMany('Too many wrong PINs. Try again in 15 minutes.');
  if (!(await verifyPin(provided, String(customer.pin_hash)))) throw new HttpError(401, 'wrong_pin', "That PIN isn't right.");
  await clearRateLimit(db, bucket);
}

/** Signs this phone in to a card: a fresh device token in the 120-day cookie. */
async function issueDevice(ctx: Ctx, q: Queryable, customerId: string) {
  const token = newToken();
  await q.query('INSERT INTO device_tokens (token_hash, customer_id) VALUES ($1, $2)', [hashToken(token), customerId]);
  // Opportunistic clean-up of long-expired devices.
  if (Math.random() < 0.05) {
    await q.query(`DELETE FROM device_tokens WHERE last_seen_at < now() - make_interval(days => $1)`, [CARD_SESSION_DAYS]);
  }
  setCardCookie(ctx, token);
}

async function meData(q: Queryable, customerId: string) {
  const [c] = await q.query('SELECT * FROM customers WHERE id = $1', [customerId]);
  if (!c) throw unauthorized('No card on this phone');
  const activity = await q.query('SELECT * FROM activity WHERE customer_id = $1 ORDER BY at DESC LIMIT 100', [customerId]);
  return { customer: toCustomer(c, true), activity: activity.map(toActivity), settings: toSettings(await loadSettings(q)) };
}

const TRANSFER_MINUTES = 15;
async function issueTransfer(q: Queryable, customerId: string) {
  const token = newToken();
  // Only the newest link works: issuing one cancels earlier unused links.
  await q.query('DELETE FROM transfer_tokens WHERE customer_id = $1 AND used_at IS NULL', [customerId]);
  const [row] = await q.query<{ expires_at: Date }>(
    `INSERT INTO transfer_tokens (token_hash, customer_id, expires_at)
     VALUES ($1, $2, now() + make_interval(mins => $3)) RETURNING expires_at`,
    [hashToken(token), customerId, TRANSFER_MINUTES],
  );
  return { token, expiresAt: iso(row!.expires_at)! };
}

/* ======================= Card rules ======================= */

/** Applies a stamp/redeem/adjust in one transaction with the row locked, so two tills can't race. */
async function mutateCard(
  db: Db,
  customerId: string,
  key: string | null,
  apply: (c: Row, max: number) => { set: Record<string, unknown>; activity: Omit<Activity, 'id' | 'at' | 'customerId'> } | HttpError,
) {
  try {
    return await db.tx(async (q) => {
      if (key) {
        const [prev] = await q.query('SELECT 1 FROM activity WHERE idempotency_key = $1 AND customer_id = $2', [key, customerId]);
        if (prev) return { customer: toCustomer((await q.query('SELECT * FROM customers WHERE id = $1', [customerId]))[0]!), replayed: true };
      }
      const [c] = await q.query('SELECT * FROM customers WHERE id = $1 FOR UPDATE', [customerId]);
      if (!c) throw notFound('Member not found');
      const max = Number((await loadSettings(q)).stamps_required);
      const result = apply(c, max);
      if (result instanceof HttpError) throw result;
      const cols = Object.keys(result.set);
      const [updated] = await q.query(
        `UPDATE customers SET ${cols.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`,
        [customerId, ...cols.map((k) => result.set[k])],
      );
      const a = result.activity;
      await q.query(
        'INSERT INTO activity (customer_id, type, drink, delta, note, idempotency_key) VALUES ($1, $2, $3, $4, $5, $6)',
        [customerId, a.type, a.drink ?? null, a.delta ?? null, a.note ?? null, key],
      );
      return { customer: toCustomer(updated!), replayed: false };
    });
  } catch (err) {
    // Same key sent twice at once: the loser of the race reports the winner's result.
    if ((err as { code?: string }).code === '23505' && key) {
      const [c] = await db.query('SELECT * FROM customers WHERE id = $1', [customerId]);
      if (c) return { customer: toCustomer(c), replayed: true };
    }
    throw err;
  }
}

/* ======================= Handlers ======================= */

type Handler = (ctx: Ctx, db: Db) => Promise<Response>;

const routes: Array<[method: string, pattern: string, handler: Handler]> = [];
const route = (method: string, pattern: string, handler: Handler) => routes.push([method, pattern, handler]);

route('GET', '/api/health', async (_ctx, db) => {
  await db.query('SELECT 1');
  return json({ ok: true });
});

route('GET', '/api/config', async (_ctx, db) => json(toSettings(await loadSettings(db))));

/* ---------- Customers ---------- */

route('POST', '/api/join', async (ctx, db) => {
  const input = await body(ctx, z.object({ name, phone, email: requiredEmail, pin, marketingOptIn: z.boolean().optional() }));
  // Generous: everyone on the café's Wi-Fi shares one address. This only stops scripted mass sign-ups.
  if (await hitRateLimit(db, `join:${ctx.ip}`, 60, 3600)) throw tooMany('Too many sign-ups from this network. Try again later.');
  const key = phoneKey(input.phone)!;
  return db.tx(async (q) => {
    const [taken] = await q.query('SELECT 1 FROM customers WHERE phone_key = $1', [key]);
    if (taken) {
      // Telling a member "you already have a card" also tells a stranger the number is registered,
      // so cap how often one network can ask.
      if (!(await takeAttempt(q, `join-taken:${ctx.ip}`, 10, 3600))) throw tooMany('Too many attempts from this network. Try again later.');
      throw conflict('That number already has a card. Sign in with your mobile number and PIN instead.', 'phone_taken');
    }
    const pinHash = await hashPin(input.pin);
    let row: Row | undefined;
    for (let attempt = 0; !row && attempt < 5; attempt++) {
      [row] = await q.query(
        `INSERT INTO customers (code, name, phone, phone_key, email, marketing_opt_in, pin_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (code) DO NOTHING RETURNING *`,
        [memberCode(), input.name, input.phone, key, input.email, input.marketingOptIn ?? false, pinHash],
      );
    }
    if (!row) throw new Error('could not allocate a member code');
    await q.query(`INSERT INTO activity (customer_id, type) VALUES ($1, 'join')`, [row.id]);
    await issueDevice(ctx, q, String(row.id));
    return json(await meData(q, String(row.id)), 201);
  });
});

route('GET', '/api/me', async (ctx, db) => {
  // No session at all is a normal state (a new visitor), not an error: answer quietly.
  if (!getCookie(ctx.req, CARD_COOKIE) && !ctx.req.headers.get('authorization')) return json({ signedIn: false });
  const { customer } = await requireCustomer(ctx, db);
  return json(await meData(db, String(customer.id)));
});

route('PATCH', '/api/me', async (ctx, db) => {
  const { customer } = await requireCustomer(ctx, db);
  const input = await body(
    ctx,
    z.object({
      name: name.optional(),
      phone: phone.optional(),
      // Absent = leave as is; otherwise a new address. It can be changed but not removed.
      email: requiredEmail.optional(),
      currentPin: z.string().max(8).optional(),
    }),
  );
  const key = input.phone ? phoneKey(input.phone) : null;
  const phoneChanging = !!key && key !== customer.phone_key;
  const oldEmail = (customer.email as string | null) ?? null;
  const newEmail = input.email ?? oldEmail;
  const emailChanging = (newEmail ?? '').toLowerCase() !== (oldEmail ?? '').toLowerCase();
  // The phone number signs in and the email receives reset links: both need the current PIN.
  if (phoneChanging || emailChanging) await confirmCurrentPin(db, customer, input.currentPin);
  if (phoneChanging) {
    const [other] = await db.query('SELECT 1 FROM customers WHERE phone_key = $1 AND id <> $2', [key, customer.id]);
    if (other) throw conflict('That number is already linked to another card', 'phone_taken');
  }
  await db.query(
    `UPDATE customers SET name = coalesce($2, name), phone = coalesce($3, phone), phone_key = coalesce($4, phone_key),
       email = $5, updated_at = now() WHERE id = $1`,
    [customer.id, input.name ?? null, input.phone ?? null, key, newEmail],
  );
  if (emailChanging && oldEmail) {
    // Best effort: tell the old address, so a takeover can't quietly redirect reset links.
    await sendEmail(emailChangedNotice(oldEmail, String(customer.name).split(' ')[0] ?? '')).catch((err) =>
      console.error(JSON.stringify({ level: 'error', requestId: ctx.requestId, msg: 'email change notice failed', detail: (err as Error).message })),
    );
  }
  return json(await meData(db, String(customer.id)));
});

route('POST', '/api/me/transfer', async (ctx, db) => {
  const { customer } = await requireCustomer(ctx, db);
  if (await hitRateLimit(db, `transfer:${customer.id}`, 10, 3600)) throw tooMany('Too many transfer links. Try again later.');
  return json(await issueTransfer(db, String(customer.id)), 201);
});

route('DELETE', '/api/me/device', async (ctx, db) => {
  const { tokenHash } = await requireCustomer(ctx, db);
  await db.query('DELETE FROM device_tokens WHERE token_hash = $1', [tokenHash]);
  clearCardCookie(ctx);
  return json({ ok: true });
});

/** Set or change the sign-in PIN. Holding the signed-in phone is the proof of identity. */
route('PUT', '/api/me/pin', async (ctx, db) => {
  const { customer, tokenHash } = await requireCustomer(ctx, db);
  const input = await body(ctx, z.object({ pin, currentPin: z.string().max(8).optional() }));
  await confirmCurrentPin(db, customer, input.currentPin);
  if (await hitRateLimit(db, `setpin:${customer.id}`, 10, 3600)) throw tooMany('Too many PIN changes. Try again later.');
  await db.query('UPDATE customers SET pin_hash = $2, updated_at = now() WHERE id = $1', [customer.id, await hashPin(input.pin)]);
  // A new PIN ends every other session, so anyone who knew the old one is out.
  await db.query('DELETE FROM device_tokens WHERE customer_id = $1 AND token_hash <> $2', [customer.id, tokenHash]);
  return json(await meData(db, String(customer.id)));
});

/** Signs out every phone except this one. */
route('POST', '/api/me/signout-others', async (ctx, db) => {
  const { customer, tokenHash } = await requireCustomer(ctx, db);
  const rows = await db.query('DELETE FROM device_tokens WHERE customer_id = $1 AND token_hash <> $2 RETURNING 1', [customer.id, tokenHash]);
  return json({ signedOut: rows.length });
});

/** Deletes the card and everything about it (visits, phones, reset links). */
route('DELETE', '/api/me', async (ctx, db) => {
  const { customer } = await requireCustomer(ctx, db);
  const input = await body(ctx, z.object({ currentPin: z.string().max(8).optional() }));
  await confirmCurrentPin(db, customer, input.currentPin);
  await db.query('DELETE FROM customers WHERE id = $1', [customer.id]);
  clearCardCookie(ctx);
  return json({ ok: true });
});

/**
 * The customer scanned the printed counter QR. The code proves they saw the
 * poster; the per-card time limit stops a photo of it being farmed from home.
 */
route('POST', '/api/me/counter-stamp', async (ctx, db) => {
  const { customer } = await requireCustomer(ctx, db);
  const input = await body(ctx, z.object({ code: z.string().min(10).max(60), idempotencyKey }));
  // Shared café Wi-Fi again; the per-card time limit is the real guard.
  if (await hitRateLimit(db, `counter:${ctx.ip}`, 300, 3600)) throw tooMany('Too many scans from this network. Ask your barista instead.');
  const s = await loadSettings(db);
  if (!s.self_scan_enabled) throw new HttpError(403, 'self_scan_off', 'Scanning at the counter is switched off right now. Show your QR to the barista instead.');
  if (!safeEqual(input.code, s.counter_code)) {
    throw new HttpError(403, 'bad_code', "This QR code isn't valid any more. Scan the code by the till, or ask your barista.");
  }
  const cooldown = Number(s.self_scan_cooldown_minutes);
  const res = await mutateCard(db, String(customer.id), input.idempotencyKey, (c, max) => {
    if (Number(c.stamps) >= max) return conflict('Your card is full. Show your QR to the barista to claim your free coffee.', 'card_full');
    const last = c.last_visit ? new Date(String(c.last_visit)).getTime() : 0;
    const nextAt = last + cooldown * 60_000;
    if (cooldown > 0 && nextAt > Date.now()) {
      const mins = Math.ceil((nextAt - Date.now()) / 60_000);
      const wait = mins >= 60 ? `${Math.floor(mins / 60)}h${mins % 60 ? ` ${mins % 60}m` : ''}` : `${mins} min`;
      return new HttpError(429, 'too_soon', `You already collected a sticker on this visit. Your next one is ready in ${wait}.`);
    }
    const stamps = Number(c.stamps);
    return {
      set: {
        stamps: stamps + 1,
        total_stamps: Number(c.total_stamps) + 1,
        rewards_earned: Number(c.rewards_earned) + (stamps + 1 === max ? 1 : 0),
        last_visit: new Date(),
      },
      activity: { type: 'stamp', note: 'Counter QR' },
    };
  });
  return json({ ...res, completed: res.customer.stamps >= Number(s.stamps_required) });
});

/**
 * The member marks their own free coffee as redeemed at the counter (the
 * barista can also do it from Customers). The card starts again; history stays.
 */
route('POST', '/api/me/redeem', async (ctx, db) => {
  const { customer } = await requireCustomer(ctx, db);
  const input = await body(ctx, z.object({ idempotencyKey }));
  const s = await loadSettings(db);
  const res = await mutateCard(db, String(customer.id), input.idempotencyKey, (c, max) => {
    const stamps = Number(c.stamps);
    if (stamps < max) return conflict('Your card has no free coffee to redeem yet.', 'not_ready');
    return {
      set: { stamps: stamps - max, rewards_redeemed: Number(c.rewards_redeemed) + 1 },
      activity: { type: 'redeem', drink: s.reward_name, note: 'Redeemed by member' },
    };
  });
  return json(res);
});

route('POST', '/api/claim', async (ctx, db) => {
  const input = await body(ctx, z.object({ token: z.string().min(20).max(100) }));
  if (await hitRateLimit(db, `claim:${ctx.ip}`, 20, 3600)) throw tooMany('Too many attempts. Try again later.');
  return db.tx(async (q) => {
    const [t] = await q.query(
      `UPDATE transfer_tokens SET used_at = now()
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING customer_id`,
      [hashToken(input.token)],
    );
    if (!t) throw new HttpError(410, 'link_expired', 'This link has expired or was already used. Ask for a new one.');
    const customerId = String(t.customer_id);
    // Moving the card signs out every other phone, so a lost phone stops working.
    await q.query('DELETE FROM device_tokens WHERE customer_id = $1', [customerId]);
    await issueDevice(ctx, q, customerId);
    return json(await meData(q, customerId));
  });
});

/* ---------- Customer sign-in and PIN recovery ---------- */

const SIGNIN_FAILS = 5;
const SIGNIN_WINDOW_MIN = 15;
const SIGNIN_DAILY_CAP = 20;
// Compared against when the number has no card, so a wrong number takes as long as a wrong PIN.
let decoyPinHash: Promise<string> | null = null;

route('POST', '/api/signin', async (ctx, db) => {
  const input = await body(ctx, z.object({ phone, pin: z.string().regex(/^\d{4}$/, 'Your PIN is 4 digits') }));
  if (await hitRateLimit(db, `signin-ip:${ctx.ip}`, 100, 900)) throw tooMany('Too many sign-in attempts from this network. Try again in 15 minutes.');
  const key = phoneKey(input.phone)!;
  // Each try is counted BEFORE the PIN is checked, atomically, so parallel guesses can't skip the limit.
  // Per number+network: someone else on another network can't lock you out with wrong guesses.
  const pairBucket = `signin:${key}:${ctx.ip}`;
  if (!(await takeAttempt(db, pairBucket, SIGNIN_FAILS, SIGNIN_WINDOW_MIN * 60))) {
    throw tooMany(`Too many wrong PINs. Wait ${SIGNIN_WINDOW_MIN} minutes, or reset your PIN by email.`);
  }
  // Per number across all networks: caps a spread-out guessing attack at 20 tries a day.
  const dayBucket = `signin-day:${key}`;
  if (!(await takeAttempt(db, dayBucket, SIGNIN_DAILY_CAP, 86_400))) {
    throw tooMany('Too many sign-in attempts for this number today. Reset your PIN by email, or ask your barista.');
  }

  const [c] = await db.query('SELECT * FROM customers WHERE phone_key = $1', [key]);
  if (!decoyPinHash) decoyPinHash = hashPin('decoy-pin');
  const ok = await verifyPin(input.pin, c?.pin_hash ? String(c.pin_hash) : await decoyPinHash);
  if (!c || !c.pin_hash || !ok) throw new HttpError(401, 'bad_signin', "That mobile number and PIN don't match.");
  await clearRateLimit(db, pairBucket);
  await clearRateLimit(db, dayBucket);
  // Signing in adds this phone; other phones stay signed in.
  await issueDevice(ctx, db, String(c.id));
  return json(await meData(db, String(c.id)));
});

const RESET_MINUTES = 30;
const FORGOT_REPLY = {
  ok: true,
  message: "If that email is on a Bloeisel card, we've sent a link to reset the PIN. It works for 30 minutes.",
};

/**
 * Forgot PIN: emails a single-use reset link. The reply is identical whether
 * or not the address is on a card, so this can't be used to discover members.
 */
route('POST', '/api/pin/forgot', async (ctx, db) => {
  const input = await body(ctx, z.object({ email: z.string().trim().max(254).email('Enter the email on your card') }));
  if (!emailConfigured() && isDeployed()) {
    throw new HttpError(503, 'email_unavailable', "PIN reset by email isn't available yet. Ask your barista to send your card to this phone.");
  }
  const address = input.email.toLowerCase();
  if (await hitRateLimit(db, `forgot-ip:${ctx.ip}`, 30, 3600)) throw tooMany('Too many requests. Try again later.');
  // Quietly cap emails per address; the reply stays the same so it reveals nothing.
  if (await hitRateLimit(db, `forgot:${address}`, 3, 3600)) return json(FORGOT_REPLY);

  const started = Date.now();
  const cards = await db.query('SELECT id, name, email FROM customers WHERE lower(email) = $1 LIMIT 3', [address]);
  const base = appUrl(ctx.url.origin);
  for (const c of cards) {
    const token = newToken();
    await db.query('DELETE FROM pin_resets WHERE customer_id = $1 AND used_at IS NULL', [c.id]);
    await db.query(`INSERT INTO pin_resets (token_hash, customer_id, expires_at) VALUES ($1, $2, now() + make_interval(mins => $3))`, [
      hashToken(token),
      c.id,
      RESET_MINUTES,
    ]);
    // The token travels in the #fragment, so it never reaches server logs or other sites via Referer.
    try {
      await sendEmail(pinResetEmail(String(c.email), String(c.name).split(' ')[0] ?? '', `${base}/app/reset#${token}`, RESET_MINUTES));
    } catch (err) {
      // Logged without the address; the reply below is unchanged so it reveals nothing.
      console.error(JSON.stringify({ level: 'error', requestId: ctx.requestId, msg: 'PIN reset email failed', detail: (err as Error).message }));
    }
  }
  // Pad every reply to the same minimum time, so response speed doesn't reveal whether an email was sent.
  const wait = Number(process.env.FORGOT_MIN_MS ?? 1500) - (Date.now() - started);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  return json(FORGOT_REPLY);
});

/** Completes a reset: new PIN, this phone signed in, every other phone signed out. */
route('POST', '/api/pin/reset', async (ctx, db) => {
  const input = await body(ctx, z.object({ token: z.string().min(20).max(100), pin }));
  if (await hitRateLimit(db, `reset-ip:${ctx.ip}`, 30, 3600)) throw tooMany('Too many attempts. Try again later.');
  return db.tx(async (q) => {
    const [r] = await q.query(
      `UPDATE pin_resets SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING customer_id`,
      [hashToken(input.token)],
    );
    if (!r) throw new HttpError(410, 'link_expired', 'This reset link has expired or was already used. Ask for a new one.');
    const customerId = String(r.customer_id);
    await q.query('UPDATE customers SET pin_hash = $2, updated_at = now() WHERE id = $1', [customerId, await hashPin(input.pin)]);
    await q.query('DELETE FROM device_tokens WHERE customer_id = $1', [customerId]);
    await q.query(
      `DELETE FROM rate_events WHERE bucket IN (SELECT 'signin-day:' || phone_key FROM customers WHERE id = $1)
         OR bucket LIKE (SELECT 'signin:' || phone_key || ':%' FROM customers WHERE id = $1)`,
      [customerId],
    );
    await issueDevice(ctx, q, customerId);
    return json(await meData(q, customerId));
  });
});

/* ---------- Staff ---------- */

route('POST', '/api/admin/login', async (ctx, db) => {
  const { pin } = await body(ctx, z.object({ pin: z.string().regex(/^\d{4,8}$/, 'PIN must be 4 to 8 digits') }));
  const bucket = `login:${ctx.ip}`;
  // Counted before the PIN check, atomically, so parallel guesses can't skip the limit.
  if (!(await takeAttempt(db, bucket, 5, 900))) throw tooMany('Too many wrong PINs. Wait 15 minutes and try again.');
  if (!(await takeAttempt(db, 'login-all', 300, 86_400))) throw tooMany('Staff sign-in is paused after too many attempts today. Try again tomorrow.');
  const s = await loadSettings(db);
  if (!(await verifyPin(pin, s.admin_pin_hash))) throw new HttpError(401, 'wrong_pin', 'That PIN is not right');
  await clearRateLimit(db, bucket);
  const session = issueStaffSession(s.admin_pin_hash, Number(s.staff_session_epoch));
  ctx.setHeaders.append('set-cookie', cookie(STAFF_COOKIE, session.value, session.maxAge));
  return json({ ok: true });
});

route('POST', '/api/admin/logout', async (ctx) => {
  ctx.setHeaders.append('set-cookie', cookie(STAFF_COOKIE, '', 0));
  return json({ ok: true });
});

/** Ends every staff session (e.g. a till was lost or someone left); this till stays signed in. */
route('POST', '/api/admin/logout-all', async (ctx, db) => {
  await requireStaff(ctx, db);
  const [s] = await db.query<SettingsRow>('UPDATE settings SET staff_session_epoch = staff_session_epoch + 1 WHERE id = 1 RETURNING *');
  const session = issueStaffSession(s!.admin_pin_hash, Number(s!.staff_session_epoch));
  ctx.setHeaders.append('set-cookie', cookie(STAFF_COOKIE, session.value, session.maxAge));
  return json({ ok: true });
});

route('GET', '/api/admin/session', async (ctx, db) => {
  const s = await loadSettings(db);
  return json({ authed: staffSession(ctx, s) });
});

/** Everything the staff portal shows. Sized for a single café; paginate if it grows past these caps. */
route('GET', '/api/admin/snapshot', async (ctx, db) => {
  const s = await requireStaff(ctx, db);
  const [customers, activity, campaigns] = await Promise.all([
    db.query('SELECT * FROM customers ORDER BY coalesce(last_visit, joined_at) DESC LIMIT 5000'),
    db.query(`SELECT * FROM activity WHERE at > now() - interval '60 days' ORDER BY at DESC LIMIT 20000`),
    db.query('SELECT * FROM campaigns ORDER BY created_at DESC'),
  ]);
  return json({
    customers: customers.map((c) => toCustomer(c)),
    activity: activity.map(toActivity),
    campaigns: campaigns.map(toCampaign),
    settings: toSettings(s),
    counter: toCounter(s),
  });
});

/**
 * The member list as a spreadsheet, so the owner can keep their own copy.
 * Same data staff already see: emails stay masked and PINs are never included.
 */
route('GET', '/api/admin/export', async (ctx, db) => {
  await requireStaff(ctx, db);
  const rows = await db.query('SELECT * FROM customers ORDER BY joined_at');
  const head = ['Code', 'Name', 'Mobile', 'Email (hidden)', 'Marketing opt-in', 'Stickers on card', 'Lifetime stickers', 'Rewards earned', 'Rewards redeemed', 'Usual order', 'Joined', 'Last visit'];
  const lines = rows.map((r) => {
    const c = toCustomer(r);
    const k = String(r.phone_key);
    const local = `0${k.slice(0, 2)} ${k.slice(2, 5)} ${k.slice(5)}`;
    return [c.code, c.name, local, c.email ?? '', r.marketing_opt_in ? 'Yes' : 'No', c.stamps, c.totalStamps, c.rewardsEarned, c.rewardsRedeemed, c.favourite ?? '', saTime(c.joinedAt), saTime(c.lastVisit)];
  });
  const csv = '\ufeff' + [head, ...lines].map((l) => l.map(csvCell).join(',')).join('\r\n') + '\r\n';
  const day = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="bloeisel-members-${day}.csv"`,
      'cache-control': 'no-store',
    },
  });
});

/** "2026-08-17 10:11" in South African time, for spreadsheets. */
function saTime(v?: string) {
  if (!v) return '';
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Africa/Johannesburg', dateStyle: 'short', timeStyle: 'short' }).format(new Date(v));
}

/** Quotes a CSV cell, and stops spreadsheet apps from running text that starts like a formula. */
function csvCell(v: unknown) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

route('POST', '/api/admin/lookup', async (ctx, db) => {
  await requireStaff(ctx, db);
  const { code } = await body(ctx, z.object({ code: z.string().max(200) }));
  const m = code.toUpperCase().match(/BK-?([A-Z2-9]{6})/) ?? code.toUpperCase().trim().match(/^([A-Z2-9]{6})$/);
  if (!m) throw notFound('No member found for that code');
  const [c] = await db.query('SELECT * FROM customers WHERE code = $1', [`BK-${m[1]}`]);
  if (!c) throw notFound('No member found for that code');
  return json({ customer: toCustomer(c) });
});

route('POST', '/api/admin/customers/:id/stamp', async (ctx, db) => {
  await requireStaff(ctx, db);
  const id = idParam(ctx);
  const input = await body(ctx, z.object({ drink, idempotencyKey }));
  const res = await mutateCard(db, id, input.idempotencyKey, (c, max) => {
    const stamps = Number(c.stamps);
    if (stamps >= max) return conflict('Card is full. Redeem the free coffee first.', 'card_full');
    return {
      set: {
        stamps: stamps + 1,
        total_stamps: Number(c.total_stamps) + 1,
        rewards_earned: Number(c.rewards_earned) + (stamps + 1 === max ? 1 : 0),
        favourite: input.drink ?? c.favourite ?? null,
        last_visit: new Date(),
      },
      activity: { type: 'stamp', drink: input.drink },
    };
  });
  const max = Number((await loadSettings(db)).stamps_required);
  return json({ ...res, completed: res.customer.stamps >= max });
});

route('POST', '/api/admin/customers/:id/redeem', async (ctx, db) => {
  const s = await requireStaff(ctx, db);
  const id = idParam(ctx);
  const input = await body(ctx, z.object({ idempotencyKey }));
  const res = await mutateCard(db, id, input.idempotencyKey, (c, max) => {
    const stamps = Number(c.stamps);
    if (stamps < max) return conflict('This card has no free coffee to redeem yet.', 'not_ready');
    // Any stickers above the threshold (e.g. after it was lowered) carry over to the new card.
    return {
      set: { stamps: stamps - max, rewards_redeemed: Number(c.rewards_redeemed) + 1, last_visit: new Date() },
      activity: { type: 'redeem', drink: s.reward_name },
    };
  });
  return json(res);
});

route('POST', '/api/admin/customers/:id/adjust', async (ctx, db) => {
  await requireStaff(ctx, db);
  const id = idParam(ctx);
  const input = await body(ctx, z.object({ delta: z.number().int().min(-12).max(12).refine((d) => d !== 0), note: z.string().trim().max(120).optional() }));
  let applied = 0;
  const res = await mutateCard(db, id, null, (c, max) => {
    const stamps = Number(c.stamps);
    // Only additions are capped, and never below the balance the card already has.
    const next = Math.max(0, Math.min(Math.max(max, stamps), stamps + input.delta));
    applied = next - stamps;
    if (applied === 0) return conflict('Nothing to change', 'no_change');
    return {
      set: {
        stamps: next,
        total_stamps: Math.max(0, Number(c.total_stamps) + applied),
        rewards_earned: Number(c.rewards_earned) + (next >= max && stamps < max ? 1 : 0),
      },
      activity: { type: 'adjust', delta: applied, note: input.note },
    };
  });
  return json(res);
});

route('POST', '/api/admin/customers/:id/transfer', async (ctx, db) => {
  await requireStaff(ctx, db);
  const id = idParam(ctx);
  const [c] = await db.query('SELECT 1 FROM customers WHERE id = $1', [id]);
  if (!c) throw notFound('Member not found');
  return json(await issueTransfer(db, id), 201);
});

route('DELETE', '/api/admin/customers/:id', async (ctx, db) => {
  await requireStaff(ctx, db);
  const id = idParam(ctx);
  const rows = await db.query('DELETE FROM customers WHERE id = $1 RETURNING id', [id]);
  if (!rows.length) throw notFound('Member not found');
  return json({ ok: true });
});

const targetUrl = z.string().trim().url('Enter a full link, starting with https://').max(500).refine((u) => /^https?:\/\//i.test(u), 'Links must start with http:// or https://');

route('POST', '/api/admin/campaigns', async (ctx, db) => {
  await requireStaff(ctx, db);
  const input = await body(
    ctx,
    z.object({
      name: z.string().trim().min(2, 'Give the code a name').max(80),
      kind: z.enum(['join', 'menu', 'custom']),
      placement: z.string().trim().max(120).default(''),
      targetUrl: targetUrl.optional(),
    }),
  );
  const dest = input.kind === 'join' ? null : input.kind === 'menu' ? (input.targetUrl ?? 'https://bloeiselkoffie.co.za') : input.targetUrl;
  if (input.kind === 'custom' && !dest) throw badRequest('Add the link this code should open');
  const [row] = await db.query('INSERT INTO campaigns (name, kind, target_url, placement) VALUES ($1, $2, $3, $4) RETURNING *', [
    input.name,
    input.kind,
    dest,
    input.placement || 'Not placed yet',
  ]);
  return json({ campaign: toCampaign(row!) }, 201);
});

route('PATCH', '/api/admin/campaigns/:id', async (ctx, db) => {
  await requireStaff(ctx, db);
  const id = idParam(ctx);
  const input = await body(
    ctx,
    z.object({ name: z.string().trim().min(2).max(80).optional(), placement: z.string().trim().max(120).optional(), active: z.boolean().optional() }),
  );
  const [row] = await db.query(
    `UPDATE campaigns SET name = coalesce($2, name), placement = coalesce($3, placement), active = coalesce($4, active)
     WHERE id = $1 RETURNING *`,
    [id, input.name ?? null, input.placement ?? null, input.active ?? null],
  );
  if (!row) throw notFound('QR code not found');
  return json({ campaign: toCampaign(row) });
});

route('DELETE', '/api/admin/campaigns/:id', async (ctx, db) => {
  await requireStaff(ctx, db);
  const rows = await db.query('DELETE FROM campaigns WHERE id = $1 RETURNING id', [idParam(ctx)]);
  if (!rows.length) throw notFound('QR code not found');
  return json({ ok: true });
});

route('PATCH', '/api/admin/settings', async (ctx, db) => {
  await requireStaff(ctx, db);
  const input = await body(
    ctx,
    z.object({
      storeName: z.string().trim().min(2).max(60).optional(),
      stampsRequired: z.number().int().min(5).max(12).optional(),
      rewardName: z.string().trim().min(2).max(60).optional(),
      pin: z.string().regex(/^\d{6,8}$/, 'Use 6 to 8 digits for the team PIN').optional(),
    }),
  );
  const pinHash = input.pin ? await hashPin(input.pin) : null;
  const [row] = await db.query<SettingsRow>(
    `UPDATE settings SET store_name = coalesce($1, store_name), stamps_required = coalesce($2, stamps_required),
       reward_name = coalesce($3, reward_name), admin_pin_hash = coalesce($4, admin_pin_hash), updated_at = now()
     WHERE id = 1 RETURNING *`,
    [input.storeName ?? null, input.stampsRequired ?? null, input.rewardName ?? null, pinHash],
  );
  if (pinHash) {
    // A new PIN signs out every other till; keep this one signed in.
    const session = issueStaffSession(pinHash, Number(row!.staff_session_epoch));
    ctx.setHeaders.append('set-cookie', cookie(STAFF_COOKIE, session.value, session.maxAge));
  }
  return json({ settings: toSettings(row!) });
});

route('PATCH', '/api/admin/counter', async (ctx, db) => {
  await requireStaff(ctx, db);
  const input = await body(
    ctx,
    z.object({ enabled: z.boolean().optional(), cooldownMinutes: z.number().int().max(1440).refine((m) => m === 0 || m >= 30, 'Pick no time limit, or at least 30 minutes').optional(), replaceCode: z.boolean().optional() }),
  );
  const [row] = await db.query<SettingsRow>(
    `UPDATE settings SET self_scan_enabled = coalesce($1, self_scan_enabled),
       self_scan_cooldown_minutes = coalesce($2, self_scan_cooldown_minutes),
       counter_code = coalesce($3, counter_code), updated_at = now()
     WHERE id = 1 RETURNING *`,
    [input.enabled ?? null, input.cooldownMinutes ?? null, input.replaceCode ? newCounterCode() : null],
  );
  return json({ counter: toCounter(row!) });
});

/* ---------- Printed QR codes ---------- */

/** Every printed code points here, so scans are counted for menus and custom links too. */
route('GET', '/q/:id', async (ctx, db) => {
  const id = ctx.params.id ?? '';
  let dest = '/';
  if (UUID.test(id)) {
    const [row] = await db.query('UPDATE campaigns SET scans = scans + 1 WHERE id = $1 AND active RETURNING *', [id]);
    if (row) dest = toCampaign(row).url;
  }
  return new Response(null, { status: 302, headers: { location: dest, 'cache-control': 'no-store' } });
});

/* ======================= Dispatch ======================= */

function match(pattern: string, path: string) {
  const a = pattern.split('/');
  const b = path.replace(/\/+$/, '').split('/');
  if (a.length !== b.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i]!.startsWith(':')) params[a[i]!.slice(1)] = decodeURIComponent(b[i]!);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}

export async function handle(req: Request): Promise<Response> {
  const started = Date.now();
  const ctx = newCtx(req);
  let res: Response;
  try {
    const path = ctx.url.pathname;
    let found: Handler | undefined;
    let allowed = false;
    for (const [method, pattern, handler] of routes) {
      const params = match(pattern, path);
      if (!params) continue;
      allowed = true;
      if (method === req.method) {
        found = handler;
        ctx.params = params;
        break;
      }
    }
    if (!found) throw allowed ? new HttpError(405, 'method_not_allowed', 'Method not allowed') : notFound();
    const db = await getDb();
    await ensureSchema(db);
    res = await found(ctx, db);
  } catch (err) {
    res = errorResponse(err, ctx);
  }
  ctx.setHeaders.forEach((v, k) => res.headers.append(k, v));
  res.headers.set('x-request-id', ctx.requestId);
  console.info(
    JSON.stringify({ level: 'info', requestId: ctx.requestId, method: req.method, path: ctx.url.pathname, status: res.status, ms: Date.now() - started }),
  );
  return res;
}
