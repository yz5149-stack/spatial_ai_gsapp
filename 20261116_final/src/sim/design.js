// An environment design: what the environment designer adds to a real place for the storm night.
// The place itself (streets, buildings, terrain, weather) is real and fixed; the design is the
// emergency response laid on top of it, under a budget:
//
//   warming   warming centres (affordance: warmth gained per tick)              3 points each
//   caches    supply caches: batteries, hand warmers, food (affordance)        1 point each
//   plowed    named streets the city plows (affordance: little snow; but lit,  2 points each
//             wide and exposed, so the creature sees you there)
//   barricades 3-cell snow piles or police barriers (obstacles)                 1 point each
//   lair      where the creature starts (the designer may move the threat)     free
//
// A design is plain JSON, so it can be saved, shared, mutated and evaluated in a worker.

import { makeRng } from './rng.js';
import { S, barricadeCells } from './city.js';

export const BUDGET = 14;
export const COST = { warming: 3, cache: 1, plow: 2, barricade: 1 };
export const CACHE_TYPES = ['battery', 'warmers', 'food'];
export const LIMITS = { warming: 3, caches: 8, plowed: 3, barricades: 6 };

export function designCost(d) {
  return d.warming.length * COST.warming + d.caches.length * COST.cache + d.plowed.length * COST.plow + d.barricades.length * COST.barricade;
}

const randomOpen = (world, rng, pred = () => true) => {
  for (let t = 0; t < 400; t++) {
    const i = rng.pick(world.nodes);
    if (pred(i)) return i;
  }
  return rng.pick(world.nodes);
};

const isRoad = (world, i) => world.surface[i] === S.AVENUE || world.surface[i] === S.STREET;
export function plowableStreets(world) {
  const count = new Map();
  for (let i = 0; i < world.N; i++) if (world.walk[i] && isRoad(world, i) && world.street[i] >= 0) count.set(world.street[i], (count.get(world.street[i]) ?? 0) + 1);
  return [...count.entries()].filter(([, n]) => n >= 12).sort((a, b) => b[1] - a[1]).map(([id]) => world.names[id]);
}

const farFrom = (world, cells, r) => (i) => cells.every((c) => Math.hypot((c % world.W) - (i % world.W), Math.floor(c / world.W) - Math.floor(i / world.W)) > r);

// A first, random design for a place.
export function randomDesign(world, seed) {
  const rng = makeRng(seed);
  const d = { id: `d${seed % 100000}`, place: world.place.id, parent: null, lair: null, warming: [], caches: [], plowed: [], barricades: [] };
  const streets = plowableStreets(world);
  d.lair = randomOpen(world, rng, farFrom(world, [world.door], 30));
  for (let k = 0; k < 2; k++) d.warming.push(randomOpen(world, rng, farFrom(world, [world.door, d.lair, ...d.warming], 10)));
  for (let k = 0; k < 4; k++) d.caches.push({ cell: randomOpen(world, rng, farFrom(world, [d.lair], 6)), type: CACHE_TYPES[k % 3] });
  if (streets.length) d.plowed.push(rng.pick(streets));
  d.barricades.push(randomBarricade(world, rng, d));
  return d;
}

function randomBarricade(world, rng, d) {
  for (let t = 0; t < 200; t++) {
    const cell = randomOpen(world, rng, farFrom(world, [world.door, d.lair, ...world.doorCells], 4));
    const dir = rng.chance(0.5) ? 'h' : 'v';
    const cells = barricadeCells(world.W, world.H, { cell, dir });
    if (cells.every((i) => world.walk[i])) return { cell, dir };
  }
  return { cell: d.lair, dir: 'h' };
}

// Moves a cell a few steps to another open cell nearby.
function nudge(world, rng, cell, r) {
  for (let t = 0; t < 60; t++) {
    const x = (cell % world.W) + rng.int(-r, r); const y = Math.floor(cell / world.W) + rng.int(-r, r);
    if (x < 1 || y < 1 || x >= world.W - 1 || y >= world.H - 1) continue;
    const i = y * world.W + x;
    if (world.walk[i]) return i;
  }
  return cell;
}

// A variation of a design: one to three small changes, staying within the budget.
export function mutate(world, design, seed, strength = 1) {
  const rng = makeRng(seed);
  const d = structuredClone(design);
  d.parent = design.id;
  d.id = `d${seed % 100000}`;
  const streets = plowableStreets(world);
  const ops = 1 + rng.int(0, Math.round(1 + strength));
  for (let n = 0; n < ops; n++) {
    const op = rng.pick(['moveWarm', 'moveWarm', 'moveCache', 'moveCache', 'cacheType', 'add', 'remove', 'plow', 'moveBarricade', 'turnBarricade', 'lair']);
    switch (op) {
      case 'moveWarm': if (d.warming.length) { const k = rng.int(0, d.warming.length - 1); d.warming[k] = nudge(world, rng, d.warming[k], Math.round(8 * strength)); } break;
      case 'moveCache': if (d.caches.length) { const c = rng.pick(d.caches); c.cell = nudge(world, rng, c.cell, Math.round(8 * strength)); } break;
      case 'cacheType': if (d.caches.length) rng.pick(d.caches).type = rng.pick(CACHE_TYPES); break;
      case 'moveBarricade': if (d.barricades.length) { const b = rng.pick(d.barricades); b.cell = nudge(world, rng, b.cell, Math.round(6 * strength)); } break;
      case 'turnBarricade': if (d.barricades.length) { const b = rng.pick(d.barricades); b.dir = b.dir === 'h' ? 'v' : 'h'; } break;
      case 'plow': if (streets.length) { if (d.plowed.length && rng.chance(0.5)) d.plowed[rng.int(0, d.plowed.length - 1)] = rng.pick(streets); else d.plowed.push(rng.pick(streets)); d.plowed = [...new Set(d.plowed)]; } break;
      case 'lair': d.lair = nudge(world, rng, d.lair, Math.round(10 * strength)); break;
      case 'add': {
        const what = rng.pick(['warming', 'cache', 'cache', 'barricade', 'plow']);
        if (what === 'warming' && d.warming.length < LIMITS.warming) d.warming.push(randomOpen(world, rng, farFrom(world, [world.door, ...d.warming], 8)));
        if (what === 'cache' && d.caches.length < LIMITS.caches) d.caches.push({ cell: randomOpen(world, rng), type: rng.pick(CACHE_TYPES) });
        if (what === 'barricade' && d.barricades.length < LIMITS.barricades) d.barricades.push(randomBarricade(world, rng, d));
        if (what === 'plow' && streets.length && d.plowed.length < LIMITS.plowed) d.plowed = [...new Set([...d.plowed, rng.pick(streets)])];
        break;
      }
      case 'remove': {
        const lists = ['warming', 'caches', 'barricades', 'plowed'].filter((k) => d[k].length);
        if (lists.length) { const k = rng.pick(lists); d[k].splice(rng.int(0, d[k].length - 1), 1); }
        break;
      }
      default: break;
    }
  }
  // over budget: drop items at random until it fits
  while (designCost(d) > BUDGET) {
    const lists = ['warming', 'caches', 'barricades', 'plowed'].filter((k) => d[k].length);
    const k = rng.pick(lists);
    d[k].splice(rng.int(0, d[k].length - 1), 1);
  }
  // nothing on the refuge door or on the lair
  d.barricades = d.barricades.filter((b) => barricadeCells(world.W, world.H, b).every((i) => !world.doorCells.includes(i) && i !== d.lair));
  return d;
}

// Short description, for lists
export function describeDesign(d) {
  const t = (k) => d.caches.filter((c) => c.type === k).length;
  return `${d.warming.length} warming centre${d.warming.length === 1 ? '' : 's'} · ${d.caches.length} caches (${t('battery')}B ${t('warmers')}W ${t('food')}F) · `
    + `${d.plowed.length ? `plowed: ${d.plowed.join(', ')}` : 'no plowing'} · ${d.barricades.length} barricade${d.barricades.length === 1 ? '' : 's'}`;
}
