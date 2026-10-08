// Kalshi PERPETUALS partner offer (contract kalshi-partner/2) — ONE footer module per page.
// A commercial partner block in the network footer only: never on race/PBEcast intelligence, Race Lab, DNA, matchup or
// Kalshi market components, and never a model input. Copy, economics and the link all come from the vendored canonical
// client (src/vendor/kalshi/kalshi-partner.js, unchanged); config is read through the same-origin rewrite
// /go/kalshi-perps/config (vercel.json, so the CSP needs nothing new). Disabled / failed config renders nothing.
// The footer survives soft navigation (nav.js swaps <main> only), so this mounts once per document.
import { loadPartnerConfig, partnerOffer } from './kalshi-partner.js';

export const PARTNER_CONFIG_URL = '/go/kalshi-perps/config';
export const PARTNER_CTX = Object.freeze({ placement: 'sport_footer', product: 'f1', sport: 'f1' });

export function mountKalshiPartnerFooter(doc = document) {
  const slot = doc.querySelector('#f1-kxo');
  if (!slot || slot.dataset.kxoMounted) return Promise.resolve(false);
  slot.dataset.kxoMounted = '1';
  return loadPartnerConfig(PARTNER_CONFIG_URL)
    .then((cfg) => {
      if (doc.querySelector('.kxo')) return false; // exactly one offer per page
      const html = partnerOffer(cfg, PARTNER_CTX, { variant: 'footer' });
      if (!html) return false;
      slot.innerHTML = html;
      slot.hidden = false;
      return true;
    })
    .catch(() => false);
}

if (typeof document !== 'undefined') mountKalshiPartnerFooter();
