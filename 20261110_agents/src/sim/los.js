// 3D line of sight.
// The world is a grid of columns; each column holds a few solid vertical intervals
// (tree, bush, rock, platform slab, leaf clump). A ray walks the columns it crosses with a
// 2D DDA (Amanatides & Woo) and, inside each column, tests the exact height range it passes
// through against that column's solid intervals. The ground plane (z = 0) is solid too.

import { nodeXYL } from './world.js';

// Returns the distance along the unit direction (dx, dy, dz) at which the ray first hits
// something solid, or maxT if it travels maxT without hitting anything.
export function castRay(world, ox, oy, oz, dx, dy, dz, maxT) {
  const { W, H, solids } = world;
  let cx = Math.floor(ox);
  let cy = Math.floor(oy);
  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  const eps = 1e-12;
  let tMaxX = adx > eps ? (dx > 0 ? cx + 1 - ox : ox - cx) / adx : Infinity;
  let tMaxY = ady > eps ? (dy > 0 ? cy + 1 - oy : oy - cy) / ady : Infinity;
  const tDeltaX = adx > eps ? 1 / adx : Infinity;
  const tDeltaY = ady > eps ? 1 / ady : Infinity;
  const tGround = dz < -eps ? -oz / dz : Infinity;
  let t0 = 0;

  for (let guard = 0; guard < 4096; guard++) {
    if (cx < 0 || cy < 0 || cx >= W || cy >= H) return t0; // outside the map counts as solid
    const t1 = Math.min(tMaxX, tMaxY, maxT);
    let hit = tGround >= t0 && tGround <= t1 ? tGround : Infinity;
    for (const [lo, hi] of solids[cy * W + cx]) {
      let ta;
      let tb;
      if (Math.abs(dz) <= eps) {
        if (oz < lo || oz > hi) continue;
        ta = -Infinity;
        tb = Infinity;
      } else {
        ta = (lo - oz) / dz;
        tb = (hi - oz) / dz;
        if (ta > tb) [ta, tb] = [tb, ta];
      }
      const enter = Math.max(ta, t0);
      if (enter <= Math.min(tb, t1) && enter < hit) hit = enter;
    }
    if (hit !== Infinity) return Math.min(hit, maxT);
    if (t1 >= maxT) return maxT;
    if (tMaxX < tMaxY) { t0 = tMaxX; tMaxX += tDeltaX; cx += stepX; }
    else { t0 = tMaxY; tMaxY += tDeltaY; cy += stepY; }
  }
  return t0;
}

// Eye point of an agent standing on node n, in world units (x east, y south, z up).
export function eyePoint(world, n) {
  const { x, y, level } = nodeXYL(world, n);
  return [x + 0.5, y + 0.5, level * world.config.levelHeight + world.config.eyeHeight];
}

// Is the straight segment between two points free of solid volumes?
export function segmentClear(world, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-9) return true;
  const t = castRay(world, a[0], a[1], a[2], dx / len, dy / len, dz / len, len);
  return t >= len - 1e-6;
}

const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// Is direction (dx, dy, dz) inside a forward cone that faces `facing` (radians, in the x-y plane)?
export function inCone(config, facing, dx, dy, dz) {
  const horiz = Math.hypot(dx, dy);
  if (horiz < 1e-9) return false; // straight up or down is outside a +-60 degree cone
  const yaw = Math.abs(wrapAngle(Math.atan2(dy, dx) - facing));
  const pitch = Math.abs(Math.atan2(dz, horiz));
  const halfH = (config.coneHorizontalDeg / 2) * Math.PI / 180;
  const halfV = config.coneVerticalDeg * Math.PI / 180;
  return yaw <= halfH + 1e-9 && pitch <= halfV + 1e-9;
}

// Can an agent on node `from`, facing `facing`, see the agent on node `to`?
// Three tests: within the fog range (3D Euclidean), inside the forward cone, and an unblocked segment.
export function canSee(world, from, facing, to) {
  const a = eyePoint(world, from);
  const b = eyePoint(world, to);
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  const dist = Math.hypot(dx, dy, dz);
  const inRange = dist <= world.config.visionRange;
  const cone = inCone(world.config, facing, dx, dy, dz);
  const clear = inRange ? segmentClear(world, a, b) : false;
  return { visible: inRange && cone && clear, dist, inRange, inCone: cone, clear };
}

// Every solid volume the straight segment a -> b passes through, one entry per grid cell:
// { material, x, y, t } where t is the distance from a at which the segment enters it.
// Uses the same column walk as castRay, but keeps going instead of stopping at the first hit.
export function segmentCrossings(world, a, b) {
  const { W, H, solids } = world;
  const dx0 = b[0] - a[0];
  const dy0 = b[1] - a[1];
  const dz0 = b[2] - a[2];
  const len = Math.hypot(dx0, dy0, dz0);
  const out = [];
  if (len < 1e-9) return out;
  const [ox, oy, oz] = a;
  const dx = dx0 / len;
  const dy = dy0 / len;
  const dz = dz0 / len;
  const eps = 1e-12;
  let cx = Math.floor(ox);
  let cy = Math.floor(oy);
  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  let tMaxX = adx > eps ? (dx > 0 ? cx + 1 - ox : ox - cx) / adx : Infinity;
  let tMaxY = ady > eps ? (dy > 0 ? cy + 1 - oy : oy - cy) / ady : Infinity;
  const tDeltaX = adx > eps ? 1 / adx : Infinity;
  const tDeltaY = ady > eps ? 1 / ady : Infinity;
  let t0 = 0;
  for (let guard = 0; guard < 4096; guard++) {
    if (cx < 0 || cy < 0 || cx >= W || cy >= H) break;
    const t1 = Math.min(tMaxX, tMaxY, len);
    for (const [lo, hi, material] of solids[cy * W + cx]) {
      let ta = -Infinity;
      let tb = Infinity;
      if (Math.abs(dz) > eps) {
        ta = (lo - oz) / dz;
        tb = (hi - oz) / dz;
        if (ta > tb) [ta, tb] = [tb, ta];
      } else if (oz < lo || oz > hi) continue;
      const enter = Math.max(ta, t0);
      // ignore a segment that only grazes a corner or an edge
      if (Math.min(tb, t1) - enter > 1e-6) out.push({ material, x: cx, y: cy, t: enter });
    }
    if (t1 >= len) break;
    if (tMaxX < tMaxY) { t0 = tMaxX; tMaxX += tDeltaX; cx += stepX; }
    else { t0 = tMaxY; tMaxY += tDeltaY; cy += stepY; }
  }
  return out;
}

// Acoustic distance between two eye points: the straight-line distance plus the muffling of every
// cell of solid material the sound has to pass through (config.muffling).
export function acousticDistance(world, a, b) {
  const crossings = segmentCrossings(world, a, b);
  const m = world.config.muffling;
  let extra = 0;
  for (const c of crossings) extra += m[c.material] ?? 0;
  return { distance: Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) + extra, extra, crossings };
}
