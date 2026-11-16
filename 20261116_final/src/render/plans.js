// Plans of what each agent knows: its own map of the real place, its trajectory, its landmarks,
// its route and its vision cone. The creature's plan can also show what all rounds have in common.
// drawDesignMap draws a whole design (the truth, not an agent's knowledge) with evaluation traces.

import { G, S } from '../sim/city.js';

export const LM_STYLE = {
  start: { color: '#cfd6de', glyph: 'O' },
  deadend: { color: '#ff5a4a', glyph: 'D' },
  corner: { color: '#7fd1ff', glyph: 'K' },
  warm: { color: '#ff8a3a', glyph: 'W' },
  supply: { color: '#b6ff8a', glyph: 'U' },
  clearing: { color: '#7fd1ff', glyph: 'C' },
  exit: { color: '#7dff9a', glyph: 'H' },
  heard: { color: '#ffb347', glyph: '))' },
  seen: { color: '#ffd23f', glyph: '!' },
  caught: { color: '#ff2a2a', glyph: '†' },
  froze: { color: '#bfe6ff', glyph: '*' },
};
export const SURV_CSS = ['#ffd27a', '#7fe0ff', '#ff9ad5', '#b6ff8a', '#ffa36b', '#c8a2ff'];
export const RESULT_CSS = { escaped: '125, 255, 154', caught: '255, 90, 80', froze: '150, 210, 255', dawn: '255, 210, 122' };
const CACHE_CSS = { battery: '#7fd1ff', warmers: '#ff8a3a', food: '#9dff7a' };

// colour of one cell of the real place
function cellColor(world, i) {
  const g = world.ground[i];
  if (g === G.BLDG) { const h = Math.min(1, world.height[i] / 120); return `rgb(${38 + 40 * h}, ${46 + 40 * h}, ${58 + 44 * h})`; }
  if (g === G.TREE) return '#1f3a2a';
  if (g === G.BUSH) return '#2d4a35';
  if (g === G.ROCK) return '#5b626c';
  if (g === G.WATER) return '#1d3550';
  if (g === G.FENCE) return '#3a434f';
  if (g === G.BARRIER) return '#ff7a2a';
  if (world.plowed?.[i]) return '#7c8794';
  switch (world.surface[i]) {
    case S.AVENUE: return '#a3acb6';
    case S.STREET: return '#aeb7c1';
    case S.LAWN: return '#dce3ea';
    case S.WOODS: return '#c7d3cb';
    case S.PATH: return '#c2cbd4';
    case S.STEPS: return '#b0b8c2';
    default: return '#c8d0d8';
  }
}

function sizeCanvas(canvas, world) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth || 400;
  const cs = (w / world.W) * dpr;
  const W = Math.round(cs * world.W);
  const H = Math.round(cs * world.H);
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  canvas.style.aspectRatio = `${world.W} / ${world.H}`;
  return cs;
}

const cx = (world, n, cs) => ((n % world.W) + 0.5) * cs;
const cy = (world, n, cs) => (Math.floor(n / world.W) + 0.5) * cs;

function polyline(g, world, cs, cells) {
  g.beginPath();
  cells.forEach((n, j) => (j ? g.lineTo(cx(world, n, cs), cy(world, n, cs)) : g.moveTo(cx(world, n, cs), cy(world, n, cs))));
  g.stroke();
}

function arrow(g, world, cs, n, facing, color, big = false) {
  g.save();
  g.translate(cx(world, n, cs), cy(world, n, cs));
  g.rotate(facing);
  const k = (big ? 1.5 : 1.2);
  g.fillStyle = color;
  g.strokeStyle = '#05070a';
  g.lineWidth = Math.max(1, cs * 0.12);
  g.beginPath();
  g.moveTo(cs * 0.85 * k, 0); g.lineTo(-cs * 0.55 * k, cs * 0.5 * k); g.lineTo(-cs * 0.25 * k, 0); g.lineTo(-cs * 0.55 * k, -cs * 0.5 * k);
  g.closePath(); g.fill(); g.stroke();
  g.restore();
}

function marker(g, world, cs, cell, color, text) {
  const x = cx(world, cell, cs); const y = cy(world, cell, cs);
  g.fillStyle = color; g.strokeStyle = '#05070a'; g.lineWidth = Math.max(1, cs * 0.12);
  g.beginPath(); g.arc(x, y, cs * 0.85, 0, Math.PI * 2); g.fill(); g.stroke();
  if (text) {
    g.fillStyle = '#05070a'; g.font = `800 ${Math.round(cs * 0.9)}px system-ui, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, x, y + cs * 0.05);
  }
}

// The design elements, drawn on any plan
export function drawDesign(g, world, cs, design, { refuge = true, lair = true, known = null } = {}) {
  const ok = (cell) => !known || known[cell] !== -1;
  for (const b of design.barricades ?? []) {
    if (!ok(b.cell)) continue;
    const x = b.cell % world.W; const y = Math.floor(b.cell / world.W);
    g.fillStyle = '#ff7a2a';
    if (b.dir === 'h') g.fillRect((x - 1) * cs, y * cs, cs * 3, cs); else g.fillRect(x * cs, (y - 1) * cs, cs, cs * 3);
  }
  (world.caches ?? design.caches ?? []).forEach((c) => {
    if (c.taken || !ok(c.cell)) return;
    const x = cx(world, c.cell, cs); const y = cy(world, c.cell, cs);
    g.fillStyle = CACHE_CSS[c.type]; g.strokeStyle = '#05070a'; g.lineWidth = Math.max(1, cs * 0.12);
    g.fillRect(x - cs * 0.6, y - cs * 0.6, cs * 1.2, cs * 1.2); g.strokeRect(x - cs * 0.6, y - cs * 0.6, cs * 1.2, cs * 1.2);
  });
  (design.warming ?? []).forEach((c, k) => { if (ok(c)) marker(g, world, cs, c, '#ff8a3a', `${k + 1}`); });
  if (refuge && ok(world.door)) marker(g, world, cs, world.door, '#7dff9a', '+');
  if (lair) {
    const l = design.lair ?? world.lair;
    if (l != null) { g.strokeStyle = '#ff3b30'; g.lineWidth = Math.max(2, cs * 0.25); g.beginPath(); g.arc(cx(world, l, cs), cy(world, l, cs), cs * 1.2, 0, Math.PI * 2); g.stroke(); }
  }
}

export function makePlan(canvas, who) {
  let sim = null;
  let focus = 0;

  function draw(s, now, overlays = {}) {
    sim = s;
    const world = sim.world;
    const survivorIdx = Math.min(focus, sim.survivors.length - 1);
    const agent = who === 'creature' ? sim.creature : sim.survivors[survivorIdx];
    const cs = sizeCanvas(canvas, world);
    const g = canvas.getContext('2d');
    g.fillStyle = '#05070a';
    g.fillRect(0, 0, canvas.width, canvas.height);
    if (!agent) {
      g.fillStyle = '#8d99aa'; g.font = `${Math.round(13 * Math.min(window.devicePixelRatio || 1, 2))}px system-ui, sans-serif`; g.textAlign = 'center';
      g.fillText('No survivors yet: the creature is still mapping the neighbourhood.', canvas.width / 2, canvas.height / 2);
      return;
    }
    const color = who === 'creature' ? '#ff3b30' : SURV_CSS[survivorIdx % SURV_CSS.length];
    const trailRgb = who === 'creature' ? '255, 59, 48' : '255, 210, 122';
    const { W, N } = world;
    const k = agent.k;
    for (let i = 0; i < N; i++) {
      if (k.known[i] === -1) continue;
      g.fillStyle = cellColor(world, i);
      g.fillRect((i % W) * cs, Math.floor(i / W) * cs, cs + 0.5, cs + 0.5);
      if (world.lit[i] && world.walk[i]) { g.fillStyle = 'rgba(255, 190, 110, 0.16)'; g.fillRect((i % W) * cs, Math.floor(i / W) * cs, cs + 0.5, cs + 0.5); }
      if (k.visits[i]) { g.fillStyle = `rgba(${trailRgb}, ${Math.min(0.45, 0.1 + 0.06 * k.visits[i])})`; g.fillRect((i % W) * cs, Math.floor(i / W) * cs, cs + 0.5, cs + 0.5); }
      const age = sim.step - k.seenAt[i];
      if (age >= 0 && age < 6) { g.fillStyle = `rgba(${trailRgb}, ${0.45 * (1 - age / 6)})`; g.fillRect((i % W) * cs, Math.floor(i / W) * cs, cs + 0.5, cs + 0.5); }
    }
    if (who === 'creature') {
      if (overlays.heat) {
        let max = 1;
        for (const v of sim.heardHeat) if (v > max) max = v;
        for (let i = 0; i < N; i++) {
          const v = sim.heardHeat[i];
          if (!v) continue;
          const t = v / max;
          g.fillStyle = `rgba(255, ${Math.round(200 - 160 * t)}, 40, ${0.25 + 0.6 * t})`;
          g.beginPath(); g.arc(cx(world, i, cs), cy(world, i, cs), cs * (0.6 + 1.1 * t), 0, Math.PI * 2); g.fill();
        }
      }
      if (overlays.paths) {
        g.lineWidth = Math.max(1, cs * 0.18); g.lineJoin = 'round';
        for (const o of sim.outcomes.slice(-60)) { g.strokeStyle = `rgba(${RESULT_CSS[o.result]}, 0.4)`; polyline(g, world, cs, o.trail); }
        for (const o of sim.outcomes.slice(-60)) marker(g, world, cs, o.end, `rgb(${RESULT_CSS[o.result]})`, o.result === 'caught' ? '×' : o.result === 'froze' ? '*' : '');
      }
    }
    drawDesign(g, world, cs, sim.design, { lair: who === 'creature', known: k.known });
    // the trajectory
    const trail = k.trail.slice(-300);
    g.lineWidth = Math.max(1, cs * 0.16); g.lineJoin = 'round';
    for (let j = 1; j < trail.length; j++) {
      g.strokeStyle = `rgba(${trailRgb}, ${0.15 + 0.85 * (j / trail.length)})`;
      g.beginPath(); g.moveTo(cx(world, trail[j - 1], cs), cy(world, trail[j - 1], cs)); g.lineTo(cx(world, trail[j], cs), cy(world, trail[j], cs)); g.stroke();
    }
    // its planned route, on its own map
    if (agent.path && agent.path.length > 1) {
      g.strokeStyle = color; g.lineWidth = Math.max(1, cs * 0.16);
      g.setLineDash([cs * 0.45, cs * 0.3]);
      polyline(g, world, cs, agent.path);
      g.setLineDash([]);
    }
    // landmarks
    for (const l of k.landmarks) {
      if (l.kind === 'warm' && l.data?.type === 'doorway') continue;
      if (l.kind === 'supply' && l.data?.used) continue;
      const st = LM_STYLE[l.kind] ?? LM_STYLE.start;
      const x = (l.x + 0.5) * cs; const y = (l.y + 0.5) * cs;
      g.fillStyle = st.color; g.strokeStyle = '#05070a'; g.lineWidth = Math.max(1, cs * 0.1);
      g.beginPath(); g.arc(x, y, cs * 0.75, 0, Math.PI * 2); g.fill(); g.stroke();
      g.fillStyle = '#05070a'; g.font = `700 ${Math.round(cs * 0.7)}px system-ui, sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(l.id.length > 3 ? st.glyph : l.id, x, y + cs * 0.04);
    }
    // the vision cone
    if (k.lastCone && k.lastCone.length > 2 && sim.phase !== 'pause' && (who === 'creature' || agent.active)) {
      g.fillStyle = who === 'creature' ? 'rgba(255, 40, 30, 0.26)' : 'rgba(255, 235, 180, 0.3)';
      g.beginPath();
      k.lastCone.forEach(([x, y], j) => (j ? g.lineTo(x * cs, y * cs) : g.moveTo(x * cs, y * cs)));
      g.closePath(); g.fill();
    }
    // the other agents, only where this one knows they are
    if (who === 'creature' && sim.phase !== 'explore') {
      sim.survivors.forEach((s, j) => { if (s.active && (sim.creature.seesSurvivor && sim.creature.quarry === s.id)) arrow(g, world, cs, s.node, s.facing, SURV_CSS[j % SURV_CSS.length]); });
      for (const snd of sim.sounds) if (snd.heard) { g.strokeStyle = '#ffb347'; g.lineWidth = Math.max(1.5, cs * 0.15); g.beginPath(); g.arc(cx(world, snd.node, cs), cy(world, snd.node, cs), cs * (1 + ((now / 400) % 1) * 2), 0, Math.PI * 2); g.stroke(); }
    }
    if (who === 'survivor' && agent.active) {
      const c = sim.creature;
      if (agent.sees) arrow(g, world, cs, c.node, c.facing, '#ff3b30');
      else if (agent.threatAt !== null && sim.step - agent.threatStep < 30) {
        g.fillStyle = '#ff3b30'; g.font = `800 ${Math.round(cs * 1.6)}px system-ui, sans-serif`;
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText('?', cx(world, agent.threatAt, cs), cy(world, agent.threatAt, cs));
      }
    }
    if (who === 'creature' || agent.active || sim.phase === 'pause') arrow(g, world, cs, agent.node, agent.facing, color, true);
  }

  function cellAt(clientX, clientY) {
    if (!sim) return null;
    const r = canvas.getBoundingClientRect();
    const x = Math.floor(((clientX - r.left) / r.width) * sim.world.W);
    const y = Math.floor(((clientY - r.top) / r.height) * sim.world.H);
    if (x < 0 || y < 0 || x >= sim.world.W || y >= sim.world.H) return null;
    return y * sim.world.W + x;
  }

  return { draw, cellAt, setFocus(k) { focus = k; } };
}

// A whole design on the real place (the truth), with the result of an evaluation if there is one:
// every survivor's path, coloured by how its night ended, over a heatmap of where they walked.
export function drawDesignMap(canvas, world, design, result = null, { heat = true } = {}) {
  const cs = sizeCanvas(canvas, world);
  const g = canvas.getContext('2d');
  g.fillStyle = '#05070a';
  g.fillRect(0, 0, canvas.width, canvas.height);
  const { W, N } = world;
  for (let i = 0; i < N; i++) {
    g.fillStyle = cellColor(world, i);
    g.fillRect((i % W) * cs, Math.floor(i / W) * cs, cs + 0.5, cs + 0.5);
  }
  if (result) {
    if (heat && result.heat) {
      let max = 1;
      for (const v of result.heat) if (v > max) max = v;
      for (let i = 0; i < N; i++) {
        const v = result.heat[i];
        if (!v) continue;
        g.fillStyle = `rgba(255, 220, 120, ${Math.min(0.55, 0.08 + 0.5 * (v / max))})`;
        g.fillRect((i % W) * cs, Math.floor(i / W) * cs, cs + 0.5, cs + 0.5);
      }
    }
    g.lineWidth = Math.max(1, cs * 0.16); g.lineJoin = 'round';
    for (const t of result.traces) { g.strokeStyle = `rgba(${RESULT_CSS[t.result]}, 0.55)`; polyline(g, world, cs, t.trail); }
    for (const t of result.traces) {
      const x = cx(world, t.end, cs); const y = cy(world, t.end, cs);
      g.fillStyle = `rgb(${RESULT_CSS[t.result]})`;
      g.beginPath(); g.arc(x, y, cs * 0.6, 0, Math.PI * 2); g.fill();
    }
  }
  drawDesign(g, world, cs, design);
  return cs;
}

export function cellFromEvent(canvas, world, e) {
  const r = canvas.getBoundingClientRect();
  const x = Math.floor(((e.clientX - r.left) / r.width) * world.W);
  const y = Math.floor(((e.clientY - r.top) / r.height) * world.H);
  if (x < 0 || y < 0 || x >= world.W || y >= world.H) return null;
  return y * world.W + x;
}
