// ESPN's public soccer feed: free, no key, CORS-enabled, current season, live status and venues.
// Covers the Premier League down to the National League (step 1), Scottish, Welsh, Irish and
// European leagues and the UEFA competitions. Unofficial and undocumented, so keep calls light.
import type { Match, MatchDetail, MatchState, Table, TableRow, TeamOverview, TeamRef } from './model';
import { cached } from './cache';

const SITE = 'https://site.api.espn.com/apis/site/v2/sports/soccer';
const STAND = 'https://site.api.espn.com/apis/v2/sports/soccer';
const SEARCH = 'https://site.web.api.espn.com/apis/search/v2';

export interface League { slug: string; name: string; short: string; table: boolean }
export interface Region { name: string; leagues: League[] }

const L = (slug: string, name: string, short = name, table = true): League => ({ slug, name, short, table });

/** Browse catalogue. Every slug here was checked against the live feed. */
export const REGIONS: Region[] = [
  { name: 'England', leagues: [
    L('eng.1', 'Premier League', 'Prem'), L('eng.2', 'Championship', 'Champ'), L('eng.3', 'League One', 'L1'),
    L('eng.4', 'League Two', 'L2'), L('eng.5', 'National League', 'NL'),
    L('eng.fa', 'FA Cup', 'FA Cup', false), L('eng.league_cup', 'Carabao Cup', 'EFL Cup', false),
    L('eng.trophy', 'EFL Trophy', 'EFL Trophy'), L('eng.w.1', "Women's Super League", 'WSL'),
  ] },
  { name: 'Scotland', leagues: [
    L('sco.1', 'Scottish Premiership', 'SPL'), L('sco.2', 'Scottish Championship', 'S.Champ'), L('sco.3', 'Scottish League One', 'S.L1'),
    L('sco.4', 'Scottish League Two', 'S.L2'), L('sco.tennents', 'Scottish Cup', 'S.Cup', false),
    L('sco.cis', 'Scottish League Cup', 'S.LgCup', false), L('sco.challenge', 'Scottish Challenge Cup', 'Chall.Cup', false),
  ] },
  { name: 'Wales & Ireland', leagues: [
    L('wal.1', 'Cymru Premier', 'Cymru'), L('nir.1', 'NIFL Premiership', 'NIFL'), L('irl.1', 'League of Ireland', 'LOI'),
  ] },
  { name: 'UEFA', leagues: [
    L('uefa.champions', 'Champions League', 'UCL'), L('uefa.europa', 'Europa League', 'UEL'),
    L('uefa.europa.conf', 'Conference League', 'UECL'), L('uefa.nations', 'Nations League', 'UNL'),
  ] },
  { name: 'Europe', leagues: [
    L('esp.1', 'LaLiga', 'LaLiga'), L('esp.2', 'LaLiga 2', 'LaLiga2'), L('ger.1', 'Bundesliga', 'Bundes'),
    L('ger.2', '2. Bundesliga', 'Bundes2'), L('ita.1', 'Serie A', 'SerieA'), L('ita.2', 'Serie B', 'SerieB'),
    L('fra.1', 'Ligue 1', 'Ligue1'), L('fra.2', 'Ligue 2', 'Ligue2'), L('ned.1', 'Eredivisie', 'Ered'),
    L('por.1', 'Primeira Liga', 'Primeira'), L('bel.1', 'Pro League', 'Belgium'), L('tur.1', 'Super Lig', 'Turkey'),
    L('aut.1', 'Austrian Bundesliga', 'Austria'), L('sui.1', 'Swiss Super League', 'Swiss'),
    L('den.1', 'Superliga', 'Denmark'), L('nor.1', 'Eliteserien', 'Norway'), L('swe.1', 'Allsvenskan', 'Sweden'),
    L('gre.1', 'Super League', 'Greece'),
  ] },
];
export const ALL_LEAGUES = REGIONS.flatMap((r) => r.leagues);
export const leagueBySlug = (slug?: string) => ALL_LEAGUES.find((l) => l.slug === slug);
/** The UK & Ireland leagues + UEFA, polled for "Live now" / "Today". Europe is fetched on demand. */
export const HOME_LEAGUES = REGIONS.filter((r) => r.name !== 'Europe').flatMap((r) => r.leagues.map((l) => l.slug));

async function get(url: string): Promise<any> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Scores feed ${r.status}`);
  return r.json();
}

// ---------- mapping ----------
function state(st: any): MatchState {
  const n: string = st?.type?.name ?? '';
  if (/POSTPONED|CANCEL|ABANDON|SUSPENDED|DELAYED/.test(n)) return 'off';
  const s = st?.type?.state;
  return s === 'in' ? 'in' : s === 'post' ? 'post' : 'pre';
}
function clock(st: any, s: MatchState): string {
  const n: string = st?.type?.name ?? '';
  if (s === 'off') return /POSTPONED/.test(n) ? 'P-P' : /CANCEL/.test(n) ? 'Canc' : /ABANDON/.test(n) ? 'Aband' : 'Delayed';
  if (s === 'in') return n === 'STATUS_HALFTIME' ? 'HT' : (st.displayClock || "LIVE");
  if (s === 'post') return st?.type?.shortDetail === 'FT' ? 'FT' : (st?.type?.shortDetail || 'FT').replace('Final', 'FT');
  return '';
}
const score = (c: any): number | null => {
  const v = typeof c?.score === 'object' ? c.score?.displayValue ?? c.score?.value : c?.score;
  return v === undefined || v === null || v === '' ? null : Number(v);
};

export function mapEvent(e: any, leagueSlug?: string, leagueName?: string): Match {
  const c = e.competitions?.[0] ?? {};
  const home = c.competitors?.find((x: any) => x.homeAway === 'home') ?? c.competitors?.[0];
  const away = c.competitors?.find((x: any) => x.homeAway === 'away') ?? c.competitors?.[1];
  const s = state(c.status ?? e.status);
  const slug = e.league?.slug ?? leagueSlug;
  return {
    id: String(e.id), src: 'espn', league: slug,
    leagueName: leagueBySlug(slug)?.name ?? e.league?.name ?? leagueName ?? c.altGameNote ?? '',
    kickoff: e.date ?? c.date ?? '', state: s, clock: clock(c.status ?? e.status, s),
    home: home?.team?.shortDisplayName ?? home?.team?.displayName ?? '?',
    away: away?.team?.shortDisplayName ?? away?.team?.displayName ?? '?',
    homeId: home?.team?.id ? String(home.team.id) : undefined, awayId: away?.team?.id ? String(away.team.id) : undefined,
    hs: s === 'pre' ? null : score(home), as: s === 'pre' ? null : score(away),
    venue: c.venue?.fullName ?? '', city: c.venue?.address?.city ?? '',
  };
}

// ---------- endpoints ----------
const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');

/** Matches in one league on a date (default today). */
export function scoreboard(slug: string, date = new Date()): Promise<Match[]> {
  return cached(`sb:${slug}:${ymd(date)}`, 45_000, async () => {
    const d = await get(`${SITE}/${slug}/scoreboard?dates=${ymd(date)}`);
    return (d.events ?? []).map((e: any) => mapEvent(e, slug, d.leagues?.[0]?.name));
  });
}

/** One league from 3 days ago to 4 days ahead: the latest results plus the coming round (one request per day, cached). */
export async function matchweek(slug: string, now = new Date()): Promise<Match[]> {
  const days = [-3, -2, -1, 0, 1, 2, 3, 4].map((k) => new Date(now.getTime() + k * 864e5));
  const all = await Promise.all(days.map((d) => scoreboard(slug, d).catch(() => [] as Match[])));
  const seen = new Set<string>();
  return all.flat().filter((m) => !seen.has(m.id) && !!seen.add(m.id)).sort((x, y) => x.kickoff.localeCompare(y.kickoff));
}

/** Today's matches across the given leagues (UK & Ireland + UEFA by default). */
export async function today(slugs = HOME_LEAGUES, date = new Date()): Promise<Match[]> {
  const all = await Promise.all(slugs.map((s) => scoreboard(s, date).catch(() => [] as Match[])));
  return all.flat().sort((a, b) => a.kickoff.localeCompare(b.kickoff));
}

export function standings(slug: string): Promise<Table[]> {
  return cached(`st:${slug}`, 5 * 60_000, async () => {
    const d = await get(`${STAND}/${slug}/standings`);
    const groups = (d.children?.length ? d.children : [d]).filter((g: any) => g.standings?.entries?.length);
    const lgName = leagueBySlug(slug)?.name;
    return groups.map((g: any) => ({
      name: groups.length === 1 ? lgName ?? g.name ?? '' : g.name ?? '',
      rows: g.standings.entries.map((e: any): TableRow => {
        const st = (k: string) => Number(e.stats?.find((x: any) => x.name === k)?.value ?? 0);
        return {
          pos: st('rank'), team: e.team?.shortDisplayName ?? e.team?.displayName, teamId: String(e.team?.id ?? ''),
          p: st('gamesPlayed'), w: st('wins'), d: st('ties'), l: st('losses'),
          gf: st('pointsFor'), ga: st('pointsAgainst'), gd: st('pointDifferential'), pts: st('points'),
          note: e.note?.description,
        };
      }).sort((a: TableRow, b: TableRow) => a.pos - b.pos),
    }));
  });
}

export function leagueTeams(slug: string): Promise<TeamRef[]> {
  return cached(`tm:${slug}`, 6 * 3600_000, async () => {
    const d = await get(`${SITE}/${slug}/teams`);
    const lg = leagueBySlug(slug);
    return (d.sports?.[0]?.leagues?.[0]?.teams ?? []).map((t: any) => ({
      src: 'espn' as const, id: String(t.team.id), name: t.team.displayName, league: slug, leagueName: lg?.name,
    })).sort((a: TeamRef, b: TeamRef) => a.name.localeCompare(b.name));
  });
}

/** Team search (phone page). Soccer teams only. */
export async function searchTeams(q: string): Promise<TeamRef[]> {
  const d = await get(`${SEARCH}?query=${encodeURIComponent(q)}&limit=15&type=team&sport=soccer`);
  const out: TeamRef[] = [];
  for (const r of d.results ?? []) if (r.type === 'team') for (const c of r.contents ?? []) {
    if (!String(c.uid).startsWith('s:600~')) continue;            // 600 = soccer
    const id = String(c.uid).split('~t:')[1];
    const slug = c.defaultLeagueSlug;
    out.push({ src: 'espn', id, name: c.displayName, league: slug, leagueName: leagueBySlug(slug)?.name ?? c.subtitle });
  }
  return out;
}

async function schedule(id: string, fixtures: boolean): Promise<Match[]> {
  return cached(`sc:${id}:${fixtures}`, fixtures ? 10 * 60_000 : 60_000, async () => {
    const d = await get(`${SITE}/all/teams/${id}/schedule${fixtures ? '?fixture=true' : ''}`);
    return (d.events ?? []).map((e: any) => mapEvent(e));
  });
}

export async function teamOverview(t: TeamRef): Promise<TeamOverview> {
  const [res, fix, tables] = await Promise.all([
    schedule(t.id, false).catch(() => []), schedule(t.id, true).catch(() => []),
    t.league && leagueBySlug(t.league)?.table !== false ? standings(t.league).catch(() => []) : Promise.resolve([] as Table[]),
  ]);
  const all = [...res, ...fix];
  const live = all.find((m) => m.state === 'in');
  // A live match can sit in either list depending on cache age; refresh it from the scoreboard.
  let liveFresh = live;
  if (live?.league) liveFresh = (await scoreboard(live.league).catch(() => [])).find((m) => m.id === live.id) ?? live;
  const last = res.filter((m) => m.state === 'post').sort((a, b) => b.kickoff.localeCompare(a.kickoff));
  const next = fix.filter((m) => m.state === 'pre' || m.state === 'off').sort((a, b) => a.kickoff.localeCompare(b.kickoff));
  const table = tables.find((g) => g.rows.some((r) => r.teamId === t.id)) ?? tables[0];
  const homeGround = [...res, ...fix].find((m) => m.home === shortOf(t.name, all))?.venue;
  return { team: t, live: liveFresh, last, next, table, ground: homeGround };
}

// The schedule uses short names ("Man Utd"); match the followed team to them.
function shortOf(name: string, ms: Match[]) {
  const names = ms.flatMap((m) => [m.home, m.away]);
  const counts = new Map<string, number>(); names.forEach((n) => counts.set(n, (counts.get(n) ?? 0) + 1));
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? name;   // the team appears in every match
}

export function matchDetail(m: Match): Promise<MatchDetail> {
  return cached(`md:${m.id}`, m.state === 'in' ? 30_000 : 10 * 60_000, async () => {
    const d = await get(`${SITE}/${m.league ?? 'all'}/summary?event=${m.id}`);
    const comp = d.header?.competitions?.[0];
    const base = comp ? mapEvent({ ...d.header, competitions: [{ ...comp, venue: d.gameInfo?.venue ?? comp.venue }] }, m.league, m.leagueName) : m;
    const events = (d.keyEvents ?? []).map((k: any) => {
      const t = (k.type?.text ?? '').toLowerCase();
      const kind = t.includes('own goal') ? 'og' : t.includes('penalty') && k.scoringPlay ? 'pen' : k.scoringPlay || t === 'goal' ? 'goal'
        : t.includes('red') ? 'red' : t.includes('yellow') ? 'yellow' : t.includes('substitution') ? 'sub' : 'other';
      const who = k.participants?.[0]?.athlete?.displayName ?? '';
      const team = k.team?.abbreviation ?? (k.team?.displayName ? shortTeam(k.team.displayName) : '');
      const tid = k.team?.id ? String(k.team.id) : undefined;
      const side = tid && tid === base.homeId ? 'home' : tid && tid === base.awayId ? 'away' : undefined;
      return { min: k.clock?.displayValue ?? '', kind, text: who ? `${who}${team ? ` (${team})` : ''}` : (k.text ?? ''), who: who || undefined, side };
    }).filter((e: any) => e.kind !== 'other');
    const ref = d.gameInfo?.officials?.find((o: any) => /referee/i.test(o.position?.name ?? o.position?.displayName ?? '')) ?? d.gameInfo?.officials?.[0];
    return {
      ...m, ...base, venue: base.venue || m.venue, city: base.city || m.city,
      events, attendance: d.gameInfo?.attendance || undefined, referee: ref?.displayName ?? ref?.fullName,
    };
  });
}

const shortTeam = (n: string) => n.replace(/ (Town|City|United|Rovers|Athletic|Albion|Wanderers|FC|AFC)$/, '');
