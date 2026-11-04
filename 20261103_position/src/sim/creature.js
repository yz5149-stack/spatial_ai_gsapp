// The creature: a tangle of roots that guards the vaccine case. It acts once per tick.
//   patrol       wanders the open ground around the case
//   investigate  goes to a sound (your footsteps, a shot, a crow)
//   chase        runs at you while it sees you
//   search       turns a full circle where it lost you
//   track        the case's alarm tells it where you are
//   ambush       lost you while you carry the case: it goes to stand between you and the hospital
//   frozen       hit by a shot: does nothing for 3 seconds
// Speeds come from the difficulty; fractions carry over between ticks.

import { canSee } from './los.js';
import { nodeXYL, forEachNeighbour } from './world.js';

export const CREATURE_MODES = {
  patrol: 'Wandering',
  investigate: 'Heading for a sound',
  chase: 'Chasing you',
  search: 'Searching around',
  track: 'Following the alarm',
  ambush: 'Cutting you off',
  frozen: 'Frozen',
};

const TURN = Math.PI / 4;

export function headingTo(ctx, a, b) {
  const p = nodeXYL(ctx.world, a);
  const q = nodeXYL(ctx.world, b);
  if (p.x === q.x && p.y === q.y) return null;
  return Math.atan2(q.y - p.y, q.x - p.x);
}

export function newCreature(node, facing) {
  return {
    node, facing, mode: 'patrol', target: null, budget: 0, frozenLeft: 0, searchLeft: 0,
    heardAt: null, seesPlayer: false, lastSeen: null, sinceLook: 0, waitLeft: 0, still: 0, lastNode: node,
  };
}

function moveTo(ctx, c, next) {
  if (next === c.node) return false;
  const h = headingTo(ctx, c.node, next);
  if (h !== null) c.facing = h;
  c.node = next;
  return true;
}

// A target it can stand on: a cell that is not walkable (a tree, say) becomes the nearest walkable
// cell next to it.
export function standable(ctx, n) {
  const { world } = ctx;
  if (n !== null && world.walk[n] === 1) return n;
  if (n === null) return null;
  const { x, y } = nodeXYL(world, n);
  let best = null;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const m = (y + dy) * world.W + (x + dx);
    if (x + dx >= 0 && y + dy >= 0 && x + dx < world.W && y + dy < world.H && world.walk[m] === 1) { best = m; break; }
  }
  return best;
}

// Returns false when it cannot get any closer (so the caller can pick something else to do).
function runToward(ctx, c, target, speed) {
  if (target === null || c.node === target) { c.budget = 0; return true; }
  c.budget += speed;
  while (c.budget >= 1 && c.node !== target) {
    c.budget -= 1;
    const next = ctx.pf.nextStep(c.node, target);
    if (next === c.node) { c.budget = 0; return false; }
    moveTo(ctx, c, next);
  }
  if (c.node === target) c.budget = 0;
  return true;
}

// Circles around the spot where it knows you are (the foot of your tree), one cell at a time.
function prowl(ctx, c, center, speed, rng) {
  c.budget += speed;
  if (c.budget < 1) return;
  c.budget -= 1;
  const options = [];
  forEachNeighbour(ctx.world, c.node, (m) => { if (ctx.pf.distance(m, center) <= 2.5) options.push(m); });
  if (options.length) moveTo(ctx, c, rng.pick(options));
  const h = headingTo(ctx, c.node, center);
  if (h !== null) c.facing = h;
}

function pickPatrolTarget(ctx, game, rng) {
  const { pf, openSet, world } = ctx;
  const fromCase = pf.row(game.caseItem.node);
  const fromMe = pf.row(game.creature.node);
  const near = openSet.filter((n) => {
    const i = world.nodeIndex[n];
    return fromCase[i] <= 10 && fromMe[i] >= 4;
  });
  if (near.length && !rng.chance(0.35)) return rng.pick(near);
  const far = openSet.filter((n) => fromMe[world.nodeIndex[n]] >= 8);
  return rng.pick(far.length ? far : openSet);
}

// Where to wait for you: two thirds of the way along your shortest walk to the hospital door.
// That puts it between you and the door (the "between" relation used as a goal).
export function ambushSpot(ctx, from) {
  const door = ctx.exits[0].node;
  const path = ctx.pf.path(from, door);
  if (path.length < 3) return door;
  return path[Math.floor(path.length * 0.66)];
}

// Can the creature see you? Its vision cone and line of sight, up to its sight range (by difficulty).
// It never sees you up in a tree.
export function creatureSees(game) {
  const { world } = game.ctx;
  const c = game.creature;
  const me = game.player;
  if (me.inTree !== null) return false; // up in a tree, out of its sight
  const s = canSee(world, c.node, c.facing, me.node);
  return s.visible && s.dist <= game.speeds.sight;
}

export function creatureAct(ctx, game, rng) {
  const c = game.creature;
  const me = game.player;
  const sp = game.speeds;
  const g = ctx.config.game;

  if (c.frozenLeft > 0) {
    c.frozenLeft--;
    c.mode = 'frozen';
    if (c.frozenLeft === 0) {
      game.log('creature', 'thaw', 'The creature can move again.');
      c.mode = c.lastSeen !== null ? 'investigate' : 'patrol';
      c.target = c.lastSeen;
    }
    return;
  }

  c.seesPlayer = creatureSees(game);
  if (c.seesPlayer) c.lastSeen = me.node;
  c.heardAt = standable(ctx, c.heardAt);
  c.target = standable(ctx, c.target);

  // never stand still for long without a reason: pick a new place to wander to
  c.still = c.node === c.lastNode ? c.still + 1 : 0;
  c.lastNode = c.node;
  if (c.still > 24 && (c.mode === 'patrol' || c.mode === 'investigate' || c.mode === 'chase')) {
    c.mode = 'patrol';
    c.target = pickPatrolTarget(ctx, game, rng);
    c.still = 0;
  }

  const alarm = game.alarmLeft > 0;
  if (c.seesPlayer) {
    if (c.mode !== 'chase') game.log('creature', 'spot', 'The creature sees you!');
    c.mode = 'chase';
    c.target = me.node;
    c.heardAt = null;
  } else if (alarm) {
    c.mode = 'track';
    c.target = me.node;
    c.heardAt = null;
  } else if (c.heardAt !== null) {
    if (c.mode !== 'chase') {
      if (c.mode !== 'investigate') game.log('creature', 'hear', 'The creature heard something and turns toward it.');
      c.mode = 'investigate';
      c.target = c.heardAt;
    }
    const h = headingTo(ctx, c.node, c.heardAt);
    if (h !== null) c.facing = h;
    c.heardAt = null;
  } else if (c.mode === 'track') {
    // the alarm just stopped: if you carry the case, cut you off on the way to the hospital
    if (me.carrying) {
      c.mode = 'ambush';
      c.target = ambushSpot(ctx, me.node);
      c.waitLeft = 40;
      game.log('creature', 'ambush', 'The alarm stops. The creature heads to wait between you and the hospital.');
    } else { c.mode = 'search'; c.searchLeft = g.searchTicks; }
  }

  switch (c.mode) {
    case 'chase':
      if (c.node === c.target || !runToward(ctx, c, c.target, sp.chase)) { c.mode = 'search'; c.searchLeft = g.searchTicks; }
      return;
    case 'track':
      // close to you: if you are up a tree, it circles the tree; otherwise it comes straight on
      if (me.inTree !== null && ctx.pf.distance(c.node, c.target) <= 2.5) prowl(ctx, c, c.target, sp.track, rng);
      else if (!runToward(ctx, c, c.target, sp.track)) prowl(ctx, c, c.node, sp.track, rng);
      return;
    case 'investigate':
      if (c.node === c.target || !runToward(ctx, c, c.target, sp.investigate)) {
        if (me.carrying) { c.mode = 'ambush'; c.target = ambushSpot(ctx, me.node); c.waitLeft = 40; return; }
        c.mode = 'search';
        c.searchLeft = g.searchTicks;
      }
      return;
    case 'ambush':
      // waits there for a while, looking around, then goes back to wandering
      if (c.node === c.target || !runToward(ctx, c, c.target, sp.investigate)) {
        c.facing += TURN;
        c.waitLeft--;
        if (c.waitLeft <= 0) { c.mode = 'patrol'; c.target = null; }
      }
      return;
    case 'search':
      c.facing += TURN;
      c.searchLeft--;
      if (c.searchLeft <= 0) { c.mode = 'patrol'; c.target = null; }
      return;
    case 'patrol':
    default:
      c.mode = 'patrol';
      if (c.target === null || c.node === c.target) c.target = pickPatrolTarget(ctx, game, rng);
      c.sinceLook++;
      if (c.sinceLook >= 6) { c.sinceLook = 0; c.facing += (rng.chance(0.5) ? 2 : -2) * TURN; return; }
      if (!runToward(ctx, c, c.target, sp.patrol)) c.target = pickPatrolTarget(ctx, game, rng);
  }
}
