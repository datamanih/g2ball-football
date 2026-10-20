// Pure text formatting for the 576x288 monochrome HUD. No SDK calls, so it runs in the self-test too.
import type { Match, MatchDetail, Table, TableRow, TeamOverview } from './model';

export const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

// Firmware limits: list items ≤ 63 bytes, text containers ≤ 999 bytes.
const enc = new TextEncoder();
export function clipBytes(s: string, max: number) {
  if (enc.encode(s).length <= max) return s;
  let out = '';
  for (const ch of s) { if (enc.encode(out + ch + '…').length > max) break; out += ch; }
  return out + '…';
}

// ---------- names ----------
const SHORT: [RegExp, string][] = [
  [/^Manchester United$/, 'Man Utd'], [/^Manchester City$/, 'Man City'], [/^Tottenham Hotspur$/, 'Spurs'],
  [/^Wolverhampton Wanderers$/, 'Wolves'], [/^Brighton & Hove Albion$/, 'Brighton'], [/^Nottingham Forest$/, "Nott'm Forest"],
  [/^West Ham United$/, 'West Ham'], [/^Newcastle United$/, 'Newcastle'], [/^Sheffield Wednesday$/, 'Sheff Wed'],
  [/^Sheffield United$/, 'Sheff Utd'], [/^Queens Park Rangers$/, 'QPR'], [/^West Bromwich Albion$/, 'West Brom'],
  [/ Football Club$| F\.?C\.?$| A\.?F\.?C\.?$/, ''],
];
export function short(name: string, max = 16) {
  let n = name;
  for (const [re, to] of SHORT) n = n.replace(re, to);
  return clip(n.trim(), max);
}

// ---------- dates (always UK time) ----------
const TZ = 'Europe/London';
const fmt = (iso: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, ...o }).format(new Date(iso));
export const hhmm = (iso: string) => (iso ? fmt(iso, { hour: '2-digit', minute: '2-digit' }) : '');
export function day(iso: string, now = new Date()) {
  if (!iso) return 'TBC';
  const d = fmt(iso, { year: 'numeric', month: '2-digit', day: '2-digit' }), t = fmt(now.toISOString(), { year: 'numeric', month: '2-digit', day: '2-digit' });
  const tm = fmt(new Date(now.getTime() + 864e5).toISOString(), { year: 'numeric', month: '2-digit', day: '2-digit' });
  const ys = fmt(new Date(now.getTime() - 864e5).toISOString(), { year: 'numeric', month: '2-digit', day: '2-digit' });
  if (d === t) return 'Today'; if (d === tm) return 'Tomorrow'; if (d === ys) return 'Yesterday';
  return fmt(iso, { weekday: 'short', day: 'numeric', month: 'short' });
}
const when = (m: Match, now?: Date) => `${day(m.kickoff, now)} ${hhmm(m.kickoff)}`.trim();

// ---------- matches ----------
const sc = (m: Match) => `${m.hs ?? '-'}-${m.as ?? '-'}`;
/** One line: "Man Utd 2-1 Chelsea 67'" / "Everton v Chelsea 12:30" / "… P-P". */
export function matchLine(m: Match, n = 15, now?: Date) {
  const h = short(m.home, n), a = short(m.away, n);
  if (m.state === 'pre') return `${h} v ${a} · ${day(m.kickoff, now) === 'Today' ? '' : day(m.kickoff, now) + ' '}${hhmm(m.kickoff)}`;
  if (m.state === 'off') return `${h} v ${a} · ${m.clock}`;
  return `${h} ${sc(m)} ${a} · ${m.clock}`;
}

/** From one team's point of view: "W 2-1 v Chelsea (H)" or "v Everton (A) · Sat 17 Oct 12:30". */
export function teamView(m: Match, team: string, now?: Date) {
  const home = m.home === team || m.home === short(team, 40) || sameish(m.home, team);
  const opp = short(home ? m.away : m.home, 18), ha = home ? 'H' : 'A';
  if (m.state === 'pre') return `v ${opp} (${ha}) · ${when(m, now)}`;
  if (m.state === 'off') return `v ${opp} (${ha}) · ${m.clock}`;
  const us = home ? m.hs : m.as, them = home ? m.as : m.hs;
  const res = us === null || them === null ? '' : us > them ? 'W ' : us < them ? 'L ' : 'D ';
  return `${m.state === 'in' ? `LIVE ${m.clock} ` : res}${us ?? '-'}-${them ?? '-'} v ${opp} (${ha})`;
}
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const sameish = (a: string, b: string) => { const x = norm(a), y = norm(b); return !!x && !!y && (x.includes(y) || y.includes(x)); };
export const teamName = (ov: TeamOverview) => {
  const ms = [...ov.last, ...ov.next, ...(ov.live ? [ov.live] : [])];
  const counts = new Map<string, number>();
  ms.flatMap((m) => [m.home, m.away]).forEach((n) => counts.set(n, (counts.get(n) ?? 0) + 1));
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ov.team.name;
};

export function form(ov: TeamOverview, n = 5) {
  const me = teamName(ov);
  return ov.last.slice(0, n).map((m) => {
    const home = m.home === me, us = home ? m.hs : m.as, them = home ? m.as : m.hs;
    return us === null || them === null ? '?' : us > them ? 'W' : us < them ? 'L' : 'D';
  }).join(' ');
}

export function position(ov: TeamOverview) {
  const me = teamName(ov);
  const r = ov.table?.rows.find((x) => (ov.team.src === 'espn' || ov.team.src === 'apif') && x.teamId === ov.team.id)
    ?? ov.table?.rows.find((x) => sameish(x.team, ov.team.name) || sameish(x.team, me));
  return r;
}
export function ordinal(n: number) { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }

// ---------- favourites ----------
/** Favourites list item (≤ 60 bytes): live score first, else next fixture, else last result. */
export function favItem(ov: TeamOverview, now?: Date) {
  const me = teamName(ov), name = short(ov.team.name, 14);
  if (ov.live) return clipBytes(`${name}: ${teamView(ov.live, me, now)}`, 60);
  const next = ov.next[0], last = ov.last[0];
  const recent = last && Date.now() - Date.parse(last.kickoff) < 20 * 3600_000;   // show today's result for the evening
  if (recent || !next) return clipBytes(`${name}: ${last ? teamView(last, me, now) : 'no matches'}`, 60);
  return clipBytes(`${name}: ${teamView(next, me, now)}`, 60);
}

export function teamTitle(ov: TeamOverview) {
  // Header fits ~52 characters: "Altrincham · 6th · 24 pts · National League", league shortened to fit.
  const r = position(ov);
  const lg = ov.table?.name || ov.team.leagueName || '';
  const name = short(ov.team.name, 20);
  const head = r ? `${name} · ${ordinal(r.pos)} · ${r.pts} pts` : name;
  const room = 52 - head.length - 3;
  return clipBytes(room >= 6 && lg ? `${head} · ${clip(lg, room)}` : head, 120);
}

// ---------- match detail ----------
const ICON: Record<string, string> = { goal: '', pen: ' (pen)', og: ' (og)', red: ' RED', yellow: '', sub: '' };
export function matchDetail(d: MatchDetail, now?: Date) {
  const head = d.state === 'pre' ? `${short(d.home, 20)} v ${short(d.away, 20)}` : `${short(d.home, 20)} ${sc(d)} ${short(d.away, 20)}`;
  const status = d.state === 'in' ? `LIVE ${d.clock}` : d.state === 'post' ? d.clock : d.state === 'off' ? d.clock : '';
  const lines = [
    `${head}   ${status}`,
    `${clip(d.leagueName, 26)} · ${when(d, now)}`,
    d.venue ? `${clip(d.venue, 30)}${d.city ? ', ' + clip(d.city, 16) : ''}` : 'Venue TBC',
  ];
  const extra = [d.referee ? `Ref: ${clip(d.referee, 22)}` : '', d.attendance ? `Att: ${d.attendance.toLocaleString('en-GB')}` : ''].filter(Boolean).join(' · ');
  if (extra) lines.push(extra);
  const goals = d.events.filter((e) => e.kind === 'goal' || e.kind === 'pen' || e.kind === 'og');
  const reds = d.events.filter((e) => e.kind === 'red');
  if (goals.length) lines.push('', ...goals.slice(-6).map((e) => clip(`${e.min} ${e.text}${ICON[e.kind]}`, 50)));
  if (reds.length) lines.push(...reds.slice(-2).map((e) => clip(`${e.min} RED ${e.text}`, 50)));
  if (!goals.length && d.state !== 'pre' && d.src !== 'espn') lines.push('', 'Scorers not published for this league.');
  return clipBytes(lines.join('\n'), 999);
}

// ---------- tables ----------
export function tableItem(r: TableRow, mark = false) {
  const gd = r.gd > 0 ? `+${r.gd}` : `${r.gd}`;
  return clipBytes(`${mark ? '» ' : ''}${r.pos}. ${short(r.team, 20)} · P${r.p} · ${gd} · ${r.pts}pts`, 60);
}
export function tableTitle(t: Table) { return clipBytes(clip(t.name || 'League table', 40), 120); }

// ---------- match screen with badges ----------
// Layout: [home badge] header text [away badge] across the top, details underneath.
const surname = (n: string) => { const p = n.trim().split(/\s+/); return p.length > 1 ? p.slice(1).join(' ') : n; };

/** Header between the two badges (~30 characters wide, 3 lines). */
export function matchHead(d: Match, now?: Date) {
  const status = d.state === 'in' ? `LIVE ${d.clock}` : d.state === 'post' || d.state === 'off' ? d.clock : `${day(d.kickoff, now)} ${hhmm(d.kickoff)}`;
  const mid = d.state === 'pre' ? `v   ${status}` : d.state === 'off' ? `v   ${status}` : `${d.hs ?? '-'} - ${d.as ?? '-'}   ${status}`;
  return clipBytes([short(d.home, 26), mid, short(d.away, 26)].join('\n'), 999);
}

/** Details under the badges: competition and date, venue, officials, scorers by side, red cards. */
export function matchBody(d: MatchDetail, now?: Date) {
  const lines = [`${clip(d.leagueName, 28)} · ${when(d, now)}`, d.venue ? `${clip(d.venue, 34)}${d.city ? ', ' + clip(d.city, 14) : ''}` : 'Venue TBC'];
  const extra = [d.referee ? `Ref: ${clip(d.referee, 22)}` : '', d.attendance ? `Att: ${d.attendance.toLocaleString('en-GB')}` : ''].filter(Boolean).join(' · ');
  if (extra) lines.push(extra);
  const goals = d.events.filter((e) => e.kind === 'goal' || e.kind === 'pen' || e.kind === 'og');
  const fmtGoal = (e: MatchDetail['events'][number]) => `${surname(e.who ?? e.text)} ${e.min}${e.kind === 'pen' ? ' (p)' : e.kind === 'og' ? ' (og)' : ''}`;
  if (goals.some((g) => g.side)) {
    for (const side of ['home', 'away'] as const) {
      const g = goals.filter((x) => x.side === side);
      if (g.length) lines.push(clip(`${short(side === 'home' ? d.home : d.away, 12)}: ${g.map(fmtGoal).join(', ')}`, 58));
    }
  } else if (goals.length) lines.push(clip(goals.map(fmtGoal).join(', '), 58));
  const reds = d.events.filter((e) => e.kind === 'red');
  if (reds.length) lines.push(clip(`Red: ${reds.map((e) => `${surname(e.who ?? e.text)} ${e.min}`).join(', ')}`, 58));
  if (!goals.length && d.state === 'post' && d.src !== 'espn' && (d.hs ?? 0) + (d.as ?? 0) > 0) lines.push('Scorers not published for this league.');
  return clipBytes(lines.join('\n'), 999);
}
