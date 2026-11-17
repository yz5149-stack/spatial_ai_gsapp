// Downloads the data for "Eyes on the Street" (Morningside Heights) and writes data/morningside-eyes.json:
//   - MTA Subway Hourly Ridership (data.ny.gov 5wq4-mkjj): entries per hour at 116 St-Columbia
//     University (1), October 2025, averaged per day type
//   - MTA Subway Origin-Destination Ridership Estimate 2025 (data.ny.gov y2qv-fytt): estimated people
//     arriving (exiting) at the station per hour, October 2025, per day of the week
//   - NYC 311 Service Requests (data.cityofnewyork.us erm2-nwe9): "Street Light Condition" reports inside
//     the map, last 12 months, with their positions
// The streets, buildings and terrain come from ../20261116_final/data/morningside.json.
// Usage: NODE_USE_ENV_PROXY=1 node tools/fetch_eyes.mjs

import { writeFile, mkdir } from 'node:fs/promises';

const STATION = { id: '307', name: '116 St-Columbia University (1)' };
const MONTH = { start: '2025-10-01T00:00:00', end: '2025-11-01T00:00:00', year: 2025, month: 10 };
const BBOX = { west: -73.9655, east: -73.9579, south: 40.80385, north: 40.80815 };
const SINCE = '2025-11-17T00:00:00';
const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const TYPES = { weekday: ['Monday', 'Tuesday', 'Wednesday', 'Thursday'], friday: ['Friday'], saturday: ['Saturday'], sunday: ['Sunday'] };

async function soql(base, params) {
  const url = `${base}?${new URLSearchParams(params)}`;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
      return await r.json();
    } catch (err) {
      if (attempt === 4) throw new Error(`${url}: ${err.message}`);
      await new Promise((res) => setTimeout(res, 2000 * attempt));
    }
  }
  return null;
}

// how many of each weekday the month has
function daysPerDow(year, month) {
  const n = Object.fromEntries(DOW.map((d) => [d, 0]));
  for (let d = new Date(Date.UTC(year, month - 1, 1)); d.getUTCMonth() === month - 1; d.setUTCDate(d.getUTCDate() + 1)) n[DOW[d.getUTCDay()]]++;
  return n;
}

async function entries() {
  const rows = await soql('https://data.ny.gov/resource/5wq4-mkjj.json', {
    $select: 'date_extract_hh(transit_timestamp) as h, date_extract_dow(transit_timestamp) as dow, sum(ridership) as r',
    $where: `station_complex_id='${STATION.id}' AND transit_timestamp >= '${MONTH.start}' AND transit_timestamp < '${MONTH.end}'`,
    $group: 'h, dow', $limit: '1000',
  });
  const days = daysPerDow(MONTH.year, MONTH.month);
  const perDow = Object.fromEntries(DOW.map((d) => [d, new Array(24).fill(0)]));
  for (const r of rows) perDow[DOW[+r.dow]][+r.h] += +r.r / days[DOW[+r.dow]];
  return perDow;
}

async function exits() {
  const rows = await soql('https://data.ny.gov/resource/y2qv-fytt.json', {
    $select: 'hour_of_day, day_of_week, sum(estimated_average_ridership) as r',
    $where: `destination_station_complex_id='${STATION.id}' AND month=${MONTH.month}`,
    $group: 'hour_of_day, day_of_week', $limit: '1000',
  });
  const perDow = Object.fromEntries(DOW.map((d) => [d, new Array(24).fill(0)]));
  for (const r of rows) perDow[r.day_of_week][+r.hour_of_day] += +r.r;
  return perDow;
}

const byType = (perDow) => Object.fromEntries(Object.entries(TYPES).map(([t, ds]) => [t,
  Array.from({ length: 24 }, (_, h) => Math.round((ds.reduce((s, d) => s + perDow[d][h], 0) / ds.length) * 10) / 10)]));

async function lights311() {
  const rows = await soql('https://data.cityofnewyork.us/resource/erm2-nwe9.json', {
    $select: 'unique_key, created_date, closed_date, status, descriptor, incident_address, latitude, longitude',
    $where: `complaint_type='Street Light Condition' AND created_date >= '${SINCE}' AND within_box(location, ${BBOX.north}, ${BBOX.west}, ${BBOX.south}, ${BBOX.east})`,
    $order: 'created_date', $limit: '2000',
  });
  return rows.filter((r) => r.latitude && r.longitude).map((r) => ({
    id: r.unique_key, created: r.created_date?.slice(0, 10), closed: r.closed_date?.slice(0, 10) ?? null, status: r.status,
    descriptor: r.descriptor, address: r.incident_address ?? '', lat: +r.latitude, lon: +r.longitude,
  }));
}

const [en, ex, reports] = await Promise.all([entries(), exits(), lights311()]);
const out = {
  place: 'morningside', station: STATION, month: '2025-10', fetched: new Date().toISOString().slice(0, 10),
  sources: {
    entries: 'MTA Subway Hourly Ridership: Beginning 2025 (data.ny.gov, 5wq4-mkjj), entries at the station, October 2025, mean per day',
    exits: 'MTA Subway Origin-Destination Ridership Estimate: 2025 (data.ny.gov, y2qv-fytt), estimated arrivals at the station, October 2025',
    lights311: `NYC 311 Service Requests from 2020 to Present (erm2-nwe9), complaint type "Street Light Condition", since ${SINCE.slice(0, 10)}`,
  },
  entries: byType(en), exits: byType(ex), lights311: reports,
};
await mkdir(new URL('../data/', import.meta.url), { recursive: true });
await writeFile(new URL('../data/morningside-eyes.json', import.meta.url), JSON.stringify(out, null, 1));
const tot = (a) => Math.round(a.reduce((s, v) => s + v, 0));
console.log(`entries/day weekday ${tot(out.entries.weekday)}, exits/day weekday ${tot(out.exits.weekday)}, 311 light reports ${reports.length}`);
console.log('weekday entries by hour', out.entries.weekday.map(Math.round).join(' '));
console.log('weekday exits by hour  ', out.exits.weekday.map(Math.round).join(' '));
