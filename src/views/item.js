// One item, opened: the thing itself on a stage, and beside it its title, the owner's notes, and the thread of
// notes on it. Left and right step through the space's items in order.
import { h, icon, prose, toast, bytes, KIND } from '../ui/dom.js';
import { makeViewer } from './viewers.js';
import { createThread } from './notes.js';
import { applyChange } from './space.js';

export async function itemView(ctx, { slug, itemId, data }) {
  const { client, sections, items, comments } = data;
  const ordered = sections.flatMap(s => items.filter(i => i.section_id === s.id));
  const at = ordered.findIndex(i => i.id === itemId);
  const item = ordered[at];
  if (!item) {
    return {
      kind: 'gate', title: 'Not found', header: { tag: client.name },
      el: h('section.wrap.gate', {}, h('div.placard.gate-copy', {},
        h('p.label.mono', {}, h('span.led', { 'aria-hidden': 'true' }), 'Not here'),
        h('h1.display.gate-title', {}, 'That item has moved.'),
        h('p.lede', {}, 'It may have been replaced or taken down. Everything current is in the space.'),
        h('div.actions', {}, h('a.btn.btn-royal', { href: '/' + slug }, 'Back to ' + client.name)))),
    };
  }
  const section = sections.find(s => s.id === item.section_id);
  const prev = ordered[at - 1], next = ordered[at + 1];
  const kind = KIND[item.kind] || KIND.file;
  const mine = () => comments.filter(c => c.item_id === item.id);

  const wanted = [item.path, item.meta?.thumb].filter(Boolean);
  const urls = wanted.length ? await ctx.api.fileUrls(wanted) : new Map();
  const url = item.path ? urls.get(item.path) : null;

  let thread;
  const viewer = makeViewer({
    item, url, poster: urls.get(item.meta?.thumb),
    hooks: {
      ask: (anchor, label, hint) => thread.setPending({ anchor, label, hint }),
      pick: id => thread.highlight(id),
    },
  });
  thread = createThread({
    ctx, client, itemId: item.id,
    list: mine,
    onChange: change => { applyChange(comments, change); if (change.added) viewer.posted?.(); viewer.sync(mine()); },
    onAnchor: (note, what) => { if (what === 'cancel') viewer.cancel?.(); else viewer.show(note); },
    empty: `No notes on this yet. Tell ${ctx.owner} what you think.`,
  });
  viewer.sync(mine());

  async function download(e) {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const name = item.meta?.name || 'download';
      const link = await ctx.api.fileUrl(item.path, { download: name });
      if (!link) throw new Error('That file isn’t available right now.');
      const a = h('a', { href: link, download: name, rel: 'noopener' });
      document.body.append(a); a.click(); a.remove();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  }

  const actions = [
    item.path && item.allow_download ? h('button.btn.btn-line.btn-small', { type: 'button', onclick: download }, icon('download'), 'Download', item.meta?.size ? h('span.btn-meta.mono', {}, bytes(item.meta.size)) : null) : null,
    item.kind === 'site' ? h('a.btn.btn-royal.btn-small', { href: item.url, target: '_blank', rel: 'noopener noreferrer' }, 'Open the live site', h('span.btn-arrow', { 'aria-hidden': 'true' }, '↗')) : null,
  ].filter(Boolean);

  const stage = h('div.stage', { style: { viewTransitionName: 'stage' } }, viewer.el);
  const el = h('div.item', {},
    h('div.item-bar.wrap', {},
      h('a.key.mono', { href: '/' + slug, 'data-restore': true, onclick: e => { e.preventDefault(); e.stopPropagation(); ctx.back('/' + slug); } }, icon('back'), section?.title || client.name),
      h('span.mono.item-count', {}, `${at + 1} / ${ordered.length}`),
      h('div.key-group', {},
        prev ? h('a.key.key-icon', { href: `/${slug}/${prev.id}`, 'aria-label': 'Previous: ' + (prev.title || 'item'), rel: 'prev' }, icon('back')) : h('span.key.key-icon.is-off', { 'aria-hidden': 'true' }, icon('back')),
        next ? h('a.key.key-icon', { href: `/${slug}/${next.id}`, 'aria-label': 'Next: ' + (next.title || 'item'), rel: 'next' }, icon('arrow')) : h('span.key.key-icon.is-off', { 'aria-hidden': 'true' }, icon('arrow')))),
    h('div.item-grid.wrap', {},
      h('div.item-main', {},
        stage,
        viewer.tools.length ? h('div.stage-tools', {}, viewer.tools) : null,
        viewer.hint ? h('p.hint.stage-hint', {}, viewer.hint) : null),
      h('aside.item-side', {},
        h('div.placard', {},
          h('p.label.mono', {}, icon(kind.icon), kind.label, section ? h('span.label-count', {}, section.title) : null),
          h('h1.display.item-title', {}, item.title || kind.label),
          item.description && item.kind !== 'text' ? prose(item.description, 'prose item-desc') : null,
          item.notes ? h('aside.owner-note.is-small', {}, h('p.mono.owner-note-label', {}, h('span.led', { 'aria-hidden': 'true' }), 'From ' + ctx.owner), prose(item.notes)) : null,
          actions.length ? h('div.actions.item-actions', {}, actions) : null),
        thread.el)));

  function keys(e) {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('dialog[open]')) return;
    const t = e.target;
    if (t.closest?.('input, textarea, select, video, [contenteditable]')) return;
    if (e.key === 'ArrowLeft' && prev) ctx.go(`/${slug}/${prev.id}`);
    else if (e.key === 'ArrowRight' && next) ctx.go(`/${slug}/${next.id}`);
    else if (e.key === 'Escape') ctx.back('/' + slug);
  }

  return {
    el, kind: 'item', title: `${item.title || kind.label} · ${client.name}`,
    header: { tag: client.name, tools: ctx.me.isAdmin ? [h('a.key.mono', { href: '/admin/' + client.id }, icon('edit'), 'Edit')] : [] },
    mounted() { addEventListener('keydown', keys); viewer.mounted?.(); },
    destroy() { removeEventListener('keydown', keys); viewer.destroy(); },
  };
}
