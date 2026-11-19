// Judging a design: run the week on a few seeds and average the measures.
// Evolution: keep the best design of each epoch and breed variations of it.

import { newSim, runDays, measures, score } from './sim.js';
import { mutate, cloneDesign, designCost } from './design.js';

export const OBJECTIVES = {
  civic: { name: 'Fewer rats', better: 'lower', fn: (m) => score(m) },
  paradise: { name: 'Rat paradise', better: 'higher', fn: (m) => -score(m) },
};

export function evaluateDesign(city, design, { days = city.config.days, seeds = [1], keepMap = false } = {}) {
  let map = null;
  const runs = seeds.map((seed, k) => {
    const sim = newSim(city, design, { seed: city.config.seed + seed * 7919 });
    runDays(sim, days);
    if (keepMap && k === 0) map = { activity: sim.activity, burrows: sim.colonies.filter((c) => sim.rats.some((r) => r.alive && r.colony === c.id)).map((c) => c.home), daily: sim.daily };
    return measures(sim);
  });
  const avg = (f) => runs.reduce((s, m) => s + f(m), 0) / runs.length;
  const m = {
    rats: avg((r) => r.rats), ratsStart: avg((r) => r.ratsStart), eaten: avg((r) => r.eaten), sightings: avg((r) => r.sightings),
    inspections: avg((r) => r.inspections), failed: avg((r) => r.failed), burrows: avg((r) => r.burrows), births: avg((r) => r.births),
    starved: avg((r) => r.deaths.starve), baited: avg((r) => r.deaths.bait), treated: avg((r) => r.deaths.treat), foodOut: avg((r) => r.foodOut),
    realMatch: avg((r) => r.realMatch),
  };
  m.score = score(m);
  m.cost = designCost(design);
  if (map) m.map = map;
  return m;
}

// evaluate(design) may be async (Web Workers); returns the measures
export async function evolve(city, start, { epochs = 6, population = 4, objective = 'civic', seed = 1, evaluate, onEpoch = null, strength = 1 } = {}) {
  const fit = (m) => OBJECTIVES[objective].fn(m);
  let best = { design: cloneDesign(start), m: await evaluate(start) };
  const history = [{ epoch: 0, best: best.m, all: [best.m.score] }];
  onEpoch?.(history[0], best);
  for (let e = 1; e <= epochs; e++) {
    const kids = [];
    for (let k = 0; k < population; k++) kids.push(mutate(city, best.design, seed * 1000 + e * 31 + k, strength));
    const ms = await Promise.all(kids.map((d) => evaluate(d)));
    let improved = false;
    ms.forEach((m, k) => { if (fit(m) < fit(best.m)) { best = { design: kids[k], m }; improved = true; } });
    const rec = { epoch: e, best: best.m, all: ms.map((m) => m.score), improved, designs: kids.map((d, k) => ({ design: d, m: ms[k] })) };
    history.push(rec);
    onEpoch?.(rec, best);
  }
  return { best, history };
}
