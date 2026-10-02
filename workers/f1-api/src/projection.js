// Projection store: public provider-neutral documents published by the production build.
// Layout in R2: projection/v1/<version>/<name>.json.gz + projection/v1/current.json {version,...}.
// Publishing is two-phase (files, then the pointer), so readers never see a half-written version.
const memo = { version: null, checkedAt: 0, docs: new Map() };

async function gunzipJson(obj) {
  return new Response(obj.body.pipeThrough(new DecompressionStream('gzip'))).json();
}

export async function currentVersion(env) {
  if (memo.version && Date.now() - memo.checkedAt < 30000) return memo.version;
  const ptr = await env.DATA.get('projection/v1/current.json');
  const v = ptr ? (await ptr.json()).version : null;
  if (v !== memo.version) memo.docs.clear();
  memo.version = v;
  memo.checkedAt = Date.now();
  return v;
}

export async function doc(env, name) {
  const v = await currentVersion(env);
  if (!v) return null;
  if (memo.docs.has(name)) return memo.docs.get(name);
  const obj = await env.DATA.get(`projection/v1/${v}/${name}.json.gz`);
  const data = obj ? await gunzipJson(obj) : null;
  memo.docs.set(name, data);
  return data;
}

export async function putFile(env, version, name, body) {
  if (!/^[a-f0-9]{16}$/.test(version) || !/^[a-z0-9-]+$/.test(name)) throw new Error('bad projection key');
  await env.DATA.put(`projection/v1/${version}/${name}.json.gz`, body, { httpMetadata: { contentType: 'application/json', contentEncoding: 'gzip' } });
}

export async function activate(env, version, manifest) {
  const missing = [];
  for (const f of [...manifest.files, 'internal']) if (!(await env.DATA.head(`projection/v1/${version}/${f}.json.gz`))) missing.push(f);
  if (missing.length) return { ok: false, missing };
  const prev = await env.DATA.get('projection/v1/current.json');
  await env.DATA.put('projection/v1/current.json', JSON.stringify({ version, activated_at: new Date().toISOString(), generated_at: manifest.generated_at, files: manifest.files, previous: prev ? (await prev.json()).version : null }), { httpMetadata: { contentType: 'application/json' } });
  memo.version = null;
  return { ok: true, version };
}
