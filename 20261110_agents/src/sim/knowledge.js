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
export function look(world, k, node, facing, range, coneDeg, step) {
  const { W, H } = world;
  const x0 = (node % W) + 0.5;
  const y0 = Math.floor(node / W) + 0.5;
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
      t += 0.2;
      const x = Math.floor(x0 + ca * t);
      const y = Math.floor(y0 + sa * t);
      if (x < 0 || y < 0 || x >= W || y >= H) { end = t; break; }
      const i = y * W + x;
      mark(i);
      if (!world.walk[i]) { end = t; break; }
    }
    cone.push([x0 + ca * end, y0 + sa * end]);
  }
  k.lastCone = cone;
  return fresh;
}

// Shortest walks on the agent's own map from `from` (8 directions, no cutting a corner it knows
// or does not know to be open). Unknown cells count as blocked, unless `optimistic`.
export function plan(world, k, from, { optimistic = false, avoid = null } = {}) {
  const { W, H } = world;
  const N = W * H;
  const dist = new Float64Array(N).fill(Infinity);
  const prev = new Int32Array(N).fill(-1);
  const open = (i) => (k.known[i] === 0 || (optimistic && k.known[i] === -1 && world.ground[i] !== G.WALL));
  dist[from] = 0;
  const heap = [[0, from]];
  const push = (d, n) => {
    heap.push([d, n]);
    let i = heap.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1; const r = l + 1; let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]]; i = m;
      }
    }
    return top;
  };
  while (heap.length) {
    const [d, n] = pop();
    if (d > dist[n]) continue;
    const x = n % W;
    const y = Math.floor(n / W);
    for (const [dx, dy] of DIRS8) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const m = ny * W + nx;
      if (!open(m)) continue;
      if (dx && dy && (!open(y * W + nx) || !open(ny * W + x))) continue;
      let c = dx && dy ? Math.SQRT2 : 1;
      if (avoid) c += avoid(m);
      if (d + c < dist[m]) { dist[m] = d + c; prev[m] = n; push(d + c, m); }
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

const COMPASS = (dx, dy) => {
  const parts = [];
  if (dx) parts.push(`${Math.abs(dx)} ${dx > 0 ? 'E' : 'W'}`);
  if (dy) parts.push(`${Math.abs(dy)} ${dy > 0 ? 'S' : 'N'}`);
  return parts.length ? parts.join(', ') : 'right at';
};

export function addLandmark(world, k, { kind, cell, step, note = '' }) {
  const { W } = world;
  const x = cell % W;
  const y = Math.floor(cell / W);
  const refs = k.landmarks.filter((l) => l.kind !== 'heard' && l.kind !== 'seen');
  const ref = refs.length ? refs[refs.length - 1] : k.origin;
  k.counters = k.counters ?? {};
  const counts = (k.counters[kind] = (k.counters[kind] ?? 0) + 1);
  const prefix = { deadend: 'D', clearing: 'C', exit: 'H', heard: 'S', seen: 'X', start: 'O', caught: '†' }[kind] ?? '?';
  const id = `${prefix}${counts}`;
  const lm = {
    id, kind, cell, x, y, step, note,
    ref: ref ? ref.id : null,
    dx: ref ? x - ref.x : 0,
    dy: ref ? y - ref.y : 0,
  };
  lm.text = ref ? `${COMPASS(lm.dx, lm.dy)} of ${ref.id}` : 'where it began';
  k.landmarks.push(lm);
  // short-term memories fade: only the latest few sounds, sightings and catches are kept
  const keep = { heard: 5, seen: 3, caught: 6 }[kind];
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
//   dead end   3 of the 4 directions are closed within 2 cells (the end of a 2-wide corridor)
//   clearing   open for at least 3 cells in all 4 directions
//   exit       it has seen the hospital door
export function recognise(world, k, fresh, step) {
  const { W, H } = world;
  const made = [];
  const check = new Set();
  for (const i of fresh) {
    const x = i % W; const y = Math.floor(i / W);
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const nx = x + dx; const ny = y + dy;
      if (nx > 0 && ny > 0 && nx < W - 1 && ny < H - 1) check.add(ny * W + nx);
    }
  }
  // how far it knows the ground is open in one direction (Infinity: it does not know yet)
  const reach = (i, dx, dy, max) => {
    let x = i % W; let y = Math.floor(i / W);
    for (let s = 1; s <= max; s++) {
      x += dx; y += dy;
      const v = k.known[y * W + x];
      if (v === -1) return Infinity;
      if (v === 1) return s - 1;
    }
    return max;
  };
  for (const i of check) {
    if (k.known[i] !== 0) continue;
    if (i === world.door || world.doorCells.includes(i)) {
      if (!nearLandmark(world, k, 'exit', i, 3)) made.push(addLandmark(world, k, { kind: 'exit', cell: world.door, step, note: 'The hospital door' }));
      continue;
    }
    const r = DIRS4.map(([dx, dy]) => reach(i, dx, dy, 3));
    if (r.some((v) => v === Infinity)) continue;
    const closed = r.filter((v) => v <= 1).length;
    if (closed >= 3 && !nearLandmark(world, k, 'deadend', i, 2)) {
      made.push(addLandmark(world, k, { kind: 'deadend', cell: i, step, note: 'A dead end' }));
    } else if (r.every((v) => v >= 3) && !nearLandmark(world, k, 'clearing', i, 5)) {
      made.push(addLandmark(world, k, { kind: 'clearing', cell: i, step, note: 'A clearing' }));
    }
  }
  return made;
}
