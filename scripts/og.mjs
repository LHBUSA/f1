// Renders public/og.png (1200x630) from an SVG using the bundled Barlow Condensed font.
import fs from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#ff4d2e" stop-opacity=".35"/><stop offset=".6" stop-color="#06070a" stop-opacity="0"/></linearGradient></defs>
<rect width="1200" height="630" fill="#06070a"/><rect width="1200" height="630" fill="url(#g)"/>
<g transform="skewX(-18)"><rect x="1060" y="0" width="60" height="630" fill="#ff4d2e" opacity=".9"/><rect x="1140" y="0" width="22" height="630" fill="#ff7a45" opacity=".8"/><rect x="1180" y="0" width="8" height="630" fill="#fff" opacity=".7"/></g>
<text x="80" y="250" font-family="Barlow Condensed" font-weight="800" font-size="64" fill="#c6ccd9" letter-spacing="6">PROPBETEDGE</text>
<text x="80" y="420" font-family="Barlow Condensed" font-weight="800" font-size="200" fill="#ffffff">F1</text>
<text x="80" y="500" font-family="Barlow Condensed" font-weight="600" font-size="34" fill="#ff7a45" letter-spacing="2">DRIVER DNA · CIRCUIT FIT · TEAMMATE BATTLES</text>
</svg>`;
const r = new Resvg(svg, { font: { fontFiles: ['node_modules/@fontsource/barlow-condensed/files/barlow-condensed-latin-800-normal.woff2','node_modules/@fontsource/barlow-condensed/files/barlow-condensed-latin-600-normal.woff2'].filter(() => false), loadSystemFonts: true, defaultFontFamily: 'Arial' } });
fs.writeFileSync('public/og.png', r.render().asPng());
console.log('og.png written');
