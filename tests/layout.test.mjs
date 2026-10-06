// Responsive layout contract: two-column splits are decided by the space they have (container queries), splits
// holding tables need room for both tables, wide tables show a scroll affordance, multi-team cells wrap, and the
// driver profile never puts its two dense tables side by side. Browser proof: scripts/layout-audit.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync('src/web/styles.css', 'utf8');
const app = fs.readFileSync('src/web/app.js', 'utf8');
const pages = fs.readFileSync('scripts/site/pages.mjs', 'utf8');
const DIST = fs.existsSync('dist/drivers/fernando-alonso.html');

test('.split is never switched to two columns by a viewport media query', () => {
  for (const m of css.matchAll(/@media[^{]*\{((?:[^{}]*\{[^}]*\})*)\}/g)) assert.doesNotMatch(m[1], /(^|\})\.split(\.even)?\{grid-template-columns:[^}]*\s[^}]*\}/, `viewport-driven split: ${m[0].slice(0, 120)}`);
  assert.match(css, /:has\(>\.split\)\{container-type:inline-size\}/);
  assert.match(css, /@container \(min-width:900px\)\{\.split\{grid-template-columns:minmax\(0,1\.55fr\) minmax\(0,1fr\)\}\}/);
  assert.match(css, /@container \(max-width:1179\.98px\)\{\.split:has\(\.table-wrap\)\{grid-template-columns:minmax\(0,1fr\)\}\}/);
  assert.doesNotMatch(css, /\.split\.even\{grid-template-columns:1fr 1fr\}/, 'bare 1fr tracks cannot shrink below content');
});

test('wide tables get a visible affordance, never an invisible scroll', () => {
  for (const s of ['start', 'middle', 'end']) assert.match(css, new RegExp(`\\.table-wrap\\[data-scroll=${s}\\]\\{-webkit-mask-image:`));
  assert.match(app, /F1\.register\('tables'/);
  assert.match(app, /w\.dataset\.scroll = s/);
  assert.match(app, /classList\.add\('is-stacked'\)/);
  assert.match(css, /\.split\.is-stacked\{grid-template-columns:minmax\(0,1fr\)\}/);
});

test('multi-team / multi-driver cells wrap instead of widening the table', () => {
  assert.match(css, /td\.list\{white-space:normal;min-width:14ch\}/);
  assert.ok((pages.match(/<td class="list">\$\{t\.constructors\.map/g) || []).length >= 1);
  assert.match(pages, /<td class="list">\$\{teams\.map\(\(t\) => teamLink\(ctx, t\)\)/);
  assert.match(pages, /<td class="list">\$\{ds\.map\(/);
});

test('driver profile: Recent races and By season are separate full-width sections', { skip: !DIST && 'needs a build' }, () => {
  const h = fs.readFileSync('dist/drivers/fernando-alonso.html', 'utf8');
  const recent = h.indexOf('<h2>Recent races</h2>');
  const season = h.indexOf('<h2>By season</h2>');
  assert.ok(recent > 0 && season > recent);
  const between = h.slice(h.lastIndexOf('<section', recent), season);
  assert.doesNotMatch(between, /class="split/, 'the two tables must not share a split');
  assert.match(between, /<\/section>/, 'By season starts its own section');
});
