// Shared by both data sources: codes, addresses, and what kind of thing a file is.

// Codes are drawn from letters and digits that can't be mistaken for each other when read aloud or copied by hand.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const s = [...bytes].map(b => ALPHABET[b % 32]).join('');
  return s.slice(0, 4) + '-' + s.slice(4);
}
export const codeKey = code => String(code || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
// "k7m29qxd" as "K7M2-9QXD" while it is typed; longer codes the owner chose are left as typed.
export function tidyCode(raw) {
  const s = String(raw || '').toUpperCase().replace(/[^A-Z0-9-]/g, '');
  const k = s.replace(/-/g, '');
  return k.length <= 8 ? (k.length > 4 ? k.slice(0, 4) + '-' + k.slice(4) : k) : s;
}

export const RESERVED = ['admin', 'demo', 'assets', 'css', 'js', 'fonts', 'index', '404'];
export const slugify = name => String(name || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
export const slugOk = slug => /^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/.test(slug);

const EXT = {
  image: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'svg'],
  video: ['mp4', 'webm', 'mov', 'm4v'],
  model: ['glb', 'gltf', 'stl', 'obj', '3mf', 'ply'],
};
export const extOf = name => (/\.([a-z0-9]+)$/i.exec(name || '') || [, ''])[1].toLowerCase();
export function kindOf(name) {
  const ext = extOf(name);
  return Object.keys(EXT).find(k => EXT[k].includes(ext)) || 'file';
}
export const ACCEPT = [...EXT.image, ...EXT.video, ...EXT.model].map(e => '.' + e).join(',');
// A file's name as a title: "logo_v2-final.png" reads "Logo v2 final".
export function titleOf(name) {
  const s = String(name || '').replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : 'Untitled';
}
// Storage keys keep to plain characters.
export const safeName = name => String(name || 'file').normalize('NFKD').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(-80) || 'file';

// A video on YouTube or Vimeo as the address its player embeds; anything else is played as a file.
export function embedOf(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') return 'https://www.youtube-nocookie.com/embed/' + u.pathname.slice(1);
    if (host === 'youtube.com' || host === 'm.youtube.com') {
      const id = u.searchParams.get('v') || (/^\/(?:shorts|embed|live)\/([\w-]+)/.exec(u.pathname) || [])[1];
      if (id) return 'https://www.youtube-nocookie.com/embed/' + id;
    }
    if (host === 'vimeo.com') {
      const m = /^\/(\d+)(?:\/([\da-f]+))?/.exec(u.pathname);
      if (m) return 'https://player.vimeo.com/video/' + m[1] + (m[2] ? '?h=' + m[2] : '');
    }
    if (host === 'player.vimeo.com') return u.href;
  } catch { /* not an address */ }
  return null;
}
export function webUrl(raw) {
  let s = String(raw || '').trim();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch { return null; }
}

export const byPosition = (a, b) => a.position - b.position || String(a.created_at).localeCompare(String(b.created_at));

// An error worth showing to a person.
export class PortalError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}
