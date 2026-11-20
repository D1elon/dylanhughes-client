// The owner's side: signing in, and the list of spaces. Editing one space is in admin-client.js.
import { h, icon, toast, dialog, ago, day } from '../ui/dom.js';
import { reveal } from '../ui/motion.js';
import { slugify, slugOk, RESERVED } from '../data/util.js';

export function adminTools(ctx) {
  return [
    h('button.key.mono', { type: 'button', onclick: async () => {
      try { await ctx.api.signOut(); } catch { /* signed out locally regardless */ }
      ctx.spaces.clear();
      await ctx.refreshMe().catch(() => {});
      ctx.go('/admin', { replace: true });
    } }, 'Sign out'),
  ];
}

export async function adminSignIn(ctx, { next = '/admin' } = {}) {
  const demo = ctx.api.mode === 'demo';
  const email = h('input.field-input', { id: 'in-email', type: 'email', name: 'email', autocomplete: 'username', required: true, 'data-focus': true, value: demo ? 'you@example.com' : '' });
  const password = h('input.field-input', { id: 'in-password', type: 'password', name: 'password', autocomplete: 'current-password', required: true, value: demo ? 'demo' : '' });
  const submit = h('button.btn.btn-royal', { type: 'submit' }, 'Sign in', h('span.btn-arrow', { 'aria-hidden': 'true' }, '→'));
  const problem = h('p.field-error', { role: 'alert', hidden: true });

  async function signIn(e) {
    e.preventDefault();
    submit.disabled = true; problem.hidden = true;
    try {
      ctx.me = await ctx.api.signIn(email.value.trim(), password.value);
      ctx.spaces.clear();
      const r = submit.getBoundingClientRect();
      await ctx.go(next, { replace: true, pixels: { x: r.left + r.width / 2, y: r.top + r.height / 2, name: 'Admin' } });
    } catch (err) {
      problem.textContent = err.message || 'That didn’t work. Try again.';
      problem.hidden = false;
      submit.disabled = false;
      password.focus(); password.select();
    }
  }

  return {
    kind: 'gate', title: 'Sign in',
    el: h('section.gate.wrap', {},
      h('div.gate-grid', {},
        h('div.gate-copy.placard', { 'data-rise': true },
          h('p.label.mono', {}, h('span.led', { 'aria-hidden': 'true' }), 'Admin'),
          h('h1.display.gate-title', {}, 'Sign in.'),
          h('p.lede', {}, `This side is ${ctx.owner}’s: making spaces, adding work to them, and answering notes.`)),
        h('div.gate-panel', { 'data-rise': true, style: { '--i': 1 } },
          h('form.gate-form.is-stacked', { onsubmit: signIn },
            h('div.field', {}, h('label.field-label.mono', { for: 'in-email' }, 'Email'), email),
            h('div.field', {}, h('label.field-label.mono', { for: 'in-password' }, 'Password'), password),
            problem,
            submit),
          demo ? h('p.hint.gate-hint', {}, 'This is the demo: any email and password sign you in, and nothing is saved outside this browser.') : null)),
      h('p.gate-foot.mono', { 'data-rise': true, style: { '--i': 2 } }, h('a', { href: '/' }, 'Have a code? Open a space'))),
  };
}

// Name and address for a new space. Resolves with the created space, or nothing.
export function newSpaceDialog(ctx) {
  const host = location.host.replace(/^www\./, '');
  return dialog({
    title: 'New space', label: 'One per client or project',
    build: close => {
      let touched = false;
      const name = h('input.field-input', { id: 'new-name', type: 'text', required: true, maxlength: 120, placeholder: 'Acme rebrand', autocomplete: 'off', autofocus: true });
      const slug = h('input.field-input.mono', { id: 'new-slug', type: 'text', required: true, maxlength: 40, placeholder: 'acme', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false' });
      const problem = h('p.field-error', { role: 'alert', hidden: true });
      const submit = h('button.btn.btn-royal', { type: 'submit' }, 'Create the space');
      name.addEventListener('input', () => { if (!touched) slug.value = slugify(name.value); });
      slug.addEventListener('input', () => { touched = true; slug.value = slug.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'); });
      return h('form.form', { onsubmit: async e => {
        e.preventDefault();
        const s = slugify(slug.value), n = name.value.trim();
        if (!n) { name.focus(); return; }
        if (!slugOk(s) || RESERVED.includes(s)) { problem.textContent = RESERVED.includes(s) ? 'That address is used by the portal itself. Pick another.' : 'Use lowercase letters, digits and dashes for the address.'; problem.hidden = false; slug.focus(); return; }
        submit.disabled = true; problem.hidden = true;
        try {
          close(await ctx.api.createClient({ name: n, slug: s }));
        } catch (err) { problem.textContent = err.message; problem.hidden = false; submit.disabled = false; }
      } },
        h('div.field', {}, h('label.field-label.mono', { for: 'new-name' }, 'Name'), name, h('p.hint', {}, 'What the client sees at the top of their space.')),
        h('div.field', {}, h('label.field-label.mono', { for: 'new-slug' }, 'Address'), h('div.field-affix', {}, h('span.mono', { 'aria-hidden': 'true' }, host + '/'), slug)),
        problem,
        h('div.dialog-actions', {}, h('button.btn.btn-line', { type: 'button', onclick: () => close() }, 'Cancel'), submit));
    },
  });
}

export async function adminHome(ctx) {
  const clients = await ctx.api.clients();
  const host = location.host.replace(/^www\./, '');
  const open = clients.reduce((n, c) => n + c.open_notes, 0);

  async function create() {
    const made = await newSpaceDialog(ctx);
    if (made) { toast('Space created'); ctx.go('/admin/' + made.id + '/access'); }
  }

  const row = c => h('li', { 'data-reveal': true },
    h('a.space-row', { href: '/admin/' + c.id },
      h('span.space-row-main', {},
        h('span.display.space-row-name', {}, c.name),
        h('span.mono.space-row-slug', {}, host + '/' + c.slug)),
      h('span.space-row-meta', {},
        !c.active ? h('span.chip', {}, h('span.led', { 'aria-hidden': 'true' }), 'Paused') : c.has_code ? h('span.chip.is-live', {}, h('span.led', { 'aria-hidden': 'true' }), 'Open') : h('span.chip.is-warn', {}, h('span.led', { 'aria-hidden': 'true' }), 'No code yet'),
        h('span.mono', {}, c.item_count === 1 ? '1 item' : c.item_count + ' items'),
        c.open_notes ? h('span.mono.space-row-notes', {}, icon('note'), c.open_notes === 1 ? '1 open note' : c.open_notes + ' open notes') : null,
        h('span.mono.space-row-seen', {}, c.last_opened_at ? 'Opened ' + ago(c.last_opened_at) : 'Made ' + day(c.created_at))),
      h('span.btn-arrow', { 'aria-hidden': 'true' }, '→')));

  const el = h('div.admin', {},
    h('section.wrap.admin-head', {},
      h('div.placard', {},
        h('p.label.mono', { 'data-rise': true }, h('span.led', { 'aria-hidden': 'true' }), 'Admin', h('span.label-count', {}, clients.length === 1 ? '1 space' : clients.length + ' spaces')),
        h('div.admin-title-row', { 'data-rise': true, style: { '--i': 1 } },
          h('h1.display.hero-title', {}, 'Your spaces.'),
          h('button.btn.btn-royal', { type: 'button', onclick: create }, icon('plus'), 'New space')),
        h('p.lede', { 'data-rise': true, style: { '--i': 2 } }, open ? `${open === 1 ? 'One note is' : open + ' notes are'} waiting for you.` : 'Each space is private to the people you give its code to.'))),
    h('section.wrap', {},
      clients.length
        ? h('ul.space-rows', {}, clients.map(row))
        : h('div.empty-block', { 'data-rise': true, style: { '--i': 3 } },
            h('p.display.empty-title', {}, 'No spaces yet.'),
            h('p.hint', {}, 'Make one for a client, a friend or a project. You add the work; they open it with a code.'),
            h('button.btn.btn-royal', { type: 'button', onclick: create }, icon('plus'), 'Make the first one'))),
    ctx.api.mode === 'demo' ? h('section.wrap.demo-note', {}, h('p.hint', {}, 'Demo mode: these spaces live in this browser only. ',
      h('button.link-button', { type: 'button', onclick: async () => { await ctx.api.reset(); ctx.spaces.clear(); await ctx.refreshMe(); toast('Demo reset'); ctx.go('/', { replace: true }); } }, 'Reset the demo'))) : null);

  let stop;
  return { el, kind: 'admin', title: 'Admin', header: { tag: 'Admin', tools: adminTools(ctx) }, mounted() { stop = reveal(el); }, destroy() { stop?.(); } };
}
