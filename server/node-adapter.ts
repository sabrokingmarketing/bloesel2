import type { IncomingMessage, ServerResponse } from 'node:http';
import { handle } from './routes.js';

/** Connect-style middleware so the Vite dev/preview server answers /api and /q like Vercel does. */
export async function nodeMiddleware(req: IncomingMessage, res: ServerResponse, next: () => void) {
  const path = (req.url ?? '/').split('?')[0]!;
  if (!path.startsWith('/api/') && !path.startsWith('/q/')) return next();
  try {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
      else if (v != null) headers.set(k, v);
    }
    const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
    const response = await handle(
      new Request(`http://${req.headers.host ?? 'localhost'}${req.url}`, {
        method: req.method,
        headers,
        body: hasBody ? Buffer.concat(chunks) : undefined,
      }),
    );
    res.statusCode = response.status;
    response.headers.forEach((v, k) => {
      if (k === 'set-cookie') return;
      res.setHeader(k, v);
    });
    const cookies = response.headers.getSetCookie();
    if (cookies.length) res.setHeader('set-cookie', cookies);
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (err) {
    console.error(err);
    res.statusCode = 500;
    res.end('Internal error');
  }
}
