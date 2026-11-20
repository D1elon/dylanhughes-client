// The portal's shell: works out where the address points (the code gate, a client's space, one item in it, or the
// owner's admin), shows that view, and moves between views without reloading.
import { h, add, clear, toast, reduced } from './ui/dom.js';
import { pixels } from './ui/pixels.js';
import { getApi } from './data/index.js';
import { gateView } from './views/gate.js';
import { spaceView } from './views/space.js';
import { itemView } from './views/item.js';
import { adminHome, adminSignIn } from './views/admin.js';
import { adminClient } from './views/admin-client.js';

const view = document.getElementById('view');
const header = document.getElementById('header');
const config = window.PORTAL_CONFIG || {};

const ctx = {
  api: null,
  me: { userId: null, isAdmin: false, spaces: [] },
  config,
  owner: config.owner || 'Dylan',
  spaces: new Map(),   // slug -> what a space holds, kept so moving between a space and its items is instant
  go, back,
  async refreshMe() { ctx.me = await ctx.api.me(); return ctx.me; },
  // A space's contents, from memory if we have them and they are no older than `maxAge` seconds.
  async space(slug, { maxAge = Infinity } = {}) {
    const held = ctx.spaces.get(slug);
    if (held && (Date.now() - held.at) / 1000 < maxAge) return held;
    const data = await ctx.api.space(slug);
    if (data) { data.at = Date.now(); ctx.spaces.set(slug, data); } else ctx.spaces.delete(slug);
    return data;
  },
  // The name notes are signed with, per space.
  nameFor(clientId) {
    if (ctx.me.isAdmin) return ctx.owner;
    try { return localStorage.getItem('portal-name') || ctx.me.spaces.find(s => s.id === clientId)?.display_name || ''; } catch { return ''; }
  },
  rememberName(name) { try { localStorage.setItem('portal-name', name); } catch { /* fine */ } },
  header: setHeader,
};

// --- Where the address points ---------------------------------------------------------------------------------
function route(pathname) {
  const parts = pathname.replace(/\/+$/, '').split('/').filter(Boolean).map(p => { try { return decodeURIComponent(p); } catch { return p; } });
  if (!parts.length || parts[0] === 'index.html' || parts[0] === '404.html') return { name: 'home' };
  if (parts[0] === 'admin') return parts[1] ? { name: 'admin-client', id: parts[1], tab: parts[2] || 'content' } : { name: 'admin' };
  const slug = parts[0].toLowerCase();
  return parts[1] ? { name: 'item', slug, itemId: parts[1] } : { name: 'space', slug };
}

async function resolve(r, extra) {
  switch (r.name) {
    case 'home': return gateView(ctx, { ...extra });
    case 'admin': return ctx.me.isAdmin ? adminHome(ctx) : adminSignIn(ctx, { next: '/admin' });
    case 'admin-client': return ctx.me.isAdmin ? adminClient(ctx, r) : adminSignIn(ctx, { next: location.pathname });
    case 'space': {
      const data = await ctx.space(r.slug, { maxAge: 20 }); // going back from an item doesn't wait on the network
      return data ? spaceView(ctx, { slug: r.slug, data }) : gateView(ctx, { slug: r.slug, ...extra });
    }
    case 'item': {
      const data = await ctx.space(r.slug);
      if (!data) return gateView(ctx, { slug: r.slug, next: location.pathname, ...extra });
      return itemView(ctx, { slug: r.slug, itemId: r.itemId, data });
    }
    default: return gateView(ctx, {});
  }
}

// --- Showing a view --------------------------------------------------------------------------------------------
let current = null, turn = 0;
const scrolls = new Map();

function setHeader({ tag, tools = [] } = {}) {
  document.getElementById('header-tag').textContent = tag || 'Client portal';
  const box = clear(document.getElementById('header-tools'));
  if (ctx.api?.mode === 'demo') box.append(h('span.chip', { title: 'Nothing here is saved outside this browser' }, h('span.led', { 'aria-hidden': 'true' }), 'Demo'));
  add(box, tools);
}

// Working out the next view can take a moment (it may ask the database); putting it on the page is instant.
async function prepare(extra) {
  const mine = ++turn;
  const r = route(location.pathname);
  view.setAttribute('aria-busy', 'true');
  let next;
  try {
    next = await resolve(r, extra);
  } catch (e) {
    console.error(e);
    next = errorView(e);
  }
  if (mine !== turn) { next.destroy?.(); return null; }
  return { next, r };
}
function commit({ next, r }, { restore = false, focus = true } = {}) {
  loadedAt = Date.now();
  current?.destroy?.();
  current = next;
  setHeader(next.header);
  document.title = (next.title ? next.title + ' · ' : '') + 'Client portal · Dylan Hughes';
  document.documentElement.dataset.view = next.kind || r.name;
  clear(view).append(next.el);
  view.removeAttribute('aria-busy');
  scrollTo({ top: restore ? scrolls.get(location.pathname) || 0 : 0, behavior: 'instant' });
  next.mounted?.();
  if (focus) { const target = next.el.querySelector('[data-focus]') || next.el.querySelector('h1'); if (target) { target.tabIndex = -1; target.focus({ preventScroll: true }); } }
}
async function show({ extra, ...opts } = {}) {
  const p = await prepare(extra);
  if (p) commit(p, opts);
}

function errorView(e) {
  return {
    title: 'Something went wrong',
    el: h('section.wrap.gate', {}, h('div.placard.gate-copy', {},
      h('p.label.mono', {}, h('span.led', { 'aria-hidden': 'true' }), 'Not available'),
      h('h1.display.gate-title', {}, 'That didn’t open.'),
      h('p.lede', {}, e?.message || 'Something went wrong. Try again in a moment.'),
      h('div.actions', {}, h('button.btn.btn-royal', { type: 'button', onclick: () => show() }, 'Try again'), h('a.btn.btn-line', { href: '/' }, 'Back to the start')))),
  };
}

// Go to another address in the portal. `pixels` asks for the dot-matrix page change ({ x, y, name }).
async function go(path, { replace = false, extra, restore = false, pixels: px } = {}) {
  scrolls.set(location.pathname, scrollY);
  if (path !== location.pathname + location.hash) history[replace ? 'replaceState' : 'pushState']({}, '', path);
  if (px) { await pixels({ ...px, prepare: () => prepare(extra), commit: p => { if (p) commit(p, { restore }); } }); return; }
  const p = await prepare(extra);
  if (!p) return;
  if (!reduced() && document.startViewTransition) {
    try { await document.startViewTransition(() => commit(p, { restore })).updateCallbackDone; return; } catch { /* no transition: change plainly */ }
  }
  commit(p, { restore });
}
// Back to a listing from something opened out of it, returning to where the list was scrolled.
function back(path) { return go(path, { restore: true }); }

// A link can carry the code after a "#": it is used once and taken out of the address bar.
function takeCode() {
  const r = route(location.pathname);
  if (location.hash.length < 2 || (r.name !== 'space' && r.name !== 'item')) return undefined;
  let code = location.hash.slice(1);
  try { code = decodeURIComponent(code); } catch { /* used as it is */ }
  history.replaceState({}, '', location.pathname);
  return /^[A-Za-z0-9 -]{6,40}$/.test(code) && !code.startsWith('s-') ? { code } : undefined;
}
// Back and forward, and a link with a code pasted into a tab that is already on that space's gate.
addEventListener('popstate', () => { const extra = takeCode(); show({ extra, restore: !extra, focus: false }); });
document.addEventListener('click', e => {
  const a = e.target.closest?.('a[href]');
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.target === '_blank' || a.hasAttribute('download')) return;
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin || /\.[a-z0-9]{2,5}$/i.test(url.pathname)) return;
  e.preventDefault();
  if (url.pathname === location.pathname && url.hash) { document.getElementById(url.hash.slice(1))?.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth' }); return; }
  go(url.pathname + url.hash, { restore: a.hasAttribute('data-restore') });
});

// Coming back to the tab after a while, a space is fetched again so new notes and items are there, unless that would
// throw away something half-written.
let loadedAt = Date.now();
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || Date.now() - loadedAt < 45000) return;
  const r = route(location.pathname);
  if ((r.name !== 'space' && r.name !== 'item') || !ctx.spaces.has(r.slug)) return;
  if (document.querySelector('dialog[open], .px-canvas') || [...view.querySelectorAll('textarea')].some(t => t.value.trim()) || view.querySelector('.note-pending:not([hidden])')) return;
  const playing = view.querySelector('video'); if (playing && !playing.paused) return;
  loadedAt = Date.now();
  const before = JSON.stringify({ ...ctx.spaces.get(r.slug), at: 0 });
  try {
    const now = await ctx.api.space(r.slug);
    if (!now) { ctx.spaces.delete(r.slug); await ctx.refreshMe(); show({ focus: false }); return; }
    if (JSON.stringify({ ...now, at: 0 }) === before) { ctx.spaces.get(r.slug).at = Date.now(); return; }
    now.at = Date.now();
    ctx.spaces.set(r.slug, now);
    const y = scrollY;
    await show({ focus: false });
    scrollTo({ top: y, behavior: 'instant' });
  } catch { /* offline: what is on screen stays */ }
});

// The header picks up a hairline once the page has scrolled under it.
addEventListener('scroll', () => header.classList.toggle('is-scrolled', scrollY > 4), { passive: true });

// --- Start ---------------------------------------------------------------------------------------------------
(async () => {
  try {
    ctx.api = await getApi();
    await ctx.refreshMe();
  } catch (e) {
    console.error(e);
    if (!ctx.api) { clear(view).append(errorView(new Error('The portal couldn’t start. Check your connection and reload.')).el); return; }
  }
  if (config.home) document.getElementById('home-link').href = config.home;
  await show({ extra: takeCode() });
  window.addEventListener('unhandledrejection', e => { if (e.reason?.name === 'PortalError' || e.reason?.code) toast(e.reason.message, 'error'); });
})();
