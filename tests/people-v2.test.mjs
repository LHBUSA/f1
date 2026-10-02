// People Intelligence V2: fact model, timeline engine, ownership separation, descriptive-only prose, built pages.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadPeople, teamPeople } from '../src/identity/people.mjs';
import { loadOwnership, careerTimeline, currentRoles, splitTitles, ownershipForTeam, ownershipForPerson, profileGroups, isOwnershipRelation, partnershipStats, tenureStats, CAUSAL, profileVisible, identityOf } from '../src/identity/people-v2.mjs';

const reg = loadPeople();
const own = loadOwnership();
const DIST = fs.existsSync('dist/people.html');
const hasData = fs.existsSync('data/normalized/drivers.json');

// ---------- synthetic fixtures ----------
const fx = (roles, extra = {}) => ({ people: { p: { name: 'Test Person' }, q: { name: 'Other' } }, sources: { s1: { url: 'https://example.org/a' } }, roles, machines: {}, photos: {}, ...extra });
const R = (o) => ({ personId: 'p', roleGroup: 'race_engineering', constructorId: 'mercedes', driverId: null, season: 2026, current: false, sources: ['s1'], confidence: 'high', display: false, history: true, ...o });

test('timeline: dated spells become ranges, gaps stay gaps, a season record is never stretched', () => {
  const r = fx([
    R({ role: 'Race Engineer', driverId: 'a', effectiveFrom: '2010', effectiveTo: '2012', season: 2010 }),
    R({ role: 'Race Engineer', driverId: 'b', effectiveFrom: '2014-03', effectiveTo: '2016-11-27', season: 2014 }),
    R({ role: 'Head of Race Engineering', history: false, display: true, current: true, season: 2026 }),
  ]);
  const tl = careerTimeline(r, 'p');
  assert.equal(tl.entries.length, 3);
  assert.deepEqual(tl.gaps, [{ from: 2013, to: 2013 }]);
  const obs = tl.entries.find((e) => e.title === 'Head of Race Engineering');
  assert.equal(obs.ranged, false);
  assert.equal(obs.period, '2026 season');
  assert.equal(tl.entries.find((e) => e.driverId === 'b').period, 'Mar 2014 – 27 Nov 2016');
});

test('previous spells never lend their dates to a current role', () => {
  const r = fx([
    R({ role: 'Technical Director', roleGroup: 'technical', effectiveFrom: '2017-03', effectiveTo: '2021-07', season: 2017 }),
    R({ role: 'Chief Technical Officer', roleGroup: 'technical', effectiveFrom: '2021-07', effectiveTo: '2023-04', season: 2021 }),
    R({ role: 'Technical Director', roleGroup: 'technical', history: false, display: true, current: true, season: 2026 }),
  ]);
  const cur = currentRoles(r, 'p', 2026);
  assert.equal(cur.length, 1);
  assert.equal(cur[0].title, 'Technical Director');
  assert.equal(cur[0].effective_from, null, 'the 2017 start of an ended spell must not become the current start');
  // an ongoing dated spell with the same title DOES date the current role
  r.roles.push(R({ role: 'Technical Director', roleGroup: 'technical', effectiveFrom: '2023-04', current: true, season: 2023 }));
  const cur2 = currentRoles(r, 'p', 2026);
  assert.equal(cur2.length, 1);
  assert.equal(cur2[0].effective_from, '2023-04');
});

test('registry: every current role is current, every ended spell stays out of team pages', () => {
  for (const cid of new Set(reg.roles.map((r) => r.constructorId).filter(Boolean))) {
    const P = teamPeople(reg, cid, 2026);
    for (const g of ['leadership', 'technical', 'raceEngineering', 'sporting', 'powerUnit', 'garageOps']) for (const r of P[g]) {
      assert.ok(!r.history && r.current === true && !r.effectiveTo && r.season === 2026, `${cid} ${r.personId} ${r.role} leaked into the team page`);
      assert.notEqual(r.roleGroup, 'ownership', `${cid} ${r.personId}: ownership title listed as leadership`);
    }
  }
  for (const pid of Object.keys(reg.people)) for (const c of currentRoles(reg, pid, 2026)) {
    assert.ok(!c.to, `${pid} current role has an end date`);
    if (c.effective_from) assert.ok(reg.roles.some((r) => r.personId === pid && r.effectiveFrom === c.effective_from && r.current === true && !r.effectiveTo), `${pid} current start ${c.effective_from} not from an ongoing record`);
  }
});

test('current roles of the canaries are correct', () => {
  const has = (pid, re, cid) => currentRoles(reg, pid, 2026).some((c) => re.test(c.title) && c.constructorId === cid);
  assert.ok(has('toto-wolff', /team principal/i, 'mercedes'));
  assert.ok(has('frederic-vasseur', /team principal/i, 'ferrari'));
  assert.ok(has('james-vowles', /team principal/i, 'williams'));
  assert.ok(has('james-allison', /technical director/i, 'mercedes'));
  assert.ok(has('peter-bonnington', /head of race engineering/i, 'mercedes'));
  assert.ok(has('gianpiero-lambiase', /race engineering|race engineer/i, 'red-bull'));
  assert.ok(!currentRoles(reg, 'gianpiero-lambiase', 2026).some((c) => c.constructorId === 'mclaren'), 'announced, not-yet-started move must not be current');
});

test('multiple concurrent roles are supported (Bonnington: head of race engineering + race engineer)', () => {
  const cur = currentRoles(reg, 'peter-bonnington', 2026);
  assert.ok(cur.length >= 2, JSON.stringify(cur.map((c) => c.title)));
  const re = cur.find((c) => /^race engineer$/i.test(c.title));
  assert.equal(re?.driverId, 'kimi-antonelli');
  assert.equal(cur.find((c) => /head of race engineering/i.test(c.title))?.driverId, null, 'department head is not a driver edge');
});

test('race engineer <-> driver association is exact', () => {
  assert.deepEqual(splitTitles({ role: 'Head of Race Engineering; Race Engineer (Kimi Antonelli)', driverId: 'kimi-antonelli' }), [{ title: 'Head of Race Engineering', driverId: null }, { title: 'Race Engineer', driverId: 'kimi-antonelli' }]);
  for (const pid of Object.keys(reg.people)) for (const e of careerTimeline(reg, pid).entries.filter((x) => x.driverId)) {
    assert.ok(reg.roles.some((r) => r.personId === pid && r.driverId === e.driverId && profileVisible(r)), `${pid} -> ${e.driverId} has no visible role edge`);
    assert.match(e.title, /engineer|mechanic|chief/i, `${pid} ${e.title} is not a driver-specific title`);
  }
  if (reg.roles.some((r) => r.personId === 'peter-bonnington' && r.driverId === 'lewis-hamilton' && r.history)) {
    const e = careerTimeline(reg, 'peter-bonnington').entries.find((x) => x.driverId === 'lewis-hamilton');
    assert.ok(e && e.constructorId === 'mercedes' && e.ranged, 'Bonnington-Hamilton is a dated Mercedes range');
  }
});

test('ownership is separate from leadership and a team principal is never an owner by title', () => {
  for (const o of own.records || []) {
    assert.ok(o.sources?.length, `${o.id} unsourced`);
    for (const s of o.sources) assert.ok(own.sources[s]?.url, `${o.id} source ${s} unresolved`);
    if (o.percentage != null) assert.ok(o.percentage_note, `${o.id} percentage without a quoted source`);
    assert.doesNotMatch(o.relationship, /principal|ceo|director|chief/i, `${o.id} job title as ownership`);
  }
  for (const cid of new Set((own.records || []).map((o) => o.constructorId))) for (const o of ownershipForTeam(own, cid)) assert.ok(isOwnershipRelation(o.relationship), `${o.id} ${o.relationship} rendered as ownership`);
  // a team principal with no ownership record gets no owner group
  const tp = fx([R({ role: 'Team Principal', roleGroup: 'leadership', history: false, display: true, current: true })]);
  const e = careerTimeline(tp, 'p').entries;
  assert.ok(!profileGroups(e, ownershipForPerson({ records: [] }, 'p')).includes('owners'));
  assert.ok(profileGroups(e, []).includes('principal'));
  // chairman is governance, never ownership
  const gov = { records: [{ id: 'x', constructorId: 'haas', entity: { personId: 'p', name: 'P' }, relationship: 'chairman', confidence: 'high', sources: ['a'] }], sources: { a: { url: 'https://e.org' } } };
  assert.equal(ownershipForTeam(gov, 'haas').length, 0);
  for (const cid of ['haas', 'mercedes']) {
    const tps = teamPeople(reg, cid, 2026).leadership.filter((r) => /team principal/i.test(r.role)).map((r) => r.personId);
    for (const pid of tps) for (const o of ownershipForPerson(own, pid)) assert.ok(o.sources.length && o.relationship !== 'chairman', `${pid} owner record needs its own source`);
  }
  if ((own.records || []).length) {
    assert.ok(ownershipForTeam(own, 'haas').some((o) => o.entity.personId === 'gene-haas'), 'Gene Haas ownership record');
    assert.ok(ownershipForTeam(own, 'mercedes').length >= 1, 'Mercedes ownership record');
  }
});

test('identity facts are sourced and whitelisted; conflicting facts are held', () => {
  const ALLOWED = new Set(['full_name', 'known_as', 'nationality', 'date_of_birth', 'birthplace', 'education', 'specialty', 'prior_racing']);
  for (const [pid, p] of Object.entries(reg.people)) {
    for (const k of Object.keys(p.identity || {})) assert.ok(ALLOWED.has(k), `${pid} identity field ${k} not allowed`);
    const id = identityOf(reg, pid);
    for (const k of ['nationality', 'date_of_birth', 'birthplace']) if (id[k]) { assert.ok(id[k].sources.length, `${pid} ${k} unsourced`); assert.ok(!id[k].conflict); }
    if (id.date_of_birth) assert.match(id.date_of_birth.value, /^\d{4}(-\d{2}-\d{2})?$/);
  }
  const held = fx([], { people: { p: { name: 'X', identity: { date_of_birth: { value: '1970-01-01', sources: ['s1'], conflict: ['1970-01-01', '1971-01-01'] } } } } });
  assert.equal(identityOf(held, 'p').date_of_birth, undefined);
});

test('performance context counts only races inside the verified window, for the role team', { skip: !hasData && 'needs local data/' }, async () => {
  const { loadContext } = await import('../scripts/site/context.mjs');
  const ctx = loadContext();
  const e = { driverId: 'lewis-hamilton', constructorId: 'mercedes', ranged: true, from: '2013', to: '2013', ongoing: false, observedSeasons: [] };
  const s = partnershipStats(ctx, e);
  assert.ok(s && s.seasons.length === 1 && s.seasons[0] === 2013, 'only 2013');
  assert.equal(s.starts, 19);
  assert.equal(s.wins, 1);
  assert.equal(partnershipStats(ctx, { ...e, constructorId: 'mclaren' }), null, 'no McLaren starts in 2013');
  const t = tenureStats(ctx, { constructorId: 'mercedes', ranged: true, from: '2014', to: '2014', ongoing: false, observedSeasons: [] });
  assert.equal(t.starts, 19);
  assert.deepEqual(t.titles, [2014]);
});

// ---------- built pages ----------
const read = (p) => fs.readFileSync(p, 'utf8');
const peopleFiles = DIST ? fs.readdirSync('dist/people').filter((f) => f.endsWith('.html')).map((f) => `dist/people/${f}`) : [];
const text = (html) => html.slice(html.indexOf('<main'), html.indexOf('</main>')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

test('no causal language in generated people prose', { skip: !DIST && 'needs a build (node scripts/build-site.mjs)' }, () => {
  const RE = /\b(led to|caused|thanks to|because of|delivered|won .* for)\b/i;
  for (const f of [...peopleFiles, 'dist/people.html', ...['kimi-antonelli', 'arvid-lindblad', 'max-verstappen', 'lewis-hamilton'].map((s) => `dist/drivers/${s}.html`).filter(fs.existsSync)]) {
    const html = read(f);
    for (const sel of [/<p class="sub">([\s\S]*?)<\/p>/g, /<meta name="description" content="([^"]*)"/g]) for (const m of html.matchAll(sel)) assert.doesNotMatch(m[1], RE, `${f}: ${m[1].slice(0, 120)}`);
    if (f.includes('/people/')) assert.doesNotMatch(text(html), RE, f);
  }
  assert.ok(CAUSAL.test('a podium thanks to the strategy') && !CAUSAL.test('Race Engineer for Lewis Hamilton'));
});

test('only cleared photos render on people pages', { skip: !DIST && 'needs a build' }, () => {
  const cleared = new Set(Object.values(reg.photos).filter((p) => p.rightsStatus === 'cleared').flatMap((p) => Object.values(p.files || {})));
  for (const p of Object.values(reg.photos).filter((x) => x.rightsStatus === 'cleared')) {
    assert.match(p.license, /^(CC0|Public domain|CC BY(-SA)? \d\.\d)/i, `${p.name} licence ${p.license}`);
    assert.doesNotMatch(p.license, /NC|ND/);
    assert.match(p.sha1, /^[0-9a-f]{40}$/);
    assert.match(p.sourceUrl, /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
  }
  for (const f of [...peopleFiles, 'dist/people.html']) for (const m of read(f).matchAll(/src="\/media\/people\/([^"]+)"/g)) {
    assert.ok(cleared.has(m[1]), `${f} renders uncleared ${m[1]}`);
    assert.ok(fs.existsSync(`dist/media/people/${m[1]}`), `${m[1]} missing from dist`);
  }
});

test('Person JSON-LD is valid on every profile', { skip: !DIST && 'needs a build' }, () => {
  for (const f of peopleFiles) {
    const lds = [...read(f).matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
    const p = lds.find((x) => x['@type'] === 'Person');
    assert.ok(p, `${f} has no Person`);
    assert.equal(p['@context'], 'https://schema.org');
    assert.ok(p.name && /^https:\/\/f1\.propbetedge\.ai\/people\/[a-z0-9-]+$/.test(p.url), `${f} name/url`);
    if (p.birthDate) assert.match(p.birthDate, /^\d{4}-\d{2}-\d{2}$/);
    if (p.nationality) assert.equal(p.nationality['@type'], 'Country');
    if (p.worksFor) assert.ok(p.worksFor.name && p.worksFor.url);
    if (p.image) { const slug = p.url.split('/').pop(); assert.equal(reg.photos[slug]?.rightsStatus, 'cleared', `${f} image without cleared photo`); }
  }
});

test('internal links on people pages, the directory and canary driver pages resolve to built pages', { skip: !DIST && 'needs a build' }, () => {
  const exists = (h) => {
    const p = h.split(/[?#]/)[0];
    if (p === '/' || p === '') return true;
    if (/^\/(api|assets|media|news\/cards)\//.test(p)) return fs.existsSync(path.join('dist', p)) || p.startsWith('/api/');
    return fs.existsSync(path.join('dist', `${p}.html`)) || fs.existsSync(path.join('dist', p, 'index.html')) || fs.existsSync(path.join('dist', p));
  };
  const files = [...peopleFiles, 'dist/people.html', ...['kimi-antonelli', 'arvid-lindblad', 'max-verstappen', 'lewis-hamilton'].map((s) => `dist/drivers/${s}.html`), ...['mercedes', 'haas', 'red-bull', 'ferrari', 'williams'].map((t) => `dist/teams/${t}.html`)].filter(fs.existsSync);
  const bad = [];
  for (const f of files) {
    const main = read(f);
    for (const m of main.matchAll(/href="(\/[^"]*)"/g)) if (!m[1].startsWith('//') && !exists(m[1])) bad.push(`${f} -> ${m[1]}`);
  }
  assert.deepEqual([...new Set(bad)], []);
});
