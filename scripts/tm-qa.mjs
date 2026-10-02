// Teammate qualifying gaps QA: every row's Ahead/Behind driver fully visible, no overlapping cells, logo inside its
// bounded slot with aspect preserved, no hidden horizontal content, no page overflow.
//   node scripts/tm-qa.mjs <base> <race path> [shot dir]     (Git Bash: MSYS_NO_PATHCONV=1)
import { chromium } from 'playwright';

const [base, path, out] = process.argv.slice(2);
const b = await chromium.launch();
let fail = 0;
for (const w of [390, 768, 1024, 1280, 1440, 1920]) {
  const pg = await b.newPage({ viewport: { width: w, height: 1000 } });
  await pg.goto(base + path, { waitUntil: 'networkidle' });
  const r = await pg.evaluate(() => {
    const card = document.querySelector('#teammate-gaps .card').getBoundingClientRect();
    const rows = [...document.querySelectorAll('.tm-row')];
    const issues = [];
    const inside = (e) => { const b = e.getBoundingClientRect(); return b.left >= card.left - 0.5 && b.right <= card.right + 0.5; };
    const ov = (x, y) => { const a = x.getBoundingClientRect(), c = y.getBoundingClientRect(); return a.left < c.right - 0.5 && c.left < a.right - 0.5 && a.top < c.bottom - 0.5 && c.top < a.bottom - 0.5; };
    for (const row of rows) {
      const team = row.querySelector('.tm-tname').textContent;
      const cells = ['.tm-team', '.tm-a', '.tm-gap', '.tm-b'].map((s) => row.querySelector(s));
      for (const n of row.querySelectorAll('.tm-name, .tm-tname, .tm-gap')) { if (n.scrollWidth > n.clientWidth + 1) issues.push(`${team}: clipped ${n.className}`); if (!inside(n)) issues.push(`${team}: outside card ${n.className}`); }
      for (let i = 0; i < cells.length; i++) for (let j = i + 1; j < cells.length; j++) if (ov(cells[i], cells[j])) issues.push(`${team}: overlap ${cells[i].className}/${cells[j].className}`);
      const img = row.querySelector('.tm-mark img');
      if (img) { const bb = img.getBoundingClientRect(); const ratio = img.naturalWidth / img.naturalHeight; if (bb.width > 40.5 || bb.height > 16.5) issues.push(`${team}: logo ${bb.width.toFixed(1)}x${bb.height.toFixed(1)}`); if (Math.abs(bb.width / bb.height - ratio) / ratio > 0.03) issues.push(`${team}: logo ratio`); if (!(img.complete && img.naturalWidth)) issues.push(`${team}: logo not loaded`); if (ov(img, row.querySelector('.tm-tname'))) issues.push(`${team}: logo overlaps name`); }
    }
    const wraps = [...document.querySelectorAll('#teammate-gaps .table-wrap')].length;
    return { rows: rows.length, issues, tableWraps: wraps, pageOverflow: document.documentElement.scrollWidth > innerWidth };
  });
  const bad = r.rows < 10 || r.issues.length || r.pageOverflow;
  if (bad) fail++;
  console.log(`${bad ? 'FAIL' : 'ok  '} ${w} rows=${r.rows} overflow=${r.pageOverflow} ${r.issues.slice(0, 6).join(' | ')}`);
  if (out && (w === 768 || w === 1024)) for (const t of ['Red Bull Racing', 'Racing Bulls']) {
    const row = pg.locator('.tm-row', { has: pg.locator('.tm-tname', { hasText: new RegExp(`^${t}$`) }) });
    if (await row.count()) await row.first().screenshot({ path: `${out}/${t.replace(/ /g, '-').toLowerCase()}-${w}.png` });
  }
  if (out) await (await pg.$('#teammate-gaps .card')).screenshot({ path: `${out}/tm-${w}.png` });
  await pg.close();
}
await b.close();
console.log(fail ? `TEAMMATE GAPS QA FAIL (${fail})` : 'TEAMMATE GAPS QA PASS');
process.exit(fail ? 1 : 0);
