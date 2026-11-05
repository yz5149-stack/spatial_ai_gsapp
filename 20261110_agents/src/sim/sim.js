// The simulation: two kinds of spatial agents in one forest.
//
// Phase 1 · explore   The creature wakes in its lair knowing nothing. It maps the forest with its
//                      red vision cone, like a robot vacuum: always heading for the nearest edge of
//                      what it has seen (a frontier), leaving landmarks at dead ends, clearings and
//                      the hospital door. The phase ends when no frontier is left.
// Phase 2 · hunt      A survivor appears somewhere at random. It knows nothing either: it explores
//                      with its flashlight, heading east where it was told the hospital is. The
//                      creature cannot see far, so it hunts by sound: footsteps send it to where
//                      they came from, along its own map; then it searches the dead ends around,
//                      because that is where a survivor gets trapped. Rounds repeat; the creature
//                      keeps everything it has learned.

import { makeRng } from './rng.js';
import { segmentClear, eyePoint, acousticDistance } from './los.js';
import { generateMaze } from './maze.js';
import {
  makeKnowledge, look, plan, firstStep, pathTo, frontiers, recognise, addLandmark, nearLandmark,
} from './knowledge.js';

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const TURN = Math.PI / 4;

export function newSim(config, seed = config.seed) {
  const world = generateMaze(config, seed);
  const rng = makeRng(seed * 31 + 7);
  const creature = {
    node: world.lair, facing: 0, budget: 0, mode: 'explore', target: null, k: makeKnowledge(world, 'creature'),
    distance: 0, heardAt: null, lastSeen: null, searchLeft: 0, sweep: [], seesSurvivor: false, moved: false,
  };
  const sim = {
    config, world, rng, seed, step: 0, phase: 'explore', round: 0,
    creature, survivor: null, events: [], sounds: [],
    explore: { done: false, ticks: 0, distance: 0 },
    rounds: [],                         // results of every hunt round
    heardHeat: new Uint16Array(world.W * world.H),   // where survivors were heard, over all rounds
    catches: [], escapes: [], dawns: [],
    pauseLeft: 0,
    log(who, kind, text) { sim.events.push({ step: sim.step, round: sim.round, who, kind, text }); },
  };
  creature.k.origin = null;
  addLandmark(world, creature.k, { kind: 'start', cell: world.lair, step: 0, note: 'Its lair' });
  creatureLook(sim);
  sim.log('creature', 'wake', 'The creature wakes in its lair. It knows nothing about the forest yet.');
  return sim;
}

// ---------------------------------------------------------------- helpers

const xy = (world, i) => [i % world.W, Math.floor(i / world.W)];
const cheb = (world, a, b) => { const [ax, ay] = xy(world, a); const [bx, by] = xy(world, b); return Math.max(Math.abs(ax - bx), Math.abs(ay - by)); };
const euclid = (world, a, b) => { const [ax, ay] = xy(world, a); const [bx, by] = xy(world, b); return Math.hypot(ax - bx, ay - by); };
const headingTo = (world, a, b) => { const [ax, ay] = xy(world, a); const [bx, by] = xy(world, b); return ax === bx && ay === by ? null : Math.atan2(by - ay, bx - ax); };

// Can an agent at `a` facing `facing` see cell `b`? Within range, inside the cone, a clear line.
function sees(world, a, facing, b, range, coneDeg) {
  if (euclid(world, a, b) > range) return false;
  const h = headingTo(world, a, b);
  if (h !== null && Math.abs(wrap(h - facing)) > (coneDeg * Math.PI) / 360) return false;
  return segmentClear(world, eyePoint(world, a), eyePoint(world, b));
}

const acoustic = (world, a, b) => acousticDistance(world, eyePoint(world, a), eyePoint(world, b)).distance;

function moveAgent(sim, agent, next) {
  if (next === agent.node) return false;
  const h = headingTo(sim.world, agent.node, next);
  if (h !== null) agent.facing = h;
  agent.node = next;
  agent.distance++;
  agent.k.trail.push(next);
  agent.k.visits[next]++;
  return true;
}

// Walk toward `target` on the agent's own map at `speed` cells per tick. False if it cannot.
function walk(sim, agent, target, speed, routeOpts) {
  agent.budget += speed;
  let moved = false;
  while (agent.budget >= 1) {
    agent.budget -= 1;
    if (agent.node === target) { agent.budget = 0; break; }
    const route = plan(sim.world, agent.k, agent.node, routeOpts);
    const next = firstStep(route, agent.node, target);
    if (next === agent.node) { agent.budget = 0; return moved ? true : false; }
    moved = moveAgent(sim, agent, next) || moved;
  }
  return true;
}

function creatureLook(sim) {
  const c = sim.creature;
  const cc = sim.config.creature;
  const fresh = look(sim.world, c.k, c.node, c.facing, cc.sight, cc.coneDeg, sim.step);
  for (const lm of recognise(sim.world, c.k, fresh, sim.step)) {
    sim.log('creature', 'landmark', `Landmark ${lm.id}: ${lm.note.toLowerCase()}, ${lm.text}.`);
  }
  return fresh;
}

function survivorLook(sim) {
  const s = sim.survivor;
  const sc = sim.config.survivor;
  const fresh = look(sim.world, s.k, s.node, s.facing, sc.sight, sc.coneDeg, sim.step);
  for (const lm of recognise(sim.world, s.k, fresh, sim.step)) {
    if (lm.kind === 'exit') sim.log('survivor', 'landmark', `The survivor sees the hospital door (${lm.id}, ${lm.text}).`);
    else if (lm.kind === 'deadend') sim.log('survivor', 'landmark', `The survivor marks a dead end (${lm.id}, ${lm.text}): a trap, never run in here.`);
  }
  return fresh;
}

export const coverage = (sim) => sim.creature.k.knownCount / (sim.world.W * sim.world.H);

// ---------------------------------------------------------------- phase 1: explore

// Pick the next frontier: the nearest one on its own map, preferring what is ahead of it
// (so it sweeps a corridor to the end, like a vacuum, instead of zigzagging).
function pickFrontier(sim) {
  const { world } = sim;
  const c = sim.creature;
  const route = plan(world, c.k, c.node);
  let best = null;
  let bestScore = Infinity;
  for (const f of frontiers(world, c.k)) {
    const d = route.dist[f];
    if (!Number.isFinite(d)) continue;
    const h = headingTo(world, c.node, f);
    const turn = h === null ? 0 : Math.abs(wrap(h - c.facing));
    const score = d + 1.6 * turn;
    if (score < bestScore) { bestScore = score; best = f; }
  }
  return best;
}

function exploreTick(sim) {
  const c = sim.creature;
  const { world, config } = sim;
  c.moved = false;
  const isFrontier = (i) => i !== null && c.k.known[i] === 0 && frontiers(world, { known: c.k.known }).includes(i);
  if (c.target === null || c.node === c.target || !isFrontier(c.target)) c.target = pickFrontier(sim);
  if (c.target === null) {
    sim.explore.done = true;
    sim.explore.ticks = sim.step;
    sim.explore.distance = c.distance;
    const lms = c.k.landmarks;
    sim.log('creature', 'mapped', `The forest is mapped: ${Math.round(coverage(sim) * 100)}% seen in ${c.distance} steps, `
      + `${lms.filter((l) => l.kind === 'deadend').length} dead ends, ${lms.filter((l) => l.kind === 'clearing').length} clearings, the hospital door.`);
    startRound(sim);
    return;
  }
  c.budget += config.creature.exploreSpeed;
  while (c.budget >= 1) {
    c.budget -= 1;
    if (c.node === c.target) break;
    const route = plan(world, c.k, c.node);
    const next = firstStep(route, c.node, c.target);
    if (next === c.node) { c.target = null; break; }
    c.moved = moveAgent(sim, c, next) || c.moved;
    creatureLook(sim);
  }
  creatureLook(sim);
}

// ---------------------------------------------------------------- phase 2: hunt

// Starts a hunt round. `at`: where the survivor wakes up (a cell you chose), or a random place.
function startRound(sim, at = null) {
  const { world, config, rng } = sim;
  const c = sim.creature;
  sim.phase = 'hunt';
  sim.round++;
  sim.roundStart = sim.step;
  let start = at;
  if (start === null) {
    // a random open cell, far from the creature (walking) and out of its sight
    const truth = { known: Int8Array.from(world.walk.subarray(0, world.W * world.H), (v) => (v ? 0 : 1)) };
    const route = plan(world, truth, c.node);
    const options = world.nodes.filter((n) => n < world.W * world.H && route.dist[n] >= config.survivor.minSpawnPath
      && !world.doorCells.includes(n) && euclid(world, n, world.door) > 8
      && !sees(world, c.node, c.facing, n, config.creature.sight, config.creature.coneDeg));
    start = rng.pick(options.length ? options : world.nodes);
  }
  const k = makeKnowledge(world, 'survivor');
  k.origin = null;
  addLandmark(world, k, { kind: 'start', cell: start, step: sim.step, note: 'Where it woke up' });
  sim.survivor = {
    node: start, facing: rng.next() * Math.PI * 2, budget: 0, mode: 'explore', target: null, k,
    distance: 0, threatAt: null, threatStep: -1e9, hideLeft: 0, running: false, moved: false, sees: false, hears: false,
    start,
  };
  survivorLook(sim);
  c.mode = 'patrol';
  c.target = null;
  c.heardAt = null;
  c.sweep = [];
  sim.log('survivor', 'spawn', at === null
    ? `Round ${sim.round}: a survivor wakes up somewhere in the forest. It knows nothing either.`
    : `Round ${sim.round}: you put a survivor here. It wakes up with a cry.`);
  if (at !== null) {
    // the cry carries through the whole forest: the creature plans its way there on its own map
    sim.sounds.push({ who: 'cry', node: start, heard: true });
    c.heardAt = start;
    sim.heardHeat[start]++;
    if (!nearLandmark(world, c.k, 'heard', start, 3)) addLandmark(world, c.k, { kind: 'heard', cell: start, step: sim.step, note: 'A cry was heard here' });
  }
}

// Puts the survivor on `cell` (an open cell, not the hospital door), starting a new round. A round in
// progress is dropped without counting. Returns false if the cell is not allowed.
export function placeSurvivor(sim, cell) {
  const { world } = sim;
  if (sim.phase === 'explore') return false;
  if (cell < 0 || cell >= world.W * world.H || !world.walk[cell] || world.doorCells.includes(cell)) return false;
  if (cheb(world, cell, sim.creature.node) <= 2) return false;
  if (sim.phase === 'hunt') sim.log('survivor', 'replace', `Round ${sim.round} was dropped: you moved the survivor.`);
  startRound(sim, cell);
  sim.placed = true;
  return true;
}

// --- the survivor

function survivorPerceive(sim, creatureMoved) {
  const { world, config } = sim;
  const s = sim.survivor;
  const c = sim.creature;
  const sc = config.survivor;
  const d = euclid(world, s.node, c.node);
  s.sees = sees(world, s.node, s.facing, c.node, sc.sight, sc.coneDeg) || (d <= 1.5);
  s.hears = creatureMoved && acoustic(world, c.node, s.node) <= sc.hearing;
  if (s.sees || (s.hears && d <= 5)) {
    if (s.mode !== 'flee') sim.log('survivor', 'flee', s.sees ? 'The survivor sees the creature and runs!' : 'The survivor hears it right behind and runs!');
    s.mode = 'flee';
    s.threatAt = c.node;
    s.threatStep = sim.step;
    s.target = null;
    if (s.sees && !nearLandmark(world, s.k, 'seen', c.node, 4)) addLandmark(world, s.k, { kind: 'seen', cell: c.node, step: sim.step, note: 'The creature was here' });
  } else if (s.hears) {
    s.threatAt = c.node;
    s.threatStep = sim.step;
  }
}

function survivorAct(sim) {
  const { world, config } = sim;
  const s = sim.survivor;
  const sc = config.survivor;
  const exit = s.k.landmarks.find((l) => l.kind === 'exit');
  const traps = s.k.landmarks.filter((l) => l.kind === 'deadend');
  const threat = s.threatAt;
  const fresh = sim.step - s.threatStep <= 12;
  // cells near a known threat or inside a dead end it marked cost more to walk through
  const avoid = (m) => {
    let extra = 0;
    if (fresh && threat !== null) { const d = euclid(world, m, threat); if (d < 4) extra += (4 - d) * 6; }
    for (const t of traps) if (Math.max(Math.abs(t.x - (m % world.W)), Math.abs(t.y - Math.floor(m / world.W))) <= 1) extra += 4;
    return extra;
  };
  s.running = false;
  s.moved = false;

  if (s.mode === 'flee') {
    if (!fresh) {
      s.mode = 'hide';
      s.hideLeft = sc.hideTicks;
      sim.log('survivor', 'hide', 'The survivor stops and holds its breath.');
      return;
    }
    s.running = true;
    const route = plan(world, s.k, s.node, { avoid });
    // run for the hospital if it knows where it is and the way is not past the creature
    if (exit && Number.isFinite(route.dist[exit.cell])) {
      const path = pathTo(route, exit.cell);
      if (!path.some((n) => euclid(world, n, threat) < 3)) { s.target = exit.cell; }
    }
    if (s.target === null || s.target === s.node) {
      let best = null;
      let bestScore = -Infinity;
      for (let i = 0; i < world.W * world.H; i++) {
        const dist = route.dist[i];
        if (!Number.isFinite(dist) || dist > 14 || dist < 2) continue;
        let score = euclid(world, i, threat) - 0.45 * dist;
        if (traps.some((t) => Math.max(Math.abs(t.x - (i % world.W)), Math.abs(t.y - Math.floor(i / world.W))) <= 2)) score -= 8;
        if (score > bestScore) { bestScore = score; best = i; }
      }
      s.target = best;
    }
    if (s.target !== null) s.moved = walk(sim, s, s.target, sc.run, { avoid }) && s.distance > 0;
  } else if (s.mode === 'hide') {
    s.hideLeft--;
    s.facing += (sim.step % 6 === 0 ? 1 : 0) * TURN * (sim.rng.chance(0.5) ? 1 : -1); // looks around
    if (s.hideLeft <= 0) { s.mode = 'explore'; s.target = null; }
  } else {
    // explore: the hospital if it knows where it is, otherwise the frontier that looks best
    if (exit) s.target = exit.cell;
    else if (s.target === null || s.node === s.target || s.k.known[s.target] !== 0 || !isFrontierOf(world, s.k, s.target)) {
      const route = plan(world, s.k, s.node, { avoid });
      let best = null;
      let bestScore = Infinity;
      for (const f of frontiers(world, s.k)) {
        const d = route.dist[f];
        if (!Number.isFinite(d)) continue;
        const h = headingTo(world, s.node, f);
        const turn = h === null ? 0 : Math.abs(wrap(h - s.facing));
        const score = d + sc.eastBias * (world.W - (f % world.W)) + 0.8 * turn;
        if (score < bestScore) { bestScore = score; best = f; }
      }
      s.target = best;
    }
    if (s.target !== null) {
      const before = s.node;
      walk(sim, s, s.target, sc.walk, { avoid });
      s.moved = s.node !== before;
    } else s.facing += TURN;
  }
  survivorLook(sim);
}

function isFrontierOf(world, k, i) {
  const x = i % world.W; const y = Math.floor(i / world.W);
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx; const ny = y + dy;
    if (nx >= 0 && ny >= 0 && nx < world.W && ny < world.H && k.known[ny * world.W + nx] === -1) return true;
  }
  return false;
}

// --- the creature

function creatureHears(sim) {
  const { world, config } = sim;
  const s = sim.survivor;
  const c = sim.creature;
  if (!s.moved) return false;
  const quiet = s.running ? 0 : config.survivor.quiet;
  const heard = acoustic(world, s.node, c.node) + quiet <= config.creature.hearing;
  sim.sounds.push({ who: 'survivor', node: s.node, heard, running: s.running });
  if (!heard) return false;
  sim.heardHeat[s.node]++;
  c.heardAt = s.node;
  if (!nearLandmark(world, c.k, 'heard', s.node, 3)) addLandmark(world, c.k, { kind: 'heard', cell: s.node, step: sim.step, note: 'Footsteps were heard here' });
  return true;
}

function creatureAct(sim) {
  const { world, config } = sim;
  const c = sim.creature;
  const s = sim.survivor;
  const cc = config.creature;
  const before = c.node;

  c.seesSurvivor = sees(world, c.node, c.facing, s.node, cc.sight, cc.coneDeg);
  if (c.seesSurvivor) {
    if (c.mode !== 'chase') sim.log('creature', 'spot', 'The creature sees the survivor!');
    c.mode = 'chase';
    c.target = s.node;
    c.lastSeen = s.node;
    c.heardAt = null;
  } else if (c.heardAt !== null && c.mode !== 'chase') {
    if (c.mode !== 'investigate') {
      const route = plan(world, c.k, c.node);
      const what = sim.sounds.some((x) => x.who === 'cry') ? 'a cry' : 'footsteps';
      sim.log('creature', 'hear', `It hears ${what} and plans a route there on its own map: ${Math.round(route.dist[c.heardAt])} steps.`);
    }
    c.mode = 'investigate';
    c.target = c.heardAt;
    c.heardAt = null;
    const h = headingTo(world, c.node, c.target);
    if (h !== null) c.facing = h;
  }

  switch (c.mode) {
    case 'chase':
      if (c.node === c.target || !walk(sim, c, c.target, cc.chase)) startSearch(sim, c.target);
      break;
    case 'investigate':
      if (c.node === c.target || !walk(sim, c, c.target, cc.investigate)) startSearch(sim, c.target);
      break;
    case 'search':
      c.facing += TURN;
      c.searchLeft--;
      if (c.searchLeft <= 0) {
        // sweep the dead ends it knows around here: that is where a survivor gets trapped
        c.mode = c.sweep.length ? 'sweep' : 'patrol';
        c.target = c.sweep.shift() ?? null;
        if (c.mode === 'sweep') sim.log('creature', 'sweep', 'It checks the dead ends it remembers nearby.');
      }
      break;
    case 'sweep':
      if (c.target === null || c.node === c.target || cheb(world, c.node, c.target) <= 1 || !walk(sim, c, c.target, cc.investigate)) {
        c.facing = headingTo(world, c.node, c.target ?? c.node) ?? c.facing;
        c.target = c.sweep.shift() ?? null;
        if (c.target === null) c.mode = 'patrol';
      }
      break;
    case 'patrol':
    default: {
      c.mode = 'patrol';
      if (c.target === null || c.node === c.target) {
        // between sounds it walks its landmarks, and keeps coming back to the hospital door
        const lms = c.k.landmarks.filter((l) => l.kind === 'clearing' || l.kind === 'deadend' || l.kind === 'exit');
        const exit = lms.find((l) => l.kind === 'exit');
        const pick = exit && sim.rng.chance(0.3) ? exit : sim.rng.pick(lms);
        c.target = pick ? nearestOpen(world, c.k, pick.cell) : null;
      }
      if (c.target !== null && !walk(sim, c, c.target, cc.patrol)) c.target = null;
    }
  }
  c.moved = c.node !== before;
  creatureLook(sim);
}

function startSearch(sim, at) {
  const { world } = sim;
  const c = sim.creature;
  c.mode = 'search';
  c.searchLeft = sim.config.creature.searchTicks;
  const route = plan(world, c.k, c.node);
  c.sweep = c.k.landmarks
    .filter((l) => l.kind === 'deadend' && Number.isFinite(route.dist[l.cell]) && euclid(world, l.cell, at ?? c.node) <= 10)
    .sort((a, b) => route.dist[a.cell] - route.dist[b.cell])
    .slice(0, 3)
    .map((l) => l.cell);
}

function nearestOpen(world, k, cell) {
  if (k.known[cell] === 0) return cell;
  const x = cell % world.W; const y = Math.floor(cell / world.W);
  for (let r = 1; r < 4; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const i = (y + dy) * world.W + (x + dx);
    if (k.known[i] === 0) return i;
  }
  return null;
}

function caught(sim) {
  const { world } = sim;
  const a = sim.survivor.node;
  const b = sim.creature.node;
  if (cheb(world, a, b) > 1) return false;
  const [ax, ay] = xy(world, a); const [bx, by] = xy(world, b);
  if (ax !== bx && ay !== by) return world.walk[ay * world.W + bx] === 1 && world.walk[by * world.W + ax] === 1;
  return true;
}

function endRound(sim, result, text) {
  const s = sim.survivor;
  const { world } = sim;
  const r = { round: sim.round, result, ticks: sim.step - sim.roundStart, distance: s.distance, start: s.start, end: s.node, trail: s.k.trail.slice(), seen: s.k.knownCount / (world.W * world.H) };
  sim.rounds.push(r);
  if (result === 'caught') {
    sim.catches.push(s.node);
    addLandmark(world, sim.creature.k, { kind: 'caught', cell: s.node, step: sim.step, note: 'It caught a survivor here' });
  } else if (result === 'escaped') sim.escapes.push(s.node);
  else sim.dawns.push(s.node);
  sim.log(result === 'caught' ? 'creature' : 'survivor', result, text);
  sim.phase = 'pause';
  sim.pauseLeft = sim.config.pauseTicks;
}

function huntTick(sim) {
  const { world, config } = sim;
  const s = sim.survivor;
  survivorAct(sim);
  if (world.doorCells.includes(s.node) || s.node === world.door) {
    endRound(sim, 'escaped', `The survivor reached the hospital in ${((sim.step - sim.roundStart) * config.tickMs / 1000).toFixed(0)} s and ${s.distance} steps.`);
    return;
  }
  if (caught(sim)) { endRound(sim, 'caught', 'The creature caught the survivor.'); return; }
  creatureHears(sim);
  creatureAct(sim);
  if (caught(sim)) { endRound(sim, 'caught', 'The creature caught the survivor.'); return; }
  survivorPerceive(sim, sim.creature.moved);
  if (sim.step - sim.roundStart >= config.roundTicks) endRound(sim, 'dawn', 'Dawn: the survivor made it through the night, hidden.');
}

export function stepSim(sim) {
  sim.step++;
  sim.sounds = [];
  if (sim.phase === 'explore') exploreTick(sim);
  else if (sim.phase === 'hunt') huntTick(sim);
  else if (sim.phase === 'pause') {
    sim.creature.moved = false;
    sim.pauseLeft--;
    if (sim.pauseLeft <= 0) startRound(sim);
  }
  if (sim.drawRoutes !== false) updateRoutes(sim);
  return sim;
}

// The routes each agent is following right now, planned on its own map (for drawing only).
export function updateRoutes(sim) {
  const c = sim.creature;
  c.path = c.target !== null && c.target !== undefined ? pathTo(plan(sim.world, c.k, c.node), c.target) : [];
  if (c.path.length === 1 && c.target !== c.node) c.path = [];
  const s = sim.survivor;
  if (s) s.path = sim.phase === 'hunt' && s.target !== null ? pathTo(plan(sim.world, s.k, s.node), s.target) : [];
}

// Runs until `rounds` more hunt rounds have finished (used for fast-forward and balancing).
export function runRounds(sim, rounds, maxSteps = 200000) {
  const target = sim.rounds.length + rounds;
  sim.drawRoutes = false;
  for (let i = 0; i < maxSteps && sim.rounds.length < target; i++) stepSim(sim);
  sim.drawRoutes = true;
  updateRoutes(sim);
  return sim;
}

export const MODES = {
  explore: 'Mapping the forest',
  patrol: 'Walking its landmarks',
  investigate: 'Heading for a sound',
  search: 'Listening, turning',
  sweep: 'Checking dead ends',
  chase: 'Chasing',
};
export const SURVIVOR_MODES = { explore: 'Exploring east', flee: 'Running', hide: 'Hiding, quiet' };
