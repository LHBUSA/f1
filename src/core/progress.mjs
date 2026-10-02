// PBEcast race-progress model (f1-progress@1). Pure and deterministic: same frames + same time = same positions.
//
// Input: normalized frames (oldest first) [{ t, lap, state, flag, cars: [{ id, pos, status, laps }] }].
// A car's position on track is DERIVED from timing observations, never from GPS:
//   * a crossing of the timing line is the first frame in which the car's completed-lap count went up
//     (its time is the observation time; the uncertainty is the gap to the previous frame);
//   * between two observed crossings (replay), the car is placed in proportion to the elapsed time;
//   * after its last observed crossing (live), it is extrapolated with its own median recent lap time, capped below the
//     line (MAX_FRACTION) until the next crossing is actually observed;
//   * with no lap-time estimate yet (opening lap) or across a recording gap, it is held at its last observed point and
//     flagged, never moved on a guess. Retired / disqualified cars leave the track from the frame that says so.
export const PROGRESS_VERSION = 'f1-progress@1';
export const MAX_FRACTION = 0.97;
export const GAP_MS = 60_000; // a silence longer than this is a recording gap
export const LONG_INTERVAL = 1.6; // × median lap: beyond this the car was in the pits/garage

const ts = (x) => (typeof x === 'number' ? x : Date.parse(x));
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

export function buildModel(frames) {
  const F = frames.map((f) => ({ ...f, ms: ts(f.t) })).sort((a, b) => a.ms - b.ms);
  const cars = new Map();
  const gaps = [];
  for (let i = 0; i < F.length; i++) {
    const f = F[i], prev = F[i - 1];
    if (prev && f.ms - prev.ms > GAP_MS) gaps.push({ from: prev.ms, to: f.ms });
    for (const c of f.cars) {
      if (!c.id) continue;
      let m = cars.get(c.id);
      if (!m) { m = { id: c.id, crossings: [], outAt: null, firstLaps: c.laps, firstMs: f.ms, last: null }; cars.set(c.id, m); }
      if (c.laps != null && m.last?.laps != null && c.laps > m.last.laps) {
        const span = c.laps - m.last.laps;
        // more than one lap between frames means frames are missing: spread the crossings across the silence and mark them
        for (let k = 1; k <= span; k++) m.crossings.push({ lap: m.last.laps + k, ms: span === 1 ? f.ms : prev.ms + ((f.ms - prev.ms) * k) / span, uncertainty_ms: f.ms - (prev?.ms ?? f.ms), inferred_gap: span > 1 });
      }
      if (m.outAt == null && ['retired', 'disqualified', 'dns', 'not_classified'].includes(c.status)) m.outAt = f.ms;
      m.last = { laps: c.laps, pos: c.pos, status: c.status, ms: f.ms };
    }
  }
  return { frames: F, cars, gaps, start: F[0]?.ms ?? null, end: F.at(-1)?.ms ?? null, version: PROGRESS_VERSION };
}

// frame in force at time T (the latest observed state, never a future one)
export function frameAt(model, T) {
  const F = model.frames;
  let lo = 0, hi = F.length - 1, ans = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (F[mid].ms <= T) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
  return ans >= 0 ? F[ans] : null;
}

export function inGap(model, T) { return model.gaps.some((g) => T > g.from && T < g.to); }

// progress in laps (e.g. 12.43) for one car at time T, or null when the car cannot be placed
export function progressAt(model, id, T, { live = false } = {}) {
  const m = model.cars.get(id);
  if (!m) return null;
  if (m.outAt != null && T >= m.outAt) return { state: 'out', laps: null };
  const xs = m.crossings;
  const before = [...xs].reverse().find((c) => c.ms <= T);
  const after = xs.find((c) => c.ms > T);
  if (!before) return { state: 'unplaced', laps: null, reason: 'no line crossing observed yet' };
  if (inGap(model, T)) return { state: 'held', laps: before.lap, reason: 'recording gap' };
  const lapMsAll = median(xs.map((c, i) => (i ? c.ms - xs[i - 1].ms : null)).filter((d) => d && d > 20_000 && d < 400_000));
  if (after && !live) {
    // a crossing interval far longer than the car's usual lap means pit/garage time (practice, qualifying, long stops):
    // the car's whereabouts are unknown, so it is not drawn rather than crawled around the lap
    if (lapMsAll && (after.ms - before.ms) / (after.lap - before.lap) > LONG_INTERVAL * lapMsAll) return { state: 'unplaced', laps: null, reason: 'long interval (pit or garage)' };
    // replay: between two observed crossings
    const frac = (T - before.ms) / (after.ms - before.ms);
    return { state: 'derived', laps: before.lap + Math.min(frac * (after.lap - before.lap), (after.lap - before.lap)), basis: 'between observed crossings' };
  }
  // live (or after the final crossing): extrapolate with the car's own recent lap time
  const recent = xs.slice(-4).map((c, i, a) => (i ? c.ms - a[i - 1].ms : null)).filter((d) => d && !xs.slice(-4)[0].inferred_gap);
  const lapMs = median(recent.filter((d) => d > 20_000 && d < 400_000));
  if (!lapMs) return { state: 'held', laps: before.lap, reason: 'no lap-time estimate yet' };
  if ((T - before.ms) > LONG_INTERVAL * lapMs) return { state: 'unplaced', laps: null, reason: 'overdue at the line (pit or garage)' };
  const frac = Math.min((T - before.ms) / lapMs, MAX_FRACTION);
  return { state: 'derived', laps: before.lap + frac, basis: 'extrapolated from own recent lap time', lap_ms: lapMs };
}

// position history for the graph: each car's classified order at the frame where it completed each lap
export function positionHistory(model) {
  const out = {};
  for (const [id, m] of model.cars) {
    out[id] = m.crossings.map((c) => { const f = frameAt(model, c.ms); const car = f?.cars.find((x) => x.id === id); return car?.pos ? { lap: c.lap, pos: car.pos } : null; }).filter(Boolean);
  }
  return out;
}

// leader lap at time T (from the frame in force; the session's own lap counter)
export function lapAt(model, T) { return frameAt(model, T)?.lap ?? null; }
