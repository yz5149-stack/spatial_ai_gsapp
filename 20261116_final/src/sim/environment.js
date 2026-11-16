// The environment through time: the real storm, hour by hour, and what it does to each cell.
//
//   weatherAt(world, t)   the weather t hours into the night (interpolated between hourly records)
//   shelterFor(world, deg) how much each cell is out of a wind from that direction (0..1)
//   snowDepthCm(world, i, w, design)   snow on the cell: the recorded depth, drifted by surface and wind
//   windChill(T, v)       the North American wind chill index (Environment Canada / NWS)

import { S, G } from './city.js';

const lerp = (a, b, t) => a + (b - a) * t;

export function nightIndex(weather, start) {
  const i = weather.time.indexOf(start);
  return i < 0 ? 0 : i;
}

// The weather `t` hours after the night began.
export function weatherAt(world, t) {
  const w = world.weather;
  const i0 = world.nightIndex + Math.max(0, t);
  const a = Math.min(w.time.length - 1, Math.floor(i0));
  const b = Math.min(w.time.length - 1, a + 1);
  const f = i0 - a;
  const get = (k) => lerp(w[k][a], w[k][b], f);
  // wind direction: interpolate on the circle
  const da = (w.wind_direction_10m[a] * Math.PI) / 180; const db = (w.wind_direction_10m[b] * Math.PI) / 180;
  const dir = (Math.atan2(lerp(Math.sin(da), Math.sin(db), f), lerp(Math.cos(da), Math.cos(db), f)) * 180) / Math.PI;
  return {
    time: w.time[a], hour: Math.floor(i0), t,
    temp: get('temperature_2m'), apparent: get('apparent_temperature'),
    snowfall: get('snowfall'), depthCm: get('snow_depth') * 100,
    wind: get('wind_speed_10m'), gust: get('wind_gusts_10m'), dir: (dir + 360) % 360,
  };
}

// Wind chill (degrees C) for air temperature T (C) and wind v (km/h at 10 m).
export function windChill(T, v) {
  if (v < 4.8) return T;
  const p = v ** 0.16;
  return 13.12 + 0.6215 * T - 11.37 * p + 0.3965 * T * p;
}

// Shelter from a wind blowing FROM `deg` (meteorological, clockwise from north).
// A cell is in the lee of a building of height h (metres) up to about 4 h downwind; woods and
// bushes shelter less. Returns a Float32Array, 0 = fully exposed, 1 = fully sheltered.
export function shelterFor(world, deg) {
  const key = Math.round(deg / 10) * 10;
  world.shelterCache = world.shelterCache ?? new Map();
  if (world.shelterCache.has(key)) return world.shelterCache.get(key);
  const { W, H, N, cellM, ground, height } = world;
  const rad = (key * Math.PI) / 180;
  const ux = Math.sin(rad); const uy = -Math.cos(rad);      // toward where the wind comes from
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    if (!world.walk[i]) continue;
    const x0 = (i % W) + 0.5; const y0 = Math.floor(i / W) + 0.5;
    let s = 0;
    for (let d = 1; d <= 18; d++) {
      const x = Math.floor(x0 + ux * d); const y = Math.floor(y0 + uy * d);
      if (x < 0 || y < 0 || x >= W || y >= H) break;
      const j = y * W + x;
      const g = ground[j];
      if (g === G.BLDG || g === G.ROCK) { const reach = (4 * height[j]) / cellM; if (d <= reach) s = Math.max(s, 1 - d / (reach + 1)); }
      else if (g === G.TREE) { if (d <= 4) s = Math.max(s, 0.55 * (1 - d / 5)); }
      else if (g === G.BUSH || g === G.FENCE || g === G.BARRIER) { if (d <= 2) s = Math.max(s, 0.35 * (1 - d / 3)); }
      if (s >= 0.95) break;
    }
    out[i] = s;
  }
  world.shelterCache.set(key, out);
  return out;
}

const DRIFT = { [S.YARD]: 1.15, [S.LAWN]: 1.35, [S.AVENUE]: 0.85, [S.STREET]: 0.95, [S.PATH]: 1.0, [S.STEPS]: 1.2, [S.PLAZA]: 1.0, [S.WOODS]: 0.9, [S.BRIDGE]: 1.1 };

// Snow on a cell (cm): the recorded depth, more on open lawns, less in the lee, almost none
// on plowed streets.
export function snowDepthCm(world, i, w, shelter) {
  if (world.plowed && world.plowed[i]) return Math.min(4, w.depthCm * 0.15);
  const lee = shelter ? 1 - 0.35 * shelter[i] : 1;
  return w.depthCm * (DRIFT[world.surface[i]] ?? 1) * lee;
}

// Local conditions on one cell right now.
export function cellClimate(world, i, w, cfg) {
  const shelter = shelterFor(world, w.dir);
  const v = w.wind * (1 - cfg.needs.shelterKeeps * shelter[i]);
  return {
    shelter: shelter[i], wind: v, chill: windChill(w.temp, v), depth: snowDepthCm(world, i, w, shelter),
  };
}

// The things on the map that matter for staying alive, from the data and from the design.
// warm[i]: warmth gained per tick on the cell (warming centres, shop doorways, subway air).
export function warmField(world, design, cfg) {
  const { W, H, N } = world;
  const warm = new Float32Array(N);
  const add = (cell, r, v) => {
    const x0 = cell % W; const y0 = Math.floor(cell / W);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const x = x0 + dx; const y = y0 + dy;
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      if (dx * dx + dy * dy > r * r + 0.5) continue;
      const j = y * W + x;
      if (world.walk[j]) warm[j] = Math.max(warm[j], v);
    }
  };
  for (const s of world.pois.shops) add(s.cell, 0, cfg.needs.doorway);
  for (const s of world.pois.subways) add(s.cell, 1, cfg.needs.subwayAir);
  for (const s of world.pois.shelters) add(s.cell, 1, cfg.needs.subwayAir);
  for (const c of design.warming ?? []) add(c, 1, cfg.needs.warmCentre);
  return warm;
}
