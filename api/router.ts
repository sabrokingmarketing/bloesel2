/**
 * Vercel Function: every /api/* and /q/* request is rewritten here (see vercel.json)
 * with the original path in `__path`.
 */
import { handle } from '../server/routes.js';

async function entry(request: Request) {
  const url = new URL(request.url);
  const original = url.searchParams.get('__path');
  if (!original) return handle(request);
  url.pathname = original;
  url.searchParams.delete('__path');
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  return handle(
    new Request(url, { method: request.method, headers: request.headers, body: hasBody ? await request.arrayBuffer() : undefined }),
  );
}

export const GET = entry;
export const POST = entry;
export const PATCH = entry;
export const DELETE = entry;
