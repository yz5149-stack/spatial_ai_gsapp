// Every tunable number of the simulation lives here.

export const CONFIG = {
  seed: 20261110,

  // Map: a maze-like forest. Maze cells are 2 x 2 clearings of snow separated by one-cell walls of
  // pines, rocks and bushes, so corridors are 2 cells wide and walls are 1 cell thick.
  mazeCols: 16,
  mazeRows: 10,          // grid is 3 * cols + 1 by 3 * rows + 1 cells: 49 x 31
  braid: 0.45,           // share of dead ends opened into loops (the rest stay dead ends)
  clearings: 4,          // open clearings carved into the maze
  rockShare: 0.12,       // share of wall cells that are rocks
  bushShare: 0.14,       // share of wall cells that are bushes

  // World geometry (heights in cells), shared with the line-of-sight and hearing code
  levelHeight: 3,
  eyeHeight: 1.5,
  treeTop: 2.75,
  bushTop: 1.8,
  rockTop: 2.0,
  slabBottom: 2.75,
  slabTop: 3.0,
  foliageTop: 5.5,
  ladderCost: 3,
  muffling: { leaves: 1, bush: 1.5, tree: 3, rock: 6, floor: 6, wall: 100 },

  tickMs: 140,           // real time per tick at 1x speed (the creature maps about 7 cells a second)

  // The creature: an explorer first, a hunter after
  creature: {
    sight: 8,            // vision cone range (cells)
    coneDeg: 100,        // vision cone width
    exploreSpeed: 1.0,   // cells per tick while mapping the forest
    patrol: 0.42,        // cells per tick while hunting
    investigate: 0.62,
    chase: 0.8,
    hearing: 14,         // hears footsteps within this acoustic distance (quiet steps count farther)
    searchTicks: 10,     // turning on the spot where it lost the trail
  },

  // The survivor: knows nothing, wants the hospital on the east side
  survivor: {
    sight: 6,            // flashlight cone range
    coneDeg: 110,
    walk: 0.5,           // quiet steps
    run: 0.85,           // loud steps, when fleeing
    quiet: 6,            // a walking step is heard as if this much farther away
    hearing: 11,         // hears the creature move within this acoustic distance
    eastBias: 0.55,      // it was told the hospital is to the east: frontier cost per cell west
    fleeWithin: 7,       // runs when it sees the creature this close, or hears it this close
    hideTicks: 25,       // after a chase it freezes, quiet, for this long
    minSpawnPath: 22,    // spawns at least this far (path) from the creature, out of sight
  },

  catchDistance: 1.5,
  roundTicks: 900,       // a round ends at dawn: the survivor made it through the night
  pauseTicks: 18,        // between rounds
};
