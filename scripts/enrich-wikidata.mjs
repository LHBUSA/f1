// Wikidata (CC0) enrichment: championship race → circuit item → coordinates, country, length, inception.
// Crosswalk ESPN venue → Wikidata circuit by majority vote over matched events ("{year} {Grand Prix name}").
// Raw SPARQL responses are archived under .cache/wikidata by query hash before parsing.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { slugify } from '../src/core/normalize.mjs';

const UA = 'PropBetEdge-F1/1.0 (https://f1.propbetedge.ai; sales@localhomebuyersusa.com)';
const CACHE = path.resolve('.cache/wikidata');
fs.mkdirSync(CACHE, { recursive: true });

async function sparql(q, maxAgeMs = 7 * 86400e3) {
  const h = crypto.createHash('sha256').update(q).digest('hex').slice(0, 24);
  const f = path.join(CACHE, h + '.json');
  if (fs.existsSync(f) && Date.now() - fs.statSync(f).mtimeMs < maxAgeMs) return JSON.parse(fs.readFileSync(f, 'utf8'));
  const res = await fetch('https://query.wikidata.org/sparql?query=' + encodeURIComponent(q), {
    headers: { Accept: 'application/sparql-results+json', 'User-Agent': UA },
  });
  if (!res.ok) throw new Error(`WDQS ${res.status}`);
  const body = await res.json();
  const env = { query: q, capturedAt: new Date().toISOString(), data: body };
  fs.writeFileSync(f, JSON.stringify(env));
  return env;
}

const v = (b, k) => b[k]?.value ?? null;
const qid = (u) => (u ? u.split('/').pop() : null);

const races = await sparql(`SELECT ?race ?raceLabel ?circuit ?date WHERE {
  ?race wdt:P361 ?season . ?season wdt:P3450 wd:Q1968 .
  OPTIONAL { ?race wdt:P276 ?circuit . ?circuit wdt:P31 ?cls . VALUES ?cls { wd:Q2338524 wd:Q926439 wd:Q1777138 wd:Q24256 } }
  OPTIONAL { ?race wdt:P585 ?date }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }`);

const circuitIds = [...new Set(races.data.results.bindings.map((b) => qid(v(b, 'circuit'))).filter(Boolean))];
const circ = await sparql(`SELECT ?c ?cLabel ?coord ?countryLabel ?length ?lengthUnitLabel ?inception ?locLabel ?article WHERE {
  VALUES ?c { ${circuitIds.map((x) => 'wd:' + x).join(' ')} }
  OPTIONAL { ?c wdt:P625 ?coord }
  OPTIONAL { ?c wdt:P17 ?country }
  OPTIONAL { ?c p:P2043/psv:P2043 [ wikibase:quantityAmount ?length ; wikibase:quantityUnit ?lengthUnit ] }
  OPTIONAL { ?c wdt:P571 ?inception }
  OPTIONAL { ?c wdt:P131 ?loc }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }`);

const circuits = {};
for (const b of circ.data.results.bindings) {
  const id = qid(v(b, 'c'));
  const c = (circuits[id] ||= { wikidata_id: id, name: v(b, 'cLabel'), lat: null, lon: null, country: v(b, 'countryLabel'), locality: v(b, 'locLabel'), length_km: null, opened: null });
  const coord = v(b, 'coord')?.match(/Point\(([-\d.]+) ([-\d.]+)\)/);
  if (coord && c.lat == null) {
    c.lon = Number(coord[1]);
    c.lat = Number(coord[2]);
  }
  const len = Number(v(b, 'length'));
  const unit = v(b, 'lengthUnitLabel');
  if (len && c.length_km == null) c.length_km = unit === 'metre' ? len / 1000 : unit === 'kilometre' ? len : unit === 'mile' ? len * 1.609344 : null;
  if (v(b, 'inception') && !c.opened) c.opened = Number(v(b, 'inception').slice(0, 4));
}

// Match ESPN events → Wikidata races.
const events = JSON.parse(fs.readFileSync('data/normalized/events.json', 'utf8'));
const raceByLabel = {};
for (const b of races.data.results.bindings) {
  const label = v(b, 'raceLabel');
  if (!label) continue;
  (raceByLabel[slugify(label)] ||= []).push({ race: qid(v(b, 'race')), circuit: qid(v(b, 'circuit')), date: v(b, 'date')?.slice(0, 10) });
}
const votes = {};
const eventXwalk = [];
let matched = 0;
for (const e of events) {
  const cands = raceByLabel[slugify(`${e.season} ${e.name}`)] || [];
  // Date guard: Wikidata race date must fall within the ESPN event weekend (±3 days) when both exist.
  const raceDay = e.end_utc?.slice(0, 10) || e.start_utc.slice(0, 10);
  const ok = cands.filter((c) => !c.date || Math.abs(Date.parse(c.date) - Date.parse(raceDay)) <= 3 * 86400e3);
  if (ok.length !== 1) continue;
  matched++;
  eventXwalk.push({ event_id: e.id, wikidata_race: ok[0].race });
  if (ok[0].circuit && e.circuit_id) {
    const vv = (votes[e.circuit_id] ||= {});
    vv[ok[0].circuit] = (vv[ok[0].circuit] || 0) + 1;
  }
}
// Identity guard: a crosswalk must share a distinctive name/locality token, else it is rejected.
const GENERIC = new Set(['circuit', 'international', 'autodromo', 'autodrome', 'grand', 'prix', 'street', 'track', 'park', 'de', 'the', 'of', 'city', 'ring', 'race', 'raceway', 'motor', 'speedway', 'nazionale', 'e', 'del', 'do', 'la', 'le', 'des', 'du', 'and', 'circuito', 'autodromo', 'autódromo']);
const toks = (...xs) => new Set(xs.filter(Boolean).flatMap((x) => slugify(x).split('-')).filter((t) => t.length > 2 && !GENERIC.has(t)));
const venuesAll = JSON.parse(fs.readFileSync('data/normalized/circuits.json', 'utf8'));
const venueById = Object.fromEntries(venuesAll.map((x) => [x.id, x]));
const rejected = [];
function plausible(venueId, wd) {
  const ven = venueById[venueId];
  const c = circuits[wd];
  if (!ven || !c) return false;
  const a = toks(ven.name, ven.locality);
  const b = toks(c.name, c.locality);
  return [...a].some((t) => b.has(t) || [...b].some((u) => u.startsWith(t) || t.startsWith(u)));
}
const venueXwalk = {};
for (const [venue, vv0] of Object.entries(votes)) {
  const vv = Object.fromEntries(Object.entries(vv0).filter(([wd]) => plausible(venue, wd) || (rejected.push({ venue, wd, name: circuits[wd]?.name }), false)));
  if (!Object.keys(vv).length) continue;
  const sorted = Object.entries(vv).sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((s, x) => s + x[1], 0);
  venueXwalk[venue] = { wikidata_id: sorted[0][0], votes: sorted[0][1], total, agreement: +(sorted[0][1] / total).toFixed(2), alternatives: sorted.slice(1) };
}

// Fallback: venues with no race-level vote → Wikidata entity search on the ESPN venue name, track classes only.
const venues = JSON.parse(fs.readFileSync('data/normalized/circuits.json', 'utf8'));
const TRACK = new Set(['Q2338524', 'Q926439', 'Q1777138', 'Q24256']);
for (const ven of venues) {
  if (venueXwalk[ven.id]) continue;
  const term = ven.name;
  const sres = await fetch(`https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=en&type=item&limit=7&search=${encodeURIComponent(term)}`, { headers: { 'User-Agent': UA } }).then((r) => r.json());
  const ids = (sres.search || []).map((x) => x.id);
  if (!ids.length) continue;
  const cls = await sparql(`SELECT ?c ?cLabel ?t ?coord ?countryLabel ?length ?lengthUnitLabel ?inception WHERE { VALUES ?c { ${ids.map((x) => 'wd:' + x).join(' ')} } ?c wdt:P31 ?t .
    OPTIONAL { ?c wdt:P625 ?coord } OPTIONAL { ?c wdt:P17 ?country } OPTIONAL { ?c wdt:P571 ?inception }
    OPTIONAL { ?c p:P2043/psv:P2043 [ wikibase:quantityAmount ?length ; wikibase:quantityUnit ?lengthUnit ] }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }`, 30 * 86400e3);
  const hit0 = ids.find((id) => cls.data.results.bindings.some((b) => qid(v(b, 'c')) === id && TRACK.has(qid(v(b, 't')))
    && (!ven.country || !v(b, 'countryLabel') || slugify(v(b, 'countryLabel')).includes(slugify(ven.country).slice(0, 4)) || slugify(ven.country).includes(slugify(v(b, 'countryLabel')).slice(0, 4)))));
  if (!hit0) continue;
  const hit = hit0;
  for (const b of cls.data.results.bindings.filter((b) => qid(v(b, 'c')) === hit)) {
    const c = (circuits[hit] ||= { wikidata_id: hit, name: v(b, 'cLabel'), lat: null, lon: null, country: v(b, 'countryLabel'), locality: null, length_km: null, opened: null });
    const coord = v(b, 'coord')?.match(/Point\(([-\d.]+) ([-\d.]+)\)/);
    if (coord && c.lat == null) { c.lon = Number(coord[1]); c.lat = Number(coord[2]); }
    const len = Number(v(b, 'length')); const unit = v(b, 'lengthUnitLabel');
    if (len && c.length_km == null) c.length_km = unit === 'metre' ? len / 1000 : unit === 'kilometre' ? len : null;
    if (v(b, 'inception') && !c.opened) c.opened = Number(v(b, 'inception').slice(0, 4));
  }
  if (!plausible(ven.id, hit)) { rejected.push({ venue: ven.id, wd: hit, name: circuits[hit]?.name, method: 'search' }); continue; }
  venueXwalk[ven.id] = { wikidata_id: hit, votes: 0, total: 0, agreement: null, method: 'name_search', espn_name: ven.name };
}

const out = {
  source: 'wikidata',
  licence: 'CC0 1.0',
  captured_at: races.capturedAt,
  query_hashes: [races.query, circ.query].map((q) => crypto.createHash('sha256').update(q).digest('hex')),
  events_matched: matched,
  events_total: events.length,
  venue_crosswalk: venueXwalk,
  circuits,
  event_crosswalk: eventXwalk,
  rejected_crosswalks: rejected,
};
fs.writeFileSync('data/normalized/wikidata.json', JSON.stringify(out));
fs.mkdirSync('data/fragments', { recursive: true });
fs.writeFileSync('data/fragments/wikidata.json', JSON.stringify(out));
console.log('rejected', JSON.stringify(rejected));
console.log(`wikidata races ${races.data.results.bindings.length}, circuits ${Object.keys(circuits).length}, events matched ${matched}/${events.length}, venues crosswalked ${Object.keys(venueXwalk).length}`);
for (const [k, x] of Object.entries(venueXwalk)) console.log(k, x.wikidata_id, circuits[x.wikidata_id]?.name, x.votes + '/' + x.total, circuits[x.wikidata_id]?.lat, circuits[x.wikidata_id]?.length_km);
