// WCAG 2.1 contrast audit of the F1 dark-mode tokens + team-tinted labels against the real surfaces.
//   node scripts/contrast-audit.mjs [--json]
import fs from 'node:fs';

const css = fs.readFileSync('src/web/styles.css', 'utf8');
const root = css.slice(css.indexOf(':root{'), css.indexOf('}', css.indexOf(':root{')));
const tok = Object.fromEntries([...root.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2].toLowerCase()]));
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lum = (h) => { const [r, g, b] = hex(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const mix = (a, b, wa) => '#' + hex(a).map((v, i) => Math.round(v * wa + hex(b)[i] * (1 - wa)).toString(16).padStart(2, '0')).join('');

const surfaces = ['bg', 'bg2', 'panel', 'panel2', 'panel3'].filter((s) => tok[s]);
const rows = [];
// text tokens >= 4.5:1; interactive-control boundary >= 3:1 (WCAG 1.4.11). --line/--line2 are decorative dividers.
const need = { ink: 4.5, ink2: 4.5, muted: 4.5, faint: 4.5, accent: 4.5, accent2: 4.5, cyan: 4.5, green: 4.5, gold: 4.5, live: 4.5, 'ctl-line': 3 };
for (const [t, min] of Object.entries(need)) if (tok[t]) {
  const worst = Math.min(...surfaces.map((s) => ratio(tok[t], tok[s])));
  rows.push({ token: `--${t}`, value: tok[t], min, worst: +worst.toFixed(2), pass: worst >= min });
}
// team-tinted labels: color-mix(in srgb, var(--tc) P%, #fff) on panel surfaces, for every team colour class in CSS
const built = fs.readdirSync('dist/assets').find((f) => /^app.[0-9a-f]+.css$/.test(f));
const bcss = built ? fs.readFileSync('dist/assets/' + built, 'utf8') : css;
const teams = [...new Set([...bcss.matchAll(/\.tc-([0-9a-f]{6})\{/g)].map((m) => '#' + m[1]))];
const tinted = (p) => teams.map((c) => ({ team: c, p, worst: +Math.min(...surfaces.map((s) => ratio(mix(c, '#ffffff', p / 100), tok[s]))).toFixed(2) }));
const t60 = tinted(55), t55 = tinted(55); // site uses 55% for team-tinted text
const out = { tokens: rows, tinted60_min: Math.min(...t60.map((x) => x.worst)), tinted60_fails: t60.filter((x) => x.worst < 4.5), tinted55_min: Math.min(...t55.map((x) => x.worst)), teams: teams.length };
if (process.argv.includes('--json')) console.log(JSON.stringify(out, null, 2));
else {
  for (const r of rows) console.log(`${r.pass ? 'ok  ' : 'FAIL'} ${r.token.padEnd(10)} ${r.value}  worst ${r.worst}:1 (min ${r.min})`);
  console.log(`team-tinted labels (55% team + white): worst ${out.tinted60_min}:1 over ${teams.length} team colours; fails: ${out.tinted60_fails.map((x) => x.team).join(', ') || 'none'}`);
}
process.exitCode = rows.every((r) => r.pass) && !out.tinted60_fails.length ? 0 : 1;
