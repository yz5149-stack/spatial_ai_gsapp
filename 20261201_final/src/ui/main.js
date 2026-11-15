// The page: the store in 3D and in plan, the agents, the night's real conditions, and the designer's
// tools (edit by hand, choose between two variations, evolve over epochs).

import { CONFIG, CATS, CAT_LABEL, CAT_COLOR } from '../sim/config.js';
import { buildStore, randomGenome, mutateGenome, cloneGenome, newId, T, runCells } from '../sim/store.js';
import { makeSim, step, distances, coverage } from '../sim/sim.js';
import { computeLight, conditionsFrom, PRESETS } from '../sim/light.js';
import { OBJECTIVES } from '../sim/evolve.js';
import { drawPlan, fitCanvas, cellAt } from '../render/plan2d.js';
import { fetchDay } from './weather.js';
import { setSound, play as sound } from './audio.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const fmt = (v, d = 0) => (v == null || Number.isNaN(v) ? '–' : Number(v).toFixed(d));
const pct = (v) => (v == null ? '–' : `${Math.round(v * 100)}%`);
const SEC = CONFIG.tickSeconds;

const state = {
  tab: 'store', mode: 'watch', speed: 2, paused: false, layer: 'truth', cam: 'orbit', follow: null,
  tool: 'inspect', hover: -1, objective: 'haven', genome: null, world: null, sim: null,
  cond: null, condMeta: { preset: 'blizzard', source: 'built-in', hour: 21, hours: null, day: null },
  seed: 7, lastEvent: 0, lineage: [], choose: null, evo: { running: false, history: [], job: 0 },
};

// ---------------------------------------------------------------- 3D (optional: the page works without it)
let scene = null;
try {
  const mod = await import('../render/scene3d.js');
  scene = mod.makeScene3D($('scene'));
} catch (err) {
  console.warn('3D view unavailable', err);
  $('viewer-fallback').hidden = false;
}

const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
const jobs = new Map();
worker.onmessage = (e) => { const h = jobs.get(e.data.job); if (h) h(e.data); };
let jobSerial = 0;
function runJob(msg, handler) { const job = ++jobSerial; jobs.set(job, handler); worker.postMessage({ ...msg, job, cond: condPayload() }); return job; }
const condPayload = () => (state.cond ? { weather: state.cond.weather, date: state.cond.date.toISOString() } : null);

// ---------------------------------------------------------------- loading a store

function loadStore(genome, { keepView = false, reason = '' } = {}) {
  state.genome = genome;
  state.world = buildStore(genome);
  computeLight(state.world, state.cond);
  restartSim();
  if (scene) scene.setWorld(state.world, state.cond);
  if (!keepView && scene) scene.setCamera(state.mode === 'play' ? 'play' : state.cam === 'creature' ? 'follow' : state.cam, state.mode === 'play' ? state.sim.survivors[0].id : state.cam === 'creature' ? 'creature' : state.follow);
  $('store-id').textContent = `${genome.id}${genome.gen ? ` · gen ${genome.gen}` : ''}`;
  try { history.replaceState(null, '', `#store=${encodeGenome(genome)}`); } catch { /* ignore */ }
  sizePlan();
  if (reason) toast(reason);
  renderPanels(true);
}

function restartSim() {
  state.sim = makeSim(state.world, { seed: state.seed, cond: state.cond, human: state.mode === 'play' });
  state.lastEvent = 0;
  if (scene) scene.clearAgents();
  $('play-result').hidden = true;
}

function encodeGenome(g) {
  const { _m, edits, ...rest } = g;
  return btoa(unescape(encodeURIComponent(JSON.stringify(rest)))).replace(/=+$/, '');
}
function decodeGenome(s) { return JSON.parse(decodeURIComponent(escape(atob(s)))); }

// ---------------------------------------------------------------- the night's conditions (real data)

function setConditions(weather, date, meta = {}) {
  state.cond = conditionsFrom(weather, date);
  Object.assign(state.condMeta, meta);
  if (state.world) {
    computeLight(state.world, state.cond);
    if (scene) scene.setConditions(state.cond);
    state.sim.cond = state.cond;
  }
  renderConditions();
}

async function choosePreset(key) {
  state.condMeta.preset = key;
  if (key === 'live') {
    $('cond-status').textContent = 'Fetching the live forecast…';
    try {
      const day = await fetchDay(CONFIG.place, null);
      const now = new Date();
      const hr = day.hours.reduce((a, b) => (Math.abs(b.date - now) < Math.abs(a.date - now) ? b : a));
      state.condMeta.hours = day.hours;
      setConditions(hr.weather, now, { source: day.source, hour: hr.hour, day: hr.local.slice(0, 10) });
      $('cond-hour').value = hr.hour;
    } catch (err) {
      $('cond-status').textContent = `Live data could not load (${err.message}). Using the blizzard preset.`;
      return choosePreset('blizzard');
    }
    return;
  }
  const p = PRESETS[key];
  state.condMeta.hours = null;
  setConditions(p.weather, new Date(p.date), { source: 'built-in values', hour: p.archive.hour, day: p.archive.date, note: p.note });
  $('cond-hour').value = p.archive.hour;
  $('cond-status').textContent = 'Loading the historical archive…';
  try {
    const day = await fetchDay(CONFIG.place, p.archive.date);
    if (state.condMeta.preset !== key) return;
    state.condMeta.hours = day.hours;
    const hr = day.hours.find((h) => h.hour === p.archive.hour) ?? day.hours[0];
    setConditions(hr.weather, hr.date, { source: day.source, hour: hr.hour });
  } catch (err) {
    if (state.condMeta.preset === key) $('cond-status').textContent = `Archive unavailable (${err.message}); built-in values shown.`;
  }
}

function setHour(h) {
  const meta = state.condMeta;
  if (meta.hours) {
    const hr = meta.hours.find((x) => x.hour === h);
    if (hr) return setConditions(hr.weather, hr.date, { hour: h });
  }
  // no hourly data: keep the weather, move the sun
  const nyHour = Number(new Intl.DateTimeFormat('en-US', { timeZone: CONFIG.place.tz, hour: 'numeric', hourCycle: 'h23' }).format(state.cond.date));
  const d = new Date(state.cond.date.getTime() + (h - nyHour) * 3600e3);
  setConditions(state.cond.weather, d, { hour: h });
}

function renderConditions() {
  const c = state.cond; if (!c) return;
  const w = c.weather;
  $('cond-values').innerHTML = `
    <div><b>${fmt(w.temperature, 1)}°C</b><span>temperature</span></div>
    <div><b>${fmt(w.snowfall, 1)}</b><span>cm/h snow</span></div>
    <div><b>${fmt(w.wind, 0)}</b><span>km/h wind</span></div>
    <div><b>${fmt(c.cloud, 0)}%</b><span>cloud</span></div>
    <div><b>${fmt(c.sun.elevation, 0)}°</b><span>sun height</span></div>
    <div><b>${fmt(c.sun.azimuth, 0)}°</b><span>sun bearing</span></div>`;
  $('cond-effects').innerHTML = c.effects.map((e) => `<li>${e}</li>`).join('') + `<li>${pct(state.world?.sunShare ?? 0)} of the floor in direct sun</li>`;
  const local = c.date.toLocaleString('en-US', { timeZone: CONFIG.place.tz, dateStyle: 'medium', timeStyle: 'short' });
  $('cond-status').innerHTML = `<span class="src ${state.condMeta.source.startsWith('Open-Meteo') ? 'live' : ''}">${state.condMeta.source}</span> ${local} · ${CONFIG.place.name}`;
  $('cond-hour-label').textContent = `${String(state.condMeta.hour).padStart(2, '0')}:00`;
  $('hud-cond').textContent = `${c.isDay ? '☀' : '☾'} ${fmt(w.temperature, 0)}°C · ${fmt(w.snowfall, 1)} cm/h · ${local}`;
}

// ---------------------------------------------------------------- the loop

let last = performance.now(); let acc = 0; let panelT = 0; let heartT = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  const sim = state.sim;
  const speed = state.mode === 'play' ? 1 : state.speed;
  if (!state.paused && sim && state.tab === 'store') {
    acc += (dt * speed) / SEC;
    let n = 0;
    while (acc >= 1 && n < 40) { step(sim); acc -= 1; n++; }
  }
  // new events: sounds, toasts, effects
  const fresh = sim ? sim.events.filter((e) => e.n > state.lastEvent) : [];
  if (fresh.length) state.lastEvent = fresh[fresh.length - 1].n;
  for (const e of fresh) onEvent(e);
  if (scene && state.tab === 'store') scene.update(sim, { dt, alpha: Math.min(1, (dt * speed) / SEC), events: fresh, focusSurvivor: state.follow });
  if (state.tab === 'store') {
    panelT += dt;
    if (panelT > 0.2) { panelT = 0; renderPanels(); }
    hudDanger(dt);
  }
  if (state.tab === 'choose' && state.choose) chooseFrame(dt);
  heartT += dt;
  requestAnimationFrame(frame);
}

function hudDanger(dt) {
  const sim = state.sim; const c = sim.creature; const w = state.world;
  let d = 0;
  if (sim.phase === 'night') {
    if (c.state === 'chase') d = 1;
    else if (c.state === 'investigate') d = 0.45;
    const me = sim.survivors.find((s) => s.human && s.cell >= 0);
    if (me) {
      const dist = Math.hypot((me.cell % w.W) - (c.cell % w.W), Math.floor(me.cell / w.W) - Math.floor(c.cell / w.W));
      d = Math.max(d * (c.sees.includes(me) ? 1 : 0.6), Math.max(0, 1 - dist / 14));
      if (dist < 10 && heartT > 0.4 + dist * 0.08) { heartT = 0; sound('heart'); }
    }
  }
  const v = $('vignette'); const cur = Number(v.style.getPropertyValue('--d') || 0);
  v.style.setProperty('--d', (cur + (d - cur) * Math.min(1, dt * 4)).toFixed(3));
}

function onEvent(e) {
  const sim = state.sim;
  const who = sim.survivors.find((s) => s.id === e.who);
  if (e.type === 'caught') { sound('caught'); toast(`${who?.human ? 'You were' : `${who?.name} was`} caught`, 'bad'); if (who?.human) showPlayResult(who); }
  else if (e.type === 'escape') { sound('escape'); toast(`${who?.human ? 'You' : who?.name} escaped with ${who?.got.length}/${who?.list.length}`, 'good'); if (who?.human) showPlayResult(who); }
  else if (e.type === 'chase') { sound('chase'); }
  else if (e.type === 'pick') sound('pick');
  else if (e.type === 'slip') { sound('slip'); toast(`${who?.name ?? 'Someone'} slipped on the wet floor`); }
  else if (e.type === 'heard') { if (Math.random() < 0.3) sound('heard'); }
  else if (e.type === 'enter') sound('enter');
  else if (e.type === 'nightEnd') {
    if (state.mode === 'play') { const me = sim.survivors.find((s) => s.human); if (me && me.outcome === 'stranded') showPlayResult(me); }
  }
}

let toastTimer = null;
function toast(text, kind = '') {
  const t = $('toast'); t.textContent = text; t.className = `toast ${kind}`;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hide'), 2600);
}

// ---------------------------------------------------------------- panels

const STATE_TEXT = {
  enter: 'coming in', explore: 'mapping the store', roam: 'prowling', patrol: 'patrolling its hunting grounds', sweep: 'checking hiding places',
  investigate: 'going to a sound', chase: 'CHASING', search: 'searching', feed: 'feeding',
  waiting: 'outside in the snow', shop: 'shopping', flee: 'running to hide', hide: 'hiding, crouched', leave: 'heading out', dash: 'running for the door',
};

function renderPanels(force = false) {
  const sim = state.sim; const w = state.world;
  if (!sim) return;
  const c = sim.creature;
  $('hud-night').textContent = sim.phase === 'night' ? `Night ${sim.night}` : `Night ${sim.night} over`;
  const secs = sim.t * SEC;
  $('hud-clock').textContent = `${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, '0')}`;
  $('hud-creature').textContent = STATE_TEXT[c.state] ?? c.state;
  $('hud-creature').className = `chip creature ${c.state === 'chase' ? 'alert' : ''}`;
  $('hud-survivors').innerHTML = sim.survivors.map((s) => `<span class="chip s ${s.outcome ?? ''}" style="--c:${s.color}">${s.human ? 'YOU' : s.name} <b>${s.got.length}/${s.list.length}</b>${s.outcome === 'caught' ? ' ✕' : s.outcome === 'escaped' ? ' ✓' : ''}</span>`).join('');

  // the plan
  drawPlan($('plan'), w, { sim, layer: state.layer, survivorId: state.follow, hover: state.hover, highlight: state.hoverRun != null ? { run: state.hoverRun } : null });

  // creature card
  $('c-state').textContent = STATE_TEXT[c.state] ?? c.state;
  const nights = sim.nights;
  const tot = nights.reduce((a, n) => ({ s: a.s + n.survivors, c: a.c + n.caught, e: a.e + n.escaped }), { s: 0, c: 0, e: 0 });
  $('c-stats').innerHTML = stat('Mapped', pct(coverage(w, c.k))) + stat('Caught tonight', c.night?.catches ?? 0) + stat('Catch rate', tot.s ? pct(tot.c / tot.s) : '–') + stat('Landmarks', c.k.landmarks.length);
  $('c-senses').innerHTML = `<span class="tag ${c.hears ? 'on' : ''}">hears footsteps</span><span class="tag ${c.sees.length ? 'on red' : ''}">sees a survivor</span>`;

  // survivors
  const list = $('s-list');
  list.innerHTML = '';
  for (const s of sim.survivors) {
    const card = el('div', `surv ${s.outcome ?? ''} ${state.follow === s.id ? 'sel' : ''}`);
    card.style.setProperty('--c', s.color);
    const items = s.list.map((x) => `<span class="item ${s.got.includes(x) ? 'got' : ''}" style="--ic:${CAT_COLOR[x]}">${CAT_LABEL[x]}</span>`).join('');
    const planText = s.order?.length ? s.order.map((x) => (x === 'door' ? 'door' : x === 'explore' ? 'explore' : x === '?' ? '…' : CAT_LABEL[x])).join(' → ') : '';
    card.innerHTML = `<div class="surv-head"><i></i><b>${s.human ? 'You' : s.name}</b><span>${s.outcome ?? STATE_TEXT[s.state] ?? s.state}</span></div>
      <div class="items">${items}</div>
      ${s.cell >= 0 && !s.outcome ? `<div class="surv-plan">Plan: ${planText || '–'}</div><div class="surv-where">${w.addr[s.cell]}</div>` : ''}
      <div class="surv-meta">${fmt(s.dist, 0)} m walked · seen ${fmt(s.seenTicks * SEC, 0)} s</div>`;
    card.onclick = () => { state.follow = s.id; if (state.layer === 'creature') state.layer = 'survivor'; syncLayerButtons(); if (scene && state.cam === 'follow') scene.setCamera('follow', s.id); };
    list.appendChild(card);
  }

  // nights
  if (force || nights.length !== state._nightsDrawn) {
    state._nightsDrawn = nights.length;
    $('nights-body').innerHTML = nights.slice(-12).reverse().map((n) => `<tr><td>${n.night}</td><td>${n.escaped}/${n.survivors}</td><td>${n.caught}</td><td>${pct(n.items)}</td><td>${fmt(n.escapeTime, 0)} s</td><td>${fmt(n.firstCatch, 0)}${n.firstCatch != null ? ' s' : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">The first night is under way.</td></tr>';
    drawNightsChart();
    const sumS = tot.s || 1;
    $('score-summary').innerHTML = stat('Survivors escaped', pct(tot.e / sumS)) + stat('Caught', pct(tot.c / sumS)) + stat('Items found', pct(nights.reduce((a, n) => a + n.items, 0) / Math.max(1, nights.length))) + stat('Nights', nights.length);
  }

  // landmarks of the selected agent
  const k = state.layer === 'survivor' ? (sim.survivors.find((s) => s.id === state.follow) ?? sim.survivors.find((s) => s.cell >= 0))?.k : c.k;
  $('lm-title').textContent = k === c.k ? 'The creature’s landmarks' : `${k?.name ? sim.survivors.find((s) => s.k === k)?.name ?? '' : ''}’s landmarks`;
  $('lm-list').innerHTML = (k?.landmarks ?? []).slice(-14).reverse().map((l) => `<li><b class="lm ${l.kind}">${l.id}</b> ${l.note} <span>${l.text}</span></li>`).join('') || '<li class="muted">None yet.</li>';

  // log
  $('log').innerHTML = sim.log.slice(-40).reverse().map((l) => `<li class="${l.kind}"><span>N${l.night} ${fmt(l.t * SEC, 0)}s</span> ${l.text}</li>`).join('');

  // play HUD
  if (state.mode === 'play') {
    const me = sim.survivors.find((s) => s.human);
    if (me) $('play-list').innerHTML = me.list.map((x) => `<span class="item ${me.got.includes(x) ? 'got' : ''}" style="--ic:${CAT_COLOR[x]}">${me.got.includes(x) ? '✓ ' : ''}${CAT_LABEL[x]}</span>`).join('') + `<span class="pstate">${me.crouch ? 'crouching · quiet' : me.running ? 'running · loud' : 'walking'}</span>`;
  }
  inspect();
}

const stat = (label, value) => `<div class="stat"><b>${value}</b><span>${label}</span></div>`;

function drawNightsChart() {
  const cv = $('nights-chart'); const g = cv.getContext('2d');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = cv.clientWidth * dpr; const H = cv.clientHeight * dpr;
  cv.width = W; cv.height = H;
  g.clearRect(0, 0, W, H);
  const ns = state.sim.nights.slice(-30);
  g.strokeStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = 1;
  for (let k = 0; k <= 4; k++) { const y = 6 * dpr + (H - 12 * dpr) * (k / 4); g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  if (ns.length < 1) return;
  const xs = (i) => (ns.length === 1 ? W / 2 : (i / (ns.length - 1)) * (W - 12 * dpr) + 6 * dpr);
  const ys = (v) => 6 * dpr + (H - 12 * dpr) * (1 - v);
  for (const [key, color] of [['esc', '#5ff2c8'], ['cau', '#ff3b4e']]) {
    g.strokeStyle = color; g.lineWidth = 2 * dpr; g.beginPath();
    ns.forEach((n, i) => { const v = key === 'esc' ? n.escaped / Math.max(1, n.survivors) : n.caught / Math.max(1, n.survivors); if (i) g.lineTo(xs(i), ys(v)); else g.moveTo(xs(i), ys(v)); });
    g.stroke();
    g.fillStyle = color;
    ns.forEach((n, i) => { const v = key === 'esc' ? n.escaped / Math.max(1, n.survivors) : n.caught / Math.max(1, n.survivors); g.beginPath(); g.arc(xs(i), ys(v), 2.5 * dpr, 0, 7); g.fill(); });
  }
}

// ---------------------------------------------------------------- inspector: three locations, four distances

function inspect() {
  const i = state.hover; const w = state.world; const sim = state.sim;
  const box = $('inspector');
  if (i < 0 || !w) { box.innerHTML = '<p class="muted">Hover over the plan to read any spot in three frames of reference, and its distances to the creature.</p>'; return; }
  const x = i % w.W; const y = Math.floor(i / w.W);
  const top = w.solids[i].length ? w.solids[i][w.solids[i].length - 1][1] * 0.5 : 0;
  const c = sim.creature;
  const rel = (k) => {
    if (!k || !k.landmarks.length) return 'no landmarks yet';
    const lms = k.landmarks.filter((l) => !['heard', 'seen'].includes(l.kind));
    if (!lms.length) return 'no landmarks yet';
    const l = lms.reduce((a, b) => (Math.hypot(a.x - x, a.y - y) <= Math.hypot(b.x - x, b.y - y) ? a : b));
    const dx = (x - l.x) * 0.5; const dy = (y - l.y) * 0.5;
    const parts = [];
    if (dx) parts.push(`${Math.abs(dx)} m ${dx > 0 ? 'E' : 'W'}`); if (dy) parts.push(`${Math.abs(dy)} m ${dy > 0 ? 'S' : 'N'}`);
    return `${parts.join(', ') || 'at'} of ${l.id} (${l.note})`;
  };
  let dist = '';
  if (sim.phase === 'night' && w.walk[i]) {
    const d = distances(sim, c.cell, i);
    dist = `<h4>Distances from the creature</h4><dl class="kv">
      <dt>Straight line</dt><dd>${fmt(d.euclid, 1)} m</dd>
      <dt>Walking (path)</dt><dd>${d.path == null ? 'no way' : `${fmt(d.path, 1)} m`}</dd>
      <dt>Acoustic</dt><dd>${fmt(d.acoustic, 1)} m <small>(+ muffling of shelves)</small></dd>
      <dt>Effort (time)</dt><dd>${d.effort == null ? '–' : `${fmt(d.effort, 1)} s`} <small>(wet floor slows)</small></dd></dl>`;
  }
  const zoneName = ['open floor', 'wet floor (slow, slippery)', 'lights out (hard to see, easy to hide)', 'crushed bags (loud)', 'rubber mat (quiet)'][w.zone[i]];
  const surv = sim.survivors.find((s) => s.id === state.follow) ?? sim.survivors.find((s) => s.cell >= 0);
  box.innerHTML = `<h4>Where this is</h4><dl class="kv">
    <dt>1 · Metric</dt><dd>x ${fmt(x * 0.5 + 0.25, 2)} m, y ${fmt(y * 0.5 + 0.25, 2)} m${top ? `, top ${fmt(top, 2)} m` : ''}</dd>
    <dt>2 · Store address</dt><dd>${w.addr[i]}</dd>
    <dt>3 · Creature’s frame</dt><dd>${rel(c.k)}</dd>
    ${surv ? `<dt>3 · ${surv.human ? 'Your' : `${surv.name}’s`} frame</dt><dd>${rel(surv.k)}</dd>` : ''}
    <dt>Light</dt><dd>${fmt(w.light[i] * 100, 0)}%${w.sunlit[i] ? ' · direct sun' : ''}${w.walk[i] ? ` · ${zoneName}` : ''}</dd></dl>${dist}`;
}

// ---------------------------------------------------------------- the plan: hover and edit

function sizePlan() {
  const cv = $('plan');
  fitCanvas(cv, state.world, cv.parentElement.clientWidth);
}
window.addEventListener('resize', () => { if (state.world) sizePlan(); });

$('plan').addEventListener('mousemove', (ev) => {
  const i = cellAt($('plan'), state.world, ev);
  state.hover = i;
  state.hoverRun = i >= 0 && state.world.runOf[i] >= 0 ? state.world.runOf[i] : null;
});
$('plan').addEventListener('mouseleave', () => { state.hover = -1; state.hoverRun = null; });
$('plan').addEventListener('click', (ev) => {
  const i = cellAt($('plan'), state.world, ev);
  if (i >= 0) applyTool(i);
});

function applyTool(i) {
  const tool = state.tool; const w = state.world; const g = cloneGenome(state.genome);
  delete g._m;
  const x = i % w.W; const y = Math.floor(i / w.W);
  const run = w.runOf[i] >= 0 ? g.runs[w.runOf[i]] : null;
  let note = '';
  if (tool === 'inspect') {
    const s = state.sim.survivors.find((q) => q.cell === i);
    if (s) { state.follow = s.id; state.layer = 'survivor'; syncLayerButtons(); }
    return;
  }
  if (tool === 'height') { if (!run) return toast('Click a gondola'); run.tall = !run.tall; note = run.tall ? 'Raised to 72″ (1.83 m): hides a standing person' : 'Lowered to 54″ (1.37 m): you can see over it standing'; }
  else if (tool === 'turn') {
    if (!run) return toast('Click a gondola');
    const cx = run.dir === 'v' ? run.x + 1 : run.x + run.len / 2; const cy = run.dir === 'v' ? run.y + run.len / 2 : run.y + 1;
    run.dir = run.dir === 'v' ? 'h' : 'v'; run.x = Math.round(run.dir === 'v' ? cx - 1 : cx - run.len / 2); run.y = Math.round(run.dir === 'v' ? cy - run.len / 2 : cy - 1);
    note = 'Turned the gondola';
  } else if (tool === 'remove') {
    if (run) { g.runs.splice(g.runs.indexOf(run), 1); note = 'Removed the gondola'; }
    else if (w.type[i] === T.BOXES) { g.boxes = g.boxes.filter((b) => !(x >= b.x && x <= b.x + 1 && y >= b.y && y <= b.y + 1)); note = 'Cleared the cartons'; }
    else return toast('Click a gondola or cartons');
  } else if (tool === 'add') { g.runs.push({ x: x - 1, y: y - 3, len: 7, dir: 'v', tall: true, cat: 'food', sign: false }); note = 'Added a gondola (food)'; }
  else if (tool === 'products') { if (!run) return toast('Click a gondola'); const order = ['food', 'batteries', 'warmers', 'medicine']; run.cat = order[(order.indexOf(run.cat) + 1) % order.length]; note = `Now stocks ${CAT_LABEL[run.cat]}`; }
  else if (tool === 'sign') { if (!run) return toast('Click a gondola'); run.sign = !run.sign; note = run.sign ? 'Hung an aisle sign: survivors read the whole aisle from 6 m' : 'Took the sign down'; }
  else if (['wet', 'dark', 'noisy', 'mat'].includes(tool)) { g.zones.push({ kind: tool, x: x - 1, y: y - 1, w: tool === 'dark' ? 5 : 3, h: tool === 'dark' ? 5 : 3 }); note = `Painted ${tool} floor`; }
  else if (tool === 'erase') { const before = g.zones.length; g.zones = g.zones.filter((z) => !(x >= z.x && x < z.x + z.w && y >= z.y && y < z.y + z.h)); if (before === g.zones.length) return toast('No floor zone here'); note = 'Cleared the floor'; }
  else if (tool === 'boxes') { g.boxes.push({ x, y }); note = 'Stacked cartons'; }
  else if (tool === 'door') { if (y < w.H - 2) return toast('Click on the storefront (bottom edge)'); g.door = x - 1; note = 'Moved the front door'; }
  else if (tool === 'back') {
    if (y === 0) g.back = { side: 'N', pos: x }; else if (x === 0) g.back = { side: 'W', pos: y }; else if (x === w.W - 1) g.back = { side: 'E', pos: y };
    else return toast('Click on the back or side wall'); note = 'Moved the stockroom door';
  }
  const nw = buildStore(g);
  const lost = g.runs.length - nw.genome.runs.length + g.boxes.length - nw.genome.boxes.length;
  if (!nw.ok) return toast(nw.missing.length ? `That would cut off ${nw.missing.map((m) => CAT_LABEL[m].toLowerCase()).join(', ')}` : 'That would block the store', 'bad');
  if (lost > 0) return toast('No room there (a fixture needs 0.5 m clear around it)', 'bad');
  const ng = { ...nw.genome, id: newId(), parent: state.genome.id, gen: (state.genome.gen ?? 0) + 1, edits: [note] };
  loadStore(ng, { keepView: true, reason: note });
}

// ---------------------------------------------------------------- controls

function syncLayerButtons() { for (const b of document.querySelectorAll('[data-layer]')) b.classList.toggle('on', b.dataset.layer === state.layer); }
for (const b of document.querySelectorAll('[data-layer]')) b.onclick = () => { state.layer = b.dataset.layer; syncLayerButtons(); };
for (const b of document.querySelectorAll('[data-speed]')) b.onclick = () => { state.speed = Number(b.dataset.speed); for (const o of document.querySelectorAll('[data-speed]')) o.classList.toggle('on', o === b); };
for (const b of document.querySelectorAll('[data-tool]')) b.onclick = () => {
  state.tool = b.dataset.tool;
  for (const o of document.querySelectorAll('[data-tool]')) o.classList.toggle('on', o === b);
  $('tool-hint').textContent = b.title;
};
for (const b of document.querySelectorAll('[data-cam]')) b.onclick = () => {
  state.cam = b.dataset.cam;
  for (const o of document.querySelectorAll('[data-cam]')) o.classList.toggle('on', o === b);
  if (scene && state.mode !== 'play') scene.setCamera(state.cam === 'creature' ? 'follow' : state.cam, state.cam === 'creature' ? 'creature' : state.follow ?? state.sim.survivors.find((s) => s.cell >= 0)?.id);
};
$('btn-pause').onclick = () => { state.paused = !state.paused; $('btn-pause').textContent = state.paused ? 'Play' : 'Pause'; };
$('btn-ff').onclick = () => {
  const sim = state.sim; const target = sim.nights.length + 10; let guard = 0;
  while (sim.nights.length < target && guard++ < 200000) step(sim);
  state.lastEvent = sim.eventSerial;
  if (scene) scene.clearAgents();
  if (state.layer === 'truth') { state.layer = 'trails'; syncLayerButtons(); }
  renderPanels(true); toast('Ran 10 more nights');
};
$('btn-new').onclick = () => loadStore(randomGenome(Math.floor(Math.random() * 1e9)), { reason: 'A new store' });
$('btn-restart').onclick = () => { restartSim(); renderPanels(true); };
$('btn-sound').onclick = () => { const on = $('btn-sound').dataset.on !== '1'; setSound(on); $('btn-sound').dataset.on = on ? '1' : '0'; $('btn-sound').textContent = on ? 'Sound on' : 'Sound off'; };
$('btn-share').onclick = async () => { try { await navigator.clipboard.writeText(location.href); toast('Link to this store copied'); } catch { toast('Copy the address bar to share this store'); } };
$('cond-preset').onchange = (e) => choosePreset(e.target.value);
$('cond-hour').oninput = (e) => setHour(Number(e.target.value));
$('btn-start').onclick = () => { $('screen-start').hidden = true; state.paused = false; };

function setMode(m) {
  state.mode = m;
  for (const b of document.querySelectorAll('[data-mode]')) b.classList.toggle('on', b.dataset.mode === m);
  document.body.classList.toggle('playing', m === 'play');
  restartSim();
  if (scene) scene.setCamera(m === 'play' ? 'play' : state.cam, m === 'play' ? state.sim.survivors[0].id : state.follow);
  if (m === 'play') { state.follow = state.sim.survivors[0].id; $('play-help').hidden = false; state.paused = true; }
  else { $('play-help').hidden = true; state.paused = false; }
  renderPanels(true);
}
for (const b of document.querySelectorAll('[data-mode]')) b.onclick = () => setMode(b.dataset.mode);
$('btn-play-go').onclick = () => { $('play-help').hidden = true; state.paused = false; $('scene').focus?.(); };
$('btn-play-again').onclick = () => { setMode('play'); };
function showPlayResult(me) {
  const r = $('play-result'); r.hidden = false;
  const won = me.outcome === 'escaped';
  $('play-result-title').textContent = won ? (me.got.length === me.list.length ? 'You made it out with everything' : 'You made it out') : me.outcome === 'caught' ? 'The creature caught you' : 'Dawn came first';
  $('play-result-body').innerHTML = `${me.got.length}/${me.list.length} items · ${fmt((me.outT - me.inT) * SEC, 0)} s inside · ${fmt(me.dist, 0)} m walked · seen for ${fmt(me.seenTicks * SEC, 0)} s`;
  r.className = `play-result ${won ? 'good' : 'bad'}`;
}

// keyboard: watch shortcuts, and the player's survivor
const keys = new Set();
window.addEventListener('keydown', (e) => {
  if (e.target.matches?.('input, select, textarea')) return;
  keys.add(e.key.toLowerCase());
  if (state.mode === 'play' && ['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(e.key.toLowerCase())) e.preventDefault();
  if (e.key === ' ' && state.mode !== 'play') { e.preventDefault(); $('btn-pause').click(); }
  syncInput();
});
window.addEventListener('keyup', (e) => { keys.delete(e.key.toLowerCase()); syncInput(); });
window.addEventListener('blur', () => { keys.clear(); syncInput(); });
function syncInput() {
  const inp = state.sim?.input; if (!inp) return;
  inp.dx = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
  inp.dy = (keys.has('s') || keys.has('arrowdown') ? 1 : 0) - (keys.has('w') || keys.has('arrowup') ? 1 : 0);
  inp.run = keys.has('shift');
  inp.crouch = keys.has('c') || keys.has('control');
}

// tabs
for (const b of document.querySelectorAll('[data-tab]')) b.onclick = () => setTab(b.dataset.tab);
function setTab(t) {
  state.tab = t;
  for (const b of document.querySelectorAll('[data-tab]')) b.classList.toggle('on', b.dataset.tab === t);
  for (const s of document.querySelectorAll('.tab')) s.hidden = s.id !== `tab-${t}`;
  if (t === 'store') { sizePlan(); scene?.resize(); }
  if (t === 'choose' && !state.choose) newPair(state.genome);
  if (t === 'evolve') drawEvoChart();
}

// ---------------------------------------------------------------- Choose: two variations side by side

const CHOOSE_SEEDS = [11, 23];
function newPair(parent) {
  const strength = Number($('choose-strength').value);
  const A = mutateGenome(parent, Math.floor(Math.random() * 1e9), CONFIG, strength);
  const B = mutateGenome(parent, Math.floor(Math.random() * 1e9), CONFIG, strength);
  if (!state.lineage.length || state.lineage[state.lineage.length - 1].genome.id !== parent.id) state.lineage.push({ genome: parent, m: parent._m ?? null });
  const mk = (g) => { const w = buildStore(g); computeLight(w, state.cond); return { genome: g, world: w, sim: makeSim(w, { seed: 5, cond: state.cond }), m: null, acc: 0 }; };
  state.choose = { parent, A: mk(A), B: mk(B) };
  for (const side of ['A', 'B']) {
    const cv = $(`choose-${side}-plan`); fitCanvas(cv, state.choose[side].world, cv.parentElement.clientWidth);
    $(`choose-${side}-edits`).innerHTML = (state.choose[side].genome.edits ?? []).map((e) => `<li>${e}</li>`).join('');
    $(`choose-${side}-stats`).innerHTML = '<p class="muted">Running 2 × 6 nights…</p>';
  }
  $('choose-parent').textContent = `Both are variations of ${parent.id}${parent.gen ? ` (generation ${parent.gen})` : ''}.`;
  renderLineage();
  const objective = $('choose-objective').value;
  const pending = [state.choose.A.genome, state.choose.B.genome];
  if (!parent._m) pending.push(parent);
  const pair = state.choose;
  runJob({ cmd: 'evaluate', genomes: pending, nights: 6, seeds: CHOOSE_SEEDS, objective }, (msg) => {
    if (msg.type !== 'evaluated' || state.choose !== pair) return;
    if (msg.id === pair.A.genome.id) pair.A.m = msg.m;
    else if (msg.id === pair.B.genome.id) pair.B.m = msg.m;
    else if (msg.id === parent.id) { parent._m = msg.m; renderLineage(); }
    renderChooseStats();
  });
}

function renderChooseStats() {
  const { A, B, parent } = state.choose;
  const base = parent._m;
  const rows = [
    ['Survivors escape', (m) => m.escapeRate, pct, true],
    ['Survivors caught', (m) => m.catchRate, pct, false],
    ['Items found', (m) => m.items, pct, true],
    ['Time to escape', (m) => m.escapeTime, (v) => `${fmt(v, 0)} s`, false],
    ['Seen by the creature', (m) => m.exposure, (v) => `${fmt(v, 1)} s`, false],
    ['Creature learns', (m) => m.learning, (v) => `${v > 0 ? '+' : ''}${fmt(v * 100, 0)} pts`, false],
  ];
  const obj = OBJECTIVES[$('choose-objective').value];
  for (const [side, me, other] of [['A', A, B], ['B', B, A]]) {
    if (!me.m) continue;
    const better = other.m ? me.m.fitness >= other.m.fitness : false;
    $(`choose-${side}`).classList.toggle('winner', !!other.m && better);
    $(`choose-${side}-stats`).innerHTML = `<div class="fit"><b>${fmt(me.m.fitness, 1)}</b><span>${obj.label} score${base ? ` · parent ${fmt(base.fitness, 1)}` : ''}</span></div>` +
      rows.map(([label, get, f]) => {
        const v = get(me.m); const o = other.m ? get(other.m) : null;
        const max = Math.max(Math.abs(v ?? 0), Math.abs(o ?? 0), label.startsWith('Time') ? 1 : label.startsWith('Seen') ? 1 : 0.01);
        return `<div class="bar"><span>${label}</span><i style="--w:${Math.max(2, (Math.abs(v ?? 0) / max) * 100)}%"></i><b>${v == null ? '–' : f(v)}</b></div>`;
      }).join('');
  }
}

function chooseFrame(dt) {
  for (const side of ['A', 'B']) {
    const c = state.choose[side];
    c.acc += (dt * 4) / SEC;
    let n = 0; while (c.acc >= 1 && n < 30) { step(c.sim); c.acc -= 1; n++; }
    drawPlan($(`choose-${side}-plan`), c.world, { sim: c.sim, layer: $('choose-layer').value });
    $(`choose-${side}-live`).textContent = `night ${c.sim.night} · ${c.sim.nights.reduce((a, x) => a + x.escaped, 0)} escaped · ${c.sim.nights.reduce((a, x) => a + x.caught, 0)} caught`;
  }
}

function pick(side) {
  const c = state.choose[side];
  c.genome._m = c.m;
  state.lineage.push({ genome: c.genome, m: c.m });
  toast(`Kept ${side}. Two new variations of it…`);
  newPair(c.genome);
}
$('choose-A-pick').onclick = () => pick('A');
$('choose-B-pick').onclick = () => pick('B');
$('choose-A-open').onclick = () => { loadStore(state.choose.A.genome); setTab('store'); };
$('choose-B-open').onclick = () => { loadStore(state.choose.B.genome); setTab('store'); };
$('choose-reroll').onclick = () => newPair(state.choose.parent);
$('choose-from-store').onclick = () => { state.lineage = []; newPair(state.genome); };

function renderLineage() {
  const box = $('lineage'); box.innerHTML = '';
  state.lineage.forEach((l, idx) => {
    const card = el('button', 'thumb');
    const cv = el('canvas'); card.appendChild(cv);
    card.appendChild(el('span', '', `${idx === 0 ? 'start' : `pick ${idx}`} · ${l.genome.id}${l.m ? ` · ${fmt(l.m.fitness, 0)}` : ''}`));
    card.title = 'Branch again from here';
    card.onclick = () => { state.lineage = state.lineage.slice(0, idx); newPair(l.genome); };
    box.appendChild(card);
    const w = buildStore(l.genome); fitCanvas(cv, w, 150); drawPlan(cv, w, { thumb: true });
  });
}

// ---------------------------------------------------------------- Evolve: epochs of generated stores

$('evo-run').onclick = () => {
  if (state.evo.running) return;
  const params = {
    popSize: Number($('evo-pop').value), epochs: Number($('evo-epochs').value), nights: Number($('evo-nights').value),
    objective: $('evo-objective').value, seeds: [11, 23], seed: Math.floor(Math.random() * 1e9),
    start: $('evo-start').value === 'store' ? (({ _m, ...g }) => g)(state.genome) : null,
  };
  state.evo = { running: true, history: [], params, population: [] };
  $('evo-run').disabled = true; $('evo-stop').disabled = false;
  $('evo-gallery').innerHTML = ''; $('evo-pop-grid').innerHTML = '';
  const total = params.popSize * params.epochs;
  let scored = 0;
  runJob({ cmd: 'evolve', params }, (msg) => {
    if (msg.type === 'scored') {
      scored++;
      $('evo-progress').style.setProperty('--p', `${(scored / total) * 100}%`);
      $('evo-status').textContent = `Epoch ${msg.epoch}/${params.epochs} · store ${msg.done}/${msg.of} scored ${fmt(msg.fitness, 1)}`;
    } else if (msg.type === 'epoch') {
      state.evo.history.push(msg);
      drawEvoChart(); addGalleryCard(msg); renderPopulation(msg);
    } else if (msg.type === 'evolveDone') {
      state.evo.running = false;
      $('evo-run').disabled = false; $('evo-stop').disabled = true;
      const h = state.evo.history;
      $('evo-status').textContent = `${msg.stopped ? 'Stopped' : 'Done'}: ${h.length} epochs, ${h.length * params.popSize} stores generated and scored.` + (h.length ? ` Best ${fmt(h[h.length - 1].best, 1)} (from ${fmt(h[0].best, 1)} in epoch 1).` : '');
      $('evo-progress').style.setProperty('--p', '100%');
    }
  });
};
$('evo-stop').onclick = () => worker.postMessage({ cmd: 'stop' });

function drawEvoChart() {
  const cv = $('evo-chart'); const g = cv.getContext('2d');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = cv.clientWidth * dpr; const H = cv.clientHeight * dpr;
  if (!W) return;
  cv.width = W; cv.height = H;
  g.clearRect(0, 0, W, H);
  const h = state.evo.history;
  const L = 40 * dpr; const R = 12 * dpr; const Tp = 14 * dpr; const B = 26 * dpr;
  g.font = `${11 * dpr}px Inter, system-ui`; g.fillStyle = '#8d99aa';
  if (!h.length) { g.fillText('Run an evolution to see the score of each epoch.', L, H / 2); return; }
  const vals = h.flatMap((e) => [e.best, e.mean, e.worst]);
  let lo = Math.min(...vals); let hi = Math.max(...vals);
  if (hi - lo < 5) { hi += 2.5; lo -= 2.5; }
  const n = Math.max(2, state.evo.params.epochs);
  const xs = (i) => L + ((i) / (n - 1)) * (W - L - R);
  const ys = (v) => Tp + (1 - (v - lo) / (hi - lo)) * (H - Tp - B);
  g.strokeStyle = 'rgba(255,255,255,0.07)'; g.lineWidth = 1;
  for (let k = 0; k <= 4; k++) { const v = lo + (hi - lo) * (k / 4); const y = ys(v); g.beginPath(); g.moveTo(L, y); g.lineTo(W - R, y); g.stroke(); g.fillText(fmt(v, 0), 4 * dpr, y + 4 * dpr); }
  for (let i = 0; i < n; i++) g.fillText(`${i + 1}`, xs(i) - 3 * dpr, H - 8 * dpr);
  // band between worst and best
  g.fillStyle = 'rgba(95,242,200,0.08)'; g.beginPath();
  h.forEach((e, i) => (i ? g.lineTo(xs(i), ys(e.best)) : g.moveTo(xs(i), ys(e.best))));
  for (let i = h.length - 1; i >= 0; i--) g.lineTo(xs(i), ys(h[i].worst));
  g.closePath(); g.fill();
  for (const [key, color, wdt] of [['mean', '#7aa7ff', 1.5], ['best', '#5ff2c8', 2.5]]) {
    g.strokeStyle = color; g.lineWidth = wdt * dpr; g.beginPath();
    h.forEach((e, i) => (i ? g.lineTo(xs(i), ys(e[key])) : g.moveTo(xs(i), ys(e[key]))));
    g.stroke();
    g.fillStyle = color; h.forEach((e, i) => { g.beginPath(); g.arc(xs(i), ys(e[key]), 3 * dpr, 0, 7); g.fill(); });
  }
  g.fillStyle = '#5ff2c8'; g.fillText('— best', L + 8 * dpr, H - B - 8 * dpr); g.fillStyle = '#7aa7ff'; g.fillText('— mean', L + 60 * dpr, H - B - 8 * dpr); g.fillStyle = 'rgba(95,242,200,0.5)'; g.fillText('band: best to worst', L + 116 * dpr, H - B - 8 * dpr);
}

function thumbCard(genome, m, label) {
  const card = el('button', 'thumb big');
  const cv = el('canvas'); card.appendChild(cv);
  card.appendChild(el('span', '', `${label} · <b>${fmt(m.fitness, 1)}</b>`));
  card.appendChild(el('small', '', `escape ${pct(m.escapeRate)} · caught ${pct(m.catchRate)} · items ${pct(m.items)}`));
  card.onclick = () => { const g = { ...genome, _m: m }; loadStore(g, { reason: `Opened ${genome.id}` }); setTab('store'); };
  const w = buildStore(genome); computeLight(w, state.cond);
  requestAnimationFrame(() => { fitCanvas(cv, w, 200); drawPlan(cv, w, { thumb: true }); });
  return card;
}
function addGalleryCard(msg) {
  const card = thumbCard(msg.bestGenome, msg.bestM, `Epoch ${msg.epoch} best`);
  $('evo-gallery').appendChild(card);
}
function renderPopulation(msg) {
  const box = $('evo-pop-grid'); box.innerHTML = '';
  msg.population.forEach((p, i) => box.appendChild(thumbCard(p.genome, p.m, `#${i + 1}`)));
  $('evo-pop-title').textContent = `Epoch ${msg.epoch}: every store, ranked`;
}

// ---------------------------------------------------------------- start

for (const [k, o] of Object.entries(OBJECTIVES)) for (const id of ['choose-objective', 'evo-objective']) { const op = el('option', '', o.label); op.value = k; $(id).appendChild(op); }
$('choose-objective').onchange = () => { $('choose-obj-blurb').textContent = OBJECTIVES[$('choose-objective').value].blurb; if (state.choose) newPair(state.choose.parent); };
$('evo-objective').onchange = () => { $('evo-obj-blurb').textContent = OBJECTIVES[$('evo-objective').value].blurb; };
$('choose-obj-blurb').textContent = OBJECTIVES.haven.blurb; $('evo-obj-blurb').textContent = OBJECTIVES.haven.blurb;

const P0 = PRESETS.blizzard;
setConditions(P0.weather, new Date(P0.date), { source: 'built-in values', hour: 21, day: P0.archive.date });
let g0 = null;
const m = location.hash.match(/store=([^&]+)/);
if (m) { try { g0 = decodeGenome(m[1]); g0.id = g0.id ?? newId(); if (!buildStore(g0).ok) g0 = null; } catch { g0 = null; } }
loadStore(g0 ?? randomGenome(20261201));
state.paused = true;
choosePreset('blizzard');
requestAnimationFrame(frame);
void runCells; void CATS;
