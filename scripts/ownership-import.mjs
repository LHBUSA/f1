// Team ownership graph import -> src/identity/ownership.json (separate from the personnel graph).
//   node scripts/ownership-import.mjs <ownership-research.json>
// Each record: team x entity (person | company | fund) x relationship, with valid_from/to, sources and confidence.
// Rules enforced here: a percentage survives only with a percentage_note quoting the source; relationship must be one
// of the allowed values; a chairman/CEO/team-principal title is never accepted as an ownership relationship.
import fs from 'node:fs';
import crypto from 'node:crypto';

const R = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const OUT = 'src/identity/ownership.json';
const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : null;
const ALLOWED = new Set(['founder', 'owner', 'co-owner', 'controlling shareholder', 'chairman', 'parent company', 'investor', 'manufacturer owner']);
const BAD = /wikipedia\.org|fandom\.com|wikiwand|reddit\.com|celebritynetworth/;
const TIER = { first_party: 'A', fia: 'A', media: 'B' };
const sources = prev?.sources || {};
const sid = (s) => {
  const id = 'o-' + crypto.createHash('sha1').update(s.url).digest('hex').slice(0, 10);
  sources[id] ??= { url: s.url, publisher: s.publisher || null, type: s.type || 'media', date: s.date || null, tier: s.tier || TIER[s.type] || 'B' };
  return id;
};
// Editorial curation (2026-10-02): a share is printed the way the source states it. "One third" is not turned into
// 33.33; a stake in a parent or holding entity is never shown as a stake in the team itself; an announced decision is
// not a completed acquisition.
const CURATE = {
  'own-mercedes-mercedes-benz': { percentage: null, share_text: 'one third (three equal parts)' },
  'own-mercedes-ineos': { percentage: null, share_text: 'one third (three equal parts)' },
  'own-mercedes-toto-wolff': { percentage: null, share_text: 'one third (three equal parts)' },
  'own-mercedes-george-kurtz': { percentage: null, share_text: '15% of the Wolff holding entity (indirect)' },
  'own-ferrari-exor': { percentage: null, share_text: '21.33% of Ferrari N.V. common shares' },
  'own-ferrari-piero-ferrari': { percentage: null, share_text: '10.67% of Ferrari N.V. common shares' },
  'own-kick-sauber-audi': { percentage: null, share_text: 'decision to acquire 100% announced Mar 2024', confidence: 'medium' },
};
const records = [];
const rejected = [];
for (const o of R.records || []) {
  const rel = String(o.relationship || '').toLowerCase();
  const src = (o.sources || []).filter((s) => s?.url && !BAD.test(s.url)).map(sid);
  if (!ALLOWED.has(rel)) { rejected.push(`${o.id}: relationship ${rel}`); continue; }
  if (!src.length) { rejected.push(`${o.id}: no usable source`); continue; }
  Object.assign(o, CURATE[o.id] || {});
  const pct = typeof o.percentage === 'number' && o.percentage_note ? o.percentage : null;
  records.push({
    id: o.id, constructorId: o.constructorId, entity: { kind: o.entity?.kind || 'company', name: o.entity?.name, personId: o.entity?.personId || null },
    relationship: rel, ownership_type: o.ownership_type || null, percentage: pct, ...(pct != null ? { percentage_note: o.percentage_note } : {}), ...(o.share_text ? { share_text: o.share_text } : {}),
    valid_from: o.valid_from || null, valid_to: o.valid_to || null, current: o.current === true && !o.valid_to,
    confidence: o.confidence || 'medium', sources: src, ...(o.notes ? { notes: o.notes } : {}), ...(o.conflicts?.length ? { conflicts: o.conflicts } : {}),
    ...(!['high', 'medium'].includes(o.confidence) ? { held: 'low confidence' } : {}),
  });
}
const doc = {
  _doc: 'Team ownership graph (separate from job titles). relationship in founder|owner|co-owner|controlling shareholder|chairman|parent company|investor|manufacturer owner. chairman is governance, not ownership. percentage only when a source states it (percentage_note). valid_from/valid_to as precise as the source. Pages show high|medium records only; sources stay here (no per-fact links on pages).',
  version: 'f1-ownership@1', retrieved: R.retrieved || null, sources, records, unverified: R.unverified || [],
};
fs.writeFileSync(OUT, JSON.stringify(doc, null, 2) + '\n');
console.log({ records: records.length, rejected, teams: [...new Set(records.map((r) => r.constructorId))].length });
