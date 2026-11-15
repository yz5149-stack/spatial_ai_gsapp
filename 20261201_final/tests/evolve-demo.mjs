import { evolve } from '../src/sim/evolve.js';
import { conditionsFrom, PRESETS } from '../src/sim/light.js';
const P = PRESETS.blizzard; const cond = conditionsFrom(P.weather, new Date(P.date));
const obj = process.argv[2] || 'haven';
const t0 = Date.now();
for (const e of evolve({ popSize: 8, epochs: 8, nights: 5, cond, objective: obj, seed: 3 })) {
  if (e.type === 'epoch') console.log(obj, 'epoch', e.epoch, 'best', e.best.toFixed(1), 'mean', e.mean.toFixed(1), 'esc', e.bestM.escapeRate.toFixed(2), 'items', e.bestM.items.toFixed(2), `${Date.now()-t0}ms`);
}
