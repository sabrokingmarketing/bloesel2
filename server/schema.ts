import { isDeployed, SetupError } from './env.js';
/**
 * Schema migrations. Append-only: never edit a migration once it has shipped,
 * add a new one. Applied automatically on first request under an advisory lock,
 * so concurrent cold starts can't race each other.
 */
import type { Db } from './db.js';
import { hashPin, newCounterCode } from './security.js';

const MIGRATIONS: Array<{ id: number; name: string; sql: string }> = [
  {
    id: 1,
    name: 'initial',
    sql: `
      CREATE TABLE customers (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        code text NOT NULL UNIQUE CHECK (code ~ '^BK-[A-Z2-9]{6}$'),
        name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 80),
        phone text NOT NULL CHECK (char_length(phone) <= 32),
        phone_key text NOT NULL UNIQUE CHECK (phone_key ~ '^[0-9]{9}$'),
        email text CHECK (email IS NULL OR char_length(email) <= 254),
        marketing_opt_in boolean NOT NULL DEFAULT false,
        stamps integer NOT NULL DEFAULT 0 CHECK (stamps >= 0),
        total_stamps integer NOT NULL DEFAULT 0 CHECK (total_stamps >= 0),
        rewards_earned integer NOT NULL DEFAULT 0 CHECK (rewards_earned >= 0),
        rewards_redeemed integer NOT NULL DEFAULT 0 CHECK (rewards_redeemed >= 0),
        favourite text,
        joined_at timestamptz NOT NULL DEFAULT now(),
        last_visit timestamptz,
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE activity (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        type text NOT NULL CHECK (type IN ('join', 'stamp', 'redeem', 'adjust')),
        at timestamptz NOT NULL DEFAULT now(),
        drink text,
        delta integer,
        note text,
        -- Lets the till retry a request without double-stamping.
        idempotency_key text UNIQUE
      );
      CREATE INDEX activity_customer_at ON activity (customer_id, at DESC);
      CREATE INDEX activity_at ON activity (at DESC);

      -- A card is bound to the phones that hold one of its device tokens. Only hashes are stored.
      CREATE TABLE device_tokens (
        token_hash text PRIMARY KEY,
        customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        created_at timestamptz NOT NULL DEFAULT now(),
        last_seen_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX device_tokens_customer ON device_tokens (customer_id);

      -- One-time links that move a card to a new phone.
      CREATE TABLE transfer_tokens (
        token_hash text PRIMARY KEY,
        customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        expires_at timestamptz NOT NULL,
        used_at timestamptz
      );
      CREATE INDEX transfer_tokens_customer ON transfer_tokens (customer_id);

      CREATE TABLE campaigns (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 80),
        kind text NOT NULL CHECK (kind IN ('join', 'menu', 'custom')),
        target_url text,
        placement text NOT NULL DEFAULT '',
        scans integer NOT NULL DEFAULT 0 CHECK (scans >= 0),
        active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        CHECK (kind = 'join' OR target_url IS NOT NULL)
      );

      CREATE TABLE settings (
        id integer PRIMARY KEY CHECK (id = 1),
        store_name text NOT NULL,
        stamps_required integer NOT NULL CHECK (stamps_required BETWEEN 5 AND 12),
        reward_name text NOT NULL,
        admin_pin_hash text NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE rate_events (
        bucket text NOT NULL,
        at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX rate_events_bucket_at ON rate_events (bucket, at);
    `,
  },
  {
    id: 2,
    name: 'counter_qr',
    sql: `
      ALTER TABLE settings ADD COLUMN counter_code text;
      ALTER TABLE settings ADD COLUMN self_scan_enabled boolean NOT NULL DEFAULT true;
      ALTER TABLE settings ADD COLUMN self_scan_cooldown_minutes integer NOT NULL DEFAULT 180
        CHECK (self_scan_cooldown_minutes BETWEEN 0 AND 1440)
    `,
  }
];

let ready: Promise<void> | null = null;

export function ensureSchema(db: Db): Promise<void> {
  if (!ready) {
    ready = migrate(db).catch((err) => {
      ready = null; // allow a later request to retry
      throw err;
    });
  }
  return ready;
}

/** Test hook. */
export function resetSchemaCache() {
  ready = null;
}

async function migrate(db: Db) {
  await db.tx(async (q) => {
    await q.query('SELECT pg_advisory_xact_lock(7426001)');
    await q.query('CREATE TABLE IF NOT EXISTS schema_migrations (id integer PRIMARY KEY, name text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    const done = new Set((await q.query<{ id: number }>('SELECT id FROM schema_migrations')).map((r) => r.id));
    for (const m of MIGRATIONS) {
      if (done.has(m.id)) continue;
      for (const stmt of m.sql.split(/;\s*\n/).map((x) => x.trim()).filter(Boolean)) await q.query(stmt);
      await q.query('INSERT INTO schema_migrations (id, name) VALUES ($1, $2)', [m.id, m.name]);
      console.info(JSON.stringify({ level: 'info', msg: 'migration applied', id: m.id, name: m.name }));
    }

    const hasSettings = (await q.query('SELECT 1 FROM settings WHERE id = 1')).length > 0;
    if (!hasSettings) {
      const pin = process.env.ADMIN_PIN;
      const isProd = isDeployed();
      if (!pin && isProd) throw new SetupError('ADMIN_PIN is not set. In Vercel, add it under Settings → Environment Variables (4 to 8 digits), then redeploy.');
      await q.query(
        `INSERT INTO settings (id, store_name, stamps_required, reward_name, admin_pin_hash)
         VALUES (1, 'Bloeisel Koffie', 10, 'Any coffee, on us', $1)`,
        [await hashPin(pin ?? '1234')],
      );
    }
    // The printed counter QR carries this code. It is random, and staff can replace it at any time.
    await q.query('UPDATE settings SET counter_code = $1 WHERE id = 1 AND counter_code IS NULL', [newCounterCode()]);
  });
}
