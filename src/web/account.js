// PropBetEdge F1 account control (every page): asks the server for the membership verdict once, labels the header
// button, opens the account sheet and shows the one server-rendered panel that matches the verdict. It never decides
// access: f1-api gates the premium endpoints itself. A failed, slow (8 s) or auth-unavailable check is the access
// check, never a sale and never FREE.
import { accountView, ACCOUNT_LABEL } from './account-view.js';

const SIGNIN = 'https://auth.propbetedge.ai/magic/request';
const SIGNOUT = 'https://auth.propbetedge.ai/logout';
let view = 'checking';
let inflight = null;

async function check() {
  if (inflight) return inflight;
  inflight = (async () => {
    let r = null;
    try {
      const res = await fetch('/pbe/f1/membership', { credentials: 'same-origin', cache: 'no-store', headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
      r = { status: res.status, body: await res.json().catch(() => null) };
    } catch { r = null; }
    view = accountView(r);
    paint();
    document.dispatchEvent(new CustomEvent('pbe:f1-account', { detail: { view } }));
    return view;
  })();
  try { return await inflight; } finally { inflight = null; }
}

function paint() {
  const [full, short] = ACCOUNT_LABEL[view] || ACCOUNT_LABEL.checking;
  document.querySelectorAll('[data-acct-open]').forEach((b) => {
    b.dataset.acctView = view;
    const l = b.querySelector('[data-acct-label]'), s = b.querySelector('[data-acct-short]');
    if (l) l.textContent = full;
    if (s) s.textContent = short;
  });
  document.documentElement.dataset.acctView = view;
  document.querySelectorAll('[data-acct-panels]').forEach((root) => {
    root.querySelectorAll('[data-acct-panel]').forEach((p) => { p.hidden = p.dataset.acctPanel !== view; });
  });
}

const sheet = () => document.querySelector('[data-acct-sheet]');
function open() {
  const d = sheet(); if (!d || d.open) return;
  d.showModal(); document.documentElement.classList.add('acct-open');
  if (view === 'checking' || view === 'check') check();
}
function close() { const d = sheet(); if (d?.open) d.close(); }

// One delegated listener per event type for the life of the document (soft navigation swaps <main> only), so
// opening and closing the sheet any number of times never stacks handlers.
document.addEventListener('click', (e) => {
  const t = e.target instanceof Element ? e.target : null;
  if (!t) return;
  if (t.closest('[data-acct-open]')) { e.preventDefault(); open(); return; }
  if (t.closest('[data-acct-close]')) { close(); return; }
  if (t.closest('[data-acct-retry]')) { view = 'checking'; paint(); check(); return; }
  if (t.closest('[data-acct-signout]')) { signOut(); return; }
  const d = sheet();
  if (d && t === d) close(); // backdrop click
});
document.addEventListener('submit', async (e) => {
  const f = e.target instanceof HTMLFormElement && e.target.matches('[data-acct-signin]') ? e.target : null;
  if (!f) return;
  e.preventDefault();
  const out = f.querySelector('[data-acct-signin-msg]'), email = f.email.value.trim();
  if (!email || !f.email.checkValidity()) { if (out) out.textContent = 'Enter the email on your PropBetEdge membership.'; return; }
  try {
    const here = new URL(location.href); here.hash = '';
    const r = await fetch(SIGNIN, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, return_to: here.toString() }) });
    const b = await r.json().catch(() => ({}));
    if (out) out.textContent = r.ok ? (b.message || 'If that email has PropBetEdge access, a sign-in link is on its way.') : 'Sign-in is unavailable right now. Try again shortly.';
  } catch { if (out) out.textContent = 'Sign-in is unavailable right now. Try again shortly.'; }
});
async function signOut() {
  try { await fetch(SIGNOUT, { method: 'POST', credentials: 'include' }); } catch { /* the reload re-asks the server */ }
  location.reload();
}
sheet()?.addEventListener('close', () => document.documentElement.classList.remove('acct-open'));
// soft navigation replaced <main>: the /all-access page carries its own panels, so repaint them
document.addEventListener('f1:navigated', paint);

window.PBEF1Account = Object.freeze({ check, get view() { return view; } });
paint();
check();
