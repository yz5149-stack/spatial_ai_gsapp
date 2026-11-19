// Small pictures drawn on canvases, used as billboards in the 3D city and as icons on the page.
// Each points "up" (north on screen) so it can be turned with the agent's heading.

const cache = new Map();
const make = (key, w, h, draw) => {
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  cache.set(key, c);
  return c;
};

// a rat seen from above, nose up
export function ratIcon(color = '#ff7a4a', key = 'rat') {
  return make(`${key}${color}`, 48, 64, (g, w) => {
    g.translate(w / 2, 30);
    g.shadowColor = color; g.shadowBlur = 10;
    // tail
    g.strokeStyle = '#f0b7a0'; g.lineWidth = 2.2; g.lineCap = 'round';
    g.beginPath(); g.moveTo(0, 14); g.bezierCurveTo(6, 22, -6, 28, 3, 33); g.stroke();
    // body and head
    g.fillStyle = color; g.strokeStyle = '#1a0b05'; g.lineWidth = 1.6;
    g.beginPath(); g.ellipse(0, 4, 8.5, 13, 0, 0, Math.PI * 2); g.fill(); g.stroke();
    g.beginPath(); g.ellipse(0, -12, 5.5, 7.5, 0, 0, Math.PI * 2); g.fill(); g.stroke();
    g.shadowBlur = 0;
    // ears and eyes
    g.fillStyle = '#ffc2a8';
    g.beginPath(); g.arc(-5, -15, 2.6, 0, Math.PI * 2); g.arc(5, -15, 2.6, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#111';
    g.beginPath(); g.arc(-2.2, -14, 1.2, 0, Math.PI * 2); g.arc(2.2, -14, 1.2, 0, Math.PI * 2); g.fill();
  });
}

// an inspector from above: a figure with a cap and a flashlight pointing up
export function inspectorIcon(color = '#47b8ff') {
  return make(`ins${color}`, 56, 56, (g, w) => {
    g.translate(w / 2, w / 2 + 4);
    g.shadowColor = color; g.shadowBlur = 12;
    g.fillStyle = color; g.strokeStyle = '#ffffff'; g.lineWidth = 2.5;
    g.beginPath(); g.ellipse(0, 4, 13, 9, 0, 0, Math.PI * 2); g.fill(); g.stroke();   // shoulders
    g.shadowBlur = 0;
    g.fillStyle = '#0f2b40'; g.beginPath(); g.arc(0, 2, 7, 0, Math.PI * 2); g.fill(); // cap
    g.fillStyle = '#fff3b0'; g.fillRect(9, -16, 4, 14);                              // flashlight
    g.fillStyle = 'rgba(255,243,176,0.9)'; g.beginPath(); g.arc(11, -17, 3.5, 0, Math.PI * 2); g.fill();
  });
}

// a black trash bag with a yellow tie
export function bagIcon(big = false) {
  const s = big ? 1.6 : 1;
  return make(`bag${big}`, 34 * s, 38 * s, (g) => {
    g.scale(s, s);
    g.fillStyle = '#16181c'; g.strokeStyle = '#ffd34d'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(9, 12); g.quadraticCurveTo(1, 26, 7, 34); g.lineTo(27, 34); g.quadraticCurveTo(33, 26, 25, 12); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#ffd34d'; g.fillRect(14, 7, 6, 6);
    g.strokeStyle = '#16181c'; g.lineWidth = 2; g.beginPath(); g.moveTo(13, 6); g.lineTo(9, 1); g.moveTo(21, 6); g.lineTo(25, 1); g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.18)'; g.beginPath(); g.ellipse(13, 22, 3, 7, -0.3, 0, Math.PI * 2); g.fill();
  });
}

// a lidded bin
export function binIcon() {
  return make('bin', 26, 30, (g) => {
    g.fillStyle = '#2f9e62'; g.strokeStyle = '#0c2a19'; g.lineWidth = 1.5;
    g.fillRect(5, 9, 16, 19); g.strokeRect(5, 9, 16, 19);
    g.fillStyle = '#5fd38a'; g.fillRect(3, 5, 20, 5); g.strokeRect(3, 5, 20, 5);
  });
}

// a burrow: a dark hole with a warm rim
export function burrowIcon() {
  return make('burrow', 34, 22, (g) => {
    g.fillStyle = 'rgba(255,90,60,0.85)'; g.beginPath(); g.ellipse(17, 11, 15, 9, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#120806'; g.beginPath(); g.ellipse(17, 12, 10, 6, 0, 0, Math.PI * 2); g.fill();
  });
}

// a bait station: a dark box with a purple lid
export function stationIcon() {
  return make('station', 26, 22, (g) => {
    g.fillStyle = '#2a2433'; g.fillRect(3, 6, 20, 13);
    g.fillStyle = '#c58bff'; g.fillRect(2, 3, 22, 5);
    g.fillStyle = '#c58bff'; g.fillRect(10, 12, 6, 3);
  });
}

// "!" over a rat that smelled something
export function alertIcon() {
  return make('alert', 22, 22, (g) => {
    g.fillStyle = '#ffd34d'; g.beginPath(); g.arc(11, 11, 10, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#1a1406'; g.font = 'bold 15px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('!', 11, 12);
  });
}
