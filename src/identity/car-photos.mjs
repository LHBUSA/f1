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
    // a model name that already carries the constructor ("Jaguar R5") is not prefixed twice
    name: p.carModel?.startsWith(p.constructorName) ? `${p.season} ${p.carModel}` : `${p.season} ${p.constructorName}${p.carModel ? ` ${p.carModel}` : ''}`,
    // historical cars: say where the photograph was taken (museum, demonstration run), never imply the race itself
    caption: p.historical ? `${p.season} ${p.carModel || p.constructorName}, photographed at ${p.event}. ${p.attribution}.` : `${p.season} ${p.constructorName}${p.driverId ? ` (${p.event})` : ''}. ${p.attribution}.`,
    creator: { '@type': 'Person', name: p.photographer },
    creditText: `${p.photographer} / ${p.sourceName}`,
    license: p.licenseUrl,
    acquireLicensePage: p.sourceUrl,
    isBasedOn: p.sourceUrl,
    copyrightNotice: `${p.photographer}, ${p.license}`,
  };
}
