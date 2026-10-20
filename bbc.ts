// BBC Sport's public scores data (the feed behind bbc.co.uk/sport/football/scores-fixtures): free, no key,
// CORS-open, updated within seconds. Used for the non-league competitions ESPN doesn't carry live:
// FA Cup qualifying rounds (when National League clubs enter), National League North / South and the FA Trophy.
// It has no venues or crests, so these matches show club initials.
import type { Match, MatchState } from './model';
import { cached } from './cache';
import * as espn from './espn';
import * as s365 from './s365';

const BASE = 'https://web-cdn.api.bbci.co.uk/wc-poll-data/container/sport-data-scores-fixtures';

/** BBC tournament URN → league code and short tag used in the app. */
export const BBC_LEAGUES = [
  { urn: 'national-league', slug: 'bbc.nl', name: 'National League', short: 'NL' },
  { urn: 'national-league-north', slug: 'bbc.nln', name: 'National League North', short: 'NLN' },
  { urn: 'national-league-south', slug: 'bbc.nls', name: 'National League South', short: 'NLS' },
  { urn: 'fa-cup', slug: 'bbc.facup', name: 'FA Cup', short: 'FA Cup' },
  { urn: 'fa-trophy', slug: 'bbc.trophy', name: 'FA Trophy', short: 'Trophy' },
];
export const bbcLeague = (slug?: string) => BBC_LEAGUES.find((l) => l.slug === slug) ?? s365.s365League(slug);

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function state(st: string): MatchState {
  if (st === 'MidEvent') return 'in';
  if (st === 'PostEvent') return 'post';
  if (/Postponed|Abandoned|Cancelled|Suspended/i.test(st)) return 'off';
  return 'pre';
}
const num = (v: unknown) => (v === undefined || v === null || v === '' ? null : Number(v));

function stageShort(stage = '') {
  return stage.replace(/(\d)(st|nd|rd|th) Round Qualifying/i, '$1QR').replace(/Preliminary Round/i, 'Prelim')
    .replace(/(\d)(st|nd|rd|th) Round Proper/i, 'R$1').replace(/(\d)(st|nd|rd|th) Round/i, 'R$1');
}

function mapEvent(e: any, lg: (typeof BBC_LEAGUES)[number]): Match {
  const st = state(e.status ?? '');
  const period: string = e.periodLabel?.value ?? '';
  const stage: string = e.stage?.name ?? '';
  const cup = lg.slug === 'bbc.facup' || lg.slug === 'bbc.trophy';
  return {
    id: String(e.id), src: 'bbc', league: lg.slug,
    leagueName: cup && stage ? `${lg.name} ${stageShort(stage)}` : lg.name,
    kickoff: e.startDateTime ?? e.date?.iso,
    state: st,
    clock: st === 'in' ? (period === 'HT' ? 'HT' : period) : st === 'post' ? (period && period !== 'FT' ? period : 'FT')
      : st === 'off' ? 'P-P' : e.time?.displayTimeUK ?? '',
    venue: '', city: '',
    home: e.home?.fullName ?? e.home?.shortName ?? '', away: e.away?.fullName ?? e.away?.shortName ?? '',
    homeId: e.home?.id ? `bbc:${e.home.id}` : undefined, awayId: e.away?.id ? `bbc:${e.away.id}` : undefined,
    hs: st === 'pre' ? null : num(e.home?.score), as: st === 'pre' ? null : num(e.away?.score),
  };
}

/** One competition for one day (cached briefly; the BBC itself caches for 5 seconds). */
function day(lg: (typeof BBC_LEAGUES)[number], date: Date): Promise<Match[]> {
  const d = iso(date), today = iso(new Date());
  return cached(`bbc:${lg.urn}:${d}`, 30_000, async () => {
    const q = new URLSearchParams({ selectedEndDate: d, selectedStartDate: d, todayDate: today,
      urn: `urn:bbc:sportsdata:football:tournament:${lg.urn}`, useSdApi: 'false' });
    const r = await fetch(`${BASE}?${q}`);
    if (!r.ok) throw new Error(`BBC scores ${r.status}`);
    const j = await r.json();
    return (j.eventGroups ?? []).flatMap((g: any) => (g.secondaryGroups ?? []).flatMap((sg: any) => sg.events ?? []))
      .map((e: any) => mapEvent(e, lg));
  });
}

export async function today(date = new Date()): Promise<Match[]> {
  const all = await Promise.all(BBC_LEAGUES.map((l) => day(l, date).catch(() => [] as Match[])));
  return all.flat();
}

// ---------- merging with ESPN ----------
// Club names across feeds: "Altrincham FC" = "Altrincham", "Buxton FC" = "Buxton", "Hemel Hempstead" =
// "Hemel Hempstead Town". United / City are kept so Manchester United ≠ Manchester City.
const norm = (s: string) => s.toLowerCase().replace(/&/g, 'and').replace(/\butd\b/g, 'united').replace(/\b(fc|afc|the)\b/g, '').replace(/[^a-z]/g, '');
const SUFFIX = /^(town|united|city|borough|athletic|rovers|wanderers|county|albion|fc)$/;
const sameSide = (a: string, b: string) => {
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [lo, sh] = x.length > y.length ? [x, y] : [y, x];
  return sh.length >= 4 && lo.startsWith(sh) && SUFFIX.test(lo.slice(sh.length));
};
/** Competition family, so a club's FA Cup tie isn't paired with its postponed league game on the same day. */
const family = (m: Match) => { const n = m.leagueName.toLowerCase();
  return /fa cup/.test(n) ? 'facup' : /trophy/.test(n) ? 'trophy' : /national league (north|south|n\s*\/\s*s)/.test(n) ? 'nlns' : /national league/.test(n) ? 'nl' : n; };
// Feeds name clubs differently (BBC's "United of Manchester" is 365Scores' "FC United"), so one matching side
// is enough within the same competition; any competition if both sides match.
const sameMatch = (a: Match, b: Match) => a.kickoff.slice(0, 10) === b.kickoff.slice(0, 10) && (
  (sameSide(a.home, b.home) && sameSide(a.away, b.away)) || (sameSide(a.home, b.away) && sameSide(a.away, b.home)) ||
  ((sameSide(a.home, b.home) || sameSide(a.away, b.away)) && family(a) === family(b)));

/**
 * ESPN's UK/UEFA matches plus BBC's non-league ones and 365Scores' FA Cup qualifying ties. A match on both keeps ESPN's details (badges, venue)
 * but takes BBC's live score and minute when BBC is further ahead, so scores update from either feed.
 */
export async function merged(date = new Date()): Promise<Match[]> {
  const [es, bb, sc] = await Promise.all([
    espn.today(espn.HOME_LEAGUES, date).catch(() => [] as Match[]),
    today(date).catch(() => [] as Match[]),
    s365.today(date).catch(() => [] as Match[]),
  ]);
  const goals = (m: Match) => (m.hs ?? -1) + (m.as ?? -1);
  // The further-on minute of two live clocks ("45'+2" > "38'", "HT" counts as 45).
  const mins = (c = '') => (c === 'HT' ? 45.5 : /^(\d+)'?(?:\+(\d+))?/.test(c) ? +RegExp.$1 + (+RegExp.$2 || 0) / 100 : -1);
  const later = (a = '', b = '') => (mins(a) >= mins(b) ? a || b : b || a);
  const out: Match[] = [...es];
  // Add BBC, then 365Scores. A match already listed keeps its details (badges, venue) but takes the newer
  // feed's live score and minute when that feed is further ahead, so scores update from any of them.
  for (const b of [...bb, ...sc]) {
    const i = out.findIndex((e) => sameMatch(e, b));
    if (i < 0) { out.push(b); continue; }
    let e = out[i];
    // Crests, venue and the 365Scores game id fill gaps (BBC has none); a side counts as the same club by name.
    const flip = !sameSide(e.home, b.home) && sameSide(e.away, b.home);
    e = out[i] = { ...e, s365Id: e.s365Id ?? b.s365Id, venue: e.venue || b.venue,
      homeLogo: e.homeLogo ?? (flip ? b.awayLogo : b.homeLogo), awayLogo: e.awayLogo ?? (flip ? b.homeLogo : b.awayLogo) };
    if (b.state === 'in' && (e.state !== 'in' || goals(b) > goals(e))) out[i] = { ...e, state: b.state, hs: b.hs, as: b.as, clock: later(b.clock, e.clock), venue: e.venue || b.venue };
    else if (b.state === 'in' && e.state === 'in' && goals(b) === goals(e)) out[i] = { ...e, clock: later(e.clock, b.clock), venue: e.venue || b.venue };
    else if (b.state === 'post' && e.state !== 'post') out[i] = { ...e, state: 'post', hs: b.hs, as: b.as, clock: b.clock || 'FT' };
    else if (!e.venue && b.venue) out[i] = { ...e, venue: b.venue };
  }
  // 365Scores keeps some postponed fixtures as "scheduled" (Bedford v Chorley on FA Cup day): drop 365Scores-only
  // games still not started 15 minutes after kick-off.
  const stale = (m: Match) => m.src === 's365' && m.state === 'pre' && !!m.kickoff && Date.now() - Date.parse(m.kickoff) > 15 * 60_000;
  for (let i = out.length - 1; i >= 0; i--) if (stale(out[i])) out.splice(i, 1);
  // Same kick-off: Premier League down to the National League first, then the non-league competitions.
  const order = [...espn.HOME_LEAGUES, ...BBC_LEAGUES.map((l) => l.slug), ...s365.S365_LEAGUES.map((l) => l.slug)];
  const rank = (m: Match) => { const i = order.indexOf(m.league ?? ''); return i < 0 ? order.length : i; };
  // Compare real times: ESPN writes "14:00Z", BBC "14:00:00Z".
  const t = (m: Match) => Date.parse(m.kickoff) || 0;
  return out.sort((a, b) => t(a) - t(b) || rank(a) - rank(b));
}
