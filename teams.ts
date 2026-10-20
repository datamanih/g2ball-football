// One entry point for any followed team, whichever source it comes from.
import type { TeamOverview, TeamRef } from './model';
import * as espn from './espn';
import * as apif from './apifootball';
import * as grass from './grassroots';

export function teamOverview(t: TeamRef): Promise<TeamOverview> {
  if (t.src === 'espn') return espn.teamOverview(t);
  if (t.src === 'apif') return apif.teamOverview(t);
  const p = grass.teamOverview(t);
  // Dev-only (?devlive): show the grassroots team's next match as live, to check live layouts.
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('devlive')) {
    return p.then((ov) => {
      const n = ov.next[0];
      return n ? { ...ov, next: ov.next.slice(1), live: { ...n, state: 'in', clock: "67'", hs: 0, as: 2, kickoff: new Date(Date.now() - 72 * 60_000).toISOString() } } : ov;
    });
  }
  return p;
}

/** Pyramid level label for the phone page. */
export function sourceLabel(t: TeamRef) {
  return t.src === 'espn' ? 'Pro / national' : t.src === 'apif' ? 'Non-league' : 'Grassroots';
}
