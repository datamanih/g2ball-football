// Phone-side settings page (the WebView page itself): favourites, grassroots teams, keys.
import { load, save, notifyFavs, getBridge, badgeKey, FAVS_SAVED, OPTIONS_SAVED, MAX_FAVOURITES, sameTeam, grassSrc, type GrassrootsTeam, type ManualMatch, type Settings } from './store';
import type { TeamRef } from './model';
import * as espn from './espn';
import * as apif from './apifootball';
import * as grass from './grassroots';
import { sourceLabel } from './teams';
import { invalidate } from './cache';
import { getBadge, teamBadge, convertUpload } from './badge';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const uid = () => Math.random().toString(36).slice(2, 10);

export function mountSettings() {
  const s = load();
  // Favourites are a draft until the user taps Save; everything else saves as it changes.
  let saved = structuredClone(s.favourites);
  const key = (fs: TeamRef[]) => fs.map((f) => `${f.src}:${f.id}`).join('|');
  const dirty = () => key(s.favourites) !== key(saved);
  const commit = () => {
    void save({ ...s, favourites: saved });          // never persists unsaved favourite changes
    invalidate(); renderFavs(); renderGrass();
  };
  const saveBtn = $<HTMLButtonElement>('favSave');
  const renderSave = () => {
    const d = dirty();
    saveBtn.disabled = !d;
    saveBtn.textContent = d ? 'Save favourites' : 'Favourites saved ✓';
    $('favUnsaved').style.display = d ? 'block' : 'none';
    $<HTMLButtonElement>('favRevert').disabled = !d;
  };
  saveBtn.onclick = async () => {
    saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
    const ok = await save(s);
    if (ok) {
      saved = structuredClone(s.favourites);
      notifyFavs();
      status(`Saved ${saved.length} favourite team${saved.length === 1 ? '' : 's'}. They'll load next time you open the app.`);
    } else status("Couldn't save to the Even app. Try again; your changes are still here.");
    renderSave();
  };
  $('favRevert').onclick = () => { s.favourites = structuredClone(saved); renderFavs(); renderGrass(); status('Changes undone.'); };
  // Favourite added/removed on the glasses: pick it up here (unless the user is mid-edit on the phone).
  window.addEventListener(FAVS_SAVED, () => {
    const now = load().favourites;
    if (key(now) === key(saved)) return;
    const editing = dirty();
    saved = structuredClone(now);
    if (!editing) { s.favourites = structuredClone(now); renderFavs(); renderGrass(); }
    else renderSave();
  });
  // Warn before leaving with unsaved favourites (browser preview; the Even app may not show it).
  window.addEventListener('beforeunload', (e) => { if (dirty()) { e.preventDefault(); e.returnValue = ''; } });

  // ---------- favourites ----------
  const renderFavs = () => {
    $('favCount').textContent = `${s.favourites.length}/${MAX_FAVOURITES}`;
    const ul = $('favs'); ul.innerHTML = '';
    s.favourites.forEach((t, i) => {
      const li = document.createElement('li');
      li.innerHTML = `<span class="team"><img class="badge" alt=""><span>${esc(t.name)}<br><small>${esc(t.leagueName ?? '')} · ${sourceLabel(t)}</small></span></span>`;
      showBadge(li, t);
      const up = btn('↑', () => { if (i) { [s.favourites[i - 1], s.favourites[i]] = [s.favourites[i], s.favourites[i - 1]]; commit(); } });
      const rm = btn('Remove', () => { s.favourites.splice(i, 1); commit(); });
      li.className = 'fav';
      const isGrass = t.src === 'ft' || t.src === 'manual';
      const g = isGrass ? s.grassroots.find((x) => x.id === t.id) : undefined;
      const k = badgeKey(t);
      const editor = badgeEditor({
        key: k, name: t.name, league: t.leagueName ?? '',
        get: () => (g ? g.badge : s.customBadges?.[k]),
        set: (v) => { if (g) g.badge = v; else { s.customBadges = { ...(s.customBadges ?? {}) }; if (v) s.customBadges[k] = v; else delete s.customBadges[k]; } },
        commit, crestNote: !isGrass,
      });
      editor.style.display = openEditors.has(k) ? 'grid' : 'none';
      const bb = btn('Badge', () => { const show = editor.style.display === 'none'; editor.style.display = show ? 'grid' : 'none'; show ? openEditors.add(k) : openEditors.delete(k); });
      li.append(span(bb, up, rm), editor); ul.append(li);
    });
    $('favFull').style.display = s.favourites.length >= MAX_FAVOURITES ? 'block' : 'none';
    renderSave();
  };
  const addFav = (t: TeamRef) => {
    if (s.favourites.some((f) => sameTeam(f, t))) return;
    if (s.favourites.length >= MAX_FAVOURITES) { status(`You can follow up to ${MAX_FAVOURITES} teams. Remove one first.`); return; }
    s.favourites.push(t); commit();
  };

  let timer: number | undefined;
  $<HTMLInputElement>('search').addEventListener('input', (e) => {
    clearTimeout(timer);
    const q = (e.target as HTMLInputElement).value.trim();
    if (q.length < 3) { $('results').innerHTML = ''; return; }
    timer = window.setTimeout(async () => {
      const [a, b] = await Promise.all([
        espn.searchTeams(q).catch(() => [] as TeamRef[]),
        apif.hasKey() ? apif.searchTeams(q).catch((err) => { status(String(err.message)); return [] as TeamRef[]; }) : Promise.resolve([] as TeamRef[]),
      ]);
      // Prefer ESPN (free, live) when both know the team.
      const seen = new Set(a.map((t) => t.name.toLowerCase()));
      const hits = [...a, ...b.filter((t) => !seen.has(t.name.toLowerCase()))];
      const ul = $('results'); ul.innerHTML = '';
      if (!hits.length) ul.innerHTML = `<li class="muted">No match. ${apif.hasKey() ? '' : 'Non-league steps 2–4 need an API-Football key (below). '}Sunday league teams: use Grassroots.</li>`;
      hits.forEach((t) => {
        const li = document.createElement('li');
        li.innerHTML = `<span class="team"><img class="badge" alt=""><span>+ ${esc(t.name)}<br><small>${esc(t.leagueName ?? '')} · ${sourceLabel(t)}</small></span></span>`;
        showBadge(li, t);
        li.onclick = () => { addFav(t); $<HTMLInputElement>('search').value = ''; ul.innerHTML = ''; };
        ul.append(li);
      });
    }, 350);
  });

  // ---------- grassroots ----------
  const renderGrass = () => {
    const ul = $('grassList'); ul.innerHTML = '';
    s.grassroots.forEach((g, i) => {
      const li = document.createElement('li'); li.className = 'card';
      const ref: TeamRef = { src: grassSrc(g), id: g.id, name: g.name, league: g.divisionId, leagueName: g.leagueName };
      const fav = s.favourites.some((f) => sameTeam(f, ref));
      li.innerHTML = `<div class="row2 team"><img class="badge" alt=""><b>${esc(g.name)}</b><small>${g.leagueName ? esc(g.leagueName) + ' · ' : ''}${g.method === 'apify' ? 'Apify feed' : g.method === 'ftapi' ? 'FullTime API' : g.embedTable || g.embedFixtures ? 'Full-Time embed' : 'Manual'}<span class="feedAge"></span></small></div>`;
      if (g.method === 'apify' && g.feedUrl) grass.loadFeed(g.feedUrl).then((f) => { li.querySelector('.feedAge')!.textContent = ` · updated ${grass.feedAge(f)}`; })
        .catch((e) => { li.querySelector('.feedAge')!.textContent = ` · ${(e as Error).message}`; });
      const bar = span(
        btn(fav ? '★ Favourite' : '☆ Add to favourites', () => { fav ? (s.favourites = s.favourites.filter((f) => !sameTeam(f, ref))) : addFav(ref); commit(); }),
        btn('Remove', () => { s.grassroots.splice(i, 1); s.favourites = s.favourites.filter((f) => !sameTeam(f, ref)); saved = saved.filter((f) => !sameTeam(f, ref)); commit(); }),
      );
      showBadge(li, ref);
      li.append(bar, badgeEditor({
        key: ref.src + ':' + g.id, name: g.name, league: g.leagueName,
        get: () => g.badge, set: (v) => { g.badge = v; }, commit,
      }));
      if (g.method === 'manual') li.append(matchEditor(g, commit));
      ul.append(li);
    });
  };

  const methodSel = $<HTMLSelectElement>('gMethod');
  const showMethod = () => { for (const m of ['apify', 'ftapi', 'embed', 'manual']) $(`m_${m}`).style.display = methodSel.value === m ? 'block' : 'none'; };
  methodSel.onchange = showMethod; showMethod();

  // Apify feed → division → team
  let feed: grass.Feed | null = null;
  const apFeed = $<HTMLInputElement>('apFeed'), apDiv = $<HTMLSelectElement>('apDiv'), apTeam = $<HTMLSelectElement>('apTeam');
  apFeed.value = s.apifyFeedUrl ?? '';
  const fillTeams = () => {
    const d = feed?.divisions.find((x) => x.id === apDiv.value);
    const teams = d ? grass.feedTeams(d).sort((a, b) => a.localeCompare(b)) : [];
    apTeam.innerHTML = `<option value="">Choose your team…</option>` + teams.map((t) => `<option>${esc(t)}</option>`).join('');
    $('apInfo').textContent = d ? `${d.table.length} table rows · ${d.fixtures.length} fixtures · ${d.results.length} results${d.errors?.length ? ` · last run: ${d.errors.join('; ')}` : ''}` : '';
  };
  apDiv.onchange = fillTeams;
  apTeam.onchange = () => {
    if (!apTeam.value) return;
    $<HTMLInputElement>('gName').value ||= apTeam.value;
    $<HTMLInputElement>('gFtName').value = apTeam.value === $<HTMLInputElement>('gName').value ? '' : apTeam.value;
    const d = feed?.divisions.find((x) => x.id === apDiv.value);
    if (d?.name && !$<HTMLInputElement>('gLeague').value.trim()) $<HTMLInputElement>('gLeague').value = d.name;
  };
  $('apLoad').onclick = async () => {
    const url = apFeed.value.trim();
    if (!/^https:\/\//.test(url) && !(import.meta.env.DEV && /^http:\/\/localhost/.test(url))) return status('Paste the feed link from the Actor log (starts with https://).');
    status('Loading Apify feed…');
    try {
      feed = await grass.loadFeed(url, true);
      apDiv.innerHTML = feed.divisions.map((d) => `<option value="${esc(d.id)}">${esc(d.name || `Division ${d.id}`)} (${grass.feedTeams(d).length} teams)</option>`).join('');
      fillTeams();
      s.apifyFeedUrl = url; commit();
      status(`Feed loaded: ${feed.divisions.length} division(s), updated ${grass.feedAge(feed)}. Pick your team.`);
    } catch (e) { feed = null; apDiv.innerHTML = ''; apTeam.innerHTML = ''; status((e as Error).message); }
  };

  // FullTime API league → division lookup
  $('ftSearch').onclick = async () => {
    const q = $<HTMLInputElement>('ftLeagueQ').value.trim(); if (q.length < 3) return;
    status('Searching Full-Time leagues… (can take 20 s)');
    try {
      const lgs = await grass.searchLeagues(q);
      $<HTMLSelectElement>('ftLeague').innerHTML = lgs.map((l) => `<option value="${esc(l.id)}">${esc(l.name)}</option>`).join('');
      status(lgs.length ? `${lgs.length} league(s) found. Pick one, then a division.` : 'No leagues found.');
      if (lgs[0]) loadDivs();
    } catch (e) { status(`FullTime API: ${(e as Error).message}. Use embed codes or Manual instead.`); }
  };
  const loadDivs = async () => {
    try {
      const ds = await grass.searchDivisions($<HTMLSelectElement>('ftLeague').value);
      $<HTMLSelectElement>('ftDiv').innerHTML = ds.map((d) => `<option value="${esc(d.id)}">${esc(d.name)}</option>`).join('');
    } catch (e) { status(`FullTime API: ${(e as Error).message}`); }
  };
  $('ftLeague').onchange = loadDivs;

  $('gAdd').onclick = () => {
    const name = $<HTMLInputElement>('gName').value.trim(), leagueName = $<HTMLInputElement>('gLeague').value.trim() || 'Sunday league';
    if (!name) return status('Enter your team name.');
    const m = methodSel.value;
    const g: GrassrootsTeam = { id: uid(), name, leagueName, method: m === 'ftapi' ? 'ftapi' : m === 'apify' ? 'apify' : 'manual', matches: [], fullTimeName: $<HTMLInputElement>('gFtName').value.trim() || undefined };
    if (m === 'apify') {
      if (!feed) return status('Load the Apify feed first.');
      g.feedUrl = apFeed.value.trim(); g.divisionId = apDiv.value || undefined;
      const ftName = g.fullTimeName || g.name, d = feed.divisions.find((x) => x.id === g.divisionId);
      if (d && !grass.feedTeams(d).some((t) => t.toLowerCase() === ftName.toLowerCase())) return status(`"${ftName}" isn't in that division. Pick it from the team list.`);
    } else if (m === 'ftapi') {
      g.divisionId = $<HTMLSelectElement>('ftDiv').value || $<HTMLInputElement>('ftDivManual').value.trim();
      if (!g.divisionId) return status('Pick a division (or type its ID).');
      const lg = $<HTMLSelectElement>('ftDiv').selectedOptions[0]?.text; if (lg && !$<HTMLInputElement>('gLeague').value.trim()) g.leagueName = lg;
    } else if (m === 'embed') {
      g.embedTable = $<HTMLTextAreaElement>('eTable').value.trim() || undefined;
      g.embedFixtures = $<HTMLTextAreaElement>('eFix').value.trim() || undefined;
      g.embedResults = $<HTMLTextAreaElement>('eRes').value.trim() || undefined;
      if (!g.embedTable && !g.embedFixtures && !g.embedResults) return status('Paste at least one Full-Time embed code.');
    } else {
      g.tablePaste = $<HTMLTextAreaElement>('pTable').value.trim() || undefined;
      if (g.tablePaste) {
        const n = grass.parseTable(g.tablePaste.split(/\r?\n/), leagueName).rows.length;
        status(n ? `Read ${n} table rows.` : 'Could not read the pasted table — check it has Pos, Team, P W D L F A (GD) Pts columns.');
      }
    }
    s.grassroots.push(g);
    if ($<HTMLInputElement>('gFav').checked) addFav({ src: grassSrc(g), id: g.id, name: g.name, league: g.divisionId, leagueName: g.leagueName });
    for (const id of ['gName', 'gLeague', 'gFtName', 'eTable', 'eFix', 'eRes', 'pTable', 'ftDivManual']) ($(id) as HTMLInputElement).value = '';
    commit();
  };

  // ---------- keys & options ----------
  bind('apifKey', 'apiFootballKey');
  bind('ftUrl', 'fullTimeApiUrl');
  const rs = $<HTMLSelectElement>('refresh'); rs.value = String(s.refreshSec); rs.onchange = () => { s.refreshSec = +rs.value; commit(); };
  const sl = $<HTMLSelectElement>('sleep'); sl.value = String(s.sleepSec ?? 30); sl.onchange = () => { s.sleepSec = +sl.value; commit(); window.dispatchEvent(new Event(OPTIONS_SAVED)); };
  const ga = $<HTMLSelectElement>('goalAlerts'); ga.value = s.goalAlerts ?? 'live'; ga.onchange = () => { s.goalAlerts = ga.value as Settings['goalAlerts']; commit(); window.dispatchEvent(new Event(OPTIONS_SAVED)); };
  function bind(id: string, key: 'apiFootballKey' | 'fullTimeApiUrl') {
    const el = $<HTMLInputElement>(id); el.value = (s as Settings)[key] ?? '';
    el.onchange = () => { (s as Settings)[key] = el.value.trim(); commit(); };
  }

  renderFavs(); renderGrass();
}

/** Fixtures & scores editor for a manual grassroots team. */
function matchEditor(g: GrassrootsTeam, commit: () => void) {
  const box = document.createElement('div'); box.className = 'matches';
  const rows = [...g.matches].sort((a, b) => a.date.localeCompare(b.date));
  box.innerHTML = `<small>Fixtures & scores</small>`;
  rows.forEach((m) => {
    const r = document.createElement('div'); r.className = 'mrow';
    r.innerHTML = `<span>${esc(m.date.slice(5).split('-').reverse().join('/'))} ${m.home ? 'v' : '@'} ${esc(m.opponent)}</span>`;
    const us = num(m.us), them = num(m.them);
    const iu = input('number', us, 'Us'), it = input('number', them, 'Opp');
    const save = () => { m.us = iu.value === '' ? null : +iu.value; m.them = it.value === '' ? null : +it.value; commit(); };
    iu.onchange = save; it.onchange = save;
    const pp = btn(m.off ? 'P-P ✓' : 'P-P', () => { m.off = !m.off; commit(); });
    const rm = btn('✕', () => { g.matches = g.matches.filter((x) => x.id !== m.id); commit(); });
    r.append(iu, it, pp, rm); box.append(r);
  });
  const add = document.createElement('div'); add.className = 'madd';
  const d = input('date', ''), t = input('time', '10:30'), o = input('text', '', 'Opponent'), v = input('text', '', 'Venue (optional)');
  const ha = document.createElement('select'); ha.innerHTML = '<option value="h">Home</option><option value="a">Away</option>';
  const go = btn('Add fixture', () => {
    if (!d.value || !o.value.trim()) return;
    const m: ManualMatch = { id: Math.random().toString(36).slice(2, 9), date: d.value, time: t.value, opponent: o.value.trim(), home: ha.value === 'h', venue: v.value.trim() || undefined, us: null, them: null };
    g.matches.push(m); commit();
  });
  add.append(d, t, o, ha, v, go); box.append(add);
  return box;
}

function btn(label: string, on: () => void) { const b = document.createElement('button'); b.className = 'ghost'; b.textContent = label; b.onclick = on; return b; }
function span(...els: HTMLElement[]) { const s = document.createElement('span'); s.className = 'btns'; s.append(...els); return s; }
function input(type: string, value: string, ph = '') { const i = document.createElement('input'); i.type = type; i.value = value; i.placeholder = ph; return i; }
const num = (v?: number | null) => (v === null || v === undefined ? '' : String(v));
function status(msg: string) { const el = document.getElementById('status'); if (el) el.textContent = msg; }

/** Fills the row's <img class="badge"> with the same 2-colour transparent badge the glasses show. */
function showBadge(row: HTMLElement, t: TeamRef) {
  const img = row.querySelector<HTMLImageElement>('img.badge');
  if (!img) return;
  getBadge(teamBadge(t), 96).then((b) => { img.src = b.dataUrl; }).catch(() => img.remove());
}

const originals = new Map<string, { src: string; inverted: boolean }>();
const openEditors = new Set<string>();
/** Where "Send to G2Ball" sends badges. */
export const BADGE_INBOX = 'datamanih@gmail.com';

interface BadgeTarget {
  key: string; name: string; league: string;
  get: () => string | undefined; set: (v?: string) => void; commit: () => void;
  /** true for teams that already have an official crest (shown until replaced) */
  crestNote?: boolean;
}

/** Upload / invert / remove / send a team's own badge. Only the 2-colour result is stored; the original stays in memory. */
function badgeEditor(t: BadgeTarget) {
  const box = document.createElement('div'); box.className = 'badgebox';
  const cur = t.get();
  const prev = document.createElement('img'); prev.className = 'badge big'; prev.alt = '';
  if (cur) prev.src = cur; else prev.style.display = 'none';
  const note = document.createElement('small');
  note.textContent = cur ? 'Your badge (2-colour, as shown on the glasses)'
    : t.crestNote ? 'Using the official crest. Upload your own to replace it.' : 'No badge yet: the glasses show initials';
  let original = originals.get(t.key)?.src;
  let inverted = originals.get(t.key)?.inverted ?? false;
  const apply = async (src: string) => {
    note.textContent = 'Converting…';
    originals.set(t.key, { src, inverted });
    try {
      t.set(await convertUpload(src, { invert: inverted }));
      openEditors.add(t.key);
      t.commit();                                // auto-saves (badges aren't part of the favourites draft)
      status(`Badge saved for ${t.name}.`);
    } catch { note.textContent = "Couldn't read that image. Try a PNG or JPG of the crest."; }
  };
  const file = document.createElement('input'); file.type = 'file'; file.accept = 'image/*'; file.style.display = 'none';
  file.onchange = () => {
    const f = file.files?.[0]; if (!f) return;
    const r = new FileReader(); r.onload = () => { original = String(r.result); inverted = false; apply(original); }; r.readAsDataURL(f);
  };
  const up = btn(cur ? 'Change badge' : 'Upload badge', async () => {
    const b = getBridge();
    if (b) {                                     // inside the Even app: use its photo picker
      try {
        const a = await b.pickImageFromAlbum();
        if (!a) return;
        original = a.base64.startsWith('data:') ? a.base64 : `data:${a.mimeType || 'image/png'};base64,${a.base64}`;
        inverted = false; return apply(original);
      } catch { /* fall back to the file chooser */ }
    }
    file.click();
  });
  const inv = btn('Invert', () => { if (original) { inverted = !inverted; apply(original); } else status('Upload the badge again to invert it.'); });
  const rm = btn(t.crestNote ? 'Use official crest' : 'Remove badge', () => { t.set(undefined); originals.delete(t.key); t.commit(); status(`Badge removed for ${t.name}.`); });
  const send = btn('Send to G2Ball', () => sendBadge(t, originals.get(t.key)?.src));
  const btns = span(up, ...(cur ? [inv, rm, send] : []));
  box.append(prev, note, btns, file);
  return box;
}

/**
 * Sends a team's badge to the G2Ball inbox so it can be checked and built into the app for everyone.
 * 1. Share sheet with the image files attached (Mail, Gmail, WhatsApp…), when the WebView supports it.
 * 2. Otherwise an email draft to BADGE_INBOX with the 2-colour badge embedded as text (data URL),
 *    plus an instruction to attach the original image.
 * Nothing is sent without the user confirming in their mail app / share sheet.
 */
async function sendBadge(t: BadgeTarget, original?: string) {
  const badge = t.get();
  if (!badge) return status('Upload a badge first.');
  const subject = `G2Ball Football badge: ${t.name}${t.league ? ` (${t.league})` : ''}`;
  const intro = `Team: ${t.name}\nLeague: ${t.league || '-'}\nApp key: ${t.key}\n`;
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  try {
    const files = [await toFile(badge, `${slug(t.name)}-badge-2colour.png`)];
    if (original) files.push(await toFile(original, `${slug(t.name)}-badge-original.${original.startsWith('data:image/jpeg') ? 'jpg' : 'png'}`));
    const data: ShareData = { title: subject, text: `${intro}\nPlease send to ${BADGE_INBOX}.`, files };
    if (nav.share && nav.canShare?.(data)) { await nav.share(data); return status('Badge shared.'); }
  } catch (e) { if ((e as Error).name === 'AbortError') return; }
  const small = await shrink(badge, 96);         // keeps the email draft short enough for mail apps
  const body = `${intro}\nPlease attach the original badge image to this email if you have it.\n\n2-colour badge (paste into a browser address bar to view):\n${small}\n`;
  const href = `mailto:${BADGE_INBOX}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  const opened = window.open(href, '_blank');
  if (!opened) location.href = href;
  status(`Opening an email to ${BADGE_INBOX}. Attach the original badge image if you have it, then send.`);
}
async function toFile(dataUrl: string, name: string) {
  const blob = await (await fetch(dataUrl)).blob();
  return new File([blob], name, { type: blob.type || 'image/png' });
}
async function shrink(dataUrl: string, S: number) {
  const img = await new Promise<HTMLImageElement>((r, j) => { const i = new Image(); i.onload = () => r(i); i.onerror = j; i.src = dataUrl; });
  const c = document.createElement('canvas'); c.width = S; c.height = S;
  const g = c.getContext('2d')!; g.imageSmoothingEnabled = false; g.drawImage(img, 0, 0, S, S);
  return c.toDataURL('image/png');
}
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
