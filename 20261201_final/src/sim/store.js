// The store: a genome (a short description an environment designer can edit or evolve) and the
// grid world built from it.
//
//   genome = { door, back: {side, pos}, counter, fridge, runs: [...], boxes: [...], zones: [...] }
//   run    = { x, y, len, dir: 'v' | 'h', tall, cat, sign }   a double-sided gondola, 1 m deep
//
// The world is a W x H grid of 0.5 m cells. Every cell has a type, a floor zone, a list of solid
// vertical intervals (for 3D sight and sound), and, for shelf cells, a product category.

import { CONFIG, CELL, CATS } from './config.js';
import { makeRng } from './rng.js';

export const T = { FLOOR: 0, WALL: 1, TALL: 2, LOW: 3, FRIDGE: 4, COUNTER: 5, BOXES: 6, DOOR: 7, BACK: 8, GLASS: 9 };
export const TYPE_NAME = ['floor', 'wall', 'tall', 'low', 'fridge', 'counter', 'boxes', 'door', 'back', 'glass'];
export const Z = { NONE: 0, WET: 1, DARK: 2, NOISY: 3, MAT: 4 };
export const ZONE_NAME = ['none', 'wet', 'dark', 'noisy', 'mat'];
const SOLID_H = { 1: 'wall', 2: 'tall', 3: 'low', 4: 'fridge', 5: 'counter', 6: 'boxes', 9: 'glass' };

const clone = (g) => JSON.parse(JSON.stringify(g));
export const newId = () => `S-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

export function runCells(r) {
  const out = [];
  if (r.dir === 'v') for (let y = r.y; y < r.y + r.len; y++) for (let x = r.x; x < r.x + 2; x++) out.push([x, y]);
  else for (let y = r.y; y < r.y + 2; y++) for (let x = r.x; x < r.x + r.len; x++) out.push([x, y]);
  return out;
}

// The two end cells of a run where its aisle sign hangs (the end facing the storefront, or the west end)
export function signCellsOf(r) {
  return r.dir === 'v' ? [[r.x, r.y + r.len - 1], [r.x + 1, r.y + r.len - 1]] : [[r.x, r.y], [r.x, r.y + 1]];
}

// ---------------------------------------------------------------- build

export function buildStore(genomeIn, cfg = CONFIG) {
  const genome = clone(genomeIn);
  const { W, H } = cfg;
  const N = W * H;
  const type = new Uint8Array(N);
  const zone = new Uint8Array(N);
  const cat = new Int8Array(N).fill(-1);
  const runOf = new Int16Array(N).fill(-1);
  const at = (x, y) => y * W + x;
  const inside = (x, y) => x >= 1 && y >= 1 && x < W - 1 && y < H - 1;
  const problems = [];

  // walls, storefront glass and the door
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!inside(x, y)) type[at(x, y)] = T.WALL;
  genome.door = Math.max(3, Math.min(W - 6, genome.door | 0));
  for (let x = 2; x < W - 2; x++) type[at(x, H - 1)] = T.GLASS;
  const doorCells = [];
  for (let x = genome.door; x < genome.door + 3; x++) { type[at(x, H - 1)] = T.DOOR; doorCells.push(at(x, H - 1)); }
  // front zone: the 3 rows inside the door stay clear
  const front = (x, y) => y >= H - 4 && Math.abs(x - (genome.door + 1)) <= 3;

  // the back (stockroom) door, where the creature comes in
  const b = genome.back;
  let backCell;
  if (b.side === 'N') { b.pos = Math.max(2, Math.min(W - 4, b.pos)); backCell = at(b.pos, 0); }
  else if (b.side === 'E') { b.pos = Math.max(2, Math.min(H - 7, b.pos)); backCell = at(W - 1, b.pos); }
  else { b.side = 'W'; b.pos = Math.max(2, Math.min(H - 7, b.pos)); backCell = at(0, b.pos); }
  type[backCell] = T.BACK;
  const bx = backCell % W; const by = Math.floor(backCell / W);
  const nearBack = (x, y) => Math.max(Math.abs(x - bx), Math.abs(y - by)) <= 2;

  // reach-in coolers along one wall (water lives here)
  const f = genome.fridge;
  const fridgeCells = [];
  if (f === 'N') for (let x = 2; x < W - 2; x++) fridgeCells.push([x, 1]);
  else if (f === 'E') for (let y = 2; y < H - 7; y++) fridgeCells.push([W - 2, y]);
  else for (let y = 2; y < H - 7; y++) fridgeCells.push([1, y]);
  for (const [x, y] of fridgeCells) if (!nearBack(x, y)) { type[at(x, y)] = T.FRIDGE; cat[at(x, y)] = CATS.indexOf('water'); }

  // the checkout counter beside the door (medicine sits behind the register)
  const cy = H - 6;
  let cx0; let cx1;
  if (genome.counter === 'L') { cx1 = genome.door - 3; cx0 = Math.max(3, cx1 - 6); }
  else { cx0 = genome.door + 5; cx1 = Math.min(W - 4, cx0 + 6); }
  if (cx1 - cx0 >= 3) {
    for (let y = cy; y < cy + 2; y++) for (let x = cx0; x <= cx1; x++) { type[at(x, y)] = T.COUNTER; cat[at(x, y)] = CATS.indexOf('medicine'); }
  }

  // a fixture fits if its footprint and a one-cell margin around it are open floor
  const fits = (cells) => cells.every(([x, y]) => {
    if (x < 2 || y < 2 || x > W - 3 || y > H - 3 || front(x, y) || nearBack(x, y)) return false;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const t = type[at(x + dx, y + dy)];
      if (t !== T.FLOOR) return false;
    }
    return true;
  });

  const placed = [];
  for (const r of genome.runs) {
    r.len = Math.max(3, Math.min(r.dir === 'v' ? 18 : 28, r.len | 0));
    const cells = runCells(r);
    if (!fits(cells)) { problems.push('run'); continue; }
    if (!CATS.includes(r.cat)) r.cat = 'food';
    const id = placed.length;
    for (const [x, y] of cells) { const i = at(x, y); type[i] = r.tall ? T.TALL : T.LOW; cat[i] = CATS.indexOf(r.cat); runOf[i] = id; }
    placed.push(r);
  }
  genome.runs = placed;
  const boxes = [];
  for (const bxs of genome.boxes) {
    const cells = [[bxs.x, bxs.y], [bxs.x + 1, bxs.y], [bxs.x, bxs.y + 1], [bxs.x + 1, bxs.y + 1]];
    if (!fits(cells)) continue;
    for (const [x, y] of cells) type[at(x, y)] = T.BOXES;
    boxes.push(bxs);
  }
  genome.boxes = boxes;

  // floor zones (only on open floor)
  const zones = [];
  for (const zz of genome.zones) {
    zz.w = Math.max(2, Math.min(8, zz.w | 0)); zz.h = Math.max(2, Math.min(8, zz.h | 0));
    zz.x = Math.max(1, Math.min(W - 1 - zz.w, zz.x | 0)); zz.y = Math.max(1, Math.min(H - 1 - zz.h, zz.y | 0));
    const k = Z[zz.kind.toUpperCase()];
    if (!k) continue;
    for (let y = zz.y; y < zz.y + zz.h; y++) for (let x = zz.x; x < zz.x + zz.w; x++) if (type[at(x, y)] === T.FLOOR) zone[at(x, y)] = k;
    zones.push(zz);
  }
  genome.zones = zones;

  const walk = new Uint8Array(N);
  for (let i = 0; i < N; i++) walk[i] = type[i] === T.FLOOR || type[i] === T.DOOR || type[i] === T.BACK ? 1 : 0;

  // solids in cell units: [bottom, top, material]
  const hz = (m) => m / CELL;
  const solids = new Array(N);
  for (let i = 0; i < N; i++) {
    const m = SOLID_H[type[i]];
    if (!m) { solids[i] = []; continue; }
    if (type[i] === T.GLASS) solids[i] = [[0, hz(cfg.window.sill), 'wall'], [hz(cfg.window.sill), hz(cfg.window.head), 'glass'], [hz(cfg.window.head), hz(cfg.heights.wall), 'wall']];
    else solids[i] = [[0, hz(cfg.heights[m]), m]];
  }

  const signs = [];
  placed.forEach((r, id) => { if (r.sign) for (const [x, y] of signCellsOf(r)) signs.push({ cell: at(x, y), run: id }); });

  const entry = at(genome.door + 1, H - 2);
  const world = {
    cfg, W, H, N, type, zone, cat, runOf, walk, solids, genome, doorCells, entry, lair: backCell, signs,
    counter: cx1 - cx0 >= 3 ? { x0: cx0, x1: cx1, y: cy } : null,
    light: new Float32Array(N).fill(0.75), sunlit: new Uint8Array(N), problems,
  };

  // reachability: every product category and the back door must be reachable from the door
  const dist = bfs(world, entry);
  world.reach = dist;
  world.access = {};
  for (let c = 0; c < CATS.length; c++) world.access[CATS[c]] = [];
  for (let i = 0; i < N; i++) {
    if (!walk[i] || dist[i] < 0) continue;
    const x = i % W; const y = Math.floor(i / W);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const j = at(x + dx, y + dy);
      if (j >= 0 && j < N && cat[j] >= 0) { const list = world.access[CATS[cat[j]]]; if (!list.includes(i)) list.push(i); }
    }
  }
  world.missing = CATS.filter((c) => world.access[c].length === 0);
  world.ok = world.missing.length === 0 && dist[backCell] >= 0 && placed.length >= 2;
  world.addr = addresses(world);
  return world;
}

// Breadth-first walking distance (8 directions, no corner cutting), -1 where unreachable
export function bfs(world, from) {
  const { W, H, walk } = world;
  const d = new Int32Array(W * H).fill(-1);
  d[from] = 0;
  const q = [from];
  for (let h = 0; h < q.length; h++) {
    const n = q[h]; const x = n % W; const y = Math.floor(n / W);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx; const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const m = ny * W + nx;
      if (!walk[m] || d[m] >= 0) continue;
      if (dx && dy && (!walk[y * W + nx] || !walk[ny * W + x])) continue;
      d[m] = d[n] + 1; q.push(m);
    }
  }
  return d;
}

// ---------------------------------------------------------------- the store's own frame of reference
//
// Location 2: an address in the store, the way staff would say it. "G3 · west face · bay 2" for a
// shelf cell, "Aisle beside G3 (Batteries)" for floor next to one, or a named zone.

export function addresses(world) {
  const { W, H, N, type, runOf, genome } = world;
  const out = new Array(N);
  const names = genome.runs.map((_, i) => `G${i + 1}`);
  const doorX = genome.door + 1;
  for (let i = 0; i < N; i++) {
    const x = i % W; const y = Math.floor(i / W);
    const t = type[i];
    if (t === T.WALL || t === T.GLASS) { out[i] = t === T.GLASS ? 'Storefront glass' : 'Wall'; continue; }
    if (t === T.DOOR) { out[i] = 'Front door'; continue; }
    if (t === T.BACK) { out[i] = 'Stockroom door'; continue; }
    if (t === T.FRIDGE) { out[i] = `Cooler door ${Math.floor((genome.fridge === 'N' ? x : y) / 2)}`; continue; }
    if (t === T.COUNTER) { out[i] = 'Checkout counter'; continue; }
    if (t === T.BOXES) { out[i] = 'Stacked cartons'; continue; }
    if (runOf[i] >= 0) {
      const r = genome.runs[runOf[i]];
      const face = r.dir === 'v' ? (x === r.x ? 'west face' : 'east face') : (y === r.y ? 'north face' : 'south face');
      const along = r.dir === 'v' ? y - r.y : x - r.x;
      out[i] = `${names[runOf[i]]} · ${face} · bay ${Math.floor(along / 2) + 1}`;
      continue;
    }
    // floor: nearest named thing within 2 cells
    let best = null; let bd = 99;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const nx = x + dx; const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx; const d = Math.max(Math.abs(dx), Math.abs(dy));
      if (d >= bd) continue;
      if (runOf[j] >= 0) { best = `Aisle beside ${names[runOf[j]]} (${genome.runs[runOf[j]].cat})`; bd = d; }
      else if (type[j] === T.FRIDGE) { best = 'Cooler aisle'; bd = d; }
      else if (type[j] === T.COUNTER) { best = 'Register'; bd = d; }
      else if (type[j] === T.BACK) { best = 'By the stockroom door'; bd = d; }
    }
    if (!best) best = y >= H - 5 && Math.abs(x - doorX) <= 4 ? 'Entrance' : y >= H - 7 ? 'Front cross-aisle' : y <= 3 ? 'Back cross-aisle' : 'Open floor';
    out[i] = best;
  }
  return out;
}

// ---------------------------------------------------------------- generate

export function randomGenome(seed, cfg = CONFIG) {
  const rng = makeRng(seed);
  for (let attempt = 0; attempt < 200; attempt++) {
    const g = sketch(rng, cfg);
    const w = buildStore(g, cfg);
    if (w.ok) return { ...w.genome, id: newId(), parent: null, gen: 0, seed };
  }
  throw new Error('could not generate a store');
}

function sketch(rng, cfg) {
  const { W, H } = cfg;
  const fridge = rng.pick(['N', 'N', 'E', 'W']);
  const sides = ['N', 'E', 'W'].filter((s) => s !== fridge || rng.chance(0.3));
  const back = { side: rng.pick(sides), pos: 0 };
  back.pos = back.side === 'N' ? rng.int(3, W - 5) : rng.int(3, H - 9);
  const g = { door: rng.int(5, W - 9), back, counter: rng.pick(['L', 'R']), fridge, runs: [], boxes: [], zones: [] };
  const cats = ['food', 'batteries', 'warmers', 'food', 'medicine', 'batteries', 'warmers', 'food'];
  for (let i = cats.length - 1; i > 0; i--) { const j = rng.int(0, i); [cats[i], cats[j]] = [cats[j], cats[i]]; }
  let ci = 0;
  const tallShare = rng.next() * 0.7 + 0.15;
  const x0 = fridge === 'W' ? 4 : 3; const x1 = fridge === 'E' ? W - 5 : W - 4;
  const y0 = fridge === 'N' ? 4 : 3; const y1 = H - 8;
  if (rng.chance(0.62)) {
    // gondolas running north-south
    let x = x0 + rng.int(0, 1);
    while (x + 1 <= x1) {
      const split = rng.chance(0.4);
      const total = rng.int(Math.min(8, y1 - y0), y1 - y0 + 1);
      const y = y0 + rng.int(0, y1 - y0 + 1 - total);
      const tall = rng.chance(tallShare);
      if (split && total >= 9) {
        const a = rng.int(3, total - 5);
        g.runs.push({ x, y, len: a, dir: 'v', tall, cat: cats[ci++ % cats.length], sign: rng.chance(0.5) });
        g.runs.push({ x, y: y + a + 2, len: total - a - 2, dir: 'v', tall: rng.chance(tallShare), cat: cats[ci++ % cats.length], sign: rng.chance(0.5) });
      } else g.runs.push({ x, y, len: total, dir: 'v', tall, cat: cats[ci++ % cats.length], sign: rng.chance(0.5) });
      x += 2 + rng.int(2, 4);
    }
  } else {
    // gondolas running east-west
    let y = y0 + rng.int(0, 1);
    while (y + 1 <= y1) {
      const total = rng.int(10, x1 - x0 + 1);
      const x = x0 + rng.int(0, x1 - x0 + 1 - total);
      if (rng.chance(0.45) && total >= 12) {
        const a = rng.int(4, total - 6);
        g.runs.push({ x, y, len: a, dir: 'h', tall: rng.chance(tallShare), cat: cats[ci++ % cats.length], sign: rng.chance(0.5) });
        g.runs.push({ x: x + a + 2, y, len: total - a - 2, dir: 'h', tall: rng.chance(tallShare), cat: cats[ci++ % cats.length], sign: rng.chance(0.5) });
      } else g.runs.push({ x, y, len: total, dir: 'h', tall: rng.chance(tallShare), cat: cats[ci++ % cats.length], sign: rng.chance(0.5) });
      y += 2 + rng.int(2, 4);
    }
  }
  const nb = rng.int(0, 3);
  for (let i = 0; i < nb; i++) g.boxes.push({ x: rng.int(3, W - 5), y: rng.int(3, H - 7) });
  const zone = (kind, wMin, wMax) => g.zones.push({ kind, x: rng.int(2, W - 8), y: rng.int(2, H - 6), w: rng.int(wMin, wMax), h: rng.int(wMin, wMax) });
  for (let i = rng.int(0, 2); i > 0; i--) zone('wet', 2, 4);
  for (let i = rng.int(0, 2); i > 0; i--) zone('dark', 4, 7);
  for (let i = rng.int(0, 1); i > 0; i--) zone('noisy', 2, 4);
  for (let i = rng.int(0, 2); i > 0; i--) zone('mat', 2, 4);
  return g;
}

// ---------------------------------------------------------------- mutate
//
// One to three small edits a designer might make: move, stretch, turn, split or remove a gondola,
// change its height or products, move a door, repaint a floor zone. Invalid results are retried.

export function mutateGenome(parent, seed, cfg = CONFIG, strength = 1) {
  const rng = makeRng(seed);
  const { W, H } = cfg;
  for (let attempt = 0; attempt < 60; attempt++) {
    const g = clone(parent);
    delete g._m; delete g.edits;
    const edits = [];
    const n = Math.max(1, Math.round((rng.int(1, 3)) * strength));
    for (let e = 0; e < n; e++) {
      const op = rng.int(0, 13);
      const r = g.runs.length ? rng.pick(g.runs) : null;
      const name = r ? `G${g.runs.indexOf(r) + 1}` : '';
      if (op === 0 && r) { const d = rng.pick([-2, -1, 1, 2]); if (r.dir === 'v') r.x += d; else r.y += d; edits.push(`shifted ${name}`); }
      else if (op === 1 && r) { const d = rng.pick([-2, -1, 1, 2]); if (r.dir === 'v') r.y += d; else r.x += d; edits.push(`slid ${name}`); }
      else if (op === 2 && r) { r.len += rng.pick([-3, -2, 2, 3]); edits.push(`resized ${name}`); }
      else if (op === 3 && r) { r.tall = !r.tall; edits.push(`${name} ${r.tall ? 'raised to 72"' : 'lowered to 54"'}`); }
      else if (op === 4 && r) {
        const cx = r.dir === 'v' ? r.x + 1 : r.x + r.len / 2; const cy = r.dir === 'v' ? r.y + r.len / 2 : r.y + 1;
        r.dir = r.dir === 'v' ? 'h' : 'v'; r.len = Math.min(r.len, r.dir === 'v' ? 12 : 16);
        r.x = Math.round(r.dir === 'v' ? cx - 1 : cx - r.len / 2); r.y = Math.round(r.dir === 'v' ? cy - r.len / 2 : cy - 1);
        edits.push(`turned ${name}`);
      } else if (op === 5 && r && r.len >= 9) {
        const a = rng.int(3, r.len - 5); const tail = { ...r, len: r.len - a - 2 };
        if (r.dir === 'v') tail.y = r.y + a + 2; else tail.x = r.x + a + 2;
        r.len = a; g.runs.push(tail); edits.push(`opened a cross-aisle in ${name}`);
      } else if (op === 6 && r && g.runs.length > 3) { g.runs.splice(g.runs.indexOf(r), 1); edits.push(`removed ${name}`); }
      else if (op === 7) {
        const dir = rng.chance(0.5) ? 'v' : 'h';
        g.runs.push({ x: rng.int(3, W - 6), y: rng.int(3, H - 10), len: rng.int(4, 9), dir, tall: rng.chance(0.5), cat: rng.pick(['food', 'batteries', 'warmers', 'medicine']), sign: rng.chance(0.5) });
        edits.push('added a gondola');
      } else if (op === 8 && g.runs.length > 1) {
        const a = rng.pick(g.runs); const b2 = rng.pick(g.runs); [a.cat, b2.cat] = [b2.cat, a.cat];
        edits.push(`swapped products of G${g.runs.indexOf(a) + 1} and G${g.runs.indexOf(b2) + 1}`);
      } else if (op === 9 && r) { r.sign = !r.sign; edits.push(`${r.sign ? 'hung' : 'took down'} the sign on ${name}`); }
      else if (op === 10) { g.door += rng.pick([-4, -3, 3, 4]); edits.push('moved the front door'); }
      else if (op === 11) {
        if (rng.chance(0.5)) g.back.pos += rng.pick([-5, -3, 3, 5]);
        else { g.back.side = rng.pick(['N', 'E', 'W']); g.back.pos = g.back.side === 'N' ? rng.int(3, W - 5) : rng.int(3, H - 9); }
        edits.push('moved the stockroom door');
      } else if (op === 12) {
        const z = g.zones.length && rng.chance(0.6) ? rng.pick(g.zones) : null;
        if (z && rng.chance(0.35)) { g.zones.splice(g.zones.indexOf(z), 1); edits.push(`cleared a ${z.kind} floor`); }
        else if (z) { z.x += rng.int(-3, 3); z.y += rng.int(-3, 3); z.w += rng.int(-1, 1); z.h += rng.int(-1, 1); edits.push(`moved a ${z.kind} floor`); }
        else {
          const kind = rng.pick(['wet', 'dark', 'noisy', 'mat']);
          g.zones.push({ kind, x: rng.int(2, W - 8), y: rng.int(2, H - 6), w: rng.int(2, 5), h: rng.int(2, 5) });
          edits.push(`added a ${kind} floor`);
        }
      } else if (op === 13) {
        if (g.boxes.length && rng.chance(0.5)) { g.boxes.splice(rng.int(0, g.boxes.length - 1), 1); edits.push('cleared some cartons'); }
        else { g.boxes.push({ x: rng.int(3, W - 5), y: rng.int(3, H - 7) }); edits.push('stacked cartons'); }
      } else { g.counter = g.counter === 'L' ? 'R' : 'L'; edits.push('moved the counter'); }
    }
    const w = buildStore(g, cfg);
    if (w.ok && edits.length) return { ...w.genome, id: newId(), parent: parent.id, gen: (parent.gen ?? 0) + 1, edits };
  }
  const same = clone(parent); delete same._m;
  return { ...same, id: newId(), parent: parent.id, gen: (parent.gen ?? 0) + 1, edits: ['(no valid change found)'] };
}

export const cloneGenome = clone;
