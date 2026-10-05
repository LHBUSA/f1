import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../scripts/site/pbecast-v2.mjs', import.meta.url), 'utf8');
const client = fs.readFileSync(new URL('../src/web/pbecast.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/web/styles.css', import.meta.url), 'utf8');

test('off-session PBEcast is a race-weekend command center, not a dead canvas', () => {
  assert.match(page, /Race weekend command center/);
  assert.match(page, /No session live right now/);
  assert.match(page, /Race intelligence/);
  assert.match(page, /Circuit profile/);
  assert.match(page, /PBEcast timing will still activate when the live session begins/);
  assert.doesNotMatch(page, /The track map for this circuit is not mapped yet/);
});

test('off-session timing tower collapses instead of reserving a full live grid', () => {
  assert.match(page, /pc-rows--idle/);
  assert.match(client, /body\.classList\.toggle\('pc-rows--idle', !rows\.length\)/);
  assert.match(css, /\.pc-rows\.pc-rows--idle\{min-height:0!important\}/);
});

test('weekend schedule renders the next session in the reader local timezone', () => {
  assert.match(page, /sessions: weekendSessions/);
  assert.match(client, /Intl\.DateTimeFormat/);
  assert.match(client, /Next: \$\{next\.label\}/);
  assert.match(client, /data-pc-session-row/);
});
