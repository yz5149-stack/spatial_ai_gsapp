// Downloads the real-world data for each place and writes data/<id>.json.
//   - OpenStreetMap (api.openstreetmap.org, API 0.6): streets, paths, parks, woods, water, trees,
//     fences, street lamps, shops, subway entrances, hospitals
//   - NYC Open Data, Building Footprints (5zhs-2jue): footprint, roof height and ground elevation
//     of every building, in feet (photogrammetric survey)
//   - Open-Meteo: hourly weather during the January 2016 blizzard (ERA5 archive) and ground
//     elevation samples (Copernicus 90 m DEM) for the parts with no buildings
// Usage: node tools/fetch_data.mjs [placeId]

import { writeFile, mkdir } from 'node:fs/promises';
import { PLACES, STORM } from '../src/data/places.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, kind = 'json') {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return kind === 'json' ? await res.json() : await res.text();
    } catch (err) {
      if (attempt === 4) throw new Error(`${url}: ${err.message}`);
      await sleep(1500 * attempt);
    }
  }
  return null;
}

const r6 = (v) => Math.round(v * 1e6) / 1e6;

// ---- OpenStreetMap: a small XML parser for the API 0.6 map call ----------------------------
function parseOsm(xml) {
  const nodes = new Map();
  const ways = [];
  const attrs = (s) => Object.fromEntries([...s.matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
  const tags = (body) => Object.fromEntries([...body.matchAll(/<tag k="([^"]*)" v="([^"]*)"\s*\/>/g)].map((m) => [m[1], m[2].replace(/&amp;/g, '&').replace(/&apos;/g, "'").replace(/&quot;/g, '"')]));
  for (const m of xml.matchAll(/<node ([^>]*?)(\/>|>([\s\S]*?)<\/node>)/g)) {
    const a = attrs(m[1]);
    nodes.set(a.id, { lat: +a.lat, lon: +a.lon, tags: m[3] ? tags(m[3]) : {} });
  }
  for (const m of xml.matchAll(/<way ([^>]*?)>([\s\S]*?)<\/way>/g)) {
    const refs = [...m[2].matchAll(/<nd ref="(\d+)"\s*\/>/g)].map((x) => x[1]);
    ways.push({ id: attrs(m[1]).id, refs, tags: tags(m[2]) });
  }
  const relations = [];
  for (const m of xml.matchAll(/<relation ([^>]*?)>([\s\S]*?)<\/relation>/g)) {
    const members = [...m[2].matchAll(/<member type="(\w+)" ref="(\d+)" role="([^"]*)"\s*\/>/g)].map((x) => ({ type: x[1], ref: x[2], role: x[3] }));
    relations.push({ members, tags: tags(m[2]) });
  }
  return { nodes, ways, relations };
}

// What each OSM feature becomes in the simulation
function classify(t) {
  const hw = t.highway;
  if (hw) {
    if (['motorway', 'trunk', 'primary', 'secondary'].includes(hw)) return 'avenue';
    if (['tertiary', 'residential', 'unclassified', 'living_street'].includes(hw)) return 'street';
    if (hw === 'service') return 'service';
    if (hw === 'steps') return 'steps';
    if (['footway', 'path', 'pedestrian', 'cycleway', 'bridleway', 'track'].includes(hw)) return t.area === 'yes' ? 'plaza' : 'path';
  }
  if (t.natural === 'water' || t.water || t.waterway === 'riverbank' || t.leisure === 'swimming_pool') return 'water';
  if (t.natural === 'wood' || t.landuse === 'forest') return 'wood';
  if (t.natural === 'scrub') return 'scrub';
  if (t.natural === 'cliff' || t.natural === 'rock' || t.natural === 'bare_rock') return 'rock';
  if (t.barrier && ['fence', 'wall', 'retaining_wall', 'hedge', 'guard_rail'].includes(t.barrier)) return t.barrier === 'hedge' ? 'hedge' : 'fence';
  if (t.leisure === 'park' || t.leisure === 'garden' || t.landuse === 'grass' || t.leisure === 'pitch' || t.landuse === 'recreation_ground' || t.natural === 'grassland') return 'park';
  if (t.place === 'square' || t.highway === 'pedestrian' || t.amenity === 'parking') return 'plaza';
  return null;
}

function pointKind(t) {
  if (t.natural === 'tree') return 'tree';
  if (t.highway === 'street_lamp') return 'lamp';
  if (t.railway === 'subway_entrance' || (t.railway === 'train_station_entrance')) return 'subway';
  if (t.amenity === 'hospital' || t.healthcare === 'hospital') return 'hospital';
  if (t.amenity === 'shelter') return 'shelter';
  if (t.shop || ['cafe', 'restaurant', 'fast_food', 'pharmacy', 'bar', 'pub'].includes(t.amenity)) return 'shop';
  if (t.amenity === 'bench') return 'bench';
  return null;
}

async function fetchOsm(b) {
  const xml = await get(`https://api.openstreetmap.org/api/0.6/map?bbox=${b.west},${b.south},${b.east},${b.north}`, 'text');
  const osm = parseOsm(xml);
  const lines = [];
  const points = [];
  const used = new Set();
  const pts = (refs) => refs.map((r) => osm.nodes.get(r)).filter(Boolean).map((n) => [r6(n.lon), r6(n.lat)]);
  for (const w of osm.ways) {
    const kind = classify(w.tags);
    const t = w.tags;
    if (t.building || t['building:part']) {
      // kept only as a fallback; NYC footprints are the primary source
      lines.push({ kind: 'osmbuilding', closed: true, pts: pts(w.refs), levels: +(t['building:levels'] || 0), height: parseFloat(t.height || '0') || 0, name: t.name || '' });
      if (t.amenity === 'hospital' || t.healthcare === 'hospital') points.push({ kind: 'hospital', name: t.name || 'Hospital', ...centroid(pts(w.refs)) });
      continue;
    }
    if (!kind) {
      if (t.amenity === 'hospital') points.push({ kind: 'hospital', name: t.name || 'Hospital', ...centroid(pts(w.refs)) });
      continue;
    }
    if (t.layer && +t.layer < 0) continue;              // tunnels
    if (t.tunnel === 'yes' || t.indoor === 'yes') continue;
    const closed = w.refs[0] === w.refs[w.refs.length - 1] && !['avenue', 'street', 'service', 'path', 'steps', 'fence', 'hedge'].includes(kind);
    lines.push({ kind, closed, pts: pts(w.refs), name: t.name || '', bridge: t.bridge === 'yes' });
    used.add(w.id);
  }
  // multipolygon relations (parks, woods, water): outer rings only
  const wayById = new Map(osm.ways.map((w) => [w.id, w]));
  for (const r of osm.relations) {
    if (r.tags.type !== 'multipolygon') continue;
    const kind = classify(r.tags);
    if (!kind || !['park', 'wood', 'water', 'scrub', 'plaza'].includes(kind)) continue;
    for (const m of r.members) {
      if (m.type !== 'way' || m.role !== 'outer') continue;
      const w = wayById.get(m.ref);
      if (w) lines.push({ kind, closed: true, pts: pts(w.refs), name: r.tags.name || '' });
    }
  }
  for (const [, n] of osm.nodes) {
    const kind = pointKind(n.tags);
    if (kind) points.push({ kind, lon: r6(n.lon), lat: r6(n.lat), name: n.tags.name || n.tags.brand || '' });
  }
  return { lines, points };
}

function centroid(p) {
  const n = p.length || 1;
  return { lon: r6(p.reduce((s, q) => s + q[0], 0) / n), lat: r6(p.reduce((s, q) => s + q[1], 0) / n) };
}

// ---- NYC building footprints: roof height and ground elevation (feet) -----------------------
async function fetchFootprints(b) {
  const where = `within_box(the_geom, ${b.north}, ${b.west}, ${b.south}, ${b.east})`;
  const url = `https://data.cityofnewyork.us/resource/5zhs-2jue.json?$limit=5000&$select=the_geom,height_roof,ground_elevation,construction_year,bin&$where=${encodeURIComponent(where)}`;
  const rows = await get(url);
  const FT = 0.3048;
  return rows.filter((r) => r.the_geom).flatMap((r) => r.the_geom.coordinates.map((poly) => ({
    h: Math.round((parseFloat(r.height_roof) || 10) * FT * 10) / 10,
    ground: Math.round((parseFloat(r.ground_elevation) || 0) * FT * 10) / 10,
    year: +r.construction_year || null,
    pts: poly[0].map(([x, y]) => [r6(x), r6(y)]),
  })));
}

// ---- Open-Meteo: the storm, hour by hour, and ground elevation -------------------------------
async function fetchWeather(p) {
  const vars = 'temperature_2m,apparent_temperature,snowfall,snow_depth,wind_speed_10m,wind_direction_10m,wind_gusts_10m,cloud_cover';
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${p.center[1]}&longitude=${p.center[0]}&start_date=${STORM.start}&end_date=${STORM.end}&hourly=${vars}&timezone=America%2FNew_York`;
  const w = await get(url);
  return { source: 'Open-Meteo historical weather API (ERA5 reanalysis)', units: w.hourly_units, gridLat: w.latitude, gridLon: w.longitude, ...w.hourly };
}

async function fetchElevation(b, nx = 12, ny = 9) {
  const lats = []; const lons = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    lats.push(r6(b.north - ((b.north - b.south) * j) / (ny - 1)));
    lons.push(r6(b.west + ((b.east - b.west) * i) / (nx - 1)));
  }
  const out = [];
  for (let k = 0; k < lats.length; k += 100) {
    const e = await get(`https://api.open-meteo.com/v1/elevation?latitude=${lats.slice(k, k + 100).join(',')}&longitude=${lons.slice(k, k + 100).join(',')}`);
    out.push(...e.elevation);
  }
  return { source: 'Open-Meteo elevation API (Copernicus DEM GLO-90)', nx, ny, values: out };
}

async function main() {
  const only = process.argv[2];
  await mkdir(new URL('../data/', import.meta.url), { recursive: true });
  for (const p of PLACES) {
    if (only && p.id !== only) continue;
    const b = p.bbox;
    process.stdout.write(`${p.id}: osm`);
    const osm = await fetchOsm(b);
    process.stdout.write(` (${osm.lines.length} ways, ${osm.points.length} points), footprints`);
    const buildings = await fetchFootprints(b);
    process.stdout.write(` (${buildings.length}), weather`);
    const weather = await fetchWeather(p);
    process.stdout.write(', elevation');
    const elevation = await fetchElevation(b);
    const out = {
      id: p.id, name: p.name, bbox: b, fetched: new Date().toISOString().slice(0, 10),
      sources: {
        osm: '© OpenStreetMap contributors, ODbL (api.openstreetmap.org)',
        buildings: 'NYC Open Data, Building Footprints (5zhs-2jue): height_roof and ground_elevation, converted from feet to metres',
        weather: weather.source,
        elevation: elevation.source,
      },
      buildings, lines: osm.lines, points: osm.points, weather, elevation,
    };
    const file = new URL(`../data/${p.id}.json`, import.meta.url);
    await writeFile(file, JSON.stringify(out));
    console.log(` -> data/${p.id}.json`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
