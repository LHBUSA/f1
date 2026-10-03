// Historical constructor helpers: sourced car models, exact-season car photos, lineage notes and the lineage car strip.
// Selection rule for every historical image: exact constructor + exact season + approved public photo. Never another
// constructor because it shares a lineage, never another season as an unlabelled fallback.
import fs from 'node:fs';

const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
export const loadCarModels = () => read('src/identity/car-models.json');
export const loadLineageNotes = () => read('src/identity/lineage-notes.json');

/** Sourced chassis name raced by `constructorId` in `season`, or null. */
export function carModelFor(models, constructorId, season) {
  return models.models.find((m) => m.constructorId === constructorId && m.season === season)?.model || null;
}

/** Every approved photo of this exact constructor, one per season (oldest first). */
export function teamCarPhotos(reg, constructorId, { includeCandidates = false } = {}) {
  const bySeason = new Map();
  for (const p of reg.photos) if (p.constructorId === constructorId && (p.approvedForPublicUse || includeCandidates) && !bySeason.has(p.season)) bySeason.set(p.season, p);
  return [...bySeason.values()].sort((a, b) => a.season - b.season);
}

/**
 * Lineage machine strip: the car that closes each predecessor (its final season), the first and last car of the page's
 * own constructor, and the car that opens each successor (its first season) — each only when an approved exact-season
 * photo exists. `chain` = constructor ids in lineage order.
 */
export function lineageCars(reg, chain, currentId, opts = {}) {
  const at = chain.indexOf(currentId);
  const out = [];
  chain.forEach((id, i) => {
    const ps = teamCarPhotos(reg, id, opts);
    if (!ps.length) return;
    const pick = i < at ? [ps.at(-1)] : i > at ? [ps[0]] : [ps[0], ps.at(-1)];
    for (const p of pick) if (!out.includes(p)) out.push(p);
  });
  return out;
}
