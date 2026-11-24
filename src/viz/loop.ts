import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { bus, step } from './bus';

gsap.registerPlugin(ScrollTrigger);

interface Renderer { el: Element; visible: boolean; always: boolean; frame: (dt: number) => void }
const renderers = new Set<Renderer>();
const io = typeof IntersectionObserver !== 'undefined'
  ? new IntersectionObserver((entries) => {
    for (const e of entries) for (const r of renderers) if (r.el === e.target) r.visible = e.isIntersecting;
  })
  : null;

/** Register a visual. It is drawn from the one shared frame loop, and skipped while offscreen. */
export function register(el: Element, frame: (dt: number) => void, always = false) {
  const r: Renderer = { el, visible: true, always, frame };
  renderers.add(r);
  if (!always) io?.observe(el);
  return () => { renderers.delete(r); io?.unobserve(el); };
}

let lenis: Lenis | null = null;
let started = false;

/** The single requestAnimationFrame loop: GSAP's ticker drives Lenis, the signal bus and every canvas. */
export function startLoop(reduced: boolean) {
  if (started) return;
  started = true;
  bus.reduced = reduced;
  if (!reduced) {
    lenis = new Lenis({ autoRaf: false, lerp: 0.12 });
    lenis.on('scroll', (l: Lenis) => { bus.scrollVelocity = l.velocity; ScrollTrigger.update(); });
  }
  gsap.ticker.lagSmoothing(0);
  gsap.ticker.add((time, deltaTime) => {
    lenis?.raf(time * 1000);
    if (document.hidden) return; // never draw while the tab is hidden
    const dt = Math.min(0.05, deltaTime / 1000);
    step(dt);
    for (const r of renderers) if (r.always || r.visible) r.frame(dt);
  });
}

export function scrollToEl(el: Element | null) {
  if (!el) return;
  if (lenis) lenis.scrollTo(el as HTMLElement, { duration: 1.1 });
  else el.scrollIntoView();
}
