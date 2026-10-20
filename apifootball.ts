// API-Football (api-sports.io) — optional, needs the user's own key (free plan: 100 requests/day).
// Fills the gap below ESPN: National League North/South, Isthmian, Northern Premier and Southern
// leagues (steps 2–4), plus anything else in its 1,200-competition catalogue.
import type { Match, MatchState, Table, TeamOverview, TeamRef } from './model';
import { cached } from './cache';
import { load } from './store';

const BASE = 'https://v3.football.api-sports.io';

export const hasKey = () => !!load().apiFootballKey;

async function get(path: string): Promise<any[]> {
  const key = load().apiFootballKey;
  if (!key) throw new Error('Add an API-Football key on the phone to see non-league steps 2–4.');
  const r = await fetch(`${BASE}${path}`, { headers: { 'x-apisports-key': key } });
  if (!r.ok) throw new Error(`API-Football ${r.status}`);
  const d = await r.json();
  const errs = d.errors && (Array.isArray(d.errors) ? d.errors : Object.values(d.errors));
  if (errs?.length) throw new Error(`API-Football: ${String(errs[0]).slice(0, 120)}`);
  return d.response ?? [];
}

/** Football seasons are named by their starting year (2026 = 2026/27). */
export function season(now = new Date()) { return now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1; }

const LIVE = new Set(['1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE', 'INT', 'SUSP']);
const OFF = new Set(['PST', 'CANC', 'ABD', 'AWD', 'WO']);
function mapFixture(f: any): Match {
  const s: string = f.fixture?.status?.short ?? 'NS';
  const st: MatchState = LIVE.has(s) ? 'in' : OFF.has(s) ? 'off' : ['FT', 'AET', 'PEN'].includes(s) ? 'post' : 'pre';
  const clock = st === 'in' ? (s === 'HT' ? 'HT' : `${f.fixture.status.elapsed ?? ''}'`) : st === 'post' ? s : st === 'off' ? (s === 'PST' ? 'P-P' : s) : '';
  return {
    id: String(f.fixture.id), src: 'apif', league: String(f.league?.id ?? ''), leagueName: f.league?.name ?? '',
    kickoff: f.fixture.date ? new Date(f.fixture.date).toISOString() : '', state: st, clock,
    home: f.teams?.home?.name ?? '?', away: f.teams?.away?.name ?? '?',
    homeId: f.teams?.home?.id ? String(f.teams.home.id) : undefined, awayId: f.teams?.away?.id ? String(f.teams.away.id) : undefined,
    homeLogo: f.teams?.home?.logo, awayLogo: f.teams?.away?.logo,
    hs: st === 'pre' ? null : f.goals?.home ?? null, as: st === 'pre' ? null : f.goals?.away ?? null,
    venue: f.fixture?.venue?.name ?? '', city: f.fixture?.venue?.city ?? '',
  };
}

function mapTable(resp: any[], teamId?: string): Table | undefined {
  const groups: any[][] = resp[0]?.league?.standings ?? [];
  const g = groups.find((rows) => rows.some((r: any) => String(r.team?.id) === teamId)) ?? groups[0];
  if (!g) return undefined;
  return {
    name: resp[0].league.name,
    rows: g.map((r: any) => ({
      pos: r.rank, team: r.team?.name, teamId: String(r.team?.id), p: r.all?.played ?? 0, w: r.all?.win ?? 0, d: r.all?.draw ?? 0,
      l: r.all?.lose ?? 0, gf: r.all?.goals?.for ?? 0, ga: r.all?.goals?.against ?? 0, gd: r.goalsDiff ?? 0, pts: r.points ?? 0,
      note: r.description ?? undefined,
    })),
  };
}

export async function searchTeams(q: string): Promise<TeamRef[]> {
  if (q.length < 3) return [];
  const r = await get(`/teams?search=${encodeURIComponent(q)}`);
  return r.map((x: any) => ({ src: 'apif' as const, id: String(x.team.id), name: x.team.name, leagueName: x.team.country }));
}

/** English competitions in progress — used to browse non-league divisions on the glasses. */
export function englishLeagues(): Promise<{ id: string; name: string }[]> {
  return cached('apif:lg:eng', 24 * 3600_000, async () => {
    const r = await get(`/leagues?country=England&current=true`);
    return r.filter((x: any) => x.league.type === 'League')
      .map((x: any) => ({ id: String(x.league.id), name: x.league.name }))
      .sort((a: any, b: any) => a.name.localeCompare(b.name));
  });
}

export function leagueTable(id: string): Promise<Table | undefined> {
  return cached(`apif:st:${id}`, 30 * 60_000, async () => mapTable(await get(`/standings?league=${id}&season=${season()}`)));
}

export function leagueFixtures(id: string): Promise<Match[]> {
  return cached(`apif:lf:${id}`, 5 * 60_000, async () => {
    const [last, next] = await Promise.all([get(`/fixtures?league=${id}&season=${season()}&last=10`), get(`/fixtures?league=${id}&season=${season()}&next=10`)]);
    return [...last, ...next].map(mapFixture).sort((a, b) => a.kickoff.localeCompare(b.kickoff));
  });
}

export async function teamOverview(t: TeamRef): Promise<TeamOverview> {
  const [last, next] = await Promise.all([
    cached(`apif:last:${t.id}`, 5 * 60_000, () => get(`/fixtures?team=${t.id}&last=5`)),
    cached(`apif:next:${t.id}`, 5 * 60_000, () => get(`/fixtures?team=${t.id}&next=5`)),
  ]);
  const ms = [...last, ...next].map(mapFixture);
  const live = ms.find((m) => m.state === 'in');
  const table = await cached(`apif:tst:${t.id}`, 30 * 60_000, async () => mapTable(await get(`/standings?team=${t.id}&season=${season()}`), t.id)).catch(() => undefined);
  return {
    team: t, live,
    last: ms.filter((m) => m.state === 'post').sort((a, b) => b.kickoff.localeCompare(a.kickoff)),
    next: ms.filter((m) => m.state === 'pre' || m.state === 'off').sort((a, b) => a.kickoff.localeCompare(b.kickoff)),
    table, ground: ms.find((m) => m.home === t.name)?.venue,
  };
}
