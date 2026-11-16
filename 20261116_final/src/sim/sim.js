// The simulation: two kinds of spatial agents in a real place, through a real storm night.
//
// Phase 1 · explore   The creature wakes in its lair knowing nothing. It maps the neighbourhood
//                      with its red vision cone, like a robot vacuum: always heading for the
//                      nearest edge of what it has seen (a frontier). It names what it finds as
//                      landmarks: real street corners, dead ends, warm places, the refuge door.
// Phase 2 · survive   Each round is the night of 23–24 January 2016, hour by hour from the real
//                      record. Several survivors appear; each knows nothing but which way the
//                      refuge lies. They must reach it before they freeze, and without being
//                      caught. They get colder in the wind, tire in deep snow, and their
//                      flashlights run down; they remember warm places and supplies and plan
//                      their way through them. The creature hunts them by sound, on its own
//                      map, and learns over the rounds where survivors tend to be.

import { makeRng } from './rng.js';
import { segmentClear, acousticDistance } from './los.js';
import { buildCity, describeLocation, S } from './city.js';
import { weatherAt, nightIndex, cellClimate, warmField, shelterFor, snowDepthCm } from './environment.js';
import {
  makeKnowledge, look, plan, firstStep, pathTo, frontiers, recognise, addLandmark, nearLandmark,
} from './knowledge.js';

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const TURN = Math.PI / 4;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// place: the data/<id>.json object, merged with its entry in src/data/places.js
// design: an environment design (src/sim/design.js), or {} for none
export function newSim(place, config, design = {}, seed = config.seed, opts = {}) {
  const world = buildCity(place, config, design);
  world.weather = place.weather;
  world.nightIndex = nightIndex(place.weather, config.night.start);
  applyDesign(world, design, config);
  const rng = makeRng(seed * 31 + 7);
  const creature = {
    kind: 'creature', node: world.lair, facing: 0, budget: 0, mode: 'explore', target: null, k: makeKnowledge(world, 'creature'),
    distance: 0, heardAt: null, lastSeen: null, searchLeft: 0, sweep: [], seesSurvivor: false, moved: false, quarry: null,
  };
  const sim = {
    config, world, design, rng, seed, step: 0, phase: 'explore', round: 0, opts,
    creature, survivors: [], survivor: null, events: [], sounds: [],
    explore: { done: false, ticks: 0, distance: 0 },
    rounds: [],                         // results of every round
    outcomes: [],                       // one entry per survivor, over all rounds
    heardHeat: new Uint16Array(world.N),   // where survivors were heard, over all rounds
    catches: [], escapes: [], dawns: [], frozen: [],
    pauseLeft: 0, weather: weatherAt(world, 0), nextId: 1,
    log(who, kind, text) { sim.events.push({ step: sim.step, round: sim.round, who, kind, text }); if (sim.events.length > 600) sim.events.splice(0, 200); },
  };
  creature.k.origin = null;
  addLandmark(world, creature.k, { kind: 'start', cell: world.lair, step: 0, note: 'Its lair' });
  if (opts.premapped) {
    // it has lived here for a long time: it knows the ground (used to evaluate designs quickly)
    for (let i = 0; i < world.N; i++) creature.k.known[i] = world.walk[i] ? 0 : 1;
    creature.k.knownCount = world.N;
    for (const c of world.corners) addLandmark(world, creature.k, { kind: 'corner', cell: c.cell, step: 0, note: c.name });
    for (const w of world.warmSpots) addLandmark(world, creature.k, { kind: 'warm', cell: w.cell, step: 0, note: w.name, data: { gain: w.gain, type: w.type } });
    addLandmark(world, creature.k, { kind: 'exit', cell: world.door, step: 0, note: world.refuge.name });
    sim.explore.done = true;
    startRound(sim);
  } else {
    creatureLook(sim);
    sim.log('creature', 'wake', `The creature wakes in its lair near ${describeLocation(world, world.lair).street}. It knows nothing about ${world.place.name} yet.`);
  }
  return sim;
}

// What the design adds to the world: plowed cells, warm places, caches.
export function applyDesign(world, design, config) {
  world.plowed = new Uint8Array(world.N);
  const plowNames = new Set(design.plowed ?? []);
  for (let i = 0; i < world.N; i++) {
    if (!world.walk[i] || world.street[i] < 0) continue;
    if ((world.surface[i] === S.AVENUE || world.surface[i] === S.STREET) && plowNames.has(world.names[world.street[i]])) world.plowed[i] = 1;
  }
  world.warm = warmField(world, design, config);
  world.warmSpots = [
    ...(design.warming ?? []).filter((c) => world.walk[c]).map((cell, k) => ({ cell, gain: config.needs.warmCentre, type: 'centre', name: `Warming centre ${k + 1}` })),
    ...world.pois.subways.map((s) => ({ cell: s.cell, gain: config.needs.subwayAir, type: 'subway', name: s.name ? `Subway entrance (${s.name})` : 'Subway entrance' })),
    ...world.pois.shelters.map((s) => ({ cell: s.cell, gain: config.needs.subwayAir, type: 'shelter', name: s.name || 'A shelter' })),
    ...world.pois.shops.map((s) => ({ cell: s.cell, gain: config.needs.doorway, type: 'doorway', name: s.name ? `${s.name} doorway` : 'A shop doorway' })),
  ];
  for (const c of design.warming ?? []) if (world.walk[c]) world.lit[c] = 1;
  world.caches = (design.caches ?? []).filter((c) => world.walk[c.cell]).map((c) => ({ ...c, taken: false }));
}

// ---------------------------------------------------------------- helpers

const xy = (world, i) => [i % world.W, Math.floor(i / world.W)];
const cheb = (world, a, b) => { const [ax, ay] = xy(world, a); const [bx, by] = xy(world, b); return Math.max(Math.abs(ax - bx), Math.abs(ay - by)); };
const euclid = (world, a, b) => { const [ax, ay] = xy(world, a); const [bx, by] = xy(world, b); return Math.hypot(ax - bx, ay - by); };
const headingTo = (world, a, b) => { const [ax, ay] = xy(world, a); const [bx, by] = xy(world, b); return ax === bx && ay === by ? null : Math.atan2(by - ay, bx - ax); };

export const eye = (world, i, m = world.config.eyeM) => [(i % world.W) + 0.5, Math.floor(i / world.W) + 0.5, (world.elev[i] + m) / world.cellM];

// Can an agent at `a` facing `facing` see cell `b`? Within range, inside the cone, a clear 3D line
// (buildings, trees and the terrain itself block it).
function sees(world, a, facing, b, range, coneDeg, eyeM) {
  if (euclid(world, a, b) > range) return false;
  const h = headingTo(world, a, b);
  if (h !== null && Math.abs(wrap(h - facing)) > (coneDeg * Math.PI) / 360) return false;
  return segmentClear(world, eye(world, a, eyeM), eye(world, b));
}

// Acoustic distance (cells): straight line plus muffling by what the sound passes through, then
// stretched or shrunk by the wind: sound carries downwind.
export function acoustic(sim, from, to) {
  const { world } = sim;
  const d = acousticDistance(world, eye(world, from), eye(world, to)).distance;
  const w = sim.weather;
  const rad = (w.dir * Math.PI) / 180;
  const tox = -Math.sin(rad); const toy = Math.cos(rad);   // the way the wind blows
  const [fx, fy] = xy(world, from); const [tx, ty] = xy(world, to);
  const L = Math.hypot(tx - fx, ty - fy) || 1;
  const along = ((tx - fx) * tox + (ty - fy) * toy) / L;   // +1: the listener is downwind
  return d * (1 - 0.3 * clamp(w.wind / 35, 0, 1.2) * along);
}

// Visibility: snowfall shortens every sight range
const visibility = (w) => 1 / (1 + 0.3 * w.snowfall);

const occupied = (sim, cell, self) => sim.survivors.some((s) => s !== self && s.active && s.node === cell);

function moveAgent(sim, agent, next) {
  if (next === agent.node) return false;
  if (agent.kind === 'survivor' && occupied(sim, next, agent)) return false;   // survivors take up space
  const h = headingTo(sim.world, agent.node, next);
  if (h !== null) agent.facing = h;
  const climb = sim.world.elev[next] - sim.world.elev[agent.node];
  agent.node = next;
  agent.distance++;
  agent.k.trail.push(next);
  agent.k.visits[next]++;
  if (agent.kind === 'survivor') spendStamina(sim, agent, next, climb);
  return true;
}

// Walk toward `target` on the agent's own map at `speed` cells per tick. False if it cannot.
function walk(sim, agent, target, speed, routeOpts = {}) {
  agent.budget += speed;
  let moved = false;
  while (agent.budget >= 1) {
    agent.budget -= 1;
    if (agent.node === target) { agent.budget = 0; break; }
    const route = plan(sim.world, agent.k, agent.node, { ...routeOpts, stopAt: target });
    const next = firstStep(route, agent.node, target);
    if (next === agent.node) { agent.budget = 0; return moved; }
    if (!moveAgent(sim, agent, next)) { agent.budget = 0; return moved; }
    moved = true;
  }
  return true;
}

function creatureLook(sim) {
  const c = sim.creature;
  const cc = sim.config.creature;
  const range = cc.sight * (sim.phase === 'explore' ? 1 : visibility(sim.weather));
  const fresh = look(sim.world, c.k, c.node, c.facing, range, cc.coneDeg, sim.step);
  for (const lm of recognise(sim.world, c.k, fresh, sim.step, { notice: ['exit', 'corner', 'warm', 'deadend'] })) {
    if (lm.kind === 'warm' && lm.data.type === 'doorway') continue;
    sim.log('creature', 'landmark', `Landmark ${lm.id}: ${lm.note}, ${lm.text}.`);
  }
  return fresh;
}

function survivorLook(sim, s) {
  const sc = sim.config.survivor;
  const range = s.lightOn || sim.world.lit[s.node] ? sc.sight * visibility(sim.weather) : sc.darkSight;
  const fresh = look(sim.world, s.k, s.node, s.facing, range, sc.coneDeg, sim.step);
  for (const lm of recognise(sim.world, s.k, fresh, sim.step)) {
    if (lm.kind === 'exit') sim.log('survivor', 'landmark', `${s.name} sees the door of ${lm.note} (${lm.id}, ${lm.text}).`);
    else if (lm.kind === 'supply') sim.log('survivor', 'landmark', `${s.name} spots a cache: ${lm.note.toLowerCase()} (${lm.id}).`);
    else if (lm.kind === 'warm' && lm.data.type !== 'doorway') sim.log('survivor', 'landmark', `${s.name} finds a warm place: ${lm.note} (${lm.id}).`);
  }
  return fresh;
}

export const coverage = (sim) => sim.creature.k.knownCount / sim.world.N;
export const walkableCoverage = (sim) => {
  let n = 0;
  for (const i of sim.world.nodes) if (sim.creature.k.known[i] !== -1) n++;
  return n / sim.world.nodes.length;
};
export const hoursIn = (sim) => (sim.phase === 'explore' ? 0 : ((sim.step - sim.roundStart) / sim.config.roundTicks) * sim.config.night.hours);

// ---------------------------------------------------------------- phase 1: explore

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

function isFrontierOf(world, k, i) {
  if (i === null || k.known[i] !== 0) return false;
  const x = i % world.W; const y = Math.floor(i / world.W);
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx; const ny = y + dy;
    if (nx >= 0 && ny >= 0 && nx < world.W && ny < world.H && k.known[ny * world.W + nx] === -1) return true;
  }
  return false;
}

function exploreTick(sim) {
  const c = sim.creature;
  const { world, config } = sim;
  c.moved = false;
  if (c.target === null || c.node === c.target || !isFrontierOf(world, c.k, c.target)) c.target = pickFrontier(sim);
  if (c.target === null) {
    sim.explore.done = true;
    sim.explore.ticks = sim.step;
    sim.explore.distance = c.distance;
    const lms = c.k.landmarks;
    sim.log('creature', 'mapped', `${world.place.name} is mapped: ${Math.round(walkableCoverage(sim) * 100)}% of the open ground seen in ${c.distance} steps (${c.distance * world.cellM} m), `
      + `${lms.filter((l) => l.kind === 'corner').length} street corners, ${lms.filter((l) => l.kind === 'deadend').length} dead ends, ${lms.filter((l) => l.kind === 'warm').length} warm places.`);
    startRound(sim);
    return;
  }
  c.budget += config.creature.exploreSpeed;
  while (c.budget >= 1) {
    c.budget -= 1;
    if (c.node === c.target) break;
    const route = plan(world, c.k, c.node, { stopAt: c.target });
    const next = firstStep(route, c.node, c.target);
    if (next === c.node) { c.target = null; break; }
    c.moved = moveAgent(sim, c, next) || c.moved;
    creatureLook(sim);
  }
  creatureLook(sim);
}

// ---------------------------------------------------------------- phase 2: the night

const NAMES = ['Ana', 'Ben', 'Chen', 'Dee', 'Eli', 'Fay', 'Gus', 'Hana', 'Ivo', 'Jun', 'Kai', 'Lia'];

function spawnCell(sim, taken) {
  const { world, config, rng } = sim;
  const c = sim.creature;
  if (!sim.spawnRoute || sim.spawnRoute.from !== c.node) {
    const truth = { known: Int8Array.from(world.walk, (v) => (v ? 0 : 1)) };
    sim.spawnRoute = { from: c.node, route: plan(world, truth, c.node), door: plan(world, truth, world.door) };
  }
  const { route, door } = sim.spawnRoute;
  const options = world.nodes.filter((n) => route.dist[n] >= config.survivor.minSpawnPath && door.dist[n] >= 35
    && !taken.some((t) => euclid(world, t, n) < 6)
    && !sees(world, c.node, c.facing, n, config.creature.sight, config.creature.coneDeg, config.creatureEyeM));
  return rng.pick(options.length ? options : world.nodes);
}

function makeSurvivor(sim, start, cried = false) {
  const { world, rng } = sim;
  const k = makeKnowledge(world, 'survivor');
  k.origin = null;
  addLandmark(world, k, { kind: 'start', cell: start, step: sim.step, note: 'Where it woke up' });
  const id = sim.nextId++;
  const s = {
    kind: 'survivor', id, name: NAMES[(id - 1) % NAMES.length], node: start, facing: rng.next() * Math.PI * 2, budget: 0,
    mode: 'explore', target: null, goal: null, k, distance: 0, threatAt: null, threatStep: -1e9, hideLeft: 0, running: false, moved: false,
    sees: false, hears: false, start, startStep: sim.step, active: true, result: null, cried,
    // the three needs
    warmth: 55 + rng.next() * 30, stamina: 70 + rng.next() * 30, battery: 45 + rng.next() * 55,
    lightOn: true, warmersLeft: 0, prevWarmth: 0, gaveUp: -1, minWarmth: 100, cachesUsed: [], warmTicks: 0, exposure: 0,
    // the refuge's bearing, the only thing it knows at first ("the hospital is that way")
    bearing: headingTo(world, start, world.door) ?? 0,
  };
  s.minWarmth = s.warmth;
  return s;
}

// Starts a round. `at`: where one survivor wakes up (a cell you chose); the others are random.
function startRound(sim, at = null) {
  const { config } = sim;
  const c = sim.creature;
  sim.phase = 'hunt';
  sim.round++;
  sim.roundStart = sim.step;
  sim.weather = weatherAt(sim.world, 0);
  for (const cache of sim.world.caches) cache.taken = false;
  sim.survivors = [];
  const taken = [];
  const n = config.survivor.count;
  for (let k = 0; k < n; k++) {
    const cell = k === 0 && at !== null ? at : spawnCell(sim, taken);
    taken.push(cell);
    const s = makeSurvivor(sim, cell, k === 0 && at !== null);
    sim.survivors.push(s);
    survivorLook(sim, s);
  }
  sim.survivor = sim.survivors[0];
  c.mode = 'patrol';
  c.target = null;
  c.heardAt = null;
  c.sweep = [];
  const w = sim.weather;
  sim.log('survivor', 'spawn', `Round ${sim.round}: ${w.time.replace('T', ' ')}, ${w.temp.toFixed(1)} °C, wind ${Math.round(w.wind)} km/h from ${compass(w.dir)}, ${Math.round(w.depthCm)} cm of snow. `
    + `${sim.survivors.map((s) => s.name).join(', ')} wake up in the storm, knowing only which way ${sim.world.refuge.name} is.`);
  if (at !== null) {
    sim.sounds.push({ who: 'cry', node: at, heard: true });
    c.heardAt = at;
    sim.heardHeat[at]++;
    if (!nearLandmark(sim.world, c.k, 'heard', at, 3)) addLandmark(sim.world, c.k, { kind: 'heard', cell: at, step: sim.step, note: 'A cry was heard here' });
  }
}

export const compass = (deg) => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8];

// Puts a survivor on `cell`, starting a new round. Returns false if the cell is not allowed.
export function placeSurvivor(sim, cell) {
  const { world } = sim;
  if (sim.phase === 'explore') return false;
  if (cell < 0 || cell >= world.N || !world.walk[cell] || world.doorCells.includes(cell)) return false;
  if (cheb(world, cell, sim.creature.node) <= 2) return false;
  if (sim.phase === 'hunt') sim.log('survivor', 'replace', `Round ${sim.round} was dropped: you placed a survivor.`);
  startRound(sim, cell);
  sim.placed = true;
  return true;
}

// --- the survivors' needs

function spendStamina(sim, s, cell, climb) {
  const nd = sim.config.needs;
  const depth = snowDepthCm(sim.world, cell, sim.weather, shelterFor(sim.world, sim.weather.dir));
  const snow = 1 + depth / 20;
  s.stamina -= (s.running ? nd.staminaRun : nd.staminaWalk) * snow + Math.max(0, climb) * nd.staminaClimb;
  s.stamina = Math.max(0, s.stamina);
  s.wading = depth > 25;
}

function updateNeeds(sim, s) {
  const { world, config } = sim;
  const nd = config.needs;
  const cl = cellClimate(world, s.node, sim.weather, config);
  // heat loss grows with the wind chill; wet from wading, warmer when running, hand warmers halve it
  let loss = nd.warmthLoss * Math.max(0, (5 - cl.chill) / 15) ** 1.5;
  if (s.moved && s.wading) loss *= 1 + nd.deepSnowWet;
  if (s.running) loss *= 1 - nd.runHeat;
  if (s.warmersLeft > 0) { loss *= 0.5; s.warmersLeft--; }
  const gain = world.warm[s.node];
  if (gain > 0) s.warmTicks++;
  s.exposure += loss;
  s.prevWarmth = s.warmth;
  s.warmth = clamp(s.warmth - loss + gain, 0, 100);
  if (s.goal?.kind === 'warm' && s.node === s.goal.cell && gain < loss) s.gaveUp = s.node;   // not warm enough here
  s.minWarmth = Math.min(s.minWarmth, s.warmth);
  if (!s.moved) s.stamina = clamp(s.stamina + nd.staminaRest * (gain > 0 ? 2 : 1), 0, 100);
  // the flashlight: off while hiding and under street lights
  s.lightOn = s.battery > 0 && s.mode !== 'hide' && !world.lit[s.node];
  if (s.lightOn) s.battery = Math.max(0, s.battery - nd.batteryDrain);
  // pick up a cache on or next to its cell
  for (const c of world.caches) {
    if (c.taken || cheb(world, c.cell, s.node) > 1) continue;
    c.taken = true;
    s.cachesUsed.push(c.type);
    if (c.type === 'battery') s.battery = 100;
    if (c.type === 'warmers') { s.warmth = clamp(s.warmth + 20, 0, 100); s.warmersLeft = 160; }
    if (c.type === 'food') { s.stamina = clamp(s.stamina + 60, 0, 100); s.warmth = clamp(s.warmth + 8, 0, 100); }
    sim.log('survivor', 'cache', `${s.name} takes the ${c.type === 'battery' ? 'batteries' : c.type === 'warmers' ? 'hand warmers' : 'food and thermos'}.`);
    const lm = s.k.landmarks.find((l) => l.kind === 'supply' && l.cell === c.cell);
    if (lm) lm.data.used = true;
  }
  // caches someone else took: it finds out when it sees the spot again
  for (const lm of s.k.landmarks) {
    if (lm.kind !== 'supply' || lm.data.used) continue;
    const c = world.caches.find((x) => x.cell === lm.cell);
    if (c && c.taken && s.k.seenAt[lm.cell] === sim.step) lm.data.used = true;
  }
}

// --- the survivors' decisions

function survivorPerceive(sim, s) {
  const { world, config } = sim;
  const c = sim.creature;
  const sc = config.survivor;
  const d = euclid(world, s.node, c.node);
  const range = (s.lightOn || world.lit[s.node] ? sc.sight : sc.darkSight + 1) * visibility(sim.weather);
  s.sees = sees(world, s.node, s.facing, c.node, range, sc.coneDeg, config.eyeM) || d <= 1.5;
  s.hears = c.moved && acoustic(sim, c.node, s.node) <= sc.hearing;
  if (s.sees || (s.hears && d <= 5)) {
    if (s.mode !== 'flee') sim.log('survivor', 'flee', s.sees ? `${s.name} sees the creature and runs!` : `${s.name} hears it right behind and runs!`);
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

// Route costs on its own map: danger near the creature, dead ends it marked, deep snow, and,
// when it is getting cold, wind exposure.
function costFor(sim, s) {
  const { world } = sim;
  const threat = s.threatAt;
  const fresh = sim.step - s.threatStep <= 14;
  const traps = s.k.landmarks.filter((l) => l.kind === 'deadend');
  const shelter = shelterFor(world, sim.weather.dir);
  const cold = s.warmth < 60 ? (60 - s.warmth) / 30 : 0;
  const w = sim.weather;
  const W = world.W;
  return (m) => {
    let extra = snowDepthCm(world, m, w, shelter) / 40;
    if (cold) extra += cold * (1 - shelter[m]);
    if (fresh && threat !== null) { const d = euclid(world, m, threat); if (d < 5) extra += (5 - d) * 6; }
    for (const t of traps) if (Math.max(Math.abs(t.x - (m % W)), Math.abs(t.y - Math.floor(m / W))) <= 1) extra += 4;
    return extra;
  };
}

// Its speed in cells per tick: deep snow slows it, exhaustion stops it running.
function speedOf(sim, s, wantRun) {
  const sc = sim.config.survivor;
  const depth = snowDepthCm(sim.world, s.node, sim.weather, shelterFor(sim.world, sim.weather.dir));
  const canRun = wantRun && s.stamina > sim.config.needs.exhausted;
  s.running = canRun;
  const base = canRun ? sc.run : sc.walk * (s.stamina < sim.config.needs.exhausted ? 0.7 : 1);
  return base / (1 + depth / sc.snowDrag);
}

// The heat it expects to lose walking `cells` cells at its current rate: planning ahead.
function expectedLoss(sim, s, cells) {
  const nd = sim.config.needs;
  const cl = cellClimate(sim.world, s.node, sim.weather, sim.config);
  const perTick = nd.warmthLoss * Math.max(0, (5 - cl.chill) / 15) ** 1.5 * 1.15;
  return (perTick * cells) / Math.max(0.15, speedOf(sim, s, false));
}

function chooseGoal(sim, s, route) {
  const nd = sim.config.needs;
  const known = (kind, pred = () => true) => s.k.landmarks.filter((l) => l.kind === kind && pred(l) && Number.isFinite(route.dist[l.cell]));
  const nearest = (list) => list.sort((a, b) => route.dist[a.cell] - route.dist[b.cell])[0] ?? null;
  const exit = known('exit')[0] ?? null;
  const warmSpots = known('warm');
  // a warming centre or subway air if it knows one within reach, else a doorway; never the one
  // it just gave up on
  const usable = warmSpots.filter((l) => l.cell !== s.gaveUp);
  const bestWarm = nearest(usable.filter((l) => l.data.type !== 'doorway' && route.dist[l.cell] < 60)) ?? nearest(usable);
  const supplies = known('supply', (l) => !l.data.used);
  // already warming up: stay until warm enough
  // (only while it is actually getting warmer there)
  if (s.goal?.kind === 'warm' && s.node === s.goal.cell && s.warmth < 92 && s.warmth > s.prevWarmth) return s.goal;
  // planning ahead: will it make it to the refuge before it freezes?
  if (exit) {
    const need = expectedLoss(sim, s, route.dist[exit.cell]);
    if (s.warmth - need > 12) return { kind: 'exit', cell: exit.cell, why: 'heads for the refuge' };
  }
  if (s.warmth < nd.lowWarmth || (exit && bestWarm)) {
    const warmers = nearest(supplies.filter((l) => l.data.type === 'warmers'));
    if (warmers && (!bestWarm || route.dist[warmers.cell] < route.dist[bestWarm.cell] * 0.7)) return { kind: 'supply', cell: warmers.cell, why: 'goes for the hand warmers' };
    if (bestWarm && s.warmth < 80) return { kind: 'warm', cell: bestWarm.cell, why: `goes to warm up at ${bestWarm.note}` };
  }
  if (s.battery < nd.lowBattery) { const b = nearest(supplies.filter((l) => l.data.type === 'battery')); if (b) return { kind: 'supply', cell: b.cell, why: 'goes for the batteries' }; }
  if (s.stamina < nd.lowStamina) { const f = nearest(supplies.filter((l) => l.data.type === 'food')); if (f) return { kind: 'supply', cell: f.cell, why: 'goes for the food' }; }
  // a cache close by is always worth the detour
  const close = nearest(supplies.filter((l) => route.dist[l.cell] <= 7));
  if (close) return { kind: 'supply', cell: close.cell, why: 'grabs a cache on the way' };
  if (exit) return { kind: 'exit', cell: exit.cell, why: 'heads for the refuge, cold or not' };
  return null;
}

function survivorAct(sim, s) {
  const { world, config } = sim;
  const sc = config.survivor;
  const avoid = costFor(sim, s);
  s.moved = false;
  s.running = false;
  const fresh = sim.step - s.threatStep <= 12;

  if (s.mode === 'flee') {
    if (!fresh) {
      s.mode = 'hide';
      s.hideLeft = sc.hideTicks;
      sim.log('survivor', 'hide', `${s.name} stops, turns off the light and holds its breath.`);
      return;
    }
    const route = plan(world, s.k, s.node, { avoid });
    const exit = s.k.landmarks.find((l) => l.kind === 'exit');
    if (exit && Number.isFinite(route.dist[exit.cell]) && !pathTo(route, exit.cell).some((n) => euclid(world, n, s.threatAt) < 3)) s.target = exit.cell;
    if (s.target === null || s.target === s.node) {
      let best = null; let bestScore = -Infinity;
      const traps = s.k.landmarks.filter((l) => l.kind === 'deadend');
      for (let i = 0; i < world.N; i++) {
        const dist = route.dist[i];
        if (!Number.isFinite(dist) || dist > 14 || dist < 2) continue;
        let score = euclid(world, i, s.threatAt) - 0.45 * dist;
        if (traps.some((t) => Math.max(Math.abs(t.x - (i % world.W)), Math.abs(t.y - Math.floor(i / world.W))) <= 2)) score -= 8;
        if (world.lit[i]) score -= 1.5;   // stay out of the light
        if (score > bestScore) { bestScore = score; best = i; }
      }
      s.target = best;
    }
    if (s.target !== null) { const before = s.node; walk(sim, s, s.target, speedOf(sim, s, true), { avoid }); s.moved = s.node !== before; }
  } else if (s.mode === 'hide') {
    s.hideLeft--;
    if (sim.step % 6 === 0) s.facing += TURN * (sim.rng.chance(0.5) ? 1 : -1);
    if (s.hideLeft <= 0) { s.mode = 'explore'; s.target = null; }
  } else {
    const route = plan(world, s.k, s.node, { avoid });
    const goal = chooseGoal(sim, s, route);
    if (goal && (s.goal?.cell !== goal.cell)) sim.log('survivor', 'goal', `${s.name} ${goal.why}.`);
    s.goal = goal;
    if (goal) {
      s.mode = goal.kind === 'warm' && s.node === goal.cell ? 'warm' : 'go';
      s.target = goal.cell;
    } else {
      s.mode = 'explore';
      if (s.target === null || s.node === s.target || !isFrontierOf(world, s.k, s.target)) {
        // explore: the frontier that looks best, biased toward where it was told the refuge is
        let best = null; let bestScore = Infinity;
        const bx = Math.cos(s.bearing); const by = Math.sin(s.bearing);
        const [sx, sy] = xy(world, s.node);
        for (const f of frontiers(world, s.k)) {
          const d = route.dist[f];
          if (!Number.isFinite(d)) continue;
          const [fx, fy] = xy(world, f);
          const away = -((fx - sx) * bx + (fy - sy) * by);     // cells against the bearing
          const h = headingTo(world, s.node, f);
          const turn = h === null ? 0 : Math.abs(wrap(h - s.facing));
          const score = d + sc.headingBias * away + 0.8 * turn;
          if (score < bestScore) { bestScore = score; best = f; }
        }
        s.target = best;
      }
    }
    if (s.mode === 'warm') { s.facing += sim.step % 9 === 0 ? TURN : 0; }
    else if (s.target !== null) {
      const before = s.node;
      walk(sim, s, s.target, speedOf(sim, s, false), { avoid });
      s.moved = s.node !== before;
    } else s.facing += TURN;
  }
  survivorLook(sim, s);
}

// --- the creature

function creatureHears(sim) {
  const { world, config } = sim;
  const c = sim.creature;
  const w = sim.weather;
  const hearing = config.creature.hearing / (1 + w.gust / 120);     // the storm drowns out sound
  let best = null; let bestD = Infinity;
  for (const s of sim.survivors) {
    if (!s.active || !s.moved) continue;
    const quiet = s.running ? 0 : config.survivor.quiet;
    const d = acoustic(sim, s.node, c.node) + quiet;
    const heard = d <= hearing;
    sim.sounds.push({ who: 'survivor', node: s.node, heard, running: s.running, id: s.id });
    if (heard && d < bestD) { bestD = d; best = s; }
  }
  if (!best) return false;
  sim.heardHeat[best.node]++;
  c.heardAt = best.node;
  if (!nearLandmark(world, c.k, 'heard', best.node, 3)) addLandmark(world, c.k, { kind: 'heard', cell: best.node, step: sim.step, note: 'Footsteps were heard here' });
  return true;
}

function creatureAct(sim) {
  const { world, config } = sim;
  const c = sim.creature;
  const cc = config.creature;
  const before = c.node;
  const vis = visibility(sim.weather);
  c.seesSurvivor = false;
  let seen = null; let seenD = Infinity;
  for (const s of sim.survivors) {
    if (!s.active) continue;
    // a survivor under a street light, or with its flashlight on, is seen from farther away
    const range = cc.sight * vis * (world.lit[s.node] ? cc.litBonus : s.lightOn ? 1.3 : 1);
    if (sees(world, c.node, c.facing, s.node, range, cc.coneDeg, config.creatureEyeM)) {
      const d = euclid(world, c.node, s.node);
      if (d < seenD) { seenD = d; seen = s; }
    }
  }
  if (seen) {
    c.seesSurvivor = true;
    if (c.mode !== 'chase' || c.quarry !== seen.id) sim.log('creature', 'spot', `The creature sees ${seen.name}!`);
    c.mode = 'chase';
    c.quarry = seen.id;
    c.target = seen.node;
    c.lastSeen = seen.node;
    c.heardAt = null;
  } else if (c.heardAt !== null && c.mode !== 'chase') {
    if (c.mode !== 'investigate') {
      const route = plan(world, c.k, c.node, { stopAt: c.heardAt });
      const what = sim.sounds.some((x) => x.who === 'cry') ? 'a cry' : 'footsteps';
      sim.log('creature', 'hear', `It hears ${what} and plans a route there on its own map: ${Math.round(route.dist[c.heardAt] * world.cellM)} m.`);
    }
    c.mode = 'investigate';
    c.target = c.heardAt;
    c.heardAt = null;
    const h = headingTo(world, c.node, c.target);
    if (h !== null) c.facing = h;
  }
  const depth = snowDepthCm(world, c.node, sim.weather, shelterFor(world, sim.weather.dir));
  const drag = 1 / (1 + depth / cc.snowDrag);

  switch (c.mode) {
    case 'chase':
      if (c.node === c.target || !walk(sim, c, c.target, cc.chase * drag)) startSearch(sim, c.target);
      break;
    case 'investigate':
      if (c.node === c.target || !walk(sim, c, c.target, cc.investigate * drag)) startSearch(sim, c.target);
      break;
    case 'search':
      c.facing += TURN;
      c.searchLeft--;
      if (c.searchLeft <= 0) {
        c.mode = c.sweep.length ? 'sweep' : 'patrol';
        c.target = c.sweep.shift() ?? null;
        if (c.mode === 'sweep') sim.log('creature', 'sweep', 'It checks the dead ends and warm places it remembers nearby.');
      }
      break;
    case 'sweep':
      if (c.target === null || c.node === c.target || cheb(world, c.node, c.target) <= 1 || !walk(sim, c, c.target, cc.investigate * drag)) {
        c.facing = headingTo(world, c.node, c.target ?? c.node) ?? c.facing;
        c.target = c.sweep.shift() ?? null;
        if (c.target === null) c.mode = 'patrol';
      }
      break;
    case 'patrol':
    default: {
      c.mode = 'patrol';
      if (c.target === null || c.node === c.target) {
        const pick = patrolLandmark(sim);
        c.target = pick ? nearestOpen(world, c.k, pick.cell) : null;
      }
      if (c.target !== null && !walk(sim, c, c.target, cc.patrol * drag)) c.target = null;
    }
  }
  c.moved = c.node !== before;
  creatureLook(sim);
}

// Between sounds it walks its landmarks, choosing those where it has heard or caught survivors
// before (its memory makes it better over the rounds), and warm places, where survivors gather.
export function landmarkInterest(sim, l) {
  const { world } = sim;
  let heard = 0;
  const r = 5;
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const x = l.x + dx; const y = l.y + dy;
    if (x >= 0 && y >= 0 && x < world.W && y < world.H) heard += sim.heardHeat[y * world.W + x];
  }
  const caught = sim.catches.filter((n) => Math.hypot((n % world.W) - l.x, Math.floor(n / world.W) - l.y) <= 6).length;
  const base = { exit: 1.5, warm: l.data?.type === 'centre' ? 3 : l.data?.type === 'doorway' ? 0.3 : 2, deadend: 1, corner: 0.7 }[l.kind] ?? 0;
  return base + 0.4 * Math.min(20, heard) + 3 * caught;
}

function patrolLandmark(sim) {
  const c = sim.creature;
  const lms = c.k.landmarks.filter((l) => ['exit', 'warm', 'deadend', 'corner'].includes(l.kind) && cheb(sim.world, l.cell, c.node) > 3);
  if (!lms.length) return null;
  const weights = lms.map((l) => landmarkInterest(sim, l));
  let r = sim.rng.next() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < lms.length; i++) { r -= weights[i]; if (r <= 0) return lms[i]; }
  return lms[lms.length - 1];
}

function startSearch(sim, at) {
  const { world } = sim;
  const c = sim.creature;
  c.mode = 'search';
  c.searchLeft = sim.config.creature.searchTicks;
  const route = plan(world, c.k, c.node);
  c.sweep = c.k.landmarks
    .filter((l) => (l.kind === 'deadend' || (l.kind === 'warm' && l.data?.type !== 'doorway')) && Number.isFinite(route.dist[l.cell]) && euclid(world, l.cell, at ?? c.node) <= 12)
    .sort((a, b) => route.dist[a.cell] - route.dist[b.cell])
    .slice(0, 3)
    .map((l) => nearestOpen(world, c.k, l.cell))
    .filter((x) => x !== null);
}

function nearestOpen(world, k, cell) {
  if (k.known[cell] === 0) return cell;
  const x = cell % world.W; const y = Math.floor(cell / world.W);
  for (let r = 1; r < 4; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const i = (y + dy) * world.W + (x + dx);
    if (i >= 0 && i < world.N && k.known[i] === 0) return i;
  }
  return null;
}

function caught(sim, s) {
  const { world } = sim;
  const a = s.node;
  const b = sim.creature.node;
  if (cheb(world, a, b) > 1) return false;
  const [ax, ay] = xy(world, a); const [bx, by] = xy(world, b);
  if (ax !== bx && ay !== by) return world.walk[ay * world.W + bx] === 1 && world.walk[by * world.W + ax] === 1;
  return true;
}

// One survivor's night is over.
function finish(sim, s, result) {
  const { world, config } = sim;
  s.active = false;
  s.result = result;
  const ticks = sim.step - sim.roundStart;
  const hours = (ticks / config.roundTicks) * config.night.hours;
  const out = {
    round: sim.round, id: s.id, name: s.name, result, ticks, hours, distance: s.distance, metres: s.distance * world.cellM,
    start: s.start, end: s.node, trail: s.k.trail.slice(), warmth: s.warmth, minWarmth: s.minWarmth, stamina: s.stamina, battery: s.battery,
    caches: s.cachesUsed.slice(), warmTicks: s.warmTicks, seen: s.k.knownCount / world.N, landmarks: s.k.landmarks.length,
  };
  sim.outcomes.push(out);
  const clock = sim.weather.time.slice(11, 16);
  if (result === 'caught') {
    sim.catches.push(s.node);
    addLandmark(world, sim.creature.k, { kind: 'caught', cell: s.node, step: sim.step, note: `It caught ${s.name} here` });
    sim.log('creature', 'caught', `The creature caught ${s.name} at ${clock}, near ${describeLocation(world, s.node).street}.`);
  } else if (result === 'escaped') {
    sim.escapes.push(s.node);
    sim.log('survivor', 'escaped', `${s.name} reached ${world.refuge.name} at ${clock}: ${out.metres} m walked, warmth ${Math.round(s.warmth)}.`);
  } else if (result === 'froze') {
    sim.frozen.push(s.node);
    addLandmark(world, sim.creature.k, { kind: 'froze', cell: s.node, step: sim.step, note: `${s.name} froze here` });
    sim.log('survivor', 'froze', `${s.name} could not go on in the cold, at ${clock} near ${describeLocation(world, s.node).street}.`);
  } else {
    sim.dawns.push(s.node);
    sim.log('survivor', 'dawn', `Dawn: ${s.name} made it through the night outside, warmth ${Math.round(s.warmth)}.`);
  }
  if (sim.survivor === s) sim.survivor = sim.survivors.find((x) => x.active) ?? s;
}

function endRound(sim) {
  const mine = sim.outcomes.filter((o) => o.round === sim.round);
  const tally = { escaped: 0, caught: 0, froze: 0, dawn: 0 };
  for (const o of mine) tally[o.result]++;
  sim.rounds.push({ round: sim.round, ...tally, survivors: mine.length, ticks: sim.step - sim.roundStart });
  sim.phase = 'pause';
  sim.pauseLeft = sim.config.pauseTicks;
}

function huntTick(sim) {
  const { world, config } = sim;
  sim.weather = weatherAt(world, hoursIn(sim));
  for (const s of sim.survivors) {
    if (!s.active) continue;
    survivorAct(sim, s);
    if (world.doorCells.includes(s.node)) { finish(sim, s, 'escaped'); continue; }
    if (caught(sim, s)) { finish(sim, s, 'caught'); continue; }
    updateNeeds(sim, s);
    if (s.warmth <= 0) finish(sim, s, 'froze');
  }
  creatureHears(sim);
  creatureAct(sim);
  for (const s of sim.survivors) {
    if (!s.active) continue;
    if (caught(sim, s)) { finish(sim, s, 'caught'); continue; }
    survivorPerceive(sim, s);
  }
  if (sim.step - sim.roundStart >= config.roundTicks) for (const s of sim.survivors) if (s.active) finish(sim, s, 'dawn');
  if (!sim.survivors.some((s) => s.active)) endRound(sim);
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
  c.path = c.target !== null && c.target !== undefined ? pathTo(plan(sim.world, c.k, c.node, { stopAt: c.target }), c.target) : [];
  if (c.path.length === 1 && c.target !== c.node) c.path = [];
  for (const s of sim.survivors) {
    s.path = sim.phase === 'hunt' && s.active && s.target !== null ? pathTo(plan(sim.world, s.k, s.node, { stopAt: s.target }), s.target) : [];
    if (s.path.length === 1 && s.target !== s.node) s.path = [];
  }
}

// Runs until `rounds` more rounds have finished (fast-forward, balancing, evaluating designs).
export function runRounds(sim, rounds, maxSteps = 400000) {
  const target = sim.rounds.length + rounds;
  sim.drawRoutes = false;
  for (let i = 0; i < maxSteps && sim.rounds.length < target; i++) stepSim(sim);
  sim.drawRoutes = true;
  updateRoutes(sim);
  return sim;
}

export const MODES = {
  explore: 'Mapping the neighbourhood',
  patrol: 'Walking its landmarks',
  investigate: 'Heading for a sound',
  search: 'Listening, turning',
  sweep: 'Checking hiding places',
  chase: 'Chasing',
};
export const SURVIVOR_MODES = { explore: 'Exploring', go: 'On its way', warm: 'Warming up', flee: 'Running', hide: 'Hiding, light off' };
export const RESULT_NAMES = { escaped: 'Reached the refuge', caught: 'Caught', froze: 'Froze', dawn: 'Survived till dawn' };
