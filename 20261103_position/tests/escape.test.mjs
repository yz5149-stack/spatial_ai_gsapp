// The escape game: moving, climbing, hiding, shooting, the case, winning and losing.

import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/sim/config.js';
import { makeContext } from '../src/sim/context.js';
import { newRun, stepRun, stepCell, treeNextTo, actionsFor } from '../src/sim/escape.js';
import { playBotRun } from '../src/sim/bot.js';
import { nodeXYL } from '../src/sim/world.js';

const ctx = makeContext(CONFIG);
const far = (g) => { // park the creature far away, out of the way
  const row = ctx.pf.row(g.player.node);
  g.creature.node = ctx.world.nodes.reduce((a, b) => (row[ctx.world.nodeIndex[b]] > row[ctx.world.nodeIndex[a]] ? b : a));
  g.creature.frozenLeft = 1e6;
};

test('a run starts on the west side, far from the case, with the creature near the case', () => {
  for (let r = 1; r <= 15; r++) {
    const g = newRun(ctx, { round: r });
    assert.ok(nodeXYL(ctx.world, g.player.node).x <= ctx.world.W * 0.5);
    assert.ok(ctx.pf.distance(g.caseItem.node, g.door) >= CONFIG.game.caseFromDoor);
    assert.ok(ctx.pf.distance(g.creature.node, g.caseItem.node) <= CONFIG.policeStartFromDiamond[1]);
    assert.equal(g.over, false);
  }
});

test('walking moves 2 cells in 4 ticks', () => {
  const g = newRun(ctx, { round: 2 });
  far(g);
  const dir = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([dx, dy]) => {
    let n = g.player.node;
    for (let k = 0; k < 3; k++) { n = stepCell(ctx.world, n, dx, dy); if (n === null) return false; }
    return true;
  });
  assert.ok(dir, 'some straight run of 3 cells');
  const start = g.player.node;
  for (let k = 0; k < 4; k++) stepRun(g, { dx: dir[0], dy: dir[1] });
  assert.equal(ctx.pf.distance(start, g.player.node), 2);
});

test('the climb key gets you into a tree next to you; up there it cannot see or catch you, and you come down in time', () => {
  const g = newRun(ctx, { round: 3 });
  far(g);
  g.player.node = ctx.world.nodes.find((n) => treeNextTo(ctx.world, n) !== null);
  assert.equal(actionsFor(g).climb, 'up');
  stepRun(g, { climb: true });
  for (let k = 0; k < CONFIG.game.climbTicks; k++) stepRun(g, {});
  assert.notEqual(g.player.inTree, null);
  assert.ok(g.relations.position.some((r) => r.kind === 'above'));
  assert.equal(actionsFor(g).climb, 'down');
  // the creature right under the tree: still not caught, not seen
  let next = null;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { next = stepCell(ctx.world, g.player.node, dx, dy); if (next !== null) break; }
  g.creature.node = next;
  g.creature.frozenLeft = 0;
  g.creature.mode = 'search';
  g.creature.searchLeft = 99;
  stepRun(g, {});
  assert.equal(g.over, false);
  assert.equal(g.creature.seesPlayer, false);
  // you cannot hold on forever
  g.creature.frozenLeft = 1e6;
  for (let k = 0; k < CONFIG.game.treeTicks + CONFIG.game.climbTicks + 2; k++) stepRun(g, {});
  assert.equal(g.player.inTree, null);
});

test('a shot within range and in the clear freezes the creature for 3 seconds and costs a bullet', () => {
  const g = newRun(ctx, { round: 5 });
  // put the creature three cells away along a free line
  let target = null;
  for (const n of ctx.world.nodes) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = stepCell(ctx.world, n, dx, dy); const b = a !== null ? stepCell(ctx.world, a, dx, dy) : null;
      const c = b !== null ? stepCell(ctx.world, b, dx, dy) : null;
      if (c !== null) { target = c; g.player.node = n; break; }
    }
    if (target !== null) break;
  }
  g.creature.node = target;
  const ammo = g.player.ammo;
  g.player.seesCreature = true;
  stepRun(g, { climb: true }); // the wrong key: nothing happens to it
  assert.equal(g.creature.mode === 'frozen', false);
  g.player.seesCreature = true;
  g.player.busy = 0; g.player.climbing = null; g.player.inTree = null;
  stepRun(g, { shoot: true });
  assert.equal(g.player.ammo, ammo - 1);
  assert.equal(g.creature.mode, 'frozen');
  assert.equal(g.over, false, 'a frozen creature does not catch you');
  assert.ok(g.creature.frozenLeft >= CONFIG.game.freezeTicks - 2);
});

test('carrying the case to the hospital door wins; the creature next to you loses', () => {
  const g = newRun(ctx, { round: 6 });
  far(g);
  g.player.node = g.caseItem.node;
  stepRun(g, {});
  assert.equal(g.player.carrying, true);
  assert.ok(g.alarmLeft > 0);
  g.player.node = g.door;
  stepRun(g, {});
  assert.equal(g.result, 'win');

  const h = newRun(ctx, { round: 7 });
  let next = null;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { next = stepCell(ctx.world, h.player.node, dx, dy); if (next !== null) break; }
  h.creature.node = next;
  stepRun(h, {});
  assert.equal(h.result, 'lose');
});

test('every run ends, and the scripted player wins some and loses some on normal', () => {
  let wins = 0;
  for (let r = 1; r <= 30; r++) {
    const g = playBotRun(ctx, { round: r });
    assert.ok(g.over);
    if (g.result === 'win') wins++;
  }
  assert.ok(wins >= 6 && wins <= 24, `${wins} of 30`);
});

test('the creature does not get stuck: never more than 30 ticks on one cell while wandering or investigating', () => {
  for (let r = 1; r <= 25; r++) {
    const g = newRun(ctx, { round: r });
    let still = 0;
    let last = g.creature.node;
    while (!g.over) {
      stepRun(g, { dx: 0, dy: 0 }); // you stand still, so it has to find you
      if (g.step > 600) break;
      const c = g.creature;
      if (c.node === last && (c.mode === 'patrol' || c.mode === 'investigate')) still++;
      else still = 0;
      last = c.node;
      assert.ok(still <= 30, `run ${r}: stuck for ${still} ticks at step ${g.step} in mode ${c.mode}`);
    }
  }
});
