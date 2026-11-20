// Editing one space: what is in it (sections and items), the notes people have left, and who can get in (address,
// code, pause, delete). Text saves itself when you leave a field; everything else saves as you do it.
import { h, add, clear, icon, toast, dialog, confirm, copy, ago, day, bytes, uuid, pad2, KIND } from '../ui/dom.js';
import { adminTools } from './admin.js';
import { createThread } from './notes.js';
import { applyChange, thumbPath } from './space.js';
import { newCode, tidyCode, codeKey, slugify, slugOk, RESERVED, ACCEPT, titleOf, safeName, webUrl, embedOf, byPosition } from '../data/util.js';
import { prepare } from '../data/media.js';

const LIMIT = 50 * 1024 * 1024;
const field = (label, input, hint) => { const id = input.id || (input.id = 'f-' + uuid().slice(0, 8)); return h('div.field', {}, h('label.field-label.mono', { for: id }, label), input, hint ? h('p.hint', {}, hint) : null); };

export async function adminClient(ctx, { id, tab: firstTab }) {
  const data = await ctx.api.client(id);
  if (!data) {
    return {
      kind: 'gate', title: 'Not found', header: { tag: 'Admin', tools: adminTools(ctx) },
      el: h('section.wrap.gate', {}, h('div.placard.gate-copy', {}, h('p.label.mono', {}, h('span.led', { 'aria-hidden': 'true' }), 'Not here'), h('h1.display.gate-title', {}, 'That space is gone.'), h('div.actions', {}, h('a.btn.btn-royal', { href: '/admin' }, 'All spaces')))),
    };
  }
  let { client } = data;
  const { sections, items, comments, visitors } = data;
  const host = location.host.replace(/^www\./, '');
  const origin = location.origin;
  let tab = ['content', 'notes', 'access'].includes(firstTab) ? firstTab : 'content';
  const thumbs = new Map();
  const wantThumbs = items.map(thumbPath).filter(Boolean);
  if (wantThumbs.length) for (const [k, v] of await ctx.api.fileUrls(wantThumbs)) thumbs.set(k, v);
  // The client's copy of this space is out of date the moment anything here changes.
  const stale = () => ctx.spaces.delete(client.slug);

  // --- Saving ---
  const state = h('span.mono.save-state', { role: 'status' }, 'All changes saved');
  let pending = 0;
  async function saving(promise) {
    pending++; state.textContent = 'Saving…'; state.dataset.state = 'busy';
    try { const out = await promise; stale(); return out; }
    catch (err) { toast(err.message || 'That didn’t save. Try again.', 'error'); throw err; }
    finally { if (--pending === 0) { state.textContent = 'All changes saved'; state.dataset.state = ''; } }
  }
  // A text field that saves when you leave it, if it changed.
  function autosave(input, get, set) {
    input.value = get() || '';
    input.addEventListener('change', () => { const v = input.value.trim(); if (v !== (get() || '')) saving(set(v)).catch(() => { input.value = get() || ''; }); });
    return input;
  }
  const area = (rows, placeholder) => h('textarea.field-input', { rows, placeholder });

  // --- Content -------------------------------------------------------------------------------------------------
  const sectionsBox = h('div.editor-sections');
  const itemsOf = s => items.filter(i => i.section_id === s.id).sort(byPosition);

  async function move(list, rows, row, by) {
    const at = rows.indexOf(row), to = at + by;
    if (to < 0 || to >= rows.length) return;
    rows.splice(at, 1); rows.splice(to, 0, row);
    rows.forEach((r, n) => { r.position = n + 1; });
    drawSections();
    await saving(ctx.api.reorder(list, rows.map(r => ({ id: r.id, position: r.position })))).catch(() => {});
  }

  function itemRow(section, item, rows) {
    const kind = KIND[item.kind] || KIND.file;
    const url = thumbs.get(thumbPath(item));
    const notes = comments.filter(c => c.item_id === item.id && !c.is_owner && !c.resolved).length;
    const at = rows.indexOf(item);
    return h('li.editor-item', {},
      h('span.editor-thumb', { 'data-kind': item.kind }, url ? h('img', { src: url, alt: '', loading: 'lazy' }) : icon(kind.icon)),
      h('button.editor-item-main', { type: 'button', onclick: () => editItem(item) },
        h('span.editor-item-title', {}, item.title || kind.label),
        h('span.mono.editor-item-meta', {}, [kind.label, item.meta?.size ? bytes(item.meta.size) : null, item.kind === 'site' || (item.kind === 'video' && item.url) ? (item.url || '').replace(/^https?:\/\//, '').replace(/\/$/, '') : null, notes ? (notes === 1 ? '1 open note' : notes + ' open notes') : null].filter(Boolean).join(' · '))),
      h('span.key-group', {},
        h('button.key.key-icon.key-small', { type: 'button', 'aria-label': 'Move up', disabled: at === 0, onclick: () => move('items', rows, item, -1) }, icon('up')),
        h('button.key.key-icon.key-small', { type: 'button', 'aria-label': 'Move down', disabled: at === rows.length - 1, onclick: () => move('items', rows, item, 1) }, icon('down')),
        h('button.key.key-icon.key-small', { type: 'button', 'aria-label': 'Edit ' + (item.title || kind.label), onclick: () => editItem(item) }, icon('edit')),
        h('button.key.key-icon.key-small', { type: 'button', 'aria-label': 'Delete ' + (item.title || kind.label), onclick: () => removeItem(item) }, icon('trash'))));
  }

  async function removeItem(item) {
    if (!(await confirm({ title: 'Delete this item?', body: `“${item.title || 'Untitled'}” and the notes on it will be removed for everyone.`, action: 'Delete', danger: true }))) return;
    await saving(ctx.api.deleteItem(item)).catch(() => null);
    items.splice(items.indexOf(item), 1);
    for (let n = comments.length - 1; n >= 0; n--) if (comments[n].item_id === item.id) comments.splice(n, 1);
    drawSections(); drawTabs();
  }

  function editItem(item) {
    const kind = KIND[item.kind] || KIND.file;
    return dialog({
      title: item.title || kind.label, label: 'Edit ' + kind.label.toLowerCase(), wide: true,
      build: close => {
        const title = h('input.field-input', { type: 'text', maxlength: 160, value: item.title || '', autofocus: true });
        const desc = h('textarea.field-input', { rows: item.kind === 'text' ? 8 : 3, value: item.description || '' });
        const notes = h('textarea.field-input', { rows: 3, value: item.notes || '' });
        const url = item.kind === 'site' || (item.kind === 'video' && item.url) ? h('input.field-input.mono', { type: 'text', inputmode: 'url', autocapitalize: 'none', spellcheck: 'false', value: item.url || '' }) : null;
        const allow = item.path ? h('input', { type: 'checkbox', checked: item.allow_download !== false }) : null;
        const cover = item.kind !== 'image' && item.kind !== 'text' ? h('input.field-file', { type: 'file', accept: 'image/*' }) : null;
        const problem = h('p.field-error', { role: 'alert', hidden: true });
        const submit = h('button.btn.btn-royal', { type: 'submit' }, 'Save');
        return h('form.form', { onsubmit: async e => {
          e.preventDefault();
          const changes = { title: title.value.trim(), description: desc.value.trim(), notes: notes.value.trim() };
          if (url) { const u = webUrl(url.value); if (!u) { problem.textContent = 'That doesn’t look like a web address.'; problem.hidden = false; url.focus(); return; } changes.url = u; }
          if (allow) changes.allow_download = allow.checked;
          submit.disabled = true;
          try {
            if (cover?.files[0]) {
              const prep = await prepare(cover.files[0], {});
              const path = `${client.id}/${item.id}/cover-${Date.now()}.${prep.thumb ? 'webp' : (cover.files[0].name.split('.').pop() || 'jpg').toLowerCase()}`;
              await ctx.api.upload(path, prep.thumb || prep.blob, { type: prep.thumb ? 'image/webp' : prep.type });
              if (item.meta?.thumb) ctx.api.removeFiles([item.meta.thumb]).catch(() => {});
              changes.meta = { ...item.meta, thumb: path };
              const link = await ctx.api.fileUrl(path);
              if (link) thumbs.set(path, link);
            }
            Object.assign(item, await saving(ctx.api.updateItem(item.id, changes)));
            drawSections();
            close(true);
          } catch (err) { problem.textContent = err.message; problem.hidden = false; submit.disabled = false; }
        } },
          field('Title', title),
          url ? field(item.kind === 'site' ? 'Website address' : 'Video address', url) : null,
          field(item.kind === 'text' ? 'Text' : 'Description', desc, item.kind === 'text' ? 'What the client reads. Line breaks are kept and web addresses become links.' : 'Shown on the card and beside the item.'),
          field('Note from you', notes, 'Set apart from the description, signed with your name. Good for “check this one carefully”.'),
          cover ? field('Card picture', cover, item.meta?.thumb ? 'Choose a picture to replace the current one.' : 'Optional. What the card shows before the item is opened.') : null,
          allow ? h('label.check', {}, allow, h('span', {}, 'Let people download the file')) : null,
          problem,
          h('div.dialog-actions', {}, h('button.btn.btn-line', { type: 'button', onclick: () => close() }, 'Cancel'), submit));
      },
    });
  }

  // Website previews, video links and written notes: things added by typing rather than uploading.
  function addTyped(section, kind) {
    const copyFor = {
      site: { title: 'Website preview', label: 'Add to ' + (section.title || 'section'), url: 'Website address', hint: 'The live site, shown in desktop, tablet and phone frames. A few sites refuse to be shown inside another page; those get an “open the live site” button instead.', placeholder: 'https://example.com' },
      video: { title: 'Video link', label: 'Add to ' + (section.title || 'section'), url: 'Video address', hint: 'A YouTube or Vimeo link (unlisted works), or a direct link to a video file. Use this for films over 50 MB.', placeholder: 'https://youtu.be/…' },
      text: { title: 'Written note', label: 'Add to ' + (section.title || 'section') },
    }[kind];
    return dialog({
      title: copyFor.title, label: copyFor.label,
      build: close => {
        const url = kind === 'text' ? null : h('input.field-input.mono', { type: 'text', inputmode: 'url', autocapitalize: 'none', spellcheck: 'false', placeholder: copyFor.placeholder, required: true, autofocus: true });
        const title = h('input.field-input', { type: 'text', maxlength: 160, placeholder: kind === 'text' ? 'What happens next' : 'Optional', autofocus: kind === 'text' });
        const text = kind === 'text' ? h('textarea.field-input', { rows: 7, required: true }) : null;
        const problem = h('p.field-error', { role: 'alert', hidden: true });
        const submit = h('button.btn.btn-royal', { type: 'submit' }, 'Add');
        return h('form.form', { onsubmit: async e => {
          e.preventDefault();
          const row = { client_id: client.id, section_id: section.id, kind, position: itemsOf(section).length + 1, title: title.value.trim() };
          if (url) {
            row.url = webUrl(url.value);
            if (!row.url) { problem.textContent = 'That doesn’t look like a web address.'; problem.hidden = false; url.focus(); return; }
            if (kind === 'video' && !embedOf(row.url) && !/\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(row.url)) { problem.textContent = 'Use a YouTube or Vimeo link, or a direct link to a video file.'; problem.hidden = false; url.focus(); return; }
            if (!row.title) row.title = kind === 'site' ? new URL(row.url).host.replace(/^www\./, '') : 'Video';
          } else {
            row.description = text.value.trim();
            if (!row.description) { text.focus(); return; }
            if (!row.title) row.title = 'Note';
          }
          submit.disabled = true;
          try { items.push(await saving(ctx.api.createItem(row))); drawSections(); close(true); }
          catch (err) { problem.textContent = err.message; problem.hidden = false; submit.disabled = false; }
        } },
          url ? field(copyFor.url, url, copyFor.hint) : null,
          field('Title', title),
          text ? field('Text', text, 'Line breaks are kept and web addresses become links.') : null,
          problem,
          h('div.dialog-actions', {}, h('button.btn.btn-line', { type: 'button', onclick: () => close() }, 'Cancel'), submit));
      },
    });
  }

  let strip = true;
  try { strip = localStorage.getItem('portal-strip') !== '0'; } catch { /* default on */ }
  async function uploadFiles(section, files, box) {
    for (const file of files) {
      const bar = h('span.upload-bar', {}, h('i'));
      const note = h('span.mono', {}, 'Getting ready');
      const row = h('li.upload', {}, h('span.upload-name', {}, file.name), note, bar);
      box.append(row);
      if (file.size > LIMIT) { note.textContent = 'Over 50 MB: add it as a video link instead'; row.classList.add('is-error'); setTimeout(() => row.remove(), 9000); continue; }
      const itemId = uuid(), base = `${client.id}/${itemId}`;
      const done = [];
      try {
        const prep = await prepare(file, { strip });
        const path = `${base}/${safeName(file.name)}`;
        note.textContent = 'Uploading';
        await ctx.api.upload(path, prep.blob, { type: prep.type, onProgress: p => { bar.firstChild.style.transform = `scaleX(${p})`; note.textContent = 'Uploading ' + Math.round(p * 100) + '%'; } });
        done.push(path);
        let thumb = null;
        if (prep.thumb) { thumb = `${base}/thumb.webp`; await ctx.api.upload(thumb, prep.thumb, { type: 'image/webp' }); done.push(thumb); }
        const item = await saving(ctx.api.createItem({ id: itemId, client_id: client.id, section_id: section.id, kind: prep.kind, title: titleOf(file.name), path, meta: { ...prep.meta, ...(thumb ? { thumb } : {}) }, position: itemsOf(section).length + 1 }));
        items.push(item);
        const want = thumbPath(item);
        if (want) { const link = await ctx.api.fileUrl(want); if (link) thumbs.set(want, link); }
        row.remove();
        drawSections();
      } catch (err) {
        ctx.api.removeFiles(done).catch(() => {});
        note.textContent = err.message || 'That didn’t upload';
        row.classList.add('is-error');
        setTimeout(() => row.remove(), 9000);
      }
    }
  }

  function sectionCard(section, n) {
    const rows = itemsOf(section);
    const uploads = h('ul.uploads', { 'aria-live': 'polite' });
    const picker = h('input', { type: 'file', multiple: true, hidden: true, onchange: e => { const files = [...e.target.files]; e.target.value = ''; uploadFiles(section, files, uploads); } });
    const el = h('article.editor-section', { 'data-section': section.id },
      h('header.editor-section-head', {},
        h('span.label-n.mono', {}, pad2(n + 1)),
        autosave(h('input.field-input.title-input.display', { type: 'text', maxlength: 160, placeholder: 'Section title', 'aria-label': 'Section title' }), () => section.title, v => ctx.api.updateSection(section.id, { title: v }).then(r => Object.assign(section, r))),
        h('span.key-group', {},
          h('button.key.key-icon.key-small', { type: 'button', 'aria-label': 'Move section up', disabled: n === 0, onclick: () => move('sections', sections, section, -1) }, icon('up')),
          h('button.key.key-icon.key-small', { type: 'button', 'aria-label': 'Move section down', disabled: n === sections.length - 1, onclick: () => move('sections', sections, section, 1) }, icon('down')),
          h('button.key.key-icon.key-small', { type: 'button', 'aria-label': 'Delete section', onclick: async () => {
            if (!(await confirm({ title: 'Delete this section?', body: rows.length ? `“${section.title || 'Untitled'}” and the ${rows.length === 1 ? 'item' : rows.length + ' items'} in it will be removed for everyone.` : 'It is empty.', action: 'Delete', danger: true }))) return;
            await saving(ctx.api.deleteSection(section)).catch(() => null);
            sections.splice(sections.indexOf(section), 1);
            for (let k = items.length - 1; k >= 0; k--) if (items[k].section_id === section.id) items.splice(k, 1);
            drawSections();
          } }, icon('trash')))),
      h('div.editor-fields', {},
        field('Description', autosave(area(2, 'What is in this section'), () => section.description, v => ctx.api.updateSection(section.id, { description: v }).then(r => Object.assign(section, r)))),
        field('Note from you', autosave(area(2, 'Optional: anything to look out for'), () => section.notes, v => ctx.api.updateSection(section.id, { notes: v }).then(r => Object.assign(section, r))))),
      rows.length ? h('ul.editor-items', {}, rows.map(i => itemRow(section, i, rows))) : h('p.hint.editor-empty', {}, 'Nothing here yet. Upload files, or drop them onto this section.'),
      uploads,
      h('div.add-row', {},
        picker,
        h('button.btn.btn-royal.btn-small', { type: 'button', onclick: () => picker.click() }, icon('upload'), 'Upload files'),
        h('button.key.mono', { type: 'button', onclick: () => addTyped(section, 'site') }, icon('site'), 'Website'),
        h('button.key.mono', { type: 'button', onclick: () => addTyped(section, 'video') }, icon('video'), 'Video link'),
        h('button.key.mono', { type: 'button', onclick: () => addTyped(section, 'text') }, icon('text'), 'Written note')));
    // Files dropped on a section go into it.
    let depth = 0;
    el.addEventListener('dragenter', e => { if (e.dataTransfer?.types.includes('Files')) { depth++; el.classList.add('is-drop'); } });
    el.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; el.classList.remove('is-drop'); } });
    el.addEventListener('dragover', e => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); });
    el.addEventListener('drop', e => { if (!e.dataTransfer?.files.length) return; e.preventDefault(); depth = 0; el.classList.remove('is-drop'); uploadFiles(section, [...e.dataTransfer.files], uploads); });
    return el;
  }
  function drawSections() {
    sections.sort(byPosition);
    clear(sectionsBox);
    add(sectionsBox, sections.map(sectionCard));
  }
  async function addSection() {
    const made = await saving(ctx.api.createSection(client.id, { title: '', position: sections.length + 1 })).catch(() => null);
    if (!made) return;
    sections.push(made);
    drawSections();
    sectionsBox.lastElementChild?.querySelector('.title-input')?.focus();
  }

  const stripBox = h('input', { type: 'checkbox', checked: strip, onchange: e => { strip = e.target.checked; try { localStorage.setItem('portal-strip', strip ? '1' : '0'); } catch { /* fine */ } } });
  const content = () => h('div.editor', {},
    h('section.editor-block', {},
      h('h2.mono.editor-heading', {}, 'Welcome'),
      h('div.editor-fields', {},
        field('Introduction', autosave(area(3, 'A line or two on what this space holds'), () => client.intro, v => ctx.api.updateClient(client.id, { intro: v }).then(r => { client = r; }))),
        field('Note from you', autosave(area(3, 'Optional: where things stand, what you need from them'), () => client.notes, v => ctx.api.updateClient(client.id, { notes: v }).then(r => { client = r; }))))),
    h('section.editor-block', {},
      h('div.editor-heading-row', {}, h('h2.mono.editor-heading', {}, 'Sections'), h('label.check.is-small', {}, stripBox, h('span', {}, 'Remove location and camera details from photos I upload'))),
      sectionsBox,
      h('button.btn.btn-line.add-section', { type: 'button', onclick: addSection }, icon('plus'), 'Add a section'),
      h('p.hint', {}, 'Pictures, films, 3D models (GLB, STL, OBJ, 3MF, PLY) and any other file, up to 50 MB each.')));

  // --- Notes ---------------------------------------------------------------------------------------------------
  function notesTab() {
    const groups = [{ id: null, title: 'On the space as a whole' }, ...sections.flatMap(s => itemsOf(s)).filter(i => comments.some(c => c.item_id === i.id)).map(i => ({ id: i.id, title: i.title || 'Untitled', item: i }))];
    const any = comments.length > 0;
    return h('div.editor', {},
      any ? null : h('div.empty-block', {}, h('p.display.empty-title', {}, 'No notes yet.'), h('p.hint', {}, 'When someone leaves a note on an item or on the space, it shows up here. You can still post one yourself below.')),
      groups.map(g => h('section.editor-block.notes-group', {},
        h('div.editor-heading-row', {}, h('h2.display.notes-group-title', {}, g.title), g.item ? h('a.key.mono', { href: `/${client.slug}/${g.item.id}` }, icon('eye'), 'Open') : null),
        createThread({ ctx, client, itemId: g.id, list: () => comments.filter(c => (c.item_id || null) === g.id), onChange: change => { applyChange(comments, change); stale(); drawTabs(); }, title: 'Notes', label: 'Notes: ' + g.title, compact: true, empty: 'Nothing here yet.' }).el)));
  }

  // --- Access --------------------------------------------------------------------------------------------------
  function accessTab() {
    const box = h('div.editor');
    const draw = async () => {
      const code = client.has_code ? await ctx.api.getCode(client.id).catch(() => null) : null;
      const link = `${origin}/${client.slug}`;
      const invite = () => `I’ve set up a private space for ${client.name}.\n\nOpen it here: ${link}\nYour code: ${code}\n\nOr use this link, which fills the code in for you:\n${link}#${code}`;

      async function setCode(next) {
        if (client.has_code && !(await confirm({ title: 'Change the code?', body: 'Everyone using the current code will be asked for the new one the next time they visit. Send it to them once it is changed.', action: 'Change it' }))) return;
        await saving(ctx.api.setCode(client.id, next)).catch(() => null);
        client = { ...client, has_code: true, code_set_at: new Date().toISOString() };
        toast('New code set');
        draw();
      }
      const custom = () => dialog({
        title: 'Choose a code', label: 'At least six letters or digits',
        build: close => {
          const input = h('input.field-input.gate-code', { type: 'text', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', maxlength: 40, autofocus: true, oninput: e => { e.target.value = tidyCode(e.target.value); } });
          return h('form.form', { onsubmit: e => { e.preventDefault(); if (codeKey(input.value).length < 6) { input.focus(); return; } close(input.value); } },
            field('Code', input, 'Capitals, spaces and dashes don’t matter when it is typed in. Short or guessable codes make a space easy to open: a generated one is safer.'),
            h('div.dialog-actions', {}, h('button.btn.btn-line', { type: 'button', onclick: () => close() }, 'Cancel'), h('button.btn.btn-royal', { type: 'submit' }, 'Use this code')));
        },
      }).then(v => { if (v) setCode(v); });

      const slug = h('input.field-input.mono', { type: 'text', maxlength: 40, autocapitalize: 'none', spellcheck: 'false', value: client.slug, 'aria-label': 'Address' });
      const name = autosave(h('input.field-input', { type: 'text', maxlength: 120 }), () => client.name, v => (v ? ctx.api.updateClient(client.id, { name: v }).then(r => { client = r; title.textContent = r.name; }) : Promise.reject(new Error('A space needs a name.'))));
      clear(box);
      add(box, [
        h('section.editor-block', {},
          h('h2.mono.editor-heading', {}, 'Code'),
          code
            ? h('div.code-card', {},
                h('p.code-value', { 'aria-label': 'The code is ' + code.split('').join(' ') }, code),
                h('p.hint', {}, `Set ${client.code_set_at ? day(client.code_set_at) : 'earlier'}. Anyone with the address and this code can open the space; it stays open on their device for 30 days.`),
                h('div.actions', {},
                  h('button.btn.btn-royal.btn-small', { type: 'button', onclick: () => copy(invite(), 'Invitation copied') }, icon('copy'), 'Copy an invitation'),
                  h('button.key.mono', { type: 'button', onclick: () => copy(`${link}#${code}`, 'Link copied') }, icon('copy'), 'Link with code'),
                  h('button.key.mono', { type: 'button', onclick: () => copy(code, 'Code copied') }, icon('copy'), 'Code only')))
            : h('div.code-card.is-empty', {},
                h('p.display.empty-title', {}, client.has_code ? 'A code is set.' : 'No code yet.'),
                h('p.hint', {}, client.has_code ? 'It was set before codes could be looked up again. Make a new one to see it here.' : 'Nobody can open this space until it has one.')),
          h('div.actions.code-actions', {},
            h('button.btn.btn-small', { class: code ? 'btn-line' : 'btn-royal', type: 'button', onclick: () => setCode(newCode()) }, icon('key'), code ? 'Make a new code' : 'Make a code'),
            h('button.key.mono', { type: 'button', onclick: custom }, 'Choose my own'),
            client.has_code ? h('button.key.mono', { type: 'button', onclick: async () => {
              if (!(await confirm({ title: 'Remove the code?', body: 'The space closes to everyone until you set a new one.', action: 'Remove it', danger: true }))) return;
              await saving(ctx.api.clearCode(client.id)).catch(() => null);
              client = { ...client, has_code: false, code_set_at: null };
              draw();
            } }, 'Remove') : null)),
        h('section.editor-block', {},
          h('h2.mono.editor-heading', {}, 'Name and address'),
          h('div.editor-fields', {},
            field('Name', name, 'What the client sees at the top of their space.'),
            h('div.field', {}, h('span.field-label.mono', {}, 'Address'),
              h('form.field-row', { onsubmit: async e => {
                e.preventDefault();
                const next = slugify(slug.value);
                if (next === client.slug) { slug.value = next; return; }
                if (!slugOk(next) || RESERVED.includes(next)) { toast('Use lowercase letters, digits and dashes for the address.', 'error'); return; }
                if (!(await confirm({ title: 'Change the address?', body: `Links to ${host}/${client.slug} will stop working. The code stays the same.`, action: 'Change it' }))) { slug.value = client.slug; return; }
                try { stale(); client = await saving(ctx.api.updateClient(client.id, { slug: next })); toast('Address changed'); draw(); } catch { slug.value = client.slug; }
              } }, h('div.field-affix', {}, h('span.mono', { 'aria-hidden': 'true' }, host + '/'), slug), h('button.key.mono', { type: 'submit' }, 'Save'))))),
        h('section.editor-block', {},
          h('h2.mono.editor-heading', {}, 'Who has opened it'),
          visitors.length
            ? h('ul.visitors', {}, visitors.map(v => h('li', {}, h('span.led', { 'aria-hidden': 'true' }), h('span', {}, v.display_name || 'Someone who hasn’t left a name'), h('span.mono', {}, v.created_at ? ago(v.created_at) : ''))))
            : h('p.hint', {}, 'Nobody yet.')),
        h('section.editor-block', {},
          h('h2.mono.editor-heading', {}, 'Pause or delete'),
          h('div.danger-row', {},
            h('div', {}, h('p.danger-title', {}, client.active ? 'Pause this space' : 'This space is paused'), h('p.hint', {}, client.active ? 'Hides it from everyone, code or not, until you open it again. Nothing is deleted.' : 'Nobody can open it, even with the code.')),
            h('button.key.mono', { type: 'button', 'aria-pressed': String(!client.active), onclick: async () => { try { client = await saving(ctx.api.updateClient(client.id, { active: !client.active })); draw(); } catch { /* shown already */ } } }, client.active ? 'Pause' : 'Open it again')),
          h('div.danger-row', {},
            h('div', {}, h('p.danger-title', {}, 'Delete this space'), h('p.hint', {}, 'Removes the space, every file in it and every note. This can’t be undone.')),
            h('button.key.mono.key-danger', { type: 'button', onclick: async () => {
              if (!(await confirm({ title: `Delete ${client.name}?`, body: 'The space, its files and its notes will be gone for good.', action: 'Delete the space', danger: true }))) return;
              try { await saving(ctx.api.deleteClient(client.id)); toast('Space deleted'); ctx.go('/admin', { replace: true }); } catch { /* shown already */ }
            } }, icon('trash'), 'Delete'))),
      ]);
    };
    draw();
    return box;
  }

  // --- The frame ---------------------------------------------------------------------------------------------------
  const title = h('h1.display.hero-title.admin-space-title', {}, client.name);
  const tabs = h('div.tabs', { role: 'tablist', 'aria-label': 'Parts of this space' });
  const panel = h('div.tab-panel', { role: 'tabpanel' });
  function drawTabs() {
    const open = comments.filter(c => !c.is_owner && !c.resolved).length;
    clear(tabs);
    for (const [idName, label, count] of [['content', 'Content'], ['notes', 'Notes', open], ['access', 'Access']]) {
      tabs.append(h('button.tab.mono', { type: 'button', role: 'tab', 'aria-selected': String(tab === idName), onclick: () => { tab = idName; history.replaceState({}, '', `/admin/${client.id}${idName === 'content' ? '' : '/' + idName}`); drawTabs(); drawPanel(); } }, label, count ? h('span.tab-count', {}, String(count)) : null));
    }
  }
  function drawPanel() {
    clear(panel);
    if (tab === 'content') { drawSections(); panel.append(content()); }
    else if (tab === 'notes') panel.append(notesTab());
    else panel.append(accessTab());
  }
  drawTabs(); drawPanel();

  const el = h('div.admin', {},
    h('section.wrap.admin-head', {},
      h('div.placard', {},
        h('p.label.mono', { 'data-rise': true }, h('a.back-link', { href: '/admin' }, icon('back'), 'All spaces'), h('span.label-count', {}, state)),
        h('div.admin-title-row', { 'data-rise': true, style: { '--i': 1 } },
          title,
          h('a.btn.btn-line', { href: '/' + client.slug, onclick: e => { e.preventDefault(); e.stopPropagation(); ctx.go('/' + client.slug); } }, icon('eye'), 'View as a client')),
        tabs)),
    h('section.wrap', {}, panel));

  return { el, kind: 'admin', title: client.name + ' · Admin', header: { tag: 'Admin', tools: adminTools(ctx) } };
}
