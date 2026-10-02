// Championship ranking + trend. Shared by scripts/derive.mjs (season progression) and the standings tables.
//
// rankWithCountback: FIA order = points, then countback on Grand Prix finishing positions (most 1st places, then most
// 2nds, ...). Sprint results add points but are not part of the countback. Remaining full ties keep a deterministic
// id order (the official table is authoritative for those).
//
// trendFor: change = championship position after the previous completed Grand Prix minus the current official
// position (positive = places gained). States: up | down | same | na. "na" (no comparable history) is NEVER rendered
// like "same".

export function rankWithCountback(points, finishes = {}) {
  const counts = {};
  for (const id of Object.keys(points)) {
    const c = [];
    for (const p of finishes[id] || []) if (Number.isInteger(p) && p > 0) c[p] = (c[p] || 0) + 1;
    counts[id] = c;
  }
  const maxPos = Math.max(0, ...Object.values(counts).map((c) => c.length));
  const cmp = ([a, pa], [b, pb]) => {
    if (Math.abs(pb - pa) > 1e-9) return pb - pa;
    for (let k = 1; k < maxPos; k++) { const d = (counts[b][k] || 0) - (counts[a][k] || 0); if (d) return d; }
    return a < b ? -1 : a > b ? 1 : 0;
  };
  return Object.entries(points).sort(cmp).map(([id, p], i) => [id, { p: Math.round(p * 1000) / 1000, pos: i + 1 }]);
}

export function trendFor(prog, kind, id, officialPos) {
  const key = kind === 'driver' ? 'drivers' : 'constructors';
  const rounds = prog?.rounds || [];
  if (rounds.length < 2) return { state: 'na', reason: 'No previous completed round this season' };
  const last = rounds.at(-1)[key]?.[id];
  const prev = rounds.at(-2)[key]?.[id];
  if (!prev) return { state: 'na', reason: 'No championship position after the previous round' };
  if (!last || last.pos !== officialPos) return { state: 'na', reason: 'Previous-round position cannot be reconciled with the official table' };
  const delta = prev.pos - officialPos;
  return { state: delta > 0 ? 'up' : delta < 0 ? 'down' : 'same', delta };
}
