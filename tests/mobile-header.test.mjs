// Mobile/tablet/small-desktop header while a session is LIVE: the LIVE pill (with its session label) must never push
// the menu/account controls off-screen. Browser proof: C:\Users\goodl\f1qa\nav-qa.mjs (320-1440, live + idle).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync('src/web/styles.css', 'utf8');

test('live header: pill shrinks with an ellipsis and the brand word yields below 1024px', () => {
  const block = css.slice(css.indexOf('/* mobile header: live state'));
  assert.match(block, /@media\(max-width:1023px\)\{/);
  assert.match(block, /\.masthead \.live-pill\{flex:0 1 auto;min-width:0;overflow:hidden\}/);
  assert.match(block, /\.masthead \.live-pill \[data-live-text\]\{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap\}/);
  assert.match(block, /\.masthead:has\(\.live-pill:not\(\[hidden\]\)\) \.brand-pbe\{display:none\}/);
});

test('tablet account button clears the menu button; tiny phones and small desktops get a dot-only pill', () => {
  assert.match(css, /@media\(min-width:768px\) and \(max-width:1023px\)\{\.acct-slot\{right:74px\}\}/);
  assert.match(css, /@media\(max-width:359px\),\(min-width:1024px\) and \(max-width:1279px\)\{/);
  // the label stays in the accessible name (visually hidden, not display:none)
  assert.match(css, /\.masthead \.live-pill \[data-live-text\]\{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect\(0 0 0 0\)/);
});
