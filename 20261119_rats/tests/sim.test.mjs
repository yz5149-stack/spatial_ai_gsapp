// node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CONFIG } from '../src/sim/config.js';
import { buildCity, describeLocation } from '../src/sim/city.js';
import { newSim, runDays, stepSim, measures } from '../src/sim/sim.js';
import { makeDesign, mutate, designCost, isBinned } from '../src/sim/design.js';

const place = JSON.parse(await readFile(new URL('../data/manhattanville.json', import.meta.url), 'utf8'));
const city = buildCity(place, CONFIG);

test('the city is built from the real data', () => {
  assert.ok(city.W > 90 && city.H > 100);
  assert.ok(city.nodes.length > 5000, 'walkable ground');
  assert.ok(city.sources.filter((s) => s.kind === 'restaurant').length > 10, 'restaurants from DOHMH');
  assert.ok(city.sheds.length > 5, 'sidewalk sheds from DOB permits');
  assert.ok(city.real.pts.length > 200, 'real 311 and inspection points');
  const loc = describeLocation(city, city.nodes[5000]);
  assert.ok(loc.lonlat[0] < -73.94 && loc.lonlat[1] > 40.8, 'lon/lat frame');
  assert.ok(typeof loc.street === 'string');
});

test('a run is deterministic for a seed', () => {
  const a = newSim(city, makeDesign('now'), { seed: 3 }); runDays(a, 1);
  const b = newSim(city, makeDesign('now'), { seed: 3 }); runDays(b, 1);
  assert.deepEqual(measures(a), measures(b));
});

test('rats know only what they have seen', () => {
  const sim = newSim(city, makeDesign('now'));
  for (let i = 0; i < 300; i++) stepSim(sim);   // 5 pm to 10 pm
  const out = sim.rats.filter((r) => r.knownCount > 0);
  assert.ok(out.length > 0, 'some rats went out');
  for (const r of out) assert.ok(r.knownCount < city.N / 4, 'partial knowledge');
});

test('bins keep food out of reach', () => {
  const now = newSim(city, makeDesign('now'));
  const old = newSim(city, makeDesign('y2022'));
  const reach = (sim) => sim.sources.filter((s) => s.kind === 'home').reduce((t, s) => t + s.amount * s.access, 0);
  assert.ok(reach(now) < reach(old), 'less food within reach with bins');
  const s = city.sources.find((x) => x.kind === 'restaurant');
  assert.equal(isBinned(city, makeDesign('now'), s), true, 'restaurants containerise since 2023');
});

test('inspectors find rat activity and treat burrows', () => {
  const sim = newSim(city, makeDesign('now'));
  runDays(sim, 5);
  const m = measures(sim);
  assert.ok(m.inspections > 5);
  assert.ok(m.failed <= m.inspections);
  assert.ok(m.failed > 0 || m.burrows > 0, 'found rat activity or a burrow');
});

test('designs mutate within budget', () => {
  let d = makeDesign('now');
  for (let k = 0; k < 20; k++) { d = mutate(city, d, k + 1, 2); assert.ok(designCost(d) <= CONFIG.budget + 1e-9); }
});

test('the night patrol spots, chases, and catches or misses rats', () => {
  const sim = newSim(city, makeDesign('now'));
  runDays(sim, 2);
  const m = measures(sim);
  assert.ok(m.spotted > 0, 'spotted some');
  assert.equal(m.caught + m.missed <= m.spotted, true);
  assert.ok(sim.totals.caught + sim.totals.missed > 0);
});
