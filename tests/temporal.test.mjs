// Temporal semantics: event time vs first-publication time vs build time. Every case passes an explicit instant —
// nothing here reads the wall clock. Fixtures 1-10 follow the newsroom/date audit brief.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { raceStateAt, temporalFrame, nextEventAfter, venueDay, venueIsoDay, archiveKind, RACE_WINDOW_MS } from '../src/news/temporal.mjs';
import { sessionsAhead, statusPill } from '../scripts/site/components.mjs';

const HAVE = fs.existsSync('data/projection/events-2026.json');
const load = async () => (await import('../src/news/data.mjs')).loadProjection();
const prose = async (draft, P) => { const { render } = await import('../src/news/validate.mjs'); return draft.sections.flatMap((s) => [s.heading, ...(s.paragraphs || [])]).map((p) => render(p, P)).join('\n'); };

const SPAIN = '2026-spanish-grand-prix'; // qualifying 2026-09-12T14:00Z, race 2026-09-13T13:00Z, next round Azerbaijan
const FUTURE_TENSE = /race starts on|follows (the session|it|the race) live|is underway/i;

// ---------- pure helpers ----------
test('race state at an instant: upcoming / live / completed / cancelled', () => {
  const ev = { status: 'scheduled' }, race = { start_utc: '2026-09-13T13:00Z' };
  assert.equal(raceStateAt(ev, race, '2026-09-13T12:59:59Z'), 'upcoming');
  assert.equal(raceStateAt(ev, race, '2026-09-13T13:00Z'), 'live');
  assert.equal(raceStateAt(ev, race, new Date(Date.parse(race.start_utc) + RACE_WINDOW_MS - 1).toISOString()), 'live');
  assert.equal(raceStateAt(ev, race, new Date(Date.parse(race.start_utc) + RACE_WINDOW_MS).toISOString()), 'completed');
  // 8. cancelled event
  assert.equal(raceStateAt({ status: 'canceled' }, race, '2026-01-01T00:00Z'), 'cancelled');
});

test('timezone: date-only facts use the venue calendar day, not the UTC day', () => {
  // Las Vegas 2026: race 04:00 UTC Sunday = 20:00 Saturday local
  assert.equal(venueDay('2026-11-22T04:00Z', 'las-vegas-street-circuit'), '21 November 2026');
  assert.equal(venueIsoDay('2026-11-22T04:00Z', 'las-vegas-street-circuit'), '2026-11-21');
  // Australia: 04:00 UTC Sunday = 15:00 Sunday local (same day)
  assert.equal(venueDay('2026-03-08T04:00Z', 'albert-park'), '8 March 2026');
  // boundary either side of UTC midnight at a UTC+ venue (Suzuka, UTC+9)
  assert.equal(venueIsoDay('2026-03-28T14:59Z', 'suzuka-circuit'), '2026-03-28');
  assert.equal(venueIsoDay('2026-03-28T15:00Z', 'suzuka-circuit'), '2026-03-29');
  // unknown venue falls back to the UTC day
  assert.equal(venueIsoDay('2026-11-22T04:00Z', 'nowhere'), '2026-11-22');
});

test('every circuit in the projection has a venue time zone', { skip: !HAVE && 'needs data/projection' }, async () => {
  const X = await load();
  const tz = JSON.parse(fs.readFileSync('src/core/circuit-tz.json', 'utf8')).zones;
  assert.deepEqual(Object.keys(X.circuit).filter((id) => !tz[id]), []);
  for (const z of Object.values(tz)) assert.doesNotThrow(() => new Intl.DateTimeFormat('en', { timeZone: z }));
});

test('10. a session still "scheduled" after its start is never the next session; Upcoming never on a past weekend', () => {
  const now = Date.parse('2026-10-03T09:00Z');
  const sessions = [
    { type: 'fp3', state: 'scheduled', start_utc: '2026-10-03T04:30Z' }, // stale source state, already past
    { type: 'qualifying', state: 'scheduled', start_utc: '2026-10-03T08:00Z' }, // started an hour ago
    { type: 'race', state: 'scheduled', start_utc: '2026-10-04T07:00Z' },
  ];
  assert.deepEqual(sessionsAhead(sessions, now).map((s) => s.type), ['race']);
  assert.deepEqual(sessionsAhead(sessions, Date.parse('2026-10-05T00:00Z')), []);
  assert.equal(statusPill({ status: 'scheduled', end_utc: '2026-09-13T15:00Z' }, now), '', 'a past weekend is never Upcoming');
  assert.match(statusPill({ status: 'scheduled', end_utc: '2026-10-04T09:00Z' }, now), /data-until="2026-10-04T09:00Z">Upcoming/);
  assert.match(statusPill({ status: 'completed' }, now), /Final/);
});

test('next round is calendar order, never filtered by today\'s status', { skip: !HAVE && 'needs data/projection' }, async () => {
  const X = await load();
  const race = X.session(SPAIN, 'race');
  assert.equal(nextEventAfter(X, race.start_utc).id, '2026-azerbaijan-grand-prix');
});

test('session order is chronological for every 2026 weekend (FP < quali < race; sprint shootout < sprint)', { skip: !HAVE && 'needs data/projection' }, async () => {
  const X = await load();
  const rank = { fp1: 0, fp2: 1, sprint_qualifying: 1, sprint: 2, fp3: 2, qualifying: 3, race: 4 };
  for (const e of X.raceEvents(2026)) {
    const ss = e.sessions.filter((s) => s.start_utc && rank[s.type] != null);
    const q = ss.find((s) => s.type === 'qualifying'), r = ss.find((s) => s.type === 'race');
    if (q && r) assert.ok(Date.parse(q.start_utc) < Date.parse(r.start_utc), `${e.id}: qualifying after race`);
    for (const s of ss.filter((x) => x.type.startsWith('fp'))) if (r) assert.ok(Date.parse(s.start_utc) < Date.parse(r.start_utc), `${e.id}: ${s.type} after race`);
    const sq = ss.find((s) => s.type === 'sprint_qualifying'), sp = ss.find((s) => s.type === 'sprint');
    if (sq && sp) assert.ok(Date.parse(sq.start_utc) < Date.parse(sp.start_utc), `${e.id}: sprint shootout after sprint`);
  }
});

// ---------- newsroom fixtures ----------
const quali = async (publishedAt) => {
  const X = await load();
  const { qualifyingPacket } = await import('../src/news/qualifying.mjs');
  const { composeQualifying } = await import('../src/news/compose-quali.mjs');
  const P = qualifyingPacket(X, SPAIN, { asOf: '2026-10-05T00:00Z', publishedAt }).packet;
  return { P, text: await prose(composeQualifying(P), P) };
};
const final = async (publishedAt) => {
  const X = await load();
  const { raceFinalPacket } = await import('../src/news/race-final.mjs');
  const { composeRaceFinal } = await import('../src/news/compose-race.mjs');
  const P = raceFinalPacket(X, SPAIN, { asOf: '2026-10-05T00:00Z', publishedAt }).packet;
  return { P, text: await prose(composeRaceFinal(P), P) };
};

test('1. qualifying story published before the race: future tense is correct', { skip: !HAVE && 'needs data/projection' }, async () => {
  const { P, text } = await quali('2026-09-12T16:00:00.000Z');
  assert.equal(P.context.temporal.race_state, 'upcoming');
  assert.equal(P.context.temporal.archive_backfill, false);
  assert.match(text, /What's next\nThe race starts on 13 September 2026\./);
  assert.match(text, /PBEcast follows the session live/);
});

test('2. qualifying story published while the race is live', { skip: !HAVE && 'needs data/projection' }, async () => {
  const { P, text } = await quali('2026-09-13T14:00:00.000Z');
  assert.equal(P.context.temporal.race_state, 'live');
  assert.match(text, /The race is underway/);
  assert.doesNotMatch(text, /race starts on/);
});

test('3. qualifying story first published after the race (the 2 Oct Spanish GP case): retrospective, archive', { skip: !HAVE && 'needs data/projection' }, async () => {
  const { P, text } = await quali('2026-10-02T15:08:36.785Z');
  assert.equal(P.context.temporal.race_state, 'completed');
  assert.equal(P.context.temporal.archive_backfill, true);
  assert.equal(archiveKind('qualifying', P.context.temporal, '2026-10-05T00:00Z'), 'backfill');
  assert.doesNotMatch(text, FUTURE_TENSE);
  assert.match(text, /Race result\nThe race was held on 13 September 2026\./);
  assert.ok(P.facts.find((f) => f.id === 'event').display.includes('Spanish Grand Prix'), 'still the Spanish GP qualifying story');
  assert.equal(P.facts.find((f) => f.id === 'race_date').value, '2026-09-13T13:00Z', 'race date stays historically correct');
});

test('frame is anchored to publication, never the build clock: rebuilding later gives the same packet', { skip: !HAVE && 'needs data/projection' }, async () => {
  const X = await load();
  const { qualifyingPacket } = await import('../src/news/qualifying.mjs');
  const a = qualifyingPacket(X, SPAIN, { asOf: '2026-10-02T16:00Z', publishedAt: '2026-10-02T15:08:36.785Z' }).packet;
  const b = qualifyingPacket(X, SPAIN, { asOf: '2026-12-25T00:00Z', publishedAt: '2026-10-02T15:08:36.785Z' }).packet;
  assert.equal(a.hash, b.hash);
});

test('4. race final immediately after the race: next round is upcoming', { skip: !HAVE && 'needs data/projection' }, async () => {
  const { P, text } = await final('2026-09-13T17:30:00.000Z');
  assert.equal(P.context.temporal.archive_backfill, false);
  assert.equal(P.context.temporal.next_race_state, 'upcoming');
  assert.match(text, /The season moves on to the 2026 Azerbaijan Grand Prix, where the race starts on 26 September 2026\./);
});

test('5. race final first built three weeks later: archive, next round in the past tense, no skipped rounds', { skip: !HAVE && 'needs data/projection' }, async () => {
  const { P, text } = await final('2026-10-04T12:00:00.000Z');
  assert.equal(P.context.temporal.archive_backfill, true);
  assert.equal(P.entities.find((x) => x.key === 'next').ref, '2026-azerbaijan-grand-prix');
  assert.match(text, /The next round on the calendar was the 2026 Azerbaijan Grand Prix, raced on 26 September 2026\./);
  assert.doesNotMatch(text, /moves on to/);
});

test('6/7. preview: future frame before the weekend; archived once its race starts (and never first-published late)', { skip: !HAVE && 'needs data/projection' }, async () => {
  const X = await load();
  const tf = temporalFrame(X, '2026-bahrain-grand-prix-in-malaysia', 'preview', '2026-10-01T12:00:00.000Z');
  assert.equal(tf.race_state, 'upcoming');
  assert.equal(archiveKind('preview', tf, '2026-10-03T00:00Z'), null);
  assert.equal(archiveKind('preview', tf, '2026-10-04T07:00Z'), 'expired_preview');
});

test('9. relocated round: dates are the new venue\'s calendar day', { skip: !HAVE && 'needs data/projection' }, async () => {
  const X = await load();
  const ev = X.event['2026-bahrain-grand-prix-in-malaysia'];
  assert.equal(ev.circuit_id, 'sepang-international-circuit');
  assert.equal(venueDay(X.session(ev.id, 'race').start_utc, ev.circuit_id), '4 October 2026');
});

test('news sitemap never carries an archive story', async () => {
  const { newsSitemapXml } = await import('../src/news/pages.mjs');
  const X = { session: () => ({ start_utc: '2026-10-02T14:00Z' }) };
  const base = { class: 'qualifying', event_id: 'e', slug: 's', headline: 'h', published_at: '2026-10-02T15:00:00Z' };
  assert.equal(newsSitemapXml([{ ...base, archive: null }], X, 'https://x', '2026-10-02T16:00:00Z').count, 1);
  assert.equal(newsSitemapXml([{ ...base, archive: 'backfill' }], X, 'https://x', '2026-10-02T16:00:00Z').count, 0);
  assert.equal(newsSitemapXml([{ ...base, class: 'preview', archive: 'expired_preview' }], X, 'https://x', '2026-10-02T16:00:00Z').count, 0);
});
