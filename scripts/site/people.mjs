// People Intelligence V2 pages: /people directory, /people/:slug premium profiles, and the driver-page profile /
// career path / engineering crew blocks. Values only (owner rule: no per-fact source links on pages); provenance stays
// in src/identity/*.json. All generated sentences are assembled from structured facts with descriptive wording only.
import { esc, teamClass, crumbs, jsonLdBreadcrumb, SITE, fmtDate, ordinal, flag } from './lib.mjs';
import { careerTimeline, rolesOf, fmtPartial, isOwnershipRelation, CAUSAL } from '../../src/identity/people-v2.mjs';

const initials = (n) => String(n || '?').split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const an = (w) => (/^[aeiou]/i.test(w) ? 'an' : 'a');
export const GROUPS = [
  ['principal', 'Team principals'], ['leadership', 'Leadership'], ['technical', 'Technical'], ['race_engineering', 'Race engineers'],
  ['sporting', 'Sporting'], ['power_unit', 'Power units'], ['garage', 'Garage'], ['owners', 'Owners / Founders'],
];

function face(prof, size = 48, cls = 'face') {
  if (prof.photo?.files) return `<img class="${cls}" src="/media/people/${esc(prof.photo.files[size > 96 ? '192' : '96'])}" width="${size}" height="${size}" alt="${size > 96 ? esc(prof.name) : ''}" loading="${size > 96 ? 'eager' : 'lazy'}" decoding="async">`;
  return `<span class="avatar" aria-hidden="true">${esc(initials(prof.name))}</span>`;
}
const orgName = (ctx, e) => (e.constructorId ? ctx.conById[e.constructorId]?.name || e.constructorId : e.organisation || '');
const orgLink = (ctx, e) => (e.constructorId && ctx.conById[e.constructorId] ? `<a href="/teams/${esc(e.constructorId)}">${esc(ctx.conById[e.constructorId].name)}</a>` : esc(e.organisation || ''));
const driverOf = (ctx, slug) => ctx.drivers.find((d) => d.slug === slug && ctx.careers[d.id]?.entries);
const driverLink = (ctx, slug) => { const d = driverOf(ctx, slug); return d ? `<a href="/drivers/${esc(d.slug)}">${esc(d.full_name)}</a>` : ''; };
const reported = (e) => (e.confidence === 'medium' ? ' <span class="tag" title="Confirmed by independent reporting, not by the team">reported</span>' : '');

// one prose sentence per fact type; checked against CAUSAL at build time
function guard(s) { if (CAUSAL.test(s)) throw new Error(`people: causal wording in generated prose: ${s}`); return s; }

export function summaryOf(ctx, prof) {
  const cur = prof.current;
  const parts = [];
  if (cur.length) {
    const byOrg = {};
    for (const e of cur) (byOrg[orgName(ctx, e)] ??= []).push(e.title);
    parts.push(`${prof.name} is listed as ${Object.entries(byOrg).map(([o, ts]) => `${[...new Set(ts)].join(' and ')}${o ? ` at ${o}` : ''}`).join('; ')} for the ${ctx.currentSeason} season.`);
  }
  const past = prof.timeline.entries.filter((e) => !e.ongoing && e.ranged);
  if (past.length) {
    const ys = past.flatMap((e) => [e.from, e.to].filter(Boolean).map((x) => Number(String(x).slice(0, 4))));
    const orgs = [...new Set(past.map((e) => orgName(ctx, e)).filter(Boolean))];
    parts.push(`The verified record also lists ${past.length} earlier role${past.length > 1 ? 's' : ''}${ys.length ? ` between ${Math.min(...ys)} and ${Math.max(...ys)}` : ''}${orgs.length ? ` with ${orgs.slice(0, 4).join(', ')}${orgs.length > 4 ? ' and others' : ''}` : ''}.`);
  }
  const ds = prof.drivers.filter((x) => x.stats && /\brace engineer\b/i.test(x.entry.title));
  if (ds.length) parts.push(`Drivers in the verified race-engineering record: ${ds.map((x) => `${x.driver.full_name} (${x.entry.period})`).join(', ')}.`);
  return parts.map(guard).join(' ');
}

function timelineHtml(ctx, prof) {
  const { entries, gaps } = prof.timeline;
  if (!entries.length) return '';
  const items = [];
  const byStart = (e) => (e.from ? Number(String(e.from).slice(0, 4)) : e.observedSeasons[0] || 0);
  const g = [...gaps];
  for (const e of entries) {
    while (g.length && g.at(-1).from > byStart(e)) { const x = g.pop(); items.push(`<li class="ctl-gap"><span>${x.from === x.to ? x.from : `${x.from}–${x.to}`}</span><b>No verified role on record</b></li>`); }
    items.push(`<li class="ctl-item${e.ongoing ? ' is-cur' : ''}"><span class="ctl-when">${esc(e.period)}</span><b>${esc(e.title)}</b><small>${orgLink(ctx, e)}${e.driverId && driverLink(ctx, e.driverId) ? ` · ${driverLink(ctx, e.driverId)}` : ''}${reported(e)}${e.ranged ? '' : ' <span class="tag" title="Role confirmed for this season only; earlier and later seasons are not implied">season record</span>'}</small></li>`);
  }
  return `<section class="section"><div class="wrap"><div class="section-head"><div><span class="eyebrow">Career</span><h2>Career timeline</h2></div></div>
  <ol class="ctl">${items.join('')}</ol>
  <p class="fine">Built only from sourced role records. A single-season record covers that season only; years with no record are left blank rather than filled in.</p></div></section>`;
}

function partnershipsHtml(ctx, prof) {
  const rows = prof.drivers.filter((x) => x.stats);
  const plain = prof.drivers.filter((x) => !x.stats);
  if (!rows.length && !plain.length) return '';
  const t = rows.length ? `<div class="table-wrap"><table><thead><tr><th>Driver</th><th>Role</th><th>Team</th><th>Verified window</th><th class="num">Races</th><th class="num">Wins</th><th class="num">Poles</th><th class="num">Podiums</th></tr></thead><tbody>${rows.map(({ driver, entry, stats }) => `<tr><td><a href="/drivers/${esc(driver.slug)}">${esc(driver.full_name)}</a></td><td>${esc(entry.title)}</td><td>${orgLink(ctx, entry)}</td><td>${esc(entry.period)}</td><td class="num">${stats.starts}</td><td class="num">${stats.wins}</td><td class="num">${stats.poles}</td><td class="num">${stats.podiums}</td></tr>`).join('')}</tbody></table></div>
  <p class="fine">Team/driver results during verified partnership: the driver’s Grand Prix starts for that team inside the dated window of the role record (first and last race in our results graph). Descriptive context only; it does not attribute results to the engineer.</p>` : '';
  return `<section class="section"><div class="wrap"><div class="section-head"><div><span class="eyebrow">Drivers worked with</span><h2>Driver partnerships</h2></div></div>${t}
  ${plain.length ? `<p class="plinks">${plain.map(({ driver, entry }) => `<a href="/drivers/${esc(driver.slug)}">${esc(driver.full_name)}</a> <small>${esc(entry.title)} · ${esc(entry.period)}</small>`).join(' · ')}</p>` : ''}</div></section>`;
}

function tenureHtml(ctx, prof) {
  if (!prof.tenures.length) return '';
  return `<section class="section"><div class="wrap"><div class="section-head"><div><span class="eyebrow">Team principal</span><h2>Team results during tenure</h2></div></div>
  ${prof.tenures.map(({ entry, stats }) => `<article class="tenure ${teamClass(ctx.colorOf(entry.constructorId, stats.seasons.at(-1)?.season))}"><header><b>${orgLink(ctx, entry)}</b><small>${esc(entry.title)} · ${esc(entry.period)}</small></header>
    <div class="stats"><div class="stat-box"><span>Grands Prix</span><b>${stats.starts}</b></div><div class="stat-box"><span>Wins</span><b>${stats.wins}</b></div><div class="stat-box"><span>Podiums</span><b>${stats.podiums}</b></div><div class="stat-box"><span>Poles</span><b>${stats.poles}</b></div><div class="stat-box"><span>Constructors’ titles</span><b>${stats.titles.length}</b>${stats.titles.length ? `<span>${stats.titles.join(', ')}</span>` : ''}</div></div>
    <p class="tseasons">${stats.seasons.map((s) => `<span><b>${s.season}</b> ${s.position ? `${ordinal(s.position)}${s.inProgress ? ' (in progress)' : ''}` : s.full ? '—' : `partial season (${s.races} races)`}</span>`).join('')}</p></article>`).join('')}
  <p class="fine">Team results during tenure: every Grand Prix the team started inside the verified dates of the role. Constructors’ positions are shown only for seasons the tenure covers in full. Descriptive context only.</p></div></section>`;
}

function carsHtml(ctx, prof) {
  if (!prof.cars.length) return '';
  return `<section class="section"><div class="wrap"><div class="section-head"><div><span class="eyebrow">Technical leadership</span><h2>Cars during tenure</h2></div></div>
  <ul class="role-list">${prof.cars.flatMap(({ entry, cars }) => cars.map((c) => `<li><b>${esc(c.model)}</b> · ${orgLink(ctx, entry)} · ${c.season} <small class="muted">— ${esc(entry.title)} that season</small></li>`)).join('')}</ul>
  <p class="fine">Means the person held this technical role in the season the car raced. It does not state that they designed the car or any part of it. Car names appear only where the team published them.</p></div></section>`;
}

function ownershipHtml(ctx, prof) {
  if (!prof.ownership.length) return '';
  return `<section class="section"><div class="wrap"><div class="section-head"><div><span class="eyebrow">Ownership</span><h2>Team ownership</h2></div></div>
  <ul class="role-list">${prof.ownership.map((o) => `<li><b>${esc(capital(o.relationship))}</b> · <a href="/teams/${esc(o.constructorId)}">${esc(ctx.conById[o.constructorId]?.name || o.constructorId)}</a>${o.valid_from ? ` · since ${esc(fmtPartial(o.valid_from))}` : ''}${o.valid_to ? ` – ${esc(fmtPartial(o.valid_to))}` : ''}${o.share_text ? ` · ${esc(o.share_text)}` : o.percentage != null ? ` · ${esc(String(o.percentage))}% (publicly stated)` : ''}${o.confidence === 'medium' ? ' <span class="tag">reported</span>' : ''}</li>`).join('')}</ul>
  <p class="fine">Ownership is recorded separately from job titles: a chairman, CEO or team principal is shown as an owner only where a source states an ownership relationship. Percentages appear only when publicly stated.</p></div></section>`;
}
const capital = (s) => String(s || '').replace(/^./, (c) => c.toUpperCase());

function backgroundHtml(prof) {
  const id = prof.identity || {};
  const rows = [['Education', id.education], ['Specialism', id.specialty], ['Before Formula 1', id.prior_racing]].filter(([, v]) => v?.length);
  if (!rows.length) return '';
  return `<section class="section"><div class="wrap"><div class="section-head"><h2>Background</h2></div><dl class="facts">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v.map((x) => esc(x.value)).join('<br>')}</dd></div>`).join('')}</dl></div></section>`;
}

export function personTitle(ctx, prof) {
  const lead = prof.current[0] || prof.timeline.entries[0];
  const team = lead ? orgName(ctx, lead) : '';
  const title = lead ? lead.title : prof.ownership[0] ? capital(prof.ownership[0].relationship) : 'Formula 1';
  const hasDrivers = prof.drivers.length > 0;
  return `${prof.name} – ${team ? `${team} F1 ` : 'F1 '}${title}, Career & ${hasDrivers ? 'Driver' : 'Team'} History`;
}

export function personLd(ctx, prof) {
  const id = prof.identity || {};
  const lead = prof.current[0];
  const team = lead?.constructorId ? ctx.conById[lead.constructorId] : null;
  return {
    '@context': 'https://schema.org', '@type': 'Person', name: prof.name,
    ...(id.full_name?.value && id.full_name.value !== prof.name ? { alternateName: id.full_name.value } : {}),
    ...(id.nationality?.value ? { nationality: { '@type': 'Country', name: id.nationality.value } } : {}),
    ...(id.date_of_birth?.value && /^\d{4}-\d{2}-\d{2}$/.test(id.date_of_birth.value) ? { birthDate: id.date_of_birth.value } : {}),
    ...(lead ? { jobTitle: lead.title } : {}),
    ...(team ? { worksFor: { '@type': 'SportsTeam', name: team.name, sport: 'Formula One', url: `${SITE}/teams/${team.id}` } } : {}),
    url: `${SITE}/people/${prof.slug}`,
    ...(prof.photo?.files ? { image: `${SITE}/media/people/${prof.photo.files['192']}` } : {}),
  };
}

export function personPageV2(ctx, prof) {
  const lead = prof.current[0] || prof.timeline.entries[0] || null;
  const team = lead?.constructorId ? ctx.conById[lead.constructorId] : prof.ownership[0] ? ctx.conById[prof.ownership[0].constructorId] : null;
  const id = prof.identity || {};
  const bc = [['/', 'Home'], ['/people', 'People'], [`/people/${prof.slug}`, prof.name]];
  const meta = [
    id.known_as?.value && ['Known as', esc(id.known_as.value)],
    id.nationality?.value && ['Nationality', esc(id.nationality.value)],
    id.date_of_birth?.value && ['Born', `${esc(/^\d{4}-\d{2}-\d{2}$/.test(id.date_of_birth.value) ? fmtDate(id.date_of_birth.value) : id.date_of_birth.value)}${id.birthplace?.value ? `, ${esc(id.birthplace.value)}` : ''}`],
    !id.date_of_birth?.value && id.birthplace?.value && ['Born in', esc(id.birthplace.value)],
    team && ['Team', `<a href="/teams/${esc(team.id)}">${esc(team.name)}</a>`],
    prof.verifiedAsOf && ['Verified as of', esc(fmtDate(prof.verifiedAsOf))],
  ].filter(Boolean);
  const cur = prof.current;
  const curHtml = cur.length ? `<section class="section"><div class="wrap"><div class="section-head"><div><span class="eyebrow">${ctx.currentSeason}</span><h2>Current role${cur.length > 1 ? 's' : ''}</h2></div></div>
  <ul class="cur-roles">${cur.map((e) => `<li><b>${esc(e.title)}</b><span>${orgLink(ctx, e)}${e.driverId && driverLink(ctx, e.driverId) ? ` · ${driverLink(ctx, e.driverId)}` : ''}${reported(e)}</span><small>${e.effective_from ? `Since ${esc(fmtPartial(e.effective_from))}` : `Verified for the ${ctx.currentSeason} season`}</small></li>`).join('')}</ul></div></section>` : '';
  const summary = summaryOf(ctx, prof);
  const tc = teamClass(team ? ctx.colorOf(team.id, ctx.currentSeason) : null);
  const body = `${crumbs(bc)}<div class="${tc}">
  <section class="hero"><div class="wrap person-hero">${face(prof, 120)}<div><span class="eyebrow">${team ? esc(team.name) : 'Formula 1'}${lead ? ` · ${esc(lead.title)}` : ''}</span><h1>${esc(prof.name)}</h1>${lead ? `<p class="lede">${esc(lead.title)}${team ? ` · ${esc(team.name)}` : ''}</p>` : ''}
  ${meta.length ? `<div class="hero-meta">${meta.map(([k, v]) => `<span><b>${k}</b>${v}</span>`).join('')}</div>` : ''}<div class="team-stripe"></div></div></div></section>
  ${summary ? `<section class="section psum"><div class="wrap"><p class="sub">${esc(summary)}</p></div></section>` : ''}
  ${curHtml}
  ${timelineHtml(ctx, prof)}
  ${partnershipsHtml(ctx, prof)}
  ${tenureHtml(ctx, prof)}
  ${carsHtml(ctx, prof)}
  ${ownershipHtml(ctx, prof)}
  ${backgroundHtml(prof)}
  <section class="section"><div class="wrap"><p class="fine">Identity and role facts come from team and FIA publications, established motorsport reporting and open identity data, each recorded with its source in the PropBetEdge registry. Private and family details are never recorded. “reported” = confirmed by independent reporting, not yet by the team.</p>
  ${prof.photo ? `<p class="fine">Photo: <a href="${esc(prof.photo.sourceUrl)}" rel="noopener">${esc(prof.photo.photographer)}</a>, <a href="${esc(prof.photo.licenseUrl)}" rel="noopener license">${esc(prof.photo.license)}</a>${prof.photo.modified ? ' · cropped' : ''}</p>` : ''}
  <p><a class="more" href="/people">All F1 people</a></p></div></section></div>`;
  const description = summary.length > 40 ? (summary.length > 300 ? `${summary.slice(0, 297).replace(/\s+\S*$/, '')}…` : summary) : `${prof.name}: Formula 1 role record, career timeline and team history.`;
  return {
    path: `/people/${prof.slug}`,
    title: personTitle(ctx, prof),
    description,
    section: '/people',
    ogType: 'profile',
    body,
    jsonLd: [jsonLdBreadcrumb(bc), personLd(ctx, prof)],
  };
}

// ---------- /people directory ----------
export function peopleIndex(ctx, profiles, teamOrder = []) {
  const order = (cid) => { const i = teamOrder.indexOf(cid); return i < 0 ? 99 : i; };
  const GRANK = { principal: 0, owners: 1, leadership: 2, technical: 3, power_unit: 4, sporting: 5, race_engineering: 6, garage: 7 };
  const rows = Object.values(profiles).map((p) => {
    const lead = p.current[0] || p.timeline.entries[0];
    const cid = lead?.constructorId || p.ownership[0]?.constructorId || null;
    return { p, lead, cid, rank: Math.min(...p.groups.map((g) => GRANK[g] ?? 9), 9) };
  }).sort((a, b) => order(a.cid) - order(b.cid) || a.rank - b.rank || a.p.name.localeCompare(b.p.name));
  const teams = [...new Set(rows.map((r) => r.cid).filter(Boolean))].sort((a, b) => order(a) - order(b));
  const counts = Object.fromEntries(GROUPS.map(([g]) => [g, rows.filter((r) => r.p.groups.includes(g)).length]));
  const li = ({ p, lead, cid }) => `<li class="pdir-item" data-groups="${esc(p.groups.join(' '))}" data-team="${esc(cid || '')}" data-name="${esc(`${p.name} ${lead?.title || ''} ${cid ? ctx.conById[cid]?.name || '' : ''}`.toLowerCase())}"><a class="pc-link ${teamClass(cid ? ctx.colorOf(cid, ctx.currentSeason) : null)}" href="/people/${esc(p.slug)}">${face(p, 48)}<span class="who"><b>${esc(p.name)}</b><small>${esc(lead?.title || capital(p.ownership[0]?.relationship || ''))}</small><em>${cid ? esc(ctx.conById[cid]?.name || cid) : ''}${p.timeline.entries.some((e) => !e.ongoing && e.ranged) ? ' · career history' : ''}</em></span></a></li>`;
  const body = `${crumbs([['/', 'Home'], ['/people', 'People']])}
  <section class="hero"><div class="wrap"><span class="eyebrow">${ctx.currentSeason} paddock</span><h1>F1 People</h1><p class="sub">${rows.length} team principals, owners, technical leaders, race engineers and trackside staff with sourced role records: current ${ctx.currentSeason} roles, career timelines and the drivers they work with.</p></div></section>
  <section class="section"><div class="wrap">
  <form class="pdir-ctl" data-pdir-ctl hidden role="search" aria-label="Filter people">
    <div class="pdir-groups" role="group" aria-label="Role group"><button type="button" class="chip" data-g="" aria-pressed="true">All <span>${rows.length}</span></button>${GROUPS.filter(([g]) => counts[g]).map(([g, l]) => `<button type="button" class="chip" data-g="${g}" aria-pressed="false">${esc(l)} <span>${counts[g]}</span></button>`).join('')}</div>
    <div class="pdir-row"><label class="pdir-team"><span>Team</span><select data-pdir-team><option value="">All teams</option>${teams.map((t) => `<option value="${esc(t)}">${esc(ctx.conById[t]?.name || t)}</option>`).join('')}</select></label>
    <input class="search" type="search" placeholder="Search people or roles" aria-label="Search people or roles" data-pdir-q><span class="pdir-count" data-pdir-count aria-live="polite">${rows.length} people</span></div>
  </form>
  <ul class="pdir pcards" data-pdir>${rows.map(li).join('')}</ul>
  <p class="pdir-empty fine" data-pdir-empty hidden>No people match these filters.</p>
  <p class="fine">Only sourced roles are listed. Owners are recorded separately from job titles. Team pages show each team’s organisation for the current season.</p></div></section>`;
  return { path: '/people', title: `F1 People ${ctx.currentSeason}: Team Principals, Engineers & Owners`, description: `Directory of ${rows.length} Formula 1 people with sourced role records: team principals, owners and founders, technical directors, race engineers, sporting and garage roles for ${ctx.currentSeason}, with career timelines.`, body, section: '/people', jsonLd: [jsonLdBreadcrumb([['/', 'Home'], ['/people', 'People']])] };
}

// ---------- driver page blocks ----------
// engineers linked to a driver across all people (current season chain + dated historical records)
export function crewForDriver(reg, slug) {
  const out = [];
  for (const pid of new Set((reg.roles || []).filter((r) => r.driverId === slug).map((r) => r.personId))) {
    for (const e of careerTimeline(reg, pid).entries.filter((x) => x.driverId === slug)) out.push({ personId: pid, name: reg.people[pid]?.name, entry: e });
  }
  const step = (t) => (/performance engineer/i.test(t) ? 1 : /race engineer/i.test(t) ? 0 : 2);
  return out.sort((a, b) => (b.entry.ongoing - a.entry.ongoing) || step(a.entry.title) - step(b.entry.title) || String(b.entry.from || b.entry.observedSeasons[0]).localeCompare(String(a.entry.from || a.entry.observedSeasons[0])));
}

export function driverMilestones(ctx, d) {
  const log = (ctx.driverLog[d.id] || []).filter((x) => x.started);
  if (!log.length) return [];
  const ev = (x) => ctx.eventById[x.event_id];
  const m = [];
  const first = (pred) => log.find(pred);
  const add = (kind, x, label) => x && ev(x) && m.push({ kind, season: ev(x).season, event: ev(x), constructorId: x.constructor_id, label });
  add('debut', log[0], 'Formula 1 debut');
  add('podium', first((x) => x.classified && x.finish <= 3), 'First podium');
  add('pole', first((x) => x.pole), 'First pole position');
  add('win', first((x) => x.classified && x.finish === 1), 'First Grand Prix win');
  let prev = log[0].constructor_id;
  const seen = new Set([prev]);
  for (const x of log) if (x.constructor_id !== prev) { add('team', x, `${seen.has(x.constructor_id) ? 'Back with' : 'First race with'} ${ctx.conById[x.constructor_id]?.name || x.constructor_id}`); seen.add(x.constructor_id); prev = x.constructor_id; }
  for (const y of ctx.careers[d.id]?.championships || []) m.push({ kind: 'title', season: y, label: `World Drivers’ Champion ${y}` });
  const key = (x) => (x.event ? x.event.start_utc : `${x.season}-12-31`);
  return m.sort((a, b) => key(a).localeCompare(key(b)));
}

export function driverProfileHtml(ctx, d, reg) {
  const car = ctx.careers[d.id];
  const log = (ctx.driverLog[d.id] || []).filter((x) => x.started);
  const onGrid = ctx.currentGrid.some((g) => g.driver_id === d.id);
  const lt = ctx.latestTeam[d.id];
  const num = (ctx.dcsByDriver[d.id] || []).slice().sort((a, b) => b.season - a.season)[0]?.car_numbers?.[0];
  const debut = log[0] ? ctx.eventById[log[0].event_id] : null;
  const firstTeam = log[0]?.constructor_id;
  const facts = [
    d.nationality && ['Nationality', `${flag(d)} ${esc(d.nationality)}`],
    d.date_of_birth && ['Born', esc(fmtDate(d.date_of_birth))],
    lt && [onGrid ? 'Current team' : 'Last team', ctx.conById[lt.constructor_id] ? `<a href="/teams/${esc(lt.constructor_id)}">${esc(ctx.conById[lt.constructor_id].name)}</a>` : esc(lt.constructor_id)],
    num && ['Number', esc(num)],
    debut && ['F1 debut', `<a href="${ctx.raceUrl(debut.id)}">${esc(`${debut.season} ${debut.name}`)}</a>`],
    firstTeam && ['First team', ctx.conById[firstTeam] ? `<a href="/teams/${esc(firstTeam)}">${esc(ctx.conById[firstTeam].name)}</a>` : esc(firstTeam)],
    car?.seasons && ['Seasons', `${car.seasons} (${car.first_season}${car.last_season !== car.first_season ? `–${car.last_season}` : ''})`],
  ].filter(Boolean);
  const ms = driverMilestones(ctx, d);
  const prose = debut ? guard(`${d.full_name} started a first Formula 1 Grand Prix at the ${debut.season} ${debut.name}${firstTeam && ctx.conById[firstTeam] ? ` with ${ctx.conById[firstTeam].name}` : ''}${car ? ` and has ${car.starts} starts, ${car.wins} wins and ${car.podiums} podiums in our results graph` : ''}.`) : '';
  const crew = reg ? crewForDriver(reg, d.slug) : [];
  const crewHtml = crew.length ? `<div class="crew"><h3>Engineering crew</h3><ul class="pcards">${crew.map((c) => `<li class="pcard"><a class="pc-link" href="/people/${esc(c.personId)}">${face({ name: c.name, photo: reg.photos?.[c.personId]?.rightsStatus === 'cleared' ? reg.photos[c.personId] : null }, 48)}<span class="who"><b>${esc(c.name)}</b><small>${esc(c.entry.title)}${c.entry.constructorId ? ` · ${esc(ctx.conById[c.entry.constructorId]?.name || '')}` : ''}</small><em>${esc(c.entry.period)}</em></span></a>${c.entry.confidence === 'medium' ? '<span class="tag">reported</span>' : ''}</li>`).join('')}</ul><p class="fine">From the PropBetEdge personnel graph: only sourced, dated role records. Roles we cannot verify are left out.</p></div>` : '';
  return `<section class="section dprof"><div class="wrap"><div class="section-head"><div><span class="eyebrow">Profile</span><h2>Driver profile</h2></div></div>
  <div class="dprof-grid"><div><dl class="facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>${prose ? `<p class="fine">${esc(prose)}</p>` : ''}</div>
  ${ms.length ? `<div><h3 class="ctl-h">Career path</h3><ol class="ctl ctl-compact">${ms.map((x) => `<li class="ctl-item ms-${x.kind}"><span class="ctl-when">${x.event ? esc(fmtDate(x.event.start_utc)) : x.season}</span><b>${esc(x.label)}</b>${x.event ? `<small><a href="${ctx.raceUrl(x.event.id)}">${esc(`${x.event.season} ${x.event.name}`)}</a>${x.constructorId && ctx.conById[x.constructorId] ? ` · ${esc(ctx.conById[x.constructorId].name)}` : ''}</small>` : ''}</li>`).join('')}</ol></div>` : ''}</div>
  ${crewHtml}</div></section>`;
}

export { rolesOf, isOwnershipRelation };
