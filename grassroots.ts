// Grassroots and Sunday league football (FA Full-Time). The FA publishes no public API, and Full-Time
// blocks automated requests, so there are three routes, in order of preference:
//   1. FullTime API — open-source JSON service over Full-Time (github.com/jwhughes-work/FullTimeAPI).
//      Point it at your own instance; the public demo instance is often slow or offline.
//   2. FA Full-Time embed codes — the league secretary / team admin can copy them from
//      Full-Time Admin → Media → Code snippets. Loaded in a hidden frame and read like a web page.
//   3. Apify feed — your own Apify Actor (apify/fulltime-feed in this repo) reads Full-Time on a schedule in a
//      real browser and publishes one JSON record; the app reads its public link. Same field names as FullTime API.
//   4. Manual — paste the league table copied from the Full-Time page and type in fixtures/scores.
import type { Match, Table, TableRow, TeamOverview, TeamRef } from './model';
import { cached } from './cache';
import { load, type GrassrootsTeam, type ManualMatch } from './store';

// ---------- 1. FullTime API ----------
const base = () => (load().fullTimeApiUrl || 'https://faapi.jwhsolutions.co.uk').replace(/\/+$/, '');

async function ftGet(path: string): Promise<any> {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 25_000);
  try {
    const r = await fetch(`${base()}${path}`, { signal: ctl.signal });
    if (!r.ok) throw new Error(`FullTime API ${r.status}`);
    return await r.json();
  } catch (e) {
    throw new Error((e as Error).name === 'AbortError' ? 'FullTime API timed out (is your instance running?)' : (e as Error).message);
  } finally { clearTimeout(t); }
}

// Response field names aren't documented for every endpoint, so read them defensively.
const pick = (o: any, ...re: RegExp[]) => { for (const r of re) for (const k of Object.keys(o ?? {})) if (r.test(k)) return o[k]; return undefined; };
const num = (v: any) => (v === undefined || v === null || v === '' || isNaN(+v) ? 0 : +v);

export async function searchLeagues(q: string): Promise<{ id: string; name: string }[]> {
  const r = await ftGet(`/api/Search/leagues/${encodeURIComponent(q)}`);
  return (Array.isArray(r) ? r : []).map((x: any) => ({ id: String(pick(x, /^leagueid$/i, /id$/i)), name: String(pick(x, /name/i) ?? '') }));
}
export async function searchDivisions(leagueId: string): Promise<{ id: string; name: string }[]> {
  const r = await ftGet(`/api/Search/divisions/${encodeURIComponent(leagueId)}`);
  return (Array.isArray(r) ? r : []).map((x: any) => ({ id: String(pick(x, /^divisionid$/i, /id$/i)), name: String(pick(x, /name/i) ?? '') }));
}

function ftDate(s: string): string {
  // "15/03/25 14:00" (UK) → ISO
  const m = /(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?/.exec(s ?? '');
  if (!m) return '';
  const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
  return ukLocalToIso(y, +m[2], +m[1], +(m[4] ?? 12), +(m[5] ?? 0));
}
/** Interpret a UK wall-clock time (GMT/BST) as an ISO UTC string. */
export function ukLocalToIso(y: number, mo: number, d: number, h: number, mi: number) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const off = new Date(guess).toLocaleString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', hour12: false });
  const shift = (+off.slice(-2) - h + 24) % 24;            // 1 in BST, 0 in GMT
  return new Date(guess - shift * 3600_000).toISOString();
}

function ftMatch(x: any, div: string, leagueName: string): Match {
  const when = String(pick(x, /datetime/i, /date/i) ?? '');
  let hs = pick(x, /^homescore/i, /homegoals/i), as = pick(x, /^awayscore/i, /awaygoals/i);
  const full = String(pick(x, /fullscore/i, /^score$/i) ?? '');
  const sm = /(\d+)\s*[-–]\s*(\d+)/.exec(full);
  if ((hs === undefined || as === undefined) && sm) { hs = sm[1]; as = sm[2]; }
  const played = hs !== undefined && hs !== null && hs !== '' && !isNaN(+hs);
  const status = /p\s*-\s*p|postpon|void|walkover|a\s*-\s*a/i.test(full) ? 'off' : played ? 'post' : 'pre';
  return {
    id: `${div}:${when}:${pick(x, /hometeam/i)}`, src: 'ft', league: div, leagueName: String(pick(x, /competition/i) ?? leagueName),
    kickoff: ftDate(when), state: status, clock: status === 'post' ? 'FT' : status === 'off' ? 'P-P' : '',
    home: String(pick(x, /hometeam/i) ?? '?'), away: String(pick(x, /awayteam/i) ?? '?'),
    hs: played ? +hs : null, as: played ? +as : null, venue: tidyVenue(String(pick(x, /location/i, /venue/i, /ground/i) ?? '')), city: '',
  };
}

/** Full-Time often sends venues in capitals ("HOUGH END PLAYING FIELDS Hough End"): title-case the capitals, drop a repeated tail. */
function tidyVenue(v: string) {
  const t = v.replace(/\b([A-Z][A-Z'&()-]+)\b/g, (w) => (w.length <= 3 && /^(FC|AFC|YMCA|RFC|CC|UK)$/.test(w) ? w : w[0] + w.slice(1).toLowerCase())).trim();
  const words = t.split(/\s+/), half = words.findIndex((_, i) => i > 0 && words.slice(i).join(' ').toLowerCase() === words.slice(0, words.length - i).slice(-(words.length - i)).join(' ').toLowerCase());
  return half > 0 ? words.slice(0, half).join(' ') : t;
}

function ftTable(r: any, name: string): Table {
  const rows = (Array.isArray(r) ? r : r?.teams ?? r?.table ?? []).map((x: any, i: number): TableRow => {
    const gf = num(pick(x, /goalsfor|^f$|^for$/i)), ga = num(pick(x, /goalsagainst|^a$|^against$/i));
    return {
      pos: num(pick(x, /^pos/i, /rank/i)) || i + 1, team: String(pick(x, /team/i, /name/i) ?? '?'),
      p: num(pick(x, /played|^p$/i)), w: num(pick(x, /won|wins|^w$/i)), d: num(pick(x, /drawn|draws|^d$/i)), l: num(pick(x, /lost|losses|^l$/i)),
      gf, ga, gd: num(pick(x, /goaldiff|^gd$/i)) || gf - ga, pts: num(pick(x, /points|^pts$/i)),
    };
  });
  return { name, rows };
}

// ---------- 2. FA Full-Time embed codes ----------
/**
 * Runs an FA Full-Time code snippet (the `var lrcode = '…'` + cs1.js embed) inside a hidden, same-origin
 * frame and reads back every table it renders. Returns rows of cell text.
 */
export function runEmbed(code: string, timeoutMs = 15_000): Promise<string[][]> {
  return cached(`emb:${code.length}:${hash(code)}`, 10 * 60_000, () => new Promise((resolve, reject) => {
    if (typeof document === 'undefined') return reject(new Error('Embed codes need the phone WebView'));
    const f = document.createElement('iframe');
    f.style.cssText = 'position:absolute;width:1px;height:1px;left:-9999px;border:0';
    f.srcdoc = `<!doctype html><html><body>${code.replace(/http:\/\/full-time\.thefa\.com/g, 'https://fulltime.thefa.com')}</body></html>`;
    const t0 = Date.now();
    const poll = () => {
      const doc = f.contentDocument;
      const rows = doc ? [...doc.querySelectorAll('tr')].map((tr) => [...tr.querySelectorAll('td,th')].map((c) => (c.textContent ?? '').replace(/\s+/g, ' ').trim())) : [];
      if (rows.length > 1) { f.remove(); return resolve(rows); }
      if (Date.now() - t0 > timeoutMs) { f.remove(); return reject(new Error('Full-Time embed returned no data')); }
      setTimeout(poll, 500);
    };
    document.body.append(f);
    setTimeout(poll, 800);
  }));
}
function hash(s: string) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return h; }

const TABLE_RE = /^\s*(\d+)\s+(.+?)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(-?\+?\d+)\s+(-?\d+)\s*$/;
const TABLE_RE_NOGD = /^\s*(\d+)\s+(.+?)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(-?\d+)\s*$/;
/** Parses a league table from rows of cells (embed) or from text pasted from the Full-Time page. */
export function parseTable(lines: string[], name: string): Table {
  const rows: TableRow[] = [];
  for (const raw of lines) {
    const line = raw.replace(/\t/g, ' ');
    let m = TABLE_RE.exec(line);
    if (m) { rows.push({ pos: +m[1], team: m[2], p: +m[3], w: +m[4], d: +m[5], l: +m[6], gf: +m[7], ga: +m[8], gd: +m[9], pts: +m[10] }); continue; }
    m = TABLE_RE_NOGD.exec(line);
    if (m) rows.push({ pos: +m[1], team: m[2], p: +m[3], w: +m[4], d: +m[5], l: +m[6], gf: +m[7], ga: +m[8], gd: +m[7] - +m[8], pts: +m[9] });
  }
  return { name, rows };
}

/** Fixtures/results rows from an embed: look for a date cell, two team cells and an optional "2 - 1" cell. */
function parseEmbedMatches(rows: string[][], g: GrassrootsTeam): Match[] {
  const out: Match[] = [];
  for (const r of rows) {
    const di = r.findIndex((c) => /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(c));
    if (di < 0) continue;
    const rest = r.filter((_, i) => i !== di && r[i] !== '');
    const si = rest.findIndex((c) => /^\s*(\d+|X)\s*[-–]\s*(\d+|X)\s*$/i.test(c) || /^v(s)?$/i.test(c));
    const teams = rest.filter((c, i) => i !== si && c.length > 2 && !/^(L|C|Cup|\d{1,2}:\d{2})$/i.test(c));
    if (teams.length < 2) continue;
    const time = r.find((c) => /^\d{1,2}:\d{2}$/.test(c)) ?? '';
    const sc = si >= 0 ? /(\d+)\s*[-–]\s*(\d+)/.exec(rest[si]) : null;
    out.push(ftMatch({ fixtureDateTime: `${r[di].match(/\d{1,2}\/\d{1,2}\/\d{2,4}/)![0]} ${time}`, homeTeam: teams[0], awayTeam: teams[1],
      fullScore: sc ? sc[0] : '', location: teams[2] ?? '' }, g.id, g.leagueName));
  }
  return out;
}

// ---------- 3. Apify feed ----------
export interface FeedDivision {
  id: string; name: string; season?: string; table: any[]; fixtures: any[]; results: any[]; errors?: string[];
}
export interface Feed { format: string; version: number; updated: string; source?: string; divisions: FeedDivision[] }

/** Loads an Apify feed (the Actor's FEED record). Cached for 5 minutes; the Actor itself refreshes on its schedule. */
export function loadFeed(url: string, fresh = false): Promise<Feed> {
  const get = async () => {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 20_000);
    try {
      const r = await fetch(url.trim(), { signal: ctl.signal, cache: 'no-store' });
      if (r.status === 404) throw new Error('Apify feed not found: run the Actor once, then copy the link from its log');
      if (r.status === 401 || r.status === 403) throw new Error('Apify feed is private: use the signed link from the Actor log');
      if (!r.ok) throw new Error(`Apify feed ${r.status}`);
      const f = await r.json();
      if (f?.format !== 'g2ball-fulltime-feed' || !Array.isArray(f.divisions)) throw new Error('That link is not a G2Ball Full-Time feed');
      return f as Feed;
    } catch (e) {
      throw new Error((e as Error).name === 'AbortError' ? 'Apify feed timed out' : (e as Error).message);
    } finally { clearTimeout(t); }
  };
  return fresh ? get() : cached(`feed:${url}`, 5 * 60_000, get);
}

/** Every team named in a feed division (table first, then fixtures/results). */
export function feedTeams(d: FeedDivision): string[] {
  const names = new Set<string>();
  for (const r of d.table ?? []) if (r.teamName) names.add(String(r.teamName));
  for (const m of [...(d.fixtures ?? []), ...(d.results ?? [])]) { if (m.homeTeam) names.add(String(m.homeTeam)); if (m.awayTeam) names.add(String(m.awayTeam)); }
  return [...names];
}

/** How long ago the feed was refreshed, for the phone page. */
export function feedAge(f: Feed) {
  const mins = Math.round((Date.now() - Date.parse(f.updated)) / 60000);
  return !isFinite(mins) ? 'unknown' : mins < 1 ? 'just now' : mins < 90 ? `${mins} min ago` : mins < 48 * 60 ? `${Math.round(mins / 60)} h ago` : `${Math.round(mins / 1440)} days ago`;
}

// ---------- 4. Manual ----------
function manualMatch(m: ManualMatch, g: GrassrootsTeam): Match {
  const played = m.us !== null && m.us !== undefined && m.them !== null && m.them !== undefined;
  const [y, mo, d] = m.date.split('-').map(Number); const [h, mi] = (m.time || '10:30').split(':').map(Number);
  return {
    id: m.id, src: 'manual', league: g.id, leagueName: g.leagueName, kickoff: y ? ukLocalToIso(y, mo, d, h, mi) : '',
    state: m.off ? 'off' : played ? 'post' : 'pre', clock: m.off ? 'P-P' : played ? 'FT' : '',
    home: m.home ? g.name : m.opponent, away: m.home ? m.opponent : g.name,
    hs: played ? (m.home ? m.us! : m.them!) : null, as: played ? (m.home ? m.them! : m.us!) : null,
    venue: m.venue ?? '', city: '',
  };
}

// ---------- unified ----------
const sameTeamName = (a: string, b: string) => a.toLowerCase().trim() === b.toLowerCase().trim();
const involves = (m: Match, name: string) => [m.home, m.away].some((t) => t.toLowerCase().includes(name.toLowerCase()) || name.toLowerCase().includes(t.toLowerCase()));

export async function teamOverview(t: TeamRef): Promise<TeamOverview> {
  const g = load().grassroots.find((x) => x.id === t.id);
  if (!g) throw new Error('Grassroots team not found. Set it up on the phone.');
  let matches: Match[] = [], table: Table | undefined;
  const filterName = g.fullTimeName || g.name;
  if (g.method === 'apify' && g.feedUrl) {
    const f = await loadFeed(g.feedUrl);
    const d = f.divisions.find((x) => x.id === g.divisionId) ?? f.divisions.find((x) => feedTeams(x).some((n) => sameTeamName(n, filterName)));
    if (!d) throw new Error(`${filterName} isn't in this Apify feed. Add the division to the Actor's input.`);
    const leagueName = g.leagueName || d.name;
    matches = [...(d.fixtures ?? []), ...(d.results ?? [])].map((x) => ftMatch(x, d.id, leagueName)).filter((m) => involves(m, filterName));
    // A fixture that now has a result appears in both lists: keep the result.
    const seen = new Map<string, Match>();
    for (const m of matches) { const k = `${m.kickoff.slice(0, 10)}|${m.home}|${m.away}`; const o = seen.get(k); if (!o || (m.state === 'post' && o.state !== 'post')) seen.set(k, m); }
    matches = [...seen.values()];
    if (d.table?.length) table = ftTable(d.table, leagueName);
  } else if (g.method === 'ftapi' && g.divisionId) {
    const div = g.divisionId, q = encodeURIComponent(filterName);
    const [fx, rs, tb] = await Promise.all([
      cached(`ft:fx:${div}:${q}`, 15 * 60_000, () => ftGet(`/api/Fixtures/${div}?teamName=${q}`)).catch(() => []),
      cached(`ft:rs:${div}:${q}`, 10 * 60_000, () => ftGet(`/api/Results/${div}?teamName=${q}`)).catch(() => []),
      cached(`ft:tb:${div}`, 30 * 60_000, () => ftGet(`/api/League/${div}`)),
    ]);
    matches = [...(fx ?? []), ...(rs ?? [])].map((x: any) => ftMatch(x, div, g.leagueName));
    table = ftTable(tb, g.leagueName);
  } else {
    if (g.embedTable) table = parseTable((await runEmbed(g.embedTable)).map((r) => r.join(' ')), g.leagueName);
    else if (g.tablePaste) table = parseTable(g.tablePaste.split(/\r?\n/), g.leagueName);
    for (const code of [g.embedFixtures, g.embedResults]) if (code) matches.push(...parseEmbedMatches(await runEmbed(code).catch(() => []), g).filter((m) => involves(m, filterName)));
    matches.push(...(g.matches ?? []).map((m) => manualMatch(m, g)));
  }
  // Grassroots results come in after the final whistle; there is no in-play feed.
  const now = Date.now();
  return {
    team: t,
    last: matches.filter((m) => m.state === 'post').sort((a, b) => b.kickoff.localeCompare(a.kickoff)),
    next: matches.filter((m) => m.state !== 'post' && (!m.kickoff || Date.parse(m.kickoff) > now - 3 * 3600_000)).sort((a, b) => a.kickoff.localeCompare(b.kickoff)),
    table, ground: matches.find((m) => (m.home === g.name || m.home === filterName) && m.venue)?.venue,
  };
}

export function divisionTable(divisionId: string, name: string): Promise<Table> {
  return cached(`ft:tb:${divisionId}`, 30 * 60_000, () => ftGet(`/api/League/${divisionId}`)).then((r) => ftTable(r, name));
}
export function divisionResults(divisionId: string, name: string): Promise<Match[]> {
  return cached(`ft:rs:${divisionId}:`, 10 * 60_000, () => ftGet(`/api/Results/${divisionId}`)).then((r) => (r ?? []).map((x: any) => ftMatch(x, divisionId, name)));
}
export function divisionFixtures(divisionId: string, name: string): Promise<Match[]> {
  return cached(`ft:fx:${divisionId}:`, 15 * 60_000, () => ftGet(`/api/Fixtures/${divisionId}`)).then((r) => (r ?? []).map((x: any) => ftMatch(x, divisionId, name)));
}
