// three.js view of the forest from the creature's side: a camera behind it, its red vision cone as
// the only strong light, and a forest that only appears where it has looked.
// Simulation coordinates: x east, y south. three.js: X = x, Y = up, Z = y.

import * as THREE from 'three';
import { G } from '../sim/world.js';

const UP = new THREE.Vector3(0, 1, 0);
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const jitter = (x, y, k) => { const s = Math.sin(x * 127.1 + y * 311.7 + k * 74.7) * 43758.5453; return s - Math.floor(s); };

export function makeScene3D(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  container.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x040507);
  scene.fog = new THREE.FogExp2(0x040507, 0.035);
  const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 400);
  scene.add(new THREE.HemisphereLight(0x55607a, 0x050608, 0.5));
  const moon = new THREE.DirectionalLight(0x8090b0, 0.25);
  moon.position.set(-20, 40, -10);
  scene.add(moon);

  let world = null;
  let mapGroup = null;
  let groundTex = null;
  let groundCtx = null;
  let groundDrawn = null;   // Int8Array: what the ground texture shows per cell
  const S = 16;             // texture pixels per cell
  const reveal = [];        // { mesh, index, x, y, k, t0, target matrix parts }
  const revealOf = new Map(); // cell -> list of instance slots
  let revealedCells = null;
  let view = 'follow';

  // ---- the creature: an original tangle of roots with ember eyes -------------------------
  const bark = new THREE.MeshStandardMaterial({ color: 0x2a1a12, roughness: 1, emissive: 0x3a0806, emissiveIntensity: 0.7, flatShading: true });
  const ember = new THREE.MeshBasicMaterial({ color: 0xff2a1a });
  const creature = new THREE.Group();
  const tube = (pts, r) => new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 18, r, 6), bark);
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 1), bark);
  core.position.y = 1.6; core.scale.set(0.9, 1.35, 0.8);
  const skull = new THREE.Mesh(new THREE.IcosahedronGeometry(0.32, 0), bark);
  skull.position.set(0.3, 2.25, 0);
  creature.add(core, skull);
  const limbs = [];
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2 + 0.4; const r = 1.0 + 0.2 * (k % 2);
    const t = tube([new THREE.Vector3(0, 1.4, 0), new THREE.Vector3(Math.cos(a) * r * 0.4, 1.0, Math.sin(a) * r * 0.4),
      new THREE.Vector3(Math.cos(a + 0.3) * r * 0.85, 0.4, Math.sin(a + 0.3) * r * 0.85), new THREE.Vector3(Math.cos(a + 0.5) * r * 1.05, 0.02, Math.sin(a + 0.5) * r * 1.05)], 0.08);
    limbs.push(t); creature.add(t);
  }
  for (const side of [-1, 1]) {
    const arm = new THREE.Group();
    arm.add(tube([new THREE.Vector3(0.2, 1.9, side * 0.3), new THREE.Vector3(0.7, 2.05, side * 0.65), new THREE.Vector3(1.25, 1.5, side * 0.7), new THREE.Vector3(1.6, 0.9, side * 0.45)], 0.065));
    for (let f = 0; f < 4; f++) arm.add(tube([new THREE.Vector3(1.6, 0.9, side * 0.45), new THREE.Vector3(1.85, 0.8 + f * 0.06, side * (0.3 + f * 0.1)), new THREE.Vector3(2.05, 0.55 + f * 0.1, side * (0.22 + f * 0.12))], 0.024));
    arm.userData.side = side;
    limbs.push(arm); creature.add(arm);
  }
  for (let k = 0; k < 6; k++) {
    const a = k * 1.1;
    const t = tube([new THREE.Vector3(-0.1, 1.9, 0), new THREE.Vector3(-0.3 + Math.cos(a) * 0.2, 2.45 + k * 0.05, Math.sin(a) * 0.35), new THREE.Vector3(-0.55 + Math.cos(a) * 0.3, 2.95 + k * 0.08, Math.sin(a) * 0.55)], 0.032);
    limbs.push(t); creature.add(t);
  }
  for (let k = 0; k < 11; k++) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.04 + 0.025 * (k % 3), 8, 6), ember);
    const a = k * 2.39;
    if (k < 6) e.position.set(0.55 + Math.cos(a) * 0.08, 2.22 + Math.sin(a) * 0.13, Math.sin(a * 1.7) * 0.19);
    else e.position.set(0.42 + Math.cos(a) * 0.1, 1.5 + (k % 4) * 0.15, Math.sin(a) * 0.33);
    creature.add(e);
  }
  const glow = new THREE.PointLight(0xff2a1a, 3.5, 7, 1.3);
  glow.position.set(0.6, 2.1, 0);
  creature.add(glow);
  scene.add(creature);
  // its vision: a red spotlight along its cone, and the cone itself drawn on the snow
  const redEye = new THREE.SpotLight(0xff2a14, 38, 13, (100 / 2) * Math.PI / 180, 0.35, 1.1);
  scene.add(redEye, redEye.target);
  const coneGeo = new THREE.BufferGeometry();
  coneGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(80 * 9), 3));
  const coneMesh = new THREE.Mesh(coneGeo, new THREE.MeshBasicMaterial({ color: 0xff2a14, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
  coneMesh.frustumCulled = false;
  scene.add(coneMesh);

  // ---- the survivor: hooded coat, scarf, flashlight ----------------------------------------
  const coat = new THREE.MeshStandardMaterial({ color: 0xffd27a, roughness: 0.75, emissive: 0xffd27a, emissiveIntensity: 0.15 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2c3138, roughness: 0.9 });
  const survivor = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.4, 6, 14), coat); body.position.y = 0.98;
  const hood = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), coat); hood.position.y = 1.45;
  const face = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), new THREE.MeshStandardMaterial({ color: 0xe3b9a0 })); face.position.set(0.1, 1.43, 0);
  const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.05, 8, 18), new THREE.MeshStandardMaterial({ color: 0xb3262b })); scarf.rotation.x = Math.PI / 2; scarf.position.y = 1.26;
  const legL = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.36, 4, 8), dark); legL.position.set(0, 0.42, -0.1);
  const legR = legL.clone(); legR.position.z = 0.1;
  survivor.add(body, hood, face, scarf, legL, legR);
  scene.add(survivor);
  const torch = new THREE.SpotLight(0xfff0d0, 10, 9, 0.5, 0.5, 1.1);
  scene.add(torch, torch.target);
  const survivorRing = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.58, 32), new THREE.MeshBasicMaterial({ color: 0xffd27a, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }));
  survivorRing.rotation.x = -Math.PI / 2; survivorRing.position.y = 0.04;
  survivor.add(survivorRing);

  // ---- routes, landmarks, sounds ------------------------------------------------------------
  const routeMat = new THREE.LineDashedMaterial({ color: 0xff6a5a, dashSize: 0.35, gapSize: 0.25 });
  const route = new THREE.Line(new THREE.BufferGeometry(), routeMat);
  route.frustumCulled = false;
  scene.add(route);
  const sRoute = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: 0xffd27a, dashSize: 0.3, gapSize: 0.25 }));
  sRoute.frustumCulled = false;
  scene.add(sRoute);
  const flags = new THREE.Group();
  scene.add(flags);
  const ripples = [];

  function labelSprite(text, color) {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = color;
    g.beginPath(); g.roundRect(8, 8, 112, 48, 24); g.fill();
    g.fillStyle = '#05070a';
    g.font = '700 30px system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, 64, 34);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
    sp.scale.set(1.1, 0.55, 1);
    return sp;
  }

  // ---- snow ---------------------------------------------------------------------------------
  const SNOW = 1200;
  const snowGeo = new THREE.BufferGeometry();
  const sp = new Float32Array(SNOW * 3);
  for (let i = 0; i < SNOW; i++) { sp[i * 3] = Math.random() * 40 - 20; sp[i * 3 + 1] = Math.random() * 14; sp[i * 3 + 2] = Math.random() * 40 - 20; }
  snowGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  const snow = new THREE.Points(snowGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.06, transparent: true, opacity: 0.7, depthWrite: false }));
  snow.frustumCulled = false;
  scene.add(snow);

  // ---- map ---------------------------------------------------------------------------------
  function buildMap(w) {
    world = w;
    if (mapGroup) { scene.remove(mapGroup); mapGroup.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); }); }
    for (const f of [...flags.children]) flags.remove(f);
    flagById.clear();
    mapGroup = new THREE.Group();
    reveal.length = 0;
    revealOf.clear();
    const { W, H, ground } = world;
    revealedCells = new Uint8Array(W * H);
    // ground: a canvas texture, dark where the creature has never looked
    const cv = document.createElement('canvas');
    cv.width = W * S; cv.height = H * S;
    groundCtx = cv.getContext('2d');
    groundCtx.fillStyle = '#020304';
    groundCtx.fillRect(0, 0, cv.width, cv.height);
    groundDrawn = new Int8Array(W * H).fill(-1);
    groundTex = new THREE.CanvasTexture(cv);
    groundTex.colorSpace = THREE.SRGBColorSpace;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.95 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(W / 2, 0, H / 2);
    mapGroup.add(floor);
    const outside = new THREE.Mesh(new THREE.PlaneGeometry(W + 60, H + 60), new THREE.MeshStandardMaterial({ color: 0x07090c, roughness: 1 }));
    outside.rotation.x = -Math.PI / 2; outside.position.set(W / 2, -0.02, H / 2);
    mapGroup.add(outside);

    // obstacles as instanced meshes, every instance hidden (scale 0) until the creature sees it
    const cellsOf = (type) => { const out = []; for (let i = 0; i < W * H; i++) if (ground[i] === type) out.push(i); return out; };
    const snowMat = new THREE.MeshStandardMaterial({ color: 0xc6d0da, roughness: 0.95 });
    const parts = [];
    const add = (geo, mat, cells, place) => {
      const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, cells.length));
      cells.forEach((i, j) => {
        const x = i % W; const y = Math.floor(i / W);
        const p = new THREE.Vector3(); const q = new THREE.Quaternion(); const s = new THREE.Vector3();
        place(x, y, p, s, q);
        const slot = { mesh, j, p, q, s };
        if (!revealOf.has(i)) revealOf.set(i, []);
        revealOf.get(i).push(slot);
        tmpM.compose(p, q, new THREE.Vector3(0, 0, 0));
        mesh.setMatrixAt(j, tmpM);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mapGroup.add(mesh);
      parts.push(mesh);
    };
    const trees = cellsOf(G.TREE);
    const k = (x, y) => 0.85 + 0.4 * jitter(x, y, 1);
    const turn = (x, y, n, q) => q.setFromAxisAngle(UP, jitter(x, y, n) * 6.3);
    add(new THREE.CylinderGeometry(0.09, 0.15, 1, 7), new THREE.MeshStandardMaterial({ color: 0x3a2a1e, roughness: 1 }), trees,
      (x, y, p, s) => { const kk = k(x, y); p.set(x + 0.5, 0.6 * kk, y + 0.5); s.set(kk, 1.2 * kk, kk); });
    const pine = new THREE.MeshStandardMaterial({ color: 0x1b2d23, roughness: 0.95, flatShading: true });
    for (const [r, h, base] of [[0.62, 1.1, 1.05], [0.48, 0.95, 1.75], [0.32, 0.8, 2.4]]) {
      add(new THREE.ConeGeometry(r, h, 8), pine, trees, (x, y, p, s, q) => { const kk = k(x, y); p.set(x + 0.5, (base + h / 2) * kk, y + 0.5); s.set(kk, kk, kk); turn(x, y, 2, q); });
      add(new THREE.ConeGeometry(r * 0.72, h * 0.42, 8), snowMat, trees, (x, y, p, s, q) => { const kk = k(x, y); p.set(x + 0.5, (base + h * 0.72) * kk, y + 0.5); s.set(kk, kk, kk); turn(x, y, 2, q); });
    }
    const bushes = cellsOf(G.BUSH);
    const bushMat = new THREE.MeshStandardMaterial({ color: 0x26402e, roughness: 1, flatShading: true });
    for (const [ox, oz, r] of [[-0.18, -0.12, 0.42], [0.2, 0.05, 0.38], [-0.02, 0.22, 0.34]]) {
      add(new THREE.IcosahedronGeometry(1, 1), bushMat, bushes, (x, y, p, s, q) => { p.set(x + 0.5 + ox, r * 1.3, y + 0.5 + oz); s.set(r, r * 1.5, r); turn(x, y, 3, q); });
      add(new THREE.IcosahedronGeometry(1, 1), snowMat, bushes, (x, y, p, s, q) => { p.set(x + 0.5 + ox, r * 2.3, y + 0.5 + oz); s.set(r * 0.75, r * 0.3, r * 0.75); turn(x, y, 3, q); });
    }
    const rocks = cellsOf(G.ROCK);
    add(new THREE.DodecahedronGeometry(0.5, 0), new THREE.MeshStandardMaterial({ color: 0x5b626c, roughness: 0.95, flatShading: true }), rocks,
      (x, y, p, s, q) => { p.set(x + 0.5, 0.75, y + 0.5); s.set(1.2, 1.5, 1.2); turn(x, y, 4, q); });
    add(new THREE.DodecahedronGeometry(0.5, 0), snowMat, rocks, (x, y, p, s, q) => { p.set(x + 0.5, 1.35, y + 0.5); s.set(0.9, 0.35, 0.9); turn(x, y, 4, q); });
    const walls = cellsOf(G.WALL).filter((i) => !(i % W === W - 1 && world.doorCells.some((d) => Math.floor(d / W) === Math.floor(i / W))));
    add(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x1e242c, roughness: 1 }), walls, (x, y, p, s) => { p.set(x + 0.5, 1.1, y + 0.5); s.set(1, 2.2, 1); });

    // the hospital beyond the east wall
    const hosp = new THREE.Group();
    const dy0 = Math.floor(world.door / W);
    const hall = new THREE.Mesh(new THREE.BoxGeometry(3.4, 4.2, 7), new THREE.MeshStandardMaterial({ color: 0x6e7a86, roughness: 0.8 }));
    hall.position.set(W + 1.7, 2.1, dy0 + 1);
    const lit = new THREE.MeshBasicMaterial({ color: 0xd7f3ff });
    const doorP = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 2), lit);
    doorP.rotation.y = -Math.PI / 2; doorP.position.set(W - 0.01, 1, dy0 + 1);
    const crossMat = new THREE.MeshBasicMaterial({ color: 0x33e07a });
    const c1 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.0, 0.32), crossMat); c1.position.set(W - 0.02, 3.4, dy0 + 1);
    const c2 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.32, 1.0), crossMat); c2.position.copy(c1.position);
    const dl = new THREE.PointLight(0xd7f3ff, 4, 9, 1.2); dl.position.set(W - 1.5, 1.8, dy0 + 1);
    hosp.add(hall, doorP, c1, c2, dl);
    mapGroup.add(hosp);
    scene.add(mapGroup);
  }

  function revealCell(i, now) {
    if (revealedCells[i]) return;
    revealedCells[i] = 1;
    for (const slot of revealOf.get(i) ?? []) reveal.push({ ...slot, t0: now });
  }

  // paints newly known cells on the ground texture: snow where it has looked, red where it walked
  function paintGround(sim) {
    const { W, H } = world;
    const k = sim.creature.k;
    const g = groundCtx;
    let changed = false;
    for (let i = 0; i < W * H; i++) {
      const v = k.known[i];
      const visits = Math.min(6, k.visits[i]);
      const code = v === -1 ? -1 : v === 1 ? 10 : visits;
      if (groundDrawn[i] === code) continue;
      groundDrawn[i] = code;
      changed = true;
      const x = (i % W) * S; const y = Math.floor(i / W) * S;
      if (v === -1) continue;
      g.fillStyle = '#aeb9c4';
      g.fillRect(x, y, S, S);
      for (let n = 0; n < 3; n++) { // a little texture in the snow
        g.fillStyle = `rgba(255,255,255,${0.08 + 0.1 * jitter(i, n, 7)})`;
        g.fillRect(x + jitter(i, n, 8) * S, y + jitter(i, n, 9) * S, 3, 3);
      }
      if (v === 0 && visits > 0) { // where it has walked: a soft red smear, like a vacuum's stripes
        const grd = g.createRadialGradient(x + S / 2, y + S / 2, 0, x + S / 2, y + S / 2, S * 0.85);
        grd.addColorStop(0, `rgba(150, 20, 15, ${0.1 + 0.05 * visits})`);
        grd.addColorStop(1, 'rgba(150, 20, 15, 0)');
        g.fillStyle = grd;
        g.fillRect(x - S / 2, y - S / 2, S * 2, S * 2);
      }
      if (v === 1) { g.fillStyle = 'rgba(10, 16, 24, 0.55)'; g.beginPath(); g.arc(x + S / 2, y + S / 2 + 2, S * 0.48, 0, Math.PI * 2); g.fill(); }
    }
    if (changed) groundTex.needsUpdate = true;
  }

  const flagById = new Map();
  function syncFlags(sim) {
    const lms = sim.creature.k.landmarks;
    const COL = { start: '#cfd6de', deadend: '#ff5a4a', clearing: '#7fd1ff', exit: '#7dff9a', heard: '#ffb347', seen: '#ffd23f', caught: '#ff2a2a' };
    const ids = new Set(lms.map((l) => l.id));
    for (const [id, g] of flagById) if (!ids.has(id)) { flags.remove(g); flagById.delete(id); }
    for (const l of lms) {
      if (flagById.has(l.id)) continue;
      const g = new THREE.Group();
      const tall = l.kind === 'heard' ? 1.1 : 1.8;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, tall, 6), new THREE.MeshBasicMaterial({ color: COL[l.kind] }));
      pole.position.y = tall / 2;
      const tag = labelSprite(l.id, COL[l.kind]);
      tag.position.y = tall + 0.3;
      const base = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.42, 24), new THREE.MeshBasicMaterial({ color: COL[l.kind], side: THREE.DoubleSide, transparent: true, opacity: 0.7 }));
      base.rotation.x = -Math.PI / 2; base.position.y = 0.04;
      g.add(pole, tag, base);
      g.position.set(l.x + 0.5, 0, l.y + 0.5);
      g.userData.t0 = performance.now();
      flags.add(g);
      flagById.set(l.id, g);
    }
  }

  // ---- per tick ----------------------------------------------------------------------------
  const anim = { creature: null, survivor: null };
  let state = null;
  const pose = (n, f) => ({ x: (n % world.W) + 0.5, y: Math.floor(n / world.W) + 0.5, f });

  function onTick(sim, now, tickMs) {
    state = sim;
    for (const who of ['creature', 'survivor']) {
      const a = sim[who];
      if (!a) { anim[who] = null; continue; }
      const to = pose(a.node, a.facing);
      const cur = anim[who]?.cur ?? to;
      const jump = Math.hypot(cur.x - to.x, cur.y - to.y) > 3;
      anim[who] = { from: jump ? to : cur, to, t0: now, dur: tickMs * 0.98, cur };
    }
    const k = sim.creature.k;
    for (let i = 0; i < k.known.length; i++) if (k.known[i] !== -1 && !revealedCells[i]) revealCell(i, now);
    paintGround(sim);
    syncFlags(sim);
    // routes on the ground
    const pts = (path, h) => path.map((n) => new THREE.Vector3((n % world.W) + 0.5, h, Math.floor(n / world.W) + 0.5));
    route.geometry.dispose();
    route.geometry = new THREE.BufferGeometry().setFromPoints(pts(sim.creature.path ?? [], 0.08));
    route.computeLineDistances();
    sRoute.geometry.dispose();
    sRoute.geometry = new THREE.BufferGeometry().setFromPoints(sim.survivor ? pts(sim.survivor.path ?? [], 0.1) : []);
    sRoute.computeLineDistances();
    for (const s of sim.sounds) if (s.heard) addRipple(s.node, s.who === 'cry' ? 0xffd27a : 0xffb347, now, s.who === 'cry');
    // the cone on the snow
    const cone = k.lastCone ?? [];
    const arr = coneGeo.attributes.position.array;
    let n = 0;
    for (let j = 1; j + 1 < cone.length && n < arr.length - 9; j++) {
      arr.set([cone[0][0], 0.06, cone[0][1], cone[j][0], 0.06, cone[j][1], cone[j + 1][0], 0.06, cone[j + 1][1]], n);
      n += 9;
    }
    coneGeo.setDrawRange(0, n / 3);
    coneGeo.attributes.position.needsUpdate = true;
  }

  function addRipple(node, color, now, big) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.0, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.set((node % world.W) + 0.5, 0.1, Math.floor(node / world.W) + 0.5);
    scene.add(m);
    ripples.push({ m, t0: now, big });
  }

  // ---- camera ----------------------------------------------------------------------------
  const camPos = new THREE.Vector3(0, 30, 30);
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

  function frame(now) {
    if (!world || !state) { renderer.render(scene, camera); return; }
    const sim = state;
    const cur = (who) => {
      const a = anim[who];
      if (!a) return null;
      const t = Math.min(1, (now - a.t0) / Math.max(1, a.dur));
      let df = a.to.f - a.from.f; df = Math.atan2(Math.sin(df), Math.cos(df));
      a.cur = { x: a.from.x + (a.to.x - a.from.x) * t, y: a.from.y + (a.to.y - a.from.y) * t, f: a.from.f + df * Math.min(1, t * 1.5) };
      return a.cur;
    };
    const C = cur('creature');
    const P = cur('survivor');
    // reveal animation: trees grow out of the dark where it has looked
    for (let i = reveal.length - 1; i >= 0; i--) {
      const r = reveal[i];
      const t = Math.min(1, (now - r.t0) / 450);
      const e = 1 - (1 - t) * (1 - t);
      tmpS.copy(r.s).multiplyScalar(e);
      tmpM.compose(r.p, r.q, tmpS);
      r.mesh.setMatrixAt(r.j, tmpM);
      r.mesh.instanceMatrix.needsUpdate = true;
      if (t >= 1) reveal.splice(i, 1);
    }
    if (C) {
      creature.position.set(C.x, Math.abs(Math.sin(now / 200)) * 0.06, C.y);
      creature.rotation.y = -C.f + Math.sin(now / 320) * 0.06;
      limbs.forEach((t, i) => { if (t.userData.side) t.rotation.z = -0.12 + Math.sin(now / 180 + t.userData.side) * 0.16; else t.rotation.y = Math.sin(now / 230 + i * 1.3) * 0.13; });
      const fx = Math.cos(C.f); const fz = Math.sin(C.f);
      redEye.position.set(C.x - fx * 0.2, 2.3, C.y - fz * 0.2);
      redEye.target.position.set(C.x + fx * 8, 0, C.y + fz * 8);
      // camera: behind and above it, looking where it looks
      let df = C.f - camFacing; df = Math.atan2(Math.sin(df), Math.cos(df));
      camFacing += df * Math.min(1, 3 * Math.min(0.1, (now - (lastFrame || now)) / 1000 + 0.016));
      const target = view === 'top'
        ? new THREE.Vector3(world.W / 2, 0, world.H / 2)
        : new THREE.Vector3(C.x + Math.cos(camFacing) * 2.2, 0.5, C.y + Math.sin(camFacing) * 2.2);
      // high and steep, so the maze walls never hide it
      const pos = view === 'top'
        ? new THREE.Vector3(world.W / 2, 46, world.H / 2 + 16)
        : new THREE.Vector3(C.x - Math.cos(camFacing) * 5.2, 11.5, C.y - Math.sin(camFacing) * 5.2);
      const dt = Math.min(0.1, (now - (lastFrame || now)) / 1000);
      lastFrame = now;
      const lag = 1 - Math.exp(-dt * (view === 'top' ? 10 : 5)); // frame-rate independent follow
      camPos.lerp(pos, lag);
      camLook.lerp(target, Math.min(1, lag * 1.3));
      camera.position.copy(camPos);
      camera.lookAt(camLook);
      scene.fog.density = view === 'top' ? 0.008 : 0.035;
      // snow around the camera
      const a = snowGeo.attributes.position.array;
      for (let i = 0; i < SNOW; i++) { a[i * 3 + 1] -= 0.025 + (i % 5) * 0.004; if (a[i * 3 + 1] < 0) a[i * 3 + 1] += 14; }
      snowGeo.attributes.position.needsUpdate = true;
      snow.position.set(camLook.x, 0, camLook.z);
    }
    survivor.visible = !!P && sim.phase !== 'explore';
    torch.visible = survivor.visible;
    if (P) {
      survivor.position.set(P.x, 0, P.y);
      survivor.rotation.y = -P.f;
      const w = sim.survivor.moved ? Math.sin(now / 100) * 0.5 : 0;
      legL.rotation.z = w; legR.rotation.z = -w;
      const fx = Math.cos(P.f); const fz = Math.sin(P.f);
      torch.position.set(P.x + fx * 0.3, 1.1, P.y + fz * 0.3);
      torch.target.position.set(P.x + fx * 6, 0, P.y + fz * 6);
    }
    for (const f of flags.children) {
      const t = Math.min(1, (now - f.userData.t0) / 500);
      f.scale.setScalar(t);
    }
    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i];
      const t = (now - r.t0) / (r.big ? 1800 : 1200);
      if (t >= 1) { scene.remove(r.m); r.m.geometry.dispose(); r.m.material.dispose(); ripples.splice(i, 1); continue; }
      r.m.scale.setScalar(0.4 + t * (r.big ? 10 : 4));
      r.m.material.opacity = 0.9 * (1 - t);
    }
    renderer.render(scene, camera);
  }

  // the cell under a click on the 3D view (the snow plane)
  const ray = new THREE.Raycaster();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  function pickCell(clientX, clientY) {
    if (!world) return null;
    const r = renderer.domElement.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), camera);
    const hit = new THREE.Vector3();
    if (!ray.ray.intersectPlane(plane, hit)) return null;
    const x = Math.floor(hit.x); const y = Math.floor(hit.z);
    if (x < 0 || y < 0 || x >= world.W || y >= world.H) return null;
    return y * world.W + x;
  }

  return {
    buildMap,
    onTick,
    frame,
    pickCell,
    setView(v) { view = v; },
    getView: () => view,
    reset() { anim.creature = null; anim.survivor = null; state = null; },
    debug: () => ({ creature: creature.position.toArray(), cam: camera.position.toArray(), look: camLook.toArray(), anim: anim.creature && anim.creature.cur }),
  };
}
