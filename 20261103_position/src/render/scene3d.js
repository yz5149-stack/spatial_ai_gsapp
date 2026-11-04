// three.js view of the night forest. Reads the game state, never changes it.
// Simulation coordinates: x east, y south, z up. three.js: X = x, Y = z (up), Z = y.
// The camera follows you from the south, so up on the screen is north and W moves you up.

import * as THREE from 'three';
import { G, C, nodeXYL } from '../sim/world.js';
import { eyePoint, inCone, segmentClear } from '../sim/los.js';
import { actionsFor, treeNextTo } from '../sim/escape.js';

const tmpMatrix = new THREE.Matrix4();
const tmpQuat = new THREE.Quaternion();
const tmpScale = new THREE.Vector3();
const tmpPos = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

function instanced(geometry, material, cells, place) {
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, cells.length));
  mesh.count = cells.length;
  cells.forEach((c, i) => {
    place(c, tmpPos, tmpScale, tmpQuat);
    tmpMatrix.compose(tmpPos, tmpQuat, tmpScale);
    mesh.setMatrixAt(i, tmpMatrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

const jitter = (x, y, k) => {
  const s = Math.sin(x * 127.1 + y * 311.7 + k * 74.7) * 43758.5453;
  return s - Math.floor(s);
};

export function makeScene3D(container, palette) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 300);
  scene.background = new THREE.Color(palette.sky);
  scene.fog = new THREE.FogExp2(palette.sky, 0.045);

  const hemi = new THREE.HemisphereLight(0x8ea4c8, 0x0b0e14, 0.75);
  const moon = new THREE.DirectionalLight(0x9fb4d8, 0.45);
  moon.position.set(-20, 40, -10);
  scene.add(hemi, moon);

  let world = null;
  let rays = null;
  let mapGroup = null;
  let canopyGroup = null;
  let mapView = false;
  let zoom = 1;
  const options = { relations: true, canopy: true };
  const camTarget = new THREE.Vector3();
  const camLook = new THREE.Vector3();
  const camOff = new THREE.Vector3(0, 15.5, 10.5);
  let climbFrom = null;
  let flashFlick = 1;

  const floorY = (level) => level * world.config.levelHeight;
  const cellV = (n, lift = 0.1) => { const { x, y, level } = nodeXYL(world, n); return new THREE.Vector3(x + 0.5, floorY(level) + lift, y + 0.5); };
  const colorOf = (who) => ({ player: palette.player, creature: palette.creature, crow: palette.crow, shot: '#ffffff' }[who] ?? palette.rel);

  // ---- you: a survivor in a hooded winter coat, scarf, backpack and flashlight ------------
  const you = new THREE.Group();
  const coat = new THREE.MeshStandardMaterial({ color: palette.player, roughness: 0.75, emissive: palette.player, emissiveIntensity: 0.16, fog: false });
  const cloth = new THREE.MeshStandardMaterial({ color: 0x2c3138, roughness: 0.9, fog: false });
  const skin = new THREE.MeshStandardMaterial({ color: 0xe3b9a0, roughness: 0.7, fog: false });
  const red = new THREE.MeshStandardMaterial({ color: 0xb3262b, roughness: 0.8, fog: false });
  const figure = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.4, 6, 14), coat);
  torso.position.y = 0.98;
  torso.scale.set(1, 1, 0.85);
  const hem = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.26, 0.18, 14), coat);
  hem.position.y = 0.7;
  const hood = new THREE.Mesh(new THREE.SphereGeometry(0.2, 18, 14), coat);
  hood.position.y = 1.45;
  hood.scale.set(1.05, 1.08, 1);
  const face = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), skin);
  face.position.set(0.1, 1.43, 0);
  const fur = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.045, 8, 20), new THREE.MeshStandardMaterial({ color: 0xe8e1d4, roughness: 1, fog: false }));
  fur.rotation.y = Math.PI / 2;
  fur.position.set(0.13, 1.44, 0);
  const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.055, 8, 18), red);
  scarf.rotation.x = Math.PI / 2;
  scarf.position.y = 1.26;
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.3, 0.1), red);
  tail.position.set(-0.17, 1.12, 0.08);
  tail.rotation.z = 0.25;
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.42, 0.34), new THREE.MeshStandardMaterial({ color: 0x3d4a3a, roughness: 0.9, fog: false }));
  pack.position.set(-0.27, 1.02, 0);
  const limb = (r, len, mat) => { const g = new THREE.Group(); const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 10), mat); m.position.y = -len / 2 - r; g.add(m); return g; };
  const legL = limb(0.075, 0.36, cloth);
  const legR = limb(0.075, 0.36, cloth);
  legL.position.set(0, 0.64, -0.1);
  legR.position.set(0, 0.64, 0.1);
  for (const leg of [legL, legR]) {
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1, 0.12), new THREE.MeshStandardMaterial({ color: 0x1a1c20, fog: false }));
    boot.position.set(0.04, -0.58, 0);
    leg.add(boot);
  }
  const armL = limb(0.06, 0.32, coat);
  const armR = limb(0.06, 0.32, coat);
  armL.position.set(0, 1.2, -0.25);
  armR.position.set(0, 1.2, 0.25);
  const torch = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 0.26, 10), new THREE.MeshStandardMaterial({ color: 0x1d1f23, emissive: 0xffe2a8, emissiveIntensity: 0.5, fog: false }));
  torch.position.set(0, -0.48, 0);
  armR.add(torch);
  // gloves at the ends of the arms, a zipper and pockets on the coat, backpack straps
  const glove = new THREE.MeshStandardMaterial({ color: 0x23272d, roughness: 0.9, fog: false });
  for (const arm of [armL, armR]) {
    const h = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), glove);
    h.position.y = -0.46;
    arm.add(h);
  }
  const zipper = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.5, 0.03), new THREE.MeshStandardMaterial({ color: 0x8b6a2a, metalness: 0.6, roughness: 0.4, fog: false }));
  zipper.position.set(0.2, 0.98, 0);
  const pocketMat = new THREE.MeshStandardMaterial({ color: 0xa8742a, roughness: 0.8, fog: false });
  const pockets = [-0.1, 0.1].map((z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.12, 0.12), pocketMat); m.position.set(0.19, 0.8, z); return m; });
  const strap = new THREE.MeshStandardMaterial({ color: 0x2a3326, fog: false });
  const straps = [-0.12, 0.12].map((z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.48, 0.04), strap); m.position.set(0.12, 1.04, z); m.rotation.z = -0.25; return m; });
  figure.add(torso, hem, hood, face, fur, scarf, tail, pack, legL, legR, armL, armR, zipper, ...pockets, ...straps);
  // the flashlight beam you can see in the falling snow
  const beamMat = new THREE.MeshBasicMaterial({ color: 0xffe9c4, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false, fog: false, blending: THREE.AdditiveBlending });
  const torchBeam = new THREE.Mesh(new THREE.ConeGeometry(1.5, 6, 24, 1, true), beamMat);
  torchBeam.rotation.z = Math.PI / 2;
  torchBeam.position.set(0.45 + 3, 0.75, 0.2);
  you.add(torchBeam);
  // soft shadows on the snow
  const blob = (r) => { const m = new THREE.Mesh(new THREE.CircleGeometry(r, 24), new THREE.MeshBasicMaterial({ color: 0x05070a, transparent: true, opacity: 0.45, depthWrite: false })); m.rotation.x = -Math.PI / 2; m.position.y = 0.02; return m; };
  you.add(blob(0.42));
  const ringMat = new THREE.MeshBasicMaterial({ color: palette.player, transparent: true, opacity: 0.9, side: THREE.DoubleSide, fog: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.58, 40), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.04;
  you.add(figure, ring);
  scene.add(you);
  // the tree you can climb right now: a ring at its foot
  const climbRing = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.72, 40), new THREE.MeshBasicMaterial({ color: palette.rel, transparent: true, opacity: 0.85, side: THREE.DoubleSide, fog: false }));
  climbRing.rotation.x = -Math.PI / 2;
  scene.add(climbRing);

  const flashlight = new THREE.SpotLight(0xffe7c2, 16, 17, 0.55, 0.5, 1.05);
  flashlight.position.set(0, 1.1, 0);
  scene.add(flashlight, flashlight.target);
  const glow = new THREE.PointLight(0xffe7c2, 1.6, 4.5, 1.2); // so you are always visible
  scene.add(glow);

  // ---- the creature: an original tangle of roots with ember eyes -------------------------
  const bark = new THREE.MeshStandardMaterial({ color: palette.creatureBody, roughness: 1, emissive: 0x2a0806, emissiveIntensity: 0.6, flatShading: true, fog: false });
  const ice = new THREE.MeshStandardMaterial({ color: 0xa8dcff, roughness: 0.2, metalness: 0.1, emissive: 0x3aa0ff, emissiveIntensity: 0.6, flatShading: true, fog: false });
  const ember = new THREE.MeshBasicMaterial({ color: palette.creature, fog: false });
  const creature = new THREE.Group();
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 1), bark);
  core.position.y = 1.75;
  core.scale.set(0.9, 1.4, 0.8);
  const skull = new THREE.Mesh(new THREE.IcosahedronGeometry(0.34, 0), bark);
  skull.position.set(0.3, 2.45, 0);
  creature.add(core, skull);
  const tendrils = [];
  const tube = (pts, r) => new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 20, r, 6), bark);
  // legs: roots that splay into the snow
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2 + 0.4;
    const r = 1.1 + 0.25 * (k % 2);
    const t = tube([
      new THREE.Vector3(0, 1.5, 0),
      new THREE.Vector3(Math.cos(a) * r * 0.4, 1.05, Math.sin(a) * r * 0.4),
      new THREE.Vector3(Math.cos(a + 0.3) * r * 0.85, 0.45, Math.sin(a + 0.3) * r * 0.85),
      new THREE.Vector3(Math.cos(a + 0.5) * r * 1.1, 0.02, Math.sin(a + 0.5) * r * 1.1),
    ], 0.085);
    tendrils.push(t); creature.add(t);
  }
  // two long arms reaching forward, with twig fingers
  for (const side of [-1, 1]) {
    const arm = new THREE.Group();
    const t = tube([
      new THREE.Vector3(0.2, 2.05, side * 0.3),
      new THREE.Vector3(0.75, 2.2, side * 0.7),
      new THREE.Vector3(1.35, 1.6, side * 0.75),
      new THREE.Vector3(1.75, 0.95, side * 0.5),
    ], 0.07);
    arm.add(t);
    for (let f = 0; f < 4; f++) {
      const ff = tube([
        new THREE.Vector3(1.75, 0.95, side * 0.5),
        new THREE.Vector3(2.0, 0.85 + f * 0.06, side * (0.35 + f * 0.1)),
        new THREE.Vector3(2.2, 0.6 + f * 0.1, side * (0.25 + f * 0.13)),
      ], 0.025);
      arm.add(ff);
    }
    arm.userData.side = side;
    tendrils.push(arm); creature.add(arm);
  }
  // spines on its back
  for (let k = 0; k < 6; k++) {
    const a = k * 1.1;
    const t = tube([
      new THREE.Vector3(-0.1, 2.0, 0),
      new THREE.Vector3(-0.35 + Math.cos(a) * 0.2, 2.6 + k * 0.05, Math.sin(a) * 0.4),
      new THREE.Vector3(-0.6 + Math.cos(a) * 0.3, 3.1 + k * 0.08, Math.sin(a) * 0.6),
    ], 0.035);
    tendrils.push(t); creature.add(t);
  }
  // a cluster of ember eyes on the skull and the body
  for (let k = 0; k < 11; k++) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.04 + 0.025 * (k % 3), 8, 6), ember);
    const a = k * 2.39;
    const onSkull = k < 6;
    if (onSkull) e.position.set(0.55 + Math.cos(a) * 0.08, 2.42 + Math.sin(a) * 0.14, Math.sin(a * 1.7) * 0.2);
    else e.position.set(0.42 + Math.cos(a) * 0.1, 1.6 + (k % 4) * 0.16, Math.sin(a) * 0.35);
    creature.add(e);
  }
  const creatureShadow = blob(1.3);
  creature.add(creatureShadow);
  const creatureLight = new THREE.PointLight(palette.creature, 4, 7, 1.3);
  creatureLight.position.set(0.6, 2.2, 0);
  creature.add(creatureLight);
  const iceRing = new THREE.Mesh(new THREE.RingGeometry(1.1, 1.3, 48), new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.85, side: THREE.DoubleSide, fog: false }));
  iceRing.rotation.x = -Math.PI / 2;
  iceRing.position.y = 0.05;
  creature.add(iceRing);
  scene.add(creature);

  // the creature's vision cone, shown while you can see it (red, so you know where it looks)
  const fanGeo = new THREE.BufferGeometry();
  fanGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(80 * 9), 3));
  const fan = new THREE.Mesh(fanGeo, new THREE.MeshBasicMaterial({ color: palette.creature, transparent: true, opacity: 0.2, side: THREE.DoubleSide, fog: false, depthWrite: false }));
  fan.frustumCulled = false;
  scene.add(fan);

  // ---- the vaccine case, with a beam so you can find it through the fog -------------------
  const caseGroup = new THREE.Group();
  const caseBox = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.4, 0.42), new THREE.MeshStandardMaterial({ color: 0xd8dee4, metalness: 0.6, roughness: 0.3, fog: false }));
  caseBox.position.y = 0.3;
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.08, 0.44), new THREE.MeshBasicMaterial({ color: palette.caseGlow, fog: false }));
  stripe.position.y = 0.32;
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.025, 6, 16, Math.PI), new THREE.MeshStandardMaterial({ color: 0x333333, fog: false }));
  handle.position.y = 0.5;
  const alarmBulb = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff2a2a, fog: false }));
  alarmBulb.position.set(0.2, 0.55, 0);
  caseGroup.add(caseBox, stripe, handle, alarmBulb);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.35, 9, 16, 1, true), new THREE.MeshBasicMaterial({ color: palette.caseGlow, transparent: true, opacity: 0.18, side: THREE.DoubleSide, fog: false, depthWrite: false }));
  beam.position.y = 4.5;
  const caseLight = new THREE.PointLight(palette.caseGlow, 2.2, 4, 1.3);
  caseLight.position.y = 0.8;
  caseGroup.add(beam, caseLight);
  scene.add(caseGroup);

  // ---- crows ------------------------------------------------------------------------------
  const crowMat = new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.7, fog: false });
  const crowEyeOff = new THREE.MeshBasicMaterial({ color: 0x555555, fog: false });
  const crowEyeOn = new THREE.MeshBasicMaterial({ color: palette.crow, fog: false });
  const crowMeshes = [];
  function makeCrow() {
    const g = new THREE.Group();
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), crowMat);
    b.scale.set(1.3, 0.9, 0.85);
    b.position.y = 0.35;
    const h = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), crowMat);
    h.position.set(0.26, 0.58, 0);
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.2, 8), new THREE.MeshStandardMaterial({ color: 0x777066, fog: false }));
    beak.rotation.z = -Math.PI / 2;
    beak.position.set(0.46, 0.57, 0);
    const eyes = [-0.08, 0.08].map((z) => { const e = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), crowEyeOff); e.position.set(0.36, 0.63, z); return e; });
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.35, 4), crowMat);
    tail.rotation.z = Math.PI / 2 + 0.3;
    tail.position.set(-0.36, 0.38, 0);
    g.add(b, h, beak, ...eyes, tail);
    g.userData.eyes = eyes;
    scene.add(g);
    return g;
  }

  // ---- sound ripples and shots ------------------------------------------------------------
  const ripples = [];
  const rippleGeo = new THREE.RingGeometry(0.9, 1.0, 48);
  function addRipple(node, color, now, big = false) {
    const mesh = new THREE.Mesh(rippleGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, fog: false, depthWrite: false }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.copy(cellV(node, 0.08));
    scene.add(mesh);
    ripples.push({ mesh, born: now, big });
  }
  const tracers = [];

  // ---- falling snow ---------------------------------------------------------------------
  const SNOW = 1400;
  const snowGeo = new THREE.BufferGeometry();
  const snowPos = new Float32Array(SNOW * 3);
  for (let i = 0; i < SNOW; i++) { snowPos[i * 3] = Math.random() * 40 - 20; snowPos[i * 3 + 1] = Math.random() * 14; snowPos[i * 3 + 2] = Math.random() * 40 - 20; }
  snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPos, 3));
  const snow = new THREE.Points(snowGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.07, transparent: true, opacity: 0.8, depthWrite: false }));
  snow.frustumCulled = false;
  scene.add(snow);

  // ---- position + movement markers ----------------------------------------------------------
  const relGroup = new THREE.Group();
  scene.add(relGroup);
  const relMat = (color, opacity = 1) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, fog: false, depthWrite: false });
  const lineMat = (color) => new THREE.LineBasicMaterial({ color, fog: false });
  const dashMat = (color) => new THREE.LineDashedMaterial({ color, dashSize: 0.4, gapSize: 0.25, fog: false });
  const flashes = [];
  const FLASH_MS = 2600;

  function clearGroup(group) {
    for (const o of [...group.children]) { group.remove(o); o.geometry?.dispose(); o.material?.dispose?.(); }
  }

  function buildRelations(game) {
    clearGroup(relGroup);
    const seen = game.player.seesCreature;
    for (const r of game.relations.position) {
      if (r.kind === 'above') {
        if (!seen) continue;
        const lo = cellV(game[r.lower].node, 1.4);
        const hi = cellV(game[r.upper].node, 0.05);
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([lo, hi]), dashMat(palette.rel));
        line.computeLineDistances();
        relGroup.add(line);
      } else if (r.kind === 'behind') {
        if (r.who === 'creature' && !seen) continue;
        const o = game[r.of];
        const m = new THREE.Mesh(new THREE.CircleGeometry(world.config.visionRange, 40, Math.PI / 2, Math.PI), relMat(colorOf(r.who), 0.1));
        m.rotation.x = -Math.PI / 2;
        m.rotation.z = -o.facing;
        m.position.copy(cellV(o.node, 0.06));
        relGroup.add(m);
      } else if (r.kind === 'adjacent') {
        if (r.b === 'creature' && !seen) continue;
        for (const n of [game.player.node, r.node]) {
          const sq = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.56, 4, 1, Math.PI / 4), relMat(palette.rel, 0.95));
          sq.rotation.x = -Math.PI / 2;
          sq.position.copy(cellV(n, 0.05));
          sq.scale.setScalar(1.15);
          relGroup.add(sq);
        }
      } else if (r.kind === 'between') {
        if (!seen) continue;
        const a = cellV(game.player.node, 0.25);
        const b = cellV(r.node, 0.25);
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), dashMat(palette.creature));
        line.computeLineDistances();
        relGroup.add(line);
        const m = cellV(game.creature.node, 2.7);
        const k = 0.4;
        relGroup.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(m.x - k, m.y + k, m.z), new THREE.Vector3(m.x + k, m.y - k, m.z),
          new THREE.Vector3(m.x + k, m.y + k, m.z), new THREE.Vector3(m.x - k, m.y - k, m.z),
        ]), lineMat(palette.creature)));
      } else if (r.kind === 'among') {
        const box = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(3, 0.02, 3)), dashMat(palette.hidden));
        box.computeLineDistances();
        box.position.copy(cellV(game.player.node, 0.08));
        relGroup.add(box);
      }
    }
    relGroup.visible = options.relations;
  }

  function addFlash(m, now) {
    const color = colorOf(m.who);
    let obj = null;
    if (m.kind === 'up' || m.kind === 'down') {
      obj = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.7, 16), relMat(color, 0.95));
      if (m.kind === 'down') obj.rotation.z = Math.PI;
      obj.position.copy(cellV(m.node, 2.3));
      obj.userData.rise = m.kind === 'up' ? 1 : -1;
    } else if (m.kind === 'around') {
      obj = new THREE.Line(new THREE.BufferGeometry().setFromPoints(m.trail.map((n) => cellV(n, 0.15))), new THREE.LineBasicMaterial({ color, transparent: true, fog: false }));
    } else if (m.kind === 'past') {
      obj = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.0, 40), relMat(color, 0.9));
      obj.rotation.x = -Math.PI / 2;
      obj.position.copy(cellV(m.node, 0.1));
      obj.userData.grow = true;
    }
    if (!obj) return;
    obj.userData.base = obj.position.y;
    scene.add(obj);
    flashes.push({ obj, born: now });
  }

  // ---- ground texture: snow, the trodden trail, footprints, tyre tracks, shadows under trees --
  function makeGround() {
    const { W, H, ground } = world;
    const S = 32;
    const cv = document.createElement('canvas');
    cv.width = (W + 14) * S;
    cv.height = (H + 14) * S;
    const g = cv.getContext('2d');
    const ox = 7 * S;
    const oy = 7 * S;
    g.fillStyle = palette.snow;
    g.fillRect(0, 0, cv.width, cv.height);
    // soft drifts
    for (let i = 0; i < 900; i++) {
      const x = Math.random() * cv.width;
      const y = Math.random() * cv.height;
      const r = 6 + Math.random() * 40;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      const shade = Math.random() < 0.5 ? 'rgba(255,255,255,0.10)' : 'rgba(120,140,170,0.07)';
      grd.addColorStop(0, shade);
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    const reserved = world.reserved;
    if (reserved) {
      // the trail and side paths: packed, greyer snow with soft edges
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const v = reserved[y * W + x];
        if (v !== 1 && v !== 2) continue;
        const cx = ox + (x + 0.5) * S;
        const cy = oy + (y + 0.5) * S;
        const grd = g.createRadialGradient(cx, cy, 0, cx, cy, S * 0.95);
        grd.addColorStop(0, v === 1 ? 'rgba(95,105,120,0.42)' : 'rgba(95,105,120,0.28)');
        grd.addColorStop(1, 'rgba(95,105,120,0)');
        g.fillStyle = grd;
        g.fillRect(cx - S, cy - S, S * 2, S * 2);
      }
      // footprints along the trail
      g.fillStyle = 'rgba(70,80,96,0.45)';
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (reserved[y * W + x] !== 1 || jitter(x, y, 31) > 0.45) continue;
        for (let k = 0; k < 2; k++) {
          const fx = ox + (x + 0.25 + 0.5 * k) * S;
          const fy = oy + (y + 0.35 + 0.3 * jitter(x, y, 32 + k)) * S;
          g.beginPath(); g.ellipse(fx, fy, 3.2, 5.5, 0.4 * (k ? 1 : -1), 0, Math.PI * 2); g.fill();
        }
      }
      // clearings: a slightly bluer, untouched snowfield
      for (const c of world.clearings ?? []) {
        const cx = ox + (c.x + 0.5) * S;
        const cy = oy + (c.y + 0.5) * S;
        const grd = g.createRadialGradient(cx, cy, 0, cx, cy, (c.r + 1) * S);
        grd.addColorStop(0, 'rgba(200,225,255,0.22)');
        grd.addColorStop(1, 'rgba(200,225,255,0)');
        g.fillStyle = grd;
        g.fillRect(cx - (c.r + 1) * S, cy - (c.r + 1) * S, (c.r + 1) * 2 * S, (c.r + 1) * 2 * S);
      }
    }
    // tyre tracks behind the car
    if (world.car) {
      g.strokeStyle = 'rgba(60,68,80,0.5)';
      g.lineWidth = 6;
      for (const dy of [0.45, 1.55]) {
        g.beginPath();
        g.moveTo(ox + 0 * S, oy + (world.car.y + dy) * S);
        g.lineTo(ox + world.car.x * S, oy + (world.car.y + dy) * S);
        g.stroke();
      }
    }
    // shadows under trees, bushes and rocks
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const t = ground[y * W + x];
      if (t !== G.TREE && t !== G.BUSH && t !== G.ROCK && t !== G.LOG) continue;
      const cx = ox + (x + 0.5) * S;
      const cy = oy + (y + 0.6) * S;
      const r = t === G.TREE ? S * 0.9 : S * 0.65;
      const grd = g.createRadialGradient(cx, cy, 0, cx, cy, r);
      grd.addColorStop(0, 'rgba(20,28,40,0.38)');
      grd.addColorStop(1, 'rgba(20,28,40,0)');
      g.fillStyle = grd;
      g.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W + 14, H + 14), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(W / 2, 0, H / 2);
    return floor;
  }

  // ---- the broken-down car --------------------------------------------------------------------
  function makeCar(car) {
    const g = new THREE.Group();
    const paint = new THREE.MeshStandardMaterial({ color: 0x5a1f1c, roughness: 0.45, metalness: 0.4 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x14171b, roughness: 0.6 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x223040, roughness: 0.1, metalness: 0.6, emissive: 0x0a1018 });
    const snowM = new THREE.MeshStandardMaterial({ color: palette.snow, roughness: 0.95 });
    const L = car.w - 0.2;
    const body = new THREE.Mesh(new THREE.BoxGeometry(L, 0.55, 1.6), paint);
    body.position.y = 0.55;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(L * 0.5, 0.5, 1.45), glass);
    cabin.position.set(-0.15, 1.05, 0);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(L * 0.5, 0.08, 1.45), paint);
    roof.position.set(-0.15, 1.33, 0);
    const roofSnow = new THREE.Mesh(new THREE.BoxGeometry(L * 0.48, 0.1, 1.4), snowM);
    roofSnow.position.set(-0.15, 1.42, 0);
    const hoodSnow = new THREE.Mesh(new THREE.BoxGeometry(L * 0.3, 0.06, 1.5), snowM);
    hoodSnow.position.set(L * 0.33, 0.86, 0);
    g.add(body, cabin, roof, roofSnow, hoodSnow);
    for (const [wx, wz] of [[-L * 0.32, 0.8], [L * 0.32, 0.8], [-L * 0.32, -0.8], [L * 0.32, -0.8]]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.22, 14), dark);
      w.rotation.x = Math.PI / 2;
      w.position.set(wx, 0.3, wz);
      g.add(w);
    }
    const lampOn = new THREE.MeshBasicMaterial({ color: 0xfff1c8, fog: false });
    const tail = new THREE.MeshBasicMaterial({ color: 0xff2a20, fog: false });
    for (const z of [-0.55, 0.55]) {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 0.26), lampOn);
      hl.position.set(L / 2 + 0.01, 0.62, z);
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.22), tail);
      tl.position.set(-L / 2 - 0.01, 0.62, z);
      g.add(hl, tl);
    }
    // the open driver's door
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.5, 0.05), paint);
    door.position.set(0.1, 0.7, 1.02);
    door.rotation.y = -0.7;
    g.add(door);
    // two headlight beams down the trail
    const beams = new THREE.SpotLight(0xfff0cc, 22, 18, 0.42, 0.6, 1.0);
    beams.position.set(L / 2 + 0.2, 0.7, 0);
    beams.target.position.set(L / 2 + 10, 0, 0);
    g.add(beams, beams.target);
    const beamCone = new THREE.Mesh(new THREE.ConeGeometry(1.6, 7, 20, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff0cc, transparent: true, opacity: 0.05, side: THREE.DoubleSide, depthWrite: false, fog: false }));
    beamCone.rotation.z = Math.PI / 2;
    beamCone.position.set(L / 2 + 3.6, 0.6, 0);
    g.add(beamCone);
    g.position.set(car.x + car.w / 2, 0, car.y + car.h / 2);
    return g;
  }

  // ---- map ---------------------------------------------------------------------------------
  function buildMap(newWorld, newRays, exits = []) {
    world = newWorld;
    rays = newRays;
    if (mapGroup) {
      scene.remove(mapGroup);
      mapGroup.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); });
    }
    for (const m of crowMeshes) scene.remove(m);
    crowMeshes.length = 0;
    mapGroup = new THREE.Group();
    canopyGroup = new THREE.Group();
    const { W, H, ground, canopy, config } = world;
    const cells = (arr, type) => {
      const out = [];
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (arr[y * W + x] === type) out.push([x, y]);
      return out;
    };
    const ident = (q) => q.identity();
    const snowMat = new THREE.MeshStandardMaterial({ color: palette.snow, roughness: 0.95 });

    mapGroup.add(makeGround());

    // the boundary wall, with an opening at the hospital door
    const door = exits[0];
    const dx0 = door.node % W;
    const dy0 = Math.floor(door.node / W);
    const gap = new Set([dy0 * W + dx0 + 1]);
    const wallMat = new THREE.MeshStandardMaterial({ color: palette.wall, roughness: 1 });
    mapGroup.add(instanced(new THREE.BoxGeometry(1, 1, 1), wallMat, cells(ground, G.WALL).filter(([x, y]) => !gap.has(y * W + x)),
      ([x, y], p, s, q) => { p.set(x + 0.5, 1.1, y + 0.5); s.set(1, 2.2, 1); ident(q); }));
    mapGroup.add(instanced(new THREE.BoxGeometry(1, 1, 1), snowMat, cells(ground, G.WALL).filter(([x, y]) => !gap.has(y * W + x)),
      ([x, y], p, s, q) => { p.set(x + 0.5, 2.25, y + 0.5); s.set(1.04, 0.12, 1.04); ident(q); }));

    // the hospital, just outside the opening: a block with lit windows, a lit door and a green cross
    const hosp = new THREE.Group();
    const hx = W + 2.2;
    const hz = dy0 + 0.5;
    const hall = new THREE.Mesh(new THREE.BoxGeometry(3.4, 4.2, 7), new THREE.MeshStandardMaterial({ color: palette.hospital, roughness: 0.8 }));
    hall.position.set(hx, 2.1, hz);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.2, 7.2), snowMat);
    roof.position.set(hx, 4.3, hz);
    const doorMat = new THREE.MeshBasicMaterial({ color: palette.door, fog: false });
    const doorPanel = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 2), doorMat);
    doorPanel.rotation.y = -Math.PI / 2;
    doorPanel.position.set(hx - 1.71, 1, hz);
    const winMat = new THREE.MeshBasicMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.55, fog: false });
    for (const z of [-2.4, -1.2, 1.2, 2.4]) for (const y of [1.3, 2.9]) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.6), winMat);
      w.rotation.y = -Math.PI / 2;
      w.position.set(hx - 1.71, y, hz + z);
      hosp.add(w);
    }
    const crossMat = new THREE.MeshBasicMaterial({ color: palette.cross, fog: false });
    const c1 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.0, 0.32), crossMat);
    const c2 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.32, 1.0), crossMat);
    for (const c of [c1, c2]) { c.position.set(hx - 1.75, 3.4, hz); hosp.add(c); }
    const doorLight = new THREE.PointLight(palette.door, 3, 7, 1.2);
    doorLight.position.set(hx - 2.4, 1.6, hz);
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(0.96, 0.96), new THREE.MeshBasicMaterial({ color: palette.door, transparent: true, opacity: 0.45, side: THREE.DoubleSide, fog: false }));
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(dx0 + 0.5, 0.03, dy0 + 0.5);
    hosp.add(hall, roof, doorPanel, doorLight, pad);
    mapGroup.add(hosp);

    // pines: three stacked tiers with snow on each, different sizes; some dead, bare trees
    const trees = cells(ground, G.TREE);
    const dead = trees.filter(([x, y]) => jitter(x, y, 9) < 0.12);
    const pines = trees.filter(([x, y]) => jitter(x, y, 9) >= 0.12);
    const sizeOf = (x, y) => 0.8 + 0.5 * jitter(x, y, 1);
    const turn = (x, y, k, q) => q.setFromAxisAngle(UP, jitter(x, y, k) * 6.3);
    mapGroup.add(instanced(new THREE.CylinderGeometry(0.09, 0.15, 1, 7), new THREE.MeshStandardMaterial({ color: palette.trunk, roughness: 1 }), pines,
      ([x, y], p, sc, q) => { const k = sizeOf(x, y); p.set(x + 0.5, 0.6 * k, y + 0.5); sc.set(k, 1.2 * k, k); q.identity(); }));
    const pine = new THREE.MeshStandardMaterial({ color: palette.tree, roughness: 0.95, flatShading: true });
    const TIERS = [[0.62, 1.1, 1.05], [0.48, 0.95, 1.75], [0.32, 0.8, 2.4]]; // radius, height, base height
    for (const [r, h, base] of TIERS) {
      mapGroup.add(instanced(new THREE.ConeGeometry(r, h, 8), pine, pines,
        ([x, y], p, sc, q) => { const k = sizeOf(x, y); p.set(x + 0.5, (base + h / 2) * k, y + 0.5); sc.set(k, k, k); turn(x, y, 2, q); }));
      mapGroup.add(instanced(new THREE.ConeGeometry(r * 0.72, h * 0.42, 8), snowMat, pines,
        ([x, y], p, sc, q) => { const k = sizeOf(x, y); p.set(x + 0.5, (base + h * 0.72) * k, y + 0.5); sc.set(k, k, k); turn(x, y, 2, q); }));
    }
    // dead trees: a black trunk with crooked branches
    const deadMat = new THREE.MeshStandardMaterial({ color: 0x15120f, roughness: 1 });
    mapGroup.add(instanced(new THREE.CylinderGeometry(0.05, 0.13, 1, 6), deadMat, dead,
      ([x, y], p, sc, q) => { const k = sizeOf(x, y); p.set(x + 0.5, 1.5 * k, y + 0.5); sc.set(k, 3 * k, k); q.identity(); }));
    for (let b = 0; b < 4; b++) {
      mapGroup.add(instanced(new THREE.CylinderGeometry(0.02, 0.05, 1, 5), deadMat, dead,
        ([x, y], p, sc, q) => {
          const k = sizeOf(x, y);
          const a = jitter(x, y, 20 + b) * 6.3;
          const hgt = (1.4 + b * 0.45) * k;
          p.set(x + 0.5 + Math.cos(a) * 0.32 * k, hgt, y + 0.5 + Math.sin(a) * 0.32 * k);
          sc.set(1, (0.9 - b * 0.12) * k, 1);
          q.setFromEuler(new THREE.Euler(Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9));
        }));
    }

    // bushes: clumps of three, dusted with snow
    const bushes = cells(ground, G.BUSH);
    const bushMat = new THREE.MeshStandardMaterial({ color: palette.bush, roughness: 1, flatShading: true });
    for (const [ox, oz, r] of [[-0.18, -0.12, 0.42], [0.2, 0.05, 0.38], [-0.02, 0.22, 0.34]]) {
      mapGroup.add(instanced(new THREE.IcosahedronGeometry(1, 1), bushMat, bushes,
        ([x, y], p, sc, q) => { p.set(x + 0.5 + ox, r * 1.3, y + 0.5 + oz); sc.set(r, r * 1.5, r); turn(x, y, 3, q); }));
      mapGroup.add(instanced(new THREE.IcosahedronGeometry(1, 1), snowMat, bushes,
        ([x, y], p, sc, q) => { p.set(x + 0.5 + ox, r * 2.3, y + 0.5 + oz); sc.set(r * 0.75, r * 0.3, r * 0.75); turn(x, y, 3, q); }));
    }

    // rocks, with snow caps
    const rocks = cells(ground, G.ROCK);
    mapGroup.add(instanced(new THREE.DodecahedronGeometry(0.5, 0), new THREE.MeshStandardMaterial({ color: palette.rock, roughness: 0.95, flatShading: true }), rocks,
      ([x, y], p, sc, q) => { p.set(x + 0.5, 0.75, y + 0.5); sc.set(1.2, 1.5, 1.2); turn(x, y, 4, q); }));
    mapGroup.add(instanced(new THREE.DodecahedronGeometry(0.5, 0), snowMat, rocks,
      ([x, y], p, sc, q) => { p.set(x + 0.5, 1.35, y + 0.5); sc.set(0.9, 0.35, 0.9); turn(x, y, 4, q); }));

    // fallen logs: one cylinder per run of three cells, snow along the top
    const logMat = new THREE.MeshStandardMaterial({ color: 0x3b2a1d, roughness: 1 });
    const cutMat = new THREE.MeshStandardMaterial({ color: 0x8a6a48, roughness: 1 });
    const seenLog = new Set();
    for (const [x, y] of cells(ground, G.LOG)) {
      if (seenLog.has(y * W + x)) continue;
      const horiz = x + 1 < W && ground[y * W + x + 1] === G.LOG;
      const len = 3;
      for (let k = 0; k < len; k++) seenLog.add(horiz ? y * W + x + k : (y + k) * W + x);
      const g2 = new THREE.Group();
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, len - 0.1, 10), logMat);
      log.rotation.z = Math.PI / 2;
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.26, len - 0.3, 10, 1, false, Math.PI * 0.5, Math.PI), snowMat);
      cap.rotation.z = Math.PI / 2;
      cap.position.y = 0.12;
      const end1 = new THREE.Mesh(new THREE.CircleGeometry(0.3, 10), cutMat);
      end1.rotation.y = Math.PI / 2;
      end1.position.x = (len - 0.1) / 2 + 0.001;
      g2.add(log, cap, end1);
      g2.position.set(horiz ? x + len / 2 : x + 0.5, 0.32, horiz ? y + 0.5 : y + len / 2);
      g2.rotation.y = horiz ? jitter(x, y, 6) * 0.1 : Math.PI / 2;
      mapGroup.add(g2);
    }

    // the broken-down car where you start, headlights still on, pointing along the trail
    if (world.car) mapGroup.add(makeCar(world.car));

    // trail posts with dim lanterns every few cells, so the way to the hospital reads in the dark
    const postMat = new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 1 });
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xffb35a, fog: false });
    const reserved = world.reserved;
    let count = 0;
    if (reserved) {
      for (let x = 7; x < W - 2; x += 6) {
        for (let y = 1; y < H - 1; y++) {
          if (reserved[y * W + x] !== 1) continue;
          // the first trail cell in this column: put the post on the cell just north of the trail
          const py = y - 1;
          if (ground[py * W + x] === G.FREE || ground[py * W + x] === G.TREE || ground[py * W + x] === G.BUSH) {
            const post = new THREE.Group();
            const pole = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.2, 0.08), postMat);
            pole.position.y = 0.6;
            const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), lampMat);
            lamp.position.set(0.1, 1.15, 0);
            post.add(pole, lamp);
            post.position.set(x + 0.5, 0, py + 0.75);
            mapGroup.add(post);
            if (count % 2 === 0) { const l = new THREE.PointLight(0xffa54a, 1.2, 3.5, 1.6); l.position.set(x + 0.6, 1.1, py + 0.8); mapGroup.add(l); }
            count++;
          }
          break;
        }
      }
    }

    // canopy walkways: wooden decks with snow
    const slabMat = new THREE.MeshStandardMaterial({ color: palette.platform, roughness: 0.85 });
    const slabCells = [...cells(canopy, C.PLATFORM), ...cells(canopy, C.LADDER), ...cells(canopy, C.FOLIAGE)];
    canopyGroup.add(instanced(new THREE.BoxGeometry(1, 1, 1), slabMat, slabCells,
      ([x, y], p, s, q) => { p.set(x + 0.5, (config.slabBottom + config.slabTop) / 2, y + 0.5); s.set(0.98, config.slabTop - config.slabBottom, 0.98); ident(q); }));
    canopyGroup.add(instanced(new THREE.BoxGeometry(1, 1, 1), slabMat, cells(canopy, C.BRIDGE),
      ([x, y], p, s, q) => { p.set(x + 0.5, (config.slabBottom + config.slabTop) / 2, y + 0.5); s.set(0.8, config.slabTop - config.slabBottom, 0.8); ident(q); }));
    canopyGroup.add(instanced(new THREE.IcosahedronGeometry(0.5, 1), new THREE.MeshStandardMaterial({ color: palette.foliage, roughness: 1, flatShading: true }), cells(canopy, C.FOLIAGE),
      ([x, y], p, s, q) => { p.set(x + 0.5, (config.slabTop + config.foliageTop) / 2, y + 0.5); s.set(1.15, config.foliageTop - config.slabTop, 1.15); q.setFromAxisAngle(UP, jitter(x, y, 5) * 6); }));

    const ladderMat = new THREE.MeshStandardMaterial({ color: palette.ladder, emissive: palette.ladder, emissiveIntensity: 0.25 });
    for (const i of world.ladders) {
      const x = i % W;
      const y = Math.floor(i / W);
      const lg = new THREE.Group();
      for (const side of [-0.28, 0.28]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, config.slabTop + 1, 0.06), ladderMat);
        rail.position.set(side, (config.slabTop + 1) / 2, 0);
        lg.add(rail);
      }
      for (let k = 0; k < 8; k++) {
        const rung = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.05, 0.05), ladderMat);
        rung.position.set(0, 0.35 + k * 0.45, 0);
        lg.add(rung);
      }
      lg.position.set(x + 0.5, 0, y + 0.5);
      mapGroup.add(lg);
    }
    mapGroup.add(canopyGroup);
    canopyGroup.visible = options.canopy;
    scene.add(mapGroup);
  }

  // ---- camera -----------------------------------------------------------------------------
  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(container);
  resize();
  renderer.domElement.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoom = Math.min(2.2, Math.max(0.55, zoom * (e.deltaY > 0 ? 1.1 : 0.9)));
  }, { passive: false });

  // ---- per tick / per frame -------------------------------------------------------------------
  const pose = (node, facing) => { const { x, y, level } = nodeXYL(world, node); return { x: x + 0.5, y: y + 0.5, z: floorY(level), facing }; };
  const anim = { player: {}, creature: {} };
  let creatureVisTarget = 0;
  let creatureVis = 0;
  for (const m of [bark, ice, ember]) m.transparent = true;
  let state = null;

  function onTick(game, now, tickMs) {
    state = game;
    for (const who of ['player', 'creature']) {
      const a = anim[who];
      const s = game[who];
      const to = pose(s.node, s.facing);
      const moved = !a.to || a.to.x !== to.x || a.to.y !== to.y;
      a.from = a.current ?? to;
      a.to = to;
      a.t0 = now;
      // glide at the walker's real speed (cells per tick) instead of hopping cell to cell
      const speed = who === 'player' ? game.ctx.config.game.walkSpeed
        : game.speeds[{ chase: 'chase', track: 'track', investigate: 'investigate', ambush: 'investigate' }[s.mode] ?? 'patrol'];
      a.dur = moved ? (tickMs / Math.min(1, Math.max(0.2, speed))) * 0.98 : tickMs;
    }
    // how much of the creature you can make out: clear when you see it, a faint shape with glowing
    // eyes in the fog a little farther out, nothing when something solid is in between
    const e = game.distances.euclidean;
    const clear = segmentClear(world, eyePoint(world, game.player.node), eyePoint(world, game.creature.node));
    creatureVisTarget = game.over || game.player.seesCreature ? 1 : (clear && e <= 14 ? 0.3 * (1 - (e - 9) / 5) + 0.12 : 0);
    while (crowMeshes.length < game.crows.length) crowMeshes.push(makeCrow());
    crowMeshes.forEach((m, i) => {
      const c = game.crows[i];
      m.visible = !!c;
      if (!c) return;
      m.position.set((c.node % world.W) + 0.5, 2.85, Math.floor(c.node / world.W) + 0.5);
      m.rotation.y = -c.facing;
      for (const e of m.userData.eyes) e.material = c.watching ? crowEyeOn : crowEyeOff;
    });
    for (const snd of game.sounds) {
      if (snd.who === 'player' && snd.creatureHeard) addRipple(snd.node, palette.player, now);
      else if (snd.who === 'creature') addRipple(snd.node, palette.creature, now);
      else if (snd.who === 'crow') addRipple(snd.node, palette.crow, now, true);
      else if (snd.who === 'shot') addRipple(snd.node, '#ffffff', now, true);
    }
    for (const s of game.shots) {
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([cellV(s.from, 1.0), cellV(s.to, 1.1)]), new THREE.LineBasicMaterial({ color: 0xfff3c4, transparent: true, fog: false }));
      scene.add(line);
      tracers.push({ obj: line, born: now });
    }
    buildRelations(game);
    if (options.relations) for (const m of game.relations.movement) if (m.kind !== 'toward' && m.kind !== 'away') addFlash(m, now);
  }

  function updateFan(node, facing, offset) {
    const fp = fan.geometry.attributes.position.array;
    const [ex, ey, ez] = eyePoint(world, node);
    const ox = ex + offset[0];
    const oy = ey + offset[1];
    const oz = ez + offset[2] - 1.3;
    const i0 = world.nodeIndex[node] * rays.R;
    const horiz = [];
    rays.dirs.forEach((d, r) => {
      if (d.el !== 0 || !inCone(world.config, facing, d.dx, d.dy, d.dz)) return;
      const len = rays.lengths[i0 + r];
      horiz.push({ a: Math.atan2(Math.sin(d.az - facing), Math.cos(d.az - facing)), p: [ox + d.dx * len, oz + 0.06, oy + d.dy * len] });
    });
    horiz.sort((a, b) => a.a - b.a);
    let nf = 0;
    let prev = null;
    for (const h of horiz) {
      if (prev) { fp.set([ox, oz + 0.06, oy, ...prev, ...h.p], nf); nf += 9; }
      prev = h.p;
    }
    fan.geometry.setDrawRange(0, nf / 3);
    fan.geometry.attributes.position.needsUpdate = true;
  }

  function frame(now) {
    if (!world || !state) { renderer.render(scene, camera); return; }
    const g = state;
    for (const who of ['player', 'creature']) {
      const a = anim[who];
      if (!a.to) continue;
      const k = Math.min(1, (now - a.t0) / Math.max(1, a.dur));
      let df = a.to.facing - a.from.facing;
      df = Math.atan2(Math.sin(df), Math.cos(df));
      a.current = {
        x: a.from.x + (a.to.x - a.from.x) * k,
        y: a.from.y + (a.to.y - a.from.y) * k,
        z: a.from.z + (a.to.z - a.from.z) * k,
        facing: a.from.facing + df * Math.min(1, k * 1.6),
      };
    }
    const P = anim.player.current;
    const Q = anim.creature.current;
    const me = g.player;
    if (P) {
      // in a tree: up among the branches, hugging the trunk
      let px = P.x; let py = P.z; let pz = P.y;
      const treeCell = me.inTree ?? (me.climbing === 'down' ? climbFrom : null);
      if (me.inTree !== null) climbFrom = me.inTree;
      if (treeCell !== null && (me.inTree !== null || me.climbing === 'down')) {
        const tx = (treeCell % world.W) + 0.5;
        const tz = Math.floor(treeCell / world.W) + 0.5;
        const k = me.inTree !== null ? 1 : 0.5;
        px = P.x + (tx - P.x) * k;
        pz = P.y + (tz + 0.45 - P.y) * k; // on the camera side of the trunk, so you stay visible
        py = 1.9 * k;
      } else if (me.climbing === 'up' && me.climbTree !== null) {
        const tx = (me.climbTree % world.W) + 0.5;
        const tz = Math.floor(me.climbTree / world.W) + 0.5;
        px = (P.x + tx) / 2; pz = (P.y + tz) / 2; py = 0.9;
      }
      you.position.set(px, py, pz);
      you.rotation.y = -P.facing;
      ring.visible = me.inTree === null;
      torchBeam.visible = me.inTree === null && !mapView;
      beamMat.opacity = 0.07 * flashFlick;
      if (goalMark.visible && me.node !== undefined && goalMark.position.distanceTo(cellV(me.node, 0.05)) < 0.1) goalMark.visible = false;
      goalMark.rotation.z = now / 600;
      // walking: legs and arms swing; in a tree: legs bent, arms up
      const walk = me.inTree === null && (me.moving || (anim.player.to && (now - anim.player.t0) < anim.player.dur && (anim.player.from.x !== anim.player.to.x || anim.player.from.y !== anim.player.to.y)));
      const sw = walk ? Math.sin(now / 105) * 0.65 : 0;
      if (me.inTree !== null) {
        legL.rotation.z = 0.9; legR.rotation.z = 0.3;
        armL.rotation.z = -2.4; armR.rotation.z = -2.1;
      } else {
        legL.rotation.z = sw; legR.rotation.z = -sw;
        armL.rotation.z = -sw * 0.8;
        armR.rotation.z = -1.25 + sw * 0.15; // holding the flashlight forward
      }
      figure.position.y = walk ? Math.abs(Math.sin(now / 105)) * 0.04 : 0;
      // the tree you could climb
      climbRing.visible = !g.over && actionsFor(g).climb === 'up';
      if (climbRing.visible) {
        const t = treeNextTo(world, me.node, me.facing);
        climbRing.position.set((t % world.W) + 0.5, 0.05, Math.floor(t / world.W) + 0.5);
        climbRing.material.opacity = 0.55 + 0.35 * Math.sin(now / 160);
      }
      const fx = Math.cos(P.facing);
      const fz = Math.sin(P.facing);
      // the flashlight flickers when it is close; in a tree you keep it down
      const near = me.knownCreature !== null && g.step - me.knownStep <= 3 ? Math.max(0, 1 - g.distances.path / 7) : 0;
      const flick = near > 0 && Math.random() < 0.12 + near * 0.3 ? 0.15 + Math.random() * 0.4 : 1;
      flashFlick = flick;
      flashlight.intensity = (me.inTree !== null ? 5 : 16) * flick;
      flashlight.position.set(px + fx * 0.3, py + 1.1, pz + fz * 0.3);
      flashlight.target.position.set(px + fx * 7, me.inTree !== null ? 0 : py + 0.1, pz + fz * 7);
      glow.position.set(px, py + 1.5, pz);
      glow.intensity = me.inTree !== null ? 0.7 : 1.6;
      // camera: follow from the south and above; when it gets you, it lunges into view
      let target = mapView ? new THREE.Vector3(world.W / 2, 0, world.H / 2) : new THREE.Vector3(px, 0, pz);
      let off = mapView ? new THREE.Vector3(0, 52, 9) : new THREE.Vector3(0, 15.5 * zoom, 10.5 * zoom);
      if (g.over && g.result === 'lose' && Q) {
        target = new THREE.Vector3(Q.x, 1.8, Q.y);
        off.set(Math.cos(Q.facing) * 2.6, 0.6, Math.sin(Q.facing) * 2.6);
      }
      const lerp = g.over && g.result === 'lose' ? 0.09 : 0.12;
      camTarget.lerp(target, lerp);
      camLook.lerp(target, lerp + 0.03);
      camOff.lerp(off, g.over ? 0.08 : 0.2);
      camera.position.copy(camTarget).add(camOff);
      // shake: when it is close, and hard when it gets you
      const shake = g.over && g.result === 'lose' ? 0.22 : near > 0.4 && g.creature.frozenLeft === 0 ? near * 0.07 : 0;
      if (shake) camera.position.add(new THREE.Vector3((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake));
      camera.lookAt(camLook);
      scene.fog.density = mapView ? 0.012 : 0.034 / zoom;
      // snow falls around the camera target
      const sp = snowGeo.attributes.position.array;
      for (let i = 0; i < SNOW; i++) {
        sp[i * 3 + 1] -= 0.025 + (i % 5) * 0.004;
        sp[i * 3] += Math.sin(now / 900 + i) * 0.004;
        if (sp[i * 3 + 1] < 0) sp[i * 3 + 1] += 14;
      }
      snowGeo.attributes.position.needsUpdate = true;
      snow.position.set(camLook.x, 0, camLook.z);
    }
    // the creature is drawn only when you can see it
    // fade in and out instead of popping up
    creatureVis += (creatureVisTarget - creatureVis) * (creatureVisTarget > creatureVis ? 0.06 : 0.1);
    const visible = g.player.seesCreature || g.over;
    creature.visible = creatureVis > 0.02 && !!Q;
    bark.opacity = Math.min(1, creatureVis * 1.1);
    ice.opacity = bark.opacity;
    ember.opacity = Math.min(1, 0.35 + creatureVis); // the eyes show first
    creatureLight.intensity = 4 * creatureVis;
    creatureShadow.material.opacity = 0.45 * creatureVis;
    fan.visible = visible && creatureVis > 0.6 && g.creature.frozenLeft === 0 && !g.over;
    if (Q) {
      creature.position.set(Q.x, Q.z, Q.y);
      creature.rotation.y = -Q.facing + Math.sin(now / 300) * 0.08;
      const frozen = g.creature.frozenLeft > 0;
      for (const t of tendrils) t.material = frozen ? ice : bark;
      core.material = frozen ? ice : bark;
      iceRing.visible = frozen;
      if (frozen) iceRing.scale.setScalar(0.6 + 0.4 * (g.creature.frozenLeft / g.ctx.config.game.freezeTicks));
      creatureLight.color.set(frozen ? 0x7ec8ff : palette.creature);
      const pulse = frozen ? 1 : 1 + 0.06 * Math.sin(now / 140);
      core.scale.set(pulse, 1.15 * pulse, 0.9 * pulse);
      tendrils.forEach((t, i) => {
        if (frozen) { t.rotation.set(0, 0, 0); return; }
        if (t.userData.side) t.rotation.z = -0.15 + Math.sin(now / 190 + t.userData.side) * 0.18;
        else t.rotation.y = Math.sin(now / 240 + i * 1.3) * 0.14;
      });
      creature.position.y = frozen ? 0 : Math.abs(Math.sin(now / 210)) * 0.08;
      if (g.over && g.result === 'lose') creature.scale.setScalar(1.25); else creature.scale.setScalar(1);
      if (fan.visible) updateFan(g.creature.node, Q.facing, [Q.x - anim.creature.to.x, Q.y - anim.creature.to.y, Q.z - anim.creature.to.z]);
    }
    // the case: on its cell with a beam, or in your hand
    if (g.caseItem.carried && P) {
      caseGroup.position.set(P.x + Math.cos(P.facing + 1.2) * 0.35, P.z + 0.15, P.y + Math.sin(P.facing + 1.2) * 0.35);
      caseGroup.scale.setScalar(0.7);
      beam.visible = false;
    } else {
      caseGroup.position.copy(cellV(g.caseItem.node, 0));
      caseGroup.rotation.y = now / 1400;
      caseGroup.scale.setScalar(1);
      beam.visible = true;
    }
    alarmBulb.visible = g.alarmLeft > 0 && Math.floor(now / 160) % 2 === 0;
    caseLight.color.set(g.alarmLeft > 0 && Math.floor(now / 160) % 2 === 0 ? 0xff3030 : palette.caseGlow);

    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i];
      const age = (now - r.born) / (r.big ? 1600 : 1200);
      if (age >= 1) { scene.remove(r.mesh); r.mesh.material.dispose(); ripples.splice(i, 1); continue; }
      const s = 0.4 + age * (r.big ? 7 : 4);
      r.mesh.scale.set(s, s, s);
      r.mesh.material.opacity = 0.9 * (1 - age);
    }
    for (let i = tracers.length - 1; i >= 0; i--) {
      const t = tracers[i];
      const age = (now - t.born) / 300;
      if (age >= 1) { scene.remove(t.obj); t.obj.geometry.dispose(); t.obj.material.dispose(); tracers.splice(i, 1); continue; }
      t.obj.material.opacity = 1 - age;
    }
    for (let i = flashes.length - 1; i >= 0; i--) {
      const f = flashes[i];
      const age = (now - f.born) / FLASH_MS;
      if (age >= 1 || !options.relations) { scene.remove(f.obj); f.obj.geometry.dispose(); f.obj.material.dispose(); flashes.splice(i, 1); continue; }
      f.obj.material.opacity = 1 - age * age;
      if (f.obj.userData.rise) f.obj.position.y = f.obj.userData.base + f.obj.userData.rise * age * 1.2;
      if (f.obj.userData.grow) f.obj.scale.setScalar(1 + age * 1.5);
    }
    renderer.render(scene, camera);
  }

  // where you clicked to walk
  const goalMark = new THREE.Mesh(new THREE.RingGeometry(0.25, 0.36, 4, 1, Math.PI / 4), new THREE.MeshBasicMaterial({ color: palette.player, transparent: true, opacity: 0.8, side: THREE.DoubleSide, fog: false }));
  goalMark.rotation.x = -Math.PI / 2;
  goalMark.visible = false;
  scene.add(goalMark);
  function markGoal(n) {
    goalMark.visible = n !== null && n !== undefined;
    if (goalMark.visible) goalMark.position.copy(cellV(n, 0.05));
  }

  const ray = new THREE.Raycaster();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  function pickCell(clientX, clientY) {
    if (!world) return null;
    const r = renderer.domElement.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), camera);
    const hit = new THREE.Vector3();
    if (!ray.ray.intersectPlane(groundPlane, hit)) return null;
    const x = Math.floor(hit.x);
    const y = Math.floor(hit.z);
    if (x < 0 || y < 0 || x >= world.W || y >= world.H) return null;
    return { x, y };
  }

  return {
    buildMap,
    pickCell,
    markGoal,
    onTick,
    frame,
    setMapView(on) { mapView = on; },
    isMapView: () => mapView,
    setOption(name, value) {
      options[name] = value;
      if (name === 'canopy' && canopyGroup) canopyGroup.visible = value;
      if (name === 'relations') relGroup.visible = value;
    },
    reset() {
      for (const a of Object.values(anim)) { a.current = null; a.from = null; a.to = null; }
      state = null;
      creatureVis = 0;
      creatureVisTarget = 0;
    },
    snapCamera() { if (anim.player.to) { const p = anim.player.to; camTarget.set(p.x, p.z, p.y); camLook.copy(camTarget); } },
  };
}
