// The page: three parts. Watch: the week on 125th Street, drawn as an axonometric, live. 02 Design: the
// environment designer. 03 Data: the real data behind it.

import { CONFIG } from '../sim/config.js';
import { buildCity, describeLocation } from '../sim/city.js';
import { newSim, stepSim, hourOf, dayOf, minuteOfDay, RAT_MODES, INSPECTOR_MODES, placeName, log, fx, inShift } from '../sim/sim.js';
import { makeDesign, cloneDesign } from '../sim/design.js';
import { makePlan, drawMind } from '../render/plan.js';
import { bagIcon } from '../render/icons.js';
import { makeDesigner } from './designer.js?v=8';

const $ = (id) => document.getElementById(id);
const DATA_URL = new URL('../../data/manhattanville.json', import.meta.url).href;

const state = {
  city: null, sim: null, scenario: 'now', design: makeDesign('now'),
  speed: 'story', paused: false, trails: true, started: false, acc: 0, last: 0,
  layer: 'none', tool: 'select', view: 'auto', slowmo: true, chaseUntil: 0, chaser: null, selected: null,
  page: 'watch', lastPanel: 0, cloud: null, dplan: null, preview: null,
};

function flash(text) {
  $('toast').textContent = text; $('toast').classList.remove('hide');
  clearTimeout(flash.t); flash.t = setTimeout(() => $('toast').classList.add('hide'), 2600);
}
function banner(html, ms = 5000) {
  $('banner').innerHTML = html; $('banner').classList.remove('hide');
  clearTimeout(banner.t); banner.t = setTimeout(() => $('banner').classList.add('hide'), ms);
}

// ---- running ---------------------------------------------------------------------------------------
function designFor(scenario) { return scenario === 'design' ? cloneDesign(state.design) : makeDesign(scenario); }
function restart(scenario = state.scenario) {
  state.scenario = scenario; $('scenario').value = scenario;
  state.sim = newSim(state.city, designFor(scenario));
  state.selected = null; feedSeq = -1;
  $('feed').innerHTML = '<li class="empty">The patrol starts at 7 pm.</li>';
  // the first night starts in the evening, just before the rats come out
  while (minuteOfDay(state.sim) !== 18 * 60 + 20) stepSim(state.sim);
  state.cloud?.invalidate();
  drawDesignPlan();
  panels();
}

function loop(now) {
  const dt = Math.min(250, now - (state.last || now)); state.last = now;
  const sim = state.sim;
  if (sim && state.started && !state.paused) {
    const chasing = sim.inspectors.find((i) => i.mode === 'chase');
    if (chasing) { state.chaser = chasing; state.chaseUntil = now + 2600; }
    // a rat hit by a car: slow down and look
    const hit = sim.fx.filter((f) => f.kind === 'roadkill' && f.seq > (state.hitSeen ?? 0)).pop();
    if (hit) { state.hitSeen = hit.seq; state.slowUntil = now + 2600; if (state.view === 'auto' && !chasing) state.cloud?.focusOn(hit.cell); }
    // Story: one minute of the night every second or so; chases in slow motion; the day skipped
    let speed = state.speed;
    if (speed === 'story') {
      const h = hourOf(sim);
      if (h >= 6.6 && h < 18.3) { while (minuteOfDay(sim) !== 18 * 60 + 20 && sim.t < sim.cfg.days * 1440) stepSim(sim); banner('The day passes. Bags go out again tonight.', 2500); }
      speed = chasing || now < state.chaseUntil || now < (state.slowUntil ?? 0) ? 0.35 : 1.6;
    } else if (chasing || now < state.chaseUntil || now < (state.slowUntil ?? 0)) speed = Math.min(speed, 0.6);
    state.acc += (dt / 1000) * speed;
    let n = 0;
    while (state.acc >= 1 && n < 900) { stepSim(sim); state.acc -= 1; n++; }
    if (sim.t >= sim.cfg.days * 1440) { state.paused = true; $('btn-pause').textContent = '▶'; flash('The week is over. Restart, or change the rules.'); }
  }
  if (sim && state.page === 'watch' && state.cloud) {
    const follow = state.view === 'auto' && now < state.chaseUntil && state.chaser ? state.chaser : null;
    const frac = state.speed === 'story' || state.speed <= 3 || follow ? state.acc : 1;
    try { state.cloud.frame(sim, { layer: state.layer, selected: state.selected, now, hourFrac: hourOf(sim), frac, follow, trails: state.trails }); } catch (err) { console.error(err); }
  }
  if (sim && now - state.lastPanel > 200) { panels(); state.lastPanel = now; }
  requestAnimationFrame(loop);
}

// ---- the HUD ---------------------------------------------------------------------------------------
const pct24 = (h) => ((((h - 12) % 24) + 24) % 24 / 24) * 100;
function band(el, from, to) {
  const a = pct24(from); let b = pct24(to); if (b <= a) b += 100;
  el.style.marginLeft = `${a}%`; el.style.width = `${Math.min(100 - a, b - a)}%`;
}
function phaseText(sim) {
  const h = hourOf(sim); const d = sim.design; const C = sim.cfg;
  const patrol = h >= C.inspector.shift[0] || h < C.inspector.shift[1];
  const ratsOut = h >= C.rat.activeFrom || h < C.rat.activeTo;
  if (!ratsOut && h >= 12 && h < d.setOut) return `Evening. Trash bags go out at ${d.setOut > 12 ? d.setOut - 12 : d.setOut} pm.`;
  if (ratsOut && patrol) return 'Night. Rats are foraging; the patrol is out with flashlights.';
  if (ratsOut) return 'Late night. The patrol has gone home; the rats have the street.';
  if (h < 12) return 'Morning. Trucks collect the bags; the rats sleep.';
  return 'Day. The rats sleep in their burrows.';
}

// one sentence, top centre: what is happening right now, for someone who has just arrived
function headline(sim) {
  const city = sim.city; const where = (c) => placeName(city, c);
  const recent = sim.fx.filter((f) => (f.kind === 'caught' || f.kind === 'missed' || f.kind === 'roadkill') && sim.t - f.t <= 10).pop();
  const chase = sim.inspectors.find((i) => i.mode === 'chase' && i.chase);
  if (recent && (!chase || recent.t >= sim.t - 2)) {
    const ins = sim.inspectors.find((i) => i.id === recent.who)?.name ?? 'The inspector';
    if (recent.kind === 'roadkill') return ['chase', `Bang! A car hit a rat crossing ${where(recent.cell)}.`];
    if (recent.kind === 'caught') return ['caught', `Caught! ${ins} got the rat on ${where(recent.cell)}.`];
    return ['', recent.burrow ? `The rat escaped into its burrow, but ${ins} now knows where the burrow is.` : `Missed. The rat got away from ${ins} on ${where(recent.cell)}.`];
  }
  if (chase) return ['chase', `${chase.name} is chasing a rat on ${where(chase.cell)}.`];
  const h = hourOf(sim); const C = sim.cfg; const d = sim.design;
  const out = sim.rats.filter((r) => r.alive && r.mode !== 'home').length;
  const patrol = inShift(C.inspector, h);
  const ratsOut = h >= C.rat.activeFrom || h < C.rat.activeTo;
  if (!ratsOut && h >= 12) return ['', `Evening on 125th Street. Trash goes out at ${d.setOut > 12 ? d.setOut - 12 : d.setOut} pm, and the rats wait for dark.`];
  if (ratsOut && out && patrol) return ['', `${out} rats are out looking for trash. ${sim.inspectors.filter((i) => i.mode !== 'off').length} inspectors patrol with flashlights (yellow cones).`];
  if (ratsOut && out) return ['', `${out} rats are out. The patrol has gone home, so the street is theirs until dawn.`];
  if (ratsOut) return ['', patrol ? 'The rats are still in their burrows. The patrol is starting its rounds.' : 'Quiet. The rats are in their burrows.'];
  return ['', 'Morning. Trucks take the bags away and the rats sleep. Press Next night.'];
}

function panels() {
  const sim = state.sim; if (!sim) return;
  const m = minuteOfDay(sim);
  $('clock').textContent = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const night = dayOf(sim) + (hourOf(sim) < 12 ? 0 : 1);
  $('day').textContent = `Night ${Math.max(1, night)} of ${sim.cfg.days}`;
  $('phase').textContent = phaseText(sim);
  const [cls, text] = headline(sim);
  if ($('headline').textContent !== text) $('headline').textContent = text;
  $('headline').className = `headline ${cls}`;
  band($('tl-bags'), sim.design.setOut, sim.design.pickup === 'night' ? 3 : 9);
  band($('tl-rats'), sim.cfg.rat.activeFrom, sim.cfg.rat.activeTo);
  band($('tl-patrol'), sim.cfg.inspector.shift[0], sim.cfg.inspector.shift[1]);
  $('tl-now').style.left = `calc(66px + (100% - 66px) * ${pct24(hourOf(sim)) / 100})`;
  $('n-rats').textContent = sim.rats.filter((r) => r.alive).length;
  $('n-caught').textContent = sim.totals.caught;
  $('n-missed').textContent = sim.totals.missed;
  $('n-car').textContent = sim.totals.deaths.car ?? 0;
  feed(sim);
  agentCard(sim, state.selected);
}

const KIND = { spot: ['Spotted', 'k-spot'], caught: ['Caught', 'k-caught'], missed: ['Got away', 'k-missed'], bag: ['Trash', 'k-bag'], roadkill: ['Car', 'k-car'] };
let feedSeq = -1;
function feed(sim) {
  if (sim.fxSeq === feedSeq) return;
  feedSeq = sim.fxSeq;
  const items = sim.fx.filter((f) => KIND[f.kind]).slice(-12).reverse();
  if (!items.length) return;
  $('feed').innerHTML = items.map((f) => {
    const [label, cls] = f.burrow ? ['Burrow', 'k-burrow'] : KIND[f.kind];
    const ins = sim.inspectors.find((i) => i.id === f.who)?.name ?? '';
    const what = { spot: `${ins} spots a rat`, caught: `${ins} catches it`, missed: f.burrow ? 'Into its burrow — burrow found' : `It gets away from ${ins}`, dodge: 'The rat dodges', bag: 'You dropped a trash bag', roadkill: 'A car hit a rat' }[f.kind];
    const m = (sim.cfg.startHour * 60 + f.t) % 1440;
    return `<li data-cell="${f.cell}"><b class="${cls}">${label}</b><span>${what}<br><small>${placeName(sim.city, f.cell)}</small></span><small>${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}</small></li>`;
  }).join('');
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
  $('agent-card').classList.toggle('hide', !a);
  if (!a) return;
  const city = sim.city; const loc = describeLocation(city, a.cell); const facts = [];
  if (a.kind === 'rat') {
    const col = sim.colonies[a.colony];
    $('a-dot').style.background = 'var(--rat)'; $('a-name').textContent = `Rat #${a.id}`;
    $('a-mode').textContent = a.alive ? (a.deathAt >= 0 ? `${RAT_MODES[a.mode]} · poisoned` : RAT_MODES[a.mode]) : 'Dead';
    facts.push(['GOAL', 'Eat a night\'s food, get home before light']);
    facts.push(['FED', `${Math.round(Math.min(1, a.fed / sim.cfg.rat.need) * 100)}% of tonight's need`]);
    facts.push(['COLONY', `${col.name} · ${sim.rats.filter((r) => r.alive && r.colony === col.id).length} rats`]);
    const mem = a.memFood.slice().sort((x, y) => y.got - x.got)[0];
    facts.push(['REMEMBERS', a.memFood.length ? `${a.memFood.length} food spots; best ${rel(city, a.home, mem.cell)} of its burrow` : 'nothing yet']);
    const chased = a.memDanger.filter((d) => d.chased).length;
    if (chased) facts.push(['AVOIDS', `${chased} place${chased > 1 ? 's' : ''} it was chased`]);
    if (a.path && a.targetKind) facts.push(['HEADING', `${{ smell: 'food it smells', memory: 'a spot it remembers', explore: 'new ground', home: 'its burrow', cover: 'cover' }[a.targetKind]} · ${metres(a.path.length - a.pi)} to go`]);
    facts.push(['RAN', metres(a.distance)]);
  } else {
    $('a-dot').style.background = 'var(--gold)'; $('a-name').textContent = a.name;
    $('a-mode').textContent = INSPECTOR_MODES[a.mode] ?? a.mode;
    facts.push(['GOAL', 'Answer 311 calls; find and treat burrows']);
    facts.push(['NOW', a.mode === 'chase' ? 'Running after a rat' : (a.job?.why ?? '—')]);
    facts.push(['CHASES', `${a.stats.spotted} spotted · ${a.stats.caught} caught · ${a.stats.missed} missed`]);
    facts.push(['INSPECTED', `${a.stats.inspections} addresses · ${a.stats.failed} failed`]);
    facts.push(['BURROWS', `${a.stats.burrows} baited and sealed`]);
    facts.push(['WALKED', `${(a.stats.walkedM / 1000).toFixed(1)} km`]);
  }
  facts.push(['WHERE', loc.street]);
  facts.push(['LON, LAT', `${loc.lonlat[0]}, ${loc.lonlat[1]} · ${loc.elevation} m`]);
  facts.push(['GRID', `${loc.metres.east} m E, ${loc.metres.south} m S of the corner`]);
  $('a-facts').innerHTML = facts.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  drawMind($('mind'), sim, a);
}

// ---- picking ---------------------------------------------------------------------------------------
function nearestAgent(sim, cell) {
  const W = sim.W; const x = cell % W; const y = Math.floor(cell / W);
  let best = null; let bd = 5;
  for (const a of [...sim.inspectors.filter((i) => i.mode !== 'off' && i.mode !== 'done'), ...sim.rats.filter((r) => r.alive && r.mode !== 'home')]) {
    const d = Math.hypot((a.cell % W) - x, Math.floor(a.cell / W) - y);
    if (d < bd) { bd = d; best = a; }
  }
  return best;
}
function pick(cell) {
  const sim = state.sim;
  if (cell < 0 || !sim) return;
  if (state.tool === 'bag') { dropBag(cell); return; }
  state.selected = nearestAgent(sim, cell);
  panels();
}
function dropBag(cell) {
  const sim = state.sim;
  if (!sim.city.walk[cell]) { flash('Drop it on a sidewalk or a street.'); return; }
  const s = { id: sim.sources.length, kind: 'bag', cell, amount: 3, name: 'Your trash bag', binned: false, out: -1, pickup: -1, access: 1, amt: 3, store: 0, isOut: false, eaten: 0 };
  sim.sources.push(s);
  if (!sim.sourceAt.has(cell)) sim.sourceAt.set(cell, []);
  sim.sourceAt.get(cell).push(s);
  sim.foodAt[cell] += 3;
  log(sim, 'rat', `You dropped a trash bag at ${placeName(sim.city, cell)}.`, cell);
  fx(sim, 'bag', cell, 'You dropped a trash bag');
  const h = hourOf(sim); const night = h >= sim.cfg.rat.activeFrom || h < sim.cfg.rat.activeTo;
  banner(night ? `Its smell spreads about <b>${sim.cfg.rat.smell * sim.city.cellM} m</b> along the open air. Rats that catch it show a <b>!</b> and their route.` : 'Bag dropped. Rats come out after 6:30 pm — press <b>NEXT NIGHT</b> to watch them come.', 6500);
  setBagTool(false);
}
function setBagTool(on) {
  state.tool = on ? 'bag' : 'select';
  $('btn-bag').classList.toggle('on', on);
  document.querySelector('.page[data-page="watch"]').classList.toggle('placing', on);
  if (on) banner('Click a sidewalk or a street to drop a bag.', 8000);
}
function setView(v) {
  state.view = v;
  document.querySelectorAll('[data-view]').forEach((o) => o.classList.toggle('on', o.dataset.view === v));
  state.cloud?.setView(v);
}

// ---- the design page: a plan you can click ------------------------------------------------------
function drawDesignPlan() {
  if (!state.dplan || state.page !== 'design') return;
  state.preview = newSim(state.city, cloneDesign(state.design));
  state.dplan.draw(state.preview, { layer: 'none', designOnly: true, now: performance.now() + 1e9 });
}

// ---- pages -------------------------------------------------------------------------------------------
function showPage(p) {
  state.page = p;
  document.querySelectorAll('section.page').forEach((s) => { s.hidden = s.dataset.page !== p; });
  document.querySelectorAll('.pages [data-page]').forEach((b) => b.classList.toggle('on', b.dataset.page === p));
  if (p === 'design') drawDesignPlan();
  if (p === 'data') designer.renderData();
  if (p === 'watch') window.dispatchEvent(new Event('resize'));
}

// ---- controls ---------------------------------------------------------------------------------------------
function wire() {
  document.querySelectorAll('.pages [data-page]').forEach((b) => b.addEventListener('click', () => showPage(b.dataset.page)));
  document.querySelectorAll('[data-speed]').forEach((b) => b.addEventListener('click', () => {
    state.speed = b.dataset.speed === 'story' ? 'story' : Number(b.dataset.speed);
    document.querySelectorAll('[data-speed]').forEach((o) => o.classList.toggle('on', o === b));
  }));
  $('btn-pause').addEventListener('click', () => { state.paused = !state.paused; $('btn-pause').textContent = state.paused ? '▶' : '❚❚'; });
  $('trails').addEventListener('change', (e) => { state.trails = e.target.checked; });
  $('real').addEventListener('change', (e) => { state.layer = e.target.checked ? 'real' : 'none'; });
  $('btn-restart').addEventListener('click', () => restart());
  $('btn-skip').addEventListener('click', () => {
    const sim = state.sim; let n = 0;
    do { stepSim(sim); n++; } while (minuteOfDay(sim) !== 19 * 60 && n < 1440 && sim.t < sim.cfg.days * 1440);
    panels();
  });
  $('scenario').addEventListener('change', (e) => restart(e.target.value));
  document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => {
    const v = b.dataset.view;
    if (v === 'follow' && !state.selected) { // (no button for this any more)
      const sim = state.sim;
      state.selected = sim.inspectors.find((i) => i.mode !== 'off' && i.mode !== 'done') ?? sim.rats.find((r) => r.alive && r.mode !== 'home') ?? null;
      if (!state.selected) { flash('Nobody is out yet. Press NEXT NIGHT.'); return; }
    }
    setView(v);
  }));
  $('bag-ico').getContext('2d').drawImage(bagIcon(true), 0, 0);
  $('btn-bag').addEventListener('click', () => setBagTool(state.tool !== 'bag'));
  $('feed').addEventListener('click', (e) => { const li = e.target.closest('li[data-cell]'); if (li) state.cloud?.focusOn(Number(li.dataset.cell)); });
  $('a-close').addEventListener('click', () => { state.selected = null; });
  $('btn-start').addEventListener('click', () => { $('screen-start').hidden = true; state.started = true; });
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (e.code === 'Space' && state.started) { e.preventDefault(); $('btn-pause').click(); }
    if (e.code === 'Escape') { setBagTool(false); state.selected = null; }
  });
}

// ---- start ---------------------------------------------------------------------------------------------
let designer = null;
async function boot() {
  const place = await fetch(DATA_URL).then((r) => r.json());
  state.city = buildCity(place, CONFIG);
  state.dplan = makePlan($('dplan'), state.city, 4);
  designer = makeDesigner({ state, city: state.city, dataUrl: DATA_URL, restart: (s) => { restart(s); drawDesignPlan(); }, flash, $, onChange: () => drawDesignPlan() });
  wire();
  restart('now');
  try {
    const { makeAxo } = await import('../render/axo.js?v=9');
    state.cloud = makeAxo($('cloud'), state.city, { onPick: (c) => pick(c) });
  } catch (err) {
    console.error(err);
    $('cloud-fallback').hidden = false;
  }
  requestAnimationFrame(loop);
}
boot();
if (new URLSearchParams(location.search).has('debug')) window.__rats = state;
