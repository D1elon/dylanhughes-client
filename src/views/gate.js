// The code gate: the one screen a visitor sees before a space. The dot-matrix display reads the code back as it is
// typed and says whether it opened. With a space's address already in the URL only the code is asked for; at the
// portal's root the space's name is asked for too.
import { h, toast } from '../ui/dom.js';
import { createDisplay } from '../ui/dmd.js';
import { tidyCode, slugify } from '../data/util.js';

export async function gateView(ctx, { slug = '', code = '', next } = {}) {
  const demo = ctx.api.mode === 'demo';
  const host = location.host.replace(/^www\./, '');
  let busy = false, display;

  const status = h('span', {}, 'Waiting for your code');
  const lamp = h('span.led', { 'aria-hidden': 'true' });
  const canvas = h('canvas', { 'aria-hidden': 'true' });
  const bezel = h('div.dmd-bezel', {}, h('div.dmd', {}, canvas));

  const spaceInput = slug ? null : h('input.field-input.mono', { id: 'gate-space', name: 'space', type: 'text', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', required: true, placeholder: 'your-space', 'aria-describedby': 'gate-status' });
  const codeInput = h('input.field-input.gate-code', { id: 'gate-code', name: 'code', type: 'text', autocomplete: 'off', autocapitalize: 'characters', autocorrect: 'off', spellcheck: 'false', required: true, maxlength: 40, placeholder: 'XXXX-XXXX', value: tidyCode(code), 'aria-describedby': 'gate-status', 'data-focus': slug ? true : null });
  const submit = h('button.btn.btn-royal', { type: 'submit' }, 'Open the space', h('span.btn-arrow', { 'aria-hidden': 'true' }, '→'));

  const say = (text, state = '') => { status.textContent = text; strip.dataset.state = state; };
  const strip = h('p.dmd-status.mono', { id: 'gate-status', role: 'status' }, lamp, status);

  codeInput.addEventListener('input', () => {
    const at = codeInput.selectionStart === codeInput.value.length;
    codeInput.value = tidyCode(codeInput.value);
    if (at) codeInput.setSelectionRange(codeInput.value.length, codeInput.value.length);
    display?.code(codeInput.value);
    if (strip.dataset.state === 'bad') say('Waiting for your code');
  });

  async function open(e) {
    e?.preventDefault();
    if (busy) return;
    const where = slug || slugify(spaceInput.value.replace(/^.*\//, ''));
    const typed = codeInput.value.trim();
    if (!where) { spaceInput.focus(); say('Enter the name of your space', 'bad'); return; }
    if (typed.replace(/[^A-Za-z0-9]/g, '').length < 6) { codeInput.focus(); say('That code is too short', 'bad'); return; }
    busy = true; submit.disabled = true;
    say('Checking', 'busy');
    let result;
    try {
      result = await ctx.api.redeem(where, typed, ctx.nameFor());
    } catch (err) {
      result = { ok: false, error: 'failed', message: err.message };
    }
    if (result.ok) {
      say('Open', 'ok');
      display?.say('OPEN');
      await display?.ripple();
      await ctx.refreshMe();
      const r = submit.getBoundingClientRect();
      const name = () => ctx.spaces.get(where)?.client.name || '';
      // Load the space under the cover so its name can be lit as the dots open.
      await ctx.go(next || '/' + where, { replace: !!slug, pixels: { x: r.left + r.width / 2, y: r.top + r.height / 2, name } });
      return;
    }
    busy = false; submit.disabled = false;
    const text = result.error === 'locked' ? 'Too many tries. Wait fifteen minutes, then try again.'
      : result.error === 'failed' ? result.message || 'Can’t reach the portal. Try again.'
      : 'That code didn’t open this space. Check it and try again.';
    say(text, 'bad');
    display?.say(result.error === 'locked' ? 'LOCKED' : 'TRY AGAIN');
    bezel.classList.remove('is-shaking'); void bezel.offsetWidth; bezel.classList.add('is-shaking');
    setTimeout(() => { if (display && strip.dataset.state === 'bad') display.code(codeInput.value); }, 1500);
    codeInput.focus(); codeInput.select();
  }

  const open_ = ctx.me.spaces.filter(s => s.slug !== slug);
  const el = h('section.gate.wrap', {},
    h('div.gate-grid', {},
      h('div.gate-copy.placard', { 'data-rise': true },
        h('p.label.mono', {}, h('span.led', { 'aria-hidden': 'true' }), slug ? 'Private space' : 'Client portal', slug ? h('span.label-count', {}, `${host}/${slug}`) : null),
        h('h1.display.gate-title', {}, 'Enter your code.'),
        h('p.lede', {}, slug
          ? `This space is private. Enter the code ${ctx.owner} sent you to open it.`
          : `Private spaces for ${ctx.owner}’s clients, friends and family. Enter your space and the code you were sent.`)),
      h('div.gate-panel', { 'data-rise': true, style: { '--i': 1 } },
        bezel,
        h('div.dmd-strip', {}, strip),
        h('form.gate-form', { novalidate: true, onsubmit: open },
          spaceInput ? h('div.field', {},
            h('label.field-label.mono', { for: 'gate-space' }, 'Your space'),
            h('div.field-affix', {}, h('span.mono', { 'aria-hidden': 'true' }, host + '/'), spaceInput)) : null,
          h('div.field', {},
            h('label.field-label.mono', { for: 'gate-code' }, 'Your code'),
            codeInput),
          submit),
        demo ? h('p.hint.gate-hint', {}, 'This is the demo. The sample space is “demo” and its code is ',
          h('button.link-button.mono', { type: 'button', onclick: () => { if (spaceInput) spaceInput.value = 'demo'; codeInput.value = 'DEMO-2026'; display?.code('DEMO-2026'); codeInput.focus(); } }, 'DEMO-2026'), '.') : null)),
    open_.length ? h('div.gate-open', { 'data-rise': true, style: { '--i': 2 } },
      h('p.label.mono', {}, 'Already open on this device'),
      h('ul.gate-spaces', {}, open_.map(s => h('li', {}, h('a.row-link', { href: '/' + s.slug }, h('span.led', { 'aria-hidden': 'true' }), h('span.display', {}, s.name), h('span.mono', {}, '/' + s.slug), h('span.btn-arrow', { 'aria-hidden': 'true' }, '→')))))) : null,
    h('p.gate-foot.mono', { 'data-rise': true, style: { '--i': 3 } },
      ctx.me.isAdmin ? h('a', { href: '/admin' }, 'Go to your admin') : h('a', { href: '/admin' }, `${ctx.owner}’s sign-in`)));

  return {
    el,
    kind: 'gate',
    title: slug ? 'Enter your code' : '',
    mounted() {
      display = createDisplay(canvas);
      if (codeInput.value) display.code(codeInput.value); else display.say('ENTER CODE', { font: 'small' });
      // A link that carried the code opens the space without a press.
      if (code && slug) open().catch(err => toast(err.message, 'error'));
    },
    destroy() { display?.destroy(); },
  };
}
