// The main site's page change, for moments that deserve it here: a space opening, the owner signing in. A wave of
// dot-matrix pixels flashes out from where you pressed until the screen is a dark field of unlit dots, the name of
// where you are going lights up in the display's lettering, then the dots open outward from it onto the new view.
import { FONTS } from './glyphs.js';
import { reduced } from './dom.js';

const ROOM = '#06070A', UNLIT = 'rgba(110, 140, 255, 0.11)';
const LIT = [43, 89, 255], ICE = [232, 238, 255];
const hash = (i, j) => { const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return s - Math.floor(s); };
const measure = (font, s) => [...s].reduce((a, c) => a + (font.glyphs[c] ? font.glyphs[c][0].length : 0) + font.spacing, -font.spacing);

// The title's lit cells on a grid of `gw` by `gh` dots: wrapped by words, big face if it fits.
function title(text, gw, gh) {
  const s = String(text || '').toUpperCase().replace(/[^A-Z0-9 .,:\-!?'/+*]/g, '').trim();
  if (!s) return [];
  for (const font of [FONTS.big, FONTS.small]) {
    const lines = [];
    for (const word of s.split(/\s+/)) {
      const next = lines.length ? lines[lines.length - 1] + ' ' + word : word;
      if (lines.length && measure(font, next) <= gw - 6) lines[lines.length - 1] = next; else lines.push(word);
    }
    if (lines.some(l => measure(font, l) > gw - 6)) continue;
    const gap = Math.round(font.height / 3), tall = lines.length * font.height + (lines.length - 1) * gap;
    if (tall > gh - 6) continue;
    const out = [];
    let y = Math.floor((gh - tall) / 2);
    for (const line of lines) {
      let x = Math.floor((gw - measure(font, line)) / 2);
      for (const c of line) {
        const g = font.glyphs[c];
        if (!g) continue;
        g.forEach((row, j) => [...row].forEach((on, i) => { if (on === '#') out.push([x + i, y + j]); }));
        x += g[0].length + font.spacing;
      }
      y += font.height + gap;
    }
    return out;
  }
  return [];
}

// Covers the screen while `prepare` gets the next view ready, puts it on the page with `commit` once nothing of the
// old one shows, then opens. Resolves when the screen is clear.
export async function pixels({ x, y, name, prepare, commit }) {
  if (reduced()) { await commit(await prepare()); return; }
  const w = innerWidth, h = innerHeight;
  const pitch = w >= 900 ? Math.max(12, Math.round(w / 120)) : 9;
  const scale = Math.min(devicePixelRatio || 1, 2, Math.sqrt(2.4e6 / (w * h)));
  const C = Math.max(6, Math.round((pitch * scale) / 2) * 2);
  const cols = Math.ceil(w / pitch), rows = Math.ceil(h / pitch);
  const canvas = document.createElement('canvas');
  canvas.className = 'px-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.width = cols * C; canvas.height = rows * C;
  canvas.style.width = cols * pitch + 'px'; canvas.style.height = rows * pitch + 'px';
  const g = canvas.getContext('2d');
  document.body.append(canvas);
  document.documentElement.classList.add('px-busy');

  const r = C * 0.36;
  const dot = (cx, cy, b) => {
    g.fillStyle = ROOM; g.fillRect(cx, cy, C, C);
    if (b < 0.05) { g.fillStyle = UNLIT; g.beginPath(); g.arc(cx + C / 2, cy + C / 2, r, 0, 6.2832); g.fill(); return; }
    const t = b * b, c = LIT.map((v, q) => Math.round(v + (ICE[q] - v) * t));
    g.fillStyle = `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${0.35 + 0.65 * b})`;
    g.beginPath(); g.arc(cx + C / 2, cy + C / 2, r * (1 + 0.24 * b), 0, 6.2832); g.fill();
  };
  const run = step => new Promise(done => {
    const start = performance.now();
    const frame = now => { if (step(now - start)) done(); else requestAnimationFrame(frame); };
    requestAnimationFrame(frame);
  });

  // Leaving: the wave covers the view.
  const ox = x ?? w / 2, oy = y ?? h / 2;
  const far = Math.max(Math.hypot(ox, oy), Math.hypot(w - ox, oy), Math.hypot(ox, h - oy), Math.hypot(w - ox, h - oy));
  let cells = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    cells.push({ i, j, x: i * C, y: j * C, delay: (Math.hypot(i * pitch + pitch / 2 - ox, j * pitch + pitch / 2 - oy) / far) * 0.74 + hash(i, j) * 0.1 });
  }
  cells.sort((a, b) => a.delay - b.delay);
  let first = 0;
  const ready = prepare().catch(e => { console.error(e); return null; });
  await run(t => {
    const p = t / 520;
    for (let n = first; n < cells.length; n++) {
      const c = cells[n], tau = (p - c.delay) / 0.24;
      if (tau <= 0) break;
      if (tau >= 1) { dot(c.x, c.y, 0); first = n + 1; continue; }
      dot(c.x, c.y, tau < 0.3 ? tau / 0.3 : Math.max(0, 1 - (tau - 0.3) / 0.7));
    }
    return first >= cells.length;
  });
  try { await commit(await ready); } catch (e) { console.error(e); }

  // Arriving: the name lights left to right, then the field opens outward from it.
  const letters = title(typeof name === 'function' ? name() : name, cols, rows);
  const inTitle = new Set(letters.map(([i, j]) => i + ',' + j));
  let mx = 0, my = 0, minI = Infinity, maxI = -Infinity;
  letters.forEach(([i, j]) => { mx += i; my += j; minI = Math.min(minI, i); maxI = Math.max(maxI, i); });
  const cx0 = letters.length ? (mx / letters.length) * pitch : w / 2, cy0 = letters.length ? (my / letters.length) * pitch : h / 2;
  const far2 = Math.max(Math.hypot(cx0, cy0), Math.hypot(w - cx0, cy0), Math.hypot(cx0, h - cy0), Math.hypot(w - cx0, h - cy0));
  const hold = letters.length ? 430 : 60;
  cells.forEach(c => {
    c.lit = inTitle.has(c.i + ',' + c.j);
    c.on = c.lit ? 60 + ((c.i - minI) / Math.max(1, maxI - minI)) * 240 : 0;
    c.open = hold + (Math.hypot(c.i * pitch - cx0, c.j * pitch - cy0) / far2) * 520 + hash(c.i, c.j) * 100;
    c.state = 0;
  });
  const order = [...cells].sort((a, b) => a.open - b.open);
  const lit = cells.filter(c => c.lit);
  const edge = Math.max(1, Math.round(C / 12));
  first = 0;
  await run(t => {
    for (const c of lit) {
      if (c.state >= 2 || t < c.on || t > c.open) continue;
      const s = t - c.on < 120 ? 1 : 2;
      if (s !== c.state) { c.state = s; dot(c.x, c.y, s === 1 ? 1 : 0.72); }
    }
    for (let n = first; n < order.length; n++) {
      const c = order[n], o = (t - c.open) / 240;
      if (o <= 0) break;
      if (o >= 1) { g.clearRect(c.x, c.y, C, C); first = n + 1; continue; }
      if (o < 0.35) { dot(c.x, c.y, Math.max(c.lit ? 0.72 : 0, o / 0.2)); continue; }
      // The dot opens into a window on the view: a square growing to the whole cell, with a royal edge.
      const q = Math.round(r + (C / 2 - r) * (1 - Math.pow(1 - (o - 0.35) / 0.65, 3)));
      const e = Math.min(C / 2, q + edge);
      g.fillStyle = ROOM; g.fillRect(c.x, c.y, C, C);
      g.fillStyle = 'rgb(28, 56, 157)'; g.fillRect(c.x + C / 2 - e, c.y + C / 2 - e, e * 2, e * 2);
      g.clearRect(c.x + C / 2 - q, c.y + C / 2 - q, q * 2, q * 2);
    }
    return first >= order.length;
  });
  canvas.remove();
  document.documentElement.classList.remove('px-busy');
}
