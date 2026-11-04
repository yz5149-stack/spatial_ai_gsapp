// Position and movement relations, and the owls.

import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/sim/config.js';
import { makeContext } from '../src/sim/context.js';
import { newRun, stepRun } from '../src/sim/escape.js';
import { botInput } from '../src/sim/bot.js';
import { isAdjacent, isAbove, isBetween, isBehind, coverAt, stepCrows } from '../src/sim/relations.js';
import { makeTestWorld, EAST, WEST } from './helpers.mjs';

const open = [
  '##########',
  '#........#',
  '#........#',
  '#...H....#',
  '#........#',
  '##########',
];
const canopy = [
  '          ',
  '  ====    ',
  '  ====    ',
  '  =H==    ',
  '          ',
  '          ',
];

test('adjacent: one walking step, or the same column on the other level; never through a gap', () => {
  const { world, at } = makeTestWorld(open, canopy);
  assert.ok(isAdjacent(world, at(0, 2, 2), at(0, 3, 2)));
  assert.ok(isAdjacent(world, at(0, 2, 2), at(0, 3, 3)), 'diagonal');
  assert.ok(!isAdjacent(world, at(0, 2, 2), at(0, 4, 2)), 'one free cell in between');
  assert.ok(isAdjacent(world, at(0, 3, 2), at(1, 3, 2)), 'stacked: nothing to stand on between the levels');
  assert.ok(isAdjacent(world, at(0, 4, 3), at(1, 4, 3)), 'ladder');
  assert.ok(!isAdjacent(world, at(0, 2, 2), at(0, 2, 2)), 'a cell is not adjacent to itself');
});

test('adjacent: a diagonal step that cuts a tree corner is not adjacent', () => {
  const { world, at } = makeTestWorld([
    '#####',
    '#.T.#',
    '#...#',
    '#####',
  ]);
  assert.equal(isAdjacent(world, at(0, 1, 1), at(0, 2, 2)), false); // the corner (2, 1) is a tree
  assert.equal(isAdjacent(world, at(0, 1, 2), at(0, 2, 2)), true);
});

test('above: on the canopy within two columns of someone on the ground', () => {
  const { world, at } = makeTestWorld(open, canopy);
  assert.ok(isAbove(world, at(1, 3, 2), at(0, 3, 2)));
  assert.ok(isAbove(world, at(1, 3, 2), at(0, 5, 3)));
  assert.ok(!isAbove(world, at(1, 3, 2), at(0, 7, 2)));
  assert.ok(!isAbove(world, at(0, 3, 2), at(1, 3, 2)), 'the ground is below, not above');
});

test('between: on the segment, inside the tolerance, not past either end', () => {
  const { world, at } = makeTestWorld(open, canopy);
  const a = at(0, 1, 2);
  const b = at(0, 8, 2);
  assert.ok(isBetween(world, a, at(0, 4, 2), b, 1.6));
  assert.ok(isBetween(world, a, at(0, 4, 3), b, 1.6));
  assert.ok(!isBetween(world, a, at(0, 4, 4), b, 1.6), 'too far from the line');
  assert.ok(!isBetween(world, a, at(0, 8, 3), b, 1.6), 'at the end, not between');
  assert.ok(!isBetween(world, a, at(1, 4, 2), b, 1.6), 'on the canopy above a ground path');
});

test('behind: the rear half of the facing, within range', () => {
  const { world, at } = makeTestWorld(open, canopy);
  const me = at(0, 5, 2);
  assert.ok(isBehind(world, me, EAST, at(0, 2, 2), 9));
  assert.ok(!isBehind(world, me, WEST, at(0, 2, 2), 9));
  assert.ok(!isBehind(world, me, EAST, at(0, 8, 2), 9));
  assert.ok(!isBehind(world, me, EAST, at(0, 2, 2), 2), 'out of range');
});

test('among: counts solid cells around and names the main material', () => {
  const { world, at } = makeTestWorld([
    '#######',
    '#TTb..#',
    '#T.T..#',
    '#TbT..#',
    '#######',
  ]);
  const c = coverAt(world, at(0, 2, 2));
  assert.equal(c.solid, 8);
  assert.equal(c.kind, 'trees');
  assert.equal(coverAt(world, at(0, 4, 2)).solid, 3);
});

test('relations are listed every tick and movements carry a mover', () => {
  const ctx = makeContext(CONFIG);
  const kinds = new Set();
  for (let r = 1; r <= 12; r++) {
    const g = newRun(ctx, { round: r });
    while (!g.over) {
      stepRun(g, botInput(g));
      for (const m of g.relations.movement) {
        assert.ok(['player', 'creature'].includes(m.who));
        kinds.add(m.kind);
      }
      for (const p of g.relations.position) kinds.add(p.kind);
    }
  }
  for (const k of ['toward', 'away', 'behind', 'adjacent']) assert.ok(kinds.has(k), k);
});

test('crows perch in trees apart from the case and caw once when you are next to them', () => {
  const ctx = makeContext(CONFIG);
  const g = newRun(ctx, { round: 1 });
  assert.equal(g.crows.length, CONFIG.crows.count);
  for (const c of g.crows) assert.equal(ctx.world.ground[c.node], 1, 'a tree cell');
  const crow = g.crows[0];
  const beside = ctx.world.nodes.find((n) => isAdjacent(ctx.world, crow.node, n));
  g.player.node = beside;
  g.creature.node = beside; // right there: hears it for sure
  g.sounds = [];
  stepCrows(g);
  assert.equal(g.sounds.filter((s) => s.who === 'crow').length, 1);
  assert.equal(g.creature.heardAt, beside, 'it comes to where the crow saw you');
  g.sounds = [];
  stepCrows(g);
  assert.equal(g.sounds.length, 0, 'resting after a caw');
});
