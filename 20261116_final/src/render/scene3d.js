// three.js view of the real place in the storm.
// Buildings are the NYC footprints extruded to their surveyed roof heights, standing on their
// surveyed ground; the ground is a terrain mesh from the elevation field. In "its knowledge" mode
// the city only appears where the creature has looked; "the real city" shows everything.
// Simulation coordinates: x east, y south, in cells. three.js: X = x, Y = up (metres / cellM), Z = y.
// Agents are drawn larger than life so they read at this scale.

import * as THREE from 'three';
import { G, S } from '../sim/city.js';

const jitter = (x, y, k) => { const s = Math.sin(x * 127.1 + y * 311.7 + k * 74.7) * 43758.5453; return s - Math.floor(s); };
const SURV_COLORS = [0xffd27a, 0x7fe0ff, 0xff9ad5, 0xb6ff8a, 0xffa36b, 0xc8a2ff];

export function makeScene3D(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  container.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x07090d);
  scene.fog = new THREE.FogExp2(0x0b0e14, 0.02);
  const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 600);
  scene.add(new THREE.HemisphereLight(0xa8b8d8, 0x20242c, 1.7));
  const moon = new THREE.DirectionalLight(0xb0c0e0, 1.1);
  moon.position.set(-30, 60, -20);
  scene.add(moon);

  let world = null;
  let mapGroup = null;
  let groundTex = null; let groundCtx = null; let groundDrawn = null;
  const S_PX = 8;
  let buildingMeshes = [];      // { mesh, cells, shown, t0 }
  let cellObjects = new Map();  // cell -> instance slots to reveal
  let revealed = null;
  const growing = [];
  let view = 'follow';
  let truth = false;            // show the real city instead of the creature's knowledge
  let focus = 0;                // which survivor the survivor camera follows
  const zAt = (i) => (world ? world.elev[i] / world.cellM : 0);
  const zAtXY = (x, y) => zAt(Math.max(0, Math.min(world.H - 1, Math.floor(y))) * world.W + Math.max(0, Math.min(world.W - 1, Math.floor(x))));

  // ---- the creature: a tangle of roots with ember eyes ---------------------------------------
  const bark = new THREE.MeshStandardMaterial({ color: 0x2a1a12, roughness: 1, emissive: 0x3a0806, emissiveIntensity: 0.8, flatShading: true });
  const ember = new THREE.MeshBasicMaterial({ color: 0xff2a1a });
  const creature = new THREE.Group();
  const body = new THREE.Group();
  const tube = (pts, r) => new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, r, 6), bark);
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 1), bark);
  core.position.y = 1.6; core.scale.set(0.9, 1.35, 0.8);
  const skull = new THREE.Mesh(new THREE.IcosahedronGeometry(0.32, 0), bark);
  skull.position.set(0.3, 2.25, 0);
  body.add(core, skull);
  const limbs = [];
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2 + 0.4; const r = 1.0 + 0.2 * (k % 2);
    const t = tube([new THREE.Vector3(0, 1.4, 0), new THREE.Vector3(Math.cos(a) * r * 0.4, 1.0, Math.sin(a) * r * 0.4),
      new THREE.Vector3(Math.cos(a + 0.3) * r * 0.85, 0.4, Math.sin(a + 0.3) * r * 0.85), new THREE.Vector3(Math.cos(a + 0.5) * r * 1.05, 0.02, Math.sin(a + 0.5) * r * 1.05)], 0.08);
    limbs.push(t); body.add(t);
  }
  for (const side of [-1, 1]) {
    const arm = new THREE.Group();
    arm.add(tube([new THREE.Vector3(0.2, 1.9, side * 0.3), new THREE.Vector3(0.7, 2.05, side * 0.65), new THREE.Vector3(1.25, 1.5, side * 0.7), new THREE.Vector3(1.6, 0.9, side * 0.45)], 0.065));
    arm.userData.side = side;
    limbs.push(arm); body.add(arm);
  }
  for (let k = 0; k < 9; k++) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.05 + 0.025 * (k % 3), 8, 6), ember);
    const a = k * 2.39;
    e.position.set(0.55 + Math.cos(a) * 0.08, 2.22 + Math.sin(a) * 0.13, Math.sin(a * 1.7) * 0.19);
    body.add(e);
  }
  body.scale.setScalar(0.55);
  creature.add(body);
  const glow = new THREE.PointLight(0xff2a1a, 3, 5, 1.4);
  glow.position.set(0.3, 1, 0);
  creature.add(glow);
  scene.add(creature);
  const redEye = new THREE.SpotLight(0xff2a14, 30, 12, (100 / 2) * Math.PI / 180, 0.35, 1.1);
  scene.add(redEye, redEye.target);
  const coneGeo = new THREE.BufferGeometry();
  coneGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(80 * 9), 3));
  const coneMesh = new THREE.Mesh(coneGeo, new THREE.MeshBasicMaterial({ color: 0xff2a14, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
  coneMesh.frustumCulled = false;
  scene.add(coneMesh);

  // ---- survivors: hooded coats, scarves, flashlights ------------------------------------------
  const survivorPool = [];
  function survivorMesh(k) {
    if (survivorPool[k]) return survivorPool[k];
    const color = SURV_COLORS[k % SURV_COLORS.length];
    const coat = new THREE.MeshStandardMaterial({ color, roughness: 0.75, emissive: color, emissiveIntensity: 0.25 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2c3138, roughness: 0.9 });
    const g = new THREE.Group();
    const b = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.4, 6, 14), coat); b.position.y = 0.98;
    const hood = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), coat); hood.position.y = 1.45;
    const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.05, 8, 18), new THREE.MeshStandardMaterial({ color: 0xb3262b })); scarf.rotation.x = Math.PI / 2; scarf.position.y = 1.26;
    const legL = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.36, 4, 8), dark); legL.position.set(0, 0.42, -0.1);
    const legR = legL.clone(); legR.position.z = 0.1;
    const fig = new THREE.Group();
    fig.add(b, hood, scarf, legL, legR);
    fig.scale.setScalar(0.85);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.55, 32), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.9, depthTest: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.06; ring.renderOrder = 3;
    g.add(fig, ring);
    const torch = new THREE.SpotLight(0xfff0d0, 8, 8, 0.5, 0.5, 1.1);
    scene.add(g, torch, torch.target);
    const entry = { g, torch, legL, legR, anim: null, color };
    survivorPool[k] = entry;
    return entry;
  }

  // ---- routes, landmarks, sounds ------------------------------------------------------------
  const route = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: 0xff6a5a, dashSize: 0.35, gapSize: 0.25, depthTest: false }));
  route.frustumCulled = false; route.renderOrder = 4;
  scene.add(route);
  const sRoute = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: 0xffd27a, dashSize: 0.3, gapSize: 0.25, depthTest: false }));
  sRoute.frustumCulled = false; sRoute.renderOrder = 4;
  scene.add(sRoute);
  const flags = new THREE.Group();
  scene.add(flags);
  const flagById = new Map();
  const ripples = [];

  function labelSprite(text, color, w = 128) {
    const c = document.createElement('canvas');
    c.width = w; c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = color;
    g.beginPath(); g.roundRect(6, 8, w - 12, 48, 24); g.fill();
    g.fillStyle = '#05070a';
    g.font = '700 30px system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, w / 2, 34);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
    sp.scale.set(1.1 * (w / 128), 0.55, 1);
    sp.renderOrder = 5;
    return sp;
  }

  // ---- snow -----------------------------------------------------------------------------------
  const SNOW = 2600;
  const snowGeo = new THREE.BufferGeometry();
  const sp = new Float32Array(SNOW * 3);
  for (let i = 0; i < SNOW; i++) { sp[i * 3] = Math.random() * 60 - 30; sp[i * 3 + 1] = Math.random() * 20; sp[i * 3 + 2] = Math.random() * 60 - 30; }
  snowGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  const snow = new THREE.Points(snowGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.07, transparent: true, opacity: 0.8, depthWrite: false }));
  snow.frustumCulled = false;
  scene.add(snow);

  // ---- the map -------------------------------------------------------------------------------
  function disposeGroup(g) { g.traverse((o) => { o.geometry?.dispose(); if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose()); else o.material?.dispose?.(); }); }

  function buildMap(w, design = {}) {
    world = w;
    if (mapGroup) { scene.remove(mapGroup); disposeGroup(mapGroup); }
    for (const f of [...flags.children]) flags.remove(f);
    flagById.clear();
    mapGroup = new THREE.Group();
    buildingMeshes = [];
    cellObjects = new Map();
    growing.length = 0;
    const { W, H, N } = world;
    revealed = new Uint8Array(N);

    // terrain: vertices at cell corners, height = mean elevation of the cells around the corner
    const cv = document.createElement('canvas');
    cv.width = W * S_PX; cv.height = H * S_PX;
    groundCtx = cv.getContext('2d');
    groundCtx.fillStyle = '#020304';
    groundCtx.fillRect(0, 0, cv.width, cv.height);
    groundDrawn = new Int16Array(N).fill(-2);
    groundTex = new THREE.CanvasTexture(cv);
    groundTex.colorSpace = THREE.SRGBColorSpace;
    const pos = []; const uv = []; const idx = [];
    for (let j = 0; j <= H; j++) for (let i = 0; i <= W; i++) {
      let s = 0; let n = 0;
      for (const [dx, dy] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) { const x = i + dx; const y = j + dy; if (x >= 0 && y >= 0 && x < W && y < H) { s += zAt(y * W + x); n++; } }
      pos.push(i, s / n, j); uv.push(i / W, 1 - j / H);
    }
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const a = j * (W + 1) + i; const b = a + 1; const c = a + W + 1; const d = c + 1; idx.push(a, c, b, b, c, d); }
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    tg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    tg.setIndex(idx); tg.computeVertexNormals();
    mapGroup.add(new THREE.Mesh(tg, new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.95 })));
    const minZ = Math.min(...world.elev) / world.cellM;
    const outside = new THREE.Mesh(new THREE.PlaneGeometry(W + 200, H + 200), new THREE.MeshStandardMaterial({ color: 0x07090c, roughness: 1 }));
    outside.rotation.x = -Math.PI / 2; outside.position.set(W / 2, minZ - 0.3, H / 2);
    mapGroup.add(outside);

    // buildings: real footprints, real roof heights; snow on the roofs
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x5a6370, roughness: 0.9 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0xdfe7ef, roughness: 0.9 });
    const windowsMat = new THREE.MeshStandardMaterial({ color: 0x5f6b7a, roughness: 0.6, metalness: 0.2 });
    const cellsOf = new Map();
    for (let i = 0; i < N; i++) if (world.bldgId[i] >= 0) { if (!cellsOf.has(world.bldgId[i])) cellsOf.set(world.bldgId[i], []); cellsOf.get(world.bldgId[i]).push(i); }
    for (const b of world.buildings) {
      const cells = cellsOf.get(b.id);
      if (!cells || b.g.length < 3) continue;
      const shape = new THREE.Shape(b.g.map(([x, y]) => new THREE.Vector2(x, -y)));
      const base = (b.ground ?? world.elev[cells[0]]) / world.cellM - 0.4;
      const geo = new THREE.ExtrudeGeometry(shape, { depth: b.h / world.cellM + 0.4, bevelEnabled: false });
      geo.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geo, [roofMat, b.h > 40 ? windowsMat : wallMat]);
      mesh.position.y = base;
      mesh.userData.base = base;
      mesh.scale.y = 0.001; mesh.visible = false;
      mapGroup.add(mesh);
      const rec = { mesh, cells, shown: false, t0: 0 };
      buildingMeshes.push(rec);
      for (const c of cells) { if (!cellObjects.has(c)) cellObjects.set(c, []); cellObjects.get(c).push({ building: rec }); }
    }

    // instanced things per cell
    const tmpM = new THREE.Matrix4();
    const add = (geo, mat, cells, place) => {
      const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, cells.length));
      cells.forEach((i, j) => {
        const x = i % W; const y = Math.floor(i / W);
        const p = new THREE.Vector3(); const q = new THREE.Quaternion(); const s = new THREE.Vector3(1, 1, 1);
        place(x, y, p, s, q, i);
        if (!cellObjects.has(i)) cellObjects.set(i, []);
        cellObjects.get(i).push({ mesh, j, p, q, s });
        tmpM.compose(p, q, new THREE.Vector3(0, 0, 0));
        mesh.setMatrixAt(j, tmpM);
      });
      if (!cells.length) mesh.count = 0;
      mesh.instanceMatrix.needsUpdate = true;
      mapGroup.add(mesh);
    };
    const of = (pred) => { const out = []; for (let i = 0; i < N; i++) if (pred(i)) out.push(i); return out; };
    const k = (x, y) => 0.8 + 0.45 * jitter(x, y, 1);
    const snowMat = new THREE.MeshStandardMaterial({ color: 0xdfe6ee, roughness: 0.95 });
    const trees = of((i) => world.ground[i] === G.TREE);
    add(new THREE.CylinderGeometry(0.06, 0.1, 1, 6), new THREE.MeshStandardMaterial({ color: 0x3a2a1e }), trees, (x, y, p, s, q, i) => { const kk = k(x, y); p.set(x + 0.5, zAt(i) + 0.4 * kk, y + 0.5); s.set(kk, 0.8 * kk, kk); });
    add(new THREE.ConeGeometry(0.5, 1.3, 7), new THREE.MeshStandardMaterial({ color: 0x1b2d23, roughness: 0.95, flatShading: true }), trees, (x, y, p, s, q, i) => { const kk = k(x, y); p.set(x + 0.5 + (jitter(x, y, 3) - 0.5) * 0.3, zAt(i) + 1.25 * kk, y + 0.5 + (jitter(x, y, 4) - 0.5) * 0.3); s.set(kk, kk * 1.1, kk); q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), jitter(x, y, 2) * 6); });
    add(new THREE.ConeGeometry(0.34, 0.5, 7), snowMat, trees, (x, y, p, s, q, i) => { const kk = k(x, y); p.set(x + 0.5 + (jitter(x, y, 3) - 0.5) * 0.3, zAt(i) + 1.75 * kk, y + 0.5 + (jitter(x, y, 4) - 0.5) * 0.3); s.set(kk, kk, kk); });
    const bushes = of((i) => world.ground[i] === G.BUSH);
    add(new THREE.IcosahedronGeometry(0.42, 1), new THREE.MeshStandardMaterial({ color: 0x2b4532, flatShading: true }), bushes, (x, y, p, s, q, i) => { p.set(x + 0.5, zAt(i) + 0.25, y + 0.5); s.set(1, 0.7, 1); });
    const rocks = of((i) => world.ground[i] === G.ROCK);
    add(new THREE.DodecahedronGeometry(0.55, 0), new THREE.MeshStandardMaterial({ color: 0x5b626c, flatShading: true }), rocks, (x, y, p, s, q, i) => { p.set(x + 0.5, zAt(i) + 0.2, y + 0.5); s.set(1, 0.75, 1); q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), jitter(x, y, 5) * 6); });
    const fences = of((i) => world.ground[i] === G.FENCE);
    add(new THREE.BoxGeometry(1, 0.2, 1), new THREE.MeshStandardMaterial({ color: 0x2a3038 }), fences, (x, y, p, s, q, i) => { p.set(x + 0.5, zAt(i) + 0.1, y + 0.5); s.set(0.96, 1, 0.96); });
    const barriers = of((i) => world.ground[i] === G.BARRIER);
    add(new THREE.BoxGeometry(1, 0.32, 1), new THREE.MeshStandardMaterial({ color: 0xff7a2a, emissive: 0x7a2a00, emissiveIntensity: 0.6 }), barriers, (x, y, p, s, q, i) => { p.set(x + 0.5, zAt(i) + 0.16, y + 0.5); s.set(0.9, 1, 0.9); });
    const water = of((i) => world.ground[i] === G.WATER);
    add(new THREE.BoxGeometry(1, 0.05, 1), new THREE.MeshStandardMaterial({ color: 0x1d2e40, roughness: 0.3, metalness: 0.2 }), water, (x, y, p, s, q, i) => { p.set(x + 0.5, zAt(i) + 0.02, y + 0.5); });

    // street lamps (decoration; the lit cells are painted on the snow)
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xffcf7a });
    const lampCells = [];
    for (const p of world.place.lamps ?? []) lampCells.push(p);
    // warming centres, caches, the refuge
    const centreMat = new THREE.MeshStandardMaterial({ color: 0xff8a3a, emissive: 0xff6a1a, emissiveIntensity: 0.9 });
    (design.warming ?? []).forEach((c, n) => {
      const g = new THREE.Group();
      const tent = new THREE.Mesh(new THREE.ConeGeometry(0.8, 0.9, 4), centreMat); tent.position.y = 0.45; tent.rotation.y = Math.PI / 4;
      const l = new THREE.PointLight(0xff8a3a, 6, 6, 1.3); l.position.y = 1.2;
      const tag = labelSprite(`W${n + 1}`, '#ff8a3a'); tag.position.y = 1.8;
      g.add(tent, l, tag);
      g.position.set((c % W) + 0.5, zAt(c), Math.floor(c / W) + 0.5);
      mapGroup.add(g);
    });
    const cacheCol = { battery: 0x7fd1ff, warmers: 0xff8a3a, food: 0x9dff7a };
    const cacheMeshes = new Map();
    for (const c of world.caches ?? []) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.32, 0.42), new THREE.MeshStandardMaterial({ color: cacheCol[c.type], emissive: cacheCol[c.type], emissiveIntensity: 0.5 }));
      m.position.set((c.cell % W) + 0.5, zAt(c.cell) + 0.2, Math.floor(c.cell / W) + 0.5);
      mapGroup.add(m);
      cacheMeshes.set(c.cell, m);
    }
    mapGroup.userData.caches = cacheMeshes;
    const d = world.door;
    const beacon = new THREE.Group();
    const crossMat = new THREE.MeshBasicMaterial({ color: 0x33e07a });
    const c1 = new THREE.Mesh(new THREE.BoxGeometry(0.25, 1.1, 0.25), crossMat); c1.position.y = 2.2;
    const c2 = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.25, 0.25), crossMat); c2.position.y = 2.2;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.6, 6), crossMat); pole.position.y = 0.8;
    const dl = new THREE.PointLight(0x7dffb0, 8, 9, 1.2); dl.position.y = 1.5;
    const tag = labelSprite(world.refuge.kind === 'subway' ? 'SUBWAY' : 'HOSPITAL', '#7dff9a', 220); tag.position.y = 3.2;
    beacon.add(c1, c2, pole, dl, tag);
    beacon.position.set((d % W) + 0.5, zAt(d), Math.floor(d / W) + 0.5);
    mapGroup.add(beacon);
    void lampMat; void lampCells;
    scene.add(mapGroup);
  }

  function revealCell(i, now) {
    if (revealed[i]) return;
    revealed[i] = 1;
    for (const slot of cellObjects.get(i) ?? []) {
      if (slot.building) { if (!slot.building.shown) { slot.building.shown = true; slot.building.t0 = now; slot.building.mesh.visible = true; growing.push({ building: slot.building }); } }
      else growing.push({ ...slot, t0: now });
    }
  }

  // the snow, painted per cell: dark where it has never looked; roads, plowed streets, lamps
  const SURF = { [S.YARD]: '#c3ccd6', [S.LAWN]: '#d7dee6', [S.AVENUE]: '#9aa3ad', [S.STREET]: '#a7b0ba', [S.PATH]: '#bcc5cf', [S.STEPS]: '#aab3bd', [S.PLAZA]: '#b3bcc6', [S.WOODS]: '#c9d2db', [S.BRIDGE]: '#8f99a4' };
  function paintGround(sim) {
    const { W, N } = world;
    const k = sim.creature.k;
    const g = groundCtx;
    let changed = false;
    for (let i = 0; i < N; i++) {
      const v = truth ? (world.walk[i] ? 0 : 1) : k.known[i];
      const visits = Math.min(6, k.visits[i]);
      const code = v === -1 ? -1 : v === 1 ? 20 + world.ground[i] : visits;
      if (groundDrawn[i] === code) continue;
      groundDrawn[i] = code;
      changed = true;
      const x = (i % W) * S_PX; const y = Math.floor(i / W) * S_PX;
      if (v === -1) { g.fillStyle = '#020304'; g.fillRect(x, y, S_PX, S_PX); continue; }
      g.fillStyle = world.ground[i] === G.WATER ? '#1d2e40' : world.plowed?.[i] ? '#6f7a86' : SURF[world.surface[i]] ?? '#c3ccd6';
      g.fillRect(x, y, S_PX, S_PX);
      if (world.lit[i] && world.walk[i]) { g.fillStyle = 'rgba(255, 190, 110, 0.22)'; g.fillRect(x, y, S_PX, S_PX); }
      if (world.warm?.[i] > 1) { g.fillStyle = 'rgba(255, 120, 40, 0.45)'; g.fillRect(x, y, S_PX, S_PX); }
      if (v === 0 && visits > 0) { g.fillStyle = `rgba(150, 20, 15, ${0.06 + 0.04 * visits})`; g.fillRect(x, y, S_PX, S_PX); }
    }
    if (changed) groundTex.needsUpdate = true;
  }

  function syncFlags(sim) {
    const lms = sim.creature.k.landmarks;
    const COL = { start: '#cfd6de', deadend: '#ff5a4a', corner: '#7fd1ff', warm: '#ff8a3a', exit: '#7dff9a', heard: '#ffb347', seen: '#ffd23f', caught: '#ff2a2a', froze: '#bfe6ff' };
    const ids = new Set(lms.map((l) => l.id));
    for (const [id, g] of flagById) if (!ids.has(id)) { flags.remove(g); flagById.delete(id); }
    for (const l of lms) {
      if (flagById.has(l.id) || (l.kind === 'warm' && l.data?.type === 'doorway')) continue;
      const g = new THREE.Group();
      const tall = l.kind === 'heard' ? 0.9 : 1.5;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, tall, 6), new THREE.MeshBasicMaterial({ color: COL[l.kind] ?? '#fff' }));
      pole.position.y = tall / 2;
      const tag = labelSprite(l.id, COL[l.kind] ?? '#fff');
      tag.position.y = tall + 0.3;
      g.add(pole, tag);
      g.position.set(l.x + 0.5, zAt(l.cell), l.y + 0.5);
      g.userData.t0 = performance.now();
      flags.add(g);
      flagById.set(l.id, g);
    }
  }

  // ---- per tick --------------------------------------------------------------------------------
  let state = null;
  let creatureAnim = null;
  const pose = (n, f) => ({ x: (n % world.W) + 0.5, y: Math.floor(n / world.W) + 0.5, f });
  const nextAnim = (prev, n, f, now, dur) => {
    const to = pose(n, f);
    const cur = prev?.cur ?? to;
    const jump = Math.hypot(cur.x - to.x, cur.y - to.y) > 3;
    return { from: jump ? to : cur, to, t0: now, dur, cur };
  };

  function onTick(sim, now, tickMs) {
    state = sim;
    creatureAnim = nextAnim(creatureAnim, sim.creature.node, sim.creature.facing, now, tickMs * 0.98);
    sim.survivors.forEach((s, k) => { const m = survivorMesh(k); m.anim = nextAnim(m.anim, s.node, s.facing, now, tickMs * 0.98); });
    const k = sim.creature.k;
    for (let i = 0; i < k.known.length; i++) if ((truth || k.known[i] !== -1) && !revealed[i]) revealCell(i, now);
    paintGround(sim);
    syncFlags(sim);
    const caches = mapGroup?.userData.caches;
    if (caches) for (const c of world.caches) { const m = caches.get(c.cell); if (m) m.visible = !c.taken && sim.phase !== 'explore'; }
    const pts = (path, h) => path.map((n) => new THREE.Vector3((n % world.W) + 0.5, zAt(n) + h, Math.floor(n / world.W) + 0.5));
    route.geometry.dispose();
    route.geometry = new THREE.BufferGeometry().setFromPoints(pts(sim.creature.path ?? [], 0.12));
    route.computeLineDistances();
    const fs = sim.survivors[focus] ?? sim.survivors[0];
    sRoute.geometry.dispose();
    sRoute.geometry = new THREE.BufferGeometry().setFromPoints(fs && fs.active ? pts(fs.path ?? [], 0.14) : []);
    sRoute.computeLineDistances();
    if (fs) sRoute.material.color.setHex(SURV_COLORS[sim.survivors.indexOf(fs) % SURV_COLORS.length]);
    for (const s of sim.sounds) if (s.heard) addRipple(s.node, s.who === 'cry' ? 0xffd27a : 0xffb347, now, s.who === 'cry');
    // the creature's cone on the ground
    const cone = k.lastCone ?? [];
    const arr = coneGeo.attributes.position.array;
    let n = 0;
    const cz = zAtXY(cone[0]?.[0] ?? 0, cone[0]?.[1] ?? 0) + 0.12;
    for (let j = 1; j + 1 < cone.length && n < arr.length - 9; j++) {
      arr.set([cone[0][0], cz, cone[0][1], cone[j][0], zAtXY(cone[j][0], cone[j][1]) + 0.12, cone[j][1], cone[j + 1][0], zAtXY(cone[j + 1][0], cone[j + 1][1]) + 0.12, cone[j + 1][1]], n);
      n += 9;
    }
    coneGeo.setDrawRange(0, n / 3);
    coneGeo.attributes.position.needsUpdate = true;
    // the storm: snowfall density and fog from the record
    const w = sim.weather;
    snow.material.opacity = Math.min(0.95, 0.25 + 0.35 * (w?.snowfall ?? 0));
    stormFog = 0.012 + 0.012 * Math.min(2, w?.snowfall ?? 0);
    windDir = w?.dir ?? 0; windSpeed = w?.wind ?? 0;
  }
  let stormFog = 0.02; let windDir = 0; let windSpeed = 0;

  function addRipple(node, color, now, big) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.0, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false, depthTest: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.set((node % world.W) + 0.5, zAt(node) + 0.15, Math.floor(node / world.W) + 0.5);
    m.renderOrder = 4;
    scene.add(m);
    ripples.push({ m, t0: now, big });
  }

  // ---- camera --------------------------------------------------------------------------------
  const camPos = new THREE.Vector3(0, 40, 40);
  const camLook = new THREE.Vector3();
  let camFacing = 0;
  let lastFrame = 0;
  function resize() {
    const w = container.clientWidth; const h = container.clientHeight;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%';
    camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(container);
  resize();

  const tmpS = new THREE.Vector3(); const tmpM2 = new THREE.Matrix4();
  function interp(a, now) {
    if (!a) return null;
    const t = Math.min(1, (now - a.t0) / Math.max(1, a.dur));
    let df = a.to.f - a.from.f; df = Math.atan2(Math.sin(df), Math.cos(df));
    a.cur = { x: a.from.x + (a.to.x - a.from.x) * t, y: a.from.y + (a.to.y - a.from.y) * t, f: a.from.f + df * Math.min(1, t * 1.5) };
    return a.cur;
  }

  function frame(now) {
    if (!world || !state) { renderer.render(scene, camera); return; }
    const sim = state;
    const dt = Math.min(0.1, (now - (lastFrame || now)) / 1000);
    lastFrame = now;
    for (let i = growing.length - 1; i >= 0; i--) {
      const r = growing[i];
      if (r.building) {
        const t = Math.min(1, (now - r.building.t0) / 700);
        r.building.mesh.scale.y = Math.max(0.001, 1 - (1 - t) ** 3);
        if (t >= 1) growing.splice(i, 1);
        continue;
      }
      const t = Math.min(1, (now - r.t0) / 450);
      tmpS.copy(r.s).multiplyScalar(1 - (1 - t) * (1 - t));
      tmpM2.compose(r.p, r.q, tmpS);
      r.mesh.setMatrixAt(r.j, tmpM2);
      r.mesh.instanceMatrix.needsUpdate = true;
      if (t >= 1) growing.splice(i, 1);
    }
    const C = interp(creatureAnim, now);
    if (C) {
      const cz = zAtXY(C.x, C.y);
      creature.position.set(C.x, cz + Math.abs(Math.sin(now / 200)) * 0.04, C.y);
      creature.rotation.y = -C.f;
      limbs.forEach((t, i) => { if (t.userData.side) t.rotation.z = -0.12 + Math.sin(now / 180 + t.userData.side) * 0.16; else t.rotation.y = Math.sin(now / 230 + i * 1.3) * 0.13; });
      const fx = Math.cos(C.f); const fz = Math.sin(C.f);
      redEye.position.set(C.x, cz + 1.4, C.y);
      redEye.target.position.set(C.x + fx * 7, cz, C.y + fz * 7);
    }
    sim.survivors.forEach((s, k) => {
      const m = survivorMesh(k);
      const P = interp(m.anim, now);
      const show = !!P && sim.phase !== 'explore' && s.active;
      m.g.visible = show; m.torch.visible = show && s.lightOn;
      if (!show) return;
      const pz = zAtXY(P.x, P.y);
      m.g.position.set(P.x, pz, P.y);
      m.g.rotation.y = -P.f;
      const fx = Math.cos(P.f); const fz = Math.sin(P.f);
      m.torch.position.set(P.x + fx * 0.2, pz + 0.7, P.y + fz * 0.2);
      m.torch.target.position.set(P.x + fx * 5, pz, P.y + fz * 5);
    });
    for (let k = sim.survivors.length; k < survivorPool.length; k++) { survivorPool[k].g.visible = false; survivorPool[k].torch.visible = false; }

    // camera
    let target; let pos;
    const fs = sim.survivors[focus] ?? sim.survivors.find((s) => s.active);
    const S0 = view === 'survivor' && fs && sim.phase !== 'explore' ? survivorPool[sim.survivors.indexOf(fs)]?.anim?.cur : null;
    const who = S0 ?? C;
    if (view === 'top') {
      target = new THREE.Vector3(world.W / 2, 0, world.H / 2);
      pos = new THREE.Vector3(world.W / 2, Math.max(world.W, world.H) * 0.95, world.H / 2 + world.H * 0.8);
    } else if (who) {
      let df = who.f - camFacing; df = Math.atan2(Math.sin(df), Math.cos(df));
      camFacing += df * Math.min(1, dt * 2.5);
      const wz = zAtXY(who.x, who.y);
      target = new THREE.Vector3(who.x + Math.cos(camFacing) * 2.5, wz + 0.5, who.y + Math.sin(camFacing) * 2.5);
      pos = new THREE.Vector3(who.x - Math.cos(camFacing) * 7, wz + 13, who.y - Math.sin(camFacing) * 7);
    }
    if (target) {
      const lag = 1 - Math.exp(-dt * (view === 'top' ? 8 : 4));
      camPos.lerp(pos, lag);
      camLook.lerp(target, Math.min(1, lag * 1.3));
      camera.position.copy(camPos);
      camera.lookAt(camLook);
    }
    scene.fog.density = view === 'top' ? stormFog * 0.25 : stormFog;
    // snow, blown by the recorded wind
    const a = snowGeo.attributes.position.array;
    const rad = (windDir * Math.PI) / 180;
    const vx = -Math.sin(rad) * windSpeed * 0.0012; const vz = Math.cos(rad) * windSpeed * 0.0012;
    for (let i = 0; i < SNOW; i++) {
      a[i * 3 + 1] -= 0.03 + (i % 5) * 0.005;
      a[i * 3] += vx; a[i * 3 + 2] += vz;
      if (a[i * 3 + 1] < 0) a[i * 3 + 1] += 20;
      if (a[i * 3] > 30) a[i * 3] -= 60; if (a[i * 3] < -30) a[i * 3] += 60;
      if (a[i * 3 + 2] > 30) a[i * 3 + 2] -= 60; if (a[i * 3 + 2] < -30) a[i * 3 + 2] += 60;
    }
    snowGeo.attributes.position.needsUpdate = true;
    snow.position.set(camLook.x, camLook.y - 2, camLook.z);
    for (const f of flags.children) f.scale.setScalar(Math.min(1, (now - f.userData.t0) / 500));
    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i];
      const t = (now - r.t0) / (r.big ? 1800 : 1200);
      if (t >= 1) { scene.remove(r.m); r.m.geometry.dispose(); r.m.material.dispose(); ripples.splice(i, 1); continue; }
      r.m.scale.setScalar(0.4 + t * (r.big ? 10 : 4));
      r.m.material.opacity = 0.9 * (1 - t);
    }
    renderer.render(scene, camera);
  }

  // the cell under a click: march the ray until it passes below the terrain
  const ray = new THREE.Raycaster();
  function pickCell(clientX, clientY) {
    if (!world) return null;
    const r = renderer.domElement.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), camera);
    const o = ray.ray.origin; const d = ray.ray.direction;
    for (let t = 0; t < 400; t += 0.25) {
      const x = o.x + d.x * t; const y = o.y + d.y * t; const z = o.z + d.z * t;
      if (x < 0 || z < 0 || x >= world.W || z >= world.H) continue;
      if (y <= zAtXY(x, z)) return Math.floor(z) * world.W + Math.floor(x);
    }
    return null;
  }

  return {
    buildMap, onTick, frame, pickCell,
    setView(v) { view = v; },
    getView: () => view,
    setTruth(v) { truth = v; if (groundDrawn) groundDrawn.fill(-2); if (v && world) { const now = performance.now(); for (let i = 0; i < world.N; i++) revealCell(i, now); } },
    getTruth: () => truth,
    setFocus(k) { focus = k; },
    reset() { creatureAnim = null; for (const m of survivorPool) m.anim = null; state = null; },
  };
}
