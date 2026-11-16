// Builds data/gallery.json: for every place, a few environments worth looking at, each evaluated
// on the same 10 nights: no response at all, a hand-made "warm the streets" response, the design
// evolved to help the survivors, and the design evolved to help the creature.
// Usage: node tools/make_gallery.mjs [epochs] [population] [nights per evaluation]

import { writeFile } from 'node:fs/promises';
import { CONFIG } from '../src/sim/config.js';
import { PLACES } from '../src/data/places.js';
import { buildCity } from '../src/sim/city.js';
import { randomDesign } from '../src/sim/design.js';
import { evaluateDesign, evolve } from '../src/sim/evaluate.js';
import { loadPlace } from '../tests/load.mjs';

const epochs = Number(process.argv[2] || 8);
const population = Number(process.argv[3] || 4);
const nights = Number(process.argv[4] || 4);
const FINAL_NIGHTS = 10;
const out = [];

const pct = (v) => `${Math.round(v * 100)}%`;
const summary = (m) => `reached ${pct(m.escapeRate)}, caught ${pct(m.catchRate)}, froze ${pct(m.freezeRate)}, dawn ${pct(m.dawnRate)}`;

for (const p of PLACES) {
  const place = loadPlace(p.id);
  const world = buildCity(place, CONFIG, {});
  const start = randomDesign(world, 20261116);
  start.id = 'start';
  const keep = (name, design, extra = {}) => {
    const r = evaluateDesign(place, CONFIG, design, { rounds: FINAL_NIGHTS, seed: 99 });
    const entry = { name, design, metrics: r.metrics, result: { traces: r.traces, heat: r.heat }, ...extra };
    out.push(entry);
    console.log(`${p.id.padEnd(12)} ${name.padEnd(34)} ${summary(r.metrics)} · score ${r.metrics.survivorScore}`);
    return entry;
  };
  keep('No response', { id: 'none', place: p.id, parent: null, lair: start.lair, warming: [], caches: [], plowed: [], barricades: [] });
  keep('The starting design', start);
  const t0 = Date.now();
  const forS = evolve(place, CONFIG, start, { epochs, population, rounds: nights, seed: 3, objective: 'survivors' });
  keep('Evolved to help the survivors', { ...forS.best.design, id: 'evo-survivors' }, { history: forS.history.map((h) => ({ epoch: h.epoch, best: h.best, mean: Math.round(h.mean * 10) / 10 })) });
  const forC = evolve(place, CONFIG, start, { epochs, population, rounds: nights, seed: 3, objective: 'creature' });
  keep('Evolved to help the creature', { ...forC.best.design, id: 'evo-creature' }, { history: forC.history.map((h) => ({ epoch: h.epoch, best: h.best, mean: Math.round(h.mean * 10) / 10 })) });
  console.log(`  (${Math.round((Date.now() - t0) / 1000)} s of evolution)`);
}

// the notes are written by hand in data/gallery-notes.json after looking at the results
let notes = {};
try { notes = JSON.parse(await (await import('node:fs/promises')).readFile(new URL('../data/gallery-notes.json', import.meta.url), 'utf8')); } catch { /* none yet */ }
for (const g of out) g.note = notes[`${g.design.place}/${g.name}`] ?? '';
await writeFile(new URL('../data/gallery.json', import.meta.url), JSON.stringify(out));
console.log(`data/gallery.json: ${out.length} environments`);
