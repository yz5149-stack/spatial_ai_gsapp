# Rat City: semantic model

**Spatial AI (ARCH6956-1), Columbia GSAPP, final project.** Ryan Fu, Lu Liu, Yifan Zhao.

**Spatial idea.** Rats are the most honest users of a street: they go exactly where its design leaves food, shelter and darkness. A model of rats that only know what they have smelled, seen and remembered turns a neighbourhood into a map of its design failures, and lets us test changes (bins, collection times, lights, sealed tree pits, see-through sidewalk sheds, bait stations, inspectors) before anyone builds them.

**Place.** Morningside Heights and West Harlem, New York: 1.43 km × 1.89 km between W 111th and W 133rd St, from Riverside Drive to Frederick Douglass Boulevard, around Columbia's Morningside and Manhattanville campuses. Rendered on Google Photorealistic 3D Tiles; simulated on a grid of 8 m cells (179 × 236).

---

## 1. Entities

| Entity | What it is | Source |
|---|---|---|
| **Cell** | 8 m × 8 m of ground. Ground: open, building, water, fence. Surface: avenue, street, path, steps, plaza, lawn, yard, woods. Flags: *wall* (open and touching a building), *road* (roadway), *soil* (can be dug). Values: elevation, light, people | OSM, NYC footprints, NYC elevation points |
| **Building** | Footprint, surveyed roof height, ground elevation, use (residential, campus, school, commercial, other), floor area | NYC Building Footprints + OSM building and zone tags |
| **Food source** | Where food is set out each night: a building's trash at its front, a restaurant, a grocery, a litter basket. Amount, set-out time, pickup time, *binned* or not, share within reach | Buildings (floor area), DOHMH restaurants (with their 04K "rats" violations), OSM groceries, DSNY litter baskets |
| **Street light** | A modelled pole every 32 m on every street and avenue, every 48 m on campus and park paths, plus OSM lamps; light falls off over 3.5 cells | Modelled (the city does not publish pole locations) |
| **People** | How busy a cell is: by surface, more near subway entrances, times the hour of day | Hourly entries + exits at 116 St–Columbia University (MTA) |
| **Sidewalk shed** | The wall cells in front of a building with an active DOB shed permit; *old* (plywood, dark, harbourage), *light* (the 2026 see-through design), *gone* | DOB NOW Approved Permits, work type Sidewalk Shed (2026-11-18 and 2023-07-01) |
| **Burrow** | A colony's home, on soil or under an old shed, away from light | Seeded from the real rat reports |
| **Bait station** | A cell next to a wall; rats avoid it while it is new (2 days), then may take the bait | Placed by the design and by inspectors |
| **Sign** | Droppings, rub marks, gnawing: left on every cell a rat runs over, fading by 10% a day | Simulated |
| **Real report** | 311 rodent calls (1,708) and DOHMH inspection locations with rat activity (1,677 places), 2023-11-18 to 2026-11-18 | NYC Open Data |

## 2. Agents

### Rat (many; colonies of 3 to 16)
- **Senses (partial).** *Smell*: food along the open air within 14 cells of walking distance (buildings block it). *Sight*: 2 cells around it. It knows nothing else.
- **Knowledge.** Its own map: every cell it has been near (starts empty).
- **Memory (landmarks).** Up to 8 *food places*, each with what it got there, how often it found nothing, and the hour it was first there (so it learns that bags appear at 8 pm); places it was *seen* by people; its *burrow*. Landmarks are reported relative to the burrow ("48 m E, 16 m S of its burrow").
- **Goal.** Eat a night's food (1 unit) and get home before light.
- **Plans ahead.** Each trip: smell first, then the best remembered place for this hour, then unexplored ground inside its home range (200 m). The route is the cheapest path on its own costs: light, people, open ground (it prefers walls), roadways; less under an old shed; a little more on ground it has never seen.
- **Performance.** Share of the night's need eaten; metres run; times seen; survival (bait, starvation, burrow treatment); young added to the colony.

### Inspector (2 by default; DOHMH)
- **Knowledge.** The public map (streets, sidewalks, paths). Yards, lawns and courtyards are unknown until seen.
- **Senses (partial).** Sees 5 cells in line of sight; signs under an old shed are half hidden.
- **Memory (landmarks).** Failed addresses (*hotspots*), evidence cells; returns for a compliance visit after 10 days; indexes the blocks around hotspots when there are no calls.
- **Goal.** Answer 311 calls, find active burrows, treat them.
- **Plans ahead.** Each morning the open complaints and compliance visits are shared out by nearest-next routing; each job is a shortest walk; at a failed address it follows the trail of signs, cell by cell, to the burrow.
- **Performance.** Inspections, share failed, burrows found and treated, rats killed, kilometres walked.

The first work orders are the **real** 311 rodent calls of the two weeks before the run.

## 3. Frames of reference (location)

1. **Grid**: cell (x, y), x east, y south.
2. **Metric**: metres east and south of the map's north-west corner; elevation in metres above sea level (NAVD88, NYC survey).
3. **Geographic**: longitude, latitude (WGS84); in 3D, ellipsoid height = elevation + the local geoid offset, calibrated against the Google tiles.
4. **Street**: "W 125th St, near Amsterdam Av" (nearest named way and the nearest other one), and street corners.
5. **Landmark-relative (each agent's own)**: a rat's food places relative to its burrow; an inspector's hotspots by address.

## 4. Distances and their metrics

| Distance | Metric | Used for |
|---|---|---|
| Straight line | Euclidean, metres | home range; "home is 120 m away" |
| Walking | Shortest path on open cells, 8 directions (diagonals √2), no corner cutting | inspectors' routes |
| Rat cost | Walking, each step × (1 + light × 2.2 + people × 2.5 + 0.8 off a wall + 1.5 on a roadway − 0.5 under an old shed + 0.6 if unknown) | rats' routes |
| Smell | Walking distance through open air (buildings block); a source's pull = amount / (1 + d / 5) | where rats go |
| Line of sight | Rays over the grid, stopped by buildings | what inspectors see |

## 5. Environment

- **Physical**, real place, real geometry, 3D.
- **Partially observable**: every agent senses only around it; each plans on its own map.
- **Multi-agent; agents consume space**: rats share burrows (a colony holds at most 16), share and empty the same food (what one eats, the next cannot), and avoid cells with fresh stations; inspectors' visits reset blocks.
- **Dynamic**: food appears and disappears by the hour; signs pile up and fade; light and people change by the hour; burrows are sealed and re-dug; colonies grow and die.
- **Non-deterministic**, seeded: the same seed replays exactly; designs are compared on the same seeds.
- **Obstacles**: buildings, fences, water.
- **Hindrances** (worse performance): light, people, open ground, roadways, bins, sealed soil, bait stations, inspectors. For inspectors: old sheds hide signs.
- **Affordances** (better performance): food set out early, torn bags, unbinned restaurants, walls, old sheds (cover and harbourage), soil and tree pits (burrows).

## 6. Time

One tick is one minute; a run is a week from 5 pm. Bags go out at the design's hour and are torn open bit by bit (18% of what is still bagged each hour); the truck comes in the morning or at night; restaurants put out at 11 pm. Rats forage from 6:30 pm to 6:30 am. Inspectors work 9 am to 5 pm. At dawn: rats that ate enough add to their colony's young; three hungry nights in a row kill a rat; signs fade.

## 7. The design (what the environment designer changes)

| Gene | Values | Cost |
|---|---|---|
| Residential set-out hour | 4 pm (before 2023), 6, 8 (now), 10 pm | free |
| Collection | morning, night shift | 12 |
| Bin rule | none, 1–9 units (2024), + Empire Bins west of Morningside Park (2025, approximated), all | free (policy) |
| Extra bins | any building | 0.5 each |
| Street lights | cells | 2 each |
| Sealed tree pits / yards | cells | 0.5 each |
| Bait stations | wall cells | 1 each |
| Sheds | per shed: old, see-through, removed | 3 / 5 |
| Inspectors | 1–5 | 8 each above 2 |

Budget: 60.

**Measures** after a week (two seeds): rats alive (not poisoned), times seen by people, food eaten, young born, deaths by cause, inspections and share failed, cost, and *r*, the correlation (in 32 m blocks) between where simulated rats ran and where the real reports were made.

**Score** (lower is better) = rats + 0.5 × sightings + 0.02 × food eaten. The *Rat paradise* objective maximises it instead: it evolves the worst street, which shows what a street must not do.

**Manual**: two variations of the current design run the same week side by side; the person chooses one, two new variations are made from it. **Automated**: epochs × variations, keeping the best each epoch.
