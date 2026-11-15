import test from 'node:test';
import assert from 'node:assert/strict';
import { randomGenome, buildStore, mutateGenome, bfs } from '../src/sim/store.js';
import { makeSim, runNights, step, distances } from '../src/sim/sim.js';
import { sunPosition, computeLight, conditionsFrom, PRESETS } from '../src/sim/light.js';
import { acousticDistance, point } from '../src/sim/los.js';
import { evaluate } from '../src/sim/evolve.js';
import { CATS } from '../src/sim/config.js';

test('generated stores are valid: every product and the stockroom are reachable', () => {
  for (let s = 1; s <= 25; s++) {
    const w = buildStore(randomGenome(s));
    assert.ok(w.ok, `store ${s}`);
    for (const c of CATS) assert.ok(w.access[c].length > 0, `store ${s} has ${c}`);
    assert.ok(w.reach[w.lair] >= 0);
  }
});

test('mutations stay valid and record what changed', () => {
  let g = randomGenome(3);
  for (let i = 0; i < 30; i++) {
    g = mutateGenome(g, 100 + i);
    assert.ok(buildStore(g).ok);
    assert.ok(g.edits.length >= 1);
    assert.equal(g._m, undefined);
  }
});

test('the sun over Morningside Heights', () => {
  const noon = sunPosition(new Date('2025-12-21T12:00:00-05:00'), 40.8075, -73.9626);
  assert.ok(Math.abs(noon.elevation - 25.7) < 1.5, `winter noon elevation ${noon.elevation}`);
  assert.ok(Math.abs(noon.azimuth - 180) < 4);
  const night = sunPosition(new Date('2016-01-23T21:00:00-05:00'), 40.8075, -73.9626);
  assert.ok(night.elevation < -20);
});

test('daylight reaches the floor through the glass at noon, not at night', () => {
  const w = buildStore(randomGenome(5));
  const p = PRESETS.winterNoon;
  computeLight(w, conditionsFrom(p.weather, new Date(p.date)));
  assert.ok(w.sunShare > 0.02, `sunlit share ${w.sunShare}`);
  const b = PRESETS.blizzard;
  computeLight(w, conditionsFrom(b.weather, new Date(b.date)));
  assert.equal(w.sunShare, 0);
});

test('a tall gondola muffles sound; a low one does not at ear height', () => {
  const w = buildStore(randomGenome(9));
  const r = w.genome.runs.find((x) => x.dir === 'v' && x.len >= 4);
  if (!r) return;
  const y = r.y + 1;
  const a = y * w.W + (r.x - 1); const b = y * w.W + (r.x + 2);
  const d = acousticDistance(w, point(w, a, 1.6), point(w, b, 1.6));
  if (r.tall) assert.ok(d > 3 + 4, `muffled ${d}`); else assert.ok(d < 3.5, `clear ${d}`);
});

test('nights run, agents keep to their own maps, results are recorded', () => {
  const w = buildStore(randomGenome(11));
  const sim = makeSim(w, { seed: 4 });
  const nights = runNights(sim, 3);
  assert.equal(nights.length, 3);
  for (const n of nights) assert.equal(n.escaped + n.caught + n.stranded, n.survivors);
  assert.ok(sim.creature.k.knownCount > 100);
  assert.ok(sim.creature.k.landmarks.length > 0);
});

test('distances: path ≥ straight line, acoustic ≥ straight line', () => {
  const w = buildStore(randomGenome(12));
  const sim = makeSim(w, { seed: 1 });
  for (let i = 0; i < 5; i++) step(sim);
  const floor = [];
  const d0 = bfs(w, w.entry);
  for (let i = 0; i < w.N; i++) if (d0[i] > 0) floor.push(i);
  for (const c of floor.slice(0, 200).filter((_, k) => k % 20 === 0)) {
    const d = distances(sim, w.entry, c);
    assert.ok(d.path >= d.euclid - 1e-9);
    assert.ok(d.acoustic >= d.euclid - 1e-9);
  }
});

test('evaluation is repeatable with the same seeds', () => {
  const g = randomGenome(13);
  const a = evaluate(g, { nights: 2, seeds: [1] });
  const b = evaluate(g, { nights: 2, seeds: [1] });
  assert.equal(a.fitness, b.fitness);
});
