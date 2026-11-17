// Eyes on the Street: who can see each piece of Morningside Heights, hour by hour.
//
// The place (streets, buildings, terrain) is the same grid as the final-project game
// (../20261116_final/src/sim/city.js, 8 m cells). On it:
//
//   lights    street lamps: modelled along every avenue and street (NYC lights them all; one pole per
//             ~30 m), assumed along park and campus paths (optional), OSM lamps, lamps you add.
//             Lamps reported out to 311 can be switched off. Light level per cell 0..1.
//   walkers   trips per hour from real MTA counts at 116 St-Columbia: people leaving the station
//             (origin-destination estimates) walk to buildings or out of the map; people entering it
//             walk from buildings; plus other walkers (a multiple of the riders, an assumption you set)
//             between buildings, shops and the map's edges. Buildings are weighted by floor area.
//             Walkers take the cheapest route; at night a dark cell costs more (people avoid dark
//             streets), so lighting changes where people walk.
//   eyes      the expected number of people who can see a spot at a random moment of that hour:
//             walkers within sight (30 m in light, 10 m in the dark), with a clear line (buildings,
//             trees block it), plus shopkeepers behind their windows while the shop is open.
//
// Nothing here predicts crime. It measures one spatial idea: natural surveillance (Jacobs' "eyes on
// the street", CPTED), and how lighting and street design change it.

import { buildCity, nearestWalkable, S, G } from '../../20261116_final/src/sim/city.js';
import { plan } from '../../20261116_final/src/sim/knowledge.js';

export const EYES = {
  cellM: 8,
  seed: 20261117,
  woodDensity: 0.42,
  walkSpeed: 1.3,          // m/s
  lampSpacing: 30,         // m, along avenues and streets
  pathLampSpacing: 45,     // m, along park and campus paths (assumed)
  lampFull: 10,            // m: full light within this distance of a pole
  lampReach: 25,           // m: no light from it beyond this
  sightLit: 30,            // m: you notice and recognise someone this far in light
  sightDark: 10,           // m: ... and this far in the dark
  windowSight: 15,         // m: a shopkeeper sees this far out of the window
  shopHours: [7, 22],      // assumed opening hours of the shops on OpenStreetMap
  lateShopHours: [7, 2],   // a late-night shop you add (closes at 2 am)
  dark: (h) => h >= 19 || h < 7,
  through: 0.25,           // share of station trips that continue out of the map
  watched: 0.5,            // a spot counts as watched with at least this many eyes on average
  litLevel: 0.35,          // a spot counts as lit at this light level or more
};

const xyOf = (W, i) => [i % W, Math.floor(i / W)];

// ---- the place and its fixed parts ------------------------------------------------------------
export function makeModel(place, eyesData, options = {}) {
  const cfg = { ...EYES, ...options.config };
  const world = buildCity(place, { cellM: cfg.cellM, seed: cfg.seed, woodDensity: cfg.woodDensity }, {});
  const { W, H, N } = world;
  const m = cfg.cellM;
  const model = { cfg, world, place, data: eyesData };

  // street lamps along the OSM centre lines
  const lamps = [];
  const near = (x, y, r) => lamps.some((l) => (l.x - x) ** 2 + (l.y - y) ** 2 < r * r);
  const toGrid = (p) => world.geo.toGrid(p[0], p[1]);
  const along = (pts, spacing, src) => {
    let carry = spacing / 2;
    for (let s = 1; s < pts.length; s++) {
      const [ax, ay] = pts[s - 1]; const [bx, by] = pts[s];
      const L = Math.hypot(bx - ax, by - ay) * m;
      let t = carry;
      while (t <= L) {
        const x = ax + ((bx - ax) * t) / L; const y = ay + ((by - ay) * t) / L;
        if (x >= 0 && y >= 0 && x < W && y < H && !near(x, y, 12 / m)) lamps.push({ x, y, src });
        t += spacing;
      }
      carry = t - L;
    }
  };
  for (const l of place.lines) if (['avenue', 'street', 'service'].includes(l.kind)) along(l.pts.map(toGrid), cfg.lampSpacing, 'street');
  model.pathLines = place.lines.filter((l) => ['path', 'steps'].includes(l.kind)).map((l) => l.pts.map(toGrid));
  for (const p of place.points) if (p.kind === 'lamp') { const [x, y] = world.geo.toGrid(p.lon, p.lat); if (!near(x, y, 6 / m)) lamps.push({ x, y, src: 'osm' }); }
  model.streetLamps = lamps;
  model.pathLamps = [];
  const save = lamps.slice();
  for (const pl of model.pathLines) along(pl, cfg.pathLampSpacing, 'path');
  model.pathLamps = lamps.slice(save.length);
  lamps.length = save.length;

  // 311 reports of lights out, placed on the grid
  model.reports = (eyesData.lights311 ?? []).map((r) => { const [x, y] = world.geo.toGrid(r.lon, r.lat); return { ...r, x, y, out: /out/i.test(r.descriptor), multiple: /multiple/i.test(r.descriptor) }; });

  // origins and destinations
  const doorOf = (cell) => nearestWalkable(W, H, world.walk, cell, 8);
  model.station = world.pois.subways.map((s) => s.cell);
  const cellsOf = new Map();
  for (let i = 0; i < N; i++) if (world.bldgId[i] >= 0) { if (!cellsOf.has(world.bldgId[i])) cellsOf.set(world.bldgId[i], []); cellsOf.get(world.bldgId[i]).push(i); }
  model.buildings = [];
  for (const b of world.buildings) {
    const cells = cellsOf.get(b.id);
    if (!cells) continue;
    const cx = cells.reduce((s, c) => s + (c % W), 0) / cells.length; const cy = cells.reduce((s, c) => s + Math.floor(c / W), 0) / cells.length;
    const door = doorOf(Math.round(cy) * W + Math.round(cx));
    if (door !== null) model.buildings.push({ door, weight: cells.length * Math.max(1, b.h / 3.2) });
  }
  // the edges of the map where people walk in and out: border cells on streets and paths, grouped
  const gates = [];
  for (let i = 0; i < N; i++) {
    const [x, y] = xyOf(W, i);
    if (!world.walk[i] || (x > 0 && y > 0 && x < W - 1 && y < H - 1)) continue;
    const s = world.surface[i];
    const w = s === S.AVENUE ? 3 : s === S.STREET ? 2 : s === S.PATH || s === S.STEPS ? 1 : 0;
    if (!w) continue;
    const g = gates.find((q) => Math.hypot(q.x - x, q.y - y) < 4);
    if (g) g.weight = Math.max(g.weight, w); else gates.push({ door: i, x, y, weight: w });
  }
  model.gates = gates;
  model.shops = world.pois.shops.map((s) => s.cell);
  return model;
}

// ---- a scenario: lighting and additions on top of the place -------------------------------------
// scenario = { pathLamps: bool, outages: 'none' | 'open' | 'all', addLamps: [{x, y}], removeLamps: [index],
//              lateShops: [cell], others: number (other walkers per subway rider), darkAvoid: number, day: 'weekday' | ... }
export function lampsFor(model, sc) {
  let lamps = model.streetLamps.map((l, i) => ({ ...l, i, on: true }));
  if (sc.pathLamps) lamps = lamps.concat(model.pathLamps.map((l, j) => ({ ...l, i: model.streetLamps.length + j, on: true })));
  for (const k of sc.removeLamps ?? []) { const l = lamps.find((q) => q.i === k); if (l) l.on = false; }
  if (sc.outages && sc.outages !== 'none') {
    for (const r of model.reports) {
      if (!r.out) continue;
      if (sc.outages === 'open' && /closed/i.test(r.status)) continue;
      const near = lamps.filter((l) => l.on).map((l) => ({ l, d: Math.hypot(l.x - r.x, l.y - r.y) * model.cfg.cellM }))
        .filter((q) => q.d <= (r.multiple ? 45 : 30)).sort((a, b) => a.d - b.d).slice(0, r.multiple ? 3 : 1);
      for (const q of near) { q.l.on = false; q.l.reported = r; }
    }
  }
  for (const a of sc.addLamps ?? []) lamps.push({ x: a.x, y: a.y, src: 'design', on: true, i: `a${a.x},${a.y}` });
  return lamps;
}

// Light level 0..1 on every cell: each pole lights fully within lampFull and fades out by lampReach;
// buildings and tree crowns cast the light's shadow.
export function lightField(model, lamps) {
  const { world, cfg } = model;
  const { W, H, N } = world;
  const L = new Float32Array(N);
  const dark = new Float32Array(N).fill(1);
  const reach = cfg.lampReach / cfg.cellM;
  for (const l of lamps) {
    if (!l.on) continue;
    const x0 = Math.max(0, Math.floor(l.x - reach)); const x1 = Math.min(W - 1, Math.ceil(l.x + reach));
    const y0 = Math.max(0, Math.floor(l.y - reach)); const y1 = Math.min(H - 1, Math.ceil(l.y + reach));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = y * W + x;
      if (!world.walk[i]) continue;
      const d = Math.hypot(x + 0.5 - l.x, y + 0.5 - l.y) * cfg.cellM;
      if (d > cfg.lampReach) continue;
      if (!clearLine(world, l.x, l.y, x + 0.5, y + 0.5)) continue;
      const f = d <= cfg.lampFull ? 1 : 1 - (d - cfg.lampFull) / (cfg.lampReach - cfg.lampFull);
      dark[i] *= 1 - 0.85 * f;
    }
  }
  for (let i = 0; i < N; i++) L[i] = world.walk[i] ? Math.min(1, (1 - dark[i]) / 0.85) : 0;
  return L;
}

// Is the straight line between two points (grid units) free of opaque cells?
function clearLine(world, ax, ay, bx, by) {
  const n = Math.ceil(Math.hypot(bx - ax, by - ay) * 3);
  for (let k = 1; k < n; k++) {
    const x = Math.floor(ax + ((bx - ax) * k) / n); const y = Math.floor(ay + ((by - ay) * k) / n);
    if (world.opaque[y * world.W + x]) return false;
  }
  return true;
}

// For each open cell, the open cells within sightLit metres that it can see: [cell, distance m]
export function sightLists(model) {
  if (model.sight) return model.sight;
  const { world, cfg } = model;
  const { W, H, N } = world;
  const r = Math.ceil(cfg.sightLit / cfg.cellM);
  const lists = new Array(N);
  for (let c = 0; c < N; c++) {
    if (!world.walk[c]) continue;
    const [cx, cy] = xyOf(W, c);
    const list = [];
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const x = cx + dx; const y = cy + dy;
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const p = y * W + x;
      if (!world.walk[p]) continue;
      const d = Math.hypot(dx, dy) * cfg.cellM;
      if (d > cfg.sightLit) continue;
      if (d > 0 && !clearLine(world, cx + 0.5, cy + 0.5, x + 0.5, y + 0.5)) continue;
      list.push(p, d);
    }
    lists[c] = Float32Array.from(list);
  }
  model.sight = lists;
  return lists;
}

// ---- flows: where people walk, per category, for one trip ---------------------------------------
// Returns seconds spent on each cell per trip of each category, for day routing and night routing.
function routeFlows(model, light, sc) {
  const { world, cfg } = model;
  const { N } = world;
  const truth = { known: Int8Array.from(world.walk, (v) => (v ? 0 : 1)) };
  const secPerCell = cfg.cellM / cfg.walkSpeed;
  const avoidNight = (mm) => (sc.darkAvoid ?? 1.5) * (1 - light[mm]);
  const trees = new Map();
  const tree = (from, night) => {
    const key = `${from}|${night ? 1 : 0}`;
    if (!trees.has(key)) trees.set(key, plan(world, truth, from, night ? { avoid: avoidNight } : {}));
    return trees.get(key);
  };
  // adds `w` trips along the route from -> to, into acc; returns the route length (cells)
  const addRoute = (acc, from, to, w, night) => {
    const t = tree(from, night);
    if (!Number.isFinite(t.dist[to])) return 0;
    let n = to; let len = 0;
    while (n !== -1 && n !== from) { acc[n] += w * secPerCell; const p = t.prev[n]; len += p >= 0 && (p % world.W !== n % world.W) && (Math.floor(p / world.W) !== Math.floor(n / world.W)) ? Math.SQRT2 : 1; n = p; }
    acc[from] += w * secPerCell;
    return len;
  };
  const norm = (list) => { const s = list.reduce((a, b) => a + b.weight, 0) || 1; return list.map((o) => ({ ...o, p: o.weight / s })); };
  const B = norm(model.buildings);
  const G2 = norm(model.gates);
  const homes = [...B.map((b) => ({ door: b.door, p: b.p * (1 - cfg.through) })), ...G2.map((g) => ({ door: g.door, p: g.p * cfg.through }))];
  const shopsOSM = model.shops.map((c) => ({ door: c, p: 1 / Math.max(1, model.shops.length) }));
  const late = (sc.lateShops ?? []).map((c) => ({ door: c, p: 1 / sc.lateShops.length }));
  const ends = [...B.map((b) => ({ door: b.door, p: b.p * 0.5 })), ...G2.map((g) => ({ door: g.door, p: g.p * 0.5 }))];
  const st = model.station.length ? model.station : [model.gates[0].door];

  const flows = {};
  const lengths = {};
  for (const night of [false, true]) {
    const tag = night ? 'night' : 'day';
    // station trips: from the station (exits) or to it (entries); routes are taken as symmetric
    const station = new Float64Array(N); let sl = 0;
    for (const s of st) for (const h of homes) sl += addRoute(station, s, h.door, h.p / st.length, night) * h.p / st.length;
    // other walkers: between buildings and edges
    const other = new Float64Array(N); let ol = 0;
    for (const a of ends) for (const b of ends) if (a.door !== b.door) ol += addRoute(other, a.door, b.door, a.p * b.p, night) * a.p * b.p;
    const sumAB = ends.reduce((s, a) => s + ends.reduce((t, b) => t + (a.door !== b.door ? a.p * b.p : 0), 0), 0) || 1;
    for (let i = 0; i < N; i++) other[i] /= sumAB;
    // trips to the shops (open hours only) and to the late-night shops you add
    const shop = new Float64Array(N);
    for (const a of ends) for (const s of shopsOSM) addRoute(shop, a.door, s.door, a.p * s.p, night);
    const lateF = new Float64Array(N);
    for (const a of ends) for (const s of late) addRoute(lateF, a.door, s.door, a.p * s.p, night);
    flows[tag] = { station, other, shop, late: lateF };
    lengths[tag] = { station: sl, other: ol / sumAB };
  }
  return { flows, lengths };
}

const openAt = (h, [a, b]) => (a < b ? h >= a && h < b : h >= a || h < b);

// ---- one hour --------------------------------------------------------------------------------
export function hourly(model, flows, light, h, sc) {
  const { world, cfg, data } = model;
  const { N } = world;
  const day = sc.day ?? 'weekday';
  const exits = data.exits[day][h]; const entries = data.entries[day][h];
  const riders = exits + entries;
  const others = (sc.others ?? 1.5) * riders;
  const night = cfg.dark(h);
  const f = flows.flows[night ? 'night' : 'day'];
  const shopsOpen = openAt(h, cfg.shopHours);
  const lateOpen = openAt(h, cfg.lateShopHours);
  const lateShare = (sc.lateShops?.length ? 0.04 * sc.lateShops.length : 0) * (lateOpen ? 1 : 0);
  const shopShare = shopsOpen ? 0.15 : 0;
  // people on each cell at a random moment of the hour
  const people = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    people[i] = (riders * f.station[i] + others * ((1 - shopShare - lateShare) * f.other[i] + shopShare * f.shop[i] + lateShare * f.late[i])) / 3600;
  }
  // eyes: people within sight of each cell, plus shopkeepers while open
  const sight = sightLists(model);
  const eyes = new Float32Array(N);
  for (let c = 0; c < N; c++) {
    const list = sight[c];
    if (!list) continue;
    const R = night ? cfg.sightDark + (cfg.sightLit - cfg.sightDark) * light[c] : cfg.sightLit;
    let e = 0;
    for (let k = 0; k < list.length; k += 2) if (list[k + 1] <= R) e += people[list[k]];
    eyes[c] = e;
  }
  const keepers = [...(shopsOpen ? model.shops : []), ...(lateOpen ? sc.lateShops ?? [] : [])];
  for (const s of keepers) {
    const list = sight[s];
    if (!list) continue;
    for (let k = 0; k < list.length; k += 2) if (list[k + 1] <= cfg.windowSight) eyes[list[k]] += 1;
  }
  return { h, people, eyes, riders, exits, entries, others, night };
}

// The measures of one hour
export function measures(model, light, hr) {
  const { world, cfg } = model;
  let cells = 0; let watched = 0; let darkUnwatched = 0; let walkTime = 0; let exposed = 0; let lit = 0; let onMap = 0;
  for (const i of world.nodes) {
    cells++;
    const L = hr.night ? light[i] : 1;
    const others = Math.max(0, hr.eyes[i] - hr.people[i]);      // people other than those on the spot
    if (hr.eyes[i] >= cfg.watched) watched++;
    if (L >= cfg.litLevel) lit++;
    if (hr.night && L < cfg.litLevel && hr.eyes[i] < cfg.watched) darkUnwatched++;
    walkTime += hr.people[i];
    if (others < cfg.watched) exposed += hr.people[i];
    onMap += hr.people[i];
  }
  return {
    h: hr.h, riders: Math.round(hr.riders), walkersOnMap: Math.round(onMap * 10) / 10,
    watchedShare: watched / cells, litShare: lit / cells, darkUnwatchedShare: darkUnwatched / cells,
    exposedWalking: walkTime ? exposed / walkTime : 0,
  };
}

// Mean eyes and light on each named street (avenues, streets and named paths)
export function streetTable(model, light, hr) {
  const { world } = model;
  const acc = new Map();
  for (const i of world.nodes) {
    const s = world.street[i];
    if (s < 0 || ![S.AVENUE, S.STREET, S.PATH, S.STEPS, S.PLAZA].includes(world.surface[i])) continue;
    if (!acc.has(s)) acc.set(s, { name: world.names[s], n: 0, eyes: 0, light: 0, minEyes: Infinity, darkest: 1 });
    const a = acc.get(s);
    a.n++; a.eyes += hr.eyes[i]; a.light += light[i]; a.minEyes = Math.min(a.minEyes, hr.eyes[i]); a.darkest = Math.min(a.darkest, light[i]);
  }
  return [...acc.values()].filter((a) => a.n >= 6).map((a) => ({ ...a, eyes: a.eyes / a.n, light: a.light / a.n })).sort((a, b) => a.eyes - b.eyes);
}

// Everything for a scenario: light, flows, all 24 hours, and how much people detour at night.
export function runScenario(model, sc) {
  const lamps = lampsFor(model, sc);
  const light = lightField(model, lamps);
  const flows = routeFlows(model, light, sc);
  const hours = Array.from({ length: 24 }, (_, h) => hourly(model, flows, light, h, sc));
  const m = hours.map((hr) => measures(model, light, hr));
  const detour = flows.lengths.day.station ? flows.lengths.night.station / flows.lengths.day.station - 1 : 0;
  return { sc, lamps, light, flows, hours, measures: m, detour };
}

export const G_ = G;
