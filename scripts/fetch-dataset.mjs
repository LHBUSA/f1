// Vercel build step: download normalized fragments from f1-api (token-gated) into data/fragments.
// history-v1.json.gz = all seasons before the current one + drivers + venues + wikidata (immutable upload);
// season-<current>.json, drivers-current.json, venues-current.json = maintained by the f1-api cron.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const API = process.env.PROPSPORTS_F1_BASE || 'https://propsports.proptechusa.ai/v1/f1';
const TOKEN = process.env.F1_DATASET_TOKEN;
if (!TOKEN) {
  // Local development may reuse fragments already on disk; a Vercel build must always pull from PropSports.
  if (!process.env.VERCEL && fs.existsSync('data/fragments/drivers.json')) { console.log('fetch-dataset: local run, using existing data/fragments'); process.exit(0); }
  console.error('fetch-dataset: F1_DATASET_TOKEN missing');
  process.exit(1);
}
const FRAG = path.resolve('data/fragments');
fs.mkdirSync(FRAG, { recursive: true });
const h = { authorization: `Bearer ${TOKEN}` };
async function getBuf(key) {
  const r = await fetch(`${API}/dataset/${key}`, { headers: h });
  if (!r.ok) throw new Error(`${key}: ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}
const manifest = await (await fetch(`${API}/dataset`, { headers: h })).json();
const keys = new Set(manifest.objects.map((o) => o.key));
let buf = await getBuf('fragments/history-v1.json.gz');
if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
const hist = JSON.parse(buf.toString('utf8'));
const cur = new Date().getUTCFullYear();
for (const f of hist.seasons) fs.writeFileSync(path.join(FRAG, `season-${f.season}.json`), JSON.stringify(f));
let drivers = hist.drivers;
let venues = hist.venues;
if (keys.has(`fragments/season-${cur}.json`)) {
  const f = JSON.parse((await getBuf(`fragments/season-${cur}.json`)).toString('utf8'));
  fs.writeFileSync(path.join(FRAG, `season-${cur}.json`), JSON.stringify(f));
  console.log(`current season ${cur}: ${f.events.length} events, ${f.results.length} results (live cron fragment)`);
}
const merge = (base, extra) => Object.values(Object.fromEntries([...base, ...extra].map((x) => [x.id, x])));
if (keys.has('fragments/drivers-current.json')) drivers = merge(drivers, JSON.parse((await getBuf('fragments/drivers-current.json')).toString('utf8')));
if (keys.has('fragments/venues-current.json')) venues = merge(venues, JSON.parse((await getBuf('fragments/venues-current.json')).toString('utf8')));
fs.writeFileSync(path.join(FRAG, 'drivers.json'), JSON.stringify(drivers));
fs.writeFileSync(path.join(FRAG, 'venues.json'), JSON.stringify(venues));
fs.writeFileSync(path.join(FRAG, 'wikidata.json'), JSON.stringify(hist.wikidata));
console.log(`fetch-dataset: ${hist.seasons.length} history seasons, ${drivers.length} drivers, ${venues.length} venues`);
