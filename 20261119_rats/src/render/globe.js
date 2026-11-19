// The real city in 3D: Google Photorealistic 3D Tiles (through Cesium ion), with the simulation
// drawn on top: rats, inspectors, food set out, bins, bait stations, sheds, burrows, street lights,
// and a layer draped over the ground (rat paths tonight, signs, the real reports, light).

import { layerValues } from './plan.js';

// a Cesium ion token limited to this site (yz5149-stack.github.io and localhost), read-only, for the
// Google tiles, Cesium World Terrain and Cesium OSM Buildings only
export const ION_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJub25jZSI6ImY3dlJON0N3bnpnZHdFSXUiLCJqdGkiOiIzMTI0Zjg2Mi04MzFmLTRjMmQtOWZlMi03NjdjNDJiZTFlNzciLCJpZCI6NTUyNDY3LCJzdWIiOiJ5ejUxNDktc3RhY2siLCJpc3MiOiJodHRwczovL2FwaS5jZXNpdW0uY29tIiwiYXVkIjoic3BhdGlhbCBhaSIsImlhdCI6MTc5NTA1MTI5N30.AnGsZWoF8CHHLvkc1Ce56r-wkO3gXF5ZTYjeG8l8IsU';

const GEOID_NYC = -32.6;   // ellipsoid height minus NAVD88 elevation around Manhattan (about -32.6 m)
const HEADING = 29;        // Manhattan's grid runs 29° east of true north

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
  scene.skyAtmosphere.show = true;
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
  let geoid = GEOID_NYC;
  const posOf = (cell, lift = 0.6, fx = 0.5, fy = 0.5) => {
    const x = cell % W; const y = Math.floor(cell / W);
    const [lon, lat] = geo.toLonLat(x + fx, y + fy);
    return Cesium.Cartesian3.fromDegrees(lon, lat, city.elev[cell] + geoid + lift);
  };

  // calibrate the height: sample the tiles on a few open streets and compare with the surveyed ground
  async function calibrate() {
    if (!tileset) return;
    const cells = city.nodes.filter((i) => city.road[i]).filter((_, k) => k % 397 === 0).slice(0, 16);
    const carto = cells.map((c) => { const [lon, lat] = geo.toLonLat((c % W) + 0.5, Math.floor(c / W) + 0.5); return Cesium.Cartographic.fromDegrees(lon, lat); });
    try {
      const got = await scene.sampleHeightMostDetailed(carto);
      const diffs = got.map((g, k) => (Number.isFinite(g.height) ? g.height - city.elev[cells[k]] : null)).filter((v) => v !== null && Math.abs(v - GEOID_NYC) < 15).sort((a, b) => a - b);
      if (diffs.length >= 4) { geoid = diffs[Math.floor(diffs.length / 2)]; rebuildStatic = true; }
    } catch (err) { console.warn('height calibration', err); }
  }
  if (tileset) tileset.initialTilesLoaded.addEventListener(() => calibrate());

  // ---- what is drawn -------------------------------------------------------------------------
  const lamps = scene.primitives.add(new Cesium.PointPrimitiveCollection());
  const statics = scene.primitives.add(new Cesium.PointPrimitiveCollection());
  const food = scene.primitives.add(new Cesium.PointPrimitiveCollection());
  const agents = scene.primitives.add(new Cesium.PointPrimitiveCollection());
  const labels = scene.primitives.add(new Cesium.LabelCollection());
  const trails = scene.primitives.add(new Cesium.PolylineCollection());
  const C = (css, a = 1) => Cesium.Color.fromCssColorString(css).withAlpha(a);
  const FRONT = Number.POSITIVE_INFINITY;
  let rebuildStatic = true;
  let lastDesign = null;
  const ratPts = new Map(); const insPts = new Map();

  function buildStatic(sim) {
    lamps.removeAll(); statics.removeAll();
    for (let k = 0; k < city.poles.length; k += 1) lamps.add({ position: posOf(city.poles[k], 6), color: C('#fff1b8', 0.55), pixelSize: 5, show: false });
    for (const c of sim.design.lights) lamps.add({ position: posOf(c, 6), color: C('#fff1b8', 0.95), pixelSize: 9, outlineColor: C('#fff1b8', 0.4), outlineWidth: 4 });
    for (const sh of sim.sheds) {
      if (sh.type === 'gone') continue;
      for (const c of sh.cells) statics.add({ position: posOf(c, 3.2), color: sh.type === 'old' ? C('#5ac8dc', 0.85) : C('#e6f5ff', 0.85), pixelSize: 6, disableDepthTestDistance: 300 });
    }
    for (const c of sim.design.guards) statics.add({ position: posOf(c, 0.4), color: C('#a0a0a0', 0.9), pixelSize: 5, disableDepthTestDistance: 300 });
    lastDesign = sim.design;
    rebuildStatic = false;
  }

  // the layer draped over the ground: a canvas the size of the grid, refreshed every couple of seconds
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
      img.data[i * 4] = L.c[0]; img.data[i * 4 + 1] = L.c[1]; img.data[i * 4 + 2] = L.c[2]; img.data[i * 4 + 3] = Math.round(70 + 185 * t);
    }
    g.putImageData(img, 0, 0);
    const material = new Cesium.ImageMaterialProperty({ image: cv, transparent: true });
    if (!drape) {
      drape = viewer.entities.add({ rectangle: { coordinates: rect, material, classificationType: Cesium.ClassificationType.BOTH } });
    } else { drape.rectangle.material = material; drape.show = true; }
  }

  // night: a darker, bluer picture (the Google tiles are photographed by day)
  const nightStage = scene.postProcessStages.add(new Cesium.PostProcessStage({
    fragmentShader: `uniform sampler2D colorTexture; uniform float night; in vec2 v_textureCoordinates;
      void main() { vec4 c = texture(colorTexture, v_textureCoordinates);
        vec3 n = c.rgb * mix(1.0, 0.42, night); n = mix(n, n * vec3(0.78, 0.86, 1.18), night);
        out_FragColor = vec4(n, c.a); }`,
    uniforms: { night: 0 },
  }));

  // ---- camera -------------------------------------------------------------------------------------
  const center = geo.toLonLat(city.W / 2, city.H / 2);
  let view = 'city'; let followed = null;
  function setView(v, sim, sel) {
    view = v; followed = sel;
    if (v === 'city') {
      viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
      const target = Cesium.Cartesian3.fromDegrees(center[0], center[1], 30 + geoid);
      viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(target, 700), { offset: new Cesium.HeadingPitchRange(Cesium.Math.toRadians(HEADING), Cesium.Math.toRadians(-58), 1550), duration: 1.6 });
    }
  }
  setView('city');

  let camRange = null;
  function frame(sim, { layer, selected, now, hourFrac }) {
    if (rebuildStatic || sim.design !== lastDesign) buildStatic(sim);
    updateDrape(sim, layer, now);
    const night = hourFrac >= 19.5 || hourFrac < 5.5 ? 1 : hourFrac >= 17.5 ? (hourFrac - 17.5) / 2 : hourFrac < 7 ? (7 - hourFrac) / 1.5 : 0;
    nightStage.uniforms.night = Math.max(0, Math.min(1, night)) * 0.85;
    for (let k = 0; k < city.poles.length && k < lamps.length; k++) lamps.get(k).show = night > 0.5;

    // food, bins, stations, burrows: rebuilt every frame (a few hundred points)
    food.removeAll();
    for (const s of sim.sources) {
      if (s.amt > 0.05) food.add({ position: posOf(s.cell, 0.6), color: C('#ffd34d'), pixelSize: 5, disableDepthTestDistance: 250 });
      else if (s.binned && s.isOut) food.add({ position: posOf(s.cell, 0.8), color: C('#5fd38a', 0.85), pixelSize: 4, disableDepthTestDistance: 250 });
    }
    for (const st of sim.stations) food.add({ position: posOf(st.cell, 0.5), color: C('#c58bff'), pixelSize: 7, outlineColor: C('#000', 0.8), outlineWidth: 1, disableDepthTestDistance: 400 });
    for (const col of sim.colonies) if (col.alive) food.add({ position: posOf(col.home, 0.3), color: C('#ff5a3c', 0.15), pixelSize: 11, outlineColor: C('#ff5a3c', 0.95), outlineWidth: 2, disableDepthTestDistance: 400 });

    // agents
    const seen = new Set();
    for (const r of sim.rats) {
      if (!r.alive || r.mode === 'home') continue;
      seen.add(r.id);
      let p = ratPts.get(r.id);
      if (!p) { p = agents.add({ pixelSize: 9, outlineColor: C('#ff6b3d', 0.35), outlineWidth: 4, disableDepthTestDistance: FRONT }); ratPts.set(r.id, p); }
      p.position = posOf(r.cell, 0.5); p.show = true;
      p.color = r.deathAt >= 0 ? C('#d9b3ff') : C('#ff7a4a');
      p.outlineColor = r.deathAt >= 0 ? C('#c58bff', 0.35) : C('#ff6b3d', 0.35);
      p.pixelSize = selected === r ? 14 : 9;
    }
    for (const [id, p] of ratPts) if (!seen.has(id)) p.show = false;
    labels.removeAll();
    // the selected agent's trail and planned route
    trails.removeAll();
    if (selected && selected.trail.length > 1) {
      trails.add({ positions: selected.trail.slice(-160).map((c) => posOf(c, 0.7)), width: 3, material: Cesium.Material.fromType('Color', { color: selected.kind === 'rat' ? C('#ff9a6a', 0.9) : C('#8fd3ff', 0.9) }) });
      if (selected.path && selected.path.length > 1) trails.add({ positions: selected.path.slice(selected.pi ?? 0).map((c) => posOf(c, 0.7)), width: 2, material: Cesium.Material.fromType('PolylineDash', { color: C('#ffffff', 0.8), dashLength: 12 }) });
    }
    for (const ins of sim.inspectors) {
      let p = insPts.get(ins.id);
      if (!p) { p = agents.add({ pixelSize: 11, color: C('#47b8ff'), outlineColor: C('#fff'), outlineWidth: 2, disableDepthTestDistance: FRONT }); insPts.set(ins.id, p); }
      const on = ins.mode !== 'off' && ins.mode !== 'done';
      p.show = on;
      if (!on) continue;
      p.position = posOf(ins.cell, 1.7);
      labels.add({ position: posOf(ins.cell, 4), text: ins.name, font: '12px system-ui', fillColor: C('#cfeaff'), outlineColor: C('#000'), outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE, disableDepthTestDistance: FRONT, pixelOffset: new Cesium.Cartesian2(0, -10) });
    }
    // camera: follow the selected agent
    if ((view === 'follow' || view === 'street') && selected) {
      const target = posOf(selected.cell, 1);
      const range = view === 'street' ? 26 : 130;
      const pitch = view === 'street' ? -14 : -38;
      if (camRange === null) camRange = range;
      viewer.camera.lookAt(target, new Cesium.HeadingPitchRange(viewer.camera.heading, Cesium.Math.toRadians(pitch), range));
    } else camRange = null;
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
    frame, setView,
    invalidate: () => { rebuildStatic = true; ratPts.clear(); agents.removeAll(); insPts.clear(); },
    resetCamera: () => setView('city'),
    viewer,
  };
}
