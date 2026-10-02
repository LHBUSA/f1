// PBE F1 EDGE append-only pick ledger (schema + in-memory engine; storage-agnostic).
//
// The ledger is a hash chain of frozen events. A pick is written once at lock (PICK event); its result is a separate
// SETTLE event. Nothing is ever edited or deleted. A pick locked without a valid pre-lock quote is UNPRICED forever:
// it is settled for the record but never gets a price retroactively and never counts toward ROI.
import { sha256, stableStringify } from './util.mjs';

export const LEDGER_SCHEMA_VERSION = 'f1-edge-ledger@0.1.0';
export const PICK_FIELDS = Object.freeze([
  'pick_id', 'canonical_event_id', 'event_name', 'market', 'selection', 'opponent', 'line',
  'model_version', 'artifact_sha256', 'dataset_sha256', 'feature_snapshot_sha256',
  'pbe_probability', 'market_novig', 'edge_pp', 'ev_per_unit', 'fair_decimal',
  'quote', 'captured_at', 'lock_time', 'policy_decision',
]);
const REQUIRED = ['pick_id', 'canonical_event_id', 'market', 'selection', 'model_version', 'artifact_sha256', 'dataset_sha256', 'feature_snapshot_sha256', 'pbe_probability', 'lock_time'];
export const RESULTS = Object.freeze(['WIN', 'LOSS', 'VOID', 'PUSH']);
export const STATUSES = Object.freeze(['OPEN', 'UNPRICED', 'SETTLED', 'SETTLED_UNPRICED', 'VOID']);

const deepFreeze = (o) => {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); }
  return o;
};

export function createLedger(initial = []) {
  const events = [];
  const ledger = {
    get length() { return events.length; },
    events: () => events.slice(),
    append(type, payload) {
      const prev = events.length ? events[events.length - 1].entry_hash : 'GENESIS';
      const body = { seq: events.length, type, payload: structuredClone(payload), prev_hash: prev, schema: LEDGER_SCHEMA_VERSION };
      const ev = deepFreeze({ ...body, entry_hash: sha256(stableStringify(body)) });
      events.push(ev);
      return ev;
    },
    /** Record a pick at lock. A missing quote, or a quote captured after lock, makes it UNPRICED. */
    recordPick(pick) {
      for (const k of REQUIRED) if (pick[k] == null) throw new Error(`pick missing ${k}`);
      if (ledger.pick(pick.pick_id)) throw new Error(`duplicate pick_id ${pick.pick_id}`);
      const quoteOk = pick.quote && pick.captured_at && Date.parse(pick.captured_at) <= Date.parse(pick.lock_time);
      const rec = {};
      for (const k of PICK_FIELDS) rec[k] = pick[k] ?? null;
      if (!quoteOk) Object.assign(rec, { quote: null, market_novig: null, edge_pp: null, ev_per_unit: null, captured_at: null, unpriced_reason: pick.quote ? 'quote_captured_after_lock' : 'no_quote_at_lock' });
      rec.priced = !!quoteOk;
      return ledger.append('PICK', rec);
    },
    settle(pick_id, result, settlement_reason, settled_at) {
      if (!RESULTS.includes(result)) throw new Error(`invalid result ${result}`);
      if (!settlement_reason) throw new Error('settlement_reason required');
      const p = ledger.pick(pick_id);
      if (!p) throw new Error(`unknown pick ${pick_id}`);
      if (p.result) throw new Error(`pick ${pick_id} already settled (append a CORRECTION event instead)`);
      return ledger.append('SETTLE', { pick_id, result, settlement_reason, settled_at: settled_at ?? null });
    },
    /** Pricing can never be attached after lock. */
    attachQuote(pick_id) {
      throw new Error(`append-only: cannot price pick ${pick_id} after lock`);
    },
    /** Folded view of one pick. */
    pick(pick_id) {
      let p = null;
      for (const e of events) {
        if (e.type === 'PICK' && e.payload.pick_id === pick_id) p = { ...e.payload, result: null, settlement_reason: null };
        if (e.type === 'SETTLE' && e.payload.pick_id === pick_id && p) Object.assign(p, { result: e.payload.result, settlement_reason: e.payload.settlement_reason });
      }
      if (!p) return null;
      p.status = p.result === 'VOID' ? 'VOID' : p.result ? (p.priced ? 'SETTLED' : 'SETTLED_UNPRICED') : p.priced ? 'OPEN' : 'UNPRICED';
      return p;
    },
    picks() { return events.filter((e) => e.type === 'PICK').map((e) => ledger.pick(e.payload.pick_id)); },
    verify() {
      let prev = 'GENESIS';
      for (const e of events) {
        const { entry_hash, ...body } = e;
        if (body.prev_hash !== prev || sha256(stableStringify(body)) !== entry_hash) return false;
        prev = entry_hash;
      }
      return true;
    },
    /** Record: every settled pick counts for W/L; ROI only over PRICED picks (UNPRICED never get a price). */
    summary() {
      const ps = ledger.picks();
      const settled = ps.filter((p) => p.result && p.result !== 'VOID');
      const priced = settled.filter((p) => p.priced);
      const units = priced.reduce((s, p) => s + (p.result === 'WIN' ? p.quote.decimal_odds - 1 : p.result === 'LOSS' ? -1 : 0), 0);
      return {
        picks: ps.length, open: ps.filter((p) => p.status === 'OPEN').length, unpriced: ps.filter((p) => !p.priced).length,
        wins: settled.filter((p) => p.result === 'WIN').length, losses: settled.filter((p) => p.result === 'LOSS').length,
        priced_settled: priced.length, units: priced.length ? units : null, roi: priced.length ? units / priced.length : null,
      };
    },
    toJSONL() { return events.map((e) => stableStringify(e)).join('\n') + (events.length ? '\n' : ''); },
  };
  for (const e of initial) ledger.append(e.type, e.payload);
  return ledger;
}
