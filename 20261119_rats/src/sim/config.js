// Every tunable number of the simulation. Times are minutes of the day (0 = midnight) unless noted.

export const CONFIG = {
  seed: 20261119,
  cellM: 6,                 // one grid cell is 6 m by 6 m
  tickMin: 1,               // one tick is one minute
  startHour: 17,            // a run starts at 5 pm on day 0
  days: 7,                  // a run is a week

  // ---- the street ------------------------------------------------------------------------
  lampEveryM: 32,           // New York lights every street; modelled poles every 32 m along each street
  pathLampEveryM: 48,       // and along campus and park paths
  lampReach: 4.5,           // cells a pole lights (light falls off to 0 there)
  people: { avenue: 1, street: 0.45, plaza: 0.8, path: 0.5, steps: 0.4, lawn: 0.12, yard: 0.03, woods: 0.05, subway: 1.5 },

  // ---- food ------------------------------------------------------------------------------
  // food is counted in "rat-nights": one unit feeds one rat for one night
  food: {
    residentialPerM2: 1 / 900,  // gross floor area per unit of food set out per night (bags)
    bagAccess: 0.04,            // share of bag food a rat can actually get at (torn bags, spills)
    campusShare: 0.25,          // Columbia, Barnard, schools: carted from loading docks
    commercialShare: 0.5,
    maxPerSource: 14,
    restaurant: 3,              // per restaurant per night, plus per 04K (rats) violation
    restaurantRatViolation: 1.5,
    grocery: 2,
    basket: 0.25,                // a litter basket, filled during the day
    betterBin: 0.55,            // share a "Better Bin" leaves within reach of rats
    binnedShare: 0.004,         // share left within reach when the trash is in a lidded bin
    spill: 0.15,                // share of bag food left as spill after collection
    tearPerHour: 0.18,          // share of what is still bagged that gets torn open or spilt each hour out
  },
  setOutHour: 20,               // residential bags go out at 8 pm (the 2023 rule; 4 pm before)
  binSetOutHour: 18,            // containers may go out at 6 pm
  pickup: { morning: [6, 11], night: [0, 4] },  // when the truck passes (hours), per block face
  restaurantOutHour: 23,        // after closing; private carters collect at night
  restaurantPickup: [2, 5],

  // ---- rats ------------------------------------------------------------------------------
  rat: {
    colonies: 12,
    startPerColony: [4, 7],
    speed: 3,               // cells per tick while foraging (18 m a minute, with stops)
    fleeSpeed: 6,           // cells per tick when running from someone (about 0.8 m/s)
    smell: 18,              // cells: how far it smells food along open air (108 m)
    sight: 3,               // cells it sees around it (rats are near-sighted)
    alert: 6,               // cells: it notices a person with a flashlight this close (sees, hears)
    homeRange: 32,          // cells (about 190 m): it rarely goes farther from its burrow
    need: 1,                // food units per night to stay fed
    carry: 1,               // eats where it finds food, up to this per visit
    eatTicks: 4,
    activeFrom: 18.5, activeTo: 6.5,   // hours: foraging night
    peopleShy: 2.5,         // extra cost per unit of people on a cell
    lightShy: 2.2,          // extra cost per unit of light
    openShy: 0.8,           // extra cost away from a wall (rats run along walls)
    coverBonus: 0.5,        // cost taken off under an old-style sidewalk shed
    streetCross: 1.5,       // extra cost on a roadway
    dangerCost: 3,          // extra cost near a place it was chased (memory, fading over days)
    neophobiaDays: 2,       // new objects (bait stations, bins) are avoided this long
    baitTake: 0.12,         // chance to eat bait at a station it passes, if hungry
    baitDaysToDie: [1, 3],
    starveNights: 3,        // dies after this many nights in a row with under a third of its need
    litter: 0.07,           // per well-fed rat per night: young added to the colony
    colonyMax: 16,
    maxRats: 160,
  },

  // ---- inspectors: a night rat patrol with flashlights -----------------------------------
  inspector: {
    count: 2,
    shift: [19, 3],         // hours: 7 pm to 3 am, when the rats are out
    speed: 10,              // cells per tick walking (60 m a minute)
    chaseSpeed: 9,          // cells per tick running after a rat, around parked cars and people
    beam: 9,                // cells: how far the flashlight reaches (54 m)
    beamDeg: 70,            // width of the beam
    near: 2,                // cells it notices all around, without the beam
    spotChance: 0.7,        // chance to spot a rat in the beam each tick (half as much in the dark part of the beam, under old sheds)
    catchChance: 0.6,       // chance to catch it (trap, net) once within reach
    reach: 1.5,             // cells
    chaseTicks: 6,          // gives up after this long
    signSeen: 10,           // sign level that counts as evidence (droppings, rub marks, gnawing)
    lookAt: 4,              // cells around the address that are checked
    indexing: true,         // with no complaints left, they index the blocks around failed addresses
    shedHides: 0.5,         // under an old shed, half the signs are hidden from view
    trailSteps: 16,         // how far it follows a trail of signs
    inspectMin: 8,          // minutes spent at each address
    treatKill: 0.2,         // share of a colony killed by baiting its burrow
    stationsPerDay: 2,
    complaintDelayDays: 1,  // a sighting becomes a 311 call the next day
    compliance: 10,         // days before it comes back to a failed address
  },
  sightingChance: 0.002,    // per tick a rat spends on a lit, busy cell
  callChance: 0.2,          // share of sightings someone reports to 311
  signDecay: 0.9,           // signs fade by this factor a day

  // ---- the environment designer -------------------------------------------------------------
  budget: 60,
};
