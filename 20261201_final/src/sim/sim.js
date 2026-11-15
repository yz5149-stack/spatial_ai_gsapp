// One store, many nights. Two kinds of spatial agents:
//
//   Survivors  come in from the blizzard one by one with a shopping list (water, food, medicine,
//              batteries, hand warmers). They know nothing of the store. They scan with a flashlight
//              cone, read shelves and aisle signs, remember where things are, plan the order to
//              collect them, and leave by the front door. They run and hide when they see or hear
//              the creature.
//   The creature comes in through the stockroom door. It maps the store over the nights, hunts by
//              sound, and remembers where it heard and caught people, so it patrols those places.
//
// Performance: survivors, escaped / items / time; the creature, catches / time to first catch.

import { CONFIG, CATS, CAT_LABEL } from './config.js';
import { Z, T } from './store.js';
import { makeRng } from './rng.js';
import { acousticDistance, segmentClear, wrapAngle, point } from './los.js';
import { makeKnowledge, look, plan, pathTo, frontiers, knownAccess, addLandmark, nearLandmark, recognise, itemLandmark } from './knowledge.js';

const NAMES = ['Ada', 'Bo', 'Cy', 'Dee', 'Eli', 'Fen', 'Gus', 'Hal', 'Ivy', 'Jo', 'Kit', 'Lu', 'Max', 'Nia', 'Oz', 'Pia', 'Quinn', 'Rae', 'Sol', 'Tam'];
const COLORS = ['#ffd27a', '#7ae0ff', '#c6a2ff', '#9dffb0', '#ff9ec7'];
const DIRS8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

export function makeSim(world, { seed = 1, cond = null, human = false, cfg = CONFIG } = {}) {
  const sim = {
    world, cfg, cond, rng: makeRng(seed), seed, human,
    t: 0, night: 0, phase: 'pause', pauseT: 0, clock: 0,
    survivors: [], nights: [], log: [], events: [], noise: [], creatureNoise: null,
    heat: { walk: new Float32Array(world.N), heard: new Float32Array(world.N), caught: [], escapedTrails: [], caughtTrails: [] },
    input: { dx: 0, dy: 0, run: false, crouch: false },
    serial: 0, eventSerial: 0,
  };
  sim.creature = makeCreature(sim);
  startNight(sim);
  return sim;
}

function makeCreature(sim) {
  const w = sim.world;
  return {
    kind: 'creature', cell: w.lair, facing: 0, prog: 0, path: [], state: 'enter', target: null,
    k: makeKnowledge(w, 'creature', w.lair), hunt: new Float32Array(w.N),
    searchT: 0, feedT: 0, sweep: [], lastHeard: null, sees: [], hears: null, planT: -99,
    total: { catches: 0, dist: 0 },
  };
}

const log = (sim, text, kind = '') => {
  sim.log.push({ night: sim.night, t: sim.t, text, kind });
  if (sim.log.length > 200) sim.log.shift();
};
const emit = (sim, e) => { sim.events.push({ ...e, t: sim.t, night: sim.night, n: ++sim.eventSerial }); if (sim.events.length > 300) sim.events.shift(); };
const cx = (w, i) => i % w.W;
const cy = (w, i) => Math.floor(i / w.W);
const hdist = (w, a, b) => Math.hypot(cx(w, a) - cx(w, b), cy(w, a) - cy(w, b));

export function startNight(sim) {
  const { world, cfg, cond, rng } = sim;
  sim.night++;
  sim.t = 0;
  sim.phase = 'night';
  const c = sim.creature;
  c.cell = world.lair; c.prog = 0; c.path = []; c.state = 'enter'; c.target = null; c.feedT = 0; c.sweep = []; c.lastHeard = null;
  c.facing = facingInto(world, world.lair);
  c.night = { catches: 0, firstCatch: null, dist: 0 };
  // memory of hunting grounds fades a little each night, but it never forgets the layout
  for (let i = 0; i < world.N; i++) c.hunt[i] *= 0.8;
  const count = cond ? cond.survivorsPerNight : 3;
  sim.survivors = [];
  for (let n = 0; n < count; n++) {
    const pool = CATS.filter((x) => x !== 'warmers' || !cond?.cold);
    const size = rng.int(cfg.survivor.listSize[0], cfg.survivor.listSize[1]) - (cond?.cold ? 1 : 0);
    const list = [];
    while (list.length < size) { const p = rng.pick(pool); if (!list.includes(p)) list.push(p); }
    if (cond?.cold) list.push('warmers');
    sim.serial++;
    sim.survivors.push({
      kind: 'survivor', id: sim.serial, name: NAMES[(sim.serial - 1) % NAMES.length], color: COLORS[n % COLORS.length],
      human: sim.human && n === 0, list, got: [], state: 'waiting', spawnT: n * cfg.spawnEvery + (n ? rng.int(0, 20) : 0),
      cell: -1, facing: -Math.PI / 2, prog: 0, path: [], k: makeKnowledge(world, `survivor ${sim.serial}`, world.entry),
      crouch: false, running: false, hideT: 0, pickT: 0, slipT: 0, lastC: null, planT: -99, order: [], goal: -1,
      steps: 0, dist: 0, seenTicks: 0, outcome: null, inT: 0, outT: 0, trail: [], refuge: -1, blockedT: 0,
    });
  }
  log(sim, `Night ${sim.night}: ${count} survivors are coming in from the snow.`, 'night');
}

function facingInto(world, cell) {
  const x = cx(world, cell); const y = cy(world, cell);
  if (y === 0) return Math.PI / 2;
  if (x === 0) return 0;
  if (x === world.W - 1) return Math.PI;
  return -Math.PI / 2;
}

// ---------------------------------------------------------------- one tick

export function step(sim) {
  sim.clock++;
  if (sim.phase === 'pause') {
    if (--sim.pauseT <= 0) startNight(sim);
    return;
  }
  sim.t++;
  sim.noise = [];
  const occupied = new Set(sim.survivors.filter((s) => s.cell >= 0 && !s.outcome).map((s) => s.cell));
  for (const s of sim.survivors) {
    if (s.outcome) continue;
    if (s.state === 'waiting') {
      if (sim.t < s.spawnT) continue;
      const spot = sim.world.doorCells.find((d) => !occupied.has(d));
      if (spot === undefined) continue;
      s.cell = spot; s.state = 'shop'; s.inT = sim.t; s.facing = -Math.PI / 2; occupied.add(spot);
      s.trail.push(spot);
      survivorLook(sim, s);
      log(sim, `${s.name} comes in for ${s.list.map((c) => CAT_LABEL[c].toLowerCase()).join(', ')}.`, 'in');
      emit(sim, { type: 'enter', cell: spot, who: s.id });
      continue;
    }
    survivorTick(sim, s, occupied);
  }
  creatureTick(sim);
  // the night ends when everyone is out, caught, or at dawn
  const live = sim.survivors.some((s) => !s.outcome);
  if (!live || sim.t >= sim.cfg.roundTicks) endNight(sim);
}

export function endNight(sim) {
  for (const s of sim.survivors) if (!s.outcome) { s.outcome = s.state === 'waiting' ? 'never came' : 'stranded'; s.outT = sim.t; }
  const ss = sim.survivors.filter((s) => s.outcome !== 'never came');
  const esc = ss.filter((s) => s.outcome === 'escaped');
  const need = ss.reduce((a, s) => a + s.list.length, 0);
  const got = ss.reduce((a, s) => a + s.got.length, 0);
  const sec = sim.cfg.tickSeconds;
  const c = sim.creature;
  const r = {
    night: sim.night, survivors: ss.length, escaped: esc.length, caught: ss.filter((s) => s.outcome === 'caught').length,
    stranded: ss.filter((s) => s.outcome === 'stranded').length,
    items: need ? got / need : 0,
    fullLists: esc.filter((s) => s.got.length === s.list.length).length,
    escapeTime: esc.length ? (esc.reduce((a, s) => a + (s.outT - s.inT), 0) / esc.length) * sec : null,
    walked: ss.length ? ss.reduce((a, s) => a + s.dist, 0) / ss.length : 0,
    exposure: ss.length ? (ss.reduce((a, s) => a + s.seenTicks, 0) / ss.length) * sec : 0,
    firstCatch: c.night.firstCatch != null ? c.night.firstCatch * sec : null,
    creatureWalked: c.night.dist,
    coverage: coverage(sim.world, c.k),
    seconds: sim.t * sec,
  };
  sim.nights.push(r);
  for (const s of ss) (s.outcome === 'escaped' ? sim.heat.escapedTrails : sim.heat.caughtTrails).push(s.trail.slice());
  for (const key of ['escapedTrails', 'caughtTrails']) if (sim.heat[key].length > 60) sim.heat[key].splice(0, sim.heat[key].length - 60);
  log(sim, `Night ${sim.night} ends: ${r.escaped} escaped, ${r.caught} caught${r.stranded ? `, ${r.stranded} stranded` : ''}.`, 'end');
  emit(sim, { type: 'nightEnd', r });
  sim.phase = 'pause';
  sim.pauseT = sim.cfg.pauseTicks;
}

export function coverage(world, k) {
  let n = 0; let seen = 0;
  for (let i = 0; i < world.N; i++) if (world.walk[i] && world.reach[i] >= 0) { n++; if (k.known[i] >= 0) seen++; }
  return n ? seen / n : 0;
}

// ---------------------------------------------------------------- perception

function lightAt(world, i) { return Math.min(1, world.light[i]); }

// Can `from` (eye at eyeM metres) see a body whose head is at headM metres on cell `to`?
export function canSee(sim, fromCell, facing, eyeM, toCell, headM, rangeCells, coneDeg) {
  const w = sim.world;
  const d = hdist(w, fromCell, toCell);
  if (d <= 1.6) return true; // close enough to touch
  const eff = rangeCells * (0.3 + 0.7 * lightAt(w, toCell));
  if (d > eff) return false;
  const ang = Math.atan2(cy(w, toCell) - cy(w, fromCell), cx(w, toCell) - cx(w, fromCell));
  if (Math.abs(wrapAngle(ang - facing)) > (coneDeg * Math.PI) / 360) return false;
  return segmentClear(w, point(w, fromCell, eyeM), point(w, toCell, headM));
}

function survivorLook(sim, s) {
  const { cfg, world } = sim;
  const eye = s.crouch ? cfg.eye.crouch : cfg.eye.stand;
  const res = look(world, s.k, s.cell, s.facing, {
    range: cfg.survivor.sight, coneDeg: cfg.survivor.coneDeg, eyeCells: eye / 0.5,
    readRange: cfg.survivor.readRange, signRange: cfg.survivor.signRange, step: sim.t,
  });
  for (const i of res.read) {
    if (s.list.includes(CATS[world.cat[i]]) && !s.got.includes(CATS[world.cat[i]])) {
      const lm = itemLandmark(world, s.k, i, sim.t, res.signs.includes(world.runOf[i]) ? 'sign' : 'seen');
      if (lm) { s.planT = -99; emit(sim, { type: 'found', cell: i, who: s.id, cat: CATS[world.cat[i]] }); }
    }
  }
  if (res.signs.length) { s.planT = -99; for (const r of res.signs) emit(sim, { type: 'sign', run: r, who: s.id }); }
  recognise(world, s.k, res.fresh, sim.t);
  return res;
}

// ---------------------------------------------------------------- survivors

function survivorTick(sim, s, occupied) {
  const { world, cfg } = sim;
  const c = sim.creature;
  const S = cfg.survivor;
  s.k.visits[s.cell]++;
  sim.heat.walk[s.cell] += 1;
  if (s.slipT > 0) { s.slipT--; return; }

  // what it notices of the creature
  const inside = c.state !== 'outside';
  const sees = inside && canSee(sim, s.cell, s.facing, s.crouch ? cfg.eye.crouch : cfg.eye.stand, c.cell, cfg.head.creature, S.sight, S.coneDeg);
  let heardAt = null;
  if (inside && sim.creatureNoise != null) {
    const d = acousticDistance(world, point(world, s.cell, 1.6), point(world, sim.creatureNoise, 1.2));
    if (d <= S.hearing * cfg.noise.creature) heardAt = d;
  }
  const dC = hdist(world, s.cell, c.cell);
  if (sees) {
    if (!s.lastC || sim.t - s.lastC.t > 25) {
      addLandmark(world, s.k, { kind: 'seen', cell: c.cell, step: sim.t, note: 'Saw the creature' });
      emit(sim, { type: 'spotted', cell: c.cell, who: s.id });
    }
    s.lastC = { cell: c.cell, t: sim.t, seen: true };
  } else if (heardAt != null) {
    s.lastC = { cell: sim.creatureNoise, t: sim.t, seen: false };
  }

  if (s.human) return humanTick(sim, s, occupied);

  const danger = (sees && dC <= S.fleeSee) || (heardAt != null && heardAt <= S.fleeHear);
  if (danger && s.state !== 'flee' && s.state !== 'dash') {
    const wasHiding = s.state === 'hide';
    if (!(wasHiding && !sees)) { // hiding and only heard it: keep still
      chooseRefuge(sim, s);
      log(sim, `${s.name} ${sees ? 'sees' : 'hears'} the creature ${(dC * 0.5).toFixed(1)} m away and ${s.state === 'dash' ? 'runs for the door' : 'runs to hide'}.`, 'flee');
    }
  } else if (danger && sim.t - s.planT > 8) chooseRefuge(sim, s);

  if (s.pickT > 0) {
    s.pickT--;
    if (s.pickT === 0) finishPick(sim, s);
    return;
  }

  if (s.state === 'flee' && (!s.path.length || s.cell === s.refuge)) {
    s.state = 'hide'; s.crouch = true; s.running = false; s.hideT = sim.t + S.hideTicks; s.path = [];
    if (!nearLandmark(world, s.k, 'hide', s.cell, 3)) addLandmark(world, s.k, { kind: 'hide', cell: s.cell, step: sim.t, note: 'Hid here' });
  }
  if (s.state === 'hide') {
    if (sim.t >= s.hideT) { s.state = 'shop'; s.crouch = false; s.planT = -99; } else { s.facing = turnToward(world, s, s.lastC?.cell); survivorLook(sim, s); return; }
  }
  if (s.state === 'shop' || s.state === 'leave') {
    const need = s.list.filter((x) => !s.got.includes(x));
    if (s.state === 'shop' && (!need.length || sim.t - s.inT > S.patience)) {
      s.state = 'leave'; s.planT = -99;
      log(sim, need.length ? `${s.name} gives up and heads for the door with ${s.got.length}/${s.list.length} items.` : `${s.name} has everything and heads for the door.`, 'leave');
    }
    // take any needed item within reach
    if (s.state === 'shop') {
      const here = adjacentCat(world, s.k, s.cell, need);
      if (here) { s.pickT = cfg.survivor.pickTicks; s.picking = here; s.path = []; noiseAt(sim, s.cell, cfg.noise.pick, s); return; }
    }
    if (sim.t - s.planT > 14 || !s.path.length) planSurvivor(sim, s, need);
  }
  if ((s.state === 'leave' || s.state === 'dash') && world.type[s.cell] === T.DOOR && sim.t - s.inT > 10) {
    s.outcome = 'escaped'; s.outT = sim.t; occupied.delete(s.cell);
    log(sim, `${s.name} escapes into the snow with ${s.got.length}/${s.list.length} items (${((s.outT - s.inT) * cfg.tickSeconds).toFixed(0)} s).`, 'escape');
    emit(sim, { type: 'escape', cell: s.cell, who: s.id });
    s.cell = -1;
    return;
  }

  if (s.state === 'dash' && !s.path.length) { s.state = 'leave'; s.planT = -99; }
  const speed = s.state === 'flee' || s.state === 'dash' ? S.run : s.crouch ? S.sneak : S.walk;
  s.running = s.state === 'flee' || s.state === 'dash';
  moveAgent(sim, s, speed, occupied);
  survivorLook(sim, s);
}

function humanTick(sim, s, occupied) {
  const { world, cfg } = sim;
  const inp = sim.input;
  s.crouch = inp.crouch;
  s.running = inp.run && !inp.crouch;
  const need = s.list.filter((x) => !s.got.includes(x));
  if (s.pickT > 0) { s.pickT--; if (s.pickT === 0) finishPick(sim, s); return; }
  // the player sees the real store, so items within reach are taken off the true shelves
  const here = adjacentCat(world, { cat: world.cat }, s.cell, need);
  if (here && !inp.dx && !inp.dy) { s.pickT = cfg.survivor.pickTicks; s.picking = here; noiseAt(sim, s.cell, cfg.noise.pick, s); return; }
  if (world.type[s.cell] === T.DOOR && sim.t - s.inT > 15 && (inp.dy > 0 || !need.length)) {
    s.outcome = 'escaped'; s.outT = sim.t; occupied.delete(s.cell); s.cell = -1;
    log(sim, `You escape with ${s.got.length}/${s.list.length} items.`, 'escape');
    emit(sim, { type: 'escape', who: s.id });
    return;
  }
  if (inp.dx || inp.dy) {
    const x = cx(world, s.cell) + inp.dx; const y = cy(world, s.cell) + inp.dy;
    const n = y * world.W + x;
    const okCorner = !(inp.dx && inp.dy) || (world.walk[cy(world, s.cell) * world.W + x] && world.walk[y * world.W + cx(world, s.cell)]);
    if (x >= 0 && y >= 0 && x < world.W && y < world.H && world.walk[n] && okCorner && world.type[n] !== T.BACK) s.path = [n];
    else s.path = [];
  } else s.path = [];
  const speed = s.running ? cfg.survivor.run : s.crouch ? cfg.survivor.sneak : cfg.survivor.walk;
  moveAgent(sim, s, speed, occupied);
  survivorLook(sim, s);
}

function finishPick(sim, s) {
  const cat = s.picking;
  if (cat && !s.got.includes(cat)) {
    s.got.push(cat);
    log(sim, `${s.name} takes ${CAT_LABEL[cat].toLowerCase()} (${s.got.length}/${s.list.length}).`, 'item');
    emit(sim, { type: 'pick', cell: s.cell, who: s.id, cat });
  }
  s.picking = null; s.planT = -99;
}

function adjacentCat(world, k, cell, need) {
  const x = cx(world, cell); const y = cy(world, cell);
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const j = (y + dy) * world.W + (x + dx);
    const c = k.cat[j];
    if (c >= 0 && need.includes(CATS[c])) return CATS[c];
  }
  return null;
}

function turnToward(world, a, cell) {
  if (cell == null || cell < 0) return a.facing + 0.15;
  return Math.atan2(cy(world, cell) - cy(world, a.cell), cx(world, cell) - cx(world, a.cell));
}

// Step costs a survivor adds on its own map: floors it has noticed, and the area around where it last
// knew the creature to be.
function survivorCost(sim, s) {
  const { world, cfg } = sim;
  const lc = s.lastC && sim.t - s.lastC.t < 160 ? s.lastC : null;
  const lx = lc ? cx(world, lc.cell) : 0; const ly = lc ? cy(world, lc.cell) : 0;
  return (m) => {
    let c = 0;
    const z = s.k.zone[m];
    if (z === Z.WET) c += cfg.zones.wet.cost;
    else if (z === Z.NOISY) c += cfg.zones.noisy.cost;
    else if (z === Z.MAT) c += cfg.zones.mat.cost;
    if (lc) { const d = Math.hypot(cx(world, m) - lx, cy(world, m) - ly); if (d < 7) c += (7 - d) * 1.4; }
    return c;
  };
}

// Plan ahead: with the items it knows the places of, try every order of collecting them and then
// walking out, and take the shortest. With nothing known, explore the nearest frontier.
function planSurvivor(sim, s, need) {
  const { world } = sim;
  s.planT = sim.t;
  const cost = survivorCost(sim, s);
  const route = plan(world, s.k, s.cell, { cost });
  if (s.state === 'leave') {
    const door = world.doorCells.filter((d) => route.dist[d] < Infinity).sort((a, b) => route.dist[a] - route.dist[b])[0];
    s.order = ['door']; s.goal = door ?? world.entry;
    s.path = door != null ? pathTo(route, door).slice(1) : [];
    return;
  }
  const known = [];
  for (const catName of need) {
    const acc = knownAccess(world, s.k, CATS.indexOf(catName)).filter((i) => route.dist[i] < Infinity);
    if (acc.length) { acc.sort((a, b) => route.dist[a] - route.dist[b]); known.push({ cat: catName, cell: acc[0] }); }
  }
  if (known.length) {
    const doorD = (cell) => { let best = Infinity; for (const d of world.doorCells) best = Math.min(best, Math.hypot(cx(world, cell) - cx(world, d), cy(world, cell) - cy(world, d))); return best; };
    let best = null;
    const routes = known.length > 1 ? known.map((k) => plan(world, s.k, k.cell, { cost })) : null;
    for (const perm of permutations(known.map((_, i) => i))) {
      let total = route.dist[known[perm[0]].cell];
      for (let j = 1; j < perm.length; j++) total += routes[perm[j - 1]].dist[known[perm[j]].cell];
      // unknown items still on the list: count the walk out lightly, they may turn up on the way
      total += doorD(known[perm[perm.length - 1]].cell) * (known.length === need.length ? 1 : 0.3);
      if (!best || total < best.total) best = { total, perm };
    }
    s.order = best.perm.map((i) => known[i].cat).concat(known.length === need.length ? ['door'] : ['?']);
    s.goal = known[best.perm[0]].cell;
    s.path = pathTo(route, s.goal).slice(1);
    return;
  }
  // explore: nearest frontier, preferring what is ahead
  const fr = frontiers(world, s.k);
  let bestF = -1; let bestScore = Infinity;
  for (const f of fr) {
    const d = route.dist[f];
    if (d === Infinity) continue;
    const ang = Math.atan2(cy(world, f) - cy(world, s.cell), cx(world, f) - cx(world, s.cell));
    const score = d + 3 * (1 - Math.cos(wrapAngle(ang - s.facing)));
    if (score < bestScore) { bestScore = score; bestF = f; }
  }
  s.order = ['explore'];
  if (bestF >= 0) { s.goal = bestF; s.path = pathTo(route, bestF).slice(1); } else { s.state = 'leave'; s.planT = -99; }
}

function* permutations(a) {
  if (a.length <= 1) { yield a; return; }
  for (let i = 0; i < a.length; i++) for (const p of permutations([...a.slice(0, i), ...a.slice(i + 1)])) yield [a[i], ...p];
}

// A refuge: a cell it can reach well before the creature, ideally dark or out of the creature's
// sight at crouching height, never in a dead end it knows. Near the door with the list done: run out.
function chooseRefuge(sim, s) {
  const { world, cfg } = sim;
  s.planT = sim.t;
  const from = s.lastC ? s.lastC.cell : sim.creature.cell;
  const mine = plan(world, s.k, s.cell, {});
  const theirs = plan(world, s.k, from, { optimistic: true });
  const need = s.list.filter((x) => !s.got.includes(x));
  const doors = world.doorCells.filter((d) => mine.dist[d] < Infinity);
  for (const d of doors) {
    if ((!need.length || s.got.length >= 1) && mine.dist[d] < theirs.dist[d] - 3 && mine.dist[d] < 18) {
      s.state = 'dash'; s.refuge = d; s.path = pathTo(mine, d).slice(1); s.crouch = false; return;
    }
  }
  const cands = [];
  for (let i = 0; i < world.N; i++) {
    const d = mine.dist[i];
    if (d === Infinity || d > 22 || d < 2 || !world.walk[i] || world.type[i] !== T.FLOOR) continue;
    const td = theirs.dist[i] === Infinity ? 40 : theirs.dist[i];
    let sc = td - 1.25 * d;
    if (s.k.zone[i] === Z.DARK) sc += 5;
    if (nearLandmark(world, s.k, 'deadend', i, 1)) sc -= 6;
    cands.push({ i, sc });
  }
  cands.sort((a, b) => b.sc - a.sc);
  let best = null;
  for (const c of cands.slice(0, 36)) {
    const hidden = !segmentClear(world, point(world, from, cfg.eye.creature), point(world, c.i, cfg.head.crouch));
    const sc = c.sc + (hidden ? 7 : 0);
    if (!best || sc > best.sc) best = { i: c.i, sc };
  }
  s.state = 'flee'; s.crouch = false;
  s.refuge = best ? best.i : s.cell;
  s.path = best ? pathTo(mine, best.i).slice(1) : [];
}

// ---------------------------------------------------------------- movement and noise

function moveAgent(sim, a, speed, occupied) {
  const { world, cfg } = sim;
  if (!a.path.length) { a.prog = 0; return; }
  let f = 1;
  const z = world.zone[a.cell];
  if (z === Z.WET) f = cfg.zones.wet.speed;
  else if (z === Z.MAT) f = cfg.zones.mat.speed;
  a.prog += speed * f;
  let guard = 0;
  while (a.path.length && guard++ < 3) {
    const nx = a.path[0];
    const diag = cx(world, nx) !== cx(world, a.cell) && cy(world, nx) !== cy(world, a.cell);
    const c = diag ? Math.SQRT2 : 1;
    if (a.prog < c) break;
    if (a.kind === 'survivor' && occupied.has(nx) && nx !== a.cell) {
      a.blockedT = (a.blockedT || 0) + 1;
      if (a.blockedT > 6) { a.planT = -99; a.blockedT = 0; }
      a.prog = Math.min(a.prog, c);
      break;
    }
    a.blockedT = 0;
    a.prog -= c;
    a.path.shift();
    a.facing = Math.atan2(cy(world, nx) - cy(world, a.cell), cx(world, nx) - cx(world, a.cell));
    if (a.kind === 'survivor') { occupied.delete(a.cell); occupied.add(nx); }
    a.cell = nx;
    if (a.kind === 'survivor') {
      a.steps++; a.dist += c * 0.5; a.trail.push(nx);
      let lvl = a.running ? cfg.noise.run : a.crouch ? cfg.noise.sneak : cfg.noise.walk;
      const zz = world.zone[nx];
      if (zz === Z.NOISY) lvl += cfg.zones.noisy.noise;
      if (zz === Z.MAT) lvl = Math.max(0.1, lvl + cfg.zones.mat.noise * lvl);
      if (zz === Z.WET && sim.rng.chance(cfg.zones.wet.slip * (a.running ? 2 : 1))) {
        lvl = cfg.noise.slip; a.slipT = 6; a.path = [];
        log(sim, `${a.name} slips on the wet floor.`, 'slip');
        emit(sim, { type: 'slip', cell: nx, who: a.id });
      }
      noiseAt(sim, nx, lvl, a);
    } else {
      a.night.dist += c * 0.5;
    }
  }
}

function noiseAt(sim, cell, level, who) {
  sim.noise.push({ cell, level, who });
}

// ---------------------------------------------------------------- the creature

function creatureTick(sim) {
  const { world, cfg } = sim;
  const c = sim.creature;
  const C = cfg.creature;
  c.k.visits[c.cell]++;
  sim.creatureNoise = null;

  // look
  const res = look(world, c.k, c.cell, c.facing, { range: C.sight, coneDeg: C.coneDeg, eyeCells: cfg.eye.creature / 0.5, step: sim.t });
  recognise(world, c.k, res.fresh, sim.t);
  const live = sim.survivors.filter((s) => s.cell >= 0 && !s.outcome);
  c.sees = live.filter((s) => canSee(sim, c.cell, c.facing, cfg.eye.creature, s.cell, s.crouch ? cfg.head.crouch : cfg.head.stand, C.sight, C.coneDeg));
  for (const s of c.sees) s.seenTicks++;
  // listen
  c.hears = null;
  const range = C.hearing * (sim.cond ? sim.cond.hearingScale : 1);
  for (const n of sim.noise) {
    const d = acousticDistance(world, point(world, c.cell, cfg.eye.creature), point(world, n.cell, 0.6));
    const margin = range * n.level - d;
    if (margin >= 0 && (!c.hears || margin > c.hears.margin)) c.hears = { cell: n.cell, margin, d, who: n.who };
  }
  if (c.hears) {
    sim.heat.heard[c.hears.cell] += 1;
    bump(world, c.hunt, c.hears.cell, 1);
    if (!nearLandmark(world, c.k, 'heard', c.hears.cell, 3)) addLandmark(world, c.k, { kind: 'heard', cell: c.hears.cell, step: sim.t, note: 'Footsteps' });
    emit(sim, { type: 'heard', cell: c.hears.cell, who: c.hears.who?.id });
  }

  // decide
  if (c.feedT > 0) { c.feedT--; c.state = 'feed'; return; }
  if (c.state === 'enter') {
    c.state = 'explore';
    const into = DIRS8.map(([dx, dy]) => (cy(world, c.cell) + dy) * world.W + cx(world, c.cell) + dx).find((i) => i >= 0 && i < world.N && world.walk[i] && world.type[i] === T.FLOOR);
    if (into != null) c.path = [into];
  }
  if (c.sees.length) {
    const t = c.sees.reduce((a, b) => (hdist(world, c.cell, a.cell) <= hdist(world, c.cell, b.cell) ? a : b));
    if (c.state !== 'chase') { log(sim, `The creature sees ${t.name}.`, 'chase'); emit(sim, { type: 'chase', who: t.id }); }
    c.state = 'chase'; c.target = t.cell; c.lastSeen = { cell: t.cell, t: sim.t };
    routeTo(sim, c, t.cell, true);
  } else if (c.hears && (c.state !== 'chase' || sim.t - (c.lastSeen?.t ?? 0) > 6)) {
    const fresh = !c.lastHeard || hdist(world, c.lastHeard.cell, c.hears.cell) > 2 || sim.t - c.lastHeard.t > 12;
    c.lastHeard = { cell: c.hears.cell, t: sim.t };
    if (fresh || c.state !== 'investigate') { c.state = 'investigate'; c.target = c.hears.cell; routeTo(sim, c, c.hears.cell, true); }
  } else if (c.state === 'chase' && !c.sees.length) {
    c.state = 'investigate'; c.target = c.lastSeen.cell; routeTo(sim, c, c.target, true);
  }
  if ((c.state === 'investigate' || c.state === 'chase') && (!c.path.length || c.cell === c.target)) {
    c.state = 'search'; c.searchT = C.searchTicks; c.path = [];
  }
  if (c.state === 'search') {
    c.facing += 0.55;
    if (--c.searchT <= 0) {
      // plan ahead: sweep the hiding places and dead ends it remembers near here, nearest first
      const near = c.k.landmarks.filter((l) => (l.kind === 'hide' || l.kind === 'deadend') && hdist(world, l.cell, c.cell) <= 14);
      c.sweep = orderNearest(world, c.cell, near.map((l) => l.cell)).slice(0, 3);
      c.state = c.sweep.length ? 'sweep' : 'roam';
    } else { sim.creatureNoise = c.cell; return; }
  }
  if (c.state === 'sweep') {
    if (!c.path.length) {
      const nxt = c.sweep.shift();
      if (nxt == null) c.state = 'roam'; else routeTo(sim, c, nxt, false);
    }
  }
  if (c.state === 'explore' || c.state === 'roam' || c.state === 'patrol') {
    if (!c.path.length || sim.t - c.planT > 40) roam(sim, c);
  }

  const speed = { chase: C.chase, investigate: C.investigate, sweep: C.investigate, explore: C.explore, roam: C.explore, patrol: C.patrol }[c.state] ?? C.patrol;
  const before = c.cell;
  moveAgent(sim, c, speed, null);
  if (c.cell !== before) sim.creatureNoise = c.cell;

  // catch
  for (const s of live) {
    if (s.cell < 0 || s.outcome) continue;
    if (hdist(world, s.cell, c.cell) <= 1.5 && segmentClear(world, point(world, c.cell, 1.0), point(world, s.cell, 1.0))) {
      s.outcome = 'caught'; s.outT = sim.t;
      c.night.catches++; c.total.catches++;
      if (c.night.firstCatch == null) c.night.firstCatch = sim.t;
      sim.heat.caught.push(s.cell);
      bump(world, c.hunt, s.cell, 4);
      addLandmark(world, c.k, { kind: 'caught', cell: s.cell, step: sim.t, note: `Caught ${s.name}` });
      log(sim, `The creature catches ${s.name} at ${world.addr[s.cell]}.`, 'caught');
      emit(sim, { type: 'caught', cell: s.cell, who: s.id });
      s.cell = -1;
      c.feedT = C.feedTicks; c.state = 'feed'; c.path = [];
    }
  }
}

// a hunting ground: where it has heard or caught people, spread a little
function bump(world, hunt, cell, w) {
  const x = cx(world, cell); const y = cy(world, cell);
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const nx = x + dx; const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= world.W || ny >= world.H) continue;
    hunt[ny * world.W + nx] += w / (1 + dx * dx + dy * dy);
  }
}

function routeTo(sim, c, cell, optimistic) {
  const r = plan(sim.world, c.k, c.cell, { optimistic });
  c.path = pathTo(r, cell).slice(1);
  c.planT = sim.t;
  if (!c.path.length && cell !== c.cell) {
    // not on its map yet: head to the known cell nearest to it
    let best = -1; let bd = Infinity;
    for (let i = 0; i < sim.world.N; i++) if (r.dist[i] < Infinity) { const d = hdist(sim.world, i, cell); if (d < bd) { bd = d; best = i; } }
    if (best >= 0) c.path = pathTo(r, best).slice(1);
  }
}

function orderNearest(world, from, cells) {
  const out = []; let cur = from; const left = cells.slice();
  while (left.length) {
    let bi = 0;
    for (let i = 1; i < left.length; i++) if (hdist(world, cur, left[i]) < hdist(world, cur, left[bi])) bi = i;
    cur = left.splice(bi, 1)[0]; out.push(cur);
  }
  return out;
}

// Without a lead: explore the nearest frontier like a robot vacuum; once the store is mapped, patrol
// its hunting grounds (the strongest places it has heard or caught survivors), planned as one route.
function roam(sim, c) {
  const { world } = sim;
  c.planT = sim.t;
  const r = plan(world, c.k, c.cell, {});
  const fr = frontiers(world, c.k);
  const hot = [];
  for (let i = 0; i < world.N; i++) if (c.hunt[i] > 2.2 && c.k.known[i] === 0) hot.push(i);
  // with strong hunting grounds it prefers them to finishing the map
  if (fr.length && (hot.length < 3 || sim.rng.chance(0.4))) {
    let best = -1; let bs = Infinity;
    for (const f of fr) {
      const d = r.dist[f]; if (d === Infinity) continue;
      const ang = Math.atan2(cy(world, f) - cy(world, c.cell), cx(world, f) - cx(world, c.cell));
      const s = d + 4 * (1 - Math.cos(wrapAngle(ang - c.facing)));
      if (s < bs) { bs = s; best = f; }
    }
    if (best >= 0) { c.state = 'explore'; c.path = pathTo(r, best).slice(1); return; }
  }
  if (hot.length) {
    // the three strongest, spread apart, visited in the nearest-first order
    hot.sort((a, b) => c.hunt[b] - c.hunt[a]);
    const picks = [];
    for (const h of hot) { if (picks.every((p) => hdist(world, p, h) > 6)) picks.push(h); if (picks.length === 3) break; }
    const targets = orderNearest(world, c.cell, picks.filter((p) => hdist(world, p, c.cell) > 3));
    for (const p of targets) {
      if (!nearLandmark(world, c.k, 'hunt', p, 4)) addLandmark(world, c.k, { kind: 'hunt', cell: p, step: sim.t, note: 'Hunting ground' });
    }
    if (targets.length) { c.state = 'patrol'; c.sweep = targets.slice(1); c.path = pathTo(r, targets[0]).slice(1); if (c.path.length) { c.state = 'sweep'; return; } }
  }
  // wander to a far known cell
  const known = [];
  for (let i = 0; i < world.N; i++) if (r.dist[i] < Infinity && r.dist[i] > 8) known.push(i);
  c.state = 'roam';
  if (known.length) c.path = pathTo(r, sim.rng.pick(known)).slice(1);
}

// ---------------------------------------------------------------- headless runs

export function runNights(sim, n, maxTicks = 1e6) {
  const target = sim.nights.length + n;
  let guard = 0;
  while (sim.nights.length < target && guard++ < maxTicks) step(sim);
  return sim.nights.slice(-n);
}

// Distances between two cells, for the inspector
export function distances(sim, a, b) {
  const w = sim.world;
  const all = { known: new Int8Array(w.N).fill(0), zone: w.zone };
  const r = plan(w, all, a, {});
  const rc = plan(w, all, a, { cost: (m) => { const z = w.zone[m]; return z === Z.WET ? 1 / w.cfg.zones.wet.speed - 1 : z === Z.MAT ? -0.07 : 0; } });
  return {
    euclid: hdist(w, a, b) * 0.5,
    path: r.dist[b] === Infinity ? null : r.dist[b] * 0.5,
    acoustic: acousticDistance(w, point(w, a, 1.6), point(w, b, 1.6)) * 0.5,
    effort: rc.dist[b] === Infinity ? null : (rc.dist[b] / w.cfg.survivor.walk) * w.cfg.tickSeconds,
  };
}
