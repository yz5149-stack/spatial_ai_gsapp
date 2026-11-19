// The real place as a grid of 8 m cells: what rats and inspectors walk on, what lights it, where
// people are, where food is set out, and where the real rat reports were made.
//
// Built once per place (it does not depend on the design); the design is applied on top in sim.js.
//
//   W, H, N, cellM, geo       grid size and the projection (cell <-> longitude, latitude)
//   ground[i]                 G code: open, building, water, fence
//   surface[i]                S code of open ground: yard, lawn, avenue, street, path, steps, plaza, woods
//   walk[i]                   open and connected
//   wall[i]                   open cell touching a building (a sidewalk, a courtyard edge): rats run here
//   road[i]                   roadway (cars), away from the buildings
//   soil[i]                   earth a rat can dig in: lawns, yards, park woods, street tree pits
//   elev[i], height[i]        metres: ground elevation (NYC survey), height of what stands on it
//   light[i]                  0..1 from modelled street-light poles (no design)
//   people[i]                 0..1 how busy the cell is at the busiest hour
//   sources                   where food is set out: buildings, restaurants, groceries, litter baskets
//   sheds                     active sidewalk sheds (DOB permits), as cells along the building front
//   real                      the real rat reports, as cells, and a smoothed map of them

import { makeRng } from './rng.js?v=13';

export const G = { OPEN: 0, BLDG: 1, WATER: 2, FENCE: 3 };
export const S = { YARD: 0, LAWN: 1, AVENUE: 2, STREET: 3, PATH: 4, STEPS: 5, PLAZA: 6, WOODS: 7 };
export const SURFACE_NAMES = ['yard', 'lawn', 'avenue', 'street', 'path', 'steps', 'plaza', 'woods'];
export const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
export const DIRS8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

// ---- projection ------------------------------------------------------------------------------
export function makeGeo(bbox, cellM) {
  const lat0 = (bbox.north + bbox.south) / 2;
  const mLat = 111132.92 - 559.82 * Math.cos((2 * lat0 * Math.PI) / 180);
  const mLon = 111412.84 * Math.cos((lat0 * Math.PI) / 180);
  const W = Math.round(((bbox.east - bbox.west) * mLon) / cellM);
  const H = Math.round(((bbox.north - bbox.south) * mLat) / cellM);
  return {
    cellM, W, H, mLat, mLon, bbox,
    toGrid: (lon, lat) => [((lon - bbox.west) * mLon) / cellM, ((bbox.north - lat) * mLat) / cellM],
    toLonLat: (x, y) => [bbox.west + (x * cellM) / mLon, bbox.north - (y * cellM) / mLat],
  };
}

// ---- rasterising ---------------------------------------------------------------------------
function fillPolygon(W, H, poly, fn) {
  let minY = Infinity; let maxY = -Infinity; let minX = Infinity; let maxX = -Infinity;
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
      if (ex * ex + ey * ey <= r * r) fn(y * W + x);
    }
  }
}

// points every `step` cells along a polyline
function along(pts, step) {
  const out = [];
  let carry = 0;
  for (let s = 1; s < pts.length; s++) {
    const [ax, ay] = pts[s - 1]; const [bx, by] = pts[s];
    const L = Math.hypot(bx - ax, by - ay);
    let t = carry;
    while (t < L) { out.push([ax + ((bx - ax) * t) / L, ay + ((by - ay) * t) / L]); t += step; }
    carry = t - L;
  }
  return out;
}

const WIDTH = { avenue: 30, street: 18, service: 6, path: 4, steps: 4, plaza: 6 };   // metres, kerb to kerb with sidewalks
const short = (s) => s.replace(/\bWest\b/g, 'W').replace(/\bEast\b/g, 'E').replace(/\bStreet\b/g, 'St').replace(/\bAvenue\b/g, 'Av').replace(/\bDrive\b/g, 'Dr').replace(/\bBoulevard\b/g, 'Blvd').replace(/\bPlace\b/g, 'Pl');
export { short };

// ---- the city ------------------------------------------------------------------------------
export function buildCity(place, config) {
  const geo = makeGeo(place.bbox, config.cellM);
  const { W, H } = geo;
  const N = W * H;
  const cellM = config.cellM;
  const rng = makeRng(config.seed ^ 0xc17);
  const ground = new Uint8Array(N);
  const surface = new Uint8Array(N).fill(S.YARD);
  const height = new Float32Array(N);
  const bldgId = new Int32Array(N).fill(-1);
  const toGrid = (p) => geo.toGrid(p[0], p[1]);
  const inGrid = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const cellOf = (lon, lat) => { const [x, y] = geo.toGrid(lon, lat); return inGrid(x, y) ? Math.floor(y) * W + Math.floor(x) : -1; };
  const lines = place.lines.map((l) => ({ ...l, g: l.pts.map(toGrid) }));
  const byKind = (k) => lines.filter((l) => l.kind === k);

  // 1. areas
  for (const l of byKind('park')) if (l.closed) fillPolygon(W, H, l.g, (i) => { surface[i] = S.LAWN; });
  for (const l of byKind('wood')) if (l.closed) fillPolygon(W, H, l.g, (i) => { surface[i] = S.WOODS; });
  for (const l of byKind('plaza')) if (l.closed) fillPolygon(W, H, l.g, (i) => { surface[i] = S.PLAZA; });
  for (const l of byKind('water')) if (l.closed) fillPolygon(W, H, l.g, (i) => { ground[i] = G.WATER; });

  // 2. buildings: NYC footprints (surveyed), OSM where the city has none
  const buildings = [];
  for (const b of place.buildings) {
    const g = b.pts.map(toGrid);
    const id = buildings.length;
    const cells = [];
    fillPolygon(W, H, g, (i) => { ground[i] = G.BLDG; height[i] = Math.max(height[i], b.h); bldgId[i] = id; cells.push(i); });
    buildings.push({ id, h: b.h, ground: b.ground, use: b.use, name: b.name, m2: b.m2, floors: b.floors, bin: b.bin, g, cells });
  }
  for (const l of byKind('osmbuilding')) {
    if (l.g.length < 3) continue;
    let covered = 0; let total = 0;
    fillPolygon(W, H, l.g, (i) => { total++; if (ground[i] === G.BLDG) covered++; });
    if (!total || covered / total > 0.3) continue;
    const h = l.height || (l.levels ? l.levels * 3.2 : 8);
    const id = buildings.length;
    const cells = [];
    fillPolygon(W, H, l.g, (i) => { if (ground[i] !== G.BLDG) { ground[i] = G.BLDG; height[i] = h; bldgId[i] = id; cells.push(i); } });
    buildings.push({ id, h, ground: null, use: 'other', name: l.name || '', m2: total * cellM * cellM, floors: Math.max(1, Math.round(h / 3.2)), g: l.g, cells });
  }

  // 3. fences, then streets and paths over everything but buildings
  for (const l of [...byKind('fence'), ...byKind('hedge')]) strokeLine(W, H, l.g, 0.36, (i) => { if (ground[i] === G.OPEN && surface[i] !== S.AVENUE && surface[i] !== S.STREET) ground[i] = G.FENCE; });
  const roadOf = { avenue: S.AVENUE, street: S.STREET, service: S.STREET, path: S.PATH, steps: S.STEPS, plaza: S.PLAZA };
  const streetLines = [];
  for (const kind of ['path', 'steps', 'service', 'street', 'avenue']) {
    for (const l of byKind(kind)) {
      if (l.closed && kind === 'plaza') continue;
      const r = Math.max(0.75, WIDTH[kind] / cellM / 2);
      strokeLine(W, H, l.g, r, (i) => {
        if (ground[i] === G.BLDG && kind !== 'avenue' && kind !== 'street') return;
        if (ground[i] === G.WATER && !l.bridge) return;
        if (ground[i] === G.BLDG) { const b = buildings[bldgId[i]]; if (b) b.cells = b.cells.filter((c) => c !== i); height[i] = 0; bldgId[i] = -1; }
        ground[i] = G.OPEN;
        if (surface[i] !== S.AVENUE) surface[i] = roadOf[kind];
      });
      if (kind === 'avenue' || kind === 'street') streetLines.push(l);
    }
  }

  // 3b. open "yard" far from anything mapped is the Hudson (OSM draws it as a coastline, not an area)
  {
    const mapped = new Uint8Array(N);
    for (let i = 0; i < N; i++) mapped[i] = ground[i] === G.BLDG || surface[i] !== S.YARD ? 1 : 0;
    const dist = new Int16Array(N).fill(99);
    const q = [];
    for (let i = 0; i < N; i++) if (mapped[i]) { dist[i] = 0; q.push(i); }
    for (let h = 0; h < q.length; h++) {
      const i = q[h]; if (dist[i] >= 6) continue;
      const x = i % W; const y = (i - x) / W;
      for (const [dx, dy] of DIRS4) { const nx = x + dx; const ny = y + dy; if (inGrid(nx, ny) && dist[ny * W + nx] > dist[i] + 1) { dist[ny * W + nx] = dist[i] + 1; q.push(ny * W + nx); } }
    }
    for (let i = 0; i < N; i++) if (ground[i] === G.OPEN && surface[i] === S.YARD && dist[i] > 5) ground[i] = G.WATER;
  }

  // 4. walkable: open and in the largest connected piece
  const walk = new Uint8Array(N);
  for (let i = 0; i < N; i++) walk[i] = ground[i] === G.OPEN ? 1 : 0;
  keepLargest(W, H, walk);

  // 5. along the walls, the roadway
  const wall = new Uint8Array(N);
  const nearB = new Uint8Array(N);   // within 1.5 cells of a building
  for (let i = 0; i < N; i++) {
    if (!walk[i]) continue;
    const x = i % W; const y = (i - x) / W;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx; const ny = y + dy;
      if (!inGrid(nx, ny)) continue;
      if (ground[ny * W + nx] === G.BLDG) { nearB[i] = 1; if (!dx || !dy) wall[i] = 1; }
    }
  }
  const road = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (walk[i] && (surface[i] === S.AVENUE || surface[i] === S.STREET) && !nearB[i]) road[i] = 1;

  // 6. soil: lawns, yards, woods; street trees make tree pits in the sidewalk
  const soil = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (walk[i] && (surface[i] === S.LAWN || surface[i] === S.YARD || surface[i] === S.WOODS)) soil[i] = 1;
  const trees = [];
  for (const p of place.points) {
    if (p.kind !== 'tree') continue;
    const c = cellOf(p.lon, p.lat);
    if (c < 0 || !walk[c]) continue;
    trees.push(c);
    soil[c] = 1;
  }

  // 7. elevation: NYC survey points and building ground elevations, smoothed onto the grid
  const elev = elevationField(place, geo, buildings);

  // 8. light: modelled poles along every street and avenue, and along campus and park paths
  const poles = [];
  const poleAt = (x, y) => { const c = Math.floor(y) * W + Math.floor(x); if (inGrid(x, y)) poles.push(c); };
  for (const l of streetLines) for (const [x, y] of along(l.g, config.lampEveryM / cellM)) poleAt(x, y);
  for (const l of byKind('path')) for (const [x, y] of along(l.g, config.pathLampEveryM / cellM)) poleAt(x, y);
  for (const p of place.points) if (p.kind === 'lamp') { const c = cellOf(p.lon, p.lat); if (c >= 0) poles.push(c); }
  const light = new Float32Array(N);
  splatLight(W, H, poles, config.lampReach, light, walk);

  // 9. people at the busiest hour, by surface; more around subway entrances
  const people = new Float32Array(N);
  const P = config.people;
  const byS = [P.yard, P.lawn, P.avenue, P.street, P.path, P.steps, P.plaza, P.woods];
  for (let i = 0; i < N; i++) if (walk[i]) people[i] = byS[surface[i]] * (road[i] ? 0.4 : 1);
  const subways = [];
  for (const p of place.points) {
    if (p.kind !== 'subway') continue;
    const c = cellOf(p.lon, p.lat);
    if (c < 0) continue;
    subways.push({ cell: nearestWalkable(W, H, walk, c, 4) ?? c, name: p.name });
    const x0 = c % W; const y0 = (c - x0) / W;
    for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) {
      const d = Math.hypot(dx, dy); const x = x0 + dx; const y = y0 + dy;
      if (d <= 5 && inGrid(x, y) && walk[y * W + x]) people[y * W + x] = Math.min(1.6, people[y * W + x] + P.subway * (1 - d / 5));
    }
  }
  let pmax = 0; for (let i = 0; i < N; i++) pmax = Math.max(pmax, people[i]);
  for (let i = 0; i < N; i++) people[i] /= pmax || 1;

  // 10. street names, for "where" in words, and street corners as landmarks
  const { names, street, cross, corners } = streetNames(W, H, lines, walk);

  // 11. the front of each building: the wall cell on its street side, nearest its middle
  const front = (cells, cx, cy) => {
    let best = -1; let bd = Infinity;
    for (const c of cells) {
      const x = c % W; const y = (c - x) / W;
      for (const [dx, dy] of DIRS4) {
        const nx = x + dx; const ny = y + dy;
        if (!inGrid(nx, ny)) continue;
        const j = ny * W + nx;
        if (!walk[j]) continue;
        const onStreet = surface[j] === S.AVENUE || surface[j] === S.STREET ? 0 : 6;
        const d = Math.hypot(nx + 0.5 - cx, ny + 0.5 - cy) + onStreet;
        if (d < bd) { bd = d; best = j; }
      }
    }
    return best;
  };

  // 12. where food is set out, every night
  const F = config.food;
  const sources = [];
  for (const b of buildings) {
    if (!b.cells.length) continue;
    const cx = b.g.reduce((s, p) => s + p[0], 0) / b.g.length; const cy = b.g.reduce((s, p) => s + p[1], 0) / b.g.length;
    const cell = front(b.cells, cx, cy);
    if (cell < 0) continue;
    b.front = cell;
    let amount = b.m2 * b.floors * F.residentialPerM2;
    let kind = 'home';
    if (b.use === 'campus' || b.use === 'school') { amount *= F.campusShare; kind = 'campus'; }
    else if (b.use === 'commercial') { amount *= F.commercialShare; kind = 'shop'; }
    else if (b.use === 'other') { amount *= F.campusShare; kind = 'campus'; }
    amount = Math.min(F.maxPerSource, amount);
    if (amount < 0.3) continue;
    sources.push({ id: sources.length, kind, cell, amount: round1(amount), name: b.name || '', building: b.id, units: Math.max(1, Math.round((b.m2 * b.floors) / 85)) });
  }
  const placeSource = (lon, lat, kind, amount, name, extra = {}) => {
    const c = cellOf(lon, lat);
    if (c < 0) return null;
    let cell = c;
    if (!walk[c] || !wall[c]) {
      // the nearest wall cell (a restaurant puts its bags at its own front)
      cell = nearestWhere(W, H, c, 4, (j) => walk[j] && wall[j]) ?? nearestWalkable(W, H, walk, c, 4);
    }
    if (cell == null) return null;
    const s = { id: sources.length, kind, cell, amount: round1(amount), name, ...extra };
    sources.push(s);
    return s;
  };
  const R = place.rats ?? {};
  for (const r of R.restaurants ?? []) placeSource(r.lon, r.lat, 'restaurant', F.restaurant + F.restaurantRatViolation * Math.min(3, r.rats), titleCase(r.name), { rats: r.rats, cuisine: r.cuisine });
  for (const p of place.points) if (p.kind === 'grocery') placeSource(p.lon, p.lat, 'grocery', F.grocery, p.name || 'Grocery');
  for (const b of R.litter ?? []) {
    const c = cellOf(b.lon, b.lat);
    if (c < 0) continue;
    const cell = nearestWalkable(W, H, walk, c, 3);
    if (cell == null) continue;
    sources.push({ id: sources.length, kind: 'basket', cell, amount: F.basket, name: b.ty, better: /Better Bin/i.test(b.ty) });
  }
  // block faces: sources on the same street between the same corners share a collection time
  for (const s of sources) s.face = `${street[s.cell]}|${Math.floor((s.cell % W) / 10)}|${Math.floor(s.cell / W / 10)}`;

  // 13. active sidewalk sheds: the wall cells along the building front, about one building long
  const shedFrom = (list, tag) => list.map((s, k) => {
    const c = cellOf(s.lon, s.lat);
    if (c < 0) return null;
    const start = nearestWhere(W, H, c, 4, (j) => wall[j] && (surface[j] === S.AVENUE || surface[j] === S.STREET)) ?? nearestWhere(W, H, c, 4, (j) => wall[j]);
    if (start == null) return null;
    const cells = [start]; const seen = new Set(cells);
    for (let q = 0; q < cells.length && cells.length < 4; q++) {
      const x = cells[q] % W; const y = (cells[q] - x) / W;
      for (const [dx, dy] of DIRS4) { const j = (y + dy) * W + x + dx; if (inGrid(x + dx, y + dy) && wall[j] && !seen.has(j)) { seen.add(j); cells.push(j); } }
    }
    return { id: `${tag}${k}`, a: s.a, bin: s.bin, from: s.from, to: s.to, lon: s.lon, lat: s.lat, cells };
  }).filter(Boolean);
  const sheds = shedFrom(R.shedsNow ?? [], 'S');
  const sheds2023 = shedFrom(R.sheds2023 ?? [], 'T');

  // 14. the real rat reports, on the grid, and a smoothed map of them (used to seed the colonies)
  const realPts = [];
  for (const r of R.r311 ?? []) { const c = cellOf(r.lon, r.lat); if (c >= 0) realPts.push({ cell: c, kind: '311', d: r.d, t: r.t, w: r.d === 'Rat Sighting' ? 1 : r.d === 'Mouse Sighting' ? 0.2 : 0.6 }); }
  for (const r of R.inspections ?? []) { const c = cellOf(r.lon, r.lat); if (c >= 0 && r.rat) realPts.push({ cell: c, kind: 'insp', n: r.n, rat: r.rat, a: r.a, w: Math.min(6, r.rat) }); }
  const realMap = new Float32Array(N);
  for (const p of realPts) {
    const x0 = p.cell % W; const y0 = (p.cell - x0) / W;
    for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
      const x = x0 + dx; const y = y0 + dy;
      if (!inGrid(x, y)) continue;
      realMap[y * W + x] += p.w * Math.exp(-(dx * dx + dy * dy) / 12);
    }
  }
  let rmax = 0; for (let i = 0; i < N; i++) rmax = Math.max(rmax, realMap[i]);
  for (let i = 0; i < N; i++) realMap[i] /= rmax || 1;

  const nodes = [];
  for (let i = 0; i < N; i++) if (walk[i]) nodes.push(i);

  // 15. lanes for cars: each street and avenue centreline as a run of roadway cells, both ways
  const lanes = [];
  {
    // OSM cuts streets into many ways: chain the pieces of each street end to end first
    const byName = new Map();
    for (const l of streetLines) { const k = `${l.name ?? ''}|${l.kind}`; if (!byName.has(k)) byName.set(k, []); byName.get(k).push(l.g.map((p) => [p[0], p[1]])); }
    const near = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1.5;
    for (const [k, segs] of byName) {
      const left = segs.slice();
      while (left.length) {
        let chain = left.shift(); let grew = true;
        while (grew) {
          grew = false;
          for (let j = 0; j < left.length; j++) {
            const g = left[j]; const a = chain[0]; const z = chain[chain.length - 1];
            if (near(z, g[0])) chain = chain.concat(g.slice(1));
            else if (near(z, g[g.length - 1])) chain = chain.concat(g.slice(0, -1).reverse());
            else if (near(a, g[g.length - 1])) chain = g.slice(0, -1).concat(chain);
            else if (near(a, g[0])) chain = g.slice(1).reverse().concat(chain);
            else continue;
            left.splice(j, 1); grew = true; break;
          }
        }
        const cells = [];
        for (let q = 0; q + 1 < chain.length; q++) {
          const [x0, y0] = chain[q]; const [x1, y1] = chain[q + 1];
          const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
          for (let t = 0; t <= n; t++) {
            const x = Math.floor(x0 + ((x1 - x0) * t) / n); const y = Math.floor(y0 + ((y1 - y0) * t) / n);
            if (x < 0 || y < 0 || x >= W || y >= H) continue;
            const i = y * W + x;
            if (cells[cells.length - 1] !== i) cells.push(i);
          }
        }
        if (cells.filter((i) => road[i]).length < 25) continue;
        const [name, kind] = k.split('|');
        lanes.push({ name, kind, cells }, { name, kind, cells: cells.slice().reverse() });
      }
    }
  }

  return {
    config, place: { id: place.id, name: place.name, sources: place.sources, ridership: place.ridership, months: R.months },
    geo, W, H, N, cellM, ground, surface, walk, wall, road, soil, elev, height, bldgId, buildings, trees,
    light, poles, people, subways, names, street, cross, corners, sources, sheds, sheds2023,
    real: { pts: realPts, map: realMap, r311: realPts.filter((p) => p.kind === '311').length, inspections: (R.inspections ?? []).length },
    nodes, lanes, seedRng: rng.next(),
  };
}

const round1 = (v) => Math.round(v * 10) / 10;
const titleCase = (s) => (s || '').toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase());

export function nearestWalkable(W, H, walk, cell, maxR = 6) {
  return nearestWhere(W, H, cell, maxR, (j) => walk[j]);
}
export function nearestWhere(W, H, cell, maxR, ok) {
  if (ok(cell)) return cell;
  const x0 = cell % W; const y0 = (cell - x0) / W;
  for (let r = 1; r <= maxR; r++) {
    let best = null; let bd = Infinity;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const x = x0 + dx; const y = y0 + dy;
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const j = y * W + x;
      if (!ok(j)) continue;
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = j; }
    }
    if (best !== null) return best;
  }
  return null;
}

export function splatLight(W, H, poles, reach, light, walk) {
  const R = Math.ceil(reach);
  for (const c of poles) {
    const x0 = c % W; const y0 = (c - x0) / W;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const x = x0 + dx; const y = y0 + dy;
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const j = y * W + x;
      if (!walk[j]) continue;
      const v = 1 - Math.hypot(dx, dy) / reach;
      if (v > light[j]) light[j] = v;
    }
  }
}

function keepLargest(W, H, walk) {
  const N = W * H;
  const comp = new Int32Array(N).fill(-1);
  let best = -1; let bestSize = 0; let c = 0;
  for (let s = 0; s < N; s++) {
    if (!walk[s] || comp[s] !== -1) continue;
    const stack = [s]; comp[s] = c; let size = 0;
    while (stack.length) {
      const i = stack.pop(); size++;
      const x = i % W; const y = (i - x) / W;
      for (const [dx, dy] of DIRS4) {
        const nx = x + dx; const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (walk[j] && comp[j] === -1) { comp[j] = c; stack.push(j); }
      }
    }
    if (size > bestSize) { bestSize = size; best = c; }
    c++;
  }
  for (let i = 0; i < N; i++) if (walk[i] && comp[i] !== best) walk[i] = 0;
}

// surveyed elevation points and building ground elevations, splatted with a Gaussian, holes filled
function elevationField(place, geo, buildings) {
  const { W, H } = geo;
  const N = W * H;
  const sum = new Float32Array(N); const wsum = new Float32Array(N);
  const add = (x, y, v) => {
    const R = 5;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const cx = Math.floor(x) + dx; const cy = Math.floor(y) + dy;
      if (cx < 0 || cy < 0 || cx >= W || cy >= H) continue;
      const d2 = (cx + 0.5 - x) ** 2 + (cy + 0.5 - y) ** 2;
      const w = Math.exp(-d2 / 6);
      sum[cy * W + cx] += w * v; wsum[cy * W + cx] += w;
    }
  };
  for (const [lon, lat, v] of place.elevation?.pts ?? []) { const [x, y] = geo.toGrid(lon, lat); add(x, y, v); }
  for (const b of buildings) {
    if (b.ground == null || !b.cells.length) continue;
    const c = b.cells[Math.floor(b.cells.length / 2)];
    add((c % W) + 0.5, Math.floor(c / W) + 0.5, b.ground);
  }
  const elev = new Float32Array(N);
  const have = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (wsum[i] > 0.05) { elev[i] = sum[i] / wsum[i]; have[i] = 1; }
  // fill the rest by repeated averaging of known neighbours
  for (let pass = 0; pass < 60; pass++) {
    let changed = 0;
    for (let i = 0; i < N; i++) {
      if (have[i]) continue;
      const x = i % W; const y = (i - x) / W;
      let s = 0; let n = 0;
      for (const [dx, dy] of DIRS4) { const nx = x + dx; const ny = y + dy; if (nx >= 0 && ny >= 0 && nx < W && ny < H && have[ny * W + nx]) { s += elev[ny * W + nx]; n++; } }
      if (n) { elev[i] = s / n; have[i] = 2; changed++; }
    }
    for (let i = 0; i < N; i++) if (have[i] === 2) have[i] = 1;
    if (!changed) break;
  }
  for (let i = 0; i < N; i++) elev[i] = Math.round(elev[i] * 10) / 10;
  return elev;
}

function streetNames(W, H, lines, walk) {
  const N = W * H;
  const names = []; const nameIdx = new Map();
  const street = new Int16Array(N).fill(-1); const cross = new Int16Array(N).fill(-1);
  const d1 = new Float32Array(N).fill(1e9); const d2 = new Float32Array(N).fill(1e9);
  const segDist = (px, py, [ax, ay], [bx, by]) => {
    const dx = bx - ax; const dy = by - ay; const L2 = dx * dx + dy * dy || 1e-9;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2));
    return Math.hypot(ax + t * dx - px, ay + t * dy - py);
  };
  for (const l of lines) {
    if (!l.name || !['avenue', 'street', 'path', 'steps', 'plaza', 'service'].includes(l.kind)) continue;
    if (!nameIdx.has(l.name)) { nameIdx.set(l.name, names.length); names.push(l.name); }
    const id = nameIdx.get(l.name);
    const r = Math.max(1, WIDTH[l.kind] / 8 / 2) + 3;
    strokeLine(W, H, l.g, r, (i) => {
      const x = (i % W) + 0.5; const y = Math.floor(i / W) + 0.5;
      let best = 1e9;
      for (let s = 1; s < l.g.length; s++) best = Math.min(best, segDist(x, y, l.g[s - 1], l.g[s]));
      if (street[i] === id) { d1[i] = Math.min(d1[i], best); return; }
      if (cross[i] === id) { d2[i] = Math.min(d2[i], best); if (d2[i] < d1[i]) { [street[i], cross[i]] = [cross[i], street[i]]; [d1[i], d2[i]] = [d2[i], d1[i]]; } return; }
      if (best < d1[i]) { cross[i] = street[i]; d2[i] = d1[i]; street[i] = id; d1[i] = best; } else if (best < d2[i]) { cross[i] = id; d2[i] = best; }
    });
  }
  const corners = [];
  const roadName = new Set(lines.filter((l) => l.name && ['avenue', 'street'].includes(l.kind)).map((l) => nameIdx.get(l.name)));
  for (let i = 0; i < N; i++) {
    if (!walk[i] || street[i] < 0 || cross[i] < 0 || !roadName.has(street[i]) || !roadName.has(cross[i])) continue;
    if (d1[i] > 1.5 || d2[i] > 1.5) continue;
    const key = [street[i], cross[i]].sort().join('|');
    if (corners.some((c) => c.key === key && Math.hypot(c.x - (i % W), c.y - Math.floor(i / W)) < 8)) continue;
    corners.push({ key, cell: i, x: i % W, y: Math.floor(i / W), name: `${short(names[street[i]])} & ${short(names[cross[i]])}` });
  }
  return { names, street, cross, corners };
}

// Where a cell is, in every frame of reference the simulation keeps.
export function describeLocation(city, cell) {
  const x = cell % city.W; const y = Math.floor(cell / city.W);
  const [lon, lat] = city.geo.toLonLat(x + 0.5, y + 0.5);
  const s = city.street[cell] >= 0 ? short(city.names[city.street[cell]]) : null;
  const c = city.cross[cell] >= 0 ? short(city.names[city.cross[cell]]) : null;
  return {
    grid: { x, y },
    metres: { east: Math.round((x + 0.5) * city.cellM), south: Math.round((y + 0.5) * city.cellM) },
    lonlat: [Math.round(lon * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6],
    elevation: city.elev[cell],
    street: s ? (c ? `${s}, near ${c}` : s) : SURFACE_NAMES[city.surface[cell]],
    surface: city.road[cell] ? 'roadway' : city.wall[cell] ? 'along a wall' : SURFACE_NAMES[city.surface[cell]],
  };
}
