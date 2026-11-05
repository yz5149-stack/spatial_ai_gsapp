// Floor plans of what each agent knows: its own map, its trajectory, its landmarks, its route
// and its vision cone. The creature's plan can also show what all rounds have in common.

const LM_STYLE = {
  start: { color: '#cfd6de', glyph: 'O' },
  deadend: { color: '#ff5a4a', glyph: 'D' },
  clearing: { color: '#7fd1ff', glyph: 'C' },
  exit: { color: '#7dff9a', glyph: 'H' },
  heard: { color: '#ffb347', glyph: '))' },
  seen: { color: '#ffd23f', glyph: '!' },
  caught: { color: '#ff2a2a', glyph: '†' },
};
export { LM_STYLE };

export function makePlan(canvas, who) {
  let sim = null;
  const colors = who === 'creature'
    ? { agent: '#ff3b30', trail: '255, 59, 48', cone: 'rgba(255, 40, 30, 0.28)', route: '#ff8a7a' }
    : { agent: '#ffd27a', trail: '255, 210, 122', cone: 'rgba(255, 230, 170, 0.3)', route: '#ffe2a0' };

  function size() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth || 400;
    const cs = (w / sim.world.W) * dpr;
    const W = Math.round(cs * sim.world.W);
    const H = Math.round(cs * sim.world.H);
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    canvas.style.aspectRatio = `${sim.world.W} / ${sim.world.H}`;
    return cs;
  }

  function draw(s, now, overlays = {}) {
    sim = s;
    const agent = who === 'creature' ? sim.creature : sim.survivor;
    const g = canvas.getContext('2d');
    if (!agent) { size(); g.fillStyle = '#05070a'; g.fillRect(0, 0, canvas.width, canvas.height); drawEmpty(g); return; }
    const cs = size();
    const { W, H } = sim.world;
    const k = agent.k;
    let maxVisit = 1;
    for (let i = 0; i < W * H; i++) if (k.visits[i] > maxVisit) maxVisit = k.visits[i];
    g.fillStyle = '#05070a';
    g.fillRect(0, 0, canvas.width, canvas.height);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const v = k.known[i];
      if (v === -1) continue;
      if (v === 1) {
        g.fillStyle = '#26303b';
        g.fillRect(x * cs, y * cs, cs + 0.5, cs + 0.5);
        g.fillStyle = '#3a4756';
        g.beginPath(); g.arc((x + 0.5) * cs, (y + 0.5) * cs, cs * 0.28, 0, Math.PI * 2); g.fill();
      } else {
        // open ground it knows; where it has walked is tinted, like the stripes a vacuum leaves
        const heat = Math.min(1, k.visits[i] / Math.max(3, maxVisit * 0.6));
        g.fillStyle = '#b9c4cf';
        g.fillRect(x * cs, y * cs, cs + 0.5, cs + 0.5);
        if (heat > 0) {
          g.fillStyle = `rgba(${colors.trail}, ${0.12 + 0.35 * heat})`;
          g.fillRect(x * cs, y * cs, cs + 0.5, cs + 0.5);
        }
        // fade-in for cells seen in the last moment
        const age = sim.step - k.seenAt[i];
        if (age >= 0 && age < 6) {
          g.fillStyle = `rgba(${colors.trail}, ${0.5 * (1 - age / 6)})`;
          g.fillRect(x * cs, y * cs, cs + 0.5, cs + 0.5);
        }
      }
    }
    // overlays: what all rounds have in common (creature plan only)
    if (who === 'creature') {
      if (overlays.heat) {
        let max = 1;
        for (const v of sim.heardHeat) if (v > max) max = v;
        for (let i = 0; i < W * H; i++) {
          const v = sim.heardHeat[i];
          if (!v) continue;
          const t = v / max;
          g.fillStyle = `rgba(255, ${Math.round(200 - 160 * t)}, 40, ${0.25 + 0.6 * t})`;
          g.beginPath(); g.arc((i % W + 0.5) * cs, (Math.floor(i / W) + 0.5) * cs, cs * (0.5 + 0.9 * t), 0, Math.PI * 2); g.fill();
        }
      }
      if (overlays.paths) {
        g.lineWidth = Math.max(1, cs * 0.12);
        g.lineJoin = 'round';
        for (const r of sim.rounds.slice(-40)) {
          g.strokeStyle = r.result === 'caught' ? 'rgba(255, 90, 80, 0.35)' : 'rgba(125, 255, 154, 0.35)';
          g.beginPath();
          r.trail.forEach((n, j) => { const px = (n % W + 0.5) * cs; const py = (Math.floor(n / W) + 0.5) * cs; if (j) g.lineTo(px, py); else g.moveTo(px, py); });
          g.stroke();
        }
      }
      if (overlays.paths || overlays.heat) {
        for (const n of sim.catches) cross(g, cs, n, '#ff2a2a');
        for (const n of sim.escapes) dot(g, cs, n, '#7dff9a');
      }
    }
    // the trajectory: the last part as a line
    const trail = k.trail.slice(-260);
    if (trail.length > 1) {
      g.lineWidth = Math.max(1, cs * 0.14);
      g.lineJoin = 'round';
      for (let j = 1; j < trail.length; j++) {
        const a = trail[j - 1]; const b = trail[j];
        g.strokeStyle = `rgba(${colors.trail}, ${0.15 + 0.85 * (j / trail.length)})`;
        g.beginPath();
        g.moveTo((a % W + 0.5) * cs, (Math.floor(a / W) + 0.5) * cs);
        g.lineTo((b % W + 0.5) * cs, (Math.floor(b / W) + 0.5) * cs);
        g.stroke();
      }
    }
    // its planned route, on its own map
    if (agent.path && agent.path.length > 1) {
      g.strokeStyle = colors.route;
      g.lineWidth = Math.max(1, cs * 0.12);
      g.setLineDash([cs * 0.35, cs * 0.25]);
      g.beginPath();
      agent.path.forEach((n, j) => { const px = (n % W + 0.5) * cs; const py = (Math.floor(n / W) + 0.5) * cs; if (j) g.lineTo(px, py); else g.moveTo(px, py); });
      g.stroke();
      g.setLineDash([]);
      const t = agent.path[agent.path.length - 1];
      g.strokeStyle = colors.route;
      g.beginPath(); g.arc((t % W + 0.5) * cs, (Math.floor(t / W) + 0.5) * cs, cs * 0.6, 0, Math.PI * 2); g.stroke();
    }
    // landmarks
    for (const l of k.landmarks) {
      const st = LM_STYLE[l.kind] ?? LM_STYLE.start;
      const px = (l.x + 0.5) * cs;
      const py = (l.y + 0.5) * cs;
      g.fillStyle = st.color;
      g.strokeStyle = '#05070a';
      g.lineWidth = Math.max(1, cs * 0.1);
      g.beginPath(); g.arc(px, py, cs * 0.62, 0, Math.PI * 2); g.fill(); g.stroke();
      g.fillStyle = '#05070a';
      g.font = `700 ${Math.round(cs * 0.62)}px system-ui, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(l.id.length > 3 ? st.glyph : l.id, px, py + cs * 0.04);
    }
    // the vision cone
    if (k.lastCone && k.lastCone.length > 2 && sim.phase !== 'pause') {
      g.fillStyle = colors.cone;
      g.beginPath();
      k.lastCone.forEach(([x, y], j) => (j ? g.lineTo(x * cs, y * cs) : g.moveTo(x * cs, y * cs)));
      g.closePath();
      g.fill();
    }
    // the other agent, only where this one knows it is
    if (who === 'creature' && sim.survivor && sim.phase !== 'explore') {
      const s = sim.survivor;
      if (sim.creature.seesSurvivor || sim.phase === 'pause') arrow(g, cs, s.node, s.facing, '#ffd27a');
      for (const snd of sim.sounds) if (snd.heard) ring(g, cs, snd.node, '#ffb347', now);
    }
    if (who === 'survivor') {
      const c = sim.creature;
      if (sim.survivor.sees) arrow(g, cs, c.node, c.facing, '#ff3b30');
      else if (sim.survivor.threatAt !== null && sim.step - sim.survivor.threatStep < 30) {
        const n = sim.survivor.threatAt;
        g.fillStyle = '#ff3b30';
        g.font = `800 ${Math.round(cs * 1.1)}px system-ui, sans-serif`;
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText('?', (n % W + 0.5) * cs, (Math.floor(n / W) + 0.5) * cs);
      }
    }
    arrow(g, cs, agent.node, agent.facing, colors.agent, true);
  }

  function drawEmpty(g) {
    g.fillStyle = '#8d99aa';
    g.font = '14px system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText('No survivor yet: the creature is still mapping the forest.', canvas.width / 2, canvas.height / 2);
  }

  function arrow(g, cs, n, facing, color, big = false) {
    const W = sim.world.W;
    g.save();
    g.translate((n % W + 0.5) * cs, (Math.floor(n / W) + 0.5) * cs);
    g.rotate(facing);
    const k = big ? 1.25 : 1;
    g.fillStyle = color;
    g.strokeStyle = '#05070a';
    g.lineWidth = Math.max(1, cs * 0.1);
    g.beginPath();
    g.moveTo(cs * 0.75 * k, 0);
    g.lineTo(-cs * 0.5 * k, cs * 0.45 * k);
    g.lineTo(-cs * 0.25 * k, 0);
    g.lineTo(-cs * 0.5 * k, -cs * 0.45 * k);
    g.closePath();
    g.fill(); g.stroke();
    g.restore();
  }
  function ring(g, cs, n, color, now) {
    const W = sim.world.W;
    g.strokeStyle = color;
    g.lineWidth = Math.max(1.5, cs * 0.12);
    const r = cs * (0.8 + ((now / 400) % 1) * 1.6);
    g.beginPath(); g.arc((n % W + 0.5) * cs, (Math.floor(n / W) + 0.5) * cs, r, 0, Math.PI * 2); g.stroke();
  }
  function cross(g, cs, n, color) {
    const W = sim.world.W;
    const x = (n % W + 0.5) * cs; const y = (Math.floor(n / W) + 0.5) * cs; const r = cs * 0.5;
    g.strokeStyle = color; g.lineWidth = Math.max(1.5, cs * 0.16);
    g.beginPath(); g.moveTo(x - r, y - r); g.lineTo(x + r, y + r); g.moveTo(x + r, y - r); g.lineTo(x - r, y + r); g.stroke();
  }
  function dot(g, cs, n, color) {
    const W = sim.world.W;
    g.fillStyle = color;
    g.beginPath(); g.arc((n % W + 0.5) * cs, (Math.floor(n / W) + 0.5) * cs, cs * 0.4, 0, Math.PI * 2); g.fill();
  }

  // the grid cell under a click
  function cellAt(clientX, clientY) {
    if (!sim) return null;
    const r = canvas.getBoundingClientRect();
    const x = Math.floor(((clientX - r.left) / r.width) * sim.world.W);
    const y = Math.floor(((clientY - r.top) / r.height) * sim.world.H);
    if (x < 0 || y < 0 || x >= sim.world.W || y >= sim.world.H) return null;
    return y * sim.world.W + x;
  }

  return { draw, cellAt };
}
