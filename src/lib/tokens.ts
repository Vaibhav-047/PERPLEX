import type { Backend, ModelKey } from './models';
import { formatNum } from './format';

export interface Cand { token: string; p: number; id?: number }
/** One scored token. h = -ln p is kept as the source of truth (p may underflow to 0 for display). */
export interface TokenScore { token: string; id: number; p: number; h: number; top8: Cand[]; generated?: boolean }

/** What the visuals and readouts need; a model run and a Lab table both produce it. */
export interface Scored { tokens: TokenScore[]; perplexity: number; meanSurprisal: number; ms?: number; next8?: Cand[] }

export interface RunResult extends Scored { model: ModelKey; backend: Backend; ms: number; next8: Cand[] }

// ---- worker protocol ----
export type ToWorker =
  | { type: 'score'; req: number; model: ModelKey; text: string }
  | { type: 'continue'; req: number; model: ModelKey; text: string };

export type FromWorker =
  | { type: 'progress'; model: ModelKey; status: string; file: string; loaded?: number; total?: number }
  | { type: 'ready'; model: ModelKey; backend: Backend; dtype: string; note?: string }
  | { type: 'fallback'; model: ModelKey; backend: Backend; note: string }
  | { type: 'result'; req: number; result: RunResult }
  | { type: 'gen'; req: number; token: TokenScore }
  | { type: 'gen-done'; req: number }
  | { type: 'error'; req: number; model: ModelKey; stage: 'load' | 'run'; message: string };

/** Mean surprisal and perplexity of a token list, from h (log space). */
export function summarize(tokens: readonly { h: number }[]) {
  if (!tokens.length) return { perplexity: NaN, meanSurprisal: NaN, peak: -1 };
  let sum = 0, peak = 0;
  tokens.forEach((t, i) => { sum += t.h; if (t.h > tokens[peak].h) peak = i; });
  const mean = sum / tokens.length;
  return { perplexity: Math.exp(mean), meanSurprisal: mean, peak };
}

/** Parse a Lab probability cell. Accepts 0.25, .25, 25%, 1/4. */
export function parseProb(s: string): { ok: true; p: number } | { ok: false; error: string } {
  const t = s.trim();
  if (!t) return { ok: false, error: 'Enter a probability' };
  let p: number;
  const frac = t.match(/^(\d*\.?\d+)\s*\/\s*(\d*\.?\d+)$/);
  if (frac) p = Number(frac[1]) / Number(frac[2]);
  else if (t.endsWith('%')) p = Number(t.slice(0, -1)) / 100;
  else p = Number(t);
  if (!Number.isFinite(p)) return { ok: false, error: 'Not a number' };
  if (p <= 0) return { ok: false, error: 'Must be greater than 0' };
  if (p > 1) return { ok: false, error: 'Must be at most 1' };
  return { ok: true, p };
}

/** The worked calculation shown in the readouts and the math sheet. */
export function workedCalc(tokens: readonly { h: number }[], max = 10) {
  const n = tokens.length;
  const sumH = tokens.reduce((s, t) => s + t.h, 0);
  const factors = tokens.slice(0, max).map((t) => formatNum(Math.exp(t.h)));
  const productLog = sumH; // ln(prod 1/p) = sum h
  const product = productLog > 700 ? `e^${formatNum(productLog)}` : formatNum(Math.exp(productLog));
  const mean = n ? sumH / n : NaN;
  return { factors, more: n > max, product, n, mean, root: Math.exp(mean) };
}
