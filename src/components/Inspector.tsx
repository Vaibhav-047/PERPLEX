import { useMemo } from 'react';
import { drawPeaks, type Peak } from '../viz/scenes';
import { useCanvas } from '../viz/useCanvas';
import { displayToken, fixed, formatNum } from '../lib/format';
import type { Cand, TokenScore } from '../lib/tokens';
import { ProbBar } from './ui';

const same = (c: Cand, t: TokenScore) => (c.id !== undefined ? c.id === t.id : c.token === t.token);

/** The top-8 candidates at one position: ghost peaks showing how tall each alternative would have been, plus bar meters. */
export function Inspector({ token, index }: { token: TokenScore; index: number }) {
  const peaks = useMemo<Peak[]>(() => {
    const list = token.top8.map((c) => ({ token: c.token, p: c.p, actual: same(c, token) }));
    if (list.length && !list.some((k) => k.actual)) list.push({ token: token.token, p: token.p, actual: true });
    return list;
  }, [token]);
  const ref = useCanvas((ctx, w, h) => drawPeaks(ctx, w, h, peaks));
  const rank = token.top8.findIndex((c) => same(c, token));
  return (
    <div className="space-y-5">
      <div>
        <p className="mono text-[11px] text-ink-faint">POSITION {index + 1}{token.generated ? ' · GENERATED' : ''}</p>
        <p className="mono text-2xl text-ink mt-1">{displayToken(token.token)}</p>
        <p className="mono text-[12px] text-ink-dim mt-1">P {formatNum(token.p)} · height −ln P = {fixed(token.h, 3)} · {rank >= 0 ? `rank ${rank + 1} of the model's choices` : 'not in the top 8'}</p>
      </div>
      {token.top8.length ? (
        <>
          <div className="h-48 rounded-md bg-void border border-line overflow-hidden" aria-hidden="true"><canvas ref={ref} className="w-full h-full block" /></div>
          <p className="sr-only">Ghost peaks: {peaks.map((k) => `'${k.token}' height ${fixed(-Math.log(k.p))}${k.actual ? ' (actual)' : ''}`).join(', ')}.</p>
          <div>
            <h3 className="mono text-[11px] text-ink-faint mb-2">WHAT THE MODEL EXPECTED HERE</h3>
            <ul className="space-y-1.5">
              {token.top8.map((c, i) => <ProbBar key={i} label={displayToken(c.token)} p={c.p} mark={same(c, token) ? '◂ actual' : undefined} highlight={same(c, token)} />)}
            </ul>
          </div>
        </>
      ) : <p className="text-sm text-ink-dim">Simulated rows have no alternatives. Run a sentence in the console to see what the model expected at each position.</p>}
    </div>
  );
}
