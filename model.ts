// Shared data shapes. Every source (ESPN, API-Football, FA Full-Time, manual) is mapped onto these.

export type Source = 'espn' | 'apif' | 'ft' | 'manual' | 'bbc' | 's365';

/** A followable team. `id` is unique within its source; `league` is the source's league/division key. */
export interface TeamRef {
  src: Source;
  id: string;
  name: string;
  league?: string;      // ESPN slug (eng.5), API-Football league id, or Full-Time division id
  leagueName?: string;
}

export type MatchState = 'pre' | 'in' | 'post' | 'off'; // off = postponed / cancelled / abandoned

export interface Match {
  id: string;
  src: Source;
  league?: string;
  leagueName: string;
  kickoff: string;      // ISO UTC; '' if unknown
  state: MatchState;
  clock: string;        // "67'", "HT", "FT", "P-P", or kickoff time text
  home: string;
  away: string;
  homeId?: string;      // source team ids, used for badges
  awayId?: string;
  homeLogo?: string;    // crest URL when the source gives one directly
  awayLogo?: string;
  /** 365Scores game id when that feed also lists the match (for venue and goal minutes) */
  s365Id?: string;
  hs: number | null;
  as: number | null;
  venue: string;
  city: string;
}

export interface TableRow {
  pos: number;
  team: string;
  teamId?: string;
  p: number; w: number; d: number; l: number;
  gf: number; ga: number; gd: number; pts: number;
  note?: string;        // Promoted, Play-offs, Relegated…
}

export interface Table { name: string; rows: TableRow[] }

export interface MatchDetail extends Match {
  events: { min: string; kind: 'goal' | 'pen' | 'og' | 'red' | 'yellow' | 'sub' | 'other'; text: string; who?: string; side?: 'home' | 'away' }[];
  attendance?: number;
  referee?: string;
}

/** What the Favourites section shows for one team. */
export interface TeamOverview {
  team: TeamRef;
  live?: Match;
  last: Match[];        // most recent first
  next: Match[];        // soonest first
  table?: Table;
  ground?: string;
}

export const isLive = (m?: Match) => m?.state === 'in';
