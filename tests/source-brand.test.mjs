// Network source-brand standard (DATA · PropSports): the guard over customer surfaces and the public f1-api serializers passes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('source-brand guard passes (customer copy, built pages, public f1-api payloads)', () => {
  const r = spawnSync(process.execPath, ['scripts/guard-source-brand.mjs'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});

test('public /replay rows carry the public session id only (no upstream key)', async () => {
  const { gzipSync } = await import('node:zlib');
  const { default: api } = await import('../workers/f1-api/src/index.js');
  const internal = { event_by_upstream: { 77: '2026-test-gp' }, driver_by_upstream: {} };
  const files = {
    'projection/v1/current.json': { version: 'v1' },
    'observations/espn-999/index.json': { session: 999, chunks: 0, meta: { event_id: 77, type: 'Race' } },
  };
  const obj = (k) => k.endsWith('.gz')
    ? { body: new Response(gzipSync(JSON.stringify(internal))).body }
    : files[k] ? { json: async () => files[k] } : null;
  const env = { DATA: { get: async (k) => obj(k), list: async () => ({ delimitedPrefixes: ['observations/espn-999/'] }) } };
  const res = await api.fetch(new Request('https://f1-api.propbetedge.ai/v1/f1/replay'), env, { waitUntil() {} });
  const body = await res.json();
  assert.ok(Array.isArray(body.sessions) && body.sessions.length === 1, JSON.stringify(body));
  assert.equal(body.sessions[0].id, '2026-test-gp-race');
  assert.ok(!('upstream' in body.sessions[0]));
  assert.doesNotMatch(JSON.stringify(body), /999|espn/i);
});
