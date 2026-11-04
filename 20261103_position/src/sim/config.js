// Every tunable number of the simulation lives here.
// The perception parameters (vision range, cone angles, hearing range) are fixed by the
// assignment design; balancing only touches the AI behaviour block at the bottom.

export const CONFIG = {
  seed: 20261022,

  // Grid
  width: 44,
  height: 28,
  levelHeight: 3,          // the canopy floor is 3 cells above the ground
  eyeHeight: 1.5,          // eye point above the floor an agent stands on

  // Solid volumes (heights in cells, measured from the ground)
  treeTop: 2.75,           // tree trunks and crowns fill the ground level up to the canopy slab
  bushTop: 1.8,            // bushes are taller than eye height, but you can look over them from above
  rockTop: 2.0,
  slabBottom: 2.75,        // platform floor slab, between ground level and canopy level
  slabTop: 3.0,
  foliageTop: 5.5,         // leaf clumps on the platforms

  // Map generation
  treeCount: 270,
  bushRows: 16,
  rockCount: 8,
  platformCount: 0,
  ladderCount: 0,
  foliageClumpsPerPlatform: 2,
  noDeadEnds: true,
  trail: true,             // a designed layout: a winding trail from a car (west) to the hospital (east)
  clearings: 4,            // small clearings off the trail; the case lies in one
  logCount: 9,             // fallen logs (3 cells, low: you can see over them)               // every walkable cell lies on a loop: no path is a dead end

  // Vision: forward cone, 3D Euclidean distance, blocked by solid volumes
  visionRange: 9,
  coneHorizontalDeg: 120,  // full horizontal opening
  coneVerticalDeg: 60,     // up and down from the horizon

  // Hearing: 360 degrees, acoustic distance (straight line plus muffling by what it passes through)
  hearingRange: 12,
  // Extra cells of distance added for every grid cell of material the straight line passes through:
  // a footstep heard through one cell of rock sounds as faint as one 6 cells farther away in open air.
  muffling: { leaves: 1, bush: 1.5, tree: 3, rock: 6, floor: 6, wall: 100 },
  sneakQuietness: 5,       // sneaking steps are soft: heard as if 5 cells farther away

  // Walking: path distance along walkable cells (the bonus metric)
  ladderCost: 3,

  // 3D rays cast from every walkable cell (visibility fingerprint)
  rayAzimuthStepDeg: 5,                     // 72 rays per ring
  rayElevationsDeg: [-60, -30, 0, 30, 60],  // five rings
  rayPoles: true,                           // plus straight up and straight down

  // Round
  maxSteps: 500,
  minStartPathDistance: 22,
  catchDistance: 1.5,            // the police catches the thief on the same or a neighbouring cell
  exitSides: ['east'],           // the hospital door: the middle of the east side of the boundary wall
  diamondMinFromExit: 10,        // the diamond is never placed right next to an exit
  thiefStartFromDiamond: 22,     // the thief starts at least this far (path) from the diamond
  policeStartFromDiamond: [3, 10],

  // Position + movement relations (this week's assignment)
  relations: {
    betweenTolerance: 1.6,   // "between": at most this far (cells, on the plan) from the segment
    aroundDeg: 270,          // "around": the bearing from the case turned at least this much
    aroundRadius: 7,         // ... while staying within this many cells of it (plan distance)
    pastDistance: 4,         // "past": the gap closed to at most this path distance and opened again
    belowWithin: 2,          // "below": the creature this close (plan) to the tree you are in
  },

  // Crows: occupants with a built-in capability. They perch in trees and caw when you are adjacent.
  crows: {
    count: 3,
    cawRange: 16,            // a caw carries farther than a footstep (acoustic distance)
    cooldown: 40,            // ticks a crow stays quiet after cawing
    minFromCase: 5,          // crows never perch right next to the case (plan distance)
  },

  // The game: you, the creature, the vaccine case and the hospital. One tick is one step.
  game: {
    tickMs: 150,             // real time per step
    walkSpeed: 0.5,          // cells per tick (about 3 cells a second); footsteps heard as if sneakQuietness farther
    climbTicks: 2,           // getting into or out of a tree
    treeTicks: 50,           // you can hold on in a tree for 7.5 seconds, then you climb down
    treeCooldown: 10,        // ticks before you can climb again
    shotRange: 7,            // the shot reaches this far (Euclidean), needs a clear line
    shotCooldown: 4,         // ticks between shots
    shotHeard: 20,           // a shot is heard this far (acoustic distance)
    freezeTicks: 20,         // a hit freezes the creature for 3 seconds (20 x 150 ms)
    caseAlarmTicks: 40,      // after you take the case it beeps for 6 seconds: the creature knows where you are
    caseFromDoor: 20,        // the case lies at least this far (path) from the hospital door
    maxTicks: 2400,          // 6 minutes: then the night is over
    searchTicks: 8,          // the creature turns a full circle where it lost you
    difficulty: {
      // creature speeds in cells per tick (yours is 0.5), how far it sees, and your bullets.
      // 'track' is its speed while the case beeps: it rushes at you for those 6 seconds.
      easy:   { patrol: 0.22, investigate: 0.32, chase: 0.45, track: 0.6, sight: 6, ammo: 3 },
      normal: { patrol: 0.3, investigate: 0.45, chase: 0.6, track: 0.7, sight: 9, ammo: 1 },
      hard:   { patrol: 0.36, investigate: 0.55, chase: 0.72, track: 0.8, sight: 9, ammo: 1 },
    },
  },

  // Running speeds in cells per step (fractions add up: 1.2 = one extra cell every 5 steps).
  // These are rules of the game, not AI tuning: balancing does not change them.
  speeds: {
    run: 1,                  // everyone's normal running speed
    thiefCarrying: 0.8,      // the diamond slows the thief down
    policeChase: 1,          // chasing by sight, before the theft, when not sprinting
    policeSprint: 1.2,       // the officer's sprint
    policeSprintStamina: 15, // after the theft the officer sprints for 15 cells, then tires back to 1
    policeCloseSprint: 5,    // within 5 cells (path) of the thief it knows about, the officer sprints anyway
  },

  // AI behaviour (the only block changed while balancing)
  ai: {
    policeGuardRadius: 10,        // patrol targets around the diamond lie within this path distance
    policeRoamChance: 0.45,       // chance that a patrol target is anywhere on the map instead
    thiefStageRadius: 8,          // the thief waits for its chance within this path distance of the diamond
    thiefQuietSteps: 8,           // ... until it has not heard the police for this many steps
    thiefWaitMax: 60,             // ... or for at most this long
    thiefHideAfterFlee: 20,       // after fleeing, lie low this long before sneaking back
    thiefLateMargin: 15,          // go for the diamond whatever the risk when time is this short
    policeOpenQuantile: 0.5,      // patrol targets are drawn from the more open half of the map
    policePatrolMin: 8,           // patrol targets are at least this far (path distance)
    policeScanSteps: 8,           // a full turn in 45 degree steps
    policePatrolLookEvery: 2,     // on patrol, glance sideways every n steps
    thiefHideQuantile: 0.25,      // waiting spots: among the 25% of cells with the smallest view
    thiefLookEvery: 6,            // while waiting, turn the head every n steps
    thiefSneakEvery: 2,           // sneaking: one cell every two steps
    thiefHoldBreath: 10,          // steps of silence after hearing a distant police officer
    thiefPanicDistance: 0,        // police this close (path distance): run (0: off)
    thiefMemorySteps: 2,          // the thief remembers where the police was for this many steps
    thiefExposedFleeDistance: 12, // in plain view of the police (if it turned): run when it is this close
    thiefApproachFlee: 8,         // footsteps coming closer within this path distance: run
    thiefGiveawayWindow: 3,       // hearing the police within n steps of moving means "it heard me"
    thiefFleeMargin: 2,           // the thief must reach the escape cell this much sooner
    thiefExposureWeight: 2,       // how much the thief avoids spots that can be seen from many cells
    thiefAvoidPoliceWeight: 0.3,  // how much the thief prefers spots far from where it last noticed the police
    policeTurnOnHear: true,       // the officer turns the head toward a sound at once
    policeChaseFollowsSound: false, // while chasing, follow footsteps too (true) or only what it sees
    policeRetarget: false,        // follow every new sound while investigating, or finish the current one
    thiefBlockedPenalty: 30,      // an exit with the police between it and the thief counts as this much farther
    thiefRespectsGuard: true,     // the thief does not go for the diamond while the police stands between them
    thiefAvoidsOwls: true,        // waiting spots are never next to an owl
  },
};
