/**
 * Loads the sample café data into the database (local PGlite by default, or
 * DATABASE_URL). Refuses to touch a database that already has members.
 *
 *   npm run db:seed
 *   DATABASE_URL=postgres://… npm run db:seed
 */
import { createSeed, DEMO_CUSTOMER_ID } from '../src/data/seed';
import { getDb } from '../server/db';
import { ensureSchema } from '../server/schema';
import { hashToken, newToken, phoneKey } from '../server/security';

async function main() {
  const db = await getDb();
  await ensureSchema(db);
  const [{ n }] = (await db.query<{ n: number }>('SELECT count(*)::int AS n FROM customers')) as [{ n: number }];
  if (n > 0) {
    console.error(`Refusing to seed: the database already has ${n} members.`);
    process.exit(1);
  }

  const seed = createSeed();
  const ids = new Map<string, string>();
  const used = new Set<string>();

  await db.tx(async (q) => {
    for (const c of seed.customers) {
      const key = phoneKey(c.phone)!;
      if (used.has(key)) continue; // the generator can repeat a number; keep the first
      used.add(key);
      const [row] = await q.query<{ id: string }>(
        `INSERT INTO customers (code, name, phone, phone_key, email, stamps, total_stamps, rewards_earned,
           rewards_redeemed, favourite, joined_at, last_visit)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [c.code, c.name, c.phone, key, c.email ?? null, c.stamps, c.totalStamps, c.rewardsEarned, c.rewardsRedeemed, c.favourite ?? null, c.joinedAt, c.lastVisit ?? null],
      );
      ids.set(c.id, row!.id);
    }
    for (const a of seed.activity) {
      const cid = ids.get(a.customerId);
      if (!cid) continue;
      await q.query('INSERT INTO activity (customer_id, type, at, drink, delta, note) VALUES ($1,$2,$3,$4,$5,$6)', [
        cid,
        a.type,
        a.at,
        a.drink ?? null,
        a.delta ?? null,
        a.note ?? null,
      ]);
    }
    for (const c of seed.campaigns) {
      await q.query('INSERT INTO campaigns (name, kind, target_url, placement, scans, active, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)', [
        c.name,
        c.kind,
        c.kind === 'join' ? null : c.url,
        c.placement,
        c.scans,
        c.active,
        c.createdAt,
      ]);
    }
  });

  // A 30-day link that puts the demo card (Lerato, 7 of 10) on whichever phone opens it.
  const token = newToken();
  await db.query(`INSERT INTO transfer_tokens (token_hash, customer_id, expires_at) VALUES ($1, $2, now() + interval '30 days')`, [
    hashToken(token),
    ids.get(DEMO_CUSTOMER_ID),
  ]);
  console.log(`Seeded ${ids.size} members, ${seed.campaigns.length} QR codes.`);
  console.log(`Open the demo card (one phone, valid 30 days): /app/claim#${token}`);
  await db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
