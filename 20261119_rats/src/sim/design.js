// An environment design: what the city changes on the street, and what it costs.
//
//   policy   setOut     hour residential bags go out (16 before April 2023, 20 now)
//            pickup     'morning' or 'night' collection
//            binning    'none' | 'small' (buildings of 1-9 units, the 2024 rule) | 'cb9' (and Empire
//                       Bins for the large ones west of Morningside Park, as in 2025) | 'all'
//            shedSet    'now' (permits active on 2026-11-18) or '2023' (active on 2023-07-01)
//            inspectors how many DOHMH inspectors work the area
//   places   bins       extra sources put in lidded bins, by source id
//            lights     extra street lights, by cell
//            guards     tree pits and yards sealed (wire mesh, concrete), by cell
//            stations   permanent bait stations, by cell
//            sheds      per shed id: 'old' (dark plywood), 'light' (the 2026 see-through design), 'gone'

import { makeRng } from './rng.js';

export const COST = { bin: 0.5, light: 2, guard: 0.5, station: 1, shedLight: 3, shedGone: 5, inspector: 8, night: 12 };
export const LIMITS = { bins: 40, lights: 16, guards: 30, stations: 16 };

export const PRESETS = {
  y2022: { name: '2022 rules', setOut: 16, pickup: 'morning', binning: 'none', shedSet: '2023', inspectors: 2 },
  now: { name: 'Now (Nov 2026)', setOut: 20, pickup: 'morning', binning: 'cb9', shedSet: 'now', inspectors: 2 },
};

export function makeDesign(preset = 'now') {
  return { ...PRESETS[preset], bins: [], lights: [], guards: [], stations: [], sheds: {} };
}

export function designCost(d) {
  const shedCost = Object.values(d.sheds ?? {}).reduce((s, v) => s + (v === 'light' ? COST.shedLight : v === 'gone' ? COST.shedGone : 0), 0);
  return d.bins.length * COST.bin + d.lights.length * COST.light + d.guards.length * COST.guard + d.stations.length * COST.station
    + shedCost + Math.max(0, d.inspectors - 2) * COST.inspector + (d.pickup === 'night' ? COST.night : 0);
}

export const cloneDesign = (d) => ({ ...d, bins: [...d.bins], lights: [...d.lights], guards: [...d.guards], stations: [...d.stations], sheds: { ...d.sheds } });

// Is a source's trash in a lidded bin under this design?
export function isBinned(city, d, s) {
  if (d.bins.includes(s.id)) return true;
  if (d.binning === 'none') return false;
  if (s.kind === 'restaurant' || s.kind === 'grocery') return true;   // 2023: food businesses containerise
  if (s.kind !== 'home') return false;
  if (d.binning === 'all') return true;
  if (s.units <= 9) return true;                                   // 2024: 1-9 units must use bins
  if (d.binning === 'cb9') {
    const [lon] = city.geo.toLonLat((s.cell % city.W) + 0.5, Math.floor(s.cell / city.W) + 0.5);
    return lon < -73.9575;                                          // 2025: Empire Bins in Community Board 9 (approx.)
  }
  return false;
}

// candidate cells for each kind of intervention, chosen where they can matter
export function candidates(city) {
  const { W, walk, wall, soil, road, light } = city;
  const lights = []; const guards = []; const stations = [];
  for (let i = 0; i < city.N; i++) {
    if (!walk[i]) continue;
    const x = i % W; const y = (i - x) / W;
    if (x % 2 || y % 2) continue;
    if (light[i] < 0.25 && !road[i]) lights.push(i);
    if (soil[i]) guards.push(i);
    if (wall[i]) stations.push(i);
  }
  return { lights, guards, stations };
}

export function randomDesign(city, seed, base = makeDesign('now')) {
  const rng = makeRng(seed);
  const d = cloneDesign(base);
  const cand = candidates(city);
  const heavy = city.sources.filter((s) => s.kind === 'home' && !isBinned(city, d, s)).sort((a, b) => b.amount - a.amount);
  for (let k = 0; k < 4; k++) d.lights.push(rng.pick(cand.lights));
  for (let k = 0; k < 6; k++) d.guards.push(rng.pick(cand.guards));
  for (let k = 0; k < 6; k++) d.stations.push(rng.pick(cand.stations));
  for (let k = 0; k < 8 && heavy.length; k++) d.bins.push(heavy[rng.int(0, Math.min(heavy.length - 1, 40))].id);
  d.bins = [...new Set(d.bins)];
  return fitBudget(city, d, rng);
}

// a variation: move, add or drop a few things, maybe change a policy
export function mutate(city, design, seed, strength = 1) {
  const rng = makeRng(seed);
  const d = cloneDesign(design);
  const cand = candidates(city);
  const W = city.W;
  const nudge = (cell, pool) => {
    // a nearby candidate, so variations stay recognisable
    const x = cell % W; const y = (cell - x) / W;
    const near = pool.filter((c) => Math.abs((c % W) - x) <= 12 && Math.abs(Math.floor(c / W) - y) <= 12);
    return near.length ? rng.pick(near) : rng.pick(pool);
  };
  const moves = 2 + Math.round(rng.next() * 3 * strength);
  for (let m = 0; m < moves; m++) {
    const r = rng.next();
    const listOp = (key, pool, limit) => {
      const list = d[key];
      const op = rng.next();
      if (op < 0.4 && list.length) { const k = rng.int(0, list.length - 1); list[k] = nudge(list[k], pool); }
      else if (op < 0.75 && list.length < limit) list.push(rng.pick(pool));
      else if (list.length) list.splice(rng.int(0, list.length - 1), 1);
    };
    if (r < 0.18) listOp('stations', cand.stations, LIMITS.stations);
    else if (r < 0.34) listOp('guards', cand.guards, LIMITS.guards);
    else if (r < 0.48) listOp('lights', cand.lights, LIMITS.lights);
    else if (r < 0.66) {
      const open = city.sources.filter((s) => s.kind !== 'basket' && !isBinned(city, { ...d, bins: [] }, s));
      if (rng.chance(0.65) && d.bins.length < LIMITS.bins && open.length) d.bins.push(rng.pick(open.sort((a, b) => b.amount - a.amount).slice(0, 60)).id);
      else if (d.bins.length) d.bins.splice(rng.int(0, d.bins.length - 1), 1);
      d.bins = [...new Set(d.bins)];
    } else if (r < 0.8) {
      const sheds = d.shedSet === '2023' ? city.sheds2023 : city.sheds;
      if (sheds.length) { const s = rng.pick(sheds); d.sheds[s.id] = rng.pick(['old', 'light', 'gone']); }
    } else if (r < 0.88) d.setOut = rng.pick([16, 18, 20, 22]);
    else if (r < 0.93) d.pickup = d.pickup === 'night' ? 'morning' : 'night';
    else if (r < 0.97) d.inspectors = Math.max(1, Math.min(5, d.inspectors + (rng.chance(0.5) ? 1 : -1)));
    else d.binning = rng.pick(['small', 'cb9', 'all']);
  }
  return fitBudget(city, d, rng);
}

// drop things at random until the design is within budget
export function fitBudget(city, d, rng) {
  const budget = city.config.budget;
  let guard = 200;
  while (designCost(d) > budget && guard-- > 0) {
    const keys = ['bins', 'lights', 'guards', 'stations'].filter((k) => d[k].length);
    if (d.pickup === 'night' && rng.chance(0.3)) { d.pickup = 'morning'; continue; }
    if (d.inspectors > 2 && rng.chance(0.3)) { d.inspectors--; continue; }
    const shedKeys = Object.keys(d.sheds).filter((k) => d.sheds[k] !== 'old');
    if (shedKeys.length && rng.chance(0.3)) { delete d.sheds[rng.pick(shedKeys)]; continue; }
    if (!keys.length) break;
    const k = rng.pick(keys);
    d[k].splice(rng.int(0, d[k].length - 1), 1);
  }
  return d;
}

export function describeDesign(city, d) {
  const sheds = Object.values(d.sheds);
  const parts = [
    `bags out ${d.setOut}:00`, `${d.pickup} pickup`, { none: 'no bin rule', small: 'bins for 1–9 units', cb9: 'bins + Empire Bins (CB9)', all: 'bins everywhere' }[d.binning],
  ];
  if (d.bins.length) parts.push(`+${d.bins.length} bins`);
  if (d.stations.length) parts.push(`${d.stations.length} bait stations`);
  if (d.guards.length) parts.push(`${d.guards.length} tree pits sealed`);
  if (d.lights.length) parts.push(`+${d.lights.length} lights`);
  const light = sheds.filter((v) => v === 'light').length; const gone = sheds.filter((v) => v === 'gone').length;
  if (light) parts.push(`${light} see-through sheds`);
  if (gone) parts.push(`${gone} sheds removed`);
  parts.push(`${d.inspectors} inspectors`);
  return parts.join(' · ');
}
