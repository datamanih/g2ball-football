// Team badges as 2-colour transparent images: lit pixels (white) on a fully transparent background.
// On the glasses, black is see-through, so the same pixels show as a single-colour crest floating in view.
//
// Conversion, per crest (all done on-device in a canvas):
//   1. Fit the crest into an S×S square with 2 px padding.
//   2. Inside the crest (alpha > 100), split light from dark at the Otsu threshold of the crest's own brightness,
//      so light parts are lit and dark parts are left transparent, whatever the club colours are.
//   3. Add a 1 px lit outline around the crest's shape so dark crests still read as a shape.
// Teams with no crest (grassroots, manual) get a monogram: a ring with their initials.
import type { Source, TeamRef } from './model';
import { load, badgeKey } from './store';

export interface Badge { /** greyscale PNG for the glasses (0 = off, 255 = lit) */ glasses: number[]; /** RGBA PNG data URL, transparent background */ dataUrl: string; /** white-on-transparent canvas, for drawing into graphical screens */ mask: HTMLCanvasElement }
export interface BadgeRef { src: Source; id?: string; name: string; logo?: string; /** uploaded, already-converted badge (data URL) */ image?: string }

const cache = new Map<string, Promise<Badge>>();

export function badgeUrl(r: BadgeRef): string | undefined {
  if (r.logo) return r.logo;
  if (!r.id) return undefined;
  if (r.src === 'espn') return `https://a.espncdn.com/combiner/i?img=/i/teamlogos/soccer/500/${r.id}.png&w=128&h=128`;
  if (r.src === 'apif') return `https://media.api-sports.io/football/teams/${r.id}.png`;
  return undefined;
}

export function getBadge(r: BadgeRef, size = 96): Promise<Badge> {
  const url = badgeUrl(r);
  const key = r.image ? `${size}:img:${r.image.length}:${hash(r.image)}` : `${size}:${url ?? 'mono:' + r.name}`;
  let p = cache.get(key);
  if (!p) {
    p = r.image ? fromConverted(r.image, size).catch(() => monogram(r.name, size))
      : url ? fromUrl(url, size).catch(() => monogram(r.name, size)) : monogram(r.name, size);
    cache.set(key, p);
    p.catch(() => cache.delete(key));
  }
  return p;
}

// ---------- conversion ----------
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const i = new Image();
    i.crossOrigin = 'anonymous';          // both crest CDNs send Access-Control-Allow-Origin: *
    i.onload = () => res(i); i.onerror = () => rej(new Error('badge load failed'));
    i.src = url;
  });
}

async function fromUrl(url: string, S: number): Promise<Badge> {
  const img = await loadImage(url);
  const c = canvas(S), g = c.getContext('2d', { willReadFrequently: true })!;
  const k = Math.min((S - 4) / img.width, (S - 4) / img.height);
  const w = Math.round(img.width * k), h = Math.round(img.height * k);
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, Math.round((S - w) / 2), Math.round((S - h) / 2), w, h);
  const px = g.getImageData(0, 0, S, S).data;
  return encode(twoTone(px, S), S);
}

/** An uploaded badge that's already 2-colour: lit wherever it's opaque. */
async function fromConverted(dataUrl: string, S: number): Promise<Badge> {
  const img = await loadImage(dataUrl);
  const c = canvas(S), g = c.getContext('2d', { willReadFrequently: true })!;
  g.imageSmoothingEnabled = false;
  g.drawImage(img, 0, 0, S, S);
  const px = g.getImageData(0, 0, S, S).data, lit = new Uint8Array(S * S);
  for (let i = 0; i < lit.length; i++) lit[i] = px[i * 4 + 3] > 127 ? 1 : 0;
  return encode(lit, S);
}

/**
 * Converts an uploaded crest (any image: PNG with transparency, JPEG, or a photo of the badge) into a 2-colour
 * transparent badge, returned as a data URL. If the image has no transparency, the background is removed by
 * flood-filling inwards from the edges over colours close to the border colour. `invert` swaps lit and clear
 * inside the crest, for badges that read better the other way round.
 */
export async function convertUpload(src: string, opts: { invert?: boolean; size?: number } = {}): Promise<string> {
  const S = opts.size ?? 192;              // stored at 2x so it stays crisp on the phone; glasses downsample to 96/88
  const img = await loadImage(src);
  const c = canvas(S), g = c.getContext('2d', { willReadFrequently: true })!;
  const k = Math.min((S - 8) / img.width, (S - 8) / img.height);
  const w = Math.round(img.width * k), h = Math.round(img.height * k);
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, Math.round((S - w) / 2), Math.round((S - h) / 2), w, h);
  const id = g.getImageData(0, 0, S, S), px = id.data;
  removeBackground(px, S, Math.round((S - w) / 2), Math.round((S - h) / 2), w, h);
  const lit = twoTone(px, S);
  if (opts.invert) {
    for (let i = 0; i < lit.length; i++) if (px[i * 4 + 3] > 100) lit[i] = lit[i] ? 0 : 1;
    // keep the outline lit so the shape still reads
    const o = twoTone(px, S), inside = (i: number) => px[i * 4 + 3] > 100;
    for (let y = 1; y < S - 1; y++) for (let x = 1; x < S - 1; x++) {
      const i = y * S + x;
      if (inside(i) && (!inside(i - 1) || !inside(i + 1) || !inside(i - S) || !inside(i + S))) lit[i] = o[i];
    }
  }
  const out = canvas(S), og = out.getContext('2d')!, od = og.createImageData(S, S);
  for (let i = 0; i < lit.length; i++) od.data.set([255, 255, 255, lit[i] ? 255 : 0], i * 4);
  og.putImageData(od, 0, 0);
  return out.toDataURL('image/png');
}

/** Makes a solid background transparent (no-op if the image already has transparency). Exported for tests. */
export function removeBackground(px: Uint8ClampedArray, S: number, x0: number, y0: number, w: number, h: number) {
  const n = S * S;
  let clear = 0;
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (px[(y * S + x) * 4 + 3] < 100) clear++;
  if (clear > w * h * 0.03) return;        // already has a transparent background
  // Border colour = median of the image's edge pixels.
  const edge: number[][] = [];
  for (let x = x0; x < x0 + w; x++) edge.push(rgb(px, y0 * S + x), rgb(px, (y0 + h - 1) * S + x));
  for (let y = y0; y < y0 + h; y++) edge.push(rgb(px, y * S + x0), rgb(px, y * S + x0 + w - 1));
  const med = [0, 1, 2].map((k) => edge.map((e) => e[k]).sort((a, b) => a - b)[edge.length >> 1]);
  const close = (i: number) => Math.abs(px[i * 4] - med[0]) + Math.abs(px[i * 4 + 1] - med[1]) + Math.abs(px[i * 4 + 2] - med[2]) < 90;
  const seen = new Uint8Array(n), stack: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = i % S, y = (i / S) | 0;
    if (x < x0 || y < y0 || x >= x0 + w || y >= y0 + h) { px[i * 4 + 3] = 0; seen[i] = 1; }   // padding
    else if ((x === x0 || y === y0 || x === x0 + w - 1 || y === y0 + h - 1) && close(i)) { stack.push(i); seen[i] = 1; }
  }
  while (stack.length) {
    const i = stack.pop()!; px[i * 4 + 3] = 0;
    const x = i % S;
    for (const j of [x > 0 ? i - 1 : -1, x < S - 1 ? i + 1 : -1, i - S, i + S]) if (j >= 0 && j < n && !seen[j]) { seen[j] = 1; if (close(j)) stack.push(j); }
  }
}
const rgb = (px: Uint8ClampedArray, i: number) => [px[i * 4], px[i * 4 + 1], px[i * 4 + 2]];
function hash(s: string) { let h = 0; for (let i = 0; i < s.length; i += 7) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

/** Returns a lit mask (1 = lit) for RGBA pixels. Exported for the self-test. */
export function twoTone(px: Uint8ClampedArray | Uint8Array, S: number): Uint8Array {
  const n = S * S, inside = new Uint8Array(n), lum = new Uint8Array(n);
  let opaque = 0;
  for (let i = 0; i < n; i++) {
    const a = px[i * 4 + 3];
    inside[i] = a > 100 ? 1 : 0; opaque += inside[i];
    lum[i] = Math.round(0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]);
  }
  if (opaque > n * 0.97) inside.fill(1);   // crest on a solid square: treat it all as crest
  const t = otsu(lum, inside);
  const lit = new Uint8Array(n);
  let litN = 0, inN = 0;
  for (let i = 0; i < n; i++) { lit[i] = inside[i] && lum[i] >= t ? 1 : 0; litN += lit[i]; inN += inside[i]; }
  // Mostly-dark crest (e.g. red on navy): split the dark part once more and light its brighter colour,
  // as long as both halves are sizeable and clearly different. Leaves crests with plenty of light parts alone.
  if (litN < inN * 0.25) {
    const dark = new Uint8Array(n);
    for (let i = 0; i < n; i++) dark[i] = inside[i] && !lit[i] ? 1 : 0;
    const t2 = otsu(lum, dark);
    let hiN = 0, loN = 0, hiS = 0, loS = 0;
    for (let i = 0; i < n; i++) if (dark[i]) { if (lum[i] >= t2) { hiN++; hiS += lum[i]; } else { loN++; loS += lum[i]; } }
    if (hiN > inN * 0.12 && loN > inN * 0.12 && hiS / hiN - loS / loN > 30)
      for (let i = 0; i < n; i++) if (dark[i] && lum[i] >= t2) lit[i] = 1;
  }
  // 1 px outline: crest pixels with a non-crest 4-neighbour (or on the canvas edge).
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    if (!inside[i]) continue;
    if (x === 0 || y === 0 || x === S - 1 || y === S - 1 || !inside[i - 1] || !inside[i + 1] || !inside[i - S] || !inside[i + S]) lit[i] = 1;
  }
  return lit;
}

function otsu(lum: Uint8Array, mask: Uint8Array) {
  const h = new Array(256).fill(0); let tot = 0, sum = 0;
  for (let i = 0; i < lum.length; i++) if (mask[i]) { h[lum[i]]++; tot++; sum += lum[i]; }
  if (!tot) return 128;
  let wB = 0, sB = 0, best = -1, t = 128;
  for (let v = 0; v < 256; v++) {
    wB += h[v]; if (!wB) continue;
    const wF = tot - wB; if (!wF) break;
    sB += v * h[v];
    const mB = sB / wB, mF = (sum - sB) / wF, b = wB * wF * (mB - mF) ** 2;
    if (b > best) { best = b; t = v; }
  }
  return t + 1;   // "lit" means strictly brighter than the darker class
}

// ---------- monogram ----------
async function monogram(name: string, S: number): Promise<Badge> {
  const c = canvas(S), g = c.getContext('2d', { willReadFrequently: true })!;
  g.strokeStyle = '#fff'; g.lineWidth = Math.max(3, S / 16);
  g.beginPath(); g.arc(S / 2, S / 2, S / 2 - g.lineWidth, 0, Math.PI * 2); g.stroke();
  const ini = initials(name);
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `bold ${Math.round(S * (ini.length > 2 ? 0.3 : 0.38))}px sans-serif`;
  g.fillText(ini, S / 2, S / 2 + S * 0.02);
  const px = g.getImageData(0, 0, S, S).data;
  const lit = new Uint8Array(S * S);
  for (let i = 0; i < lit.length; i++) lit[i] = px[i * 4 + 3] > 110 ? 1 : 0;
  return encode(lit, S);
}
export function initials(name: string) {
  const words = name.replace(/\b(FC|AFC|F\.C\.|Football Club|Sunday|Saturday|Reserves|Res)\b/gi, '').trim().split(/\s+/).filter(Boolean);
  return (words.length === 1 ? words[0].slice(0, 3) : words.slice(0, 3).map((w) => w[0]).join('')).toUpperCase();
}

// ---------- encoding ----------
async function encode(lit: Uint8Array, S: number): Promise<Badge> {
  // Glasses: opaque greyscale (black = off). Phone: white on transparent.
  const gc = canvas(S), gg = gc.getContext('2d')!, gd = gg.createImageData(S, S);
  const pc = canvas(S), pg = pc.getContext('2d')!, pd = pg.createImageData(S, S);
  for (let i = 0; i < lit.length; i++) {
    const v = lit[i] ? 255 : 0;
    gd.data.set([v, v, v, 255], i * 4);
    pd.data.set([255, 255, 255, lit[i] ? 255 : 0], i * 4);
  }
  gg.putImageData(gd, 0, 0); pg.putImageData(pd, 0, 0);
  const blob: Blob = await new Promise((r) => gc.toBlob((b) => r(b!), 'image/png'));
  return { glasses: Array.from(new Uint8Array(await blob.arrayBuffer())), dataUrl: pc.toDataURL('image/png'), mask: pc };
}
function canvas(S: number) { const c = document.createElement('canvas'); c.width = S; c.height = S; return c; }

/** Badge source for a followed team: crest for ESPN / API-Football teams, monogram for grassroots. */
export function teamBadge(t: TeamRef): BadgeRef {
  const st = load();
  const image = st.customBadges?.[badgeKey(t)]
    ?? (t.src === 'ft' || t.src === 'manual' ? st.grassroots.find((g) => g.id === t.id)?.badge : undefined);
  return { src: t.src, id: t.src === 'espn' || t.src === 'apif' ? t.id : undefined, name: t.name, image };
}

/** Uploaded badge for a grassroots team appearing in a match by name (opponents without one get a monogram). */
export function grassrootsBadge(name: string): string | undefined {
  const n = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, '');
  const k = n(name);
  return load().grassroots.find((g) => g.badge && [g.name, g.fullTimeName ?? ''].some((x) => n(x) && (n(x) === k || k.includes(n(x)) || n(x).includes(k))))?.badge;
}

/** Uploaded badge for a professional / non-league team (by source id), if the user set one. */
export function customBadge(src: Source, id?: string): string | undefined { return id ? load().customBadges?.[badgeKey({ src, id })] : undefined; }
