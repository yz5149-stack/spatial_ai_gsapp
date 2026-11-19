// The real city in 3D: Google Photorealistic 3D Tiles (through Cesium ion), with the simulation on
// top: rats (turned the way they run, moving smoothly), inspectors with the beam of their flashlight,
// trash bags and bins, bait stations, burrows, sidewalk sheds, street lights; what happens (spotted,
// caught, missed, a burrow found) pops up where it happens; a trash bag you drop sends out rings of
// smell, and the rats that pick it up show a "!" and their route to it.

import { layerValues } from './plan.js';
import { ratIcon, inspectorIcon, bagIcon, binIcon, burrowIcon, stationIcon, alertIcon } from './icons.js';

// a Cesium ion token limited to this site (yz5149-stack.github.io and localhost), read-only, for the
// Google tiles, Cesium World Terrain and Cesium OSM Buildings only
export const ION_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJub25jZSI6ImY3dlJON0N3bnpnZHdFSXUiLCJqdGkiOiIzMTI0Zjg2Mi04MzFmLTRjMmQtOWZlMi03NjdjNDJiZTFlNzciLCJpZCI6NTUyNDY3LCJzdWIiOiJ5ejUxNDktc3RhY2siLCJpc3MiOiJodHRwczovL2FwaS5jZXNpdW0uY29tIiwiYXVkIjoic3BhdGlhbCBhaSIsImlhdCI6MTc5NTA1MTI5N30.AnGsZWoF8CHHLvkc1Ce56r-wkO3gXF5ZTYjeG8l8IsU';

const GEOID_NYC = -32.6;   // ellipsoid height minus NAVD88 elevation around Manhattan (about -32.6 m)
const HEADING = 29;        // Manhattan's grid runs 29° east of true north
const FX_STYLE = {
  spot: { color: '#ffd34d', text: 'SPOTTED', ring: '#ffd34d' },
  caught: { color: '#5fd38a', text: 'CAUGHT!', ring: '#5fd38a' },
  missed: { color: '#c9d1db', text: 'GOT AWAY', ring: '#8b96a5' },
  dodge: { color: '#ffb08a', text: 'DODGED', ring: '#ff9a6a' },
};

export async function makeGlobe(el, city, { onPick = null, onStatus = null } = {}) {
  const Cesium = window.Cesium;
  if (!Cesium) throw new Error('Cesium did not load');
  Cesium.Ion.defaultAccessToken = ION_TOKEN;
  const viewer = new Cesium.Viewer(el, {
    timeline: false, animation: false, baseLayerPicker: false, geocoder: false, homeButton: false, sceneModePicker: false,
    navigationHelpButton: false, fullscreenButton: false, infoBox: false, selectionIndicator: false, baseLayer: false,
    msaaSamples: 4,
  });
  const scene = viewer.scene;
  scene.globe.show = false;
  scene.backgroundColor = Cesium.Color.fromCssColorString('#05070a');
  viewer.cesiumWidget.creditContainer.style.fontSize = '10px';

  let tileset = null;
  try {
    tileset = await Cesium.createGooglePhotorealistic3DTileset({ onlyUsingWithGoogleGeocoder: true });
    scene.primitives.add(tileset);
    onStatus?.('3D city loaded (Google Photorealistic 3D Tiles via Cesium ion)');
  } catch (err) {
    console.error(err);
    onStatus?.('The Google 3D tiles did not load; showing OSM buildings.');
    try { const osm = await Cesium.createOsmBuildingsAsync(); scene.primitives.add(osm); scene.globe.show = true; } catch (e) { console.error(e); }
  }

  const { geo, W } = city;
  const cellM = city.cellM;
  let geoid = GEOID_NYC;
  const C = (css, a = 1) => Cesium.Color.fromCssColorString(css).withAlpha(a);
  const FRONT = Number.POSITIVE_INFINITY;
  const xyOf = (cell) => [(cell % W) + 0.5, Math.floor(cell / W) + 0.5];
  const posXY = (x, y, cell, lift = 0.5) => { const [lon, lat] = geo.toLonLat(x, y); return Cesium.Cartesian3.fromDegrees(lon, lat, city.elev[cell] + geoid + lift); };
  const posOf = (cell, lift = 0.5) => { const [x, y] = xyOf(cell); return posXY(x, y, cell, lift); };

  // calibrate the height: sample the tiles on a few open streets and compare with the surveyed ground
  async function calibrate() {
    if (!tileset) return;
    const cells = city.nodes.filter((i) => city.road[i]).filter((_, k) => k % 211 === 0).slice(0, 20);
    const carto = cells.map((c) => { const [lon, lat] = geo.toLonLat((c % W) + 0.5, Math.floor(c / W) + 0.5); return Cesium.Cartographic.fromDegrees(lon, lat); });
    try {
      const got = await scene.sampleHeightMostDetailed(carto);
      const diffs = got.map((g, k) => (Number.isFinite(g.height) ? g.height - city.elev[cells[k]] : null)).filter((v) => v !== null && Math.abs(v - GEOID_NYC) < 15).sort((a, b) => a - b);
      if (diffs.length >= 4) { geoid = diffs[Math.floor(diffs.length / 2)]; rebuildStatic = true; }
    } catch (err) { console.warn('height calibration', err); }
  }
  if (tileset) tileset.initialTilesLoaded.addEventListener(() => calibrate());

  // ---- collections ----------------------------------------------------------------------------
  const lamps = scene.primitives.add(new Cesium.PointPrimitiveCollection());
  const sheds = scene.primitives.add(new Cesium.PointPrimitiveCollection());
  const things = scene.primitives.add(new Cesium.BillboardCollection({ scene }));
  const agentsBB = scene.primitives.add(new Cesium.BillboardCollection({ scene }));
  const labels = scene.primitives.add(new Cesium.LabelCollection({ scene }));
  const lines = scene.primitives.add(new Cesium.PolylineCollection());
  let rebuildStatic = true; let lastDesign = null;
  const ratBB = new Map(); const insBB = new Map();
  const near = new Cesium.NearFarScalar(80, 1.0, 1600, 0.42);

  function buildStatic(sim) {
    lamps.removeAll(); sheds.removeAll();
    for (const c of city.poles) lamps.add({ position: posOf(c, 6), color: C('#fff1b8', 0.5), pixelSize: 5, show: false });
    for (const c of sim.design.lights) lamps.add({ position: posOf(c, 6), color: C('#fff1b8', 0.95), pixelSize: 9, outlineColor: C('#fff1b8', 0.4), outlineWidth: 4 });
    for (const sh of sim.sheds) {
      if (sh.type === 'gone') continue;
      for (const c of sh.cells) sheds.add({ position: posOf(c, 3.2), color: sh.type === 'old' ? C('#5ac8dc', 0.9) : C('#e6f5ff', 0.9), pixelSize: 7, disableDepthTestDistance: 400 });
    }
    lastDesign = sim.design;
    rebuildStatic = false;
  }

  // ---- the layer draped over the ground --------------------------------------------------------
  const rect = Cesium.Rectangle.fromDegrees(geo.bbox.west, geo.bbox.south, geo.bbox.east, geo.bbox.north);
  let drape = null; let drapeAt = 0; let drapeLayer = null;
  function updateDrape(sim, layer, now) {
    if (layer === drapeLayer && now - drapeAt < 2000) return;
    drapeAt = now; drapeLayer = layer;
    const L = layerValues(sim, layer);
    if (!L) { if (drape) drape.show = false; return; }
    const cv = document.createElement('canvas'); cv.width = city.W; cv.height = city.H;
    const g = cv.getContext('2d'); const img = g.createImageData(city.W, city.H);
    let max = 0; for (let i = 0; i < L.v.length; i++) if (L.v[i] > max) max = L.v[i];
    if (max > 0) for (let i = 0; i < L.v.length; i++) {
      const v = L.v[i]; if (!v) continue;
      const t = Math.min(1, Math.sqrt(v / max) * L.gain);
      if (t < 0.12) continue;
      img.data[i * 4] = L.c[0]; img.data[i * 4 + 1] = L.c[1]; img.data[i * 4 + 2] = L.c[2]; img.data[i * 4 + 3] = Math.round(50 + 150 * t);
    }
    g.putImageData(img, 0, 0);
    const material = new Cesium.ImageMaterialProperty({ image: cv, transparent: true });
    if (!drape) drape = viewer.entities.add({ rectangle: { coordinates: rect, material, classificationType: Cesium.ClassificationType.BOTH } });
    else { drape.rectangle.material = material; drape.show = true; }
  }

  // ---- night: a darker, bluer picture (the Google tiles are photographed by day) --------------
  const nightStage = scene.postProcessStages.add(new Cesium.PostProcessStage({
    fragmentShader: `uniform sampler2D colorTexture; uniform float night; in vec2 v_textureCoordinates;
      void main() { vec4 c = texture(colorTexture, v_textureCoordinates);
        vec3 n = c.rgb * mix(1.0, 0.45, night); n = mix(n, n * vec3(0.78, 0.86, 1.18), night);
        out_FragColor = vec4(n, c.a); }`,
    uniforms: { night: 0 },
  }));

  // ---- flashlight beams: one translucent fan per inspector ----------------------------------------
  const beams = new Map();
  function beamFor(ins) {
    if (beams.has(ins.id)) return beams.get(ins.id);
    const b = { pts: [], show: false };
    b.entity = viewer.entities.add({
      polygon: {
        hierarchy: new Cesium.CallbackProperty(() => new Cesium.PolygonHierarchy(b.pts), false),
        perPositionHeight: true, material: C('#fff3b0', 0.28), outline: false,
      },
      show: false,
    });
    beams.set(ins.id, b);
    return b;
  }

  // ---- smooth movement: along the cells moved in the last tick --------------------------------
  function along(a, frac) {
    const m = a.moved;
    if (!m || m.length < 2) return xyOf(a.cell);
    const t = Math.max(0, Math.min(1, frac)) * (m.length - 1);
    const k = Math.min(m.length - 2, Math.floor(t)); const f = t - k;
    const [x0, y0] = xyOf(m[k]); const [x1, y1] = xyOf(m[k + 1]);
    return [x0 + (x1 - x0) * f, y0 + (y1 - y0) * f];
  }
  // screen rotation of an icon that points up, for a heading in grid space (x east, y south)
  const tmpA = new Cesium.Cartesian2(); const tmpB = new Cesium.Cartesian2();
  function screenRotation(p, facing, cell, x, y) {
    const q = posXY(x + Math.cos(facing) * 0.6, y + Math.sin(facing) * 0.6, cell, 0.5);
    const a = Cesium.SceneTransforms.worldToWindowCoordinates(scene, p, tmpA);
    const b = Cesium.SceneTransforms.worldToWindowCoordinates(scene, q, tmpB);
    if (!a || !b) return 0;
    return -Math.atan2(b.x - a.x, -(b.y - a.y));
  }

  // ---- things that happen: pop-up words and rings ---------------------------------------------
  const pops = []; let fxSeen = 0; const bagRings = []; const bagsSeen = new Set();
  function addPop(sim, f, now) {
    const st = FX_STYLE[f.kind]; if (!st) return;
    const text = f.burrow ? 'GOT AWAY · BURROW FOUND' : st.text;
    const label = labels.add({
      position: posOf(f.cell, 4), text, font: '700 15px system-ui', fillColor: C(st.color), outlineColor: C('#000'), outlineWidth: 4,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE, disableDepthTestDistance: FRONT, showBackground: true, backgroundColor: C('#0b0d10', 0.7),
      pixelOffset: new Cesium.Cartesian2(0, -24), horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
    });
    const ring = viewer.entities.add({
      position: posOf(f.cell, 0.3),
      ellipse: { semiMajorAxis: 3, semiMinorAxis: 3, height: city.elev[f.cell] + geoid + 0.4, material: C(st.ring, 0.0), outline: true, outlineColor: C(st.ring, 0.9), outlineWidth: 2 },
    });
    pops.push({ label, ring, t0: now, kind: f.kind });
  }
  function updatePops(now) {
    for (let k = pops.length - 1; k >= 0; k--) {
      const p = pops[k]; const age = (now - p.t0) / 2600;
      if (age >= 1) { labels.remove(p.label); viewer.entities.remove(p.ring); pops.splice(k, 1); continue; }
      p.label.pixelOffset = new Cesium.Cartesian2(0, -24 - 30 * age);
      p.label.fillColor = p.label.fillColor.withAlpha(1 - age * age);
      const r = 3 + 22 * age;
      p.ring.ellipse.semiMajorAxis = r; p.ring.ellipse.semiMinorAxis = r;
      p.ring.ellipse.outlineColor = p.ring.ellipse.outlineColor.getValue().withAlpha(0.9 * (1 - age));
    }
    for (let k = bagRings.length - 1; k >= 0; k--) {
      const b = bagRings[k]; const age = ((now - b.t0) % 2400) / 2400; const life = (now - b.t0) / 9000;
      if (life >= 1) { viewer.entities.remove(b.entity); bagRings.splice(k, 1); continue; }
      const r = 4 + (b.reach - 4) * age;
      b.entity.ellipse.semiMajorAxis = r; b.entity.ellipse.semiMinorAxis = r;
      b.entity.ellipse.outlineColor = C('#ffd34d', 0.85 * (1 - age) * (1 - life));
    }
  }
  function addBagRings(sim, s, now) {
    const reach = sim.cfg.rat.smell * cellM;
    for (let k = 0; k < 3; k++) {
      const entity = viewer.entities.add({
        position: posOf(s.cell, 0.3),
        ellipse: { semiMajorAxis: 4, semiMinorAxis: 4, height: city.elev[s.cell] + geoid + 0.5, material: C('#ffd34d', 0.04), outline: true, outlineColor: C('#ffd34d', 0.8), outlineWidth: 2 },
      });
      bagRings.push({ entity, t0: now - k * 800, reach });
    }
  }

  // ---- camera --------------------------------------------------------------------------------------
  const center = geo.toLonLat(city.W / 2, city.H / 2);
  let view = 'city'; let following = false; let camRange = 120;
  function setView(v) {
    view = v;
    if (v === 'city') {
      viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
      const target = Cesium.Cartesian3.fromDegrees(center[0], center[1], 25 + geoid);
      viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(target, 450), { offset: new Cesium.HeadingPitchRange(Cesium.Math.toRadians(HEADING), Cesium.Math.toRadians(-55), 1050), duration: 1.6 });
    }
  }
  setView('city');
  const focusOn = (cell, range = 160) => {
    viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
    viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(posOf(cell, 1), 10), { offset: new Cesium.HeadingPitchRange(viewer.camera.heading, Cesium.Math.toRadians(-50), range), duration: 1.2 });
  };

  // ---- each frame -------------------------------------------------------------------------------------
  function frame(sim, { layer, selected, now, hourFrac, frac = 1, follow = null }) {
    if (rebuildStatic || sim.design !== lastDesign) buildStatic(sim);
    updateDrape(sim, layer, now);
    const night = hourFrac >= 19.5 || hourFrac < 5.5 ? 1 : hourFrac >= 17.5 ? (hourFrac - 17.5) / 2 : hourFrac < 7 ? (7 - hourFrac) / 1.5 : 0;
    nightStage.uniforms.night = Math.max(0, Math.min(1, night)) * 0.85;
    const lampsOn = night > 0.5;
    for (let k = 0; k < city.poles.length && k < lamps.length; k++) lamps.get(k).show = lampsOn;

    // bags, bins, bait stations, burrows
    things.removeAll();
    for (const s of sim.sources) {
      if (s.kind === 'bag' && s.amt > 0.05) things.add({ position: posOf(s.cell, 0.6), image: bagIcon(true), verticalOrigin: Cesium.VerticalOrigin.BOTTOM, scaleByDistance: near, disableDepthTestDistance: FRONT });
      else if (s.amt > 0.05 && s.kind !== 'basket') things.add({ position: posOf(s.cell, 0.4), image: bagIcon(), verticalOrigin: Cesium.VerticalOrigin.BOTTOM, scale: 0.55, scaleByDistance: near, disableDepthTestDistance: 500 });
      else if (s.binned && s.isOut) things.add({ position: posOf(s.cell, 0.4), image: binIcon(), verticalOrigin: Cesium.VerticalOrigin.BOTTOM, scale: 0.6, scaleByDistance: near, disableDepthTestDistance: 500 });
      if (s.kind === 'bag' && !bagsSeen.has(s.id)) { bagsSeen.add(s.id); addBagRings(sim, s, now); }
    }
    for (const st of sim.stations) things.add({ position: posOf(st.cell, 0.3), image: stationIcon(), scale: 0.7, scaleByDistance: near, disableDepthTestDistance: 600 });
    for (const col of sim.colonies) if (col.alive) things.add({ position: posOf(col.home, 0.2), image: burrowIcon(), scale: 0.8, scaleByDistance: near, disableDepthTestDistance: 600 });

    // rats
    const seen = new Set();
    lines.removeAll();
    const bagCells = new Set(sim.sources.filter((s) => s.kind === 'bag' && s.amt > 0.05).map((s) => s.cell));
    for (const r of sim.rats) {
      if (!r.alive || r.mode === 'home') continue;
      seen.add(r.id);
      let b = ratBB.get(r.id);
      if (!b) { b = agentsBB.add({ image: ratIcon(), scaleByDistance: near, disableDepthTestDistance: FRONT }); ratBB.set(r.id, b); }
      const [x, y] = along(r, frac);
      const p = posXY(x, y, r.cell, 0.5);
      b.position = p; b.show = true;
      b.image = r.deathAt >= 0 ? ratIcon('#c58bff', 'p') : r.mode === 'flee' ? ratIcon('#ff3d3d', 'f') : ratIcon();
      b.scale = selected === r ? 0.9 : 0.6;
      b.rotation = screenRotation(p, r.facing, r.cell, x, y);
      // heading for the bag you dropped: "!" and its route
      if (bagCells.has(r.target) && r.path) {
        things.add({ position: p, image: alertIcon(), pixelOffset: new Cesium.Cartesian2(0, -22), scaleByDistance: near, disableDepthTestDistance: FRONT });
        lines.add({ positions: r.path.slice(r.pi).map((c) => posOf(c, 0.6)), width: 2, material: Cesium.Material.fromType('PolylineDash', { color: C('#ffd34d', 0.85), dashLength: 10 }) });
      }
    }
    for (const [id, b] of ratBB) if (!seen.has(id)) b.show = false;

    // inspectors and their flashlights
    for (const ins of sim.inspectors) {
      let b = insBB.get(ins.id);
      if (!b) {
        b = agentsBB.add({ image: inspectorIcon(), scaleByDistance: near, disableDepthTestDistance: FRONT });
        b.label = labels.add({ text: ins.name, font: '600 12px system-ui', fillColor: C('#cfeaff'), outlineColor: C('#000'), outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE, disableDepthTestDistance: FRONT, pixelOffset: new Cesium.Cartesian2(0, -30), scaleByDistance: near });
        insBB.set(ins.id, b);
      }
      const beam = beamFor(ins);
      const on = ins.mode !== 'off' && ins.mode !== 'done';
      b.show = on; b.label.show = on; beam.entity.show = on && night > 0.3;
      if (!on) continue;
      const [x, y] = along(ins, frac);
      const p = posXY(x, y, ins.cell, 1.2);
      b.position = p; b.label.position = p;
      b.scale = selected === ins ? 0.95 : 0.75;
      b.rotation = screenRotation(p, ins.facing, ins.cell, x, y);
      b.label.text = ins.mode === 'chase' ? `${ins.name} · chasing` : ins.name;
      b.label.fillColor = ins.mode === 'chase' ? C('#ffd34d') : C('#cfeaff');
      // the beam: a fan in front
      const Cb = sim.cfg.inspector; const half = (Cb.beamDeg * Math.PI) / 360;
      const pts = [posXY(x, y, ins.cell, 1.0)];
      for (let k = 0; k <= 10; k++) { const a = ins.facing - half + (2 * half * k) / 10; pts.push(posXY(x + Math.cos(a) * Cb.beam, y + Math.sin(a) * Cb.beam, ins.cell, 1.0)); }
      beam.pts = pts;
      beam.entity.polygon.material = ins.mode === 'chase' ? C('#ffd34d', 0.38) : C('#fff3b0', 0.24);
      // chasing: a line to the rat
      if (ins.mode === 'chase' && ins.chase?.rat?.alive) lines.add({ positions: [p, posOf(ins.chase.rat.cell, 0.6)], width: 2, material: Cesium.Material.fromType('Color', { color: C('#ffd34d', 0.9) }) });
    }

    // the selected agent: trail, plan, and what it senses (a rat's nose)
    if (selected && selected.trail.length > 1) {
      lines.add({ positions: selected.trail.slice(-160).map((c) => posOf(c, 0.7)), width: 3, material: Cesium.Material.fromType('Color', { color: selected.kind === 'rat' ? C('#ff9a6a', 0.9) : C('#8fd3ff', 0.9) }) });
      if (selected.path && selected.path.length > 1) lines.add({ positions: selected.path.slice(selected.pi ?? 0).map((c) => posOf(c, 0.7)), width: 2, material: Cesium.Material.fromType('PolylineDash', { color: C('#ffffff', 0.8), dashLength: 12 }) });
      if (selected.kind === 'rat' && selected.alive && selected.mode !== 'home') {
        const [x, y] = along(selected, frac); const R = sim.cfg.rat.smell; const ring = [];
        for (let k = 0; k <= 48; k++) { const a = (k / 48) * Math.PI * 2; ring.push(posXY(x + Math.cos(a) * R, y + Math.sin(a) * R, selected.cell, 0.8)); }
        lines.add({ positions: ring, width: 1.5, material: Cesium.Material.fromType('PolylineDash', { color: C('#ffd34d', 0.6), dashLength: 8 }) });
      }
    }

    // pop-ups
    for (const f of sim.fx) if (f.seq > fxSeen) addPop(sim, f, now);
    fxSeen = sim.fxSeq;
    updatePops(now);

    // camera: follow
    const target = follow ?? (view === 'follow' || view === 'street' ? selected : null);
    if (target) {
      const [x, y] = along(target, frac);
      const tp = posXY(x, y, target.cell, 1);
      const range = view === 'street' ? 26 : follow ? 95 : 120;
      const pitch = view === 'street' ? -16 : -50;
      if (!following) camRange = Cesium.Cartesian3.distance(viewer.camera.positionWC, tp);
      camRange += (range - camRange) * 0.08;          // ease in
      viewer.camera.lookAt(tp, new Cesium.HeadingPitchRange(viewer.camera.heading, Cesium.Math.toRadians(pitch), camRange));
      following = true;
    } else if (following) { viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY); following = false; }
  }

  // clicks on the city become grid cells
  const handler = new Cesium.ScreenSpaceEventHandler(scene.canvas);
  handler.setInputAction((e) => {
    const p = scene.pickPosition(e.position);
    if (!p) return;
    const c = Cesium.Cartographic.fromCartesian(p);
    const [x, y] = geo.toGrid(Cesium.Math.toDegrees(c.longitude), Cesium.Math.toDegrees(c.latitude));
    if (x < 0 || y < 0 || x >= city.W || y >= city.H) return;
    onPick?.(Math.floor(y) * city.W + Math.floor(x));
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  return {
    frame, setView, focusOn,
    invalidate: () => { for (const p of pops) viewer.entities.remove(p.ring); for (const b of bagRings) viewer.entities.remove(b.entity); bagRings.length = 0; rebuildStatic = true; ratBB.clear(); insBB.clear(); agentsBB.removeAll(); labels.removeAll(); for (const b of beams.values()) viewer.entities.remove(b.entity); beams.clear(); pops.length = 0; fxSeen = 0; bagsSeen.clear(); },
    resetCamera: () => setView('city'),
    viewer,
  };
}
