// What fills the stage for each kind of item. Every viewer returns { el, tools, show(note), sync(notes), destroy() }:
// `tools` are the keys shown under the stage; `show` takes you to what a note points at; `sync` is told when the
// item's notes change. `hooks.ask(anchor, label, hint)` starts a note that points at something; `hooks.pick(id)`
// lights that note in the thread.
import { h, icon, clear, prose, bytes, clock, KIND } from '../ui/dom.js';
import { embedOf, extOf } from '../data/util.js';
import { pinNumbers } from './notes.js';

const key = (label, ico, props = {}) => h('button.key.mono', { type: 'button', ...props }, ico ? icon(ico) : null, label);

// --- Pictures: tap to pin a note to a spot -------------------------------------------------------------------------
function imageViewer({ item, url, hooks }) {
  const img = h('img', { src: url, alt: item.title || 'Picture', decoding: 'async', draggable: 'false' });
  const layer = h('div.pins');
  const box = h('div.image-box', {}, img, layer);
  let notes = [], pending = null;
  if (item.meta?.w && item.meta?.h) box.style.aspectRatio = `${item.meta.w} / ${item.meta.h}`;

  function draw() {
    clear(layer);
    const numbers = pinNumbers(notes);
    for (const n of notes) {
      if (n.anchor?.type !== 'pin') continue;
      layer.append(h('button.pin', { type: 'button', class: n.resolved ? 'is-done' : '', 'data-pin': n.id, style: { left: n.anchor.x * 100 + '%', top: n.anchor.y * 100 + '%' }, 'aria-label': `Pin ${numbers.get(n.id)}: ${n.author}’s note`, onclick: e => { e.stopPropagation(); hooks.pick(n.id); } }, String(numbers.get(n.id))));
    }
    if (pending) layer.append(h('span.pin.is-pending', { style: { left: pending.x * 100 + '%', top: pending.y * 100 + '%' }, 'aria-hidden': 'true' }, icon('plus')));
  }
  box.addEventListener('click', e => {
    const r = img.getBoundingClientRect();
    if (!r.width) return;
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    pending = { x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 };
    draw();
    hooks.ask({ type: 'pin', ...pending }, 'New pin', 'Your note will be pinned to that spot.');
  });
  return {
    el: h('div.stage-fit.is-image', {}, box),
    hint: 'Tap anywhere on the picture to pin a note to that spot.',
    tools: [h('a.key.mono', { href: url, target: '_blank', rel: 'noopener' }, icon('out'), 'Full size')],
    sync(list) { notes = list; draw(); },
    cancel() { pending = null; draw(); },
    posted() { pending = null; },
    show(note) {
      const pin = layer.querySelector(`[data-pin="${CSS.escape(note.id)}"]`);
      if (!pin) return;
      box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      pin.classList.remove('is-lit'); void pin.offsetWidth; pin.classList.add('is-lit');
    },
    destroy() {},
  };
}

// --- Films: a note can be tied to a moment ---------------------------------------------------------------------------
function videoViewer({ item, url, poster, hooks }) {
  const embed = item.url ? embedOf(item.url) : null;
  if (embed) {
    return {
      el: h('div.stage-fit.is-video', {}, h('div.embed', {}, h('iframe', { src: embed, title: item.title || 'Video', allow: 'accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen', allowfullscreen: true, referrerpolicy: 'strict-origin-when-cross-origin', loading: 'lazy' }))),
      tools: [h('a.key.mono', { href: item.url, target: '_blank', rel: 'noopener noreferrer' }, icon('out'), 'Open the video')],
      sync() {}, show() {}, destroy() {},
    };
  }
  const video = h('video', { src: url || item.url, controls: true, playsinline: true, preload: 'metadata', poster: poster || null, 'aria-label': item.title || 'Video' });
  const stamp = h('span', {}, 'Note at 0:00');
  const mark = h('button.key.mono', { type: 'button', onclick: () => {
    video.pause();
    const t = Math.round(video.currentTime * 10) / 10;
    hooks.ask({ type: 'time', t }, 'At ' + clock(t), 'Your note will point at this moment.');
  } }, icon('clock'), stamp);
  video.addEventListener('timeupdate', () => { stamp.textContent = 'Note at ' + clock(video.currentTime); });
  return {
    el: h('div.stage-fit.is-video', {}, video),
    hint: 'Pause where you want to say something, then press “Note at…”.',
    tools: [mark],
    sync() {},
    show(note) {
      if (note.anchor?.type !== 'time') return;
      video.currentTime = note.anchor.t;
      video.pause();
      video.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    },
    destroy() { video.pause(); video.removeAttribute('src'); video.load(); },
  };
}

// --- Websites: the live site in a desktop, tablet or phone frame ----------------------------------------------------------
const DEVICES = {
  desktop: { label: 'Desktop', w: 1440, h: 900, icon: 'desktop' },
  tablet: { label: 'Tablet', w: 820, h: 1180, icon: 'tablet' },
  phone: { label: 'Phone', w: 390, h: 844, icon: 'phone' },
};
function siteViewer({ item, hooks }) {
  let device = innerWidth < 700 ? 'phone' : 'desktop', turned = false;
  let host = item.url;
  try { host = new URL(item.url).host; } catch { /* shown as typed */ }
  const frame = h('iframe', { src: item.url, title: `${item.title || host}, live preview`, loading: 'lazy', referrerpolicy: 'no-referrer', sandbox: 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox' });
  const bar = h('div.device-bar', { 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('span.mono', {}, host));
  const body = h('div.device', {}, bar, h('div.device-screen', {}, frame));
  const sizer = h('div.device-sizer', {}, body);
  const stage = h('div.stage-fit.is-site', {}, sizer);
  const readout = h('span.mono.stage-readout');
  const keys = Object.fromEntries(Object.entries(DEVICES).map(([id, d]) => [id, key(d.label, d.icon, { 'aria-pressed': 'false', onclick: () => { device = id; turned = false; layout(); } })]));
  const turn = key('Rotate', 'rotate', { onclick: () => { turned = !turned; layout(); } });

  function layout() {
    const d = DEVICES[device];
    const w = turned ? d.h : d.w, hgt = turned ? d.w : d.h;
    const chrome = device === 'desktop' ? 38 : 0, pad = device === 'desktop' ? 0 : 14;
    const fullW = w + pad * 2, fullH = hgt + chrome + pad * 2;
    const cs = getComputedStyle(stage);
    const availW = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 2, availH = Math.max(320, Math.min(innerHeight * (innerWidth < 900 ? 0.72 : 0.78), 1100));
    const scale = Math.min(1, availW / fullW, availH / fullH);
    body.dataset.device = device;
    body.style.width = fullW + 'px'; body.style.height = fullH + 'px';
    body.style.transform = `scale(${scale})`;
    frame.style.width = w + 'px'; frame.style.height = hgt + 'px';
    sizer.style.width = Math.round(fullW * scale) + 'px'; sizer.style.height = Math.round(fullH * scale) + 'px';
    for (const [id, k] of Object.entries(keys)) k.setAttribute('aria-pressed', String(id === device));
    turn.disabled = device === 'desktop';
    readout.textContent = `${w} × ${hgt} · ${Math.round(scale * 100)}%`;
  }
  const ro = 'ResizeObserver' in window ? new ResizeObserver(layout) : null;
  ro?.observe(stage);
  addEventListener('resize', layout);
  return {
    el: stage,
    hint: 'This is the live site. If the frame stays empty, the site doesn’t allow previews: open it in a new tab instead.',
    tools: [h('div.key-group', { role: 'group', 'aria-label': 'Device' }, Object.values(keys)), turn, readout,
      key('Note on this view', 'note', { onclick: () => hooks.ask({ type: 'device', device }, DEVICES[device].label + ' view', 'Your note will say which device you were looking at.') })],
    mounted: layout,
    sync() {},
    show(note) { if (note.anchor?.type === 'device' && DEVICES[note.anchor.device]) { device = note.anchor.device; turned = false; layout(); stage.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } },
    destroy() { ro?.disconnect(); removeEventListener('resize', layout); frame.src = 'about:blank'; },
  };
}

// --- 3D models: loaded on demand, since the viewer is the heaviest thing here ---------------------------------------------
function modelViewer({ item, url, hooks }) {
  const status = h('p.stage-status.mono', { role: 'status' }, h('span.led', { 'aria-hidden': 'true' }), 'Loading the model');
  const mount = h('div.model-mount');
  const stage = h('div.stage-fit.is-model', {}, mount, status);
  const readout = h('span.mono.stage-readout');
  let viewer = null, dead = false;
  const spin = key('Spin', 'rotate', { 'aria-pressed': 'false', onclick: () => { if (!viewer) return; const on = spin.getAttribute('aria-pressed') !== 'true'; spin.setAttribute('aria-pressed', String(on)); viewer.setSpin(on); } });
  const wire = key('Wireframe', 'grid', { 'aria-pressed': 'false', onclick: () => { if (!viewer) return; const on = wire.getAttribute('aria-pressed') !== 'true'; wire.setAttribute('aria-pressed', String(on)); viewer.setWireframe(on); } });
  const tools = [
    key('Reset view', 'eye', { onclick: () => viewer?.reset() }), spin, wire, readout,
    key('Note on this view', 'note', { onclick: () => { if (viewer) hooks.ask({ type: 'view', view: viewer.getView() }, 'This view', 'Your note will bring people back to this angle.'); } }),
  ];
  return {
    el: stage,
    hint: 'Drag to turn, scroll or pinch to zoom, right-drag or two fingers to move.',
    tools,
    async mounted() {
      try {
        const { mountModel } = await import('../viewers/model3d.js');
        if (dead) return;
        viewer = await mountModel(mount, { url, ext: extOf(item.meta?.name || item.path || ''), label: item.title || '3D model' });
        if (dead) { viewer.destroy(); return; }
        status.remove();
        const s = viewer.size;
        readout.textContent = s ? `${s.x} × ${s.y} × ${s.z}${viewer.unit ? ' ' + viewer.unit : ''}` : '';
      } catch (err) {
        console.error(err);
        status.textContent = err?.message?.startsWith('This') ? err.message : 'This model couldn’t be shown here. Try downloading it instead.';
        status.classList.add('is-error');
      }
    },
    sync() {},
    show(note) { if (note.anchor?.type === 'view' && viewer) { viewer.setView(note.anchor.view); stage.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } },
    destroy() { dead = true; viewer?.destroy(); },
  };
}

// --- Files and written notes --------------------------------------------------------------------------------------------
function fileViewer({ item, url }) {
  const name = item.meta?.name || 'File';
  const pdf = /pdf$/i.test(item.meta?.type || '') || /\.pdf$/i.test(name);
  if (pdf && url && innerWidth >= 760) {
    return { el: h('div.stage-fit.is-doc', {}, h('iframe.doc', { src: url, title: item.title || name })), tools: [h('a.key.mono', { href: url, target: '_blank', rel: 'noopener' }, icon('out'), 'Open in a new tab')], sync() {}, show() {}, destroy() {} };
  }
  return {
    el: h('div.stage-fit.is-file', {}, h('div.file-plate', {}, icon(KIND.file.icon, 'plate-icon'), h('p.display.file-name', {}, name), h('p.mono', {}, [extOf(name).toUpperCase(), bytes(item.meta?.size)].filter(Boolean).join(' · ')),
      pdf && url ? h('a.btn.btn-line', { href: url, target: '_blank', rel: 'noopener' }, 'Open the PDF', h('span.btn-arrow', { 'aria-hidden': 'true' }, '→')) : null)),
    tools: [], sync() {}, show() {}, destroy() {},
  };
}
function textViewer({ item }) {
  return { el: h('div.stage-fit.is-text', {}, h('article.text-sheet', {}, h('p.mono.owner-note-label', {}, h('span.led', { 'aria-hidden': 'true' }), 'Note'), prose(item.description || '', 'prose text-body'))), tools: [], sync() {}, show() {}, destroy() {} };
}

export function makeViewer(args) {
  const kind = args.item.kind;
  if ((kind === 'image' || kind === 'model' || (kind === 'video' && !args.item.url) || kind === 'file') && !args.url) {
    return { el: h('div.stage-fit.is-file', {}, h('div.file-plate', {}, icon('file', 'plate-icon'), h('p.display.file-name', {}, 'This file isn’t available.'), h('p.hint', {}, 'It may have been replaced. Try reloading the page.'))), tools: [], sync() {}, show() {}, destroy() {} };
  }
  if (kind === 'image') return imageViewer(args);
  if (kind === 'video') return videoViewer(args);
  if (kind === 'site') return siteViewer(args);
  if (kind === 'model') return modelViewer(args);
  if (kind === 'text') return textViewer(args);
  return fileViewer(args);
}
