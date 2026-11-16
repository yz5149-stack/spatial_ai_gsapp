// Evaluating an environment design: play it for a number of nights and measure how the agents did.
// Every design of a comparison is played with the same seeds (the same survivors waking in the
// same places, as far as the design allows), so differences come from the design.

import { newSim, runRounds } from './sim.js';
import { buildCity } from './city.js';
import { mutate } from './design.js';

// Performance of each kind of agent, and one score for the designer's objective.
//   survivors: reach the refuge (100), last till dawn (60), freeze or be caught (0), plus a little
//              for the warmth they keep; minus a little for a long time out in the storm
//   creature:  share of survivors caught
export function scoreOutcomes(outcomes, config) {
  const n = outcomes.length || 1;
  const c = { escaped: 0, caught: 0, froze: 0, dawn: 0 };
  let warmth = 0; let hours = 0; let metres = 0; let caches = 0;
  for (const o of outcomes) {
    c[o.result]++;
    warmth += o.result === 'escaped' || o.result === 'dawn' ? o.warmth : 0;
    hours += o.hours; metres += o.metres; caches += o.caches.length;
  }
  const survivorScore = (100 * c.escaped + 60 * c.dawn) / n + 0.15 * (warmth / n)
    - 8 * (outcomes.filter((o) => o.result === 'escaped').reduce((s, o) => s + o.hours, 0) / n) / config.night.hours;
  return {
    survivors: n, ...c,
    escapeRate: c.escaped / n, catchRate: c.caught / n, freezeRate: c.froze / n, dawnRate: c.dawn / n,
    survivalRate: (c.escaped + c.dawn) / n,
    meanWarmth: warmth / n, meanHours: hours / n, meanMetres: metres / n, cachesPerSurvivor: caches / n,
    survivorScore: Math.round(survivorScore * 10) / 10,
    creatureScore: Math.round((100 * c.caught) / n * 10) / 10,
  };
}

export const objectiveScore = (m, objective) => (objective === 'creature' ? m.creatureScore : m.survivorScore);

// Plays `rounds` nights of a design. Returns the measures and the traces needed to draw it:
// every survivor's path, where each night ended, a heatmap of where survivors walked.
export function evaluateDesign(place, config, design, { rounds = 6, seed = 1, premapped = true } = {}) {
  const t0 = Date.now();
  const sim = newSim(place, config, design, seed, { premapped });
  runRounds(sim, rounds);
  const m = scoreOutcomes(sim.outcomes, config);
  const heat = new Uint16Array(sim.world.N);
  for (const o of sim.outcomes) for (const n of o.trail) heat[n]++;
  return {
    design, metrics: m, ms: Date.now() - t0,
    traces: sim.outcomes.map((o) => ({ result: o.result, start: o.start, end: o.end, trail: thin(o.trail, 2) })),
    heat: Array.from(heat), heard: Array.from(sim.heardHeat),
    creature: { lair: sim.world.lair, landmarks: sim.creature.k.landmarks.length },
  };
}

const thin = (trail, k) => trail.filter((_, i) => i % k === 0 || i === trail.length - 1);

// The automated designer: start from a design, and for each epoch make `population` variations of
// the best design so far, evaluate them all, and keep the best. `onEpoch` is called after each one.
export function evolve(place, config, start, { epochs = 6, population = 4, rounds = 4, seed = 1, objective = 'survivors', strength = 1, onEpoch = null } = {}) {
  const world = buildCity(place, config, {});
  let best = evaluateDesign(place, config, start, { rounds, seed });
  best.score = objectiveScore(best.metrics, objective);
  const history = [{ epoch: 0, best: best.score, mean: best.score, scores: [best.score], designs: [best] }];
  onEpoch?.(history[0], best);
  for (let e = 1; e <= epochs; e++) {
    const evaluated = [];
    for (let p = 0; p < population; p++) {
      const d = mutate(world, best.design, seed * 1000 + e * 37 + p * 101, strength);
      const r = evaluateDesign(place, config, d, { rounds, seed });
      r.score = objectiveScore(r.metrics, objective);
      evaluated.push(r);
    }
    const top = evaluated.reduce((a, b) => (b.score > a.score ? b : a));
    if (top.score >= best.score) best = top;
    const scores = evaluated.map((r) => r.score);
    const h = { epoch: e, best: best.score, mean: scores.reduce((a, b) => a + b, 0) / scores.length, scores, designs: evaluated };
    history.push(h);
    onEpoch?.(h, best);
  }
  return { best, history };
}
