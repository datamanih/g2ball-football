// 365Scores' public web feed (webws.365scores.com): free, no key, CORS-open, live minute and score.
// Used for FA Cup qualifying rounds and National League North / South, as a faster second feed next to BBC Sport.
// Unofficial, so calls are light (one request per refresh) and failures are silent.
import type { Match, MatchDetail, MatchState } from './model';
import { cached } from './cache';

const BASE = 'https://webws.365scores.com/web/games/';
/** 365Scores competition id → app league code. */
export const S365_LEAGUES = [
  { id: 7856, slug: 's365.facupq', name: 'FA Cup', short: 'FA Cup' },
  { id: 7852, slug: 's365.nlns', name: 'National League N/S', short: 'NL N/S' },
];
export const s365League = (slug?: string) => S365_LEAGUES.find((l) => l.slug === slug);

const dmy = (d: Date) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

function state(g: any): MatchState {
  const t: string = g.statusText ?? '';
  if (/postpon|cancel|abandon|suspend/i.test(t)) return 'off';
  if (g.statusGroup === 3) return 'in';
  if (g.statusGroup === 4) return 'post';
  return 'pre';
}
const stageShort = (s = '') => s.replace(/(\d)(st|nd|rd|th) Qualifying Round/i, '$1QR').replace(/Preliminary Round/i, 'Prelim').replace(/Extra Preliminary Round/i, 'EP');
/** Club crest from 365Scores' image CDN (PNG, transparent background, CORS-open). No placeholder: a club
 *  without a crest returns 404, so the app falls back to initials. */
export const crest = (id?: number, v = 1) => (id ? `https://imagecache.365scores.com/image/upload/f_png,w_128,h_128,c_limit,q_auto:eco,dpr_1/v${v}/Competitors/${id}` : undefined);
const score = (v: unknown) => (typeof v === 'number' && v >= 0 ? v : null);

function mapGame(g: any, lg: (typeof S365_LEAGUES)[number]): Match {
  const st = state(g);
  const t: string = g.statusText ?? '';
  const ko = new Date(g.startTime);
  const clock = st === 'in' ? (/half ?time|^HT$/i.test(t) ? 'HT' : g.gameTimeDisplay || (g.gameTime > 0 ? `${Math.round(g.gameTime)}'` : 'LIVE'))
    : st === 'post' ? (/ET|extra/i.test(t) ? 'AET' : /pen/i.test(t) ? 'Pens' : 'FT')
    : st === 'off' ? 'P-P' : ko.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
  return {
    id: String(g.id), src: 's365', league: lg.slug,
    leagueName: lg.id === 7856 ? `${lg.name} ${stageShort(g.stageName)}`.trim() : lg.name,
    kickoff: isNaN(+ko) ? '' : ko.toISOString(), state: st, clock,
    home: g.homeCompetitor?.name ?? '', away: g.awayCompetitor?.name ?? '',
    homeId: g.homeCompetitor?.id ? `s365:${g.homeCompetitor.id}` : undefined, awayId: g.awayCompetitor?.id ? `s365:${g.awayCompetitor.id}` : undefined,
    hs: st === 'pre' ? null : score(g.homeCompetitor?.score), as: st === 'pre' ? null : score(g.awayCompetitor?.score),
    homeLogo: crest(g.homeCompetitor?.id, g.homeCompetitor?.imageVersion), awayLogo: crest(g.awayCompetitor?.id, g.awayCompetitor?.imageVersion),
    s365Id: String(g.id), venue: g.venue?.name ?? '', city: '',
  };
}

export function today(date = new Date()): Promise<Match[]> {
  const d = dmy(date);
  return cached(`s365:${d}`, 30_000, async () => {
    const q = new URLSearchParams({ appTypeId: '5', langId: '1', timezoneName: 'Europe/London', userCountryId: '1',
      competitions: S365_LEAGUES.map((l) => l.id).join(','), startDate: d, endDate: d });
    const r = await fetch(`${BASE}?${q}`);
    if (!r.ok) throw new Error(`365Scores ${r.status}`);
    const j = await r.json();
    return (j.games ?? []).flatMap((g: any) => { const lg = S365_LEAGUES.find((l) => l.id === g.competitionId); return lg ? [mapGame(g, lg)] : []; });
  });
}

/**
 * One game's details: venue (with capacity) and goal / red-card minutes by side.
 * 365Scores doesn't name the scorer in its public feed, so goals show as "Goal 39'".
 */
export function detail(gameId: string): Promise<{ venue: string; capacity?: number; events: MatchDetail['events'] }> {
  return cached(`s365g:${gameId}`, 30_000, async () => {
    const q = new URLSearchParams({ appTypeId: '5', langId: '1', timezoneName: 'Europe/London', userCountryId: '1', gameId });
    const r = await fetch(`${BASE.replace('/games/', '/game/')}?${q}`);
    if (!r.ok) throw new Error(`365Scores ${r.status}`);
    const g = (await r.json()).game ?? {};
    const homeId = g.homeCompetitor?.id;
    const events: MatchDetail['events'] = [];
    for (const e of g.events ?? []) {
      const t = e.eventType ?? {}, sub = String(t.subTypeName ?? '');
      const kind = t.id === 1 ? (/own/i.test(sub) ? 'og' : /pen/i.test(sub) ? 'pen' : 'goal') : /red/i.test(t.name ?? '') ? 'red' : null;
      if (!kind) continue;
      const min = e.gameTimeDisplay || `${Math.round(e.gameTime ?? 0)}'`;
      events.push({ min, kind, text: kind === 'red' ? 'Red card' : 'Goal', side: e.competitorId === homeId ? 'home' : 'away' });
    }
    return { venue: g.venue?.name ?? '', capacity: g.venue?.capacity || undefined, events };
  });
}

/**
 * The current FA Cup qualifying round (the one being played now, else the latest, else the next) plus its
 * replays, for Browse. 365Scores lists replays without a round name, so they are labelled from the round.
 */
export function qualifyingRound(): Promise<Match[]> {
  return cached('s365:faq:round', 30_000, async () => {
    const now = Date.now();
    const q = new URLSearchParams({ appTypeId: '5', langId: '1', timezoneName: 'Europe/London', userCountryId: '1', competitions: '7856',
      startDate: dmy(new Date(now - 12 * 864e5)), endDate: dmy(new Date(now + 12 * 864e5)) });
    const r = await fetch(`${BASE}?${q}`);
    if (!r.ok) throw new Error(`365Scores ${r.status}`);
    const lg = S365_LEAGUES[0];
    const games: any[] = ((await r.json()).games ?? []).filter((g: any) => g.competitionId === 7856);
    const tOf = (g: any) => Date.parse(g.startTime) || 0;
    const stages = new Map<number, any[]>();
    for (const g of games) if (g.stageNum != null && g.stageName) { if (!stages.has(g.stageNum)) stages.set(g.stageNum, []); stages.get(g.stageNum)!.push(g); }
    if (!stages.size) return [];
    const nums = [...stages.keys()].sort((a, b) => a - b);
    const first = (n: number) => Math.min(...stages.get(n)!.map(tOf));
    // Latest round that has started (or starts within 2 days); otherwise the next one.
    const pick = [...nums].reverse().find((n) => first(n) <= now + 2 * 864e5) ?? nums[0];
    const nextStart = nums.filter((n) => n > pick).map(first).sort((a, b) => a - b)[0] ?? Infinity;
    const round = stages.get(pick)!.map((g) => mapGame(g, lg));
    const label = round[0]?.leagueName ?? 'FA Cup';
    const replays = games.filter((g) => !g.stageName && tOf(g) > first(pick) && tOf(g) < nextStart)
      .map((g) => ({ ...mapGame(g, lg), leagueName: `${label} replay` }));
    return [...round, ...replays].sort((a, b) => a.kickoff.localeCompare(b.kickoff) || a.home.localeCompare(b.home));
  });
}
