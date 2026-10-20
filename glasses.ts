// Glasses UI for G2Ball Football: a screen stack rendered with Even Hub containers (576x288).
// Graphical pages (home, favourites, team, match, table, match lists) are drawn on a canvas and sent as four image
// tiles over an invisible full-screen text container that receives scroll/tap. Menus stay as native lists.
// Ring / temple: scroll to move, tap to select, double-tap to go back (double-tap on Home = exit dialog).
import {
  CreateStartUpPageContainer, RebuildPageContainer, ListContainerProperty, ListItemContainerProperty,
  TextContainerProperty, TextContainerUpgrade, OsEventTypeList, ImageContainerProperty, ImageRawDataUpdate,
  type EvenAppBridge, type EvenHubEvent,
} from '@evenrealities/even_hub_sdk';
import type { Match, MatchDetail, Source, Table, TeamOverview, TeamRef } from './model';
import * as scr from './screens';
import { tiles, pngBytes, tileKey, setFont } from './gfx';
import * as espn from './espn';
import * as bbc from './bbc';
import * as s365 from './s365';
import * as apif from './apifootball';
import * as grass from './grassroots';
import { teamOverview } from './teams';
import { getBadge, teamBadge, grassrootsBadge, customBadge, type BadgeRef } from './badge';
import * as fmt from './format';
import { load, addFavourite, removeFavourite, isFavourite, saveResume, loadResume, MAX_FAVOURITES, FAVS_SAVED, OPTIONS_SAVED, grassSrc, type Resume } from './store';

const W = 576, H = 288, HEADER_H = 40, ROW_H = 38, TILE_W = 288, TILE_H = 144;
/** Resolution badges are converted at for the graphical screens (drawn smaller as needed). */
const BADGE_PX = 112;
// Badges: 96 px beside the team menu, 88 px either side of the score on match screens.
const TEAM_BADGE = 96, MATCH_BADGE = 88, BADGE_ID = 3, AWAY_BADGE_ID = 4;

interface ListScreen {
  kind: 'list'; title: string; items: string[]; onPick: (i: number) => void;
  resume?: Resume;
  /** Team crest shown to the left of the list (team pages). */
  badge?: BadgeRef;
  /** Called on a timer; return new title/items to update in place (title) or rebuild (items changed). */
  refresh?: () => Promise<{ title?: string; items?: string[] } | void>;
  refreshMs?: number; timer?: number;
}
interface TextScreen { kind: 'text'; content: string; onTap?: () => void; refresh?: () => Promise<string | void>; refreshMs?: number; timer?: number }
/** Match info: [home badge] score header [away badge], details below. */
interface MatchScreen {
  kind: 'match'; head: string; body: string; home: BadgeRef; away: BadgeRef; onTap?: () => void;
  refresh?: () => Promise<{ head: string; body: string } | void>; refreshMs?: number; timer?: number;
}
/** A fully drawn screen: `sel` moves with scroll, tap picks it. Only tiles whose pixels changed are resent. */
interface GfxScreen {
  kind: 'gfx'; sel: number; count: () => number; draw: (sel: number) => HTMLCanvasElement | Promise<HTMLCanvasElement>;
  onPick: (i: number) => void; resume?: Resume;
  refresh?: () => Promise<unknown>; refreshMs?: number; timer?: number; keys?: number[];
}
type Screen = ListScreen | TextScreen | MatchScreen | GfxScreen;

export class GlassesApp {
  private stack: Screen[] = [];
  private started = false;
  private rendering = Promise.resolve();
  private renderQueued = false;
  /** The screen whose containers are currently on the glasses. */
  private laidOut: Screen | null = null;
  private masks = new Map<string, HTMLCanvasElement | null>();
  // Screen sleep: blank the display after the chosen time without input; any tap or scroll wakes it.
  private asleep = false;
  private sleepTimer?: number;
  private sleepAt = 0;          // when the screen last went blank
  private lastInputAt = Date.now();
  private lastInput = '';
  // Goal alerts: scores seen per match, pop-ups waiting, and the one on screen.
  private scores = new Map<string, { hs: number; as: number }>();
  private alerts: { m: Match; kind: scr.AlertKind }[] = [];
  private alert: { timer: number } | null = null;
  private watchTimer?: number;
  constructor(private bridge: EvenAppBridge) {}

  async start() {
    this.bridge.onEvenHubEvent((e) => this.onEvent(e));
    window.addEventListener(FAVS_SAVED, () => this.onFavouritesSaved());
    window.addEventListener(OPTIONS_SAVED, () => { this.resetSleep(); this.startWatch(); });
    const r = loadResume();
    await this.splash();
    this.resetSleep();
    this.startWatch();
    window.setInterval(() => this.status(), 5000);
    if (import.meta.env.DEV && new URLSearchParams(location.search).has('devgoal')) {
      // Dev only: fake score changes to preview the pop-up (?devgoal).
      const m: Match = { id: 'dev1', src: 'espn', league: 'eng.1', leagueName: 'Premier League', kickoff: new Date().toISOString(), state: 'in',
        clock: "67'", home: 'Manchester United', away: 'Liverpool', homeId: '360', awayId: '364', hs: 2, as: 1, venue: 'Old Trafford', city: 'Manchester' };
      window.setTimeout(() => this.queueAlert(m, 'home'), 6000);
      window.setTimeout(() => this.queueAlert({ ...m, id: 'dev2', home: 'Altrincham', away: 'Rochdale', homeId: '633', awayId: '336', league: 'eng.5', leagueName: 'National League', hs: 0, as: 1, clock: "23'" }, 'away'), 6500);
    }
    const home = this.homeScreen();
    this.push(home);
    this.applyRefresh(home);
    if (r?.kind === 'favourites') this.openFavourites();
    else if (r?.kind === 'live') this.openLive();
    else if (r?.kind === 'team' && r.team) { this.openFavourites(); this.openTeam(r.team); }
  }

  // ---------- splash (same two-tone gorilla as the London Tube app) ----------
  private async splash() {
    const SHOW_MS = 3000, t0 = Date.now();
    let loaded = false;
    const work = Promise.all([
      ...load().favourites.map((t) => teamOverview(t).catch(() => null)),
      ...load().favourites.map((t) => getBadge(teamBadge(t), BADGE_PX).catch(() => null)),
    ]).then(() => { loaded = true; });
    try {
      this.started = true;
      await this.bridge.createStartUpPageContainer(new CreateStartUpPageContainer(this.fullScreenImagePage()));
      const base = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = './splash/base.png'; });
      const frame = (p: number) => {
        const c = document.createElement('canvas'); c.width = W; c.height = H;
        const g = c.getContext('2d')!; g.imageSmoothingEnabled = false; g.drawImage(base, 0, 0);
        g.fillStyle = '#fff'; g.fillRect(92, 266, Math.round((W - 185) * Math.min(1, p)), 8);
        // App version, right of the loading bar.
        setFont(g, 13, 700); g.fillStyle = '#fff'; g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.fillText(`v${__APP_VERSION__}`, 496, 276);
        return tiles(c);
      };
      const first = frame(0);
      for (let k = 0; k < 4; k++) await this.sendTile(k, first[k]);
      let last = -1;
      while (true) {
        const t = (Date.now() - t0) / SHOW_MS;
        const p = t >= 1 ? (loaded ? 1 : 0.92) : Math.min(t, loaded ? t : 0.92);
        const step = Math.round(p * 12);
        if (step !== last) { last = step; const f = frame(step / 12); await this.sendTile(2, f[2]); await this.sendTile(3, f[3]); }
        if (t >= 1 && loaded) break;
        await sleep(120);
        if (Date.now() - t0 > SHOW_MS + 5000) break;     // never block on a slow network
      }
      await sleep(200);
    } catch { await Promise.race([work, sleep(SHOW_MS)]); }
  }
  private async sendTile(k: number, c: HTMLCanvasElement) {
    await this.bridge.updateImageRawData(new ImageRawDataUpdate({ containerID: 10 + k, containerName: `img${k}`, imageData: await pngBytes(c) }));
  }

  // ---------- home ----------
  private homeScreen(): GfxScreen {
    const d: scr.HomeData = { fav: 0, max: MAX_FAVOURITES, live: 0, grass: 0 };
    const s: GfxScreen = {
      kind: 'gfx', sel: 0, count: () => scr.HOME_ITEMS.length,
      // Counts are read from storage on every draw, so the favourites count always reflects what's saved.
      draw: (sel) => { d.fav = load().favourites.length; d.grass = load().grassroots.length; return scr.home(sel, d); },
      onPick: (i) => [() => this.openFavourites(), () => this.openLive(), () => this.openToday(), () => this.openBrowse(),
        () => this.openNonLeague(), () => this.openGrassroots()][i]?.(),
      refreshMs: load().refreshSec * 1000,
      refresh: async () => {
        const ovs = await this.favOverviews();
        const lv = ovs.find((o) => o?.live)?.live;
        const ab = (n: string) => { const x = fmt.short(n, 40); return x.length <= 12 ? x : x.split(' ')[0]; };
        d.ticker = lv ? `${ab(lv.home)} ${lv.hs ?? 0}-${lv.as ?? 0} ${ab(lv.away)} ${lv.clock}`.trim() : undefined;
        const all = await bbc.merged().catch(() => null);
        if (all) { d.today = all.length; d.live = all.filter((m) => m.state === 'in').length + ovs.filter((o) => o?.live && o.team.src !== 'espn').length; }
      },
    };
    return s;
  }
  private favOverviews() { return Promise.all(load().favourites.map((t) => teamOverview(t).catch(() => null))); }

  /** Favourites changed (saved on the phone, or added/removed on the glasses): refresh what's on screen. */
  private onFavouritesSaved() {
    const home = this.stack[0], top = this.top();
    if (top === home) { this.render(); this.applyRefresh(home); return; }
    if (top?.kind === 'gfx' && top.resume?.kind === 'favourites') { this.render(); this.applyRefresh(top); }
  }

  // ---------- screen sleep ----------
  private sleepSec() {
    const dev = import.meta.env.DEV ? new URLSearchParams(location.search).get('devsleep') : null;
    return dev ? +dev : load().sleepSec ?? 30;
  }
  /** Restart the sleep countdown (after any input, alert or wake). */
  private resetSleep() {
    if (this.sleepTimer) clearTimeout(this.sleepTimer);
    this.sleepTimer = undefined;
    const sec = this.sleepSec();
    if (sec > 0) this.sleepTimer = window.setTimeout(() => this.goToSleep(), sec * 1000);
    this.status();
  }
  private goToSleep() {
    if (this.asleep) return;
    if (this.alert) { this.resetSleep(); return; }          // never blank a goal pop-up
    const wasImages = this.laidOut?.kind === 'gfx';
    this.asleep = true; this.sleepAt = Date.now(); this.laidOut = null;
    this.status();
    // Blank by sending four black tiles. Graphical screens already use this page layout, so nothing is rebuilt
    // (rebuilding can make the glasses send events that would wake the screen straight away). Other screens
    // switch to the image layout once; its invisible text container still receives the next tap or scroll.
    const black = document.createElement('canvas'); black.width = W; black.height = H;
    const ts = tiles(black);
    this.queue(async () => {
      if (!this.asleep) return;
      if (!wasImages) await this.bridge.rebuildPageContainer(new RebuildPageContainer(this.fullScreenImagePage()));
      for (let k = 0; k < 4; k++) { if (!this.asleep) return; await this.sendTile(k, ts[k]); }
    });
  }
  private wake() {
    if (!this.asleep) return;
    this.asleep = false; this.laidOut = null;
    this.status();
    this.render();
    const t = this.top(); if (t) this.applyRefresh(t);    // bring it up to date after the nap
    this.resetSleep();
  }
  /** Live status line on the phone page (Options → Screen sleep), to check sleep on real glasses. */
  private status() {
    const el = typeof document !== 'undefined' ? document.getElementById('sleepStatus') : null;
    if (!el) return;
    const sec = this.sleepSec();
    const ago = Math.round((Date.now() - this.lastInputAt) / 1000);
    el.textContent = sec <= 0 ? 'Screen sleep is off.'
      : `${this.asleep ? `Asleep since ${new Date(this.sleepAt).toLocaleTimeString('en-GB')}` : `Awake, sleeps after ${sec} s idle`}`
        + ` · last glasses input ${ago} s ago${this.lastInput ? ` (${this.lastInput})` : ''}`;
  }
  /** True when `s` is what the user is looking at (not asleep, no pop-up over it). */
  private onScreen(s: Screen) { return this.top() === s && !this.asleep && !this.alert; }
  /** Run a display update after any in-flight one (the host rejects overlapping page updates). */
  private queue(fn: () => Promise<unknown>) { this.rendering = this.rendering.then(fn).then(() => {}, () => {}); return this.rendering; }

  // ---------- goal alerts ----------
  private startWatch() {
    if (this.watchTimer) clearInterval(this.watchTimer);
    this.watchTimer = undefined;
    if (load().goalAlerts === 'off') return;
    void this.checkScores();
    this.watchTimer = window.setInterval(() => void this.checkScores(), Math.max(30, load().refreshSec) * 1000);
  }
  /** The matches being watched: everything in Live now, or only matches involving a favourite. */
  private async watched(): Promise<Match[]> {
    const mode = load().goalAlerts;
    const favs = load().favourites;
    const extra = (await this.favOverviews()).flatMap((o) => (o?.live && o.team.src !== 'espn' ? [o.live] : []));
    let espnLive = (await bbc.merged().catch(() => [] as Match[])).filter((m) => m.state === 'in');
    if (mode === 'favourites') espnLive = espnLive.filter((m) => favs.some((f) => (f.src === 'espn' && (f.id === m.homeId || f.id === m.awayId)) || (f.src !== 'espn' && (sameName(f.name, m.home) || sameName(f.name, m.away)))));
    return dedupe([...extra, ...espnLive]);
  }
  private async checkScores() {
    if (load().goalAlerts === 'off') return;
    const ms = await this.watched().catch(() => [] as Match[]);
    for (const m of ms) {
      if (m.hs == null || m.as == null) continue;
      const key = `${m.src}:${m.id}`, was = this.scores.get(key);
      this.scores.set(key, { hs: m.hs, as: m.as });
      if (!was || (was.hs === m.hs && was.as === m.as)) continue;   // first sighting or no change: no alert
      const up = (m.hs > was.hs ? 1 : 0) + (m.as > was.as ? 2 : 0);
      const kind: scr.AlertKind = m.hs < was.hs || m.as < was.as ? 'update' : up === 1 ? 'home' : up === 2 ? 'away' : 'both';
      this.queueAlert(m, kind);
    }
  }
  private queueAlert(m: Match, kind: scr.AlertKind) {
    // One pop-up per match: a newer score for the same match replaces a waiting one.
    this.alerts = this.alerts.filter((a) => !(a.m.src === m.src && a.m.id === m.id));
    this.alerts.push({ m, kind });
    if (this.alerts.length > 6) this.alerts.splice(0, this.alerts.length - 6);
    if (!this.alert) void this.nextAlert();
  }
  private async nextAlert() {
    const a = this.alerts.shift();
    if (!a) { this.endAlerts(); return; }
    if (this.sleepTimer) clearTimeout(this.sleepTimer);
    this.asleep = false;
    this.alert = { timer: 0 };
    this.laidOut = null;
    const badge = (h: boolean) => Promise.race([getBadge(sideRef(a.m, h), BADGE_PX).then((b) => b.mask).catch(() => null), sleep(1500).then(() => null)]);
    const [hb, ab] = await Promise.all([badge(true), badge(false)]);
    const ts = tiles(scr.goalAlert(a.m, a.kind, hb, ab));
    await this.queue(async () => {
      await this.bridge.rebuildPageContainer(new RebuildPageContainer(this.fullScreenImagePage()));
      for (let k = 0; k < 4; k++) await this.sendTile(k, ts[k]);
    });
    if (this.alert) this.alert.timer = window.setTimeout(() => this.dismissAlert(), 8000);
  }
  private dismissAlert() {
    if (!this.alert) return;
    clearTimeout(this.alert.timer);
    this.alert = null;
    if (this.alerts.length) void this.nextAlert(); else this.endAlerts();
  }
  /** Back to whatever was on screen, awake, with the sleep countdown restarted. */
  private endAlerts() {
    this.alert = null; this.laidOut = null;
    this.render();
    const t = this.top(); if (t) this.applyRefresh(t);
    this.resetSleep();
  }

  // ---------- favourites ----------
  private openFavourites() {
    if (!load().favourites.length) return this.push({ kind: 'text', content: 'No favourite teams yet.\n\nAdd up to 5 on your phone (G2Ball Football settings),\nor open any team in Browse and tap "Follow".\n\nDouble-tap: back' });
    let ovs: (TeamOverview | null)[] | undefined;
    const same = (a: TeamRef, b: TeamRef) => a.src === b.src && a.id === b.id;
    // Favourites are read live, so removing one on its team page is reflected straight away.
    const s: GfxScreen = {
      kind: 'gfx', sel: 0, resume: { kind: 'favourites' }, count: () => load().favourites.length,
      draw: (sel) => {
        const favs = load().favourites;
        const rows = favs.map((t) => ({
          name: t.name, league: t.leagueName ?? '', badge: this.mask(teamBadge(t)),
          ov: ovs ? ovs.find((o) => o && same(o.team, t)) ?? null : undefined,
        }));
        return scr.favourites(sel, rows, rows.filter((r) => r.ov?.live).length);
      },
      onPick: (i) => { const t = load().favourites[i]; if (t) this.openTeam(t); },
      refresh: async () => { ovs = await this.favOverviews(); },
      refreshMs: load().refreshSec * 1000,
    };
    this.push(s);
    this.applyRefresh(s);
  }

  // ---------- team page ----------
  private async openTeam(t: TeamRef) {
    this.push({ kind: 'text', content: `${t.name}\nLoading…` });
    try {
      let ov = await teamOverview(t), items = scr.teamItems(ov);
      const me = () => fmt.short(ov.team.name, 20);
      const s: GfxScreen = {
        kind: 'gfx', sel: 0, resume: { kind: 'team', team: t }, count: () => items.length,
        draw: (sel) => scr.team(items[sel], ov, this.mask(teamBadge(t)), isFavourite(t)),
        onPick: (i) => {
          const it = items[i];
          if (it === 'live' && ov.live) return this.openMatch(ov.live);
          if (it === 'next' && ov.next[0]) return this.openMatch(ov.next[0]);
          if (it === 'last' && ov.last[0]) return this.openMatch(ov.last[0]);
          if (it === 'table' && ov.table) return this.showTable(ov.table, ov);
          if (it === 'fixtures') return this.matchList(`${me()} fixtures`, ov.next);
          if (it === 'results') return this.matchList(`${me()} results`, ov.last);
          if (it === 'fav') {
            if (isFavourite(t)) removeFavourite(t);
            else if (!addFavourite(t)) return this.push({ kind: 'text', content: `You already follow ${MAX_FAVOURITES} teams.\nRemove one first.\n\nDouble-tap: back` });
            this.render();
          }
        },
        refreshMs: load().refreshSec * 1000,
        refresh: async () => { ov = await teamOverview(t); items = scr.teamItems(ov); },
      };
      this.replace(s);
    } catch (e) { this.replace(this.error(e)); }
  }

  /** Graphical list of matches (team fixtures/results, live, a league's round). */
  private matchList(title: string, ms: Match[], o: { refresh?: () => Promise<Match[]>; resume?: Resume; title?: () => string; live?: boolean; startAt?: (ms: Match[]) => number; tag?: (m: Match) => string } = {}) {
    let list = ms, first = true;
    const s: GfxScreen = {
      kind: 'gfx', sel: o.startAt ? o.startAt(ms) : 0, resume: o.resume, count: () => Math.max(1, list.length),
      draw: (sel) => {
        const page = Math.floor(sel / scr.LIST_ROWS);
        const rows = list.map((m, i) => {
          const on = Math.floor(i / scr.LIST_ROWS) === page;    // only load badges for the visible page
          return { m, hb: on ? this.mask(sideRef(m, true)) : null, ab: on ? this.mask(sideRef(m, false)) : null };
        });
        const live = list.filter((m) => m.state === 'in').length;
        return scr.matchList(sel, o.title ? o.title() : title, rows, { live: o.live && live ? live : undefined, tag: o.tag });
      },
      onPick: (i) => { if (list[i]) this.openMatch(list[i]); },
      refresh: o.refresh && (async () => {
        list = await o.refresh!();
        if (first && o.startAt) s.sel = o.startAt(list);
        first = false;
      }),
      refreshMs: o.refresh ? load().refreshSec * 1000 : 0,
    };
    this.push(s);
    if (s.refresh) this.applyRefresh(s);
  }

  // ---------- match info ----------
  private openMatch(m: Match) {
    const plain = (x: Match): MatchDetail => ({ ...x, events: [] });
    // Non-league matches: venue and goal minutes from 365Scores when it lists the game (fresh score from the merged feed).
    const s365Detail = async (): Promise<MatchDetail> => {
      const cur = (await bbc.merged().catch(() => [] as Match[])).find((x) => x.id === m.id && x.src === m.src) ?? m;
      const id = cur.s365Id ?? m.s365Id;
      if (!id) return plain(cur);
      const x = await s365.detail(id).catch(() => null);
      return { ...plain(cur), venue: cur.venue || x?.venue || '', events: x?.events ?? [] };
    };
    const get = () => (m.src === 'espn' ? espn.matchDetail(m).catch(() => plain(m)) : m.src === 'bbc' || m.src === 's365' ? s365Detail() : Promise.resolve(plain(m)));
    let d = plain(m);
    const s: GfxScreen = {
      kind: 'gfx', sel: 0, count: () => 1,
      draw: () => scr.match(d, this.mask(sideRef(m, true)), this.mask(sideRef(m, false))),
      onPick: () => this.openMatchDetails(m, d, get),     // tap: scorers, cards, referee, attendance as text
      refresh: async () => { d = await get(); },
      refreshMs: m.state === 'in' || (m.state === 'pre' && Date.parse(m.kickoff) - Date.now() < 15 * 60_000) ? 30_000 : 0,
    };
    this.push(s);
    this.applyRefresh(s);
  }
  private openMatchDetails(m: Match, d: MatchDetail, get: () => Promise<MatchDetail>) {
    const s: MatchScreen = { kind: 'match', head: fmt.matchHead(d), body: fmt.matchBody(d), home: sideRef(m, true), away: sideRef(m, false) };
    s.refresh = async () => { const x = await get(); return { head: fmt.matchHead(x), body: fmt.matchBody(x) }; };
    s.refreshMs = m.state === 'in' ? 30_000 : 0;
    s.onTap = () => this.applyRefresh(s);
    this.push(s);
  }

  // ---------- live / today ----------
  private openLive() {
    let none = false;
    this.matchList('Live now', [], {
      resume: { kind: 'live' }, live: true,
      title: () => (none ? 'Live now · none · next up' : 'Live now'),
      refresh: async () => {
        const all = await bbc.merged();   // ESPN + BBC (FA Cup qualifying, National League North / South, FA Trophy)
        // Favourites from other sources (non-league / grassroots) too.
        const extra = (await this.favOverviews()).flatMap((o) => (o?.live && o.team.src !== 'espn' ? [o.live] : []));
        const ms = dedupe([...extra, ...all.filter((m) => m.state === 'in')]);
        none = !ms.length;
        // Favourite teams' matches first, whatever the competition (FA Cup qualifying, Europe, non-league…);
        // otherwise the usual order (kick-off, then Premier League downwards) is kept.
        return favouritesFirst(none ? all.filter((m) => m.state === 'pre').slice(0, 20) : ms);
      },
    });
  }

  /** Today: every UK, Irish and UEFA match on one graphical list, by kick-off, league in the left column. */
  private openToday() {
    const lgs = [...espn.HOME_LEAGUES, ...bbc.BBC_LEAGUES.map((l) => l.slug)];
    const order = (m: Match) => { const i = lgs.indexOf(m.league ?? ''); return i < 0 ? lgs.length : i; };
    this.matchList("Today's matches", [], {
      live: true,
      tag: (m) => (espn.leagueBySlug(m.league ?? '')?.short ?? bbc.bbcLeague(m.league)?.short ?? m.leagueName).toUpperCase(),
      startAt: (ms) => { const i = ms.findIndex((m) => m.state !== 'post'); return i < 0 ? 0 : i; },
      refresh: async () => [...await bbc.merged()].sort((a, b) => (Date.parse(a.kickoff) || 0) - (Date.parse(b.kickoff) || 0) || order(a) - order(b)),
    });
  }

  // ---------- browse ----------
  private openBrowse() {
    this.push({ kind: 'list', title: 'Browse leagues', items: espn.REGIONS.map((r) => r.name), onPick: (i) => {
      const r = espn.REGIONS[i];
      // England also lists FA Cup qualifying (365Scores), straight after the FA Cup.
      const items: [string, () => void][] = r.leagues.flatMap((l) => {
        const own: [string, () => void] = [l.name, () => this.openLeague(l)];
        return l.slug === 'eng.fa' ? [own, ['FA Cup qualifying', () => this.faCupQualifying()] as [string, () => void]] : [own];
      });
      this.push({ kind: 'list', title: r.name, items: items.map(([n]) => n), onPick: (j) => items[j]?.[1]() });
    } });
  }

  private openLeague(l: espn.League) {
    const acts: [string, () => void][] = [
      ['Matches (this week)', () => this.leagueMatches(l)],
      ...(l.table ? [['Table', () => this.leagueTable(l)] as [string, () => void]] : []),
      ['Teams', () => this.leagueTeams(l)],
    ];
    this.push({ kind: 'list', title: l.name, items: acts.map(([a]) => a), onPick: (i) => acts[i]?.[1]() });
  }

  private async leagueMatches(l: espn.League, preset?: Match[]) {
    // From "Today": today's games only. From Browse: the feed's current round, starting at the next unplayed match.
    let last = preset ?? [];
    this.matchList(l.name, preset ?? [], {
      live: true,
      startAt: (ms) => { const i = ms.findIndex((m) => m.state !== 'post'); return i < 0 ? Math.max(0, ms.length - 1) : i; },
      refresh: async () => {
        last = await (preset ? espn.scoreboard(l.slug) : espn.matchweek(l.slug)).catch(() => last);
        return [...last].sort((a, b) => a.kickoff.localeCompare(b.kickoff));
      },
    });
  }

  /** FA Cup qualifying: the current round with live scores (365Scores, kept up to date with BBC via the merged feed). */
  private faCupQualifying() {
    let last: Match[] = [];
    this.matchList('FA Cup qualifying', [], {
      live: true,
      title: () => (last[0]?.leagueName ?? 'FA Cup qualifying').replace(/^FA Cup /, 'FA Cup qualifying · '),
      startAt: (ms) => { const i = ms.findIndex((m) => m.state !== 'post'); return i < 0 ? 0 : i; },
      refresh: async () => {
        const round = await s365.qualifyingRound().catch(() => last);
        // Take the merged (ESPN + BBC + 365Scores) score and minute for today's ties, whichever feed is ahead.
        const merged = round.some((m) => m.state === 'in') ? await bbc.merged().catch(() => [] as Match[]) : [];
        last = round.map((m) => merged.find((x) => x.s365Id === m.id) ? { ...m, ...pickLive(merged.find((x) => x.s365Id === m.id)!) } : m);
        return last;
      },
    });
  }

  private async leagueTable(l: espn.League) {
    this.push({ kind: 'text', content: `${l.name}\nLoading table…` });
    try {
      const groups = await espn.standings(l.slug);
      this.dispose(this.stack.pop());
      if (!groups.length) return this.push({ kind: 'text', content: `${l.name}\nNo table published.\n\nDouble-tap: back` });
      if (groups.length === 1) return this.showTable({ ...groups[0], name: l.name }, undefined, 'espn', l.slug);
      this.push({ kind: 'list', title: `${l.name} · groups`, items: groups.map((g) => fmt.clip(g.name, 40)), onPick: (i) => this.showTable(groups[i], undefined, 'espn', l.slug) });
    } catch (e) { this.replace(this.error(e)); }
  }

  private async leagueTeams(l: espn.League) {
    this.push({ kind: 'text', content: `${l.name}\nLoading teams…` });
    try {
      const teams = await espn.leagueTeams(l.slug);
      this.dispose(this.stack.pop());
      this.pagedList(`${l.name} · teams`, teams.map((t) => `${isFavourite(t) ? '» ' : ''}${t.name}`), (i) => this.openTeam(teams[i]));
    } catch (e) { this.replace(this.error(e)); }
  }

  private showTable(t: Table, ov?: TeamOverview, src: Source = ov?.team.src ?? 'espn', league = ov?.team.league) {
    const mine = ov ? fmt.position(ov) : undefined;
    const favNames = load().favourites.map((f) => f.name.toLowerCase());
    const ref = (r: Table['rows'][number]): BadgeRef => r.teamId && (src === 'espn' || src === 'apif')
      ? { src, id: r.teamId, name: r.team, image: customBadge(src, r.teamId) }
      : { src: 'manual', name: r.team, image: grassrootsBadge(r.team) };
    const s: GfxScreen = {
      kind: 'gfx', sel: mine ? Math.max(0, t.rows.indexOf(mine)) : 0, count: () => t.rows.length,
      draw: (sel) => {
        const p = Math.floor(sel / scr.TABLE_ROWS);
        return scr.table(sel, t, t.rows.slice(p * scr.TABLE_ROWS, p * scr.TABLE_ROWS + scr.TABLE_ROWS).map((r) => this.mask(ref(r))), mine, favNames);
      },
      // Tap a row: open that team (when the source can look it up).
      onPick: (i) => {
        const r = t.rows[i];
        if (r?.teamId && (src === 'espn' || src === 'apif')) this.openTeam({ src, id: r.teamId, name: r.team, league, leagueName: t.name });
      },
    };
    this.push(s);
  }

  // ---------- non-league (API-Football) ----------
  private async openNonLeague() {
    if (!apif.hasKey()) return this.push({ kind: 'text', content: 'Non-league steps 2–4\n(National League North/South, Isthmian,\nNorthern Premier, Southern League)\n\nAdd a free API-Football key on your phone:\nG2Ball Football settings → Non-league.\n\nDouble-tap: back' });
    this.push({ kind: 'text', content: 'English leagues\nLoading…' });
    try {
      const lgs = await apif.englishLeagues();
      this.dispose(this.stack.pop());
      this.pagedList('English leagues (API-Football)', lgs.map((l) => l.name), (i) => {
        const l = lgs[i];
        const acts: [string, () => void][] = [
          ['Recent & upcoming matches', async () => {
            this.push({ kind: 'text', content: `${l.name}\nLoading…` });
            try { const ms = await apif.leagueFixtures(l.id); this.dispose(this.stack.pop()); this.matchList(l.name, ms); } catch (e) { this.replace(this.error(e)); }
          }],
          ['Table', async () => {
            this.push({ kind: 'text', content: `${l.name}\nLoading table…` });
            try { const t = await apif.leagueTable(l.id); this.dispose(this.stack.pop()); t ? this.showTable(t, undefined, 'apif', String(l.id)) : this.push({ kind: 'text', content: 'No table.\n\nDouble-tap: back' }); } catch (e) { this.replace(this.error(e)); }
          }],
        ];
        this.push({ kind: 'list', title: l.name, items: acts.map(([a]) => a), onPick: (j) => acts[j]?.[1]() });
      });
    } catch (e) { this.replace(this.error(e)); }
  }

  // ---------- grassroots / Sunday league ----------
  private openGrassroots() {
    const gs = load().grassroots;
    if (!gs.length) return this.push({ kind: 'text', content: 'Grassroots & Sunday league\n\nSet up your team on the phone:\nG2Ball Football settings → Grassroots.\n\nUses FA Full-Time data (via FullTime API or\nyour league\'s Full-Time embed codes), or\nyour own table and scores.\n\nDouble-tap: back' });
    const refs: TeamRef[] = gs.map((g) => ({ src: grassSrc(g), id: g.id, name: g.name, league: g.divisionId, leagueName: g.leagueName }));
    this.push({ kind: 'list', title: 'Grassroots & Sunday league', items: refs.map((r) => fmt.clipBytes(`${r.name} · ${r.leagueName}`, 60)), onPick: (i) => this.openTeam(refs[i]) });
    void grass;
  }

  // ---------- shared ----------
  /** A list longer than the 20-item firmware limit, split into pages with ‹ / › items. */
  private pagedList(title: string, labels: string[], onPick: (i: number) => void, startPage = 0) {
    const PER = 18, pages = Math.ceil(labels.length / PER);
    const s: ListScreen = { kind: 'list', title, items: [], onPick: () => {} };
    const show = (p: number) => {
      const start = p * PER, slice = labels.slice(start, start + PER);
      const prev = p > 0 ? ['‹ Previous'] : [], next = p < pages - 1 ? ['Next ›'] : [];
      s.title = pages > 1 ? `${title}  ${p + 1}/${pages}` : title;
      s.items = [...prev, ...slice, ...next];
      s.onPick = (i) => {
        if (prev.length && i === 0) return show(p - 1);
        const k = i - prev.length;
        if (k >= slice.length) return show(p + 1);
        onPick(start + k);
      };
      if (this.top() === s) this.render();
    };
    show(Math.min(startPage, Math.max(0, pages - 1)));
    this.push(s);
  }

  private error(e: unknown): TextScreen {
    return { kind: 'text', content: `Couldn't load that.\n${fmt.clip((e as Error).message ?? String(e), 200)}\n\nDouble-tap: back` };
  }

  /** Run a screen's refresh now and then on its timer; update the header in place, rebuild only if items changed. */
  private async applyRefresh(s: Screen) {
    if (!s.refresh) return;
    if (s.refreshMs && !s.timer) s.timer = window.setInterval(() => this.applyRefresh(s), s.refreshMs);
    try {
      if (s.kind === 'gfx') { await s.refresh(); if (this.onScreen(s)) await this.render(); return; }
      const r = await s.refresh();
      if (!r) return;
      if (s.kind === 'text') {
        const changed = r !== s.content; s.content = r as string;
        if (changed && this.onScreen(s)) await this.updateText(s.content);
        return;
      }
      if (s.kind === 'match') {
        const { head, body } = r as { head: string; body: string };
        const hc = head !== s.head, bc = body !== s.body; s.head = head; s.body = body;
        if (!this.onScreen(s)) return;
        if (hc) await this.bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: 1, containerName: 'head', content: head }));
        if (bc) await this.bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: 2, containerName: 'body', content: body }));
        return;
      }
      const { title, items } = r as { title?: string; items?: string[] };
      const itemsChanged = !!items && (items.length !== s.items.length || items.some((x, i) => x !== s.items[i]));
      if (items) s.items = items;
      const titleChanged = title !== undefined && title !== s.title;
      if (title !== undefined) s.title = title;
      if (!this.onScreen(s)) return;
      if (itemsChanged) await this.render(); else if (titleChanged) await this.updateTitle(s.title);
    } catch (e) {
      if (s.kind === 'gfx') return;
      if (s.kind === 'list' && s.items[0] === 'Loading…') { s.title = 'Offline'; s.items = [fmt.clipBytes((e as Error).message, 60)]; if (this.top() === s) this.render(); }
    }
  }

  // ---------- navigation ----------
  private top() { return this.stack[this.stack.length - 1]; }
  private push(s: Screen) { this.stack.push(s); this.render(); }
  private replace(s: Screen) { this.dispose(this.stack.pop()); this.stack.push(s); this.render(); }
  private back() {
    if (this.stack.length <= 1) { saveResume(null); this.bridge.shutDownPageContainer(1); return; } // 1 = system exit dialog
    this.dispose(this.stack.pop());
    this.render();
    const t = this.top(); if (t) this.applyRefresh(t);           // returning to a screen: bring it up to date
  }
  private dispose(s?: Screen) { if (s?.timer) { clearInterval(s.timer); s.timer = undefined; } }

  // ---------- input ----------
  private onEvent(e: EvenHubEvent) {
    const ev = e.listEvent ?? e.textEvent ?? e.sysEvent;
    if (!ev) return;
    const type = ev.eventType ?? OsEventTypeList.CLICK_EVENT;   // CLICK (0) is often omitted
    const input = type === OsEventTypeList.CLICK_EVENT || type === OsEventTypeList.DOUBLE_CLICK_EVENT
      || type === OsEventTypeList.SCROLL_TOP_EVENT || type === OsEventTypeList.SCROLL_BOTTOM_EVENT;
    // Events the glasses send by themselves right after the screen blanks (page/focus updates) are not the user.
    if (this.asleep && Date.now() - this.sleepAt < 1500) return;
    if (input) {
      const names = ['tap', 'scroll up', 'scroll down', 'double-tap'];
      const src = e.sysEvent?.eventSource;
      this.lastInput = `${names[type] ?? type}${src === 2 ? ' from ring' : src === 1 || src === 3 ? ' from temple' : ''}`;
      this.lastInputAt = Date.now();
      if (this.alert) { this.dismissAlert(); return; }        // any tap or scroll closes the pop-up
      if (this.asleep) { this.wake(); return; }                // ...or wakes the screen, without acting on it
      this.resetSleep();
    }
    const s = this.top();
    if (type === OsEventTypeList.DOUBLE_CLICK_EVENT) return this.back();
    if (type === OsEventTypeList.FOREGROUND_ENTER_EVENT) {
      if (this.alert) return;
      if (this.asleep && Date.now() - this.sleepAt < 5000) return;   // a page refresh, not the user coming back
      this.asleep = false; this.laidOut = null; this.render(); if (s) this.applyRefresh(s); this.resetSleep(); return;
    }
    if (type === OsEventTypeList.ABNORMAL_EXIT_EVENT || type === OsEventTypeList.SYSTEM_EXIT_EVENT) {
      this.stack.forEach((x) => this.dispose(x));
      if (this.watchTimer) clearInterval(this.watchTimer);
      if (this.sleepTimer) clearTimeout(this.sleepTimer);
      return;
    }
    if (!s) return;
    if (s.kind === 'gfx') {
      const n = s.count();
      if (type === OsEventTypeList.SCROLL_BOTTOM_EVENT) { if (s.sel < n - 1) { s.sel++; this.render(); } return; }
      if (type === OsEventTypeList.SCROLL_TOP_EVENT) { if (s.sel > 0) { s.sel--; this.render(); } return; }
      if (type === OsEventTypeList.CLICK_EVENT) s.onPick(s.sel);
      return;
    }
    if (s.kind === 'list' && e.listEvent && type === OsEventTypeList.CLICK_EVENT) {
      const i = e.listEvent.currentSelectItemIndex ?? s.items.indexOf(e.listEvent.currentSelectItemName ?? '');
      return s.onPick(Math.max(0, i ?? 0));
    }
    if ((s.kind === 'text' || s.kind === 'match') && type === OsEventTypeList.CLICK_EVENT) s.onTap?.();
  }

  // ---------- rendering ----------
  private render() {
    // Serialise page updates (the host rejects overlapping ones) and coalesce bursts, e.g. fast scrolling.
    if (this.renderQueued) return this.rendering;
    this.renderQueued = true;
    this.rendering = this.rendering.then(() => { this.renderQueued = false; return this.renderNow(); }).catch(() => {});
    return this.rendering;
  }
  private async renderNow() {
    const s = this.top();
    if (!s || this.asleep || this.alert) return;       // blank or pop-up showing: redrawn on wake / close
    saveResume(s.kind === 'list' || s.kind === 'gfx' ? s.resume ?? null : null);
    if (s.kind === 'gfx') return this.renderGfx(s);
    this.laidOut = s;
    const page = this.layout(s as Exclude<Screen, GfxScreen>);
    if (!this.started) { this.started = true; await this.bridge.createStartUpPageContainer(new CreateStartUpPageContainer(page)); }
    else await this.bridge.rebuildPageContainer(new RebuildPageContainer(page));
    // Image containers start empty: send the badge pixels once the page exists (cached after the first load).
    const imgs: [number, BadgeRef, number][] = s.kind === 'list' && s.badge ? [[BADGE_ID, s.badge, TEAM_BADGE]]
      : s.kind === 'match' ? [[BADGE_ID, s.home, MATCH_BADGE], [AWAY_BADGE_ID, s.away, MATCH_BADGE]] : [];
    for (const [id, ref, size] of imgs) {
      const b = await getBadge(ref, size).catch(() => null);
      if (!b || !this.onScreen(s)) continue;
      await this.bridge.updateImageRawData(new ImageRawDataUpdate({ containerID: id, containerName: `badge${id}`, imageData: b.glasses }));
    }
  }

  private async renderGfx(s: GfxScreen) {
    if (this.laidOut !== s) {
      const page = this.fullScreenImagePage();
      if (!this.started) { this.started = true; await this.bridge.createStartUpPageContainer(new CreateStartUpPageContainer(page)); }
      else await this.bridge.rebuildPageContainer(new RebuildPageContainer(page));
      this.laidOut = s; s.keys = [];
    }
    s.sel = Math.max(0, Math.min(s.sel, s.count() - 1));
    const ts = tiles(await s.draw(s.sel));
    for (let k = 0; k < 4; k++) {
      if (!this.onScreen(s) || this.laidOut !== s) return;
      const key = tileKey(ts[k]);
      if (s.keys![k] === key) continue;
      await this.sendTile(k, ts[k]);
      s.keys![k] = key;
    }
  }

  /** Badge mask for drawing; loads in the background and redraws the current graphical screen when it arrives. */
  private mask(r: BadgeRef): HTMLCanvasElement | null | undefined {
    const key = `${r.src}|${r.id ?? ''}|${r.logo ?? ''}|${r.name}|${r.image ? r.image.length + r.image.slice(-24) : ''}`;
    if (this.masks.has(key)) return this.masks.get(key);
    this.masks.set(key, undefined as unknown as null);
    getBadge(r, BADGE_PX).then((b) => this.masks.set(key, b.mask)).catch(() => this.masks.set(key, null))
      .finally(() => { if (this.top()?.kind === 'gfx') this.render(); });
    return undefined;
  }

  private layout(s: Exclude<Screen, GfxScreen>) {
    const img = (id: number, x: number, y: number, size: number) =>
      new ImageContainerProperty({ containerID: id, containerName: `badge${id}`, xPosition: x, yPosition: y, width: size, height: size });
    if (s.kind === 'match') {
      const B = MATCH_BADGE, pad = 6;
      return {
        containerTotalNum: 4,
        textObject: [
          new TextContainerProperty({ containerID: 1, containerName: 'head', xPosition: B + 2 * pad, yPosition: 4, width: W - 2 * (B + 2 * pad), height: B + 4,
            paddingLength: 4, isEventCapture: 0, content: fmt.clipBytes(s.head, 999) }),
          new TextContainerProperty({ containerID: 2, containerName: 'body', xPosition: 0, yPosition: B + 2 * pad, width: W, height: H - B - 2 * pad,
            paddingLength: 8, isEventCapture: 1, content: fmt.clipBytes(s.body, 999) }),
        ],
        imageObject: [img(BADGE_ID, pad, pad, B), img(AWAY_BADGE_ID, W - B - pad, pad, B)],
      };
    }
    if (s.kind === 'list') {
      const left = s.badge ? TEAM_BADGE + 8 : 0;
      return {
        containerTotalNum: s.badge ? 3 : 2,
        textObject: [new TextContainerProperty({
          containerID: 1, containerName: 'title', xPosition: 0, yPosition: 0, width: W, height: HEADER_H,
          paddingLength: 6, isEventCapture: 0, content: fmt.clipBytes(fmt.clip(s.title, 52), 120),
        })],
        listObject: [new ListContainerProperty({
          containerID: 2, containerName: 'list', xPosition: left, yPosition: HEADER_H, width: W - left,
          height: Math.min(H - HEADER_H, Math.min(s.items.length, 20) * ROW_H + 8),
          borderWidth: 0, paddingLength: 4, isEventCapture: 1,
          itemContainer: new ListItemContainerProperty({
            itemCount: Math.min(s.items.length, 20), itemWidth: W - left - 8, isItemSelectBorderEn: 1,
            itemName: s.items.slice(0, 20).map((t) => fmt.clipBytes(t, 60)),
          }),
        })],
        ...(s.badge ? { imageObject: [img(BADGE_ID, 4, HEADER_H + 8, TEAM_BADGE)] } : {}),
      };
    }
    return {
      containerTotalNum: 1,
      textObject: [new TextContainerProperty({
        containerID: 1, containerName: 'body', xPosition: 0, yPosition: 0, width: W, height: H,
        paddingLength: 8, isEventCapture: 1, content: fmt.clipBytes(s.content, 999),
      })],
    };
  }

  private updateTitle(content: string) {
    return this.bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: 1, containerName: 'title', content: fmt.clipBytes(fmt.clip(content, 52), 120) }));
  }
  private updateText(content: string) {
    return this.bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: 1, containerName: 'body', content: fmt.clipBytes(content, 999) }));
  }

  private fullScreenImagePage() {
    const img = (k: number, x: number, y: number) => new ImageContainerProperty({ containerID: 10 + k, containerName: `img${k}`, xPosition: x, yPosition: y, width: TILE_W, height: TILE_H });
    return {
      containerTotalNum: 5,
      textObject: [new TextContainerProperty({ containerID: 1, containerName: 'body', xPosition: 0, yPosition: 0, width: W, height: H, paddingLength: 0, isEventCapture: 1, content: ' ' })],
      imageObject: [img(0, 0, 0), img(1, TILE_W, 0), img(2, 0, TILE_H), img(3, TILE_W, TILE_H)],
    };
  }
}

// ---------- helpers ----------
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Badge for one side of a match (uploaded badges first, then the source's crest, then a monogram). */
function sideRef(m: Match, h: boolean): BadgeRef {
  const name = h ? m.home : m.away, id = h ? m.homeId : m.awayId;
  return { src: m.src, id, logo: h ? m.homeLogo : m.awayLogo, name,
    image: m.src === 'ft' || m.src === 'manual' ? grassrootsBadge(name) : customBadge(m.src, id) };
}
/** Is one of the user's favourite teams playing? ESPN favourites by team id, any source by club name. */
function hasFavourite(m: Match) {
  return load().favourites.some((f) => (m.src === f.src && (f.id === m.homeId || f.id === m.awayId))
    || sameName(f.name, m.home) || sameName(f.name, m.away));
}
/** Stable sort: matches with a favourite team move to the top, in their existing order. */
function favouritesFirst(ms: Match[]) {
  return [...ms.filter(hasFavourite), ...ms.filter((m) => !hasFavourite(m))];
}
/** Live fields from a merged match (score, minute, state) onto a 365Scores one. */
const pickLive = (x: Match): Partial<Match> => ({ state: x.state, hs: x.hs, as: x.as, clock: x.clock, ...(x.venue ? { venue: x.venue } : {}) });
function leagueTag(m: Match) {
  const l = espn.leagueBySlug(m.league) ?? bbc.bbcLeague(m.league);
  return l ? `${l.short}:` : '';
}
/** Club name for comparing across feeds: "Altrincham FC" = "Altrincham", "Man Utd"-style abbreviations
 *  are left to team ids. Words like United / City are kept, so Manchester United ≠ Manchester City. */
const nm = (s: string) => s.toLowerCase().replace(/&/g, 'and').replace(/\butd\b/g, 'united').replace(/\b(fc|afc|the)\b/g, '').replace(/[^a-z]/g, '');
const SUFFIX = /^(town|united|city|borough|athletic|rovers|wanderers|county|albion|fc)$/;
/** Same club, allowing one feed to add a plain suffix ("Buxton" = "Buxton Town", not "Arsenal" = "Arsenal Women"). */
function sameName(a: string, b: string) {
  const x = nm(a), y = nm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [lo, sh] = x.length > y.length ? [x, y] : [y, x];
  return sh.length >= 4 && lo.startsWith(sh) && SUFFIX.test(lo.slice(sh.length));
}
/** A favourite's own feed and the merged feed can list the same live match: keep the first. */
function dedupe(ms: Match[]) {
  const out: Match[] = [];
  for (const m of ms) if (!out.some((o) => o.kickoff.slice(0, 10) === m.kickoff.slice(0, 10) && ((sameName(o.home, m.home) && sameName(o.away, m.away)) || (o.kickoff === m.kickoff && (sameName(o.home, m.home) || sameName(o.away, m.away)))))) out.push(m);
  return out;
}
