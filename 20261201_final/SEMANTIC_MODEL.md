# Semantic model: Last Open Store

A blizzard night in Morningside Heights. One convenience store still has its lights on. Survivors come in from the snow for supplies; a creature has come in through the stockroom door before them. The store is the environment, and the designer's job is to arrange it.

## 1. The environment

| Concept | Definition | In code |
|---|---|---|
| **Store** | An 18 × 13 m room (about 2,500 sq ft) on a 0.5 m grid of 36 × 26 cells. Walls on three sides, a glass storefront facing south onto the street. | `src/sim/store.js` `buildStore` |
| **Genome** | The short description a store is built from. It is what the designer edits, what a variation changes, and what evolution breeds. | `genome = { door, back, counter, fridge, runs, boxes, zones }` |
| **Front door** | 1.5 m wide, in the storefront. Survivors enter and leave here. | `genome.door` |
| **Stockroom door** | On the back or a side wall. The creature enters here each night. | `genome.back = { side, pos }` |
| **Gondola** (run) | A double-sided shelf, 1 m deep, 1.5 to 9 m long, running north-south or east-west, 54″ (1.37 m) or 72″ (1.83 m) high, stocking one product, with or without an aisle sign. | `{ x, y, len, dir, tall, cat, sign }` |
| **Coolers** | Reach-in coolers (2.03 m) along one wall. They hold water. | `genome.fridge` |
| **Counter** | Checkout counter (1.02 m) beside the door. Medicine is behind it. | `genome.counter` |
| **Cartons** | 1 × 1 m stacks, 1.2 m high: an obstacle you can see over. | `genome.boxes` |
| **Floor zones** | Rectangles of wet floor, lights out, crushed bags, or rubber mat. | `genome.zones` |

Each cell has a **type**, a **floor zone**, a **product category** (for shelf cells), a **light level**, and a list of **solid vertical intervals** `[bottom, top, material]` for 3D sight and sound.

### Environment properties

- **Physical**: real dimensions and heights.
- **Partially observable**: agents see only along their vision cones, blocked by anything taller than their eyes.
- **Multi-agent**: up to five survivors and one creature at a time. Survivors occupy cells and block each other.
- **Dynamic**: agents move. The sun moves with the chosen hour.
- **Non-deterministic**: arrivals, shopping lists and slips on wet floor are random. Each run uses a seed, so a comparison can replay the same night exactly.

### Obstacles, hindrances and affordances

| Kind | Region | Effect |
|---|---|---|
| Obstacle | Gondolas, coolers, counter, cartons, walls | Block walking. Block sight if taller than the eye. Muffle sound if they cross the line between ears. |
| Hindrance | **Wet floor** | Speed × 0.55. 12% chance per step (24% running) of a slip: loud noise and 1.2 s lost. |
| Hindrance | **Crushed bags** | Footsteps +50% louder. |
| Hindrance / affordance | **Lights out** | Light 12%: agents see into it only up close. Bad for finding items, good for hiding. |
| Affordance | **Rubber mat** | Footsteps 50% quieter, speed × 1.08. |
| Affordance | **Aisle sign** | Readable from 6 m. The survivor learns the whole gondola's place and product at once. |
| Affordance | **Daylight** | Cells in direct sun are brighter, so agents see farther into them. |

## 2. Locations: three frames of reference

Every occupant has a location in each frame. Hover over the plan to see all three.

1. **Metric (world frame)**: x and y in metres from the store's north-west corner, plus height z for eyes, heads and shelf tops.
2. **Store address (the store's own frame)**: how staff would say it. *"G3 · west face · bay 2"* for a shelf, *"Aisle beside G3 (batteries)"*, *"Cooler aisle"*, *"Register"*, *"Entrance"*, *"Back cross-aisle"* for floor (`addresses()` in `store.js`).
3. **Relative to an agent's landmarks (the agent's frame)**: each landmark is stored as an offset from the one the agent made before, the way you give directions: *"D2: 2 m E, 1.5 m N of I1"* (`addLandmark()` in `knowledge.js`).

## 3. Distances: each with its own metric

| Distance | Metric | Used for |
|---|---|---|
| **Straight line** | 3D Euclidean between eye points | Vision range |
| **Walking path** | Dijkstra over walkable cells, 8 directions, no corner cutting (1 or √2 per step × 0.5 m) | All route planning |
| **Acoustic** | Straight 3D line + muffling for each cell of material it passes through (cooler 6, tall gondola 4, low gondola 2, counter 2, cartons 2, glass 10, wall 60 cells of open air). A line at ear height passes over a 54″ gondola, so it is not muffled. | Hearing: a step is heard if acoustic distance ≤ hearing range × loudness |
| **Effort** | Walking time in seconds, where wet floor counts 1/0.55 and mats 1/1.08 | Survivors' route costs |

## 4. Agents

### Survivor (up to five per night)

- **Knows at the start**: only the cells around the door.
- **Senses**: a flashlight cone (120°, 5.5 m in full light, shorter in the dark). Eye at 1.6 m standing, 0.95 m crouching. Reads products within 3 m and aisle signs within 6 m. Hears the creature move within an acoustic distance of about 5 m.
- **Memory (landmarks)**: items found, aisle signs read, dead ends, dark corners, where it hid, where it saw the creature.
- **Goal**: collect its shopping list (2–3 of water, food, medicine, batteries, hand warmers) and leave by the front door.
- **Planning ahead**: tries every order of the list items it knows the places of, plus the walk out, and takes the shortest. With nothing known, it explores the nearest frontier, preferring what is ahead. Its costs avoid wet and noisy floor it has seen, and the area around where it last knew the creature to be.
- **When frightened**: picks a refuge it can reach well before the creature, preferring the dark, hidden from the creature at crouching height, and not in a dead end it knows. With at least one item and the door clearly closer to it than to the creature, it runs out instead.
- **Performance**: escaped (yes/no), items collected, time inside, metres walked, seconds seen by the creature.

### Creature (one)

- **Knows at the start**: nothing. It keeps its map and its memory from night to night.
- **Senses**: a vision cone (110°, 6 m in full light), eye at 1.75 m, so it sees over 54″ gondolas. Hearing in all directions, about 6.5 m for a running step, less in wind.
- **Memory (landmarks)**: dead ends, dark corners, footsteps heard, catches, and **hunting grounds**: a map of where it has heard and caught survivors, fading 20% a night.
- **Goal**: catch survivors before they leave.
- **Planning ahead**: on a sound, it plans the shortest route on its own map. When it loses the trail it plans a sweep of the remembered hiding places and dead ends nearby. Once the store is mapped, it plans a patrol through its three strongest hunting grounds.
- **Performance**: catch rate, time to first catch, metres walked, map coverage, and *learning*: catch rate in later nights minus earlier nights.

## 5. Real-world data: three dimensions + time

- **Place**: a south-facing storefront in Morningside Heights, Manhattan (40.8075° N, 73.9626° W).
- **Sun**: the solar position for the chosen hour (NOAA low-precision formulas). For every floor cell, a ray is cast toward the sun. The cell is lit only if the ray leaves through the glazing between the 0.45 m sill and 2.45 m head, without hitting a shelf on the way.
- **Weather**: hourly temperature, snowfall, wind and cloud from the Open-Meteo archive (ERA5) for a past date, such as the blizzard of 23 January 2016, or the live forecast.
  - Snowfall sets how many survivors come in.
  - Wind masks sound, so the creature hears less far.
  - Cold puts hand warmers on every list.
  - Cloud dims the direct sun.

## 6. The environment designer

- **Edit**: change any gondola's height, direction or stock. Add or remove gondolas, cartons, signs and floor zones. Move either door. Edits that would cut off a product or block the store are refused.
- **Choose (manual generation)**: two variations of the current store run side by side with identical survivors. Keep one, and two new variations grow from it. The lineage is kept.
- **Evolve (automated generation)**: a population of stores is scored by running nights and aggregating the agents' performance under a chosen goal. The best two are kept, the rest are mutations of the better half, plus one new random store. This repeats for N epochs.
  - **Safe haven**: survivors escape with their lists, quickly and unseen.
  - **Creature's den**: catches, early.
  - **Thriller**: half escape, after long exposure. A game designer's target.
