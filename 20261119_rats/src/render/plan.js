// 2D plans on a canvas: the whole area (with a layer and every agent), small maps for comparing
// designs, and the "mind" of one agent (what it has seen, what it remembers, where it went).

import { G, S } from '../sim/city.js';

const COL = {
  rat: [255, 107, 61], insp: [71, 184, 255], food: [255, 211, 77], bin: [95, 211, 138], station: [197, 139, 255],
  real: [255, 61, 110], lightOn: [255, 243, 176], shedOld: [90, 200, 220], shedLight: [230, 245, 255],
};

// the base map, one pixel per cell
export function baseImage(city) {
  const { W, H, N } = city;
  const img = new ImageData(W, H);
  const d = img.data;
  for (let i = 0; i < N; i++) {
    let c;
    if (city.ground[i] === G.BLDG) { const h = Math.min(1, city.height[i] / 60); c = [255 - 60 * h, 255 - 60 * h, 252 - 58 * h]; }
    else if (city.ground[i] === G.WATER) c = [200, 220, 235];
    else if (!city.walk[i]) c = [232, 230, 224];
    else if (city.road[i]) c = [212, 214, 216];
    else if (city.surface[i] === S.LAWN || city.surface[i] === S.WOODS) c = [214, 228, 206];
    else if (city.surface[i] === S.YARD) c = [228, 234, 220];
    else if (city.wall[i]) c = [246, 245, 241];
    else c = [238, 237, 232];
    d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2]; d[i * 4 + 3] = 255;
  }
  return img;
}

function heatInto(img, values, color, gain = 1) {
  const d = img.data;
  let max = 0; for (let i = 0; i < values.length; i++) if (values[i] > max) max = values[i];
  if (!max) return;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]; if (!v) continue;
    const t = Math.min(1, Math.sqrt(v / max) * gain);
    d[i * 4] = d[i * 4] * (1 - t) + color[0] * t;
    d[i * 4 + 1] = d[i * 4 + 1] * (1 - t) + color[1] * t;
    d[i * 4 + 2] = d[i * 4 + 2] * (1 - t) + color[2] * t;
  }
}

// the layer the person chose, as values per cell
export function layerValues(sim, layer) {
  if (layer === 'activity') return { v: sim.tonight.some((x) => x > 0) ? sim.tonight : sim.activity, c: COL.rat, gain: 1.3 };
  if (layer === 'signs') return { v: sim.signs, c: [214, 170, 90], gain: 1.2 };
  if (layer === 'real') return { v: sim.city.real.map, c: COL.real, gain: 1 };
  if (layer === 'light') return { v: sim.light, c: COL.lightOn, gain: 0.7 };
  return null;
}

export function makePlan(canvas, city, scale = 2) {
  const base = baseImage(city);
  const off = document.createElement('canvas'); off.width = city.W; off.height = city.H;
  const offCtx = off.getContext('2d');
  canvas.width = city.W * scale; canvas.height = city.H * scale;
  const g = canvas.getContext('2d');
  let lastLayerAt = 0; let layerImg = null; let lastKey = '';

  function draw(sim, { layer = 'activity', selected = null, now = 0, hover = -1, designOnly = false } = {}) {
    const { W } = city;
    // the layer image is rebuilt twice a second
    const key = `${layer}|${sim.design?.name}`;
    if (!layerImg || now - lastLayerAt > 500 || key !== lastKey) {
      layerImg = new ImageData(new Uint8ClampedArray(base.data), city.W, city.H);
      const L = layerValues(sim, layer);
      if (L) heatInto(layerImg, L.v, L.c, L.gain);
      lastLayerAt = now; lastKey = key;
    }
    offCtx.putImageData(layerImg, 0, 0);
    g.imageSmoothingEnabled = false;
    g.drawImage(off, 0, 0, canvas.width, canvas.height);
    const s = scale;
    const px = (c) => (c % W + 0.5) * s; const py = (c) => (Math.floor(c / W) + 0.5) * s;
    // sheds
    for (const sh of sim.sheds) {
      if (sh.type === 'gone') continue;
      g.fillStyle = sh.type === 'old' ? 'rgba(90,200,220,0.9)' : 'rgba(63,167,196,0.35)';
      for (const c of sh.cells) g.fillRect((c % W) * s, Math.floor(c / W) * s, s, s);
    }
    // real reports
    if (layer === 'real') {
      for (const p of city.real.pts) { g.fillStyle = p.kind === '311' ? 'rgba(255,61,110,0.8)' : 'rgba(255,170,61,0.7)'; g.fillRect(px(p.cell) - 1, py(p.cell) - 1, 2, 2); }
    }
    if (designOnly) { drawDesignMarks(g, city, sim, s, px, py); return; }
    // food within reach now
    for (const src of sim.sources) {
      if (src.amt > 0.05) { g.fillStyle = 'rgba(255,211,77,0.95)'; g.fillRect(px(src.cell) - 1.5, py(src.cell) - 1.5, 3, 3); }
      else if (src.binned && src.isOut) { g.fillStyle = 'rgba(95,211,138,0.7)'; g.fillRect(px(src.cell) - 1, py(src.cell) - 1, 2, 2); }
    }
    // design: lights, sealed soil, stations
    g.strokeStyle = 'rgba(255,243,176,0.9)'; g.lineWidth = 1;
    for (const c of sim.design.lights) { g.beginPath(); g.arc(px(c), py(c), 3, 0, Math.PI * 2); g.stroke(); }
    g.fillStyle = 'rgba(160,160,160,0.9)';
    for (const c of sim.design.guards) g.fillRect(px(c) - 2, py(c) - 2, 4, 4);
    for (const st of sim.stations) { g.fillStyle = st.by === 'design' ? 'rgb(197,139,255)' : 'rgba(197,139,255,0.7)'; g.fillRect(px(st.cell) - 2, py(st.cell) - 2, 4, 4); }
    // burrows
    g.strokeStyle = 'rgba(255,90,60,0.9)'; g.lineWidth = 1.2;
    for (const col of sim.colonies) if (col.alive) { g.beginPath(); g.arc(px(col.home), py(col.home), 3.2, 0, Math.PI * 2); g.stroke(); }
    // rats
    for (const r of sim.rats) {
      if (!r.alive || r.mode === 'home') continue;
      g.fillStyle = r.deathAt >= 0 ? 'rgb(197,139,255)' : r.mode === 'flee' ? 'rgb(255,61,61)' : 'rgb(255,107,61)';
      g.fillRect(px(r.cell) - 1.5, py(r.cell) - 1.5, 3, 3);
    }
    // inspectors, with the beam of their flashlight
    for (const ins of sim.inspectors) {
      if (ins.mode === 'off' || ins.mode === 'done') continue;
      const C = sim.cfg.inspector; const half = (C.beamDeg * Math.PI) / 360;
      g.fillStyle = ins.mode === 'chase' ? 'rgba(255,211,77,0.45)' : 'rgba(255,243,176,0.22)';
      g.beginPath(); g.moveTo(px(ins.cell), py(ins.cell));
      g.arc(px(ins.cell), py(ins.cell), C.beam * s, ins.facing - half, ins.facing + half); g.closePath(); g.fill();
      g.fillStyle = 'rgb(71,184,255)'; g.strokeStyle = '#000';
      g.beginPath(); g.arc(px(ins.cell), py(ins.cell), 3.5, 0, Math.PI * 2); g.fill(); g.stroke();
    }
    // the selected agent: its route and itself
    if (selected) {
      const a = selected;
      if (a.path) {
        g.strokeStyle = a.kind === 'rat' ? 'rgba(255,200,170,0.9)' : 'rgba(170,220,255,0.9)'; g.lineWidth = 1.4; g.setLineDash([3, 2]);
        g.beginPath(); a.path.forEach((c, k) => (k ? g.lineTo(px(c), py(c)) : g.moveTo(px(c), py(c)))); g.stroke(); g.setLineDash([]);
      }
      g.strokeStyle = '#fff'; g.lineWidth = 1.5;
      g.beginPath(); g.arc(px(a.cell), py(a.cell), 6, 0, Math.PI * 2); g.stroke();
    }
    if (hover >= 0) { g.strokeStyle = 'rgba(255,255,255,0.7)'; g.strokeRect((hover % W) * s - 2, Math.floor(hover / W) * s - 2, s + 4, s + 4); }
  }

  function cellAt(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    const x = Math.floor(((clientX - r.left) / r.width) * city.W);
    const y = Math.floor(((clientY - r.top) / r.height) * city.H);
    if (x < 0 || y < 0 || x >= city.W || y >= city.H) return -1;
    return y * city.W + x;
  }

  return { draw, cellAt };
}

// the design's own things, large enough to read on the "What if" page
export const MARK = { station: '#7d5bb5', guard: '#2f9e62', light: '#e0a100', bin: '#2c3a52', shed: '#3fa7c4' };
function drawDesignMarks(g, city, sim, s, px, py) {
  const d = sim.design; const r = Math.max(4, s * 1.4);
  g.lineWidth = 1.5;
  // bins: every source whose trash is in a lidded bin
  for (const src of sim.sources) if (src.binned && src.kind !== 'basket') { g.fillStyle = MARK.bin; g.globalAlpha = 0.55; g.fillRect(px(src.cell) - r * 0.45, py(src.cell) - r * 0.45, r * 0.9, r * 0.9); }
  g.globalAlpha = 1;
  for (const c of d.guards) { g.fillStyle = MARK.guard; g.beginPath(); g.moveTo(px(c), py(c) - r); g.lineTo(px(c) + r, py(c)); g.lineTo(px(c), py(c) + r); g.lineTo(px(c) - r, py(c)); g.closePath(); g.fill(); }
  for (const c of d.lights) { g.fillStyle = 'rgba(224,161,0,0.25)'; g.beginPath(); g.arc(px(c), py(c), r * 2.6, 0, Math.PI * 2); g.fill(); g.fillStyle = MARK.light; g.beginPath(); g.arc(px(c), py(c), r * 0.8, 0, Math.PI * 2); g.fill(); }
  for (const c of d.stations) { g.fillStyle = MARK.station; g.strokeStyle = '#fff'; g.fillRect(px(c) - r, py(c) - r, r * 2, r * 2); g.strokeRect(px(c) - r, py(c) - r, r * 2, r * 2); }
}

// a small static map of a finished run: where rats went, burrows left, the design's things
export function thumbnail(city, run, { width = 360 } = {}) {
  const c = document.createElement('canvas');
  const img = new ImageData(new Uint8ClampedArray(baseImage(city).data), city.W, city.H);
  if (run.activity) heatInto(img, run.activity, COL.rat, 1.3);
  const off = document.createElement('canvas'); off.width = city.W; off.height = city.H; off.getContext('2d').putImageData(img, 0, 0);
  const s = width / city.W;
  c.width = width; c.height = Math.round(city.H * s);
  const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
  g.drawImage(off, 0, 0, c.width, c.height);
  const px = (cell) => ((cell % city.W) + 0.5) * s; const py = (cell) => (Math.floor(cell / city.W) + 0.5) * s;
  const d = run.design;
  if (d) {
    g.fillStyle = 'rgb(197,139,255)'; for (const cell of d.stations) g.fillRect(px(cell) - 2, py(cell) - 2, 4, 4);
    g.strokeStyle = 'rgba(255,243,176,0.9)'; for (const cell of d.lights) { g.beginPath(); g.arc(px(cell), py(cell), 3, 0, Math.PI * 2); g.stroke(); }
    g.fillStyle = 'rgba(170,170,170,0.9)'; for (const cell of d.guards) g.fillRect(px(cell) - 1.5, py(cell) - 1.5, 3, 3);
  }
  for (const h of run.burrows ?? []) { g.strokeStyle = 'rgba(255,90,60,0.9)'; g.beginPath(); g.arc(px(h), py(h), 3, 0, Math.PI * 2); g.stroke(); }
  return c;
}

// what one agent knows: its own map, its memories, its trail
export function drawMind(canvas, sim, a) {
  const city = sim.city; const W = city.W;
  const g = canvas.getContext('2d');
  canvas.width = 150; canvas.height = 150;
  g.fillStyle = '#efede7'; g.fillRect(0, 0, 150, 150);
  if (!a) return;
  // a window around the agent (rats) or the whole area (inspectors)
  const span = a.kind === 'rat' ? 64 : Math.max(city.W, city.H);
  const cx = a.kind === 'rat' ? a.home % W : city.W / 2; const cy = a.kind === 'rat' ? Math.floor(a.home / W) : city.H / 2;
  const x0 = Math.round(cx - span / 2); const y0 = Math.round(cy - span / 2);
  const s = 150 / span;
  const img = g.createImageData(150, 150);
  for (let py = 0; py < 150; py++) for (let px = 0; px < 150; px++) {
    const x = Math.floor(x0 + px / s); const y = Math.floor(y0 + py / s);
    const k = (py * 150 + px) * 4; img.data[k] = 239; img.data[k + 1] = 237; img.data[k + 2] = 231; img.data[k + 3] = 255;
    if (x < 0 || y < 0 || x >= W || y >= city.H) continue;
    const i = y * W + x;
    const known = a.known[i];
    if (!known) continue;
    const c = city.walk[i] ? (city.wall[i] ? [150, 152, 156] : [190, 192, 196]) : [90, 92, 98];
    img.data[k] = c[0]; img.data[k + 1] = c[1]; img.data[k + 2] = c[2];
  }
  g.putImageData(img, 0, 0);
  const tx = (cell) => ((cell % W) - x0 + 0.5) * s; const ty = (cell) => (Math.floor(cell / W) - y0 + 0.5) * s;
  // trail
  g.strokeStyle = a.kind === 'rat' ? 'rgba(255,107,61,0.8)' : 'rgba(71,184,255,0.8)'; g.lineWidth = 1;
  g.beginPath(); a.trail.forEach((c, k) => (k ? g.lineTo(tx(c), ty(c)) : g.moveTo(tx(c), ty(c)))); g.stroke();
  if (a.kind === 'rat') {
    for (const f of a.memFood) { g.fillStyle = 'rgb(255,211,77)'; g.beginPath(); g.arc(tx(f.cell), ty(f.cell), 3, 0, Math.PI * 2); g.fill(); }
    g.strokeStyle = 'rgb(255,90,60)'; g.lineWidth = 2; g.beginPath(); g.arc(tx(a.home), ty(a.home), 4, 0, Math.PI * 2); g.stroke();
  } else {
    for (const h of a.hotspots) { g.fillStyle = 'rgb(255,61,110)'; g.fillRect(tx(h.cell) - 2, ty(h.cell) - 2, 4, 4); }
  }
  g.fillStyle = '#fff'; g.beginPath(); g.arc(tx(a.cell), ty(a.cell), 2.5, 0, Math.PI * 2); g.fill();
}
