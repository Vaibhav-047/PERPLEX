import { useEffect, useRef } from 'react';
import { bus } from './bus';
import { register } from './loop';

export type Draw = (ctx: CanvasRenderingContext2D, w: number, h: number, dt: number, canvas: HTMLCanvasElement) => void;

/** A canvas drawn by the shared loop. DPR capped at 2; offscreen canvases are skipped;
 *  under reduced motion it redraws only when the bus version changes (static snapshots). */
export function useCanvas(draw: Draw) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef(draw);
  drawRef.current = draw;
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    let w = 0, h = 0, seen = -1, dirty = true;
    const ro = new ResizeObserver(() => {
      const r = c.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = r.width; h = r.height;
      c.width = Math.max(1, Math.round(w * dpr)); c.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      dirty = true;
    });
    ro.observe(c);
    const off = register(c, (dt) => {
      if (!w || !h) return;
      if (bus.reduced && !dirty && seen === bus.version) return;
      seen = bus.version; dirty = false;
      ctx.clearRect(0, 0, w, h);
      drawRef.current(ctx, w, h, dt, c);
    });
    return () => { ro.disconnect(); off(); };
  }, []);
  return ref;
}
