// PBE F1 EDGE pick policy STUB. Default answer is NO OFFICIAL PICK.
//
// An official pick needs ALL of: preregistered thresholds (recorded before the shadow window, bound to the frozen
// artifact hash), a promoted (non-research) model, a priced quote captured before lock, and the thresholds met.
// In this research phase OFFICIAL_PICKS_ENABLED is false, so the best possible outcome is SHADOW_CANDIDATE.
export const POLICY_VERSION = 'f1-edge-pick-policy@0.1.0-stub';
export const OFFICIAL_PICKS_ENABLED = false;
export const NO_OFFICIAL_PICK = 'NO_OFFICIAL_PICK';

const REQUIRED_THRESHOLDS = ['registered_at', 'artifact_sha256', 'min_edge_pp', 'min_ev_per_unit', 'min_probability', 'max_overround', 'min_books'];

export function evaluatePick({ valuation, thresholds = null, model = {}, consensusBooks = 0, overround = null, quoteCapturedAt = null, lockTime = null }) {
  const no = (reason) => ({ decision: NO_OFFICIAL_PICK, reason, policy: POLICY_VERSION });
  if (!thresholds || REQUIRED_THRESHOLDS.some((k) => thresholds[k] == null)) return no('thresholds_not_preregistered');
  if (thresholds.artifact_sha256 !== model.artifact_sha256) return no('thresholds_bound_to_different_artifact');
  if (lockTime && Date.parse(thresholds.registered_at) >= Date.parse(lockTime)) return no('thresholds_registered_after_lock');
  if (!valuation?.priced) return no('unpriced');
  if (quoteCapturedAt && lockTime && Date.parse(quoteCapturedAt) > Date.parse(lockTime)) return no('quote_after_lock');
  if (valuation.edge_pp == null || valuation.edge_pp < thresholds.min_edge_pp) return no('edge_below_threshold');
  if (valuation.ev_per_unit < thresholds.min_ev_per_unit) return no('ev_below_threshold');
  if (valuation.pbe_probability < thresholds.min_probability) return no('probability_below_threshold');
  if (overround == null || overround > thresholds.max_overround) return no('overround_above_threshold');
  if (consensusBooks < thresholds.min_books) return no('insufficient_books');
  if (!model.status || /research/i.test(model.status) || !model.promoted) return { decision: 'SHADOW_CANDIDATE', reason: 'model_not_promoted', policy: POLICY_VERSION };
  if (!OFFICIAL_PICKS_ENABLED) return { decision: 'SHADOW_CANDIDATE', reason: 'official_picks_disabled', policy: POLICY_VERSION };
  return { decision: 'OFFICIAL_PICK', reason: 'all_thresholds_met', policy: POLICY_VERSION };
}
