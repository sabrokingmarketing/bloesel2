import { isDeployed, SetupError } from './env.js';
import { randomUUID } from 'node:crypto';
import { ZodError, type ZodType } from 'zod';

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, code = 'bad_request') => new HttpError(400, code, msg);
export const unauthorized = (msg = 'Sign in required') => new HttpError(401, 'unauthorized', msg);
export const notFound = (msg = 'Not found') => new HttpError(404, 'not_found', msg);
export const conflict = (msg: string, code = 'conflict') => new HttpError(409, code, msg);
export const tooMany = (msg: string) => new HttpError(429, 'rate_limited', msg);

export type Ctx = {
  req: Request;
  url: URL;
  params: Record<string, string>;
  requestId: string;
  ip: string;
  /** Headers to add to the response (cookies). */
  setHeaders: Headers;
};

export function json(data: unknown, status = 200, headers?: HeadersInit) {
  const h = new Headers(headers);
  h.set('content-type', 'application/json; charset=utf-8');
  h.set('cache-control', 'no-store');
  return new Response(JSON.stringify(data), { status, headers: h });
}

const MAX_BODY = 16 * 1024;

export async function body<T>(ctx: Ctx, schema: ZodType<T>): Promise<T> {
  // Requiring JSON blocks cross-site form posts, on top of SameSite=Strict cookies.
  if (!(ctx.req.headers.get('content-type') ?? '').includes('application/json')) {
    throw new HttpError(415, 'unsupported_media_type', 'Send JSON');
  }
  const text = await ctx.req.text();
  if (text.length > MAX_BODY) throw new HttpError(413, 'too_large', 'Request too large');
  let raw: unknown;
  try {
    raw = text ? JSON.parse(text) : {};
  } catch {
    throw badRequest('Invalid JSON');
  }
  return schema.parse(raw);
}

export function getCookie(req: Request, name: string) {
  const header = req.headers.get('cookie') ?? '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

export function cookie(name: string, value: string, maxAge: number) {
  const secure = isDeployed();
  return [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxAge}`, secure ? 'Secure' : '']
    .filter(Boolean)
    .join('; ');
}

export function clientIp(req: Request) {
  return (req.headers.get('x-forwarded-for') ?? '').split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'local';
}

export function newCtx(req: Request, params: Record<string, string> = {}): Ctx {
  return {
    req,
    url: new URL(req.url),
    params,
    requestId: req.headers.get('x-vercel-id') ?? randomUUID(),
    ip: clientIp(req),
    setHeaders: new Headers(),
  };
}

/** Converts thrown errors into safe JSON responses; never leaks internals. */
export function errorResponse(err: unknown, ctx: Ctx) {
  if (err instanceof HttpError) return json({ error: { code: err.code, message: err.message } }, err.status);
  if (err instanceof SetupError) {
    console.error(JSON.stringify({ level: 'error', requestId: ctx.requestId, path: ctx.url.pathname, msg: err.message }));
    return json({ error: { code: 'setup_required', message: `The loyalty server isn't set up yet. ${err.message}` } }, 503);
  }
  if (err instanceof ZodError) {
    const first = err.issues[0];
    return json({ error: { code: 'invalid', message: first ? `${first.path.join('.') || 'body'}: ${first.message}` : 'Invalid request' } }, 400);
  }
  const pgCode = (err as { code?: string })?.code;
  if (pgCode === '23505') return json({ error: { code: 'conflict', message: 'That already exists' } }, 409);
  console.error(JSON.stringify({ level: 'error', requestId: ctx.requestId, path: ctx.url.pathname, msg: (err as Error)?.message, stack: (err as Error)?.stack }));
  return json({ error: { code: 'internal', message: `Something went wrong. Reference ${ctx.requestId}` } }, 500);
}
