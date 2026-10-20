// `npm test`: prints what the main glasses screens show, using live data. No glasses or simulator needed.
import * as espn from './espn';
import * as grass from './grassroots';
import * as fmt from './format';
import { teamOverview } from './teams';
import { load, save } from './store';

const line = (s = '') => console.log(s);
const s = load();
// A manual Sunday-league team, to check the grassroots path end to end.
s.grassroots = [{
  id: 'demo', name: 'Didsbury Dynamos', leagueName: 'Demo Sunday League Div 2', method: 'manual',
  tablePaste: 'Pos\tTeam\tP\tW\tD\tL\tF\tA\tGD\tPTS\n1\tLittle Heath FC\t4\t3\t1\t0\t11\t6\t5\t10\n2\tDidsbury Dynamos\t4\t3\t0\t1\t11\t7\t4\t9\n3\tSpartak Tesco\t4\t2\t0\t2\t11\t9\t2\t6',
  matches: [
    { id: 'a', date: '2026-10-11', time: '10:30', opponent: 'Spartak Tesco', home: true, venue: 'Fog Lane Park', us: 3, them: 2 },
    { id: 'b', date: '2026-10-25', time: '10:30', opponent: 'Little Heath FC', home: false, venue: 'Heath Rec', us: null, them: null },
  ],
}];
s.favourites = [
  { src: 'espn', id: '360', name: 'Manchester United', league: 'eng.1', leagueName: 'Premier League' },
  { src: 'espn', id: '633', name: 'Altrincham', league: 'eng.5', leagueName: 'National League' },
  { src: 'espn', id: '256', name: 'Celtic', league: 'sco.1', leagueName: 'Premiership' },
  { src: 'manual', id: 'demo', name: 'Didsbury Dynamos', leagueName: 'Demo Sunday League Div 2' },
];
await save(s);

line('=== Favourites ===');
const ovs = await Promise.all(s.favourites.map((t) => teamOverview(t)));
ovs.forEach((o) => line('  ' + fmt.favItem(o)));

for (const o of [ovs[1], ovs[3]]) {
  line(`\n=== Team: ${fmt.teamTitle(o)} ===`);
  if (o.next[0]) line(`  Next: ${fmt.teamView(o.next[0], o.team.name)}  @ ${o.next[0].venue}`);
  if (o.last[0]) line(`  Last: ${fmt.teamView(o.last[0], o.team.name)}`);
  line(`  Form: ${fmt.form(o)}   Ground: ${o.ground ?? '-'}`);
}

line('\n=== Match info (Altrincham last match) ===');
line(fmt.matchDetail(await espn.matchDetail(ovs[1].last[0])).split('\n').map((x) => '  ' + x).join('\n'));

line('\n=== National League table (top 6) ===');
const [t] = await espn.standings('eng.5');
t.rows.slice(0, 6).forEach((r) => line('  ' + fmt.tableItem(r, r.team === 'Altrincham')));
line(`  … ${t.rows.length} teams`);

line("\n=== Today (UK, Ireland & UEFA) ===");
const today = await espn.today();
line(`  ${today.length} matches, ${today.filter((m) => m.state === 'in').length} live`);
today.slice(0, 8).forEach((m) => line('  ' + fmt.matchLine(m)));

line('\n=== Team search "salford" ===');
(await espn.searchTeams('salford')).forEach((x) => line(`  ${x.name} · ${x.leagueName} (${x.league})`));

line('\n=== Pasted Full-Time table parse ===');
line('  ' + JSON.stringify(grass.parseTable(s.grassroots[0].tablePaste!.split('\n'), 'x').rows.map((r) => [r.pos, r.team, r.pts])));
