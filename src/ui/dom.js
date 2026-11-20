// Small DOM helpers. Everything a visitor or the owner typed reaches the page as text, never as markup.

export const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// h('button.key.mono', { type: 'button', onclick }, 'Label')
export function h(tag, props, ...kids) {
  const [name, ...cls] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (cls.length) el.className = cls.join(' ');
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = (el.className ? el.className + ' ' : '') + v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'style') for (const [p, val] of Object.entries(v)) { if (p.startsWith('--')) el.style.setProperty(p, val); else el.style[p] = val; }
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'hidden' || k === 'muted' || k === 'indeterminate') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  add(el, kids);
  return el;
}
export function add(el, kids) {
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false || kid === '') continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
export const clear = el => { el.replaceChildren(); return el; };

// Line icons, drawn on a 20-unit grid in the stroke the main site's skill icons use.
const ICONS = {
  arrow: '<path d="M4 10h12M11 5l5 5-5 5"/>',
  back: '<path d="M16 10H4M9 5l-5 5 5 5"/>',
  up: '<path d="M10 16V4M5 9l5-5 5 5"/>',
  down: '<path d="M10 4v12M5 11l5 5 5-5"/>',
  out: '<path d="M8 4H4v12h12v-4M11 3h6v6M17 3l-8 8"/>',
  download: '<path d="M10 3v10M5.5 9l4.5 4.5L14.5 9M4 16.5h12"/>',
  close: '<path d="M5 5l10 10M15 5L5 15"/>',
  plus: '<path d="M10 4v12M4 10h12"/>',
  check: '<path d="M4 10.5l4 4 8-9"/>',
  pin: '<path d="M10 17s5-4.6 5-8.5a5 5 0 0 0-10 0C5 12.4 10 17 10 17z"/><circle cx="10" cy="8.5" r="1.6"/>',
  clock: '<circle cx="10" cy="10" r="6.5"/><path d="M10 6.5V10l2.5 1.5"/>',
  cube: '<path d="M10 2.5l6.5 3.7v7.6L10 17.5l-6.5-3.7V6.2z"/><path d="M3.5 6.2L10 10l6.5-3.8M10 10v7.5"/>',
  image: '<rect x="3" y="4" width="14" height="12" rx="1.5"/><path d="M3 13l3.5-3.5 3 3 2.5-2.5 5 5"/><circle cx="13" cy="7.5" r="1.2"/>',
  video: '<rect x="3" y="4" width="14" height="12" rx="1.5"/><path d="M8.5 7.5v5l4.5-2.5z"/>',
  site: '<rect x="2.5" y="4" width="15" height="12" rx="1.5"/><path d="M2.5 7.5h15M5 5.8h.01M7 5.8h.01"/>',
  file: '<path d="M5.5 2.5h6l3.5 3.5v11.5h-9.5z"/><path d="M11.5 2.5V6H15M8 10h4.5M8 13h4.5"/>',
  text: '<path d="M4 5h12M4 9h12M4 13h8"/>',
  desktop: '<rect x="2.5" y="3.5" width="15" height="10" rx="1.2"/><path d="M7.5 17h5M10 13.5V17"/>',
  tablet: '<rect x="4.5" y="2.5" width="11" height="15" rx="1.5"/><path d="M9.5 15h1"/>',
  phone: '<rect x="6" y="2.5" width="8" height="15" rx="1.5"/><path d="M9.5 15h1"/>',
  rotate: '<path d="M16 10a6 6 0 1 1-2-4.5M16 3v3.5h-3.5"/>',
  trash: '<path d="M4 6h12M8 6V4h4v2M6 6l.7 10.5h6.6L14 6M8.5 9v4.5M11.5 9v4.5"/>',
  edit: '<path d="M4 16l.7-3.3L13.5 4l2.5 2.5-8.8 8.8z"/><path d="M12 5.5l2.5 2.5"/>',
  copy: '<rect x="7" y="7" width="9.5" height="9.5" rx="1.5"/><path d="M4.5 13H3.5V3.5H13v1"/>',
  key: '<circle cx="6.5" cy="13.5" r="3"/><path d="M8.7 11.3L16 4M13 7l2.5 2.5"/>',
  note: '<path d="M4 4h12v9.5H9.5L6 16.5v-3H4z"/>',
  eye: '<path d="M2.5 10S5.5 5 10 5s7.5 5 7.5 5-3 5-7.5 5-7.5-5-7.5-5z"/><circle cx="10" cy="10" r="2.2"/>',
  upload: '<path d="M10 13.5V3.5M5.5 8L10 3.5 14.5 8M4 16.5h12"/>',
  grid: '<path d="M3 7h14M3 13h14M7 3v14M13 3v14"/>',
  play: '<path d="M6.5 4.5v11l9-5.5z"/>',
  pause: '<path d="M6.5 4.5v11M13.5 4.5v11"/>',
  lock: '<rect x="4.5" y="9" width="11" height="8" rx="1.5"/><path d="M7 9V6.5a3 3 0 0 1 6 0V9"/>',
};
export function icon(name, cls = '') {
  const t = document.createElement('template');
  t.innerHTML = `<svg class="icon ${cls}" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">${ICONS[name] || ''}</svg>`;
  return t.content.firstChild;
}

// Text a person wrote, with line breaks kept and web addresses made into links.
export function prose(text, cls = 'prose') {
  const el = h('div', { class: cls });
  const parts = String(text || '').split(/(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]])/g);
  parts.forEach((part, i) => {
    if (i % 2) el.append(h('a', { href: part, target: '_blank', rel: 'noopener noreferrer nofollow' }, part.replace(/^https?:\/\//, '')));
    else if (part) el.append(part);
  });
  return el;
}

// --- Messages ----------------------------------------------------------------------------------------------------
export function toast(message, kind = 'ok') {
  const box = document.getElementById('toasts');
  const el = h('div.toast', { class: kind === 'error' ? 'is-error' : '' }, h('span.led', { 'aria-hidden': 'true' }), h('span', {}, message));
  box.append(el);
  setTimeout(() => { el.classList.add('is-out'); setTimeout(() => el.remove(), 400); }, kind === 'error' ? 6000 : 3200);
}

// A modal dialog. `build(close)` returns its content; the promise settles with whatever close() is given.
export function dialog({ title, label, build, wide = false, dismiss = true }) {
  return new Promise(resolve => {
    const dlg = h('dialog.dialog', { class: wide ? 'is-wide' : '', 'aria-label': title });
    let done = false;
    const close = value => { if (done) return; done = true; dlg.close(); dlg.remove(); resolve(value); };
    const head = h('div.dialog-head', {},
      h('div', {}, label ? h('p.mono.dialog-label', {}, label) : null, h('h2.display.dialog-title', {}, title)),
      h('button.key.key-icon', { type: 'button', 'aria-label': 'Close', onclick: () => close(undefined) }, icon('close')));
    dlg.append(h('div.dialog-body', {}, head, build(close)));
    dlg.addEventListener('cancel', e => { e.preventDefault(); if (dismiss) close(undefined); });
    dlg.addEventListener('click', e => { if (e.target === dlg && dismiss) close(undefined); });
    document.body.append(dlg);
    dlg.showModal();
  });
}
export function confirm({ title, body, action = 'Confirm', danger = false, label }) {
  return dialog({
    title, label,
    build: close => h('div', {},
      body ? h('p.dialog-text', {}, body) : null,
      h('div.dialog-actions', {},
        h('button.btn.btn-line', { type: 'button', onclick: () => close(false) }, 'Cancel'),
        h('button.btn', { class: danger ? 'btn-danger' : 'btn-royal', type: 'button', autofocus: true, onclick: () => close(true) }, action))),
  }).then(Boolean);
}

export async function copy(text, done = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
    toast(done);
  } catch {
    // No clipboard permission (an older browser, or a page not served securely): show the text to copy by hand.
    await dialog({ title: 'Copy this', build: () => h('textarea.field-input.copy-box', { readonly: true, rows: 4, value: text, onfocus: e => e.target.select() }) });
  }
}

// --- Formatting --------------------------------------------------------------------------------------------------
export function bytes(n) {
  if (!n && n !== 0) return '';
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
  return (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + ' MB';
}
export function clock(t) {
  t = Math.max(0, Math.floor(t || 0));
  const m = Math.floor(t / 60), s = t % 60, hh = Math.floor(m / 60);
  return (hh ? hh + ':' + String(m % 60).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
}
export function ago(iso) {
  if (!iso) return '';
  const d = new Date(iso), s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' h ago';
  if (s < 604800) return Math.floor(s / 86400) + ' d ago';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}
export const day = iso => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');
export const pad2 = n => String(n).padStart(2, '0');
export const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));

export const KIND = {
  image: { label: 'Image', icon: 'image' },
  video: { label: 'Video', icon: 'video' },
  model: { label: '3D model', icon: 'cube' },
  site: { label: 'Website', icon: 'site' },
  file: { label: 'File', icon: 'file' },
  text: { label: 'Note', icon: 'text' },
};
