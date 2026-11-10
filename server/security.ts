import { isDeployed } from './env';
import { createHash, createHmac, randomBytes, randomInt, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Queryable } from './db';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

/* ---------- Staff PIN ---------- */

export async function hashPin(pin: string) {
  const salt = randomBytes(16);
  const key = await scrypt(pin, salt, 32);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPin(pin: string, stored: string) {
  const [alg, saltB64, keyB64] = stored.split('$');
  if (alg !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const actual = await scrypt(pin, Buffer.from(saltB64, 'base64'), expected.length);
  return timingSafeEqual(actual, expected);
}

/* ---------- Opaque tokens (device + transfer) ---------- */

/** 256-bit random bearer token. Only its SHA-256 is ever stored. */
export function newToken() {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

/* ---------- Staff session cookie ---------- */

export const STAFF_COOKIE = 'bk_staff';
const STAFF_SESSION_HOURS = 12;

function sessionSecret() {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 32) return s;
  if (isDeployed()) {
    throw new Error('SESSION_SECRET must be set (32+ random characters) to sign staff sessions.');
  }
  return 'dev-only-session-secret-change-me-0000000000';
}

function sign(payload: string) {
  return createHmac('sha256', sessionSecret()).update(payload).digest('base64url');
}

/** Session = expiry + PIN-version, signed. Changing the PIN logs every till out. */
export function issueStaffSession(pinHash: string, now = Date.now()) {
  const exp = now + STAFF_SESSION_HOURS * 3600_000;
  const payload = `${exp}.${pinVersion(pinHash)}`;
  return { value: `${payload}.${sign(payload)}`, maxAge: STAFF_SESSION_HOURS * 3600 };
}

export function verifyStaffSession(value: string | undefined, pinHash: string, now = Date.now()) {
  if (!value) return false;
  const i = value.lastIndexOf('.');
  if (i < 0) return false;
  const payload = value.slice(0, i);
  const sig = Buffer.from(value.slice(i + 1));
  const want = Buffer.from(sign(payload));
  if (sig.length !== want.length || !timingSafeEqual(sig, want)) return false;
  const [exp, ver] = payload.split('.');
  return Number(exp) > now && ver === pinVersion(pinHash);
}

function pinVersion(pinHash: string) {
  return createHash('sha256').update(pinHash).digest('base64url').slice(0, 10);
}

/* ---------- Rate limiting (DB-backed, works across serverless instances) ---------- */

/** Records one event and reports whether the bucket is over `limit` within `windowSec`. */
export async function hitRateLimit(q: Queryable, bucket: string, limit: number, windowSec: number) {
  const rows = await q.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM rate_events WHERE bucket = $1 AND at > now() - make_interval(secs => $2)`,
    [bucket, windowSec],
  );
  if ((rows[0]?.n ?? 0) >= limit) return true;
  await q.query('INSERT INTO rate_events (bucket) VALUES ($1)', [bucket]);
  // Opportunistic cleanup keeps the table small without a cron job.
  if (Math.random() < 0.02) await q.query(`DELETE FROM rate_events WHERE at < now() - interval '1 day'`);
  return false;
}

export async function clearRateLimit(q: Queryable, bucket: string) {
  await q.query('DELETE FROM rate_events WHERE bucket = $1', [bucket]);
}

/* ---------- Identifiers ---------- */

/** Last nine digits: "+27 82 123 4567" and "082 123 4567" are the same number. */
export function phoneKey(phone: string) {
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 9 && digits.length <= 15 ? digits.slice(-9) : null;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function memberCode() {
  let s = '';
  for (let i = 0; i < 6; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `BK-${s}`;
}
