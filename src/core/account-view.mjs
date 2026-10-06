// Account view from the server's F1 membership verdict. Pure, dependency-free: imported by the build/tests through
// src/core/all-access.mjs and shipped to the browser (content-hashed) for src/web/account.js and src/web/pbecast.js.

/**
 * One view per server verdict. An unanswered or failed check, or an explicit auth outage, is the access check:
 * never "signed out", never a sale, never FREE. Only the verdict's own fields are read.
 * @param {{status:number, body:any}|null} r  the GET /pbe/f1/membership response (null = no answer / timeout)
 */
export function accountView(r) {
  if (!r || r.status !== 200 || !r.body || typeof r.body !== 'object') return 'check';
  const b = r.body, m = b.membership || {};
  if (b.verification === 'auth_unavailable') return 'check';
  if (m.entitled === true && m.state === 'owner') return 'owner';
  if (m.entitled === true && m.state === 'all_access') return 'all_access';
  if (b.signed_in === true) return 'signed_in';
  return 'signed_out';
}

/** Header label per view (full, short). A non-member is never labelled FREE. */
export const ACCOUNT_LABEL = Object.freeze({
  checking: ['Account', 'Account'],
  signed_out: ['Sign in', 'Sign in'],
  signed_in: ['Account', 'Account'],
  all_access: ['◆ Platinum', '◆ Platinum'],
  owner: ['Verified owner', 'Owner'],
  check: ['Access check', 'Check'],
});
