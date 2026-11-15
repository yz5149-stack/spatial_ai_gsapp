// three.js view of the store: a cut-away convenience store on a snowy Manhattan street at the real
// sun angle of the chosen hour. Simulation coordinates: x east, y south, cells of 0.5 m.
// three.js: X = east (m), Y = up (m), Z = south (m).

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { T, Z, runCells } from '../sim/store.js';
import { CATS, CAT_COLOR, CAT_LABEL, CELL } from '../sim/config.js';

const M = CELL;
const hash = (a, b, c = 0) => { const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453; return s - Math.floor(s); };
const cxm = (w, i) => ((i % w.W) + 0.5) * M;
const czm = (w, i) => (Math.floor(i / w.W) + 0.5) * M;

function canvasTexture(wd, ht, draw) {
  const c = document.createElement('canvas'); c.width = wd; c.height = ht;
  draw(c.getContext('2d'), wd, ht);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

function textSprite(text, { color = '#fff', bg = 'rgba(8,10,16,0.82)', size = 44, pad = 18, border = null } = {}) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  g.font = `700 ${size}px "Space Grotesk", system-ui, sans-serif`;
  const w = Math.ceil(g.measureText(text).width) + pad * 2; const h = size + pad * 1.4;
  c.width = w; c.height = h;
  g.font = `700 ${size}px "Space Grotesk", system-ui, sans-serif`;
  g.fillStyle = bg; g.beginPath(); g.roundRect(2, 2, w - 4, h - 4, h / 2.4); g.fill();
  if (border) { g.strokeStyle = border; g.lineWidth = 4; g.stroke(); }
  g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, w / 2, h / 2 + 2);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.scale.set(w / h * 0.32, 0.32, 1);
  sp.renderOrder = 10;
  return sp;
}

export function makeScene3D(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 200);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.maxPolarAngle = 1.38; controls.minDistance = 4; controls.maxDistance = 45;

  const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x20232c, 0.55);
  const ambient = new THREE.AmbientLight(0xffffff, 0.12);
  scene.add(ambient);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff1d6, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 90 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
  const moon = new THREE.DirectionalLight(0x6f86c8, 0.25);
  scene.add(moon, moon.target);

  // ---- snow -------------------------------------------------------------------------------
  const flake = canvasTexture(32, 32, (g) => { const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 32, 32); });
  const SNOW = 2600;
  const snowGeo = new THREE.BufferGeometry();
  const sp = new Float32Array(SNOW * 3); const sv = new Float32Array(SNOW);
  for (let i = 0; i < SNOW; i++) { sp[i * 3] = Math.random() * 44 - 13; sp[i * 3 + 1] = Math.random() * 16; sp[i * 3 + 2] = Math.random() * 30 + 6; sv[i] = 0.6 + Math.random() * 0.8; }
  snowGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  const snow = new THREE.Points(snowGeo, new THREE.PointsMaterial({ map: flake, color: 0xffffff, size: 0.09, transparent: true, opacity: 0.85, depthWrite: false }));
  snow.frustumCulled = false;
  scene.add(snow);
  let snowRate = 1;

  // ---- agents -----------------------------------------------------------------------------
  const agentsGroup = new THREE.Group();
  scene.add(agentsGroup);
  const creature = buildCreature();
  agentsGroup.add(creature.group);
  const redEye = new THREE.SpotLight(0xff2a14, 22, 9, (110 / 2) * Math.PI / 180, 0.4, 1.2);
  scene.add(redEye, redEye.target);
  const survivorPool = [];
  for (let n = 0; n < 5; n++) {
    const s = buildSurvivor();
    s.torch = new THREE.SpotLight(0xfff2d6, 0, 7, 0.55, 0.5, 1.3);
    scene.add(s.torch, s.torch.target);
    agentsGroup.add(s.group);
    s.group.visible = false;
    survivorPool.push(s);
  }

  const coneMat = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
  const makeCone = (mat) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(130 * 9), 3)); const m = new THREE.Mesh(g, mat); m.frustumCulled = false; m.renderOrder = 2; scene.add(m); return m; };
  const creatureCone = makeCone(coneMat(0xff2a14, 0.2));
  const survivorCones = survivorPool.map(() => makeCone(coneMat(0xffd27a, 0.1)));

  const routeLine = (color) => { const l = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color, dashSize: 0.18, gapSize: 0.12, transparent: true, opacity: 0.9 })); l.frustumCulled = false; scene.add(l); return l; };
  const creatureRoute = routeLine(0xff6a5a);
  const survivorRoutes = survivorPool.map(() => routeLine(0xffd27a));

  const fx = new THREE.Group(); scene.add(fx);
  const effects = [];
  const pins = new THREE.Group(); scene.add(pins);

  let world = null; let storeGroup = null; let cond = null;
  let mode = 'orbit'; let followId = null;
  const prevPos = new Map();

  // ---- the store --------------------------------------------------------------------------
  function setWorld(w, c) {
    world = w;
    if (storeGroup) { scene.remove(storeGroup); storeGroup.traverse((o) => { o.geometry?.dispose?.(); if (o.material) [].concat(o.material).forEach((m) => { m.map?.dispose?.(); m.dispose?.(); }); }); }
    storeGroup = buildStore(w);
    scene.add(storeGroup);
    prevPos.clear();
    for (const e of effects) fx.remove(e.obj);
    effects.length = 0;
    setConditions(c);
    if (mode === 'orbit') resetOrbit();
  }

  function setConditions(c) {
    cond = c;
    const day = c && c.isDay;
    const el = c ? c.sun.elevation : -30; const az = c ? c.sun.azimuth : 0;
    const rad = Math.PI / 180;
    const cloud = c ? c.cloud / 100 : 0.8;
    const dir = new THREE.Vector3(Math.sin(az * rad) * Math.cos(el * rad), Math.sin(el * rad), -Math.cos(az * rad) * Math.cos(el * rad));
    const center = world ? new THREE.Vector3(world.W * M / 2, 0, world.H * M / 2) : new THREE.Vector3();
    sun.position.copy(center).addScaledVector(dir, 40); sun.target.position.copy(center);
    sun.intensity = day && el > 0 ? 3.2 * Math.pow(1 - cloud, 1.2) * Math.min(1, el / 10) + 0.05 : 0;
    sun.color.setHSL(0.09, 0.6, Math.min(0.85, 0.55 + el / 90));
    moon.position.copy(center).add(new THREE.Vector3(-10, 25, 8)); moon.target.position.copy(center);
    moon.intensity = day ? 0 : 0.22;
    const sky = day ? new THREE.Color().setHSL(0.6, 0.18 + 0.1 * (1 - cloud), 0.42 + 0.18 * Math.min(1, el / 30) - 0.12 * cloud) : new THREE.Color(0x070b16);
    scene.background = sky;
    ambient.intensity = day ? 0.18 : 0.14;
    scene.fog = new THREE.FogExp2(sky, day ? 0.022 : 0.03 + (c ? Math.min(0.03, c.weather.snowfall * 0.004) : 0));
    hemi.intensity = day ? 0.7 + 0.6 * Math.min(1, Math.max(0, el) / 25) : 0.75;
    hemi.color.set(day ? 0xdfe8ff : 0x8fa6e0);
    snowRate = c ? Math.min(3, 0.25 + c.weather.snowfall * 0.6) : 1;
    snow.material.opacity = c && c.weather.snowfall < 0.05 ? 0.0 : 0.85;
    renderer.toneMappingExposure = day ? 0.95 : 1.12;
  }

  function buildStore(w) {
    const g = new THREE.Group();
    const { W, H, type, zone, cat } = w;
    const SW = W * M; const SH = H * M;

    // outside: snowy ground, sidewalk, street, lamp
    const snowMat = new THREE.MeshStandardMaterial({ color: 0xdfe7f2, roughness: 0.92 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), snowMat);
    ground.rotation.x = -Math.PI / 2; ground.position.set(SW / 2, -0.02, SH / 2); ground.receiveShadow = true; g.add(ground);
    const walkTex = canvasTexture(512, 128, (c, cw, ch) => {
      c.fillStyle = '#c9d2dc'; c.fillRect(0, 0, cw, ch);
      c.strokeStyle = 'rgba(80,90,105,0.35)'; c.lineWidth = 2;
      for (let x = 0; x < cw; x += 32) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, ch); c.stroke(); }
      for (let i = 0; i < 260; i++) { c.fillStyle = `rgba(255,255,255,${0.2 + Math.random() * 0.5})`; c.beginPath(); c.arc(Math.random() * cw, Math.random() * ch, Math.random() * 6, 0, 7); c.fill(); }
    });
    const sidewalk = new THREE.Mesh(new THREE.PlaneGeometry(SW + 16, 3.2), new THREE.MeshStandardMaterial({ map: walkTex, roughness: 0.85 }));
    sidewalk.rotation.x = -Math.PI / 2; sidewalk.position.set(SW / 2, 0.005, SH + 1.6); sidewalk.receiveShadow = true; g.add(sidewalk);
    const street = new THREE.Mesh(new THREE.PlaneGeometry(SW + 60, 9), new THREE.MeshStandardMaterial({ color: 0x3a3f48, roughness: 0.55, metalness: 0.1 }));
    street.rotation.x = -Math.PI / 2; street.position.set(SW / 2, 0.0, SH + 7.7); street.receiveShadow = true; g.add(street);
    const slush = new THREE.Mesh(new THREE.PlaneGeometry(SW + 60, 0.5), snowMat);
    slush.rotation.x = -Math.PI / 2; slush.position.set(SW / 2, 0.012, SH + 3.4); g.add(slush);
    for (let i = 0; i < 14; i++) {
      const pile = new THREE.Mesh(new THREE.SphereGeometry(0.6 + hash(i, 2) * 0.7, 12, 8), snowMat);
      pile.scale.y = 0.35; pile.position.set(-3 + hash(i, 1) * (SW + 6), 0, SH + 3.2 + hash(i, 3) * 0.4); pile.castShadow = true; g.add(pile);
    }
    const lamp = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 5.2, 10), new THREE.MeshStandardMaterial({ color: 0x2b3038, metalness: 0.6, roughness: 0.4 }));
    pole.position.y = 2.6; pole.castShadow = true; lamp.add(pole);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.08, 0.08), pole.material); arm.position.set(-0.55, 5.15, 0); lamp.add(arm);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffc27a })); bulb.position.set(-1.1, 5.05, 0); lamp.add(bulb);
    const lampLight = new THREE.PointLight(0xffa45c, 30, 16, 1.6); lampLight.position.set(-1.1, 4.9, 0); lamp.add(lampLight);
    lamp.position.set(SW * 0.78, 0, SH + 2.9); g.add(lamp);

    // floor: vinyl tiles, with the floor zones painted in
    const S = 24;
    const floorTex = canvasTexture(W * S, H * S, (c) => {
      for (let i = 0; i < w.N; i++) {
        const x = (i % W) * S; const y = Math.floor(i / W) * S;
        const v = 214 + Math.floor(hash(i % W, Math.floor(i / W)) * 16) - (((i % W) + Math.floor(i / W)) % 2) * 8;
        c.fillStyle = `rgb(${v},${v - 2},${v - 6})`; c.fillRect(x, y, S, S);
        c.strokeStyle = 'rgba(0,0,0,0.08)'; c.strokeRect(x + 0.5, y + 0.5, S - 1, S - 1);
      }
      for (let i = 0; i < w.N; i++) {
        const x = (i % W) * S; const y = Math.floor(i / W) * S;
        if (zone[i] === Z.MAT) { c.fillStyle = '#26332d'; c.fillRect(x, y, S, S); c.fillStyle = 'rgba(120,160,130,0.25)'; for (let k = 2; k < S; k += 6) c.fillRect(x, y + k, S, 2); }
        if (zone[i] === Z.WET) { c.fillStyle = 'rgba(70,140,210,0.45)'; c.fillRect(x, y, S, S); }
        if (zone[i] === Z.NOISY) { c.fillStyle = 'rgba(150,120,80,0.35)'; c.fillRect(x, y, S, S); }
        if (zone[i] === Z.DARK) { c.fillStyle = 'rgba(5,6,10,0.55)'; c.fillRect(x, y, S, S); }
        if (type[i] === T.DOOR) { c.fillStyle = '#3b3f46'; c.fillRect(x, y, S, S); }
      }
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(SW, SH), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.42, metalness: 0.0 }));
    floor.rotation.x = -Math.PI / 2; floor.position.set(SW / 2, 0.01, SH / 2); floor.receiveShadow = true; g.add(floor);

    // wet floor: a glossy film and yellow caution signs
    const wetMat = new THREE.MeshStandardMaterial({ color: 0x9cc8ff, roughness: 0.05, metalness: 0.4, transparent: true, opacity: 0.35 });
    const cautionMat = new THREE.MeshStandardMaterial({ color: 0xffd21f, roughness: 0.5, emissive: 0x332800 });
    for (const zz of w.genome.zones) {
      if (zz.kind === 'wet') {
        const film = new THREE.Mesh(new THREE.CircleGeometry(1, 24), wetMat);
        film.rotation.x = -Math.PI / 2; film.scale.set(zz.w * M * 0.55, zz.h * M * 0.55, 1);
        film.position.set((zz.x + zz.w / 2) * M, 0.02, (zz.y + zz.h / 2) * M); g.add(film);
        const sign = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.62, 4, 1, true), cautionMat);
        sign.position.set((zz.x + 0.6) * M, 0.31, (zz.y + 0.6) * M); sign.rotation.y = 0.6; sign.castShadow = true; g.add(sign);
      }
      if (zz.kind === 'noisy') {
        const bagMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.6, transparent: true, opacity: 0.85 });
        const glass = new THREE.MeshStandardMaterial({ color: 0x5fae6a, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.8 });
        for (let k = 0; k < zz.w * zz.h * 0.8; k++) {
          const px = (zz.x + hash(k, zz.x) * zz.w) * M; const pz = (zz.y + hash(k, zz.y, 3) * zz.h) * M;
          if (k % 3) { const b = new THREE.Mesh(new THREE.IcosahedronGeometry(0.09, 0), bagMat); b.position.set(px, 0.06, pz); b.scale.set(1, 0.6, 1.3); g.add(b); }
          else { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.22, 8), glass); b.rotation.z = Math.PI / 2; b.rotation.y = hash(k, 9) * 6; b.position.set(px, 0.035, pz); g.add(b); }
        }
      }
    }

    // walls (cut-away: the side walls are low so the store can be seen from the street)
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x343a46, roughness: 0.85 });
    const wallTop = new THREE.MeshStandardMaterial({ color: 0x1b1f27, roughness: 0.9 });
    const box = (wx, wy, wz, x, y, z, mat, shadow = true) => { const b = new THREE.Mesh(new THREE.BoxGeometry(wx, wy, wz), mat); b.position.set(x, y, z); b.castShadow = shadow; b.receiveShadow = true; g.add(b); return b; };
    const backH = 3.0; const sideH = 1.1;
    for (let x = 0; x < W; x++) if (type[x] === T.WALL) box(M, backH, M, (x + 0.5) * M, backH / 2, 0.5 * M, wallMat);
    for (let y = 1; y < H - 1; y++) {
      for (const x of [0, W - 1]) if (type[y * W + x] === T.WALL) box(M, sideH, M, (x + 0.5) * M, sideH / 2, (y + 0.5) * M, wallMat);
    }
    box(M, sideH, M, 0.5 * M, sideH / 2, (H - 0.5) * M, wallMat); box(M, sideH, M, (W - 0.5) * M, sideH / 2, (H - 0.5) * M, wallMat);
    // a dark top band on the back wall with the store name
    const nameTex = canvasTexture(1024, 96, (c, cw, ch) => { c.fillStyle = '#0d1016'; c.fillRect(0, 0, cw, ch); c.font = '800 54px "Space Grotesk", system-ui'; c.fillStyle = '#5ff2c8'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.shadowColor = '#5ff2c8'; c.shadowBlur = 18; c.fillText('LAST OPEN · 24 HOURS · HOT COFFEE · BATTERIES', cw / 2, ch / 2); });
    const band = new THREE.Mesh(new THREE.PlaneGeometry(SW - 2 * M, 0.42), new THREE.MeshBasicMaterial({ map: nameTex }));
    band.position.set(SW / 2, 2.62, M + 0.01); g.add(band);

    // the storefront: glass panes, mullions, sill and head, the door, a neon OPEN sign
    const glassMat = new THREE.MeshPhysicalMaterial({ color: 0xbfe3ff, roughness: 0.05, metalness: 0, transmission: 0.0, transparent: true, opacity: 0.16, depthWrite: false });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x1a1e25, metalness: 0.7, roughness: 0.35 });
    const zF = (H - 0.5) * M;
    const sill = 0.45; const head = 2.45;
    box(SW - 2 * M, sill, 0.18, SW / 2, sill / 2, zF, wallMat);
    box(SW - 2 * M, 0.12, 0.2, SW / 2, head + 0.06, zF, frameMat);
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(SW - 2 * M, head - sill), glassMat);
    pane.position.set(SW / 2, (sill + head) / 2, zF); pane.castShadow = false; g.add(pane);
    for (let x = 2; x <= W - 2; x += 3) box(0.06, head - sill, 0.12, x * M, (sill + head) / 2, zF, frameMat, false);
    const d0 = w.genome.door;
    const doorGap = new THREE.Mesh(new THREE.PlaneGeometry(3 * M - 0.04, head), new THREE.MeshStandardMaterial({ color: 0x9fd1ff, transparent: true, opacity: 0.1, depthWrite: false }));
    doorGap.position.set((d0 + 1.5) * M, head / 2, zF + 0.02); g.add(doorGap);
    box(0.08, head, 0.14, d0 * M, head / 2, zF, frameMat, false); box(0.08, head, 0.14, (d0 + 3) * M, head / 2, zF, frameMat, false);
    const openTex = canvasTexture(256, 110, (c, cw, ch) => { c.clearRect(0, 0, cw, ch); c.strokeStyle = '#ff3b6b'; c.lineWidth = 7; c.shadowColor = '#ff3b6b'; c.shadowBlur = 16; c.beginPath(); c.roundRect(10, 10, cw - 20, ch - 20, 22); c.stroke(); c.font = '800 62px "Space Grotesk", system-ui'; c.fillStyle = '#ffe9f0'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('OPEN', cw / 2, ch / 2 + 3); });
    const openSign = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.39), new THREE.MeshBasicMaterial({ map: openTex, transparent: true, side: THREE.DoubleSide }));
    const signX = d0 > W / 2 ? (d0 - 4) * M : (d0 + 7) * M;
    openSign.position.set(signX, 1.75, zF - 0.06); g.add(openSign);
    const openGlow = new THREE.PointLight(0xff3b6b, 4, 4, 1.5); openGlow.position.set(signX, 1.7, zF + 0.4); g.add(openGlow);
    // awning over the storefront
    const awning = new THREE.Mesh(new THREE.BoxGeometry(SW, 0.08, 1.1), new THREE.MeshStandardMaterial({ color: 0x0f6b5a, roughness: 0.6 }));
    awning.position.set(SW / 2, 2.95, SH + 0.45); awning.rotation.x = -0.12; awning.castShadow = true; g.add(awning);
    const awnSnow = new THREE.Mesh(new THREE.BoxGeometry(SW, 0.05, 1.0), snowMat); awnSnow.position.set(SW / 2, 3.0, SH + 0.45); awnSnow.rotation.x = -0.12; g.add(awnSnow);

    // the stockroom door: a steel door with a red sign
    const bc = w.lair; const bx = (bc % W + 0.5) * M; const bz = (Math.floor(bc / W) + 0.5) * M;
    const steel = new THREE.MeshStandardMaterial({ color: 0x5b1416, metalness: 0.5, roughness: 0.45, emissive: 0x2a0204 });
    const back = new THREE.Mesh(new THREE.BoxGeometry(M * 1.05, 2.1, M * 1.05), steel); back.position.set(bx, 1.05, bz); g.add(back);
    const exitS = textSprite('STAFF ONLY', { color: '#fff', bg: '#b3121c', size: 40 }); exitS.position.set(bx, 2.45, bz); exitS.scale.multiplyScalar(0.9); g.add(exitS);
    const backGlow = new THREE.PointLight(0xff2020, 3, 3.5, 1.5); backGlow.position.set(bx, 2.2, bz); g.add(backGlow);

    // ceiling lights (off over dark floor): only their light is drawn, so the cut-away stays clear
    const lights = [];
    for (let y = 4; y < H - 2; y += 7) for (let x = 4; x < W - 2; x += 8) {
      let dark = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (zone[(y + dy) * W + x + dx] === Z.DARK) dark++;
      if (dark < 6) lights.push([(x + 0.5) * M, (y + 0.5) * M]);
    }
    for (const [x, z] of lights.slice(0, 9)) { const pl = new THREE.PointLight(0xeef7ff, 16, 9, 1.1); pl.position.set(x, 2.9, z); g.add(pl); }

    // gondolas: plinth, spine, shelves, end caps, and products on every face that faces an aisle
    const plinth = new THREE.MeshStandardMaterial({ color: 0x23262d, roughness: 0.7 });
    const metal = new THREE.MeshStandardMaterial({ color: 0xd9dde3, roughness: 0.45, metalness: 0.35 });
    const spine = new THREE.MeshStandardMaterial({ color: 0xeef0f3, roughness: 0.6 });
    const products = []; const bottles = [];
    w.genome.runs.forEach((r, id) => {
      const tall = r.tall; const hgt = tall ? 1.83 : 1.37;
      const cells = runCells(r);
      const x0 = Math.min(...cells.map((c) => c[0])); const x1 = Math.max(...cells.map((c) => c[0])) + 1;
      const y0 = Math.min(...cells.map((c) => c[1])); const y1 = Math.max(...cells.map((c) => c[1])) + 1;
      const wx = (x1 - x0) * M; const wz = (y1 - y0) * M; const mx = (x0 + x1) / 2 * M; const mz = (y0 + y1) / 2 * M;
      box(wx - 0.02, 0.12, wz - 0.02, mx, 0.06, mz, plinth);
      const sp2 = r.dir === 'v' ? box(0.05, hgt, wz - 0.04, mx, hgt / 2, mz, spine) : box(wx - 0.04, hgt, 0.05, mx, hgt / 2, mz, spine);
      void sp2;
      const levels = tall ? [0.14, 0.5, 0.86, 1.22, 1.58] : [0.14, 0.52, 0.9];
      for (const lv of levels) box(wx - 0.03, 0.025, wz - 0.03, mx, lv, mz, metal, false);
      // end caps
      const capColor = new THREE.MeshStandardMaterial({ color: new THREE.Color(CAT_COLOR[r.cat]).multiplyScalar(0.55), roughness: 0.5 });
      if (r.dir === 'v') { box(wx, hgt, 0.04, mx, hgt / 2, y0 * M + 0.02, capColor); box(wx, hgt, 0.04, mx, hgt / 2, y1 * M - 0.02, capColor); }
      else { box(0.04, hgt, wz, x0 * M + 0.02, hgt / 2, mz, capColor); box(0.04, hgt, wz, x1 * M - 0.02, hgt / 2, mz, capColor); }
      const base = new THREE.Color(CAT_COLOR[r.cat]);
      for (const [cx, cy] of cells) {
        const i = cy * W + cx;
        // which side faces the aisle
        const faces = r.dir === 'v' ? [[cx === r.x ? -1 : 1, 0]] : [[0, cy === r.y ? -1 : 1]];
        for (const [fx2, fz] of faces) {
          const nb = (cy + fz) * W + (cx + fx2);
          if (!w.walk[nb]) continue;
          for (let li = 0; li < levels.length; li++) {
            const lv = levels[li];
            const shelfH = (li + 1 < levels.length ? levels[li + 1] : hgt + 0.05) - lv - 0.06;
            for (let k = 0; k < 3; k++) {
              const hh = Math.min(shelfH, 0.12 + hash(i, li, k) * 0.2);
              const along = (k - 1) * 0.15;
              const depth = 0.2;
              const col = base.clone().offsetHSL((hash(i, k, li) - 0.5) * 0.08, (hash(k, i) - 0.5) * 0.3, (hash(li, k, i) - 0.5) * 0.3);
              const px = r.dir === 'v' ? (cx + 0.5) * M + fx2 * 0.12 : (cx + 0.5) * M + along;
              const pz = r.dir === 'v' ? (cy + 0.5) * M + along : (cy + 0.5) * M + fz * 0.12;
              products.push({ x: px, y: lv + 0.0125 + hh / 2, z: pz, sx: r.dir === 'v' ? depth : 0.13, sy: hh, sz: r.dir === 'v' ? 0.13 : depth, col });
            }
          }
        }
      }
      // an aisle sign hanging above the end that faces the front
      if (r.sign) {
        const s = textSprite(`G${id + 1} · ${CAT_LABEL[r.cat].toUpperCase()}`, { color: '#0b0e14', bg: CAT_COLOR[r.cat], size: 40 });
        const sx = r.dir === 'v' ? mx : x0 * M + 0.3; const sz = r.dir === 'v' ? y1 * M - 0.3 : mz;
        s.position.set(sx, 2.45, sz); g.add(s);
        const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.4), metal); cord.position.set(sx, 2.75, sz); g.add(cord);
      }
    });

    // coolers: dark cabinets with lit glass doors and bottles
    const cab = new THREE.MeshStandardMaterial({ color: 0x1d2128, roughness: 0.5, metalness: 0.4 });
    const coolGlass = new THREE.MeshStandardMaterial({ color: 0xcfeaff, emissive: 0x9fd8ff, emissiveIntensity: 0.55, transparent: true, opacity: 0.32, roughness: 0.1 });
    const f = w.genome.fridge;
    for (let i = 0; i < w.N; i++) {
      if (type[i] !== T.FRIDGE) continue;
      const x = cxm(w, i); const z = czm(w, i);
      box(M, 2.03, M, x, 1.015, z, cab);
      const door = new THREE.Mesh(new THREE.PlaneGeometry(M - 0.06, 1.7), coolGlass);
      const nx = f === 'E' ? -1 : f === 'W' ? 1 : 0; const nz = f === 'N' ? 1 : 0;
      door.position.set(x + nx * (M / 2 + 0.005), 1.0, z + nz * (M / 2 + 0.005));
      door.rotation.y = f === 'E' ? -Math.PI / 2 : f === 'W' ? Math.PI / 2 : 0;
      g.add(door);
      for (const lv of [0.3, 0.72, 1.14, 1.56]) for (let k = 0; k < 3; k++) {
        const along = (k - 1) * 0.14;
        const hue = hash(i, k, lv * 10);
        const col = new THREE.Color().setHSL(hue < 0.5 ? 0.55 + hue * 0.1 : hue * 0.15, 0.7, 0.55);
        bottles.push({ x: x + (nz ? along : nx * 0.08), y: lv + 0.13, z: z + (nz ? nz * 0.08 : along), col });
      }
    }
    const coolLightPos = [];
    for (let i = 0; i < w.N; i += 1) if (type[i] === T.FRIDGE && (i % 9 === 0)) coolLightPos.push(i);
    for (const i of coolLightPos.slice(0, 3)) { const pl = new THREE.PointLight(0x9fd8ff, 3, 4, 1.5); pl.position.set(cxm(w, i), 1.4, czm(w, i) + (f === 'N' ? 0.6 : 0)); g.add(pl); }

    // counter with register and a small pharmacy shelf
    if (w.counter) {
      const c = w.counter;
      const wood = new THREE.MeshStandardMaterial({ color: 0x8a5a36, roughness: 0.55 });
      const lenX = (c.x1 - c.x0 + 1) * M;
      box(lenX, 0.95, 2 * M, (c.x0 * M + lenX / 2), 0.475, (c.y + 1) * M, plinth);
      box(lenX + 0.06, 0.06, 2 * M + 0.06, (c.x0 * M + lenX / 2), 0.99, (c.y + 1) * M, wood);
      const reg = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.22, 0.3), new THREE.MeshStandardMaterial({ color: 0x111317, roughness: 0.4 })); reg.position.set(c.x0 * M + 0.5, 1.13, (c.y + 1) * M); g.add(reg);
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.18), new THREE.MeshBasicMaterial({ color: 0x5ff2c8 })); scr.position.set(c.x0 * M + 0.5, 1.33, (c.y + 1) * M + 0.12); scr.rotation.x = -0.3; g.add(scr);
      for (let k = 0; k < 10; k++) bottles.push({ x: c.x0 * M + 0.9 + k * 0.12, y: 1.08, z: (c.y + 0.6) * M, col: new THREE.Color(CAT_COLOR.medicine).offsetHSL(0, 0, (hash(k, 3) - 0.5) * 0.3) });
      const med = textSprite('PHARMACY', { color: '#0b0e14', bg: CAT_COLOR.medicine, size: 36 }); med.position.set(c.x0 * M + lenX / 2, 2.35, (c.y + 1) * M); g.add(med);
    }

    // stacked cartons
    const kraft = new THREE.MeshStandardMaterial({ color: 0xa47b4c, roughness: 0.9 });
    for (const b of w.genome.boxes) {
      for (let k = 0; k < 4; k++) {
        const bb = box(0.45, 0.38, 0.45, (b.x + 0.5 + (k % 2)) * M + (hash(k, b.x) - 0.5) * 0.06, 0.19 + (k > 1 ? 0.4 : 0), (b.y + 1) * M + (hash(b.y, k) - 0.5) * 0.1, kraft);
        bb.rotation.y = (hash(k, b.y) - 0.5) * 0.4;
      }
      box(0.5, 0.38, 0.5, (b.x + 1) * M, 0.99, (b.y + 1) * M, kraft).rotation.y = 0.3;
    }

    // instanced products and bottles
    if (products.length) {
      const pm = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.55 }), products.length);
      const m4 = new THREE.Matrix4();
      products.forEach((p, k) => { m4.makeScale(p.sx, p.sy, p.sz).setPosition(p.x, p.y, p.z); pm.setMatrixAt(k, m4); pm.setColorAt(k, p.col); });
      pm.castShadow = true; pm.receiveShadow = true; g.add(pm);
    }
    if (bottles.length) {
      const bm = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.035, 0.04, 0.26, 8), new THREE.MeshStandardMaterial({ roughness: 0.2, metalness: 0.1, emissive: 0x0a1a24 }), bottles.length);
      const m4 = new THREE.Matrix4();
      bottles.forEach((p, k) => { m4.makeTranslation(p.x, p.y, p.z); bm.setMatrixAt(k, m4); bm.setColorAt(k, p.col); });
      g.add(bm);
    }
    void cat; void CATS;
    return g;
  }

  // ---- camera -----------------------------------------------------------------------------
  function resetOrbit() {
    if (!world) return;
    const cxw = world.W * M / 2; const czw = world.H * M / 2;
    controls.target.set(cxw, 0.4, czw - 0.5);
    camera.position.set(cxw + 2.5, 12.5, czw + 11.5);
    controls.update();
  }
  function setCamera(m, id = null) {
    mode = m; followId = id;
    controls.enabled = m === 'orbit';
    if (m === 'orbit') resetOrbit();
  }

  // ---- per frame --------------------------------------------------------------------------
  const tmpV = new THREE.Vector3();
  function lerpAgent(key, cell, alpha) {
    const x = cxm(world, cell); const z = czm(world, cell);
    let p = prevPos.get(key);
    if (!p || p.cell !== cell) { p = { cell, fromX: p ? p.x : x, fromZ: p ? p.z : z, x, z, t: 0 }; prevPos.set(key, p); }
    p.t = Math.min(1, p.t + alpha);
    const e = p.t;
    return [p.fromX + (p.x - p.fromX) * e, p.fromZ + (p.z - p.fromZ) * e];
  }

  function fillCone(mesh, cone, y) {
    const pos = mesh.geometry.attributes.position;
    const arr = pos.array; let k = 0;
    if (cone && cone.length > 2) {
      const [ox, oy] = cone[0];
      for (let i = 1; i < cone.length - 1 && k < arr.length - 9; i++) {
        arr[k++] = ox * M; arr[k++] = y; arr[k++] = oy * M;
        arr[k++] = cone[i][0] * M; arr[k++] = y; arr[k++] = cone[i][1] * M;
        arr[k++] = cone[i + 1][0] * M; arr[k++] = y; arr[k++] = cone[i + 1][1] * M;
      }
    }
    for (; k < arr.length; k++) arr[k] = 0;
    pos.needsUpdate = true;
  }

  function setRoute(line, from, path, y) {
    const pts = [];
    if (from != null && path && path.length) {
      pts.push(new THREE.Vector3(from[0], y, from[1]));
      for (const c of path.slice(0, 60)) pts.push(new THREE.Vector3(cxm(world, c), y, czm(world, c)));
    }
    line.geometry.dispose();
    line.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    line.computeLineDistances();
    line.visible = pts.length > 1;
  }

  function addEffect(e) {
    if (!world) return;
    const x = e.cell != null && e.cell >= 0 ? cxm(world, e.cell) : null; const z = e.cell != null && e.cell >= 0 ? czm(world, e.cell) : null;
    if (x == null) return;
    if (e.type === 'heard' || e.type === 'slip' || e.type === 'caught' || e.type === 'escape' || e.type === 'spotted') {
      const color = { heard: 0xff6a5a, slip: 0x7ac8ff, caught: 0xff2a3a, escape: 0x5ff2c8, spotted: 0xffd27a }[e.type];
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(x, 0.05, z);
      fx.add(ring);
      effects.push({ obj: ring, t: 0, life: e.type === 'caught' ? 1.6 : 1.0, grow: e.type === 'caught' ? 2.6 : e.type === 'heard' ? 1.6 : 1.2 });
    }
    if (e.type === 'pick' || e.type === 'found') {
      const s = textSprite(`${e.type === 'pick' ? '+' : '!'} ${CAT_LABEL[e.cat]}`, { color: '#0b0e14', bg: CAT_COLOR[e.cat], size: 38 });
      s.position.set(x, 2.0, z); fx.add(s);
      effects.push({ obj: s, t: 0, life: 1.6, rise: true });
    }
    if (e.type === 'caught') {
      const s = textSprite('CAUGHT', { color: '#fff', bg: '#d81b2c', size: 44 }); s.position.set(x, 2.4, z); fx.add(s);
      effects.push({ obj: s, t: 0, life: 2.0, rise: true });
    }
  }

  let lastLabels = new Map();
  function labelFor(s) {
    const key = `${s.name}|${s.got.length}/${s.list.length}|${s.human ? 1 : 0}`;
    let l = lastLabels.get(s.id);
    if (!l || l.key !== key) {
      if (l) l.sprite.parent?.remove(l.sprite);
      const sprite = textSprite(`${s.human ? 'YOU' : s.name} ${s.got.length}/${s.list.length}`, { color: '#0b0e14', bg: s.color, size: 36 });
      l = { key, sprite }; lastLabels.set(s.id, l);
    }
    return l.sprite;
  }

  let time = 0;
  function update(sim, { dt = 0.016, alpha = 0.2, showCones = true, showRoutes = true, focusSurvivor = null, events = [] } = {}) {
    if (!world) return;
    time += dt;
    for (const e of events) addEffect(e);
    // snow
    const arr = snowGeo.attributes.position.array;
    for (let i = 0; i < SNOW; i++) {
      arr[i * 3 + 1] -= dt * sv[i] * 0.9 * snowRate;
      arr[i * 3] += Math.sin(time * 0.7 + i) * dt * 0.25 + dt * 0.35 * snowRate;
      if (arr[i * 3 + 1] < 0) { arr[i * 3 + 1] = 14 + Math.random() * 2; arr[i * 3] = Math.random() * 44 - 13; }
    }
    snowGeo.attributes.position.needsUpdate = true;

    // the creature
    const c = sim.creature;
    const inside = sim.phase === 'night';
    creature.group.visible = inside;
    if (inside) {
      const [x, z] = lerpAgent('c', c.cell, alpha);
      creature.group.position.set(x, 0, z);
      const target = -c.facing;
      creature.group.rotation.y += Math.atan2(Math.sin(target - creature.group.rotation.y), Math.cos(target - creature.group.rotation.y)) * Math.min(1, dt * 8);
      creature.animate(time, c.state);
      redEye.position.set(x, 1.75, z);
      redEye.target.position.set(x + Math.cos(c.facing) * 4, 0.2, z + Math.sin(c.facing) * 4);
      redEye.intensity = c.state === 'chase' ? 40 : 22;
      fillCone(creatureCone, showCones ? c.k.lastCone : null, 0.03);
      creatureCone.material.opacity = c.state === 'chase' ? 0.32 : 0.18;
      setRoute(creatureRoute, [x, z], showRoutes ? c.path : null, 0.06);
    } else { fillCone(creatureCone, null, 0); redEye.intensity = 0; creatureRoute.visible = false; }

    // survivors
    const live = sim.survivors.filter((s) => s.cell >= 0 && !s.outcome);
    survivorPool.forEach((p, n) => {
      const s = live[n];
      if (!s || !inside) {
        p.group.visible = false; p.torch.intensity = 0; fillCone(survivorCones[n], null, 0); survivorRoutes[n].visible = false;
        if (p.label) { p.group.remove(p.label); p.label = null; }
        return;
      }
      p.group.visible = true;
      const [x, z] = lerpAgent(`s${s.id}`, s.cell, alpha);
      p.group.position.set(x, 0, z);
      const target = -s.facing;
      p.group.rotation.y += Math.atan2(Math.sin(target - p.group.rotation.y), Math.cos(target - p.group.rotation.y)) * Math.min(1, dt * 10);
      p.setColor(s.color);
      p.body.scale.y += ((s.crouch ? 0.62 : 1) - p.body.scale.y) * Math.min(1, dt * 10);
      p.animate(time, s.path.length > 0, s.running);
      p.torch.position.set(x, s.crouch ? 0.9 : 1.35, z);
      p.torch.target.position.set(x + Math.cos(s.facing) * 3, 0.1, z + Math.sin(s.facing) * 3);
      p.torch.intensity = 9;
      const sprite = labelFor(s);
      if (p.label !== sprite) { if (p.label) p.group.remove(p.label); p.group.add(sprite); p.label = sprite; }
      sprite.position.set(0, s.crouch ? 1.45 : 2.05, 0);
      fillCone(survivorCones[n], showCones ? s.k.lastCone : null, 0.025);
      survivorCones[n].material.color.set(s.color);
      setRoute(survivorRoutes[n], [x, z], showRoutes && (focusSurvivor == null || focusSurvivor === s.id) ? s.path : null, 0.05);
      survivorRoutes[n].material.color.set(s.color);
    });

    for (let i = effects.length - 1; i >= 0; i--) {
      const e = effects[i];
      e.t += dt;
      const k = e.t / e.life;
      if (e.rise) { e.obj.position.y += dt * 0.5; e.obj.material.opacity = 1 - k; }
      else { const s = 0.3 + k * e.grow; e.obj.scale.set(s, s, s); e.obj.material.opacity = 0.9 * (1 - k); }
      if (k >= 1) { fx.remove(e.obj); e.obj.geometry?.dispose?.(); e.obj.material?.dispose?.(); effects.splice(i, 1); }
    }

    // camera
    if (mode === 'follow' || mode === 'play') {
      let target = null; let face = 0;
      if (followId === 'creature' && inside) { target = creature.group.position; face = c.facing; }
      else {
        const s = sim.survivors.find((q) => q.id === followId && q.cell >= 0) ?? live[0];
        if (s) { const idx = live.indexOf(s); target = survivorPool[idx]?.group.position; face = s.facing; }
      }
      if (target) {
        const back = mode === 'play' ? 3.6 : 4.5;
        const want = tmpV.set(target.x - Math.cos(face) * back, mode === 'play' ? 4.4 : 5.2, target.z - Math.sin(face) * back);
        if (mode === 'play') want.set(target.x, 10.5, target.z + 2.4);
        camera.position.lerp(want, Math.min(1, dt * 2.5));
        controls.target.lerp(new THREE.Vector3(target.x, 0.6, target.z), Math.min(1, dt * 4));
        camera.lookAt(controls.target);
      }
    } else if (mode === 'top') {
      camera.position.lerp(tmpV.set(world.W * M / 2, 24, world.H * M / 2 + 0.01), Math.min(1, dt * 3));
      camera.lookAt(world.W * M / 2, 0, world.H * M / 2);
    } else controls.update();
    renderer.render(scene, camera);
  }

  function resize() {
    const w = container.clientWidth; const h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = `${w}px`; renderer.domElement.style.height = `${h}px`;
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(container);
  resize();

  function clearAgents() { prevPos.clear(); for (const [, l] of lastLabels) l.sprite.parent?.remove(l.sprite); lastLabels = new Map(); for (const p of survivorPool) p.label = null; }

  return { setWorld, setConditions, update, setCamera, resize, clearAgents, get mode() { return mode; } };
}

// ---- the creature: an original tangle of frozen roots with ember eyes ------------------------
function buildCreature() {
  const bark = new THREE.MeshStandardMaterial({ color: 0x2a1a12, roughness: 1, emissive: 0x3a0806, emissiveIntensity: 0.8, flatShading: true });
  const ember = new THREE.MeshBasicMaterial({ color: 0xff2a1a });
  const frost = new THREE.MeshStandardMaterial({ color: 0xcfe3f2, roughness: 0.6 });
  const group = new THREE.Group();
  const inner = new THREE.Group(); inner.scale.setScalar(0.62); group.add(inner);
  const tube = (pts, r, m = bark) => new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 18, r, 6), m);
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 1), bark); core.position.y = 1.7; core.scale.set(0.85, 1.35, 0.8); core.castShadow = true;
  const skull = new THREE.Mesh(new THREE.IcosahedronGeometry(0.32, 0), bark); skull.position.set(0.32, 2.4, 0); skull.castShadow = true;
  inner.add(core, skull);
  const legs = [];
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2 + 0.4; const r = 1.0 + 0.2 * (k % 2);
    const t = tube([new THREE.Vector3(0, 1.5, 0), new THREE.Vector3(Math.cos(a) * r * 0.4, 1.0, Math.sin(a) * r * 0.4), new THREE.Vector3(Math.cos(a + 0.3) * r * 0.85, 0.4, Math.sin(a + 0.3) * r * 0.85), new THREE.Vector3(Math.cos(a + 0.5) * r * 1.05, 0.02, Math.sin(a + 0.5) * r * 1.05)], 0.08);
    t.castShadow = true; legs.push(t); inner.add(t);
  }
  const arms = [];
  for (const side of [-1, 1]) {
    const arm = new THREE.Group();
    arm.add(tube([new THREE.Vector3(0.2, 2.0, side * 0.3), new THREE.Vector3(0.7, 2.15, side * 0.65), new THREE.Vector3(1.25, 1.6, side * 0.7), new THREE.Vector3(1.6, 1.0, side * 0.45)], 0.065));
    for (let f = 0; f < 4; f++) arm.add(tube([new THREE.Vector3(1.6, 1.0, side * 0.45), new THREE.Vector3(1.85, 0.9 + f * 0.06, side * (0.3 + f * 0.1)), new THREE.Vector3(2.05, 0.65 + f * 0.1, side * (0.22 + f * 0.12))], 0.024));
    arm.userData.side = side; arms.push(arm); inner.add(arm);
  }
  for (let k = 0; k < 6; k++) {
    const a = k * 1.1;
    inner.add(tube([new THREE.Vector3(-0.1, 2.0, 0), new THREE.Vector3(-0.3 + Math.cos(a) * 0.2, 2.55 + k * 0.05, Math.sin(a) * 0.35), new THREE.Vector3(-0.55 + Math.cos(a) * 0.3, 3.05 + k * 0.08, Math.sin(a) * 0.55)], 0.032, k % 2 ? bark : frost));
  }
  for (let k = 0; k < 11; k++) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.04 + 0.025 * (k % 3), 8, 6), ember);
    const a = k * 2.39;
    if (k < 6) e.position.set(0.58 + Math.cos(a) * 0.08, 2.37 + Math.sin(a) * 0.13, Math.sin(a * 1.7) * 0.19);
    else e.position.set(0.44 + Math.cos(a) * 0.1, 1.6 + (k % 4) * 0.15, Math.sin(a) * 0.33);
    inner.add(e);
  }
  const glow = new THREE.PointLight(0xff2a1a, 4, 4, 1.4); glow.position.set(0.4, 1.4, 0); group.add(glow);
  return {
    group,
    animate(t, state) {
      const fast = state === 'chase' ? 2.2 : state === 'feed' ? 0.3 : 1;
      inner.position.y = Math.sin(t * 3 * fast) * 0.03;
      legs.forEach((l, i) => { l.rotation.y = Math.sin(t * 2.2 * fast + i) * 0.12; });
      arms.forEach((a) => { a.rotation.z = Math.sin(t * 1.6 * fast + a.userData.side) * 0.12 - (state === 'chase' ? 0.25 : 0); });
      glow.intensity = state === 'chase' ? 7 + Math.sin(t * 20) * 2 : 4;
    },
  };
}

// ---- a survivor: hooded parka, scarf, flashlight --------------------------------------------
function buildSurvivor() {
  const coat = new THREE.MeshStandardMaterial({ color: 0xffd27a, roughness: 0.75, emissive: 0xffd27a, emissiveIntensity: 0.12 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2c3138, roughness: 0.9 });
  const group = new THREE.Group();
  const body = new THREE.Group(); group.add(body);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.42, 6, 14), coat); torso.position.y = 0.98; torso.castShadow = true;
  const hood = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), coat); hood.position.y = 1.47; hood.castShadow = true;
  const face = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10), new THREE.MeshStandardMaterial({ color: 0xe3b9a0 })); face.position.set(0.08, 1.45, 0);
  const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.045, 8, 18), new THREE.MeshStandardMaterial({ color: 0xb3262b })); scarf.rotation.x = Math.PI / 2; scarf.position.y = 1.28;
  const bag = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.26, 0.24), new THREE.MeshStandardMaterial({ color: 0x3b4252, roughness: 0.8 })); bag.position.set(-0.17, 1.05, 0);
  const legL = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.38, 4, 8), dark); legL.position.set(0, 0.42, -0.09); legL.castShadow = true;
  const legR = legL.clone(); legR.position.z = 0.09;
  const torchM = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.2, 8), new THREE.MeshStandardMaterial({ color: 0x222, metalness: 0.6 })); torchM.rotation.z = Math.PI / 2; torchM.position.set(0.24, 1.1, 0.12);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.03, 10), new THREE.MeshBasicMaterial({ color: 0xfff6d8 })); lens.rotation.y = Math.PI / 2; lens.position.set(0.345, 1.1, 0.12);
  body.add(torso, hood, face, scarf, bag, legL, legR, torchM, lens);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.36, 32), new THREE.MeshBasicMaterial({ color: 0xffd27a, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03; group.add(ring);
  let colorKey = '';
  return {
    group, body,
    setColor(c) { if (c === colorKey) return; colorKey = c; coat.color.set(c); coat.emissive.set(c); ring.material.color.set(c); },
    animate(t, moving, running) {
      const sp = running ? 16 : 9;
      const sw = moving ? Math.sin(t * sp) * (running ? 0.5 : 0.3) : 0;
      legL.rotation.z = sw; legR.rotation.z = -sw;
      torso.rotation.z = running ? -0.2 : 0;
    },
  };
}
