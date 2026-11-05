// Wires the simulation to the page: the tick loop, speed, the 3D view, the two maps, the panels,
// placing the survivor by clicking, and sound.

import { CONFIG } from '../sim/config.js';
import { newSim, stepSim, runRounds, placeSurvivor, coverage, MODES, SURVIVOR_MODES } from '../sim/sim.js';
import { makePlan, LM_STYLE } from '../render/plans.js';
import { makeAudio } from './audio.js';

const $ = (id) => document.getElementById(id);
const state = { sim: null, speed: 1, paused: false, started: false, acc: 0, last: 0, shown: 0, overlays: { paths: false, heat: false } };
const creaturePlan = makePlan($('plan-creature'), 'creature');
const survivorPlan = makePlan($('plan-survivor'), 'survivor');
const audio = makeAudio();
let scene = null;

function load(seed) {
  state.sim = newSim(CONFIG, seed);
  state.shown = 0;
  $('log').innerHTML = '';
  $('map-seed').textContent = `Map ${seed}`;
  scene?.reset();
  scene?.buildMap(state.sim.world);
  scene?.onTick(state.sim, performance.now(), CONFIG.tickMs);
  panels();
}

function tick(now) {
  const sim = state.sim;
  const before = sim.events.length;
  const moved = sim.creature.node;
  stepSim(sim);
  scene?.onTick(sim, now, CONFIG.tickMs / state.speed);
  for (const e of sim.events.slice(before)) {
    if (e.kind === 'spot') audio.play.screech();
    else if (e.kind === 'caught') audio.play.lose();
    else if (e.kind === 'escaped') audio.play.win();
    else if (e.kind === 'landmark' && e.who === 'creature') audio.play.beep();
    else if (e.kind === 'hear') audio.play.creak();
  }
  if (sim.creature.node !== moved && sim.step % 5 === 0 && sim.phase === 'hunt') audio.play.creak();
}

function loop(now) {
  const dt = Math.min(250, now - (state.last || now));
  state.last = now;
  const ms = CONFIG.tickMs / state.speed;
  if (state.started && !state.paused) {
    state.acc += dt;
    let n = 0;
    while (state.acc >= ms && n < 12) { state.acc -= ms; tick(now); n++; }
    if (n) panels();
  }
  const sim = state.sim;
  if (sim) {
    // heartbeat: how close the creature is to the survivor
    let d = 0;
    if (state.started && !state.paused && sim.phase === 'hunt' && sim.survivor) {
      const W = sim.world.W;
      const dist = Math.hypot((sim.creature.node % W) - (sim.survivor.node % W), Math.floor(sim.creature.node / W) - Math.floor(sim.survivor.node / W));
      d = Math.max(0, 1 - dist / 12);
      if (sim.creature.mode === 'chase') d = Math.max(d, 0.7);
    }
    audio.danger(d, now);
    $('vignette').style.setProperty('--d', String(d));
    creaturePlan.draw(sim, now, state.overlays);
    survivorPlan.draw(sim, now);
  }
  scene?.frame(now);
  requestAnimationFrame(loop);
}

// ---- panels -------------------------------------------------------------------------------
const pct = (v) => `${Math.round(v * 100)}%`;
const secs = (ticks) => `${Math.round((ticks * CONFIG.tickMs) / 1000)} s`;

function panels() {
  const sim = state.sim;
  const c = sim.creature;
  const s = sim.survivor;
  const phase = sim.phase === 'explore' ? 'Phase 1 · Mapping the forest' : sim.phase === 'hunt' ? `Phase 2 · Hunting by sound · round ${sim.round}` : `Phase 2 · Round ${sim.round} over`;
  $('phase').textContent = phase;
  $('phase-sub').textContent = sim.phase === 'explore'
    ? `${pct(coverage(sim))} of the forest seen · ${c.distance} steps · ${c.k.landmarks.length} landmarks`
    : 'Click anywhere on the map or the forest to put the survivor there.';
  $('cov-bar').style.width = pct(coverage(sim));
  // creature card
  $('c-mode').textContent = MODES[c.mode] ?? c.mode;
  $('c-goal').textContent = sim.phase === 'explore' ? 'Map the whole forest' : 'Find the survivor, by sound';
  $('c-crit').textContent = sim.phase === 'explore' ? 'See every cell, walking as little as possible' : 'Catch it before it reaches the hospital';
  $('c-stats').innerHTML = `<span><b>${pct(coverage(sim))}</b>seen</span><span><b>${c.distance}</b>steps</span>`
    + `<span><b>${(c.k.knownCount / Math.max(1, c.distance)).toFixed(1)}</b>cells / step</span><span><b>${c.k.landmarks.length}</b>landmarks</span>`;
  $('c-hears').classList.toggle('on', sim.sounds.some((x) => x.heard));
  $('c-sees').classList.toggle('on', !!c.seesSurvivor);
  // survivor card
  $('s-card').classList.toggle('idle', !s);
  if (s) {
    const t = sim.phase === 'hunt' ? sim.step - sim.roundStart : (sim.rounds[sim.rounds.length - 1]?.ticks ?? 0);
    $('s-mode').textContent = sim.phase === 'pause' ? ({ caught: 'Caught', escaped: 'Escaped!', dawn: 'Survived the night' }[sim.rounds[sim.rounds.length - 1]?.result] ?? '') : (SURVIVOR_MODES[s.mode] ?? s.mode);
    $('s-stats').innerHTML = `<span><b>${secs(t)}</b>time</span><span><b>${s.distance}</b>steps</span>`
      + `<span><b>${pct(s.k.knownCount / (sim.world.W * sim.world.H))}</b>seen</span><span><b>${s.k.landmarks.length}</b>landmarks</span>`;
    $('s-sees').classList.toggle('on', !!s.sees);
    $('s-hears').classList.toggle('on', !!s.hears);
  } else {
    $('s-mode').textContent = 'Not here yet';
    $('s-stats').innerHTML = '';
  }
  // rounds
  const tally = { caught: 0, escaped: 0, dawn: 0 };
  for (const r of sim.rounds) tally[r.result]++;
  $('tally').innerHTML = `<span class="t-caught"><b>${tally.caught}</b>caught</span><span class="t-escaped"><b>${tally.escaped}</b>escaped</span><span class="t-dawn"><b>${tally.dawn}</b>hid till dawn</span>`;
  // landmarks (the creature's memory)
  const lms = c.k.landmarks;
  if ($('lm-list').dataset.n !== String(lms.length)) {
    $('lm-list').dataset.n = String(lms.length);
    $('lm-list').innerHTML = lms.slice().reverse().slice(0, 40).map((l) => `<li><i style="--c:${LM_STYLE[l.kind].color}">${l.id}</i><span>${l.note}<small>${l.text}</small></span></li>`).join('');
  }
  // log
  for (const e of sim.events.slice(state.shown)) {
    const li = document.createElement('li');
    li.className = e.who;
    li.innerHTML = `<span class="when">${secs(e.step)}</span>`;
    const w = document.createElement('span');
    w.textContent = e.text;
    li.append(w);
    $('log').prepend(li);
  }
  state.shown = sim.events.length;
  while ($('log').children.length > 80) $('log').lastChild.remove();
}

// ---- controls -----------------------------------------------------------------------------
function place(cell) {
  if (cell === null || !state.started) return;
  if (placeSurvivor(state.sim, cell)) {
    audio.play.screech();
    scene?.onTick(state.sim, performance.now(), CONFIG.tickMs);
    panels();
  } else if (state.sim.phase === 'explore') flash('Wait until the creature has mapped the forest.');
  else flash('Pick an open snow cell, away from the creature.');
}
let flashTimer = null;
function flash(text) {
  $('toast').textContent = text;
  $('toast').classList.remove('hide');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => $('toast').classList.add('hide'), 2200);
}
$('plan-creature').addEventListener('click', (e) => place(creaturePlan.cellAt(e.clientX, e.clientY)));
$('plan-survivor').addEventListener('click', (e) => place(survivorPlan.cellAt(e.clientX, e.clientY)));
$('scene').addEventListener('click', (e) => place(scene?.pickCell(e.clientX, e.clientY) ?? null));

document.querySelectorAll('[data-speed]').forEach((b) => b.addEventListener('click', () => {
  state.speed = Number(b.dataset.speed);
  document.querySelectorAll('[data-speed]').forEach((o) => o.classList.toggle('on', o === b));
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
  if (sim.phase === 'explore') while (sim.phase === 'explore') stepSim(sim);
  $('btn-ff').disabled = true;
  $('btn-ff').textContent = 'Running 20 rounds…';
  setTimeout(() => {
    runRounds(sim, 20);
    state.overlays.paths = true; state.overlays.heat = true;
    $('ov-paths').checked = true; $('ov-heat').checked = true;
    scene?.onTick(sim, performance.now(), 1);
    panels();
    $('btn-ff').disabled = false;
    $('btn-ff').textContent = '+20 rounds';
  }, 30);
});
$('btn-new').addEventListener('click', () => load(Math.floor(Math.random() * 1e9)));
$('btn-view').addEventListener('click', () => {
  if (!scene) return;
  const v = scene.getView() === 'top' ? 'follow' : 'top';
  scene.setView(v);
  $('btn-view').textContent = v === 'top' ? 'Behind the creature' : 'Whole forest';
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
  if (e.target instanceof HTMLInputElement) return;
  if (e.code === 'Space' && state.started) { e.preventDefault(); $('btn-pause').click(); }
  if (e.code === 'KeyV') $('btn-view').click();
});

// ---- start ---------------------------------------------------------------------------------
async function boot() {
  try {
    const { makeScene3D } = await import('../render/scene3d.js');
    scene = makeScene3D($('scene'));
  } catch (err) {
    console.error(err);
    $('viewer-fallback').hidden = false;
  }
  load(CONFIG.seed);
  requestAnimationFrame(loop);
}
boot();
if (new URLSearchParams(location.search).has('debug')) window.__agents = { state, scene: () => scene };
