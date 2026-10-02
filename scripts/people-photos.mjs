// Personnel headshots: cleared Commons photos -> square face crops (96/192 WebP) + provenance registry.
//   node scripts/people-photos.mjs <photos.json> [--crop personId=x,y,size ...]
// Crop = square around the face (sharp attention strategy unless a manual crop box is given, in original pixels).
// Only crop + resize: never retouched or recoloured. Credit (photographer + licence + "cropped") is shown on the page.
import fs from 'node:fs';
import crypto from 'node:crypto';
import sharp from 'sharp';

const [manifest, ...rest] = process.argv.slice(2);
const manual = Object.fromEntries(rest.filter((a) => a.includes('=')).map((a) => { const [id, v] = a.split('='); return [id, v.split(',').map(Number)]; }));
const list = JSON.parse(fs.readFileSync(manifest, 'utf8')).filter((p) => p.rightsStatus === 'cleared');
const REG = 'src/identity/people-photos.json';
const reg = fs.existsSync(REG) ? JSON.parse(fs.readFileSync(REG, 'utf8')) : { _doc: '', version: 'f1-people-photos@1', photos: {} };
reg._doc = 'Personnel photographs (faces). Cleared = free licence verified on Wikimedia Commons (or VRT-ticketed permission), SHA-1 matched, subject checked. Derivatives are square crops only; attribution keeps photographer + licence + "cropped". Anything not cleared renders as initials.';
fs.mkdirSync('assets-src/people', { recursive: true });
for (const p of list) {
  const buf = fs.readFileSync(p.file);
  const sha = crypto.createHash('sha1').update(buf).digest('hex');
  if (p.sha1 && sha !== p.sha1) { console.log('SKIP sha mismatch', p.personId); continue; }
  const files = {};
  for (const size of [96, 192]) {
    const out = `assets-src/people/${p.personId}-${size}.webp`;
    let img = sharp(buf).rotate();
    if (manual[p.personId]) { const [x, y, s] = manual[p.personId]; img = img.extract({ left: x, top: y, width: s, height: s }).resize(size, size); }
    else img = img.resize(size, size, { fit: 'cover', position: sharp.strategy.attention });
    await img.webp({ quality: 82 }).toFile(out);
    files[size] = out.split('/').pop();
  }
  reg.photos[p.personId] = {
    name: p.name, photoUrl: p.photoUrl, sourceUrl: p.sourceUrl, photographer: p.photographer, credit: p.credit, license: p.license, licenseUrl: p.licenseUrl,
    rightsStatus: 'cleared', sha1: sha, capturedAt: p.capturedAt || null, season: 2026, acquiredAt: '2026-10-02', modified: true,
    crop: manual[p.personId] ? { box: manual[p.personId] } : 'attention', files, notes: p.notes || null,
  };
  console.log('ok', p.personId);
}
fs.writeFileSync(REG, JSON.stringify(reg, null, 2) + '\n');
