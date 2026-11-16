// A Web Worker that evaluates environment designs off the page's main thread.
// Message in:  { job, placeId, design, rounds, seed }
// Message out: { job, result } or { job, error }

import { CONFIG } from './config.js';
import { evaluateDesign } from './evaluate.js';
import { loadPlace } from '../data/load.js';

self.onmessage = async (e) => {
  const { job, placeId, design, rounds, seed, config } = e.data;
  try {
    const place = await loadPlace(placeId);
    const result = evaluateDesign(place, config ?? CONFIG, design, { rounds, seed });
    self.postMessage({ job, result });
  } catch (err) {
    self.postMessage({ job, error: String(err && err.stack || err) });
  }
};
