// The dot-matrix display from the main site, here as the readout of the code gate: it shows the code as it is typed,
// then says whether it opened. One canvas, a grid of dots, each easing toward a target brightness with a flash when
// it first lights.
import { FONTS } from './glyphs.js';
import { reduced } from './dom.js';

const COLS = 96, ROWS = 24;
const LIT = [43, 89, 255], ICE = [232, 238, 255];
// Two glyphs the big face lacks: the dash between a code's halves and the mark for a letter not typed yet.
const EXTRA = {
  '-': Array.from({ length: 12 }, (_, j) => (j === 5 || j === 6 ? '####' : '....')),
  _: Array.from({ length: 12 }, (_, j) => (j >= 10 ? '########' : '........')),
};
const glyph = (font, c) => (font === FONTS.big && EXTRA[c]) || font.glyphs[c];
const measure = (font, s) => [...s].reduce((a, c) => a + (glyph(font, c) ? glyph(font, c)[0].length : 0) + font.spacing, -font.spacing);

// The lit dots of a line of text, centred on the grid: [column, row, brightness].
function cells(text, { font = 'big', row } = {}) {
  let face = FONTS[font];
  let s = String(text).toUpperCase();
  if (measure(face, s) > COLS - 4 && face === FONTS.big) face = FONTS.small;
  while (measure(face, s) > COLS - 4 && s.length > 1) s = s.slice(1);
  const out = [];
  let x = Math.floor((COLS - measure(face, s)) / 2);
  const y = row ?? Math.floor((ROWS - face.height) / 2);
  for (const c of s) {
    const g = glyph(face, c);
    if (!g) continue;
    const dim = c === '_' ? 0.26 : 1;
    g.forEach((line, j) => [...line].forEach((on, i) => { if (on === '#') out.push([x + i, y + j, dim]); }));
    x += g[0].length + face.spacing;
  }
  return out;
}

export function createDisplay(canvas) {
  const g = canvas.getContext('2d');
  const n = COLS * ROWS;
  const target = new Float32Array(n), level = new Float32Array(n), flash = new Float32Array(n);
  const still = reduced();
  let raf = 0, alive = true, shimmer = true, ripple = null, pitch = 0;

  function size() {
    const w = canvas.clientWidth || 640;
    const scale = Math.min(devicePixelRatio || 1, 2);
    pitch = Math.max(2, Math.floor((w * scale) / COLS));
    canvas.width = pitch * COLS;
    canvas.height = pitch * ROWS;
  }
  function set(list) {
    target.fill(0);
    for (const [i, j, b] of list) if (i >= 0 && i < COLS && j >= 0 && j < ROWS) target[j * COLS + i] = b;
    for (let k = 0; k < n; k++) if (target[k] > level[k] + 0.3) flash[k] = 1;
    if (still) { level.set(target); flash.fill(0); }
  }
  function draw(now) {
    g.fillStyle = '#06070A';
    g.fillRect(0, 0, canvas.width, canvas.height);
    const r = pitch * 0.36, band = shimmer && !still ? ((now / 2800) % 1.5) * (COLS + ROWS) : -99;
    const wave = ripple ? (now - ripple.t) / 480 : -1;
    if (ripple && wave > 1.25) { const done = ripple.done; ripple = null; done(); }
    for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) {
      const k = j * COLS + i;
      level[k] += (target[k] - level[k]) * 0.24;
      flash[k] *= 0.86;
      let b = level[k] * 0.82 + flash[k] * 0.5;
      if (level[k] > 0.5) b += Math.max(0, 1 - Math.abs(i + j - band) / 5) * 0.3;
      if (ripple) {
        const d = Math.hypot(i - COLS / 2, (j - ROWS / 2) * 1.6) / (COLS / 2);
        b += Math.max(0, 1 - Math.abs(d - wave) / 0.16) * 0.9;
      }
      const cx = i * pitch + pitch / 2, cy = j * pitch + pitch / 2;
      if (b < 0.05) { g.fillStyle = 'rgba(110, 140, 255, 0.11)'; g.beginPath(); g.arc(cx, cy, r, 0, 6.2832); g.fill(); continue; }
      b = Math.min(1, b);
      const t = b * b, c = LIT.map((v, q) => Math.round(v + (ICE[q] - v) * t));
      if (b > 0.6) { g.fillStyle = `rgba(43, 89, 255, ${0.2 * b})`; g.beginPath(); g.arc(cx, cy, r * 1.4, 0, 6.2832); g.fill(); }
      g.fillStyle = `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${0.35 + 0.65 * b})`;
      g.beginPath(); g.arc(cx, cy, r * (1 + 0.2 * b), 0, 6.2832); g.fill();
    }
  }
  let last = 0;
  function frame(now) {
    if (!alive) return;
    if (!canvas.isConnected) { alive = false; return; }
    // The display's own pace: about thirty frames a second is plenty for dots.
    if (now - last > 30) { last = now; draw(now); }
    raf = requestAnimationFrame(frame);
  }
  const onResize = () => { size(); draw(performance.now()); };
  size();
  addEventListener('resize', onResize);
  if (still) draw(0); else raf = requestAnimationFrame(frame);

  const api = {
    // A message in the big face, or the small one if it is long.
    say(text, opts) { shimmer = true; set(cells(text, opts)); if (still) draw(0); },
    // The code so far, in two halves, with marks for the letters still to come.
    code(typed) {
      const s = typed.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      const shown = s.length <= 8 ? (s + '________').slice(0, 8) : s;
      shimmer = false;
      set(cells(shown.length === 8 ? shown.slice(0, 4) + '-' + shown.slice(4) : shown));
      if (still) draw(0);
    },
    // A ring of light out from the middle: the code was right.
    ripple() {
      if (still) return Promise.resolve();
      return new Promise(done => { ripple = { t: performance.now(), done }; });
    },
    destroy() { alive = false; cancelAnimationFrame(raf); removeEventListener('resize', onResize); },
  };
  return api;
}
