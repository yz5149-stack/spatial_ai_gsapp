// Wires the simulation to the page: the place and the night, the tick loop, the 3D view, the maps,
// the panels, placing a survivor by clicking, sound, and the environment designer.

import { CONFIG } from '../sim/config.js';
import { PLACES } from '../data/places.js';
import { loadPlace, liveWeather } from '../data/load.js';
import { newSim, stepSim, runRounds, placeSurvivor, walkableCoverage, hoursIn, acoustic, compass, MODES, SURVIVOR_MODES, RESULT_NAMES } from '../sim/sim.js';
import { describeLocation } from '../sim/city.js';
import { cellClimate } from '../sim/environment.js';
import { plan } from '../sim/knowledge.js';
import { makePlan, LM_STYLE, SURV_CSS } from '../render/plans.js';
import { makeAudio } from './audio.js';
import { makeDesigner } from './designer.js';

const $ = (id) => document.getElementById(id);
const state = {
  sim: null, place: null, config: null, design: {}, speed: 1, paused: false, started: false, acc: 0, last: 0, shown: 0,
  overlays: { paths: false, heat: false }, focus: 0, loading: null,
};
const creaturePlan = makePlan($('plan-creature'), 'creature');
const survivorPlan = makePlan($('plan-survivor'), 'survivor');
const audio = makeAudio();
let scene = null;

// ---- the place, the night and the configuration ------------------------------------------
for (const p of PLACES) $('sel-place').append(new Option(p.name, p.id));
const params = new URLSearchParams(location.search);
if (params.get('place') && PLACES.some((p) => p.id === params.get('place'))) $('sel-place').value = params.get('place');

function nycHour() {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(new Date()).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:00`;
}

async function preparePlace() {
  const id = $('sel-place').value;
  const base = await loadPlace(id);
  const night = $('sel-night').value;
  const config = structuredClone(CONFIG);
  config.survivor.count = Number($('sel-count').value);
  let place = base;
  if (night === 'live') {
    try {
      const weather = await liveWeather(base);
      place = { ...base, weather };
      const now = nycHour();
      config.night.start = weather.time.includes(now) ? now : weather.time[Math.max(0, weather.time.length - 24)];
      config.night.hours = Math.min(12, weather.time.length - 1 - weather.time.indexOf(config.night.start));
    } catch (err) {
      console.error(err);
      flash('Live weather could not be loaded; playing the 2016 storm.');
      $('sel-night').value = CONFIG.night.start;
    }
  } else config.night.start = night;
  return { place, config };
}

async function load(design) {
  const token = {};
  state.loading = token;
  $('btn-start').disabled = true;
  const { place, config } = await preparePlace();
  if (state.loading !== token) return;
  designer.setPlace(place, config);
  if (!design || design.place !== place.id) design = designer.initial(place, config);
  state.place = place; state.config = config; state.design = design;
  const seed = Number(params.get('seed') || CONFIG.seed);
  state.sim = newSim(place, config, design, seed, { premapped: params.has('premapped') });
  state.shown = 0;
  state.focus = 0;
  $('log').innerHTML = '';
  const meta = PLACES.find((p) => p.id === place.id);
  $('place-blurb').textContent = meta.blurb;
  $('start-place').textContent = `${meta.name}, ${place.weather.time[state.sim.world.nightIndex].replace('T', ' ')}. ${meta.blurb}`;
  $('map-seed').textContent = `${state.sim.world.W} × ${state.sim.world.H} cells of ${config.cellM} m · refuge: ${state.sim.world.refuge.name}`;
  scene?.reset();
  scene?.buildMap(state.sim.world, design);
  scene?.onTick(state.sim, performance.now(), config.tickMs);
  $('btn-start').disabled = false;
  panels();
}

['sel-place', 'sel-night', 'sel-count'].forEach((id) => $(id).addEventListener('change', () => {
  const placeChanged = id === 'sel-place';
  load(placeChanged ? null : state.design).then(() => { if (placeChanged) designer.reset(); });
}));

// ---- the loop ---------------------------------------------------------------------------------
function tick(now) {
  const sim = state.sim;
  const before = sim.events.length;
  stepSim(sim);
  scene?.onTick(sim, now, state.config.tickMs / state.speed);
  for (const e of sim.events.slice(before)) {
    if (e.kind === 'spot') audio.play.screech();
    else if (e.kind === 'caught') audio.play.lose();
    else if (e.kind === 'escaped') audio.play.win();
    else if (e.kind === 'cache') audio.play.pickup?.();
    else if (e.kind === 'landmark' && e.who === 'creature') audio.play.beep();
    else if (e.kind === 'hear') audio.play.creak();
  }
}

function loop(now) {
  const dt = Math.min(250, now - (state.last || now));
  state.last = now;
  const sim = state.sim;
  if (sim) {
    const ms = state.config.tickMs / state.speed;
    if (state.started && !state.paused) {
      state.acc += dt;
      let n = 0;
      while (state.acc >= ms && n < 12) { state.acc -= ms; tick(now); n++; }
      if (n) panels();
    }
    let d = 0;
    if (state.started && !state.paused && sim.phase === 'hunt') {
      const W = sim.world.W;
      for (const s of sim.survivors) {
        if (!s.active) continue;
        const dist = Math.hypot((sim.creature.node % W) - (s.node % W), Math.floor(sim.creature.node / W) - Math.floor(s.node / W));
        d = Math.max(d, 1 - dist / 12);
      }
      if (sim.creature.mode === 'chase') d = Math.max(d, 0.7);
    }
    audio.danger(d, now);
    $('vignette').style.setProperty('--d', String(d));
    // the plans are redrawn at most ~20 times a second
    if (now - (state.lastPlan ?? 0) > 50) {
      state.lastPlan = now;
      creaturePlan.draw(sim, now, state.overlays);
      survivorPlan.draw(sim, now);
    }
  }
  scene?.frame(now);
  requestAnimationFrame(loop);
}

// ---- panels -----------------------------------------------------------------------------------
const pct = (v) => `${Math.round(v * 100)}%`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const bar = (label, v, cls) => `<div class="need ${cls}"><span>${label}</span><i><b style="width:${Math.max(0, Math.min(100, v))}%"></b></i><em>${Math.round(v)}</em></div>`;

function weatherHtml(w, sim) {
  const clock = w.time.replace('T', ' ');
  const vis = Math.round((1 / (1 + 0.3 * w.snowfall)) * 100);
  return `<span><b>${clock}</b>${sim.phase === 'explore' ? 'before the night' : `hour ${hoursIn(sim).toFixed(1)} of ${sim.config.night.hours}`}</span>`
    + `<span><b>${w.temp.toFixed(1)} °C</b>feels ${w.apparent.toFixed(1)} °C</span>`
    + `<span><b>${Math.round(w.wind)} km/h</b>from ${compass(w.dir)}, gusts ${Math.round(w.gust)}</span>`
    + `<span><b>${w.snowfall.toFixed(1)} cm/h</b>snowfall · sight ${vis}%</span>`
    + `<span><b>${Math.round(w.depthCm)} cm</b>snow on the ground</span>`;
}

function framesHtml(sim) {
  const world = sim.world;
  const s = sim.survivors[state.focus] ?? sim.survivors[0];
  const c = sim.creature;
  const row = (who, a, color) => {
    const L = describeLocation(world, a.node);
    return `<div class="frame"><b style="color:${color}">${who}</b>`
      + `<span><small>grid cell</small>(${L.grid.x}, ${L.grid.y})</span>`
      + `<span><small>metres from NW corner</small>${L.metres.east} E, ${L.metres.south} S</span>`
      + `<span><small>longitude, latitude</small>${L.lonlat[0].toFixed(5)}, ${L.lonlat[1].toFixed(5)}</span>`
      + `<span><small>elevation</small>${L.elevation.toFixed(1)} m</span>`
      + `<span class="wide"><small>street</small>${esc(L.street)}</span></div>`;
  };
  let html = row('Creature', c, '#ff3b30');
  if (s && sim.phase !== 'explore') {
    html += row(s.name, s, SURV_CSS[sim.survivors.indexOf(s) % SURV_CSS.length]);
    const m = world.cellM;
    const [ax, ay] = [c.node % world.W, Math.floor(c.node / world.W)];
    const [bx, by] = [s.node % world.W, Math.floor(s.node / world.W)];
    const flat = Math.hypot(ax - bx, ay - by) * m;
    const dz = world.elev[c.node] - world.elev[s.node];
    const route = plan(world, s.k, s.node, { stopAt: c.node });
    const walkD = route.dist[c.node];
    const truth = plan(world, c.k, c.node, { stopAt: s.node }).dist[s.node];
    const ac = acoustic(sim, s.node, c.node) * m;
    const cl = cellClimate(world, s.node, sim.weather, sim.config);
    html += `<div class="dists"><span><small>Euclidean</small>${Math.round(flat)} m <em>(3D ${Math.round(Math.hypot(flat, dz))} m)</em></span>`
      + `<span><small>walking, on the creature's map</small>${Number.isFinite(truth) ? `${Math.round(truth * m)} m` : '—'}</span>`
      + `<span><small>walking, on ${esc(s.name)}'s map</small>${Number.isFinite(walkD) ? `${Math.round(walkD * m)} m` : 'unknown ground'}</span>`
      + `<span><small>acoustic (muffled, wind)</small>${Math.round(ac)} m</span>`
      + `<span><small>${esc(s.name)}'s wind chill here</small>${cl.chill.toFixed(1)} °C · ${Math.round(cl.wind)} km/h · ${Math.round(cl.depth)} cm snow${cl.shelter > 0.2 ? ' · sheltered' : ''}</span></div>`;
  }
  return html;
}

function panels() {
  const sim = state.sim;
  if (!sim) return;
  const c = sim.creature;
  const w = sim.weather;
  const phase = sim.phase === 'explore' ? 'Phase 1 · The creature maps the neighbourhood' : sim.phase === 'hunt' ? `Phase 2 · Night ${sim.round}` : `Night ${sim.round} is over`;
  $('phase').textContent = phase;
  const active = sim.survivors.filter((s) => s.active).length;
  $('phase-sub').textContent = sim.phase === 'explore'
    ? `${pct(walkableCoverage(sim))} of the open ground seen · ${c.distance * sim.world.cellM} m walked · ${c.k.landmarks.length} landmarks`
    : `${active} of ${sim.survivors.length} survivors still out · click the map to place one`;
  $('cov-bar').style.width = sim.phase === 'explore' ? pct(walkableCoverage(sim)) : pct(hoursIn(sim) / sim.config.night.hours);
  $('weather').innerHTML = weatherHtml(w, sim);
  $('hud-weather').innerHTML = `<b>${w.time.slice(11, 16)}</b> ${w.temp.toFixed(0)} °C · ${Math.round(w.wind)} km/h ${compass(w.dir)} · ${Math.round(w.depthCm)} cm`;
  // creature
  $('c-mode').textContent = MODES[c.mode] ?? c.mode;
  $('c-goal').textContent = sim.phase === 'explore' ? 'Map the whole neighbourhood' : 'Find the survivors, by sound';
  $('c-crit').textContent = sim.phase === 'explore' ? 'See every open cell, walking as little as possible' : 'Share of survivors caught';
  const caught = sim.outcomes.filter((o) => o.result === 'caught').length;
  $('c-stats').innerHTML = `<span><b>${pct(walkableCoverage(sim))}</b>seen</span><span><b>${(c.distance * sim.world.cellM / 1000).toFixed(1)} km</b>walked</span>`
    + `<span><b>${c.k.landmarks.length}</b>landmarks</span><span><b>${sim.outcomes.length ? pct(caught / sim.outcomes.length) : '—'}</b>caught</span>`;
  $('c-hears').classList.toggle('on', sim.sounds.some((x) => x.heard));
  $('c-sees').classList.toggle('on', !!c.seesSurvivor);
  // survivors
  const tabsKey = sim.survivors.map((s) => s.id).join(',');
  if ($('surv-tabs').dataset.key !== tabsKey) {
    $('surv-tabs').dataset.key = tabsKey;
    $('surv-tabs').innerHTML = sim.survivors.map((s, k) => `<button type="button" data-k="${k}" style="--c:${SURV_CSS[k % SURV_CSS.length]}">${esc(s.name)}</button>`).join('');
  }
  $('surv-tabs').querySelectorAll('button').forEach((b) => b.classList.toggle('on', Number(b.dataset.k) === state.focus));
  $('s-list').innerHTML = sim.survivors.length ? sim.survivors.map((s, k) => {
    const status = s.active ? (SURVIVOR_MODES[s.mode] ?? s.mode) : RESULT_NAMES[s.result];
    return `<div class="s-row ${s.active ? '' : 'done'} ${k === state.focus ? 'focus' : ''}" data-k="${k}"><div class="s-name"><i style="--c:${SURV_CSS[k % SURV_CSS.length]}"></i>${esc(s.name)}<span class="mode" style="--c:${SURV_CSS[k % SURV_CSS.length]}">${esc(status)}</span></div>`
      + bar('warmth', s.warmth, 'warm') + bar('stamina', s.stamina, 'stam') + bar('battery', s.battery, 'batt')
      + `<div class="s-meta">${s.distance * sim.world.cellM} m · ${s.k.landmarks.length} landmarks${s.cachesUsed.length ? ` · took ${s.cachesUsed.join(', ')}` : ''}${s.lightOn ? ' · light on' : ''}${s.sees ? ' · <b>sees it</b>' : ''}</div></div>`;
  }).join('') : '<p class="caption">They appear when the creature has mapped the place.</p>';
  // nights
  const tally = { escaped: 0, caught: 0, froze: 0, dawn: 0 };
  for (const o of sim.outcomes) tally[o.result]++;
  $('tally').innerHTML = `<span class="t-escaped"><b>${tally.escaped}</b>reached the refuge</span><span class="t-caught"><b>${tally.caught}</b>caught</span><span class="t-froze"><b>${tally.froze}</b>froze</span><span class="t-dawn"><b>${tally.dawn}</b>lasted till dawn</span>`;
  const lms = c.k.landmarks.filter((l) => !(l.kind === 'warm' && l.data?.type === 'doorway'));
  if ($('lm-list').dataset.n !== String(c.k.landmarks.length)) {
    $('lm-list').dataset.n = String(c.k.landmarks.length);
    $('lm-list').innerHTML = lms.slice().reverse().slice(0, 50).map((l) => `<li><i style="--c:${(LM_STYLE[l.kind] ?? LM_STYLE.start).color}">${l.id}</i><span>${esc(l.note)}<small>${esc(l.text)}</small></span></li>`).join('');
  }
  if (sim.step % 3 === 0 || !state.started) $('frames').innerHTML = framesHtml(sim);
  // log
  const fresh = sim.events.filter((e) => e.step >= (state.lastLogStep ?? -1) && !state.logged?.has(e));
  state.logged = state.logged ?? new WeakSet();
  for (const e of fresh) {
    state.logged.add(e);
    const li = document.createElement('li');
    li.className = e.who;
    li.innerHTML = `<span class="when">${e.round ? `N${e.round}` : '—'}</span>`;
    const t = document.createElement('span');
    t.textContent = e.text;
    li.append(t);
    $('log').prepend(li);
  }
  state.lastLogStep = sim.step;
  while ($('log').children.length > 120) $('log').lastChild.remove();
}

// ---- controls ---------------------------------------------------------------------------------
function place(cell) {
  if (cell === null || !state.started) return;
  if (placeSurvivor(state.sim, cell)) {
    audio.play.screech();
    scene?.onTick(state.sim, performance.now(), state.config.tickMs);
    panels();
  } else if (state.sim.phase === 'explore') flash('Wait until the creature has mapped the neighbourhood.');
  else flash('Pick an open cell, away from the creature.');
}
let flashTimer = null;
function flash(text) {
  $('toast').textContent = text;
  $('toast').classList.remove('hide');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => $('toast').classList.add('hide'), 2600);
}
$('plan-creature').addEventListener('click', (e) => place(creaturePlan.cellAt(e.clientX, e.clientY)));
$('plan-survivor').addEventListener('click', (e) => place(survivorPlan.cellAt(e.clientX, e.clientY)));
$('scene').addEventListener('click', (e) => place(scene?.pickCell(e.clientX, e.clientY) ?? null));

function setFocus(k) {
  state.focus = k;
  survivorPlan.setFocus(k);
  scene?.setFocus(k);
  panels();
}
$('surv-tabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setFocus(Number(b.dataset.k)); });
$('s-list').addEventListener('click', (e) => { const r = e.target.closest('.s-row'); if (r) setFocus(Number(r.dataset.k)); });

document.querySelectorAll('[data-speed]').forEach((b) => b.addEventListener('click', () => {
  state.speed = Number(b.dataset.speed);
  document.querySelectorAll('[data-speed]').forEach((o) => o.classList.toggle('on', o === b));
}));
document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => {
  scene?.setView(b.dataset.view);
  document.querySelectorAll('[data-view]').forEach((o) => o.classList.toggle('on', o === b));
}));
$('btn-pause').addEventListener('click', () => {
  state.paused = !state.paused;
  $('btn-pause').textContent = state.paused ? 'Resume' : 'Pause';
  if (state.paused) audio.suspend(); else audio.resume();
});
$('btn-skip').addEventListener('click', () => {
  const sim = state.sim;
  if (sim.phase !== 'explore') return;
  while (sim.phase === 'explore') stepSim(sim);
  scene?.onTick(sim, performance.now(), 1);
  panels();
});
$('btn-ff').addEventListener('click', () => {
  const sim = state.sim;
  $('btn-ff').disabled = true;
  $('btn-ff').textContent = 'Playing 10 nights…';
  setTimeout(() => {
    if (sim.phase === 'explore') while (sim.phase === 'explore') stepSim(sim);
    runRounds(sim, 10);
    state.overlays.paths = true; state.overlays.heat = true;
    $('ov-paths').checked = true; $('ov-heat').checked = true;
    scene?.onTick(sim, performance.now(), 1);
    panels();
    $('btn-ff').disabled = false;
    $('btn-ff').textContent = '+10 nights';
  }, 30);
});
$('btn-truth').addEventListener('click', () => {
  if (!scene) return;
  scene.setTruth(!scene.getTruth());
  $('btn-truth').textContent = scene.getTruth() ? 'Show its knowledge' : 'Show the real city';
  scene.onTick(state.sim, performance.now(), 1);
});
$('btn-sound').addEventListener('click', () => {
  audio.setMuted(!audio.isMuted());
  $('btn-sound').textContent = audio.isMuted() ? 'Sound: off' : 'Sound: on';
});
$('ov-paths').addEventListener('change', (e) => { state.overlays.paths = e.target.checked; });
$('ov-heat').addEventListener('change', (e) => { state.overlays.heat = e.target.checked; });
$('btn-start').addEventListener('click', () => {
  audio.start();
  $('screen-start').hidden = true;
  state.started = true;
});
document.addEventListener('visibilitychange', () => { if (document.hidden) audio.suspend(); else if (!state.paused) audio.resume(); });
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  if (e.code === 'Space' && state.started) { e.preventDefault(); $('btn-pause').click(); }
  if (e.code === 'KeyV') { const views = ['follow', 'survivor', 'top']; const cur = scene?.getView() ?? 'follow'; document.querySelector(`[data-view="${views[(views.indexOf(cur) + 1) % 3]}"]`)?.click(); }
  if (e.code === 'KeyT') $('btn-truth').click();
});

// ---- the designer -------------------------------------------------------------------------------
const designer = makeDesigner({
  play(design) {
    load(design).then(() => {
      $('screen-start').hidden = true;
      state.started = true;
      audio.start();
      const sim = state.sim;
      if (sim.phase === 'explore') { while (sim.phase === 'explore') stepSim(sim); scene?.onTick(sim, performance.now(), 1); }
      document.querySelector('.stage').scrollIntoView({ behavior: 'smooth', block: 'start' });
      flash('Playing your design. The creature has already mapped the place.');
    });
  },
  flash,
});

// ---- start --------------------------------------------------------------------------------------
async function boot() {
  try {
    const { makeScene3D } = await import('../render/scene3d.js');
    scene = makeScene3D($('scene'));
  } catch (err) {
    console.error(err);
    $('viewer-fallback').hidden = false;
  }
  await load(null);
  designer.reset();
  requestAnimationFrame(loop);
}
boot();
if (params.has('debug')) window.__whiteout = { state, scene: () => scene, designer };
