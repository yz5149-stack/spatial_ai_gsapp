// The real place in three dimensions and time: the sun's position over Morningside Heights at a given
// moment, the light it sends through the storefront glass onto the floor (a 3D ray from each floor
// cell to the sun, through the glazing between sill and head height, past the shelves), and the
// weather of that hour, which sets how many people come in and how far sound carries.

import { CONFIG } from './config.js';
import { castRay } from './los.js';
import { Z, T } from './store.js';

const RAD = Math.PI / 180;

// Solar position (low-precision NOAA / Astronomical Almanac formulas, accurate to about 1 degree).
// Returns degrees: elevation above the horizon, azimuth clockwise from north.
export function sunPosition(date, lat, lon) {
  const d = date.getTime() / 86400000 + 2440587.5 - 2451545.0;
  const g = (357.529 + 0.98560028 * d) * RAD;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * RAD;
  const e = (23.439 - 0.00000036 * d) * RAD;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = ((18.697374558 + 24.06570982441908 * d) % 24 + 24) % 24;
  const ha = (gmst * 15 + lon) * RAD - ra;
  const phi = lat * RAD;
  const el = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(ha));
  const az = Math.atan2(-Math.sin(ha), Math.cos(phi) * Math.tan(dec) - Math.sin(phi) * Math.cos(ha));
  return { elevation: el / RAD, azimuth: ((az / RAD) % 360 + 360) % 360 };
}

// What one hour of weather does to a night in the store
export function conditionsFrom(weather, date, place = CONFIG.place) {
  const sun = sunPosition(date, place.lat, place.lon);
  const snow = Math.max(0, weather.snowfall ?? 0);
  const wind = Math.max(0, weather.wind ?? 0);
  const temp = weather.temperature ?? 0;
  const cloud = Math.max(0, Math.min(100, weather.cloud ?? 50));
  const c = {
    date, weather, sun, cloud,
    isDay: sun.elevation > -0.83,
    survivorsPerNight: Math.max(2, Math.min(5, 2 + Math.round(snow * 1.2))),
    hearingScale: Math.max(0.6, Math.min(1, 1 - wind / 110)),
    cold: temp <= -2,
    effects: [],
  };
  c.effects.push(`${snow.toFixed(1)} cm/h of snow → ${c.survivorsPerNight} survivors come in each night`);
  c.effects.push(`Wind ${wind.toFixed(0)} km/h → the creature hears ${Math.round(c.hearingScale * 100)}% as far`);
  c.effects.push(c.cold ? `${temp.toFixed(1)} °C → every list includes hand warmers` : `${temp.toFixed(1)} °C → hand warmers are optional`);
  c.effects.push(c.isDay
    ? `Sun ${sun.elevation.toFixed(0)}° high at ${sun.azimuth.toFixed(0)}°, cloud ${cloud.toFixed(0)}% → daylight through the glass`
    : `Sun below the horizon (${sun.elevation.toFixed(0)}°) → only ceiling lights and the street lamp`);
  return c;
}

// Light level per cell (0 dark, 1 bright) and which floor cells get direct sun.
export function computeLight(world, cond) {
  const { W, H, N, type, zone, cfg } = world;
  const light = world.light; const sunlit = world.sunlit;
  sunlit.fill(0);
  const sill = cfg.window.sill / 0.5; const head = cfg.window.head / 0.5;
  const el = cond ? cond.sun.elevation : -20; const az = cond ? cond.sun.azimuth : 0;
  const cloud = cond ? cond.cloud / 100 : 0.5;
  const ux = Math.cos(el * RAD) * Math.sin(az * RAD);
  const uy = -Math.cos(el * RAD) * Math.cos(az * RAD);
  const uz = Math.sin(el * RAD);
  const direct = el > 1.5 ? 0.85 * Math.pow(1 - cloud, 1.3) * Math.min(1, el / 12) : 0;
  const diffuse = el > -3 ? Math.min(1, (el + 3) / 18) * (0.18 + 0.2 * cloud) : 0;
  const face = H - 1; // the inner face of the storefront row
  let litCount = 0; let floorCount = 0;
  for (let i = 0; i < N; i++) {
    const x = i % W; const y = Math.floor(i / W);
    const base = zone[i] === Z.DARK ? cfg.zones.dark.light : 0.72;
    const fromGlass = Math.max(0, face - (y + 0.5));
    let L = base + diffuse * Math.exp(-fromGlass / 7);
    if (!cond || !cond.isDay) L += 0.12 * Math.exp(-fromGlass / 3); // the street lamp outside
    if (world.walk[i] && type[i] === T.FLOOR) {
      floorCount++;
      if (direct > 0 && uy > 0.02) {
        const ox = x + 0.5; const oy = y + 0.5; const oz = 0.05;
        const t = (face - oy) / uy;
        const zf = oz + t * uz; const xf = ox + t * ux;
        const fx = Math.floor(xf);
        if (zf > sill && zf < head && fx >= 0 && fx < W) {
          const ft = type[(H - 1) * W + fx];
          if ((ft === T.GLASS || ft === T.DOOR) && castRay(world, ox, oy, oz, ux, uy, uz, t - 1e-3) >= t - 2e-3) {
            sunlit[i] = 1; L += direct; litCount++;
          }
        }
      }
    }
    light[i] = Math.min(1.6, L);
  }
  world.sunShare = floorCount ? litCount / floorCount : 0;
  return world;
}

// Built-in hours of weather, used until (or if) the live archive answers. The live values come from
// Open-Meteo (open-meteo.com), fetched in the browser.
export const PRESETS = {
  blizzard: {
    label: 'Blizzard of 23 Jan 2016, 9 pm',
    date: '2016-01-23T21:00:00-05:00',
    weather: { temperature: -4.5, snowfall: 4.5, wind: 45, cloud: 100 },
    archive: { date: '2016-01-23', hour: 21 },
    note: 'Built-in values approximate the published storm summary (record 27.5 in at Central Park). The live archive replaces them when it loads.',
  },
  winterNoon: {
    label: 'Clear winter noon, 21 Dec 2025',
    date: '2025-12-21T12:00:00-05:00',
    weather: { temperature: -1, snowfall: 0, wind: 12, cloud: 10 },
    archive: { date: '2025-12-21', hour: 12 },
    note: 'Built-in placeholder values until the live archive loads. Low winter sun from the south: long sunlit stripes between the gondolas.',
  },
  winterDusk: {
    label: 'Snowy dusk, 15 Jan 2026, 4 pm',
    date: '2026-01-15T16:00:00-05:00',
    weather: { temperature: -3, snowfall: 1.5, wind: 20, cloud: 70 },
    archive: { date: '2026-01-15', hour: 16 },
    note: 'Built-in placeholder values until the live archive loads. The sun is setting in the south-west: a raking light under the cloud.',
  },
};
