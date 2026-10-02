// Horizontal scroll surfaces keep scrolling but never show a native scrollbar; the page scrollbar is never hidden.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync('src/web/styles.css', 'utf8');
const rule = (sel) => { const m = css.match(new RegExp(`(^|[}\\n])${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\{([^}]*)\\}`)); return m ? m[2] : null; };

for (const sel of ['.table-wrap', '.itabs', '.xp-chips']) {
  test(`${sel} scrolls horizontally with the scrollbar hidden`, () => {
    const r = rule(sel);
    assert.ok(r, `${sel} rule missing`);
    assert.match(r, /overflow-x:auto/, `${sel} must stay horizontally scrollable`);
    assert.doesNotMatch(r, /overflow(-x)?:hidden/, `${sel} must not clip`);
    assert.match(r, /scrollbar-width:none/, `${sel} Firefox scrollbar hidden`);
    assert.ok(css.includes(`${sel}::-webkit-scrollbar{display:none}`), `${sel} WebKit scrollbar hidden`);
  });
}

test('the page (html/body) scrollbar is never hidden', () => {
  assert.doesNotMatch(css, /(^|\})\s*(html|body)(,\s*(html|body))*\s*\{[^}]*scrollbar-width:none/);
  assert.doesNotMatch(css, /(html|body)::-webkit-scrollbar\s*\{[^}]*display:none/);
});
