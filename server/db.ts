/**
 * Database access. Production uses Postgres over `pg` (e.g. Neon via the
 * Vercel Marketplace). Local dev and tests use PGlite, an embedded Postgres,
 * so the exact same SQL runs everywhere.
 */
import type { PGlite } from '@electric-sql/pglite';
import type { Pool, PoolClient } from 'pg';
import { isDeployed } from './env';

export type Row = Record<string, unknown>;

export interface Queryable {
  query<T extends Row = Row>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface Db extends Queryable {
  /** Runs fn in a transaction; rolls back if it throws. */
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

function fromPool(pool: Pool): Db {
  return {
    async query(sql, params) {
      return (await pool.query(sql, params as unknown[])).rows;
    },
    async tx(fn) {
      const client: PoolClient = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn({ query: async (sql, params) => (await client.query(sql, params as unknown[])).rows });
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

export function fromPglite(pg: PGlite): Db {
  // PGlite is single-connection; serialise transactions so they never interleave.
  let chain: Promise<unknown> = Promise.resolve();
  const q: Queryable = { query: async (sql, params) => (await pg.query(sql, params as unknown[])).rows as never };
  return {
    query: q.query,
    tx(fn) {
      const run = chain.then(() =>
        pg.transaction(async (t) => fn({ query: async (sql, params) => (await t.query(sql, params as unknown[])).rows as never })),
      );
      chain = run.catch(() => {});
      return run;
    },
    close: () => pg.close(),
  };
}

let instance: Promise<Db> | null = null;

export function getDb(): Promise<Db> {
  if (!instance) instance = connect();
  return instance;
}

/** Test hook: point the app at a specific database. */
export function setDb(db: Db | null) {
  instance = db ? Promise.resolve(db) : null;
}

async function connect(): Promise<Db> {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (url) {
    const { default: pg } = await import('pg');
    // Serverless: keep the pool small; use the provider's pooled connection string.
    return fromPool(new pg.Pool({ connectionString: url, max: 3, idleTimeoutMillis: 10_000 }));
  }
  if (isDeployed()) {
    throw new Error('DATABASE_URL is not set. Add a Postgres database (e.g. Neon) to the Vercel project.');
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const dir = process.env.PGLITE_DIR ?? '.data/pglite';
  console.info(JSON.stringify({ level: 'info', msg: 'Using embedded PGlite database for local development', dir }));
  return fromPglite(new PGlite(dir));
}
