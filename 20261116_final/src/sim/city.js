// A real place as a grid the agents can live in.
//
// Input: one data/<place>.json (OpenStreetMap + NYC building footprints + Open-Meteo), and an
// environment design (src/sim/design.js) that adds what the environment designer placed.
// Output: a world object with
//   W, H, N              grid size (cells are config.cellM metres; x east, y south)
//   ground[i]            G code: open ground, building, tree, bush, rock, fence, water
//   surface[i]           S code of open ground: avenue, street, path, steps, plaza, lawn, yard, woods
//   walk[i], opaque[i]   can be walked on / blocks sight
//   elev[i]              ground elevation in metres above sea level (NYC footprints + DEM)
//   height[i]            height of what stands on the cell, metres (buildings: surveyed roof height)
//   solids[i]            vertical intervals for the 3D line-of-sight and sound code (in cell units)
//   lit[i]               under street lights
//   street[i], cross[i]  nearest named street and the nearest other one (indices into names)
//   corners              street corners (two named streets meet), used as landmarks
//   refuge, door, doorCells, lair
//   geo                  the projection: cell <-> longitude, latitude

import { makeRng } from './rng.js';
import { G } from './world.js';

export { G };
export const S = { YARD: 0, LAWN: 1, AVENUE: 2, STREET: 3, PATH: 4, STEPS: 5, PLAZA: 6, WOODS: 7, BRIDGE: 8 };
export const SURFACE_NAMES = ['yard', 'lawn', 'avenue', 'street', 'path', 'steps', 'plaza', 'woods floor', 'bridge'];
// extra ground codes for the city
G.BLDG = 8; G.WATER = 9; G.FENCE = 10; G.BARRIER = 11;

const OPEN = new Set([G.FREE]);

// ---- projection ------------------------------------------------------------------------------
export function makeGeo(bbox, cellM) {
  const lat0 = (bbox.north + bbox.south) / 2;
  const mLat = 111132.92 - 559.82 * Math.cos(2 * lat0 * Math.PI / 180);
  const mLon = 111412.84 * Math.cos(lat0 * Math.PI / 180);
  const widthM = (bbox.east - bbox.west) * mLon;
  const heightM = (bbox.north - bbox.south) * mLat;
  const W = Math.round(widthM / cellM);
  const H = Math.round(heightM / cellM);
  return {
    cellM, W, H, mLat, mLon, bbox,
    // longitude, latitude -> grid coordinates (cells, fractional)
    toGrid: (lon, lat) => [((lon - bbox.west) * mLon) / cellM, ((bbox.north - lat) * mLat) / cellM],
    // grid coordinates -> longitude, latitude
    toLonLat: (x, y) => [bbox.west + (x * cellM) / mLon, bbox.north - (y * cellM) / mLat],
  };
}

// ---- rasterising ---------------------------------------------------------------------------
function fillPolygon(W, H, poly, fn) {
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
  for (const [x, y] of poly) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const y0 = Math.max(0, Math.floor(minY)); const y1 = Math.min(H - 1, Math.ceil(maxY));
  const x0 = Math.max(0, Math.floor(minX)); const x1 = Math.min(W - 1, Math.ceil(maxX));
  for (let y = y0; y <= y1; y++) {
    const cy = y + 0.5;
    const xs = [];
    for (let k = 0, j = poly.length - 1; k < poly.length; j = k++) {
      const [ax, ay] = poly[j]; const [bx, by] = poly[k];
      if ((ay > cy) !== (by > cy)) xs.push(ax + ((cy - ay) * (bx - ax)) / (by - ay));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(x0, Math.ceil(xs[k] - 0.5)); const to = Math.min(x1, Math.floor(xs[k + 1] - 0.5));
      for (let x = from; x <= to; x++) fn(y * W + x);
    }
  }
}

// every cell whose centre is within r cells of the polyline (r >= 0.75 keeps it 4-connected)
function strokeLine(W, H, pts, r, fn) {
  for (let s = 1; s < pts.length; s++) {
    const [ax, ay] = pts[s - 1]; const [bx, by] = pts[s];
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - r)); const x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx) + r));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by) - r)); const y1 = Math.min(H - 1, Math.ceil(Math.max(ay, by) + r));
    const dx = bx - ax; const dy = by - ay; const L2 = dx * dx + dy * dy || 1e-9;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x + 0.5; const py = y + 0.5;
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2));
      const ex = ax + t * dx - px; const ey = ay + t * dy - py;
      if (ex * ex + ey * ey <= r * r) fn(y * W + x, t, s);
    }
  }
}

const centroidOf = (pts) => [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];

// road widths in metres (kerb to kerb plus sidewalks)
const WIDTH = { avenue: 26, street: 17, service: 6, path: 4, steps: 4, plaza: 6 };

// ---- the city ------------------------------------------------------------------------------
export function buildCity(place, config, design = {}) {
  const geo = makeGeo(place.bbox, config.cellM);
  const { W, H } = geo;
  const N = W * H;
  const cellM = config.cellM;
  const rng = makeRng(config.seed ^ 0x5eed);
  const ground = new Uint8Array(N).fill(G.FREE);
  const surface = new Uint8Array(N).fill(S.YARD);
  const height = new Float32Array(N);
  const bldgId = new Int32Array(N).fill(-1);
  const toGrid = (p) => geo.toGrid(p[0], p[1]);
  const lines = place.lines.map((l) => ({ ...l, g: l.pts.map(toGrid) }));
  const byKind = (k) => lines.filter((l) => l.kind === k);

  // 1. parks, woods, scrub, water, plazas (areas)
  for (const l of byKind('park')) if (l.closed) fillPolygon(W, H, l.g, (i) => { surface[i] = S.LAWN; });
  for (const l of byKind('wood')) if (l.closed) fillPolygon(W, H, l.g, (i) => { surface[i] = S.WOODS; if (rng.chance(config.woodDensity)) ground[i] = G.TREE; });
  for (const l of byKind('scrub')) if (l.closed) fillPolygon(W, H, l.g, (i) => { if (ground[i] === G.FREE && rng.chance(0.45)) ground[i] = G.BUSH; });
  for (const l of byKind('plaza')) if (l.closed) fillPolygon(W, H, l.g, (i) => { surface[i] = S.PLAZA; ground[i] = G.FREE; });
  for (const l of byKind('water')) if (l.closed) fillPolygon(W, H, l.g, (i) => { ground[i] = G.WATER; });
  for (const l of byKind('rock')) {
    if (l.closed) fillPolygon(W, H, l.g, (i) => { ground[i] = G.ROCK; });
    else strokeLine(W, H, l.g, 0.5, (i) => { ground[i] = G.ROCK; });
  }

  // 2. buildings: NYC footprints (surveyed heights), OSM buildings where the city has none
  const buildings = [];
  place.buildings.forEach((b) => {
    const g = b.pts.map(toGrid);
    const id = buildings.length;
    buildings.push({ id, h: b.h, ground: b.ground, year: b.year, g, source: 'nyc' });
    fillPolygon(W, H, g, (i) => { ground[i] = G.BLDG; height[i] = Math.max(height[i], b.h); bldgId[i] = id; });
  });
  for (const l of byKind('osmbuilding')) {
    if (l.g.length < 3) continue;
    let covered = 0; let total = 0;
    fillPolygon(W, H, l.g, (i) => { total++; if (ground[i] === G.BLDG) covered++; });
    if (!total || covered / total > 0.3) continue;
    const h = l.height || (l.levels ? l.levels * 3.2 : 7);
    const id = buildings.length;
    buildings.push({ id, h, ground: null, year: null, g: l.g, source: 'osm', name: l.name });
    fillPolygon(W, H, l.g, (i) => { if (ground[i] !== G.BLDG) { ground[i] = G.BLDG; height[i] = h; bldgId[i] = id; } });
  }

  // 3. fences, hedges (thin), then streets and paths on top
  for (const l of [...byKind('fence'), ...byKind('hedge')]) strokeLine(W, H, l.g, 0.36, (i) => { if (ground[i] === G.FREE) ground[i] = l.kind === 'hedge' ? G.BUSH : G.FENCE; });
  const roadOf = { avenue: S.AVENUE, street: S.STREET, service: S.STREET, path: S.PATH, steps: S.STEPS, plaza: S.PLAZA };
  for (const kind of ['path', 'steps', 'service', 'street', 'avenue']) {
    for (const l of byKind(kind)) {
      if (l.closed && kind === 'plaza') continue;
      const r = Math.max(0.75, WIDTH[kind] / cellM / 2);
      strokeLine(W, H, l.g, r, (i) => {
        if (ground[i] === G.BLDG && kind !== 'avenue' && kind !== 'street') return;
        if (ground[i] === G.WATER && !l.bridge) return;
        if (ground[i] === G.BLDG) { height[i] = 0; bldgId[i] = -1; }
        ground[i] = G.FREE;
        surface[i] = l.bridge && kind !== 'avenue' ? S.BRIDGE : roadOf[kind];
      });
    }
  }

  // 4. trees from OSM points, on lawns and yards (street trees stay decoration)
  const trees = [];
  for (const p of place.points) {
    if (p.kind !== 'tree') continue;
    const [x, y] = geo.toGrid(p.lon, p.lat);
    const i = Math.floor(y) * W + Math.floor(x);
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    trees.push([x, y]);
    if (ground[i] === G.FREE && (surface[i] === S.LAWN || surface[i] === S.YARD || surface[i] === S.WOODS)) ground[i] = G.TREE;
  }
  for (let i = 0; i < N; i++) if (ground[i] === G.TREE) height[i] = Math.max(height[i], 12);
  for (let i = 0; i < N; i++) if (ground[i] === G.BUSH) height[i] = 1.6;
  for (let i = 0; i < N; i++) if (ground[i] === G.ROCK) height[i] = 3;
  for (let i = 0; i < N; i++) if (ground[i] === G.FENCE) height[i] = 1.4;

  // 5. what the environment designer added: barricades (obstacles)
  for (const b of design.barricades ?? []) {
    for (const i of barricadeCells(W, H, b)) if (ground[i] === G.FREE) { ground[i] = G.BARRIER; height[i] = 1.8; }
  }

  // 6. elevation: building ground elevations (surveyed) and DEM samples, blended by distance
  const elev = elevationField(place, geo, buildings);

  // 7. keep the largest connected open area; the rest (closed courtyards) becomes fenced lots
  const walk = new Uint8Array(N);
  for (let i = 0; i < N; i++) walk[i] = OPEN.has(ground[i]) ? 1 : 0;
  keepLargest(W, H, walk, ground);
  for (let i = 0; i < N; i++) walk[i] = OPEN.has(ground[i]) ? 1 : 0;

  const opaque = new Uint8Array(N);
  for (let i = 0; i < N; i++) opaque[i] = [G.BLDG, G.TREE, G.ROCK, G.BUSH, G.WALL].includes(ground[i]) ? 1 : 0;

  // 8. solids for 3D sight and sound, in cell units (vertical metres / cellM)
  const solids = [];
  for (let i = 0; i < N; i++) {
    const z = elev[i] / cellM;
    const list = [[-50, z, 'terrain']];
    const top = z + height[i] / cellM;
    switch (ground[i]) {
      case G.BLDG: list.push([z, top, 'building']); break;
      case G.TREE: list.push([z + 2 / cellM, top, 'tree']); break;   // under the canopy you can see a little
      case G.BUSH: list.push([z, top, 'bush']); break;
      case G.ROCK: list.push([z, top, 'rock']); break;
      case G.FENCE: case G.BARRIER: list.push([z, top, 'fence']); break;
      default: break;
    }
    solids.push(list);
  }

  // 9. street lights: OSM lamps, and every avenue and street (New York lights all of them)
  const lit = new Uint8Array(N);
  for (const p of place.points) {
    if (p.kind !== 'lamp') continue;
    const [x, y] = geo.toGrid(p.lon, p.lat);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const cx = Math.floor(x) + dx; const cy = Math.floor(y) + dy;
      if (cx >= 0 && cy >= 0 && cx < W && cy < H && dx * dx + dy * dy <= 5) lit[cy * W + cx] = 1;
    }
  }
  for (let i = 0; i < N; i++) if (walk[i] && (surface[i] === S.AVENUE || surface[i] === S.STREET)) lit[i] = 1;

  // 10. street names: for each cell, the nearest named way and the nearest different one
  const names = [];
  const nameIdx = new Map();
  const street = new Int16Array(N).fill(-1); const cross = new Int16Array(N).fill(-1);
  const d1 = new Float32Array(N).fill(1e9); const d2 = new Float32Array(N).fill(1e9);
  for (const l of lines) {
    if (!l.name || !['avenue', 'street', 'service', 'path', 'steps', 'plaza'].includes(l.kind)) continue;
    if (!nameIdx.has(l.name)) { nameIdx.set(l.name, names.length); names.push(l.name); }
    const id = nameIdx.get(l.name);
    const r = Math.max(1, WIDTH[l.kind] / cellM / 2) + 3;
    strokeLine(W, H, l.g, r, (i) => {
      const x = (i % W) + 0.5; const y = Math.floor(i / W) + 0.5;
      let best = 1e9;
      for (let s = 1; s < l.g.length; s++) best = Math.min(best, segDist(x, y, l.g[s - 1], l.g[s]));
      if (street[i] === id) { d1[i] = Math.min(d1[i], best); return; }
      if (cross[i] === id) { d2[i] = Math.min(d2[i], best); if (d2[i] < d1[i]) { [street[i], cross[i]] = [cross[i], street[i]]; [d1[i], d2[i]] = [d2[i], d1[i]]; } return; }
      if (best < d1[i]) { cross[i] = street[i]; d2[i] = d1[i]; street[i] = id; d1[i] = best; } else if (best < d2[i]) { cross[i] = id; d2[i] = best; }
    });
  }
  // street corners: open cells close to two named streets (avenues or streets) at once
  const corners = [];
  const roadName = new Set(lines.filter((l) => l.name && ['avenue', 'street'].includes(l.kind)).map((l) => nameIdx.get(l.name)));
  for (let i = 0; i < N; i++) {
    if (!walk[i] || street[i] < 0 || cross[i] < 0 || !roadName.has(street[i]) || !roadName.has(cross[i])) continue;
    if (d1[i] > 1.2 || d2[i] > 1.2) continue;
    const key = [street[i], cross[i]].sort().join('|');
    const near = corners.find((c) => c.key === key && Math.hypot(c.x - (i % W), c.y - Math.floor(i / W)) < 6);
    if (near) continue;
    corners.push({ key, cell: i, x: i % W, y: Math.floor(i / W), name: `${short(names[street[i]])} & ${short(names[cross[i]])}` });
  }

  // 11. points of interest that matter for survival
  const pois = { shops: [], subways: [], benches: [], shelters: [] };
  for (const p of place.points) {
    const [x, y] = geo.toGrid(p.lon, p.lat);
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    const cell = nearestWalkable(W, H, walk, Math.floor(y) * W + Math.floor(x), 4);
    if (cell === null) continue;
    if (p.kind === 'shop') pois.shops.push({ cell, name: p.name });
    if (p.kind === 'subway') pois.subways.push({ cell, name: p.name });
    if (p.kind === 'shelter') pois.shelters.push({ cell, name: p.name });
  }

  // 12. the refuge (the goal of the survivors)
  const ref = findRefuge(place, geo, W, H, walk);

  const world = {
    config, place: { id: place.id, name: place.name, sources: place.sources }, geo,
    W, H, N, cellM, ground, surface, height, bldgId, walk, opaque, elev, solids, lit, buildings, trees,
    names, street, cross, corners, pois,
    nodes: [], nodeIndex: null, platforms: [], ladders: [], canopy: new Uint8Array(N),
    refuge: ref, door: ref.cell, doorCells: ref.cells,
    seed: config.seed,
  };
  for (let i = 0; i < N; i++) if (walk[i]) world.nodes.push(i);
  world.lair = design.lair != null && world.walk[design.lair] ? design.lair : defaultLair(world);
  return world;
}

const short = (s) => s.replace(/\bWest\b/g, 'W').replace(/\bEast\b/g, 'E').replace(/\bStreet\b/g, 'St').replace(/\bAvenue\b/g, 'Av').replace(/\bDrive\b/g, 'Dr').replace(/\bPlace\b/g, 'Pl');

function segDist(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax; const dy = by - ay; const L2 = dx * dx + dy * dy || 1e-9;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2));
  return Math.hypot(ax + t * dx - px, ay + t * dy - py);
}

export function nearestWalkable(W, H, walk, cell, maxR = 6) {
  if (walk[cell]) return cell;
  const x0 = cell % W; const y0 = Math.floor(cell / W);
  for (let r = 1; r <= maxR; r++) {
    let best = null; let bd = Infinity;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const x = x0 + dx; const y = y0 + dy;
      if (x < 0 || y < 0 || x >= W || y >= H || !walk[y * W + x]) continue;
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = y * W + x; }
    }
    if (best !== null) return best;
  }
  return null;
}

function findRefuge(place, geo, W, H, walk) {
  const want = place.refuge ?? { kind: 'hospital' };
  const cands = place.points.filter((p) => p.kind === want.kind);
  const inside = cands.filter((p) => { const [x, y] = geo.toGrid(p.lon, p.lat); return x >= 1 && y >= 1 && x < W - 1 && y < H - 1; });
  const named = inside.filter((p) => want.name && p.name && p.name.toLowerCase().includes(want.name.toLowerCase().slice(0, 8)));
  const p = named[0] ?? inside[0] ?? { lon: (place.bbox.west + place.bbox.east) / 2, lat: (place.bbox.north + place.bbox.south) / 2 };
  const [x, y] = geo.toGrid(p.lon, p.lat);
  const cell = nearestWalkable(W, H, walk, Math.floor(y) * W + Math.floor(x), 12);
  const cells = [cell];
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const j = cell + dy * W + dx;
    if (walk[j] && cells.length < 2) cells.push(j);
  }
  return { cell, cells, kind: want.kind, name: want.name ?? p.name, lon: p.lon, lat: p.lat, gx: x, gy: y };
}

function keepLargest(W, H, walk, ground) {
  const N = W * H;
  const comp = new Int32Array(N).fill(-1);
  let best = -1; let bestSize = 0; let c = 0;
  for (let s = 0; s < N; s++) {
    if (!walk[s] || comp[s] !== -1) continue;
    const stack = [s]; comp[s] = c; let size = 0;
    while (stack.length) {
      const i = stack.pop(); size++;
      const x = i % W; const y = Math.floor(i / W);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx; const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (walk[j] && comp[j] === -1) { comp[j] = c; stack.push(j); }
      }
    }
    if (size > bestSize) { bestSize = size; best = c; }
    c++;
  }
  for (let i = 0; i < N; i++) if (walk[i] && comp[i] !== best) ground[i] = G.FENCE;
}

// inverse-distance blend of surveyed building ground elevations and the coarse DEM
function elevationField(place, geo, buildings) {
  const { W, H } = geo;
  const samples = [];
  const nyc = buildings.filter((b) => b.ground !== null);
  for (const b of nyc) { const [x, y] = centroidOf(b.g); samples.push([x, y, b.ground, 1]); }
  const e = place.elevation;
  const maxGround = nyc.length ? Math.max(...nyc.map((b) => b.ground)) : Infinity;
  for (let j = 0; j < e.ny; j++) for (let i = 0; i < e.nx; i++) {
    const v = e.values[j * e.nx + i];
    // the DEM sees rooftops in dense blocks; drop samples far above any surveyed ground
    if (nyc.length >= 30 && v > maxGround + 8) continue;
    samples.push([(i / (e.nx - 1)) * W, (j / (e.ny - 1)) * H, v, nyc.length >= 30 ? 0.25 : 1]);
  }
  const elev = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let sw = 0; let sv = 0;
    for (const [sx, sy, v, w] of samples) {
      const d2 = (sx - x - 0.5) ** 2 + (sy - y - 0.5) ** 2 + 4;
      const k = w / (d2 * d2);
      sw += k; sv += k * v;
    }
    elev[y * W + x] = Math.round((sv / sw) * 10) / 10;
  }
  // a building stands on its own surveyed ground
  return elev;
}

// cells of a barricade: a 3-cell line through `cell`, horizontal or vertical
export function barricadeCells(W, H, b) {
  const x = b.cell % W; const y = Math.floor(b.cell / W);
  const out = [];
  for (let k = -1; k <= 1; k++) {
    const cx = b.dir === 'h' ? x + k : x; const cy = b.dir === 'h' ? y : y + k;
    if (cx >= 0 && cy >= 0 && cx < W && cy < H) out.push(cy * W + cx);
  }
  return out;
}

function defaultLair(world) {
  // the open cell farthest (as the crow flies) from the refuge, preferring parks and woods
  let best = world.nodes[0]; let bd = -1;
  const rx = world.door % world.W; const ry = Math.floor(world.door / world.W);
  for (const i of world.nodes) {
    const d = Math.hypot((i % world.W) - rx, Math.floor(i / world.W) - ry) + ([S.LAWN, S.WOODS, S.PATH].includes(world.surface[i]) ? 8 : 0);
    if (d > bd) { bd = d; best = i; }
  }
  return best;
}

// Where an agent is, in the frames of reference the simulation keeps.
export function describeLocation(world, cell) {
  const x = cell % world.W; const y = Math.floor(cell / world.W);
  const [lon, lat] = world.geo.toLonLat(x + 0.5, y + 0.5);
  const s = world.street[cell] >= 0 ? short(world.names[world.street[cell]]) : null;
  const c = world.cross[cell] >= 0 ? short(world.names[world.cross[cell]]) : null;
  return {
    grid: { x, y },
    metres: { east: Math.round((x + 0.5) * world.cellM), south: Math.round((y + 0.5) * world.cellM) },
    lonlat: [Math.round(lon * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6],
    elevation: world.elev[cell],
    street: s ? (c ? `${s}, near ${c}` : s) : SURFACE_NAMES[world.surface[cell]],
    surface: SURFACE_NAMES[world.surface[cell]],
  };
}
