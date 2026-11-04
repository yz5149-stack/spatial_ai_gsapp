// A simple scripted player, used only to balance the game (tests/balance.mjs) and in the tests.
// It only knows what a player could know (where it last saw or heard the creature). It walks to the
// case, then to the hospital, steps away from the creature, shoots when it comes close, and climbs a
// tree to hide when it is hunted and the case is not beeping.

import { forEachNeighbour } from './world.js';
import { directionTo, newRun, stepRun, actionsFor } from './escape.js';

export function botInput(game, { skill = 1 } = {}) {
  const { world, pf } = game.ctx;
  const me = game.player;
  const c = game.creature;
  const goal = me.carrying ? game.door : game.caseItem.node;
  const fresh = me.knownCreature !== null && game.step - me.knownStep <= 10;
  const where = fresh ? me.knownCreature : null;
  const frozen = c.frozenLeft > 0 && me.seesCreature;
  const dC = where === null ? Infinity : pf.distance(me.node, where);
  const input = { dx: 0, dy: 0, shoot: false, climb: false };
  const acts = actionsFor(game);

  // in a tree: stay while it is close, come down when it has gone
  if (me.inTree !== null) {
    if (!me.seesCreature || dC >= 7) input.climb = true;
    return input;
  }
  if (acts.shoot && dC <= 2 + skill * 1.5) { input.shoot = true; return input; }
  if (acts.climb === 'up' && !frozen && game.alarmLeft === 0 && where !== null && dC <= 4 && c.mode === 'chase') {
    input.climb = true;
    return input;
  }

  // pick the neighbour that gets closer to the goal without walking into the creature
  const rowGoal = pf.row(goal);
  const rowC = where === null || frozen ? null : pf.row(where);
  const idx = (n) => world.nodeIndex[n];
  let best = null;
  let bestScore = Infinity;
  forEachNeighbour(world, me.node, (n, cost) => {
    let score = cost + rowGoal[idx(n)];
    if (rowC) {
      const dn = rowC[idx(n)];
      if (dn <= 1.5) score += 100;
      else if (dC <= 8) score -= skill * 0.6 * Math.min(dn, 6);
    }
    if (score < bestScore) { bestScore = score; best = n; }
  });
  if (best !== null) Object.assign(input, directionTo(world, me.node, best));
  return input;
}

export function playBotRun(ctx, opts = {}) {
  const game = newRun(ctx, opts);
  while (!game.over) stepRun(game, botInput(game, opts));
  return game;
}
