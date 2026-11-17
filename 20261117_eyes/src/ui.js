// The page: controls, the map, the tools, the measures for the hour, the day chart, the streets.

import { loadPlace } from '../../20261116_final/src/data/load.js';
import { G, S, SURFACE_NAMES, describeLocation } from '../../20261116_final/src/sim/city.js';
import { makeModel, runScenario, streetTable, EYES } from './eyes.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = (v) => `${Math.round(v * 100)}%`;
const hh = (h) => `${String(h).padStart(2, '0')}:00`;
const st = { model: null, base: null, run: null, baseKey: '', hour: 23, layer: 'eyes', tool: 'none', design: { addLamps: [], removeLamps: [], lateShops: [] }, timer: null, play: null };

function settings() {
  return { day: $('day').value, outages: $('outages').value, pathLamps: $('path-lamps').checked, others: Number($('others').value), darkAvoid: Number($('avoid').value) };
}
const hasDesign = () => st.design.addLamps.length + st.design.removeLamps.length + st.design.lateShops.length > 0;

function recompute() {
  const s = settings();
  const key = JSON.stringify(s);
  if (key !== st.baseKey) { st.base = runScenario(st.model, { ...s, addLamps: [], removeLamps: [], lateShops: [] }); st.baseKey = key; }
  st.run = hasDesign() ? runScenario(st.model, { ...s, ...structuredClone(st.design) }) : st.base;
  render();
}
const schedule = () => { clearTimeout(st.timer); st.timer = setTimeout(recompute, 60); };

// ---- colours ----------------------------------------------------------------------------------
const INFERNO = [[0, [12, 8, 30]], [0.25, [86, 23, 110]], [0.5, [187, 55, 84]], [0.75, [249, 142, 9]], [1, [252, 255, 164]]];
const ramp = (stops, t) => {
  t = Math.max(0, Math.min(1, t));
  for (let k = 1; k < stops.length; k++) {
    const [t1, c1] = stops[k]; const [t0, c0] = stops[k - 1];
    if (t <= t1) { const f = (t - t0) / (t1 - t0); return `rgb(${c0.map((v, j) => Math.round(v + (c1[j] - v) * f)).join(',')})`; }
  }
  return `rgb(${stops[stops.length - 1][1].join(',')})`;
};
const LIGHT = [[0, [10, 14, 26]], [0.5, [120, 100, 40]], [1, [255, 226, 130]]];
const eyesT = (v) => Math.log10(1 + 4 * v) / Math.log10(1 + 4 * 4);       // 0 .. 4 eyes, log
const passing = (people) => (people * 3600) / (EYES.cellM / EYES.walkSpeed);

function cellColor(i, hr, base) {
  const { world } = st.model;
  const g = world.ground[i];
  if (!world.walk[i]) {
    if (g === G.BLDG) { const h = Math.min(1, world.height[i] / 70); return `rgb(${34 + 30 * h},${40 + 32 * h},${52 + 36 * h})`; }
    if (g === G.TREE || g === G.BUSH) return '#16261d';
    if (g === G.WATER) return '#13243a';
    return '#1d232c';
  }
  const L = st.run.light[i];
  switch (st.layer) {
    case 'light': return ramp(LIGHT, hr.night ? L : 1);
    case 'people': return ramp(INFERNO, Math.log10(1 + passing(hr.people[i])) / Math.log10(1 + 400));
    case 'unwatched': {
      const watched = hr.eyes[i] >= EYES.watched;
      if (watched) return '#3d5446';
      return hr.night && L < EYES.litLevel ? '#ff4a3d' : '#7a5a2a';
    }
    case 'diff': {
      const d = hr.eyes[i] - base.eyes[i];
      const t = Math.max(-1, Math.min(1, d / 0.6));
      if (Math.abs(t) < 0.02) return '#59616e';
      return t > 0 ? `rgb(${Math.round(42 - 20 * t)},${Math.round(48 + 190 * t)},${Math.round(58 + 90 * t)})` : `rgb(${Math.round(42 + 200 * -t)},${Math.round(48 + 30 * -t)},${Math.round(58 + 20 * -t)})`;
    }
    default: return ramp(INFERNO, eyesT(hr.eyes[i]));
  }
}

// ---- the map ---------------------------------------------------------------------------------
let cs = 1;
function drawMap() {
  const { world } = st.model;
  const cv = $('map');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cs = ((cv.clientWidth || 800) / world.W) * dpr;
  const W = Math.round(cs * world.W); const H = Math.round(cs * world.H);
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  cv.style.aspectRatio = `${world.W} / ${world.H}`;
  const g = cv.getContext('2d');
  const hr = st.run.hours[st.hour];
  const base = st.base.hours[st.hour];
  for (let i = 0; i < world.N; i++) {
    g.fillStyle = cellColor(i, hr, base);
    g.fillRect((i % world.W) * cs, Math.floor(i / world.W) * cs, cs + 0.5, cs + 0.5);
  }
  // street lights
  if ($('show-lamps').checked) {
    for (const l of st.run.lamps) {
      const x = l.x * cs; const y = l.y * cs;
      if (l.on) { g.fillStyle = l.src === 'design' ? '#7cc4ff' : 'rgba(255, 220, 120, 0.9)'; g.beginPath(); g.arc(x, y, Math.max(1.6, cs * (l.src === 'design' ? 0.32 : 0.18)), 0, Math.PI * 2); g.fill(); }
      else { g.strokeStyle = l.reported ? '#ff5a4f' : '#93a0b2'; g.lineWidth = Math.max(1.2, cs * 0.12); const r = cs * 0.25; g.beginPath(); g.moveTo(x - r, y - r); g.lineTo(x + r, y + r); g.moveTo(x + r, y - r); g.lineTo(x - r, y + r); g.stroke(); }
    }
  }
  if ($('show-311').checked) {
    for (const r of st.model.reports) {
      const x = r.x * cs; const y = r.y * cs; const s = cs * 0.38;
      g.strokeStyle = r.out ? '#ff5a4f' : '#ff9d7a'; g.lineWidth = Math.max(1, cs * 0.1);
      g.beginPath(); g.moveTo(x, y - s); g.lineTo(x + s, y + s * 0.8); g.lineTo(x - s, y + s * 0.8); g.closePath(); g.stroke();
    }
  }
  // the station and the shops you add
  for (const c of st.model.station) badge(g, c, '#7dff9a', '1');
  for (const c of st.design.lateShops) badge(g, c, '#ff7ad9', 'S');
}
function badge(g, c, color, text) {
  const W = st.model.world.W;
  const x = ((c % W) + 0.5) * cs; const y = (Math.floor(c / W) + 0.5) * cs;
  g.fillStyle = color; g.strokeStyle = '#06080b'; g.lineWidth = Math.max(1, cs * 0.12);
  g.beginPath(); g.arc(x, y, cs * 0.9, 0, Math.PI * 2); g.fill(); g.stroke();
  g.fillStyle = '#06080b'; g.font = `800 ${Math.round(cs * 0.95)}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, x, y + cs * 0.05);
}

function legend() {
  const grad = (stops) => `linear-gradient(90deg, ${stops.map(([t, c]) => `rgb(${c.join(',')}) ${t * 100}%`).join(', ')})`;
  const L = {
    eyes: `<span>0</span><i class="ramp" style="background:${grad(INFERNO)}"></i><span>4+ people can see the spot</span>`,
    people: `<span>0</span><i class="ramp" style="background:${grad(INFERNO)}"></i><span>400+ walkers pass per hour</span>`,
    light: `<span>dark</span><i class="ramp" style="background:${grad(LIGHT)}"></i><span>lit</span>`,
    unwatched: '<span><i class="sw" style="--c:#ff4a3d"></i>dark and unwatched</span><span><i class="sw" style="--c:#7a5a2a"></i>unwatched</span><span><i class="sw" style="--c:#3d5446"></i>watched (½ person or more)</span>',
    diff: '<span><i class="sw" style="--c:#f24e3a"></i>fewer eyes than the baseline</span><span><i class="sw" style="--c:#16eebc"></i>more eyes</span>',
  }[st.layer];
  $('legend').innerHTML = `${L}<span><i class="dot" style="--c:#ffdc78"></i>street light</span><span><i class="dot" style="--c:#7cc4ff"></i>light you added</span><span style="color:#ff5a4f">✕ light out (311)</span><span style="color:#ff5a4f">△ 311 report</span><span><i class="dot" style="--c:#7dff9a"></i>116 St station</span><span><i class="dot" style="--c:#ff7ad9"></i>late-night shop</span>`;
}

// ---- measures, chart, streets -------------------------------------------------------------------
function cards() {
  const m = st.run.measures[st.hour]; const b = st.base.measures[st.hour];
  const hr = st.run.hours[st.hour];
  const d = (k, better) => {
    if (!hasDesign()) return '';
    const v = m[k] - b[k];
    if (Math.abs(v) < 0.005) return '<em>±0</em>';
    const good = better === 'up' ? v > 0 : v < 0;
    return `<em class="${good ? 'good' : 'bad'}">${v > 0 ? '+' : ''}${Math.round(v * 100)} pts</em>`;
  };
  $('cards').innerHTML = `<div><b>${Math.round(hr.exits)} / ${Math.round(hr.entries)}</b>leave / enter the subway this hour</div>`
    + `<div><b>${m.walkersOnMap.toFixed(m.walkersOnMap < 10 ? 1 : 0)}</b>people walking on the map at any moment</div>`
    + `<div><b>${pct(m.watchedShare)}${d('watchedShare', 'up')}</b>of the open ground is watched</div>`
    + `<div><b>${hr.night ? pct(m.darkUnwatchedShare) : '—'}${hr.night ? d('darkUnwatchedShare', 'down') : ''}</b>is dark and unwatched</div>`
    + `<div><b>${pct(m.exposedWalking)}${d('exposedWalking', 'down')}</b>of walking time is spent unseen</div>`
    + `<div><b>${hr.night ? `+${Math.round(st.run.detour * 100)}%` : '—'}</b>longer walks at night, avoiding the dark</div>`;
  $('cards-note').textContent = hasDesign() ? 'Changes are against the baseline: the same settings without your lights and shops.' : 'Add a light or a late-night shop on the map to compare against this baseline.';
}

function chart() {
  const svg = $('chart');
  const Wc = 520; const Hc = 230; const P = { l: 36, r: 10, t: 12, b: 26 };
  const X = (h) => P.l + ((Wc - P.l - P.r) * h) / 23;
  const Y = (v) => P.t + (Hc - P.t - P.b) * (1 - v);
  const riders = st.run.hours.map((h) => h.riders);
  const maxR = Math.max(...riders, 1);
  let s = '';
  for (const v of [0, 0.25, 0.5, 0.75, 1]) s += `<line class="grid-l" x1="${P.l}" x2="${Wc - P.r}" y1="${Y(v)}" y2="${Y(v)}"/><text class="tick" x="${P.l - 5}" y="${Y(v) + 4}" text-anchor="end">${v * 100}%</text>`;
  const bw = (Wc - P.l - P.r) / 24 * 0.7;
  riders.forEach((r, h) => { s += `<rect class="bar" x="${X(h) - bw / 2}" y="${Y(0.35 * r / maxR)}" width="${bw}" height="${Y(0) - Y(0.35 * r / maxR)}"><title>${hh(h)}: ${Math.round(r)} riders</title></rect>`; });
  for (const h of [0, 3, 6, 9, 12, 15, 18, 21, 23]) s += `<text class="tick" x="${X(h)}" y="${Hc - 8}" text-anchor="middle">${h}h</text>`;
  const line = (ms, k, cls) => `<polyline class="${cls}" points="${ms.map((m, h) => `${X(h)},${Y(m[k])}`).join(' ')}"/>`;
  if (hasDesign()) { s += line(st.base.measures, 'watchedShare', 'a base'); s += line(st.base.measures, 'exposedWalking', 'b base'); }
  s += line(st.run.measures, 'watchedShare', 'a'); s += line(st.run.measures, 'exposedWalking', 'b');
  s += `<line class="now" x1="${X(st.hour)}" x2="${X(st.hour)}" y1="${P.t}" y2="${Y(0)}"/>`;
  svg.innerHTML = s;
}

function streets() {
  const rows = streetTable(st.model, st.run.light, st.run.hours[st.hour]).slice(0, 14);
  const max = Math.max(...rows.map((r) => r.eyes), 0.5);
  $('streets').innerHTML = rows.map((r) => `<tr><td>${esc(r.name)}</td><td><i class="barcell" style="width:${Math.round(60 * r.eyes / max)}px"></i>${r.eyes.toFixed(2)}</td><td>${r.minEyes.toFixed(2)}</td><td>${st.run.hours[st.hour].night ? pct(r.light) : 'day'}</td></tr>`).join('');
}

function render() {
  $('hour-label').textContent = hh(st.hour);
  $('others-label').textContent = Number($('others').value).toFixed(2);
  $('avoid-label').textContent = Number($('avoid').value).toFixed(2);
  const titles = { eyes: 'Eyes', unwatched: 'Dark and unwatched', light: 'Light', people: 'Walkers', diff: 'Change in eyes' };
  $('map-title').textContent = `${titles[st.layer]} at ${hh(st.hour)}, ${$('day').selectedOptions[0].textContent.split(' (')[0].toLowerCase()}`;
  const n = st.design.addLamps.length; const r = st.design.removeLamps.length; const k = st.design.lateShops.length;
  $('design-note').textContent = hasDesign() ? `Your changes: ${n} light${n === 1 ? '' : 's'} added, ${r} removed, ${k} late-night shop${k === 1 ? '' : 's'}` : '';
  drawMap(); legend(); cards(); chart(); streets();
}

// ---- interaction -------------------------------------------------------------------------------
function cellAt(e) {
  const { world } = st.model;
  const r = $('map').getBoundingClientRect();
  const fx = ((e.clientX - r.left) / r.width) * world.W; const fy = ((e.clientY - r.top) / r.height) * world.H;
  if (fx < 0 || fy < 0 || fx >= world.W || fy >= world.H) return null;
  return { fx, fy, i: Math.floor(fy) * world.W + Math.floor(fx) };
}
$('map').addEventListener('mousemove', (e) => {
  const c = cellAt(e);
  const tip = $('tip');
  if (!c) { tip.hidden = true; return; }
  const { world } = st.model;
  const hr = st.run.hours[st.hour];
  const i = c.i;
  const loc = describeLocation(world, i);
  let html = `<b>${esc(loc.street)}</b>`;
  if (world.walk[i]) {
    html += `${esc(SURFACE_NAMES[world.surface[i]])} · light ${hr.night ? pct(st.run.light[i]) : 'daylight'}<br>${Math.round(passing(hr.people[i]))} walkers pass per hour<br>eyes on it: <b style="display:inline">${hr.eyes[i].toFixed(2)}</b>`;
    if (hasDesign()) html += ` (baseline ${st.base.hours[st.hour].eyes[i].toFixed(2)})`;
  } else html += world.ground[i] === G.BLDG ? `building, ${Math.round(world.height[i])} m tall` : 'not walkable';
  const rep = st.model.reports.find((q) => Math.hypot(q.x - c.fx, q.y - c.fy) < 1.2);
  if (rep) html += `<br><span style="color:#ff5a4f">311: ${esc(rep.descriptor)}, ${rep.created}${rep.closed ? `, closed ${rep.closed}` : ', open'}</span>`;
  html += `<br><span style="color:#93a0b2">${loc.lonlat[1].toFixed(5)}, ${loc.lonlat[0].toFixed(5)} · ${loc.elevation.toFixed(0)} m</span>`;
  tip.innerHTML = html;
  tip.hidden = false;
  const wrap = $('map').getBoundingClientRect();
  const x = e.clientX - wrap.left; const y = e.clientY - wrap.top;
  tip.style.left = `${Math.min(x + 14, wrap.width - 270)}px`; tip.style.top = `${Math.min(y + 14, wrap.height - 110)}px`;
});
$('map').addEventListener('mouseleave', () => { $('tip').hidden = true; });
$('map').addEventListener('click', (e) => {
  const c = cellAt(e);
  if (!c || st.tool === 'none') return;
  const { world } = st.model;
  if (st.tool === 'lamp') { if (!world.walk[c.i]) return; st.design.addLamps.push({ x: Math.floor(c.fx) + 0.5, y: Math.floor(c.fy) + 0.5 }); }
  else if (st.tool === 'shop') { if (!world.walk[c.i] || st.design.lateShops.includes(c.i)) return; st.design.lateShops.push(c.i); }
  else if (st.tool === 'remove') {
    const d = (x, y) => Math.hypot(x - c.fx, y - c.fy);
    const ai = st.design.addLamps.findIndex((l) => d(l.x, l.y) < 1.2);
    const si = st.design.lateShops.findIndex((s) => d((s % world.W) + 0.5, Math.floor(s / world.W) + 0.5) < 1.5);
    if (ai >= 0) st.design.addLamps.splice(ai, 1);
    else if (si >= 0) st.design.lateShops.splice(si, 1);
    else {
      const lamp = st.run.lamps.filter((l) => l.on && l.src !== 'design').map((l) => ({ l, dd: d(l.x, l.y) })).sort((a, b) => a.dd - b.dd)[0];
      if (!lamp || lamp.dd > 1.5) return;
      st.design.removeLamps.push(lamp.l.i);
    }
  }
  if (st.layer === 'eyes' && hasDesign()) { st.layer = 'diff'; $('layer').value = 'diff'; }
  schedule();
});
document.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => {
  st.tool = b.dataset.tool;
  document.querySelectorAll('[data-tool]').forEach((o) => o.classList.toggle('on', o === b));
}));
$('reset').addEventListener('click', () => { st.design = { addLamps: [], removeLamps: [], lateShops: [] }; if (st.layer === 'diff') { st.layer = 'eyes'; $('layer').value = 'eyes'; } schedule(); });
$('hour').addEventListener('input', (e) => { st.hour = Number(e.target.value); render(); });
$('layer').addEventListener('change', (e) => { st.layer = e.target.value; render(); });
['day', 'outages', 'path-lamps', 'others', 'avoid'].forEach((id) => $(id).addEventListener(id === 'others' || id === 'avoid' ? 'change' : 'change', schedule));
['others', 'avoid'].forEach((id) => $(id).addEventListener('input', () => { $(`${id}-label`).textContent = Number($(id).value).toFixed(2); }));
['show-lamps', 'show-311'].forEach((id) => $(id).addEventListener('change', drawMap));
$('play').addEventListener('click', () => {
  if (st.play) { clearInterval(st.play); st.play = null; $('play').textContent = '▶'; return; }
  $('play').textContent = '❚❚';
  st.play = setInterval(() => { st.hour = (st.hour + 1) % 24; $('hour').value = st.hour; render(); }, 800);
});
new ResizeObserver(() => { if (st.run) drawMap(); }).observe($('map'));

async function boot() {
  const [place, data] = await Promise.all([loadPlace('morningside'), fetch('data/morningside-eyes.json').then((r) => r.json())]);
  st.model = makeModel(place, data);
  recompute();
}
boot().catch((err) => { console.error(err); document.querySelector('main').insertAdjacentHTML('afterbegin', `<p class="panel">Could not load: ${esc(err.message)}</p>`); });
if (new URLSearchParams(location.search).has('debug')) window.__eyes = st;
void S;
