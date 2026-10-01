// Pure normalizer: raw ESPN documents → canonical F1 rows.
// Shared by the Node backfill and the f1-ingest Worker. No I/O here.
// Source truth only — nothing derived beyond parsing (times → ms, ids → slugs).

export const SESSION_TYPES = {
  FP1: 'fp1',
  FP2: 'fp2',
  FP3: 'fp3',
  Qual: 'qualifying',
  SS: 'sprint_qualifying',
  SR: 'sprint',
  Race: 'race',
};

export const SESSION_LABEL = {
  fp1: 'Practice 1',
  fp2: 'Practice 2',
  fp3: 'Practice 3',
  qualifying: 'Qualifying',
  sprint_qualifying: 'Sprint Qualifying',
  sprint: 'Sprint',
  race: 'Grand Prix',
};

// Title sponsors stripped from ESPN event names to get the championship name.
// Data-driven list: extend when scripts/normalize.mjs reports a name that still carries a sponsor.
const SPONSORS = [
  'Qatar Airways', 'Heineken Silver', 'Heineken', 'Gulf Air', 'Aramco', 'STC', 'Crypto.com', 'Lenovo', 'MSC Cruises', 'Pirelli',
  'Moët & Chandon', 'Moet & Chandon', 'AWS', 'Tag Heuer', 'TAG Heuer', 'Singapore Airlines', 'Etihad Airways', 'Louis Vuitton',
  'Formula 1', 'Rolex', 'Made in Italy', 'Ooredoo', 'Airtel', 'UBS', 'Shell', 'Santander', 'DHL', 'Johnnie Walker', 'Petronas',
  'VTB', 'Mubadala', 'Fly Emirates', 'Emirates', 'Socar', 'SOCAR', 'Allianz', 'Hisense', 'Telmex', 'ING', 'Etihad',
];

export function cleanEventName(name) {
  let n = (name || '').replace(/\s+(?:presented|powered)\s+by\s+.+$/i, '').trim();
  let changed = true;
  while (changed) {
    changed = false;
    for (const s of [...SPONSORS].sort((a, b) => b.length - a.length)) {
      const rest = n.slice(s.length + 1);
      if (n.startsWith(s + ' ') && /Grand Prix/.test(rest) && !/^Grand Prix/.test(rest)) {
        n = rest.trim();
        changed = true;
      }
    }
  }
  return n;
}

export function slugify(s) {
  return String(s || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** "1:23:06.801" | "1:18.518" | "58.123" | "+5.515" → ms; null for empty/zero placeholders. */
export function parseTimeMs(t) {
  if (t == null) return null;
  const s = String(t).trim().replace(/^\+/, '');
  if (!s || s === '0' || s === '.000' || s === '0.000' || /lap/i.test(s)) return null;
  const parts = s.split(':').map(Number);
  if (parts.some((p) => Number.isNaN(p))) return null;
  let ms = 0;
  for (const p of parts) ms = ms * 60 + p;
  ms = Math.round(ms * 1000);
  return ms > 0 ? ms : null;
}

export function statMap(statDoc) {
  const out = {};
  for (const cat of statDoc?.splits?.categories || []) {
    for (const s of cat.stats || []) out[s.name] = { v: s.value, d: s.displayValue };
  }
  return out;
}

const STATUS_MAP = {
  STATUS_CLASSIFIED: 'classified',
  STATUS_FINAL: 'classified',
  STATUS_RETIRED: 'retired',
  STATUS_DISQUALIFIED: 'disqualified',
  STATUS_DNS: 'did_not_start',
  STATUS_DID_NOT_START: 'did_not_start',
  STATUS_DNQ: 'did_not_qualify',
  STATUS_DID_NOT_QUALIFY: 'did_not_qualify',
  STATUS_DNPQ: 'did_not_prequalify',
  STATUS_EXCLUDED: 'excluded',
  STATUS_WITHDRAWN: 'withdrawn',
  STATUS_NOT_STARTED: 'did_not_start',
  STATUS_NOT_QUALIFIED: 'did_not_qualify',
  STATUS_DID_NOT_APPEAR: 'did_not_appear',
  STATUS_NOT_CLASSIFIED: 'not_classified',
  STATUS_FREE_PRACTICE: 'practice_only', // listed on the race entry because they drove a practice session only
};
// Race/sprint statuses meaning the car took the start.
export const STARTED_STATUSES = new Set(['classified', 'retired', 'disqualified', 'not_classified']);

export function normStatus(name) {
  if (!name) return null;
  return STATUS_MAP[name] || name.replace(/^STATUS_/, '').toLowerCase();
}

export function prov(url, capturedAt, sourceId, ingestedAt) {
  return {
    source: 'espn',
    source_id: String(sourceId),
    source_url: url,
    source_updated_at: null, // ESPN core documents carry no modification timestamp
    ingested_at: ingestedAt || capturedAt,
    captured_at: capturedAt,
  };
}

const sessionStateOf = (statusDoc) => {
  const t = statusDoc?.type;
  if (!t) return 'unknown';
  if (t.name === 'STATUS_CANCELED' || t.name === 'STATUS_POSTPONED') return t.name === 'STATUS_CANCELED' ? 'canceled' : 'postponed';
  if (t.state === 'post') return 'completed';
  if (t.state === 'in') return 'live';
  if (t.state === 'pre') return 'scheduled';
  return t.state || 'unknown';
};

/**
 * Normalize one event.
 * @param {object} ev    {url, capturedAt, data}
 * @param {function} lookup (url) → {url, capturedAt, data} | null  — returns cached sub-documents
 * @param {function} constructorOf (manufacturerName, season, teamColor) → constructor id
 */
export function normalizeEvent(ev, lookup, constructorOf, ingestedAt) {
  const e = ev.data;
  const season = Number(e.season?.$ref?.match(/seasons\/(\d{4})/)?.[1] || e.date.slice(0, 4));
  const venueId = e.venues?.[0]?.$ref?.match(/venues\/(\d+)/)?.[1] || null;
  const name = cleanEventName(e.name);
  const event = {
    id: `espn-${e.id}`,
    season,
    round: null, // assigned per season after cancellations are known
    name,
    official_name: e.name,
    short_name: e.shortName || null,
    slug: null,
    circuit_id: venueId ? `espn-venue-${venueId}` : null,
    start_utc: e.date,
    end_utc: e.endDate || null,
    status: 'unknown',
    format: 'conventional',
    sprint: false,
    session_ids: [],
    ...prov(ev.url, ev.capturedAt, e.id, ingestedAt),
  };
  const sessions = [];
  const results = [];
  const entries = [];
  for (const c of e.competitions || []) {
    const type = SESSION_TYPES[c.type?.abbreviation] || slugify(c.type?.text || 'session');
    const st = c.status?.$ref ? lookup(c.status.$ref) : null;
    const statusDoc = st?.data || c.status;
    const raceStats = c.statistics?.$ref ? lookup(c.statistics.$ref) : null;
    const rs = statMap(raceStats?.data ? { splits: raceStats.data } : null);
    const session = {
      id: `espn-${c.id}`,
      event_id: event.id,
      season,
      type,
      label: SESSION_LABEL[type] || c.type?.text,
      start_utc: c.date || null,
      time_valid: c.timeValid !== false,
      state: sessionStateOf(statusDoc),
      status_raw: statusDoc?.type?.name || null,
      flag: statusDoc?.flag || null,
      laps_scheduled: rs.laps?.v || null,
      distance_km: rs.length?.v || null,
      classified_count: 0,
      ...prov(c.$ref || ev.url, (st || ev).capturedAt, c.id, ingestedAt),
    };
    sessions.push(session);
    event.session_ids.push(session.id);
    if (type === 'sprint') {
      event.sprint = true;
      event.format = 'sprint';
    }
    for (const cp of c.competitors || []) {
      const aid = String(cp.id);
      const statsDoc = cp.statistics?.$ref ? lookup(cp.statistics.$ref) : null;
      const statusD = cp.status?.$ref ? lookup(cp.status.$ref) : null;
      const s = statMap(statsDoc?.data);
      const manu = cp.vehicle?.manufacturer || null;
      const constructorId = manu ? constructorOf(manu, season, cp.vehicle?.teamColor) : null;
      const pos = cp.order ?? (s.place?.v ? Number(s.place.v) : null);
      const statusName = statusD?.data?.type?.name || null;
      const isPointsSession = type === 'race' || type === 'sprint';
      const isQualiLike = type === 'qualifying' || type === 'sprint_qualifying';
      const timeText = s.totalTime?.d && s.totalTime.d !== '0' ? s.totalTime.d : null;
      const row = {
        id: `${session.id}-${aid}`,
        session_id: session.id,
        event_id: event.id,
        season,
        session_type: type,
        driver_id: `espn-${aid}`,
        constructor_id: constructorId,
        constructor_name_raw: manu,
        team_color: cp.vehicle?.teamColor || null,
        car_number: cp.vehicle?.number || null,
        position: pos || null,
        grid: isPointsSession ? (cp.startOrder || null) : null,
        status: normStatus(statusName),
        status_raw: statusName,
        status_text: statusD?.data?.type?.description || null,
        laps: s.lapsCompleted?.v ?? null,
        time_text: isPointsSession ? timeText : null,
        time_ms: isPointsSession ? parseTimeMs(timeText) : null,
        gap_text: s.behindTime?.d && s.behindTime.d !== '0' ? s.behindTime.d : null,
        gap_ms: parseTimeMs(s.behindTime?.d),
        behind_laps: s.behindLaps?.v || null,
        points: isPointsSession ? (s.championshipPts?.v ?? null) : null,
        laps_led: isPointsSession ? (s.lapsLead?.v ?? null) : null,
        pit_stops: isPointsSession && s.pitsTaken ? s.pitsTaken.v : null,
        fastest_lap_text: s.fastestLap?.d && s.fastestLap.d !== '0' ? s.fastestLap.d : null,
        fastest_lap_ms: parseTimeMs(s.fastestLap?.d),
        fastest_lap_number: s.fastestLapNum?.v || null,
        best_lap_ms: !isPointsSession ? parseTimeMs(timeText) : null,
        q1_ms: isQualiLike ? parseTimeMs(s.qual1TimeMS?.d) : null,
        q2_ms: isQualiLike ? parseTimeMs(s.qual2TimeMS?.d) : null,
        q3_ms: isQualiLike ? parseTimeMs(s.qual3TimeMS?.d) : null,
        winner: !!cp.winner,
        race_participant: isPointsSession ? normStatus(statusName) !== 'practice_only' : null,
        ...prov(cp.$ref || ev.url, (statsDoc || ev).capturedAt, `${c.id}/${aid}`, ingestedAt),
      };
      if (!statsDoc && !statusD) {
        // Entry list only (future/canceled session): an entry, not a classification.
        entries.push({ session_id: session.id, event_id: event.id, season, driver_id: row.driver_id, constructor_id: constructorId, car_number: row.car_number, constructor_name_raw: manu });
        continue;
      }
      results.push(row);
      if (row.status === 'classified') session.classified_count++;
    }
  }
  const states = sessions.map((s) => s.state);
  if (sessions.length && states.every((s) => s === 'canceled')) event.status = 'canceled';
  else if (states.some((s) => s === 'live')) event.status = 'live';
  else if (sessions.find((s) => s.type === 'race')?.state === 'completed') event.status = 'completed';
  else if (states.some((s) => s === 'completed')) event.status = 'in_progress';
  else event.status = 'scheduled';
  return { event, sessions, results, entries, venueRef: e.venues?.[0]?.$ref || null };
}

export function normalizeDriver(doc, ingestedAt) {
  const a = doc.data;
  const v = (a.vehicles || [])[0] || {};
  return {
    id: `espn-${a.id}`,
    espn_id: String(a.id),
    slug: a.slug || slugify(a.displayName || a.fullName),
    full_name: a.fullName || a.displayName,
    first_name: a.firstName || null,
    last_name: a.lastName || null,
    display_name: a.displayName || a.fullName,
    short_name: a.shortName || null,
    code: a.abbreviation || null,
    date_of_birth: a.dateOfBirth ? a.dateOfBirth.slice(0, 10) : null,
    nationality: a.flag?.alt || null,
    flag_url: a.flag?.href || null,
    headshot_url: a.headshot?.href || null,
    active: a.active ?? null,
    espn_team: v.team || null,
    espn_number: v.number || null,
    ...prov(doc.url, doc.capturedAt, a.id, ingestedAt),
  };
}

export function normalizeVenue(doc, ingestedAt) {
  const v = doc.data;
  return {
    id: `espn-venue-${v.id}`,
    espn_id: String(v.id),
    name: v.fullName,
    slug: slugify(v.fullName),
    locality: v.address?.city || null,
    country: v.address?.country || v.countryFlag?.alt || null,
    flag_url: v.countryFlag?.href || null,
    layout_type: v.shape || null, // ESPN "shape": Street / Road / Oval
    length_km: v.length || null,
    turns: v.turns || null,
    image_url: (v.images || []).find((i) => i.rel?.includes('day'))?.href || null,
    ...prov(doc.url, doc.capturedAt, v.id, ingestedAt),
  };
}
