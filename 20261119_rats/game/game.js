// Rat Run 125: an arcade game on the real 125th Street & Amsterdam Avenue.
// The street (buildings, sidewalks, roads, lamps, trash sources, bins, subway entrances) comes from
// the Rat City simulation's grid (../src/sim/city.js), built from NYC Open Data and OpenStreetMap.
// You play one rat: carry food from the trash back to your burrow before dawn.

import { buildCity, G, S } from '../src/sim/city.js?v=13';
import { CONFIG } from '../src/sim/config.js?v=13';

const DATA_URL = new URL('../data/manhattanville.json', import.meta.url).href;
const R = 16;                 // pixels per cell in the pre-drawn world
const NIGHT_SECONDS = 150;    // 7 pm -> 5 am
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const TAU = Math.PI * 2;
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};

// ---------------------------------------------------------------------------------- words
const WORDS = {
  en: {
    night: 'Night', pts: 'pts', stash: 'Stash', sniff: 'Sniff', dive: 'Dive', dash: 'Dash',
    kicker: '125th St & Amsterdam Av · Harlem · after dark',
    lead: 'You are a rat. The city just put its trash out. Grab what you can carry, dodge the patrol\'s flashlights, the cars and the bodega cat, and stash enough in your burrow before dawn.',
    'h-move': 'run', 'h-dash': 'dash (uses stamina)', 'h-sniff': 'sniff out food nearby',
    'h-dive': 'dive into a subway grate, pop out at another',
    'h-wall': 'hug the walls and stay out of the lamplight: you\'re harder to spot',
    play: 'Play', fine: 'The streets, buildings, lamps, bins, restaurants and subway entrances are the real place, from NYC Open Data and OpenStreetMap.',
    sim: 'See the simulation →', best: (s, n) => `Best: ${s} pts · reached night ${n}`,
    nightTitle: (n) => `Night ${n}`, goal: 'Stash before dawn', bites: 'bites',
    newThreats: 'Out tonight:', inspectors: (n) => `${n} inspector${n > 1 ? 's' : ''} with flashlights`,
    cars: 'traffic on every street', truck: 'a night garbage truck (it takes the bags!)', cat: 'the bodega cat',
    go: 'Go!', dawn: 'Dawn', made: 'You made it!', short: 'Not enough food…',
    stashed: 'stashed', caught: 'caught', km: 'm run',
    pick: 'Pick a perk for tomorrow night', continue: 'Next night', retry: 'Play again', title: 'Title',
    over: 'Game over', overLead: (s, n) => `${s} points over ${n} night${n > 1 ? 's' : ''}.`, newBest: 'New best!',
    paused: 'Paused', resume: 'Resume', quit: 'Quit to title',
    caughtBy: { ins: 'CAUGHT!', car: 'BONK!', cat: 'SWIPE!' },
    caughtMsg: { ins: 'The inspector grabbed you. You dropped your food.', car: 'Hit by a car. Look both ways!', cat: 'The cat got you.' },
    seen: 'Spotted!', lost: 'You lost them', bank: (n, p) => `+${p} · stashed ${n}`,
    quotaMet: 'Enough for tonight! Keep going for bonus.', trash: (name) => `${name} put the trash out`,
    restaurant: 'A restaurant', binsOut: 'Bags are out on every block', full: 'Cheeks full! Head home.',
    grateHint: 'Space / Dive: into the grate', grateKey: 'Dive', dawnSoon: 'Dawn in one hour. Get home!',
    lostCarry: 'Caught out at dawn: you lost what you carried.', truckMsg: 'Garbage truck coming…', lives: 'lives',
    perks: {
      speed: ['Quick feet', 'Run 12% faster'], cap: ['Big cheeks', 'Carry 2 more bites'],
      vision: ['Night eyes', 'See further in the dark'], heart: ['Thick fur', '+1 life (and heal one)'],
      sniff: ['Super sniffer', 'Sniff further, more often'], stealth: ['Soft paws', 'Spotted 25% slower'],
      stamina: ['Big lungs', 'Dash 50% longer'],
    },
    loading: 'Loading the street…',
  },
  zh: {
    night: '夜', pts: '分', stash: '囤粮', sniff: '嗅', dive: '钻', dash: '冲',
    kicker: '哈莱姆 · 125街与阿姆斯特丹大道 · 入夜',
    lead: '你是一只老鼠。整条街刚把垃圾搬出来。尽量多叼点吃的，躲开巡查员的手电筒、来往的汽车和杂货店的猫，在天亮前把足够的食物囤回洞里。',
    'h-move': '奔跑', 'h-dash': '冲刺（消耗体力）', 'h-sniff': '嗅出附近的食物',
    'h-dive': '钻进地铁格栅，从另一个出口冒出来',
    'h-wall': '贴着墙走、避开路灯：更难被发现',
    play: '开始', fine: '街道、建筑、路灯、垃圾桶、餐馆和地铁口都来自真实街区（纽约市开放数据与 OpenStreetMap）。',
    sim: '查看模拟 →', best: (s, n) => `最高分：${s} · 撑到第 ${n} 夜`,
    nightTitle: (n) => `第 ${n} 夜`, goal: '天亮前囤够', bites: '口',
    newThreats: '今晚出没：', inspectors: (n) => `${n} 名拿手电的巡查员`,
    cars: '每条街都有车', truck: '夜间垃圾车（会把垃圾袋收走！）', cat: '杂货店的猫',
    go: '出发！', dawn: '天亮了', made: '过关！', short: '食物不够……',
    stashed: '囤粮', caught: '被抓', km: '米',
    pick: '为明晚选一个能力', continue: '下一夜', retry: '再玩一次', title: '回到标题',
    over: '游戏结束', overLead: (s, n) => `${n} 夜共得 ${s} 分。`, newBest: '新纪录！',
    paused: '暂停', resume: '继续', quit: '回到标题',
    caughtBy: { ins: '被抓了！', car: '砰！', cat: '喵！' },
    caughtMsg: { ins: '巡查员抓住了你，食物掉了。', car: '被车撞了，过马路要看车！', cat: '被猫逮住了。' },
    seen: '被发现了！', lost: '甩掉了', bank: (n, p) => `+${p} · 囤了 ${n} 口`,
    quotaMet: '今晚够了！继续可以拿奖励分。', trash: (name) => `${name} 把垃圾搬出来了`,
    restaurant: '一家餐馆', binsOut: '每个街区都摆出了垃圾袋', full: '腮帮塞满了！快回洞。',
    grateHint: '空格 / 钻：钻进格栅', grateKey: '钻', dawnSoon: '还有一小时天亮，快回家！',
    lostCarry: '天亮时还在外面：嘴里的食物丢了。', truckMsg: '垃圾车来了……', lives: '命',
    perks: {
      speed: ['快腿', '跑速 +12%'], cap: ['大腮帮', '多叼 2 口'],
      vision: ['夜眼', '黑暗中看得更远'], heart: ['厚毛', '+1 条命（并回一条）'],
      sniff: ['灵鼻', '嗅得更远、更频繁'], stealth: ['轻足', '被发现慢 25%'],
      stamina: ['大肺', '冲刺时间 +50%'],
    },
    loading: '正在加载街区……',
  },
};
let lang = store.get('ratrun.lang', (navigator.language || '').startsWith('zh') ? 'zh' : 'en');
const T = (k) => WORDS[lang][k] ?? WORDS.en[k];
function applyLang() {
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  for (const el of document.querySelectorAll('[data-t]')) { const v = T(el.dataset.t); if (typeof v === 'string') el.textContent = v; }
  for (const b of document.querySelectorAll('[data-lang]')) b.classList.toggle('on', b.dataset.lang === lang);
  showBest();
}

// ---------------------------------------------------------------------------------- sound
let actx = null; let muted = store.get('ratrun.muted', false);
function audio() { if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch { actx = null; } } if (actx?.state === 'suspended') actx.resume(); return actx; }
function tone(f, d = 0.08, type = 'square', vol = 0.04, f2 = null, delay = 0) {
  if (muted) return; const a = audio(); if (!a) return;
  const t = a.currentTime + delay; const o = a.createOscillator(); const g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + d);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  o.connect(g).connect(a.destination); o.start(t); o.stop(t + d + 0.02);
}
const sfx = {
  nibble: () => tone(900 + Math.random() * 300, 0.04, 'square', 0.025),
  bank: (n) => { for (let k = 0; k < Math.min(n, 6); k++) tone(520 * Math.pow(1.19, k), 0.09, 'triangle', 0.05, null, k * 0.06); },
  alert: () => { tone(880, 0.09, 'square', 0.05); tone(1320, 0.12, 'square', 0.05, null, 0.1); },
  caught: () => tone(400, 0.5, 'sawtooth', 0.06, 60),
  sniff: () => { tone(300, 0.12, 'sine', 0.05, 700); tone(320, 0.12, 'sine', 0.04, 760, 0.14); },
  dive: () => tone(600, 0.25, 'sine', 0.06, 120),
  pop: () => tone(180, 0.18, 'sine', 0.06, 700),
  horn: () => { tone(330, 0.18, 'sawtooth', 0.03); tone(415, 0.18, 'sawtooth', 0.03); },
  thud: () => tone(120, 0.12, 'triangle', 0.05, 60),
  win: () => [523, 659, 784, 1046].forEach((f, k) => tone(f, 0.16, 'triangle', 0.06, null, k * 0.12)),
  lose: () => [392, 330, 262, 196].forEach((f, k) => tone(f, 0.22, 'triangle', 0.06, null, k * 0.16)),
  click: () => tone(700, 0.04, 'square', 0.03),
};

// ---------------------------------------------------------------------------------- city
let city; let W; let H; let world; let darkMap; let miniBase;
let lamp; let burrow; let grates = []; let lampCells = []; let roadCells = []; let walkCells = [];
const inB = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
const cellAt = (x, y) => (inB(x, y) ? Math.floor(y) * W + Math.floor(x) : -1);
const walkable = (x, y) => { const i = cellAt(x, y); return i >= 0 && city.walk[i] === 1; };
const cx = (i) => (i % W) + 0.5; const cy = (i) => Math.floor(i / W) + 0.5;

function seeThrough(x, y) { const i = cellAt(x, y); return i >= 0 && city.ground[i] !== G.BLDG; }
function los(ax, ay, bx, by) {
  const d = Math.hypot(bx - ax, by - ay); const n = Math.ceil(d / 0.4);
  for (let k = 1; k < n; k++) if (!seeThrough(ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n)) return false;
  return true;
}

// BFS over walkable cells, 8 directions without cutting corners
let bfsPrev; let bfsQ;
function path(from, to, maxSteps = 6000) {
  if (from === to) return [to];
  bfsPrev.fill(-1); let h = 0; let t = 0; bfsQ[t++] = from; bfsPrev[from] = from;
  while (h < t && h < maxSteps) {
    const c = bfsQ[h++]; const x = c % W; const y = (c / W) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue; const nx = x + dx; const ny = y + dy;
      if (!inB(nx, ny)) continue; const n = ny * W + nx;
      if (bfsPrev[n] !== -1 || !city.walk[n]) continue;
      if (dx && dy && (!city.walk[y * W + nx] || !city.walk[ny * W + x])) continue;
      bfsPrev[n] = c; if (n === to) { const out = [n]; let k = c; while (k !== from) { out.push(k); k = bfsPrev[k]; } return out.reverse(); }
      bfsQ[t++] = n;
    }
  }
  return null;
}

function prepCity(place) {
  city = buildCity(place, CONFIG); W = city.W; H = city.H;
  bfsPrev = new Int32Array(city.N); bfsQ = new Int32Array(city.N);
  for (let i = 0; i < city.N; i++) {
    if (!city.walk[i]) continue; walkCells.push(i); if (city.road[i]) roadCells.push(i);
  }
  // the burrow: soil near the real rat reports, not too close to the edge
  let best = -1e9; let bi = walkCells[0];
  for (const i of walkCells) {
    if (!city.soil[i]) continue; const x = i % W; const y = (i / W) | 0;
    if (x < 8 || y < 8 || x > W - 8 || y > H - 8) continue;
    const d = Math.hypot(x - W / 2, y - H / 2) / W;
    const s = city.real.map[i] * 2 - d;
    if (s > best) { best = s; bi = i; }
  }
  burrow = { x: cx(bi), y: cy(bi), cell: bi };
  // grates: the real subway entrances, plus a few street corners so the network reaches everywhere
  const seen = new Set();
  const addGrate = (cell, name) => { const i = nearestWalk(cell); if (i < 0 || seen.has(i)) return; for (const g of grates) if (Math.hypot(g.x - cx(i), g.y - cy(i)) < 10) return; seen.add(i); grates.push({ x: cx(i), y: cy(i), cell: i, name, subway: !!name }); };
  for (const s of city.subways) addGrate(s.cell, 'subway');
  for (const c of city.corners) addGrate(c.cell, null);
  lampCells = city.poles;
  lamp = new Float32Array(city.N); const LR = 2.6;
  for (const p of city.poles) { const px = cx(p); const py = cy(p); for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const i = cellAt(px + dx, py + dy); if (i < 0) continue; const d = Math.hypot(cx(i) - px, cy(i) - py); if (d < LR) lamp[i] = Math.max(lamp[i], Math.pow(1 - d / LR, 0.8)); } }
  drawWorld(); drawDark(); drawMiniBase();
}
function nearestWalk(cell) {
  if (city.walk[cell]) return cell; const x0 = cell % W; const y0 = (cell / W) | 0;
  for (let r = 1; r < 8; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const i = cellAt(x0 + dx, y0 + dy); if (i >= 0 && city.walk[i]) return i; }
  return -1;
}

// ---------------------------------------------------------------------------------- pre-drawn world
function hash(i) { let x = (i * 2654435761) >>> 0; x ^= x >>> 13; x = Math.imul(x, 0x5bd1e995) >>> 0; return (x ^ (x >>> 15)) / 4294967296; }

function drawWorld() {
  world = document.createElement('canvas'); world.width = W * R; world.height = H * R;
  const g = world.getContext('2d');
  g.fillStyle = '#100d26'; g.fillRect(0, 0, world.width, world.height);
  const base = document.createElement('canvas'); base.width = W; base.height = H; const bg = base.getContext('2d'); const bimg = bg.createImageData(W, H);
  for (let i = 0; i < city.N; i++) {
    const gr = city.ground[i]; const su = city.surface[i];
    let c = null;
    if (gr === G.WATER) c = '#0b2140';
    else if (gr === G.FENCE) c = '#2b2747';
    else if (gr === G.BLDG) c = '#1a1534';
    else if (city.road[i]) c = '#1c1a36';
    else if (su === S.LAWN) c = hash(i) < 0.5 ? '#173a33' : '#163631';
    else if (su === S.WOODS) c = '#11302a';
    else if (city.walk[i]) c = city.wall[i] ? '#38325f' : '#2f2a52';
    else c = '#181430';
    const n = parseInt(c.slice(1), 16); bimg.data.set([(n >> 16) & 255, (n >> 8) & 255, n & 255, 255], i * 4);
  }
  bg.putImageData(bimg, 0, 0); g.imageSmoothingEnabled = true; g.drawImage(base, 0, 0, W * R, H * R);
  // a little grain so the pavement doesn't look like plastic
  for (let k = 0; k < W * H * 3; k++) { const i = (k * 7919) % (W * H * R * R); g.fillStyle = hash(k) < 0.5 ? 'rgba(255,255,255,.03)' : 'rgba(0,0,0,.08)'; g.fillRect((i % (W * R)), ((i / (W * R)) | 0) % (H * R), 2, 2); }
  // lane markings
  g.fillStyle = 'rgba(255,214,107,.28)';
  for (const l of city.lanes) for (let k = 0; k < l.cells.length; k += 5) { const i = l.cells[k]; g.fillRect((i % W) * R + R / 2 - 2, ((i / W) | 0) * R + R / 2 - 1, 4, 2); }
  // lamp glow
  g.globalCompositeOperation = 'lighter';
  for (const p of city.poles) {
    const x = cx(p) * R; const y = cy(p) * R; const gg = g.createRadialGradient(x, y, 0, x, y, R * 3.2);
    gg.addColorStop(0, 'rgba(255,170,80,.32)'); gg.addColorStop(1, 'rgba(255,170,80,0)'); g.fillStyle = gg; g.fillRect(x - R * 3.2, y - R * 3.2, R * 6.4, R * 6.4);
  }
  g.globalCompositeOperation = 'source-over';
  // trees
  for (const t of city.trees) { const x = cx(t) * R; const y = cy(t) * R; g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.arc(x + 3, y + 4, R * 0.75, 0, TAU); g.fill(); g.fillStyle = hash(t) < 0.5 ? '#1f5a45' : '#1d4f3f'; g.beginPath(); g.arc(x, y, R * 0.75, 0, TAU); g.fill(); g.fillStyle = 'rgba(120,220,170,.15)'; g.beginPath(); g.arc(x - 3, y - 3, R * 0.35, 0, TAU); g.fill(); }
  // sidewalk sheds (scaffolding)
  g.strokeStyle = 'rgba(160,120,80,.6)'; g.lineWidth = 2;
  for (const s of city.sheds) for (const i of s.cells) { const x = (i % W) * R; const y = ((i / W) | 0) * R; g.strokeRect(x + 2, y + 2, R - 4, R - 4); g.beginPath(); g.moveTo(x + 2, y + 2); g.lineTo(x + R - 2, y + R - 2); g.stroke(); }
  // buildings: south faces extruded, then roofs, nearest last
  const K = 0.03; // cells of lift per metre of height
  const blds = city.buildings.filter((b) => b.g && b.g.length > 2).map((b) => ({ b, maxY: Math.max(...b.g.map((p) => p[1])) })).sort((a, b) => a.maxY - b.maxY);
  const roofCol = { residential: ['#3b2f66', '#2a2150'], commercial: ['#56305e', '#3a2045'], campus: ['#2f3f72', '#212c55'], school: ['#2e4a6a', '#203650'], other: ['#3a3658', '#28253f'] };
  for (const { b } of blds) {
    const off = Math.min(4, Math.max(0.35, (b.h || 8) * K)); const pts = b.g; const [rc, sc] = roofCol[b.use] || roofCol.other;
    const inside = (px, py) => { let c = false; for (let k = 0, j = pts.length - 1; k < pts.length; j = k++) { const [ax, ay] = pts[j]; const [bx, by] = pts[k]; if ((ay > py) !== (by > py) && px < ax + ((py - ay) * (bx - ax)) / (by - ay)) c = !c; } return c; };
    for (let k = 0; k < pts.length; k++) {
      const [ax, ay] = pts[k]; const [bx, by] = pts[(k + 1) % pts.length]; const len = Math.hypot(bx - ax, by - ay); if (len < 0.05) continue;
      const mx = (ax + bx) / 2; const my = (ay + by) / 2; if (inside(mx, my + 0.15)) continue; // north-facing: hidden
      const shade = 0.55 + 0.45 * Math.abs((bx - ax) / len);
      g.fillStyle = shadeCol(sc, shade); g.beginPath(); g.moveTo(ax * R, ay * R); g.lineTo(bx * R, by * R); g.lineTo(bx * R, (by - off) * R); g.lineTo(ax * R, (ay - off) * R); g.closePath(); g.fill();
      // windows
      const floors = Math.max(1, Math.min(12, Math.round(b.floors || (b.h || 8) / 3.2))); const cols = Math.max(1, Math.floor((len * R) / 7));
      for (let f = 0; f < floors; f++) for (let c = 0; c < cols; c++) {
        const u = (c + 0.5) / cols; const v = (f + 0.55) / (floors + 0.2); const rnd = hash(b.id * 977 + f * 31 + c * 7 + k * 131);
        const wx = lerp(ax, bx, u) * R; const wy = (lerp(ay, by, u) - off * v) * R;
        g.fillStyle = rnd < 0.22 ? (rnd < 0.05 ? '#9fd8ff' : '#ffd36b') : 'rgba(10,8,30,.55)';
        g.fillRect(wx - 1.5, wy - 1.5, 3, Math.max(2, Math.min(4, (off * R) / floors - 1)));
      }
    }
    g.save(); g.translate(0, -off * R);
    g.beginPath(); pts.forEach(([x, y], k) => (k ? g.lineTo(x * R, y * R) : g.moveTo(x * R, y * R))); g.closePath();
    g.fillStyle = rc; g.fill(); g.strokeStyle = 'rgba(255,255,255,.14)'; g.lineWidth = 1.2; g.stroke();
    // rooftop bits: water tanks and vents
    if ((b.cells?.length || 0) > 30 && hash(b.id) < 0.45) { const [x, y] = centroid(pts); g.fillStyle = '#5a3d2e'; g.beginPath(); g.arc(x * R, y * R, R * 0.45, 0, TAU); g.fill(); g.fillStyle = '#7a5640'; g.beginPath(); g.arc(x * R, y * R - 2, R * 0.45, Math.PI, TAU); g.fill(); }
    g.restore();
  }
}
function centroid(pts) { let x = 0; let y = 0; for (const p of pts) { x += p[0]; y += p[1]; } return [x / pts.length, y / pts.length]; }
function shadeCol(hex, k) { const n = parseInt(hex.slice(1), 16); const r = ((n >> 16) & 255) * k; const gg = ((n >> 8) & 255) * k; const b = (n & 255) * k; return `rgb(${r | 0},${gg | 0},${b | 0})`; }

function drawDark() {
  const small = document.createElement('canvas'); small.width = W; small.height = H;
  const sg = small.getContext('2d'); const img = sg.createImageData(W, H);
  for (let i = 0; i < city.N; i++) { const l = lamp[i]; img.data[i * 4] = 6; img.data[i * 4 + 1] = 4; img.data[i * 4 + 2] = 24; img.data[i * 4 + 3] = 255 * (0.9 - 0.72 * l); }
  sg.putImageData(img, 0, 0);
  darkMap = document.createElement('canvas'); darkMap.width = W * 4; darkMap.height = H * 4;
  const g = darkMap.getContext('2d'); g.fillStyle = 'rgba(6,4,24,.9)'; g.fillRect(0, 0, W * 4, H * 4);
  g.globalCompositeOperation = 'copy'; g.filter = 'blur(5px)'; g.imageSmoothingEnabled = true; g.drawImage(small, 0, 0, W * 4, H * 4); g.filter = 'none';
}
function drawMiniBase() {
  miniBase = document.createElement('canvas'); miniBase.width = W; miniBase.height = H;
  const g = miniBase.getContext('2d'); const img = g.createImageData(W, H);
  for (let i = 0; i < city.N; i++) {
    let c = [16, 13, 38];
    if (city.ground[i] === G.BLDG) c = [58, 48, 100]; else if (city.road[i]) c = [40, 36, 74]; else if (city.walk[i]) c = [70, 62, 120];
    if (city.surface[i] === S.LAWN || city.surface[i] === S.WOODS) c = [30, 80, 66];
    img.data.set([...c, 255], i * 4);
  }
  g.putImageData(img, 0, 0);
}

// ---------------------------------------------------------------------------------- game state
const view = $('view'); const ctx = view.getContext('2d');
const dark = document.createElement('canvas'); const dctx = dark.getContext('2d');
const mini = $('mini'); const mctx = mini.getContext('2d');
let dpr = 1; let SW = 0; let SH = 0; let Z = 26;
function resize() {
  dpr = Math.min(2, window.devicePixelRatio || 1); SW = window.innerWidth; SH = window.innerHeight;
  view.width = SW * dpr; view.height = SH * dpr; dark.width = view.width; dark.height = view.height;
  Z = clamp(Math.min(SW, SH) / 21, 20, 36);
  if (W) { mini.width = W * 2; mini.height = H * 2; }
}
window.addEventListener('resize', resize);

const PERK_IDS = ['speed', 'cap', 'vision', 'heart', 'sniff', 'stealth', 'stamina'];
const PERK_ICON = { speed: '👟', cap: '🐹', vision: '👁️', heart: '🧶', sniff: '👃', stealth: '🐾', stamina: '🫁' };
let game = null; let mode = 'title'; let explored;
const keys = new Set(); const joy = { x: 0, y: 0, on: false, dash: false };

function newGame() {
  game = { night: 0, score: 0, hearts: 3, maxHearts: 3, totalBanked: 0, p: { speed: 1, cap: 4, vision: 1, sniffR: 18, sniffCd: 6, stealth: 1, stamina: 1 } };
}
function nightSpec(n) {
  return { quota: [12, 18, 24, 30, 36][n - 1] ?? 36 + (n - 5) * 6, inspectors: Math.min(6, [1, 2, 2, 3, 3][n - 1] ?? 3 + Math.floor((n - 5) / 2)), cars: Math.min(18, 4 + n * 2), truck: n >= 2, cats: n >= 3 ? (n >= 6 ? 2 : 1) : 0 };
}

function startNight() {
  game.night++; const spec = nightSpec(game.night); const rng = mulberry(20261119 + game.night * 977);
  Object.assign(game, { spec, t: 0, banked: 0, caughtN: 0, dist: 0, quotaMet: false, dawnWarned: false, toastT: 0, shake: 0, flash: 0, sniffT: 0, sniffCool: 0, ping: [], parts: [], floats: [], time: 0 });
  explored = new Uint8Array(city.N);
  game.rat = { x: burrow.x, y: burrow.y, vx: 0, vy: 0, ang: -Math.PI / 2, carry: 0, stam: 1, inv: 1.5, diving: 0, diveTo: null, diveCool: 0, step: 0, eat: 0, home: true };
  // food: bags from homes (out at 8 pm), restaurants after closing, groceries, open litter baskets; Better Bins are sealed
  game.food = [];
  for (const s of city.sources) {
    const cell = nearestWalk(s.cell); if (cell < 0) continue;
    if (Math.hypot(cx(cell) - burrow.x, cy(cell) - burrow.y) < 4) continue;
    const jitter = () => (rng() - 0.5) * 0.5;
    if (s.kind === 'basket') { game.food.push({ x: cx(cell) + jitter(), y: cy(cell) + jitter(), kind: s.better ? 'better' : 'basket', bites: s.better ? 0 : 2, max: 2, at: 0, on: true, name: s.name }); continue; }
    if (s.kind === 'home' || s.kind === 'campus' || s.kind === 'shop') {
      if (rng() > 0.4) continue;
      const bites = clamp(Math.round(1 + s.amount * 1.4), 2, 6);
      game.food.push({ x: cx(cell) + jitter(), y: cy(cell) + jitter(), kind: 'bag', bites, max: bites, at: 0.06 + rng() * 0.2, on: false, name: s.name });
    } else if (s.kind === 'restaurant') {
      game.food.push({ x: cx(cell) + jitter(), y: cy(cell) + jitter(), kind: 'pizza', bites: 6, max: 6, at: 0.35 + rng() * 0.25, on: false, name: s.name });
    } else if (s.kind === 'grocery') {
      game.food.push({ x: cx(cell) + jitter(), y: cy(cell) + jitter(), kind: 'crate', bites: 8, max: 8, at: 0.3 + rng() * 0.2, on: false, name: s.name });
    }
  }
  // the patrol
  game.ins = []; const far = walkCells.filter((i) => !city.soil[i] && Math.hypot(cx(i) - burrow.x, cy(i) - burrow.y) > 28);
  for (let k = 0; k < spec.inspectors; k++) { const c = far[Math.floor(rng() * far.length)]; game.ins.push(newHunter('ins', c, rng)); }
  for (let k = 0; k < spec.cats; k++) { const c = far[Math.floor(rng() * far.length)]; game.ins.push(newHunter('cat', c, rng)); }
  // traffic
  game.cars = [];
  for (let k = 0; k < spec.cars; k++) game.cars.push(newCar(rng, false));
  if (spec.truck) { const t = newCar(rng, true); t.wait = NIGHT_SECONDS * 0.5; game.cars.push(t); }
  game.rng = rng;
  showCard('intro');
}
function newHunter(kind, cell, rng) {
  return { kind, x: cx(cell), y: cy(cell), ang: rng() * TAU, state: 'patrol', path: null, pi: 0, meter: 0, last: null, lostT: 0, repath: 0, tired: 0, chaseT: 0, wob: rng() * 10, bang: 0 };
}
function newCar(rng, truck) {
  const lanes = city.lanes; const lane = lanes[Math.floor(rng() * lanes.length)];
  return { lane, pos: truck ? 0 : rng() * lane.cells.length, speed: truck ? 3.2 : 6 + rng() * 4, truck, wait: truck ? 0 : rng() * 4, color: ['#ff6f6f', '#ffd36b', '#7fd0ff', '#e7e3ff', '#a7ff8f'][Math.floor(rng() * 5)], x: 0, y: 0, ang: 0, honk: 0 };
}
function mulberry(seed) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ---------------------------------------------------------------------------------- update
function update(dt) {
  const g = game; const r = g.rat; g.time += dt;
  g.t += dt / NIGHT_SECONDS;
  // food appears on schedule
  for (const f of g.food) if (!f.on && g.t >= f.at) {
    f.on = true; f.pop = 1;
    if (f.kind !== 'bag' && g.toastT <= 0 && Math.hypot(f.x - r.x, f.y - r.y) < 45) { toast(`${f.kind === 'pizza' ? '🍕' : '🥬'} ${T('trash')(niceName(f.name) || T('restaurant'))}`); g.toastT = 7; sfx.thud(); }
  }
  if (g.t > 0.06 && !g.bagsSaid) { g.bagsSaid = true; toast(`🗑️ ${T('binsOut')}`); }
  g.toastT -= dt;
  if (g.t > 0.88 && !g.dawnWarned) { g.dawnWarned = true; toast(`🌅 ${T('dawnSoon')}`, 'bad'); }
  if (g.t >= 1) { endNight(); return; }

  // --- rat
  r.inv = Math.max(0, r.inv - dt); r.diveCool = Math.max(0, r.diveCool - dt); g.sniffCool = Math.max(0, g.sniffCool - dt); g.sniffT = Math.max(0, g.sniffT - dt);
  if (r.diving > 0) {
    r.diving -= dt;
    if (r.diving <= 0) { r.x = r.diveTo.x; r.y = r.diveTo.y; r.inv = Math.max(r.inv, 0.8); sfx.pop(); burst(r.x, r.y, '#43e6c5', 14); for (const h of g.ins) if (h.state === 'chase') { h.state = 'search'; h.lostT = 0; } }
  } else {
    let ix = 0; let iy = 0;
    if (keys.has('ArrowLeft') || keys.has('KeyA')) ix -= 1; if (keys.has('ArrowRight') || keys.has('KeyD')) ix += 1;
    if (keys.has('ArrowUp') || keys.has('KeyW')) iy -= 1; if (keys.has('ArrowDown') || keys.has('KeyS')) iy += 1;
    if (joy.on) { ix = joy.x; iy = joy.y; }
    const il = Math.hypot(ix, iy); if (il > 1) { ix /= il; iy /= il; }
    const wantDash = (keys.has('ShiftLeft') || keys.has('ShiftRight') || joy.dash) && il > 0.1;
    const dashing = wantDash && r.stam > 0.02;
    r.stam = clamp(r.stam + (dashing ? -dt * 0.45 / g.p.stamina : dt * 0.22), 0, 1); r.dashing = dashing;
    const load = 1 - 0.05 * r.carry;
    const top = 5.2 * g.p.speed * load * (dashing ? 1.65 : 1);
    const ax = ix * top; const ay = iy * top; const k = 1 - Math.exp(-dt * 14);
    r.vx = lerp(r.vx, ax, k); r.vy = lerp(r.vy, ay, k);
    const ox = r.x; const oy = r.y; moveBody(r, r.vx * dt, r.vy * dt, 0.28);
    const moved = Math.hypot(r.x - ox, r.y - oy); g.dist += moved; r.step += moved * 3;
    if (Math.hypot(r.vx, r.vy) > 0.4) r.ang = Math.atan2(r.vy, r.vx);
    if (dashing && Math.random() < dt * 30) g.parts.push({ x: r.x - Math.cos(r.ang) * 0.3, y: r.y - Math.sin(r.ang) * 0.3, vx: (Math.random() - 0.5), vy: (Math.random() - 0.5), life: 0.4, max: 0.4, c: 'rgba(200,190,255,.5)', s: 0.12 });
  }
  const rc = cellAt(r.x, r.y);
  r.onWall = rc >= 0 && city.wall[rc] === 1; r.light = rc >= 0 ? lamp[rc] : 0; r.onRoad = rc >= 0 && city.road[rc] === 1;
  // explore
  if ((g.time * 5 | 0) !== g.lastEx) { g.lastEx = g.time * 5 | 0; const vr = Math.round(6 * g.p.vision); const x0 = r.x | 0; const y0 = r.y | 0; for (let dy = -vr; dy <= vr; dy++) for (let dx = -vr; dx <= vr; dx++) if (dx * dx + dy * dy <= vr * vr) { const i = cellAt(x0 + dx, y0 + dy); if (i >= 0) explored[i] = 1; } }

  // eat
  r.eat -= dt;
  if (r.diving <= 0 && r.carry < g.p.cap && r.eat <= 0) {
    for (const f of g.food) {
      if (!f.on || f.bites <= 0 || f.kind === 'better') continue;
      if (Math.abs(f.x - r.x) < 0.85 && Math.abs(f.y - r.y) < 0.85) {
        f.bites--; r.carry++; r.eat = 0.18; f.wig = 0.25; sfx.nibble(); crumbs(f.x, f.y);
        if (r.carry >= g.p.cap) { floatText(r.x, r.y - 0.8, T('full'), '#ffcf3f'); }
        break;
      }
    }
  }
  // bank
  const home = Math.hypot(r.x - burrow.x, r.y - burrow.y) < 1.1; r.home = home;
  if (home && r.carry > 0) {
    const n = r.carry; const pts = Math.round(n * 10 * (1 + 0.15 * (n - 1)) * (1 + 0.1 * (g.night - 1)));
    g.banked += n; g.totalBanked += n; g.score += pts; r.carry = 0; sfx.bank(n); burst(burrow.x, burrow.y, '#ffcf3f', 10 + n * 3);
    floatText(burrow.x, burrow.y - 1, `+${pts}`, '#ffcf3f', 1.4);
    if (!g.quotaMet && g.banked >= g.spec.quota) { g.quotaMet = true; toast(`⭐ ${T('quotaMet')}`, 'good'); sfx.win(); }
  }

  // --- hunters
  for (const h of g.ins) updateHunter(h, dt);
  // --- cars
  for (const c of g.cars) updateCar(c, dt);

  // particles
  for (const p of g.parts) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.92; p.vy *= 0.92; p.life -= dt; }
  g.parts = g.parts.filter((p) => p.life > 0);
  for (const f of g.floats) { f.y -= dt * 0.9; f.life -= dt; }
  g.floats = g.floats.filter((f) => f.life > 0);
  g.ping = g.ping.filter((p) => (p.life -= dt) > 0);
  g.shake = Math.max(0, g.shake - dt * 2.5); g.flash = Math.max(0, g.flash - dt * 1.6);
}

function moveBody(e, dx, dy, rad) {
  const free = (x, y) => walkable(x - rad, y - rad) && walkable(x + rad, y - rad) && walkable(x - rad, y + rad) && walkable(x + rad, y + rad);
  const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 0.2)); const sx = dx / n; const sy = dy / n;
  for (let k = 0; k < n; k++) {
    if (free(e.x + sx, e.y)) e.x += sx; else e.vx *= 0.3;
    if (free(e.x, e.y + sy)) e.y += sy; else e.vy *= 0.3;
  }
}

function updateHunter(h, dt) {
  const g = game; const r = g.rat; const cat = h.kind === 'cat';
  const dx = r.x - h.x; const dy = r.y - h.y; const d = Math.hypot(dx, dy);
  const hidden = r.diving > 0 || r.inv > 0 || (r.home && r.carry === 0) || r.home;
  h.bang = Math.max(0, h.bang - dt); h.tired = Math.max(0, h.tired - dt);
  // can it see the rat?
  let sees = false; let rate = 0;
  if (!hidden) {
    if (cat) {
      if (d < 6 && los(h.x, h.y, r.x, r.y)) { sees = true; rate = (1.4 - d / 6) * 1.6 * (r.dashing ? 1.4 : 1) * g.p.stealth; }
    } else {
      const range = 9.5; let da = Math.atan2(dy, dx) - h.ang; da = Math.atan2(Math.sin(da), Math.cos(da));
      const inCone = d < range && Math.abs(da) < 0.62; const close = d < 1.6;
      if ((inCone || close) && los(h.x, h.y, r.x, r.y)) {
        sees = true;
        rate = (1.5 - d / range) * (0.35 + 1.8 * r.light) * (r.onWall ? 0.6 : 1) * (r.dashing ? 1.35 : 1) * g.p.stealth * (close ? 2.5 : 1) * (1 + 0.08 * (g.night - 1));
      }
    }
  }
  if (h.state !== 'chase') {
    if (sees) h.meter += rate * dt * 1.4; else h.meter = Math.max(0, h.meter - dt * 0.35);
    if (h.meter >= 1 && h.tired <= 0) {
      h.state = 'chase'; h.chaseT = 0; h.lostT = 0; h.last = { x: r.x, y: r.y }; h.bang = 1.2; h.path = null;
      sfx.alert(); if (!cat) toast(`❗ ${T('seen')}`, 'bad'); g.shake = Math.max(g.shake, 0.25);
    }
  }
  let speed = cat ? 2.0 : 2.5; let target = null;
  if (h.state === 'chase') {
    h.chaseT += dt;
    if (sees || (d < 12 && !hidden && los(h.x, h.y, r.x, r.y))) { h.last = { x: r.x, y: r.y }; h.lostT = 0; } else h.lostT += dt;
    speed = cat ? (h.chaseT < 3.5 ? 6.6 : 3) : 4.4 + 0.12 * g.night;
    target = h.last;
    if (hidden && r.diving > 0) h.lostT += dt * 2;
    if (h.lostT > 2.6 || (cat && h.chaseT > 4.5)) { h.state = 'search'; h.lostT = 0; h.path = null; h.meter = 0.45; if (cat) h.tired = 4; else if (d > 4) floatText(h.x, h.y - 1, '?', '#ffffff'); }
    if (d < 0.62 && !hidden) { caught(h); return; }
    h.ang = turn(h.ang, Math.atan2(dy, dx), dt * 8);
  } else if (h.state === 'search') {
    target = h.last; speed = 3.1;
    if (!target || Math.hypot(target.x - h.x, target.y - h.y) < 0.7) { h.lostT += dt; h.ang += dt * 3; if (h.lostT > 2) { h.state = 'patrol'; h.path = null; } }
  }
  // follow a path
  h.repath -= dt;
  if (target && (h.repath <= 0 || !h.path)) { const a = cellAt(h.x, h.y); const b = nearestWalk(cellAt(target.x, target.y)); h.path = a >= 0 && b >= 0 ? path(a, b) : null; h.pi = 0; h.repath = h.state === 'chase' ? 0.35 : 1; }
  if (!target && (!h.path || h.pi >= h.path.length)) {
    // patrol: walk to food on the street (or a random street cell)
    const on = g.food.filter((f) => f.on && f.bites > 0);
    const pick = on.length && g.rng() < 0.7 ? on[Math.floor(g.rng() * on.length)] : null;
    const goal = pick ? nearestWalk(cellAt(pick.x, pick.y)) : walkCells[Math.floor(g.rng() * walkCells.length)];
    const a = cellAt(h.x, h.y); h.path = a >= 0 ? path(a, goal) : null; h.pi = 0;
    if (h.path && h.path.length > 70) h.path.length = 70;
  }
  if (h.path && h.pi < h.path.length) {
    const c = h.path[h.pi]; const tx = cx(c); const ty = cy(c); const ex = tx - h.x; const ey = ty - h.y; const el = Math.hypot(ex, ey);
    if (el < 0.15) h.pi++;
    else {
      const st = Math.min(el, speed * dt); h.x += (ex / el) * st; h.y += (ey / el) * st;
      if (h.state !== 'chase') h.ang = turn(h.ang, Math.atan2(ey, ex) + Math.sin(g.time * 1.7 + h.wob) * 0.55, dt * 4);
    }
  } else if (h.state === 'chase' && target) { // straight in when close
    const ex = target.x - h.x; const ey = target.y - h.y; const el = Math.hypot(ex, ey); if (el > 0.05) { h.x += (ex / el) * Math.min(el, speed * dt); h.y += (ey / el) * Math.min(el, speed * dt); }
  }
}
const turn = (a, b, k) => { let d = b - a; d = Math.atan2(Math.sin(d), Math.cos(d)); return a + d * Math.min(1, k); };

function updateCar(c, dt) {
  const g = game; const r = g.rat;
  if (c.wait > 0) { c.wait -= dt; c.x = -99; return; }
  c.pos += c.speed * dt;
  if (c.pos >= c.lane.cells.length - 1) { Object.assign(c, newCar(g.rng, c.truck)); if (c.truck) c.wait = 6 + g.rng() * 10; return; }
  const k = Math.floor(c.pos); const f = c.pos - k; const a = c.lane.cells[k]; const b = c.lane.cells[Math.min(k + 1, c.lane.cells.length - 1)];
  const k2 = Math.min(k + 3, c.lane.cells.length - 1); const ahead = c.lane.cells[k2];
  c.x = lerp(cx(a), cx(b), f); c.y = lerp(cy(a), cy(b), f);
  const ta = Math.atan2(cy(ahead) - cy(a), cx(ahead) - cx(a)); c.ang = turn(c.ang || ta, ta, dt * 6);
  if (c.truck) {
    if (!c.said) { c.said = true; toast(`🚛 ${T('truckMsg')}`); }
    for (const f2 of g.food) if (f2.on && f2.bites > 0 && f2.kind !== 'basket' && f2.kind !== 'better' && Math.hypot(f2.x - c.x, f2.y - c.y) < 2.2) { f2.bites = 0; burst(f2.x, f2.y, '#8a8aa8', 6); }
  }
  const d = Math.hypot(r.x - c.x, r.y - c.y);
  if (d < 5 && r.onRoad && c.honk <= 0) { c.honk = 3; sfx.horn(); }
  c.honk -= dt;
  if (d < (c.truck ? 0.9 : 0.7) && r.diving <= 0 && r.inv <= 0 && !r.home) caught({ kind: 'car', x: c.x, y: c.y });
}

function caught(h) {
  const g = game; const r = g.rat; const kind = h.kind;
  g.hearts--; g.caughtN++; sfx.caught(); g.shake = 1; g.flash = 1;
  bigText(T('caughtBy')[kind]); toast(T('caughtMsg')[kind], 'bad');
  burst(r.x, r.y, '#ff4d5e', 22);
  // the food spills where you were caught
  if (r.carry > 0) g.food.push({ x: r.x, y: r.y, kind: 'bag', bites: r.carry, max: r.carry, at: 0, on: true, name: '' });
  r.carry = 0; r.x = burrow.x; r.y = burrow.y; r.vx = r.vy = 0; r.inv = 2.2; r.stam = 1;
  for (const o of g.ins) { if (o.state === 'chase') { o.state = 'patrol'; o.path = null; } o.meter = 0; if (o.kind === 'cat') o.tired = 3; }
  if (g.hearts <= 0) setTimeout(() => gameOver(), 700), mode = 'dying';
}

function endNight() {
  const g = game; const r = g.rat;
  if (!r.home && r.carry > 0) { toast(T('lostCarry'), 'bad'); r.carry = 0; }
  const ok = g.banked >= g.spec.quota;
  if (ok) { sfx.win(); g.score += Math.round(100 * (g.banked / g.spec.quota) * g.night); showCard('summary'); } else { sfx.lose(); gameOver(); }
}
function gameOver() {
  mode = 'over'; const best = store.get('ratrun.best', { score: 0, night: 0 }); const isBest = game.score > best.score;
  if (isBest) store.set('ratrun.best', { score: game.score, night: game.night });
  showCard('over', isBest);
}

// ---------------------------------------------------------------------------------- actions
function sniff() {
  const g = game; if (!g || mode !== 'play' || g.sniffCool > 0) return;
  g.sniffCool = g.p.sniffCd; g.sniffT = 4; sfx.sniff();
  const r = g.rat; const R2 = g.p.sniffR;
  g.ping = g.food.filter((f) => f.on && f.bites > 0 && f.kind !== 'better' && Math.hypot(f.x - r.x, f.y - r.y) < R2).sort((a, b) => Math.hypot(a.x - r.x, a.y - r.y) - Math.hypot(b.x - r.x, b.y - r.y)).slice(0, 4).map((f) => ({ f, life: 4 }));
  for (const p of g.ping) p.f.known = true;
  g.parts.push({ ring: true, x: r.x, y: r.y, life: 0.9, max: 0.9, R: R2 });
  if (!g.ping.length) floatText(r.x, r.y - 0.9, '…', '#a9a0cf');
}
function dive() {
  const g = game; if (!g || mode !== 'play') return; const r = g.rat;
  if (r.diving > 0 || r.diveCool > 0) return;
  const here = grates.find((q) => Math.hypot(q.x - r.x, q.y - r.y) < 1.1); if (!here) return;
  // pop out at a grate in the direction you're facing (or a random one)
  const opts = grates.filter((q) => q !== here);
  let best = null; let bs = -1e9;
  for (const q of opts) { const a = Math.atan2(q.y - r.y, q.x - r.x); const d = Math.hypot(q.x - r.x, q.y - r.y); const s = Math.cos(a - r.ang) * 2 - d / 40 + g.rng() * 0.6; if (s > bs) { bs = s; best = q; } }
  r.diving = 0.7; r.diveTo = best; r.diveCool = 2.5; r.vx = r.vy = 0; sfx.dive(); burst(r.x, r.y, '#43e6c5', 10);
}

// ---------------------------------------------------------------------------------- fx helpers
function burst(x, y, c, n) { for (let k = 0; k < n; k++) { const a = Math.random() * TAU; const s = 1 + Math.random() * 4; game.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.5 + Math.random() * 0.4, max: 0.9, c, s: 0.09 + Math.random() * 0.08 }); } }
function crumbs(x, y) { for (let k = 0; k < 4; k++) { const a = Math.random() * TAU; game.parts.push({ x, y, vx: Math.cos(a) * 2, vy: Math.sin(a) * 2 - 1, life: 0.35, max: 0.35, c: '#ffcf3f', s: 0.07 }); } }
function floatText(x, y, text, c, life = 1) { game.floats.push({ x, y, text, c, life, max: life }); }
function bigText(text) { toast(text, 'big'); }
function toast(text, cls = '') { const el = document.createElement('div'); el.className = `toast ${cls}`; el.textContent = text; $('toasts').appendChild(el); setTimeout(() => el.remove(), 3200); while ($('toasts').children.length > 3) $('toasts').firstChild.remove(); }
const niceName = (s) => (s || '').replace(/\b(llc|inc|corp)\.?\b/gi, '').replace(/\s+/g, ' ').trim().replace(/\b\w+/g, (w) => (w.length > 2 && w === w.toUpperCase() ? w[0] + w.slice(1).toLowerCase() : w));

// ---------------------------------------------------------------------------------- draw
let camX = 0; let camY = 0;
function render() {
  const g = game; const r = g.rat;
  const tx = r.diving > 0 && r.diveTo ? lerp(r.x, r.diveTo.x, 1 - r.diving / 0.7) : r.x; const ty = r.diving > 0 && r.diveTo ? lerp(r.y, r.diveTo.y, 1 - r.diving / 0.7) : r.y;
  const k = r.diving > 0 ? 0.12 : 0.14; camX = lerp(camX, tx + r.vx * 0.25, k); camY = lerp(camY, ty + r.vy * 0.25, k);
  const shake = g.shake * g.shake * 0.35; const sx = (Math.random() - 0.5) * shake; const sy = (Math.random() - 0.5) * shake;
  const setT = (c) => c.setTransform(Z * dpr, 0, 0, Z * dpr, (SW / 2 - (camX + sx) * Z) * dpr, (SH / 2 - (camY + sy) * Z) * dpr);
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#07061a'; ctx.fillRect(0, 0, view.width, view.height);
  setT(ctx); ctx.imageSmoothingEnabled = true; ctx.drawImage(world, 0, 0, W, H);
  const t = g.time;
  const vx0 = camX - SW / Z / 2 - 2; const vx1 = camX + SW / Z / 2 + 2; const vy0 = camY - SH / Z / 2 - 2; const vy1 = camY + SH / Z / 2 + 4;
  const onScreen = (x, y) => x > vx0 && x < vx1 && y > vy0 && y < vy1;

  // burrow
  drawBurrow(burrow.x, burrow.y, t, r.carry > 0);
  // grates
  for (const q of grates) if (onScreen(q.x, q.y)) drawGrate(q, t, Math.hypot(q.x - r.x, q.y - r.y) < 1.1 && r.diveCool <= 0);
  // food
  for (const f of g.food) if (f.on && onScreen(f.x, f.y)) drawFood(f, t);
  // cars
  for (const c of g.cars) if (c.x > -50 && onScreen(c.x, c.y)) drawCar(c);
  // hunters
  for (const h of g.ins) if (onScreen(h.x, h.y)) (h.kind === 'cat' ? drawCat(h, t) : drawInspector(h, t));
  // rat
  if (r.diving <= 0) drawRat(r, t);
  // particles
  for (const p of g.parts) {
    if (p.ring) { const q = 1 - p.life / p.max; ctx.strokeStyle = `rgba(67,230,197,${0.6 * (1 - q)})`; ctx.lineWidth = 0.12; ctx.beginPath(); ctx.arc(p.x, p.y, p.R * q, 0, TAU); ctx.stroke(); continue; }
    ctx.globalAlpha = clamp(p.life / p.max, 0, 1); ctx.fillStyle = p.c; ctx.beginPath(); ctx.arc(p.x, p.y, p.s, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
  }

  // darkness, with holes for the rat's eyes, flashlights and headlights
  const dawn = clamp((g.t - 0.85) / 0.15, 0, 1);
  dctx.globalCompositeOperation = 'source-over'; dctx.setTransform(1, 0, 0, 1, 0, 0);
  dctx.fillStyle = 'rgba(6,4,22,1)'; dctx.globalAlpha = 0.9 - dawn * 0.55; dctx.fillRect(0, 0, dark.width, dark.height); dctx.globalAlpha = 1;
  setT(dctx); dctx.imageSmoothingEnabled = true; dctx.clearRect(0, 0, W, H);
  dctx.globalAlpha = 1 - dawn * 0.65; dctx.drawImage(darkMap, 0, 0, W, H); dctx.globalAlpha = 1;
  dctx.globalCompositeOperation = 'destination-out';
  hole(dctx, tx, ty, 6 * g.p.vision, 1);
  hole(dctx, burrow.x, burrow.y, 2.2, 0.6);
  for (const h of g.ins) if (h.kind === 'ins' && onScreen(h.x, h.y)) cone(dctx, h.x, h.y, h.ang, 9.5, 0.62, 1);
  for (const c of g.cars) if (c.x > -50 && onScreen(c.x, c.y)) cone(dctx, c.x + Math.cos(c.ang) * 0.6, c.y + Math.sin(c.ang) * 0.6, c.ang, 6, 0.35, 0.8);
  dctx.globalCompositeOperation = 'source-over';
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(dark, 0, 0);
  // warm flashlight beams on top
  setT(ctx); ctx.globalCompositeOperation = 'lighter';
  for (const h of g.ins) if (h.kind === 'ins' && onScreen(h.x, h.y)) { const col = h.state === 'chase' ? '255,90,90' : '255,226,140'; coneFill(ctx, h.x, h.y, h.ang, 9.5, 0.62, `rgba(${col},0.22)`); }
  ctx.globalCompositeOperation = 'source-over';
  // things that should read above the dark
  for (const h of g.ins) if (onScreen(h.x, h.y)) drawAwareness(h, t);
  for (const p of g.ping) { const f = p.f; if (f.bites <= 0) continue; const a = clamp(p.life, 0, 1); ctx.strokeStyle = `rgba(255,207,63,${a})`; ctx.lineWidth = 0.1; ctx.beginPath(); ctx.arc(f.x, f.y, 0.9 + Math.sin(t * 6) * 0.15, 0, TAU); ctx.stroke(); }
  if (r.diving <= 0 && r.carry > 0) drawCarry(r);
  for (const f of g.floats) { ctx.globalAlpha = clamp(f.life / f.max * 1.5, 0, 1); ctx.font = `800 ${0.75}px Inter, sans-serif`; ctx.textAlign = 'center'; ctx.lineWidth = 0.15; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.strokeText(f.text, f.x, f.y); ctx.fillStyle = f.c; ctx.fillText(f.text, f.x, f.y); ctx.globalAlpha = 1; }

  // screen-space: edge arrows to home and sniffed food, damage flash
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (!onScreen(burrow.x, burrow.y) || Math.abs(burrow.x - camX) > SW / Z / 2 - 1 || Math.abs(burrow.y - camY) > SH / Z / 2 - 1) edgeArrow(burrow.x, burrow.y, r.carry >= g.p.cap ? '#ffcf3f' : '#ff9a5a', '🏠', r.carry >= g.p.cap);
  for (const p of g.ping) if (p.f.bites > 0) { const sxp = (p.f.x - camX) * Z + SW / 2; const syp = (p.f.y - camY) * Z + SH / 2; if (sxp < 30 || sxp > SW - 30 || syp < 70 || syp > SH - 30) edgeArrow(p.f.x, p.f.y, '#43e6c5', p.f.kind === 'pizza' ? '🍕' : p.f.kind === 'crate' ? '🥬' : '🗑️'); }
  if (g.flash > 0) { ctx.fillStyle = `rgba(255,40,70,${g.flash * 0.35})`; ctx.fillRect(0, 0, SW, SH); }
  const vig = ctx.createRadialGradient(SW / 2, SH / 2, Math.min(SW, SH) * 0.35, SW / 2, SH / 2, Math.max(SW, SH) * 0.75); vig.addColorStop(0, 'rgba(0,0,0,0)'); vig.addColorStop(1, 'rgba(0,0,0,.5)'); ctx.fillStyle = vig; ctx.fillRect(0, 0, SW, SH);
}
function hole(c, x, y, rad, a) { const gg = c.createRadialGradient(x, y, 0, x, y, rad); gg.addColorStop(0, `rgba(0,0,0,${a})`); gg.addColorStop(0.55, `rgba(0,0,0,${a * 0.65})`); gg.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = gg; c.beginPath(); c.arc(x, y, rad, 0, TAU); c.fill(); }
function cone(c, x, y, ang, len, half, a) { const gg = c.createRadialGradient(x, y, 0, x, y, len); gg.addColorStop(0, `rgba(0,0,0,${a})`); gg.addColorStop(0.7, `rgba(0,0,0,${a * 0.6})`); gg.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = gg; c.beginPath(); c.moveTo(x, y); c.arc(x, y, len, ang - half, ang + half); c.closePath(); c.fill(); }
function coneFill(c, x, y, ang, len, half, col) { const gg = c.createRadialGradient(x, y, 0, x, y, len); gg.addColorStop(0, col); gg.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = gg; c.beginPath(); c.moveTo(x, y); c.arc(x, y, len, ang - half, ang + half); c.closePath(); c.fill(); }

function edgeArrow(wx, wy, col, icon, pulse = false) {
  const x = (wx - camX) * Z + SW / 2; const y = (wy - camY) * Z + SH / 2; const a = Math.atan2(y - SH / 2, x - SW / 2);
  const m = 34; const top = 78; const ex = clamp(x, m, SW - m); const ey = clamp(y, top, SH - m);
  const s = pulse ? 1 + Math.sin(performance.now() / 120) * 0.12 : 1;
  ctx.save(); ctx.translate(ex, ey); ctx.scale(s, s);
  ctx.fillStyle = 'rgba(11,9,32,.85)'; ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, 16, 0, TAU); ctx.fill(); ctx.stroke();
  ctx.rotate(a); ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(24, 0); ctx.lineTo(16, -6); ctx.lineTo(16, 6); ctx.closePath(); ctx.fill(); ctx.rotate(-a);
  ctx.font = '15px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(icon, 0, 1); ctx.restore();
}

function drawBurrow(x, y, t, beckon) {
  ctx.fillStyle = '#4a2e22'; ctx.beginPath(); ctx.ellipse(x, y + 0.1, 1.1, 0.8, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = '#6b4330'; ctx.beginPath(); ctx.ellipse(x, y, 0.95, 0.65, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = '#120a08'; ctx.beginPath(); ctx.ellipse(x, y + 0.05, 0.5, 0.36, 0, 0, TAU); ctx.fill();
  if (beckon) { ctx.strokeStyle = `rgba(255,207,63,${0.5 + Math.sin(t * 5) * 0.3})`; ctx.lineWidth = 0.08; ctx.beginPath(); ctx.arc(x, y, 1.3 + Math.sin(t * 5) * 0.1, 0, TAU); ctx.stroke(); }
}
function drawGrate(q, t, near) {
  ctx.fillStyle = '#0d0c1c'; ctx.fillRect(q.x - 0.55, q.y - 0.4, 1.1, 0.8);
  ctx.strokeStyle = near ? '#43e6c5' : '#5d5a86'; ctx.lineWidth = 0.07; ctx.strokeRect(q.x - 0.55, q.y - 0.4, 1.1, 0.8);
  for (let k = -2; k <= 2; k++) { ctx.beginPath(); ctx.moveTo(q.x + k * 0.2, q.y - 0.36); ctx.lineTo(q.x + k * 0.2, q.y + 0.36); ctx.stroke(); }
  if (q.subway) { ctx.fillStyle = '#2bb673'; ctx.beginPath(); ctx.arc(q.x + 0.75, q.y - 0.55, 0.28, 0, TAU); ctx.fill(); ctx.fillStyle = '#fff'; ctx.font = '800 0.34px Inter'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('M', q.x + 0.75, q.y - 0.53); }
  if (near) { ctx.strokeStyle = `rgba(67,230,197,${0.5 + Math.sin(t * 8) * 0.4})`; ctx.beginPath(); ctx.arc(q.x, q.y, 0.95, 0, TAU); ctx.stroke(); }
}
function drawFood(f, t) {
  const x = f.x; const y = f.y; const empty = f.bites <= 0; const s = (f.pop ? 1 + (f.pop = Math.max(0, f.pop - 0.05)) * 0.6 : 1) * (f.wig ? 1 + Math.sin((f.wig -= 0.016) * 60) * 0.06 : 1);
  if (f.wig < 0) f.wig = 0;
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  if (f.kind === 'better') { ctx.fillStyle = '#2d6b4f'; ctx.fillRect(-0.32, -0.38, 0.64, 0.76); ctx.fillStyle = '#8fe0b6'; ctx.fillRect(-0.32, -0.38, 0.64, 0.12); ctx.fillStyle = '#d9fbe8'; ctx.font = '0.4px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('🔒', 0, 0.08); ctx.restore(); return; }
  if (f.kind === 'basket') { ctx.fillStyle = empty ? '#3a3a52' : '#56567a'; ctx.beginPath(); ctx.arc(0, 0, 0.36, 0, TAU); ctx.fill(); ctx.strokeStyle = '#8888b0'; ctx.lineWidth = 0.05; ctx.stroke(); if (!empty) { ctx.fillStyle = '#ffcf3f'; ctx.beginPath(); ctx.arc(0.08, -0.05, 0.12, 0, TAU); ctx.fill(); } }
  else if (f.kind === 'pizza') { ctx.rotate(0.2); ctx.fillStyle = empty ? '#5a4a40' : '#f2efe6'; ctx.fillRect(-0.45, -0.45, 0.9, 0.9); ctx.fillStyle = empty ? '#3a2a20' : '#e84a3c'; ctx.fillRect(-0.45, -0.45, 0.9, 0.16); if (!empty) { ctx.fillStyle = '#ffcf3f'; ctx.beginPath(); ctx.moveTo(-0.15, 0.3); ctx.lineTo(0.3, 0.05); ctx.lineTo(0.05, -0.2); ctx.closePath(); ctx.fill(); ctx.fillStyle = '#c0392b'; ctx.beginPath(); ctx.arc(0.06, 0.05, 0.06, 0, TAU); ctx.fill(); } }
  else if (f.kind === 'crate') { ctx.fillStyle = empty ? '#4a3a2a' : '#9a6b3a'; ctx.fillRect(-0.45, -0.38, 0.9, 0.76); ctx.strokeStyle = '#5e3f1f'; ctx.lineWidth = 0.06; ctx.strokeRect(-0.45, -0.38, 0.9, 0.76); if (!empty) { ['#6fdc5a', '#ff7a3c', '#ffcf3f', '#e04a6a'].forEach((c, k) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(-0.25 + k * 0.17, -0.12 + (k % 2) * 0.12, 0.11, 0, TAU); ctx.fill(); }); } }
  else { // bag
    const fill = empty ? 0.6 : 0.8 + 0.2 * (f.bites / f.max);
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(0.06, 0.12, 0.42 * fill, 0.3, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = empty ? '#24242f' : '#2b2b36'; ctx.beginPath(); ctx.ellipse(0, 0, 0.42 * fill, 0.36 * fill, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.beginPath(); ctx.ellipse(-0.12, -0.12, 0.12, 0.07, -0.6, 0, TAU); ctx.fill();
    ctx.fillStyle = '#ffcf3f'; ctx.fillRect(-0.06, -0.42 * fill, 0.12, 0.1);
    if (empty) { ctx.strokeStyle = '#555'; ctx.lineWidth = 0.04; ctx.beginPath(); ctx.moveTo(-0.2, 0); ctx.lineTo(0.1, 0.15); ctx.stroke(); }
  }
  ctx.restore();
  if (!empty && f.kind !== 'better') { // smell squiggles
    ctx.strokeStyle = f.known ? 'rgba(255,207,63,.75)' : 'rgba(180,230,140,.45)'; ctx.lineWidth = 0.05;
    for (let k = 0; k < 2; k++) { const ph = (t * 0.8 + k * 0.5 + (x * 0.37) % 1) % 1; ctx.globalAlpha = 1 - ph; ctx.beginPath(); for (let s2 = 0; s2 <= 8; s2++) { const yy = y - 0.4 - ph * 1.2 - s2 * 0.06; const xx = x - 0.15 + k * 0.3 + Math.sin(s2 * 0.9 + t * 4 + k) * 0.08; s2 ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy); } ctx.stroke(); }
    ctx.globalAlpha = 1;
  }
}
function drawRat(r, t) {
  const blink = r.inv > 0 && Math.sin(t * 30) > 0; if (blink) ctx.globalAlpha = 0.45;
  ctx.save(); ctx.translate(r.x, r.y); ctx.rotate(r.ang); ctx.scale(1.4, 1.4);
  const run = Math.sin(r.step * 2.2); const sz = 1 + r.carry * 0.03;
  ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(0.05, 0.08, 0.42, 0.24, 0, 0, TAU); ctx.fill();
  // tail
  ctx.strokeStyle = '#e89aa8'; ctx.lineWidth = 0.07; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(-0.3, 0);
  for (let k = 1; k <= 6; k++) ctx.lineTo(-0.3 - k * 0.11, Math.sin(t * 9 - k * 0.8) * 0.06 * k * 0.5 + run * 0.02 * k);
  ctx.stroke();
  // feet
  ctx.fillStyle = '#e89aa8'; for (const [fx, fy, ph] of [[0.18, 0.17, 0], [0.18, -0.17, Math.PI], [-0.18, 0.18, Math.PI], [-0.18, -0.18, 0]]) { ctx.beginPath(); ctx.arc(fx + Math.sin(r.step * 2.2 + ph) * 0.06, fy, 0.055, 0, TAU); ctx.fill(); }
  // body
  ctx.fillStyle = '#8a7f9e'; ctx.beginPath(); ctx.ellipse(-0.02, 0, 0.36 * sz, 0.22 * sz, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = '#a69bbd'; ctx.beginPath(); ctx.ellipse(0.02, -0.05, 0.26 * sz, 0.12 * sz, 0, 0, TAU); ctx.fill();
  // head
  ctx.fillStyle = '#8a7f9e'; ctx.beginPath(); ctx.ellipse(0.32, 0, 0.18, 0.14 + r.carry * 0.012, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = '#ff9fb2'; ctx.beginPath(); ctx.arc(0.5, 0, 0.045, 0, TAU); ctx.fill();
  // ears
  for (const s of [-1, 1]) { ctx.fillStyle = '#8a7f9e'; ctx.beginPath(); ctx.arc(0.24, s * 0.15, 0.09, 0, TAU); ctx.fill(); ctx.fillStyle = '#ffb3c1'; ctx.beginPath(); ctx.arc(0.24, s * 0.15, 0.05, 0, TAU); ctx.fill(); }
  // eyes
  for (const s of [-1, 1]) { ctx.fillStyle = '#0b0920'; ctx.beginPath(); ctx.arc(0.38, s * 0.075, 0.035, 0, TAU); ctx.fill(); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0.39, s * 0.075 - 0.012, 0.012, 0, TAU); ctx.fill(); }
  // whiskers
  ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 0.015; for (const s of [-1, 1]) for (const k of [0, 1]) { ctx.beginPath(); ctx.moveTo(0.46, s * 0.03); ctx.lineTo(0.62, s * (0.08 + k * 0.07)); ctx.stroke(); }
  ctx.restore(); ctx.globalAlpha = 1;
}
function drawCarry(r) {
  for (let k = 0; k < r.carry; k++) { const a = -Math.PI / 2 + (k - (r.carry - 1) / 2) * 0.32; ctx.fillStyle = '#ffcf3f'; ctx.strokeStyle = '#8a5a00'; ctx.lineWidth = 0.03; ctx.beginPath(); ctx.arc(r.x + Math.cos(a) * 0.7, r.y + Math.sin(a) * 0.7, 0.1, 0, TAU); ctx.fill(); ctx.stroke(); }
}
function drawInspector(h, t) {
  ctx.save(); ctx.translate(h.x, h.y); ctx.scale(1.2, 1.2);
  ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.beginPath(); ctx.ellipse(0.08, 0.12, 0.5, 0.36, 0, 0, TAU); ctx.fill();
  ctx.rotate(h.ang);
  ctx.fillStyle = '#2f6fd6'; ctx.beginPath(); ctx.ellipse(0, 0, 0.32, 0.46, 0, 0, TAU); ctx.fill(); // shoulders
  ctx.fillStyle = '#d7ff3f'; ctx.fillRect(-0.06, -0.44, 0.1, 0.88); // hi-vis stripe
  ctx.fillStyle = '#c98a5c'; ctx.beginPath(); ctx.arc(0.04, 0, 0.22, 0, TAU); ctx.fill(); // head
  ctx.fillStyle = '#1b2f5a'; ctx.beginPath(); ctx.arc(0.0, 0, 0.21, Math.PI * 0.5, Math.PI * 1.5); ctx.fill(); ctx.fillRect(0.0, -0.2, 0.28, 0.4); // cap
  ctx.fillStyle = '#ddd'; ctx.fillRect(0.3, 0.26, 0.24, 0.1); // flashlight
  ctx.restore();
}
function drawCat(h, t) {
  ctx.save(); ctx.translate(h.x, h.y); ctx.rotate(h.ang); ctx.scale(1.2, 1.2); const run = h.state === 'chase' ? Math.sin(t * 20) : Math.sin(t * 6) * 0.4;
  ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(0.05, 0.1, 0.55, 0.3, 0, 0, TAU); ctx.fill();
  ctx.strokeStyle = '#e8892e'; ctx.lineWidth = 0.12; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(-0.4, 0); ctx.quadraticCurveTo(-0.7, run * 0.3, -0.85, 0.2 + run * 0.2); ctx.stroke();
  ctx.fillStyle = '#f0a040'; ctx.beginPath(); ctx.ellipse(-0.05, 0, 0.45, 0.26, 0, 0, TAU); ctx.fill();
  ctx.strokeStyle = '#c86a1a'; ctx.lineWidth = 0.06; for (const k of [-0.2, 0, 0.2]) { ctx.beginPath(); ctx.moveTo(k, -0.24); ctx.lineTo(k + 0.05, 0.24); ctx.stroke(); }
  ctx.fillStyle = '#f0a040'; ctx.beginPath(); ctx.arc(0.42, 0, 0.22, 0, TAU); ctx.fill();
  for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(0.38, s * 0.12); ctx.lineTo(0.5, s * 0.3); ctx.lineTo(0.56, s * 0.1); ctx.fill(); }
  const glow = h.state === 'chase' ? '#ff4d5e' : '#b6ff5a'; for (const s of [-1, 1]) { ctx.fillStyle = glow; ctx.beginPath(); ctx.ellipse(0.52, s * 0.08, 0.05, 0.035, 0, 0, TAU); ctx.fill(); }
  ctx.restore();
}
function drawCar(c) {
  ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.ang);
  const L = c.truck ? 1.6 : 1.1; const Wd = c.truck ? 0.8 : 0.62;
  ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(-L / 2 + 0.08, -Wd / 2 + 0.12, L, Wd);
  ctx.fillStyle = c.truck ? '#e8e8f0' : c.color; roundRect(-L / 2, -Wd / 2, L, Wd, 0.14); ctx.fill();
  if (c.truck) { ctx.fillStyle = '#2bb673'; ctx.fillRect(-L / 2, -Wd / 2, L * 0.65, Wd); ctx.fillStyle = '#fff'; ctx.font = '800 0.3px Inter'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('DSNY', -0.25, 0.02); }
  else { ctx.fillStyle = 'rgba(20,30,60,.85)'; ctx.fillRect(0.05, -Wd / 2 + 0.07, 0.25, Wd - 0.14); ctx.fillRect(-0.4, -Wd / 2 + 0.08, 0.16, Wd - 0.16); }
  ctx.fillStyle = '#fff6c0'; ctx.fillRect(L / 2 - 0.06, -Wd / 2 + 0.05, 0.06, 0.12); ctx.fillRect(L / 2 - 0.06, Wd / 2 - 0.17, 0.06, 0.12);
  ctx.fillStyle = '#ff3040'; ctx.fillRect(-L / 2, -Wd / 2 + 0.05, 0.05, 0.1); ctx.fillRect(-L / 2, Wd / 2 - 0.15, 0.05, 0.1);
  ctx.restore();
}
function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function drawAwareness(h, t) {
  if (h.state === 'chase' || h.bang > 0) { const b = 1 + Math.max(0, h.bang - 0.9) * 2; ctx.font = `900 ${0.9 * b}px Inter, sans-serif`; ctx.textAlign = 'center'; ctx.lineWidth = 0.14; ctx.strokeStyle = '#000'; ctx.strokeText('!', h.x, h.y - 0.8); ctx.fillStyle = '#ff4d5e'; ctx.fillText('!', h.x, h.y - 0.8); return; }
  if (h.meter > 0.05) { ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(h.x - 0.5, h.y - 0.95, 1, 0.16); ctx.fillStyle = h.meter > 0.66 ? '#ff4d5e' : '#ffcf3f'; ctx.fillRect(h.x - 0.5, h.y - 0.95, Math.min(1, h.meter), 0.16); ctx.font = '800 0.6px Inter'; ctx.textAlign = 'center'; ctx.fillStyle = '#ffcf3f'; ctx.fillText('?', h.x, h.y - 1.1); }
  if (h.kind === 'cat' && h.tired > 0) { ctx.font = '700 0.5px Inter'; ctx.textAlign = 'center'; ctx.fillStyle = '#b8b0e0'; ctx.fillText('z', h.x + 0.3 + Math.sin(t * 2) * 0.1, h.y - 0.7 - (t % 1) * 0.3); }
}

function drawMini() {
  const g = game; const w = mini.width; const h = mini.height; const sx = w / W; const sy = h / H;
  mctx.imageSmoothingEnabled = false; mctx.drawImage(miniBase, 0, 0, w, h);
  if (!g.fog || (g.time * 2 | 0) !== g.fogT) { g.fogT = g.time * 2 | 0; if (!g.fog) { g.fog = document.createElement('canvas'); g.fog.width = W; g.fog.height = H; } const fc = g.fog.getContext('2d'); const img = fc.createImageData(W, H); for (let i = 0; i < city.N; i++) img.data[i * 4 + 3] = explored[i] ? 0 : 200; fc.putImageData(img, 0, 0); }
  mctx.drawImage(g.fog, 0, 0, w, h);
  for (const f of g.food) if (f.on && f.bites > 0 && f.kind !== 'better' && (f.known || explored[cellAt(f.x, f.y)])) { mctx.fillStyle = f.known ? '#ffcf3f' : '#a88a2a'; mctx.fillRect(f.x * sx - 1.5, f.y * sy - 1.5, 3, 3); }
  for (const q of grates) { mctx.fillStyle = '#43e6c5'; mctx.fillRect(q.x * sx - 1, q.y * sy - 1, 2, 2); }
  for (const hh of g.ins) if (explored[cellAt(hh.x, hh.y)] && Math.hypot(hh.x - g.rat.x, hh.y - g.rat.y) < 14) { mctx.fillStyle = hh.state === 'chase' ? '#ff4d5e' : '#6fa0ff'; mctx.beginPath(); mctx.arc(hh.x * sx, hh.y * sy, 2.5, 0, TAU); mctx.fill(); }
  mctx.fillStyle = '#ff9a5a'; mctx.beginPath(); mctx.arc(burrow.x * sx, burrow.y * sy, 4, 0, TAU); mctx.fill();
  mctx.fillStyle = '#fff'; mctx.beginPath(); mctx.arc(g.rat.x * sx, g.rat.y * sy, 3, 0, TAU); mctx.fill();
}

// ---------------------------------------------------------------------------------- HUD + cards
function hud() {
  const g = game; const r = g.rat;
  $('h-night').textContent = g.night; $('h-score').textContent = g.score;
  const mins = 19 * 60 + Math.floor(g.t * 600); $('h-clock').textContent = `${String(Math.floor(mins / 60) % 24).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  $('h-clockbar').style.width = `${g.t * 100}%`;
  $('h-bank').textContent = g.banked; $('h-quota').textContent = g.spec.quota; $('h-qbar').style.width = `${Math.min(100, (g.banked / g.spec.quota) * 100)}%`;
  document.querySelector('.quota').classList.toggle('met', g.quotaMet);
  const hearts = `${'<span>❤️</span>'.repeat(Math.max(0, g.hearts))}${'<span class="lost">❤️</span>'.repeat(Math.max(0, g.maxHearts - g.hearts))}`;
  if ($('h-hearts').dataset.v !== hearts) { $('h-hearts').innerHTML = hearts; $('h-hearts').dataset.v = hearts; }
  const pips = `${r.carry}/${g.p.cap}`; if ($('h-carry').dataset.v !== pips) { $('h-carry').innerHTML = Array.from({ length: g.p.cap }, (_, k) => `<i class="${k < r.carry ? 'full' : ''}"></i>`).join(''); $('h-carry').dataset.v = pips; }
  $('h-stam').style.width = `${r.stam * 100}%`; $('h-stam').classList.toggle('low', r.stam < 0.25);
  const nearG = r.diving <= 0 && grates.some((q) => Math.hypot(q.x - r.x, q.y - r.y) < 1.1) && r.diveCool <= 0;
  const hint = nearG ? T('grateHint') : '';
  if ($('hint').textContent !== hint) { $('hint').textContent = hint; $('hint').hidden = !hint; }
  $('t-sniff').classList.toggle('cool', g.sniffCool > 0); $('t-dive').classList.toggle('cool', !nearG);
}

function setPlaying(on) {
  for (const id of ['hud', 'cheeks', 'mini']) $(id).hidden = !on;
  $('touch').hidden = !on || !isTouch;
}
function showCard(kind, extra) {
  const g = game; const c = $('card'); const sp = g?.spec; let html = '';
  if (kind === 'intro') {
    mode = 'card';
    const threats = [`👮 ${T('inspectors')(sp.inspectors)}`, `🚗 ${T('cars')}`]; if (sp.truck) threats.push(`🚛 ${T('truck')}`); if (sp.cats) threats.push(`🐈 ${T('cat')}`);
    html = `<p class="kicker">${T('night')} ${g.night} · 19:00</p><h2>${T('nightTitle')(g.night)}</h2>
      <div class="goal">🧀 <span>${T('goal')}</span> <b>${sp.quota}</b> <span>${T('bites')}</span></div>
      <p><b>${T('newThreats')}</b><br>${threats.join('<br>')}</p>
      <button class="go" id="c-go">${T('go')}</button>`;
  } else if (kind === 'summary') {
    mode = 'card'; const ratio = g.banked / sp.quota; const stars = ratio >= 2 ? 3 : ratio >= 1.5 ? 2 : 1;
    const offer = shuffle(PERK_IDS.filter((p) => !(p === 'heart' && g.maxHearts >= 6))).slice(0, 3);
    html = `<p class="kicker">🌅 ${T('dawn')} · 05:00</p><h2>${T('made')}</h2>
      <div class="stars">${[1, 2, 3].map((k) => `<span class="${k <= stars ? '' : 'dim'}">⭐</span>`).join('')}</div>
      <div class="stats"><div><b>${g.banked}</b><span>${T('stashed')}</span></div><div><b>${g.caughtN}</b><span>${T('caught')}</span></div><div><b>${Math.round(g.dist * 6)}</b><span>${T('km')}</span></div></div>
      <p class="kicker">${T('pick')}</p>
      <div class="perks">${offer.map((p) => `<button class="perk" data-perk="${p}"><span class="pi">${PERK_ICON[p]}</span><span><b>${T('perks')[p][0]}</b><span>${T('perks')[p][1]}</span></span></button>`).join('')}</div>`;
  } else if (kind === 'over') {
    const best = store.get('ratrun.best', { score: 0, night: 0 });
    html = `<p class="kicker">${g.hearts <= 0 ? '💀' : '🌅'} ${g.hearts <= 0 ? '' : T('short')}</p><h2>${T('over')}</h2>
      <p>${T('overLead')(g.score, g.night)} ${extra ? `<b style="color:var(--cheese)">${T('newBest')}</b>` : ''}</p>
      <div class="stats"><div><b>${g.score}</b><span>${T('pts')}</span></div><div><b>${g.totalBanked}</b><span>${T('stashed')}</span></div><div><b>${best.score}</b><span>best</span></div></div>
      <button class="go" id="c-retry">${T('retry')}</button><button class="go alt" id="c-title">${T('title')}</button>`;
  } else if (kind === 'pause') {
    mode = 'pause';
    html = `<h2>${T('paused')}</h2><button class="go" id="c-resume">${T('resume')}</button><button class="go alt" id="c-title">${T('quit')}</button>`;
  }
  c.innerHTML = html; $('s-card').hidden = false; setPlaying(kind === 'pause');
  $('c-go')?.addEventListener('click', () => { sfx.click(); $('s-card').hidden = true; mode = 'play'; setPlaying(true); camX = game.rat.x; camY = game.rat.y; toast(`🌙 ${T('nightTitle')(game.night)}`, 'big'); last = performance.now(); });
  $('c-resume')?.addEventListener('click', resume);
  $('c-retry')?.addEventListener('click', () => { sfx.click(); newGame(); startNight(); });
  $('c-title')?.addEventListener('click', () => { sfx.click(); $('s-card').hidden = true; mode = 'title'; setPlaying(false); $('s-title').hidden = false; showBest(); });
  for (const b of c.querySelectorAll('[data-perk]')) b.addEventListener('click', () => { sfx.click(); applyPerk(b.dataset.perk); startNight(); });
  c.querySelector('button')?.focus({ preventScroll: true });
}
function applyPerk(p) {
  const P = game.p;
  if (p === 'speed') P.speed *= 1.12; else if (p === 'cap') P.cap += 2; else if (p === 'vision') P.vision *= 1.3;
  else if (p === 'heart') { game.maxHearts = Math.min(6, game.maxHearts + 1); game.hearts = Math.min(game.maxHearts, game.hearts + 1); }
  else if (p === 'sniff') { P.sniffR *= 1.5; P.sniffCd = Math.max(2.5, P.sniffCd - 1.5); } else if (p === 'stealth') P.stealth *= 0.75; else if (p === 'stamina') P.stamina *= 1.5;
}
function shuffle(a) { for (let k = a.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [a[k], a[j]] = [a[j], a[k]]; } return a; }
function pause() { if (mode === 'play') showCard('pause'); }
function resume() { sfx.click(); $('s-card').hidden = true; mode = 'play'; setPlaying(true); last = performance.now(); }
function showBest() { const b = store.get('ratrun.best', null); $('best').textContent = b && b.score ? T('best')(b.score, b.night) : ''; }

// ---------------------------------------------------------------------------------- input
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
window.addEventListener('keydown', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  keys.add(e.code); audio();
  if (mode === 'play') {
    if (e.code === 'KeyE') sniff(); if (e.code === 'Space') dive();
    if (e.code === 'KeyP' || e.code === 'Escape') pause();
  } else if (mode === 'pause' && (e.code === 'KeyP' || e.code === 'Escape')) resume();
  if (e.code === 'KeyM') toggleMute();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => { keys.clear(); pause(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
function toggleMute() { muted = !muted; store.set('ratrun.muted', muted); $('b-mute').classList.toggle('off', muted); }
$('b-mute').addEventListener('click', toggleMute); $('b-pause').addEventListener('click', pause);
$('t-sniff').addEventListener('pointerdown', (e) => { e.preventDefault(); sniff(); });
$('t-dive').addEventListener('pointerdown', (e) => { e.preventDefault(); dive(); });
$('t-dash').addEventListener('pointerdown', (e) => { e.preventDefault(); joy.dash = true; });
for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) $('t-dash').addEventListener(ev, () => { joy.dash = false; });
{ // joystick: anywhere on the left half of the screen
  let id = null; let ox = 0; let oy = 0; const stick = $('stick'); const knob = $('knob');
  view.addEventListener('pointerdown', (e) => {
    if (mode !== 'play' || e.pointerType === 'mouse' || e.clientX > SW * 0.6) return;
    id = e.pointerId; ox = e.clientX; oy = e.clientY; joy.on = true; joy.x = joy.y = 0;
    stick.style.left = `${ox - 60}px`; stick.style.top = `${oy - 60}px`; stick.style.bottom = 'auto';
  });
  view.addEventListener('pointermove', (e) => {
    if (e.pointerId !== id) return; let dx = e.clientX - ox; let dy = e.clientY - oy; const l = Math.hypot(dx, dy); const m = 46;
    if (l > m) { dx = (dx / l) * m; dy = (dy / l) * m; } joy.x = dx / m; joy.y = dy / m; knob.style.transform = `translate(${dx}px, ${dy}px)`;
  });
  const up = (e) => { if (e.pointerId !== id) return; id = null; joy.on = false; joy.x = joy.y = 0; knob.style.transform = ''; stick.style.left = ''; stick.style.top = ''; stick.style.bottom = ''; };
  view.addEventListener('pointerup', up); view.addEventListener('pointercancel', up);
}
for (const b of document.querySelectorAll('[data-lang]')) b.addEventListener('click', () => { lang = b.dataset.lang; store.set('ratrun.lang', lang); applyLang(); });
$('b-play').addEventListener('click', () => { audio(); sfx.click(); $('s-title').hidden = true; newGame(); startNight(); });

// ---------------------------------------------------------------------------------- loop
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (game && (mode === 'play' || mode === 'dying')) { if (mode === 'play') update(dt); else { game.time += dt; game.shake = Math.max(0, game.shake - dt * 2); game.flash = Math.max(0, game.flash - dt); } }
  if (game && game.rat && mode !== 'title') { render(); if (mode === 'play') { hud(); drawMini(); } }
  else if (city) titleBackdrop(now / 1000);
  requestAnimationFrame(frame);
}
// a slow drift over the street behind the title screen
function titleBackdrop(t) {
  const x = burrow.x + Math.sin(t * 0.05) * 30; const y = burrow.y + Math.cos(t * 0.04) * 25; const z = Z * 0.8;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#07061a'; ctx.fillRect(0, 0, view.width, view.height);
  ctx.setTransform(z * dpr, 0, 0, z * dpr, (SW / 2 - x * z) * dpr, (SH / 2 - y * z) * dpr); ctx.drawImage(world, 0, 0, W, H);
  ctx.globalAlpha = 0.85; ctx.drawImage(darkMap, 0, 0, W, H); ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------------------------- boot
(async function boot() {
  applyLang(); resize(); $('b-mute').classList.toggle('off', muted); $('loading').textContent = T('loading');
  try {
    const place = await fetch(DATA_URL).then((r) => r.json());
    prepCity(place); resize();
    $('loading').hidden = true; requestAnimationFrame(frame);
    window.__ratrun = { get game() { return game; }, get mode() { return mode; }, city: () => city, grates: () => grates, burrow: () => burrow };
  } catch (err) { $('loading').textContent = `Could not load the street (${err.message}).`; console.error(err); }
}());
