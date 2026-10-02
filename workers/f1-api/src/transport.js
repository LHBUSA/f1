// HTTP transport for responses that reach browsers through Vercel's external rewrites
// (f1.propbetedge.ai/pbe/f1/* -> propsports.proptechusa.ai/v1/f1/* -> this Worker).
//
// Vercel caches those responses under a key that ignores Accept-Encoding. Without no-transform,
// Cloudflare compressed each response for whichever client filled the cache (zstd for Chrome) and
// Vercel replayed those bytes to every client, so Safari and other non-zstd clients got unreadable
// JSON. With no-transform Cloudflare returns the body as the Worker wrote it; Vercel negotiates
// gzip/br per client. Existing directives (private, no-store, max-age) and every other header are
// kept verbatim; only `no-transform` is appended.
//
// F1 sits behind TWO Vercel caches (the F1 site's rewrite reaches PropSports, itself a Vercel
// rewrite). The PropSports layer compresses per client, so the F1 layer would cache that client's
// gzip/br bytes and replay them to everyone. Vercel keys its rewrite cache on the upstream Vary
// (proven with Vary: Origin), so Accept-Encoding is merged into Vary: each layer then keeps one
// entry per encoding instead of replaying another client's.

const NULL_BODY = new Set([101, 204, 205, 304]);

/** The same response with `no-transform` merged into Cache-Control and Accept-Encoding into Vary (idempotent). */
export function noTransform(res) {
  const cc = res.headers.get('cache-control') || '';
  const vary = res.headers.get('vary') || '';
  const hasNoTransform = /(^|[\s,])no-transform([\s,]|$)/i.test(cc);
  const hasVaryAE = vary.trim() === '*' || vary.split(',').some((v) => v.trim().toLowerCase() === 'accept-encoding');
  if (hasNoTransform && hasVaryAE) return res;
  const headers = new Headers(res.headers);
  if (!hasNoTransform) headers.set('cache-control', cc ? `${cc}, no-transform` : 'no-transform');
  if (!hasVaryAE) headers.set('vary', vary ? `${vary}, Accept-Encoding` : 'Accept-Encoding');
  return new Response(NULL_BODY.has(res.status) ? null : res.body, { status: res.status, statusText: res.statusText, headers });
}
