// A thread of notes: on one item, or on a space as a whole. Clients write them; the owner replies, marks them done
// and can remove them. A note can point at something (a pin on a picture, a moment in a film, a view of a model, a
// device in a site preview), shown as a chip that takes you back to it.
import { h, clear, icon, prose, ago, toast, confirm, clock } from '../ui/dom.js';

export function anchorLabel(anchor, n) {
  if (!anchor) return null;
  if (anchor.type === 'pin') return { icon: 'pin', text: 'Pin ' + (n || '') };
  if (anchor.type === 'time') return { icon: 'clock', text: clock(anchor.t) };
  if (anchor.type === 'view') return { icon: 'cube', text: 'Saved view' };
  if (anchor.type === 'device') return { icon: anchor.device === 'phone' ? 'phone' : anchor.device === 'tablet' ? 'tablet' : 'desktop', text: anchor.device[0].toUpperCase() + anchor.device.slice(1) };
  return null;
}
// Pins are numbered in the order they were placed.
export function pinNumbers(comments) {
  const map = new Map();
  let n = 0;
  for (const c of comments) if (c.anchor?.type === 'pin') map.set(c.id, ++n);
  return map;
}

// `list()` returns the notes to show; `onChange` is told after any is added, removed or resolved.
export function createThread({ ctx, client, itemId = null, list, onChange, onAnchor, title = 'Notes', label, empty = 'No notes yet. Yours will be the first.', compact = false }) {
  const isOwner = ctx.me.isAdmin;
  let pending = null; // { anchor, label }
  const count = h('span.label-count');
  const items = h('ol.notes');
  const pendingChip = h('div.note-pending', { hidden: true });
  const body = h('textarea.field-input.note-input', { rows: 3, maxlength: 4000, placeholder: isOwner ? 'Reply or add a note…' : 'Write a note…', 'aria-label': 'Your note' });
  const nameInput = h('input.field-input', { type: 'text', maxlength: 60, autocomplete: 'name', placeholder: 'Your name', 'aria-label': 'Your name', value: ctx.nameFor(client.id) });
  const send = h('button.btn.btn-royal.btn-small', { type: 'submit' }, isOwner ? 'Post' : 'Send note');

  function setPending(p) {
    pending = p;
    clear(pendingChip);
    pendingChip.hidden = !p;
    if (p) {
      pendingChip.append(h('span.chip.is-live', {}, h('span.led', { 'aria-hidden': 'true' }), p.label),
        h('span.hint', {}, p.hint || 'Your note will point here.'),
        h('button.key.key-icon.key-small', { type: 'button', 'aria-label': 'Remove the pointer', onclick: () => { setPending(null); onAnchor?.(null, 'cancel'); } }, icon('close')));
      body.focus({ preventScroll: false });
    }
  }

  async function post(e) {
    e.preventDefault();
    const text = body.value.trim();
    if (!text) { body.focus(); return; }
    const author = isOwner ? ctx.owner : nameInput.value.trim();
    if (!isOwner && !author) { nameInput.focus(); toast('Add your name so ' + ctx.owner + ' knows who the note is from.', 'error'); return; }
    send.disabled = true;
    try {
      if (!isOwner && author !== ctx.nameFor(client.id)) { ctx.rememberName(author); ctx.api.setName(client.id, author).catch(() => {}); }
      const row = await ctx.api.addComment({ client_id: client.id, item_id: itemId, body: text, anchor: pending?.anchor || null, author });
      body.value = '';
      setPending(null);
      onChange?.({ added: row });
      render();
      items.lastElementChild?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } catch (err) {
      toast(err.message || 'Your note wasn’t saved. Try again.', 'error');
    } finally {
      send.disabled = false;
    }
  }

  function render() {
    const rows = list();
    const pins = pinNumbers(rows);
    const open = rows.filter(r => !r.resolved).length;
    count.textContent = rows.length ? (open === rows.length ? `${rows.length}` : `${open} open · ${rows.length - open} done`) : '';
    clear(items);
    if (!rows.length) { items.append(h('li.notes-empty', {}, empty)); return; }
    for (const row of rows) {
      const mine = row.user_id === ctx.me.userId;
      const a = anchorLabel(row.anchor, pins.get(row.id));
      const tools = [];
      if (isOwner && !row.is_owner) tools.push(h('button.key.key-small.mono', { type: 'button', 'aria-pressed': String(!!row.resolved), onclick: async () => {
        try { await ctx.api.resolveComment(row.id, !row.resolved); row.resolved = !row.resolved; onChange?.({ changed: row }); render(); } catch (err) { toast(err.message, 'error'); }
      } }, icon('check'), row.resolved ? 'Done' : 'Mark done'));
      if (isOwner || mine) tools.push(h('button.key.key-icon.key-small', { type: 'button', 'aria-label': 'Delete this note', onclick: async () => {
        if (!(await confirm({ title: 'Delete this note?', body: 'It will be removed for everyone.', action: 'Delete', danger: true }))) return;
        try { await ctx.api.deleteComment(row.id); onChange?.({ removed: row }); render(); } catch (err) { toast(err.message, 'error'); }
      } }, icon('trash')));
      items.append(h('li.note', { class: (row.is_owner ? 'is-owner ' : '') + (row.resolved ? 'is-done' : ''), 'data-note': row.id },
        h('div.note-head', {},
          h('span.note-author', {}, row.is_owner ? h('span.led', { 'aria-hidden': 'true' }) : null, row.author || 'Guest'),
          h('time.mono.note-time', { datetime: row.created_at, title: new Date(row.created_at).toLocaleString() }, ago(row.created_at)),
          row.resolved ? h('span.mono.note-done', {}, 'Done') : null),
        a ? h('button.chip.note-anchor', { type: 'button', onclick: () => onAnchor?.(row, 'show') }, icon(a.icon), a.text) : null,
        prose(row.body, 'prose note-body'),
        tools.length ? h('div.note-tools', {}, tools) : null));
    }
  }

  const form = h('form.note-form', { onsubmit: post },
    pendingChip,
    body,
    h('div.note-form-row', {}, isOwner ? h('span.hint', {}, 'Posting as ' + ctx.owner) : nameInput, send));
  body.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) form.requestSubmit(); });

  const el = h('section.thread', { class: compact ? 'is-compact' : '', 'aria-label': label || title },
    h('p.label.mono.thread-label', {}, icon('note'), title, count),
    items,
    form);
  render();
  return {
    el, render, setPending,
    highlight(id) {
      const li = items.querySelector(`[data-note="${CSS.escape(id)}"]`);
      if (!li) return;
      li.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      li.classList.remove('is-lit'); void li.offsetWidth; li.classList.add('is-lit');
    },
  };
}
