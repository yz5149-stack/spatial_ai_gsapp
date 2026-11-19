// Every tunable number of the simulation. Times are minutes of the day (0 = midnight) unless noted.

export const CONFIG = {
  seed: 20261119,
  cellM: 8,                 // one grid cell is 8 m by 8 m
  tickMin: 1,               // one tick is one minute
  startHour: 17,            // a run starts at 5 pm on day 0
  days: 7,                  // a run is a week

  // ---- the street ------------------------------------------------------------------------
  lampEveryM: 32,           // New York lights every street; modelled poles every 32 m along each street
  pathLampEveryM: 48,       // and along campus and park paths
  lampReach: 3.5,           // cells a pole lights (light falls off to 0 there)
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
    colonies: 26,
    startPerColony: [3, 6],
    speed: 2,               // cells per tick while moving (16 m a minute, with stops)
    smell: 14,              // cells: how far it smells food along open air (112 m)
    sight: 3,               // cells: rats are near-sighted
    homeRange: 26,          // cells (about 200 m): it rarely goes farther from its burrow
    need: 1,                // food units per night to stay fed
    carry: 1,               // eats where it finds food, up to this per visit
    eatTicks: 4,
    activeFrom: 18.5, activeTo: 6.5,   // hours: foraging night
    peopleShy: 2.5,         // extra cost per unit of people on a cell
    lightShy: 2.2,          // extra cost per unit of light
    openShy: 0.8,           // extra cost away from a wall (rats run along walls)
    coverBonus: 0.5,        // cost taken off under an old-style sidewalk shed
    streetCross: 1.5,       // extra cost on a roadway
    neophobiaDays: 2,       // new objects (bait stations, bins) are avoided this long
    baitTake: 0.12,         // chance to eat bait at a station it passes, if hungry
    baitDaysToDie: [1, 3],
    starveNights: 3,        // dies after this many nights in a row with under a third of its need
    litter: 0.07,           // per well-fed rat per night: young added to the colony (a litter of ~8 every ~4 months per rat, a share of them grown)
    colonyMax: 16,
    maxRats: 420,
  },

  // ---- inspectors -------------------------------------------------------------------------
  inspector: {
    count: 2,
    shift: [9, 17],         // hours
    speed: 9,               // cells per tick (72 m a minute, walking)
    sight: 5,               // cells
    signSeen: 25,           // sign level that counts as evidence (droppings, rub marks, gnawing)
    lookAt: 3,              // cells around the address that are checked
    indexing: true,         // with no complaints left, they index the blocks around failed addresses
    shedHides: 0.5,         // under an old shed, half the signs are hidden from view
    trailSteps: 12,         // how far it follows a trail of signs
    inspectMin: 12,         // minutes spent at each address
    treatKill: 0.25,        // share of a colony killed by baiting its burrow
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
