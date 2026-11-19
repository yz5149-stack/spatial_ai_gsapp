// The page: loads the real place, runs the simulation in real time, draws the 3D city and the plans,
// and wires the controls. The environment designer lives in designer.js.

import { CONFIG } from '../sim/config.js';
import { buildCity, describeLocation } from '../sim/city.js';
import { newSim, stepSim, clock, hourOf, dayOf, minuteOfDay, RAT_MODES, INSPECTOR_MODES, placeName, log, fx } from '../sim/sim.js';
import { makeDesign, cloneDesign } from '../sim/design.js';
import { makePlan, drawMind } from '../render/plan.js';
import { bagIcon } from '../render/icons.js';
import { makeDesigner } from './designer.js';

const $ = (id) => document.getElementById(id);
const DATA_URL = new URL('../../data/manhattanville.json', import.meta.url).href;

const state = {
  city: null, sim: null, scenario: 'now', design: makeDesign('now'),
  speed: 60, paused: false, started: false, acc: 0, last: 0,
  layer: 'activity', tool: 'select', view: 'auto', slowmo: true, chaseUntil: 0, chaser: null, selected: null, shownEvents: 0, lastPanel: 0, globe: null, plan: null,
};

function flash(text) {
  $('toast').textContent = text; $('toast').classList.remove('hide');
  clearTimeout(flash.t); flash.t = setTimeout(() => $('toast').classList.add('hide'), 2600);
}

// ---- running ------------------------------------------------------------------------------------
function designFor(scenario) { return scenario === 'design' ? cloneDesign(state.design) : makeDesign(scenario); }

function restart(scenario = state.scenario) {
  state.scenario = scenario;
  $('scenario').value = scenario;
  state.sim = newSim(state.city, designFor(scenario));
  state.selected = null; state.shownEvents = 0;
  $('log').innerHTML = '';
  state.globe?.invalidate();
  panels(true);
}

function loop(now) {
  const dt = Math.min(250, now - (state.last || now)); state.last = now;
  const sim = state.sim;
  if (sim && state.started && !state.paused) {
    // a chase plays in slow motion, so you can see who wins
    const chasing = sim.inspectors.find((i) => i.mode === 'chase');
    if (chasing) { state.chaser = chasing; state.chaseUntil = now + 1800; }
    const slow = state.slowmo && (chasing || now < state.chaseUntil);
    const speed = slow ? Math.min(state.speed, 2.5) : state.speed;
    state.acc += (dt / 1000) * speed;
    let n = 0;
    while (state.acc >= 1 && n < 900) { stepSim(sim); state.acc -= 1; n++; }
    if (sim.t >= sim.cfg.days * 1440) { state.paused = true; $('btn-pause').textContent = 'Resume'; flash('The week is over. Restart, or change the rules.'); }
  }
  if (sim) {
    state.plan.draw(sim, { layer: state.layer, selected: state.selected, now });
    const follow = state.view === 'auto' && now < state.chaseUntil && state.chaser ? state.chaser : null;
    const frac = state.speed <= 60 || follow ? state.acc : 1;
    try { state.globe?.frame(sim, { layer: state.layer, selected: state.selected, now, hourFrac: hourOf(sim), frac, follow }); } catch (err) { console.error(err); }
    if (now - state.lastPanel > 250) { panels(); state.lastPanel = now; }
  }
  requestAnimationFrame(loop);
}

// ---- panels -----------------------------------------------------------------------------------------
function phaseText(sim) {
  const h = hourOf(sim); const d = sim.design;
  if (h >= 17 && h < d.setOut) return `Evening: bags go out at ${d.setOut % 12 || 12} ${d.setOut < 12 ? 'am' : 'pm'}`;
  const patrol = h >= sim.cfg.inspector.shift[0] || h < sim.cfg.inspector.shift[1];
  if (h >= sim.cfg.rat.activeFrom || h < sim.cfg.rat.activeTo) return patrol ? 'Night: rats out, the patrol has flashlights' : 'Night: the rats are out, the patrol has gone home';
  return h < 12 ? 'Morning: trucks collect the bags' : 'Day: the rats sleep';
}

function panels(force = false) {
  const sim = state.sim; if (!sim) return;
  $('clock').textContent = clock(sim);
  $('phase').textContent = phaseText(sim);
  const alive = sim.rats.filter((r) => r.alive);
  $('n-rats').textContent = alive.length;
  const last = sim.daily[sim.daily.length - 1];
  $('n-fed').textContent = last && last.fedShare ? `${Math.round(last.fedShare * 100)}%` : '–';
  $('n-spot').textContent = sim.totals.spotted;
  $('n-caught').textContent = sim.totals.caught;
  $('n-missed').textContent = sim.totals.missed;
  $('n-sight').textContent = sim.totals.sightings;
  feed(sim);
  // log
  for (const e of sim.events) {
    if (e.seq <= state.shownEvents) continue;
    const li = document.createElement('li'); li.className = e.who;
    const w = document.createElement('span'); w.className = 'when'; w.textContent = shortTime(sim, e.t);
    const t = document.createElement('span'); t.textContent = e.text;
    li.append(w, t); $('log').prepend(li);
  }
  state.shownEvents = sim.eventSeq ?? 0;
  while ($('log').children.length > 60) $('log').lastChild.remove();
  agentCard(sim, state.selected);
  drawMind($('mind'), sim, state.selected);
  legend();
}

// the things worth watching, newest first; click one to fly there
const KIND = { spot: ['SPOTTED', 'k-spot'], caught: ['CAUGHT', 'k-caught'], missed: ['GOT AWAY', 'k-missed'], dodge: ['DODGED', 'k-dodge'], bag: ['BAG', 'k-bag'] };
let feedSeq = -1;
function feed(sim) {
  if (sim.fxSeq === feedSeq) return;
  feedSeq = sim.fxSeq;
  const items = sim.fx.filter((f) => KIND[f.kind]).slice(-14).reverse();
  if (!items.length) return;
  $('feed').innerHTML = items.map((f) => {
    const [label, cls] = f.burrow ? ['BURROW FOUND', 'k-burrow'] : KIND[f.kind];
    return `<li data-cell="${f.cell}"><b class="${cls}">${label}</b><span>${f.text.replace(/^Inspector \w spots a rat$/, '')}${f.kind === 'spot' ? `${f.text} at ${placeName(sim.city, f.cell)}` : ` · ${placeName(sim.city, f.cell)}`}</span><small>${shortTime(sim, f.t).slice(3)}</small></li>`;
  }).join('');
}

function shortTime(sim, t) {
  const m = (sim.cfg.startHour * 60 + t) % 1440; const d = Math.floor((sim.cfg.startHour * 60 + t) / 1440) + 1;
  const h = Math.floor(m / 60); return `D${d} ${String(h).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

const metres = (cells) => `${Math.round(cells * CONFIG.cellM)} m`;
function rel(city, from, to) {
  const dx = (to % city.W) - (from % city.W); const dy = Math.floor(to / city.W) - Math.floor(from / city.W);
  const parts = [];
  if (dx) parts.push(`${Math.abs(dx) * city.cellM} m ${dx > 0 ? 'E' : 'W'}`);
  if (dy) parts.push(`${Math.abs(dy) * city.cellM} m ${dy > 0 ? 'S' : 'N'}`);
  return parts.length ? parts.join(', ') : 'right there';
}

function agentCard(sim, a) {
  if (!a) {
    $('a-name').textContent = 'Nobody selected'; $('a-mode').textContent = '';
    $('a-facts').innerHTML = '<dt>Tip</dt><dd>Click a rat (orange) or an inspector (blue) on the map or in the city.</dd>';
    return;
  }
  const city = sim.city;
  const loc = describeLocation(city, a.cell);
  const facts = [];
  if (a.kind === 'rat') {
    const col = sim.colonies[a.colony];
    $('a-name').textContent = `Rat #${a.id}`;
    $('a-mode').textContent = a.alive ? (a.deathAt >= 0 ? `${RAT_MODES[a.mode]} · poisoned` : RAT_MODES[a.mode]) : 'Dead';
    facts.push(['Colony', `${col.name} (${sim.rats.filter((r) => r.alive && r.colony === col.id).length} rats)`]);
    facts.push(['Goal', 'Eat a night\'s food and get home before light']);
    facts.push(['Fed tonight', `${Math.round(Math.min(1, a.fed / sim.cfg.rat.need) * 100)}%`]);
    facts.push(['Ran', `${metres(a.distance)} in all`]);
    facts.push(['Knows', `${Math.round((a.knownCount * city.cellM * city.cellM) / 1000)} thousand m² of ground`]);
    const mem = a.memFood.slice().sort((x, y) => y.got - x.got)[0];
    facts.push(['Remembers', a.memFood.length ? `${a.memFood.length} food places; best ${rel(city, a.home, mem.cell)} of its burrow` : 'no food places yet']);
    facts.push(['Home is', `${metres(Math.hypot((a.home % city.W) - (a.cell % city.W), Math.floor(a.home / city.W) - Math.floor(a.cell / city.W)))} away (straight)`]);
    if (a.path && a.targetKind) facts.push(['Heading for', `${{ smell: 'food it smells', memory: 'a place it remembers', explore: 'ground it has not seen', home: 'its burrow' }[a.targetKind]}, ${metres(a.path.length - a.pi)} of walking`]);
  } else {
    $('a-name').textContent = a.name;
    $('a-mode').textContent = INSPECTOR_MODES[a.mode] ?? a.mode;
    facts.push(['Goal', 'Answer 311 calls; find and treat burrows']);
    facts.push(['Today', a.job ? a.job.why : '–']);
    facts.push(['Inspections', `${a.stats.inspections} (${a.stats.failed} failed for rats)`]);
    facts.push(['Burrows treated', `${a.stats.burrows} · bait stations ${a.stats.stations}`]);
    facts.push(['Walked', `${(a.stats.walkedM / 1000).toFixed(1)} km`]);
    facts.push(['Work list', `${a.queue?.length ?? 0} addresses left`]);
    facts.push(['Remembers', `${a.hotspots.length} failed addresses`]);
  }
  facts.push(['Where', loc.street]);
  facts.push(['Grid / metres', `cell ${loc.grid.x},${loc.grid.y} · ${loc.metres.east} m E, ${loc.metres.south} m S of the NW corner`]);
  facts.push(['Lon, lat', `${loc.lonlat[0]}, ${loc.lonlat[1]} · ${loc.elevation} m above sea level`]);
  $('a-facts').innerHTML = facts.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
}

function legend() {
  const L = {
    activity: '<i style="background:#ff6b3d"></i>Rat paths tonight', signs: '<i style="background:#d6aa5a"></i>Droppings, rub marks, gnawing',
    real: '<i style="background:#ff3d6e"></i>Real 311 calls and failed inspections, 2023–2026', light: '<i style="background:#fff3b0"></i>Street light (modelled poles)', none: '',
  }[state.layer];
  $('legend').innerHTML = `${L ? `${L}<br>` : ''}<i style="background:#ff6b3d"></i>Rat · <i style="background:#c58bff"></i>poisoned / bait station<br><i style="background:#47b8ff"></i>Inspector · <i style="background:#ffd34d"></i>food within reach · <i style="background:#5fd38a"></i>trash in a bin<br><i style="background:#5ac8dc"></i>sidewalk shed · <i style="border:2px solid #ff5a3c;background:none"></i>burrow`;
}

// ---- picking ------------------------------------------------------------------------------------------
function nearestAgent(sim, cell) {
  const W = sim.W; const x = cell % W; const y = Math.floor(cell / W);
  let best = null; let bd = 4.5;
  for (const a of [...sim.inspectors.filter((i) => i.mode !== 'off' && i.mode !== 'done'), ...sim.rats.filter((r) => r.alive && r.mode !== 'home')]) {
    const d = Math.hypot((a.cell % W) - x, Math.floor(a.cell / W) - y);
    if (d < bd) { bd = d; best = a; }
  }
  return best;
}

function pick(cell) {
  const sim = state.sim;
  if (cell < 0 || !sim) return;
  if (designer.handlePick(cell)) return;
  if (state.tool === 'bag') {
    if (!sim.city.walk[cell]) { flash('Drop it on a sidewalk or a street.'); return; }
    const s = { id: sim.sources.length, kind: 'bag', cell, amount: 3, name: 'Your trash bag', binned: false, out: -1, pickup: -1, access: 1, amt: 0, store: 0, isOut: false, eaten: 0 };
    sim.sources.push(s);
    if (!sim.sourceAt.has(cell)) sim.sourceAt.set(cell, []);
    sim.sourceAt.get(cell).push(s);
    sim.foodAt[cell] += 3; s.amt = 3;
    log(sim, 'rat', `You dropped a trash bag at ${placeName(sim.city, cell)}. Rats within smell will plan their way to it.`, cell);
    fx(sim, 'bag', cell, 'You dropped a trash bag');
    const h = hourOf(sim);
    const night = h >= sim.cfg.rat.activeFrom || h < sim.cfg.rat.activeTo;
    banner(night ? `Bag dropped at ${placeName(sim.city, cell)}. Its smell spreads about ${sim.cfg.rat.smell * sim.city.cellM} m along the open air; rats that catch it show a <b>!</b> and their route.` : 'Bag dropped. The rats come out after 6:30 pm: press “Next night” to see them come.', 6000);
    setBagTool(false);
    return;
  }
  state.selected = nearestAgent(sim, cell);
  if (state.selected && state.view !== 'city') state.globe?.setView(state.view, sim, state.selected);
  panels(true);
}

function banner(html, ms = 4000) {
  $('banner').innerHTML = html; $('banner').classList.remove('hide');
  clearTimeout(banner.t); banner.t = setTimeout(() => $('banner').classList.add('hide'), ms);
}
function setBagTool(on) {
  state.tool = on ? 'bag' : 'select';
  designer?.setTool(null);
  $('btn-bag').classList.toggle('on', on);
  document.querySelector('.stage').classList.toggle('placing', on);
  if (on) banner('Click a sidewalk or a street, in the city or on the map, to drop a bag.', 8000);
}

// ---- controls -------------------------------------------------------------------------------------------
function wire() {
  document.querySelectorAll('[data-speed]').forEach((b) => b.addEventListener('click', () => {
    state.speed = Number(b.dataset.speed);
    document.querySelectorAll('[data-speed]').forEach((o) => o.classList.toggle('on', o === b));
  }));
  $('btn-pause').addEventListener('click', () => { state.paused = !state.paused; $('btn-pause').textContent = state.paused ? 'Resume' : 'Pause'; });
  $('btn-restart').addEventListener('click', () => restart());
  $('btn-skip').addEventListener('click', () => {
    const sim = state.sim; let n = 0;
    do { stepSim(sim); n++; } while (minuteOfDay(sim) !== 19 * 60 && n < 1440 && sim.t < sim.cfg.days * 1440);
    panels(true);
  });
  $('scenario').addEventListener('change', (e) => restart(e.target.value));
  document.querySelectorAll('[data-layer]').forEach((b) => b.addEventListener('click', () => {
    state.layer = b.dataset.layer;
    document.querySelectorAll('[data-layer]').forEach((o) => o.classList.toggle('on', o === b));
    legend();
  }));
  const ico = bagIcon(true); $('bag-ico').getContext('2d').drawImage(ico, 0, 0);
  $('btn-bag').addEventListener('click', () => setBagTool(state.tool !== 'bag'));
  $('slowmo').addEventListener('change', (e) => { state.slowmo = e.target.checked; });
  $('feed').addEventListener('click', (e) => { const li = e.target.closest('li[data-cell]'); if (li) state.globe?.focusOn(Number(li.dataset.cell)); });
  document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => {
    const v = b.dataset.view;
    if ((v === 'follow' || v === 'street') && !state.selected) {
      // pick someone to follow: an inspector by day, a foraging rat by night
      const sim = state.sim;
      state.selected = sim.rats.find((r) => r.alive && r.mode !== 'home') ?? sim.inspectors.find((i) => i.mode !== 'off' && i.mode !== 'done') ?? null;
      if (!state.selected) { flash('Nobody is out right now. Wait for the night (rats) or the day (inspectors).'); return; }
    }
    state.view = v;
    document.querySelectorAll('[data-view]').forEach((o) => o.classList.toggle('on', o === b));
    state.globe?.setView(v, state.sim, state.selected);
  }));
  $('plan').addEventListener('click', (e) => pick(state.plan.cellAt(e.clientX, e.clientY)));
  $('btn-start').addEventListener('click', () => { $('screen-start').hidden = true; state.started = true; });
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (e.code === 'Space' && state.started) { e.preventDefault(); $('btn-pause').click(); }
  });
}

// ---- start ----------------------------------------------------------------------------------------------
let designer = null;
async function boot() {
  const place = await fetch(DATA_URL).then((r) => r.json());
  state.city = buildCity(place, CONFIG);
  state.plan = makePlan($('plan'), state.city, 2);
  designer = makeDesigner({ state, city: state.city, dataUrl: DATA_URL, restart, flash, $ });
  wire();
  restart('now');
  requestAnimationFrame(loop);
  // the 3D city, when WebGL and Cesium are there
  const waitCesium = () => new Promise((res) => { const t0 = performance.now(); const tick = () => (window.Cesium || performance.now() - t0 > 15000 ? res() : setTimeout(tick, 100)); tick(); });
  await waitCesium();
  try {
    const { makeGlobe } = await import('../render/globe.js');
    state.globe = await makeGlobe($('globe'), state.city, { onPick: (c) => pick(c), onStatus: (s) => console.info(s) });
  } catch (err) {
    console.error(err);
    $('globe-fallback').hidden = false;
  }
}
boot();
if (new URLSearchParams(location.search).has('debug')) window.__rats = state;
