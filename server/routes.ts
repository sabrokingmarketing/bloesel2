import { z } from 'zod';
import type { Activity, Campaign, Customer, Settings } from '../src/data/types';
import { getDb, type Db, type Queryable, type Row } from './db';
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
} from './http';
import { ensureSchema } from './schema';
import {
  clearRateLimit,
  hashPin,
  hashToken,
  hitRateLimit,
  issueStaffSession,
  memberCode,
  newToken,
  phoneKey,
  STAFF_COOKIE,
  verifyPin,
  verifyStaffSession,
} from './security';

/* ======================= Row mapping ======================= */

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v ? new Date(String(v)).toISOString() : undefined);

function toCustomer(r: Row): Customer {
  return {
    id: String(r.id),
    code: String(r.code),
    name: String(r.name),
    phone: String(r.phone),
    email: (r.email as string) ?? undefined,
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
    url: r.kind === 'join' ? `/app/join?src=${r.id}` : String(r.target_url),
    placement: String(r.placement),
    scans: Number(r.scans),
    active: Boolean(r.active),
    createdAt: iso(r.created_at)!,
  };
}

type SettingsRow = { store_name: string; stamps_required: number; reward_name: string; admin_pin_hash: string };

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
const email = z
  .string()
  .trim()
  .max(254)
  .email('That email looks off')
  .optional()
  .or(z.literal('').transform(() => undefined));
const drink = z.string().trim().min(1).max(40).optional();
const idempotencyKey = z.string().trim().min(8).max(100);

/* ======================= Auth ======================= */

async function requireStaff(ctx: Ctx, q: Queryable) {
  const s = await loadSettings(q);
  if (!verifyStaffSession(getCookie(ctx.req, STAFF_COOKIE), s.admin_pin_hash)) throw unauthorized('Staff sign-in required');
  return s;
}

/** The card belonging to this phone's bearer token. Customers can only ever reach their own card. */
async function requireCustomer(ctx: Ctx, q: Queryable) {
  const token = (ctx.req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token || token.length > 100) throw unauthorized('No card on this phone');
  const hash = hashToken(token);
  const [row] = await q.query(
    `SELECT c.* FROM device_tokens d JOIN customers c ON c.id = d.customer_id WHERE d.token_hash = $1`,
    [hash],
  );
  if (!row) throw unauthorized('No card on this phone');
  await q.query(`UPDATE device_tokens SET last_seen_at = now() WHERE token_hash = $1 AND last_seen_at < now() - interval '1 hour'`, [hash]);
  return { customer: row, tokenHash: hash };
}

async function issueDevice(q: Queryable, customerId: string) {
  const token = newToken();
  await q.query('INSERT INTO device_tokens (token_hash, customer_id) VALUES ($1, $2)', [hashToken(token), customerId]);
  return token;
}

async function meData(q: Queryable, customerId: string) {
  const [c] = await q.query('SELECT * FROM customers WHERE id = $1', [customerId]);
  if (!c) throw unauthorized('No card on this phone');
  const activity = await q.query('SELECT * FROM activity WHERE customer_id = $1 ORDER BY at DESC LIMIT 100', [customerId]);
  return { customer: toCustomer(c), activity: activity.map(toActivity), settings: toSettings(await loadSettings(q)) };
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
        const [prev] = await q.query('SELECT 1 FROM activity WHERE idempotency_key = $1', [key]);
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
  const input = await body(ctx, z.object({ name, phone, email, marketingOptIn: z.boolean().optional() }));
  if (await hitRateLimit(db, `join:${ctx.ip}`, 10, 3600)) throw tooMany('Too many sign-ups from this network. Try again later.');
  const key = phoneKey(input.phone)!;
  return db.tx(async (q) => {
    const [taken] = await q.query('SELECT 1 FROM customers WHERE phone_key = $1', [key]);
    if (taken) throw conflict('That number already has a card. Ask your barista to move it to this phone.', 'phone_taken');
    let row: Row | undefined;
    for (let attempt = 0; !row && attempt < 5; attempt++) {
      [row] = await q.query(
        `INSERT INTO customers (code, name, phone, phone_key, email, marketing_opt_in)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (code) DO NOTHING RETURNING *`,
        [memberCode(), input.name, input.phone, key, input.email ?? null, input.marketingOptIn ?? false],
      );
    }
    if (!row) throw new Error('could not allocate a member code');
    await q.query(`INSERT INTO activity (customer_id, type) VALUES ($1, 'join')`, [row.id]);
    const token = await issueDevice(q, String(row.id));
    return json({ token, ...(await meData(q, String(row.id))) }, 201);
  });
});

route('GET', '/api/me', async (ctx, db) => {
  const { customer } = await requireCustomer(ctx, db);
  return json(await meData(db, String(customer.id)));
});

route('PATCH', '/api/me', async (ctx, db) => {
  const { customer } = await requireCustomer(ctx, db);
  const input = await body(ctx, z.object({ name: name.optional(), phone: phone.optional(), email }));
  const key = input.phone ? phoneKey(input.phone) : null;
  if (key) {
    const [other] = await db.query('SELECT 1 FROM customers WHERE phone_key = $1 AND id <> $2', [key, customer.id]);
    if (other) throw conflict('That number is already linked to another card', 'phone_taken');
  }
  await db.query(
    `UPDATE customers SET name = coalesce($2, name), phone = coalesce($3, phone), phone_key = coalesce($4, phone_key),
       email = $5, updated_at = now() WHERE id = $1`,
    [customer.id, input.name ?? null, input.phone ?? null, key, input.email ?? null],
  );
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
  return json({ ok: true });
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
    const token = await issueDevice(q, customerId);
    return json({ token, ...(await meData(q, customerId)) });
  });
});

/* ---------- Staff ---------- */

route('POST', '/api/admin/login', async (ctx, db) => {
  const { pin } = await body(ctx, z.object({ pin: z.string().regex(/^\d{4,8}$/, 'PIN must be 4 to 8 digits') }));
  const bucket = `login:${ctx.ip}`;
  const [{ n }] = (await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM rate_events WHERE bucket = $1 AND at > now() - interval '15 minutes'`,
    [bucket],
  )) as [{ n: number }];
  if (n >= 5) throw tooMany('Too many wrong PINs. Wait 15 minutes and try again.');
  const s = await loadSettings(db);
  if (!(await verifyPin(pin, s.admin_pin_hash))) {
    await db.query('INSERT INTO rate_events (bucket) VALUES ($1)', [bucket]);
    throw new HttpError(401, 'wrong_pin', 'That PIN is not right');
  }
  await clearRateLimit(db, bucket);
  const session = issueStaffSession(s.admin_pin_hash);
  ctx.setHeaders.append('set-cookie', cookie(STAFF_COOKIE, session.value, session.maxAge));
  return json({ ok: true });
});

route('POST', '/api/admin/logout', async (ctx) => {
  ctx.setHeaders.append('set-cookie', cookie(STAFF_COOKIE, '', 0));
  return json({ ok: true });
});

route('GET', '/api/admin/session', async (ctx, db) => {
  const s = await loadSettings(db);
  return json({ authed: verifyStaffSession(getCookie(ctx.req, STAFF_COOKIE), s.admin_pin_hash) });
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
    customers: customers.map(toCustomer),
    activity: activity.map(toActivity),
    campaigns: campaigns.map(toCampaign),
    settings: toSettings(s),
  });
});

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
      pin: z.string().regex(/^\d{4,8}$/, 'PIN must be 4 to 8 digits').optional(),
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
    const session = issueStaffSession(pinHash);
    ctx.setHeaders.append('set-cookie', cookie(STAFF_COOKIE, session.value, session.maxAge));
  }
  return json({ settings: toSettings(row!) });
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
