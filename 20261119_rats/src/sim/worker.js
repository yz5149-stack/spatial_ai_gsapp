// A Web Worker that evaluates designs off the main thread. It loads the place once and builds the city.

import { CONFIG } from './config.js?v=13';
import { buildCity } from './city.js?v=13';
import { evaluateDesign } from './evaluate.js?v=13';

let cityP = null;
self.onmessage = async (e) => {
  const { id, url, design, opts } = e.data;
  try {
    if (!cityP) cityP = fetch(url).then((r) => r.json()).then((place) => buildCity(place, CONFIG));
    const city = await cityP;
    const m = evaluateDesign(city, design, opts);
    self.postMessage({ id, m });
  } catch (err) {
    self.postMessage({ id, error: String(err?.stack ?? err) });
  }
};
