// The environment designer's tools: score a store by running nights in it, and evolve stores.
//
// Every store in a comparison is run with the same seeds (the same survivors with the same lists
// arriving at the same times), so differences in score come from the layout, not from luck.

import { buildStore, mutateGenome, randomGenome } from './store.js';
import { makeSim, runNights } from './sim.js';
import { computeLight } from './light.js';
import { makeRng } from './rng.js';

export const OBJECTIVES = {
  haven: {
    label: 'Safe haven',
    blurb: 'A store where survivors get what they need and get out alive.',
    score: (m) => 100 * m.escapeRate + 40 * m.items - 0.15 * (m.escapeTime ?? 60) - 4 * m.exposure,
  },
  trap: {
    label: 'Creature’s den',
    blurb: 'A store that works for the hunter: survivors get lost and caught.',
    score: (m) => 100 * m.catchRate + 0.25 * Math.max(0, 120 - (m.firstCatch ?? 120)) - 20 * m.items,
  },
  thriller: {
    label: 'Thriller',
    blurb: 'A game designer’s store: half the survivors make it, after long, close chases.',
    score: (m) => 100 - 220 * Math.abs(m.escapeRate - 0.5) + 6 * Math.min(8, m.exposure) + 20 * m.items,
  },
};

export function aggregate(nights) {
  const S = nights.reduce((a, n) => a + n.survivors, 0) || 1;
  const esc = nights.filter((n) => n.escapeTime != null);
  const fc = nights.filter((n) => n.firstCatch != null);
  return {
    nights: nights.length,
    survivors: S,
    escapeRate: nights.reduce((a, n) => a + n.escaped, 0) / S,
    catchRate: nights.reduce((a, n) => a + n.caught, 0) / S,
    items: nights.reduce((a, n) => a + n.items, 0) / nights.length,
    escapeTime: esc.length ? esc.reduce((a, n) => a + n.escapeTime, 0) / esc.length : null,
    firstCatch: fc.length ? fc.reduce((a, n) => a + n.firstCatch, 0) / fc.length : null,
    exposure: nights.reduce((a, n) => a + n.exposure, 0) / nights.length,
    walked: nights.reduce((a, n) => a + n.walked, 0) / nights.length,
    // learning: how much better the creature does in the second half of the nights than the first
    learning: (() => {
      const h = Math.floor(nights.length / 2);
      if (h < 1) return 0;
      const rate = (ns) => ns.reduce((a, n) => a + n.caught, 0) / Math.max(1, ns.reduce((a, n) => a + n.survivors, 0));
      return rate(nights.slice(h)) - rate(nights.slice(0, h));
    })(),
  };
}

export function evaluate(genome, { nights = 6, seeds = [11, 23], cond = null, objective = 'haven' } = {}) {
  const world = buildStore(genome);
  computeLight(world, cond);
  const all = [];
  for (const seed of seeds) {
    const sim = makeSim(world, { seed, cond });
    all.push(...runNights(sim, nights));
  }
  const m = aggregate(all);
  m.fitness = OBJECTIVES[objective].score(m);
  m.sunShare = world.sunShare;
  return m;
}

// (mu + lambda) evolution. Each epoch: score every store, keep the best two unchanged, fill the rest
// with mutations of the better half, and add one new random store to keep variety.
// A generator: yields after each store is scored so the page stays responsive.
export function* evolve({ start = null, popSize = 8, epochs = 10, nights = 5, seeds = [11, 23], cond = null, objective = 'haven', seed = 1 }) {
  const rng = makeRng(seed);
  let pop = [];
  if (start) { pop.push(start); while (pop.length < popSize) pop.push(mutateGenome(start, rng.int(1, 1e9))); }
  else while (pop.length < popSize) pop.push(randomGenome(rng.int(1, 1e9)));
  const history = [];
  for (let epoch = 1; epoch <= epochs; epoch++) {
    const scored = [];
    for (const g of pop) {
      const m = g._m ?? evaluate(g, { nights, seeds, cond, objective });
      g._m = m;
      scored.push({ genome: g, m });
      yield { type: 'scored', epoch, done: scored.length, of: pop.length, genome: g, m };
    }
    scored.sort((a, b) => b.m.fitness - a.m.fitness);
    const fits = scored.map((s) => s.m.fitness);
    const rec = {
      epoch, best: fits[0], mean: fits.reduce((a, b) => a + b, 0) / fits.length, worst: fits[fits.length - 1],
      bestGenome: scored[0].genome, bestM: scored[0].m, population: scored.map((s) => ({ genome: s.genome, m: s.m })),
    };
    history.push(rec);
    yield { type: 'epoch', ...rec, history };
    if (epoch === epochs) break;
    const next = [scored[0].genome, scored[1].genome];
    const parents = scored.slice(0, Math.max(2, Math.ceil(popSize / 2))).map((s) => s.genome);
    while (next.length < popSize - 1) next.push(mutateGenome(rng.pick(parents), rng.int(1, 1e9)));
    next.push(randomGenome(rng.int(1, 1e9)));
    pop = next;
  }
  return history;
}
