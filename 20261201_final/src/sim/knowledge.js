// What one agent knows about the store: its own map, built only from what it has seen.
//
//   known[i]   -1 never seen, 0 floor, 1 something solid
//   cat[i]     the product category it has read on a shelf cell (-1 unread)
//   zone[i]    the floor zone it has noticed (wet, dark, noisy, mat)
//   visits[i]  how often it stood there (its trajectory, as a heatmap)
//   landmarks  places it decided to remember, each stored relative to the one before it
//
// Planning uses only this map, never the true store.

import { T, Z } from './store.js';
import { CATS, CAT_LABEL } from './config.js';

const DIRS8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export function makeKnowledge(world, name, originCell) {
  const N = world.W * world.H;
  const k = {
    name,
    known: new Int8Array(N).fill(-1),
    cat: new Int8Array(N).fill(-1),
    zone: new Int8Array(N).fill(-1),
    visits: new Uint16Array(N),
    landmarks: [],
    counters: {},
    knownCount: 0,
    lastCone: [],
    origin: { id: 'O', x: originCell % world.W, y: Math.floor(originCell / world.W) },
  };
  return k;
}

// Solid top of a cell (cells of height), 0 for open floor
const topOf = (world, i) => { const s = world.solids[i]; return s.length ? s[s.length - 1][1] : 0; };

// Looks along a cone. Rays pass over anything lower than the eye (you can see across a 54" gondola
// when you stand) and stop at anything taller. Returns the newly known cells and what was read.
export function look(world, k, node, facing, { range, coneDeg, eyeCells, readRange = 0, signRange = 0, step = 0 }) {
  const { W, H } = world;
  const x0 = (node % W) + 0.5; const y0 = Math.floor(node / W) + 0.5;
  const fresh = []; const read = [];
  const mark = (i, t) => {
    if (k.known[i] === -1) { k.known[i] = world.walk[i] ? 0 : 1; k.knownCount++; fresh.push(i); }
    if (world.walk[i] && k.zone[i] === -1 && (world.zone[i] !== Z.DARK || t < 3)) k.zone[i] = world.zone[i];
    if (readRange && world.cat[i] >= 0 && k.cat[i] === -1 && t <= readRange * (world.light[i] < 0.3 ? 0.5 : 1)) {
      k.cat[i] = world.cat[i]; read.push(i);
    }
  };
  mark(node, 0);
  for (const [dx, dy] of DIRS8) {
    const x = (node % W) + dx; const y = Math.floor(node / W) + dy;
    if (x >= 0 && y >= 0 && x < W && y < H) mark(y * W + x, 1);
  }
  const half = (coneDeg * Math.PI) / 360;
  const cone = [[x0, y0]];
  const rays = Math.max(10, Math.round(coneDeg / 3));
  const signsSeen = new Set();
  for (let r = 0; r <= rays; r++) {
    const a = facing - half + (2 * half * r) / rays;
    const ca = Math.cos(a); const sa = Math.sin(a);
    let t = 0; let end = range; let lastCell = -1;
    while (t < range) {
      t += 0.25;
      const x = Math.floor(x0 + ca * t); const y = Math.floor(y0 + sa * t);
      if (x < 0 || y < 0 || x >= W || y >= H) { end = t; break; }
      const i = y * W + x;
      if (i === lastCell) continue;
      lastCell = i;
      // dark floor only shows itself up close
      if (world.light[i] < 0.3 && t > range * 0.45 && world.walk[i]) continue;
      mark(i, t);
      if (signRange && t <= signRange) for (const s of world.signs) if (s.cell === i) signsSeen.add(s.run);
      if (!world.walk[i] && topOf(world, i) >= eyeCells - 0.05) { end = t; break; }
    }
    cone.push([x0 + ca * end, y0 + sa * end]);
  }
  k.lastCone = cone;
  // an aisle sign tells it the whole gondola: where it is and what it holds
  const signs = [];
  for (const run of signsSeen) {
    let learned = 0;
    for (let i = 0; i < world.N; i++) {
      if (world.runOf[i] !== run) continue;
      if (k.known[i] === -1) { k.known[i] = 1; k.knownCount++; fresh.push(i); }
      if (k.cat[i] === -1) { k.cat[i] = world.cat[i]; learned++; read.push(i); }
    }
    if (learned) signs.push(run);
  }
  return { fresh, read, signs };
}

// Shortest walks on the agent's own map (8 directions, no corner cutting). `cost(i)` adds to each step.
// Unknown cells are blocked unless `optimistic` (then they cost a little extra).
export function plan(world, k, from, { optimistic = false, cost = null, blocked = null } = {}) {
  const { W, H } = world;
  const N = W * H;
  const dist = new Float64Array(N).fill(Infinity);
  const prev = new Int32Array(N).fill(-1);
  const open = (i) => (k.known[i] === 0 && world.walk[i]) || (optimistic && k.known[i] === -1 && world.type[i] !== T.WALL && world.type[i] !== T.GLASS);
  dist[from] = 0;
  const heap = new MinHeap();
  heap.push(0, from);
  while (heap.size) {
    const [d, n] = heap.pop();
    if (d > dist[n]) continue;
    const x = n % W; const y = Math.floor(n / W);
    for (const [dx, dy] of DIRS8) {
      const nx = x + dx; const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const m = ny * W + nx;
      if (!open(m) || (blocked && blocked.has(m))) continue;
      if (dx && dy && (!open(y * W + nx) || !open(ny * W + x))) continue;
      let c = dx && dy ? Math.SQRT2 : 1;
      if (k.known[m] === -1) c += 0.6;
      if (cost) c = Math.max(0.2, c + cost(m));
      if (d + c < dist[m]) { dist[m] = d + c; prev[m] = n; heap.push(d + c, m); }
    }
  }
  return { dist, prev, from };
}

export function pathTo(route, to) {
  if (route.dist[to] === Infinity) return [];
  const out = [];
  for (let n = to; n !== -1; n = route.prev[n]) out.push(n);
  return out.reverse();
}

// Frontier cells: floor it knows, next to ground it has never seen.
export function frontiers(world, k) {
  const { W, H } = world;
  const out = [];
  for (let i = 0; i < W * H; i++) {
    if (k.known[i] !== 0 || !world.walk[i]) continue;
    const x = i % W; const y = Math.floor(i / W);
    for (const [dx, dy] of DIRS4) {
      const nx = x + dx; const ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < W && ny < H && k.known[ny * W + nx] === -1) { out.push(i); break; }
    }
  }
  return out;
}

// Floor cells next to a shelf it has read as holding `catIndex`
export function knownAccess(world, k, catIndex) {
  const { W, N } = world;
  const out = [];
  for (let i = 0; i < N; i++) {
    if (k.cat[i] !== catIndex) continue;
    const x = i % W; const y = Math.floor(i / W);
    for (const [dx, dy] of DIRS4) {
      const j = (y + dy) * W + (x + dx);
      if (j >= 0 && j < N && world.walk[j] && k.known[j] === 0 && !out.includes(j)) out.push(j);
    }
  }
  return out;
}

// ---------------------------------------------------------------- landmarks
//
// Location 3: each landmark is stored relative to the one made before it ("4 m E, 1.5 m N of D2"),
// the way you give directions, not as coordinates. The grid position is kept only to draw it.

const PREFIX = { item: 'I', sign: 'A', deadend: 'D', hide: 'H', heard: 'S', seen: 'X', caught: '†', exit: 'E', hunt: 'K' };

const compass = (dx, dy) => {
  const m = (v) => `${(Math.abs(v) * 0.5).toFixed(1).replace(/\.0$/, '')} m`;
  const parts = [];
  if (dx) parts.push(`${m(dx)} ${dx > 0 ? 'E' : 'W'}`);
  if (dy) parts.push(`${m(dy)} ${dy > 0 ? 'S' : 'N'}`);
  return parts.length ? parts.join(', ') : 'right at';
};

export function addLandmark(world, k, { kind, cell, step, note = '', weight = 1 }) {
  const x = cell % world.W; const y = Math.floor(cell / world.W);
  const stable = k.landmarks.filter((l) => !['heard', 'seen'].includes(l.kind));
  const ref = stable.length ? stable[stable.length - 1] : k.origin;
  const n = (k.counters[kind] = (k.counters[kind] ?? 0) + 1);
  const lm = { id: `${PREFIX[kind] ?? '?'}${n}`, kind, cell, x, y, step, note, weight, ref: ref.id, dx: x - ref.x, dy: y - ref.y };
  lm.text = `${compass(lm.dx, lm.dy)} of ${ref.id}`;
  k.landmarks.push(lm);
  const keep = { heard: 6, seen: 3, caught: 8 }[kind];
  if (keep) {
    const same = k.landmarks.filter((l) => l.kind === kind);
    if (same.length > keep) k.landmarks.splice(k.landmarks.indexOf(same[0]), 1);
  }
  return lm;
}

export function nearLandmark(world, k, kind, cell, r) {
  const x = cell % world.W; const y = Math.floor(cell / world.W);
  return k.landmarks.find((l) => l.kind === kind && Math.max(Math.abs(l.x - x), Math.abs(l.y - y)) <= r) ?? null;
}

// Landmarks it can recognise around newly seen cells: dead ends (closed on three sides) and hiding
// places (floor in the dark, or tucked behind a tall gondola at the end of an aisle).
export function recognise(world, k, fresh, step) {
  const { W, H } = world;
  const made = [];
  const check = new Set();
  for (const i of fresh) {
    const x = i % W; const y = Math.floor(i / W);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const nx = x + dx; const ny = y + dy;
      if (nx > 0 && ny > 0 && nx < W - 1 && ny < H - 1) check.add(ny * W + nx);
    }
  }
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
    if (k.known[i] !== 0 || !world.walk[i]) continue;
    const r = DIRS4.map(([dx, dy]) => reach(i, dx, dy, 3));
    if (r.some((v) => v === Infinity)) continue;
    const closed = r.filter((v) => v <= 1).length;
    if (closed >= 3 && !nearLandmark(world, k, 'deadend', i, 3)) made.push(addLandmark(world, k, { kind: 'deadend', cell: i, step, note: 'Dead end' }));
    else if (k.zone[i] === Z.DARK && !nearLandmark(world, k, 'hide', i, 4)) made.push(addLandmark(world, k, { kind: 'hide', cell: i, step, note: 'Dark corner' }));
  }
  return made;
}

export function itemLandmark(world, k, shelfCell, step, how) {
  const c = world.cat[shelfCell];
  const label = CAT_LABEL[CATS[c]];
  const x = shelfCell % world.W; const y = Math.floor(shelfCell / world.W);
  const run = world.runOf[shelfCell];
  // one landmark per gondola (or per stretch of cooler or counter) and product
  if (k.landmarks.some((l) => (l.kind === 'item' || l.kind === 'sign') && l.note.startsWith(label)
    && ((run >= 0 && world.runOf[l.cell] === run) || (run < 0 && Math.max(Math.abs(l.x - x), Math.abs(l.y - y)) <= 8)))) return null;
  return addLandmark(world, k, { kind: how === 'sign' ? 'sign' : 'item', cell: shelfCell, step, note: `${label}${how === 'sign' ? ' (aisle sign)' : ''}` });
}

class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(d, n) {
    const a = this.a; a.push([d, n]);
    let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop() {
    const a = this.a; const top = a[0]; const last = a.pop();
    if (a.length) {
      a[0] = last; let i = 0;
      for (;;) {
        const l = 2 * i + 1; const r = l + 1; let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top;
  }
}
