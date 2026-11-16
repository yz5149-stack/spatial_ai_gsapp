// Loads a place in the browser (page or worker): data/<id>.json merged with its entry in places.js.

import { PLACES } from './places.js';

const cache = new Map();
export function loadPlace(id) {
  if (!cache.has(id)) {
    const meta = PLACES.find((p) => p.id === id);
    const url = new URL(`../../data/${id}.json`, import.meta.url);
    cache.set(id, fetch(url).then((r) => { if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.json(); }).then((data) => ({ ...data, ...meta })));
  }
  return cache.get(id);
}

// Live weather now, for the place (Open-Meteo forecast API, no key): the real-time option.
export async function liveWeather(place) {
  const vars = 'temperature_2m,apparent_temperature,snowfall,snow_depth,wind_speed_10m,wind_direction_10m,wind_gusts_10m,cloud_cover';
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${place.center[1]}&longitude=${place.center[0]}&hourly=${vars}&past_days=1&forecast_days=2&timezone=America%2FNew_York`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Open-Meteo: ${r.status}`);
  const w = await r.json();
  return { source: 'Open-Meteo forecast API (live)', units: w.hourly_units, ...w.hourly };
}
