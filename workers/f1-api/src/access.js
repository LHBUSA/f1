// F1 premium access: the PropBetEdge network authority decides, never the browser.
// Same pattern as every All-Access-only sport (Soccer, Tennis, Golf): forward ONLY the pbe_session cookie to
// auth-magic GET /membership?sport=f1 over the AUTH service binding. Granted only for an active All Access
// subscription or the verified owner; anything else (no session, error, timeout, odd shape) is free. Fail closed.
export const ALL_ACCESS_URL = 'https://propbetedge.ai/pro';
const CONTRACT = '1.4.0';

export function sessionCookie(request) {
  const entries = (request.headers.get('cookie') || '').split(';').map((v) => v.trim()).filter((v) => v.startsWith('pbe_session='));
  if (entries.length !== 1) return null;
  const value = entries[0].slice('pbe_session='.length);
  return /^[A-Za-z0-9_.-]{20,4096}$/.test(value) ? value : null;
}

const free = (reason) => ({ granted: false, reason, membership: { contract: CONTRACT, sport: 'f1', state: 'free', entitled: false, access_source: null, network_url: ALL_ACCESS_URL } });

export async function f1Access(request, env) {
  const token = sessionCookie(request);
  if (!token) return free('no_session');
  if (!env.AUTH?.fetch) return free('auth_unavailable');
  try {
    const r = await env.AUTH.fetch('https://auth.propbetedge.ai/membership?sport=f1', { headers: { cookie: `pbe_session=${token}`, accept: 'application/json' }, signal: AbortSignal.timeout(2500) });
    if (r.status !== 200) return free('auth_unavailable');
    const body = await r.json();
    const m = body?.membership;
    const signedIn = body?.authenticated === true;
    if (!m || m.sport !== 'f1' || m.entitled !== true || !['all_access', 'owner'].includes(m.state) || m.access_source !== (m.state === 'owner' ? 'owner' : 'all_access')) return { ...free(signedIn ? 'no_network_entitlement' : 'invalid_session'), signed_in: signedIn };
    return { granted: true, reason: 'network', signed_in: true, membership: { contract: CONTRACT, sport: 'f1', state: m.state, entitled: true, access_source: m.access_source, label: m.label || null, network_url: ALL_ACCESS_URL } };
  } catch {
    return free('auth_unavailable');
  }
}
