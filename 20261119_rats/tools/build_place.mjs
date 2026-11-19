// Builds data/manhattanville.json, the one file the page loads, from the raw downloads in data/raw/.
//
//   data/raw/osm.json        OpenStreetMap (Overpass API): streets, paths, parks, buildings, trees,
//                            lamps, subway entrances, restaurants and shops, litter baskets
//   data/raw/nyc.json        NYC Open Data, fetched 2026-11-18:
//                              Building Footprints (5zhs-2jue): roof height, ground elevation
//                              311 Service Requests (erm2-nwe9): complaint type "Rodent", since 2023-11-18
//                              DOHMH Rodent Inspection (p937-wjvj): since 2023-11-18, by location
//                              DOHMH Restaurant Inspection Results (43nn-pn8j): violations 04K (rats), 04L, 04N
//                              DSNY Litter Basket Inventory (8znf-7b2c)
//                              DOB NOW: Build – Approved Permits (rbx6-tga4): work type "Sidewalk Shed",
//                              active on 2026-11-18 and on 2023-07-01
//   data/raw/elevation.json  NYC Planimetric Database: Elevation Points (9uxf-ng6q)
//   ../20261117_eyes/data/morningside-eyes.json  MTA hourly ridership at 116 St–Columbia University
//
// The raw files were fetched in a browser (the NYC Open Data and Overpass APIs allow it) because the
// build machine had no access to those hosts; the queries are listed in README.md.
// Usage: node tools/build_place.mjs

import { readFile, writeFile } from 'node:fs/promises';

const here = (p) => new URL(p, import.meta.url);
const read = async (p) => JSON.parse(await readFile(here(p), 'utf8'));
const r5 = (v) => Math.round(v * 1e5) / 1e5;

// the raw downloads cover W -73.9670, E -73.9500, S 40.8030, N 40.8200; the simulation focuses on
// Manhattanville and 125th Street: Broadway to St Nicholas Park, about W 120th to W 133rd St
export const BBOX = { west: -73.9620, east: -73.9500, south: 40.8085, north: 40.8195 };
const M = 0.0012;   // keep what touches a margin around the box
const near = (lon, lat) => lon > BBOX.west - M && lon < BBOX.east + M && lat > BBOX.south - M && lat < BBOX.north + M;
const touches = (pts) => pts.some(([x, y]) => near(x, y));

function inside(poly, x, y) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]; const [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
const centroid = (pts) => [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
const area = (pts) => {
  // square metres, from degrees
  const lat0 = (BBOX.north + BBOX.south) / 2;
  const mx = 111412.84 * Math.cos((lat0 * Math.PI) / 180); const my = 111132.92;
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j][0] * mx) * (pts[i][1] * my) - (pts[i][0] * mx) * (pts[j][1] * my);
  return Math.abs(a / 2);
};

const USE = {
  apartments: 'residential', residential: 'residential', house: 'residential', dormitory: 'campus',
  university: 'campus', college: 'campus', school: 'school', church: 'other', cathedral: 'other', hospital: 'other',
  office: 'commercial', retail: 'commercial', commercial: 'commercial', supermarket: 'commercial',
  fire_station: 'other', parking: 'other', garage: 'other', roof: 'other', guardhouse: 'other', public: 'other',
};

async function main() {
  const osm = await read('../data/raw/osm.json');
  const nyc = await read('../data/raw/nyc.json');
  const elev = await read('../data/raw/elevation.json');
  const eyes = await read('../../20261117_eyes/data/morningside-eyes.json');

  const osmBuildings = osm.lines.filter((l) => l.kind === 'osmbuilding');
  const zones = osm.lines.filter((l) => l.kind === 'zone');

  // NYC footprints, with their use from the OSM building or the zone (campus, school, housing) they stand in
  const buildings = nyc.buildings.filter((b) => touches(b.pts)).map((b) => {
    const [cx, cy] = centroid(b.pts);
    const ob = osmBuildings.find((o) => o.pts.length > 2 && inside(o.pts, cx, cy));
    const zone = zones.find((z) => z.pts.length > 2 && inside(z.pts, cx, cy));
    let use = ob ? USE[ob.btype] : undefined;
    if (!use && zone) use = zone.zone === 'university' ? 'campus' : zone.zone === 'school' ? 'school' : zone.zone === 'commercial' ? 'commercial' : 'residential';
    if (!use) use = 'residential';
    const m2 = area(b.pts);
    return {
      h: b.h, ground: b.ground, year: b.year, bin: b.bin, use,
      name: ob?.name || (zone?.zone === 'residential' ? zone.name : '') || '',
      floors: Math.max(1, Math.round(b.h / 3.2)), m2: Math.round(m2),
      pts: b.pts.map(([x, y]) => [r5(x), r5(y)]),
    };
  });

  const lines = osm.lines.filter((l) => l.kind !== 'zone' && touches(l.pts)).map((l) => ({ ...l, pts: l.pts.map(([x, y]) => [r5(x), r5(y)]) }));
  for (const l of lines) { if (l.kind !== 'osmbuilding') { delete l.btype; delete l.amenity; } if (!l.bridge) delete l.bridge; if (!l.sidewalk) delete l.sidewalk; if (!l.name) delete l.name; }
  const points = osm.points.filter((p) => near(p.lon, p.lat)).map((p) => ({ ...p, lon: r5(p.lon), lat: r5(p.lat) }));

  // weekday and Saturday people at the station, entries + exits, per hour
  const people = (k) => eyes.entries[k].map((v, h) => Math.round(v + eyes.exits[k][h]));

  const out = {
    id: 'manhattanville',
    name: 'Manhattanville and 125th Street',
    bbox: BBOX,
    fetched: '2026-11-18',
    sources: {
      osm: '© OpenStreetMap contributors, ODbL (Overpass API)',
      buildings: 'NYC Open Data, Building Footprints (5zhs-2jue): roof height and ground elevation, feet to metres',
      elevation: elev.source,
      r311: 'NYC 311 Service Requests from 2020 to Present (erm2-nwe9), complaint type Rodent, 2023-11-18 to 2026-11-18',
      inspections: 'DOHMH Rodent Inspection (p937-wjvj), 2023-11-18 to 2026-11-18, summed by location',
      restaurants: 'DOHMH New York City Restaurant Inspection Results (43nn-pn8j): 04K rats, 04L mice, 04N flies, since 2023-11-18',
      litter: 'DSNY Litter Basket Inventory (8znf-7b2c)',
      sheds: 'DOB NOW: Build – Approved Permits (rbx6-tga4), work type Sidewalk Shed, active on 2026-11-18 and 2023-07-01',
      ridership: `${eyes.sources.entries}; ${eyes.sources.exits}`,
    },
    buildings, lines, points,
    elevation: { pts: elev.pts.filter(([x, y]) => near(x, y)) },
    rats: {
      r311: nyc.r311.filter((r) => near(r.lon, r.lat)).map((r) => ({ t: r.t, d: r.d, lon: r5(r.lon), lat: r5(r.lat), lt: r.lt })),
      inspections: nyc.inspLocs.filter((r) => near(r.lon, r.lat)).map((o) => ({ lon: r5(o.lon), lat: r5(o.lat), a: o.a, n: o.n, rat: o.rat, bait: o.bait, last: o.last })),
      // by month: 311 calls inside this map; inspections from the wider download (Morningside + West Harlem)
      months: Object.fromEntries(Object.entries(nyc.months).map(([k, v]) => [k, { sight: nyc.r311.filter((r) => near(r.lon, r.lat) && r.t.startsWith(k)).length, ratFailWide: v.ratFail, baitWide: v.bait, inspWide: v.insp }])),
      restaurants: nyc.restaurants.filter((r) => near(r.lon, r.lat)).map((r) => ({ ...r, lon: r5(r.lon), lat: r5(r.lat) })),
      litter: nyc.litter.filter((r) => near(r.lon, r.lat)).map((r) => ({ ty: r.ty, lon: r5(r.lon), lat: r5(r.lat) })),
      shedsNow: nyc.shedsNow.filter((r) => near(r.lon, r.lat)).map((s) => ({ ...s, lon: r5(s.lon), lat: r5(s.lat) })),
      sheds2023: nyc.sheds2023.filter((r) => near(r.lon, r.lat)).map((s) => ({ ...s, lon: r5(s.lon), lat: r5(s.lat) })),
    },
    ridership: { station: eyes.station.name, month: eyes.month, weekday: people('weekday'), saturday: people('saturday') },
  };
  const s = JSON.stringify(out);
  await writeFile(here('../data/manhattanville.json'), s);
  const uses = {}; for (const b of buildings) uses[b.use] = (uses[b.use] || 0) + 1;
  console.log(`data/manhattanville.json: ${(s.length / 1e6).toFixed(2)} MB, ${buildings.length} buildings`, uses);
}

main().catch((e) => { console.error(e); process.exit(1); });
