import test from 'node:test';
import assert from 'node:assert/strict';
import { noTransform } from '../workers/f1-api/src/transport.js';

test('transport: public F1 JSON keeps its TTL, Vary and service headers and gains no-transform', async () => {
  const res = noTransform(new Response('{"season":2026}', { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=300', vary: 'Origin', 'x-propsports-service': 'f1', 'access-control-allow-origin': 'https://f1.propbetedge.ai' } }));
  assert.equal(res.headers.get('cache-control'), 'public, max-age=300, no-transform');
  assert.equal(res.headers.get('vary'), 'Origin, Accept-Encoding');
  assert.equal(res.headers.get('x-propsports-service'), 'f1');
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://f1.propbetedge.ai');
  assert.deepEqual(await res.json(), { season: 2026 });
});

test('transport: premium/session responses stay private, no-store with Vary: Origin, Cookie and credentials', () => {
  const res = noTransform(new Response('{"error":"all_access_required"}', { status: 403, headers: { 'cache-control': 'private, no-store', vary: 'Origin, Cookie', 'access-control-allow-credentials': 'true', 'x-robots-tag': 'noindex' } }));
  assert.equal(res.status, 403);
  assert.equal(res.headers.get('cache-control'), 'private, no-store, no-transform');
  assert.equal(res.headers.get('vary'), 'Origin, Cookie, Accept-Encoding');
  assert.equal(res.headers.get('access-control-allow-credentials'), 'true');
  assert.equal(res.headers.get('x-robots-tag'), 'noindex');
});

test('transport: null-body statuses and idempotence', () => {
  const empty = noTransform(new Response(null, { status: 204, headers: { 'cache-control': 'max-age=86400' } }));
  assert.equal(empty.status, 204);
  assert.equal(empty.headers.get('cache-control'), 'max-age=86400, no-transform');
  assert.equal(empty.headers.get('vary'), 'Accept-Encoding');
  const tagged = new Response('x', { headers: { 'cache-control': 'no-store, no-transform', vary: 'Origin, Accept-Encoding' } });
  assert.equal(noTransform(tagged), tagged);
});
