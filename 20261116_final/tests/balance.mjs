// Plays many rounds on every place (with random designs) and reports how the nights end.
// Usage: node tests/balance.mjs [rounds per design] [designs per place]
import { CONFIG } from '../src/sim/config.js';
import { newSim, runRounds } from '../src/sim/sim.js';
import { buildCity } from '../src/sim/city.js';
import { randomDesign } from '../src/sim/design.js';
import { PLACES } from '../src/data/places.js';
import { loadPlace } from './load.mjs';
const per = Number(process.argv[2] || 6);
const designs = Number(process.argv[3] || 2);
const all = { escaped: 0, caught: 0, froze: 0, dawn: 0 };
for (const p of PLACES) {
  const place = loadPlace(p.id);
  const base = buildCity(place, CONFIG, {});
  const tally = { escaped: 0, caught: 0, froze: 0, dawn: 0 };
  const t = performance.now();
  for (let d = 0; d < designs; d++) {
    const sim = newSim(place, CONFIG, randomDesign(base, 100 + d), 1 + d, { premapped: true });
    runRounds(sim, per);
    for (const o of sim.outcomes) { tally[o.result]++; all[o.result]++; }
  }
  const n = Object.values(tally).reduce((a, b) => a + b, 0);
  console.log(p.id.padEnd(12), Object.entries(tally).map(([k, v]) => `${k} ${(100 * v / n).toFixed(0)}%`).join('  '), `(${n} survivors, ${Math.round(performance.now() - t)} ms)`);
}
const n = Object.values(all).reduce((a, b) => a + b, 0);
console.log('all'.padEnd(12), Object.entries(all).map(([k, v]) => `${k} ${(100 * v / n).toFixed(0)}%`).join('  '));
