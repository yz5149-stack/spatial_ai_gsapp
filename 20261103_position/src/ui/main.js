// Wires the game to the page: keyboard, mouse and touch input, the tick loop, the 3D view, the
// minimap, sound, the HUD and the start and end screens.
//
// Controls: move (arrow keys / WASD, or click where to go), Space to shoot, E to climb a tree or
// climb down. Two different keys, so you never hide when you meant to shoot or the other way round.

import { CONFIG } from '../sim/config.js';
import { makeContext } from '../sim/context.js';
import { newRun, stepRun, directionTo } from '../sim/escape.js';
import { G, nodeId } from '../sim/world.js';
import { isAdjacent } from '../sim/relations.js';
import { makePlans } from '../render/plans2d.js';
import { makePanels } from './panels.js';
import { makeAudio } from './audio.js';

const $ = (id) => document.getElementById(id);
const TICK = CONFIG.game.tickMs;

function readPalette() {
  const css = getComputedStyle(document.documentElement);
  const v = (name) => css.getPropertyValue(name).trim();
  return {
    player: v('--player'), creature: v('--creature'), creatureBody: v('--creature-body'), crow: v('--crow'),
    caseGlow: v('--case'), hidden: v('--hidden'), rel: v('--rel'), door: v('--door'), cross: v('--cross'), hospital: v('--hospital'),
    sky: v('--sky'), snow: v('--snow'), tree: v('--tree'), trunk: v('--trunk'), bush: v('--bush'), rock: v('--rock'),
    wall: v('--wall'), platform: v('--platform'), bridge: v('--bridge'), foliage: v('--foliage'), ladder: v('--ladder'),
    planFree: v('--plan-free'), planAir: v('--plan-air'), planGrid: v('--plan-grid'), planInk: v('--plan-ink'),
    exit: v('--door'),
  };
}

const DIFF_NOTE = {
  easy: '3 bullets, and it is slow and short-sighted. Good for a first try.',
  normal: '1 bullet. It is a little slower than you.',
  hard: '1 bullet, and it is faster than you.',
};

const state = {
  ctx: null, game: null, seed: CONFIG.seed, round: 0, difficulty: 'easy',
  started: false, paused: false, acc: 0, last: 0, showRelations: true,
  queued: { shoot: false, climb: false }, goal: null, climbAtGoal: null, beepTick: 0,
};
const keys = new Set();
const touch = { dx: 0, dy: 0 };

const palette = readPalette();
const panels = makePanels();
const plans = makePlans($('minimap'), null);
const audio = makeAudio();
let scene = null;

function loadMap(seed) {
  state.seed = seed;
  state.ctx = makeContext(CONFIG, seed);
  plans.setMap(state.ctx.world, state.ctx.rays, palette, state.ctx.exits);
  scene?.buildMap(state.ctx.world, state.ctx.rays, state.ctx.exits);
}

function newGame() {
  state.round++;
  state.game = newRun(state.ctx, { difficulty: state.difficulty, round: state.round });
  state.goal = null;
  state.climbAtGoal = null;
  panels.reset();
  scene?.reset();
  scene?.onTick(state.game, performance.now(), TICK);
  scene?.snapCamera();
  panels.update(state.game);
  state.acc = 0;
}

function input() {
  const g = state.game;
  const k = (...names) => names.some((n) => keys.has(n));
  let dx = (k('KeyD', 'ArrowRight') ? 1 : 0) - (k('KeyA', 'ArrowLeft') ? 1 : 0);
  let dy = (k('KeyS', 'ArrowDown') ? 1 : 0) - (k('KeyW', 'ArrowUp') ? 1 : 0);
  if (!dx && !dy) { dx = touch.dx; dy = touch.dy; }
  const shoot = state.queued.shoot;
  let climb = state.queued.climb;
  state.queued.shoot = false;
  state.queued.climb = false;
  if (dx || dy) { state.goal = null; state.climbAtGoal = null; }
  // clicked somewhere: walk there along the shortest path; clicked a tree: climb it on arrival
  if (!dx && !dy && state.goal !== null && g.player.inTree === null && g.player.busy === 0) {
    if (g.player.node === state.goal) {
      state.goal = null;
      if (state.climbAtGoal !== null && isAdjacent(g.ctx.world, g.player.node, state.climbAtGoal)) {
        g.player.facing = Math.atan2(Math.floor(state.climbAtGoal / g.ctx.world.W) - Math.floor(g.player.node / g.ctx.world.W),
          (state.climbAtGoal % g.ctx.world.W) - (g.player.node % g.ctx.world.W));
        climb = true;
      }
      state.climbAtGoal = null;
    } else {
      const next = g.ctx.pf.nextStep(g.player.node, state.goal);
      ({ dx, dy } = directionTo(g.ctx.world, g.player.node, next));
    }
  }
  return { dx, dy, shoot, climb };
}

let lastKnown = -1;
function tick(now) {
  const g = state.game;
  const before = { node: g.player.node, events: g.events.length };
  stepRun(g, input());
  scene?.onTick(g, now, TICK);
  plans.addSounds(g, now);
  panels.update(g);
  // sound for what just happened
  if (g.player.node !== before.node) audio.play.step();
  if (g.player.hearsCreature) audio.play.creak();
  for (const e of g.events.slice(before.events)) {
    if (e.kind === 'spot') audio.play.screech();
    else if (e.kind === 'caw') audio.play.caw();
    else if (e.kind === 'shot') audio.play.shot();
    else if (e.kind === 'case') audio.play.pickup();
    else if (e.kind === 'lose') audio.play.lose();
    else if (e.kind === 'win') audio.play.win();
  }
  if (g.alarmLeft > 0 && g.step % 4 === 0) audio.play.beep();
  if (g.player.seesCreature && lastKnown < g.step - 40 && g.creature.mode !== 'chase') audio.play.creak();
  if (g.player.seesCreature) lastKnown = g.step;
  if (g.over) showEnd(g);
}

function dangerLevel(g) {
  const me = g.player;
  if (g.over || me.knownCreature === null || g.step - me.knownStep > 6) return 0;
  let d = Math.max(0, 1 - g.distances.path / 11);
  if (g.creature.seesPlayer) d = Math.max(d, 0.75);
  if (g.creature.frozenLeft > 0) d *= 0.4;
  if (me.inTree !== null) d *= 0.8;
  return d;
}

function showEnd(g) {
  state.started = false;
  const win = g.result === 'win';
  $('end-card').className = `card ${win ? 'win' : 'lose'}`;
  $('end-title').textContent = win ? 'You saved the world' : 'You became part of it';
  $('end-text').textContent = win
    ? 'The vaccine reached the hospital in time.'
    : (g.step >= CONFIG.game.maxTicks ? 'The night ran out. At dawn the roots found you.' : 'The roots closed around you before you reached the hospital.');
  const secs = Math.round((g.step * TICK) / 1000);
  $('end-stats').innerHTML = `<span><b>${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}</b>time</span>`
    + `<span><b>${g.player.shots}</b>shots</span><span><b>${g.events.filter((e) => e.kind === 'climb').length}</b>trees climbed</span>`
    + `<span><b>${g.player.carrying ? 'yes' : 'no'}</b>had the case</span>`;
  if (!win) $('viewer').classList.add('hit');
  setTimeout(() => { $('viewer').classList.remove('hit'); $('screen-end').hidden = false; $('btn-again').focus(); }, win ? 400 : 1700);
}

function start() {
  audio.start();
  audio.resume();
  $('screen-start').hidden = true;
  $('screen-end').hidden = true;
  newGame();
  state.started = true;
  state.paused = false;
  $('btn-pause').textContent = 'Pause';
  $('viewer').focus();
}

function loop(now) {
  const dt = Math.min(250, now - (state.last || now));
  state.last = now;
  const g = state.game;
  if (state.started && !state.paused && g && !g.over) {
    state.acc += dt;
    while (state.acc >= TICK && !state.game.over) { state.acc -= TICK; tick(now); }
  }
  if (g) {
    const d = state.started && !state.paused ? dangerLevel(g) : 0;
    audio.danger(d, now);
    $('vignette').style.setProperty('--d', String(d));
  }
  scene?.frame(now);
  if (state.game) plans.draw(state.game, now, true, state.showRelations);
  requestAnimationFrame(loop);
}

// ---- input -----------------------------------------------------------------------
const GAME_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Enter', 'KeyE', 'KeyM', 'KeyP']);
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (!state.started && (e.code === 'Space' || e.code === 'Enter') && e.target instanceof HTMLButtonElement) return;
  if (!GAME_KEYS.has(e.code)) return;
  if (state.started) e.preventDefault();
  if (!state.started && (e.code === 'Space' || e.code === 'Enter')) {
    if (!$('screen-start').hidden || !$('screen-end').hidden) { e.preventDefault(); start(); }
    return;
  }
  keys.add(e.code);
  if (e.repeat) return;
  if (e.code === 'Space') state.queued.shoot = true;
  if (e.code === 'KeyE') state.queued.climb = true;
  if (e.code === 'KeyM') toggleMap();
  if (e.code === 'KeyP') togglePause();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

// click (or tap) the ground to walk there; click a tree to walk to it and climb it
$('viewer').addEventListener('pointerdown', (e) => {
  $('viewer').focus();
  if (!state.started || state.paused || !scene || e.target.closest('button, .screen')) return;
  const cell = scene.pickCell(e.clientX, e.clientY);
  if (!cell) return;
  const g = state.game;
  const { world, pf } = g.ctx;
  const i = cell.y * world.W + cell.x;
  if (world.ground[i] === G.TREE) {
    // the walkable cell next to that tree closest to you
    let best = null;
    const row = pf.row(g.player.node);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const n = nodeId(world, 0, cell.x + dx, cell.y + dy);
      if (cell.x + dx < 0 || cell.y + dy < 0 || cell.x + dx >= world.W || cell.y + dy >= world.H || !world.walk[n]) continue;
      if (!isAdjacent(world, n, i)) continue;
      if (best === null || row[world.nodeIndex[n]] < row[world.nodeIndex[best]]) best = n;
    }
    if (best !== null) { state.goal = best; state.climbAtGoal = i; }
  } else if (world.walk[i]) {
    state.goal = i;
    state.climbAtGoal = null;
  }
  if (state.goal !== null && g.player.inTree !== null) state.queued.climb = true; // come down first
  scene.markGoal?.(state.goal);
});

document.querySelectorAll('#touch [data-dir]').forEach((b) => {
  const [dx, dy] = b.dataset.dir.split(',').map(Number);
  const on = (e) => { e.preventDefault(); e.stopPropagation(); touch.dx = dx; touch.dy = dy; state.goal = null; };
  const off = (e) => { e.preventDefault(); if (touch.dx === dx && touch.dy === dy) { touch.dx = 0; touch.dy = 0; } };
  b.addEventListener('pointerdown', on);
  b.addEventListener('pointerup', off);
  b.addEventListener('pointerleave', off);
  b.addEventListener('pointercancel', off);
});
document.querySelector('#touch [data-act="shoot"]').addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); state.queued.shoot = true; });
document.querySelector('#touch [data-act="climb"]').addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); state.queued.climb = true; });

// ---- controls --------------------------------------------------------------------
function togglePause() {
  if (!state.started) return;
  state.paused = !state.paused;
  $('btn-pause').textContent = state.paused ? 'Resume' : 'Pause';
  if (state.paused) { panels.toast('Paused. Press P to go on.'); audio.suspend(); } else audio.resume();
}
// leaving the page (another tab, a minimized window, a hidden pane) pauses the game and the sound
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (state.started && !state.paused) togglePause();
    audio.suspend();
  } else if (!state.started || !state.paused) audio.resume();
});
window.addEventListener('pagehide', () => audio.suspend());
function toggleMap() {
  if (!scene) return;
  const on = !scene.isMapView();
  scene.setMapView(on);
  $('btn-map').setAttribute('aria-pressed', String(on));
  $('btn-map').textContent = on ? 'Follow view' : 'Map view';
}
document.querySelectorAll('[data-diff]').forEach((b) => b.addEventListener('click', () => {
  state.difficulty = b.dataset.diff;
  document.querySelectorAll('[data-diff]').forEach((o) => o.classList.toggle('on', o === b));
  $('diff-note').textContent = DIFF_NOTE[state.difficulty];
}));
document.querySelectorAll('[data-diff]').forEach((o) => o.classList.toggle('on', o.dataset.diff === state.difficulty));
$('diff-note').textContent = DIFF_NOTE[state.difficulty];
$('btn-start').addEventListener('click', start);
$('btn-again').addEventListener('click', start);
$('btn-menu').addEventListener('click', () => { $('screen-end').hidden = true; $('screen-start').hidden = false; });
$('btn-newmap').addEventListener('click', () => { loadMap(Math.floor(Math.random() * 1e9)); start(); });
$('btn-restart').addEventListener('click', start);
$('btn-pause').addEventListener('click', togglePause);
$('btn-map').addEventListener('click', toggleMap);
$('btn-sound').addEventListener('click', () => {
  audio.setMuted(!audio.isMuted());
  $('btn-sound').textContent = audio.isMuted() ? 'Sound: off' : 'Sound: on';
});
$('tg-rel').addEventListener('change', (e) => { state.showRelations = e.target.checked; scene?.setOption('relations', e.target.checked); });

// ---- start -------------------------------------------------------------------------
// The 3D view is loaded separately so the minimap still runs if the CDN is unreachable.
async function boot() {
  try {
    const { makeScene3D } = await import('../render/scene3d.js');
    scene = makeScene3D($('scene'), palette);
  } catch (err) {
    console.error(err);
    $('viewer-fallback').hidden = false;
  }
  loadMap(CONFIG.seed);
  newGame(); // shows the forest behind the start screen
  requestAnimationFrame(loop);
}
boot();
// For testing: open the page with ?debug to reach the game state from the console.
if (new URLSearchParams(location.search).has('debug')) window.__frostroot = { state, keys };
