import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { backendLabel, MODEL_KEYS, MODELS, plannedBackend, type Backend, type ModelKey } from '../lib/models';
import { formatMB, formatNum } from '../lib/format';
import { workedCalc } from '../lib/tokens';
import { EASE, useMedia } from './ui';

export interface FileProgress { loaded: number; total: number; done: boolean }
export interface ModelState { state: 'off' | 'loading' | 'ready' | 'fault'; backend: Backend | null; files: Record<string, FileProgress>; message?: string; note?: string }
export const freshModel = (): ModelState => ({ state: 'off', backend: null, files: {} });

export function downloadTotals(m: ModelState) {
  let loaded = 0, total = 0;
  for (const f of Object.values(m.files)) { loaded += f.loaded; total += f.total; }
  return { loaded, total, pct: total ? Math.min(100, (loaded / total) * 100) : 0 };
}

export function statusLine(key: ModelKey, m: ModelState, expected: Backend | null, busy: boolean) {
  const info = MODELS[key], planned = plannedBackend(key, expected), b = backendLabel(m.backend ?? (expected ? planned : null));
  if (m.state === 'fault') return m.message ?? 'Fault';
  if (m.state === 'loading') {
    const d = downloadTotals(m);
    return `${b} · ${info.name} · loading ${d.total ? `${d.pct.toFixed(0)}% (${formatMB(d.loaded)} of ${formatMB(d.total)})` : '…'}${m.note ? ` (${m.note})` : ''}`;
  }
  if (m.state === 'ready') return `${b} · ${info.name} · ${busy ? 'running' : 'ready'}${m.note ? ` (${m.note})` : ''}`;
  return `${b} · ${info.name} · not loaded (about ${info.mb[planned]} MB on the first run)`;
}

const optionText = (k: ModelKey, b: Backend | null) => `${MODELS[k].label} · ${MODELS[k].name} · ${MODELS[k].mb[plannedBackend(k, b)]} MB`;

/** Custom listbox (ARIA listbox pattern) on desktop. */
function ModelListbox({ model, onModel, backend, disabled }: { model: ModelKey; onModel: (m: ModelKey) => void; backend: Backend | null; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, MODEL_KEYS.indexOf(model)));
    list.current?.focus();
    const close = (e: PointerEvent) => { if (!list.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const choose = (i: number) => { onModel(MODEL_KEYS[i]); setOpen(false); btn.current?.focus(); };
  return (
    <div className="relative min-w-0">
      <button ref={btn} type="button" aria-haspopup="listbox" aria-expanded={open} aria-label={`Model: ${optionText(model, backend)}`} aria-describedby="model-status" disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setOpen(true); } }}
        className="well h-8 w-full flex items-center gap-2 px-2.5 text-left">
        <span className="flex-1 min-w-0 mono text-[12px] text-ink truncate">{optionText(model, backend)}</span>
        <span aria-hidden="true" className="text-ink-faint text-[10px]">▾</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.ul ref={list} role="listbox" tabIndex={-1} aria-label="Model" aria-activedescendant={`opt-${MODEL_KEYS[active]}`}
            initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.15, ease: EASE }}
            className="absolute z-50 left-0 right-0 mt-1 rounded-md border border-line-hi bg-deck py-1 outline-none min-w-[320px]"
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(MODEL_KEYS.length - 1, a + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
              else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
              else if (e.key === 'End') { e.preventDefault(); setActive(MODEL_KEYS.length - 1); }
              else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(active); }
              else if (e.key === 'Escape' || e.key === 'Tab') { e.stopPropagation(); setOpen(false); btn.current?.focus(); }
            }}>
            {MODEL_KEYS.map((k, i) => (
              <li key={k} id={`opt-${k}`} role="option" aria-selected={k === model}
                onPointerEnter={() => setActive(i)} onClick={() => choose(i)}
                className={`flex items-center gap-2 px-2.5 py-1.5 cursor-pointer ${i === active ? 'bg-well' : ''}`}>
                <span className={`w-2 text-[10px] ${k === model ? 'text-ink' : 'text-transparent'}`} aria-hidden="true">●</span>
                <span className="flex-1 min-w-0">
                  <span className="block mono text-[12px] text-ink">{MODELS[k].label} · {MODELS[k].name}</span>
                  <span className="block text-[11px] text-ink-faint">{MODELS[k].id} · {MODELS[k].dtype[plannedBackend(k, backend)]} on {backendLabel(plannedBackend(k, backend))} · {MODELS[k].mb[plannedBackend(k, backend)]} MB</span>
                </span>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

interface Props {
  model: ModelKey; onModel: (m: ModelKey) => void; status: ModelState; expected: Backend | null; busy: boolean;
  onViewMath: () => void; onOpenSheet: (s: 'controls' | 'readouts') => void;
}

export function ConsoleHeader(p: Props) {
  const phone = useMedia('(max-width: 767px)');
  const s = p.status.state;
  const lamp = s === 'fault' ? 'var(--fault)' : s === 'ready' ? 'var(--ok)' : s === 'loading' ? 'var(--caution)' : 'var(--line-hi)';
  const lampName = s === 'fault' ? 'fault' : s === 'ready' ? 'ready' : s === 'loading' ? 'loading' : 'off';
  return (
    <header className="sticky top-0 z-30 bg-void border-b border-line px-4 py-2 flex flex-wrap md:flex-nowrap items-center gap-x-5 gap-y-2">
      <span className="display text-[17px] text-ink shrink-0 tracking-[0.04em]">PERPLEX</span>
      <span className="mono text-[11px] text-ink-faint shrink-0 hidden lg:inline">SECTOR 03 · CONSOLE</span>
      <div className="order-last md:order-none w-full md:w-auto md:flex-1 md:max-w-lg min-w-0">
        {phone ? (
          <>
            <label htmlFor="model" className="sr-only">Model</label>
            <select id="model" className="well mono text-[13px] w-full h-8 px-2" value={p.model} disabled={p.busy}
              onChange={(e) => p.onModel(e.target.value as ModelKey)} aria-describedby="model-status">
              {MODEL_KEYS.map((k) => <option key={k} value={k}>{optionText(k, p.expected)}</option>)}
            </select>
          </>
        ) : <ModelListbox model={p.model} onModel={p.onModel} backend={p.expected} disabled={p.busy} />}
        <p id="model-status" aria-live="polite" className={`mono text-[11px] mt-1 ${s === 'fault' ? 'text-fault' : 'text-ink-dim'} ${phone ? '' : 'truncate'}`}>
          {statusLine(p.model, p.status, p.expected, p.busy)}
        </p>
      </div>
      <div className="flex items-center gap-3 md:gap-4 ml-auto shrink-0">
        <span role="status" className="flex items-center gap-1.5 mono text-[11px] text-ink-dim">
          <span key={s} aria-hidden="true" className={`h-2 w-2 rounded-full ${s === 'fault' ? 'lamp-fault' : s === 'loading' ? 'lamp-loading' : ''}`} style={{ background: lamp }} />
          <span>{lampName.toUpperCase()}</span>
        </span>
        <button type="button" className="btn-ghost text-[13px]" onClick={p.onViewMath} aria-haspopup="dialog">View math</button>
        <button type="button" className="mobile-only btn-outline text-xs px-2 py-1" onClick={() => p.onOpenSheet('controls')}>Controls</button>
        <button type="button" className="mobile-only btn-outline text-xs px-2 py-1" onClick={() => p.onOpenSheet('readouts')}>Readouts</button>
      </div>
    </header>
  );
}

/** The formula and a worked example, computed with the same functions the console uses. */
export function MathBody() {
  const ex = [['I', 0.5], ['␣love', 0.8], ['␣Python', 0.2]] as const;
  const w = workedCalc(ex.map(([, p]) => ({ h: -Math.log(p) })));
  return (
    <div className="space-y-6 text-sm text-ink-dim leading-relaxed">
      <section>
        <h3 className="mono text-[11px] text-ink-faint mb-2">FORMULA</h3>
        <p className="mono text-ink text-[13px]">h_i = −ln P(token_i | earlier tokens)</p>
        <p className="mono text-ink text-[13px] mt-1">PPL = exp( (1/N) · Σ h_i ) = e^(water level)</p>
        <p className="mt-3">Each token's surprisal h is the height of its ridge. The mean height is the water level. Perplexity is e raised to that level, which equals the N-th root of the product of all 1/P values.</p>
        <p className="mt-2">The model reads the sentence once. The probability for token i comes from its prediction at position i−1, a log-softmax over its whole vocabulary. A start token goes first, so the first word gets a probability too.</p>
      </section>
      <section>
        <h3 className="mono text-[11px] text-ink-faint mb-2">WORKED EXAMPLE · "I love Python"</h3>
        <table className="w-full text-[12px]">
          <thead><tr className="text-ink-faint text-left"><th className="font-normal py-1">Token</th><th className="font-normal text-right">P</th><th className="font-normal text-right">1/P</th><th className="font-normal text-right">−ln P</th></tr></thead>
          <tbody>{ex.map(([t, p]) => (
            <tr key={t} className="border-t border-line text-ink"><td className="py-1">{t}</td><td className="text-right">{p}</td><td className="text-right">{formatNum(1 / p)}</td><td className="text-right">{(-Math.log(p)).toFixed(3)}</td></tr>
          ))}</tbody>
        </table>
        <ol className="mono text-[12px] text-ink mt-4 space-y-1.5">
          <li>1. multiply 1/P: {w.factors.join(' × ')} = {w.product}</li>
          <li>2. count N = {w.n}</li>
          <li>3. N-th root: {w.product}^(1/{w.n}) = {w.root.toFixed(3)}</li>
          <li className="text-ink-dim">log form: e^({w.mean.toFixed(3)}) = {w.root.toFixed(3)}</li>
        </ol>
        <p className="mt-4 text-xs text-ink-faint">These three probabilities give perplexity ≈ 2.32: the cube root of 12.5.</p>
      </section>
    </div>
  );
}

/** Per-model download progress (per file while loading) and what the browser is storing for this site. */
export function DownloadStatus({ models, expected }: { models: Record<ModelKey, ModelState>; expected: Backend | null }) {
  const [stored, setStored] = useState<number | null>(null);
  const states = MODEL_KEYS.map((k) => models[k].state).join();
  useEffect(() => {
    navigator.storage?.estimate?.().then((e) => setStored(e.usage ?? null)).catch(() => setStored(null));
  }, [states]);
  return (
    <div>
      <h3 className="mono text-[11px] tracking-[0.08em] text-ink-faint mb-2">MODEL DOWNLOAD · MEMORY</h3>
      <ul className="space-y-2 text-[12px]">
        {MODEL_KEYS.map((k) => {
          const m = models[k], d = downloadTotals(m), b = m.backend ?? plannedBackend(k, expected);
          return (
            <li key={k}>
              <div className="flex justify-between gap-2">
                <span className="text-ink">{MODELS[k].label} · {MODELS[k].name}</span>
                <span className={`mono ${m.state === 'fault' ? 'text-fault' : 'text-ink-dim'}`}>
                  {m.state === 'ready' ? `ready · ${backendLabel(m.backend)}` : m.state === 'loading' ? `${d.pct.toFixed(0)}%` : m.state === 'fault' ? 'fault' : 'not loaded'}
                </span>
              </div>
              <p className="mono text-[11px] text-ink-faint">
                {m.state === 'ready' ? `~${MODELS[k].mb[b]} MB of ${MODELS[k].dtype[b]} weights in the worker's memory`
                  : m.state === 'loading' ? `${formatMB(d.loaded)} of ${formatMB(d.total)}` : `${MODELS[k].mb[b]} MB download, cached after the first run`}
              </p>
              {m.state === 'loading' && (
                <ul className="mt-1 space-y-0.5">
                  {Object.entries(m.files).map(([f, p]) => (
                    <li key={f} className="grid grid-cols-[minmax(0,1fr)_3rem] gap-2 mono text-[10px] text-ink-faint">
                      <span className="truncate">{f}</span><span className="text-right">{p.done ? 'done' : p.total ? `${Math.round((p.loaded / p.total) * 100)}%` : '…'}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      {stored !== null && <p className="mono text-[11px] text-ink-faint mt-2">Browser storage used by this site: {formatMB(stored)}</p>}
    </div>
  );
}
