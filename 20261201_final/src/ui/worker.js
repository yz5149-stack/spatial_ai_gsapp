// Runs the designer's experiments off the main thread: scoring stores and evolving them.
import { evolve, evaluate } from '../sim/evolve.js';
import { conditionsFrom } from '../sim/light.js';

let stopRequested = false;
const pause = () => new Promise((r) => setTimeout(r, 0));
const strip = (g) => { const { _m, ...rest } = g; return rest; };

self.onmessage = async (e) => {
  const msg = e.data;
  if (msg.cmd === 'stop') { stopRequested = true; return; }
  const cond = msg.cond ? conditionsFrom(msg.cond.weather, new Date(msg.cond.date)) : null;
  if (msg.cmd === 'evaluate') {
    for (const g of msg.genomes) {
      const m = evaluate(g, { nights: msg.nights, seeds: msg.seeds, cond, objective: msg.objective });
      self.postMessage({ type: 'evaluated', job: msg.job, id: g.id, m });
      await pause();
    }
    self.postMessage({ type: 'evaluateDone', job: msg.job });
  }
  if (msg.cmd === 'evolve') {
    stopRequested = false;
    const it = evolve({ ...msg.params, cond });
    for (const ev of it) {
      if (ev.type === 'scored') self.postMessage({ type: 'scored', job: msg.job, epoch: ev.epoch, done: ev.done, of: ev.of, id: ev.genome.id, fitness: ev.m.fitness });
      else self.postMessage({
        type: 'epoch', job: msg.job, epoch: ev.epoch, best: ev.best, mean: ev.mean, worst: ev.worst,
        bestGenome: strip(ev.bestGenome), bestM: ev.bestM,
        population: ev.population.map((p) => ({ genome: strip(p.genome), m: p.m })),
      });
      await pause();
      if (stopRequested) break;
    }
    self.postMessage({ type: 'evolveDone', job: msg.job, stopped: stopRequested });
  }
};
