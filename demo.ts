// Dev-only demo data (loaded with ?demo). Never bundled into the production build's start path.
import { load, save, notifyFavs, badgeKey } from './store';

export async function seedDemo(live = false) {
  const s = load();
  if (!new URLSearchParams(location.search).has("devcustom")) s.customBadges = {};
  // ?devfeed: an Apify-feed team using a real feed captured from Full-Time (dev/ft-feed.json).
  const df = new URLSearchParams(location.search).get('devfeed');
  const feedTeam = df === null ? [] : df === 'eofl' ? [{
    id: 'feed', name: 'Leigh Ramblers', leagueName: 'Essex Olympian Premier', method: 'apify' as const,
    feedUrl: `${location.origin}/dev/eofl-feed.json`, divisionId: '390705635', matches: [],
  }] : [{
    id: 'feed', name: 'AFC Didsbury', fullTimeName: 'AFC Didsbury Sunday', leagueName: '', method: 'apify' as const,
    feedUrl: `${location.origin}/dev/ft-feed.json`, divisionId: '409926786', matches: [],
  }];
  if (feedTeam.length) s.apifyFeedUrl = feedTeam[0].feedUrl;
  s.grassroots = [...feedTeam, {
    id: 'demo', name: 'Didsbury Dynamos', leagueName: 'Manchester Sunday Div 2', method: 'manual',
    tablePaste: [
      '1\tLittle Heath FC\t6\t5\t1\t0\t19\t6\t13\t16', '2\tDidsbury Dynamos\t6\t4\t1\t1\t17\t9\t8\t13',
      '3\tSpartak Tesco\t6\t3\t1\t2\t14\t11\t3\t10', '4\tFog Lane Rangers\t6\t3\t0\t3\t12\t12\t0\t9',
      '5\tChorlton Villa\t6\t2\t1\t3\t9\t13\t-4\t7', '6\tWithington Wanderers\t6\t1\t2\t3\t8\t14\t-6\t5',
      '7\tBurnage Athletic\t6\t1\t1\t4\t7\t16\t-9\t4', '8\tLevenshulme Lions\t6\t0\t1\t5\t5\t20\t-15\t1',
    ].join('\n'),
    matches: [
      { id: 'a', date: '2026-10-11', time: '10:30', opponent: 'Spartak Tesco', home: true, venue: 'Fog Lane Park', us: 3, them: 2 },
      { id: 'b', date: '2026-10-18', time: '10:30', opponent: 'Little Heath FC', home: false, venue: 'Heath Rec, Pitch 3', us: null, them: null },
      { id: 'c', date: '2026-10-25', time: '10:30', opponent: 'Chorlton Villa', home: true, venue: 'Fog Lane Park', us: null, them: null },
    ],
  }];
  s.favourites = [
    { src: 'espn', id: '360', name: 'Manchester United', league: 'eng.1', leagueName: 'Premier League' },
    { src: 'espn', id: '633', name: 'Altrincham', league: 'eng.5', leagueName: 'National League' },
    { src: 'espn', id: '256', name: 'Celtic', league: 'sco.1', leagueName: 'Scottish Premiership' },
    { src: 'espn', id: '379', name: 'Burnley', league: 'eng.2', leagueName: 'Championship' },
    ...(live ? [{ src: 'espn' as const, id: '5327', name: 'Sydney FC', league: 'aus.1', leagueName: 'A-League Men' }] : []),
    { src: 'manual', id: 'demo', name: 'Didsbury Dynamos', leagueName: 'Manchester Sunday Div 2' },
  ];
  if (live) s.favourites.splice(3, 1);           // swap Burnley for a team that is playing right now
  if (feedTeam.length) s.favourites.splice(4, 1, { src: 'ft', id: 'feed', name: feedTeam[0].name, leagueName: feedTeam[0].leagueName });
  await save(s);
}

/** Dev-only: after 6 s, keep the first `n` favourites and save — the same path as tapping Save favourites on the phone. */
export function devSave(n: number) {
  setTimeout(async () => {
    const s = load(); s.favourites = s.favourites.slice(0, n);
    await save(s); notifyFavs();
    console.log('[devsave] saved', s.favourites.length, 'favourites');
  }, 6000);
}

/** Dev-only: convert an image URL as if uploaded on the phone and attach it to the demo grassroots team. */
export async function devBadge(url: string, invert = false) {
  const { convertUpload } = await import('./badge');
  const s = load(); const g = s.grassroots.find((x) => x.id === 'demo');
  if (!g) return;
  g.badge = await convertUpload(url, { invert });
  await save(s);
  console.log('[devbadge] saved', g.badge.length, 'bytes');
}

/** Dev-only: give the first favourite a custom uploaded badge (replaces its official crest). */
export async function devCustom(url: string) {
  const { convertUpload } = await import('./badge');
  const s = load(); const t = s.favourites[0]; if (!t) return;
  s.customBadges = { ...(s.customBadges ?? {}), [badgeKey(t)]: await convertUpload(url) };
  await save(s);
  console.log('[devcustom] saved for', t.name);
}
