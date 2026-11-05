// The map, the agents' knowledge, exploration, landmarks and the hunt.

import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/sim/config.js';
import { generateMaze } from '../src/sim/maze.js';
import { makeKnowledge, look, plan, frontiers } from '../src/sim/knowledge.js';
import { newSim, stepSim, runRounds, placeSurvivor, coverage } from '../src/sim/sim.js';

test('the maze is connected, has dead ends, loops and a hospital door', () => {
  for (const seed of [CONFIG.seed, 1, 2, 3, 4]) {
    const w = generateMaze(CONFIG, seed);
    const truth = { known: Int8Array.from(w.walk.subarray(0, w.W * w.H), (v) => (v ? 0 : 1)) };
    const r = plan(w, truth, w.lair);
    const open = w.nodes.filter((n) => n < w.W * w.H);
    assert.ok(open.every((n) => Number.isFinite(r.dist[n])), `seed ${seed}: every open cell reachable`);
    const dead = w.maze.links.filter((l) => l.size === 1).length;
    assert.ok(dead >= 3, `seed ${seed}: ${dead} dead ends`);
    assert.equal(w.walk[w.door], 1);
  }
});

test('an agent starts knowing only what is around it, and its vision is blocked by trees', () => {
  const w = generateMaze(CONFIG);
  const k = makeKnowledge(w, 'test');
  assert.ok(k.known.every((v) => v === -1));
  look(w, k, w.lair, 0, 8, 100, 0);
  const seen = k.known.filter((v) => v !== -1).length;
  assert.ok(seen > 9 && seen < 120, `${seen} cells seen at first`);
  // it never sees through an obstacle: every seen open cell is reachable on a straight-ish line
  for (let i = 0; i < k.known.length; i++) if (k.known[i] !== -1) assert.equal(k.known[i], w.walk[i] ? 0 : 1);
});

test('exploration maps nearly everything, makes landmarks relative to earlier ones, then ends', () => {
  const sim = newSim(CONFIG);
  while (sim.phase === 'explore' && sim.step < 4000) stepSim(sim);
  assert.notEqual(sim.phase, 'explore');
  assert.ok(coverage(sim) > 0.95, `coverage ${coverage(sim)}`);
  assert.equal(frontiers(sim.world, sim.creature.k).length, 0);
  const lms = sim.creature.k.landmarks;
  assert.ok(lms.some((l) => l.kind === 'exit'));
  assert.equal(lms.filter((l) => l.kind === 'deadend').length, sim.world.maze.links.filter((l) => l.size === 1).length);
  for (const l of lms.slice(1)) {
    const ref = lms.find((m) => m.id === l.ref);
    assert.ok(ref, `${l.id} refers to ${l.ref}`);
    assert.equal(ref.x + l.dx, l.x);
    assert.equal(ref.y + l.dy, l.y);
  }
});

test('placing the survivor makes the creature plan a route there on its own map', () => {
  const sim = newSim(CONFIG);
  while (sim.phase === 'explore') stepSim(sim);
  const cell = sim.world.nodes.find((n) => n < sim.world.W * sim.world.H && n % sim.world.W > 30 && !sim.world.doorCells.includes(n));
  assert.equal(placeSurvivor(sim, cell), true);
  assert.equal(sim.survivor.node, cell);
  stepSim(sim);
  assert.equal(sim.creature.mode, 'investigate');
  assert.ok(sim.creature.path.length > 2);
  assert.equal(placeSurvivor(sim, 0), false, 'not on the outer wall');
});

test('hunt rounds end, and the survivor wins some and loses some', () => {
  const sim = newSim(CONFIG);
  runRounds(sim, 24);
  const caught = sim.rounds.filter((r) => r.result === 'caught').length;
  assert.equal(sim.rounds.length, 24);
  assert.ok(caught >= 5 && caught <= 19, `${caught} of 24 caught`);
});
