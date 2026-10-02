// HTTP transport for responses that reach browsers through Vercel's external rewrites
// (f1.propbetedge.ai/pbe/f1/* -> propsports.proptechusa.ai/v1/f1/* -> this Worker).
//
// Vercel caches those responses under a key that ignores Accept-Encoding. Without no-transform,
// Cloudflare compressed each response for whichever client filled the cache (zstd for Chrome) and
// Vercel replayed those bytes to every client, so Safari and other non-zstd clients got unreadable
// JSON. With no-transform Cloudflare returns the body as the Worker wrote it; Vercel negotiates
// gzip/br per client. Existing directives (private, no-store, max-age) and every other header are
// kept verbatim; only `no-transform` is appended.

const NULL_BODY = new Set([101, 204, 205, 304]);

/** The same response with `no-transform` merged into its Cache-Control (idempotent). */
export function noTransform(res) {
  const cc = res.headers.get('cache-control') || '';
  if (/(^|[\s,])no-transform([\s,]|$)/i.test(cc)) return res;
  const headers = new Headers(res.headers);
  headers.set('cache-control', cc ? `${cc}, no-transform` : 'no-transform');
  return new Response(NULL_BODY.has(res.status) ? null : res.body, { status: res.status, statusText: res.statusText, headers });
}
