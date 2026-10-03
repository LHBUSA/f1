// Temporal frame for newsroom stories. Four different times, never interchangeable:
//   event/session time   — when the qualifying/race/weekend happened (projection sessions, UTC)
//   publication time     — when the story was FIRST published (frozen in the live news index; never backdated)
//   frame time (as_of)   — the moment the copy is written from = the first publication; tense follows the race state
//                          at that moment, so a story's wording never drifts with later rebuilds
//   build time           — when this build ran; used only for gates (stale previews), never in copy
// A story first published after the session it describes is an ARCHIVE story: retrospective copy, labelled, and kept out
// of Google News (news sitemap: session must be within 72h of publication).
//
// Timezone policy: every source timestamp stays UTC. A date-only editorial fact ("the race was held on 21 November")
// is the VENUE-LOCAL calendar day of the session (src/core/circuit-tz.json), because the UTC day can differ (Las Vegas
// races start 04:00 UTC Sunday = Saturday night local). Unknown venue -> UTC day. Reader-facing session schedules are
// localized in the browser (app.js fmtLocal).
import fs from 'node:fs';

const TZ = JSON.parse(fs.readFileSync(new URL('../core/circuit-tz.json', import.meta.url), 'utf8')).zones;
export const venueTz = (circuitId) => TZ[circuitId] || 'UTC';
/** "21 November 2026": the calendar date of `iso` at the venue. */
export const venueDay = (iso, circuitId) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: venueTz(circuitId) }) : null);
/** YYYY-MM-DD at the venue. */
export const venueIsoDay = (iso, circuitId) => (iso ? new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: venueTz(circuitId) }).format(new Date(iso)) : null);

// The race session has no published end time. A Grand Prix is capped at 3 hours of elapsed time (incl. suspensions);
// the live window adds one hour of margin for the classification to publish.
export const RACE_WINDOW_MS = 4 * 3600e3;
// News freshness used by the Google News sitemap: a story about a session more than 72h before its first publication
// is an archive backfill.
export const ARCHIVE_AFTER_MS = 72 * 3600e3;

const t = (iso) => (iso ? Date.parse(iso) : NaN);

/** State of the race at instant `at` (ISO). */
export function raceStateAt(ev, race, at) {
  if (!ev) return null;
  if (ev.status === 'canceled' || race?.state === 'canceled') return 'cancelled';
  if (!race?.start_utc) return null;
  const now = t(at), start = t(race.start_utc);
  if (now < start) return 'upcoming';
  if (now < start + RACE_WINDOW_MS) return 'live';
  return 'completed';
}

/**
 * Temporal frame for one story. `publishedAt` = the frozen first-publication time (or this build's time for a first
 * publication). Pure: same inputs, same frame (it is part of the packet hash).
 */
export function temporalFrame(X, eventId, cls, publishedAt) {
  const ev = X.event[eventId];
  const q = X.session(eventId, 'qualifying'), race = X.session(eventId, 'race');
  const sessions = (ev?.sessions || []).filter((s) => s.start_utc).map((s) => s.start_utc).sort();
  const subject = cls === 'qualifying' ? q?.start_utc : cls === 'race_final' ? race?.start_utc : null;
  const frame = {
    as_of: publishedAt,
    event_start: sessions[0] || ev?.start_utc || null,
    event_end: race?.start_utc ? new Date(t(race.start_utc) + RACE_WINDOW_MS).toISOString() : ev?.end_utc || null,
    qualifying_start: q?.start_utc || null,
    race_start: race?.start_utc || null,
    race_end: race?.start_utc ? new Date(t(race.start_utc) + RACE_WINDOW_MS).toISOString() : null,
    race_state: raceStateAt(ev, race, publishedAt),
    // qualifying: first published once the race had already started; race final: >72h after the race
    archive_backfill: cls === 'preview' ? false
      : cls === 'qualifying' ? !!race?.start_utc && t(publishedAt) >= t(race.start_utc)
      : !!subject && t(publishedAt) - t(subject) > ARCHIVE_AFTER_MS,
  };
  return frame;
}

/** Next event strictly after `afterIso` in calendar order (never by today's status: the answer must not drift). */
export function nextEventAfter(X, afterIso) {
  return X.allEvents.find((e) => e.status !== 'canceled' && e.start_utc > afterIso) || null;
}

/** Calendar day (UTC) of an ISO instant, as YYYY-MM-DD. */
export const utcDay = (iso) => new Date(iso).toISOString().slice(0, 10);

/** Archive classification of a story at build time `now` (display only; never changes the copy's frame). */
export function archiveKind(cls, tf, now) {
  if (!tf) return null;
  if (tf.archive_backfill) return 'backfill';
  if (cls === 'preview' && tf.race_start && Date.parse(tf.race_start) <= Date.parse(now)) return 'expired_preview';
  return null;
}
