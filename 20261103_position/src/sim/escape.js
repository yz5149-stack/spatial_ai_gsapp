// One run of the escape: find the vaccine case in the snowy forest and carry it to the hospital
// door on the east side while a creature made of roots hunts you. You win at the door with the case;
// you lose when the creature reaches you (same or neighbouring cell) or when the night runs out.
//
// Input per tick: { dx, dy } in -1..1 (a direction on the map), shoot and climb (edge-triggered).
// Shoot fires if the creature is in range and in the clear. Climb gets you into the tree next to
// you, or down from the one you are in.

import { makeRng } from './rng.js';
import { segmentClear, eyePoint } from './los.js';
import { G, nodeXYL, nodeId, isWalkable } from './world.js';
import { newCreature, creatureAct, creatureSees, headingTo, CREATURE_MODES } from './creature.js';
import { computeRelations, newTracks, placeCrows, stepCrows } from './relations.js';

const FACINGS = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => (k * Math.PI) / 4);
const DIRS8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
export { CREATURE_MODES };

export function newRun(ctx, { difficulty = 'normal', round = 1, seed = ctx.seed * 7919 + round } = {}) {
  const rng = makeRng(seed);
  const { world, pf, config } = ctx;
  const g = config.game;
  const door = ctx.exits[0].node;

  // The case: a fairly hidden cell, well away from the hospital door.
  const exposures = world.nodes.map((n) => ctx.exposure(n)).sort((a, b) => a - b);
  const median = exposures[Math.floor(exposures.length / 2)];
  const fromDoor = pf.row(door);
  // On a designed map the case lies in a clearing off the trail.
  // the clearing farthest (walking) from the hospital, or the second farthest now and then
  let caseOptions = (world.clearings ?? []).map((c) => c.y * world.W + c.x)
    .filter((n) => world.walk[n] === 1 && fromDoor[world.nodeIndex[n]] >= g.caseFromDoor * 0.8)
    .sort((a, b) => fromDoor[world.nodeIndex[b]] - fromDoor[world.nodeIndex[a]]);
  if (caseOptions.length > 1) caseOptions = rng.chance(0.7) ? caseOptions.slice(0, 1) : caseOptions.slice(1, 2);
  if (!caseOptions.length) caseOptions = world.nodes.filter((n) => n !== door && ctx.exposure(n) <= median && fromDoor[world.nodeIndex[n]] >= g.caseFromDoor);
  if (!caseOptions.length) caseOptions = world.nodes.filter((n) => fromDoor[world.nodeIndex[n]] >= g.caseFromDoor * 0.7);
  const caseNode = rng.pick(caseOptions);
  const fromCase = pf.row(caseNode);

  // The creature starts near the case; you start on the west side, far from both, out of sight.
  const [cMin, cMax] = config.policeStartFromDiamond;
  const creatureOptions = world.nodes.filter((n) => { const d = fromCase[world.nodeIndex[n]]; return d >= cMin && d <= cMax; });
  let creature = null;
  let start = null;
  // you start next to the car, where the trail begins
  if (world.car) {
    const spots = [0, 1, -1, 2].map((dy) => (world.car.y + dy) * world.W + world.car.x + world.car.w).filter((n) => world.walk[n] === 1);
    if (spots.length) {
      start = spots[0];
      const row0 = pf.row(start);
      let best = null;
      for (let attempt = 0; attempt < 60; attempt++) {
        const n = rng.pick(creatureOptions);
        const ok = row0[world.nodeIndex[n]] >= 12 && ctx.metrics.euclidean(n, start) > config.visionRange;
        if (ok) { best = n; break; }
        if (best === null || row0[world.nodeIndex[n]] > row0[world.nodeIndex[best]]) best = n;
      }
      creature = newCreature(best, rng.pick(FACINGS));
    }
  }
  for (let attempt = 0; attempt < 200 && start === null; attempt++) {
    creature = newCreature(rng.pick(creatureOptions), rng.pick(FACINGS));
    const row = pf.row(creature.node);
    const options = world.nodes.filter((n) => {
      const i = world.nodeIndex[n];
      return nodeXYL(world, n).x <= world.W * 0.3 && row[i] >= 14 && fromCase[i] >= 12
        && ctx.metrics.euclidean(n, creature.node) > config.visionRange;
    });
    if (options.length) start = rng.pick(options);
  }
  if (start === null) start = world.nodes.reduce((a, b) => (fromCase[world.nodeIndex[b]] > fromCase[world.nodeIndex[a]] ? b : a));

  const speeds = { ...g.difficulty[difficulty] };
  const game = {
    ctx, rng, round, difficulty, speeds, step: 0, over: false, result: null,
    player: {
      node: start, facing: 0, carrying: false, ammo: speeds.ammo, budget: 0, busy: 0, cooldown: 0,
      inTree: null, treeLeft: 0, treeCooldown: 0, climbing: null, climbTree: null, lastMoveStep: -1, shots: 0, moving: false,
      seesCreature: false, hearsCreature: false, knownCreature: null, knownStep: -1e9,
    },
    creature,
    caseItem: { node: caseNode, carried: false },
    door,
    alarmLeft: 0,
    events: [],
    sounds: [],
    shots: [],
    tracks: newTracks(),
    relations: { position: [], movement: [] },
    log(who, kind, text) { game.events.push({ step: game.step, round: game.round, who, kind, text }); },
  };
  game.crows = placeCrows(ctx, rng, caseNode);
  game.player.facing = headingTo(ctx, start, caseNode) ?? 0;
  measure(game);
  senseCreature(game, creature.node);
  game.sounds = [];
  game.relations = computeRelations(game, null);
  game.log('player', 'start', 'Find the vaccine case (the cyan light), then reach the hospital door on the east side.');
  return game;
}

function measure(game) {
  const { metrics } = game.ctx;
  const a = game.player.node;
  const b = game.creature.node;
  game.distances = { euclidean: metrics.euclidean(a, b), acoustic: metrics.acoustic(a, b), path: metrics.path(a, b) };
}

// The cell one step in direction (dx, dy), sliding along obstacles when a diagonal is blocked.
export function stepCell(world, n, dx, dy) {
  const { x, y, level } = nodeXYL(world, n);
  const ok = (cx, cy) => isWalkable(world, level, cx, cy);
  if (dx && dy) {
    if (ok(x + dx, y + dy) && ok(x + dx, y) && ok(x, y + dy)) return nodeId(world, level, x + dx, y + dy);
    if (ok(x + dx, y)) return nodeId(world, level, x + dx, y);
    if (ok(x, y + dy)) return nodeId(world, level, x, y + dy);
    return null;
  }
  if (ok(x + dx, y + dy)) return nodeId(world, level, x + dx, y + dy);
  return null;
}

// The tree (a ground index) next to n that is closest to where you face, or null.
export function treeNextTo(world, n, facing = 0) {
  const { x, y } = nodeXYL(world, n);
  let best = null;
  let bestScore = Infinity;
  for (const [dx, dy] of DIRS8) {
    const tx = x + dx;
    const ty = y + dy;
    if (tx < 0 || ty < 0 || tx >= world.W || ty >= world.H) continue;
    if (world.ground[ty * world.W + tx] !== G.TREE) continue;
    const a = Math.atan2(dy, dx) - facing;
    const score = Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) + (dx && dy ? 0.3 : 0);
    if (score < bestScore) { bestScore = score; best = ty * world.W + tx; }
  }
  return best;
}

function makeNoise(game) {
  const { metrics, config } = game.ctx;
  const c = game.creature;
  const heard = metrics.acoustic(game.player.node, c.node) + config.sneakQuietness <= config.hearingRange;
  game.sounds.push({ who: 'player', node: game.player.node, heard, creatureHeard: heard });
  if (heard && c.frozenLeft === 0) c.heardAt = game.player.node;
}

// Can you shoot it right now? You see it, it is within range in the clear, and not frozen already.
export function canShoot(game) {
  const { world, config, metrics } = game.ctx;
  const me = game.player;
  const c = game.creature;
  if (me.inTree !== null || me.ammo <= 0 || me.cooldown > 0 || c.frozenLeft > 0 || !me.seesCreature) return false;
  return metrics.euclidean(me.node, c.node) <= config.game.shotRange
    && segmentClear(world, eyePoint(world, me.node), eyePoint(world, c.node));
}

function shoot(game) {
  const { metrics } = game.ctx;
  const g = game.ctx.config.game;
  const me = game.player;
  const c = game.creature;
  me.ammo--;
  me.shots++;
  me.cooldown = g.shotCooldown;
  const h = headingTo(game.ctx, me.node, c.node);
  if (h !== null) me.facing = h;
  c.frozenLeft = g.freezeTicks;
  c.mode = 'frozen';
  c.budget = 0;
  c.lastSeen = me.node;
  game.shots.push({ from: me.node, to: c.node, hit: true });
  game.sounds.push({ who: 'shot', node: me.node, heard: true, creatureHeard: metrics.acoustic(me.node, c.node) <= g.shotHeard });
  game.log('player', 'shot', `Hit! It is frozen for 3 seconds. Run! (${me.ammo} bullet${me.ammo === 1 ? '' : 's'} left)`);
}

// What the two keys would do now. The HUD shows them.
//   shoot: true when a shot would hit
//   climb: 'up' (a tree is next to you), 'down' (you are in a tree) or null
export function actionsFor(game) {
  const me = game.player;
  if (me.busy > 0) return { shoot: false, climb: null };
  return {
    shoot: canShoot(game),
    climb: me.inTree !== null ? 'down' : (me.treeCooldown === 0 && treeNextTo(game.ctx.world, me.node, me.facing) !== null ? 'up' : null),
  };
}

function tryShoot(game) {
  const me = game.player;
  if (canShoot(game)) { shoot(game); return; }
  if (me.inTree !== null || me.busy > 0) return;
  if (me.ammo <= 0) game.log('player', 'noshot', 'No bullets left. Hide or run!');
  else if (!me.seesCreature) game.log('player', 'noshot', 'Nothing to shoot at.');
  else if (game.creature.frozenLeft === 0) game.log('player', 'noshot', 'Too far to shoot. Let it come closer, or get away.');
}

function tryClimb(game) {
  const me = game.player;
  const g = game.ctx.config.game;
  const what = actionsFor(game).climb;
  if (what === 'down') { me.busy = g.climbTicks; me.climbing = 'down'; }
  else if (what === 'up') {
    me.busy = g.climbTicks;
    me.climbing = 'up';
    me.climbTree = treeNextTo(game.ctx.world, me.node, me.facing);
  } else if (me.busy === 0) game.log('player', 'notree', 'No tree right next to you.');
}

function caught(game) {
  const c = game.creature;
  const me = game.player;
  if (c.frozenLeft > 0 || me.inTree !== null || me.climbing === 'up') return false;
  return game.ctx.pf.distance(me.node, c.node) <= game.ctx.config.catchDistance;
}

// What you know about the creature: you see it within the fog with a clear line (you look around
// freely; from a tree you see over the bushes), and you hear it move within the hearing range.
function senseCreature(game, before) {
  const { world, config, metrics } = game.ctx;
  const me = game.player;
  const c = game.creature;
  const e = metrics.euclidean(me.node, c.node);
  const from = eyePoint(world, me.node);
  if (me.inTree !== null) from[2] += 1.2;
  me.seesCreature = e <= config.visionRange && segmentClear(world, from, eyePoint(world, c.node));
  me.hearsCreature = c.node !== before && metrics.acoustic(c.node, me.node) <= config.hearingRange;
  if (me.hearsCreature) game.sounds.push({ who: 'creature', node: c.node, heard: true });
  if (me.seesCreature || me.hearsCreature) { me.knownCreature = c.node; me.knownStep = game.step; }
}

function end(game, result, text) {
  game.over = true;
  game.result = result;
  game.log(result === 'win' ? 'player' : 'creature', result, text);
}

export function stepRun(game, input = {}) {
  if (game.over) return game;
  const { world, config } = game.ctx;
  const g = config.game;
  const me = game.player;
  game.step++;
  game.sounds = [];
  game.shots = [];
  const prev = { player: me.node, creature: game.creature.node, inTree: me.inTree };
  if (me.cooldown > 0) me.cooldown--;
  if (me.treeCooldown > 0) me.treeCooldown--;
  if (game.alarmLeft > 0) {
    game.alarmLeft--;
    if (game.alarmLeft === 0) game.log('player', 'alarm', 'The case stops beeping. It no longer knows exactly where you are.');
  }

  // ---- you
  const moving = !!(input.dx || input.dy);
  me.moving = false;
  if (me.busy > 0) {
    me.busy--;
    if (me.busy === 0) {
      if (me.climbing === 'up') {
        me.inTree = me.climbTree;
        me.treeLeft = g.treeTicks;
        game.log('player', 'climb', 'You climb into the tree. It cannot see you up here, but you cannot hold on for long.');
      } else if (me.climbing === 'down') {
        me.inTree = null;
        me.treeCooldown = g.treeCooldown;
      }
      me.climbing = null;
    }
  } else if (input.shoot) {
    tryShoot(game);
  } else if (input.climb) {
    tryClimb(game);
  } else if (me.inTree !== null) {
    me.treeLeft--;
    if (moving) { me.busy = g.climbTicks; me.climbing = 'down'; }
    else if (me.treeLeft <= 0) {
      me.busy = g.climbTicks;
      me.climbing = 'down';
      game.log('player', 'slip', 'Your hands are numb with cold. You have to climb down.');
    }
  } else if (moving) {
    me.facing = Math.atan2(input.dy, input.dx);
    me.moving = true;
    me.budget += g.walkSpeed;
    if (me.budget >= 1) {
      me.budget -= 1;
      const next = stepCell(world, me.node, Math.sign(input.dx), Math.sign(input.dy));
      if (next !== null) {
        const h = headingTo(game.ctx, me.node, next);
        if (h !== null) me.facing = h;
        me.node = next;
        me.lastMoveStep = game.step;
        makeNoise(game);
      } else me.budget = 0;
    }
  } else {
    me.budget = Math.min(me.budget, 0.6); // a tap still moves soon
  }

  if (!me.carrying && me.node === game.caseItem.node && me.inTree === null) {
    me.carrying = true;
    game.caseItem.carried = true;
    game.alarmLeft = g.caseAlarmTicks;
    game.log('player', 'case', 'You have the vaccine! But it beeps: it knows where you are. Run east to the hospital!');
  }
  if (me.carrying && me.node === game.door) end(game, 'win', 'You reached the hospital with the vaccine. You saved the world.');
  else if (caught(game)) end(game, 'lose', 'It reached you.');

  // ---- crows, then the creature
  if (!game.over) {
    stepCrows(game);
    creatureAct(game.ctx, game, game.rng);
    if (caught(game)) end(game, 'lose', 'It reached you.');
  }
  if (!game.over && game.step >= g.maxTicks) end(game, 'lose', 'The night is over. At dawn it found you.');

  game.creature.seesPlayer = game.creature.frozenLeft === 0 && creatureSees(game);
  senseCreature(game, prev.creature);
  measure(game);
  game.relations = computeRelations(game, prev);
  return game;
}

export const statusOf = (game) => ({
  mode: CREATURE_MODES[game.creature.mode] ?? game.creature.mode,
  sees: game.creature.seesPlayer,
  hears: game.sounds.some((s) => s.who === 'player' && s.creatureHeard),
  inTree: game.player.inTree !== null,
  actions: actionsFor(game),
});

export function directionTo(world, from, to) {
  const a = nodeXYL(world, from);
  const b = nodeXYL(world, to);
  return { dx: Math.sign(b.x - a.x), dy: Math.sign(b.y - a.y) };
}
