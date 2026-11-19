// The place as an architectural axonometric drawing (three.js, orthographic camera): white building
// volumes with black edges and grey shade, the ground drawn by surface (roadway, sidewalk, lawn,
// yard), street names written on the streets, street trees. On it: rats (body, head, ears, tail,
// running), inspectors (people in hi-vis vests, walking, with the fan of their flashlight), trash
// bags and bins, bait stations, burrows, sidewalk sheds. Agents are drawn a little larger than life.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { layerValues } from './plan.js?v=13';
import { S, G } from '../sim/city.js?v=13';

const GRID_TURN = (29 * Math.PI) / 180;   // Manhattan's grid runs 29° east of true north: turn it square
const PAPER = 0xf3f2ee;
const INK = 0x1d1f22;

function edges(mesh, color = INK, threshold = 25) {
  const e = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, threshold), new THREE.LineBasicMaterial({ color }));
  mesh.add(e);
  return e;
}

// ---- a rat: about 1.1 m long here (drawn 3x larger than life) -------------------------------------
// a car: body, cabin, wheels, head and tail lights; drawn along +x
const CAR_COLORS = [0xf2c230, 0xf2c230, 0x2e3440, 0xe8e6e1, 0x8c95a3, 0x9b2f2f, 0x2f4f7a, 0x1f1f22]; // yellow cabs, then the rest
function makeCar(k) {
  const g = new THREE.Group();
  const paint = new THREE.MeshLambertMaterial({ color: CAR_COLORS[k % CAR_COLORS.length] });
  const glass = new THREE.MeshLambertMaterial({ color: 0x2b3442 });
  const tyre = new THREE.MeshLambertMaterial({ color: 0x1b1b1d });
  const body = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.9, 1.8), paint); body.position.y = 0.75; edges(body, INK, 30); g.add(body);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.75, 1.6), glass); cab.position.set(-0.25, 1.55, 0); edges(cab, INK, 30); g.add(cab);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.12, 1.62), paint); roof.position.set(-0.3, 1.95, 0); g.add(roof);
  for (const [x, z] of [[1.35, 0.85], [1.35, -0.85], [-1.35, 0.85], [-1.35, -0.85]]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.28, 14).rotateX(Math.PI / 2), tyre); w.position.set(x, 0.38, z); g.add(w); }
  const headMat = new THREE.MeshBasicMaterial({ color: 0xfff1c4 }); const tailMat = new THREE.MeshBasicMaterial({ color: 0xff3b2f });
  for (const z of [0.6, -0.6]) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.22, 0.4), headMat); h.position.set(2.21, 0.85, z); g.add(h);
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.2, 0.36), tailMat); t.position.set(-2.21, 0.85, z); g.add(t);
  }
  // headlight beams on the road, at night
  const shape = new THREE.Shape([new THREE.Vector2(2.2, 0.8), new THREE.Vector2(13, 3.4), new THREE.Vector2(13, -3.4), new THREE.Vector2(2.2, -0.8)]);
  const beamMat = new THREE.MeshBasicMaterial({ color: 0xfff0b8, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  const beam = new THREE.Mesh(new THREE.ShapeGeometry(shape).rotateX(Math.PI / 2), beamMat); beam.position.y = 0.12; g.add(beam);
  return { g, beamMat };
}

// a cat: ginger or black, sits or walks; drawn along +x
function makeCat(k) {
  const g = new THREE.Group();
  const fur = new THREE.MeshLambertMaterial({ color: [0xd98b3a, 0x2a2626, 0xe8e2d6, 0x8d8580][k % 4] });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.5, 14, 10), fur); body.scale.set(1.5, 0.75, 0.7); body.position.y = 0.75; edges(body, INK, 40); g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 14, 10), fur); head.position.set(0.85, 1.15, 0); edges(head, INK, 40); g.add(head);
  for (const z of [-0.17, 0.17]) { const ear = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.24, 8), fur); ear.position.set(0.85, 1.5, z); g.add(ear); }
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xc8f04a });
  for (const z of [-0.12, 0.12]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), eyeMat); e.position.set(1.15, 1.2, z); g.add(e); }
  const tail = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(-0.7, 0.8, 0), new THREE.Vector3(-1.1, 1.1, 0.1), new THREE.Vector3(-1.2, 1.6, -0.1)]), 10, 0.07, 6), fur); g.add(tail);
  const legs = [];
  for (const [x, z] of [[0.45, 0.2], [0.45, -0.2], [-0.45, 0.2], [-0.45, -0.2]]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.5, 0.13), fur); l.position.set(x, 0.25, z); g.add(l); legs.push(l); }
  const halo = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.3, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x7d5bb5, transparent: true, opacity: 0.85, depthWrite: false }));
  halo.position.y = 0.05; g.add(halo);
  return { g, body, head, tail, legs };
}

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
  const halo = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.25, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff7a3c, transparent: true, opacity: 0.9, depthWrite: false }));
  halo.position.y = 0.05; g.add(halo);
  g.scale.setScalar(3.6);
  return { g, body, tail, legs, fur, halo };
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
  const halo = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.95, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.95, depthWrite: false }));
  halo.position.y = 0.05; g.add(halo);
  g.scale.setScalar(3.2);
  return { g, hipL, hipR, armL, armR, halo };
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
  const hemi = new THREE.HemisphereLight(0xffffff, 0xb8bcc4, 1.6); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(-300, 500, -200); scene.add(sun);
  const dusk = new THREE.AmbientLight(0xc8a8d8, 0); scene.add(dusk);   // the evening glow that keeps the brick readable

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

  // ---- buildings: coloured walls with windows that light up at night -----------------------------
  // one texture tile is 8 bays (3 m) by 8 floors (3.2 m): wall, window frames, glass. A second tile of
  // the same size says which windows are lit; six versions of it let windows switch on and off.
  const BAY = 3; const FLOOR = 3.2; const TB = 8;
  const wallTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 256, 256);
    const cw = 256 / TB;
    for (let fy = 0; fy < TB; fy++) {
      g.fillStyle = 'rgba(0,0,0,0.06)'; g.fillRect(0, fy * cw + cw - 3, 256, 3);                 // floor line
      for (let bx = 0; bx < TB; bx++) {
        const x = bx * cw + cw * 0.24; const y = fy * cw + cw * 0.2; const w = cw * 0.52; const h = cw * 0.56;
        g.fillStyle = '#5b6170'; g.fillRect(x - 1.5, y - 1.5, w + 3, h + 3);                    // frame
        g.fillStyle = '#3d4658'; g.fillRect(x, y, w, h);                                       // glass
        g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(x, y, w * 0.45, h);                  // reflection
      }
    }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    return t;
  })();
  const litTex = [];
  const rndB = (() => { let s = 99991; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
  for (let v = 0; v < 6; v++) {
    const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, 256, 256);
    const cw = 256 / TB;
    for (let fy = 0; fy < TB; fy++) for (let bx = 0; bx < TB; bx++) {
      if (rndB() > 0.26) continue;
      const warm = rndB() < 0.8;
      g.fillStyle = warm ? '#ffb85c' : '#cfe3ff';
      g.fillRect(bx * cw + cw * 0.24, fy * cw + cw * 0.2, cw * 0.52, cw * 0.56);
    }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
    litTex.push(t);
  }
  const PALETTE = { residential: [0xb86b52, 0xa45a45, 0xc98b62, 0xd9b48a, 0x9b6a58], campus: [0xc9c3b6, 0xb7b2a6, 0xd6d0c2], school: [0xc77d5a, 0xd09a6a], commercial: [0x9aa5b1, 0xb4bcc4, 0x8e99a6], other: [0xbdb5a8, 0xa9a39a] };
  const bGroup = new THREE.Group(); world.add(bGroup);
  const roofMat = new THREE.MeshLambertMaterial({ color: 0x8f8a84 });
  const lineMat = new THREE.LineBasicMaterial({ color: 0x2a2630 });
  const bMeshes = [];
  for (const b of city.buildings) {
    const g = b.g; if (!g || g.length < 3 || !b.h) continue;
    const pts = g.map(([x, y]) => [Math.max(0, Math.min(W, x)), Math.max(0, Math.min(H, y))]);
    let area = 0; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) area += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]);
    if (Math.abs(area) < 0.3) continue;
    let baseY = Infinity; for (const c of b.cells) baseY = Math.min(baseY, ground[c] - e0);
    if (!Number.isFinite(baseY)) { const [x0, y0] = pts[0]; baseY = elevAt(x0, y0); }
    const h = Math.max(3.5, b.h);
    // walls: one quad per footprint edge, windows by the metre
    const pos = []; const uv = []; const idx = []; const nrm = [];
    let u0 = rndB() * TB;
    for (let k = 0; k < pts.length; k++) {
      const [ax, ay] = pts[k]; const [bx, by] = pts[(k + 1) % pts.length];
      const x1 = X(ax); const z1 = Z(ay); const x2 = X(bx); const z2 = Z(by);
      const L = Math.hypot(x2 - x1, z2 - z1); if (L < 0.2) continue;
      const nx = (z2 - z1) / L; const nz = -(x2 - x1) / L;
      const n = pos.length / 3; const uL = L / BAY / TB; const vH = h / FLOOR / TB;
      pos.push(x1, 0, z1, x2, 0, z2, x2, h, z2, x1, h, z1);
      for (let q = 0; q < 4; q++) nrm.push(area > 0 ? -nx : nx, 0, area > 0 ? -nz : nz);
      uv.push(u0, 0, u0 + uL, 0, u0 + uL, vH, u0, vH);
      u0 += uL;
      idx.push(n, n + 1, n + 2, n, n + 2, n + 3);
    }
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); wg.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3)); wg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); wg.setIndex(idx);
    const pal = PALETTE[b.use] ?? PALETTE.other;
    const mat = new THREE.MeshLambertMaterial({ color: pal[Math.floor(rndB() * pal.length)], map: wallTex, emissive: 0xffa24a, emissiveMap: litTex[Math.floor(rndB() * litTex.length)], emissiveIntensity: 0, side: THREE.DoubleSide });
    const walls = new THREE.Mesh(wg, mat); walls.position.y = baseY; bGroup.add(walls);
    // roof
    const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(X(x), -Z(y))));
    const rg = new THREE.ShapeGeometry(shape); rg.rotateX(-Math.PI / 2);
    const roof = new THREE.Mesh(rg, roofMat); roof.position.y = baseY + h; bGroup.add(roof);
    // outlines: roof edge, base, corners
    const lp = [];
    for (let k = 0; k < pts.length; k++) {
      const [ax, ay] = pts[k]; const [bx, by] = pts[(k + 1) % pts.length];
      lp.push(X(ax), h, Z(ay), X(bx), h, Z(by), X(ax), 0, Z(ay), X(bx), 0, Z(by), X(ax), 0, Z(ay), X(ax), h, Z(ay));
    }
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
    const lines = new THREE.LineSegments(lg, lineMat); lines.position.y = baseY; bGroup.add(lines);
    bMeshes.push({ mat, lit: 0.55 + rndB() * 0.45, next: performance.now() + rndB() * 8000 });
  }
  // street lights: warm glows on poles, on at night
  const dotTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,220,150,1)'); gr.addColorStop(0.25, 'rgba(255,180,90,0.8)'); gr.addColorStop(1, 'rgba(255,150,60,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
  const lampPos = []; for (const c of city.poles) { const [gx, gy] = cellXZ(c); lampPos.push(X(gx), elevAt(gx, gy) + 6, Z(gy)); }
  const lampGeo = new THREE.BufferGeometry(); lampGeo.setAttribute('position', new THREE.Float32BufferAttribute(lampPos, 3));
  const lamps = new THREE.Points(lampGeo, new THREE.PointsMaterial({ size: 8, color: 0xffb060, map: dotTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: false }));
  world.add(lamps);
  // the sky: a gradient behind everything, from day to dusk to night
  const skyCanvas = document.createElement('canvas'); skyCanvas.width = 4; skyCanvas.height = 256;
  const skyTex = new THREE.CanvasTexture(skyCanvas); skyTex.colorSpace = THREE.SRGBColorSpace; scene.background = skyTex;
  let skyKey = -1;
  function paintSky(n) {
    const key = Math.round(n * 20); if (key === skyKey) return; skyKey = key;
    const g = skyCanvas.getContext('2d'); const gr = g.createLinearGradient(0, 0, 0, 256);
    const mix = (a, b) => { const ca = new THREE.Color(a); return `#${ca.lerp(new THREE.Color(b), n).getHexString()}`; };
    gr.addColorStop(0, mix('#e8e4da', '#141a33')); gr.addColorStop(0.6, mix('#efe9dd', '#2a2f57')); gr.addColorStop(1, mix('#f3ede2', '#4b3f66'));
    g.fillStyle = gr; g.fillRect(0, 0, 4, 256); skyTex.needsUpdate = true;
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
      const g = cv.getContext('2d'); g.fillStyle = '#8a90a0'; g.font = '600 34px "Space Grotesk", system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle';
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
  const cars = new Map(); const flying = []; const cats = new Map(); const shareLines = [];
  // car lanes as smooth curves: cell centres averaged over a few cells, so cars do not zig-zag
  const lanePts = (city.lanes ?? []).map((lane) => {
    const c = lane.cells.map((i) => cellXZ(i));
    const sm = c.map((_, j) => { let x = 0; let y = 0; let n = 0; for (let q = Math.max(0, j - 4); q <= Math.min(c.length - 1, j + 4); q++) { x += c[q][0]; y += c[q][1]; n++; } return [x / n, y / n]; });
    // drive on the right: shift each lane a little to the right of its direction
    return sm.map((p, j) => { const a = sm[Math.max(0, j - 3)]; const b = sm[Math.min(sm.length - 1, j + 3)]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [p[0] - ((b[1] - a[1]) / L) * 1.1, p[1] + ((b[0] - a[0]) / L) * 1.1]; });
  });
  const laneAt = (k, p) => { const pts = lanePts[k]; const i = Math.max(0, Math.min(pts.length - 1, p)); const a = Math.floor(i); const b = Math.min(pts.length - 1, a + 1); const f = i - a; return [pts[a][0] + (pts[b][0] - pts[a][0]) * f, pts[a][1] + (pts[b][1] - pts[a][1]) * f]; };
  function catFor(c) { let m = cats.get(c.id); if (m) return m; m = makeCat(c.id); m.g.scale.setScalar(3.4); world.add(m.g); cats.set(c.id, m); return m; }
  function shareLine(f) {
    if (f.cell2 == null) return;
    const [ax, ay] = cellXZ(f.cell); const [bx, by] = cellXZ(f.cell2);
    const a = v3(ax, ay, 4); const b = v3(bx, by, 4); const mid = a.clone().lerp(b, 0.5); mid.y += 6;
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(16)), new THREE.LineDashedMaterial({ color: 0xd4a514, dashSize: 1.2, gapSize: 0.8, transparent: true }));
    line.computeLineDistances(); world.add(line); shareLines.push({ line, t0: performance.now() });
  }
  function carFor(c) {
    let m = cars.get(c.id); if (m) return m;
    m = makeCar(c.color); m.g.scale.setScalar(3); world.add(m.g); cars.set(c.id, m); return m;
  }
  // a rat hit by a car flies off in the car's direction, tumbling, and lands on its back
  function launch(f) {
    const [gx, gy] = cellXZ(f.cell);
    const m = makeRat(); m.g.scale.setScalar(3.6); m.halo.visible = false; world.add(m.g);
    const L = Math.hypot(f.dx || 0, f.dy || 0) || 1;
    const dir = new THREE.Vector3((f.dx || 1) / L, 0, (f.dy || 0) / L);
    const from = v3(gx, gy, 0.3);
    const to = from.clone().addScaledVector(dir, 26); const [tx, ty] = [gx + (dir.x * 26) / cellM, gy + (dir.z * 26) / cellM]; to.y = elevAt(tx, ty) + 0.3;
    flying.push({ m, from, to, t0: performance.now(), spin: new THREE.Vector3(6 + Math.random() * 6, Math.random() * 4, 4 + Math.random() * 5) });
    addRing(f.cell, 0xe0242a, 1, 18, 1000, 2, 220);
  }
  const PIN = { caught: () => '✓ caught', missed: (f) => (f.burrow ? '⌂ burrow found' : '✗ got away'), roadkill: () => '✱ hit by car', cat: () => '✓ cat got one' };
  function updateFlying(now) {
    for (let k = flying.length - 1; k >= 0; k--) {
      const fl = flying[k]; const t = (now - fl.t0) / (window.__flyMs ?? 1300);
      if (t >= 4) { world.remove(fl.m.g); flying.splice(k, 1); continue; }
      const u = Math.min(1, t);
      fl.m.g.position.lerpVectors(fl.from, fl.to, u); fl.m.g.position.y += Math.sin(Math.PI * u) * 22;
      if (u < 1) fl.m.g.rotation.set(fl.spin.x * u * 3, fl.spin.y * u * 3, fl.spin.z * u * 3);
      else fl.m.g.rotation.set(Math.PI, fl.m.g.rotation.y, 0);
      fl.m.legs.forEach((l, j) => { l.rotation.z = u < 1 ? Math.sin(now / 40 + j) * 1.2 : 0.4; });
    }
  }

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
    el.textContent = { spot: 'Spotted!', caught: 'Caught!', missed: f.burrow ? 'Got away — burrow found' : 'Got away', dodge: 'Dodged', bag: 'Trash dropped', roadkill: 'Hit by a car!', cat: 'A cat got it!', catmiss: 'Escaped the cat' }[f.kind] ?? f.kind;
    if (f.kind === 'roadkill') launch(f);
    if (f.kind === 'share') { shareLine(f); return; }
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
  function focusOn(cell, zoom = overviewZoom() * 3) { const [gx, gy] = cellXZ(cell); glideTo(worldPos(gx, gy), zoom); }

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
    const [rise, set] = sim.cfg.sun ?? [6.8, 19];
    const hf = hourFrac;
    const night = hf >= set + 0.5 || hf < rise - 0.5 ? 1 : hf >= set - 1.5 && hf < set + 0.5 ? (hf - (set - 1.5)) / 2 : hf >= rise - 0.5 && hf < rise + 1 ? (rise + 1 - hf) / 1.5 : 0;
    const nn = Math.max(0, Math.min(1, night));
    paintSky(nn);
    hemi.intensity = 1.6 - 0.55 * nn; hemi.color.setRGB(1 - 0.35 * nn, 1 - 0.3 * nn, 1 - 0.05 * nn); hemi.groundColor.setRGB(0.72 - 0.4 * nn, 0.74 - 0.4 * nn, 0.77 - 0.3 * nn);
    sun.intensity = 1.4 - 0.75 * nn; dusk.intensity = 1.3 * nn; sun.color.setRGB(1, 1 - 0.15 * nn, 1 - 0.3 * nn);
    groundMesh.material.color.setRGB(1 - 0.55 * nn, 1 - 0.52 * nn, 1 - 0.38 * nn);
    lamps.visible = nn > 0.15; lamps.material.opacity = nn;
    // windows: lit at night, and now and then someone switches a light on or off
    for (const bm of bMeshes) {
      bm.mat.emissiveIntensity = nn * bm.lit * 1.6;
      if (nn > 0.3 && now > bm.next) { bm.next = now + 2500 + Math.random() * 9000; bm.mat.emissiveMap = litTex[Math.floor(Math.random() * litTex.length)]; bm.mat.needsUpdate = true; }
    }

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
      m.g.scale.setScalar(selected === r ? 4.8 : 3.6);
      m.halo.material.color.set(r.mode === 'flee' ? 0xff3d3d : 0xff7a3c);
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
      m.g.scale.setScalar(selected === ins ? 3.9 : 3.2);
      if (chasing && ins.chase?.rat?.alive) {
        const [rx, ry] = along(ins.chase.rat, frac);
        m.chaseLine.geometry.dispose(); m.chaseLine.geometry = new THREE.BufferGeometry().setFromPoints([v3(gx, gy, 1), v3(rx, ry, 0.5)]); m.chaseLine.computeLineDistances(); m.chaseLine.visible = true;
      }
      label(`ins${ins.id}`, v3(gx, gy, 6.5), chasing ? `${ins.name} · chasing` : ins.name, `lab ins${chasing ? ' chase' : ''}${selected === ins ? ' sel' : ''}`);
    }

    // cars, along their smoothed lane
    const liveCars = new Set();
    for (const c of sim.cars ?? []) {
      liveCars.add(c.id);
      const m = carFor(c); m.g.visible = true;
      const from = c.pos - (c.moved.length - 1); const p = from + (c.pos - from) * Math.max(0, Math.min(1, frac));
      const [gx, gy] = laneAt(c.lane, p); m.g.position.copy(v3(gx, gy, 0));
      const [ax, ay] = laneAt(c.lane, p - 2); const [bx, by] = laneAt(c.lane, p + 2);
      if (Math.hypot(bx - ax, by - ay) > 0.01) { const want = -Math.atan2(by - ay, bx - ax); m.g.rotation.y = m.init ? turn(m.g.rotation.y, want) : want; m.init = true; }
      m.beamMat.opacity = 0.32 * nn;
    }
    for (const [id, m] of cars) if (!liveCars.has(id)) { world.remove(m.g); cars.delete(id); }
    updateFlying(now);
    // cats
    const liveCats = new Set();
    for (const c of sim.cats ?? []) {
      liveCats.add(c.id);
      const m = catFor(c); const [gx, gy] = along(c, frac);
      m.g.position.copy(v3(gx, gy, 0)); m.g.rotation.y = turn(m.g.rotation.y, -c.facing);
      const moving = c.moved && c.moved.length > 1;
      m.legs.forEach((l, k) => { l.rotation.z = moving ? Math.sin(t * (c.mode === 'pounce' ? 22 : 9) + (k % 2) * Math.PI) * 0.7 : 0; });
      m.body.position.y = c.mode === 'sit' ? 0.6 : 0.75; m.tail.rotation.x = Math.sin(t * 2 + c.id) * 0.3;
      if (c.mode === 'pounce') label(`cat${c.id}`, v3(gx, gy, 6), 'Cat · pouncing', 'lab cat');
    }
    for (const [id, m] of cats) if (!liveCats.has(id)) { world.remove(m.g); cats.delete(id); }
    for (let k = shareLines.length - 1; k >= 0; k--) { const sl = shareLines[k]; const u = (now - sl.t0) / 2600; if (u >= 1) { world.remove(sl.line); sl.line.geometry.dispose(); shareLines.splice(k, 1); } else sl.line.material.opacity = 1 - u; }
    // pins: where something happened tonight stays marked for a while
    const pinsFx = sim.fx.filter((f) => PIN[f.kind] && sim.t - f.t < 150).slice(-14);
    for (const f of pinsFx) { const [gx, gy] = cellXZ(f.cell); label(`pin${f.seq}`, v3(gx, gy, 2.5), PIN[f.kind](f), `pin pin-${f.burrow ? 'burrow' : f.kind}`); }

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
      for (const m of cars.values()) world.remove(m.g); cars.clear();
      for (const m of cats.values()) world.remove(m.g); cats.clear();
      for (const sl of shareLines) world.remove(sl.line); shareLines.length = 0;
      for (const fl of flying) world.remove(fl.m.g); flying.length = 0;
      rats.clear(); fxSeen = 0; bagsSeen.clear(); lastLayer = null;
      for (const p of pops) p.el.remove(); pops.length = 0;
    },
  };
}
