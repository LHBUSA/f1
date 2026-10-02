// 1200x630 social card for an article (also the article's hero image). Dark carbon + red telemetry, the class label,
// the headline, the event line, and the lead driver's headshot (from the PropSports media proxy) with a team-colour ring.
import fs from 'node:fs';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';

const FONTS = ['BarlowCondensed-ExtraBold.ttf', 'BarlowCondensed-SemiBold.ttf', 'Barlow-Medium.ttf'].map((f) => path.resolve('assets-src/fonts', f));
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// greedy wrap by an approximate glyph width for Barlow Condensed ExtraBold uppercase (0.47 em)
export function wrap(text, size, width, maxLines) {
  const words = text.toUpperCase().split(/\s+/);
  const lines = [];
  let cur = '';
  const fits = (s) => s.length * size * 0.47 <= width;
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (fits(t)) cur = t;
    else { if (cur) lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) { const keep = lines.slice(0, maxLines); keep[maxLines - 1] = keep[maxLines - 1].replace(/\s+\S+$/, '') + '…'; return keep; }
  return lines;
}

export function cardSvg({ label, headline, sub, color = 'ff4d2e', headshot = null }) {
  let size = 78, lines = wrap(headline, size, headshot ? 700 : 940, 3);
  if (lines.length === 3) { size = 66; lines = wrap(headline, size, headshot ? 720 : 960, 3); }
  const y0 = 300 - ((lines.length - 1) * size * 0.98) / 2;
  const hs = headshot ? `<defs><clipPath id="hc"><circle cx="1010" cy="300" r="138"/></clipPath></defs><circle cx="1010" cy="300" r="150" fill="#0e1118"/><image href="${headshot}" x="872" y="162" width="276" height="276" clip-path="url(#hc)" preserveAspectRatio="xMidYMin slice"/><circle cx="1010" cy="300" r="146" fill="none" stroke="#${esc(color)}" stroke-width="8"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1200" height="630" viewBox="0 0 1200 630">
<defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#ff4d2e" stop-opacity=".22"/><stop offset=".55" stop-color="#06070a" stop-opacity="0"/></linearGradient>
<pattern id="cf" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="#08090d"/><rect width="4" height="8" fill="#0b0d12"/></pattern></defs>
<rect width="1200" height="630" fill="url(#cf)"/><rect width="1200" height="630" fill="url(#g)"/>
<path d="M0 560 L420 560 L470 520 L1200 520" stroke="#ff4d2e" stroke-width="3" fill="none" opacity=".75"/><path d="M0 572 L430 572 L480 532 L1200 532" stroke="#ff7a45" stroke-width="1.5" fill="none" opacity=".45"/>
<rect x="64" y="${y0 - size * 0.86}" width="10" height="${lines.length * size * 0.98 - size * 0.12}" fill="#${esc(color)}"/>
<text x="64" y="96" font-family="Barlow Condensed" font-weight="800" font-size="30" letter-spacing="5" fill="#c6ccd9">PROPBETEDGE <tspan fill="#ff4d2e">F1</tspan></text>
<text x="64" y="${y0 - size * 1.15}" font-family="Barlow Condensed" font-weight="600" font-size="28" letter-spacing="4" fill="#ff7a45">${esc(label.toUpperCase())}</text>
${lines.map((l, i) => `<text x="96" y="${(y0 + i * size * 0.98).toFixed(1)}" font-family="Barlow Condensed" font-weight="800" font-size="${size}" fill="#ffffff">${esc(l)}</text>`).join('\n')}
<text x="64" y="612" font-family="Barlow" font-weight="500" font-size="26" fill="#9aa1b2">${esc(sub)}</text>
${hs}
</svg>`;
}

export function renderCard(svg) {
  const r = new Resvg(svg, { font: { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: 'Barlow Condensed' }, fitTo: { mode: 'width', value: 1200 } });
  return r.render().asPng();
}

// headshot as a data URI, cached on disk (the media proxy is the only image source the site may use)
export async function headshotData(driverId, { base, cacheDir }) {
  const f = path.join(cacheDir, `${driverId}.img`);
  let buf = null, type = 'image/png';
  if (fs.existsSync(f)) { const raw = fs.readFileSync(f); type = raw.subarray(0, 4).toString('hex') === '89504e47' ? 'image/png' : 'image/jpeg'; buf = raw; }
  else {
    const r = await fetch(`${base}/media/headshot/${driverId}`).catch(() => null);
    if (!r?.ok || !(r.headers.get('content-type') || '').startsWith('image/')) return null;
    buf = Buffer.from(await r.arrayBuffer());
    type = r.headers.get('content-type');
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(f, buf);
  }
  if (!/png|jpe?g/.test(type)) return null;
  return `data:${type};base64,${buf.toString('base64')}`;
}
