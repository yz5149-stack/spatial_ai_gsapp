# Last Open Store

**Spatial AI (ARCH6956-1), Columbia GSAPP. Final project.**

Instructor: [William Martin](https://awmartin.xyz/spatial-computing/course/)

Group: **Ryan Fu, Lu Liu, Yifan Zhao**

A spatial simulation and environment-design tool, continuing the Frostroot series. A blizzard night in Morningside Heights, and one convenience store still has its lights on:

- **Survivors** come in from the snow with a shopping list.
- **A creature** has come in through the stockroom door. It maps the store, hunts by sound, and remembers.

The store itself is generated from a short genome. You are its designer: you edit it, compare variations of it, and evolve it, judged by how the agents do inside.

Semantic model: [SEMANTIC_MODEL.md](SEMANTIC_MODEL.md).

## Run it

Serve the folder, for example with `python3 -m http.server` in the repository root. Then open `/20261201_final/`.

- Tests: `npm test`
- An evolution in the terminal: `npm run evolve` (or `node tests/evolve-demo.mjs trap`)

## The views

| View | What you do |
|---|---|
| **The store · Watch** | The 3D store and its plan. Nights run one after another. Camera options: orbit, plan, follow the creature, follow a survivor. **+10 nights** fills the overlays: every survivor's path, and where survivors were heard and caught. |
| **The store · Play** | You are the first survivor in. WASD or arrows to move, Shift to run (loud), C to crouch (quiet, hidden behind 54″ shelves). Stand still beside a shelf on your list to take the item. Leave by the front door. |
| **Plan tools** | Inspect any spot: three locations, four distances to the creature. Edit the store: height, turn, stock, sign, add or remove gondolas and cartons, paint wet, dark, noisy or mat floor, move the doors. |
| **Tonight's conditions** | Pick a date and hour: the 2016 blizzard, a snowy dusk, a winter noon, or live. The sun angle and the weather change the night. |
| **Choose** | Two variations run side by side with identical survivors. Keep one; two more grow from it. The lineage is kept. |
| **Evolve** | Epochs of generated stores, scored by the agents' aggregate performance under a goal: *Safe haven*, *Creature's den* or *Thriller*. A chart shows best and mean per epoch, plus a gallery of each epoch's best store. |
| **How it works** | Every requirement and where it is met. |

## Files

```
index.html, style.css     the page
SEMANTIC_MODEL.md         the semantic model
src/sim/                  the simulation, no DOM, runs in Node
  config.js               every parameter (real heights in metres)
  store.js                genome → store; random stores; mutations; store addresses
  los.js                  3D line of sight and acoustic distance
  knowledge.js            an agent's own map, planning, frontiers, landmarks
  sim.js                  survivors, the creature, nights, metrics, distances
  light.js                sun position, daylight through the glass, weather → conditions
  evolve.js               scoring stores, goals, the evolution loop
src/render/scene3d.js     three.js: the store, the street, the agents, the real sun
src/render/plan2d.js      plans, knowledge maps, heatmaps, thumbnails
src/ui/                   page logic, a web worker for experiments, weather fetch, sound
tests/                    node:test suite, an evolution demo
```

Built with three.js 0.160.0. Weather from [Open-Meteo](https://open-meteo.com/) (archive: ERA5). The creature, the store, the story and the sound are original to this project.
