// Builds responsive derivatives for every photo in src/identity/car-photos.json from its background-removed master.
//   node scripts/car-derivatives.mjs [--id <photo id>]
// Resize + encode only (AVIF/WebP at 640/960/1280/1920). Never alters car pixels. Records aspect + file map + sha1s.
import fs from 'node:fs';
import crypto from 'node:crypto';
import sharp from 'sharp';

const REG = 'src/identity/car-photos.json';
const WIDTHS = [640, 960, 1280, 1920];
const reg = JSON.parse(fs.readFileSync(REG, 'utf8'));
const only = process.argv.includes('--id') ? process.argv[process.argv.indexOf('--id') + 1] : null;
const sha1 = (f) => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex');

for (const p of reg.photos) {
  if (only && p.id !== only) continue;
  const d = p.derivatives;
  if (p.localAssetPath && p.originalSha1 && sha1(p.localAssetPath) !== p.originalSha1) throw new Error(`${p.id}: original does not match recorded SHA-1`);
  const meta = await sharp(d.master).metadata();
  const stem = d.stem || d.master.replace(/-cutout-master\.png$/, '');
  d.files = {};
  for (const w of WIDTHS) {
    d.files[w] = {};
    for (const ext of ['webp', 'avif']) {
      const f = `${stem}-${w}.${ext}`;
      const img = sharp(d.master).resize(Math.min(w, meta.width));
      await (ext === 'webp' ? img.webp({ quality: 82, alphaQuality: 90 }) : img.avif({ quality: 55 })).toFile(f);
      d.files[w][ext] = f;
    }
  }
  d.aspect = [meta.width, meta.height];
  d.masterSha1 = sha1(d.master);
  // Car Explorer: hotspots use normalised coordinates of the master (0..1, origin top-left); identical on every derivative
  p.explorer ??= { coordinateSystem: { space: 'normalized-master', origin: 'top-left', x: '0..1 of width', y: '0..1 of height', master: d.master }, hotspots: [] };
  p.explorer.coordinateSystem.aspect = d.aspect;
  console.log(p.id, d.aspect.join('x'));
}
fs.writeFileSync(REG, JSON.stringify(reg, null, 2) + '\n');
