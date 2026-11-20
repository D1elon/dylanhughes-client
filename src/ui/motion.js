// Scroll-in reveals, as on the main site: things marked data-reveal settle into place the first time they are seen.
// Without motion (or without the observer) everything is simply there.
import { reduced } from './dom.js';

export function reveal(root) {
  const marked = [...root.querySelectorAll('[data-reveal]')];
  if (reduced() || !('IntersectionObserver' in window)) { marked.forEach(el => el.classList.add('is-in')); return () => {}; }
  const io = new IntersectionObserver(entries => {
    // Things arriving together come in one after another.
    entries.filter(e => e.isIntersecting).forEach((e, n) => {
      e.target.style.setProperty('--d', Math.min(n, 8) * 55 + 'ms');
      e.target.classList.add('is-in');
      io.unobserve(e.target);
    });
  }, { rootMargin: '0px 0px -6% 0px', threshold: 0.05 });
  marked.forEach(el => io.observe(el));
  return () => io.disconnect();
}

// Lights the index entry of whichever section is on screen.
export function spy(links, sections) {
  if (!('IntersectionObserver' in window) || !links.length) return () => {};
  const io = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      links.forEach(a => a.toggleAttribute('aria-current', a.hash === '#' + e.target.id));
    }
  }, { rootMargin: '-30% 0px -60% 0px' });
  sections.forEach(s => io.observe(s));
  return () => io.disconnect();
}
