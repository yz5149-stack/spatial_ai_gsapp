// What an agent knows about the forest: its own map, built only from what it has seen.
//
//   known[i]  -1 never seen, 0 open ground, 1 obstacle
//   visits[i] how often it stood on the cell (its trajectory, as a heatmap)
//   trail     the cells it walked, in order
//   landmarks places it decided to remember, each stored relative to something it already knew
//
// Planning (shortest walks, frontiers) uses only this map, never the true world.

import { G } from './world.js';

const DIRS8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export function makeKnowledge(world, name) {
  const N = world.W * world.H;
  return {
    name,
    known: new Int8Array(N).fill(-1),
    seenAt: new Int32Array(N).fill(-1),
    visits: new Uint16Array(N),
    trail: [],
    landmarks: [],
    knownCount: 0,
    lastCone: [],   // the cone polygon of the latest look, for drawing: [[x, y], ...]
  };
}

// Looks along a cone (and feels the 8 cells around, like a bumper). Returns the cells newly seen.
// Rays stop at the first opaque cell (building, tree, rock, bush) and where the ground rises
// above the eye (a cliff, a hill).
export function look(world, k, node, facing, range, coneDeg, step) {
  const { W, H } = world;
  const x0 = (node % W) + 0.5;
  const y0 = Math.floor(node / W) + 0.5;
  const eye = (world.elev ? world.elev[node] : 0) + 2;
  const fresh = [];
  const mark = (i) => {
    if (k.known[i] !== -1) return;
    k.known[i] = world.walk[i] ? 0 : 1;
    k.seenAt[i] = step;
    k.knownCount++;
    fresh.push(i);
  };
  mark(node);
  for (const [dx, dy] of DIRS8) {
    const x = (node % W) + dx;
    const y = Math.floor(node / W) + dy;
    if (x >= 0 && y >= 0 && x < W && y < H) mark(y * W + x);
  }
  const opaque = world.opaque ?? null;
  const half = (coneDeg * Math.PI) / 360;
  const cone = [[x0, y0]];
  const rays = Math.max(8, Math.round(coneDeg / 3));
  for (let r = 0; r <= rays; r++) {
    const a = facing - half + (2 * half * r) / rays;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    let t = 0;
    let end = range;
    while (t < range) {
      t += 0.25;
      const x = Math.floor(x0 + ca * t);
      const y = Math.floor(y0 + sa * t);
      if (x < 0 || y < 0 || x >= W || y >= H) { end = t; break; }
      const i = y * W + x;
      mark(i);
      if (opaque ? opaque[i] : !world.walk[i]) { end = t; break; }
      if (world.elev && world.elev[i] > eye + 3) { end = t; break; }
    }
    cone.push([x0 + ca * end, y0 + sa * end]);
  }
  k.lastCone = cone;
  return fresh;
}

// Shortest walks on the agent's own map from `from` (8 directions, no cutting a corner it knows
// or does not know to be open). Unknown cells count as blocked, unless `optimistic`.
// `avoid(m)` adds a cost to stepping onto m (danger, cold, deep snow). `stopAt`: stop early once
// this cell is settled (then only the route to it is exact).
const heapK = { keys: new Float64Array(1 << 14), vals: new Int32Array(1 << 14) };
export function plan(world, k, from, { optimistic = false, avoid = null, stopAt = -1 } = {}) {
  const { W, H } = world;
  const N = W * H;
  const dist = new Float64Array(N).fill(Infinity);
  const prev = new Int32Array(N).fill(-1);
  const known = k.known;
  const open = optimistic
    ? (i) => known[i] === 0 || (known[i] === -1 && world.ground[i] !== G.WALL)
    : (i) => known[i] === 0;
  let keys = heapK.keys; let vals = heapK.vals; let size = 0;
  const push = (d, n) => {
    if (size >= keys.length) {
      const k2 = new Float64Array(keys.length * 2); k2.set(keys); const v2 = new Int32Array(vals.length * 2); v2.set(vals);
      heapK.keys = keys = k2; heapK.vals = vals = v2;
    }
    let i = size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= d) break;
      keys[i] = keys[p]; vals[i] = vals[p]; i = p;
    }
    keys[i] = d; vals[i] = n;
  };
  const pop = () => {
    const n = vals[0];
    const d = keys[--size];
    const v = vals[size];
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      if (l >= size) break;
      const r = l + 1;
      const m = r < size && keys[r] < keys[l] ? r : l;
      if (keys[m] >= d) break;
      keys[i] = keys[m]; vals[i] = vals[m]; i = m;
    }
    keys[i] = d; vals[i] = v;
    return n;
  };
  dist[from] = 0;
  push(0, from);
  while (size) {
    const dTop = keys[0];
    const n = pop();
    if (dTop > dist[n]) continue;
    if (n === stopAt) break;
    const x = n % W;
    const y = (n - x) / W;
    for (let q = 0; q < 8; q++) {
      const dx = DIRS8[q][0]; const dy = DIRS8[q][1];
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const m = ny * W + nx;
      if (!open(m)) continue;
      if (dx && dy && (!open(y * W + nx) || !open(ny * W + x))) continue;
      let c = dx && dy ? Math.SQRT2 : 1;
      if (avoid) c += avoid(m) * (dx && dy ? Math.SQRT2 : 1);
      const nd = dTop + c;
      if (nd < dist[m]) { dist[m] = nd; prev[m] = n; push(nd, m); }
    }
  }
  return { dist, prev };
}

// The first step from `from` toward `to` along a planned route (or `from` if there is none).
export function firstStep(route, from, to) {
  if (to === from || route.prev[to] === -1) return from;
  let n = to;
  while (route.prev[n] !== from && route.prev[n] !== -1) n = route.prev[n];
  return route.prev[n] === from ? n : from;
}

export function pathTo(route, to) {
  const out = [];
  for (let n = to; n !== -1; n = route.prev[n]) out.push(n);
  return out.reverse();
}

// Frontier cells: open ground it knows, next to ground it has never seen.
export function frontiers(world, k) {
  const { W, H } = world;
  const out = [];
  for (let i = 0; i < W * H; i++) {
    if (k.known[i] !== 0) continue;
    const x = i % W;
    const y = Math.floor(i / W);
    for (const [dx, dy] of DIRS4) {
      const nx = x + dx; const ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < W && ny < H && k.known[ny * W + nx] === -1) { out.push(i); break; }
    }
  }
  return out;
}

// ---------------------------------------------------------------- landmarks
//
// A landmark is stored relative to something the agent already knew: its starting point, or the
// landmark it made just before. The global position is kept only to draw it.

const COMPASS = (dx, dy, m = 1) => {
  const parts = [];
  const u = m === 1 ? '' : ' m';
  if (dx) parts.push(`${Math.abs(dx) * m}${u} ${dx > 0 ? 'E' : 'W'}`);
  if (dy) parts.push(`${Math.abs(dy) * m}${u} ${dy > 0 ? 'S' : 'N'}`);
  return parts.length ? parts.join(', ') : 'right at';
};

export function addLandmark(world, k, { kind, cell, step, note = '', data = null }) {
  const { W } = world;
  const x = cell % W;
  const y = Math.floor(cell / W);
  const refs = k.landmarks.filter((l) => !['heard', 'seen', 'caught', 'froze', 'supply'].includes(l.kind));
  const ref = refs.length ? refs[refs.length - 1] : k.origin;
  k.counters = k.counters ?? {};
  const counts = (k.counters[kind] = (k.counters[kind] ?? 0) + 1);
  const prefix = { deadend: 'D', clearing: 'C', corner: 'K', warm: 'W', supply: 'U', exit: 'H', heard: 'S', seen: 'X', start: 'O', caught: '†', froze: '*' }[kind] ?? '?';
  const id = `${prefix}${counts}`;
  const lm = {
    id, kind, cell, x, y, step, note, data,
    ref: ref ? ref.id : null,
    dx: ref ? x - ref.x : 0,
    dy: ref ? y - ref.y : 0,
  };
  lm.text = ref ? `${COMPASS(lm.dx, lm.dy, world.cellM ?? 1)} of ${ref.id}` : 'where it began';
  k.landmarks.push(lm);
  // short-term memories fade: only the latest few sounds, sightings and catches are kept
  const keep = { heard: 6, seen: 3, caught: 8, froze: 6 }[kind];
  if (keep) {
    const same = k.landmarks.filter((l) => l.kind === kind);
    if (same.length > keep) k.landmarks.splice(k.landmarks.indexOf(same[0]), 1);
  }
  return lm;
}

// Is there already a landmark of this kind within `r` cells?
export function nearLandmark(world, k, kind, cell, r) {
  const x = cell % world.W;
  const y = Math.floor(cell / world.W);
  return k.landmarks.some((l) => l.kind === kind && Math.max(Math.abs(l.x - x), Math.abs(l.y - y)) <= r);
}

// After a look: make landmarks for what it can now recognise around the newly seen cells.
//   exit       the refuge (hospital, subway) once it has seen its door
//   corner     a real street corner, named after the two streets (from OpenStreetMap)
//   warm       a warming centre, a subway entrance or a shop doorway: a place to get warm
//   supply     a cache the designer left (batteries, hand warmers, food)
//   dead end   a cul-de-sac: in the 9 x 9 cells around it, all known, only one way out
export function recognise(world, k, fresh, step, { notice = ['exit', 'corner', 'warm', 'supply', 'deadend'] } = {}) {
  const { W, H } = world;
  const made = [];
  if (!fresh.length) return made;
  const freshSet = new Set(fresh);
  const wants = new Set(notice);
  const seenNow = (cell) => freshSet.has(cell) && k.known[cell] === 0;
  if (wants.has('exit')) {
    for (const c of world.doorCells) {
      if (seenNow(c) && !nearLandmark(world, k, 'exit', c, 3)) made.push(addLandmark(world, k, { kind: 'exit', cell: world.door, step, note: world.refuge?.name ?? 'The refuge' }));
    }
  }
  if (wants.has('corner')) {
    for (const c of world.corners ?? []) if (seenNow(c.cell) && !nearLandmark(world, k, 'corner', c.cell, 4)) made.push(addLandmark(world, k, { kind: 'corner', cell: c.cell, step, note: c.name }));
  }
  if (wants.has('warm')) {
    for (const w of world.warmSpots ?? []) if (seenNow(w.cell) && !nearLandmark(world, k, 'warm', w.cell, 2)) made.push(addLandmark(world, k, { kind: 'warm', cell: w.cell, step, note: w.name, data: { gain: w.gain, type: w.type } }));
  }
  if (wants.has('supply')) {
    for (const c of world.caches ?? []) if (!c.taken && seenNow(c.cell) && !k.landmarks.some((l) => l.kind === 'supply' && l.cell === c.cell)) made.push(addLandmark(world, k, { kind: 'supply', cell: c.cell, step, note: CACHE_NAMES[c.type], data: { type: c.type } }));
  }
  if (wants.has('deadend')) {
    const check = new Set();
    for (const i of fresh) {
      const x = i % W; const y = Math.floor(i / W);
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const nx = x + dx; const ny = y + dy;
        if (nx > 4 && ny > 4 && nx < W - 5 && ny < H - 5) check.add(ny * W + nx);
      }
    }
    for (const i of check) {
      if (k.known[i] !== 0 || nearLandmark(world, k, 'deadend', i, 4)) continue;
      if (isCulDeSac(world, k, i)) made.push(addLandmark(world, k, { kind: 'deadend', cell: i, step, note: 'A dead end' }));
    }
  }
  return made;
}

export const CACHE_NAMES = { battery: 'Batteries', warmers: 'Hand warmers', food: 'Food and a thermos' };

// In the 9 x 9 window around i (all known), the open cells connected to i reach the edge of the
// window in exactly one place, i itself is at least 3 cells from the edge it reaches, and the
// pocket is small: a cul-de-sac.
function isCulDeSac(world, k, i, R = 4) {
  const { W } = world;
  const x0 = i % W; const y0 = Math.floor(i / W);
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) if (k.known[(y0 + dy) * W + x0 + dx] === -1) return false;
  const seen = new Set([i]);
  const stack = [i];
  const ring = [];
  while (stack.length) {
    const n = stack.pop();
    const x = n % W; const y = Math.floor(n / W);
    if (Math.max(Math.abs(x - x0), Math.abs(y - y0)) === R) { ring.push(n); continue; }
    for (const [dx, dy] of DIRS4) {
      const m = (y + dy) * W + x + dx;
      if (!seen.has(m) && k.known[m] === 0) { seen.add(m); stack.push(m); }
    }
  }
  if (!ring.length || seen.size > 34) return false;
  // group the reached edge cells: neighbours along the ring belong together
  const left = new Set(ring);
  let groups = 0;
  while (left.size) {
    groups++;
    const st = [left.values().next().value];
    left.delete(st[0]);
    while (st.length) {
      const n = st.pop();
      for (const m of [...left]) if (Math.max(Math.abs((m % W) - (n % W)), Math.abs(Math.floor(m / W) - Math.floor(n / W))) <= 1) { left.delete(m); st.push(m); }
    }
  }
  if (groups !== 1) return false;
  // the agent stands deep inside: far from where the pocket opens
  const mx = ring.reduce((s, n) => s + (n % W), 0) / ring.length; const my = ring.reduce((s, n) => s + Math.floor(n / W), 0) / ring.length;
  return Math.hypot(mx - x0, my - y0) >= 3.2;
}
