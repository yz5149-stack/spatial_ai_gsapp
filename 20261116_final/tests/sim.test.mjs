// The real places, the agents' knowledge, survival, the design tools and evolution.

import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/sim/config.js';
import { PLACES } from '../src/data/places.js';
import { buildCity, describeLocation, G } from '../src/sim/city.js';
import { weatherAt, windChill, shelterFor, nightIndex } from '../src/sim/environment.js';
import { makeKnowledge, look, plan, frontiers } from '../src/sim/knowledge.js';
import { newSim, stepSim, runRounds, placeSurvivor, walkableCoverage, acoustic } from '../src/sim/sim.js';
import { randomDesign, mutate, designCost, BUDGET } from '../src/sim/design.js';
import { evaluateDesign, evolve } from '../src/sim/evaluate.js';
import { loadPlace } from './load.mjs';

const places = Object.fromEntries(PLACES.map((p) => [p.id, loadPlace(p.id)]));

test('every place becomes a connected grid with a refuge, real heights and real terrain', () => {
  for (const p of PLACES) {
    const w = buildCity(places[p.id], CONFIG, {});
    assert.ok(w.W >= 70 && w.H >= 50, `${p.id}: ${w.W} x ${w.H}`);
    const truth = { known: Int8Array.from(w.walk, (v) => (v ? 0 : 1)) };
    const r = plan(w, truth, w.door);
    assert.ok(w.nodes.every((n) => Number.isFinite(r.dist[n])), `${p.id}: every open cell reachable from the refuge`);
    assert.ok(w.nodes.length > w.N * 0.3, `${p.id}: enough open ground`);
    assert.ok(w.buildings.length > 5, `${p.id}: buildings`);
    const tallest = Math.max(...w.buildings.map((b) => b.h));
    assert.ok(tallest > 7, `${p.id}: tallest building ${tallest} m`);
    const lo = Math.min(...w.elev); const hi = Math.max(...w.elev);
    assert.ok(hi - lo > 3, `${p.id}: terrain from ${lo} to ${hi} m`);
  }
  const fidi = buildCity(places.fidi, CONFIG, {});
  assert.ok(Math.max(...fidi.buildings.map((b) => b.h)) > 150, 'Lower Manhattan has skyscrapers over 150 m');
});

test('a cell has several frames of reference: grid, metres, longitude and latitude, street', () => {
  const w = buildCity(places.morningside, CONFIG, {});
  const loc = describeLocation(w, w.door);
  const [lon, lat] = loc.lonlat;
  const b = places.morningside.bbox;
  assert.ok(lon > b.west && lon < b.east && lat > b.south && lat < b.north);
  assert.equal(loc.metres.east, Math.round((loc.grid.x + 0.5) * CONFIG.cellM));
  assert.match(loc.street, /\w/);
  // the projection goes both ways
  const [gx, gy] = w.geo.toGrid(lon, lat);
  assert.ok(Math.abs(gx - loc.grid.x - 0.5) < 0.01 && Math.abs(gy - loc.grid.y - 0.5) < 0.01);
  assert.ok(w.corners.some((c) => /Amsterdam/.test(c.name)), 'a corner on Amsterdam Avenue');
});

test('the storm comes from the real hourly record, and the wind chill follows the formula', () => {
  const w = buildCity(places.ramble, CONFIG, {});
  w.weather = places.ramble.weather;
  w.nightIndex = nightIndex(w.weather, CONFIG.night.start);
  const a = weatherAt(w, 0); const b = weatherAt(w, CONFIG.night.hours);
  assert.equal(a.time, CONFIG.night.start);
  assert.ok(a.temp < 0 && a.snowfall > 0 && a.wind > 15, 'a cold, snowy, windy start');
  assert.ok(b.depthCm >= a.depthCm, 'snow piles up through the night');
  assert.ok(Math.abs(windChill(-10, 20) - -17.9) < 0.2);
  // the lee of a building is sheltered
  const s = shelterFor(w, a.dir);
  assert.ok(Math.max(...s) > 0.5 && Math.min(...[...s].filter((_, i) => w.walk[i])) === 0);
});

test('an agent starts knowing only what is around it; buildings and trees block its view', () => {
  const w = buildCity(places.fidi, CONFIG, {});
  const k = makeKnowledge(w, 'test');
  assert.ok(k.known.every((v) => v === -1));
  look(w, k, w.door, 0, 7, 100, 0);
  const first = k.known.filter((v) => v !== -1).length;
  assert.ok(first >= 9 && first < 120, `${first} cells seen at first`);
  for (let a = 1; a < 8; a++) look(w, k, w.door, (a * Math.PI) / 4, 7, 100, 0);
  const around = k.known.filter((v) => v !== -1).length;
  assert.ok(around > first && around < Math.PI * 7.5 * 7.5, `${around} cells seen turning around`);
  for (let i = 0; i < k.known.length; i++) if (k.known[i] !== -1) assert.equal(k.known[i], w.walk[i] ? 0 : 1);
});

test('exploration maps the neighbourhood and names landmarks relative to earlier ones', () => {
  const sim = newSim(places.morningside, CONFIG, {}, 3);
  while (sim.phase === 'explore' && sim.step < 6000) stepSim(sim);
  assert.notEqual(sim.phase, 'explore');
  assert.ok(walkableCoverage(sim) > 0.97, `coverage ${walkableCoverage(sim)}`);
  assert.equal(frontiers(sim.world, sim.creature.k).length, 0);
  const lms = sim.creature.k.landmarks;
  assert.ok(lms.some((l) => l.kind === 'exit'));
  assert.ok(lms.filter((l) => l.kind === 'corner').length >= 8, 'street corners');
  for (const l of lms.slice(1)) {
    const ref = lms.find((m) => m.id === l.ref);
    if (!ref) continue; // short-term memories (sounds) fade
    assert.equal(ref.x + l.dx, l.x);
    assert.equal(ref.y + l.dy, l.y);
  }
});

test('sound carries downwind and is muffled by buildings', () => {
  const sim = newSim(places.fidi, CONFIG, {}, 1, { premapped: true });
  const w = sim.world;
  const a = w.door;
  const b = w.nodes.find((n) => Math.hypot((n % w.W) - (a % w.W), Math.floor(n / w.W) - Math.floor(a / w.W)) > 12);
  const dx = (b % w.W) - (a % w.W); const dy = Math.floor(b / w.W) - Math.floor(a / w.W);
  const toward = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;   // compass bearing a -> b
  sim.weather = { ...sim.weather, wind: 30, dir: (toward + 180) % 360 }; // wind from behind a, toward b
  const downwind = acoustic(sim, a, b);
  sim.weather = { ...sim.weather, dir: toward };                        // wind from b, toward a
  const upwind = acoustic(sim, a, b);
  assert.ok(downwind < upwind, `downwind ${downwind.toFixed(1)} < upwind ${upwind.toFixed(1)}`);
  assert.ok(downwind >= Math.hypot(dx, dy) * 0.6, 'never less than most of the straight line');
});

test('survivors feel the cold, use what the design gives them, and nights end four ways', () => {
  const base = buildCity(places.ramble, CONFIG, {});
  const sim = newSim(places.ramble, CONFIG, randomDesign(base, 9), 2, { premapped: true });
  assert.equal(sim.survivors.length, CONFIG.survivor.count);
  const w0 = sim.survivors.map((s) => s.warmth);
  for (let i = 0; i < 40; i++) stepSim(sim);
  assert.ok(sim.survivors.some((s, j) => s.warmth < w0[j]), 'warmth drops in the storm');
  runRounds(sim, 8);
  const kinds = new Set(sim.outcomes.map((o) => o.result));
  assert.ok(kinds.size >= 2, `outcomes: ${[...kinds]}`);
  // two survivors never stand on the same cell
  for (const s of sim.survivors) for (const t of sim.survivors) if (s !== t && s.active && t.active) assert.notEqual(s.node, t.node);
});

test('placing a survivor makes the creature plan a route there on its own map', () => {
  const sim = newSim(places.morningside, CONFIG, {}, 1, { premapped: true });
  const w = sim.world;
  const cell = w.nodes.find((n) => Math.hypot((n % w.W) - (w.lair % w.W), Math.floor(n / w.W) - Math.floor(w.lair / w.W)) > 25 && !w.doorCells.includes(n));
  assert.equal(placeSurvivor(sim, cell), true);
  assert.equal(sim.survivors[0].node, cell);
  stepSim(sim);
  assert.ok(['investigate', 'chase'].includes(sim.creature.mode));
  assert.ok(sim.creature.path.length > 2);
  assert.equal(placeSurvivor(sim, w.nodes.length ? -1 : 0), false);
});

test('designs stay within budget, mutate, and change the world', () => {
  const w = buildCity(places.morningside, CONFIG, {});
  let d = randomDesign(w, 4);
  assert.ok(designCost(d) <= BUDGET);
  for (let k = 0; k < 30; k++) { d = mutate(w, d, 50 + k, 1.5); assert.ok(designCost(d) <= BUDGET); }
  d.barricades = [{ cell: w.nodes[Math.floor(w.nodes.length / 2)], dir: 'h' }];
  const wb = buildCity(places.morningside, CONFIG, d);
  assert.ok(wb.ground.some((g) => g === G.BARRIER), 'a barricade blocks the way');
});

test('evaluation is repeatable, and evolution never loses its best design', () => {
  const w = buildCity(places.fidi, CONFIG, {});
  const d = randomDesign(w, 11);
  const a = evaluateDesign(places.fidi, CONFIG, d, { rounds: 2, seed: 5 });
  const b = evaluateDesign(places.fidi, CONFIG, d, { rounds: 2, seed: 5 });
  assert.deepEqual(a.metrics, b.metrics);
  const r = evolve(places.fidi, CONFIG, d, { epochs: 2, population: 2, rounds: 2, seed: 5 });
  assert.equal(r.history.length, 3);
  for (let e = 1; e < r.history.length; e++) assert.ok(r.history[e].best >= r.history[e - 1].best);
});
