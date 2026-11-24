import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, MotionConfig, useReducedMotion } from 'framer-motion';
import { MAX_TOKENS, MODELS, otherModel, parseModelKey, type Backend, type ModelKey } from './lib/models';
import { summarize, type FromWorker, type RunResult, type TokenScore } from './lib/tokens';
import { displayToken } from './lib/format';
import { createClient, ModelError } from './worker/client';
import { bus, emit, type Preset } from './viz/bus';
import { scrollToEl, startLoop } from './viz/loop';
import { Hero } from './components/Hero';
import { Story } from './components/Story';
import { ConsoleHeader, DownloadStatus, freshModel, MathBody, type ModelState } from './components/ConsoleHeader';
import { Controls, SAMPLES } from './components/Controls';
import { Terrain } from './components/Terrain';
import { Readouts } from './components/Readouts';
import { Inspector } from './components/Inspector';
import { Lab } from './components/Lab';
import { Cursor } from './components/Cursor';
import { Panel, Reveal, Sheet, useMedia } from './components/ui';

// The model choice is remembered. Storage can throw in private / blocked modes.
const STORE = 'perplex.model';
const store = {
  get: () => { try { return localStorage.getItem(STORE); } catch { return null; } },
  set: (v: string) => { try { localStorage.setItem(STORE, v); } catch { /* ignore */ } },
};
const SOURCE_URL = 'https://github.com/Vaibhav-047/PERPLEX';
const SUPPORTED = typeof Worker !== 'undefined' && typeof WebAssembly === 'object';
const UNSUPPORTED = "This browser can't run the model here (it needs Web Workers and WebAssembly). The Lab below always works.";

type MSheet = 'controls' | 'readouts' | null;
interface Scoring extends RunResult { text: string }

export default function App() {
  const reduced = !!useReducedMotion();
  bus.reduced = reduced; // set before children render: they read it on mount
  const phone = useMedia('(max-width: 767px)');
  const finePointer = useMedia('(pointer: fine)');
  const t = bus.terrains.console;
  useEffect(() => { startLoop(reduced); }, [reduced]);

  const [expected, setExpected] = useState<Backend | null>(null);
  useEffect(() => {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    if (!gpu) { setExpected('wasm'); return; }
    gpu.requestAdapter().then((a) => setExpected(a ? 'webgpu' : 'wasm'), () => setExpected('wasm'));
  }, []);

  const [model, setModel] = useState<ModelKey>(() => parseModelKey(store.get()));
  useEffect(() => { store.set(model); }, [model]);
  const [models, setModels] = useState<Record<ModelKey, ModelState>>({ fast: freshModel(), accurate: freshModel() });
  const patch = useCallback((k: ModelKey, p: Partial<ModelState> | ((m: ModelState) => Partial<ModelState>)) =>
    setModels((all) => ({ ...all, [k]: { ...all[k], ...(typeof p === 'function' ? p(all[k]) : p) } })), []);

  const [sentence, setSentence] = useState(SAMPLES[2]);
  const [result, setResult] = useState<Scoring | null>(null);
  const [ghost, setGhost] = useState<RunResult | null>(null);
  const [busy, setBusy] = useState<'run' | 'continue' | null>(null);
  const [history, setHistory] = useState<number[]>([]);
  const [fault, setFault] = useState<string | null>(null);
  const [compareNote, setCompareNote] = useState<string | null>(null);
  const [compare, setCompare] = useState(false);
  const [preset, setPreset] = useState<Preset>(reduced ? 'side' : 'orbit');
  const [inspect, setInspect] = useState<{ token: TokenScore; index: number } | null>(null);
  const [mathOpen, setMathOpen] = useState(false);
  const [msheet, setMsheet] = useState<MSheet>(null);
  const consoleRef = useRef<HTMLElement>(null);

  // Reduced motion: a static snapshot in Side view.
  useEffect(() => { if (reduced) { setPreset('side'); emit.preset(bus.terrains.lab, 'side'); } }, [reduced]);
  useEffect(() => { emit.preset(t, preset); }, [preset, t]);

  // ---- the model worker: created on the first run, so nothing downloads until then ----
  const onEvent = useCallback((e: FromWorker) => {
    if (e.type === 'progress') {
      patch(e.model, (m) => ({
        state: m.state === 'ready' ? 'ready' : 'loading',
        files: e.status === 'initiate' || e.total || e.status === 'done'
          ? { ...m.files, [e.file]: { loaded: e.status === 'done' ? (m.files[e.file]?.total ?? 0) : (e.loaded ?? 0), total: e.total ?? m.files[e.file]?.total ?? 0, done: e.status === 'done' } }
          : m.files,
      }));
    } else if (e.type === 'ready') patch(e.model, { state: 'ready', backend: e.backend, note: e.note, message: undefined });
    else if (e.type === 'fallback') patch(e.model, { backend: e.backend, note: e.note });
  }, [patch]);
  const client = useRef<ReturnType<typeof createClient> | null>(null);
  const getClient = () => (client.current ??= createClient(onEvent));
  useEffect(() => () => client.current?.terminate(), []);

  const explain = (e: unknown, k: ModelKey) => {
    const err = e instanceof ModelError ? e : new ModelError(String(e), 'run');
    return err.stage === 'load'
      ? `Could not load ${MODELS[k].name}: ${err.message}. Check your connection and free memory, try the ${MODELS[otherModel(k)].label} model, or use the Lab below, which always works.`
      : `The run failed: ${err.message}. Try a shorter sentence or the other model. The Lab below always works.`;
  };
  const startLoading = (k: ModelKey) => { if (models[k].state !== 'ready') patch(k, { state: 'loading', message: undefined }); };

  const run = async () => {
    const text = sentence;
    if (busy || !text.trim() || !SUPPORTED) return;
    if (phone) setMsheet(null);
    setBusy('run'); setFault(null); setCompareNote(null); setInspect(null);
    emit.run(t); emit.ghost(t, null); setGhost(null);
    const c = getClient();
    startLoading(model);
    try {
      const r = await c.score(model, text);
      setResult({ ...r, text });
      setHistory((h) => [...h, r.perplexity].slice(-24));
      emit.result(t, r.tokens, r.meanSurprisal, r.perplexity);
      if (compare) {
        const other = otherModel(model);
        startLoading(other);
        try {
          const g = await c.score(other, text);
          setGhost(g);
          emit.ghost(t, { h: g.tokens.map((x) => x.h), mean: g.meanSurprisal, ppl: g.perplexity, name: MODELS[other].name });
        } catch (e) {
          const msg = explain(e, other);
          patch(other, { state: 'fault', message: msg });
          setCompareNote(`Compare: ${msg}`);
        }
      }
    } catch (e) {
      const msg = explain(e, model);
      patch(model, { state: 'fault', message: msg });
      setFault(msg);
      emit.fault(t);
    } finally {
      setBusy(null);
    }
  };

  const cont = async () => {
    if (busy || !result) return;
    setBusy('continue'); setFault(null);
    emit.run(t);
    let tokens = [...result.tokens];
    const prompt = result.text + result.tokens.filter((x) => x.generated).map((x) => x.token).join('');
    try {
      await getClient().continue(result.model, prompt, (tok) => {
        tokens = [...tokens, tok];
        const s = summarize(tokens);
        emit.append(t, tok, s.meanSurprisal, s.perplexity);
        setResult((r) => r && { ...r, tokens, perplexity: s.perplexity, meanSurprisal: s.meanSurprisal });
      });
    } catch (e) {
      setFault(explain(e, result.model));
      emit.fault(t);
    } finally {
      emit.done(t);
      setBusy(null);
    }
  };

  const reset = () => {
    emit.reset(t);
    setResult(null); setGhost(null); setFault(null); setCompareNote(null); setHistory([]); setInspect(null);
  };

  // Esc closes the topmost sheet.
  const escRef = useRef(() => {});
  escRef.current = () => { if (inspect) setInspect(null); else if (mathOpen) setMathOpen(false); else if (msheet) setMsheet(null); };
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === 'Escape') escRef.current(); };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);

  const status = models[model];
  const loadingNow = busy !== null && status.state !== 'ready';
  const canRun = SUPPORTED && !busy && sentence.trim().length > 0;
  const canContinue = SUPPORTED && !busy && !!result && result.tokens.length < MAX_TOKENS + 60;
  const reason = !SUPPORTED ? UNSUPPORTED : loadingNow ? 'Loading the model. This happens once; the files are cached afterwards.' : undefined;
  const ghostNote = ghost && result
    ? `Ghost: ${MODELS[ghost.model].name} split this into ${ghost.tokens.length} tokens, ${MODELS[result.model].name} into ${result.tokens.filter((x) => !x.generated).length}. The models tokenize differently, so the ghost is stretched to the same width and its ridges don't line up one to one.`
    : compareNote ?? undefined;

  const sheetProps = (which: 'controls' | 'readouts') => ({ 'data-open': String(msheet === which), ...(phone && msheet !== which ? { inert: '' } : {}) });
  const sheetHead = (title: string) => (
    <div className="mobile-only sticky top-0 z-10 bg-deck flex items-center justify-between px-4 h-11 border-b border-line">
      <span className="display text-sm text-ink">{title}</span>
      <button type="button" className="btn-outline text-xs px-2.5 py-1" onClick={() => setMsheet(null)}>Close</button>
    </div>
  );
  const select = (i: number) => { if (result?.tokens[i]) { emit.select(t, i); setInspect({ token: result.tokens[i], index: i }); } };

  return (
    <MotionConfig reducedMotion="user">
      {!reduced && finePointer && <Cursor />}
      <main>
        <Hero onStart={() => scrollToEl(consoleRef.current)} />
        <Story pinned={!reduced && !phone} />

        <section ref={consoleRef} id="console" className="console" aria-label="Console">
          <ConsoleHeader model={model} onModel={setModel} status={status} expected={expected} busy={busy !== null}
            onViewMath={() => setMathOpen(true)} onOpenSheet={setMsheet} />
          <div className="console-body">
            <aside className="c-controls msheet" aria-label="Controls" data-lenis-prevent {...sheetProps('controls')}>
              {sheetHead('Controls')}
              <Panel label="CONTROLS" id="controls-h" className="max-md:border-0 max-md:rounded-none">
                <Controls sentence={sentence} setSentence={setSentence} onRun={run} onContinue={cont}
                  canRun={canRun} canContinue={canContinue} running={busy !== null} reason={reason}
                  compare={compare} setCompare={setCompare} preset={preset} setPreset={setPreset} onReset={reset} />
              </Panel>
            </aside>
            <Panel label="TERRAIN · ELEVATION = −ln P" id="terrain-h" className="c-terrain p-3 pt-0">
              <Terrain which="console" data={result} onSelect={select} ghostNote={ghostNote}
                overlay={fault} empty={SUPPORTED ? 'Type a sentence and press Run. The model downloads on the first run.' : UNSUPPORTED}
                note={result ? `${MODELS[result.model].name} · ${result.tokens.length} tokens` : undefined} />
              {phone && (
                <div className="flex gap-2 mt-2">
                  <button type="button" className="btn-solid h-10 flex-1 text-sm relative" onClick={run} disabled={!canRun}>
                    {busy === 'run' ? 'Running…' : 'Run'}{busy && <span className="run-scan" aria-hidden="true" />}
                  </button>
                  <button type="button" className="btn-outline h-10 px-4 text-sm" onClick={() => setMsheet('controls')}>Edit sentence</button>
                </div>
              )}
            </Panel>
            <aside className="c-readouts msheet" aria-label="Readouts" data-lenis-prevent {...sheetProps('readouts')}>
              {sheetHead('Readouts')}
              <Panel label="READOUTS" id="readouts-h" className="max-md:border-0 max-md:rounded-none">
                <Readouts data={result} history={history} onSelect={select}
                  empty={SUPPORTED ? 'Run a sentence to see its numbers.' : UNSUPPORTED}
                  status={SUPPORTED ? <DownloadStatus models={models} expected={expected} /> : undefined} />
              </Panel>
            </aside>
          </div>
          {phone && msheet && <div className="fixed inset-0 z-30 bg-void/80" onClick={() => setMsheet(null)} aria-hidden="true" />}
        </section>

        <Lab onInspect={(token, index) => { emit.select(bus.terrains.lab, index); setInspect({ token, index }); }} />
      </main>

      <footer className="border-t border-line px-4 md:px-6 py-10">
        <Reveal className="max-w-5xl mx-auto grid md:grid-cols-[1fr_auto] gap-6 text-sm">
          <div>
            <p className="text-ink">Runs on your device — no text leaves your browser.</p>
            <p className="text-ink-dim mt-2 text-xs leading-relaxed max-w-[70ch]">
              Model files download once from Hugging Face and are cached by your browser. Models:{' '}
              <a className="underline hover:text-ink" href={`https://huggingface.co/${MODELS.fast.id}`}>SmolLM2-135M-Instruct</a> by Hugging Face (Apache-2.0) and{' '}
              <a className="underline hover:text-ink" href={`https://huggingface.co/${MODELS.accurate.id}`}>Qwen2.5-0.5B</a> by the Qwen team (Apache-2.0), ONNX build by onnx-community,
              run with <a className="underline hover:text-ink" href="https://github.com/huggingface/transformers.js">Transformers.js</a>.
            </p>
          </div>
          <div className="md:text-right">
            <a className="mono text-[12px] text-ink-dim hover:text-ink underline" href={SOURCE_URL}>Source</a>
            <p className="mono text-[11px] text-ink-faint mt-2">SECTOR 05 · END OF SURVEY</p>
          </div>
        </Reveal>
      </footer>

      <AnimatePresence>
        {mathOpen && <Sheet key="math" title="The math" onClose={() => setMathOpen(false)} width="min(520px, 100vw)"><MathBody /></Sheet>}
        {inspect && (
          <Sheet key="inspect" title={`Inspector · ${displayToken(inspect.token.token)}`} onClose={() => setInspect(null)} width="min(480px, 100vw)">
            <Inspector token={inspect.token} index={inspect.index} />
          </Sheet>
        )}
      </AnimatePresence>
    </MotionConfig>
  );
}
