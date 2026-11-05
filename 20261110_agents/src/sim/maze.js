// The map: a maze-like snowy forest with corridors, loops, dead ends and a few clearings.
// Maze cells are 2 x 2 snow cells separated by one-cell walls of pines, rocks and bushes.
// The hospital door is in the middle of the east wall; the creature's lair is on the west side.

import { makeRng } from './rng.js';
import { G, C, buildWorld, nodeId } from './world.js';

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export function generateMaze(config, seed = config.seed) {
  const rng = makeRng(seed);
  const cols = config.mazeCols;
  const rows = config.mazeRows;
  const W = 3 * cols + 1;
  const H = 3 * rows + 1;
  const ground = new Uint8Array(W * H).fill(G.TREE);
  const canopy = new Uint8Array(W * H).fill(C.AIR);
  const idx = (x, y) => y * W + x;
  const cellX = (i) => 1 + 3 * i; // left column of maze cell i
  const cellY = (j) => 1 + 3 * j;

  // open every maze cell (2 x 2)
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) ground[idx(cellX(i) + dx, cellY(j) + dy)] = G.FREE;
  }
  // open the wall between two neighbouring maze cells (2 cells long)
  const openWall = (i, j, di, dj) => {
    if (di) { const x = cellX(Math.max(i, i + di)) - 1; for (let dy = 0; dy < 2; dy++) ground[idx(x, cellY(j) + dy)] = G.FREE; }
    else { const y = cellY(Math.max(j, j + dj)) - 1; for (let dx = 0; dx < 2; dx++) ground[idx(cellX(i) + dx, y)] = G.FREE; }
  };
  const links = Array.from({ length: cols * rows }, () => new Set());
  const link = (i, j, di, dj) => {
    openWall(i, j, di, dj);
    links[j * cols + i].add(`${di},${dj}`);
    links[(j + dj) * cols + (i + di)].add(`${-di},${-dj}`);
  };

  // recursive backtracker: a perfect maze (one path between any two cells)
  const seen = new Uint8Array(cols * rows);
  const stack = [[rng.int(0, cols - 1), rng.int(0, rows - 1)]];
  seen[stack[0][1] * cols + stack[0][0]] = 1;
  while (stack.length) {
    const [i, j] = stack[stack.length - 1];
    const options = DIRS.filter(([di, dj]) => {
      const a = i + di; const b = j + dj;
      return a >= 0 && b >= 0 && a < cols && b < rows && !seen[b * cols + a];
    });
    if (!options.length) { stack.pop(); continue; }
    const [di, dj] = rng.pick(options);
    link(i, j, di, dj);
    seen[(j + dj) * cols + (i + di)] = 1;
    stack.push([i + di, j + dj]);
  }

  // braid: open some dead ends into loops, keep the rest
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    if (links[j * cols + i].size !== 1 || !rng.chance(config.braid)) continue;
    const options = DIRS.filter(([di, dj]) => {
      const a = i + di; const b = j + dj;
      return a >= 0 && b >= 0 && a < cols && b < rows && !links[j * cols + i].has(`${di},${dj}`);
    });
    if (options.length) { const [di, dj] = rng.pick(options); link(i, j, di, dj); }
  }

  // clearings: open a block of 2 x 2 maze cells (a 5 x 5 opening)
  const clearings = [];
  for (let k = 0, tries = 0; k < config.clearings && tries < 200; tries++) {
    const i = rng.int(1, cols - 3);
    const j = rng.int(0, rows - 2);
    if (clearings.some((c) => Math.abs(c.i - i) < 4 && Math.abs(c.j - j) < 3)) continue;
    for (let y = cellY(j); y < cellY(j) + 5; y++) for (let x = cellX(i); x < cellX(i) + 5; x++) ground[idx(x, y)] = G.FREE;
    for (const [a, b] of [[i, j], [i + 1, j], [i, j + 1], [i + 1, j + 1]]) links[b * cols + a].add('room');
    clearings.push({ i, j, x: cellX(i) + 2, y: cellY(j) + 2 });
    k++;
  }

  // wall materials: mostly pines, some rocks and bushes in small clusters; the outer wall
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = idx(x, y);
    if (x === 0 || y === 0 || x === W - 1 || y === H - 1) { ground[i] = G.WALL; continue; }
    if (ground[i] !== G.TREE) continue;
    const r = rng.next();
    if (r < config.rockShare) ground[i] = G.ROCK;
    else if (r < config.rockShare + config.bushShare) ground[i] = G.BUSH;
  }

  // the hospital door: the maze cell in the middle of the east side
  const jDoor = Math.floor(rows / 2);
  const doorY = cellY(jDoor);
  const door = idx(W - 2, doorY);
  // the creature's lair: a maze cell on the west side
  const jLair = rng.int(1, rows - 2);
  const lair = idx(cellX(0), cellY(jLair));

  const world = buildWorld(config, W, H, ground, canopy, [], seed);
  world.door = nodeId(world, 0, W - 2, doorY);
  world.doorCells = [door, door + W];
  world.lair = lair;
  world.clearings = clearings;
  world.maze = { cols, rows, links };
  return world;
}

// Is cell i open ground (not a tree, bush, rock or wall)?
export const isOpen = (world, i) => world.walk[i] === 1;
