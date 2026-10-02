// Recomputes reports/people/COVERAGE.md from the registries (personnel graph, ownership graph, people photos).
//   node scripts/people-coverage.mjs
import fs from 'node:fs';
import { loadPeople } from '../src/identity/people.mjs';
import { loadOwnership, careerTimeline, identityOf, profileVisible, ownershipForTeam, isOwnershipRelation } from '../src/identity/people-v2.mjs';

const reg = loadPeople();
const own = loadOwnership();
const season = 2026;
const people = Object.keys(reg.people);
const visible = reg.roles.filter(profileVisible);
const cur = new Set(reg.roles.filter((r) => r.display && !r.history && r.current === true && r.season === season).map((r) => r.personId));
const GROUP = { leadership: 'Leadership', technical: 'Technical', race_engineering: 'Race engineering', sporting: 'Sporting', power_unit: 'Power unit', garage_operations: 'Garage', ownership: 'Ownership' };
const groupOf = {};
for (const r of visible) (groupOf[r.roleGroup] ??= new Set()).add(r.personId);
const ownPeople = new Set((own.records || []).filter((o) => o.entity?.personId && isOwnershipRelation(o.relationship)).map((o) => o.entity.personId));
for (const p of ownPeople) (groupOf.ownership ??= new Set()).add(p);

const tier = { identityOnly: 0, roleOnly: 0, richBio: 0, photo: 0, careerHistory: 0 };
const rows = [];
for (const pid of people) {
  const id = identityOf(reg, pid);
  const idFacts = ['nationality', 'date_of_birth', 'birthplace'].filter((k) => id?.[k]?.value).length + ['education', 'specialty', 'prior_racing'].reduce((n, k) => n + (id?.[k]?.length || 0), 0);
  const tl = careerTimeline(reg, pid);
  const hasRole = tl.entries.length > 0;
  const history = tl.entries.some((e) => e.ranged && (!e.ongoing || e.from));
  const earlier = tl.entries.some((e) => !e.ongoing);
  if (idFacts && !hasRole) tier.identityOnly++;
  if (hasRole && !idFacts) tier.roleOnly++;
  if (hasRole && idFacts >= 2 && earlier) tier.richBio++;
  if (reg.photos?.[pid]?.rightsStatus === 'cleared') tier.photo++;
  if (earlier || history) tier.careerHistory++;
  if (earlier) rows.push([reg.people[pid].name, tl.entries.length, tl.entries.filter((e) => !e.ongoing).length, idFacts, reg.photos?.[pid]?.rightsStatus === 'cleared' ? 'yes' : '—']);
}
const teams = Object.keys(JSON.parse(fs.readFileSync('src/identity/teams-2026.json', 'utf8')).teams);
const ownRows = teams.map((t) => { const rs = ownershipForTeam(own, t); return [t, rs.length, rs.filter((o) => o.current).map((o) => `${o.entity.name} (${o.relationship}${o.percentage != null ? `, ${o.percentage}%` : ''})`).join('; ') || '—']; });
const md = `# F1 People coverage

Recomputed from the registries by \`node scripts/people-coverage.mjs\` (personnel ${reg.version}, retrieved ${reg.retrieved}; ownership ${own.version || '—'}).

## Totals

| Measure | Count |
|---|---|
| People in the registry | ${people.length} |
| Role records (all) | ${reg.roles.length} |
| Role records shown on profiles (sourced, high/medium, not held) | ${visible.length} |
| Historical role records (history=true) | ${reg.roles.filter((r) => r.history).length} |
| Held role records (low confidence / stale / superseded) | ${reg.roles.filter((r) => r.held).length} |
| Current ${season} people (team-page roles) | ${cur.size} |
| Ownership records (shown / all) | ${(own.records || []).filter((o) => ownershipForTeam(own, o.constructorId).includes(o)).length} / ${(own.records || []).length} |

## People by group (profile-visible roles; one person can sit in several)

| Group | People |
|---|---|
${Object.entries(GROUP).map(([k, l]) => `| ${l} | ${groupOf[k]?.size || 0} |`).join('\n')}

## Depth

| Tier | People |
|---|---|
| Identity only (identity facts, no shown role) | ${tier.identityOnly} |
| Role only (shown role, no sourced identity fact) | ${tier.roleOnly} |
| Rich bio (role + 2 or more identity/background facts + an earlier role) | ${tier.richBio} |
| Cleared photo | ${tier.photo} |
| Career history (an earlier or dated role beyond the current season) | ${tier.careerHistory} |

## People with career history

| Person | Timeline entries | Earlier roles | Identity facts | Photo |
|---|---|---|---|---|
${rows.sort((a, b) => b[2] - a[2]).map((r) => `| ${r.join(' | ')} |`).join('\n')}

## Ownership by team (current, shown)

| Team | Shown records | Current owners / shareholders |
|---|---|---|
${ownRows.map((r) => `| ${r.join(' | ')} |`).join('\n')}
${(own.unverified || []).length ? `\n## Ownership not verified\n\n${own.unverified.map((u) => `- ${u}`).join('\n')}\n` : ''}`;
fs.mkdirSync('reports/people', { recursive: true });
fs.writeFileSync('reports/people/COVERAGE.md', md);
console.log(md.split('## Depth')[0]);
