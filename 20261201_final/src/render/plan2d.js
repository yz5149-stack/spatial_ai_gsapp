// Top-down plans of a store, drawn on a canvas: the true store, what one agent knows, heatmaps of
// many nights, daylight. Also used small, as thumbnails, in the Choose and Evolve views.

import { T, Z, signCellsOf } from '../sim/store.js';
import { CATS, CAT_COLOR } from '../sim/config.js';

const COL = {
  bg: '#090c13', floor: '#1a1f2b', floorAlt: '#1d2330', wall: '#3a4252', glass: '#5ab8d8', door: '#5ff2c8', back: '#ff3b4e',
  tall: '#4a5468', low: '#2d3546', fridge: '#20384a', counter: '#7a5234', boxes: '#8b6a42',
  unknown: '#05070b', creature: '#ff3b4e',
};
const ZONE_FILL = { [Z.WET]: 'rgba(80,160,255,0.30)', [Z.DARK]: 'rgba(0,0,0,0.55)', [Z.NOISY]: 'rgba(255,170,80,0.22)', [Z.MAT]: 'rgba(90,200,140,0.22)' };

export function fitCanvas(canvas, world, maxW) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = maxW ?? canvas.clientWidth ?? 400;
  const s = w / world.W;
  canvas.width = Math.round(world.W * s * dpr); canvas.height = Math.round(world.H * s * dpr);
  canvas.style.aspectRatio = `${world.W} / ${world.H}`;
  return s * dpr;
}

// layer: 'truth' | 'creature' | 'survivor' | 'walk' | 'heard' | 'trails' | 'light'
export function drawPlan(canvas, world, { sim = null, layer = 'truth', survivorId = null, hover = -1, thumb = false, highlight = null } = {}) {
  const g = canvas.getContext('2d');
  const s = canvas.width / world.W;
  const { W, H, type, zone } = world;
  g.save();
  g.fillStyle = COL.bg; g.fillRect(0, 0, canvas.width, canvas.height);

  const k = layer === 'creature' && sim ? sim.creature.k
    : layer === 'survivor' && sim ? (sim.survivors.find((q) => q.id === survivorId) ?? sim.survivors.find((q) => q.cell >= 0) ?? sim.survivors[0])?.k : null;

  // floor and zones
  for (let i = 0; i < world.N; i++) {
    const x = (i % W) * s; const y = Math.floor(i / W) * s;
    const t = type[i];
    if (t === T.FLOOR || t === T.DOOR || t === T.BACK) {
      g.fillStyle = ((i % W) + Math.floor(i / W)) % 2 ? COL.floor : COL.floorAlt;
      g.fillRect(x, y, s + 0.5, s + 0.5);
      if (zone[i]) { g.fillStyle = ZONE_FILL[zone[i]]; g.fillRect(x, y, s + 0.5, s + 0.5); }
    }
  }
  // zone patterns
  if (!thumb) {
    for (const zz of world.genome.zones) {
      const x0 = zz.x * s; const y0 = zz.y * s; const ww = zz.w * s; const hh = zz.h * s;
      g.save(); g.beginPath(); g.rect(x0, y0, ww, hh); g.clip();
      if (zz.kind === 'wet') { g.strokeStyle = 'rgba(140,200,255,0.5)'; g.lineWidth = 1; for (let r = s * 0.6; r < Math.max(ww, hh); r += s * 0.8) { g.beginPath(); g.arc(x0 + ww / 2, y0 + hh / 2, r, 0, 7); g.stroke(); } }
      if (zz.kind === 'noisy') { g.fillStyle = 'rgba(255,190,120,0.7)'; for (let n = 0; n < zz.w * zz.h * 1.5; n++) { const a = Math.sin(n * 91.7 + zz.x) * 0.5 + 0.5; const b = Math.sin(n * 37.1 + zz.y) * 0.5 + 0.5; g.fillRect(x0 + a * ww, y0 + b * hh, s * 0.15, s * 0.15); } }
      if (zz.kind === 'mat') { g.strokeStyle = 'rgba(120,230,170,0.35)'; g.lineWidth = 1; for (let d = -hh; d < ww; d += s * 0.5) { g.beginPath(); g.moveTo(x0 + d, y0); g.lineTo(x0 + d + hh, y0 + hh); g.stroke(); } }
      if (zz.kind === 'dark') { const gr = g.createRadialGradient(x0 + ww / 2, y0 + hh / 2, 0, x0 + ww / 2, y0 + hh / 2, Math.max(ww, hh) * 0.7); gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x0, y0, ww, hh); }
      g.restore();
    }
  }

  // daylight layer: the sim's own sun calculation
  if (layer === 'light') {
    for (let i = 0; i < world.N; i++) {
      if (!world.walk[i]) continue;
      const x = (i % W) * s; const y = Math.floor(i / W) * s;
      const L = Math.min(1.4, world.light[i]);
      g.fillStyle = world.sunlit[i] ? `rgba(255,214,120,${0.35 + 0.35 * (L - 0.7)})` : `rgba(0,0,0,${Math.max(0, 0.75 - L) * 0.9})`;
      g.fillRect(x, y, s + 0.5, s + 0.5);
    }
  }

  // fixtures
  for (let i = 0; i < world.N; i++) {
    const t = type[i];
    if (t === T.FLOOR) continue;
    const x = (i % W) * s; const y = Math.floor(i / W) * s;
    if (t === T.WALL) { g.fillStyle = COL.wall; g.fillRect(x, y, s + 0.5, s + 0.5); }
    else if (t === T.GLASS) { g.fillStyle = COL.wall; g.fillRect(x, y + s * 0.35, s + 0.5, s * 0.3); g.fillStyle = COL.glass; g.fillRect(x, y + s * 0.42, s + 0.5, s * 0.16); }
    else if (t === T.DOOR) { g.fillStyle = COL.door; g.globalAlpha = 0.85; g.fillRect(x, y + s * 0.3, s + 0.5, s * 0.4); g.globalAlpha = 1; }
    else if (t === T.BACK) { g.fillStyle = COL.back; g.fillRect(x, y, s, s); }
    else if (t === T.FRIDGE) { g.fillStyle = COL.fridge; g.fillRect(x, y, s + 0.5, s + 0.5); g.fillStyle = 'rgba(120,210,255,0.8)'; g.fillRect(x + s * 0.15, y + s * 0.15, s * 0.7, s * 0.7); }
    else if (t === T.COUNTER) { g.fillStyle = COL.counter; g.fillRect(x, y, s + 0.5, s + 0.5); }
    else if (t === T.BOXES) { g.fillStyle = COL.boxes; g.fillRect(x + 0.5, y + 0.5, s - 1, s - 1); }
  }
  world.genome.runs.forEach((r, id) => {
    const x0 = r.x * s; const y0 = r.y * s;
    const ww = (r.dir === 'v' ? 2 : r.len) * s; const hh = (r.dir === 'v' ? r.len : 2) * s;
    const isHi = highlight && highlight.run === id;
    g.fillStyle = r.tall ? COL.tall : COL.low;
    g.beginPath(); g.roundRect(x0 + 0.5, y0 + 0.5, ww - 1, hh - 1, s * 0.25); g.fill();
    if (r.tall) { g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x0 + ww, y0 + s * 0.3, s * 0.35, hh); }
    // product stripes on both faces
    g.fillStyle = CAT_COLOR[r.cat];
    if (r.dir === 'v') { g.fillRect(x0 + 1, y0 + s * 0.2, s * 0.22, hh - s * 0.4); g.fillRect(x0 + ww - 1 - s * 0.22, y0 + s * 0.2, s * 0.22, hh - s * 0.4); }
    else { g.fillRect(x0 + s * 0.2, y0 + 1, ww - s * 0.4, s * 0.22); g.fillRect(x0 + s * 0.2, y0 + hh - 1 - s * 0.22, ww - s * 0.4, s * 0.22); }
    if (!r.tall) { g.strokeStyle = 'rgba(255,255,255,0.25)'; g.setLineDash([s * 0.3, s * 0.25]); g.lineWidth = 1; g.strokeRect(x0 + 1, y0 + 1, ww - 2, hh - 2); g.setLineDash([]); }
    if (isHi) { g.strokeStyle = '#fff'; g.lineWidth = 2; g.strokeRect(x0, y0, ww, hh); }
    if (!thumb) {
      g.fillStyle = 'rgba(230,236,245,0.85)'; g.font = `700 ${Math.max(9, s * 0.75)}px "Space Grotesk", system-ui`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(`G${id + 1}`, x0 + ww / 2, y0 + hh / 2);
      if (r.sign) {
        const [[sx, sy]] = signCellsOf(r);
        g.fillStyle = '#fff'; g.beginPath(); g.arc((sx + (r.dir === 'v' ? 1 : 0)) * s, (sy + (r.dir === 'v' ? 1 : 1)) * s, s * 0.3, 0, 7); g.fill();
        g.strokeStyle = CAT_COLOR[r.cat]; g.lineWidth = 2; g.stroke();
      }
    }
  });

  // what an agent knows: darken the unknown, show its trajectory
  if (k) {
    const color = layer === 'creature' ? '255,59,78' : '255,210,122';
    for (let i = 0; i < world.N; i++) {
      const x = (i % W) * s; const y = Math.floor(i / W) * s;
      if (k.known[i] === -1) { g.fillStyle = 'rgba(3,4,8,0.88)'; g.fillRect(x, y, s + 0.5, s + 0.5); }
      else if (k.visits[i]) { g.fillStyle = `rgba(${color},${Math.min(0.55, 0.12 + k.visits[i] * 0.04)})`; g.fillRect(x, y, s + 0.5, s + 0.5); }
      if (k.cat && k.cat[i] >= 0 && layer === 'survivor') { g.fillStyle = CAT_COLOR[CATS[k.cat[i]]]; g.fillRect(x + s * 0.3, y + s * 0.3, s * 0.4, s * 0.4); }
    }
    if (layer === 'creature' && sim) {
      let mx = 0; for (let i = 0; i < world.N; i++) mx = Math.max(mx, sim.creature.hunt[i]);
      if (mx > 0.5) for (let i = 0; i < world.N; i++) {
        const v = sim.creature.hunt[i] / mx; if (v < 0.15) continue;
        g.fillStyle = `rgba(255,60,40,${v * 0.5})`; g.fillRect((i % W) * s, Math.floor(i / W) * s, s + 0.5, s + 0.5);
      }
    }
    // landmarks
    for (const l of k.landmarks) {
      const x = (l.x + 0.5) * s; const y = (l.y + 0.5) * s;
      const c = { item: '#ffe08a', sign: '#ffffff', deadend: '#ff8a5a', hide: '#9a8cff', heard: '#ff6a5a', seen: '#ff3b4e', caught: '#ff2a3a', hunt: '#ff2a8a' }[l.kind] ?? '#ccc';
      g.fillStyle = c; g.beginPath(); g.moveTo(x, y); g.arc(x, y - s * 0.9, s * 0.45, Math.PI * 0.75, Math.PI * 2.25); g.closePath(); g.fill();
      g.fillStyle = '#0b0e14'; g.font = `700 ${Math.max(7, s * 0.5)}px system-ui`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(l.id.replace(/\d+$/, '') || '?', x, y - s * 0.9);
    }
  }

  // heatmaps of many nights
  if (sim && (layer === 'walk' || layer === 'heard')) {
    const src = layer === 'walk' ? sim.heat.walk : sim.heat.heard;
    let mx = 0; for (let i = 0; i < world.N; i++) mx = Math.max(mx, src[i]);
    if (mx > 0) for (let i = 0; i < world.N; i++) {
      if (!src[i]) continue;
      const v = Math.pow(src[i] / mx, 0.5);
      g.fillStyle = layer === 'walk' ? `rgba(255,${Math.round(220 - 120 * v)},90,${0.15 + 0.6 * v})` : `rgba(255,${Math.round(90 - 60 * v)},70,${0.15 + 0.65 * v})`;
      g.fillRect((i % W) * s, Math.floor(i / W) * s, s + 0.5, s + 0.5);
    }
    if (layer === 'heard') for (const c of sim.heat.caught) { g.fillStyle = '#ff2a3a'; g.font = `800 ${s * 1.1}px system-ui`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('×', ((c % W) + 0.5) * s, (Math.floor(c / W) + 0.5) * s); }
  }
  if (sim && layer === 'trails') {
    g.lineWidth = Math.max(1, s * 0.12); g.lineJoin = 'round';
    for (const [key, color] of [['escapedTrails', 'rgba(95,242,200,0.35)'], ['caughtTrails', 'rgba(255,59,78,0.4)']]) {
      g.strokeStyle = color;
      for (const tr of sim.heat[key]) {
        g.beginPath();
        tr.forEach((c, j) => { const x = ((c % W) + 0.5) * s; const y = (Math.floor(c / W) + 0.5) * s; if (j) g.lineTo(x, y); else g.moveTo(x, y); });
        g.stroke();
      }
    }
  }

  // agents
  if (sim && sim.phase === 'night' && !(thumb && !sim)) {
    const c = sim.creature;
    const drawCone = (cone, fill) => { if (!cone || cone.length < 3) return; g.fillStyle = fill; g.beginPath(); g.moveTo(cone[0][0] * s, cone[0][1] * s); for (const p of cone) g.lineTo(p[0] * s, p[1] * s); g.closePath(); g.fill(); };
    if (layer !== 'survivor') drawCone(c.k.lastCone, c.state === 'chase' ? 'rgba(255,40,40,0.28)' : 'rgba(255,40,40,0.16)');
    for (const sv of sim.survivors) if (sv.cell >= 0 && !sv.outcome && (layer !== 'survivor' || sv.k === k)) drawCone(sv.k.lastCone, hexA(sv.color, 0.14));
    // routes
    const route = (from, path, color) => {
      if (!path || !path.length) return;
      g.strokeStyle = color; g.lineWidth = Math.max(1, s * 0.12); g.setLineDash([s * 0.4, s * 0.3]);
      g.beginPath(); g.moveTo(((from % W) + 0.5) * s, (Math.floor(from / W) + 0.5) * s);
      for (const p of path) g.lineTo(((p % W) + 0.5) * s, (Math.floor(p / W) + 0.5) * s);
      g.stroke(); g.setLineDash([]);
    };
    if (!thumb) {
      if (layer !== 'survivor') route(c.cell, c.path, 'rgba(255,110,90,0.9)');
      for (const sv of sim.survivors) if (sv.cell >= 0 && !sv.outcome && (layer !== 'creature')) route(sv.cell, sv.path, hexA(sv.color, 0.85));
    }
    for (const sv of sim.survivors) {
      if (sv.cell < 0 || sv.outcome) continue;
      const x = ((sv.cell % W) + 0.5) * s; const y = (Math.floor(sv.cell / W) + 0.5) * s;
      g.fillStyle = sv.color; g.beginPath(); g.arc(x, y, s * (sv.crouch ? 0.42 : 0.55), 0, 7); g.fill();
      g.strokeStyle = '#0b0e14'; g.lineWidth = Math.max(1, s * 0.12); g.stroke();
      if (sv.human) { g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.arc(x, y, s * 0.85, 0, 7); g.stroke(); }
    }
    if (layer !== 'survivor') {
      const x = ((c.cell % W) + 0.5) * s; const y = (Math.floor(c.cell / W) + 0.5) * s;
      g.fillStyle = COL.creature; g.shadowColor = COL.creature; g.shadowBlur = s * 1.2;
      g.beginPath(); g.arc(x, y, s * 0.68, 0, 7); g.fill(); g.shadowBlur = 0;
      g.strokeStyle = '#ffd0c8'; g.lineWidth = Math.max(1, s * 0.12);
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(c.facing) * s * 1.1, y + Math.sin(c.facing) * s * 1.1); g.stroke();
    }
  }

  if (hover >= 0) {
    g.strokeStyle = '#fff'; g.lineWidth = 1.5;
    g.strokeRect((hover % W) * s + 0.5, Math.floor(hover / W) * s + 0.5, s - 1, s - 1);
  }
  g.restore();
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// Cell under a mouse event on a plan canvas
export function cellAt(canvas, world, ev) {
  const r = canvas.getBoundingClientRect();
  const x = Math.floor(((ev.clientX - r.left) / r.width) * world.W);
  const y = Math.floor(((ev.clientY - r.top) / r.height) * world.H);
  if (x < 0 || y < 0 || x >= world.W || y >= world.H) return -1;
  return y * world.W + x;
}
