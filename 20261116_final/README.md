# Frostroot: Whiteout

**Spatial AI (ARCH6956-1), Columbia GSAPP. Final project.**

Instructor: [William Martin](https://awmartin.xyz/spatial-computing/course/)

Group: **Ryan Fu, Lu Liu, Yifan Zhao**

**Simulation:** https://yz5149-stack.github.io/spatial_ai_gsapp/20261116_final/
**Semantic model:** [semantic-model.md](semantic-model.md)

A spatial simulation of survival in **real New York places**, through the **real January 2016 blizzard**, hour by hour. It grows out of our [Spatial Agents workshop](../20261110_agents/) (a creature that maps a maze-forest, then hunts a survivor by sound). Two changes:

1. **Real-world maps.** Three 640 m × 480 m pieces of Manhattan, rasterised to 8 m cells from OpenStreetMap, with every building's **surveyed roof height and ground elevation** from NYC Open Data, and a terrain model:
   - **Morningside Heights**: Columbia, from Broadway to Morningside Park and its 30 m cliff. Refuge: Mount Sinai Morningside.
   - **Central Park, The Ramble**: woods, winding paths and the Lake. Refuge: the 81 St–Museum of Natural History subway.
   - **Lower Manhattan**: the crooked Financial District streets between 250 m towers. Refuge: NewYork-Presbyterian Lower Manhattan Hospital.
2. **Survival.** Several survivors at once, each with **warmth, stamina and a flashlight battery**. The cold comes from the recorded temperature and wind (wind chill on each cell, with shelter in the lee of buildings), the snow piles up hour by hour, and deep snow slows and soaks them. They remember **warm places** (warming centres, subway air, shop doorways) and **supply caches** (batteries, hand warmers, food), and **plan ahead**: before setting out for the refuge they estimate the heat they will lose on the way and warm up first if they would not make it. A night ends four ways: **reached the refuge, caught, froze, or lasted till dawn**.

On top of the real place, you are the **environment designer**: the city's emergency planner for one night, with a budget for warming centres, caches, plowed streets and barricades. Compare two variations side by side and choose (manual), or let designs **evolve over epochs** by the aggregate performance of the agents (automated).

## How it answers the final brief

| Requirement | In the simulation |
|---|---|
| Baseline simulation from a semantic model | [semantic-model.md](semantic-model.md): the place, the storm, the agents, their needs, the design. Open the page and press Start |
| ≥ 2 notions of **location** (frames of reference) | Grid cell; metres east/south of the map corner; longitude/latitude (WGS84); street ("W 113th St, near Amsterdam Av"); landmark-relative memory ("K4: 48 m E, 32 m S of W1"); elevation. Panel *Where they are* (`describeLocation`) |
| ≥ 2 notions of **distance**, each with its metric | Euclidean (2D and 3D), walking on the agent's own map, effort/cold (snow and wind exposure), acoustic (muffling by buildings, trees, terrain; carried downwind), expected heat loss. Panel *Where they are* |
| ≥ 2 kinds of **spatial agents** | The creature (explores, then hunts) and the survivors (1–5 per night) |
| Limited knowledge, scanning | Both see only a cone, blocked in 3D by buildings, trees and the rising ground, shortened by snowfall; each builds its own map (`src/sim/knowledge.js`) |
| **Spatial memory**: landmarks used later | Street corners, dead ends, warm places, caches, the refuge, sounds, catches. Survivors return to warm places and caches they saw; the creature patrols the landmarks where it heard or caught survivors on earlier nights, and sweeps remembered dead ends and warm places when it loses a trail |
| ≥ 1 **goal** and measurable **performance** per goal | Creature: map (coverage, metres) → catch (share caught). Survivors: reach the refuge (reached/dawn/froze/caught, time, warmth kept, caches used) |
| **Plan ahead** | Shortest routes on their own maps; survivors' heat budget before heading for the refuge; detours to warm places and caches; the creature's planned route to a sound |
| Physical vs abstract | Physical: real streets, buildings, terrain, weather |
| **Partial observability** | Cones of vision and hearing only; the creature's map starts empty; survivors know only the refuge's bearing |
| **Multi-agent**, agents consume space | One creature, several survivors; two survivors never share a cell |
| Dynamic / static (choice) | **Dynamic**: the weather changes every hour, the snow deepens, caches are taken |
| Deterministic / non-deterministic (choice) | **Non-deterministic** (seeded: the same seed replays exactly; designs are compared on the same seeds) |
| **Obstacles** | Buildings, tree trunks, bushes, rocks and cliffs, fences, water, barricades |
| **Hindrances and affordances** | Hindrances: deep snow, wind exposure, slopes and steps, street light (you are seen), dead ends. Affordances: warming centres, subway air, shop doorways, caches, plowed streets, the lee of buildings |
| **Primary function**: generate multiple environment options | *Environment designer*: edit by clicking; **manual** A/B ("choose your own adventure") with lineage; **automated** evolution with epochs × variations, a score chart and the best of each epoch; gallery; JSON export |
| **Secondary function**: real-world data, 3D + time | OpenStreetMap; NYC building footprints (roof height, ground elevation, in metres); Open-Meteo hourly weather (ERA5) for the storm, or tonight's live forecast; Copernicus DEM. Rendered in 3D at true scale |

## Running it

Open `index.html` through a web server (for example `python3 -m http.server` in this folder). Everything else runs in the browser; evaluations of designs run in Web Workers.

| Input | Action |
|---|---|
| Place, Night, Survivors | choose the real place, the night of the storm (or tonight's live weather) and how many survivors |
| Start | the creature starts mapping |
| Click the 3D view or either map | put a survivor there; it cries out and the creature plans its way to it |
| Skip mapping, +10 nights | finish phase 1 at once; play ten nights and show the overlays |
| Creature / Survivor / Whole place, V | camera |
| Show the real city, T | the whole city instead of only what the creature has seen |
| Space | pause |
| Environment designer | click the map with a tool (shift-click: vertical barricade), choose streets to plow, *Evaluate*, *Play this design above*, *Make two variations*, *Run* evolution, *Save to gallery*, *Download JSON* |

Add `?place=ramble` (or `morningside`, `fidi`) to open a place directly, `&seed=…` to change the seed, `&premapped` to skip phase 1.

Tests: `npm test`. Balance over all places: `npm run balance`. Refresh the real data: `npm run fetch-data` (needs network access to api.openstreetmap.org, data.cityofnewyork.us and the Open-Meteo APIs). Rebuild the preset gallery: `node tools/make_gallery.mjs`.

## The data

`data/<place>.json`, fetched by `tools/fetch_data.mjs`:

- **OpenStreetMap** (API 0.6 map call): streets and paths with names, parks, woods, scrub, water, rocks and cliffs, fences and hedges, trees, street lamps, shops, subway entrances, shelters, hospitals. © OpenStreetMap contributors, ODbL.
- **NYC Open Data, Building Footprints** (`5zhs-2jue`): footprint polygons with `height_roof` and `ground_elevation`, converted from feet to metres.
- **Open-Meteo historical weather** (ERA5 reanalysis), hourly, 22–24 January 2016: temperature, apparent temperature, snowfall, snow depth, wind speed, gusts and direction. ERA5 is coarse (about 25 km) and underestimates this storm's snow depth (Central Park recorded about 70 cm, 27.5 in; ERA5 gives about 28 cm), so the snow in the simulation is on the low side.
- **Open-Meteo elevation** (Copernicus DEM GLO-90), a 12 × 9 grid of samples, blended with the surveyed ground elevations of the buildings (samples on rooftops are dropped).
- **Live**: Open-Meteo forecast API, fetched in the browser when *Tonight* is chosen.

## Files

```
index.html, style.css      the page
semantic-model.md          the semantic model (deliverable 2)
data/                      the three places (generated), gallery.json (preset environments)
src/data/                  places.js (the places and the storm), load.js (loading, live weather)
src/sim/                   the simulation, no DOM, runs in Node and in workers
  city.js                  real data -> grid, buildings, terrain, street names, corners, frames of reference
  environment.js           the storm hour by hour, wind chill, shelter, snow depth, warm places
  knowledge.js             an agent's own map: vision, planning, frontiers, landmarks
  sim.js                   the creature, the survivors, their needs, nights
  design.js                environment designs: budget, random designs, mutation
  evaluate.js              scoring, evaluating a design, evolution
  worker.js                evaluates designs in a Web Worker
  los.js, world.js, rng.js 3D line of sight and sound, grid helpers, seeded random numbers
src/render/                three.js view of the city; plans of each agent's knowledge; design maps
src/ui/                    page wiring, the designer, synthesized sound
tools/                     fetch_data.mjs, make_gallery.mjs
tests/                     node:test suite, balance script
```

## Deliverables checklist

1. URL: https://yz5149-stack.github.io/spatial_ai_gsapp/20261116_final/
2. Semantic model: [semantic-model.md](semantic-model.md)
3. Diagrams of the requirements: screenshots of the panels listed in the table above (the *How it answers the brief* section of the page names each one)
4. Instruction-manual video: record choosing a place, Start, placing a survivor, then the designer: edit, Evaluate, *Make two variations*, choose, *Run* evolution
5. Demo video: an evolution run from the starting design to the evolved one, then *Play this design above*
6. Interesting environments: the **Gallery** tab (presets in `data/gallery.json`, plus whatever you save)
