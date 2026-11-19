// "What if…?": the environment designer, for someone who has never seen the project.
//
//   1. Tick the changes you want (each is a real policy or a real object on the street).
//   2. Run a week: your street against today's rules, on the same nights, as bars.
//   3. Let the computer try: two variations side by side, pick one, repeat (manual design);
//      or evolve generations of designs toward fewer rats, or toward a rat paradise (automated).
//
// Everything runs whole simulated weeks in Web Workers.

import { makeDesign, cloneDesign, designCost, describeDesign, mutate } from '../sim/design.js';
import { evolve } from '../sim/evaluate.js';
import { thumbnail } from '../render/plan.js';

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
  return { run: (design, opts = {}) => new Promise((resolve, reject) => { queue.push({ id: ++seq, design: JSON.parse(JSON.stringify(design)), opts, resolve, reject }); next(); }) };
}

const fmt = (v, d = 0) => (v == null ? '–' : Number(v).toFixed(d));

export function makeDesigner({ state, city, dataUrl, restart, $, onChange = () => {} }) {
  const pool = makePool(dataUrl);
  const W = city.W;

  // ---- the changes you can tick ----------------------------------------------------------------
  // places for the street objects: where the real reports cluster (spread out), on the right ground
  const hot = (ok, n, gap) => {
    const cand = city.nodes.filter(ok).sort((a, b) => city.real.map[b] - city.real.map[a]);
    const out = [];
    for (const c of cand) { if (out.length >= n) break; if (out.every((o) => Math.hypot((o % W) - (c % W), Math.floor(o / W) - Math.floor(c / W)) >= gap)) out.push(c); }
    return out;
  };
  const CHANGES = [
    { id: 'late', title: 'Bags out at 10 pm', text: 'Residents put trash out two hours later than today (8 pm).', apply: (d) => { d.setOut = 22; } },
    { id: 'bins', title: 'Every building uses a lidded bin', text: 'Today only small buildings and part of the area must.', apply: (d) => { d.binning = 'all'; } },
    { id: 'night', title: 'Collect trash at night', text: 'The truck comes between midnight and 4 am instead of the morning.', apply: (d) => { d.pickup = 'night'; } },
    { id: 'stations', title: '8 bait stations', text: 'Placed where the real 311 calls and inspections cluster.', apply: (d) => { d.stations.push(...hot((i) => city.wall[i], 8, 8)); } },
    { id: 'seal', title: 'Seal 20 tree pits and yards', text: 'Wire mesh or concrete where rats dig, near the hotspots.', apply: (d) => { d.guards.push(...hot((i) => city.soil[i], 20, 4)); } },
    { id: 'sheds', title: 'See-through sidewalk sheds', text: 'Swap every old plywood shed for the 2026 see-through design.', apply: (d) => { for (const s of (d.shedSet === '2023' ? city.sheds2023 : city.sheds)) d.sheds[s.id] = 'light'; } },
    { id: 'lights', title: '10 more street lights', text: 'In the darkest spots near the hotspots.', apply: (d) => { d.lights.push(...hot((i) => city.light[i] < 0.2 && !city.road[i], 10, 8)); } },
    { id: 'patrol', title: 'A third inspector', text: 'One more person on the night patrol.', apply: (d) => { d.inspectors = 3; } },
  ];
  const picked = new Set();
  $('w-changes').innerHTML = CHANGES.map((c) => `<label class="change"><input type="checkbox" data-change="${c.id}"><span><b>${c.title}</b><small>${c.text}</small></span></label>`).join('');
  const build = () => {
    const d = makeDesign($('w-base').value);
    d.name = 'Your street';
    for (const c of CHANGES) if (picked.has(c.id)) c.apply(d);
    return d;
  };
  const sync = () => {
    state.design = build();
    const cost = designCost(state.design); const budget = city.config.budget;
    $('w-cost').innerHTML = `Cost <b>${fmt(cost, 1)}</b> of ${budget}`;
    $('w-costbar').style.width = `${Math.min(100, (cost / budget) * 100)}%`;
    $('w-costbar').classList.toggle('over', cost > budget);
    $('w-run').disabled = false;
    $('w-summary').textContent = picked.size ? `${picked.size} change${picked.size > 1 ? 's' : ''} to ${$('w-base').value === 'y2022' ? 'the 2022 rules' : 'today\'s rules'}. The plan shows where they go.` : 'No changes yet: tick one on the left.';
    onChange();
  };
  document.querySelectorAll('[data-change]').forEach((el) => el.addEventListener('change', () => { if (el.checked) picked.add(el.dataset.change); else picked.delete(el.dataset.change); sync(); }));
  $('w-base').addEventListener('change', sync);

  // ---- run a week: bars --------------------------------------------------------------------------
  const baseCache = new Map();
  const baseline = (preset) => { if (!baseCache.has(preset)) baseCache.set(preset, pool.run(makeDesign(preset), { seeds: [1, 2], keepMap: true })); return baseCache.get(preset); };
  function bars(rows) {
    return rows.map(({ label, a, b, better }) => {
      const max = Math.max(a, b, 1);
      const diff = a ? Math.round(((b - a) / a) * 100) : 0;
      const good = better === 'lower' ? b < a : b > a;
      const tag = Math.abs(diff) < 3 ? '<em class="same">about the same</em>' : `<em class="${good ? 'good' : 'bad'}">${diff > 0 ? '+' : ''}${diff}%</em>`;
      return `<div class="bars"><div class="bl">${label} ${tag}</div>
        <div class="br"><span>Today's rules</span><i style="width:${(a / max) * 100}%"></i><b>${fmt(a)}</b></div>
        <div class="br you"><span>Your street</span><i style="width:${(b / max) * 100}%"></i><b>${fmt(b)}</b></div></div>`;
    }).join('');
  }
  function verdict(a, b) {
    const d = Math.round(((b.rats - a.rats) / Math.max(1, a.rats)) * 100);
    if (d <= -10) return `Your street ends the week with <b>${-d}% fewer rats</b> than today's rules.`;
    if (d >= 10) return `Your street ends the week with <b>${d}% more rats</b>: these changes help the rats.`;
    return 'Your street ends the week with <b>about as many rats</b> as today\'s rules.';
  }
  $('w-run').addEventListener('click', async () => {
    $('w-run').disabled = true; $('w-result').innerHTML = '<p class="tiny">Running two simulated weeks of your street and of today\'s rules…</p>';
    try {
      const [a, b] = await Promise.all([baseline('now'), pool.run(state.design, { seeds: [1, 2], keepMap: true })]);
      $('w-result').innerHTML = `<p class="verdict">${verdict(a, b)}</p>${bars([
        { label: 'Rats left after a week', a: a.rats, b: b.rats, better: 'lower' },
        { label: 'Times people saw a rat', a: a.sightings, b: b.sightings, better: 'lower' },
        { label: 'Rats caught by the patrol', a: a.caught ?? 0, b: b.caught ?? 0, better: 'higher' },
        { label: 'Food the rats ate', a: a.eaten, b: b.eaten, better: 'lower' },
      ])}<div class="maps"><figure></figure><figure></figure></div>`;
      const figs = $('w-result').querySelectorAll('figure');
      figs[0].append(thumbnail(city, { activity: a.map.activity, burrows: a.map.burrows, design: makeDesign('now') }, { width: 300 })); figs[0].insertAdjacentHTML('beforeend', '<figcaption>Today: where rats ran</figcaption>');
      figs[1].append(thumbnail(city, { activity: b.map.activity, burrows: b.map.burrows, design: state.design }, { width: 300 })); figs[1].insertAdjacentHTML('beforeend', '<figcaption>Your street: where rats ran</figcaption>');
    } catch (err) { console.error(err); $('w-result').innerHTML = `<p class="tiny">Could not run: ${err.message}</p>`; }
    $('w-run').disabled = false;
  });
  $('w-watch').addEventListener('click', () => { restart('design'); document.querySelector('.pages [data-page="watch"]')?.click(); });

  // ---- let the computer try: two options (manual) --------------------------------------------------
  let pair = null; let lineage = []; let abSeed = 1;
  async function makePair() {
    pair = [mutate(city, state.design, abSeed++ * 97, 1.2), mutate(city, state.design, abSeed++ * 97 + 13, 1.2)];
    for (const [k, id] of [[0, 'var-a'], [1, 'var-b']]) $(id).innerHTML = `<h3>Option ${k ? 'B' : 'A'}</h3><p class="tiny">${describeDesign(city, pair[k])}</p><p class="tiny">Running a week…</p>`;
    const ms = await Promise.all(pair.map((d) => pool.run(d, { seeds: [1, 2], keepMap: true })));
    ms.forEach((m, k) => {
      const el = $(k ? 'var-b' : 'var-a');
      el.innerHTML = `<h3>Option ${k ? 'B' : 'A'} <span>${fmt(m.rats)} rats left · seen ${fmt(m.sightings)} times</span></h3><p class="tiny">${describeDesign(city, pair[k])}</p>`;
      el.append(thumbnail(city, { activity: m.map.activity, burrows: m.map.burrows, design: pair[k] }, { width: 420 }));
      el.insertAdjacentHTML('beforeend', `<div class="row"><button class="primary" data-choose>I prefer ${k ? 'B' : 'A'}</button><button data-watch>Watch it</button></div>`);
      el.querySelector('[data-choose]').addEventListener('click', () => { lineage.push(`${k ? 'B' : 'A'} (${fmt(m.rats)} rats)`); state.design = cloneDesign(pair[k]); $('ab-lineage').textContent = `Your choices: ${lineage.join(' → ')}`; makePair(); });
      el.querySelector('[data-watch]').addEventListener('click', () => { state.design = cloneDesign(pair[k]); restart('design'); document.querySelector('.pages [data-page="watch"]')?.click(); });
    });
  }
  $('ab-start').addEventListener('click', () => { lineage = []; $('ab-box').hidden = false; makePair(); });

  // ---- let the computer try: evolve (automated) -------------------------------------------------------
  let evBest = null;
  $('ev-run').addEventListener('click', async () => {
    const goal = $('ev-goal').value;
    $('ev-run').disabled = true; $('ev-play').disabled = true; $('ev-box').hidden = false;
    const hist = [];
    try {
      const res = await evolve(city, goal === 'paradise' ? makeDesign('now') : state.design, {
        epochs: 6, population: 4, objective: goal, seed: Math.floor(Math.random() * 1e6),
        evaluate: (d) => pool.run(d, { seeds: [1, 2] }),
        onEpoch: (rec, best) => {
          hist.push(rec); drawEvolution($('ev-chart'), hist, goal);
          $('ev-best').innerHTML = `<b>Generation ${rec.epoch} of 6</b>: best so far leaves <b>${fmt(best.m.rats)} rats</b> (seen ${fmt(best.m.sightings)} times).<br>${describeDesign(city, best.design)}`;
        },
      });
      evBest = res.best; $('ev-play').disabled = false;
    } catch (err) { console.error(err); $('ev-best').textContent = `Could not run: ${err.message}`; }
    $('ev-run').disabled = false;
  });
  $('ev-play').addEventListener('click', () => { if (!evBest) return; state.design = cloneDesign(evBest.design); restart('design'); document.querySelector('.pages [data-page="watch"]')?.click(); });

  function drawEvolution(cv, hist, goal) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = cv.clientWidth * dpr; cv.height = cv.clientHeight * dpr;
    const g = cv.getContext('2d'); g.scale(dpr, dpr);
    const w = cv.clientWidth; const h = cv.clientHeight;
    g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
    const pts = hist.flatMap((r) => (r.designs ?? [{ m: r.best }]).map((x) => [r.epoch, x.m.rats]));
    const bestLine = hist.map((r) => [r.epoch, r.best.rats]);
    const lo = 0; const hi = Math.max(...pts.map((p) => p[1]), 1) * 1.1;
    const X = (e) => 46 + (e / 6) * (w - 66); const Y = (v) => h - 28 - ((v - lo) / (hi - lo)) * (h - 50);
    g.strokeStyle = '#ebe9e3'; g.fillStyle = '#737880'; g.font = '11px Inter, system-ui';
    for (let k = 0; k <= 4; k++) { const v = (hi * k) / 4; g.beginPath(); g.moveTo(46, Y(v)); g.lineTo(w - 16, Y(v)); g.stroke(); g.fillText(v.toFixed(0), 10, Y(v) + 4); }
    for (let e = 0; e <= 6; e++) g.fillText(e ? `gen ${e}` : 'start', X(e) - 12, h - 8);
    g.fillText(`rats left after a week (${goal === 'paradise' ? 'more is "better" for the rats' : 'fewer is better'})`, 50, 14);
    for (const [e, v] of pts) { g.fillStyle = 'rgba(179,74,53,0.35)'; g.beginPath(); g.arc(X(e), Y(v), 4, 0, Math.PI * 2); g.fill(); }
    g.strokeStyle = '#b34a35'; g.lineWidth = 2.5; g.beginPath(); bestLine.forEach(([e, v], k) => (k ? g.lineTo(X(e), Y(v)) : g.moveTo(X(e), Y(v)))); g.stroke();
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
    g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
    const series = [['sight', '311 rodent calls (this map)', '#b34a35'], ['ratFailWide', 'Inspections that found rats (wider area)', '#d4a514'], ['baitWide', 'Burrows baited (wider area)', '#7d5bb5']];
    const hi = Math.max(...keys.flatMap((k) => series.map(([s]) => months[k][s])));
    const X = (k) => 40 + (k / (keys.length - 1)) * (w - 60); const Y = (v) => h - 30 - (v / hi) * (h - 56);
    g.font = '11px Inter, system-ui';
    keys.forEach((k, i) => { if (k.endsWith('-01') || i === 0) { g.fillStyle = '#737880'; g.fillText(k.slice(0, 4), X(i) - 12, h - 10); g.strokeStyle = '#ebe9e3'; g.beginPath(); g.moveTo(X(i), 20); g.lineTo(X(i), h - 28); g.stroke(); } });
    const may = keys.indexOf('2025-05');
    if (may >= 0) { g.strokeStyle = '#2f9e62'; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(X(may), 20); g.lineTo(X(may), h - 28); g.stroke(); g.setLineDash([]); g.fillStyle = '#2f9e62'; g.fillText('Empire Bins arrive (May 2025)', X(may) + 4, 30); }
    series.forEach(([s, label, col], j) => {
      g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); keys.forEach((k, i) => (i ? g.lineTo(X(i), Y(months[k][s])) : g.moveTo(X(i), Y(months[k][s])))); g.stroke();
      g.fillStyle = col; g.fillText(label, 44 + j * 250, 14);
    });
    $('real-notes').innerHTML = `Inside this map: ${city.real.r311} 311 rodent calls from Nov 2023 to Nov 2026, and ${city.real.pts.filter((p) => p.kind === 'insp').length} addresses where inspectors found rats. The simulation starts its rat colonies where these cluster, and the patrol's first work orders are the real 311 calls of the last two weeks.`;
  }

  sync();
  return { renderData, handlePick: () => false, setTool: () => {} };
}
