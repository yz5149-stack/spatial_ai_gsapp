// The place as a point cloud, with the simulation on top (three.js).
//
// The cloud is generated from the city's survey, the way a laser scan would see it: points on every
// wall and roof of the NYC building footprints (surveyed roof heights), on the ground (surveyed
// elevation points, coloured by surface: roadway, sidewalk, lawn, yard), and in the crowns of the
// street trees. It is not a raw LiDAR scan.
//
// On top: rats (glowing arrows, red when they run, with trails), inspectors (beacons with the fan of
// their flashlight), trash bags and bins, bait stations, burrows, sidewalk sheds, street lights at
// night; pop-ups where things happen; rings of smell around a bag you drop. Agents are drawn much
// larger than life so they can be followed from above.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { layerValues } from './plan.js';
import { S, G } from '../sim/city.js';

const GRID_TURN = (29 * Math.PI) / 180;   // Manhattan's grid runs 29° east of true north: turn it upright

const hex = (h) => new THREE.Color(h);
const COL = {
  road: hex('#12304a'), side: hex('#2a7aa0'), lawn: hex('#1c8a5c'), yard: hex('#2c5a3c'), plaza: hex('#3a7f9c'), other: hex('#0c1a26'),
  wallLow: hex('#0a3350'), wallHigh: hex('#55e4ff'), roof: hex('#7fdcf0'), edge: hex('#d8fbff'), tree: hex('#3ee0a0'), lamp: hex('#fff1b8'),
  rat: hex('#ff6a3d'), flee: hex('#ff3d5a'), poison: hex('#b98bff'), ins: hex('#4de1ff'), chase: hex('#ffd34d'),
};

function dotTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.35, 'rgba(255,255,255,0.85)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function makeCloud(el, city, { onPick = null } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setClearColor(0x04060a, 1);
  el.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x04060a, 0.00055);
  const camera = new THREE.PerspectiveCamera(42, 1, 1, 8000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.08; controls.maxPolarAngle = Math.PI * 0.47; controls.minDistance = 20; controls.maxDistance = 2600;

  const { W, H, cellM } = city;
  const world = new THREE.Group(); world.rotation.y = GRID_TURN; scene.add(world);
  let e0 = Infinity; for (const i of city.nodes) e0 = Math.min(e0, city.elev[i]);
  const cx = (W * cellM) / 2; const cz = (H * cellM) / 2;
  const X = (gx) => gx * cellM - cx; const Z = (gy) => gy * cellM - cz;
  const elevAt = (gx, gy) => { const x = Math.max(0, Math.min(W - 1, Math.floor(gx))); const y = Math.max(0, Math.min(H - 1, Math.floor(gy))); return city.elev[y * W + x] - e0; };
  const cellXZ = (cell) => [(cell % W) + 0.5, Math.floor(cell / W) + 0.5];
  const v3 = (gx, gy, lift = 0) => new THREE.Vector3(X(gx), elevAt(gx, gy) + lift, Z(gy));

  // ---- the point cloud ----------------------------------------------------------------------------
  const dot = dotTexture();
  const pos = []; const col = [];
  const push = (x, y, z, c, k = 1) => { pos.push(x, y, z); col.push(c.r * k, c.g * k, c.b * k); };
  const rnd = (() => { let s = 1234567; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
  // ground: 3 x 3 points per cell (2 m apart), jittered like a scan
  const ground = []; // [pointIndex, cell] for recolouring by layer
  const groundBase = [];
  for (let i = 0; i < city.N; i++) {
    const gx = i % W; const gy = Math.floor(i / W);
    if (city.ground[i] === G.BLDG) continue;
    let c = COL.other; let k = 0.6;
    if (city.walk[i]) {
      if (city.road[i]) c = COL.road;
      else if (city.wall[i]) c = COL.side;
      else if (city.surface[i] === S.LAWN || city.surface[i] === S.WOODS) c = COL.lawn;
      else if (city.surface[i] === S.YARD) c = COL.yard;
      else c = COL.plaza;
      k = 1.25;
    }
    const n = city.walk[i] ? 3 : 2;
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
      const fx = gx + (a + 0.5 + (rnd() - 0.5) * 0.5) / n; const fy = gy + (b + 0.5 + (rnd() - 0.5) * 0.5) / n;
      ground.push(pos.length / 3, i); groundBase.push(c.r * k, c.g * k, c.b * k);
      push(X(fx), elevAt(fx, fy) + (rnd() - 0.5) * 0.15, Z(fy), c, k);
    }
  }
  // buildings: walls every 1.8 m around and 2 m up, roofs every 3 m, roof edges brighter
  for (const b of city.buildings) {
    const g = b.g; if (!g || g.length < 3 || !b.h) continue;
    const inside = g.some(([x, y]) => x >= 0 && y >= 0 && x <= W && y <= H);
    if (!inside) continue;
    const base = (b.ground != null ? b.ground : city.elev[b.cells[0] ?? 0]) - e0;
    const h = Math.max(3, b.h);
    for (let k = 0; k < g.length; k++) {
      const [ax, ay] = g[k]; const [bx, by] = g[(k + 1) % g.length];
      const L = Math.hypot(bx - ax, by - ay) * cellM; const n = Math.max(1, Math.round(L / 1.8));
      for (let s = 0; s < n; s++) {
        const t = s / n; const gx = ax + (bx - ax) * t; const gy = ay + (by - ay) * t;
        if (gx < 0 || gy < 0 || gx > W || gy > H) continue;
        for (let z = 0; z <= h; z += 2) {
          const f = z / h; const c = COL.wallLow.clone().lerp(COL.wallHigh, f * f);
          push(X(gx) + (rnd() - 0.5) * 0.3, base + z + (rnd() - 0.5) * 0.3, Z(gy) + (rnd() - 0.5) * 0.3, c, 0.55 + 0.45 * f);
        }
        push(X(gx), base + h, Z(gy), COL.edge, 1);
      }
    }
    // roof fill
    let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
    for (const [x, y] of g) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    const step = 3 / cellM;
    for (let y = minY; y <= maxY; y += step) for (let x = minX; x <= maxX; x += step) {
      if (x < 0 || y < 0 || x > W || y > H) continue;
      let c = false;
      for (let i = 0, j = g.length - 1; i < g.length; j = i++) { const [xi, yi] = g[i]; const [xj, yj] = g[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; }
      if (c) push(X(x + (rnd() - 0.5) * step * 0.4), base + h, Z(y + (rnd() - 0.5) * step * 0.4), COL.roof, 0.6);
    }
  }
  // street trees: a ball of points 5-9 m up
  for (const c of city.trees) {
    const [gx, gy] = cellXZ(c); const base = elevAt(gx, gy);
    for (let k = 0; k < 46; k++) {
      const u = rnd() * Math.PI * 2; const v = Math.acos(2 * rnd() - 1); const r = 2.6 * Math.cbrt(rnd());
      push(X(gx) + r * Math.sin(v) * Math.cos(u), base + 7 + r * Math.cos(v) * 0.8, Z(gy) + r * Math.sin(v) * Math.sin(u), COL.tree, 0.55 + rnd() * 0.4);
    }
    for (let z = 0; z < 5; z += 1) push(X(gx), base + z, Z(gy), COL.tree, 0.35);
  }
  const cloudGeo = new THREE.BufferGeometry();
  cloudGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const colorAttr = new THREE.Float32BufferAttribute(col, 3);
  cloudGeo.setAttribute('color', colorAttr);
  const cloudMat = new THREE.PointsMaterial({ size: 1.7, sizeAttenuation: true, vertexColors: true, map: dot, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const cloud = new THREE.Points(cloudGeo, cloudMat);
  world.add(cloud);
  const pointCount = pos.length / 3;

  // street lights (shown at night)
  const lampPos = [];
  for (const c of city.poles) { const [gx, gy] = cellXZ(c); lampPos.push(X(gx), elevAt(gx, gy) + 6, Z(gy)); }
  const lampGeo = new THREE.BufferGeometry(); lampGeo.setAttribute('position', new THREE.Float32BufferAttribute(lampPos, 3));
  const lamps = new THREE.Points(lampGeo, new THREE.PointsMaterial({ size: 5, color: COL.lamp, map: dot, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending }));
  world.add(lamps);

  // an invisible ground surface, for clicks
  const gGeo = new THREE.PlaneGeometry(W * cellM, H * cellM, W, H); gGeo.rotateX(-Math.PI / 2);
  const gp = gGeo.attributes.position;
  for (let k = 0; k < gp.count; k++) { const gx = (gp.getX(k) + cx) / cellM; const gy = (gp.getZ(k) + cz) / cellM; gp.setY(k, elevAt(gx, gy)); }
  const pickMesh = new THREE.Mesh(gGeo, new THREE.MeshBasicMaterial({ visible: false }));
  world.add(pickMesh);

  // ---- agents and things ----------------------------------------------------------------------------
  const glowTex = dot;
  const makeGlow = (color, size) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); s.scale.set(size, size, 1); return s; };
  const ratGeo = new THREE.ConeGeometry(1.1, 3.6, 12); ratGeo.rotateZ(-Math.PI / 2);
  const rats = new Map();
  function ratMesh(r) {
    let m = rats.get(r.id);
    if (m) return m;
    const grp = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: COL.rat });
    const body = new THREE.Mesh(ratGeo, mat); body.position.y = 1.2; grp.add(body);
    const glow = makeGlow(COL.rat, 9); glow.position.y = 1.2; grp.add(glow);
    const tGeo = new THREE.BufferGeometry(); tGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(30 * 3), 3)); tGeo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(30 * 3), 3));
    const trail = new THREE.Line(tGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending }));
    world.add(grp); world.add(trail);
    m = { grp, body, mat, glow, trail, hist: [] };
    rats.set(r.id, m);
    return m;
  }
  const inspectors = new Map();
  function insMesh(ins, C) {
    let m = inspectors.get(ins.id);
    if (m) return m;
    const grp = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: COL.ins });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.3, 4.2, 16), mat); body.position.y = 2.1; grp.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(1.1, 16, 12), mat); head.position.y = 5; grp.add(head);
    const glow = makeGlow(COL.ins, 16); glow.position.y = 3; grp.add(glow);
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 60, 6), new THREE.MeshBasicMaterial({ color: COL.ins, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
    pillar.position.y = 30; grp.add(pillar);
    const half = (C.beamDeg * Math.PI) / 360;
    const bGeo = new THREE.CircleGeometry(C.beam * cellM, 32, -half, 2 * half); bGeo.rotateX(-Math.PI / 2);
    const beamMat = new THREE.MeshBasicMaterial({ color: COL.chase, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
    const beam = new THREE.Mesh(bGeo, beamMat); beam.position.y = 0.8; grp.add(beam);
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: COL.chase }));
    world.add(grp); world.add(line);
    m = { grp, mat, glow, beam, beamMat, line, pillar };
    inspectors.set(ins.id, m);
    return m;
  }

  // instanced things: bags, bins, stations, burrows
  const boxGeo = new THREE.BoxGeometry(1.6, 1.6, 1.6);
  const inst = (geo, color, n) => { const m = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color }), n); m.count = 0; m.frustumCulled = false; world.add(m); return m; };
  const bags = inst(boxGeo, hex('#ffd34d'), 800);
  const bins = inst(new THREE.CylinderGeometry(0.8, 0.8, 1.6, 10), hex('#5fe3a1'), 800);
  const stations = inst(new THREE.BoxGeometry(2.2, 1.0, 1.4), hex('#b98bff'), 200);
  const ringGeo = new THREE.RingGeometry(2.2, 3.2, 32); ringGeo.rotateX(-Math.PI / 2);
  const burrows = inst(ringGeo, hex('#ff5a3c'), 200);
  const bigBagGeo = new THREE.BoxGeometry(3.2, 3.2, 3.2);
  const userBags = inst(bigBagGeo, hex('#ffe680'), 50);
  const M4 = new THREE.Matrix4();
  const place = (im, k, x, y, z) => { M4.makeTranslation(x, y, z); im.setMatrixAt(k, M4); };

  // sheds: lines along the building fronts, 3.5 m up
  let shedLines = null; let lastDesign = null;
  function buildSheds(sim) {
    if (shedLines) { world.remove(shedLines); shedLines.geometry.dispose(); }
    const p = []; const c = [];
    for (const sh of sim.sheds) {
      if (sh.type === 'gone') continue;
      const color = sh.type === 'old' ? hex('#4de1ff') : hex('#e6f7ff');
      for (const cell of sh.cells) { const [gx, gy] = cellXZ(cell); const y = elevAt(gx, gy) + 3.5; p.push(X(gx - 0.5), y, Z(gy), X(gx + 0.5), y, Z(gy), X(gx), y, Z(gy - 0.5), X(gx), y, Z(gy + 0.5)); for (let k = 0; k < 4; k++) c.push(color.r, color.g, color.b); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
    shedLines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 }));
    world.add(shedLines);
    lastDesign = sim.design;
  }

  // the selected agent: trail, plan, nose
  const selLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: hex('#ffffff'), transparent: true, opacity: 0.85 }));
  const planLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: hex('#ffffff'), dashSize: 3, gapSize: 2 }));
  const noseRing = new THREE.Mesh(new THREE.RingGeometry(1, 1.04, 96).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: COL.chase, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false }));
  world.add(selLine, planLine, noseRing);
  // routes of rats heading for the bag you dropped
  const bagRoutes = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: COL.chase, dashSize: 2.5, gapSize: 2 }));
  world.add(bagRoutes);

  // rings: things that happened, and smell around a bag
  const rings = [];
  function addRing(cell, color, from, to, ms, repeat = 1, delay = 0) {
    const [gx, gy] = cellXZ(cell);
    for (let k = 0; k < repeat; k++) {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 72).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
      m.position.set(X(gx), elevAt(gx, gy) + 0.6, Z(gy));
      world.add(m);
      rings.push({ m, t0: performance.now() + k * delay, from, to, ms });
    }
  }
  function updateRings(now) {
    for (let k = rings.length - 1; k >= 0; k--) {
      const r = rings[k]; const t = (now - r.t0) / r.ms;
      if (t < 0) { r.m.visible = false; continue; }
      r.m.visible = true;
      if (t >= 1) { world.remove(r.m); r.m.geometry.dispose(); rings.splice(k, 1); continue; }
      const s = r.from + (r.to - r.from) * (1 - (1 - t) ** 2);
      r.m.scale.set(s, 1, s); r.m.material.opacity = 0.9 * (1 - t);
    }
  }

  // ---- HTML labels and pop-ups ----------------------------------------------------------------------
  const labelsEl = document.getElementById('labels');
  const labelPool = new Map();
  const tmp = new THREE.Vector3();
  function project(v) { tmp.copy(v); world.localToWorld(tmp); tmp.project(camera); if (tmp.z > 1) return null; const r = renderer.domElement.getBoundingClientRect(); return [((tmp.x + 1) / 2) * r.width, ((1 - tmp.y) / 2) * r.height]; }
  function label(key, v, text, cls) {
    let el = labelPool.get(key);
    if (!el) { el = document.createElement('div'); labelsEl.append(el); labelPool.set(key, el); }
    el.used = true;
    const p = project(v);
    if (!p) { el.style.display = 'none'; return; }
    el.style.display = ''; el.className = cls; el.textContent = text;
    el.style.left = `${p[0]}px`; el.style.top = `${p[1]}px`;
  }
  const pops = [];
  function pop(f) {
    const [gx, gy] = cellXZ(f.cell);
    const el = document.createElement('div');
    const kind = f.burrow ? 'burrow' : f.kind;
    el.className = `pop ${kind}`;
    el.textContent = { spot: 'SPOTTED', caught: 'CAUGHT', missed: f.burrow ? 'GOT AWAY · BURROW FOUND' : 'GOT AWAY', dodge: 'DODGED', bag: 'TRASH DROPPED' }[f.kind] ?? f.kind;
    labelsEl.append(el);
    pops.push({ el, v: v3(gx, gy, 7), t0: performance.now() });
    const color = { spot: COL.chase, caught: hex('#5fe3a1'), missed: hex('#c9d6e6'), dodge: hex('#ffb08a'), bag: COL.chase }[f.kind] ?? COL.chase;
    if (f.kind !== 'bag') addRing(f.cell, f.burrow ? COL.rat : color, 2, 22, 1400);
  }
  function updatePops(now) {
    for (let k = pops.length - 1; k >= 0; k--) {
      const p = pops[k];
      if (now - p.t0 > 2600) { p.el.remove(); pops.splice(k, 1); continue; }
      const q = project(p.v); if (!q) { p.el.style.display = 'none'; continue; }
      p.el.style.display = ''; p.el.style.left = `${q[0]}px`; p.el.style.top = `${q[1]}px`;
    }
  }

  // ---- ground layer: recolour the ground points ----------------------------------------------------
  let layerAt = 0; let lastLayer = null;
  function updateLayer(sim, layer, now) {
    if (layer === lastLayer && now - layerAt < 1500) return;
    layerAt = now; lastLayer = layer;
    const L = layerValues(sim, layer);
    const arr = colorAttr.array;
    let max = 0; if (L) for (let i = 0; i < L.v.length; i++) if (L.v[i] > max) max = L.v[i];
    for (let k = 0, j = 0; k < ground.length; k += 2, j += 3) {
      const p = ground[k] * 3; const cell = ground[k + 1];
      let r = groundBase[j]; let g = groundBase[j + 1]; let b = groundBase[j + 2];
      if (L && max > 0 && L.v[cell] > 0) {
        const t = Math.min(1, Math.sqrt(L.v[cell] / max) * L.gain);
        if (t > 0.08) { const k2 = 0.25 + 1.2 * t; r = r * (1 - t) + (L.c[0] / 255) * k2 * t; g = g * (1 - t) + (L.c[1] / 255) * k2 * t; b = b * (1 - t) + (L.c[2] / 255) * k2 * t; }
      }
      arr[p] = r; arr[p + 1] = g; arr[p + 2] = b;
    }
    colorAttr.needsUpdate = true;
  }

  // ---- camera --------------------------------------------------------------------------------------
  let view = 'auto'; let following = false;
  const home = { target: new THREE.Vector3(0, 10, 0), offset: new THREE.Vector3(-260, 520, 560) };
  function overview(instant = false) {
    flyTo(home.target.clone(), home.target.clone().add(home.offset), instant);
  }
  let fly = null;
  function flyTo(target, position, instant = false) {
    if (instant) { controls.target.copy(target); camera.position.copy(position); controls.update(); fly = null; return; }
    fly = { t0: performance.now(), ms: 1200, fromT: controls.target.clone(), fromP: camera.position.clone(), toT: target, toP: position };
  }
  overview(true);
  const worldPos = (gx, gy, lift = 0) => { const v = v3(gx, gy, lift); world.localToWorld(v); return v; };
  function focusOn(cell, dist = 140) {
    const [gx, gy] = cellXZ(cell); const t = worldPos(gx, gy, 2);
    const dir = camera.position.clone().sub(controls.target).normalize();
    flyTo(t, t.clone().add(dir.multiplyScalar(dist)));
  }

  function resize() {
    const r = el.getBoundingClientRect();
    renderer.setSize(r.width, r.height, false);
    renderer.domElement.style.width = `${r.width}px`; renderer.domElement.style.height = `${r.height}px`;
    camera.aspect = r.width / Math.max(1, r.height); camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize); resize();

  // clicks: the ground cell under the pointer (a short drag is still a click)
  const ray = new THREE.Raycaster(); const ndc = new THREE.Vector2(); let downAt = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObject(pickMesh)[0];
    if (!hit) return;
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

  function frame(sim, { layer, selected, now, hourFrac, frac = 1, follow = null }) {
    if (sim.design !== lastDesign) buildSheds(sim);
    updateLayer(sim, layer, now);
    const night = hourFrac >= 19.5 || hourFrac < 5.5 ? 1 : hourFrac >= 17.5 ? (hourFrac - 17.5) / 2 : hourFrac < 7 ? (7 - hourFrac) / 1.5 : 0;
    const n = Math.max(0, Math.min(1, night));
    cloudMat.color.setRGB(1 - 0.35 * n, 1 - 0.28 * n, 1 - 0.05 * n);
    lamps.material.opacity = 0.75 * n; lamps.visible = n > 0.05;
    for (const el of labelPool.values()) el.used = false;

    // things
    let nb = 0; let nbin = 0; let nub = 0;
    for (const s of sim.sources) {
      const [gx, gy] = cellXZ(s.cell); const y = elevAt(gx, gy);
      if (s.kind === 'bag') {
        if (!bagsSeen.has(s.id)) { bagsSeen.add(s.id); addRing(s.cell, COL.chase, 4, sim.cfg.rat.smell * cellM, 2400, 4, 600); }
        if (s.amt > 0.05 && nub < 50) place(userBags, nub++, X(gx), y + 1.6, Z(gy));
      } else if (s.amt > 0.05 && s.kind !== 'basket' && nb < 800) place(bags, nb++, X(gx), y + 0.8, Z(gy));
      else if (s.binned && s.isOut && nbin < 800) place(bins, nbin++, X(gx), y + 0.8, Z(gy));
    }
    bags.count = nb; bins.count = nbin; userBags.count = nub;
    bags.instanceMatrix.needsUpdate = true; bins.instanceMatrix.needsUpdate = true; userBags.instanceMatrix.needsUpdate = true;
    let ns = 0; for (const st of sim.stations) { const [gx, gy] = cellXZ(st.cell); if (ns < 200) place(stations, ns++, X(gx), elevAt(gx, gy) + 0.5, Z(gy)); }
    stations.count = ns; stations.instanceMatrix.needsUpdate = true;
    let nbu = 0; for (const c of sim.colonies) if (c.alive) { const [gx, gy] = cellXZ(c.home); if (nbu < 200) place(burrows, nbu++, X(gx), elevAt(gx, gy) + 0.3, Z(gy)); }
    burrows.count = nbu; burrows.instanceMatrix.needsUpdate = true;

    // rats
    const live = new Set();
    const bagCells = new Set(sim.sources.filter((s) => s.kind === 'bag' && s.amt > 0.05).map((s) => s.cell));
    const routePts = [];
    for (const r of sim.rats) {
      if (!r.alive || r.mode === 'home') continue;
      live.add(r.id);
      const m = ratMesh(r);
      const [gx, gy] = along(r, frac);
      const p = v3(gx, gy, 0);
      m.grp.position.copy(p); m.grp.rotation.y = -r.facing; m.grp.visible = true;
      const color = r.deathAt >= 0 ? COL.poison : r.mode === 'flee' ? COL.flee : COL.rat;
      m.mat.color.copy(color); m.glow.material.color.copy(color);
      const big = selected === r ? 1.6 : 1;
      m.body.scale.setScalar(big); m.glow.scale.setScalar((r.mode === 'flee' ? 13 : 9) * big);
      // trail
      const lastP = m.hist[m.hist.length - 1];
      if (lastP && lastP.distanceToSquared(p) > 30 * 30) m.hist.length = 0;      // it was home, or time jumped: start a new trail
      if (!m.hist.length || m.hist[m.hist.length - 1].distanceToSquared(p) > 0.5) { m.hist.push(p.clone().setY(p.y + 0.6)); if (m.hist.length > 30) m.hist.shift(); }
      const ta = m.trail.geometry.attributes.position; const tc = m.trail.geometry.attributes.color;
      for (let k = 0; k < 30; k++) { const q = m.hist[Math.max(0, m.hist.length - 30 + k)] ?? p; ta.setXYZ(k, q.x, q.y, q.z); const f = k / 29; tc.setXYZ(k, color.r * f, color.g * f, color.b * f); }
      ta.needsUpdate = true; tc.needsUpdate = true; m.trail.visible = true; m.trail.geometry.computeBoundingSphere();
      if (bagCells.has(r.target) && r.path) {
        label(`bang${r.id}`, v3(gx, gy, 6), '!', 'bang');
        for (let k = r.pi; k < r.path.length - 1; k++) { const [ax, ay] = cellXZ(r.path[k]); const [bx, by] = cellXZ(r.path[k + 1]); routePts.push(v3(ax, ay, 0.8), v3(bx, by, 0.8)); }
      }
      if (selected === r) label('selrat', v3(gx, gy, 8), `RAT #${r.id}`, 'lab sel');
    }
    for (const [id, m] of rats) if (!live.has(id)) { m.grp.visible = false; m.trail.visible = false; m.hist.length = 0; }
    bagRoutes.geometry.dispose(); bagRoutes.geometry = new THREE.BufferGeometry().setFromPoints(routePts); bagRoutes.computeLineDistances();

    // inspectors
    const C = sim.cfg.inspector;
    for (const ins of sim.inspectors) {
      const m = insMesh(ins, C);
      const on = ins.mode !== 'off' && ins.mode !== 'done';
      m.grp.visible = on; m.line.visible = false;
      if (!on) continue;
      const [gx, gy] = along(ins, frac);
      m.grp.position.copy(v3(gx, gy, 0));
      m.beam.rotation.y = -ins.facing;
      const chasing = ins.mode === 'chase';
      m.mat.color.copy(chasing ? COL.chase : COL.ins); m.glow.material.color.copy(chasing ? COL.chase : COL.ins); m.pillar.material.color.copy(chasing ? COL.chase : COL.ins);
      m.beamMat.opacity = chasing ? 0.42 : 0.16 + 0.12 * n;
      if (chasing && ins.chase?.rat?.alive) {
        const [rx, ry] = along(ins.chase.rat, frac);
        m.line.geometry.setFromPoints([v3(gx, gy, 3), v3(rx, ry, 1.2)]); m.line.visible = true;
      }
      label(`ins${ins.id}`, v3(gx, gy, 9), chasing ? `${ins.name.toUpperCase()} · CHASING` : ins.name.toUpperCase(), `lab ins${chasing ? ' chase' : ''}${selected === ins ? ' sel' : ''}`);
    }

    // selected: trail, plan, nose
    selLine.visible = planLine.visible = noseRing.visible = false;
    if (selected && selected.trail?.length > 1) {
      selLine.geometry.dispose(); selLine.geometry = new THREE.BufferGeometry().setFromPoints(selected.trail.slice(-160).map((c) => { const [x, y] = cellXZ(c); return v3(x, y, 0.9); }));
      selLine.material.color.copy(selected.kind === 'rat' ? COL.rat : COL.ins); selLine.visible = true;
      if (selected.path && selected.path.length > 1) {
        planLine.geometry.dispose(); planLine.geometry = new THREE.BufferGeometry().setFromPoints(selected.path.slice(selected.pi ?? 0).map((c) => { const [x, y] = cellXZ(c); return v3(x, y, 1); }));
        planLine.computeLineDistances(); planLine.visible = true;
      }
      if (selected.kind === 'rat' && selected.alive && selected.mode !== 'home') {
        const [gx, gy] = along(selected, frac); const R = sim.cfg.rat.smell * cellM;
        noseRing.position.copy(v3(gx, gy, 0.7)); noseRing.scale.set(R, 1, R); noseRing.visible = true;
      }
    }

    // pop-ups
    for (const f of sim.fx) if (f.seq > fxSeen) pop(f);
    fxSeen = sim.fxSeq;
    updatePops(now); updateRings(now);
    for (const [k, el] of labelPool) if (!el.used) { el.remove(); labelPool.delete(k); }

    // camera
    if (fly) {
      const t = Math.min(1, (now - fly.t0) / fly.ms); const e = t * t * (3 - 2 * t);
      controls.target.lerpVectors(fly.fromT, fly.toT, e); camera.position.lerpVectors(fly.fromP, fly.toP, e);
      if (t >= 1) fly = null;
    }
    const target = follow ?? (view === 'follow' ? selected : null);
    if (target && !fly) {
      const [gx, gy] = along(target, frac);
      const tp = worldPos(gx, gy, 2);
      const delta = tp.clone().sub(controls.target);
      controls.target.add(delta.multiplyScalar(0.18));
      const dir = camera.position.clone().sub(controls.target);
      const want = follow ? 110 : 150;
      const d = dir.length(); const nd = d + (want - d) * 0.06;
      camera.position.copy(controls.target).add(dir.normalize().multiplyScalar(nd));
      following = true;
    } else following = false;
    controls.update();
    renderer.render(scene, camera);
  }

  return {
    frame, focusOn, pointCount,
    setView: (v) => { view = v; if (v === 'city') overview(); },
    invalidate: () => {
      for (const m of rats.values()) { world.remove(m.grp); world.remove(m.trail); }
      rats.clear(); fxSeen = 0; bagsSeen.clear(); lastDesign = null;
      for (const p of pops) p.el.remove(); pops.length = 0;
    },
  };
}
