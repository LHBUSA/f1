// PBEcast state presentation (LHBUSA/f1#10, Singapore qualifying 2026-10-10): the server HTML never asserts a session
// state (the client's single state machine does), and no raw session code reaches the page.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pbecastEventPage } from '../scripts/site/pbecast-v2.mjs';

const HAVE = fs.existsSync('data/projection/events-2026.json');
const skip = !HAVE && 'needs data/projection';

test('a sprint weekend labels every session; no raw sprint_qualifying / sprint-qualifying text', { skip }, async () => {
  const X = (await import('../src/news/data.mjs')).loadProjection();
  const ev = X.raceEvents(2026).find((e) => e.sprint && e.sessions.some((s) => s.type === 'sprint_qualifying'));
  const page = pbecastEventPage(X, ev);
  const data = JSON.parse(page.body.match(/<script type="application\/json" id="pbecast-data">([\s\S]*?)<\/script>/)[1]);
  assert.ok(data.sessions.every((s) => s.label && !/[_-]/.test(s.label)), JSON.stringify(data.sessions.map((s) => s.label)));
  assert.equal(data.session_labels['sprint-qualifying'], 'Sprint Qualifying', 'live/replay session types use the hyphen');
  assert.equal(data.session_labels.sprint_qualifying, 'Sprint Qualifying');
  const visible = page.body.replace(/<script[\s\S]*?<\/script>/g, '');
  assert.doesNotMatch(visible, />[^<]*sprint[_-]qualifying[^<]*</i);
});

test('server HTML asserts no session state: no "No session live" headline, no "Off-session view"', { skip }, async () => {
  const X = (await import('../src/news/data.mjs')).loadProjection();
  for (const ev of X.raceEvents(2026)) {
    const { body } = pbecastEventPage(X, ev);
    assert.doesNotMatch(body, /Off-session view/);
    assert.doesNotMatch(body, /<h2[^>]*>No session live right now<\/h2>/);
  }
});

test('a chequered / End of Session upstream is never shown as LIVE (state stays live until the classification is final)', () => {
  const client = fs.readFileSync('src/web/pbecast.js', 'utf8');
  const def = client.match(/const sessionEnded = (\(s\) => [^;]+);/);
  assert.ok(def, 'sessionEnded helper');
  const sessionEnded = eval(def[1]);
  assert.equal(sessionEnded({ flag: 'CHECKER', status: 'End of Session' }), true);
  assert.equal(sessionEnded({ flag: 'GREEN', status: 'End of Session' }), true);
  assert.equal(sessionEnded({ flag: 'GREEN', status: 'In Progress' }), false);
  assert.equal(sessionEnded({ flag: 'RED', status: 'Suspended' }), false);
  assert.equal(sessionEnded(null), false);
});
