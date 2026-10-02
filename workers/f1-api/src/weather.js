// Weekend forecasts (MET Norway Locationforecast 2.0, CC BY 4.0 — the licence credit travels with the payload).
const UA = 'PropBetEdge-F1/1.0 (+https://f1.propbetedge.ai)';

export async function forecast(geo, from, to, ctx) {
  const lat = Number(geo.lat).toFixed(3);
  const lon = Number(geo.lon).toFixed(3);
  const cacheKey = new Request(`https://f1-data-plane.internal/cache/weather/${lat},${lon}`);
  const cache = caches.default;
  let fc = await cache.match(cacheKey);
  if (!fc) {
    const r = await fetch(`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat}&lon=${lon}`, { headers: { 'User-Agent': UA } });
    if (!r.ok) return { days: [], note: 'forecast temporarily unavailable' };
    fc = new Response(await r.text(), { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' } });
    ctx.waitUntil(cache.put(cacheKey, fc.clone()));
  }
  const data = await fc.json();
  const days = {};
  for (const t of data.properties?.timeseries || []) {
    const d = t.time.slice(0, 10);
    if ((from && d < from) || (to && d > to)) continue;
    const det = t.data.instant.details;
    const x = (days[d] ||= { date: d, t_max: -99, t_min: 99, precip_mm: 0, wind_ms: 0, _h: new Set() });
    x.t_max = Math.max(x.t_max, det.air_temperature);
    x.t_min = Math.min(x.t_min, det.air_temperature);
    x.wind_ms = Math.max(x.wind_ms, det.wind_speed ?? 0);
    const p1 = t.data.next_1_hours?.details?.precipitation_amount;
    const p6 = t.data.next_6_hours?.details?.precipitation_amount;
    const hour = Number(t.time.slice(11, 13));
    if (p1 != null) { if (!x._h.has(hour)) { x.precip_mm += p1; x._h.add(hour); } }
    else if (p6 != null && hour % 6 === 0) { x.precip_mm += p6; for (let h = hour; h < hour + 6; h++) x._h.add(h); }
  }
  return {
    updated_at: data.properties?.meta?.updated_at || null,
    licence_credit: 'Forecast data: MET Norway, CC BY 4.0',
    days: Object.values(days).map(({ _h, ...d }) => ({ ...d, precip_mm: Math.round(d.precip_mm * 10) / 10 })),
  };
}
