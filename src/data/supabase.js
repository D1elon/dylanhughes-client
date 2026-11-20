// The portal on Supabase. A visitor's browser holds an anonymous session; the owner's holds an email-and-password
// one. Everything a session can see or change is decided by the database's rules (supabase/schema.sql), so nothing
// here needs to be trusted: this file only asks.
import { createClient } from '@supabase/supabase-js';
import { byPosition, PortalError } from './util.js';

const BUCKET = 'portal';
const SIGNED_FOR = 6 * 3600; // seconds a file link lasts

export function makeSupabase(config) {
  const sb = createClient(config.supabaseUrl, config.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'portal-session' },
  });
  const store = sb.storage.from(BUCKET);

  // Errors a person can act on, in words a person would use.
  function fail(error, fallback = 'Something went wrong. Try again.') {
    const msg = String(error?.message || '');
    if (error?.code === '23505') return new PortalError('That address is already taken.', 'slug');
    if (error?.code === '23514') return new PortalError('Use lowercase letters, digits and dashes for the address.', 'slug');
    if (/invalid login credentials/i.test(msg)) return new PortalError('That email and password don’t match.', 'auth');
    if (/anonymous sign-ins are disabled/i.test(msg)) return new PortalError('The portal isn’t finished being set up: anonymous sign-ins are off in Supabase.', 'setup');
    if (/failed to fetch|networkerror|load failed/i.test(msg)) return new PortalError('Can’t reach the portal. Check your connection and try again.', 'network');
    if (/rate limit|too many/i.test(msg)) return new PortalError('Too many tries just now. Wait a minute and try again.', 'rate');
    if (/payload too large|exceeded the maximum/i.test(msg)) return new PortalError('That file is over the 50 MB limit.', 'size');
    return new PortalError(msg && msg.length < 140 ? msg : fallback, error?.code);
  }
  const ok = ({ data, error }, fallback) => { if (error) throw fail(error, fallback); return data; };

  async function session() {
    const { data, error } = await sb.auth.getSession();
    if (error) throw fail(error);
    return data.session;
  }
  // A visitor gets a session the first time they try a code, not before: stray visits create nothing.
  async function ensureSession() {
    const s = await session();
    if (s) return s;
    return ok(await sb.auth.signInAnonymously()).session;
  }

  // --- Files ---
  const links = new Map(); // path -> { url, until }
  const fresh = path => { const l = links.get(path); return l && l.until > Date.now() ? l.url : null; };
  async function listFolder(prefix) {
    const { data } = await store.list(prefix, { limit: 100 });
    return (data || []).filter(f => f.id).map(f => `${prefix}/${f.name}`);
  }

  return {
    mode: 'live',
    async me() {
      const s = await session();
      if (!s) return { userId: null, isAdmin: false, spaces: [] };
      const { data, error } = await sb.rpc('portal_whoami');
      if (error) {
        // A session the server no longer knows (the account was removed): start clean.
        if (error.code === 'PGRST301' || /JWT|token/i.test(error.message || '')) { await sb.auth.signOut({ scope: 'local' }); return { userId: null, isAdmin: false, spaces: [] }; }
        throw fail(error);
      }
      return { userId: data.user_id, isAdmin: !!data.is_admin, spaces: data.spaces || [] };
    },
    async redeem(slug, code, name) {
      await ensureSession();
      const data = ok(await sb.rpc('portal_redeem', { p_slug: slug, p_code: code, p_name: name || null }));
      return data || { ok: false, error: 'invalid' };
    },
    async leave(clientId) {
      const s = await session();
      if (s) ok(await sb.from('portal_access').delete().eq('client_id', clientId).eq('user_id', s.user.id));
    },
    async setName(clientId, name) { ok(await sb.rpc('portal_set_name', { p_client: clientId, p_name: name })); },
    async signIn(email, password) {
      ok(await sb.auth.signInWithPassword({ email, password }));
      const me = await this.me();
      if (!me.isAdmin) { await sb.auth.signOut(); throw new PortalError('That account isn’t the portal’s owner.', 'auth'); }
      return me;
    },
    async signOut() { links.clear(); await sb.auth.signOut(); },

    async space(slug) {
      if (!(await session())) return null;
      const client = ok(await sb.from('portal_clients').select('*').eq('slug', slug).maybeSingle());
      if (!client) return null;
      const [sections, items, comments] = await Promise.all([
        sb.from('portal_sections').select('*').eq('client_id', client.id),
        sb.from('portal_items').select('*').eq('client_id', client.id),
        sb.from('portal_comments').select('*').eq('client_id', client.id).order('created_at'),
      ]);
      return { client, sections: ok(sections).sort(byPosition), items: ok(items).sort(byPosition), comments: ok(comments) };
    },
    async fileUrl(path, { download } = {}) {
      if (!path) return null;
      if (!download && fresh(path)) return fresh(path);
      const { data, error } = await store.createSignedUrl(path, SIGNED_FOR, download ? { download } : undefined);
      if (error) return null;
      if (!download) links.set(path, { url: data.signedUrl, until: Date.now() + (SIGNED_FOR - 600) * 1000 });
      return data.signedUrl;
    },
    async fileUrls(paths) {
      const out = new Map(), want = [];
      for (const p of new Set(paths.filter(Boolean))) { if (fresh(p)) out.set(p, fresh(p)); else want.push(p); }
      if (want.length) {
        const { data } = await store.createSignedUrls(want, SIGNED_FOR);
        for (const row of data || []) {
          if (!row.signedUrl || !row.path) continue;
          links.set(row.path, { url: row.signedUrl, until: Date.now() + (SIGNED_FOR - 600) * 1000 });
          out.set(row.path, row.signedUrl);
        }
      }
      return out;
    },
    async addComment({ client_id, item_id = null, body, anchor = null, author }) {
      return ok(await sb.from('portal_comments').insert({ client_id, item_id, body, anchor, author: author || '' }).select().single(), 'Your note wasn’t saved. Try again.');
    },
    async deleteComment(id) { ok(await sb.from('portal_comments').delete().eq('id', id)); },
    async resolveComment(id, resolved) { ok(await sb.from('portal_comments').update({ resolved }).eq('id', id)); },

    // --- The owner ---
    async clients() {
      const [clients, items, notes] = await Promise.all([
        sb.from('portal_clients').select('*').order('created_at', { ascending: false }),
        sb.from('portal_items').select('client_id'),
        sb.from('portal_comments').select('client_id').eq('is_owner', false).eq('resolved', false),
      ]);
      const count = (rows, id) => rows.filter(r => r.client_id === id).length;
      const i = ok(items), n = ok(notes);
      return ok(clients).map(c => ({ ...c, item_count: count(i, c.id), open_notes: count(n, c.id) }));
    },
    async client(id) {
      const client = ok(await sb.from('portal_clients').select('*').eq('id', id).maybeSingle());
      if (!client) return null;
      const [sections, items, comments, visitors] = await Promise.all([
        sb.from('portal_sections').select('*').eq('client_id', id),
        sb.from('portal_items').select('*').eq('client_id', id),
        sb.from('portal_comments').select('*').eq('client_id', id).order('created_at'),
        sb.from('portal_access').select('display_name, created_at, expires_at').eq('client_id', id).order('created_at'),
      ]);
      return { client, sections: ok(sections).sort(byPosition), items: ok(items).sort(byPosition), comments: ok(comments), visitors: ok(visitors) };
    },
    async createClient({ name, slug }) { return ok(await sb.from('portal_clients').insert({ name, slug }).select().single()); },
    async updateClient(id, changes) { return ok(await sb.from('portal_clients').update(changes).eq('id', id).select().single()); },
    async deleteClient(id) {
      // Files first: the rows that say where they are go with the space.
      const items = ok(await sb.from('portal_items').select('id').eq('client_id', id));
      const paths = (await Promise.all(items.map(i => listFolder(`${id}/${i.id}`)))).flat();
      if (paths.length) await store.remove(paths);
      ok(await sb.from('portal_clients').delete().eq('id', id));
    },
    async setCode(clientId, code) { ok(await sb.rpc('portal_set_code', { p_client: clientId, p_code: code })); },
    async getCode(clientId) { return ok(await sb.rpc('portal_get_code', { p_client: clientId })); },
    async clearCode(clientId) { ok(await sb.rpc('portal_clear_code', { p_client: clientId })); },

    async createSection(clientId, { title = '', position = 0 }) { return ok(await sb.from('portal_sections').insert({ client_id: clientId, title, position }).select().single()); },
    async updateSection(id, changes) { return ok(await sb.from('portal_sections').update(changes).eq('id', id).select().single()); },
    async deleteSection(section) {
      const items = ok(await sb.from('portal_items').select('id').eq('section_id', section.id));
      const paths = (await Promise.all(items.map(i => listFolder(`${section.client_id}/${i.id}`)))).flat();
      if (paths.length) await store.remove(paths);
      ok(await sb.from('portal_sections').delete().eq('id', section.id));
    },
    async createItem(item) { return ok(await sb.from('portal_items').insert(item).select().single()); },
    async updateItem(id, changes) { return ok(await sb.from('portal_items').update(changes).eq('id', id).select().single()); },
    async deleteItem(item) {
      const paths = await listFolder(`${item.client_id}/${item.id}`);
      if (paths.length) await store.remove(paths);
      ok(await sb.from('portal_items').delete().eq('id', item.id));
    },
    async reorder(list, rows) {
      const table = list === 'sections' ? 'portal_sections' : 'portal_items';
      const results = await Promise.all(rows.map(r => sb.from(table).update({ position: r.position }).eq('id', r.id)));
      results.forEach(r => ok(r));
    },
    // Straight to the storage endpoint, so the transfer's progress can be shown.
    async upload(path, blob, { type, onProgress } = {}) {
      const s = await session();
      if (!s) throw new PortalError('Sign in first.', 'auth');
      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${config.supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/${BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`);
        xhr.setRequestHeader('authorization', 'Bearer ' + s.access_token);
        xhr.setRequestHeader('apikey', config.supabaseKey);
        xhr.setRequestHeader('x-upsert', 'true');
        xhr.setRequestHeader('cache-control', 'max-age=3600');
        xhr.setRequestHeader('content-type', type || blob.type || 'application/octet-stream');
        xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) { resolve(); return; }
          let message = '';
          try { message = JSON.parse(xhr.responseText).message; } catch { /* not JSON */ }
          reject(fail({ message: xhr.status === 413 ? 'Payload too large' : message }, 'The upload didn’t go through. Try again.'));
        };
        xhr.onerror = () => reject(fail({ message: 'Failed to fetch' }));
        xhr.send(blob);
      });
      links.delete(path);
      return path;
    },
    async removeFiles(paths) {
      const list = paths.filter(Boolean);
      if (list.length) await store.remove(list);
      list.forEach(p => links.delete(p));
    },
  };
}
