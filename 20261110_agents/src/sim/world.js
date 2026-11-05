// Two-level misty forest on a grid.
// Ground level: trees, rows of bushes, rocks and a boundary wall.
// Canopy level (3 cells up): platforms joined by narrow bridges, with leaf clumps; open air elsewhere.
// Ladders connect the two levels. After generation every walkable cell is reachable from every other.

import { makeRng } from './rng.js';

export const G = { FREE: 0, TREE: 1, BUSH: 2, ROCK: 3, WALL: 4, LADDER: 5, LOG: 6, CAR: 7 };
export const C = { AIR: 0, PLATFORM: 1, BRIDGE: 2, FOLIAGE: 3, LADDER: 5 };

const DIRS8 = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

export function generateWorld(config, seed = config.seed) {
  const rng = makeRng(seed);
  const W = config.width;
  const H = config.height;
  const ground = new Uint8Array(W * H);
  const canopy = new Uint8Array(W * H);
  const idx = (x, y) => y * W + x;
  const inner = (x, y) => x > 0 && y > 0 && x < W - 1 && y < H - 1;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) if (!inner(x, y)) ground[idx(x, y)] = G.WALL;
  }

  // --- Canopy: platforms -------------------------------------------------
  // Best-candidate placement: of many random rectangles, keep the one farthest from the
  // platforms already placed, so the canopy spreads over the whole forest.
  const platforms = [];
  for (let k = 0; k < config.platformCount; k++) {
    let best = null;
    for (let attempt = 0; attempt < 60; attempt++) {
      const w = rng.int(4, 7);
      const h = rng.int(3, 5);
      const x0 = rng.int(2, W - 3 - w);
      const y0 = rng.int(2, H - 3 - h);
      const clash = platforms.some(
        (p) => x0 < p.x0 + p.w + 3 && x0 + w + 3 > p.x0 && y0 < p.y0 + p.h + 3 && y0 + h + 3 > p.y0,
      );
      if (clash) continue;
      const cx = Math.floor(x0 + w / 2);
      const cy = Math.floor(y0 + h / 2);
      const gap = platforms.length
        ? Math.min(...platforms.map((p) => Math.hypot(p.cx - cx, p.cy - cy)))
        : rng.next();
      if (!best || gap > best.gap) best = { x0, y0, w, h, cx, cy, gap };
    }
    if (best) platforms.push(best);
  }
  for (const p of platforms) {
    for (let y = p.y0; y < p.y0 + p.h; y++) {
      for (let x = p.x0; x < p.x0 + p.w; x++) canopy[idx(x, y)] = C.PLATFORM;
    }
  }

  // --- Canopy: bridges along a minimum spanning tree of platform centres ---
  const inTree = [0];
  const edges = [];
  while (inTree.length < platforms.length) {
    let best = null;
    for (const a of inTree) {
      for (let b = 0; b < platforms.length; b++) {
        if (inTree.includes(b)) continue;
        const d = Math.abs(platforms[a].cx - platforms[b].cx) + Math.abs(platforms[a].cy - platforms[b].cy);
        if (!best || d < best.d) best = { a, b, d };
      }
    }
    inTree.push(best.b);
    edges.push(best);
  }
  for (const { a, b } of edges) {
    const pa = platforms[a];
    const pb = platforms[b];
    const horizontalFirst = rng.chance(0.5);
    const lay = (x, y) => {
      if (canopy[idx(x, y)] === C.AIR) canopy[idx(x, y)] = C.BRIDGE;
    };
    let x = pa.cx;
    let y = pa.cy;
    const walkX = () => { while (x !== pb.cx) { x += Math.sign(pb.cx - x); lay(x, y); } };
    const walkY = () => { while (y !== pb.cy) { y += Math.sign(pb.cy - y); lay(x, y); } };
    if (horizontalFirst) { walkX(); walkY(); } else { walkY(); walkX(); }
  }

  // --- Canopy: leaf clumps on platforms -----------------------------------
  for (const p of platforms) {
    for (let k = 0; k < config.foliageClumpsPerPlatform; k++) {
      const fx = rng.int(p.x0, p.x0 + p.w - 2);
      const fy = rng.int(p.y0, p.y0 + p.h - 2);
      if (fx === p.cx || fy === p.cy) continue; // keep the bridge cross free
      const shape = rng.pick([[[0, 0]], [[0, 0], [1, 0]], [[0, 0], [0, 1]], [[0, 0], [1, 0], [0, 1]]]);
      for (const [dx, dy] of shape) {
        const cx = fx + dx;
        const cy = fy + dy;
        if (cx === p.cx || cy === p.cy) continue;
        if (canopy[idx(cx, cy)] === C.PLATFORM) canopy[idx(cx, cy)] = C.FOLIAGE;
      }
    }
  }

  // --- The trail, the clearings and the car (a designed layout) -----------
  // A winding trail runs from a broken-down car on the west side to the hospital door in the middle
  // of the east wall. Side paths lead off it to small clearings. Obstacles stay off all of these.
  const reserved = new Uint8Array(W * H);  // 1 trail, 2 side path, 3 clearing, 4 car
  const clearings = [];
  let car = null;
  if (config.trail) {
    const mid = Math.floor(H / 2);
    const y0 = rng.int(4, H - 6);
    const amp = 2 + rng.next() * 2.5;
    const phase = rng.next() * Math.PI * 2;
    const mark = (x, y, v) => { if (inner(x, y) && (!reserved[idx(x, y)] || v === 1)) reserved[idx(x, y)] = v; };
    let prevY = null;
    const x0 = 5;
    for (let x = x0; x <= W - 2; x++) {
      const t = (x - x0) / (W - 2 - x0);
      const ease = t * t * (3 - 2 * t);
      const y = Math.round(y0 + (mid - y0) * ease + amp * Math.sin(t * Math.PI * 2.2 + phase) * Math.sin(t * Math.PI));
      const yc = Math.max(2, Math.min(H - 3, y));
      if (prevY !== null) for (let k = Math.min(prevY, yc); k <= Math.max(prevY, yc); k++) { mark(x, k, 1); mark(x, k + 1, 1); }
      mark(x, yc, 1); mark(x, yc + 1, 1);
      prevY = yc;
    }
    // the car: 3 by 2 cells just west of where the trail starts, facing east along it
    const cy = Math.max(2, Math.min(H - 4, y0));
    car = { x: 2, y: cy, w: 3, h: 2 };
    for (let y = cy; y < cy + 2; y++) for (let x = 2; x < 5; x++) reserved[idx(x, y)] = 4;
    for (let y = cy - 1; y <= cy + 2; y++) mark(5, y, 1); // room to step out of the car
    // clearings off the trail, joined to it by a side path
    const trailCells = [];
    for (let i = 0; i < W * H; i++) if (reserved[i] === 1) trailCells.push(i);
    for (let k = 0; k < (config.clearings ?? 3) && trailCells.length; k++) {
      for (let attempt = 0; attempt < 40; attempt++) {
        const from = rng.pick(trailCells);
        const fx = from % W;
        const fy = Math.floor(from / W);
        if (fx < 9 || fx > W - 6) continue;
        const dir = rng.chance(0.5) ? 1 : -1;
        const dist = rng.int(4, 6);
        const cx = fx + rng.int(-2, 2);
        const cyy = fy + dir * dist;
        const r = 2;
        if (cyy - r < 1 || cyy + r > H - 2 || cx - r < 1 || cx + r > W - 2) continue;
        if (clearings.some((c) => Math.hypot(c.x - cx, c.y - cyy) < 7)) continue;
        for (let y = cyy - r; y <= cyy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
          if (Math.hypot(x - cx, y - cyy) <= r + 0.3 && !reserved[idx(x, y)]) reserved[idx(x, y)] = 3;
        }
        // side path: straight from the trail cell to the clearing (vertical, then horizontal)
        for (let y = Math.min(fy, cyy); y <= Math.max(fy, cyy); y++) mark(fx, y, 2);
        for (let x = Math.min(fx, cx); x <= Math.max(fx, cx); x++) mark(x, cyy, 2);
        clearings.push({ x: cx, y: cyy, r });
        break;
      }
    }
  }
  const free = (x, y) => inner(x, y) && ground[idx(x, y)] === G.FREE && !reserved[idx(x, y)];

  // --- Ground obstacles ---------------------------------------------------
  const placeGround = (x, y, type) => { if (free(x, y)) ground[idx(x, y)] = type; };
  if (config.trail) {
    // forest: dense away from the trail, thinner next to it
    const near = new Float32Array(W * H).fill(99);
    for (let i = 0; i < W * H; i++) if (reserved[i]) near[i] = 0;
    for (let pass = 0; pass < 4; pass++) {
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        const i = idx(x, y);
        near[i] = Math.min(near[i], near[i - 1] + 1, near[i + 1] + 1, near[i - W] + 1, near[i + W] + 1);
      }
    }
    const cells = [];
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) if (free(x, y)) cells.push([x, y]);
    const want = config.treeCount;
    let placed = 0;
    for (let round = 0; round < 6 && placed < want; round++) {
      for (const [x, y] of cells) {
        if (placed >= want || !free(x, y)) continue;
        const d = near[idx(x, y)];
        const p = d <= 1 ? 0.06 : d === 2 ? 0.2 : 0.34;
        if (rng.next() < p) { ground[idx(x, y)] = G.TREE; placed++; }
      }
    }
  } else {
    for (let k = 0; k < config.treeCount; k++) placeGround(rng.int(1, W - 2), rng.int(1, H - 2), G.TREE);
  }
  for (let k = 0; k < config.bushRows; k++) {
    const len = rng.int(2, 5);
    const horizontal = rng.chance(0.5);
    const x0 = rng.int(1, W - 2);
    const y0 = rng.int(1, H - 2);
    for (let i = 0; i < len; i++) placeGround(horizontal ? x0 + i : x0, horizontal ? y0 : y0 + i, G.BUSH);
  }
  for (let k = 0; k < config.rockCount; k++) {
    const [w, h] = rng.pick([[2, 2], [2, 1], [1, 2]]);
    const x0 = rng.int(1, W - 1 - w);
    const y0 = rng.int(1, H - 1 - h);
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) placeGround(x, y, G.ROCK);
  }
  // fallen logs: 3 cells long, low enough to see over
  for (let k = 0, made = 0; k < 200 && made < (config.logCount ?? 0); k++) {
    const horizontal = rng.chance(0.5);
    const x0 = rng.int(1, W - 4);
    const y0 = rng.int(1, H - 4);
    const cellsL = [0, 1, 2].map((i) => (horizontal ? [x0 + i, y0] : [x0, y0 + i]));
    if (cellsL.every(([x, y]) => free(x, y))) { for (const [x, y] of cellsL) ground[idx(x, y)] = G.LOG; made++; }
  }
  if (car) for (let y = car.y; y < car.y + car.h; y++) for (let x = car.x; x < car.x + car.w; x++) ground[idx(x, y)] = G.CAR;

  // --- Ladders: one per platform, on a platform edge cell -----------------
  const ladderCells = [];
  for (const p of platforms) {
    if (ladderCells.length >= config.ladderCount) break;
    const candidates = [];
    for (let y = p.y0; y < p.y0 + p.h; y++) {
      for (let x = p.x0; x < p.x0 + p.w; x++) {
        const edge = x === p.x0 || y === p.y0 || x === p.x0 + p.w - 1 || y === p.y0 + p.h - 1;
        if (edge && canopy[idx(x, y)] === C.PLATFORM) candidates.push([x, y]);
      }
    }
    if (!candidates.length) continue;
    const [lx, ly] = rng.pick(candidates);
    canopy[idx(lx, ly)] = C.LADDER;
    ground[idx(lx, ly)] = G.LADDER;
    // keep the foot of the ladder open
    for (const [dx, dy] of DIRS8.slice(0, 4)) {
      const nx = lx + dx;
      const ny = ly + dy;
      if (inner(nx, ny) && ground[idx(nx, ny)] !== G.LADDER) ground[idx(nx, ny)] = G.FREE;
    }
    ladderCells.push([lx, ly]);
  }

  const world = buildWorld(config, W, H, ground, canopy, platforms);
  removeUnreachable(world);
  if (config.noDeadEnds) removeDeadEnds(config, W, H, world.ground, world.canopy, platforms, rng);
  const out = buildWorld(config, W, H, world.ground, world.canopy, platforms, seed);
  out.reserved = reserved; // 1 trail, 2 side path, 3 clearing, 4 car
  out.clearings = clearings;
  out.car = car;
  return out;
}

// Builds the derived data (walkable nodes, solid volumes) from the two cell grids.
export function buildWorld(config, W, H, ground, canopy, platforms = [], seed = 0) {
  const N = W * H;
  const walk = new Uint8Array(2 * N);
  for (let i = 0; i < N; i++) {
    walk[i] = ground[i] === G.FREE || ground[i] === G.LADDER ? 1 : 0;
    walk[N + i] = canopy[i] === C.PLATFORM || canopy[i] === C.BRIDGE || canopy[i] === C.LADDER ? 1 : 0;
  }
  const nodes = [];
  for (let n = 0; n < 2 * N; n++) if (walk[n]) nodes.push(n);
  const nodeIndex = new Int32Array(2 * N).fill(-1);
  nodes.forEach((n, i) => { nodeIndex[n] = i; });

  // Solid vertical intervals [lo, hi, material] in each column of the grid.
  const solids = [];
  for (let i = 0; i < N; i++) {
    const list = [];
    switch (ground[i]) {
      case G.WALL: list.push([-1, 1e6, 'wall']); break;
      case G.TREE: list.push([0, config.treeTop, 'tree']); break;
      case G.BUSH: list.push([0, config.bushTop, 'bush']); break;
      case G.ROCK: list.push([0, config.rockTop, 'rock']); break;
      case G.LOG: list.push([0, 0.7, 'bush']); break;     // a fallen log: you can see over it
      case G.CAR: list.push([0, 1.65, 'rock']); break;
      default: break;
    }
    switch (canopy[i]) {
      case C.PLATFORM: case C.BRIDGE: case C.LADDER: list.push([config.slabBottom, config.slabTop, 'floor']); break;
      case C.FOLIAGE: list.push([config.slabBottom, config.foliageTop, 'leaves']); break;
      default: break;
    }
    solids.push(list);
  }

  const ladders = [];
  for (let i = 0; i < N; i++) if (ground[i] === G.LADDER && canopy[i] === C.LADDER) ladders.push(i);

  return { config, W, H, N, ground, canopy, walk, nodes, nodeIndex, solids, platforms, ladders, seed };
}

// Node id helpers: id = level * W * H + y * W + x
export const nodeId = (world, level, x, y) => level * world.N + y * world.W + x;
export function nodeXYL(world, n) {
  const level = n >= world.N ? 1 : 0;
  const i = n - level * world.N;
  return { x: i % world.W, y: Math.floor(i / world.W), level };
}
export const isWalkable = (world, level, x, y) =>
  x >= 0 && y >= 0 && x < world.W && y < world.H && world.walk[level * world.N + y * world.W + x] === 1;

// Calls fn(neighbour, cost) for each move from node n.
// 8 directions on the same level (diagonal sqrt 2, no cutting a blocked corner) and ladders (cost 3).
export function forEachNeighbour(world, n, fn) {
  const { x, y, level } = nodeXYL(world, n);
  for (const [dx, dy] of DIRS8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!isWalkable(world, level, nx, ny)) continue;
    if (dx !== 0 && dy !== 0) {
      if (!isWalkable(world, level, x + dx, y) || !isWalkable(world, level, x, y + dy)) continue;
      fn(nodeId(world, level, nx, ny), Math.SQRT2);
    } else {
      fn(nodeId(world, level, nx, ny), 1);
    }
  }
  const i = y * world.W + x;
  if (world.ground[i] === G.LADDER && world.canopy[i] === C.LADDER) {
    fn(level === 0 ? world.N + i : i, world.config.ladderCost);
  }
}

// Keeps only the largest connected group of walkable cells; cut-off cells become bush or air.
function removeUnreachable(world) {
  const seen = new Int32Array(2 * world.N).fill(-1);
  let best = -1;
  let bestSize = 0;
  let comp = 0;
  for (const start of world.nodes) {
    if (seen[start] !== -1) continue;
    const stack = [start];
    seen[start] = comp;
    let size = 0;
    while (stack.length) {
      const n = stack.pop();
      size++;
      forEachNeighbour(world, n, (m) => {
        if (seen[m] === -1) { seen[m] = comp; stack.push(m); }
      });
    }
    if (size > bestSize) { bestSize = size; best = comp; }
    comp++;
  }
  for (const n of world.nodes) {
    if (seen[n] === best) continue;
    const { x, y, level } = nodeXYL(world, n);
    const i = y * world.W + x;
    if (level === 0) world.ground[i] = world.config.trail ? G.TREE : G.BUSH;
    else world.canopy[i] = C.AIR;
  }
  // A ladder only counts if both ends survived.
  for (let i = 0; i < world.N; i++) {
    if (world.ground[i] === G.LADDER && world.canopy[i] !== C.LADDER) world.ground[i] = G.FREE;
    if (world.canopy[i] === C.LADDER && world.ground[i] !== G.LADDER) world.canopy[i] = C.PLATFORM;
  }
}

// ---- no dead ends ----------------------------------------------------------
// A dead end is a part of the walkable network that hangs on a single connection (a bridge in the
// graph): you can only leave it the way you came in. Small alcoves (up to 3 cells) are filled in;
// larger ones get a new opening, carved through the obstacles (ground) or as a new walkway (canopy)
// to some other part of the network. Repeats until no bridge is left.

// Finds one bridge edge of the walkable graph (iterative Tarjan), or null.
export function findBridge(world) {
  const disc = new Int32Array(2 * world.N).fill(-1);
  const low = new Int32Array(2 * world.N);
  let time = 0;
  for (const root of world.nodes) {
    if (disc[root] !== -1) continue;
    const stack = [{ n: root, parent: -1, nbrs: null, i: 0 }];
    disc[root] = low[root] = time++;
    while (stack.length) {
      const top = stack[stack.length - 1];
      if (!top.nbrs) { top.nbrs = []; forEachNeighbour(world, top.n, (m) => top.nbrs.push(m)); }
      if (top.i < top.nbrs.length) {
        const m = top.nbrs[top.i++];
        if (m === top.parent) continue;
        if (disc[m] === -1) {
          disc[m] = low[m] = time++;
          stack.push({ n: m, parent: top.n, nbrs: null, i: 0 });
        } else {
          low[top.n] = Math.min(low[top.n], disc[m]);
        }
      } else {
        stack.pop();
        if (top.parent !== -1) {
          low[top.parent] = Math.min(low[top.parent], low[top.n]);
          if (low[top.n] > disc[top.parent]) return [top.parent, top.n];
        }
      }
    }
  }
  return null;
}

function removeDeadEnds(config, W, H, ground, canopy, platforms, rng) {
  const N = W * H;
  for (let iter = 0; iter < 400; iter++) {
    const world = buildWorld(config, W, H, ground, canopy, platforms);
    const bridge = findBridge(world);
    if (!bridge) return;
    const [u, v] = bridge;

    // the two sides of the bridge; the smaller one is the dead end
    const side = new Set([u]);
    const stack = [u];
    while (stack.length) {
      const n = stack.pop();
      forEachNeighbour(world, n, (m) => {
        if ((n === u && m === v) || side.has(m)) return;
        side.add(m);
        stack.push(m);
      });
    }
    const pocket = side.size * 2 <= world.nodes.length ? [...side] : world.nodes.filter((n) => !side.has(n));
    const inPocket = new Set(pocket);
    const hasLadder = pocket.some((n) => world.ground[n % N] === G.LADDER);

    if (pocket.length > 3 || hasLadder) {
      if (carveOpening(world, ground, canopy, pocket, inPocket, rng)) continue;
    }
    // fill the alcove in
    for (const n of pocket) {
      const i = n % N;
      if (n < N) ground[i] = config.trail ? G.TREE : G.BUSH; else canopy[i] = C.AIR;
      if (ground[i] === G.LADDER && canopy[i] !== C.LADDER) ground[i] = G.FREE;
      if (canopy[i] === C.LADDER && ground[i] !== G.LADDER) canopy[i] = C.PLATFORM;
    }
  }
}

// Opens the shortest passage from the pocket to the rest of its level, through obstacles that may
// be cleared (ground: trees, bushes, rocks; canopy: open air, which becomes a walkway).
function carveOpening(world, ground, canopy, pocket, inPocket, rng) {
  const { W, H, N } = world;
  const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const level of rng.chance(0.5) ? [0, 1] : [1, 0]) {
    const cells = pocket.filter((n) => (n >= N ? 1 : 0) === level).map((n) => n % N);
    if (!cells.length) continue;
    const carvable = (i) => {
      const x = i % W;
      const y = Math.floor(i / W);
      if (x < 1 || y < 1 || x > W - 2 || y > H - 2) return false;
      return level === 0 ? [G.TREE, G.BUSH, G.ROCK, G.LOG].includes(ground[i]) : canopy[i] === C.AIR;
    };
    const walkableOther = (i) => world.walk[level * N + i] === 1 && !inPocket.has(level * N + i);
    const prev = new Map();
    const queue = [];
    for (const i of cells) {
      for (const [dx, dy] of DIRS4) {
        const j = i + dy * W + dx;
        if (carvable(j) && !prev.has(j)) { prev.set(j, -1); queue.push(j); }
      }
    }
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q];
      const reaches = DIRS4.some(([dx, dy]) => walkableOther(i + dy * W + dx));
      if (reaches) {
        for (let k = i; k !== -1; k = prev.get(k)) {
          if (level === 0) ground[k] = G.FREE; else canopy[k] = C.BRIDGE;
        }
        return true;
      }
      for (const [dx, dy] of DIRS4) {
        const j = i + dy * W + dx;
        if (carvable(j) && !prev.has(j)) { prev.set(j, i); queue.push(j); }
      }
    }
  }
  return false;
}
