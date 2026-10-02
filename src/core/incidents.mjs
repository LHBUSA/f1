// Incident Intelligence event model (taxonomy f1-incidents@1). Shared by the data plane and PBEcast.
//
// An event records what a source OBSERVED. It never assigns cause, blame, damage or failure: a retirement is not an
// accident, a pit stop is not damage, and a flag is not an incident report. Types the current sources cannot observe
// are part of the taxonomy (so replay/UI can carry them later) but are never produced from inference.
export const INCIDENT_TAXONOMY_VERSION = 'f1-incidents@1';

export const INCIDENT_TYPES = Object.freeze({
  // observable from our recorded timing lane today
  retirement: { severity: 'high', lane: 'timing', free: true },
  dsq: { severity: 'high', lane: 'timing', free: true },
  dns: { severity: 'high', lane: 'timing', free: true },
  dnf: { severity: 'high', lane: 'classification', free: true },
  yellow_flag: { severity: 'medium', lane: 'timing_flag', free: true },
  safety_car: { severity: 'critical', lane: 'timing_flag', free: true },
  virtual_safety_car: { severity: 'medium', lane: 'timing_flag', free: true },
  red_flag: { severity: 'critical', lane: 'timing_flag', free: true },
  // modelled, held: no source lane we are allowed to use reports these
  collision: { severity: 'high', lane: 'race_control', held: true },
  contact: { severity: 'high', lane: 'race_control', held: true },
  spin: { severity: 'medium', lane: 'race_control', held: true },
  off_track: { severity: 'medium', lane: 'race_control', held: true },
  stopped_car: { severity: 'high', lane: 'race_control', held: true },
  puncture: { severity: 'high', lane: 'race_control', held: true },
  mechanical: { severity: 'high', lane: 'race_control', held: true },
  penalty: { severity: 'high', lane: 'race_control', held: true },
  investigation: { severity: 'medium', lane: 'race_control', held: true },
  noted: { severity: 'low', lane: 'race_control', held: true },
  pit_after_incident: { severity: 'medium', lane: 'race_control', held: true },
});
export const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low'];

// flag strings as the timing source publishes them -> race-state type (unknown strings are kept, never guessed)
const FLAG_STATE = { YELLOW: 'yellow_flag', DOUBLE_YELLOW: 'yellow_flag', SC: 'safety_car', SAFETY_CAR: 'safety_car', SAFETYCAR: 'safety_car', VSC: 'virtual_safety_car', VIRTUAL_SAFETY_CAR: 'virtual_safety_car', RED: 'red_flag', RED_FLAG: 'red_flag' };

export function incidentEvent(e) {
  return {
    event_id: e.event_id, taxonomy: INCIDENT_TAXONOMY_VERSION, session_id: e.session_id ?? null, type: e.type,
    severity: INCIDENT_TYPES[e.type]?.severity || 'low', status: e.status || 'observed',
    t: e.t, lap: e.lap ?? null, turn: null, sector: null, location: null, // never guessed
    driver_ids: e.driver_ids || [], constructor_ids: e.constructor_ids || [],
    race_control_message: null, summary: e.summary, consequence: e.consequence || null,
    source: e.source, confidence: e.confidence || 'observed', free: INCIDENT_TYPES[e.type]?.free === true,
  };
}

// frames (normalized, oldest first) -> observed race-state events. Deterministic: same frames, same events.
export function deriveIncidents(frames, { sessionId = null, teamOf = () => null } = {}) {
  const out = [];
  let prevFlag = null;
  const seenStatus = new Map();
  frames.forEach((f, i) => {
    const flag = f.flag ? String(f.flag).toUpperCase().replace(/[\s-]+/g, '_') : null;
    if (i > 0 && flag !== prevFlag) {
      const type = FLAG_STATE[flag];
      const was = FLAG_STATE[prevFlag];
      if (type) out.push(incidentEvent({ event_id: `${sessionId}:flag:${f.t}`, session_id: sessionId, type, status: 'active', t: f.t, lap: f.lap, summary: `${type.replace(/_/g, ' ')} shown`, source: 'recorded timing (session flag)' }));
      if (was && !type) out.push(incidentEvent({ event_id: `${sessionId}:flagend:${f.t}`, session_id: sessionId, type: was, status: 'cleared', t: f.t, lap: f.lap, summary: `${was.replace(/_/g, ' ')} cleared${flag ? ` (${flag.toLowerCase()})` : ''}`, source: 'recorded timing (session flag)' }));
    }
    prevFlag = flag;
    for (const c of f.cars) {
      const before = seenStatus.get(c.id);
      if (before && before !== c.status && ['retired', 'disqualified', 'dns'].includes(c.status)) {
        const type = c.status === 'retired' ? 'retirement' : c.status === 'disqualified' ? 'dsq' : 'dns';
        out.push(incidentEvent({ event_id: `${sessionId}:${type}:${c.id}`, session_id: sessionId, type, t: f.t, lap: f.lap, driver_ids: [c.id], constructor_ids: [teamOf(c.id)].filter(Boolean), summary: type === 'retirement' ? 'Retired' : type === 'dsq' ? 'Disqualified' : 'Did not start', consequence: type === 'retirement' && c.laps != null ? `out after ${c.laps} laps` : null, source: 'recorded timing (car status)' }));
      }
      if (c.status) seenStatus.set(c.id, c.status);
    }
  });
  // de-duplicate by id (a status can flicker in the source; the first observation wins)
  const seen = new Set();
  return out.filter((e) => (seen.has(e.event_id) ? false : (seen.add(e.event_id), true)));
}
