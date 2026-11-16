// Every tunable number of the simulation lives here.

export const CONFIG = {
  seed: 20261116,
  cellM: 8,              // one grid cell is 8 m by 8 m of the real place
  woodDensity: 0.42,     // share of woodland cells that hold a tree trunk (the rest is underbrush)

  // Heights for the 3D sight and sound code, in metres
  eyeM: 1.6,
  creatureEyeM: 2.4,
  muffling: { building: 8, tree: 1.2, bush: 1, rock: 5, fence: 0.3, terrain: 4, wall: 100 },

  tickMs: 140,           // real time per tick at 1x speed
  roundTicks: 900,       // one round is one night of the storm
  pauseTicks: 18,        // between rounds

  // The night that is played, taken from the real hourly record (see src/data/places.js)
  night: { start: '2016-01-23T17:00', hours: 12 },

  creature: {
    sight: 7,            // vision cone range (cells) in clear air; snowfall shortens it
    coneDeg: 100,
    litBonus: 1.6,       // it sees a survivor standing under a street light this much farther
    exploreSpeed: 1.0,
    patrol: 0.5,
    investigate: 0.72,
    chase: 0.7,
    hearing: 13,         // acoustic distance (cells) at which it hears running steps in calm air
    searchTicks: 10,
    snowDrag: 70,        // its speed is divided by 1 + snow depth (cm) / snowDrag
  },

  survivor: {
    count: 3,            // survivors per round (they take up space: two never share a cell)
    sight: 6,            // flashlight cone range (cells)
    darkSight: 2.5,      // without light: battery empty, or hiding with the light off
    coneDeg: 110,
    walk: 0.55,
    run: 0.95,
    quiet: 6,            // a walking step is heard as if this much farther away
    hearing: 11,
    headingBias: 0.5,    // it was told which way the refuge is: frontier cost per cell away from it
    fleeWithin: 7,
    hideTicks: 25,
    minSpawnPath: 30,    // spawns at least this far (walking) from the creature
    snowDrag: 28,        // its speed is divided by 1 + snow depth (cm) / snowDrag
  },

  // Survival: three needs, each 0..100
  needs: {
    warmthLoss: 0.19,      // per tick at a wind chill of -10 C, fully exposed
    shelterKeeps: 0.6,     // share of the wind a building or wood takes away on its lee side
    deepSnowWet: 0.35,     // extra heat loss while wading through deep snow (> 25 cm)
    runHeat: 0.35,         // running warms you a little
    staminaWalk: 0.08,     // per cell walked, times the snow factor
    staminaRun: 0.45,      // per cell run
    staminaClimb: 0.06,    // per metre climbed
    staminaRest: 0.4,      // recovered per tick standing still
    exhausted: 12,         // below this stamina it cannot run
    batteryDrain: 0.11,    // per tick with the flashlight on
    warmCentre: 2.2,       // warmth gained per tick next to a warming centre
    doorway: 0.3,          // gained per tick in a shop doorway (out of the wind, warm air)
    subwayAir: 0.7,        // gained per tick at a subway entrance (warm air from below)
    lowWarmth: 45,         // below this it goes for the nearest warm place it knows
    lowBattery: 25,        // below this it goes for batteries it knows about
    lowStamina: 25,
  },

  catchDistance: 1.5,
};
