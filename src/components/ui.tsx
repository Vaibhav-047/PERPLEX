import { useEffect, useRef, useState, type ReactNode } from 'react';
import { animate, motion, useMotionValue, useSpring } from 'framer-motion';
import { bus } from '../viz/bus';
import { elevation, hToV } from '../viz/color';
import { formatNum } from '../lib/format';

export const EASE = [0.2, 0.8, 0.2, 1] as const;

export function useMedia(q: string) {
  const [m, setM] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [q]);
  return m;
}

/** Small mono survey-coordinate label, e.g. "SECTOR 03 · CONSOLE". */
export function Label({ children, id, className = '', as = 'p' }: { children: ReactNode; id?: string; className?: string; as?: 'p' | 'h2' | 'h3' }) {
  const Tag = as;
  return <Tag id={id} className={`mono text-[11px] tracking-[0.08em] text-ink-faint ${className}`}>{children}</Tag>;
}

/** Flat panel with a 1px rule; the rule brightens near the pointer, and a scan line sweeps it once when it first enters view. */
export function Panel({ children, className = '', label, id }: { children: ReactNode; className?: string; label?: string; id?: string }) {
  const [seen, setSeen] = useState(false);
  return (
    <motion.section
      aria-labelledby={label ? id : undefined}
      onViewportEnter={() => setSeen(true)} viewport={{ once: true, amount: 0.2 }}
      data-seen={seen && !bus.reduced ? 'true' : undefined}
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`);
        e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`);
      }}
      className={`panel ${className}`}
    >
      {label && <Label as="h2" id={id} className="px-4 pt-3 pb-2">{label}</Label>}
      {children}
    </motion.section>
  );
}

/**
 * Section content rises in with a short blur-to-sharp. Afterwards the inline filter and transform are cleared:
 * a leftover filter/transform would become the containing block for position: fixed descendants and break pins and sheets.
 */
export function Reveal({ children, className = '', delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  if (bus.reduced) return <div className={className}>{children}</div>;
  return (
    <motion.div ref={ref} className={className}
      initial={{ opacity: 0, y: 22, filter: 'blur(6px)' }} whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      viewport={{ once: true, amount: 0.2 }} transition={{ duration: 0.7, delay, ease: EASE }}
      onAnimationComplete={() => { const s = ref.current?.style; if (s) { s.filter = ''; s.transform = ''; } }}>
      {children}
    </motion.div>
  );
}

/** Toggle switch (role="switch"). */
export function Switch({ id, label, checked, disabled, note, onChange }: {
  id: string; label: string; checked: boolean; disabled?: boolean; note?: string; onChange: (v: boolean) => void;
}) {
  return (
    <div>
      <div className={`flex items-center gap-3 ${disabled ? 'opacity-55' : ''}`}>
        <label htmlFor={id} className="text-sm text-ink flex-1">{label}</label>
        <button id={id} type="button" role="switch" aria-checked={checked} disabled={disabled}
          aria-describedby={note ? `${id}-note` : undefined} onClick={() => onChange(!checked)}
          className={`relative h-5 w-9 shrink-0 rounded-full border disabled:cursor-not-allowed ${checked ? 'border-ink bg-ink' : 'border-line-hi bg-well'}`}>
          <motion.span className="absolute top-[2px] left-[2px] h-3.5 w-3.5 rounded-full"
            style={{ background: checked ? 'var(--void)' : 'var(--ink-faint)' }}
            animate={{ x: checked ? 16 : 0 }} transition={{ type: 'spring', stiffness: 700, damping: 45 }} />
        </button>
      </div>
      {note && <p id={`${id}-note`} className="text-xs text-ink-faint mt-1.5">{note}</p>}
    </div>
  );
}

/** Odometer number: rolls from the previous value. */
export function Roll({ value, format }: { value: number; format: (v: number) => string }) {
  const [shown, setShown] = useState(bus.reduced ? value : 0);
  const prev = useRef(bus.reduced ? value : 0);
  useEffect(() => {
    if (bus.reduced || !Number.isFinite(value)) { setShown(value); prev.current = value; return; }
    const c = animate(prev.current, value, { duration: 0.6, ease: EASE, onUpdate: setShown });
    prev.current = value;
    return () => c.stop();
  }, [value]);
  return <>{format(shown)}</>;
}

/** Magnetic pull toward the cursor, up to 6px. Off for touch and reduced motion. */
export function useMagnetic<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const x = useSpring(useMotionValue(0), { stiffness: 300, damping: 22 });
  const y = useSpring(useMotionValue(0), { stiffness: 300, damping: 22 });
  useEffect(() => {
    if (bus.reduced || !window.matchMedia('(pointer: fine)').matches) return;
    const on = (e: PointerEvent) => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const dx = e.clientX - cx, dy = e.clientY - cy, near = Math.abs(dx) < r.width / 2 + 40 && Math.abs(dy) < r.height / 2 + 40;
      x.set(near ? Math.max(-6, Math.min(6, dx * 0.15)) : 0);
      y.set(near ? Math.max(-6, Math.min(6, dy * 0.15)) : 0);
    };
    window.addEventListener('pointermove', on);
    return () => window.removeEventListener('pointermove', on);
  }, [x, y]);
  return { ref, style: { x, y } };
}

/** Side sheet (dialog) from the right, focus trapped. Esc is handled by App; backdrop click and Close close it. */
export function Sheet({ title, onClose, children, width = 'min(560px, 100vw)' }: { title: string; onClose: () => void; children: ReactNode; width?: string }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => prev?.focus();
  }, []);
  return (
    <motion.div className="fixed inset-0 z-50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
      <div className="absolute inset-0 bg-void/80" onClick={onClose} aria-hidden="true" />
      <motion.div role="dialog" aria-modal="true" aria-labelledby="sheet-title"
        className="absolute right-0 top-0 bottom-0 bg-deck border-l border-line-hi flex flex-col" style={{ width }}
        initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ duration: 0.26, ease: EASE }}
        onKeyDown={(e) => {
          if (e.key !== 'Tab') return;
          const f = e.currentTarget.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
          if (!f.length) return;
          if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
          else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
        }}>
        <div className="h-12 shrink-0 flex items-center justify-between px-4 border-b border-line">
          <h2 id="sheet-title" className="display text-[15px] text-ink">{title}</h2>
          <button ref={closeRef} type="button" onClick={onClose} className="btn-outline text-xs px-2.5 py-1">Close</button>
        </div>
        <div data-lenis-prevent className="flex-1 min-h-0 overflow-y-auto p-4">{children}</div>
      </motion.div>
    </motion.div>
  );
}

/** Horizontal bar meter for a probability, coloured by the elevation it implies, always with its number. */
export function ProbBar({ label, p, mark, highlight }: { label: string; p: number; mark?: string; highlight?: boolean }) {
  const h = -Math.log(p);
  return (
    <li className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)_3.6rem] items-center gap-2 text-[12px]">
      <span className={`mono truncate ${highlight ? 'text-ink' : 'text-ink-dim'}`}>{label}{mark && <span className="text-ink"> {mark}</span>}</span>
      <span className="h-2 bg-well rounded-[1px] overflow-hidden" aria-hidden="true">
        <motion.span className="block h-full origin-left" style={{ background: elevation(hToV(h)) }}
          initial={bus.reduced ? false : { scaleX: 0 }} animate={{ scaleX: Math.max(0.01, p) }} transition={{ duration: 0.5, ease: EASE }} />
      </span>
      <span className="mono text-right text-ink">{formatNum(p, 2)}</span>
    </li>
  );
}
