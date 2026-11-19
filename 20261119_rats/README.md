# Rat City

**Spatial AI (ARCH6956-1), Columbia GSAPP. Final project.** Ryan Fu, Lu Liu, Yifan Zhao. Instructor: William Martin.

**Live:** https://yz5149-stack.github.io/spatial_ai_gsapp/20261119_rats/
**Semantic model:** [semantic-model.md](semantic-model.md)

Rats and a night rat patrol on 125th Street and Amsterdam Avenue, Harlem (Broadway to Morningside Av, W 122nd to W 129th St), drawn as an architectural axonometric from the city's surveyed building footprints, roof heights and ground elevations. Rats come out after dark: they smell food along the open air, run along walls, keep out of light and away from people, and remember where (and when) they found food and where they were chased. Inspectors walk the night with flashlights: they answer 311 calls, look for droppings and gnawing, follow the trail to the burrow, bait it and seal it; a rat caught in the beam is chased and is either caught or gets away (into its burrow, which gives the burrow away). Chases play in slow motion and the camera follows them. The city sets the table: when bags go out, whether trash is in bins, where lights and sidewalk sheds are.

You are the **environment designer**: change the rules and the street, compare two variations and choose, or let designs evolve over epochs, toward fewer rats or (to learn what not to do) toward a rat paradise.

## How it answers the final brief

| Requirement | In Rat City |
|---|---|
| Baseline simulation from a semantic model | [semantic-model.md](semantic-model.md); press *Start*: today's rules |
| ≥ 2 notions of **location** | Grid; metres from the corner + elevation; longitude/latitude (and ellipsoid height in 3D); street ("W 125th St, near Amsterdam Av"); each rat's food places relative to its burrow. Shown for the selected agent |
| ≥ 2 notions of **distance** | Straight line; walking (8 directions); the rat's cost (light, people, open ground, roadways, cover); smell (walking distance through open air); line of sight |
| ≥ 2 kinds of **spatial agents** | Rats (colonies) and inspectors; bodega cats (a predator, in the designer); cars on every street and avenue (traffic by hour), which can hit a rat on the roadway |
| Limited knowledge, scanning | Rats smell 18 cells (108 m) and see 2–3; they notice a flashlight 6 cells away. Inspectors see along a 70° flashlight beam 9 cells (54 m) long, blocked by buildings, half as well in the dark and under old sheds. Each builds its own map |
| **Shared knowledge** | Each rat's map starts at its burrow. Back home it leaves what it saw, the food places it found and where it was chased with its colony; setting out, it takes the colony's best places. Rats of different burrows that meet swap their best food place (rats learn food from each other's breath). The right-hand map shows everything the rats know, dark where nobody has been |
| **Spatial memory** | Rats: food places with the hour they appear, their burrow; inspectors: failed addresses, revisited and used to choose which blocks to index |
| **Goals** and **performance** | Rat: eat a night's food and get home (share fed, survival, young). Inspector: find and treat burrows (inspections, share failed, burrows treated, km) |
| **Plan ahead** | Rats: smell → memory → explore, then the cheapest route on their own map; inspectors: nearest-next route over the day's list, shortest walks, following the trail of signs to the burrow |
| Physical, partially observable, multi-agent (agents consume space), dynamic, non-deterministic (seeded) | Yes (see the model) |
| Obstacles; hindrances and affordances | Buildings, fences, water; light, people, roadways, bins, sealed soil, bait / food, walls, old sheds, soil |
| **Primary**: environment designer | *What if…?* (a drawer over the street): pick a season, tick real changes (bags at 10 pm, bins everywhere, night pickup, bait stations and sealed soil at the real hotspots, see-through sheds, lights, a third inspector, working cats, birth-control bait, dry ice in burrows), run a week, bars against today's rules. *Let the computer try*: two variations, choose one, repeat (manual, with lineage); or evolve six generations toward fewer rats or a rat paradise |
| **Secondary**: real data, 3D + time | Axonometric drawn from NYC footprints (surveyed heights) and elevation points; 311 rodent calls, DOHMH rodent inspections and restaurant violations, DOB shed permits (2023 and today), DSNY litter baskets; MTA hourly ridership; the *Real data* tab charts three years of reports by month |

## Data

All fetched on 2026-11-18 for the box W −73.9670, E −73.9500, S 40.8030, N 40.8200 (`data/raw/`); the simulation uses W −73.9620, E −73.9500, S 40.8085, N 40.8195, combined into `data/manhattanville.json` by `node tools/build_place.mjs`.

| What | Source |
|---|---|
| Streets, paths, parks, buildings' use, trees, lamps, subway entrances, restaurants and shops | OpenStreetMap (Overpass API), ODbL |
| Building footprints, roof height, ground elevation | NYC Open Data, Building Footprints (`5zhs-2jue`) |
| Ground elevation points | NYC Planimetric Database: Elevation Points (`9uxf-ng6q`) |
| 311 rodent calls, 2023-11-18 to 2026-11-18 | 311 Service Requests (`erm2-nwe9`), complaint type Rodent |
| Rodent inspections (results, by location) | DOHMH Rodent Inspection (`p937-wjvj`) |
| Restaurants and their rat violations (04K) | DOHMH Restaurant Inspection Results (`43nn-pn8j`) |
| Litter baskets (and which are "Better Bins") | DSNY Litter Basket Inventory (`8znf-7b2c`) |
| Sidewalk sheds active on 2026-11-18 and 2023-07-01 | DOB NOW: Build – Approved Permits (`rbx6-tga4`), work type Sidewalk Shed |
| People by hour | MTA hourly ridership at 116 St–Columbia University, October 2025 (from our `20261117_eyes` prototype) |

**Modelled, not measured:** street-light poles (every 32 m); how much food a building sets out (from its floor area); how much of it rats can reach; the Empire Bin area (west of Morningside Park); rat behaviour constants (`src/sim/config.js`).

## Running it

Open `index.html` through a web server from the repository root (for example `python3 -m http.server`, then `/20261119_rats/`). Designs are evaluated in Web Workers. `npm test` runs the tests.

| Control | What it does |
|---|---|
| Rules | 2022 rules, today's rules, or your design |
| 1× … 120×, Pause (Space), Next night, Restart week | time |
| Whole area / Follow selected / Street level | camera |
| Rat paths tonight / Signs / Real reports / Light | the layer draped over the city and the map |
| Drop a trash bag (button on the city) | its smell spreads in rings; the rats that catch it show a “!” and their route |
| Watch the chases, Slow down for chases | the camera flies to each chase and time slows down; *Happening now* lists spotted / caught / got away (click to fly there) |
| Design, Compare two, Evolve, Gallery, Real data | the environment designer |

## Files

`index.html`, `style.css`; `src/sim/` (`city.js` the grid from the data, `sim.js` agents and time, `design.js` the genome, `evaluate.js` runs and evolution, `path.js` planning, `worker.js`); `src/render/` (`axo.js` the axonometric drawing (three.js), `plan.js` 2D maps, `icons.js`); `src/ui/` (`main.js`, `designer.js`); `tools/build_place.mjs`; `tests/`.
