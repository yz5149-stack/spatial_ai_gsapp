// The page: three parts. 01 Watch: the week on 125th Street in a point cloud, live. 02 Design: the
// environment designer. 03 Data: the real data behind it.

import { CONFIG } from '../sim/config.js';
import { buildCity, describeLocation } from '../sim/city.js';
import { newSim, stepSim, hourOf, dayOf, minuteOfDay, RAT_MODES, INSPECTOR_MODES, placeName, log, fx } from '../sim/sim.js';
import { makeDesign, cloneDesign } from '../sim/design.js';
import { makePlan, drawMind } from '../render/plan.js';
import { bagIcon } from '../render/icons.js';
import { makeDesigner } from './designer.js';

const $ = (id) => document.getElementById(id);
const DATA_URL = new URL('../../data/manhattanville.json', import.meta.url).href;

const state = {
  city: null, sim: null, scenario: 'now', design: makeDesign('now'),
  speed: 40, paused: false, started: false, acc: 0, last: 0,
  layer: 'activity', tool: 'select', view: 'auto', slowmo: true, chaseUntil: 0, chaser: null, selected: null,
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
  $('feed').innerHTML = '<li class="empty">Rats leave their burrows at 6:30 pm. The patrol starts at 7 pm.</li>';
  state.cloud?.invalidate();
  drawDesignPlan();
  panels();
}

function loop(now) {
  const dt = Math.min(250, now - (state.last || now)); state.last = now;
  const sim = state.sim;
  if (sim && state.started && !state.paused) {
    const chasing = sim.inspectors.find((i) => i.mode === 'chase');
    if (chasing) { state.chaser = chasing; state.chaseUntil = now + 2200; }
    const slow = state.slowmo && (chasing || now < state.chaseUntil);
    state.acc += (dt / 1000) * (slow ? Math.min(state.speed, 2.5) : state.speed);
    let n = 0;
    while (state.acc >= 1 && n < 900) { stepSim(sim); state.acc -= 1; n++; }
    if (sim.t >= sim.cfg.days * 1440) { state.paused = true; $('btn-pause').textContent = '▶'; flash('The week is over. Restart, or change the rules.'); }
  }
  if (sim && state.page === 'watch' && state.cloud) {
    const follow = state.view === 'auto' && now < state.chaseUntil && state.chaser ? state.chaser : null;
    const frac = state.speed <= 40 || follow ? state.acc : 1;
    try { state.cloud.frame(sim, { layer: state.layer, selected: state.selected, now, hourFrac: hourOf(sim), frac, follow }); } catch (err) { console.error(err); }
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

function panels() {
  const sim = state.sim; if (!sim) return;
  const m = minuteOfDay(sim);
  $('clock').textContent = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const night = dayOf(sim) + (hourOf(sim) < 12 ? 0 : 1);
  $('day').textContent = `NIGHT ${Math.max(1, night)} OF ${sim.cfg.days}`;
  $('phase').textContent = phaseText(sim);
  band($('tl-bags'), sim.design.setOut, sim.design.pickup === 'night' ? 3 : 9);
  band($('tl-rats'), sim.cfg.rat.activeFrom, sim.cfg.rat.activeTo);
  band($('tl-patrol'), sim.cfg.inspector.shift[0], sim.cfg.inspector.shift[1]);
  $('tl-now').style.left = `calc(48px + (100% - 48px) * ${pct24(hourOf(sim)) / 100})`;
  $('n-rats').textContent = sim.rats.filter((r) => r.alive).length;
  $('n-spot').textContent = sim.totals.spotted;
  $('n-caught').textContent = sim.totals.caught;
  $('n-missed').textContent = sim.totals.missed;
  cast(sim); feed(sim);
  agentCard(sim, state.selected);
}

// who is out, and what they are doing; click to follow
function cast(sim) {
  const items = [];
  for (const ins of sim.inspectors) {
    const on = ins.mode !== 'off' && ins.mode !== 'done';
    items.push({ a: ins, cls: `ins${ins.mode === 'chase' ? ' chase' : ''}`, name: ins.name, st: on ? INSPECTOR_MODES[ins.mode] : 'Off duty until 7 pm', stat: `${ins.stats.caught} caught · ${ins.stats.missed} missed` });
  }
  const out = sim.rats.filter((r) => r.alive && r.mode !== 'home');
  const home = sim.rats.filter((r) => r.alive && r.mode === 'home').length;
  out.sort((a, b) => (b.mode === 'flee') - (a.mode === 'flee') || b.distance - a.distance);
  for (const r of out.slice(0, 5)) items.push({ a: r, cls: `rat${r.mode === 'flee' ? ' flee' : ''}`, name: `Rat #${r.id}`, st: RAT_MODES[r.mode], stat: `fed ${Math.round(Math.min(1, r.fed) * 100)}%` });
  const key = items.map((i) => `${i.a.id}${i.st}${i.stat}`).join('|') + out.length + home + (state.selected?.id ?? '');
  if (cast.key === key) return; cast.key = key;
  $('cast').innerHTML = items.map((i, k) => `<li class="${i.cls}${state.selected === i.a ? ' sel' : ''}" data-k="${k}"><i></i><span>${i.name}<span class="st">${i.st}</span></span><small>${i.stat}</small></li>`).join('')
    + `<li class="rat" style="cursor:default"><i></i><span>${out.length} rats out<span class="st">${home} in their burrows</span></span><small></small></li>`;
  cast.items = items;
}

const KIND = { spot: ['SPOTTED', 'k-spot'], caught: ['CAUGHT', 'k-caught'], missed: ['GOT AWAY', 'k-missed'], dodge: ['DODGED', 'k-dodge'], bag: ['TRASH', 'k-bag'] };
let feedSeq = -1;
function feed(sim) {
  if (sim.fxSeq === feedSeq) return;
  feedSeq = sim.fxSeq;
  const items = sim.fx.filter((f) => KIND[f.kind]).slice(-16).reverse();
  if (!items.length) return;
  $('feed').innerHTML = items.map((f) => {
    const [label, cls] = f.burrow ? ['BURROW', 'k-burrow'] : KIND[f.kind];
    const ins = sim.inspectors.find((i) => i.id === f.who)?.name ?? '';
    const what = { spot: `${ins} spots a rat`, caught: `${ins} catches it`, missed: f.burrow ? 'Into its burrow — burrow found' : `It gets away from ${ins}`, dodge: 'The rat dodges', bag: 'You dropped a trash bag' }[f.kind];
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
    $('a-dot').style.background = 'var(--rat)'; $('a-name').textContent = `RAT #${a.id}`;
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
    $('a-dot').style.background = 'var(--cyan)'; $('a-name').textContent = a.name.toUpperCase();
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
  state.selected = nearestAgent(sim, cell); cast.key = null;
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
  state.dplan.draw(state.preview, { layer: 'real', now: performance.now() + 1e9 });
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
    state.speed = Number(b.dataset.speed);
    document.querySelectorAll('[data-speed]').forEach((o) => o.classList.toggle('on', o === b));
  }));
  $('btn-pause').addEventListener('click', () => { state.paused = !state.paused; $('btn-pause').textContent = state.paused ? '▶' : '❚❚'; });
  $('btn-restart').addEventListener('click', () => restart());
  $('btn-skip').addEventListener('click', () => {
    const sim = state.sim; let n = 0;
    do { stepSim(sim); n++; } while (minuteOfDay(sim) !== 19 * 60 && n < 1440 && sim.t < sim.cfg.days * 1440);
    panels();
  });
  $('scenario').addEventListener('change', (e) => restart(e.target.value));
  document.querySelectorAll('[data-layer]').forEach((b) => b.addEventListener('click', () => {
    state.layer = b.dataset.layer;
    document.querySelectorAll('[data-layer]').forEach((o) => o.classList.toggle('on', o === b));
  }));
  document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => {
    const v = b.dataset.view;
    if (v === 'follow' && !state.selected) {
      const sim = state.sim;
      state.selected = sim.inspectors.find((i) => i.mode !== 'off' && i.mode !== 'done') ?? sim.rats.find((r) => r.alive && r.mode !== 'home') ?? null;
      if (!state.selected) { flash('Nobody is out yet. Press NEXT NIGHT.'); return; }
    }
    setView(v);
  }));
  $('slowmo').addEventListener('change', (e) => { state.slowmo = e.target.checked; });
  $('bag-ico').getContext('2d').drawImage(bagIcon(true), 0, 0);
  $('btn-bag').addEventListener('click', () => setBagTool(state.tool !== 'bag'));
  $('feed').addEventListener('click', (e) => { const li = e.target.closest('li[data-cell]'); if (li) state.cloud?.focusOn(Number(li.dataset.cell)); });
  $('cast').addEventListener('click', (e) => { const li = e.target.closest('li[data-k]'); if (!li) return; const it = cast.items?.[Number(li.dataset.k)]; if (it) { state.selected = it.a; setView('follow'); cast.key = null; } });
  $('a-close').addEventListener('click', () => { state.selected = null; if (state.view === 'follow') setView('auto'); });
  $('dplan').addEventListener('click', (e) => { const c = state.dplan.cellAt(e.clientX, e.clientY); if (designer.handlePick(c)) drawDesignPlan(); });
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
  designer = makeDesigner({ state, city: state.city, dataUrl: DATA_URL, restart: (s) => { restart(s); drawDesignPlan(); }, flash, $ });
  wire();
  restart('now');
  try {
    const { makeCloud } = await import('../render/cloud.js');
    state.cloud = makeCloud($('cloud'), state.city, { onPick: (c) => pick(c) });
  } catch (err) {
    console.error(err);
    $('cloud-fallback').hidden = false;
  }
  requestAnimationFrame(loop);
}
boot();
if (new URLSearchParams(location.search).has('debug')) window.__rats = state;
