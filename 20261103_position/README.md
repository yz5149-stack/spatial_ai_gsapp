# Frostroot: Night Run

**Spatial AI (ARCH6956-1), Columbia GSAPP. Assignment: Workshop, Position + Movement.**

Instructor: [William Martin](https://awmartin.xyz/spatial-computing/course/)

Group: **Ryan Fu, Lu Liu, Yifan Zhao**

A playable night escape in a snowy forest, built on last week's [Misty Forest Chase](../20261022_distance/). You find a vaccine case and carry it to the hospital door on the east side while a creature made of roots hunts you. Every rule of the game is a preposition of place or movement: you hide *up in a tree* (above it), slip *behind* and *past* it, and it ambushes you by standing *between* you and the hospital.

Play: open `index.html` through a web server (for example `python3 -m http.server` in this folder). Tests: `npm test`. Balance: `npm run balance`. Made for a computer screen (16:9); on a phone, on-screen buttons appear.

## Controls

| Input | Action |
|---|---|
| Arrow keys / WASD, or click where to go | move (click a tree to walk to it and climb it) |
| Space | shoot, when it is close and in the clear: it freezes for 3 seconds |
| E | climb the tree next to you, or climb down |
| M / P | map view / pause |

Shooting and hiding are on different keys so one is never pressed for the other. Prompts at the bottom of the screen show what each key would do right now.

## Rules

- **Win:** reach the hospital door with the case: *You saved the world*.
- **Lose:** it reaches you (same or neighbouring cell, not while frozen and not while you are in a tree), or the night runs out after 6 minutes: *You became part of it*.
- **Trees:** up in a tree it cannot see you or catch you, even standing below. You can hold on for 7.5 seconds. The case's alarm still gives you away.
- **Sight** (Euclidean distance): it sees ahead in a 120° cone, 6 to 9 cells by difficulty, blocked by trees, bushes and rocks. You only see it within 9 cells with a clear line; otherwise the minimap shows a fading **?** where you last saw or heard it.
- **Hearing** (acoustic distance): your footsteps are heard within 7, shots within 20; you hear it move within 12.
- **The case alarm:** when you pick up the case it beeps for 6 seconds and it knows where you are.
- **Seeing it coming:** it glides at its real speed, and fades in out of the fog: first a faint shape with glowing eyes (up to 14 cells, with a clear line), then fully when you can see it (9 cells).
- **Fear:** synthesized sound (wind, a heartbeat that speeds up as it closes in, its creaking, a screech when it sees you), a red vignette, a flickering flashlight and camera shake when it is near, and a lunge when it gets you.
- **Difficulty:** its speed and sight, and your bullets (Easy 3, Normal 1, Hard 1). While the case beeps it rushes at you. With a scripted player (`src/sim/bot.js`, which only knows what a player could see and hear) the win rate is about **95% on Easy, 72% on Normal, 36% on Hard** (300 runs on 6 maps each).
- **It never stands still for long:** sounds and crows send it to a cell it can stand on, it gives up waiting in an ambush after 6 seconds, it circles the foot of your tree, and if it has not moved for 3.5 seconds while wandering it picks a new place to go (tested in `tests/escape.test.mjs`).

## Position (Part 1)

All rules live in [`src/sim/relations.js`](src/sim/relations.js) and are checked after every tick; thresholds in `config.relations`.

| Relation | Rule on the grid | Indicator |
|---|---|---|
| **In a tree (above / below)** | you are up in a tree; it is *below* when it is within 2 cells of your tree | double rings and ▲ IN THE TREE on the minimap, ▼ BELOW on it, IN A TREE chip |
| **Behind** | within 9 cells and more than 90° from where the other faces | rear half-disc shaded, BEHIND tag |
| **Adjacent** | no occupiable cell in between: one walking step without cutting a blocked corner | one yellow outline around both cells: you and the creature, the case, the hospital door, a crow's tree |
| **Between** | on the plan, it projects inside the segment from you to your goal (case, then door) and lies within 1.6 cells of it | dashed line crossed out at the creature, IN THE WAY tag |

Relations that involve the creature are only shown while you can see it.

## Position (Part 2): behaviours

- **(a) Placement → response.** *Hiding up a tree:* it never sees or catches you in a tree. *Ambush:* when the alarm stops and it has lost you while you carry the case, it goes to stand two thirds of the way along your shortest walk to the door, between you and the hospital.
- **(b) Intrinsic capability: crows.** Three crows perch in trees. When you are adjacent to a crow's tree it caws; it hears the caw within an acoustic distance of 16 and comes.

## Movement

| Movement | Rule | Indicator |
|---|---|---|
| **Toward / away** | the mover's path distance to the other, before and after its step | arrow on the minimap, solid toward, dashed away |
| **Up / down** | you climbed into a tree or down from it | ↑ UP / ↓ DOWN tag, arrow cone in 3D, a bar for how long you can hold on |
| **Around** | within 7 cells of the case, the bearing from it turned through 270° | the trail with an arrowhead, AROUND tag |
| **Past** | the gap fell to 4 cells or less and grew again while it never saw you | ring at the closest point, » PAST tag |

The page has a diagram for each relation and behaviour.

## The scene

A 44 × 28 grid on one level with a designed layout (`config.trail`): a winding trail runs from a broken-down car on the west side, headlights still on, to the hospital door in the middle of the east wall. Side paths lead to small clearings; the case lies in the one farthest from the hospital. The forest is dense away from the trail and thinner next to it, with lanterns along the trail, fallen logs (low: you can see over them), rocks, bushes and some dead trees, and no dead ends. The ground is a painted snow texture with the trodden trail, footprints, tyre tracks and shadows. Maps come from a seed; **New map** draws another. The creature, the case, the crows, the hospital, the look, the sound and the story are original to this project.

## The four distances (from last week, where they drove a police officer and a thief)

Positions are cell centres. An agent's eye point is 1.5 cells above the floor it stands on, and the canopy floor is 3 cells above the ground.

### 1. Euclidean distance (sight)

d<sub>E</sub>(a, b) = &radic;((x<sub>a</sub> &minus; x<sub>b</sub>)&sup2; + (y<sub>a</sub> &minus; y<sub>b</sub>)&sup2; + (z<sub>a</sub> &minus; z<sub>b</sub>)&sup2;)

An agent sees the other when:

- d<sub>E</sub> &le; 9 (the fog);
- the other is inside its forward cone: 120&deg; wide and &plusmn;60&deg; up and down. Vision only looks forward;
- the 3D segment between the eyes does not pass through a solid volume (tree, bush, rock, leaf clump, platform floor slab). Open air blocks nothing, so you can look down from a platform edge or up through a gap.

The line of sight is a 2D grid DDA (Amanatides & Woo) over the columns of the map. In each column it tests the exact height range the segment passes through against that column's solid intervals (`src/sim/los.js`).

### 2. Acoustic distance (hearing)

d<sub>A</sub>(a, b) = d<sub>E</sub>(a, b) + &Sigma;<sub>k</sub> m<sub>k</sub>

Sound travels along the same straight line as sight, but solids muffle it instead of stopping it. For every grid cell of solid material the line passes through, a muffling cost m<sub>k</sub> is added. The cost is in cells of open air that would make the sound just as faint: leaf clump +1, bush +1.5, tree +3, rock +6, platform floor +6 (`config.muffling`). Whenever an agent moves, the other hears it if d<sub>A</sub> &le; 12, and knows where the sound came from. A sneaking thief steps softly: its steps count as 5 cells farther away (`config.sneakQuietness`), so they are heard only within d<sub>A</sub> &le; 7. Running steps and the police's steps are heard at 12. Hearing works in every direction. Through open air d<sub>A</sub> = d<sub>E</sub>, so someone on a platform edge hears footsteps on the ground below (`acousticDistance` in `src/sim/los.js`).

### 3. Path distance (walking, the bonus)

d<sub>P</sub>(a, b) = the shortest walk from a to b. Step costs: 1 straight, &radic;2 diagonal, 3 for a ladder. A diagonal step may not cut the corner of an obstacle. It is computed with Dijkstra's algorithm over the walkable cells of both levels (`src/sim/paths.js`). Both AIs move along these shortest paths. The thief uses it to find escape cells that it reaches before the police.

### 4. Perceptual distance (visibility fingerprint)

From every walkable cell, 362 rays are cast in 3D: 72 directions (every 5&deg;) on five elevation rings (&minus;60&deg;, &minus;30&deg;, 0&deg;, +30&deg;, +60&deg;), plus straight up and straight down. Each ray stops at the first solid volume or at 9 cells. The vector of the 362 ray lengths is the cell's **visibility fingerprint**. It covers 360&deg; and does not depend on facing.

d<sub>V</sub>(a, b) = &radic;(&Sigma;<sub>i</sub> (r<sub>i</sub>(a) &minus; r<sub>i</sub>(b))&sup2;)

The fog cuts every ray at 9, so open places have similar fingerprints, while places inside the thicket all differ. The same cached rays draw the faint all-around view and the bright vision cone in the 3D view (`src/sim/rays.js`).

## Files

```
index.html, style.css        the game page (16:9 for a computer screen; touch buttons on phones)
src/sim/                     game core, no DOM, runs in Node
  config.js                  every parameter in one object (config.game, config.relations, config.crows)
  escape.js                  one run: you, the case, the hospital, shots, winning and losing
  creature.js                the creature's AI
  relations.js               position + movement relations, crows
  bot.js                     a scripted player for balancing and tests
  world.js, los.js, rays.js, paths.js, metrics.js, context.js   map, sight, hearing, paths (last week)
src/render/                  three.js night scene and the minimap
src/ui/                      input, game loop, HUD, panels and synthesized sound (audio.js)
tests/                       node:test suites and the balance script
```
