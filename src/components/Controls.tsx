import { useLayoutEffect, useRef, useState } from 'react';
import type { Preset } from '../viz/bus';
import { bus } from '../viz/bus';
import { Switch, useMagnetic } from './ui';
import { motion } from 'framer-motion';

export const SAMPLES = ['I love Python', 'Python love I', 'The capital of France is Paris'];
const PRESETS: { key: Preset; label: string }[] = [{ key: 'orbit', label: 'Orbit' }, { key: 'side', label: 'Side' }, { key: 'top', label: 'Top' }];

/** Single-line sentence input in a dark well with a block cursor (the native caret is hidden). */
function SentenceInput({ value, onChange, onEnter }: { value: string; onChange: (v: string) => void; onEnter: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [caret, setCaret] = useState<number | null>(null);
  const measure = useRef<CanvasRenderingContext2D | null>(null);
  const update = () => {
    const el = input.current;
    if (!el || document.activeElement !== el || el.selectionStart !== el.selectionEnd) { setCaret(null); return; }
    const cs = getComputedStyle(el);
    measure.current ??= document.createElement('canvas').getContext('2d');
    const m = measure.current!;
    m.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    setCaret(parseFloat(cs.paddingLeft) + m.measureText(el.value.slice(0, el.selectionStart ?? 0)).width - el.scrollLeft);
  };
  useLayoutEffect(update, [value]);
  return (
    <div className="relative">
      <label htmlFor="sentence" className="sr-only">Sentence to score</label>
      <input ref={input} id="sentence" value={value} maxLength={400} autoComplete="off" spellCheck={false}
        onChange={(e) => onChange(e.target.value)} onSelect={update} onFocus={update} onBlur={() => setCaret(null)} onScroll={update}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onEnter(); } }}
        className="sentence well mono text-[14px] w-full h-11 px-3" placeholder="Type a sentence" />
      {caret !== null && <span aria-hidden="true" className="block-caret" style={{ left: caret, fontSize: 14, animation: bus.reduced ? 'none' : undefined }} />}
    </div>
  );
}

interface Props {
  sentence: string; setSentence: (s: string) => void;
  onRun: () => void; onContinue: () => void; canRun: boolean; canContinue: boolean; running: boolean; reason?: string;
  compare: boolean; setCompare: (v: boolean) => void;
  preset: Preset; setPreset: (p: Preset) => void; onReset: () => void;
}

export function Controls(p: Props) {
  const magnet = useMagnetic<HTMLButtonElement>();
  const presetRefs = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <div className="px-4 pb-4 space-y-5">
      <div>
        <SentenceInput value={p.sentence} onChange={p.setSentence} onEnter={() => p.canRun && p.onRun()} />
        <div className="flex flex-wrap gap-1.5 mt-2.5" aria-label="Sample sentences" role="group">
          {SAMPLES.map((s) => (
            <button key={s} type="button" onClick={() => p.setSentence(s)}
              className={`mono text-[11px] px-2 py-1 rounded border ${p.sentence === s ? 'border-ink-dim text-ink' : 'border-line-hi text-ink-dim hover:text-ink'}`}>{s}</button>
          ))}
        </div>
      </div>

      <div>
        <div className="flex gap-2">
          <motion.button ref={magnet.ref} style={magnet.style} type="button" onClick={p.onRun} disabled={!p.canRun}
            className="btn-solid relative h-10 px-5 text-sm flex-1" aria-describedby={p.reason ? 'run-reason' : undefined}>
            {p.running ? 'Running…' : 'Run'}
            {p.running && <span className="run-scan" aria-hidden="true" />}
          </motion.button>
          <button type="button" onClick={p.onContinue} disabled={!p.canContinue} className="btn-outline h-10 px-4 text-sm">Continue</button>
        </div>
        {p.reason && <p id="run-reason" className="text-xs text-ink-faint mt-2">{p.reason}</p>}
        <p className="text-xs text-ink-faint mt-2">Continue generates up to 30 tokens and streams each one with its probability.</p>
      </div>

      <Switch id="compare" label="Compare models" checked={p.compare} onChange={p.setCompare}
        note={p.compare ? 'Runs both models. The other one is drawn as a wireframe ghost.' : undefined} />

      <div>
        <p id="cam-label" className="text-sm text-ink mb-2">Camera</p>
        <div role="radiogroup" aria-labelledby="cam-label" className="grid grid-cols-3 gap-1 p-0.5 rounded-md border border-line bg-well">
          {PRESETS.map((x, i) => (
            <button key={x.key} ref={(el) => { presetRefs.current[i] = el; }} type="button" role="radio" aria-checked={p.preset === x.key}
              tabIndex={p.preset === x.key ? 0 : -1} onClick={() => p.setPreset(x.key)}
              onKeyDown={(e) => {
                const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
                if (!d) return;
                e.preventDefault();
                const j = (i + d + PRESETS.length) % PRESETS.length;
                p.setPreset(PRESETS[j].key); presetRefs.current[j]?.focus();
              }}
              className={`h-7 rounded text-[12px] ${p.preset === x.key ? 'bg-ink text-void' : 'text-ink-dim hover:text-ink'}`}>{x.label}{x.key === 'top' ? ' (map)' : ''}</button>
          ))}
        </div>
        <p className="text-xs text-ink-faint mt-2">Drag the terrain, or focus it and use the arrow keys, to rotate.</p>
      </div>

      <button type="button" onClick={p.onReset} className="btn-outline h-9 w-full text-sm">Reset</button>
    </div>
  );
}
