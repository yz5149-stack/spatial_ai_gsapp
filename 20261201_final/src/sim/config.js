// Every tunable number of the simulation lives here.
// Grid cells are 0.5 m square. Horizontal distances in the simulation are in cells; heights are given
// here in metres and converted to cells when a store is built (store.js).

export const CELL = 0.5; // metres per cell

export const CONFIG = {
  // The store: 18 m x 13 m outside the walls (about 2,500 sq ft, a mid-size convenience store).
  W: 36,
  H: 26,

  // Real fixture heights in metres (US retail standards: 54" and 72" gondolas, reach-in coolers,
  // a 40" checkout counter, stacked cartons).
  heights: { wall: 3.0, glass: 3.0, tall: 1.83, low: 1.37, fridge: 2.03, counter: 1.02, boxes: 1.2 },
  // The storefront glazing on the south side: sill and head heights (m)
  window: { sill: 0.45, head: 2.45 },
  // Eye and head heights (m). A crouching survivor hides behind a 54" gondola; a standing one does not.
  eye: { stand: 1.6, crouch: 0.95, creature: 1.75 },
  head: { stand: 1.72, crouch: 1.05, creature: 2.05 },

  // Muffling of sound, in cells of open air per cell of material the sound passes through.
  muffling: { wall: 60, glass: 10, fridge: 6, tall: 4, low: 2, counter: 2, boxes: 2 },

  tickSeconds: 0.2,       // one simulation tick is 0.2 s of store time
  roundTicks: 1100,       // a night in the store: 3 min 40 s
  pauseTicks: 20,         // between nights
  spawnEvery: 110,        // survivors come in one after another, this many ticks apart

  survivor: {
    sight: 11,            // flashlight cone range (cells) in full light
    coneDeg: 120,
    readRange: 6,         // reads a shelf's products within 3 m
    signRange: 12,        // reads an aisle sign within 6 m
    walk: 0.5,            // cells per tick (1.25 m/s)
    run: 0.86,            // 2.15 m/s
    sneak: 0.3,           // crouched
    hearing: 13,          // hears the creature within this acoustic distance (cells)
    fleeSee: 11,          // runs when it sees the creature this close (cells)
    fleeHear: 7,
    hideTicks: 26,
    patience: 650,        // after this long it leaves with what it has
    pickTicks: 5,         // taking an item off the shelf
    listSize: [2, 3],
  },

  creature: {
    sight: 12,            // vision range in full light (cells)
    coneDeg: 110,
    explore: 0.56,
    patrol: 0.5,
    investigate: 0.68,
    chase: 0.8,
    hearing: 13,          // hears a running step within this acoustic distance (cells)
    searchTicks: 12,
    feedTicks: 30,        // after a catch it stays put
    catchCells: 1.05,
  },

  // Noise of one step, as a share of the creature's hearing range
  noise: { walk: 0.55, run: 1.0, sneak: 0.28, pick: 0.35, slip: 1.25, creature: 0.75 },

  zones: {
    wet: { speed: 0.55, slip: 0.12, cost: 2.0 },    // hindrance: slow, and a slip is loud
    dark: { light: 0.12, cost: 0 },                 // hindrance to seeing, affordance to hiding
    noisy: { noise: 0.5, cost: 1.5 },               // crushed bags and bottles: louder steps
    mat: { noise: -0.5, speed: 1.08, cost: -0.3 },  // rubber mats: quiet, sure-footed
  },

  // The real place: a storefront in Morningside Heights, Manhattan, its glass facing south.
  place: { name: 'Morningside Heights, Manhattan', lat: 40.8075, lon: -73.9626, facadeAzimuth: 180, tz: 'America/New_York' },
};

export const CATS = ['water', 'food', 'medicine', 'batteries', 'warmers'];
export const CAT_LABEL = { water: 'Water', food: 'Food', medicine: 'Medicine', batteries: 'Batteries', warmers: 'Hand warmers' };
export const CAT_COLOR = { water: '#5ec8ff', food: '#ffb347', medicine: '#ff6b8a', batteries: '#c3f75e', warmers: '#ff8f4a' };
