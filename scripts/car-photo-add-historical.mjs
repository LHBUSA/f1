// Adds reviewed Commons photographs of HISTORICAL cars to src/identity/car-photos.json (the one photo registry).
//   node scripts/car-photo-add-historical.mjs <manifest.json>
// Manifest rows: { constructorId, season, file (Commons title), localPath (original), cutout (background-removed
// master), photographer, license, licenseUrl, sourceUrl, imageUrl, originalSha1, originalSize, capturedAt,
// photographed (where/when the photo was taken), driverId?, restrictions?, facing? }.
// The car model comes from src/identity/car-models.json (exact constructor + exact season, sourced); a row with no
// model entry is refused. Original SHA-1 must match Commons. Run scripts/car-derivatives.mjs --id <id> afterwards.
import fs from 'node:fs';
import crypto from 'node:crypto';

const REG = 'src/identity/car-photos.json';
const reg = JSON.parse(fs.readFileSync(REG, 'utf8'));
const models = JSON.parse(fs.readFileSync('src/identity/car-models.json', 'utf8')).models;
const today = new Date().toISOString().slice(0, 10);
const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

for (const c of JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))) {
  const m = models.find((x) => x.constructorId === c.constructorId && x.season === c.season);
  if (!m) throw new Error(`${c.constructorId} ${c.season}: no sourced car model in car-models.json`);
  const sha = crypto.createHash('sha1').update(fs.readFileSync(c.localPath)).digest('hex');
  if (sha !== c.originalSha1) throw new Error(`${c.constructorId} ${c.season}: SHA-1 mismatch`);
  const id = `${c.season}-${slug(m.model)}-${slug(c.photographer.split(/\s+/).slice(-1)[0])}`;
  const stem = `assets-src/cars/derived/${id}`;
  const orig = `assets-src/cars/originals/${id}.jpg`;
  fs.copyFileSync(c.localPath, orig);
  fs.copyFileSync(c.cutout, `${stem}-cutout-master.png`);
  const sa = /SA/.test(c.license);
  const entry = {
    id, season: c.season, constructorId: c.constructorId, constructorName: c.constructorName,
    carModel: m.model, carModelSource: `src/identity/car-models.json (${m.sources.join(', ')})`,
    driverId: c.driverId || null, event: c.photographed, eventNote: c.photographedNote || null, historical: true,
    capturedAt: c.capturedAt, imageUrl: c.imageUrl, localAssetPath: orig, originalSha1: c.originalSha1, originalSize: c.originalSize,
    sourceName: 'Wikimedia Commons', sourceUrl: c.sourceUrl, photographer: c.photographer,
    creditLine: `Photo: ${c.photographer} / Wikimedia Commons, ${c.license}`,
    license: c.license, licenseUrl: c.licenseUrl,
    derivativeLicense: sa ? `${c.license} (ShareAlike: the background-removed derivative is offered under the same licence)` : null,
    attribution: `Photo: ${c.photographer}, ${c.license} · background removed`,
    acquisitionDate: today, rightsStatus: `licensed_${slug(c.license).replace(/-/g, '_')}`,
    rightsNotes: `Commons file page checked individually: ${c.rightsCheck}. Sponsor marks shown as photographed, unaltered; trademarks not licensed to PropBetEdge.`,
    approvedForPublicUse: true, approvedBy: 'owner standing rule 2026-10-02 (ship when provenance, rights and QA pass)', approvedAt: today,
    derivatives: {
      changes: ['background removed (rembg BiRefNet-general segmentation; background pixels made transparent, no pixels generated)', 'isolated background fragments removed', 'cropped to the car', 'resized'],
      master: `${stem}-cutout-master.png`, stem, facing: c.facing || 'left',
    },
  };
  reg.photos = reg.photos.filter((p) => p.id !== id);
  reg.photos.push(entry);
  console.log('added', id);
}
fs.writeFileSync(REG, JSON.stringify(reg, null, 2) + '\n');
