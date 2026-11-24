import { useEffect, useRef, useState } from 'react';
import { bus, emit } from '../viz/bus';
import { drawTerrain } from '../viz/scenes';
import { useCanvas } from '../viz/useCanvas';
import { elevation, hToV } from '../viz/color';
import { displayToken, fixed, formatNum } from '../lib/format';
import { summarize, type Scored } from '../lib/tokens';
import { useMedia } from './ui';

interface Props {
  which: 'console' | 'lab';
  data: Scored | null;
  onSelect: (i: number) => void;
  empty: string;
  note?: string;
  overlay?: string | null;
  ghostNote?: string;
}

/** Nearest ridge to the pointer, using the ridge screen positions from the last draw. */
function hit(screen: Float32Array, x: number, y: number) {
  let best = -1, bd = 28;
  for (let i = 0; i < screen.length / 4; i++) {
    const ax = screen[i * 4], ay = screen[i * 4 + 1], bx = screen[i * 4 + 2], by = Math.min(screen[i * 4 + 3], ay - 12);
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L));
    const d = Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

export function Terrain({ which, data, onSelect, empty, note, overlay, ghostNote }: Props) {
  const t = bus.terrains[which];
  const phone = useMedia('(max-width: 767px)');
  const [hover, setHoverState] = useState(-1);
  const drag = useRef<{ x: number; y: number; moved: number } | null>(null);
  const canvasRef = useCanvas((ctx, w, h) => drawTerrain(ctx, w, h, t, { phone, labels: 'p', waterLabel: 'ppl' }));
  const chipsRef = useRef<HTMLDivElement>(null);
  const setHover = (i: number) => { setHoverState(i); emit.hover(t, i); };

  useEffect(() => { if (hover >= 0) chipsRef.current?.querySelector<HTMLElement>(`[data-i="${hover}"]`)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); }, [hover]);

  const tokens = data?.tokens ?? [];
  const s = summarize(tokens);
  const peak = tokens[s.peak];
  const sr = !tokens.length ? empty
    : `Terrain of ${tokens.length} tokens. Tallest ridge: '${peak.token}', probability ${formatNum(peak.p)}, height ${fixed(peak.h)}. `
      + `Water level (mean surprisal) ${fixed(s.meanSurprisal)}, perplexity ${fixed(s.perplexity, 1)}.${t.ghost ? ` Ghost: ${t.ghost.name}, ${t.ghost.h.length} tokens, perplexity ${fixed(t.ghost.ppl, 1)}.` : ''}`;
  const descId = `${which}-terrain-desc`;

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="relative flex-1 min-h-[260px] rounded-md bg-void border border-line overflow-hidden touch-none outline-offset-[-2px]"
        tabIndex={0} role="group" aria-roledescription="terrain" aria-label="Surprise terrain. Arrow keys rotate the camera." aria-describedby={descId}
        data-terrain=""
        onKeyDown={(e) => {
          const k = e.key, r = 0.12;
          if (k === 'ArrowLeft') emit.rotate(t, -r, 0); else if (k === 'ArrowRight') emit.rotate(t, r, 0);
          else if (k === 'ArrowUp') emit.rotate(t, 0, r); else if (k === 'ArrowDown') emit.rotate(t, 0, -r);
          else return;
          e.preventDefault();
        }}
        onPointerDown={(e) => { drag.current = { x: e.clientX, y: e.clientY, moved: 0 }; e.currentTarget.setPointerCapture(e.pointerId); emit.drag(t, true); }}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const d = drag.current;
          if (d) {
            const dx = e.clientX - d.x, dy = e.clientY - d.y;
            d.moved += Math.abs(dx) + Math.abs(dy); d.x = e.clientX; d.y = e.clientY;
            if (d.moved > 4) { emit.rotate(t, dx * 0.008, dy * 0.006); return; }
          }
          const i = hit(t.screen, e.clientX - r.left, e.clientY - r.top);
          if (i !== hover) setHover(i);
          bus.cursorH = i >= 0 ? t.h[i] : null;
        }}
        onPointerUp={(e) => {
          const d = drag.current; drag.current = null; emit.drag(t, false);
          e.currentTarget.releasePointerCapture?.(e.pointerId);
          if (d && d.moved <= 4) { const r = e.currentTarget.getBoundingClientRect(); const i = hit(t.screen, e.clientX - r.left, e.clientY - r.top); if (i >= 0) onSelect(i); }
        }}
        onPointerLeave={() => { if (!drag.current) { setHover(-1); bus.cursorH = null; } }}>
        <canvas ref={canvasRef} aria-hidden="true" className="w-full h-full block absolute inset-0" />
        {(overlay || !tokens.length) && (
          <p className={`absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-sm px-6 pointer-events-none ${overlay ? 'text-fault' : 'text-ink-dim'}`}>{overlay || empty}</p>
        )}
        <p id={descId} className="sr-only" aria-live="polite">{sr}</p>
        {note && <p className="absolute left-3 top-2.5 mono text-[10px] text-ink-faint pointer-events-none">{note}</p>}
      </div>
      {ghostNote && <p className="text-xs text-ink-faint mt-2">{ghostNote}</p>}
      {tokens.length > 0 && (
        <div ref={chipsRef} className="mt-2 flex flex-wrap gap-1 max-h-[104px] overflow-y-auto" role="list" aria-label="Tokens in order. Each opens the inspector.">
          {tokens.map((tk, i) => (
            <div role="listitem" key={i}>
              <button type="button" data-i={i} onClick={() => onSelect(i)}
                onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(-1)} onFocus={() => setHover(i)} onBlur={() => setHover(-1)}
                aria-label={`Ridge ${i + 1}: '${tk.token}', probability ${formatNum(tk.p)}, height ${fixed(tk.h)}${tk.generated ? ', generated' : ''}`}
                className={`mono text-[11px] flex items-center gap-1.5 px-1.5 py-0.5 rounded border ${hover === i ? 'border-ink text-ink bg-well' : 'border-line text-ink-dim'} ${tk.generated ? 'border-dashed' : ''}`}>
                <span aria-hidden="true" className="inline-block w-1.5 h-1.5 rounded-[1px]" style={{ background: elevation(hToV(tk.h)) }} />
                <span className="text-ink">{displayToken(tk.token)}</span>
                <span>{formatNum(tk.p, 2)}</span>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
