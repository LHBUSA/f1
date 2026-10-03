// Driver hero: global avatar size variants are never overridden by a bare .avatar rule; the current car comes only
// from the current-season grid constructor's approved photo; historical drivers get no current car.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync('src/web/styles.css', 'utf8');
const DIST = fs.existsSync('dist/drivers.html') && fs.existsSync('data/derived/meta.json');

test('no bare .avatar rule sets a size (it would override .avatar-sm/md/lg later in the cascade)', () => {
  for (const m of css.matchAll(/(^|\})\s*([^{}@]+)\{([^}]*)\}/g)) {
    const sels = m[2].split(',').map((s) => s.trim());
    if (sels.includes('.avatar')) assert.doesNotMatch(m[3], /(^|;)\s*(width|height)\s*:/, `bare .avatar sets a size: ${m[0].slice(0, 120)}`);
  }
  assert.match(css, /\.avatar-lg\{width:120px;height:120px\}/);
  assert.match(css, /@media\(min-width:1024px\)\{\.avatar-lg\{width:208px;height:208px\}/);
});

test('built driver pages: current car = grid constructor, current season, approved photo; historical drivers none', { skip: !DIST && 'needs a build' }, () => {
  const meta = JSON.parse(fs.readFileSync('data/derived/meta.json', 'utf8'));
  const season = meta.current_season;
  const photos = JSON.parse(fs.readFileSync('src/identity/car-photos.json', 'utf8')).photos;
  const drivers = JSON.parse(fs.readFileSync('data/normalized/drivers.json', 'utf8'));
  const byId = Object.fromEntries((drivers.drivers || drivers).map((d) => [d.id, d]));
  const carIds = (h) => [...new Set([...h.matchAll(/\/media\/cars\/([a-z0-9-]+?)-1280\.webp/g)].map((m) => m[1]))];
  let withCar = 0;
  for (const g of meta.current_grid) {
    const d = byId[g.driver_id];
    const h = fs.readFileSync(`dist/drivers/${d.slug}.html`, 'utf8');
    const hero = h.slice(h.indexOf('<section class="hero'), h.indexOf('</section>', h.indexOf('<section class="hero')));
    const photo = photos.find((p) => p.constructorId === g.constructor_id && p.season === season && p.approvedForPublicUse);
    if (photo) {
      withCar++;
      assert.deepEqual(carIds(hero), [photo.id], `${d.slug} hero car must be ${photo.id}`);
      assert.match(hero, new RegExp(`href="/teams/${g.constructor_id}#explorer"`));
      assert.match(hero, new RegExp(`href="/teams/${g.constructor_id}#powertrain"`));
      assert.match(hero, /rel="noopener license"/, `${d.slug} car credit`);
      if (photo.driverId === d.slug) assert.doesNotMatch(hero, /Pictured:/, d.slug);
      else assert.match(hero, new RegExp(`Pictured: ${byId[Object.keys(byId).find((k) => byId[k].slug === photo.driverId)].full_name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'s car`), d.slug);
    } else {
      assert.equal(carIds(hero).length, 0, `${d.slug}: no approved ${season} photo -> no car image`);
    }
  }
  assert.ok(withCar >= 20, `expected most of the grid to have a car, got ${withCar}`);
  // historical driver: no current car, no current-machine card
  for (const slug of ['michael-schumacher', 'ayrton-senna']) {
    const p = `dist/drivers/${slug}.html`;
    if (!fs.existsSync(p)) continue;
    const h = fs.readFileSync(p, 'utf8');
    assert.doesNotMatch(h, /class="drv-car"|cur-machine|\/media\/cars\//, slug);
  }
});
