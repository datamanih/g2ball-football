// Drawing toolkit for the graphical glasses screens (576×288, greyscale, black = see-through).
// Screens are drawn into one canvas, cut into four 288×144 tiles and sent as images; only changed tiles are resent.

export const W = 576, H = 288;
export const FG = '#ffffff', DIM = '#9c9c9c', FAINT = '#4a4a4a', BG = '#000000';
const FONT = `'Helvetica Neue', Roboto, 'DejaVu Sans', Arial, sans-serif`;

export function surface() {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = BG; g.fillRect(0, 0, W, H);
  g.textBaseline = 'alphabetic';
  return { c, g };
}

export type Align = 'left' | 'center' | 'right';
export interface TextOpts { size?: number; weight?: number; color?: string; align?: Align; maxW?: number }

export function setFont(g: CanvasRenderingContext2D, size: number, weight = 700) { g.font = `${weight} ${size}px ${FONT}`; }

/** Draws text (y = baseline), shrinking up to 15% then truncating with … to fit maxW. Returns drawn width. */
export function text(g: CanvasRenderingContext2D, s: string, x: number, y: number, o: TextOpts = {}) {
  let size = o.size ?? 18;
  const weight = o.weight ?? 700, maxW = o.maxW ?? 9999;
  setFont(g, size, weight);
  while (g.measureText(s).width > maxW && size > (o.size ?? 18) * 0.85) setFont(g, --size, weight);
  let str = s;
  if (g.measureText(str).width > maxW) {
    while (str.length > 1 && g.measureText(str + '…').width > maxW) str = str.slice(0, -1);
    str = str.trimEnd() + '…';
  }
  g.fillStyle = o.color ?? FG; g.textAlign = o.align ?? 'left';
  g.fillText(str, x, y);
  return g.measureText(str).width;
}
export function measure(g: CanvasRenderingContext2D, s: string, size: number, weight = 700) { setFont(g, size, weight); return g.measureText(s).width; }

export function rr(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
export function box(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, o: { r?: number; fill?: string; stroke?: string; lw?: number } = {}) {
  rr(g, x, y, w, h, o.r ?? 8);
  if (o.fill) { g.fillStyle = o.fill; g.fill(); }
  if (o.stroke) { g.strokeStyle = o.stroke; g.lineWidth = o.lw ?? 2; g.stroke(); }
}
/** Selection ring used on every graphical screen. */
export function selRing(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r = 10) {
  box(g, x + 1, y + 1, w - 2, h - 2, { r, stroke: FG, lw: 3 });
}

/** Rounded label. `solid` = white fill with black text (used for LIVE and the selected state). Returns width. */
export function pill(g: CanvasRenderingContext2D, s: string, x: number, y: number, o: { size?: number; solid?: boolean; align?: Align; h?: number; color?: string } = {}) {
  const size = o.size ?? 14, h = o.h ?? size + 10, w = measure(g, s, size) + size;
  const x0 = o.align === 'right' ? x - w : o.align === 'center' ? x - w / 2 : x;
  box(g, x0, y, w, h, { r: h / 2, fill: o.solid ? (o.color ?? FG) : undefined, stroke: o.solid ? undefined : (o.color ?? DIM), lw: 2 });
  text(g, s, x0 + w / 2, y + h / 2 + size * 0.36, { size, align: 'center', color: o.solid ? BG : (o.color ?? FG) });
  return w;
}

/** Top bar: title on the left, optional right-hand label, thin rule underneath. */
export function header(g: CanvasRenderingContext2D, title: string, right?: string, live = false) {
  text(g, title.toUpperCase(), 12, 25, { size: 17, weight: 800, maxW: right ? 360 : 552 });
  if (right) {
    if (live) pill(g, right, W - 10, 6, { size: 13, solid: true, align: 'right', h: 24 });
    else text(g, right, W - 12, 25, { size: 15, weight: 600, color: DIM, align: 'right', maxW: 200 });
  }
  g.fillStyle = FAINT; g.fillRect(10, 36, W - 20, 2);
}

/** Footer hint, bottom-centre. */
export function hint(g: CanvasRenderingContext2D, s: string) { text(g, s, W / 2, H - 6, { size: 12, weight: 600, color: DIM, align: 'center' }); }

/** Draws a converted badge (white-on-transparent canvas) scaled to `size`. */
export function badge(g: CanvasRenderingContext2D, b: HTMLCanvasElement | null | undefined, x: number, y: number, size: number) {
  if (!b) { g.strokeStyle = FAINT; g.lineWidth = 2; g.beginPath(); g.arc(x + size / 2, y + size / 2, size / 2 - 2, 0, Math.PI * 2); g.stroke(); return; }
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  g.drawImage(b, x, y, size, size);
}

/** Form guide: W = filled square, D = white outline, L = faint outline; letter in each. */
export function form(g: CanvasRenderingContext2D, results: string[], x: number, y: number, s = 24, gap = 6) {
  results.forEach((r, i) => {
    const bx = x + i * (s + gap);
    if (r === 'W') box(g, bx, y, s, s, { r: 4, fill: FG });
    else if (r === 'D') box(g, bx, y, s, s, { r: 4, stroke: FG, lw: 2 });
    else box(g, bx, y, s, s, { r: 4, stroke: FAINT, lw: 2 });
    text(g, r, bx + s / 2, y + s * 0.73, { size: s * 0.6, weight: 800, align: 'center', color: r === 'W' ? BG : r === 'D' ? FG : DIM });
  });
}

// ---------- icons (drawn, so they stay crisp at any size) ----------
type Icon = (g: CanvasRenderingContext2D, cx: number, cy: number, s: number, color: string) => void;
const stroke = (g: CanvasRenderingContext2D, color: string, lw: number) => { g.strokeStyle = color; g.fillStyle = color; g.lineWidth = lw; g.lineCap = 'round'; g.lineJoin = 'round'; };

export const iconStar: Icon = (g, cx, cy, s, c) => {
  stroke(g, c, s / 12); g.beginPath();
  for (let i = 0; i < 10; i++) { const r = i % 2 ? s * 0.22 : s * 0.5, a = -Math.PI / 2 + (i * Math.PI) / 5; g.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a)); }
  g.closePath(); g.fill();
};
export const iconStarOutline: Icon = (g, cx, cy, s, c) => {
  stroke(g, c, Math.max(1.5, s / 10)); g.beginPath();
  for (let i = 0; i < 10; i++) { const r = i % 2 ? s * 0.22 : s * 0.5, a = -Math.PI / 2 + (i * Math.PI) / 5; g.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a)); }
  g.closePath(); g.stroke();
};
export const iconLive: Icon = (g, cx, cy, s, c) => {
  stroke(g, c, s / 11);
  g.beginPath(); g.arc(cx, cy, s * 0.12, 0, Math.PI * 2); g.fill();
  for (const r of [0.28, 0.45]) for (const side of [-1, 1]) {
    g.beginPath(); g.arc(cx, cy, s * r, side < 0 ? Math.PI * 0.75 : -Math.PI * 0.25, side < 0 ? Math.PI * 1.25 : Math.PI * 0.25); g.stroke();
  }
};
export const iconCalendar: Icon = (g, cx, cy, s, c) => {
  stroke(g, c, s / 12);
  box(g, cx - s * 0.42, cy - s * 0.34, s * 0.84, s * 0.76, { r: s * 0.08, stroke: c, lw: s / 12 });
  g.fillRect(cx - s * 0.42, cy - s * 0.34, s * 0.84, s * 0.18);
  for (const dx of [-0.22, 0.22]) { g.beginPath(); g.moveTo(cx + dx * s, cy - s * 0.46); g.lineTo(cx + dx * s, cy - s * 0.26); g.stroke(); }
  for (let r = 0; r < 2; r++) for (let k = 0; k < 3; k++) g.fillRect(cx - s * 0.27 + k * s * 0.21, cy - s * 0.04 + r * s * 0.2, s * 0.12, s * 0.1);
};
export const iconTrophy: Icon = (g, cx, cy, s, c) => {
  stroke(g, c, s / 12);
  g.beginPath(); g.moveTo(cx - s * 0.3, cy - s * 0.42); g.lineTo(cx + s * 0.3, cy - s * 0.42);
  g.quadraticCurveTo(cx + s * 0.3, cy + s * 0.08, cx, cy + s * 0.1); g.quadraticCurveTo(cx - s * 0.3, cy + s * 0.08, cx - s * 0.3, cy - s * 0.42); g.fill();
  for (const sd of [-1, 1]) { g.beginPath(); g.arc(cx + sd * s * 0.3, cy - s * 0.22, s * 0.13, sd < 0 ? Math.PI * 0.5 : -Math.PI * 0.5, sd < 0 ? Math.PI * 1.5 : Math.PI * 0.5, sd > 0 ? false : false); g.stroke(); }
  g.fillRect(cx - s * 0.05, cy + s * 0.08, s * 0.1, s * 0.2);
  g.fillRect(cx - s * 0.22, cy + s * 0.28, s * 0.44, s * 0.12);
};
export const iconPyramid: Icon = (g, cx, cy, s, c) => {
  stroke(g, c, s / 12);
  const rows = [0.18, 0.36, 0.54], h = s * 0.2;
  rows.forEach((w, i) => box(g, cx - w * s, cy - s * 0.42 + i * (h + s * 0.08), w * 2 * s, h, { r: 3, fill: i === 2 ? c : undefined, stroke: c, lw: s / 14 }));
};
export const iconGoal: Icon = (g, cx, cy, s, c) => {
  stroke(g, c, s / 11);
  g.beginPath(); g.moveTo(cx - s * 0.45, cy + s * 0.32); g.lineTo(cx - s * 0.45, cy - s * 0.3); g.lineTo(cx + s * 0.45, cy - s * 0.3); g.lineTo(cx + s * 0.45, cy + s * 0.32); g.stroke();
  g.lineWidth = s / 30;
  for (let k = 1; k < 5; k++) { const x = cx - s * 0.45 + k * s * 0.18; g.beginPath(); g.moveTo(x, cy - s * 0.3); g.lineTo(x, cy + s * 0.18); g.stroke(); }
  for (let k = 1; k < 3; k++) { const y = cy - s * 0.3 + k * s * 0.16; g.beginPath(); g.moveTo(cx - s * 0.45, y); g.lineTo(cx + s * 0.45, y); g.stroke(); }
  iconBall(g, cx + s * 0.2, cy + s * 0.3, s * 0.3, c);
};
export const iconBall: Icon = (g, cx, cy, s, c) => {
  g.fillStyle = BG; g.beginPath(); g.arc(cx, cy, s / 2, 0, Math.PI * 2); g.fill();
  stroke(g, c, Math.max(1.5, s / 10)); g.beginPath(); g.arc(cx, cy, s / 2 - g.lineWidth / 2, 0, Math.PI * 2); g.stroke();
  g.beginPath();
  for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5; g.lineTo(cx + s * 0.18 * Math.cos(a), cy + s * 0.18 * Math.sin(a)); }
  g.closePath(); g.fill();
};
export const iconPin: Icon = (g, cx, cy, s, c) => {
  stroke(g, c, s / 8);
  g.beginPath(); g.arc(cx, cy - s * 0.12, s * 0.3, Math.PI * 0.85, Math.PI * 2.15); g.lineTo(cx, cy + s * 0.48); g.closePath(); g.fill();
  g.fillStyle = BG; g.beginPath(); g.arc(cx, cy - s * 0.12, s * 0.12, 0, Math.PI * 2); g.fill();
};
export const iconCard: Icon = (g, cx, cy, s, c) => { g.fillStyle = c; rr(g, cx - s * 0.22, cy - s * 0.32, s * 0.44, s * 0.64, 2); g.fill(); };

// ---------- tiles ----------
export const TILE_W = 288, TILE_H = 144;
export function tiles(src: HTMLCanvasElement) {
  return [[0, 0], [TILE_W, 0], [0, TILE_H], [TILE_W, TILE_H]].map(([sx, sy]) => {
    const t = document.createElement('canvas'); t.width = TILE_W; t.height = TILE_H;
    t.getContext('2d')!.drawImage(src, sx, sy, TILE_W, TILE_H, 0, 0, TILE_W, TILE_H);
    return t;
  });
}
export async function pngBytes(c: HTMLCanvasElement): Promise<number[]> {
  const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), 'image/png'));
  return Array.from(new Uint8Array(await blob.arrayBuffer()));
}
/** Cheap fingerprint of a tile's pixels, to skip resending unchanged tiles. */
export function tileKey(c: HTMLCanvasElement) {
  const d = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height).data;
  let h = 2166136261;
  for (let i = 0; i < d.length; i += 4) h = Math.imul(h ^ d[i], 16777619);
  return h;
}
