// Small synthesized sounds (no files): the cooler hum, footsteps, the creature, the door chime.
let ctx = null; let master = null; let hum = null; let on = false;

export function setSound(v) {
  on = v;
  if (on && !ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 0.5; master.connect(ctx.destination);
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 60;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 180;
    hum = ctx.createGain(); hum.gain.value = 0.025;
    o.connect(f); f.connect(hum); hum.connect(master); o.start();
  }
  if (ctx) { if (on) ctx.resume(); else ctx.suspend(); }
}
export const soundOn = () => on;

function blip({ freq = 440, type = 'sine', dur = 0.15, vol = 0.2, slide = 0, delay = 0, noise = false }) {
  if (!on || !ctx) return;
  const t = ctx.currentTime + delay;
  const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let src;
  if (noise) {
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
    const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; src.connect(f); f.connect(g);
  } else {
    src = ctx.createOscillator(); src.type = type; src.frequency.setValueAtTime(freq, t);
    if (slide) src.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    src.connect(g);
  }
  g.connect(master); src.start(t); src.stop(t + dur + 0.02);
}

export function play(type) {
  if (!on) return;
  if (type === 'enter' || type === 'escape') { blip({ freq: 988, dur: 0.25, vol: 0.12 }); blip({ freq: 784, dur: 0.35, vol: 0.1, delay: 0.18 }); }
  else if (type === 'step') blip({ freq: 1800, dur: 0.05, vol: 0.05, noise: true });
  else if (type === 'pick') blip({ freq: 660, dur: 0.12, vol: 0.1, type: 'triangle', slide: 300 });
  else if (type === 'slip') { blip({ freq: 400, dur: 0.3, vol: 0.2, noise: true }); blip({ freq: 300, dur: 0.25, vol: 0.12, type: 'square', slide: -200 }); }
  else if (type === 'heard') blip({ freq: 90, dur: 0.5, vol: 0.18, type: 'sawtooth', slide: -30 });
  else if (type === 'chase') { blip({ freq: 70, dur: 0.9, vol: 0.3, type: 'sawtooth', slide: 40 }); blip({ freq: 1400, dur: 0.6, vol: 0.05, noise: true }); }
  else if (type === 'caught') { blip({ freq: 160, dur: 1.0, vol: 0.3, type: 'square', slide: -120 }); blip({ freq: 600, dur: 0.6, vol: 0.12, noise: true }); }
  else if (type === 'heart') { blip({ freq: 55, dur: 0.12, vol: 0.35 }); blip({ freq: 50, dur: 0.14, vol: 0.28, delay: 0.17 }); }
}
