import { useEffect, useRef } from 'react';
import { bus } from '../viz/bus';
import { register } from '../viz/loop';
import { fixed } from '../lib/format';

const INTERACTIVE = 'a, button, select, summary, [role="switch"], [role="option"], [role="radio"], label';
const TEXT = 'input, textarea';

/** Desktop-only crosshair ring (difference blend) that grows over controls and, over the terrain, shows the live
 *  elevation ("h 2.31"). The native cursor stays in text fields. Not mounted for touch or reduced motion. */
export function Cursor() {
  const ring = useRef<HTMLDivElement>(null);
  const readout = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ring.current;
    if (!el) return;
    document.documentElement.classList.add('has-cursor');
    let tx = -100, ty = -100, x = -100, y = -100, big = false, text = false, out = true, shown = '';
    const move = (e: PointerEvent) => {
      tx = e.clientX; ty = e.clientY; out = false;
      const t = e.target as Element | null;
      big = !!t?.closest?.(INTERACTIVE);
      text = !!t?.closest?.(TEXT);
    };
    const leave = () => { out = true; };
    window.addEventListener('pointermove', move);
    document.addEventListener('pointerleave', leave);
    const off = register(el, (dt) => {
      const k = 1 - Math.exp(-dt * 30);
      x += (tx - x) * k; y += (ty - y) * k;
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      el.style.opacity = out || text ? '0' : '1';
      el.dataset.big = String(big);
      const label = bus.cursorH === null ? '' : `h ${fixed(bus.cursorH)}`;
      if (readout.current && label !== shown) { readout.current.textContent = label; shown = label; }
    }, true);
    return () => {
      off();
      window.removeEventListener('pointermove', move);
      document.removeEventListener('pointerleave', leave);
      document.documentElement.classList.remove('has-cursor');
    };
  }, []);
  return (
    <div ref={ring} aria-hidden="true" className="cursor fixed left-0 top-0 z-[100] pointer-events-none" style={{ transform: 'translate(-100px,-100px)', mixBlendMode: 'difference' }}>
      <span className="cursor-ring" />
      <span className="cursor-cross" />
      <span ref={readout} className="absolute left-3 top-3 mono text-[10px] text-ink whitespace-nowrap" />
    </div>
  );
}
