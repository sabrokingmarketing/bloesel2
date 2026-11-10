import QRCode from 'qrcode';

export type QRMatrix = { size: number; get: (x: number, y: number) => boolean };

export function qrMatrix(text: string): QRMatrix {
  // High error correction leaves room for the blossom mark in the centre.
  const qr = QRCode.create(text, { errorCorrectionLevel: 'H' });
  const { size, data } = qr.modules;
  return { size, get: (x, y) => x >= 0 && y >= 0 && x < size && y < size && !!data[y * size + x] };
}

/** Draws a branded QR onto a canvas (for PNG download / print). */
export async function qrToPngDataUrl(
  text: string,
  opts: { size?: number; fg?: string; bg?: string; title?: string; subtitle?: string } = {},
) {
  const { size = 1200, fg = '#2e1a16', bg = '#ffffff', title, subtitle } = opts;
  const m = qrMatrix(text);
  const pad = size * 0.09;
  const footer = title ? size * 0.2 : 0;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size + footer;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const cell = (size - pad * 2) / m.size;
  ctx.fillStyle = fg;
  const inFinder = (x: number, y: number) =>
    (x < 7 && y < 7) || (x >= m.size - 7 && y < 7) || (x < 7 && y >= m.size - 7);
  const c0 = m.size / 2;
  const hole = m.size * 0.13;
  for (let y = 0; y < m.size; y++)
    for (let x = 0; x < m.size; x++) {
      if (!m.get(x, y) || inFinder(x, y)) continue;
      if (Math.abs(x + 0.5 - c0) < hole && Math.abs(y + 0.5 - c0) < hole) continue;
      ctx.beginPath();
      ctx.arc(pad + (x + 0.5) * cell, pad + (y + 0.5) * cell, cell * 0.43, 0, Math.PI * 2);
      ctx.fill();
    }
  const rr = (x: number, y: number, w: number, r: number) => {
    ctx.beginPath();
    ctx.roundRect(x, y, w, w, r);
    ctx.fill();
  };
  for (const [fx, fy] of [
    [0, 0],
    [m.size - 7, 0],
    [0, m.size - 7],
  ]) {
    const x = pad + fx * cell;
    const y = pad + fy * cell;
    ctx.fillStyle = fg;
    rr(x, y, cell * 7, cell * 2.2);
    ctx.fillStyle = bg;
    rr(x + cell, y + cell, cell * 5, cell * 1.5);
    ctx.fillStyle = fg;
    rr(x + cell * 2, y + cell * 2, cell * 3, cell * 0.9);
  }
  // Centre blossom
  const cx = size / 2;
  const r = cell * hole * 0.95;
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.arc(cx, cx, r * 1.15, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#d9617f';
  for (let i = 0; i < 5; i++) {
    ctx.save();
    ctx.translate(cx, cx);
    ctx.rotate((i * 2 * Math.PI) / 5);
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.48, r * 0.34, r * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = '#2e1a16';
  ctx.beginPath();
  ctx.ellipse(cx, cx, r * 0.26, r * 0.34, -0.45, 0, Math.PI * 2);
  ctx.fill();

  if (title) {
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.font = `600 ${size * 0.055}px Fraunces, Georgia, serif`;
    ctx.fillText(title, cx, size + footer * 0.38);
    if (subtitle) {
      ctx.globalAlpha = 0.6;
      ctx.font = `500 ${size * 0.03}px Poppins, sans-serif`;
      ctx.fillText(subtitle, cx, size + footer * 0.68);
      ctx.globalAlpha = 1;
    }
  }
  return canvas.toDataURL('image/png');
}

export function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function absoluteUrl(path: string) {
  if (/^https?:\/\//.test(path)) return path;
  return new URL(path, window.location.origin).toString();
}
