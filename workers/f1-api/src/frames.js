// Recorded observation frames -> public, normalized frames (public driver ids, normalized status, parsed timing).
// FREE frames carry only what the free tier shows (order, laps, status); FULL frames add gaps, pits and best laps.
const STATUS = { STATUS_CLASSIFIED: 'running', STATUS_IN_PROGRESS: 'running', STATUS_FINAL: 'running', STATUS_RETIRED: 'retired', STATUS_DISQUALIFIED: 'disqualified', STATUS_DID_NOT_START: 'dns', STATUS_NOT_CLASSIFIED: 'not_classified', STATUS_FREE_PRACTICE: 'running', STATUS_SCHEDULED: 'scheduled' };
export const SESSION_TYPE = { FP1: 'fp1', FP2: 'fp2', FP3: 'fp3', Qual: 'qualifying', SS: 'sprint-qualifying', SR: 'sprint', Race: 'race' };
const num = (s) => { const v = Number(String(s ?? '').replace(/[^0-9.\-]/g, '')); return Number.isFinite(v) && String(s ?? '').trim() !== '' ? v : null; };
const timeMs = (s) => { if (!s || !/\d/.test(s)) return null; const p = String(s).replace(/^\+/, '').split(':').map(Number); if (p.some((x) => !Number.isFinite(x))) return null; let v = 0; for (const x of p) v = v * 60 + x; return Math.round(v * 1000); };

export function sessionPublicId(meta, internal) {
  const slug = internal?.event_by_upstream?.[String(meta?.event_id)] || null;
  const type = SESSION_TYPE[meta?.type] || null;
  return slug && type ? `${slug}-${type}` : null;
}

export function normalizeFrames(frames, internal, { full = false } = {}) {
  const map = internal?.driver_by_upstream || {};
  return frames.map((f) => ({
    t: f.t,
    state: f.state,
    lap: f.lap ?? null,
    flag: f.flag || null,
    clock: f.clock || null,
    cars: (f.cars || []).map(([uid, pos, status, v]) => {
      const d = map[uid];
      const c = { id: d?.id || null, pos: pos ?? null, status: STATUS[status] || (status ? String(status).replace(/^STATUS_/, '').toLowerCase() : null), laps: num(v?.lapsCompleted) };
      if (full) {
        c.gap_ms = timeMs(v?.behindTime);
        c.gap_laps = num(v?.behindLaps);
        c.pits = num(v?.pitsTaken);
        c.best_ms = timeMs(v?.fastestLap);
      }
      return c;
    }).filter((c) => c.id),
  }));
}

// recorded-session index entry -> coverage summary (frames, span, longest silence) so gaps are visible, not hidden
export function coverage(frames) {
  if (!frames.length) return { frames: 0 };
  let maxGap = 0, gaps = 0;
  for (let i = 1; i < frames.length; i++) { const g = Date.parse(frames[i].t) - Date.parse(frames[i - 1].t); if (g > maxGap) maxGap = g; if (g > 60000) gaps++; }
  return { frames: frames.length, first_t: frames[0].t, last_t: frames.at(-1).t, longest_silence_s: Math.round(maxGap / 1000), silences_over_60s: gaps };
}
