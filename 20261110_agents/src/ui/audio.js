// Sound, synthesized with the Web Audio API (no files): wind, a heartbeat that speeds up as the
// creature gets close, its creaking steps, the screech when it sees you, crows, the shot, the
// case's beep, and the endings. Browsers only allow sound after a click, so start() is called
// from the Start button.

export function makeAudio() {
  let ac = null;
  let master = null;
  let wind = null;
  let muted = false;
  let nextBeat = 0;
  let beatGap = 0;   // seconds between heartbeats, 0 = silent
  let droneGain = null;

  function noiseBuffer(seconds = 2) {
    const b = ac.createBuffer(1, ac.sampleRate * seconds, ac.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  function start() {
    if (ac) { ac.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ac = new AC();
    master = ac.createGain();
    master.gain.value = muted ? 0 : 0.8;
    master.connect(ac.destination);
    // wind: filtered noise with a slow sweep
    const src = ac.createBufferSource();
    src.buffer = noiseBuffer(4);
    src.loop = true;
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 420;
    bp.Q.value = 0.6;
    const lfo = ac.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ac.createGain();
    lfoGain.gain.value = 260;
    lfo.connect(lfoGain).connect(bp.frequency);
    wind = ac.createGain();
    wind.gain.value = 0.07;
    src.connect(bp).connect(wind).connect(master);
    src.start();
    lfo.start();
    // a low drone that swells with danger
    const o1 = ac.createOscillator();
    const o2 = ac.createOscillator();
    o1.type = 'sawtooth'; o1.frequency.value = 43;
    o2.type = 'sawtooth'; o2.frequency.value = 43.7;
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 160;
    droneGain = ac.createGain();
    droneGain.gain.value = 0.0;
    o1.connect(lp); o2.connect(lp);
    lp.connect(droneGain).connect(master);
    o1.start(); o2.start();
  }

  function env(node, t, a, peak, d) {
    node.gain.setValueAtTime(0.0001, t);
    node.gain.exponentialRampToValueAtTime(peak, t + a);
    node.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  function thump(t, f = 55, peak = 0.9) {
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(f * 1.6, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.08);
    env(g, t, 0.01, peak, 0.22);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + 0.3);
  }

  function noiseHit(t, { freq = 1200, q = 1, peak = 0.4, dur = 0.15, type = 'bandpass' } = {}) {
    const s = ac.createBufferSource();
    s.buffer = noiseBuffer(0.6);
    const f = ac.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ac.createGain();
    env(g, t, 0.005, peak, dur);
    s.connect(f).connect(g).connect(master);
    s.start(t);
    s.stop(t + dur + 0.1);
  }

  // per frame: the heartbeat and drone follow how close the creature is (0 far .. 1 right here)
  function danger(level, now) {
    if (!ac) return;
    const t = ac.currentTime;
    beatGap = level <= 0.05 ? 0 : 1.25 - level * 0.9;
    if (beatGap > 0 && t >= nextBeat) {
      thump(t, 52, 0.5 + level * 0.5);
      thump(t + 0.17, 48, 0.35 + level * 0.4);
      nextBeat = t + beatGap;
    } else if (beatGap === 0) nextBeat = t;
    droneGain.gain.setTargetAtTime(level * 0.16, t, 0.4);
    wind.gain.setTargetAtTime(0.07 + level * 0.05, t, 0.6);
  }

  const play = {
    step() { if (!ac) return; noiseHit(ac.currentTime, { freq: 900, q: 0.8, peak: 0.05, dur: 0.06 }); },
    creak() { // its steps: wood creaking, low and wet
      if (!ac) return;
      const t = ac.currentTime;
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(90 + Math.random() * 40, t);
      o.frequency.linearRampToValueAtTime(60 + Math.random() * 20, t + 0.25);
      const f = ac.createBiquadFilter();
      f.type = 'bandpass'; f.frequency.value = 300; f.Q.value = 6;
      env(g, t, 0.02, 0.12, 0.3);
      o.connect(f).connect(g).connect(master);
      o.start(t); o.stop(t + 0.4);
      noiseHit(t, { freq: 200, q: 2, peak: 0.12, dur: 0.12 });
    },
    screech() { // it sees you
      if (!ac) return;
      const t = ac.currentTime;
      for (const [f0, f1, det] of [[1400, 520, 0], [1450, 480, 13], [700, 260, -7]]) {
        const o = ac.createOscillator();
        const g = ac.createGain();
        o.type = 'sawtooth';
        o.detune.value = det * 10;
        o.frequency.setValueAtTime(f0, t);
        o.frequency.exponentialRampToValueAtTime(f1, t + 0.9);
        env(g, t, 0.03, 0.13, 0.9);
        o.connect(g).connect(master);
        o.start(t); o.stop(t + 1.1);
      }
      noiseHit(t, { freq: 2500, q: 0.7, peak: 0.25, dur: 0.6 });
    },
    caw() {
      if (!ac) return;
      const t = ac.currentTime;
      for (const k of [0, 0.22]) {
        const o = ac.createOscillator();
        const g = ac.createGain();
        o.type = 'square';
        o.frequency.setValueAtTime(820, t + k);
        o.frequency.exponentialRampToValueAtTime(380, t + k + 0.18);
        const f = ac.createBiquadFilter();
        f.type = 'bandpass'; f.frequency.value = 1200; f.Q.value = 3;
        env(g, t + k, 0.01, 0.22, 0.18);
        o.connect(f).connect(g).connect(master);
        o.start(t + k); o.stop(t + k + 0.25);
      }
    },
    shot() {
      if (!ac) return;
      const t = ac.currentTime;
      noiseHit(t, { freq: 1800, q: 0.4, peak: 0.9, dur: 0.25 });
      thump(t, 70, 1);
      noiseHit(t + 0.05, { freq: 5000, q: 1, peak: 0.25, dur: 0.6, type: 'highpass' }); // ice crackle
    },
    beep() {
      if (!ac) return;
      const t = ac.currentTime;
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = 'square'; o.frequency.value = 1760;
      env(g, t, 0.005, 0.07, 0.08);
      o.connect(g).connect(master);
      o.start(t); o.stop(t + 0.12);
    },
    pickup() {
      if (!ac) return;
      const t = ac.currentTime;
      [660, 880, 1320].forEach((f, i) => {
        const o = ac.createOscillator(); const g = ac.createGain();
        o.type = 'triangle'; o.frequency.value = f;
        env(g, t + i * 0.09, 0.01, 0.2, 0.3);
        o.connect(g).connect(master); o.start(t + i * 0.09); o.stop(t + i * 0.09 + 0.4);
      });
    },
    lose() {
      if (!ac) return;
      const t = ac.currentTime;
      play.screech();
      noiseHit(t + 0.1, { freq: 400, q: 0.5, peak: 0.8, dur: 1.4, type: 'lowpass' });
      thump(t + 0.1, 40, 1);
      droneGain.gain.setTargetAtTime(0.3, t, 0.1);
      droneGain.gain.setTargetAtTime(0, t + 1.5, 0.8);
    },
    win() {
      if (!ac) return;
      const t = ac.currentTime;
      [523, 659, 784, 1047].forEach((f, i) => {
        const o = ac.createOscillator(); const g = ac.createGain();
        o.type = 'sine'; o.frequency.value = f;
        env(g, t + i * 0.14, 0.02, 0.22, 1.2);
        o.connect(g).connect(master); o.start(t + i * 0.14); o.stop(t + i * 0.14 + 1.4);
      });
      droneGain.gain.setTargetAtTime(0, t, 0.3);
    },
  };

  return {
    start,
    suspend() { if (ac && ac.state === 'running') ac.suspend(); },
    resume() { if (ac && ac.state === 'suspended') ac.resume(); },
    danger,
    play,
    setMuted(m) { muted = m; if (master) master.gain.setTargetAtTime(m ? 0 : 0.8, ac.currentTime, 0.05); },
    isMuted: () => muted,
  };
}
