// Shortest walks on a grid, with the agent's own costs and the agent's own map.
//
// One planner per grid size is shared by every agent: its arrays are reused between searches (a
// stamp marks which entries belong to the current search), so planning allocates nothing.

import { DIRS8 } from './city.js';

export function makePlanner(W, H) {
  const N = W * H;
  const dist = new Float32Array(N);
  const prev = new Int32Array(N);
  const stamp = new Uint32Array(N);
  const closed = new Uint32Array(N);
  let gen = 1;
  let keys = new Float32Array(4096);
  let vals = new Int32Array(4096);
  let size = 0;
  const push = (d, n) => {
    if (size >= keys.length) {
      const k2 = new Float32Array(keys.length * 2); k2.set(keys); keys = k2;
      const v2 = new Int32Array(vals.length * 2); v2.set(vals); vals = v2;
    }
    let i = size++;
    while (i > 0) { const p = (i - 1) >> 1; if (keys[p] <= d) break; keys[i] = keys[p]; vals[i] = vals[p]; i = p; }
    keys[i] = d; vals[i] = n;
  };
  const pop = () => {
    const n = vals[0]; const d = keys[--size]; const v = vals[size];
    let i = 0;
    for (;;) {
      const l = 2 * i + 1; if (l >= size) break;
      const r = l + 1; const m = r < size && keys[r] < keys[l] ? r : l;
      if (keys[m] >= d) break;
      keys[i] = keys[m]; vals[i] = vals[m]; i = m;
    }
    keys[i] = d; vals[i] = v;
    return n;
  };

  // Dijkstra from `from` over cells where open(i), stepping cost 1 (or √2) times (1 + cost(i)).
  // Stops at `target` (A* toward it), when goal(i) is true, or past maxCost.
  // Returns the path [from .. end] or null; `reached` lists every settled cell when wanted.
  function search(from, { open, cost = null, target = -1, goal = null, maxCost = Infinity, reached = null, greed = 1.6 }) {
    gen++;
    if (gen === 0xffffffff) { stamp.fill(0); closed.fill(0); gen = 1; }
    size = 0;
    const tx = target >= 0 ? target % W : 0; const ty = target >= 0 ? (target - tx) / W : 0;
    const h = target >= 0 ? (i) => { const x = i % W; const y = (i - x) / W; const dx = Math.abs(x - tx); const dy = Math.abs(y - ty); return greed * (Math.max(dx, dy) + 0.414 * Math.min(dx, dy)); } : () => 0;
    stamp[from] = gen; dist[from] = 0; prev[from] = -1;
    push(h(from), from);
    let end = -1;
    while (size) {
      const n = pop();
      const dn = dist[n];
      if (closed[n] === gen) continue;
      closed[n] = gen;
      if (reached) reached.push(n, dn);
      if (n === target || (goal && n !== from && goal(n))) { end = n; break; }
      const x = n % W; const y = (n - x) / W;
      for (let q = 0; q < 8; q++) {
        const dx = DIRS8[q][0]; const dy = DIRS8[q][1];
        const nx = x + dx; const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const m = ny * W + nx;
        if (closed[m] === gen || !open(m)) continue;
        if (dx && dy && (!open(y * W + nx) || !open(ny * W + x))) continue;
        const step = (dx && dy ? Math.SQRT2 : 1) * (1 + (cost ? cost(m) : 0));
        const nd = dn + step;
        if (nd > maxCost) continue;
        if (stamp[m] !== gen || nd < dist[m]) { stamp[m] = gen; dist[m] = nd; prev[m] = n; push(nd + h(m), m); }
      }
    }
    if (end < 0) return null;
    const path = [];
    for (let n = end; n !== -1; n = prev[n]) path.push(n);
    return path.reverse();
  }

  // All cells within maxCost of `from` (no target): [cell, distance, cell, distance, ...]
  function flood(from, opts) {
    const reached = [];
    search(from, { ...opts, target: -1, goal: null, reached });
    return reached;
  }

  return { search, flood, N };
}
