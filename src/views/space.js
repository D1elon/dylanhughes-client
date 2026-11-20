// A client's space: the owner's welcome and notes, then each section with its items as cards, then a thread for
// notes on the space as a whole. Laid out like the main site's pages: a title block per section, numbered.
import { h, icon, prose, ago, confirm, toast, KIND, pad2 } from '../ui/dom.js';
import { reveal, spy } from '../ui/motion.js';
import { createThread } from './notes.js';

// What a card shows for an item: its picture if it has one, otherwise a plate for its kind.
export function thumbPath(item) {
  return item.meta?.thumb || (item.kind === 'image' ? item.path : null);
}
export function cardMedia(item, url) {
  const kind = KIND[item.kind] || KIND.file;
  const badge = h('span.card-kind.mono', {}, icon(kind.icon), kind.label);
  if (url) {
    return h('span.card-media', { 'data-kind': item.kind },
      h('img', { src: url, alt: '', loading: 'lazy', decoding: 'async' }),
      item.kind === 'video' ? h('span.card-play', { 'aria-hidden': 'true' }, icon('play')) : null,
      badge);
  }
  let plate;
  if (item.kind === 'site') {
    let host = item.url || '';
    try { host = new URL(item.url).host.replace(/^www\./, ''); } catch { /* shown as typed */ }
    plate = h('span.plate.plate-site', { 'aria-hidden': 'true' }, h('span.plate-bar', {}, h('i'), h('i'), h('i'), h('span.mono', {}, host)), h('span.plate-lines', {}, h('i'), h('i'), h('i')));
  } else if (item.kind === 'text') {
    plate = h('span.plate.plate-text', { 'aria-hidden': 'true' }, (item.description || item.title || '').slice(0, 180));
  } else {
    const ext = (item.meta?.name || '').split('.').pop();
    plate = h('span.plate', { 'aria-hidden': 'true' }, icon(kind.icon, 'plate-icon'), ext && ext.length < 6 ? h('span.mono', {}, '.' + ext) : null);
  }
  return h('span.card-media.is-plate', { 'data-kind': item.kind }, plate, badge);
}

export async function spaceView(ctx, { slug, data }) {
  const { client, sections, items, comments } = data;
  const paths = items.map(thumbPath).filter(Boolean);
  const urls = paths.length ? await ctx.api.fileUrls(paths) : new Map();
  const notesOn = id => comments.filter(c => c.item_id === id).length;
  const latest = [client.updated_at, ...items.map(i => i.created_at), ...comments.map(c => c.created_at)].filter(Boolean).sort().pop();

  function card(item, n) {
    const count = notesOn(item.id);
    const a = h('a.card', { href: `/${slug}/${item.id}`, 'data-reveal': true },
      cardMedia(item, urls.get(thumbPath(item))),
      h('span.card-text', {},
        h('span.card-title.display', {}, item.title || KIND[item.kind]?.label || 'Untitled'),
        item.description && item.kind !== 'text' ? h('span.card-desc', {}, item.description) : null,
        h('span.card-foot.mono', {}, h('span', {}, pad2(n)), count ? h('span.card-notes', {}, icon('note'), count === 1 ? '1 note' : count + ' notes') : null, h('span.card-open', { 'aria-hidden': 'true' }, 'Open ', h('span.btn-arrow', {}, '→')))));
    // The picture carries over into the viewer, where the browser can animate it.
    a.addEventListener('click', () => { const m = a.querySelector('.card-media'); if (m) m.style.viewTransitionName = 'stage'; });
    return a;
  }

  const shown = sections.filter(s => items.some(i => i.section_id === s.id) || s.title || s.description || s.notes);
  const index = shown.length > 1 ? h('nav.index', { 'aria-label': 'Sections', 'data-rise': true, style: { '--i': 3 } },
    h('ol', {}, shown.map((s, n) => h('li', {}, h('a.mono', { href: '#s-' + s.id }, h('span.index-n', {}, pad2(n + 1)), s.title || 'Section ' + (n + 1)))))) : null;

  const thread = createThread({
    ctx, client, itemId: null,
    list: () => comments.filter(c => !c.item_id),
    onChange: change => applyChange(comments, change),
    title: 'Notes on this space',
    empty: `Nothing yet. Leave ${ctx.owner} a note about the project as a whole, or open an item to comment on it.`,
  });

  const el = h('div.space', {},
    h('section.space-hero.wrap', {},
      h('div.placard', {},
        h('p.label.mono', { 'data-rise': true }, h('span.led', { 'aria-hidden': 'true' }), 'Private space', latest ? h('span.label-count', {}, 'Updated ' + ago(latest)) : null),
        h('h1.display.hero-title', { 'data-rise': true, style: { '--i': 1 } }, client.name),
        client.intro ? prose(client.intro, 'prose lede hero-lede') : null,
        client.notes ? h('aside.owner-note', { 'data-rise': true, style: { '--i': 2 } }, h('p.mono.owner-note-label', {}, h('span.led', { 'aria-hidden': 'true' }), 'From ' + ctx.owner), prose(client.notes)) : null,
        index)),
    h('div.stations', {},
      shown.length ? shown.map((s, n) => {
        const mine = items.filter(i => i.section_id === s.id);
        let k = 0;
        return h('section.station.wrap', { id: 's-' + s.id, 'aria-labelledby': 'h-' + s.id },
          h('div.placard', {},
            h('p.label.mono', {}, h('span.label-n', {}, pad2(n + 1)), 'Section', h('span.label-count', {}, mine.length === 1 ? '1 item' : mine.length + ' items')),
            h('div.station-head', {},
              h('h2.display.station-title', { id: 'h-' + s.id, 'data-reveal': true }, s.title || 'Section ' + (n + 1)),
              h('div.station-copy', { 'data-reveal': true },
                s.description ? prose(s.description, 'prose station-desc') : null,
                s.notes ? h('aside.owner-note.is-small', {}, h('p.mono.owner-note-label', {}, h('span.led', { 'aria-hidden': 'true' }), 'From ' + ctx.owner), prose(s.notes)) : null))),
          mine.length ? h('ul.cards', { 'data-count': Math.min(mine.length, 5) }, mine.map(i => h('li', {}, card(i, ++k)))) : h('p.empty', { 'data-reveal': true }, 'Nothing in this section yet.'));
      }) : h('section.station.wrap', {}, h('div.placard', {}, h('p.label.mono', {}, h('span.label-n', {}, '01'), 'Coming soon'), h('p.empty', {}, `Nothing here yet. ${ctx.owner} is still setting this space up.`))),
      h('section.station.wrap.station-notes', { id: 'notes' },
        h('div.placard', {}, h('p.label.mono', {}, h('span.label-n', {}, pad2(Math.max(shown.length, 1) + 1)), 'Notes'),
          h('div.station-head', {}, h('h2.display.station-title', { 'data-reveal': true }, 'Anything else?'), h('div.station-copy', { 'data-reveal': true }, thread.el))))));

  const tools = ctx.me.isAdmin
    ? [h('a.key.mono', { href: '/admin/' + client.id }, icon('edit'), 'Edit')]
    : [h('button.key.mono', { type: 'button', onclick: async () => {
        if (!(await confirm({ title: 'Close this space?', body: 'It will be closed on this device. You will need your code to open it again.', action: 'Close it' }))) return;
        try { await ctx.api.leave(client.id); ctx.spaces.delete(slug); await ctx.refreshMe(); ctx.go('/' + slug, { replace: true }); } catch (err) { toast(err.message, 'error'); }
      } }, icon('lock'), 'Lock')];

  let stop = [];
  return {
    el, kind: 'space', title: client.name,
    header: { tag: client.name, tools },
    mounted() {
      stop = [reveal(el), spy([...el.querySelectorAll('.index a')], [...el.querySelectorAll('.station[id^="s-"]')])];
    },
    destroy() { stop.forEach(f => f()); },
  };
}

// Keeps the remembered list of notes in step with what a thread just did.
export function applyChange(comments, { added, removed }) {
  if (added) comments.push(added);
  if (removed) { const i = comments.findIndex(c => c.id === removed.id); if (i >= 0) comments.splice(i, 1); }
}
