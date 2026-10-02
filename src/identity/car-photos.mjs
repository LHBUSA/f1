// Car-photo registry access + schema.org ImageObject (source-aware: credit, licence and acquire page come from the
// original photograph; never a PropBetEdge copyright).
import fs from 'node:fs';

export function loadCarPhotos() { return JSON.parse(fs.readFileSync('src/identity/car-photos.json', 'utf8')); }

// best approved photo for a constructor/season: same season first, never another season unless labelled
export function carPhotoFor(reg, constructorId, season, { includeCandidates = false } = {}) {
  const ok = (p) => p.constructorId === constructorId && (p.approvedForPublicUse || includeCandidates);
  return reg.photos.find((p) => ok(p) && p.season === season) || null;
}

export function imageObject(p, { site, publicPath }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ImageObject',
    contentUrl: `${site}${publicPath}`,
    name: `${p.season} ${p.constructorName}${p.carModel ? ` ${p.carModel}` : ''}`,
    caption: `${p.season} ${p.constructorName}${p.driverId ? ` (${p.event})` : ''}. ${p.attribution}.`,
    creator: { '@type': 'Person', name: p.photographer },
    creditText: `${p.photographer} / ${p.sourceName}`,
    license: p.licenseUrl,
    acquireLicensePage: p.sourceUrl,
    isBasedOn: p.sourceUrl,
    copyrightNotice: `${p.photographer}, ${p.license}`,
  };
}
