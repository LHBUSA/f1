// Adds reviewed Commons car photos to src/identity/car-photos.json from a sourcing manifest.
//   node scripts/car-photo-add.mjs <candidates.json> <cutout-dir> [constructorId ...]
// Copies the original (SHA-1 must match Commons) and the background-removed master into assets-src/cars, then
// records full provenance. Run scripts/car-derivatives.mjs afterwards. Car model is NOT taken from the photo: the
// identity label comes from machine-<season>.json, which needs a first-party source.
import fs from 'node:fs';
import crypto from 'node:crypto';

const [manifest, cutDir, ...only] = process.argv.slice(2);
const REG = 'src/identity/car-photos.json';
const reg = JSON.parse(fs.readFileSync(REG, 'utf8'));
const today = new Date().toISOString().slice(0, 10);
const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

for (const c of JSON.parse(fs.readFileSync(manifest, 'utf8'))) {
  if (c.status !== 'READY' || (only.length && !only.includes(c.constructorId))) continue;
  const sha = crypto.createHash('sha1').update(fs.readFileSync(c.localPath)).digest('hex');
  if (sha !== c.originalSha1) throw new Error(`${c.constructorId}: SHA-1 mismatch`);
  const who = slug(c.photographer.split(/\s+/).pop());
  const id = `2026-${c.constructorId}-${slug(c.driver)}-${slug(c.event.split('(')[0]).replace(/^2026-/, '')}-${who}`;
  const stem = `assets-src/cars/derived/${id}`;
  const orig = `assets-src/cars/originals/${id}.jpg`;
  fs.copyFileSync(c.localPath, orig);
  fs.copyFileSync(`${cutDir}/${c.constructorId}/cutout-bire.png`, `${stem}-cutout-master.png`);
  const sa = /SA/.test(c.license);
  const entry = {
    id, season: 2026, constructorId: c.constructorId, constructorName: c.constructorName,
    carModel: null, carModelSource: 'see src/identity/machine-2026.json (first-party sourced label only)',
    driverId: slug(c.driver), event: '2026 Austrian Grand Prix, Friday practice', eventNote: c.session,
    capturedAt: c.capturedAt, imageUrl: c.imageUrl, localAssetPath: orig, originalSha1: c.originalSha1, originalSize: c.originalSize,
    sourceName: 'Wikimedia Commons', sourceUrl: c.sourceUrl, photographer: c.photographer, creditLine: c.creditLine,
    license: c.license, licenseUrl: c.licenseUrl,
    derivativeLicense: sa ? `${c.license} (ShareAlike: the background-removed derivative is offered under the same licence)` : null,
    attribution: `Photo: ${c.photographer}, ${c.license} · background removed`,
    acquisitionDate: today, rightsStatus: sa ? 'licensed_cc_by_sa_4.0' : 'licensed_cc_by_4.0',
    rightsNotes: `Commons file, author's own work, no restriction templates (${c.restrictions || 'none'}). Sponsor marks shown as photographed, unaltered; trademarks not licensed to PropBetEdge.`,
    approvedForPublicUse: true, approvedBy: 'owner standing rule 2026-10-02 (ship when provenance, rights and QA pass)', approvedAt: today,
    derivatives: {
      changes: ['background removed (rembg BiRefNet-general segmentation; background pixels made transparent, no pixels generated)', 'isolated background fragments removed', 'cropped to the car', 'resized'],
      master: `${stem}-cutout-master.png`, stem, facing: c.facing || 'left',
    },
  };
  reg.photos = reg.photos.filter((p) => p.id !== id && !(p.constructorId === c.constructorId && p.season === 2026 && p.id !== id && /raich/.test(p.id)));
  reg.photos.push(entry);
  console.log('added', id);
}
fs.writeFileSync(REG, JSON.stringify(reg, null, 2) + '\n');
