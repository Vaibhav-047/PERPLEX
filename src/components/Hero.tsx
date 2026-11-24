import { useRef } from 'react';
import { motion } from 'framer-motion';
import { bus } from '../viz/bus';
import { drawHero } from '../viz/scenes';
import { useCanvas } from '../viz/useCanvas';
import { EASE, useMagnetic, useMedia } from './ui';

export function Hero({ onStart }: { onStart: () => void }) {
  const phone = useMedia('(max-width: 767px)');
  const word = useRef<HTMLHeadingElement>(null);
  const magnet = useMagnetic<HTMLButtonElement>();
  const canvasRef = useCanvas((ctx, w, h) => drawHero(ctx, w, h, phone, word.current?.offsetWidth ?? w * 0.6));

  return (
    <section aria-labelledby="hero-title" className="relative h-[100dvh] min-h-[560px] overflow-hidden"
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        Object.assign(bus.hero, { inside: true, px: e.clientX - r.left, py: e.clientY - r.top });
      }}
      onPointerLeave={() => { bus.hero.inside = false; }}>
      <div aria-hidden="true" className="absolute inset-0"><canvas ref={canvasRef} className="w-full h-full block" /></div>
      <p className="sr-only">A point-cloud landscape flies slowly toward you, coloured from teal in the lowlands to red on the peaks, while a laser line scans across it.</p>
      <div className="relative z-10 h-full flex flex-col items-center px-4 text-center pt-[16dvh]">
        <p className="mono text-[11px] tracking-[0.08em] text-ink-faint mb-5">SECTOR 01 · SURVEY START</p>
        <h1 ref={word} id="hero-title" className="display text-[clamp(48px,14vw,168px)] leading-[0.9] tracking-[0.02em] text-ink select-none">PERPLEX</h1>
        <p className="mono text-[12px] text-ink-dim mt-3">Surprise Terrain</p>
        <motion.p className="mt-8 text-lg text-ink max-w-[34ch]" initial={bus.reduced ? false : { opacity: 0, y: 8, filter: 'blur(4px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} transition={{ delay: 0.2, duration: 0.6, ease: EASE }}>
          Perplexity is how high the water rises.
        </motion.p>
        <motion.button ref={magnet.ref} style={magnet.style} type="button" onClick={onStart}
          className="mt-8 h-11 px-5 rounded-md border border-line-hi bg-void text-ink text-sm hover:border-ink-faint transition-colors">
          Start the survey ↓
        </motion.button>
      </div>
    </section>
  );
}
