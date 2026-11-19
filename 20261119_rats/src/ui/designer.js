// The environment designer: edit a design by hand, compare two variations and choose (manual),
// evolve designs over epochs (automated), keep the interesting ones in a gallery, and look at the
// real data behind it all.

import { makeDesign, cloneDesign, designCost, describeDesign, mutate, randomDesign, isBinned } from '../sim/design.js';
import { evolve, OBJECTIVES } from '../sim/evaluate.js';
import { thumbnail } from '../render/plan.js';
import { nearestWhere } from '../sim/city.js';

// ---- a pool of Web Workers that run whole weeks ------------------------------------------------
function makePool(dataUrl) {
  const size = Math.max(1, Math.min(6, (navigator.hardwareConcurrency || 4) - 1));
  const workers = []; const queue = []; let seq = 0; const waiting = new Map();
  for (let k = 0; k < size; k++) {
    const w = new Worker(new URL('../sim/worker.js', import.meta.url), { type: 'module' });
    w.busy = false;
    w.onmessage = (e) => { const job = waiting.get(e.data.id); waiting.delete(e.data.id); w.busy = false; if (e.data.error) job.reject(new Error(e.data.error)); else job.resolve(e.data.m); next(); };
    workers.push(w);
  }
  function next() {
    for (const w of workers) {
      if (w.busy || !queue.length) continue;
      const job = queue.shift(); w.busy = true; waiting.set(job.id, job);
      w.postMessage({ id: job.id, url: dataUrl, design: job.design, opts: job.opts });
    }
  }
  return {
    size,
    run: (design, opts = {}) => new Promise((resolve, reject) => { queue.push({ id: ++seq, design: JSON.parse(JSON.stringify(design)), opts, resolve, reject }); next(); }),
  };
}

const fmt = (v, d = 0) => (v == null ? '–' : Number(v).toFixed(d));

export function makeDesigner({ state, city, dataUrl, restart, flash, $ }) {
  const pool = makePool(dataUrl);
  let tool = null;
  let baseline = null;
  const gallery = loadGallery();

  // ---- tabs -----------------------------------------------------------------------------------
  document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('[data-tab]').forEach((o) => o.classList.toggle('on', o === b));
    document.querySelectorAll('[data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== b.dataset.tab; });
    if (b.dataset.tab === 'gallery') renderGallery();
    if (b.dataset.tab === 'data') renderData();
  }));

  // ---- edit -------------------------------------------------------------------------------------
  const sync = () => {
    const d = state.design;
    $('d-setout').value = String(d.setOut); $('d-pickup').value = d.pickup; $('d-binning').value = d.binning;
    $('d-shedset').value = d.shedSet; $('d-inspectors').value = String(d.inspectors);
    const cost = designCost(d); const budget = city.config.budget;
    $('budget-text').textContent = `Budget ${fmt(cost, 1)} of ${budget}`;
    $('budget-bar').style.width = `${Math.min(100, (cost / budget) * 100)}%`;
    $('budget-bar').classList.toggle('over', cost > budget);
    $('d-summary').textContent = describeDesign(city, d);
  };
  const changed = () => { sync(); restart('design'); };
  for (const [id, key, num] of [['d-setout', 'setOut', true], ['d-pickup', 'pickup'], ['d-binning', 'binning'], ['d-shedset', 'shedSet'], ['d-inspectors', 'inspectors', true]]) {
    $(id).addEventListener('change', (e) => { state.design[key] = num ? Number(e.target.value) : e.target.value; if (key === 'shedSet') state.design.sheds = {}; changed(); });
  }
  document.querySelectorAll('[data-dtool]').forEach((b) => b.addEventListener('click', () => {
    tool = tool === b.dataset.dtool ? null : b.dataset.dtool;
    document.querySelectorAll('[data-dtool]').forEach((o) => o.classList.toggle('on', o.dataset.dtool === tool));
    if (tool) flash('Click the map or the city to place it. Each change restarts the week with your design.');
  }));
  $('d-reset').addEventListener('click', () => { state.design = makeDesign('now'); changed(); });
  $('d-random').addEventListener('click', () => { state.design = randomDesign(city, Math.floor(Math.random() * 1e9)); changed(); });
  $('d-play').addEventListener('click', () => restart('design'));
  $('d-eval').addEventListener('click', async () => {
    $('d-eval').disabled = true; $('d-result').innerHTML = '<p class="hint">Running the week twice…</p>';
    try {
      if (!baseline) baseline = await pool.run(makeDesign('now'), { seeds: [1, 2] });
      const m = await pool.run(state.design, { seeds: [1, 2], keepMap: true });
      $('d-result').innerHTML = resultTable(m, baseline);
      const thumb = thumbnail(city, { activity: m.map.activity, burrows: m.map.burrows, design: state.design }, { width: 340 });
      $('d-result').prepend(thumb);
    } catch (err) { console.error(err); $('d-result').innerHTML = `<p class="hint">Could not run: ${err.message}</p>`; }
    $('d-eval').disabled = false;
  });

  function handlePick(cell) {
    if (!tool) return false;
    const d = state.design; const W = city.W;
    const near = (list, r = 2) => list.findIndex((c) => Math.abs((c % W) - (cell % W)) <= r && Math.abs(Math.floor(c / W) - Math.floor(cell / W)) <= r);
    if (tool === 'station') { const c = nearestWhere(W, city.H, cell, 3, (j) => city.walk[j] && city.wall[j]); if (c == null) return flash('Bait stations go against a wall.'), true; d.stations.push(c); }
    else if (tool === 'light') { const c = nearestWhere(W, city.H, cell, 2, (j) => city.walk[j]); if (c == null) return true; d.lights.push(c); }
    else if (tool === 'guard') { const c = nearestWhere(W, city.H, cell, 3, (j) => city.soil[j]); if (c == null) return flash('No tree pit or yard there.'), true; d.guards.push(c); }
    else if (tool === 'bin') {
      const s = city.sources.filter((x) => x.kind !== 'basket').sort((a, b) => dist(a.cell, cell) - dist(b.cell, cell))[0];
      if (!s || dist(s.cell, cell) > 6) return flash('Click next to a building.'), true;
      if (isBinned(city, { ...d, bins: [] }, s)) return flash('That building already uses bins under these rules.'), true;
      if (d.bins.includes(s.id)) d.bins = d.bins.filter((x) => x !== s.id); else d.bins.push(s.id);
    } else if (tool === 'shed') {
      const sheds = d.shedSet === '2023' ? city.sheds2023 : city.sheds;
      const sh = sheds.slice().sort((a, b) => dist(a.cells[0], cell) - dist(b.cells[0], cell))[0];
      if (!sh || dist(sh.cells[0], cell) > 5) return flash('No sidewalk shed there (blue on the map).'), true;
      const order = ['old', 'light', 'gone']; const now = d.sheds[sh.id] ?? 'old';
      d.sheds[sh.id] = order[(order.indexOf(now) + 1) % 3];
      flash(`Shed at ${sh.a}: ${{ old: 'old plywood (dark)', light: 'see-through 2026 design', gone: 'removed (facade repaired)' }[d.sheds[sh.id]]}`);
    } else if (tool === 'erase') {
      for (const key of ['stations', 'lights', 'guards']) { const k = near(d[key]); if (k >= 0) { d[key].splice(k, 1); break; } }
    }
    changed();
    return true;
    function dist(a, b) { return Math.hypot((a % W) - (b % W), Math.floor(a / W) - Math.floor(b / W)); }
  }

  function resultTable(m, base) {
    const row = (label, v, b, d = 0, lowerIsBetter = true) => {
      const diff = b == null ? '' : v - b;
      const good = diff === '' || Math.abs(diff) < 0.5 ? '' : (diff < 0) === lowerIsBetter ? 'color:#5fd38a' : 'color:#ff6b6b';
      return `<tr><td>${label}</td><td>${fmt(v, d)}${b == null ? '' : ` <span style="${good}">(${diff > 0 ? '+' : ''}${fmt(diff, d)})</span>`}</td></tr>`;
    };
    return `<table>
      ${row('Rats alive after a week', m.rats, base?.rats)}
      ${row('Times people saw a rat', m.sightings, base?.sightings)}
      ${row('Food rats ate (rat-nights)', m.eaten, base?.eaten)}
      ${row('Rats born', m.births, base?.births)}
      ${row('Starved', m.starved, base?.starved, 0, false)}
      ${row('Killed by bait stations', m.baited, base?.baited, 0, false)}
      ${row('Killed by burrow treatment', m.treated, base?.treated, 0, false)}
      ${row('Inspections (failed)', m.inspections, base?.inspections, 0, false)}
      ${row('Score (lower is better)', m.score, base?.score, 1)}
      <tr><td>Cost</td><td>${fmt(m.cost, 1)} of ${city.config.budget}</td></tr>
      <tr><td>Match with real reports (r)</td><td>${fmt(m.realMatch, 2)}</td></tr>
    </table><p class="hint">In brackets: the difference from today's rules (“Now”), on the same two runs.</p>`;
  }

  // ---- compare two (manual) ------------------------------------------------------------------------
  let pair = null; let lineage = []; let abSeed = 1;
  async function makePair() {
    const parent = state.design;
    pair = [mutate(city, parent, abSeed++ * 97, 1.2), mutate(city, parent, abSeed++ * 97 + 13, 1.2)];
    for (const [k, id] of [[0, 'var-a'], [1, 'var-b']]) $(id).innerHTML = `<h4>${k ? 'B' : 'A'}</h4><p class="hint">${describeDesign(city, pair[k])}</p><p class="hint">Running the week…</p>`;
    const ms = await Promise.all(pair.map((d) => pool.run(d, { seeds: [1, 2], keepMap: true })));
    ms.forEach((m, k) => {
      const el = $(k ? 'var-b' : 'var-a');
      el.innerHTML = `<h4>${k ? 'B' : 'A'} · score ${fmt(m.score, 1)}</h4><p class="why">${describeDesign(city, pair[k])}</p>`;
      el.append(thumbnail(city, { activity: m.map.activity, burrows: m.map.burrows, design: pair[k] }, { width: 520 }));
      el.insertAdjacentHTML('beforeend', `${resultTable(m, null)}<div class="row"><button class="primary" data-choose="${k}">Choose ${k ? 'B' : 'A'}</button><button data-playv="${k}">Play it</button><button data-savev="${k}">Save</button></div>`);
      el.querySelector('[data-choose]').addEventListener('click', () => { lineage.push(`${k ? 'B' : 'A'} (${fmt(m.score, 1)})`); state.design = cloneDesign(pair[k]); sync(); $('ab-lineage').textContent = `Chosen so far: ${lineage.join(' → ')}`; makePair(); });
      el.querySelector('[data-playv]').addEventListener('click', () => { state.design = cloneDesign(pair[k]); sync(); restart('design'); window.scrollTo({ top: 0, behavior: 'smooth' }); });
      el.querySelector('[data-savev]').addEventListener('click', () => save(pair[k], m, `Chosen variation ${lineage.length + 1}${k ? 'B' : 'A'}`));
    });
  }
  $('ab-start').addEventListener('click', () => { lineage = []; makePair(); });

  // ---- evolve (automated) -------------------------------------------------------------------------
  let evBest = null;
  $('ev-run').addEventListener('click', async () => {
    const goal = $('ev-goal').value; const epochs = Number($('ev-epochs').value); const population = Number($('ev-pop').value);
    $('ev-run').disabled = true; $('ev-play').disabled = true; $('ev-save').disabled = true;
    const hist = [];
    const start = goal === 'paradise' ? makeDesign('now') : state.design;
    try {
      const res = await evolve(city, start, {
        epochs, population, objective: goal, seed: Math.floor(Math.random() * 1e6),
        evaluate: (d) => pool.run(d, { seeds: [1, 2] }),
        onEpoch: (rec, best) => {
          hist.push(rec); drawEvolution($('ev-chart'), hist, goal);
          $('ev-best').innerHTML = `<b>Epoch ${rec.epoch} of ${epochs}</b> · best score ${fmt(best.m.score, 1)} (${OBJECTIVES[goal].name})<br>${describeDesign(city, best.design)}<br>rats ${fmt(best.m.rats)}, seen ${fmt(best.m.sightings)}, cost ${fmt(best.m.cost, 1)}`;
        },
      });
      evBest = res.best;
      $('ev-play').disabled = false; $('ev-save').disabled = false;
    } catch (err) { console.error(err); $('ev-best').textContent = `Evolution failed: ${err.message}`; }
    $('ev-run').disabled = false;
  });
  $('ev-play').addEventListener('click', () => { if (!evBest) return; state.design = cloneDesign(evBest.design); sync(); restart('design'); window.scrollTo({ top: 0, behavior: 'smooth' }); });
  $('ev-save').addEventListener('click', () => evBest && save(evBest.design, evBest.m, `Evolved (${$('ev-goal').value === 'paradise' ? 'rat paradise' : 'fewer rats'})`));

  function drawEvolution(cv, hist, goal) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = cv.clientWidth * dpr; cv.height = cv.clientHeight * dpr;
    const g = cv.getContext('2d'); g.scale(dpr, dpr);
    const w = cv.clientWidth; const h = cv.clientHeight;
    g.fillStyle = '#0a0d11'; g.fillRect(0, 0, w, h);
    const all = hist.flatMap((r) => r.all.concat(r.best.score));
    const lo = Math.min(...all) * 0.95; const hi = Math.max(...all) * 1.05;
    const X = (e) => 40 + (e / Math.max(1, hist[hist.length - 1].epoch || 1)) * (w - 60);
    const Y = (v) => h - 28 - ((v - lo) / (hi - lo || 1)) * (h - 50);
    g.strokeStyle = '#262d36'; g.fillStyle = '#8b96a5'; g.font = '11px system-ui';
    for (let k = 0; k <= 4; k++) { const v = lo + ((hi - lo) * k) / 4; g.beginPath(); g.moveTo(40, Y(v)); g.lineTo(w - 10, Y(v)); g.stroke(); g.fillText(v.toFixed(0), 6, Y(v) + 4); }
    g.fillText('epoch', w - 44, h - 8); g.fillText(`score (${goal === 'paradise' ? 'higher = more rats' : 'lower = fewer rats'})`, 44, 14);
    for (const r of hist) for (const v of r.all) { g.fillStyle = 'rgba(255,107,61,0.45)'; g.beginPath(); g.arc(X(r.epoch), Y(v), 3, 0, Math.PI * 2); g.fill(); }
    g.strokeStyle = '#ff6b3d'; g.lineWidth = 2; g.beginPath(); hist.forEach((r, k) => (k ? g.lineTo(X(r.epoch), Y(r.best.score)) : g.moveTo(X(r.epoch), Y(r.best.score)))); g.stroke();
  }

  // ---- gallery ------------------------------------------------------------------------------------
  function loadGallery() { try { return JSON.parse(localStorage.getItem('ratcity-gallery') || '[]'); } catch { return []; } }
  function save(design, m, name) {
    const { map, ...rest } = m;
    gallery.unshift({ name, design: cloneDesign(design), m: rest, saved: new Date().toISOString().slice(0, 16).replace('T', ' ') });
    try { localStorage.setItem('ratcity-gallery', JSON.stringify(gallery.slice(0, 24))); } catch { /* storage may be off */ }
    flash('Saved to the gallery.');
  }
  const thumbs = new Map();
  async function renderGallery() {
    const el = $('gallery');
    const presets = [
      { name: '2022 rules', design: makeDesign('y2022'), note: 'Bags out at 4 pm, no bins, the sheds of July 2023.' },
      { name: 'Now (Nov 2026)', design: makeDesign('now'), note: 'Bags at 8 pm, bins for small buildings, Empire Bins west of Morningside Park, today\'s sheds.' },
    ];
    const items = [...presets, ...gallery];
    el.innerHTML = '';
    for (const it of items) {
      const div = document.createElement('div'); div.className = 'item';
      div.innerHTML = `<b>${it.name}</b><p class="hint">${it.note ?? describeDesign(city, it.design)}</p><p class="hint score">…</p><div class="row"><button>Play</button></div>`;
      div.querySelector('button').addEventListener('click', () => { state.design = cloneDesign(it.design); sync(); restart('design'); window.scrollTo({ top: 0, behavior: 'smooth' }); });
      el.append(div);
      const key = JSON.stringify(it.design);
      const p = thumbs.get(key) ?? pool.run(it.design, { seeds: [1], keepMap: true });
      thumbs.set(key, p);
      p.then((m) => {
        div.insertBefore(thumbnail(city, { activity: m.map.activity, burrows: m.map.burrows, design: it.design }, { width: 300 }), div.firstChild);
        div.querySelector('.score').textContent = `After a week: ${fmt(m.rats)} rats, seen ${fmt(m.sightings)} times, score ${fmt(m.score, 1)}`;
      });
    }
  }

  // ---- the real data behind it --------------------------------------------------------------------
  function renderData() {
    const months = city.place.months ?? {};
    const keys = Object.keys(months).sort().filter((k) => k < '2026-11');
    const cv = $('real-chart');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = cv.clientWidth * dpr; cv.height = cv.clientHeight * dpr;
    const g = cv.getContext('2d'); g.scale(dpr, dpr);
    const w = cv.clientWidth; const h = cv.clientHeight;
    g.fillStyle = '#0a0d11'; g.fillRect(0, 0, w, h);
    const series = [['sight', '311 rodent calls (this map)', '#ff3d6e'], ['ratFailWide', 'Inspections that found rats (Morningside + W Harlem)', '#ffaa3d'], ['baitWide', 'Burrows baited (same area)', '#c58bff']];
    const hi = Math.max(...keys.flatMap((k) => series.map(([s]) => months[k][s])));
    const X = (k) => 40 + (k / (keys.length - 1)) * (w - 60); const Y = (v) => h - 30 - (v / hi) * (h - 56);
    g.font = '11px system-ui';
    keys.forEach((k, i) => { if (k.endsWith('-01') || i === 0) { g.fillStyle = '#8b96a5'; g.fillText(k.slice(0, 4), X(i) - 12, h - 10); g.strokeStyle = '#1f262e'; g.beginPath(); g.moveTo(X(i), 20); g.lineTo(X(i), h - 28); g.stroke(); } });
    const may = keys.indexOf('2025-05');
    if (may >= 0) { g.strokeStyle = '#5fd38a'; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(X(may), 20); g.lineTo(X(may), h - 28); g.stroke(); g.setLineDash([]); g.fillStyle = '#5fd38a'; g.fillText('Empire Bins in CB9', X(may) + 4, 30); }
    series.forEach(([s, label, col], j) => {
      g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); keys.forEach((k, i) => (i ? g.lineTo(X(i), Y(months[k][s])) : g.moveTo(X(i), Y(months[k][s])))); g.stroke();
      g.fillStyle = col; g.fillText(label, 44 + j * 300, 14);
    });
    const sum = (from, to, s) => keys.filter((k) => k >= from && k <= to).reduce((a, k) => a + months[k][s], 0);
    const before = sum('2023-12', '2024-11', 'sight'); const after = sum('2025-12', '2026-10', 'sight') * (12 / 11);
    $('real-notes').innerHTML = `<b>Inside this map, by month</b> (NYC Open Data, fetched ${'2026-11-18'}).<br><br>
      311 rat calls: ${before} from Dec 2023 to Nov 2024; about ${Math.round(after)} a year since Dec 2025.<br>
      Inspections here: ${city.real.inspections} addresses checked, ${city.real.pts.filter((p) => p.kind === 'insp').length} with rat activity at least once.<br><br>
      The simulation starts its colonies where these reports cluster, and its first work orders are the real 311 calls of the last two weeks.
      The match between where simulated rats run and where people reported them is shown as <i>r</i> in each evaluation.`;
  }

  sync();
  return { handlePick, setTool: (t) => { tool = t; document.querySelectorAll('[data-dtool]').forEach((o) => o.classList.toggle('on', o.dataset.dtool === tool)); } };
}
