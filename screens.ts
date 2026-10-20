// Graphical screen designs. Each function draws one full 576×288 frame for a given selection.
import * as G from './gfx';
import { W, H, FG, DIM, FAINT, BG } from './gfx';
import type { Match, MatchDetail, Table, TableRow, TeamOverview } from './model';
import * as fmt from './format';

type Img = HTMLCanvasElement | null | undefined;
const now = () => new Date();
const up = (s: string) => s.toUpperCase();

/** A match from one team's point of view. */
export function pov(m: Match, me: string) {
  const home = m.home === me || sameish(m.home, me);
  const us = home ? m.hs : m.as, them = home ? m.as : m.hs;
  const res = us === null || them === null || m.state !== 'post' ? '' : us > them ? 'W' : us < them ? 'L' : 'D';
  return { opp: home ? m.away : m.home, home, us, them, res };
}
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const sameish = (a: string, b: string) => { const x = norm(a), y = norm(b); return !!x && !!y && (x.includes(y) || y.includes(x)); };
const dayShort = (iso: string) => { const d = fmt.day(iso, now()); return d.length > 9 ? d.replace(/^(\w{3}) (\d+) (\w{3})$/, '$1 $2 $3') : d; };

// ---------- home ----------
export interface HomeData { fav: number; max: number; live: number; today?: number; ticker?: string; grass: number }
export const HOME_ITEMS = ['Favourites', 'Live now', 'Today', 'Browse', 'Non-league', 'Grassroots'];
export function home(sel: number, d: HomeData) {
  const { c, g } = G.surface();
  if (d.ticker) G.header(g, 'G2Ball Football', d.ticker, true);
  else G.header(g, 'G2Ball Football', `${fmt.day(now().toISOString())} ${fmt.hhmm(now().toISOString())}`);
  const icons = [G.iconStar, G.iconLive, G.iconCalendar, G.iconTrophy, G.iconPyramid, G.iconGoal];
  const badges = [`${d.fav}/${d.max}`, d.live ? `${d.live} live` : '', d.today ? String(d.today) : '', '', '', d.grass ? String(d.grass) : ''];
  const TW = 180, TH = 114, gap = 8, x0 = (W - 3 * TW - 2 * gap) / 2, y0 = 46;
  HOME_ITEMS.forEach((label, i) => {
    const x = x0 + (i % 3) * (TW + gap), y = y0 + Math.floor(i / 3) * (TH + gap), on = i === sel;
    G.box(g, x, y, TW, TH, { r: 12, fill: on ? FG : undefined, stroke: on ? undefined : FAINT, lw: 2 });
    const col = on ? BG : FG;
    icons[i](g, x + TW / 2, y + 44, 46, col);
    G.text(g, label, x + TW / 2, y + 97, { size: 18, align: 'center', color: col, maxW: TW - 12 });
    if (badges[i]) {
      const live = i === 1 && d.live > 0;
      G.pill(g, badges[i], x + TW - 8, y + 8, { size: 12, h: 20, align: 'right', solid: live && !on, color: on ? BG : live ? FG : DIM });
    }
  });
  return c;
}

// ---------- favourites ----------
/** ov: undefined = still loading, null = unavailable. */
export interface FavRow { name: string; league: string; badge: Img; ov: TeamOverview | null | undefined }
export function favourites(sel: number, rows: FavRow[], liveCount: number) {
  const { c, g } = G.surface();
  G.header(g, 'Favourites', liveCount ? `${liveCount} LIVE` : `${fmt.day(now().toISOString())} ${fmt.hhmm(now().toISOString())}`, liveCount > 0);
  const RH = 48, y0 = 42;
  rows.forEach((r, i) => {
    const y = y0 + i * RH;
    if (i === sel) G.selRing(g, 4, y, W - 8, RH - 2, 10);
    G.badge(g, r.badge, 14, y + 4, 38);
    G.text(g, fmt.short(r.name, 30), 64, y + 22, { size: 19, maxW: 300 });
    const ov = r.ov;
    if (!ov) { G.text(g, ov === undefined ? 'Loading…' : 'Unavailable', 64, y + 41, { size: 14, weight: 600, color: DIM }); return; }
    const me = fmt.teamName(ov);
    const right = W - 18;
    if (ov.live) {
      const p = pov(ov.live, me);
      G.text(g, `v ${fmt.short(p.opp, 22)} (${p.home ? 'H' : 'A'})`, 64, y + 41, { size: 14, weight: 600, color: DIM, maxW: 290 });
      const sw = G.text(g, `${p.us ?? 0}-${p.them ?? 0}`, right, y + 33, { size: 26, weight: 800, align: 'right' });
      G.pill(g, ov.live.clock || 'LIVE', right - sw - 10, y + 12, { size: 13, solid: true, align: 'right', h: 24 });
      return;
    }
    const next = ov.next[0], last = ov.last[0];
    const recent = last && Date.now() - Date.parse(last.kickoff) < 20 * 3600_000;
    if (last && (recent || !next)) {
      const p = pov(last, me);
      G.text(g, `v ${fmt.short(p.opp, 22)} (${p.home ? 'H' : 'A'}) · ${dayShort(last.kickoff)}`, 64, y + 41, { size: 14, weight: 600, color: DIM, maxW: 300 });
      const sw = G.text(g, `${p.us ?? '-'}-${p.them ?? '-'}`, right, y + 33, { size: 24, weight: 800, align: 'right' });
      if (p.res) G.form(g, [p.res], right - sw - 36, y + 12, 26);
    } else if (next) {
      const p = pov(next, me);
      G.text(g, `v ${fmt.short(p.opp, 22)} (${p.home ? 'H' : 'A'})${next.venue ? ' · ' + next.venue : ''}`, 64, y + 41, { size: 14, weight: 600, color: DIM, maxW: 330 });
      if (next.state === 'off') G.pill(g, next.clock, right, y + 12, { size: 14, align: 'right' });
      else {
        G.text(g, up(dayShort(next.kickoff)), right, y + 17, { size: 12, weight: 700, color: DIM, align: 'right' });
        G.text(g, fmt.hhmm(next.kickoff), right, y + 40, { size: 22, weight: 800, align: 'right' });
      }
    } else G.text(g, 'No matches', 64, y + 41, { size: 14, weight: 600, color: DIM });
  });
  if (!rows.length) G.text(g, 'Add up to 5 teams on your phone', W / 2, 150, { size: 20, align: 'center', color: DIM });
  return c;
}

// ---------- team ----------
export type TeamItem = 'live' | 'next' | 'last' | 'table' | 'fixtures' | 'results' | 'fav';
export function teamItems(ov: TeamOverview): TeamItem[] {
  const out: TeamItem[] = [];
  out.push(ov.live ? 'live' : 'next');
  out.push('last');
  if (ov.table?.rows.length) out.push('table');
  out.push('fixtures', 'results', 'fav');
  return out;
}
export function team(sel: TeamItem, ov: TeamOverview, b: Img, isFav: boolean) {
  const { c, g } = G.surface();
  const me = fmt.teamName(ov), pos = fmt.position(ov);
  G.badge(g, b, 14, 10, 112);
  G.text(g, ov.team.name, 140, 40, { size: 27, weight: 800, maxW: 424 });
  G.text(g, ov.table?.name || ov.team.leagueName || '', 140, 62, { size: 15, weight: 600, color: DIM, maxW: 424 });
  let fx = 140;
  if (pos) {
    const w = G.text(g, fmt.ordinal(pos.pos), 140, 112, { size: 38, weight: 800 });
    G.text(g, `${pos.pts} PTS`, 140 + w + 12, 92, { size: 15, weight: 800 });
    G.text(g, `GD ${pos.gd > 0 ? '+' : ''}${pos.gd} · P${pos.p}`, 140 + w + 12, 112, { size: 14, weight: 600, color: DIM });
    fx = 360;
  }
  const f = fmt.form(ov).split(' ').filter(Boolean);
  if (f.length) {
    G.text(g, 'FORM', fx, 84, { size: 11, weight: 800, color: DIM });
    G.form(g, f.reverse(), fx, 90, 26, 5);      // oldest → newest, left to right
  }
  // cards
  const cardW = (W - 36) / 2, cy = 134, ch = 76;
  const card = (x: number, kind: 'live' | 'next' | 'last', m: Match | undefined) => {
    const on = sel === kind;
    G.box(g, x, cy, cardW, ch, { r: 10, stroke: on ? FG : FAINT, lw: on ? 3 : 2 });
    if (kind === 'live') G.pill(g, `LIVE ${m?.clock ?? ''}`.trim(), x + 10, cy + 8, { size: 12, solid: true, h: 20 });
    else G.text(g, kind === 'next' ? 'NEXT' : 'LAST', x + 12, cy + 22, { size: 12, weight: 800, color: DIM });
    if (!m) { G.text(g, kind === 'next' ? 'No fixtures' : 'No results', x + 12, cy + 50, { size: 17, color: DIM }); return; }
    const p = pov(m, me);
    G.text(g, `${p.home ? 'v' : '@'} ${fmt.short(p.opp, 24)}`, x + 12, cy + 48, { size: 19, maxW: cardW - (kind === 'next' ? 24 : 110) });
    if (kind === 'next') {
      G.text(g, m.state === 'off' ? m.clock : `${dayShort(m.kickoff)} · ${fmt.hhmm(m.kickoff)}`, x + 12, cy + 68, { size: 14, weight: 600, color: DIM, maxW: cardW - 24 });
    } else {
      G.text(g, m.venue || m.leagueName, x + 12, cy + 68, { size: 13, weight: 600, color: DIM, maxW: cardW - 110 });
      const sw = G.text(g, `${p.us ?? '-'}-${p.them ?? '-'}`, x + cardW - 12, cy + 56, { size: 28, weight: 800, align: 'right' });
      if (p.res && kind === 'last') G.form(g, [p.res], x + cardW - 12 - sw - 34, cy + 34, 26);
    }
  };
  card(12, ov.live ? 'live' : 'next', ov.live ?? ov.next[0]);
  card(24 + cardW, 'last', ov.last[0]);
  // chips
  const chips: [TeamItem, string][] = [];
  if (ov.table?.rows.length) chips.push(['table', 'Table']);
  chips.push(['fixtures', `Fixtures ${ov.next.length}`], ['results', `Results ${ov.last.length}`], ['fav', isFav ? 'Following' : 'Follow']);
  const gap = 8, cw = (W - 24 - gap * (chips.length - 1)) / chips.length, chy = 222, chh = 40;
  chips.forEach(([id, label], i) => {
    const x = 12 + i * (cw + gap), on = sel === id;
    G.box(g, x, chy, cw, chh, { r: chh / 2, fill: on ? FG : undefined, stroke: on ? undefined : FAINT, lw: 2 });
    if (id === 'fav') {
      const tw = G.measure(g, label, 16), sx = x + cw / 2 - (tw + 22) / 2;
      const col = on ? BG : FG;
      if (isFav) G.iconStar(g, sx + 8, chy + chh / 2, 18, col);
      else G.iconStarOutline(g, sx + 8, chy + chh / 2, 18, col);
      G.text(g, label, sx + 22, chy + 27, { size: 16, color: col, maxW: cw - 40 });
    } else G.text(g, label, x + cw / 2, chy + 27, { size: 16, align: 'center', color: on ? BG : FG, maxW: cw - 16 });
  });
  if (ov.ground) { G.iconPin(g, 20, H - 12, 12, DIM); G.text(g, ov.ground, 30, H - 7, { size: 12, weight: 600, color: DIM, maxW: 520 }); }
  return c;
}

// ---------- match scoreboard ----------
export function match(d: MatchDetail, hb: Img, ab: Img) {
  const { c, g } = G.surface();
  G.header(g, d.leagueName || 'Match', d.kickoff ? `${dayShort(d.kickoff)} ${fmt.hhmm(d.kickoff)}` : '');
  const B = 96, by = 48;
  G.badge(g, hb, 28, by, B); G.badge(g, ab, W - 28 - B, by, B);
  // Names are centred under the badges; keep them inside the screen edge (max width = 2 × distance to the edge).
  const nameW = 2 * (28 + B / 2) - 12;
  G.text(g, fmt.short(d.home, 20), 28 + B / 2, by + B + 22, { size: 16, align: 'center', maxW: nameW });
  G.text(g, fmt.short(d.away, 20), W - 28 - B / 2, by + B + 22, { size: 16, align: 'center', maxW: nameW });
  const cx = W / 2;
  if (d.state === 'pre') {
    G.text(g, up(fmt.day(d.kickoff, now())), cx, 78, { size: 15, weight: 800, color: DIM, align: 'center' });
    G.text(g, fmt.hhmm(d.kickoff) || 'TBC', cx, 128, { size: 54, weight: 800, align: 'center' });
    const mins = Math.round((Date.parse(d.kickoff) - Date.now()) / 60000);
    if (mins > 0) G.pill(g, mins < 60 ? `KICK-OFF IN ${mins} MIN` : mins < 36 * 60 ? `KICK-OFF IN ${Math.floor(mins / 60)}H ${mins % 60}M` : `KICK-OFF IN ${Math.round(mins / 1440)} DAYS`, cx, 142, { size: 12, align: 'center', h: 22 });
  } else {
    G.text(g, `${d.hs ?? 0}`, cx - 22, 126, { size: 64, weight: 800, align: 'right' });
    G.text(g, '–', cx, 120, { size: 40, weight: 700, align: 'center', color: DIM });
    G.text(g, `${d.as ?? 0}`, cx + 22, 126, { size: 64, weight: 800, align: 'left' });
    const st = d.state === 'in' ? (d.clock === 'HT' ? 'HALF TIME' : `LIVE ${d.clock}`) : d.state === 'post' ? (d.clock === 'FT' ? 'FULL TIME' : d.clock) : d.clock;
    G.pill(g, st, cx, 140, { size: 13, align: 'center', h: 24, solid: d.state === 'in' });
  }
  if (d.state !== 'pre' && d.events.some((e) => ['goal', 'pen', 'og', 'red'].includes(e.kind))) timeline(g, d, 218);
  else if (d.state !== 'pre') G.text(g, d.src === 'espn' || d.s365Id ? (d.hs || d.as ? '' : 'No goals yet') : 'Scorers not published', cx, 226, { size: 14, weight: 600, color: DIM, align: 'center' });
  // venue (bigger before kick-off, when there's no timeline)
  const v = [d.venue, d.city].filter(Boolean).join(', ') || 'Venue TBC';
  if (d.state === 'pre') {
    const vs = G.measure(g, v, 19, 700);
    G.iconPin(g, cx - Math.min(vs, 480) / 2 - 14, 222, 20, FG);
    G.text(g, v, cx + 8, 230, { size: 19, align: 'center', maxW: 480 });
    G.hint(g, 'Tap for match details · double-tap back');
    return c;
  }
  const vw = G.measure(g, v, 14, 600);
  G.iconPin(g, cx - vw / 2 - 10, H - 18, 14, DIM);
  G.text(g, v, cx + 6, H - 12, { size: 14, weight: 600, color: DIM, align: 'center', maxW: 500 });
  return c;
}

/** 0–90' bar, home goals above (ball + minute), away goals below, red cards as small cards. */
function timeline(g: CanvasRenderingContext2D, d: MatchDetail, y: number) {
  const x0 = 60, x1 = W - 60, minute = (s: string) => { const m = /(\d+)(?:'?\+(\d+))?/.exec(s); return m ? Math.min(+m[1] + (m[2] ? +m[2] * 0.3 : 0), 120) : 0; };
  const maxM = Math.max(90, ...d.events.map((e) => minute(e.min)));
  const X = (m: number) => x0 + ((x1 - x0) * Math.min(m, maxM)) / maxM;
  g.fillStyle = FAINT; g.fillRect(x0, y - 1, x1 - x0, 3);
  g.fillStyle = DIM; g.fillRect(X(45) - 1, y - 6, 2, 13);
  G.text(g, "0'", x0 - 8, y + 5, { size: 11, weight: 700, color: DIM, align: 'right' });
  G.text(g, `${Math.round(maxM)}'`, x1 + 8, y + 5, { size: 11, weight: 700, color: DIM });
  if (d.state === 'in') { const nowM = minute(d.clock); if (nowM) { g.fillStyle = FG; g.fillRect(x0, y - 1, X(nowM) - x0, 3); } }
  else if (d.state === 'post') { g.fillStyle = DIM; g.fillRect(x0, y - 1, x1 - x0, 3); }
  const placed: number[] = [];
  for (const e of d.events) {
    const isGoal = e.kind === 'goal' || e.kind === 'pen' || e.kind === 'og';
    if (!isGoal && e.kind !== 'red') continue;
    const side = e.side ?? 'home', sgn = side === 'home' ? -1 : 1, x = X(minute(e.min));
    if (isGoal) G.iconBall(g, x, y + sgn * 14, 16, FG); else G.iconCard(g, x, y + sgn * 14, 18, FG);
    const clash = placed.some((p) => Math.abs(p - x * sgn) < 30);
    if (!clash) G.text(g, e.min.replace(/'$/, "'"), x, y + sgn * (side === 'home' ? 28 : 38), { size: 11, weight: 700, color: DIM, align: 'center' });
    placed.push(x * sgn);
  }
}

// ---------- league table ----------
export const TABLE_ROWS = 8;
export function table(sel: number, t: Table, badges: Img[], mine?: TableRow, favNames: string[] = []) {
  const { c, g } = G.surface();
  const pages = Math.max(1, Math.ceil(t.rows.length / TABLE_ROWS)), page = Math.floor(sel / TABLE_ROWS);
  G.header(g, t.name || 'Table', pages > 1 ? `${page + 1}/${pages}` : '');
  const cols = { pos: 34, badge: 44, team: 74, p: 418, gd: 482, pts: 556 };
  const hy = 54;
  for (const [k, l] of [['p', 'P'], ['gd', 'GD'], ['pts', 'PTS']] as const) G.text(g, l, cols[k], hy, { size: 12, weight: 800, color: DIM, align: 'right' });
  G.text(g, 'TEAM', cols.team, hy, { size: 12, weight: 800, color: DIM });
  const RH = 28, y0 = 60;
  t.rows.slice(page * TABLE_ROWS, page * TABLE_ROWS + TABLE_ROWS).forEach((r, k) => {
    const i = page * TABLE_ROWS + k, y = y0 + k * RH;
    const me = r === mine || favNames.includes(r.team.toLowerCase());
    // Followed team: dim filled bar with bright text (dark-on-bright text looks thin on the display).
    if (me) G.box(g, 6, y + 1, W - 12, RH - 2, { r: 6, fill: '#0e0e0e', stroke: DIM, lw: 1 });
    if (i === sel) G.selRing(g, 6, y, W - 12, RH, 6);
    const col = FG;
    if (r.note) { g.fillStyle = /releg/i.test(r.note) ? DIM : FG; g.fillRect(10, y + 6, 3, RH - 12); }
    G.text(g, String(r.pos), cols.pos, y + 20, { size: 15, weight: 800, align: 'right', color: col });
    G.badge(g, badges[k], cols.badge, y + 3, 22);
    G.text(g, fmt.short(r.team, 26), cols.team, y + 20, { size: 16, weight: me ? 800 : 600, color: col, maxW: 300 });
    G.text(g, String(r.p), cols.p, y + 20, { size: 15, weight: 600, align: 'right', color: col });
    G.text(g, `${r.gd > 0 ? '+' : ''}${r.gd}`, cols.gd, y + 20, { size: 15, weight: 600, align: 'right', color: col });
    G.text(g, String(r.pts), cols.pts, y + 20, { size: 16, weight: 800, align: 'right', color: col });
  });
  return c;
}

// ---------- match list ----------
export const LIST_ROWS = 5;
export interface ListRow { m: Match; hb: Img; ab: Img }
export function matchList(sel: number, title: string, rows: ListRow[], opts: { live?: number; tag?: (m: Match) => string } = {}) {
  const { c, g } = G.surface();
  const pages = Math.max(1, Math.ceil(rows.length / LIST_ROWS)), page = Math.floor(sel / LIST_ROWS);
  const right = opts.live ? `${opts.live} LIVE` : pages > 1 ? `${page + 1}/${pages}` : '';
  G.header(g, title, right, !!opts.live);
  const RH = 48, y0 = 42, cx = W / 2 + 34;
  rows.slice(page * LIST_ROWS, page * LIST_ROWS + LIST_ROWS).forEach(({ m, hb, ab }, k) => {
    const i = page * LIST_ROWS + k, y = y0 + k * RH;
    if (i === sel) G.selRing(g, 4, y, W - 8, RH - 2, 10);
    // left: when / status
    const tag = opts.tag ? opts.tag(m) : up(dayShort(m.kickoff)).slice(0, 10);
    if (m.state === 'in') {
      G.pill(g, m.clock || 'LIVE', 12, y + (opts.tag ? 4 : 12), { size: 13, solid: true, h: 22 });
      if (opts.tag) G.text(g, tag, 14, y + 41, { size: 11, weight: 700, color: DIM, maxW: 120 });
    } else if (m.state === 'post' || m.state === 'off') {
      G.text(g, tag, 14, y + 19, { size: 11, weight: 700, color: DIM, maxW: 120 });
      G.text(g, m.clock || 'FT', 14, y + 39, { size: 16, weight: 800, color: m.state === 'off' ? DIM : FG });
    } else {
      G.text(g, tag, 14, y + 19, { size: 11, weight: 700, color: DIM, maxW: 120 });
      G.text(g, fmt.hhmm(m.kickoff), 14, y + 39, { size: 17, weight: 800 });
    }
    // teams + score
    G.text(g, fmt.short(m.home, 18), cx - 70, y + 30, { size: 17, align: 'right', maxW: cx - 70 - 96 });
    G.badge(g, hb, cx - 64, y + 9, 28);
    G.badge(g, ab, cx + 36, y + 9, 28);
    G.text(g, fmt.short(m.away, 18), cx + 70, y + 30, { size: 17, maxW: W - cx - 84 });
    if (m.state === 'pre') G.text(g, 'v', cx, y + 30, { size: 17, weight: 600, align: 'center', color: DIM });
    else G.text(g, `${m.hs ?? '-'}-${m.as ?? '-'}`, cx, y + 31, { size: 21, weight: 800, align: 'center' });
  });
  if (!rows.length) G.text(g, 'No matches', W / 2, 150, { size: 20, align: 'center', color: DIM });
  return c;
}

// ---------- goal alert (pop-up over whatever is on screen) ----------
export type AlertKind = 'home' | 'away' | 'both' | 'update';
export function goalAlert(m: Match, kind: AlertKind, hb: Img, ab: Img) {
  const { c, g } = G.surface();
  const cx = W / 2;
  // Bold frame so it reads as a pop-up, not a normal screen.
  G.box(g, 4, 4, W - 8, H - 8, { r: 16, stroke: FG, lw: 3 });
  const title = kind === 'update' ? 'SCORE UPDATE' : 'GOAL';
  const tw = G.measure(g, title, 30, 800) + (kind === 'update' ? 56 : 112);
  G.box(g, cx - tw / 2, 16, tw, 44, { r: 22, fill: FG });
  G.text(g, title, cx, 49, { size: 30, weight: 800, color: '#0e0e0e', align: 'center' });
  if (kind !== 'update') { G.iconBall(g, cx - tw / 2 + 28, 38, 24, '#0e0e0e'); G.iconBall(g, cx + tw / 2 - 28, 38, 24, '#0e0e0e'); }
  const B = 84, by = 76;
  G.badge(g, hb, 34, by, B); G.badge(g, ab, W - 34 - B, by, B);
  const nameW = 2 * (34 + B / 2) - 12;
  const hot = (side: 'home' | 'away') => kind === side || kind === 'both' || kind === 'update';
  G.text(g, fmt.short(m.home, 20), 34 + B / 2, by + B + 22, { size: 16, align: 'center', maxW: nameW, color: hot('home') ? FG : DIM });
  G.text(g, fmt.short(m.away, 20), W - 34 - B / 2, by + B + 22, { size: 16, align: 'center', maxW: nameW, color: hot('away') ? FG : DIM });
  G.text(g, `${m.hs ?? 0}`, cx - 24, 158, { size: 72, weight: 800, align: 'right', color: hot('home') ? FG : DIM });
  G.text(g, '–', cx, 150, { size: 44, weight: 700, align: 'center', color: DIM });
  G.text(g, `${m.as ?? 0}`, cx + 24, 158, { size: 72, weight: 800, align: 'left', color: hot('away') ? FG : DIM });
  const st = m.clock === 'HT' ? 'HALF TIME' : m.clock ? `LIVE ${m.clock}` : 'LIVE';
  G.pill(g, st, cx, 172, { size: 13, align: 'center', h: 24, solid: true });
  G.text(g, (m.leagueName || '').toUpperCase(), cx, 232, { size: 15, weight: 700, color: DIM, align: 'center', maxW: 500 });
  G.text(g, 'Tap to close', cx, H - 18, { size: 12, weight: 600, color: DIM, align: 'center' });
  return c;
}
