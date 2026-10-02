// F1 People Intelligence V2: fact model, career timeline engine, ownership graph and descriptive performance context.
// Pure functions over the registries (src/identity/personnel.json, ownership.json, machine-<season>.json) and the
// results graph (scripts/site/context.mjs ctx). Every fact keeps its provenance in the registry; pages print values
// only (owner rule 2026-10-02: no per-fact source links). Nothing here infers a fact that a record does not state.
import fs from 'node:fs';
import { photoFor } from './people.mjs';

const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
export const SHOWN_CONF = new Set(['high', 'medium']);

export function loadOwnership(file = 'src/identity/ownership.json') {
  return fs.existsSync(file) ? read(file) : { records: [], sources: {} };
}

// ---------- dates ----------
// effective dates are stored as precisely as the source states them: YYYY, YYYY-MM or YYYY-MM-DD
export function dateStart(s) {
  if (!s) return null;
  const [y, m = '01', d = '01'] = String(s).split('-');
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}
export function dateEnd(s) {
  if (!s) return null;
  const p = String(s).split('-');
  if (p.length === 1) return `${p[0]}-12-31`;
  if (p.length === 2) { const last = new Date(Date.UTC(Number(p[0]), Number(p[1]), 0)).getUTCDate(); return `${p[0]}-${p[1].padStart(2, '0')}-${String(last).padStart(2, '0')}`; }
  return `${p[0]}-${p[1].padStart(2, '0')}-${p[2].padStart(2, '0')}`;
}
const year = (s) => (s ? Number(String(s).slice(0, 4)) : null);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function fmtPartial(s) {
  if (!s) return null;
  const p = String(s).split('-');
  if (p.length === 1) return p[0];
  if (p.length === 2) return `${MONTHS[Number(p[1]) - 1]} ${p[0]}`;
  return `${Number(p[2])} ${MONTHS[Number(p[1]) - 1]} ${p[0]}`;
}

// ---------- roles ----------
// a role is shown on a profile when it is sourced, not held and high|medium confidence. Current team-page roles keep
// their own stricter flag (display); historical records carry history=true and never reach a team page.
export function profileVisible(r) {
  if (!(r.sources || []).length || r.held) return false;
  if (r.history) return SHOWN_CONF.has(r.confidence);
  return r.display === true;
}

const DRIVER_SPECIFIC = /\b(?:race|performance) engineer\b|\bmechanic\b|\bcar chief\b|\bcrew chief\b/i;
// "Head of Race Engineering; Race Engineer (Kimi Antonelli)" -> two titles; a driver link stays only on the
// driver-specific title. Parenthetical qualifiers are dropped from the title (the driver is a separate edge).
export function splitTitles(r) {
  return String(r.role || '')
    .split(/\s*;\s*/)
    .map((t) => t.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((t) => t && !/^\(?departed\)?$/i.test(t))
    .map((title) => ({ title, driverId: DRIVER_SPECIFIC.test(title) ? r.driverId || null : null }));
}

export function rolesOf(reg, personId) {
  return (reg.roles || []).filter((r) => r.personId === personId && profileVisible(r));
}

// ---------- career timeline engine ----------
// Entries come only from role records. A record with effective dates is a RANGE; a record without dates is an
// OBSERVATION for its season (shown as that season only - never stretched). Observations fold into a range only
// when the same title/team/driver range covers that season. Gaps between ranges stay visible as gaps.
export function careerTimeline(reg, personId) {
  const rs = rolesOf(reg, personId);
  const items = [];
  for (const r of rs) for (const t of splitTitles(r)) {
    const org = r.constructorId || r.organisation || null;
    const ranged = !!(r.effectiveFrom || r.effectiveTo);
    items.push({
      key: `${org}|${t.title.toLowerCase()}|${t.driverId || ''}`,
      title: t.title, roleGroup: r.roleGroup, constructorId: r.constructorId || null, organisation: r.organisation || null, driverId: t.driverId,
      from: r.effectiveFrom || null, to: r.effectiveTo || null,
      ongoing: r.current === true && !r.effectiveTo,
      observedSeasons: ranged ? [] : [r.season],
      ranged, confidence: r.confidence, history: !!r.history, sources: r.sources, conflicts: r.conflicts || [],
    });
  }
  const ranges = items.filter((x) => x.ranged);
  const obs = items.filter((x) => !x.ranged);
  const out = [...ranges];
  for (const o of obs) {
    const y = o.observedSeasons[0];
    const host = ranges.find((g) => g.key === o.key && (!g.from || year(g.from) <= y) && (g.ongoing || (g.to && year(g.to) >= y)));
    if (host) { host.sources = [...new Set([...host.sources, ...o.sources])]; if (o.ongoing) host.ongoing = true; if (o.confidence === 'high') host.confidence = 'high'; continue; }
    const twin = out.find((g) => !g.ranged && g.key === o.key);
    if (twin) { twin.observedSeasons = [...new Set([...twin.observedSeasons, y])].sort(); twin.sources = [...new Set([...twin.sources, ...o.sources])]; twin.ongoing ||= o.ongoing; continue; }
    out.push({ ...o });
  }
  const startOf = (e) => (e.from ? dateStart(e.from) : e.observedSeasons.length ? `${e.observedSeasons[0]}-01-01` : '9999');
  out.sort((a, b) => startOf(b).localeCompare(startOf(a)) || (b.ongoing - a.ongoing) || a.title.localeCompare(b.title));
  for (const e of out) e.period = periodLabel(e);
  // explicit gaps between consecutive ended ranges (newest first): never imply continuity between them
  const asc = out.filter((e) => e.ranged && e.from).slice().sort((a, b) => dateStart(a.from).localeCompare(dateStart(b.from)));
  const gaps = [];
  let reach = null;
  for (const e of asc) {
    if (reach && year(e.from) - year(reach) > 1) gaps.push({ from: year(reach) + 1, to: year(e.from) - 1 });
    const end = e.ongoing ? '9999' : e.to ? dateEnd(e.to) : dateStart(e.from);
    if (!reach || end > reach) reach = end;
  }
  return { entries: out, gaps };
}

export function periodLabel(e) {
  if (!e.ranged) return `${e.observedSeasons.join(', ')} season${e.observedSeasons.length > 1 ? 's' : ''}`;
  const f = e.from ? fmtPartial(e.from) : 'Start date not verified';
  const t = e.ongoing ? 'present' : e.to ? fmtPartial(e.to) : 'end date not verified';
  return `${f} – ${t}`;
}

// current roles = current, not ended, current season; effective_from only from a range with the SAME title/team/driver
// that is still ongoing (an earlier spell's start date never becomes the current role's start date)
export function currentRoles(reg, personId, season) {
  const tl = careerTimeline(reg, personId);
  return tl.entries.filter((e) => e.ongoing && (e.ranged ? !e.to : e.observedSeasons.includes(season))).map((e) => ({ ...e, effective_from: e.ranged ? e.from : null }));
}

// ---------- identity (bio fact model) ----------
const IDENTITY_FIELDS = ['full_name', 'known_as', 'nationality', 'date_of_birth', 'birthplace'];
const LIST_FIELDS = ['education', 'specialty', 'prior_racing'];
// a field shows only when sourced and not under a recorded conflict
export function identityOf(reg, personId) {
  const p = reg.people?.[personId];
  if (!p) return null;
  const id = p.identity || {};
  const out = {};
  for (const k of IDENTITY_FIELDS) { const f = id[k]; if (f?.value && (f.sources || []).length && !f.conflict) out[k] = f; }
  if (!out.full_name) out.full_name = { value: p.name, sources: [] };
  if (!out.known_as && p.known_as) out.known_as = { value: p.known_as, sources: [] };
  for (const k of LIST_FIELDS) out[k] = (id[k] || []).filter((f) => f?.value && (f.sources || []).length && !f.conflict);
  return out;
}

// ---------- ownership graph ----------
export const OWNER_RELATIONS = new Set(['founder', 'owner', 'co-owner', 'controlling shareholder', 'parent company', 'investor', 'manufacturer owner']);
export const isOwnershipRelation = (rel) => OWNER_RELATIONS.has(rel);
// chairman is governance: it stays in the registry but is never rendered as an ownership relationship
const ownVisible = (o) => (o.sources || []).length && SHOWN_CONF.has(o.confidence) && !o.held && isOwnershipRelation(o.relationship);
export function ownershipForTeam(own, constructorId) {
  const W = { 'parent company': 0, 'manufacturer owner': 0, owner: 1, founder: 1, 'controlling shareholder': 2, 'co-owner': 3, investor: 4 };
  return (own.records || []).filter((o) => o.constructorId === constructorId && ownVisible(o)).sort((a, b) => (b.current === true) - (a.current === true) || (W[a.relationship] ?? 5) - (W[b.relationship] ?? 5) || String(b.valid_from || '').localeCompare(String(a.valid_from || '')));
}
export function ownershipForPerson(own, personId) {
  return (own.records || []).filter((o) => o.entity?.personId === personId && ownVisible(o));
}

// ---------- performance context (descriptive only; from our own results graph) ----------
const raceDay = (ev) => String(ev.end_utc || ev.start_utc || '').slice(0, 10);
function windowOf(e, season) {
  if (e.ranged) return { from: e.from ? dateStart(e.from) : null, to: e.ongoing ? '9999-12-31' : e.to ? dateEnd(e.to) : null };
  const ys = e.observedSeasons;
  return { from: `${Math.min(...ys)}-01-01`, to: `${Math.max(...ys)}-12-31`, seasons: ys };
}
const inWin = (ev, w) => w.from && w.to && raceDay(ev) >= w.from && raceDay(ev) <= w.to && (!w.seasons || w.seasons.includes(ev.season));

function poleOf(ctx, eid) {
  return ctx.rows(eid, 'qualifying').find((r) => r.position === 1) || ctx.rows(eid, 'race').find((r) => r.grid === 1) || null;
}

// race engineer x driver: the driver's starts for that team inside the verified partnership window
export function partnershipStats(ctx, e) {
  const d = ctx.drivers.find((x) => x.slug === e.driverId);
  if (!d || !e.constructorId) return null;
  const w = windowOf(e);
  if (!w.from || !w.to) return null;
  const rows = (ctx.driverLog[d.id] || []).filter((x) => x.constructor_id === e.constructorId && x.started && ctx.eventById[x.event_id] && inWin(ctx.eventById[x.event_id], w));
  if (!rows.length) return null;
  const ev = (x) => ctx.eventById[x.event_id];
  return {
    driver: d, starts: rows.length,
    wins: rows.filter((x) => x.classified && x.finish === 1).length,
    podiums: rows.filter((x) => x.classified && x.finish <= 3).length,
    poles: rows.filter((x) => x.pole).length,
    first: ev(rows[0]), last: ev(rows.at(-1)),
    seasons: [...new Set(rows.map((x) => x.season))],
  };
}

// team principal: the team's Grands Prix inside the verified tenure window
export function tenureStats(ctx, e) {
  if (!e.constructorId) return null;
  const w = windowOf(e);
  if (!w.from || !w.to) return null;
  const evs = ctx.events.filter((ev) => ev.status === 'completed' && inWin(ev, w));
  let starts = 0, wins = 0, podiums = 0, poles = 0;
  const bySeason = {};
  for (const ev of evs) {
    const rows = ctx.rows(ev.id, 'race').filter((r) => r.constructor_id === e.constructorId);
    if (!rows.length) continue;
    starts++;
    (bySeason[ev.season] ??= 0);
    bySeason[ev.season]++;
    wins += rows.filter((r) => r.status === 'classified' && r.position === 1).length;
    podiums += rows.filter((r) => r.status === 'classified' && r.position <= 3).length;
    if (poleOf(ctx, ev.id)?.constructor_id === e.constructorId) poles++;
  }
  if (!starts) return null;
  // constructors' classification only for seasons the tenure covers completely (every team race of that season)
  const seasons = Object.keys(bySeason).map(Number).sort();
  const table = seasons.map((y) => {
    const all = (ctx.eventsBySeason[y] || []).filter((ev) => ev.status === 'completed' && ctx.rows(ev.id, 'race').some((r) => r.constructor_id === e.constructorId)).length;
    const full = all === bySeason[y];
    const st = (ctx.standingsBy[`${y}|constructor`] || []).find((s) => s.subject_id === e.constructorId);
    const inProgress = y === ctx.currentSeason && (ctx.eventsBySeason[y] || []).some((ev) => ev.status !== 'completed' && ev.status !== 'canceled');
    return { season: y, races: bySeason[y], full, position: full && st ? st.position : null, inProgress };
  });
  const titles = table.filter((t) => t.full && !t.inProgress && t.position === 1).map((t) => t.season);
  return { starts, wins, podiums, poles, seasons: table, titles };
}

// technical leaders: the team's car in each season of the role where a machine record proves the model name.
// Holding the role that season is all this states - not that the person designed the car.
export function carsDuringTenure(reg, e) {
  if (!e.constructorId) return [];
  const out = [];
  for (const [season, m] of Object.entries(reg.machines || {})) {
    const y = Number(season);
    const covered = e.ranged ? (!e.from || year(e.from) <= y) && (e.ongoing || (e.to && year(e.to) >= y)) && !!e.from : e.observedSeasons.includes(y);
    const cm = m.teams?.[e.constructorId]?.carModel;
    if (covered && cm?.value && (cm.sources || []).length) out.push({ season: y, model: cm.value, short: cm.short || null });
  }
  return out.sort((a, b) => b.season - a.season);
}

export const TP = /team principal/i;
export const TECH_LEAD = /technical director|chief technical|technical officer|technical partner|chief designer|\bcto\b|director of engineering|engineering director/i;

// ---------- profile assembly ----------
export function personProfileV2(reg, own, ctx, personId) {
  const person = reg.people?.[personId];
  if (!person) return null;
  const tl = careerTimeline(reg, personId);
  const ownership = ownershipForPerson(own, personId);
  if (!tl.entries.length && !ownership.length) return null;
  const season = ctx.currentSeason;
  const current = currentRoles(reg, personId, season);
  const drivers = [];
  for (const e of tl.entries.filter((x) => x.driverId)) {
    const d = ctx.drivers.find((x) => x.slug === e.driverId);
    if (!d) continue;
    drivers.push({ driver: d, entry: e, stats: /race engineer|performance engineer/i.test(e.title) ? partnershipStats(ctx, e) : null });
  }
  const tenures = tl.entries.filter((e) => TP.test(e.title) && !/deputy|assistant/i.test(e.title) && e.constructorId).map((e) => ({ entry: e, stats: tenureStats(ctx, e) })).filter((x) => x.stats);
  const cars = tl.entries.filter((e) => TECH_LEAD.test(e.title)).map((e) => ({ entry: e, cars: carsDuringTenure(reg, e) })).filter((x) => x.cars.length);
  const orgs = [...new Set(tl.entries.map((e) => e.constructorId || e.organisation).filter(Boolean))];
  const allSrc = rolesOf(reg, personId).flatMap((r) => r.sources).map((s) => reg.sources?.[s]?.date).filter(Boolean).sort();
  return {
    slug: personId, name: person.name, photo: photoFor(reg, personId), identity: identityOf(reg, personId),
    timeline: tl, current, drivers, tenures, cars, ownership, orgs,
    verifiedAsOf: reg.retrieved || allSrc.at(-1) || null,
    groups: profileGroups(tl.entries, ownership),
  };
}

// directory filter groups (one person can sit in several)
export function profileGroups(entries, ownership = []) {
  const g = new Set();
  const cur = entries.filter((e) => e.ongoing);
  const pool = cur.length ? cur : entries;
  for (const e of pool) {
    if (TP.test(e.title) && !/deputy|assistant/i.test(e.title)) g.add('principal');
    if (e.roleGroup === 'leadership') g.add('leadership');
    if (e.roleGroup === 'technical') g.add('technical');
    if (e.roleGroup === 'race_engineering') g.add('race_engineering');
    if (e.roleGroup === 'sporting') g.add('sporting');
    if (e.roleGroup === 'power_unit') g.add('power_unit');
    if (e.roleGroup === 'garage_operations') g.add('garage');
    if (e.roleGroup === 'ownership') g.add('owners');
  }
  if (ownership.length) g.add('owners');
  return [...g];
}

// generated prose: assembled ONLY from frozen structured facts; descriptive verbs only (no causal language)
export const CAUSAL = /\b(led to|caused|thanks to|because of|delivered|responsible for (?:the|his|her) (?:win|title|success)|won [^.]* for)\b/i;
