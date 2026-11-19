// The simulation: a week of nights and days in Morningside Heights and West Harlem.
//
// Rats live in colonies, in burrows dug in soil or under sidewalk sheds. At night they forage:
// they smell food along the open air, run along walls, keep out of light and away from people, and
// remember where and when they found food. Inspectors work the day: they answer 311 complaints,
// look for signs (droppings, rub marks, gnawing), follow the trail to the burrow, bait it and seal it.
// The city sets out food every night (trash bags, restaurant waste, litter baskets) on its own
// schedule; the design (src/sim/design.js) changes that schedule, the bins, the lights, the sheds.

import { makeRng } from './rng.js';
import { DIRS8, S, nearestWhere, splatLight, short } from './city.js';
import { makePlanner } from './path.js';
import { isBinned } from './design.js';

const DAY = 1440;
export const RAT_MODES = { home: 'In the burrow', forage: 'Foraging', eat: 'Eating', return: 'Heading home', flee: 'Fleeing', dead: 'Dead' };
export const INSPECTOR_MODES = { off: 'Off duty', travel: 'Walking to an address', inspect: 'Inspecting', track: 'Following a trail', treat: 'Baiting a burrow', done: 'Shift over' };

const planners = new Map();
const plannerFor = (city) => { const key = `${city.W}x${city.H}`; if (!planners.has(key)) planners.set(key, makePlanner(city.W, city.H)); return planners.get(key); };

// ---- time --------------------------------------------------------------------------------------
export const minuteOfDay = (sim) => (sim.cfg.startHour * 60 + sim.t) % DAY;
export const dayOf = (sim) => Math.floor((sim.cfg.startHour * 60 + sim.t) / DAY);
export const hourOf = (sim) => minuteOfDay(sim) / 60;
export function clock(sim) {
  const m = minuteOfDay(sim);
  const h = Math.floor(m / 60); const mm = String(Math.floor(m % 60)).padStart(2, '0');
  const ap = h < 12 ? 'am' : 'pm'; const h12 = h % 12 || 12;
  return `Day ${dayOf(sim) + 1}, ${h12}:${mm} ${ap}`;
}
const isNight = (cfg, h) => h >= cfg.rat.activeFrom || h < cfg.rat.activeTo;

// ---- setup -------------------------------------------------------------------------------------
export function newSim(city, design, { seed = city.config.seed, config = city.config } = {}) {
  const cfg = config;
  const rng = makeRng(seed);
  const { N, W } = city;
  const sim = {
    city, cfg, design, rng, seed, W, t: 0, steps: 0,
    planner: plannerFor(city),
    signs: new Float32Array(N),        // droppings, rub marks, gnawing: what inspectors look for
    activity: new Float32Array(N),     // rat-minutes per cell, all week (for the maps)
    tonight: new Float32Array(N),      // rat-minutes per cell, this night
    foodAt: new Float32Array(N),       // food within reach of rats, per cell
    blocked: new Uint8Array(N),        // cells rats will not enter (fresh bait stations, for a while)
    rats: [], colonies: [], inspectors: [], stations: [], complaints: [], events: [],
    daily: [], today: blankDay(0),
    totals: { eaten: 0, sightings: 0, complaints: 0, inspections: 0, failed: 0, burrowsTreated: 0, deaths: { bait: 0, starve: 0, treat: 0 }, births: 0 },
    nextId: 1,
    inspectedAt: new Map(),
  };
  applyDesign(sim);
  makeSources(sim);
  seedColonies(sim);
  makeInspectors(sim);
  seedComplaints(sim);
  log(sim, 'world', `${sim.rats.length} rats in ${sim.colonies.length} colonies, placed where the real inspections found rat activity.`);
  return sim;
}

function blankDay(day) { return { day, eaten: 0, sightings: 0, inspections: 0, failed: 0, treated: 0, deathsBait: 0, deathsStarve: 0, deathsTreat: 0, births: 0, rats: 0, fedShare: 0, foodOut: 0 }; }

export function log(sim, who, text, cell = null) {
  sim.eventSeq = (sim.eventSeq ?? 0) + 1;
  sim.events.push({ seq: sim.eventSeq, t: sim.t, who, text, cell });
  if (sim.events.length > 400) sim.events.splice(0, sim.events.length - 400);
}

// the design on top of the city: lights, sealed soil, sheds, bait stations
function applyDesign(sim) {
  const { city, design: d, cfg } = sim;
  const { N, W, H, walk } = city;
  sim.light = Float32Array.from(city.light);
  splatLight(W, H, d.lights, cfg.lampReach, sim.light, walk);
  sim.soil = Uint8Array.from(city.soil);
  for (const c of d.guards) {
    const x = c % W; const y = (c - x) / W;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const j = (y + dy) * W + x + dx; if (j >= 0 && j < N) sim.soil[j] = 0; }
  }
  // sheds: cover (old), see-through (light), or none
  sim.shedAt = new Int16Array(N).fill(-1);
  sim.shedType = new Uint8Array(N);   // 0 none, 1 old, 2 light
  sim.sheds = (d.shedSet === '2023' ? city.sheds2023 : city.sheds).map((s, k) => ({ ...s, k, type: d.sheds[s.id] ?? 'old' }));
  for (const s of sim.sheds) {
    if (s.type === 'gone') continue;
    for (const c of s.cells) {
      sim.shedAt[c] = s.k;
      sim.shedType[c] = s.type === 'old' ? 1 : 2;
      if (s.type === 'old') sim.light[c] *= 0.35;        // dark under plywood
      if (s.type === 'old') sim.soil[c] = 1;             // debris and voids under the deck: harbourage
    }
  }
  sim.stations = d.stations.filter((c) => walk[c]).map((c) => ({ cell: c, t: -cfg.rat.neophobiaDays * DAY, by: 'design' }));
  // hourly people, from the real station counts (weekday)
  const prof = city.place.ridership?.weekday ?? Array(24).fill(1);
  const mx = Math.max(...prof);
  sim.peopleHour = prof.map((v) => v / mx);
}

// ---- food ------------------------------------------------------------------------------------------
function makeSources(sim) {
  const { city, design: d, cfg } = sim;
  const F = cfg.food;
  const rng = makeRng(sim.seed ^ 0xf00d);
  const faceTime = new Map();
  const pick = (a, b) => Math.round((a + rng.next() * (b - a)) * 60);
  sim.sources = city.sources.map((s) => {
    const binned = s.kind === 'basket' ? false : isBinned(city, d, s);
    let out; let pickup; let access;
    if (s.kind === 'home') {
      if (!faceTime.has(s.face)) faceTime.set(s.face, d.pickup === 'night' ? pick(...cfg.pickup.night) : pick(...cfg.pickup.morning));
      out = (binned ? Math.min(d.setOut, cfg.binSetOutHour) : d.setOut) * 60;
      pickup = faceTime.get(s.face);
      access = binned ? F.binnedShare : F.bagAccess;
    } else if (s.kind === 'restaurant' || s.kind === 'grocery') {
      out = (s.kind === 'restaurant' ? cfg.restaurantOutHour : 21) * 60 + rng.int(0, 50);
      pickup = pick(...cfg.restaurantPickup);
      access = binned ? F.binnedShare : F.bagAccess * 1.5;
    } else if (s.kind === 'basket') {
      out = 17 * 60; pickup = 7 * 60 + rng.int(0, 120);
      access = s.better ? F.betterBin : 1;
    } else {   // campus, shop: loading docks, carted at night
      out = 21 * 60 + rng.int(0, 60); pickup = pick(3, 6);
      access = binned ? F.binnedShare : F.bagAccess * 0.6;
    }
    return { ...s, binned, out, pickup, access, amt: 0, store: 0, isOut: false, eaten: 0 };
  });
  sim.sourceAt = new Map();
  for (const s of sim.sources) { if (!sim.sourceAt.has(s.cell)) sim.sourceAt.set(s.cell, []); sim.sourceAt.get(s.cell).push(s); }
}

function setFood(sim, s, amt) {
  if (amt < 0.05) amt = 0;
  sim.foodAt[s.cell] += amt - s.amt;
  if (sim.foodAt[s.cell] < 1e-4) sim.foodAt[s.cell] = 0;
  s.amt = amt;
}

// Bags go out at their hour; each hour some of what is still bagged is torn open or spilt and comes
// within reach (so bags set out at 4 pm have lost more by night than bags set out at 8 pm). The truck
// takes the rest, leaving a little spill.
function foodSchedule(sim, m) {
  const F = sim.cfg.food;
  for (const s of sim.sources) {
    if (m === s.out) { s.store = s.amount; s.isOut = true; }
    else if (m === s.pickup && s.isOut) {
      s.isOut = false; s.store = 0;
      setFood(sim, s, s.kind === 'basket' ? 0 : Math.min(s.amt, s.amount * s.access * F.spill));
    }
    if (s.isOut && m % 60 === s.out % 60 && s.store > 0) {
      const torn = s.kind === 'basket' ? s.store : s.store * F.tearPerHour * (s.binned ? 1 : 1);
      s.store -= torn;
      const put = torn * s.access * (s.kind === 'basket' ? 1 : 3.5);
      setFood(sim, s, s.amt + put);
      sim.today.foodOut += put;
    }
  }
}

// ---- rats ----------------------------------------------------------------------------------------
function suitable(sim, i) {
  const { city } = sim;
  return city.walk[i] && !city.road[i] && (sim.soil[i] || sim.shedType[i] === 1) && sim.light[i] < 0.6;
}

function seedColonies(sim) {
  const { city, cfg, rng } = sim;
  const { W, N } = city;
  // weight: the real rat reports nearby (inspections that found rats, 311), times a place to dig
  const cand = []; let total = 0;
  for (let i = 0; i < N; i++) {
    if (!suitable(sim, i)) continue;
    const w = 0.02 + city.real.map[i] ** 1.5;
    cand.push([i, w]); total += w;
  }
  const homes = [];
  for (let tries = 0; homes.length < cfg.rat.colonies && tries < 4000; tries++) {
    let r = rng.next() * total; let c = cand[0][0];
    for (const [i, w] of cand) { r -= w; if (r <= 0) { c = i; break; } }
    if (homes.some((h) => Math.hypot((h % W) - (c % W), Math.floor(h / W) - Math.floor(c / W)) < 10)) continue;
    homes.push(c);
  }
  for (const home of homes) {
    const col = { id: sim.colonies.length, home, burrows: [home], surplus: 0, alive: true, treated: 0, name: placeName(city, home), founded: 0 };
    sim.colonies.push(col);
    const n = rng.int(...cfg.rat.startPerColony) + Math.round(city.real.map[home] * 4);
    for (let k = 0; k < n; k++) addRat(sim, col);
  }
}

export function placeName(city, cell) {
  const s = city.street[cell] >= 0 ? short(city.names[city.street[cell]]) : null;
  const c = city.cross[cell] >= 0 ? short(city.names[city.cross[cell]]) : null;
  if (s && c) return `${s} near ${c}`;
  if (s) return s;
  return city.surface[cell] === S.LAWN ? 'a lawn' : 'a back yard';
}

function addRat(sim, col) {
  if (sim.rats.filter((r) => r.alive).length >= sim.cfg.rat.maxRats) return null;
  const rat = {
    id: sim.nextId++, kind: 'rat', colony: col.id, cell: col.home, home: col.home, mode: 'home', alive: true,
    path: null, pi: 0, target: -1, targetKind: null, fed: 0, hungry: 0, eatLeft: 0, poisonedAt: -1, deathAt: -1,
    facing: 0, distance: 0, trail: [], born: sim.t,
    known: new Uint8Array(sim.city.N), knownCount: 0, memFood: [], memDanger: [], poisonCause: null,
  };
  sim.rats.push(rat);
  return rat;
}

// what a rat pays to cross a cell: light, people, open ground, roadways; cover under old sheds
function ratCost(sim, rat, hourPeople) {
  const { city, cfg } = sim; const R = cfg.rat; const known = rat.known;
  return (i) => {
    let c = R.lightShy * sim.light[i] + R.peopleShy * city.people[i] * hourPeople;
    if (!city.wall[i]) c += R.openShy;
    if (city.road[i]) c += R.streetCross;
    if (sim.shedType[i] === 1) c -= R.coverBonus;
    if (!known[i]) c += 0.6;            // unknown ground: a little risk
    return c < 0 ? 0 : c;
  };
}

function ratStep(sim, rat, m, h) {
  const { city, cfg } = sim; const R = cfg.rat;
  if (!rat.alive) return;
  if (rat.deathAt >= 0 && sim.t >= rat.deathAt) { killRat(sim, rat, rat.poisonCause ?? 'bait'); return; }
  const night = isNight(cfg, h);

  if (rat.mode === 'home') {
    if (night && rat.fed < R.need && sim.t >= (rat.restUntil ?? 0) && !(h >= R.activeTo - 0.5 && h < 12)) {
      rat.mode = 'forage'; rat.path = null;
    } else return;
  }
  if (rat.mode === 'eat') {
    if (--rat.eatLeft > 0) return;
    rat.mode = rat.fed >= R.need ? 'return' : 'forage';
    rat.path = null;
  }
  // dawn: go home
  if (!night && rat.mode !== 'return') { rat.mode = 'return'; rat.path = null; }

  // pick a destination
  if (!rat.path) {
    if (rat.mode === 'return') {
      rat.path = sim.planner.search(rat.cell, { open: (i) => city.walk[i] && !sim.blocked[i], cost: ratCost(sim, rat, sim.peopleHour[Math.floor(h)]), target: rat.home, maxCost: 300 });
      if (!rat.path) { rat.cell = rat.home; rat.mode = 'home'; return; }
      rat.pi = 0; rat.target = rat.home; rat.targetKind = 'home';
    } else {
      chooseForage(sim, rat, h);
      if (!rat.path) { rat.mode = 'return'; rat.restUntil = sim.t + 25; return; }
    }
  }

  // move along the path
  for (let s = 0; s < R.speed && rat.path; s++) {
    if (rat.pi >= rat.path.length - 1) { arrive(sim, rat, m, h); break; }
    const next = rat.path[rat.pi + 1];
    if (sim.blocked[next] && next !== rat.target) { rat.path = null; break; }
    const x0 = rat.cell % sim.W; const y0 = (rat.cell - x0) / sim.W;
    rat.facing = Math.atan2(Math.floor(next / sim.W) - y0, (next % sim.W) - x0);
    rat.cell = next; rat.pi++; rat.distance++;
    rat.trail.push(next); if (rat.trail.length > 240) rat.trail.shift();
    sense(sim, rat);
    // bait stations it passes: a hungry rat may take the bait, once the station is no longer new
    for (const st of sim.stations) {
      if (Math.abs((st.cell % sim.W) - (next % sim.W)) <= 1 && Math.abs(Math.floor(st.cell / sim.W) - Math.floor(next / sim.W)) <= 1) {
        const age = (sim.t - st.t) / DAY;
        if (age >= R.neophobiaDays && rat.deathAt < 0 && rat.fed < R.need && sim.rng.chance(R.baitTake)) {
          rat.deathAt = sim.t + sim.rng.int(...R.baitDaysToDie) * DAY;
          rat.poisonedAt = sim.t; rat.poisonCause = 'bait';
        }
      }
    }
  }
  // leave signs, and be seen where it is lit and busy
  const i = rat.cell;
  sim.signs[i] += 1; sim.activity[i] += 1; sim.tonight[i] += 1;
  const busy = city.people[i] * sim.peopleHour[Math.floor(h)];
  if (sim.light[i] > 0.4 && busy > 0.15 && sim.rng.chance(cfg.sightingChance * (1 + 4 * busy))) {
    sim.today.sightings++; sim.totals.sightings++;
    if (sim.rng.chance(cfg.callChance)) { sim.complaints.push({ cell: i, day: dayOf(sim), t: sim.t, src: 'sim', name: placeName(city, i) }); sim.totals.complaints++; }
    rat.memDanger.push({ cell: i, t: sim.t });
  }
}

// what it learns as it runs: the cells around it, and food it sees
function sense(sim, rat) {
  const { W, H } = sim.city;
  const x0 = rat.cell % W; const y0 = (rat.cell - x0) / W;
  const r = 2;
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const x = x0 + dx; const y = y0 + dy;
    if (x >= 0 && y >= 0 && x < W && y < H && !rat.known[y * W + x]) { rat.known[y * W + x] = 1; rat.knownCount++; }
  }
}

// memory first (where it found food before, at this hour), then smell, then explore
function chooseForage(sim, rat, h) {
  const { city, cfg } = sim; const R = cfg.rat;
  const W = sim.W;
  const hx = rat.home % W; const hy = (rat.home - hx) / W;
  const inRange = (c) => Math.hypot((c % W) - hx, Math.floor(c / W) - hy) <= R.homeRange;
  const cost = ratCost(sim, rat, sim.peopleHour[Math.floor(h)]);
  const open = (i) => city.walk[i] && !sim.blocked[i];
  let target = -1; let kind = null;

  // smell: food within reach of its nose, along the open air
  const reached = sim.planner.flood(rat.cell, { open, maxCost: R.smell });
  let best = 0;
  for (let k = 0; k < reached.length; k += 2) {
    const c = reached[k]; const f = sim.foodAt[c];
    if (f < 0.05 || c === rat.lastMiss) continue;
    const v = Math.min(f, 3) / (1 + reached[k + 1] / 5);
    if (v > best) { best = v; target = c; kind = 'smell'; }
  }
  // memory: the best place it found food before, if it is the right time of night
  if (target < 0 || best < 0.15) {
    const hourNow = h < 12 ? h + 24 : h;
    let bm = 0;
    for (const f of rat.memFood) {
      const fh = f.hour < 12 ? f.hour + 24 : f.hour;
      if (hourNow + 0.5 < fh) continue;                 // too early: it was not out yet
      if (f.cell === rat.cell || f.cell === rat.lastMiss) continue;
      const v = f.got / (1 + 2 * f.misses);
      if (v < 0.15) continue;
      if (v > bm) { bm = v; target = f.cell; kind = 'memory'; }
    }
  }
  // explore: somewhere it has not been, inside its range
  if (target < 0) {
    for (let tries = 0; tries < 12 && target < 0; tries++) {
      const a = sim.rng.next() * Math.PI * 2; const d = 4 + sim.rng.next() * R.homeRange;
      const x = Math.round(hx + Math.cos(a) * d); const y = Math.round(hy + Math.sin(a) * d);
      if (x < 0 || y < 0 || x >= W || y >= sim.city.H) continue;
      const c = nearestWhere(W, sim.city.H, y * W + x, 3, (j) => city.walk[j] && !rat.known[j]);
      if (c != null && inRange(c)) { target = c; kind = 'explore'; }
    }
  }
  if (target < 0) { rat.path = null; return; }
  rat.path = sim.planner.search(rat.cell, { open, cost, target, maxCost: 160 });
  rat.pi = 0; rat.target = target; rat.targetKind = kind;
}

function arrive(sim, rat, m, h) {
  const R = sim.cfg.rat;
  rat.path = null;
  if (rat.targetKind === 'home') { rat.mode = 'home'; rat.cell = rat.home; return; }
  const list = sim.sourceAt.get(rat.cell);
  const mem = rat.memFood.find((f) => f.cell === rat.cell);
  let got = 0;
  if (list) {
    for (const s of list) {
      if (s.amt < 0.05 || got >= R.carry) continue;
      const take = Math.min(s.amt, R.carry - got, R.need * 1.5 - rat.fed);
      if (take <= 0) continue;
      setFood(sim, s, s.amt - take);
      s.eaten += take; got += take;
    }
  }
  if (got > 0) {
    rat.fed += got; sim.today.eaten += got; sim.totals.eaten += got;
    if (mem) { mem.got = (mem.got + got) / 2 + 0.3; mem.misses = 0; mem.hour = Math.min(mem.hour, h); }
    else {
      rat.memFood.push({ cell: rat.cell, got, misses: 0, hour: h, found: sim.t });
      if (rat.memFood.length > 8) rat.memFood.sort((a, b) => b.got - a.got).pop();
    }
    rat.mode = 'eat'; rat.eatLeft = R.eatTicks;
  } else {
    rat.lastMiss = rat.cell;
    if (mem) mem.misses++;
    rat.mode = rat.fed >= R.need ? 'return' : 'forage';
  }
}

function killRat(sim, rat, cause) {
  rat.alive = false; rat.mode = 'dead'; rat.path = null;
  sim.totals.deaths[cause]++;
  if (cause === 'bait') sim.today.deathsBait++;
  else if (cause === 'starve') sim.today.deathsStarve++;
  else sim.today.deathsTreat++;
}

// at dawn: who ate enough, who starves, who is born; signs fade
function dawn(sim) {
  const { cfg } = sim; const R = cfg.rat;
  const alive = sim.rats.filter((r) => r.alive);
  let fedCount = 0;
  for (const r of alive) {
    if (r.fed >= R.need * 0.66) { r.hungry = 0; fedCount++; sim.colonies[r.colony].surplus += R.litter * Math.min(1.5, r.fed / R.need); } else if (r.fed < R.need / 3) r.hungry++;
    if (r.hungry >= R.starveNights) killRat(sim, r, 'starve');
    r.fed = 0;
    r.cell = r.home; r.mode = 'home'; r.path = null;
  }
  for (const col of sim.colonies) {
    const members = sim.rats.filter((r) => r.alive && r.colony === col.id);
    col.alive = members.length > 0;
    while (col.alive && col.surplus >= 1 && members.length < R.colonyMax) {
      col.surplus -= 1;
      const baby = addRat(sim, col);
      if (!baby) break;
      members.push(baby); sim.today.births++; sim.totals.births++;
    }
    if (!col.alive) col.surplus = 0;
  }
  for (let i = 0; i < sim.signs.length; i++) sim.signs[i] *= cfg.signDecay;
  sim.today.fedShare = alive.length ? fedCount / alive.length : 0;
}

// ---- inspectors ----------------------------------------------------------------------------------
function makeInspectors(sim) {
  const { city, design: d } = sim;
  const start = city.subways.length ? city.subways[0].cell : city.nodes[0];
  for (let k = 0; k < d.inspectors; k++) {
    const known = new Uint8Array(city.N);
    // they know the public map: streets and sidewalks; yards, lawns and courtyards they must see
    for (let i = 0; i < city.N; i++) if (city.walk[i] && (city.surface[i] === S.AVENUE || city.surface[i] === S.STREET || city.surface[i] === S.PATH || city.surface[i] === S.PLAZA)) known[i] = 1;
    sim.inspectors.push({
      id: sim.nextId++, kind: 'inspector', name: `Inspector ${String.fromCharCode(65 + k)}`, cell: city.subways[k % Math.max(1, city.subways.length)]?.cell ?? start,
      start: city.subways[k % Math.max(1, city.subways.length)]?.cell ?? start,
      mode: 'off', path: null, pi: 0, job: null, busy: 0, trailLeft: 0, facing: 0,
      known, evidence: [], hotspots: [], distance: 0, trail: [],
      stats: { inspections: 0, failed: 0, passed: 0, burrows: 0, killed: 0, stations: 0, walkedM: 0 },
      stationsToday: 0,
    });
  }
}

// the first work orders are the real 311 rodent complaints of the two weeks before the run
function seedComplaints(sim) {
  const recent = sim.city.real.pts.filter((p) => p.kind === '311' && p.t >= '2026-11-04').slice(0, 30);
  for (const p of recent) sim.complaints.push({ cell: p.cell, day: -1, t: -1, src: 'real', name: placeName(sim.city, p.cell), d: p.d });
}

function startShift(sim) {
  const today = dayOf(sim);
  const cfg = sim.cfg.inspector;
  // the list: complaints from before today, then compliance visits at addresses that failed
  const jobs = sim.complaints.filter((c) => !c.done && c.day < today).map((c) => ({ ...c, ref: c, why: c.src === 'real' ? `311: ${c.d ?? 'Rat Sighting'} (real)` : '311: Rat Sighting' }));
  for (const ins of sim.inspectors) for (const hsp of ins.hotspots) if (!hsp.revisited && today - hsp.day >= cfg.compliance) { jobs.push({ cell: hsp.cell, why: 'Compliance visit', hotspot: hsp }); hsp.revisited = true; }
  // share them out: each inspector takes the nearest open job next (plans a route ahead)
  for (const ins of sim.inspectors) { ins.queue = []; ins.mode = 'travel'; ins.cell = ins.start; ins.path = null; ins.stationsToday = 0; }
  const pos = sim.inspectors.map((i) => i.cell);
  const W = sim.W;
  const left = [...jobs];
  let k = 0;
  while (left.length && k < 400) {
    const n = k % sim.inspectors.length; k++;
    const p = pos[n];
    let bi = 0; let bd = Infinity;
    left.forEach((j, idx) => { const d = Math.hypot((j.cell % W) - (p % W), Math.floor(j.cell / W) - Math.floor(p / W)); if (d < bd) { bd = d; bi = idx; } });
    const job = left.splice(bi, 1)[0];
    sim.inspectors[n].queue.push(job); pos[n] = job.cell;
  }
  for (const ins of sim.inspectors) if (!ins.queue.length) ins.mode = 'done';
}

function inspectorStep(sim, ins, m, h) {
  const { city, cfg } = sim; const C = cfg.inspector;
  if (h < C.shift[0] || h >= C.shift[1]) { if (ins.mode !== 'off') { ins.mode = 'off'; ins.path = null; ins.cell = ins.start; } return; }
  if (ins.mode === 'off') { ins.mode = 'done'; return; }
  if (ins.mode === 'done') return;
  if (ins.busy > 0) {
    ins.busy--;
    if (ins.busy === 0) { if (ins.mode === 'inspect') finishInspection(sim, ins); else { ins.mode = 'travel'; ins.path = null; } }
    return;
  }
  if (!ins.path) {
    if (ins.mode === 'track') { trackStep(sim, ins); return; }
    ins.job = ins.queue.shift() ?? (C.indexing ? indexJob(sim, ins) : null);
    if (!ins.job) { ins.mode = 'done'; return; }
    if (ins.job.cell != null) sim.inspectedAt.set(ins.job.cell, dayOf(sim));
    ins.mode = 'travel';
    ins.path = sim.planner.search(ins.cell, { open: (i) => city.walk[i], cost: (i) => (ins.known[i] ? 0 : 0.3) + (city.road[i] ? 0.2 : 0), target: ins.job.cell, maxCost: 900 });
    ins.pi = 0;
    if (!ins.path) { ins.job = null; return; }
  }
  for (let s = 0; s < C.speed && ins.path; s++) {
    if (ins.pi >= ins.path.length - 1) {
      ins.path = null;
      if (ins.mode === 'travel') { ins.mode = 'inspect'; ins.busy = C.inspectMin; look(sim, ins); }
      else if (ins.mode === 'track') trackStep(sim, ins);
      break;
    }
    const next = ins.path[ins.pi + 1];
    ins.facing = Math.atan2(Math.floor(next / sim.W) - Math.floor(ins.cell / sim.W), (next % sim.W) - (ins.cell % sim.W));
    ins.cell = next; ins.pi++; ins.distance++; ins.stats.walkedM += city.cellM;
    ins.trail.push(next); if (ins.trail.length > 400) ins.trail.shift();
    ins.known[next] = 1;
  }
}

// with no complaints left: index the block, property by property, around the addresses that failed
// (or, at first, where the real inspections found rats: the city's Rat Mitigation Zone practice)
function indexJob(sim, ins) {
  const { city } = sim; const W = sim.W;
  const today = dayOf(sim);
  const hot = sim.inspectors.flatMap((i) => i.hotspots).map((h) => h.cell);
  const near = (c, list, r) => list.some((h) => Math.abs((h % W) - (c % W)) <= r && Math.abs(Math.floor(h / W) - Math.floor(c / W)) <= r);
  let best = null; let bd = Infinity;
  for (const s of sim.sources) {
    if (s.kind !== 'home') continue;
    const last = sim.inspectedAt.get(s.cell);
    if (last != null && today - last < 14) continue;
    if (hot.length ? !near(s.cell, hot, 14) : city.real.map[s.cell] < 0.35) continue;
    const d = Math.hypot((s.cell % W) - (ins.cell % W), Math.floor(s.cell / W) - Math.floor(ins.cell / W));
    if (d < bd) { bd = d; best = s; }
  }
  return best ? { cell: best.cell, why: 'Indexing the block' } : null;
}

// what an inspector sees around them: cells in line of sight within range, and the signs on them
function look(sim, ins) {
  const { city, cfg } = sim; const C = cfg.inspector;
  const W = sim.W; const H = city.H;
  const x0 = ins.cell % W; const y0 = (ins.cell - x0) / W;
  const seen = [];
  for (let a = 0; a < 48; a++) {
    const ang = (a / 48) * Math.PI * 2; const ca = Math.cos(ang); const sa = Math.sin(ang);
    for (let t = 0.5; t <= C.sight; t += 0.5) {
      const x = Math.floor(x0 + 0.5 + ca * t); const y = Math.floor(y0 + 0.5 + sa * t);
      if (x < 0 || y < 0 || x >= W || y >= H) break;
      const i = y * W + x;
      ins.known[i] = 1;
      if (!city.walk[i]) break;
      seen.push(i);
    }
  }
  ins.lastSeen = [...new Set(seen)];
  return ins.lastSeen;
}

const visibleSign = (sim, i) => sim.signs[i] * (sim.shedType[i] === 1 ? 1 - sim.cfg.inspector.shedHides : 1);

function finishInspection(sim, ins) {
  const C = sim.cfg.inspector;
  // the property: the cells it can see within a few cells of the address
  const W = sim.W; const ax = ins.cell % W; const ay = (ins.cell - ax) / W;
  const seen = (ins.lastSeen ?? look(sim, ins)).filter((i) => Math.abs((i % W) - ax) <= C.lookAt && Math.abs(Math.floor(i / W) - ay) <= C.lookAt);
  let best = -1; let bv = 0;
  for (const i of seen) { const v = visibleSign(sim, i); if (v > bv) { bv = v; best = i; } }
  ins.stats.inspections++; sim.today.inspections++; sim.totals.inspections++;
  if (ins.job?.ref) ins.job.ref.done = true;
  const where = placeName(sim.city, ins.cell);
  if (bv >= C.signSeen) {
    ins.stats.failed++; sim.today.failed++; sim.totals.failed++;
    ins.hotspots.push({ cell: best, day: dayOf(sim), level: Math.round(bv), name: where });
    ins.evidence.push({ cell: best, t: sim.t, level: bv });
    if (ins.evidence.length > 30) ins.evidence.shift();
    log(sim, 'inspector', `${ins.name} failed ${where} for rat activity (${ins.job?.why ?? 'patrol'}). Following the trail.`, best);
    ins.mode = 'track'; ins.trailLeft = C.trailSteps; ins.trackFrom = best; ins.path = null;
    // a bait station where the signs are heaviest
    if (ins.stationsToday < C.stationsPerDay) { sim.stations.push({ cell: best, t: sim.t, by: ins.name }); ins.stationsToday++; ins.stats.stations++; }
  } else {
    ins.stats.passed++;
    ins.mode = 'travel';
    log(sim, 'inspector', `${ins.name} passed ${where} (${ins.job?.why ?? 'patrol'}): no active signs.`, ins.cell);
  }
}

// follow the signs, cell by cell, toward the burrow: like the creature that followed sounds
function trackStep(sim, ins) {
  const { city } = sim;
  const W = sim.W;
  const col = sim.colonies.find((c) => sim.rats.some((r) => r.alive && r.colony === c.id) && c.burrows.some((b) => Math.hypot((b % W) - (ins.cell % W), Math.floor(b / W) - Math.floor(ins.cell / W)) <= 2.5));
  if (col) { treatBurrow(sim, ins, col); return; }
  if (ins.trailLeft-- <= 0) { ins.mode = 'travel'; ins.path = null; return; }
  const seen = look(sim, ins);
  let best = -1; let bv = 0;
  for (const i of seen) {
    if (i === ins.cell) continue;
    const v = visibleSign(sim, i) + (sim.soil[i] ? 2 : 0);   // burrows are dug in soil
    if (v > bv && !ins.trail.slice(-30).includes(i)) { bv = v; best = i; }
  }
  if (best < 0 || bv < 2) { ins.mode = 'travel'; ins.path = null; return; }
  ins.path = sim.planner.search(ins.cell, { open: (i) => city.walk[i], target: best, maxCost: 40 });
  ins.pi = 0;
  if (!ins.path) { ins.mode = 'travel'; }
}

function treatBurrow(sim, ins, col) {
  const C = sim.cfg.inspector;
  ins.mode = 'treat'; ins.busy = 20; ins.path = null;
  const members = sim.rats.filter((r) => r.alive && r.colony === col.id);
  let killed = 0;
  for (const r of members) if (r.mode === 'home' && r.deathAt < 0 && sim.rng.chance(C.treatKill)) { r.deathAt = sim.t + sim.rng.int(1, 2) * DAY; r.poisonedAt = sim.t; r.poisonCause = 'treat'; killed++; }
  col.treated++; ins.stats.burrows++; ins.stats.killed += killed; sim.today.treated++; sim.totals.burrowsTreated++;
  log(sim, 'inspector', `${ins.name} found the burrow at ${col.name}: baited and sealed it (${killed} of ${members.length} rats poisoned).`, col.home);
  // the colony digs a new burrow nearby, if there is somewhere to dig
  const W = sim.W; const H = sim.city.H;
  const blocked = new Set(col.burrows);
  const next = nearestWhere(W, H, col.home, 8, (j) => suitable(sim, j) && !blocked.has(j) && Math.hypot((j % W) - (col.home % W), Math.floor(j / W) - Math.floor(col.home / W)) >= 3);
  if (next != null) { col.home = next; col.burrows.push(next); for (const r of members) r.home = next; }
  ins.trailLeft = 0;
}

// ---- the loop ------------------------------------------------------------------------------------
export function stepSim(sim) {
  const m = minuteOfDay(sim);
  const h = m / 60;
  foodSchedule(sim, m);
  // fresh bait stations: rats keep away from new objects for a while
  if (m % 30 === 0) {
    sim.blocked.fill(0);
    for (const st of sim.stations) if ((sim.t - st.t) / DAY < sim.cfg.rat.neophobiaDays) sim.blocked[st.cell] = 1;
  }
  if (m === Math.round(sim.cfg.rat.activeTo * 60)) dawn(sim);
  if (m === Math.round(sim.cfg.inspector.shift[0] * 60)) startShift(sim);
  if (m === Math.round(sim.cfg.rat.activeFrom * 60) - 30) { sim.tonight.fill(0); }
  for (const rat of sim.rats) ratStep(sim, rat, m, h);
  for (const ins of sim.inspectors) {
    inspectorStep(sim, ins, m, h);
  }
  sim.t += sim.cfg.tickMin; sim.steps++;
  // a new day starts at midnight in the daily record
  if (minuteOfDay(sim) === 0) closeDay(sim);
}

function closeDay(sim) {
  sim.today.rats = sim.rats.filter((r) => r.alive).length;
  sim.daily.push(sim.today);
  sim.today = blankDay(sim.daily.length);
}

export function runDays(sim, days) {
  const end = sim.t + days * DAY;
  while (sim.t < end) stepSim(sim);
}

// ---- measures ---------------------------------------------------------------------------------------
export function measures(sim) {
  const alive = sim.rats.filter((r) => r.alive && r.deathAt < 0).length;
  const start = sim.daily.length ? sim.rats.length - sim.totals.births : sim.rats.length;
  const corr = correlation(sim);
  return {
    rats: alive, ratsStart: start,
    eaten: Math.round(sim.totals.eaten), sightings: sim.totals.sightings,
    inspections: sim.totals.inspections, failed: sim.totals.failed, burrows: sim.totals.burrowsTreated,
    deaths: { ...sim.totals.deaths }, births: sim.totals.births,
    foodOut: Math.round(sim.daily.reduce((s, d) => s + d.foodOut, 0) + sim.today.foodOut),
    realMatch: corr,
  };
}

// how well the simulated activity matches where the real reports were made (Pearson r, 4x4-cell blocks)
export function correlation(sim) {
  const { city } = sim; const W = city.W; const H = city.H;
  const B = 4; const bw = Math.ceil(W / B); const bh = Math.ceil(H / B);
  const a = new Float32Array(bw * bh); const b = new Float32Array(bw * bh);
  for (let i = 0; i < city.N; i++) { const x = i % W; const y = (i - x) / W; const k = Math.floor(y / B) * bw + Math.floor(x / B); a[k] += sim.activity[i]; }
  for (const p of city.real.pts) { const x = p.cell % W; const y = (p.cell - x) / W; b[Math.floor(y / B) * bw + Math.floor(x / B)] += p.w; }
  let n = 0; let sa = 0; let sb = 0;
  for (let k = 0; k < a.length; k++) { n++; sa += a[k]; sb += b[k]; }
  const ma = sa / n; const mb = sb / n;
  let cov = 0; let va = 0; let vb = 0;
  for (let k = 0; k < a.length; k++) { cov += (a[k] - ma) * (b[k] - mb); va += (a[k] - ma) ** 2; vb += (b[k] - mb) ** 2; }
  return va && vb ? Math.round((cov / Math.sqrt(va * vb)) * 100) / 100 : 0;
}

// the number the environment designer optimises: fewer rats, fewer sightings (lower is better)
export function score(m) { return m.rats + 0.5 * m.sightings + 0.02 * m.eaten; }
