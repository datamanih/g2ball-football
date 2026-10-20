// Settings are saved in two places:
//  - the Even app's own storage (bridge.setLocalStorage), which survives app restarts and WebView cache clears;
//  - the WebView's localStorage, as a fast local copy and for use outside the Even app (browser / self-test).
// On startup initStore() reads the Even app copy first and falls back to localStorage.
import type { EvenAppBridge } from '@evenrealities/even_hub_sdk';
import type { TeamRef } from './model';

export const MAX_FAVOURITES = 5;

export interface ManualMatch {
  id: string; date: string; time?: string;   // date YYYY-MM-DD, time HH:MM (UK)
  opponent: string; home: boolean; venue?: string;
  us?: number | null; them?: number | null; off?: boolean;
}

/** Full-Time data (FullTime API or an Apify feed) vs. typed-in data. */
export const grassSrc = (g: { method: string }) => (g.method === 'manual' ? 'manual' as const : 'ft' as const);

/** A Sunday league / grassroots team, configured on the phone. */
export interface GrassrootsTeam {
  id: string; name: string; leagueName: string;
  method: 'ftapi' | 'apify' | 'manual';
  fullTimeName?: string;                       // the name exactly as Full-Time shows it, if different
  divisionId?: string;                         // FullTime API route; for Apify feeds, which division in the feed
  feedUrl?: string;                            // Apify feed: public link to the FEED record
  embedTable?: string; embedFixtures?: string; embedResults?: string; // FA Full-Time code snippets
  tablePaste?: string;                         // table copied from the Full-Time page
  badge?: string;                              // uploaded crest, already converted: 2-colour PNG data URL (white on transparent)
  matches: ManualMatch[];
}

export interface Settings {
  favourites: TeamRef[];                       // up to 5, shown first on the glasses
  apiFootballKey: string;
  fullTimeApiUrl: string;
  apifyFeedUrl: string;                        // last Apify feed link used (prefills the next team)
  grassroots: GrassrootsTeam[];
  refreshSec: number;                          // live refresh interval
  sleepSec: number;                            // blank the glasses screen after this long without a tap or scroll (0 = never)
  goalAlerts: 'live' | 'favourites' | 'off';   // pop-up on the glasses when a score changes
  customBadges: Record<string, string>;        // "src:id" → uploaded 2-colour badge (data URL), overrides the crest
}

const KEY = 'g2football.settings.v1';
const DEFAULTS: Settings = {
  favourites: [
    { src: 'espn', id: '360', name: 'Manchester United', league: 'eng.1', leagueName: 'Premier League' },
    { src: 'espn', id: '633', name: 'Altrincham', league: 'eng.5', leagueName: 'National League' },
  ],
  apiFootballKey: '',
  fullTimeApiUrl: '',
  apifyFeedUrl: '',
  grassroots: [],
  refreshSec: 60,
  sleepSec: 30,
  goalAlerts: 'live',
  customBadges: {},
};

const mem: { s?: Settings } = {};
let bridge: EvenAppBridge | null = null;
const ls = () => (typeof localStorage === 'undefined' ? null : localStorage);
export function load(): Settings {
  if (mem.s) return structuredClone(mem.s);
  try { const raw = ls()?.getItem(KEY); return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : structuredClone(DEFAULTS); }
  catch { return structuredClone(DEFAULTS); }
}

/** Load saved settings from the Even app's storage (call once the bridge is ready, before the UI starts). */
export async function initStore(b: EvenAppBridge | null) {
  bridge = b;
  if (!b) return;
  try {
    const raw = await b.getLocalStorage(KEY);
    if (raw) {
      const s = { ...DEFAULTS, ...JSON.parse(raw) } as Settings;
      mem.s = s; ls()?.setItem(KEY, JSON.stringify(s));
    } else {
      // First run on this version: copy any existing WebView settings into the Even app's storage.
      const local = ls()?.getItem(KEY);
      if (local) await b.setLocalStorage(KEY, local);
    }
  } catch { /* keep the localStorage copy */ }
}

/** Saves everywhere. Resolves true once the Even app has confirmed the write (or when running outside it). */
export async function save(s: Settings): Promise<boolean> {
  mem.s = structuredClone(s);
  const json = JSON.stringify(s);
  try { ls()?.setItem(KEY, json); } catch {}
  if (!bridge) return true;
  try { return (await bridge.setLocalStorage(KEY, json)) !== false; } catch { return false; }
}

/** The Even app bridge (null outside the app), e.g. for the photo picker. */
export const getBridge = () => bridge;

/** Fired when the phone page saves favourites, so the glasses can refresh what they show. */
export const FAVS_SAVED = 'g2football:favourites-saved';
/** Fired when screen sleep or goal alert options change on the phone page. */
export const OPTIONS_SAVED = 'g2football:options-saved';

export const badgeKey = (t: { src: string; id?: string }) => `${t.src}:${t.id ?? ''}`;
export const sameTeam = (a: TeamRef, b: TeamRef) => a.src === b.src && a.id === b.id;
export const isFavourite = (t: TeamRef) => load().favourites.some((f) => sameTeam(f, t));

/** Returns false when the 5-team limit is reached. */
export function addFavourite(t: TeamRef): boolean {
  const s = load();
  if (s.favourites.some((f) => sameTeam(f, t))) return true;
  if (s.favourites.length >= MAX_FAVOURITES) return false;
  s.favourites.push(t); void save(s); notifyFavs(); return true;
}
export function removeFavourite(t: TeamRef) { const s = load(); s.favourites = s.favourites.filter((f) => !sameTeam(f, t)); void save(s); notifyFavs(); }
export function notifyFavs() { if (typeof window !== 'undefined') window.dispatchEvent(new Event(FAVS_SAVED)); }

// Where the user was, so the app can resume after the phone locks.
export type Resume = { kind: 'favourites' } | { kind: 'team'; team: TeamRef } | { kind: 'live' };
const RKEY = 'g2football.resume.v1';
export function saveResume(r: Resume | null) { try { r ? ls()?.setItem(RKEY, JSON.stringify({ ...r, at: Date.now() })) : ls()?.removeItem(RKEY); } catch {} }
export function loadResume(): Resume | null {
  try { const r = JSON.parse(ls()?.getItem(RKEY) || 'null'); return r && Date.now() - r.at < 3 * 3600_000 ? r : null; } catch { return null; }
}
