// The environment designer: edit a design on the real map, evaluate it, compare two variations
// side by side and choose (manual), or let designs evolve over epochs (automated). Evaluations run
// in Web Workers, several at once, so the page stays responsive.

import { buildCity, barricadeCells } from '../sim/city.js';
import { applyDesign } from '../sim/sim.js';
import { randomDesign, mutate, designCost, describeDesign, plowableStreets, BUDGET, COST, LIMITS } from '../sim/design.js';
import { objectiveScore } from '../sim/evaluate.js';
import { drawDesignMap, cellFromEvent } from '../render/plans.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = (v) => `${Math.round(v * 100)}%`;
const GALLERY_KEY = 'whiteout-gallery-v1';

// ---- a pool of workers ------------------------------------------------------------------------
function makePool() {
  const size = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
  const workers = [];
  const queue = [];
  const pending = new Map();
  let nextJob = 1;
  let fallback = null;
  try {
    for (let i = 0; i < size; i++) {
      const w = new Worker(new URL('../sim/worker.js', import.meta.url), { type: 'module' });
      w.busy = false;
      w.onmessage = (e) => {
        const p = pending.get(e.data.job);
        pending.delete(e.data.job);
        w.busy = false;
        if (e.data.error) p.reject(new Error(e.data.error)); else p.resolve(e.data.result);
        pump();
      };
      w.onerror = (e) => { console.error(e); };
      workers.push(w);
    }
  } catch (err) {
    console.warn('No module workers; evaluating on the page', err);
  }
  function pump() {
    for (const w of workers) {
      if (w.busy || !queue.length) continue;
      const job = queue.shift();
      w.busy = true;
      pending.set(job.msg.job, job);
      w.postMessage(job.msg);
    }
  }
  async function run(msg) {
    if (!workers.length) {
      fallback = fallback ?? await import('../sim/evaluate.js');
      const { loadPlace } = await import('../data/load.js');
      await new Promise((r) => setTimeout(r, 0));
      return fallback.evaluateDesign(await loadPlace(msg.placeId), msg.config, msg.design, msg);
    }
    return new Promise((resolve, reject) => { queue.push({ msg: { ...msg, job: nextJob++ }, resolve, reject }); pump(); });
  }
  return { run, size: workers.length || 1 };
}

export function makeDesigner(hooks) {
  const pool = makePool();
  const st = {
    place: null, config: null, base: null, world: null, design: null, result: null, tool: 'warming',
    lineage: [], ab: null, evo: null, evoStop: false, gallery: loadGallery(), seq: 1,
  };
  $('budget-total').textContent = BUDGET;

  // ---- the current design ---------------------------------------------------------------
  function initial(place, config) {
    const base = buildCity(place, config, {});
    const d = randomDesign(base, 20261116);
    d.id = 'start';
    return d;
  }

  function setPlace(place, config, world) {
    const changed = !st.place || st.place.id !== place.id;
    st.place = place; st.config = config;
    if (changed) {
      st.base = buildCity(place, config, {});
      const sel = $('sel-plow');
      sel.innerHTML = '<option value="">add or remove a plowed street…</option>' + plowableStreets(st.base).map((n) => `<option>${esc(n)}</option>`).join('');
    }
    void world;
  }

  function reset() {
    st.design = initial(st.place, st.config);
    st.lineage = [{ design: st.design, note: 'Starting design', metrics: null }];
    st.result = null;
    st.ab = null;
    refresh();
    renderLineage();
    renderAB();
    renderGallery();
  }

  function setDesign(d, note) {
    st.design = d;
    st.result = null;
    if (note) { st.lineage.push({ design: d, note, metrics: null }); renderLineage(); }
    refresh();
  }

  function worldFor(d) {
    const w = buildCity(st.place, st.config, d);
    applyDesign(w, d, st.config);
    return w;
  }

  function refresh() {
    st.world = worldFor(st.design);
    drawDesignMap($('design-canvas'), st.world, st.design, st.result);
    const cost = designCost(st.design);
    $('budget-bar').style.width = `${Math.min(100, (100 * cost) / BUDGET)}%`;
    $('budget-bar').classList.toggle('over', cost > BUDGET);
    $('budget-text').textContent = `${cost} of ${BUDGET} points`;
    $('design-desc').textContent = describeDesign(st.design);
    $('design-metrics').innerHTML = st.result ? metricsHtml(st.result.metrics) : '<p class="caption">Not evaluated yet.</p>';
  }

  // ---- editing on the map -----------------------------------------------------------------
  document.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => {
    st.tool = b.dataset.tool;
    document.querySelectorAll('[data-tool]').forEach((o) => o.classList.toggle('on', o === b));
  }));
  const near = (a, b, r) => Math.max(Math.abs((a % st.world.W) - (b % st.world.W)), Math.abs(Math.floor(a / st.world.W) - Math.floor(b / st.world.W))) <= r;
  $('design-canvas').addEventListener('click', (e) => {
    if (!st.world) return;
    const cell = cellFromEvent($('design-canvas'), st.world, e);
    if (cell === null) return;
    const d = structuredClone(st.design);
    d.parent = st.design.id; d.id = `m${st.seq++}`;
    const open = st.base.walk[cell];
    const t = st.tool;
    const over = (extra) => designCost(d) + extra > BUDGET;
    if (t === 'erase') {
      const n0 = d.warming.length + d.caches.length + d.barricades.length;
      d.warming = d.warming.filter((c) => !near(c, cell, 1));
      d.caches = d.caches.filter((c) => !near(c.cell, cell, 1));
      d.barricades = d.barricades.filter((b) => !barricadeCells(st.world.W, st.world.H, b).some((c) => near(c, cell, 0)));
      if (n0 === d.warming.length + d.caches.length + d.barricades.length) { hooks.flash('Nothing to remove there.'); return; }
    } else if (!open) { hooks.flash('Pick open ground: a street, a path, a lawn.'); return; }
    else if (t === 'warming') {
      if (d.warming.length >= LIMITS.warming) { hooks.flash(`At most ${LIMITS.warming} warming centres.`); return; }
      if (over(COST.warming)) { hooks.flash('Over budget: remove something first.'); return; }
      d.warming.push(cell);
    } else if (['battery', 'warmers', 'food'].includes(t)) {
      if (d.caches.length >= LIMITS.caches) { hooks.flash(`At most ${LIMITS.caches} caches.`); return; }
      if (over(COST.cache)) { hooks.flash('Over budget: remove something first.'); return; }
      d.caches.push({ cell, type: t });
    } else if (t === 'barricade') {
      if (d.barricades.length >= LIMITS.barricades) { hooks.flash(`At most ${LIMITS.barricades} barricades.`); return; }
      if (over(COST.barricade)) { hooks.flash('Over budget: remove something first.'); return; }
      const dir = e.shiftKey ? 'v' : 'h';
      const cells = barricadeCells(st.world.W, st.world.H, { cell, dir });
      if (cells.some((c) => st.world.doorCells.includes(c))) { hooks.flash('Not on the refuge door.'); return; }
      d.barricades.push({ cell, dir });
    } else if (t === 'lair') d.lair = cell;
    setDesign(d, null);
  });
  $('sel-plow').addEventListener('change', (e) => {
    const name = e.target.value;
    e.target.value = '';
    if (!name) return;
    const d = structuredClone(st.design);
    d.parent = st.design.id; d.id = `m${st.seq++}`;
    if (d.plowed.includes(name)) d.plowed = d.plowed.filter((n) => n !== name);
    else {
      if (d.plowed.length >= LIMITS.plowed) { hooks.flash(`At most ${LIMITS.plowed} plowed streets.`); return; }
      if (designCost(d) + COST.plow > BUDGET) { hooks.flash('Over budget: remove something first.'); return; }
      d.plowed.push(name);
    }
    setDesign(d, null);
  });

  // ---- evaluation ---------------------------------------------------------------------------
  // Designs are always evaluated on the recorded storm (the workers load the place from its file);
  // with tonight's live weather above, the evaluation still uses the 2016 night.
  const evalConfig = () => {
    const cfg = structuredClone(st.config);
    if (String(st.place.weather?.source ?? '').includes('live')) cfg.night = { start: '2016-01-23T17:00', hours: 12 };
    return cfg;
  };
  const evaluate = (design, rounds, seed = 7) => pool.run({ placeId: st.place.id, design, rounds, seed, config: evalConfig() });

  $('btn-eval').addEventListener('click', async () => {
    const b = $('btn-eval');
    b.disabled = true; b.textContent = 'Evaluating…';
    try {
      const d = st.design;
      const r = await evaluate(d, 8);
      if (st.design === d) { st.result = r; refresh(); }
    } catch (err) { console.error(err); hooks.flash('Evaluation failed: see the console.'); }
    b.disabled = false; b.textContent = 'Evaluate (8 nights)';
  });
  $('btn-play-design').addEventListener('click', () => hooks.play(st.design));
  $('btn-random').addEventListener('click', () => { const d = randomDesign(st.base, Math.floor(Math.random() * 1e9)); setDesign(d, 'A random design'); });

  function metricsHtml(m, other = null) {
    const cmp = (k, better = 'up') => {
      if (!other) return '';
      const d = m[k] - other[k];
      if (Math.abs(d) < 1e-9) return '';
      const good = better === 'up' ? d > 0 : d < 0;
      return ` <em class="${good ? 'good' : 'bad'}">${d > 0 ? '▲' : '▼'}</em>`;
    };
    return `<div class="m-grid">`
      + `<span class="m-escaped"><b>${pct(m.escapeRate)}${cmp('escapeRate')}</b>reached the refuge</span>`
      + `<span class="m-caught"><b>${pct(m.catchRate)}${cmp('catchRate', 'down')}</b>caught</span>`
      + `<span class="m-froze"><b>${pct(m.freezeRate)}${cmp('freezeRate', 'down')}</b>froze</span>`
      + `<span class="m-dawn"><b>${pct(m.dawnRate)}</b>lasted till dawn</span>`
      + `<span><b>${m.survivorScore}${cmp('survivorScore')}</b>survivor score</span>`
      + `<span><b>${m.creatureScore}</b>creature score</span>`
      + `<span><b>${Math.round(m.meanWarmth)}</b>warmth kept</span>`
      + `<span><b>${m.cachesPerSurvivor.toFixed(1)}</b>caches each</span>`
      + `</div><p class="caption">${m.survivors} survivors over the nights played.</p>`;
  }

  // ---- manual: choose your own adventure -------------------------------------------------------
  async function makeAB() {
    const b = $('btn-ab');
    b.disabled = true; b.textContent = 'Playing both…';
    const rounds = Number($('ab-rounds').value);
    const strength = Number($('ab-strength').value);
    const seed = 1000 + st.seq;
    const A = mutate(st.base, st.design, seed * 7 + 1, strength);
    const B = mutate(st.base, st.design, seed * 7 + 2, strength);
    A.id = `a${st.seq}`; B.id = `b${st.seq}`; st.seq++;
    st.ab = { A: { design: A, result: null }, B: { design: B, result: null } };
    renderAB();
    try {
      const [ra, rb] = await Promise.all([evaluate(A, rounds, seed), evaluate(B, rounds, seed)]);
      if (st.ab?.A.design === A) { st.ab.A.result = ra; st.ab.B.result = rb; renderAB(); }
    } catch (err) { console.error(err); hooks.flash('Evaluation failed: see the console.'); }
    b.disabled = false; b.textContent = 'Make two new variations';
  }
  function renderAB() {
    for (const k of ['A', 'B']) {
      const card = $(`ab-${k.toLowerCase()}`);
      const entry = st.ab?.[k];
      const other = st.ab?.[k === 'A' ? 'B' : 'A'];
      card.querySelector('.ab-desc').textContent = entry ? describeDesign(entry.design) : 'Make two variations to compare.';
      const cv = card.querySelector('canvas');
      if (entry && st.place) drawDesignMap(cv, worldFor(entry.design), entry.design, entry.result);
      else if (st.world) { drawDesignMap(cv, st.world, st.design, null); const g = cv.getContext('2d'); g.fillStyle = 'rgba(5, 7, 10, 0.6)'; g.fillRect(0, 0, cv.width, cv.height); }
      card.querySelector('.metrics').innerHTML = entry?.result ? metricsHtml(entry.result.metrics, other?.result?.metrics) : entry ? '<p class="caption">Playing the nights…</p>' : '';
      card.querySelector('.ab-pick').disabled = !entry?.result;
    }
  }
  $('btn-ab').addEventListener('click', makeAB);
  document.querySelectorAll('.ab-pick').forEach((b, i) => b.addEventListener('click', () => {
    const k = i === 0 ? 'A' : 'B';
    const entry = st.ab[k];
    const other = st.ab[k === 'A' ? 'B' : 'A'];
    st.design = entry.design;
    st.result = entry.result;
    st.lineage.push({ design: entry.design, note: `Chose ${k} (score ${entry.result.metrics.survivorScore} vs ${other.result.metrics.survivorScore})`, metrics: entry.result.metrics });
    renderLineage();
    refresh();
    makeAB();
  }));
  function renderLineage() {
    $('lineage').innerHTML = st.lineage.map((l, i) => `<li><b>${i}</b> ${esc(l.note)}<small>${esc(describeDesign(l.design))}${l.metrics ? ` · reached ${pct(l.metrics.escapeRate)}, caught ${pct(l.metrics.catchRate)}, froze ${pct(l.metrics.freezeRate)}` : ''}</small>`
      + `<button type="button" class="btn btn-xs" data-i="${i}">back to this</button></li>`).join('');
  }
  $('lineage').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-i]');
    if (!b) return;
    const l = st.lineage[Number(b.dataset.i)];
    st.design = l.design; st.result = null;
    refresh();
  });

  // ---- automated evolution -----------------------------------------------------------------
  async function runEvolution() {
    const epochs = clampInt($('evo-epochs').value, 1, 60);
    const pop = clampInt($('evo-pop').value, 1, 12);
    const rounds = clampInt($('evo-rounds').value, 1, 20);
    const objective = $('evo-objective').value;
    const seed = 500 + st.seq++;
    st.evoStop = false;
    $('btn-evolve').disabled = true; $('btn-evolve-stop').disabled = false; $('btn-use-best').disabled = true;
    $('evo-strip').innerHTML = '';
    const history = [];
    const t0 = performance.now();
    let generated = 0;
    try {
      let best = await evaluate(st.design, rounds, seed);
      best.score = objectiveScore(best.metrics, objective);
      generated++;
      history.push({ epoch: 0, best: best.score, mean: best.score, scores: [best.score] });
      showEvo(history, best, generated, epochs, pop, t0);
      for (let e = 1; e <= epochs && !st.evoStop; e++) {
        const designs = [];
        for (let p = 0; p < pop; p++) {
          const d = mutate(st.base, best.design, seed * 1000 + e * 37 + p * 101, 1 + (p % 3) * 0.4);
          d.id = `e${e}.${p + 1}`;
          designs.push(d);
        }
        const results = await Promise.all(designs.map((d) => evaluate(d, rounds, seed)));
        generated += results.length;
        for (const r of results) r.score = objectiveScore(r.metrics, objective);
        const top = results.reduce((a, b) => (b.score > a.score ? b : a));
        const improved = top.score > best.score;
        if (top.score >= best.score) best = top;
        const scores = results.map((r) => r.score);
        history.push({ epoch: e, best: best.score, mean: scores.reduce((a, b) => a + b, 0) / scores.length, scores, improved });
        showEvo(history, best, generated, epochs, pop, t0);
        addStrip(e, top, improved);
      }
      st.evo = { best, history, objective };
      $('btn-use-best').disabled = false;
    } catch (err) { console.error(err); hooks.flash('Evolution failed: see the console.'); }
    $('btn-evolve').disabled = false; $('btn-evolve-stop').disabled = true;
  }
  function showEvo(history, best, generated, epochs, pop, t0) {
    drawChart($('evo-chart'), history);
    drawDesignMap($('evo-best'), worldFor(best.design), best.design, best);
    $('evo-metrics').innerHTML = metricsHtml(best.metrics);
    const e = history[history.length - 1].epoch;
    $('evo-status').textContent = `Epoch ${e} of ${epochs} · ${generated} environments generated and evaluated (${pop} per epoch) · best score ${best.score} · ${((performance.now() - t0) / 1000).toFixed(0)} s · ${pool.size} worker${pool.size === 1 ? '' : 's'}`;
  }
  function addStrip(e, r, improved) {
    const div = document.createElement('div');
    div.className = `strip-item${improved ? ' improved' : ''}`;
    const cv = document.createElement('canvas');
    cv.className = 'plan';
    div.append(cv);
    const p = document.createElement('p');
    p.innerHTML = `<b>Epoch ${e}</b> best of epoch ${r.score}${improved ? ' · new best' : ''}`;
    div.append(p);
    $('evo-strip').append(div);
    requestAnimationFrame(() => drawDesignMap(cv, worldFor(r.design), r.design, r, { heat: false }));
  }
  $('btn-evolve').addEventListener('click', runEvolution);
  $('btn-evolve-stop').addEventListener('click', () => { st.evoStop = true; });
  $('btn-use-best').addEventListener('click', () => {
    if (!st.evo) return;
    const b = st.evo.best;
    st.design = b.design; st.result = b;
    st.lineage.push({ design: b.design, note: `Best after ${st.evo.history.length - 1} epochs (${st.evo.objective === 'creature' ? 'helping the creature' : 'helping the survivors'}, score ${b.score})`, metrics: b.metrics });
    renderLineage();
    refresh();
    hooks.flash('The evolved design is now the current design.');
  });

  // ---- gallery -------------------------------------------------------------------------------
  function loadGallery() { try { return JSON.parse(localStorage.getItem(GALLERY_KEY) || '[]'); } catch { return []; } }
  function saveGallery() { try { localStorage.setItem(GALLERY_KEY, JSON.stringify(st.gallery)); } catch { /* private mode */ } }
  async function loadPresets() {
    try {
      const r = await fetch(new URL('../../data/gallery.json', import.meta.url));
      if (r.ok) return (await r.json()).map((g) => ({ ...g, preset: true }));
    } catch { /* none */ }
    return [];
  }
  let presets = [];
  loadPresets().then((p) => { presets = p; renderGallery(); });
  function renderGallery() {
    if (!st.place) return;
    const items = [...presets, ...st.gallery].filter((g) => g.design.place === st.place.id);
    $('gallery').innerHTML = items.length ? '' : '<p class="caption">Nothing saved for this place yet. Evaluate a design and press “Save to gallery”.</p>';
    for (const g of items) {
      const div = document.createElement('div');
      div.className = 'g-item';
      div.innerHTML = `<canvas class="plan"></canvas><h3>${esc(g.name)}${g.preset ? ' <small>(preset)</small>' : ''}</h3><p>${esc(g.note || '')}</p><p class="caption">${esc(describeDesign(g.design))}</p>`
        + (g.metrics ? `<p class="caption">reached ${pct(g.metrics.escapeRate)} · caught ${pct(g.metrics.catchRate)} · froze ${pct(g.metrics.freezeRate)} · score ${g.metrics.survivorScore}</p>` : '');
      const row = document.createElement('div');
      row.className = 'btn-row';
      const use = document.createElement('button'); use.className = 'btn btn-xs'; use.textContent = 'Make current';
      use.onclick = () => { st.design = g.design; st.result = g.result ?? null; st.lineage.push({ design: g.design, note: `From the gallery: ${g.name}`, metrics: g.metrics }); renderLineage(); refresh(); };
      const play = document.createElement('button'); play.className = 'btn btn-xs'; play.textContent = 'Play';
      play.onclick = () => hooks.play(g.design);
      row.append(use, play);
      if (!g.preset) {
        const del = document.createElement('button'); del.className = 'btn btn-xs'; del.textContent = 'Delete';
        del.onclick = () => { st.gallery = st.gallery.filter((x) => x !== g); saveGallery(); renderGallery(); };
        row.append(del);
      }
      div.append(row);
      $('gallery').append(div);
      requestAnimationFrame(() => drawDesignMap(div.querySelector('canvas'), worldFor(g.design), g.design, g.result ?? null, { heat: true }));
    }
  }
  $('btn-save').addEventListener('click', () => {
    const name = prompt('A name for this design:', `Design ${st.gallery.length + 1}`);
    if (!name) return;
    const note = prompt('Why is it interesting? (a sentence for the gallery)', '') ?? '';
    const r = st.result;
    st.gallery.push({ name, note, design: st.design, metrics: r?.metrics ?? null, result: r ? { traces: r.traces, heat: r.heat } : null, saved: new Date().toISOString() });
    saveGallery();
    renderGallery();
    document.querySelector('[data-tab="gallery"]').click();
  });
  $('btn-export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ design: st.design, metrics: st.result?.metrics ?? null, lineage: st.lineage.map((l) => ({ note: l.note, design: l.design, metrics: l.metrics })), gallery: st.gallery }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `whiteout-${st.place.id}-${st.design.id}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $('file-import').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      const d = j.design ?? j;
      if (d.place !== st.place.id) { hooks.flash(`That design is for another place (${d.place}). Switch the place first.`); return; }
      if (Array.isArray(j.gallery)) { st.gallery.push(...j.gallery.filter((g) => !st.gallery.some((x) => x.saved === g.saved))); saveGallery(); renderGallery(); }
      setDesign(d, 'Loaded from a file');
    } catch (err) { hooks.flash('That file is not a design.'); }
    e.target.value = '';
  });

  // ---- tabs ----------------------------------------------------------------------------------
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((o) => o.classList.toggle('on', o === t));
    for (const k of ['manual', 'auto', 'gallery']) $(`pane-${k}`).hidden = k !== t.dataset.tab;
    if (t.dataset.tab === 'gallery') renderGallery();
    if (t.dataset.tab === 'manual') renderAB();
  }));

  return {
    setPlace, reset, initial, current: () => st.design,
    async onPlaceChanged() { reset(); },
  };
}

const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v) || lo)));

// Score by epoch: the best so far (line), the mean of each epoch (dashed), each variation (dots).
function drawChart(svg, history) {
  const W = 600; const H = 260; const P = { l: 44, r: 12, t: 14, b: 34 };
  const all = history.flatMap((h) => h.scores.concat([h.best]));
  const lo = Math.floor(Math.min(...all) / 10) * 10; const hi = Math.ceil(Math.max(...all, lo + 10) / 10) * 10;
  const n = Math.max(1, history[history.length - 1].epoch);
  const X = (e) => P.l + ((W - P.l - P.r) * e) / n;
  const Y = (v) => P.t + (H - P.t - P.b) * (1 - (v - lo) / (hi - lo || 1));
  let s = '';
  for (let v = lo; v <= hi; v += Math.max(5, Math.round((hi - lo) / 5 / 5) * 5)) s += `<line x1="${P.l}" x2="${W - P.r}" y1="${Y(v)}" y2="${Y(v)}" class="grid"/><text x="${P.l - 6}" y="${Y(v) + 4}" class="tick" text-anchor="end">${v}</text>`;
  for (const h of history) s += `<text x="${X(h.epoch)}" y="${H - P.b + 16}" class="tick" text-anchor="middle">${h.epoch}</text>`;
  s += `<text x="${(P.l + W - P.r) / 2}" y="${H - 4}" class="tick" text-anchor="middle">epoch</text>`;
  for (const h of history) for (const v of h.scores) s += `<circle cx="${X(h.epoch)}" cy="${Y(v)}" r="3.5" class="dot"><title>epoch ${h.epoch}: ${v}</title></circle>`;
  s += `<polyline class="mean" points="${history.map((h) => `${X(h.epoch)},${Y(h.mean)}`).join(' ')}"/>`;
  s += `<polyline class="best" points="${history.map((h) => `${X(h.epoch)},${Y(h.best)}`).join(' ')}"/>`;
  const last = history[history.length - 1];
  s += `<text x="${X(last.epoch) - 4}" y="${Y(last.best) - 8}" class="label" text-anchor="end">best ${last.best}</text>`;
  svg.innerHTML = s;
}
