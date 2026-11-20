// The portal with no database behind it: everything is kept in this browser (rows in localStorage, uploaded files in
// IndexedDB), seeded with one sample space. It is what runs until js/config.js is filled in, so the whole thing can
// be tried, and it answers the same calls the Supabase source does.
import { codeKey, byPosition, PortalError, slugOk, RESERVED } from './util.js';
import { uuid } from '../ui/dom.js';

const KEY = 'portal-demo-v3';
const now = () => new Date().toISOString();
const past = days => new Date(Date.now() - days * 864e5).toISOString();
const wait = (ms = 160) => new Promise(r => setTimeout(r, ms));

function seed() {
  const c = 'c0000000-0000-4000-8000-000000000001';
  const s = n => `50000000-0000-4000-8000-00000000000${n}`;
  const i = n => `10000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
  const item = (n, section, kind, title, extra) => ({ id: i(n), client_id: c, section_id: s(section), kind, title, description: '', notes: '', path: null, url: null, meta: {}, allow_download: true, position: n, created_at: past(6), ...extra });
  const note = (n, itemId, author, owner, body, anchor, days, resolved = false) => ({ id: `n0000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`, client_id: c, item_id: itemId, user_id: owner ? 'owner' : 'guest-sam', author, is_owner: owner, body, anchor: anchor || null, resolved, created_at: past(days) });
  return {
    clients: [{
      id: c, slug: 'demo', name: 'Sample project', active: true, has_code: true, code_set_at: past(7), last_opened_at: past(1), created_at: past(8), updated_at: past(1),
      intro: 'Everything for the project in one place: photos, the 3D model, a film, the website preview and the documents. Open anything to look closer and leave a note on it.',
      notes: 'Round two is up. The 3D model is the one going to print, so that is the one to check carefully. Leave notes wherever something looks off and I will pick them up.',
    }],
    codes: { [c]: 'DEMO-2026' },
    sections: [
      { id: s(1), client_id: c, title: 'Photos and renders', description: 'The finished part, fitted and boxed, and two renders of the design.', notes: 'Tap a spot on any picture to pin a note to it.', position: 1, created_at: past(8) },
      { id: s(2), client_id: c, title: '3D model', description: 'The part itself. Turn it, zoom in, and save a note against the view you are looking at.', notes: '', position: 2, created_at: past(8) },
      { id: s(3), client_id: c, title: 'Film', description: 'A turntable of the finished pair.', notes: '', position: 3, created_at: past(8) },
      { id: s(4), client_id: c, title: 'Website preview', description: 'The live site, as it looks on a desktop, a tablet and a phone.', notes: 'Check the phone view in particular.', position: 4, created_at: past(8) },
      { id: s(5), client_id: c, title: 'Documents', description: '', notes: '', position: 5, created_at: past(8) },
    ],
    items: [
      item(1, 1, 'image', 'Fitted in the machine', { path: '/assets/demo/photo-fitted.webp', description: 'Both sides fitted, lit by the machine.', meta: { name: 'photo-fitted.webp', size: 265726, type: 'image/webp', w: 1600, h: 1200 } }),
      item(2, 1, 'image', 'Boxed and ready', { path: '/assets/demo/photo-box.webp', meta: { name: 'photo-box.webp', size: 255644, type: 'image/webp', w: 1600, h: 1200 } }),
      item(3, 1, 'image', 'Render: the pair', { path: '/assets/demo/render-pair.webp', notes: 'Colours here are close to the print, not exact.', meta: { name: 'render-pair.webp', size: 36304, type: 'image/webp', w: 1600, h: 1000 } }),
      item(4, 1, 'image', 'Render: cutaway', { path: '/assets/demo/render-cutaway.webp', meta: { name: 'render-cutaway.webp', size: 88812, type: 'image/webp', w: 1600, h: 1160 } }),
      item(5, 2, 'model', 'Mounting plate', { path: '/assets/demo/mounting-plate.stl', description: 'The plate that carries the spring, as it will be printed.', notes: 'Sizes are in millimetres.', meta: { name: 'mounting-plate.stl', size: 0, type: 'model/stl', thumb: '/assets/demo/mounting-plate.webp' } }),
      item(6, 3, 'video', 'Turntable', { path: '/assets/demo/turntable.mp4', meta: { name: 'turntable.mp4', size: 2286499, type: 'video/mp4', thumb: '/assets/demo/turntable-poster.jpg' } }),
      item(7, 4, 'site', 'dylanhughes.dev', { url: 'https://dylanhughes.dev/', description: 'The portfolio, live.' }),
      item(8, 5, 'file', 'Install guide', { path: '/assets/demo/install-guide.pdf', description: 'The guide that ships in the box.', meta: { name: 'install-guide.pdf', size: 715329, type: 'application/pdf' } }),
      item(9, 5, 'text', 'What happens next', { description: 'Once you are happy with the model I will print a test pair and send photos here. Allow a week for the print and the fit check.\n\nAnything urgent, message me directly.' }),
    ],
    comments: [
      note(1, i(1), 'Sam', false, 'Love how these sit. Is the left one slightly higher, or is that the camera?', { type: 'pin', x: 0.31, y: 0.52 }, 3),
      note(2, i(1), 'Dylan', true, 'Camera angle. They are level to within half a millimetre, I checked with the gauge.', null, 2.8),
      note(3, i(6), 'Sam', false, 'This angle would make a great thumbnail.', { type: 'time', t: 4 }, 2),
      note(4, null, 'Sam', false, 'Thanks for setting this up, much easier than digging through email.', null, 4, true),
    ],
    session: { userId: 'guest-' + uuid().slice(0, 8), admin: false, access: {} },
  };
}

// --- Rows --------------------------------------------------------------------------------------------------------
let db;
function load() {
  if (db) return db;
  try { db = JSON.parse(localStorage.getItem(KEY)); } catch { db = null; }
  if (!db || !db.clients) { db = seed(); save(); }
  return db;
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* private mode: lives for this visit only */ }
}

// --- Files -------------------------------------------------------------------------------------------------------
const urls = new Map();
let idb;
function files() {
  idb ||= new Promise((resolve, reject) => {
    const open = indexedDB.open('portal-demo', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('files');
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  return idb;
}
const memory = new Map(); // where IndexedDB is unavailable, files last for this visit
async function fileOp(mode, fn) {
  const store = (await files()).transaction('files', mode).objectStore('files');
  return new Promise((resolve, reject) => { const r = fn(store); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
}
async function putFile(path, blob) { memory.set(path, blob); try { await fileOp('readwrite', s => s.put(blob, path)); } catch { /* memory only */ } }
async function getFile(path) { if (memory.has(path)) return memory.get(path); try { return await fileOp('readonly', s => s.get(path)); } catch { return null; } }
async function dropFile(path) { memory.delete(path); urls.delete(path); try { await fileOp('readwrite', s => s.delete(path)); } catch { /* gone anyway */ } }

export function makeDemo() {
  load();
  const d = () => load();
  const admin = () => d().session.admin;
  const need = () => { if (!admin()) throw new PortalError('Sign in first.', 'auth'); };
  const allowed = id => admin() || (id in d().session.access && d().clients.find(c => c.id === id)?.active);
  const bundle = client => ({
    client: { ...client },
    sections: d().sections.filter(s => s.client_id === client.id).sort(byPosition).map(s => ({ ...s })),
    items: d().items.filter(i => i.client_id === client.id).sort(byPosition).map(i => ({ ...i })),
    comments: d().comments.filter(n => n.client_id === client.id).sort((a, b) => a.created_at.localeCompare(b.created_at)).map(n => ({ ...n })),
  });
  const patch = (list, id, changes) => { const row = d()[list].find(r => r.id === id); if (!row) throw new PortalError('That is no longer there.'); Object.assign(row, changes); save(); return { ...row }; };
  const checkSlug = (slug, selfId) => {
    if (!slugOk(slug) || RESERVED.includes(slug)) throw new PortalError('Use lowercase letters, digits and dashes for the address.', 'slug');
    if (d().clients.some(c => c.slug === slug && c.id !== selfId)) throw new PortalError('That address is already taken.', 'slug');
  };

  return {
    mode: 'demo',
    async me() {
      const s = d().session;
      return { userId: s.admin ? 'owner' : s.userId, isAdmin: s.admin, spaces: d().clients.filter(c => c.id in s.access && c.active).map(c => ({ id: c.id, slug: c.slug, name: c.name, display_name: s.access[c.id] || null })) };
    },
    async redeem(slug, code, name) {
      await wait(420);
      const client = d().clients.find(c => c.slug === String(slug).trim().toLowerCase());
      if (!client || !client.active || !d().codes[client.id] || codeKey(d().codes[client.id]) !== codeKey(code)) return { ok: false, error: 'invalid' };
      d().session.access[client.id] = name || d().session.access[client.id] || '';
      client.last_opened_at = now();
      save();
      return { ok: true, slug: client.slug, client_id: client.id };
    },
    async leave(clientId) { delete d().session.access[clientId]; save(); },
    async setName(clientId, name) { if (clientId in d().session.access) { d().session.access[clientId] = name; save(); } },
    async signIn(email, password) {
      await wait(380);
      if (!String(email).includes('@') || !password) throw new PortalError('Enter an email address and a password.');
      d().session.admin = true; save();
      return this.me();
    },
    async signOut() { d().session.admin = false; save(); },

    async space(slug) {
      await wait(120);
      const client = d().clients.find(c => c.slug === slug);
      return client && allowed(client.id) ? bundle(client) : null;
    },
    async fileUrl(path) {
      if (!path) return null;
      if (path.startsWith('/')) return path;
      if (!urls.has(path)) { const blob = await getFile(path); if (!blob) return null; urls.set(path, URL.createObjectURL(blob)); }
      return urls.get(path);
    },
    async fileUrls(paths) {
      const out = new Map();
      for (const p of paths) out.set(p, await this.fileUrl(p));
      return out;
    },
    async addComment({ client_id, item_id = null, body, anchor = null, author }) {
      await wait();
      if (!allowed(client_id)) throw new PortalError('This space is closed to you.');
      const s = d().session;
      const row = { id: uuid(), client_id, item_id, user_id: s.admin ? 'owner' : s.userId, author: s.admin ? 'Dylan' : (author || s.access[client_id] || 'Guest'), is_owner: s.admin, body: body.trim(), anchor, resolved: false, created_at: now() };
      d().comments.push(row); save();
      return { ...row };
    },
    async deleteComment(id) { d().comments = d().comments.filter(n => n.id !== id); save(); },
    async resolveComment(id, resolved) { need(); patch('comments', id, { resolved }); },

    // --- The owner ---
    async clients() {
      need(); await wait(120);
      return d().clients.map(c => ({ ...c, item_count: d().items.filter(i => i.client_id === c.id).length, open_notes: d().comments.filter(n => n.client_id === c.id && !n.is_owner && !n.resolved).length }))
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
    },
    async client(id) {
      need(); await wait(120);
      const client = d().clients.find(c => c.id === id);
      if (!client) return null;
      const s = d().session;
      return { ...bundle(client), visitors: id in s.access ? [{ display_name: s.access[id] || null, created_at: client.last_opened_at }] : [] };
    },
    async createClient({ name, slug }) {
      need(); checkSlug(slug);
      const row = { id: uuid(), slug, name, intro: '', notes: '', active: true, has_code: false, code_set_at: null, last_opened_at: null, created_at: now(), updated_at: now() };
      d().clients.push(row); save();
      return { ...row };
    },
    async updateClient(id, changes) { need(); if ('slug' in changes) checkSlug(changes.slug, id); return patch('clients', id, { ...changes, updated_at: now() }); },
    async deleteClient(id) {
      need();
      for (const i of d().items.filter(x => x.client_id === id)) await this.removeFiles([i.path, i.meta?.thumb]);
      for (const list of ['sections', 'items', 'comments']) d()[list] = d()[list].filter(r => r.client_id !== id);
      d().clients = d().clients.filter(c => c.id !== id);
      delete d().codes[id]; delete d().session.access[id];
      save();
    },
    async setCode(clientId, code) {
      need();
      if (codeKey(code).length < 6) throw new PortalError('A code needs at least six letters or digits.');
      d().codes[clientId] = code.trim().toUpperCase();
      // As in the real thing, a new code closes the space to everyone who used the old one.
      delete d().session.access[clientId];
      patch('clients', clientId, { has_code: true, code_set_at: now() });
    },
    async getCode(clientId) { need(); return d().codes[clientId] || null; },
    async clearCode(clientId) { need(); delete d().codes[clientId]; delete d().session.access[clientId]; patch('clients', clientId, { has_code: false, code_set_at: null }); },

    async createSection(clientId, { title = '', position = 0 }) {
      need();
      const row = { id: uuid(), client_id: clientId, title, description: '', notes: '', position, created_at: now() };
      d().sections.push(row); save();
      return { ...row };
    },
    async updateSection(id, changes) { need(); return patch('sections', id, changes); },
    async deleteSection(section) {
      need();
      for (const i of d().items.filter(x => x.section_id === section.id)) await this.deleteItem(i);
      d().sections = d().sections.filter(s => s.id !== section.id); save();
    },
    async createItem(item) {
      need();
      const row = { id: uuid(), title: '', description: '', notes: '', path: null, url: null, meta: {}, allow_download: true, position: 0, created_at: now(), ...item };
      d().items.push(row); save();
      return { ...row };
    },
    async updateItem(id, changes) { need(); return patch('items', id, changes); },
    async deleteItem(item) {
      need();
      await this.removeFiles([item.path, item.meta?.thumb]);
      d().items = d().items.filter(i => i.id !== item.id);
      d().comments = d().comments.filter(n => n.item_id !== item.id);
      save();
    },
    async reorder(list, rows) { need(); for (const r of rows) { const row = d()[list].find(x => x.id === r.id); if (row) row.position = r.position; } save(); },
    async upload(path, blob, { onProgress } = {}) {
      need();
      // A short pretend transfer, so the progress bar is seen working.
      for (let p = 0.2; p < 1; p += 0.2) { onProgress?.(p); await wait(70); }
      await putFile(path, blob);
      onProgress?.(1);
      return path;
    },
    async removeFiles(paths) { for (const p of paths) if (p && !p.startsWith('/')) await dropFile(p); },
    // Demo only: back to the sample space as first seen.
    async reset() { localStorage.removeItem(KEY); db = null; try { indexedDB.deleteDatabase('portal-demo'); } catch { /* fine */ } idb = null; memory.clear(); urls.clear(); load(); },
  };
}
