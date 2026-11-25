import { isDeployed, SetupError } from './env.js';
import { createHash, createHmac, randomBytes, randomInt, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Db, Queryable } from './db.js';

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

/** The secret in the printed counter QR: 120 random bits, URL-safe. */
export function newCounterCode() {
  return randomBytes(15).toString('base64url');
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/* ---------- Customer card session ---------- */

/** HttpOnly cookie holding the phone's device token. */
export const CARD_COOKIE = 'bk_card';
/** Members stay signed in this long after their last visit (sliding). */
export const CARD_SESSION_DAYS = 120;

/** Rejects PINs that are trivially guessed: all one digit, or a straight run like 1234 or 9876. */
export function weakPin(pin: string) {
  if (/^(\d)\1+$/.test(pin)) return true;
  const d = pin.split('').map(Number);
  const up = d.every((x, i) => i === 0 || x === (d[i - 1]! + 1) % 10);
  const down = d.every((x, i) => i === 0 || x === (d[i - 1]! + 9) % 10);
  return up || down;
}

/** "lerato@example.com" -> "l•••••@example.com". Staff screens never get full addresses. */
export function maskEmail(email: string | null | undefined) {
  if (!email) return undefined;
  const at = email.indexOf('@');
  if (at < 1) return '•••';
  return `${email[0]}${'•'.repeat(Math.max(3, Math.min(8, at - 1)))}${email.slice(at)}`;
}

/* ---------- Staff session cookie ---------- */

export const STAFF_COOKIE = 'bk_staff';
const DAY_MS = 86_400_000;
/** A till stays signed in while it's used at least once every 30 days. */
export const STAFF_SESSION_IDLE_DAYS = 30;
/** However often it's used, a till must re-enter the PIN 90 days after signing in. */
export const STAFF_SESSION_MAX_DAYS = 90;
/** Re-issue the cookie at most once a day, so polling doesn't send a new one every 10 seconds. */
const STAFF_SESSION_RENEW_MS = DAY_MS;
const STAFF_TOKEN_VERSION = 'v2';

function sessionSecret() {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 32) return s;
  if (isDeployed()) {
    throw new SetupError('SESSION_SECRET is not set. In Vercel, add it under Settings → Environment Variables (32+ random characters), then redeploy.');
  }
  return 'dev-only-session-secret-change-me-0000000000';
}

function sign(payload: string) {
  // Domain-separated, so a signature made for anything else can never pass as a staff session.
  return createHmac('sha256', sessionSecret()).update(`bk-staff-session:${payload}`).digest('base64url');
}

export type StaffSession = { issuedAt: number; expiresAt: number };

/**
 * Session = format version + sign-in time + expiry + PIN version, HMAC-signed.
 * The PIN version covers the PIN hash and a session epoch, so changing the PIN
 * or "sign out all tills" ends every session at once. The expiry slides forward
 * with use (see renewStaffSession) but never past STAFF_SESSION_MAX_DAYS after sign-in.
 */
export function issueStaffSession(pinHash: string, epoch = 0, now = Date.now(), issuedAt = now) {
  const expiresAt = Math.min(now + STAFF_SESSION_IDLE_DAYS * DAY_MS, issuedAt + STAFF_SESSION_MAX_DAYS * DAY_MS);
  const payload = `${STAFF_TOKEN_VERSION}.${issuedAt}.${expiresAt}.${pinVersion(pinHash, epoch)}`;
  return { value: `${payload}.${sign(payload)}`, maxAge: Math.max(0, Math.floor((expiresAt - now) / 1000)) };
}

/** Returns the session when the cookie is genuine, current and matches today's PIN; otherwise null. */
export function verifyStaffSession(value: string | undefined, pinHash: string, epoch = 0, now = Date.now()): StaffSession | null {
  if (!value || value.length > 200) return null;
  const i = value.lastIndexOf('.');
  if (i < 0) return null;
  const payload = value.slice(0, i);
  const sig = Buffer.from(value.slice(i + 1));
  const want = Buffer.from(sign(payload));
  if (sig.length !== want.length || !timingSafeEqual(sig, want)) return null;
  const parts = payload.split('.');
  if (parts.length !== 4 || parts[0] !== STAFF_TOKEN_VERSION) return null;
  const issuedAt = Number(parts[1]);
  const expiresAt = Number(parts[2]);
  if (!Number.isSafeInteger(issuedAt) || !Number.isSafeInteger(expiresAt)) return null;
  if (issuedAt > now + 60_000) return null; // allow a minute of clock skew between serverless instances
  if (expiresAt <= now || expiresAt > issuedAt + STAFF_SESSION_MAX_DAYS * DAY_MS) return null;
  if (parts[3] !== pinVersion(pinHash, epoch)) return null;
  return { issuedAt, expiresAt };
}

/**
 * Sliding expiry: once a day, a till that's in use gets a fresh 30 days
 * (capped at 90 days from sign-in). Returns the new cookie, or null when no renewal is due.
 */
export function renewStaffSession(session: StaffSession, pinHash: string, epoch = 0, now = Date.now()) {
  const fullExpiry = Math.min(now + STAFF_SESSION_IDLE_DAYS * DAY_MS, session.issuedAt + STAFF_SESSION_MAX_DAYS * DAY_MS);
  if (fullExpiry - session.expiresAt < STAFF_SESSION_RENEW_MS) return null;
  return issueStaffSession(pinHash, epoch, now, session.issuedAt);
}

function pinVersion(pinHash: string, epoch: number) {
  return createHash('sha256').update(`${pinHash}:${epoch}`).digest('base64url').slice(0, 10);
}

/* ---------- Rate limiting (DB-backed, works across serverless instances) ---------- */

/**
 * Atomically records one attempt in `bucket` unless it already holds `limit`
 * within `windowSec`; returns false when the attempt is refused. A per-bucket
 * advisory lock makes count-and-insert one step, so parallel requests can't
 * all slip in before any is counted. Call it BEFORE checking a PIN.
 */
export async function takeAttempt(q: Db | Queryable, bucket: string, limit: number, windowSec: number) {
  const run = async (t: Queryable) => {
    await t.query('SELECT pg_advisory_xact_lock(hashtext($1))', [bucket]);
    const [row] = await t.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM rate_events WHERE bucket = $1 AND at > now() - make_interval(secs => $2)`,
      [bucket, windowSec],
    );
    if ((row?.n ?? 0) >= limit) return false;
    await t.query('INSERT INTO rate_events (bucket) VALUES ($1)', [bucket]);
    return true;
  };
  const allowed = 'tx' in q ? await (q as Db).tx(run) : await run(q);
  // Opportunistic cleanup keeps the table small without a cron job.
  if (Math.random() < 0.02) await q.query(`DELETE FROM rate_events WHERE at < now() - interval '2 days'`);
  return allowed;
}

/** True when the bucket is over its limit (and records the attempt otherwise). */
export async function hitRateLimit(q: Db | Queryable, bucket: string, limit: number, windowSec: number) {
  return !(await takeAttempt(q, bucket, limit, windowSec));
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
