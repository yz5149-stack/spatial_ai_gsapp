// 3D sight and sound through the store.
// Each grid column holds a few solid vertical intervals [bottom, top, material] (in cells; one cell
// is 0.5 m). A ray walks the columns it crosses with a 2D DDA (Amanatides & Woo) and, inside each
// column, tests the height range it passes through against that column's solids.

const EPS = 1e-12;

// Distance along the unit direction (dx, dy, dz) to the first solid, or maxT.
export function castRay(world, ox, oy, oz, dx, dy, dz, maxT) {
  const { W, H, solids } = world;
  let cx = Math.floor(ox); let cy = Math.floor(oy);
  const stepX = dx > 0 ? 1 : -1; const stepY = dy > 0 ? 1 : -1;
  const adx = Math.abs(dx); const ady = Math.abs(dy);
  let tMaxX = adx > EPS ? (dx > 0 ? cx + 1 - ox : ox - cx) / adx : Infinity;
  let tMaxY = ady > EPS ? (dy > 0 ? cy + 1 - oy : oy - cy) / ady : Infinity;
  const tDX = adx > EPS ? 1 / adx : Infinity; const tDY = ady > EPS ? 1 / ady : Infinity;
  const tGround = dz < -EPS ? -oz / dz : Infinity;
  let t0 = 0;
  for (let guard = 0; guard < 2048; guard++) {
    if (cx < 0 || cy < 0 || cx >= W || cy >= H) return t0;
    const t1 = Math.min(tMaxX, tMaxY, maxT);
    let hit = tGround >= t0 && tGround <= t1 ? tGround : Infinity;
    for (const [lo, hi] of solids[cy * W + cx]) {
      let ta; let tb;
      if (Math.abs(dz) <= EPS) { if (oz < lo || oz > hi) continue; ta = -Infinity; tb = Infinity; }
      else { ta = (lo - oz) / dz; tb = (hi - oz) / dz; if (ta > tb) [ta, tb] = [tb, ta]; }
      const enter = Math.max(ta, t0);
      if (enter <= Math.min(tb, t1) && enter < hit) hit = enter;
    }
    if (hit !== Infinity) return Math.min(hit, maxT);
    if (t1 >= maxT) return maxT;
    if (tMaxX < tMaxY) { t0 = tMaxX; tMaxX += tDX; cx += stepX; } else { t0 = tMaxY; tMaxY += tDY; cy += stepY; }
  }
  return t0;
}

export function segmentClear(world, a, b, ignoreGlass = false) {
  const dx = b[0] - a[0]; const dy = b[1] - a[1]; const dz = b[2] - a[2];
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-9) return true;
  if (!ignoreGlass) return castRay(world, a[0], a[1], a[2], dx / len, dy / len, dz / len, len) >= len - 1e-6;
  return segmentCrossings(world, a, b).every((c) => c.material === 'glass');
}

// Every solid the segment a -> b passes through, one entry per cell: { material, x, y, t }
export function segmentCrossings(world, a, b) {
  const { W, H, solids } = world;
  const dx0 = b[0] - a[0]; const dy0 = b[1] - a[1]; const dz0 = b[2] - a[2];
  const len = Math.hypot(dx0, dy0, dz0);
  const out = [];
  if (len < 1e-9) return out;
  const [ox, oy, oz] = a;
  const dx = dx0 / len; const dy = dy0 / len; const dz = dz0 / len;
  let cx = Math.floor(ox); let cy = Math.floor(oy);
  const stepX = dx > 0 ? 1 : -1; const stepY = dy > 0 ? 1 : -1;
  const adx = Math.abs(dx); const ady = Math.abs(dy);
  let tMaxX = adx > EPS ? (dx > 0 ? cx + 1 - ox : ox - cx) / adx : Infinity;
  let tMaxY = ady > EPS ? (dy > 0 ? cy + 1 - oy : oy - cy) / ady : Infinity;
  const tDX = adx > EPS ? 1 / adx : Infinity; const tDY = ady > EPS ? 1 / ady : Infinity;
  let t0 = 0;
  for (let guard = 0; guard < 2048; guard++) {
    if (cx < 0 || cy < 0 || cx >= W || cy >= H) break;
    const t1 = Math.min(tMaxX, tMaxY, len);
    for (const [lo, hi, material] of solids[cy * W + cx]) {
      let ta = -Infinity; let tb = Infinity;
      if (Math.abs(dz) > EPS) { ta = (lo - oz) / dz; tb = (hi - oz) / dz; if (ta > tb) [ta, tb] = [tb, ta]; }
      else if (oz < lo || oz > hi) continue;
      const enter = Math.max(ta, t0);
      if (Math.min(tb, t1) - enter > 1e-6) out.push({ material, x: cx, y: cy, t: enter });
    }
    if (t1 >= len) break;
    if (tMaxX < tMaxY) { t0 = tMaxX; tMaxX += tDX; cx += stepX; } else { t0 = tMaxY; tMaxY += tDY; cy += stepY; }
  }
  return out;
}

// Distance 2 · acoustic: the straight 3D line plus the muffling of each cell of material on it.
export function acousticDistance(world, a, b) {
  const m = world.cfg.muffling;
  let extra = 0;
  for (const c of segmentCrossings(world, a, b)) extra += m[c.material] ?? 0;
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) + extra;
}

export const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// A point at height h (metres) above the centre of cell n, in cell units
export function point(world, n, hMetres) {
  return [(n % world.W) + 0.5, Math.floor(n / world.W) + 0.5, hMetres / 0.5];
}
