/**
 * Re-maps the colours of a Lottie animation onto the Bloeisel palette.
 * Walks every colour property (static and keyframed) and swaps any colour
 * that sits close to a source swatch for its brand counterpart.
 */
type RGB = [number, number, number];

const hex = (h: string): RGB => {
  const n = parseInt(h.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

export type ColorMap = Array<[from: string, to: string]>;

/** Source palette of "Coffee Break" -> Bloeisel brand colours. */
export const COFFEE_BREAK_BRAND_MAP: ColorMap = [
  ['#092821', '#2e1a16'], // dark green ink outlines -> espresso
  ['#fc53c3', '#d9617f'], // hot pink -> Bloeisel rose
  ['#ae9dff', '#f5c7d2'], // lavender sleeves/cup -> blush
  ['#ddf30a', '#e8b974'], // lime accents -> caramel
  ['#c55852', '#b06a52'], // warm skin -> cocoa-warm skin
  ['#eadcdc', '#f7e8e2'], // pale skin, steam, cup -> latte cream
];

function close(a: number[], b: RGB) {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 0.06;
}

function mapColor(arr: unknown, pairs: Array<[RGB, RGB]>) {
  if (!Array.isArray(arr) || arr.length < 3 || typeof arr[0] !== 'number') return;
  for (const [from, to] of pairs) {
    if (close(arr as number[], from)) {
      arr[0] = to[0];
      arr[1] = to[1];
      arr[2] = to[2];
      return;
    }
  }
}

export function recolorLottie<T>(data: T, map: ColorMap = COFFEE_BREAK_BRAND_MAP): T {
  const copy = JSON.parse(JSON.stringify(data));
  const pairs = map.map(([f, t]) => [hex(f), hex(t)] as [RGB, RGB]);

  const walk = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
    // Shape fills/strokes: { ty: 'fl'|'st', c: { a, k } }
    const c = obj.c as { a?: number; k?: unknown } | undefined;
    if (c && typeof c === 'object' && 'k' in c) {
      if (c.a === 1 && Array.isArray(c.k)) {
        for (const kf of c.k as Array<{ s?: unknown; e?: unknown }>) {
          mapColor(kf.s, pairs);
          mapColor(kf.e, pairs);
        }
      } else {
        mapColor(c.k, pairs);
      }
    }
    for (const key in obj) walk(obj[key]);
  };

  walk(copy);
  return copy;
}
