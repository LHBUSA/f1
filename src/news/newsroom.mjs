// Newsroom decisions, pure (no network, no clock): which stories are candidates at instant `now`, what status each gets,
// and the health record of the run. scripts/build-news.mjs does the IO around it; tests/newsroom.test.mjs drives it.
//
// Publication rules (unchanged for the event classes):
// - published_at is frozen at first publication (live index); modified_at moves only when the packet hash changes.
// - race_final / qualifying: generated for every completed session; a late first publication is an archive backfill
//   (temporal.mjs), never backdated.
// - preview: only the next race not yet started (or one already published); never first-published after its race starts.
// - championship (title picture after a round): only the latest completed round, and only until the next weekend's first
//   session; never first-published late, never backfilled for older rounds.
// - market_move: only the next race, only before its qualifying, only on a material move in stored Kalshi observations;
//   built once and carried forward unchanged from the published record (prices are never re-read into a live story).
import { raceFinalPacket } from './race-final.mjs';
import { composeRaceFinal } from './compose-race.mjs';
import { qualifyingPacket } from './qualifying.mjs';
import { composeQualifying } from './compose-quali.mjs';
import { previewPacket } from './preview.mjs';
import { composePreview } from './compose-preview.mjs';
import { championshipPacket, nextWeekendStart } from './championship.mjs';
import { composeChampionship } from './compose-championship.mjs';
import { marketMovePacket, tapeEntryFor } from './market-move.mjs';
import { composeMarketMove } from './compose-market-move.mjs';
import { editorialGate, EDITORIAL_VERSION } from './quality.mjs';
import { validateDraft, render, QUALITY_VERSION } from './validate.mjs';
import { archiveKind } from './temporal.mjs';
import { marketLink } from './market.mjs';

const T = (iso) => Date.parse(iso); // source ISO strings differ in precision ('11:00Z' vs '11:00:00.000Z')
export const HEALTH_CONTRACT = 'f1-newsroom-health/1';
// the f1-api Worker rebuilds the site (and so re-runs this evaluation) at least this often, plus after every session
export const EVALUATION_INTERVAL_HOURS = 6;

export const SLUG = {
  race_final: (P) => `${P.entities.find((x) => x.key === 'p1').ref}-wins-${P.event_id}`,
  qualifying: (P) => `${P.event_id}-qualifying-results`,
  preview: (P) => `${P.event_id}-preview`,
  championship: (P) => `${P.event_id}-championship-standings`,
  market_move: (P) => `${P.event_id}-market-move`,
};
export const MIN_WORDS = { race_final: 400, qualifying: 300, preview: 400, championship: 400, market_move: 300 };
const COMPOSE = { race_final: composeRaceFinal, qualifying: composeQualifying, preview: composePreview, championship: composeChampionship, market_move: composeMarketMove };
const FROZEN_CLASSES = new Set(['market_move']);

/**
 * Candidates at `now`. live = {slug: index row} from the published news index; liveDocs = {slug: published news doc} for
 * frozen classes; tape = market-tape/1 for F1 (null when the read failed).
 * Returns { candidates, evaluations } — evaluations record every non-event-class decision (why something was or was not
 * a candidate), so a quiet run is visibly quiet rather than silent.
 */
export function buildCandidates(X, classes, { now, live = {}, liveDocs = {}, tape = null }) {
  const publishedAtFor = (cls, eventId) => Object.values(live).find((a) => a.class === cls && a.event_id === eventId)?.published_at || now;
  const candidates = [], evaluations = [];
  const nextRace = (season) => X.raceEvents(season).find((e) => T(X.session(e.id, 'race')?.start_utc) > T(now) && e.status !== 'completed');
  for (const [cls, cfg] of Object.entries(classes)) {
    if (cls.startsWith('_') || cfg.mode === 'off' || !COMPOSE[cls]) continue;
    for (const season of cfg.seasons) {
      for (const ev of X.raceEvents(season)) {
        let r;
        const publishedAt = publishedAtFor(cls, ev.id);
        if (cls === 'race_final') r = raceFinalPacket(X, ev.id, { asOf: now, publishedAt });
        else if (cls === 'qualifying') r = qualifyingPacket(X, ev.id, { asOf: now, publishedAt });
        else if (cls === 'preview') {
          // a preview exists only for the next event that has not started (or one already published before its start)
          const race = X.session(ev.id, 'race');
          const already = live[`${ev.id}-preview`];
          if (!already && (!race?.start_utc || T(race.start_utc) <= T(now) || ev.status === 'completed')) continue;
          if (!already && nextRace(season)?.id !== ev.id) continue;
          r = previewPacket(X, ev.id, { asOf: now, publishedAt });
        } else if (cls === 'championship') {
          const already = Object.values(live).some((a) => a.class === cls && a.event_id === ev.id);
          if (!already) {
            if (X.session(ev.id, 'race')?.state !== 'completed') continue;
            const nws = nextWeekendStart(X, ev.id);
            // window: from the race until the next weekend starts (season finale: seven days)
            const closes = nws || new Date(T(X.session(ev.id, 'race').start_utc) + 7 * 86400e3).toISOString();
            if (T(closes) <= T(now)) continue;
          }
          r = championshipPacket(X, ev.id, { asOf: now, publishedAt });
          evaluations.push({ class: cls, event_id: ev.id, result: r.ok ? 'candidate' : r.reason });
        } else if (cls === 'market_move') {
          const slug = `${ev.id}-market-move`;
          if (live[slug]) {
            // frozen: the published record is the story; prices are never re-read into it
            const doc = liveDocs[slug];
            if (!doc?.packet?.hash || !doc?.draft) throw new Error(`${slug}: published market story without its stored packet (refusing to rebuild it from today's prices)`);
            candidates.push({ cls, cfg, ev, P: doc.packet, draft: { ...doc.draft, slug }, sortKey: live[slug].published_at, frozen: true });
            continue;
          }
          if (nextRace(season)?.id !== ev.id) continue;
          if (!tape) { evaluations.push({ class: cls, event_id: ev.id, result: 'market_tape_unavailable' }); continue; }
          r = marketMovePacket(X, ev.id, tapeEntryFor(tape, ev.id), { asOf: now, publishedAt: now });
          evaluations.push({ class: cls, event_id: ev.id, result: r.ok ? 'candidate' : r.reason });
        }
        if (!r?.ok) continue;
        const P = r.packet;
        const draft = COMPOSE[cls](P);
        draft.slug = SLUG[cls](P);
        candidates.push({ cls, cfg, ev, P, draft, sortKey: X.session(ev.id, cls === 'qualifying' ? 'qualifying' : 'race')?.start_utc || ev.start_utc });
      }
    }
  }
  return { candidates, evaluations };
}

/**
 * Gates + status for every candidate. Statuses: published | shadow (canary overflow) | held (failed a gate) | stale
 * (a time-boxed story whose window closed before its first publication: never first-published late).
 */
export function decide(X, classes, candidates, { now, live = {}, evaluations = [] }) {
  const ledger = Object.fromEntries(Object.values(live).map((a) => [a.slug, { topic: a.topic, headline: a.headline }]));
  const articles = [];
  const report = { gate: QUALITY_VERSION, generated_at: now, classes: {}, stories: [], evaluations };
  for (const cls of Object.keys(classes).filter((k) => !k.startsWith('_'))) {
    const list = candidates.filter((c) => c.cls === cls).sort((a, b) => b.sortKey.localeCompare(a.sortKey));
    const cfg = classes[cls];
    list.forEach((c, i) => {
      const v = validateDraft(c.P, c.draft, { ledger, minWords: MIN_WORDS[cls] });
      // editorial gate runs only on a factually clean draft and never relaxes it
      const ed = v.ok ? editorialGate(c.P, c.draft, { X }) : { ok: false, reasons: ['factual_gate_failed'], warnings: [], words: v.words, links: 0 };
      const prev = live[c.draft.slug];
      const stale = !prev && c.P.context.valid_until && T(c.P.context.valid_until) <= T(now);
      const status = !v.ok || !ed.ok ? 'held' : stale ? 'stale' : cfg.mode === 'published' ? 'published' : cfg.mode === 'canary' ? (i < cfg.canary || prev?.status === 'published' ? 'published' : 'shadow') : 'shadow';
      const published_at = prev?.published_at || now;
      if (c.P.context.temporal && c.P.context.temporal.as_of !== published_at) throw new Error(`${c.draft.slug}: temporal frame ${c.P.context.temporal.as_of} != published_at ${published_at}`);
      // archive: backfill at first publication, or a preview whose race has started since (judged at build time; display only)
      const archive = archiveKind(cls, c.P.context.temporal || {}, now);
      const modified_at = prev && prev.packet_hash !== c.P.hash ? now : prev?.modified_at || published_at;
      // article-market/1 link: frozen at first publication, carried forward; outside the packet (never moves a hash)
      // a championship update is about the table, not the race-winner market: never linked (article-market/1 links one
      // Grand Prix race-winner market per weekend story, never a championship market)
      const market = prev?.market || (cls === 'championship' ? null : marketLink(X, c.P.event_id, c.P));
      const headline = render(c.draft.headline, c.P);
      ledger[c.draft.slug] = { topic: c.P.topic, headline };
      const a = { slug: c.draft.slug, class: cls, topic: c.P.topic, event_id: c.P.event_id, status, published_at, modified_at, archive, market, headline, dek: render(c.draft.dek, c.P), packet_hash: c.P.hash, packet: c.P, draft: c.draft, validation: { ok: v.ok, reasons: v.reasons, facts_used: v.facts_used, words: v.words, gate: QUALITY_VERSION }, editorial: { ok: ed.ok, reasons: ed.reasons, warnings: ed.warnings, words: ed.words, links: ed.links, version: EDITORIAL_VERSION }, composer: c.draft.composer || null };
      articles.push(a);
      report.stories.push({ slug: a.slug, class: cls, status, words: v.words, facts_used: v.facts_used.length, reasons: [...v.reasons, ...ed.reasons], warnings: ed.warnings, links: ed.links });
    });
    const n = (s) => articles.filter((a) => a.class === cls && a.status === s).length;
    report.classes[cls] = { mode: cfg.mode, candidates: list.length, published: n('published'), held: n('held'), shadow: n('shadow'), stale: n('stale') };
  }
  return { articles, report };
}

/** Health record of one newsroom run (published as projection doc `news-health`). A run with nothing new is healthy. */
export function newsroomHealth({ now, articles, report, live = {} }) {
  const pub = articles.filter((a) => a.status === 'published');
  const fresh = pub.filter((a) => !live[a.slug]);
  const last = pub.slice().sort((a, b) => b.published_at.localeCompare(a.published_at) || b.slug.localeCompare(a.slug))[0] || null;
  const total = Object.values(report.classes).reduce((s, c) => s + c.candidates, 0);
  return {
    contract: HEALTH_CONTRACT,
    run_at: now,
    healthy: true, // this run completed; staleness of the newsroom is judged against the clock by the f1-api Worker
    outcome: fresh.length ? 'published_new' : 'no_new_eligible',
    evaluation_interval_hours: EVALUATION_INTERVAL_HOURS,
    next_expected_evaluation: new Date(T(now) + EVALUATION_INTERVAL_HOURS * 3600e3).toISOString(),
    candidates: total,
    newly_published: fresh.map((a) => ({ slug: a.slug, class: a.class, published_at: a.published_at })),
    last_publication: last ? { slug: last.slug, class: last.class, published_at: last.published_at } : null,
    classes: report.classes,
    held: report.stories.filter((s) => s.status === 'held').map((s) => ({ slug: s.slug, class: s.class, reasons: s.reasons })),
    evaluations: report.evaluations,
  };
}
