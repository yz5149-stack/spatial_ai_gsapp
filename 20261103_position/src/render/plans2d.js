// Floor plans of the two levels, drawn on 2D canvases.

import { G, C, nodeXYL } from '../sim/world.js';

export function makePlans(groundCanvas, canopyCanvas) {
  let world = null;
  let rays = null;
  let palette = null;
  let exits = [];
  const backgrounds = [null, null];
  const sounds = [];
  const flashes = [];   // completed movements (up, down, around, past), drawn for a moment
  const FLASH_MS = 2600;

  function cellSize(canvas) {
    const w = canvas.clientWidth || 360;
    return w / world.W;
  }

  function fit(canvas) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cs = cellSize(canvas);
    const w = Math.round(cs * world.W * dpr);
    const h = Math.round(cs * world.H * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    canvas.style.aspectRatio = `${world.W} / ${world.H}`;
    return { cs: cs * dpr, dpr };
  }

  function drawBackground(level, canvas) {
    const { cs } = fit(canvas);
    const off = document.createElement('canvas');
    off.width = canvas.width;
    off.height = canvas.height;
    const g = off.getContext('2d');
    const { W, H, ground, canopy } = world;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        let fill = palette.planFree;
        let mark = null;
        if (level === 0) {
          switch (ground[i]) {
            case G.TREE: mark = palette.tree; break;
            case G.BUSH: fill = palette.bush; break;
            case G.ROCK: fill = palette.rock; break;
            case G.LOG: fill = '#5a4330'; break;
            case G.CAR: fill = '#7a2622'; break;
            case G.WALL: fill = palette.wall; break;
            case G.LADDER: fill = palette.ladder; break;
            default: break;
          }
        } else {
          switch (canopy[i]) {
            case C.AIR: fill = palette.planAir; break;
            case C.PLATFORM: fill = palette.platform; break;
            case C.BRIDGE: fill = palette.bridge; break;
            case C.FOLIAGE: fill = palette.foliage; break;
            case C.LADDER: fill = palette.ladder; break;
            default: break;
          }
        }
        if (level === 0 && fill === palette.planFree && world.reserved) {
          const v = world.reserved[i];
          if (v === 1) fill = '#a6b2bf';       // the trail
          else if (v === 2) fill = '#b5c0cc';  // side paths
          else if (v === 3) fill = '#d4dfe9';  // clearings
        }
        g.fillStyle = fill;
        g.fillRect(x * cs, y * cs, cs + 0.5, cs + 0.5);
        if (mark) {
          g.fillStyle = mark;
          g.beginPath();
          g.arc((x + 0.5) * cs, (y + 0.5) * cs, cs * 0.42, 0, Math.PI * 2);
          g.fill();
        }
        if ((level === 0 && ground[i] === G.LADDER) || (level === 1 && canopy[i] === C.LADDER)) {
          g.strokeStyle = palette.planInk;
          g.lineWidth = Math.max(1, cs * 0.08);
          g.beginPath();
          g.moveTo((x + 0.3) * cs, (y + 0.15) * cs); g.lineTo((x + 0.3) * cs, (y + 0.85) * cs);
          g.moveTo((x + 0.7) * cs, (y + 0.15) * cs); g.lineTo((x + 0.7) * cs, (y + 0.85) * cs);
          for (const t of [0.35, 0.5, 0.65]) { g.moveTo((x + 0.3) * cs, (y + t) * cs); g.lineTo((x + 0.7) * cs, (y + t) * cs); }
          g.stroke();
        }
      }
    }
    // exits: a lit cell with an arrow pointing out of the map
    if (level === 0) {
      const OUT = { north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] };
      for (const e of exits) {
        const x = e.node % W;
        const y = Math.floor(e.node / W);
        const [dx, dy] = OUT[e.side];
        g.fillStyle = palette.exit;
        g.fillRect(x * cs, y * cs, cs, cs);
        g.fillRect((x + dx) * cs, (y + dy) * cs, cs, cs);
        g.fillStyle = palette.planInk;
        g.beginPath();
        const cx = (x + 0.5 + dx * 0.5) * cs;
        const cy = (y + 0.5 + dy * 0.5) * cs;
        g.moveTo(cx + dx * cs * 0.45, cy + dy * cs * 0.45);
        g.lineTo(cx - dy * cs * 0.3 - dx * cs * 0.1, cy + dx * cs * 0.3 - dy * cs * 0.1);
        g.lineTo(cx + dy * cs * 0.3 - dx * cs * 0.1, cy - dx * cs * 0.3 - dy * cs * 0.1);
        g.closePath();
        g.fill();
      }
    }
    // a light grid on walkable cells
    g.strokeStyle = palette.planGrid;
    g.lineWidth = 1;
    g.beginPath();
    for (let x = 0; x <= W; x++) { g.moveTo(x * cs, 0); g.lineTo(x * cs, H * cs); }
    for (let y = 0; y <= H; y++) { g.moveTo(0, y * cs); g.lineTo(W * cs, y * cs); }
    g.stroke();
    backgrounds[level] = off;
  }

  function setMap(newWorld, newRays, newPalette, newExits = []) {
    world = newWorld;
    rays = newRays;
    palette = newPalette;
    exits = newExits;
    sounds.length = 0;
    flashes.length = 0;
    drawBackground(0, groundCanvas);
    if (canopyCanvas) drawBackground(1, canopyCanvas);
  }

  function addSounds(game, now) {
    for (const s of game.sounds) if (s.heard) sounds.push({ node: s.node, who: s.who, born: now });
    for (const m of game.relations.movement) {
      if (m.kind === 'up' || m.kind === 'down' || m.kind === 'around' || m.kind === 'past') flashes.push({ ...m, born: now });
    }
  }

  const colorOf = (who) => ({ creature: palette.creature, player: palette.player, crow: palette.crow, shot: '#ffffff' }[who] ?? palette.planInk);
  const centre = (n, cs) => { const { x, y, level } = nodeXYL(world, n); return { x: (x + 0.5) * cs, y: (y + 0.5) * cs, level }; };

  // A crow: a dark body, a beak toward where it looks, eyes that light up while it watches you.
  function drawOwl(g, cs, crow, level) {
    const c = centre(crow.node, cs);
    if (c.level !== level) return;
    const r = cs * 0.38;
    g.save();
    g.translate(c.x, c.y);
    if (crow.watching) {
      g.strokeStyle = palette.crow;
      g.lineWidth = Math.max(1.5, cs * 0.12);
      g.setLineDash([cs * 0.2, cs * 0.14]);
      g.strokeRect(-cs * 1.5, -cs * 1.5, cs * 3, cs * 3);
      g.setLineDash([]);
    }
    g.rotate(crow.facing);
    g.fillStyle = '#15171c';
    g.strokeStyle = palette.crow;
    g.lineWidth = Math.max(1, cs * 0.08);
    g.beginPath();
    g.ellipse(0, 0, r * 1.2, r * 0.8, 0, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.fillStyle = '#9a9286';
    g.beginPath(); g.moveTo(r * 1.15, -r * 0.2); g.lineTo(r * 1.75, 0); g.lineTo(r * 1.15, r * 0.2); g.closePath(); g.fill();
    g.fillStyle = crow.watching ? palette.crow : '#777';
    g.beginPath(); g.arc(r * 0.6, 0, r * 0.22, 0, Math.PI * 2); g.fill();
    g.restore();
  }

  function label(g, cs, x, y, text, color) {
    g.font = `700 ${Math.round(cs * 0.62)}px system-ui, sans-serif`;
    const w = g.measureText(text).width + cs * 0.4;
    const h = cs * 0.85;
    g.save();
    g.fillStyle = color;
    g.beginPath();
    g.roundRect(x - w / 2, y - h / 2, w, h, h / 2);
    g.fill();
    g.fillStyle = '#fff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, x, y + cs * 0.03);
    g.restore();
  }

  function arrow(g, cs, a, b, color, dashed) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return;
    const ux = dx / len;
    const uy = dy / len;
    g.strokeStyle = color;
    g.fillStyle = color;
    g.lineWidth = Math.max(1.5, cs * 0.14);
    g.setLineDash(dashed ? [cs * 0.18, cs * 0.14] : []);
    g.beginPath();
    g.moveTo(a.x, a.y);
    g.lineTo(b.x - ux * cs * 0.35, b.y - uy * cs * 0.35);
    g.stroke();
    g.setLineDash([]);
    g.beginPath();
    g.moveTo(b.x, b.y);
    g.lineTo(b.x - ux * cs * 0.5 - uy * cs * 0.3, b.y - uy * cs * 0.5 + ux * cs * 0.3);
    g.lineTo(b.x - ux * cs * 0.5 + uy * cs * 0.3, b.y - uy * cs * 0.5 - ux * cs * 0.3);
    g.closePath();
    g.fill();
  }

  // Position relations that hold right now, drawn on the plan of each level.
  function drawRelations(g, cs, game, level, now) {
    const seen = game.player.seesCreature || game.over;
    const rel = {
      position: game.relations.position.filter((r) => seen || !(r.kind === 'between'
        || (r.kind === 'behind' && r.who === 'creature') || (r.kind === 'adjacent' && r.b === 'creature'))),
      movement: game.relations.movement.filter((m) => seen || m.who === 'player'),
    };
    const pulse = 0.6 + 0.4 * Math.sin(now / 220);
    for (const r of rel.position) {
      if (r.kind === 'above') {
        // you up in a tree: a double ring on the tree, and one at the creature if it is right below
        const tx = (r.tree % world.W + 0.5) * cs;
        const ty = (Math.floor(r.tree / world.W) + 0.5) * cs;
        g.strokeStyle = palette.player;
        g.lineWidth = Math.max(1.5, cs * 0.12);
        for (const k of [0.6, 0.9]) { g.beginPath(); g.arc(tx, ty, cs * k, 0, Math.PI * 2); g.stroke(); }
        label(g, cs, tx, ty - cs * 1.5, '\u25B2 IN THE TREE', palette.player);
        if (r.under && seen) {
          const c = centre(game.creature.node, cs);
          g.strokeStyle = palette.creature;
          g.beginPath(); g.arc(c.x, c.y, cs * 0.8, 0, Math.PI * 2); g.stroke();
          label(g, cs, c.x, c.y + cs * 1.5, '\u25BC BELOW', palette.creature);
        }
      } else if (r.kind === 'behind') {
        // the rear half of the observer's view, filled while someone stands in it
        const o = game[r.of];
        const c = centre(o.node, cs);
        if (c.level !== level) continue;
        const R = world.config.visionRange * cs;
        g.fillStyle = colorOf(r.who);
        g.globalAlpha = 0.13 + 0.07 * pulse;
        g.beginPath();
        g.moveTo(c.x, c.y);
        g.arc(c.x, c.y, R, o.facing + Math.PI / 2, o.facing + Math.PI * 1.5);
        g.closePath();
        g.fill();
        g.globalAlpha = 1;
        g.strokeStyle = colorOf(r.who);
        g.lineWidth = Math.max(1, cs * 0.08);
        g.setLineDash([cs * 0.25, cs * 0.2]);
        g.stroke();
        g.setLineDash([]);
        const t = centre(game[r.who].node, cs);
        if (t.level === level) label(g, cs, t.x, t.y + cs * 1.4, 'BEHIND', colorOf(r.who));
      } else if (r.kind === 'adjacent') {
        // one outline around both cells: nothing occupiable between them
        const a = nodeXYL(world, game[r.a].node);
        const b = nodeXYL(world, r.node);
        if (a.level !== level && b.level !== level) continue;
        const x0 = Math.min(a.x, b.x);
        const y0 = Math.min(a.y, b.y);
        const x1 = Math.max(a.x, b.x) + 1;
        const y1 = Math.max(a.y, b.y) + 1;
        g.strokeStyle = palette.rel;
        g.lineWidth = Math.max(2, cs * 0.18);
        g.beginPath();
        g.roundRect(x0 * cs - 2, y0 * cs - 2, (x1 - x0) * cs + 4, (y1 - y0) * cs + 4, cs * 0.3);
        g.stroke();
      } else if (r.kind === 'between') {
        // the line from you to what you need, crossed out where the creature stands
        const a = centre(game.player.node, cs);
        const b = centre(r.node, cs);
        const m = centre(game.creature.node, cs);
        if (m.level !== level && a.level !== level) continue;
        g.strokeStyle = palette.creature;
        g.globalAlpha = 0.85;
        g.lineWidth = Math.max(1.5, cs * 0.12);
        g.setLineDash([cs * 0.35, cs * 0.25]);
        g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
        g.setLineDash([]);
        g.globalAlpha = 1;
        if (m.level === level) {
          const k = cs * 0.55;
          g.lineWidth = Math.max(2, cs * 0.2);
          g.beginPath();
          g.moveTo(m.x - k, m.y - k); g.lineTo(m.x + k, m.y + k);
          g.moveTo(m.x + k, m.y - k); g.lineTo(m.x - k, m.y + k);
          g.stroke();
          label(g, cs, m.x, m.y - cs * 1.5, 'IN THE WAY', palette.creature);
        }
      } else if (r.kind === 'among') {
        // a dotted 3 by 3 frame: the agent is surrounded by solid cover
        const c = nodeXYL(world, game[r.who].node);
        if (c.level !== level) continue;
        g.strokeStyle = colorOf(r.who);
        g.lineWidth = Math.max(1, cs * 0.09);
        g.setLineDash([cs * 0.08, cs * 0.16]);
        g.strokeRect((c.x - 1) * cs, (c.y - 1) * cs, cs * 3, cs * 3);
        g.setLineDash([]);
      }
    }
    // toward / away: the step just taken, solid when closing in, dashed when opening up
    for (const m of rel.movement) {
      if (m.kind !== 'toward' && m.kind !== 'away') continue;
      const a = centre(m.from, cs);
      const b = centre(m.to, cs);
      if (a.level !== level || b.level !== level) continue;
      arrow(g, cs, a, b, colorOf(m.who), m.kind === 'away');
    }
    // completed movements, fading out
    for (const f of flashes) {
      const age = (now - f.born) / FLASH_MS;
      if (age >= 1) continue;
      g.globalAlpha = 1 - age * age;
      if (f.kind === 'up' || f.kind === 'down') {
        const c = centre(f.node, cs);
        const lift = (f.kind === 'up' ? -1 : 1) * age * cs * 1.2;
        label(g, cs, c.x, c.y - cs * 1.4 + lift, f.kind === 'up' ? '\u2191 UP' : '\u2193 DOWN', colorOf(f.who));
      } else if (f.kind === 'around') {
        const pts = f.trail.map((n) => centre(n, cs)).filter((p) => p.level === level);
        if (pts.length > 1) {
          g.strokeStyle = colorOf(f.who);
          g.lineWidth = Math.max(2, cs * 0.22);
          g.lineJoin = 'round';
          g.beginPath();
          pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
          g.stroke();
          arrow(g, cs, pts[pts.length - 2], pts[pts.length - 1], colorOf(f.who), false);
        }
        const c = centre(f.center, cs);
        if (c.level === level) label(g, cs, c.x, c.y + cs * 1.5, 'AROUND', colorOf(f.who));
      } else if (f.kind === 'past') {
        const c = centre(f.node, cs);
        if (c.level === level) {
          g.strokeStyle = palette.player;
          g.lineWidth = Math.max(2, cs * 0.16);
          g.beginPath(); g.arc(c.x, c.y, cs * (0.6 + age * 1.5), 0, Math.PI * 2); g.stroke();
          label(g, cs, c.x, c.y - cs * 1.5, '\u00BB PAST', palette.player);
        }
      }
      g.globalAlpha = 1;
    }
  }

  function drawAgent(g, cs, agent, color, level, showCone) {
    const { x, y, level: l } = nodeXYL(world, agent.node);
    const cx = (x + 0.5) * cs;
    const cy = (y + 0.5) * cs;
    const own = l === level;
    if (own && showCone) {
      // horizontal slice of the vision cone, clipped by the cached rays
      const i0 = world.nodeIndex[agent.node] * rays.R;
      const pts = [];
      rays.dirs.forEach((d, r) => {
        if (d.el !== 0) return;
        const a = Math.atan2(Math.sin(d.az - agent.facing), Math.cos(d.az - agent.facing));
        if (Math.abs(a) > (world.config.coneHorizontalDeg / 2) * Math.PI / 180 + 1e-9) return;
        const len = rays.lengths[i0 + r];
        pts.push({ a, px: cx + d.dx * len * cs, py: cy + d.dy * len * cs });
      });
      pts.sort((p, q) => p.a - q.a);
      g.fillStyle = color;
      g.globalAlpha = 0.22;
      g.beginPath();
      g.moveTo(cx, cy);
      for (const p of pts) g.lineTo(p.px, p.py);
      g.closePath();
      g.fill();
      g.globalAlpha = 1;
    }
    g.save();
    g.translate(cx, cy);
    g.rotate(agent.facing);
    g.globalAlpha = own ? 1 : 0.35;
    g.fillStyle = color;
    g.strokeStyle = palette.planInk;
    g.lineWidth = Math.max(1, cs * 0.08);
    g.beginPath();
    g.moveTo(cs * 0.62, 0);
    g.lineTo(-cs * 0.4, cs * 0.38);
    g.lineTo(-cs * 0.22, 0);
    g.lineTo(-cs * 0.4, -cs * 0.38);
    g.closePath();
    if (own) g.fill(); else g.setLineDash([cs * 0.15, cs * 0.12]);
    g.stroke();
    g.restore();
  }

  function draw(game, now, showCone, showRelations = true) {
    if (!world || !game) return;
    [groundCanvas, canopyCanvas].filter(Boolean).forEach((canvas, level) => {
      const { cs, dpr } = fit(canvas);
      if (backgrounds[level].width !== canvas.width) drawBackground(level, canvas);
      const g = canvas.getContext('2d');
      g.clearRect(0, 0, canvas.width, canvas.height);
      g.drawImage(backgrounds[level], 0, 0);
      for (const s of sounds) {
        const { x, y, level: l } = nodeXYL(world, s.node);
        if (l !== level) continue;
        const age = (now - s.born) / 1400;
        if (age >= 1) continue;
        g.strokeStyle = colorOf(s.who);
        g.globalAlpha = 1 - age;
        g.lineWidth = 2 * dpr;
        g.beginPath();
        g.arc((x + 0.5) * cs, (y + 0.5) * cs, cs * (0.4 + age * 4), 0, Math.PI * 2);
        g.stroke();
        g.globalAlpha = 1;
      }
      // the vaccine case on its cell (a small box), or next to you once you carry it
      const dn = game.caseItem.carried ? game.player.node : game.caseItem.node;
      const dp = nodeXYL(world, dn);
      if (dp.level === level) {
        const k = game.caseItem.carried ? 0.6 : 1;
        const cx = (dp.x + 0.5) * cs + (game.caseItem.carried ? cs * 0.6 : 0);
        const cy = (dp.y + 0.5) * cs - (game.caseItem.carried ? cs * 0.6 : 0);
        if (!game.caseItem.carried) {
          g.strokeStyle = palette.caseGlow;
          g.globalAlpha = 0.5 + 0.4 * Math.sin(now / 250);
          g.lineWidth = Math.max(1.5, cs * 0.12);
          g.beginPath(); g.arc(cx, cy, cs * 0.95, 0, Math.PI * 2); g.stroke();
          g.globalAlpha = 1;
        }
        g.fillStyle = '#d8dee4';
        g.strokeStyle = palette.planInk;
        g.lineWidth = Math.max(1, cs * 0.07);
        g.fillRect(cx - cs * 0.42 * k, cy - cs * 0.3 * k, cs * 0.84 * k, cs * 0.6 * k);
        g.strokeRect(cx - cs * 0.42 * k, cy - cs * 0.3 * k, cs * 0.84 * k, cs * 0.6 * k);
        g.fillStyle = palette.caseGlow;
        g.fillRect(cx - cs * 0.42 * k, cy - cs * 0.06 * k, cs * 0.84 * k, cs * 0.12 * k);
      }
      for (const o of game.crows) drawOwl(g, cs, o, level);
      if (showRelations) drawRelations(g, cs, game, level, now);
      // the creature: drawn where it is while you can see it; otherwise a fading question mark
      // where you last saw or heard it
      const seen = game.player.seesCreature || game.over;
      if (seen) drawAgent(g, cs, game.creature, palette.creature, level, showCone);
      else if (game.player.knownCreature !== null) {
        const age = (game.step - game.player.knownStep) / 30;
        const c = centre(game.player.knownCreature, cs);
        if (age < 1 && c.level === level) {
          g.globalAlpha = 0.85 * (1 - age);
          g.strokeStyle = palette.creature;
          g.setLineDash([cs * 0.15, cs * 0.12]);
          g.lineWidth = Math.max(1.5, cs * 0.1);
          g.beginPath(); g.arc(c.x, c.y, cs * 0.55, 0, Math.PI * 2); g.stroke();
          g.setLineDash([]);
          g.fillStyle = palette.creature;
          g.font = `700 ${Math.round(cs * 0.75)}px system-ui, sans-serif`;
          g.textAlign = 'center'; g.textBaseline = 'middle';
          g.fillText('?', c.x, c.y + cs * 0.04);
          g.globalAlpha = 1;
        }
      }
      if (game.player.inTree !== null) drawAgent(g, cs, { ...game.player, node: game.player.inTree }, palette.player, level, false);
      else drawAgent(g, cs, game.player, palette.player, level, showCone);
    });
    for (let i = sounds.length - 1; i >= 0; i--) if (now - sounds[i].born > 1400) sounds.splice(i, 1);
    for (let i = flashes.length - 1; i >= 0; i--) if (now - flashes[i].born > FLASH_MS) flashes.splice(i, 1);
  }

  return { setMap, addSounds, draw, redrawBackgrounds: (p) => { palette = p; if (world) { drawBackground(0, groundCanvas); if (canopyCanvas) drawBackground(1, canopyCanvas); } } };
}
