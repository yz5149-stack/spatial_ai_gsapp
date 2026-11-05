# Frostroot: Agents

**Spatial AI (ARCH6956-1), Columbia GSAPP. Assignment: Workshop, Spatial Agents.**

Instructor: [William Martin](https://awmartin.xyz/spatial-computing/course/)

Group: **Ryan Fu, Lu Liu, Yifan Zhao**

Two kinds of spatial agents in a snowy maze-forest, seen from the creature's side. It builds on our [Position + Movement game](../20261103_position/).

- **Phase 1, the creature maps the forest.** It wakes in its lair knowing nothing. It explores with a red vision cone like a robot vacuum: always to the nearest edge of what it has seen, sweeping each corridor to its end. It leaves landmarks at dead ends, clearings and the hospital door. The phase ends when nothing is left unseen.
- **Phase 2, it hunts by sound.** A survivor appears at a random spot (or wherever you click). It knows nothing either, and explores east, where it was told the hospital is. The creature cannot see far, so it follows footsteps, planning the shortest route on the map it built, and checks the dead ends it remembers when it loses the trail. Rounds repeat; the creature keeps its memory.

Open `index.html` through a web server (for example `python3 -m http.server` in this folder). Tests: `npm test`. Balance: `npm run balance`.

## Controls

| Input | Action |
|---|---|
| Click the forest or either map | put the survivor there (after mapping). It cries out; the creature plans its way to it |
| 1× 2× 4× 8× | speed |
| Skip mapping | finish phase 1 at once |
| +20 rounds | run 20 hunt rounds at once and show the overlays |
| Whole forest / V | switch between the view behind the creature and the whole map |
| Space | pause |

## How it answers the assignment

| # | Requirement | In the simulation |
|---|---|---|
| 1 | Limited knowledge at spawn | Each agent knows only the 8 cells around it. Its map (`src/sim/knowledge.js`) starts unknown everywhere |
| 2 | A cone of vision | Creature: 100°, 8 cells (red). Survivor: 110°, 6 cells (flashlight). Rays stop at the first tree, bush or rock |
| 3 | Obstacles and other agents | Routes go only through ground the agent has seen. The survivor avoids cells near where it last saw or heard the creature, and runs from it |
| 4 | Goals and performance criteria | Creature, phase 1: map the forest, measured by coverage and cells seen per step. Phase 2: catch the survivor. Survivor: reach the hospital, measured by time and steps, without being caught |
| 5 | Mapping | Frontier exploration: walk to the nearest seen cell next to an unseen one, preferring what is ahead (so it finishes a corridor before turning, like a vacuum) |
| 6 | Landmarks | Dead end (closed on 3 sides), clearing (open on all sides), hospital door, footsteps heard, creature seen, catch. Each is stored relative to the landmark before it: "D3: 6 E, 4 S of C1" |
| 7 | Using landmarks | On a sound, the creature plans on its own map. When it loses the trail, it sweeps the dead ends it remembers within 10 cells. The survivor runs for the door once it has seen it, and never flees into a dead end it has marked |
| 8 | One agent's spatial knowledge | *The creature's map* and *The survivor's map*: seen / unseen ground, trajectory, landmarks, current route, vision cone |
| 9–10 | Many agents, in aggregate | Rounds repeat with new survivors. **+20 rounds** fills the overlays: every survivor's path (green escaped, red caught) and a heatmap of where survivors were heard |
| 11 | Video or screenshots | Use the page; the views are made for screen recording |

With the default settings the survivor is caught in about 57% of rounds (100 rounds on 4 maps, `npm run balance`).

## The map

A maze of 2-cell-wide snowy corridors between one-cell walls of pines, rocks and bushes (49 × 31 cells). It starts as a perfect maze, then 45% of the dead ends are opened into loops (`braid`), so there are both loops and real dead ends, plus a few clearings. The hospital door is in the middle of the east wall; the creature's lair is on the west side.

## Files

```
index.html, style.css     the page
src/sim/                  simulation, no DOM, runs in Node
  config.js               every parameter
  maze.js                 the maze-forest
  knowledge.js            an agent's own map: vision, planning, frontiers, landmarks
  sim.js                  the two agents, the phases and the rounds
  world.js, los.js        grid, line of sight and hearing (from earlier weeks)
src/render/               three.js view from the creature, and the two maps
src/ui/                   page wiring and synthesized sound
tests/                    node:test suite and the balance script
```
