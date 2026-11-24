import { useEffect, useMemo, useRef, useState } from 'react';
import { bus, emit } from '../viz/bus';
import { parseProb, summarize, type Scored, type TokenScore } from '../lib/tokens';
import { Label, Panel, Reveal } from './ui';
import { Terrain } from './Terrain';
import { Readouts } from './Readouts';

interface Row { key: number; token: string; p: string }
let nextKey = 1;
const rows = (pairs: [string, number][]): Row[] => pairs.map(([token, p]) => ({ key: nextKey++, token, p: String(p) }));

export const LAB_PRESETS: { name: string; pairs: [string, number][] }[] = [
  { name: 'I love Python', pairs: [['I', 0.5], [' love', 0.8], [' Python', 0.2]] },
  { name: 'All 1/8', pairs: Array.from({ length: 8 }, (_, i) => [`t${i + 1}`, 0.125] as [string, number]) },
  { name: 'One surprising word', pairs: [['The', 0.9], [' cat', 0.9], [' sat', 0.9], [' quietly', 0.01]] },
];

/** Simulated terrain: edit tokens and probabilities and the terrain, water level and readouts reshape as you type. */
export function Lab({ onInspect }: { onInspect: (t: TokenScore, i: number) => void }) {
  const [list, setList] = useState<Row[]>(() => rows(LAB_PRESETS[0].pairs));
  const [preset, setPreset] = useState(LAB_PRESETS[0].name);
  const [shapeKey, setShapeKey] = useState(0); // bumped when rows are added, removed or replaced
  const lastShape = useRef(-1);
  const parsed = list.map((r) => ({ r, v: parseProb(r.p) }));
  const valid = parsed.filter((x) => x.v.ok);
  const data = useMemo<Scored | null>(() => {
    const tokens: TokenScore[] = valid.map(({ r, v }) => {
      const p = (v as { p: number }).p;
      return { token: r.token, id: -1, p, h: -Math.log(p), top8: [] };
    });
    if (!tokens.length) return null;
    const s = summarize(tokens);
    return { tokens, perplexity: s.perplexity, meanSurprisal: s.meanSurprisal };
  }, [JSON.stringify(valid.map(({ r, v }) => [r.token, v.ok && v.p]))]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const t = bus.terrains.lab;
    if (!data) { emit.reset(t); return; }
    // sweep in only when the shape changes (a preset, or a row added or removed); typing reshapes in place
    emit.result(t, data.tokens, data.meanSurprisal, data.perplexity, shapeKey !== lastShape.current);
    lastShape.current = shapeKey;
  }, [data, shapeKey]);

  const set = (key: number, patch: Partial<Row>) => setList((l) => l.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const invalid = parsed.length - valid.length;

  return (
    <section id="lab" aria-labelledby="lab-title" className="px-4 md:px-6 py-20">
      <Reveal className="mb-6">
        <Label className="mb-3">SECTOR 04 · LAB</Label>
        <h2 id="lab-title" className="display text-[clamp(28px,4vw,52px)] leading-[1.05] text-ink">Shape your own terrain</h2>
        <p className="mono text-[12px] text-caution mt-3">SIMULATED — not from the model</p>
        <p className="text-sm text-ink-dim mt-2 max-w-[60ch]">Type any tokens and probabilities. This works in every browser, with no download.</p>
      </Reveal>
      <div className="lab-grid">
        <Panel label="ROWS" id="lab-rows-h">
          <div className="px-4 pb-4">
            <div className="flex flex-wrap gap-1.5 mb-3" role="group" aria-label="Presets">
              {LAB_PRESETS.map((x) => (
                <button key={x.name} type="button" onClick={() => { setList(rows(x.pairs)); setPreset(x.name); setShapeKey((k) => k + 1); }}
                  className={`mono text-[11px] px-2 py-1 rounded border ${preset === x.name ? 'border-ink-dim text-ink' : 'border-line-hi text-ink-dim hover:text-ink'}`}>{x.name}</button>
              ))}
            </div>
            <ul className="space-y-1.5">
              {parsed.map(({ r, v }, i) => (
                <li key={r.key}>
                  <div className="grid grid-cols-[1.4rem_minmax(0,1fr)_5rem_1.8rem] gap-1.5 items-center">
                    <span className="mono text-[10px] text-ink-faint">{i + 1}</span>
                    <input aria-label={`Token ${i + 1}`} value={r.token} onChange={(e) => { set(r.key, { token: e.target.value }); setPreset(''); }} className="well mono text-[12px] h-8 px-2 min-w-0" />
                    <input aria-label={`Probability ${i + 1}`} value={r.p} inputMode="decimal" aria-invalid={!v.ok} aria-describedby={!v.ok ? `lab-err-${r.key}` : undefined}
                      onChange={(e) => set(r.key, { p: e.target.value })}
                      className={`well mono text-[12px] h-8 px-2 min-w-0 text-right ${!v.ok ? '!border-fault' : ''}`} />
                    <button type="button" aria-label={`Remove row ${i + 1}`} onClick={() => { setList((l) => l.filter((x) => x.key !== r.key)); setShapeKey((k) => k + 1); }} disabled={list.length <= 1}
                      className="btn-outline h-8 text-[13px] text-ink-dim">−</button>
                  </div>
                  {!v.ok && <p id={`lab-err-${r.key}`} className="text-[11px] text-fault mt-1 ml-[1.9rem]">{v.error} (P must be &gt; 0 and ≤ 1)</p>}
                </li>
              ))}
            </ul>
            <button type="button" onClick={() => { setList((l) => [...l, ...rows([['new', 0.5]])]); setPreset(''); setShapeKey((k) => k + 1); }} disabled={list.length >= 40}
              className="btn-outline h-8 w-full mt-2 text-[12px]">+ Add row</button>
            {invalid > 0 && <p className="text-xs text-ink-faint mt-2" aria-live="polite">{invalid} row{invalid > 1 ? 's' : ''} left out until fixed.</p>}
          </div>
        </Panel>
        <Panel label="SIMULATED TERRAIN" id="lab-terrain-h" className="p-3 pt-0 flex flex-col min-h-[460px]">
          <Terrain which="lab" data={data} onSelect={(i) => data && onInspect(data.tokens[i], i)} empty="Add a row with a valid probability." note="SIMULATED" />
        </Panel>
        <Panel label="SIMULATED READOUTS" id="lab-readouts-h">
          <Readouts data={data} empty="Add a row with a valid probability." onSelect={(i) => data && onInspect(data.tokens[i], i)} />
        </Panel>
      </div>
    </section>
  );
}
