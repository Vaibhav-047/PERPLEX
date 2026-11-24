import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { bus } from '../viz/bus';
import { elevation, H_MAX, hToV } from '../viz/color';
import { displayToken, fixed, formatMs, formatNum } from '../lib/format';
import { summarize, workedCalc, type Scored } from '../lib/tokens';
import { EASE, ProbBar, Roll } from './ui';

const Sub = ({ children }: { children: ReactNode }) => <h3 className="mono text-[11px] tracking-[0.08em] text-ink-faint mb-2">{children}</h3>;
const Block = ({ children, className = '' }: { children: ReactNode; className?: string }) => <div className={`py-3 border-t border-line first:border-t-0 ${className}`}>{children}</div>;

/** Vertical water gauge: the fill is the mean surprisal, the tick is a peak-hold at the highest ridge. */
function Gauge({ mean, peak }: { mean: number; peak: number }) {
  const scale = Math.max(H_MAX, Math.ceil(peak));
  const pct = (v: number) => `${Math.min(100, (v / scale) * 100)}%`;
  return (
    <div className="flex gap-2 items-stretch h-36" role="img" aria-label={`Water gauge: mean surprisal ${fixed(mean)}, highest ridge ${fixed(peak)}, scale 0 to ${scale}`}>
      <div className="flex flex-col justify-between mono text-[10px] text-ink-faint text-right" aria-hidden="true"><span>{scale}</span><span>{scale / 2}</span><span>0</span></div>
      <div className="relative w-6 border border-line-hi rounded-[2px] bg-well overflow-hidden" aria-hidden="true">
        <motion.div className="absolute inset-x-0 bottom-0" style={{ background: 'rgba(18,181,166,0.35)', borderTop: '1px solid rgba(238,241,236,0.4)' }}
          initial={bus.reduced ? false : { height: 0 }} animate={{ height: pct(mean) }} transition={{ duration: 0.8, ease: EASE }} />
        <motion.div className="absolute inset-x-0 h-[2px]" style={{ background: elevation(hToV(peak)) }}
          initial={bus.reduced ? false : { bottom: 0 }} animate={{ bottom: pct(peak) }} transition={{ duration: 0.8, ease: EASE }} />
      </div>
      <div className="relative flex-1 mono text-[11px]" aria-hidden="true">
        <span className="absolute left-0 text-ink-dim -translate-y-1/2" style={{ bottom: pct(peak) }}>peak {fixed(peak)}</span>
        <span className="absolute left-0 text-ink translate-y-1/2" style={{ bottom: pct(mean) }}>level {fixed(mean)}</span>
      </div>
    </div>
  );
}

function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return <p className="text-xs text-ink-faint">Run a few sentences to draw a trend.</p>;
  const W = 240, H = 40, lo = Math.min(...values), hi = Math.max(...values), span = hi - lo || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * W},${H - 3 - ((v - lo) / span) * (H - 6)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-10" role="img" aria-label={`Perplexity across ${values.length} runs: ${values.map((v) => fixed(v, 1)).join(', ')}`}>
      <polyline points={pts} fill="none" stroke="var(--ink-dim)" strokeWidth="1" />
      {values.map((v, i) => <circle key={i} cx={(i / (values.length - 1)) * W} cy={H - 3 - ((v - lo) / span) * (H - 6)} r="1.8" fill={elevation(hToV(Math.log(v)))} />)}
    </svg>
  );
}

interface Props { data: Scored | null; history?: number[]; status?: ReactNode; empty: string; onSelect?: (i: number) => void }

export function Readouts({ data, history, status, empty, onSelect }: Props) {
  const tokens = data?.tokens ?? [];
  if (!tokens.length) {
    return (
      <div className="px-4 pb-4">
        <p className="text-sm text-ink-dim">{empty}</p>
        {status && <Block className="mt-3">{status}</Block>}
      </div>
    );
  }
  const s = summarize(tokens), peak = tokens[s.peak], w = workedCalc(tokens);
  return (
    <div className="px-4 pb-4">
      <Block>
        <Sub>PERPLEXITY</Sub>
        <p className="mono text-[44px] leading-none text-ink" aria-label={`Perplexity ${fixed(s.perplexity, 2)}`}>
          <Roll value={s.perplexity} format={(v) => fixed(v, 2)} />
        </p>
        <p className="text-sm text-ink-dim mt-2">≈ choosing between {formatNum(s.perplexity)} equally likely tokens</p>
      </Block>
      <div className="readout-grid">
        <Block>
          <Sub>WATER GAUGE · NATS</Sub>
          <Gauge mean={s.meanSurprisal} peak={peak.h} />
        </Block>
        <Block>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5 text-[12px]">
            <dt className="text-ink-faint">Mean surprisal</dt><dd className="mono text-ink text-right">{fixed(s.meanSurprisal, 3)}</dd>
            <dt className="text-ink-faint">Tokens</dt><dd className="mono text-ink text-right">{tokens.length}</dd>
            <dt className="text-ink-faint">Highest peak</dt>
            <dd className="mono text-ink text-right truncate">
              <button type="button" className="hover:underline" onClick={() => onSelect?.(s.peak)} disabled={!onSelect}>{displayToken(peak.token)}</button>
              <span className="text-ink-dim"> {formatNum(peak.p, 2)}</span>
            </dd>
            {data?.ms !== undefined && <><dt className="text-ink-faint">Run time</dt><dd className="mono text-ink text-right">{formatMs(data.ms)}</dd></>}
          </dl>
          {history && <div className="mt-3"><Sub>THIS SESSION</Sub><Spark values={history} /></div>}
        </Block>
        {status && <Block>{status}</Block>}
        <Block>
          <Sub>WORKED CALCULATION</Sub>
          <ol className="mono text-[11px] text-ink space-y-1.5 break-words">
            <li><span className="text-ink-faint">1 · multiply 1/P </span>{w.factors.join(' × ')}{w.more ? ' × …' : ''} = {w.product}</li>
            <li><span className="text-ink-faint">2 · count </span>N = {w.n}</li>
            <li><span className="text-ink-faint">3 · N-th root </span>({w.product})^(1/{w.n}) = {fixed(w.root, 3)}</li>
            <li className="text-ink-dim"><span className="text-ink-faint">log form </span>e^(mean of −ln P) = e^{fixed(w.mean, 3)} = {fixed(w.root, 3)}</li>
          </ol>
        </Block>
      </div>
      <Block>
        <Sub>DATA</Sub>
        <div className="max-h-56 overflow-auto" data-lenis-prevent>
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-deck"><tr className="text-ink-faint text-right"><th className="font-normal text-left py-1">#</th><th className="font-normal text-left">Token</th><th className="font-normal">P</th><th className="font-normal">1/P</th><th className="font-normal">−ln P</th></tr></thead>
            <tbody>
              {tokens.map((t, i) => (
                <tr key={i} className={`border-t border-line text-right ${i === s.peak ? 'text-ink' : 'text-ink-dim'}`}>
                  <td className="text-left py-1 text-ink-faint">{i + 1}</td>
                  <td className="text-left max-w-[8rem] truncate">{displayToken(t.token)}{t.generated ? <span className="text-ink-faint"> gen</span> : null}</td>
                  <td>{formatNum(t.p)}</td><td>{formatNum(Math.exp(t.h))}</td><td>{formatNum(t.h)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Block>
      {data?.next8 && data.next8.length > 0 && (
        <Block>
          <Sub>NEXT TOKEN · AFTER THE SENTENCE</Sub>
          <ul className="space-y-1.5">{data.next8.map((c, i) => <ProbBar key={i} label={displayToken(c.token)} p={c.p} highlight={i === 0} />)}</ul>
        </Block>
      )}
    </div>
  );
}
