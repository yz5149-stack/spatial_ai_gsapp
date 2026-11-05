// Plays many hunt rounds on several maps and reports how often the survivor is caught.
// Usage: node tests/balance.mjs [rounds per map] [maps]
import { CONFIG } from '../src/sim/config.js';
import { newSim, runRounds } from '../src/sim/sim.js';
const per = Number(process.argv[2] || 30);
const maps = Number(process.argv[3] || 4);
const tally = { caught: 0, escaped: 0, dawn: 0 };
let ticks = 0;
for (let m = 0; m < maps; m++) {
  const sim = newSim(CONFIG, CONFIG.seed + m);
  runRounds(sim, per);
  for (const r of sim.rounds) { tally[r.result]++; ticks += r.ticks; }
}
const n = per * maps;
console.log(JSON.stringify({ rounds: n, ...tally, caughtRate: +(tally.caught / n).toFixed(3), avgSeconds: +((ticks / n) * CONFIG.tickMs / 1000).toFixed(1) }));
