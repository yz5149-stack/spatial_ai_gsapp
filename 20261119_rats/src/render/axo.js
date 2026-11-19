// The place as an architectural axonometric drawing (three.js, orthographic camera): white building
// volumes with black edges and grey shade, the ground drawn by surface (roadway, sidewalk, lawn,
// yard), street names written on the streets, street trees. On it: rats (body, head, ears, tail,
// running), inspectors (people in hi-vis vests, walking, with the fan of their flashlight), trash
// bags and bins, bait stations, burrows, sidewalk sheds. Agents are drawn a little larger than life.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { layerValues } from './plan.js';
import { S, G } from '../sim/city.js';

const GRID_TURN = (29 * Math.PI) / 180;   // Manhattan's grid runs 29° east of true north: turn it square
const PAPER = 0xf3f2ee;
const INK = 0x1d1f22;

function edges(mesh, color = INK, threshold = 25) {
  const e = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, threshold), new THREE.LineBasicMaterial({ color }));
  mesh.add(e);
  return e;
}

// ---- a rat: about 1.1 m long here (drawn 3x larger than life) -------------------------------------
function makeRat() {
  const g = new THREE.Group();
  const fur = new THREE.MeshLambertMaterial({ color: 0x75645a });
  const pink = new THREE.MeshLambertMaterial({ color: 0xd9a99a });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), fur); body.scale.set(1.35, 0.62, 0.7); body.position.y = 0.38; edges(body, INK, 40); g.add(body);
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.62, 12), fur); head.rotation.z = -Math.PI / 2; head.position.set(0.85, 0.4, 0); edges(head, INK, 40); g.add(head);
  for (const z of [-0.16, 0.16]) { const ear = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), pink); ear.scale.set(0.5, 1, 1); ear.position.set(0.62, 0.66, z); g.add(ear); }
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), pink); nose.position.set(1.16, 0.4, 0); g.add(nose);
  const tailCurve = new THREE.CatmullRomCurve3([new THREE.Vector3(-0.62, 0.36, 0), new THREE.Vector3(-1.1, 0.25, 0.12), new THREE.Vector3(-1.5, 0.12, -0.1), new THREE.Vector3(-1.85, 0.08, 0.15)]);
  const tail = new THREE.Mesh(new THREE.TubeGeometry(tailCurve, 16, 0.045, 6), pink); g.add(tail);
  const legs = [];
  for (const [x, z] of [[0.35, 0.22], [0.35, -0.22], [-0.35, 0.22], [-0.35, -0.22]]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.22, 0.08), pink); l.position.set(x, 0.1, z); g.add(l); legs.push(l); }
  g.scale.setScalar(3);
  return { g, body, tail, legs, fur };
}

// ---- a person in a hi-vis vest with a flashlight: about 1.8 m (drawn 1.4x) ----------------------
function makePerson() {
  const g = new THREE.Group();
  const navy = new THREE.MeshLambertMaterial({ color: 0x2c3a52 });
  const vest = new THREE.MeshLambertMaterial({ color: 0xd8ee3a });
  const skin = new THREE.MeshLambertMaterial({ color: 0xc99a78 });
  const hipL = new THREE.Group(); hipL.position.set(0, 0.85, 0.11); const hipR = new THREE.Group(); hipR.position.set(0, 0.85, -0.11);
  for (const hip of [hipL, hipR]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.85, 0.17), navy); leg.position.y = -0.42; edges(leg); hip.add(leg); g.add(hip); }
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.62, 0.46), vest); torso.position.y = 1.18; edges(torso); g.add(torso);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.31, 0.06, 0.47), new THREE.MeshBasicMaterial({ color: 0xeeeeee })); stripe.position.y = 1.08; g.add(stripe);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 10), skin); head.position.y = 1.65; g.add(head);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.08, 14), navy); cap.position.y = 1.77; g.add(cap);
  const brim = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.02, 0.22), navy); brim.position.set(0.16, 1.74, 0); g.add(brim);
  const armL = new THREE.Group(); armL.position.set(0, 1.44, 0.29); const armR = new THREE.Group(); armR.position.set(0, 1.44, -0.29);
  for (const arm of [armL, armR]) { const a = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.58, 0.12), vest); a.position.y = -0.29; edges(a); arm.add(a); g.add(arm); }
  armR.rotation.z = -1.1;   // holding the flashlight forward
  const torch = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.26, 8), new THREE.MeshLambertMaterial({ color: 0x222222 })); torch.rotation.z = -Math.PI / 2; torch.position.set(0.12, -0.55, 0); armR.add(torch);
  g.scale.setScalar(2.8);
  return { g, hipL, hipR, armL, armR };
}

export function makeAxo(el, city, { onPick = null } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setClearColor(PAPER, 1);
  el.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-100, 100, 100, -100, -2000, 4000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.1; controls.minZoom = 0.6; controls.maxZoom = 12; controls.maxPolarAngle = Math.PI * 0.42; controls.minPolarAngle = 0.15;
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb8bcc4, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(-300, 500, -200); scene.add(sun);

  const { W, H, cellM } = city;
  const world = new THREE.Group(); world.rotation.y = GRID_TURN; scene.add(world);
  // a smooth ground: the surveyed elevation on open ground, filled under buildings, blurred
  const ground = new Float32Array(city.N).fill(NaN);
  for (const i of city.nodes) ground[i] = city.elev[i];
  for (let pass = 0; pass < 200; pass++) {
    let left = 0;
    for (let i = 0; i < city.N; i++) {
      if (!Number.isNaN(ground[i])) continue;
      const x = i % W; const y = Math.floor(i / W); let sum = 0; let n = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx; const ny = y + dy; if (nx >= 0 && ny >= 0 && nx < W && ny < H && !Number.isNaN(ground[ny * W + nx])) { sum += ground[ny * W + nx]; n++; } }
      if (n) ground[i] = sum / n; else left++;
    }
    if (!left) break;
  }
  for (let pass = 0; pass < 3; pass++) {
    const src = Float32Array.from(ground);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let sum = 0; let n = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const nx = x + dx; const ny = y + dy; if (nx >= 0 && ny >= 0 && nx < W && ny < H) { sum += src[ny * W + nx]; n++; } }
      ground[y * W + x] = sum / n;
    }
  }
  let e0 = Infinity; for (let i = 0; i < city.N; i++) e0 = Math.min(e0, ground[i]);
  const cx = (W * cellM) / 2; const cz = (H * cellM) / 2;
  const X = (gx) => gx * cellM - cx; const Z = (gy) => gy * cellM - cz;
  const elevAt = (gx, gy) => { const x = Math.max(0, Math.min(W - 1, Math.floor(gx))); const y = Math.max(0, Math.min(H - 1, Math.floor(gy))); return ground[y * W + x] - e0; };
  const cellXZ = (cell) => [(cell % W) + 0.5, Math.floor(cell / W) + 0.5];
  const v3 = (gx, gy, lift = 0) => new THREE.Vector3(X(gx), elevAt(gx, gy) + lift, Z(gy));

  // ---- the ground: a drawing on the terrain -----------------------------------------------------
  const PX = 8;
  const groundCanvas = document.createElement('canvas'); groundCanvas.width = W * PX; groundCanvas.height = H * PX;
  const gctx = groundCanvas.getContext('2d');
  const base = document.createElement('canvas'); base.width = W * PX; base.height = H * PX;
  {
    const g = base.getContext('2d');
    g.fillStyle = '#f7f6f2'; g.fillRect(0, 0, base.width, base.height);
    for (let i = 0; i < city.N; i++) {
      const x = i % W; const y = Math.floor(i / W);
      let c = null;
      if (city.ground[i] === G.BLDG) c = '#e9e7e1';
      else if (!city.walk[i]) c = '#ecebe6';
      else if (city.road[i]) c = '#d9dbdc';
      else if (city.surface[i] === S.LAWN || city.surface[i] === S.WOODS) c = '#dbe6d3';
      else if (city.surface[i] === S.YARD) c = '#e8ede1';
      else if (city.surface[i] === S.PLAZA || city.surface[i] === S.PATH) c = '#f0efea';
      if (c) { g.fillStyle = c; g.fillRect(x * PX, y * PX, PX + 0.5, PX + 0.5); }
    }
    // soften the cell edges, like a drawn plan rather than pixels
    const soft = document.createElement('canvas'); soft.width = base.width; soft.height = base.height;
    const sg = soft.getContext('2d'); sg.filter = 'blur(3px)'; sg.drawImage(base, 0, 0);
    g.drawImage(soft, 0, 0);
    // kerbs: a thin line where roadway meets sidewalk
    g.strokeStyle = 'rgba(60,64,70,0.0)'; g.lineWidth = 1;
    for (let i = 0; i < 0; i++) {
      if (!city.road[i]) continue;
      const x = i % W; const y = Math.floor(i / W);
      if (x + 1 < W && !city.road[i + 1] && city.walk[i + 1]) { g.beginPath(); g.moveTo((x + 1) * PX, y * PX); g.lineTo((x + 1) * PX, (y + 1) * PX); g.stroke(); }
      if (x > 0 && !city.road[i - 1] && city.walk[i - 1]) { g.beginPath(); g.moveTo(x * PX, y * PX); g.lineTo(x * PX, (y + 1) * PX); g.stroke(); }
      if (y + 1 < H && !city.road[i + W] && city.walk[i + W]) { g.beginPath(); g.moveTo(x * PX, (y + 1) * PX); g.lineTo((x + 1) * PX, (y + 1) * PX); g.stroke(); }
      if (y > 0 && !city.road[i - W] && city.walk[i - W]) { g.beginPath(); g.moveTo(x * PX, y * PX); g.lineTo((x + 1) * PX, y * PX); g.stroke(); }
    }
  }
  const groundTex = new THREE.CanvasTexture(groundCanvas); groundTex.colorSpace = THREE.SRGBColorSpace; groundTex.anisotropy = 8;
  const gGeo = new THREE.PlaneGeometry(W * cellM, H * cellM, W, H); gGeo.rotateX(-Math.PI / 2);
  const gp = gGeo.attributes.position;
  for (let k = 0; k < gp.count; k++) { const gx = (gp.getX(k) + cx) / cellM; const gy = (gp.getZ(k) + cz) / cellM; gp.setY(k, elevAt(gx, gy)); }
  gGeo.computeVertexNormals();
  const groundMesh = new THREE.Mesh(gGeo, new THREE.MeshBasicMaterial({ map: groundTex }));
  world.add(groundMesh);
  // a thin frame around the site
  {
    const pts = [[0, 0], [W, 0], [W, H], [0, H], [0, 0]].map(([x, y]) => v3(Math.min(W - 0.01, x), Math.min(H - 0.01, y), 0.2));
    world.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: INK })));
  }

  let layerAt = 0; let lastLayer = null;
  function paintGround(sim, layer, now) {
    if (layer === lastLayer && now - layerAt < 1500) return;
    layerAt = now; lastLayer = layer;
    gctx.drawImage(base, 0, 0);
    const L = layerValues(sim, layer);
    if (L) {
      let max = 0; for (let i = 0; i < L.v.length; i++) if (L.v[i] > max) max = L.v[i];
      const [r, g, b] = layer === 'real' ? [214, 60, 90] : layer === 'signs' ? [176, 128, 62] : [255, 112, 60];
      if (max > 0) for (let i = 0; i < L.v.length; i++) {
        const v = L.v[i]; if (!v) continue;
        const t = Math.min(1, Math.sqrt(v / max) * L.gain); if (t < 0.1) continue;
        gctx.fillStyle = `rgba(${r},${g},${b},${(0.12 + 0.5 * t).toFixed(2)})`;
        gctx.fillRect((i % W) * PX, Math.floor(i / W) * PX, PX, PX);
      }
    }
    // sheds
    for (const sh of sim.sheds) {
      if (sh.type === 'gone') continue;
      gctx.strokeStyle = sh.type === 'old' ? '#2b6c8f' : '#7fb6d1'; gctx.lineWidth = 3; gctx.setLineDash(sh.type === 'old' ? [] : [4, 3]);
      for (const c of sh.cells) gctx.strokeRect((c % W) * PX + 1, Math.floor(c / W) * PX + 1, PX - 2, PX - 2);
    }
    gctx.setLineDash([]);
    groundTex.needsUpdate = true;
  }

  // ---- buildings: white volumes, black edges ------------------------------------------------------
  const bMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const bGroup = new THREE.Group(); world.add(bGroup);
  for (const b of city.buildings) {
    const g = b.g; if (!g || g.length < 3 || !b.h) continue;
    const pts = g.map(([x, y]) => [Math.max(0, Math.min(W, x)), Math.max(0, Math.min(H, y))]);
    let area = 0; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) area += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]);
    if (Math.abs(area) < 0.3) continue;
    const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(X(x), -Z(y))));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: Math.max(3, b.h), bevelEnabled: false });
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, bMat);
    let baseY = Infinity; for (const c of b.cells) baseY = Math.min(baseY, ground[c] - e0);
    if (!Number.isFinite(baseY)) { const [x0, y0] = pts[0]; baseY = elevAt(x0, y0); }
    m.position.y = baseY;
    edges(m, INK, 30);
    bGroup.add(m);
  }
  // street trees: little canopies
  const treeGeo = new THREE.IcosahedronGeometry(2.4, 1); const treeMat = new THREE.MeshLambertMaterial({ color: 0xcfe0c6, flatShading: true });
  const trunkGeo = new THREE.CylinderGeometry(0.15, 0.2, 4, 6); const trunkMat = new THREE.MeshLambertMaterial({ color: 0x8b7b6b });
  for (const c of city.trees) {
    const [gx, gy] = cellXZ(c); const p = v3(gx, gy, 0);
    const t = new THREE.Mesh(trunkGeo, trunkMat); t.position.copy(p).setY(p.y + 2); world.add(t);
    const crown = new THREE.Mesh(treeGeo, treeMat); crown.position.copy(p).setY(p.y + 5.5); edges(crown, 0x6f8a68, 30); world.add(crown);
  }

  // street names, written on the roadway
  {
    const groups = new Map();
    for (let i = 0; i < city.N; i++) { if (!city.road[i] || city.street[i] < 0) continue; const id = city.street[i]; if (!groups.has(id)) groups.set(id, []); groups.get(id).push(i); }
    for (const [id, cells] of groups) {
      if (cells.length < 20) continue;
      const name = city.names[id].toUpperCase().replace(/\bWEST\b/, 'W').replace(/\bSTREET\b/, 'ST').replace(/\bAVENUE\b/, 'AV').replace(/\bBOULEVARD\b/, 'BLVD');
      let mx = 0; let my = 0; for (const c of cells) { mx += c % W; my += Math.floor(c / W); } mx /= cells.length; my /= cells.length;
      let sxx = 0; let syy = 0; let sxy = 0; for (const c of cells) { const dx = (c % W) - mx; const dy = Math.floor(c / W) - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
      const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
      // the cell nearest the middle that is on this street
      let best = cells[0]; let bd = Infinity; for (const c of cells) { const d = ((c % W) - mx) ** 2 + (Math.floor(c / W) - my) ** 2; if (d < bd) { bd = d; best = c; } }
      const cv = document.createElement('canvas'); cv.width = 512; cv.height = 64;
      const g = cv.getContext('2d'); g.fillStyle = '#4a4f57'; g.font = '600 34px "Space Grotesk", system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(name.split('').join(String.fromCharCode(8202)), 256, 34);
      const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(64, 8), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
      plane.rotation.x = -Math.PI / 2;
      let a = -ang; if (Math.cos(a) < 0) a += Math.PI;
      plane.rotation.z = a;
      const [gx, gy] = cellXZ(best); plane.position.copy(v3(gx, gy, 0.3));
      world.add(plane);
    }
  }

  // ---- things ---------------------------------------------------------------------------------------
  const inst = (geo, color, n, outline = true) => {
    const m = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color }), n); m.count = 0; m.frustumCulled = false; world.add(m);
    return m;
  };
  const bagGeo = new THREE.SphereGeometry(0.75, 10, 8); bagGeo.scale(1, 0.9, 1);
  const bags = inst(bagGeo, 0x2a2c30, 800);
  const bins = inst(new THREE.CylinderGeometry(0.6, 0.55, 1.4, 12), 0x3f9c6a, 800);
  const stations = inst(new THREE.BoxGeometry(1.4, 0.7, 0.9), 0x7d5bb5, 200);
  const burrowGeo = new THREE.RingGeometry(1.1, 2.0, 24); burrowGeo.rotateX(-Math.PI / 2);
  const burrows = new THREE.InstancedMesh(burrowGeo, new THREE.MeshBasicMaterial({ color: 0x5a3a2e }), 200); burrows.count = 0; burrows.frustumCulled = false; world.add(burrows);
  const holes = new THREE.InstancedMesh(new THREE.CircleGeometry(1.1, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x15100d }), 200); holes.count = 0; holes.frustumCulled = false; world.add(holes);
  const userBagGeo = new THREE.SphereGeometry(1.4, 14, 10);
  const userBags = inst(userBagGeo, 0x111111, 50);
  const tie = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.25, 0.4, 0.6, 8), new THREE.MeshBasicMaterial({ color: 0xffc928 }), 50); tie.count = 0; tie.frustumCulled = false; world.add(tie);
  const M4 = new THREE.Matrix4();
  const place = (im, k, x, y, z) => { M4.makeTranslation(x, y, z); im.setMatrixAt(k, M4); };

  // ---- agents ----------------------------------------------------------------------------------------
  const rats = new Map(); const people = new Map();
  const trailMat = new THREE.LineBasicMaterial({ color: 0xe0582a, transparent: true, opacity: 0.6 });
  function ratFor(r) {
    let m = rats.get(r.id); if (m) return m;
    m = makeRat(); world.add(m.g);
    m.trail = new THREE.Line(new THREE.BufferGeometry(), trailMat); world.add(m.trail);
    m.hist = []; m.phase = Math.random() * 6;
    rats.set(r.id, m); return m;
  }
  function personFor(ins, C) {
    let m = people.get(ins.id); if (m) return m;
    m = makePerson(); world.add(m.g);
    const half = (C.beamDeg * Math.PI) / 360;
    const bGeo = new THREE.CircleGeometry(C.beam * cellM, 40, -half, 2 * half); bGeo.rotateX(-Math.PI / 2);
    m.beamMat = new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide });
    m.beam = new THREE.Mesh(bGeo, m.beamMat); world.add(m.beam);
    m.beamEdge = new THREE.LineSegments(new THREE.EdgesGeometry(bGeo), new THREE.LineBasicMaterial({ color: 0xd4a514 })); m.beam.add(m.beamEdge);
    m.chaseLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: 0xd4a514, dashSize: 1.5, gapSize: 1 })); world.add(m.chaseLine);
    people.set(ins.id, m); return m;
  }

  // the selected agent: trail, plan, nose
  const selLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x1d1f22 }));
  const planLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: 0x1d1f22, dashSize: 2, gapSize: 1.5 }));
  const nose = new THREE.Mesh(new THREE.RingGeometry(0.985, 1, 96).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xd4a514, side: THREE.DoubleSide }));
  const bagRoutes = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: 0xd4a514, dashSize: 2, gapSize: 1.5 }));
  world.add(selLine, planLine, nose, bagRoutes);

  // rings: things that happened, and smell around a bag
  const rings = [];
  function addRing(cell, color, from, to, ms, repeat = 1, delay = 0) {
    const [gx, gy] = cellXZ(cell);
    for (let k = 0; k < repeat; k++) {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.96, 1, 80).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
      m.position.copy(v3(gx, gy, 0.5)); m.visible = false;
      world.add(m); rings.push({ m, t0: performance.now() + k * delay, from, to, ms });
    }
  }
  function updateRings(now) {
    for (let k = rings.length - 1; k >= 0; k--) {
      const r = rings[k]; const t = (now - r.t0) / r.ms;
      if (t < 0) continue;
      if (t >= 1) { world.remove(r.m); r.m.geometry.dispose(); rings.splice(k, 1); continue; }
      r.m.visible = true;
      const s = r.from + (r.to - r.from) * (1 - (1 - t) ** 2); r.m.scale.set(s, 1, s); r.m.material.opacity = 1 - t;
    }
  }

  // ---- labels and pop-ups (HTML) ---------------------------------------------------------------------
  const labelsEl = document.getElementById('labels');
  const labelPool = new Map(); const tmp = new THREE.Vector3();
  function project(v) { tmp.copy(v); world.localToWorld(tmp); tmp.project(camera); const r = renderer.domElement.getBoundingClientRect(); return [((tmp.x + 1) / 2) * r.width, ((1 - tmp.y) / 2) * r.height]; }
  function label(key, v, text, cls) {
    let el = labelPool.get(key);
    if (!el) { el = document.createElement('div'); labelsEl.append(el); labelPool.set(key, el); }
    el.used = true; el.className = cls; if (el.textContent !== text) el.textContent = text;
    const [x, y] = project(v); el.style.left = `${x}px`; el.style.top = `${y}px`;
  }
  const pops = [];
  function pop(f) {
    const [gx, gy] = cellXZ(f.cell);
    const el = document.createElement('div');
    el.className = `pop ${f.burrow ? 'burrow' : f.kind}`;
    el.textContent = { spot: 'Spotted!', caught: 'Caught!', missed: f.burrow ? 'Got away — burrow found' : 'Got away', dodge: 'Dodged', bag: 'Trash dropped' }[f.kind] ?? f.kind;
    labelsEl.append(el); pops.push({ el, v: v3(gx, gy, 6), t0: performance.now() });
    const color = { spot: 0xd4a514, caught: 0x2f9e62, missed: 0x6b7280, dodge: 0xe0582a }[f.kind];
    if (color) addRing(f.cell, f.burrow ? 0xe0582a : color, 1, 14, 1400);
  }
  function updatePops(now) {
    for (let k = pops.length - 1; k >= 0; k--) {
      const p = pops[k];
      if (now - p.t0 > 2600) { p.el.remove(); pops.splice(k, 1); continue; }
      const [x, y] = project(p.v); p.el.style.left = `${x}px`; p.el.style.top = `${y}px`;
    }
  }

  // ---- camera --------------------------------------------------------------------------------------
  let view = 'auto';
  const camDir = new THREE.Vector3(-1, 1.15, 1).normalize();
  function setFrame(target, zoom) { controls.target.copy(target); camera.position.copy(target).add(camDir.clone().multiplyScalar(1200)); camera.zoom = zoom; camera.updateProjectionMatrix(); controls.update(); }
  const overviewZoom = () => { const r = el.getBoundingClientRect(); const span = Math.max(W, H) * cellM * 1.05; return Math.min(r.width, r.height) / span; };
  function resize() {
    const r = el.getBoundingClientRect();
    renderer.setSize(r.width, r.height, false);
    renderer.domElement.style.width = `${r.width}px`; renderer.domElement.style.height = `${r.height}px`;
    camera.left = -r.width / 2; camera.right = r.width / 2; camera.top = r.height / 2; camera.bottom = -r.height / 2; camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize); resize();
  setFrame(new THREE.Vector3(0, 0, 0), overviewZoom());
  const worldPos = (gx, gy, lift = 0) => { const v = v3(gx, gy, lift); world.localToWorld(v); return v; };
  let glide = null;
  function glideTo(target, zoom) { glide = { t0: performance.now(), ms: 900, fromT: controls.target.clone(), fromZ: camera.zoom, toT: target, toZ: zoom }; }
  function focusOn(cell, zoom = overviewZoom() * 6) { const [gx, gy] = cellXZ(cell); glideTo(worldPos(gx, gy), zoom); }

  // clicks
  const ray = new THREE.Raycaster(); const ndc = new THREE.Vector2(); let downAt = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObject(groundMesh)[0]; if (!hit) return;
    const p = world.worldToLocal(hit.point.clone());
    const gx = Math.floor((p.x + cx) / cellM); const gy = Math.floor((p.z + cz) / cellM);
    if (gx >= 0 && gy >= 0 && gx < W && gy < H) onPick?.(gy * W + gx);
  });

  // ---- each frame ------------------------------------------------------------------------------------
  const along = (a, frac) => {
    const m = a.moved;
    if (!m || m.length < 2) return cellXZ(a.cell);
    const t = Math.max(0, Math.min(1, frac)) * (m.length - 1);
    const k = Math.min(m.length - 2, Math.floor(t)); const f = t - k;
    const [x0, y0] = cellXZ(m[k]); const [x1, y1] = cellXZ(m[k + 1]);
    return [x0 + (x1 - x0) * f, y0 + (y1 - y0) * f];
  };
  let fxSeen = 0; const bagsSeen = new Set();
  const turn = (cur, want) => { let d = want - cur; d = Math.atan2(Math.sin(d), Math.cos(d)); return cur + d * 0.25; };

  function frame(sim, { layer, selected, now, hourFrac, frac = 1, follow = null, trails = true }) {
    paintGround(sim, layer, now);
    for (const elx of labelPool.values()) elx.used = false;
    const t = now / 1000;
    const night = hourFrac >= 19.5 || hourFrac < 5.5 ? 1 : hourFrac >= 17.5 ? (hourFrac - 17.5) / 2 : hourFrac < 7 ? (7 - hourFrac) / 1.5 : 0;
    renderer.setClearColor(new THREE.Color(PAPER).lerp(new THREE.Color(0xdfe3ea), night * 0.6));

    // things
    let nb = 0; let nbin = 0; let nub = 0;
    for (const s of sim.sources) {
      const [gx, gy] = cellXZ(s.cell); const y = elevAt(gx, gy);
      if (s.kind === 'bag') {
        if (!bagsSeen.has(s.id)) { bagsSeen.add(s.id); addRing(s.cell, 0xd4a514, 3, sim.cfg.rat.smell * cellM, 2600, 4, 650); }
        if (s.amt > 0.05 && nub < 50) { place(userBags, nub, X(gx), y + 1.2, Z(gy)); place(tie, nub, X(gx), y + 2.6, Z(gy)); nub++; }
      } else if (s.amt > 0.05 && s.kind !== 'basket' && nb < 800) place(bags, nb++, X(gx), y + 0.6, Z(gy));
      else if (s.binned && s.isOut && nbin < 800) place(bins, nbin++, X(gx), y + 0.7, Z(gy));
    }
    bags.count = nb; bins.count = nbin; userBags.count = nub; tie.count = nub;
    for (const im of [bags, bins, userBags, tie]) im.instanceMatrix.needsUpdate = true;
    let ns = 0; for (const st of sim.stations) { const [gx, gy] = cellXZ(st.cell); if (ns < 200) place(stations, ns++, X(gx), elevAt(gx, gy) + 0.35, Z(gy)); }
    stations.count = ns; stations.instanceMatrix.needsUpdate = true;
    let nbu = 0; for (const c of sim.colonies) if (c.alive && nbu < 200) { const [gx, gy] = cellXZ(c.home); place(burrows, nbu, X(gx), elevAt(gx, gy) + 0.2, Z(gy)); place(holes, nbu, X(gx), elevAt(gx, gy) + 0.25, Z(gy)); nbu++; }
    burrows.count = holes.count = nbu; burrows.instanceMatrix.needsUpdate = true; holes.instanceMatrix.needsUpdate = true;

    // rats
    const live = new Set(); const routePts = [];
    const bagCells = new Set(sim.sources.filter((s) => s.kind === 'bag' && s.amt > 0.05).map((s) => s.cell));
    for (const r of sim.rats) {
      if (!r.alive || r.mode === 'home') continue;
      live.add(r.id);
      const m = ratFor(r);
      const [gx, gy] = along(r, frac); const p = v3(gx, gy, 0);
      const moving = r.moved && r.moved.length > 1;
      m.g.position.copy(p); m.g.visible = true;
      m.g.rotation.y = turn(m.g.rotation.y, -r.facing);
      const speed = r.mode === 'flee' ? 26 : 16;
      m.body.position.y = 0.38 + (moving ? Math.abs(Math.sin(t * speed + m.phase)) * 0.08 : 0);
      m.tail.rotation.y = Math.sin(t * (moving ? 10 : 3) + m.phase) * 0.35;
      m.legs.forEach((l, k) => { l.rotation.z = moving ? Math.sin(t * speed + m.phase + (k % 2) * Math.PI) * 0.7 : 0; });
      m.fur.color.set(r.deathAt >= 0 ? 0x8e7aa8 : r.mode === 'flee' ? 0xb34a35 : 0x75645a);
      m.g.scale.setScalar(selected === r ? 4 : 3);
      // trail
      const last = m.hist[m.hist.length - 1];
      if (last && last.distanceToSquared(p) > 30 * 30) m.hist.length = 0;
      if (!last || last.distanceToSquared(p) > 0.6) { m.hist.push(p.clone().setY(p.y + 0.15)); if (m.hist.length > 40) m.hist.shift(); }
      m.trail.visible = trails && m.hist.length > 1;
      if (m.trail.visible) { m.trail.geometry.dispose(); m.trail.geometry = new THREE.BufferGeometry().setFromPoints(m.hist); }
      if (bagCells.has(r.target) && r.path) {
        label(`bang${r.id}`, v3(gx, gy, 5), '!', 'bang');
        for (let k = r.pi; k < r.path.length - 1; k++) { const [ax, ay] = cellXZ(r.path[k]); const [bx, by] = cellXZ(r.path[k + 1]); routePts.push(v3(ax, ay, 0.4), v3(bx, by, 0.4)); }
      }
      if (selected === r) label('sel', v3(gx, gy, 3.5), `Rat #${r.id}`, 'lab sel');
    }
    for (const [id, m] of rats) if (!live.has(id)) { m.g.visible = false; m.trail.visible = false; m.hist.length = 0; }
    bagRoutes.geometry.dispose(); bagRoutes.geometry = new THREE.BufferGeometry().setFromPoints(routePts); bagRoutes.computeLineDistances();

    // inspectors
    const C = sim.cfg.inspector;
    for (const ins of sim.inspectors) {
      const m = personFor(ins, C);
      const on = ins.mode !== 'off' && ins.mode !== 'done';
      m.g.visible = m.beam.visible = on; m.chaseLine.visible = false;
      if (!on) continue;
      const [gx, gy] = along(ins, frac); const p = v3(gx, gy, 0);
      const moving = ins.moved && ins.moved.length > 1; const chasing = ins.mode === 'chase';
      m.g.position.copy(p); m.g.rotation.y = turn(m.g.rotation.y, -ins.facing);
      const sp = chasing ? 14 : 8; const sw = moving ? Math.sin(t * sp) * (chasing ? 0.8 : 0.5) : 0;
      m.hipL.rotation.z = sw; m.hipR.rotation.z = -sw; m.armL.rotation.z = -sw * 0.8;
      m.beam.position.copy(p).setY(p.y + 0.35); m.beam.rotation.y = -ins.facing;
      m.beamMat.opacity = chasing ? 0.42 : 0.12 + 0.2 * night;
      m.g.scale.setScalar(selected === ins ? 3.4 : 2.8);
      if (chasing && ins.chase?.rat?.alive) {
        const [rx, ry] = along(ins.chase.rat, frac);
        m.chaseLine.geometry.dispose(); m.chaseLine.geometry = new THREE.BufferGeometry().setFromPoints([v3(gx, gy, 1), v3(rx, ry, 0.5)]); m.chaseLine.computeLineDistances(); m.chaseLine.visible = true;
      }
      label(`ins${ins.id}`, v3(gx, gy, 6.5), chasing ? `${ins.name} · chasing` : ins.name, `lab ins${chasing ? ' chase' : ''}${selected === ins ? ' sel' : ''}`);
    }

    // selected
    selLine.visible = planLine.visible = nose.visible = false;
    if (selected && selected.trail?.length > 1) {
      selLine.geometry.dispose(); selLine.geometry = new THREE.BufferGeometry().setFromPoints(selected.trail.slice(-160).map((c) => { const [x, y] = cellXZ(c); return v3(x, y, 0.3); })); selLine.visible = true;
      if (selected.path && selected.path.length > 1) { planLine.geometry.dispose(); planLine.geometry = new THREE.BufferGeometry().setFromPoints(selected.path.slice(selected.pi ?? 0).map((c) => { const [x, y] = cellXZ(c); return v3(x, y, 0.35); })); planLine.computeLineDistances(); planLine.visible = true; }
      if (selected.kind === 'rat' && selected.alive && selected.mode !== 'home') { const [gx, gy] = along(selected, frac); const R = sim.cfg.rat.smell * cellM; nose.position.copy(v3(gx, gy, 0.4)); nose.scale.set(R, 1, R); nose.visible = true; }
    }

    for (const f of sim.fx) if (f.seq > fxSeen) pop(f);
    fxSeen = sim.fxSeq;
    updatePops(now); updateRings(now);
    for (const [k, elx] of labelPool) if (!elx.used) { elx.remove(); labelPool.delete(k); }

    // camera
    if (glide) {
      const k = Math.min(1, (now - glide.t0) / glide.ms); const e = k * k * (3 - 2 * k);
      const tgt = glide.fromT.clone().lerp(glide.toT, e);
      const off = camera.position.clone().sub(controls.target);
      controls.target.copy(tgt); camera.position.copy(tgt).add(off);
      camera.zoom = glide.fromZ + (glide.toZ - glide.fromZ) * e; camera.updateProjectionMatrix();
      if (k >= 1) glide = null;
    }
    const target = follow ?? (view === 'follow' ? selected : null);
    if (target && !glide) {
      const [gx, gy] = along(target, frac); const tp = worldPos(gx, gy, 1);
      const d = tp.sub(controls.target).multiplyScalar(0.12);
      controls.target.add(d); camera.position.add(d);
      const want = overviewZoom() * (follow ? 9 : 7);
      camera.zoom += (want - camera.zoom) * 0.05; camera.updateProjectionMatrix();
    }
    controls.update();
    renderer.render(scene, camera);
  }

  return {
    frame, focusOn, pointCount: 0,
    setView: (v) => { view = v; if (v === 'city') glideTo(new THREE.Vector3(0, 0, 0), overviewZoom()); },
    invalidate: () => {
      for (const m of rats.values()) { world.remove(m.g); world.remove(m.trail); }
      rats.clear(); fxSeen = 0; bagsSeen.clear(); lastLayer = null;
      for (const p of pops) p.el.remove(); pops.length = 0;
    },
  };
}
