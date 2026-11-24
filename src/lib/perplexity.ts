// Perplexity math. Everything stays in log space (nats) so long sentences never overflow or underflow.
// assertProbability / surprisal / perplexity / statsFromLogprobs come from p_exp/lib/perplexity.ts.

export function assertProbability(p: number): void {
  if (!(Number.isFinite(p) && p > 0 && p <= 1)) {
    throw new RangeError(`Each probability must be > 0 and <= 1 (got ${p}).`);
  }
}

/** Surprisal of one token, in nats: h = -ln p. */
export function surprisal(p: number): number {
  assertProbability(p);
  return -Math.log(p);
}

/** Mean surprisal (the water level), in nats. */
export function meanSurprisal(ps: readonly number[]): number {
  if (ps.length === 0) throw new RangeError('Need at least one probability.');
  let sum = 0;
  for (const p of ps) sum += surprisal(p);
  return sum / ps.length;
}

/** perplexity = exp(mean of -ln p) = e^(water level). */
export function perplexity(ps: readonly number[]): number {
  return Math.exp(meanSurprisal(ps));
}

/** Same result from log-probabilities: stays exact when exp(logp) would underflow to 0. */
export function statsFromLogprobs(logprobs: readonly number[]): { perplexity: number; meanSurprisal: number } {
  if (logprobs.length === 0) throw new RangeError('Need at least one logprob.');
  let sum = 0;
  for (const lp of logprobs) {
    if (!(Number.isFinite(lp) && lp <= 0)) throw new RangeError(`A logprob must be finite and <= 0 (got ${lp}).`);
    sum += -lp;
  }
  const mean = sum / logprobs.length;
  return { perplexity: Math.exp(mean), meanSurprisal: mean };
}

/** log Z for one row of logits: log-sum-exp after subtracting the max (stable log-softmax). log p_j = x_j - logZ. */
export function logNormalizer(x: ArrayLike<number>, off: number, V: number): number {
  let m = -Infinity;
  for (let j = 0; j < V; j++) { const v = x[off + j]; if (v > m) m = v; }
  let s = 0;
  for (let j = 0; j < V; j++) s += Math.exp(x[off + j] - m);
  return m + Math.log(s);
}

export interface Pick { id: number; logp: number }

/** The k most likely ids in one row, most likely first. */
export function topK(x: ArrayLike<number>, off: number, V: number, k: number, logZ: number): Pick[] {
  const ids: number[] = [], vals: number[] = [];
  for (let j = 0; j < V; j++) {
    const v = x[off + j];
    if (ids.length === k && v <= vals[k - 1]) continue;
    let i = Math.min(ids.length, k - 1);
    while (i > 0 && vals[i - 1] < v) i--;
    ids.splice(i, 0, j); vals.splice(i, 0, v);
    if (ids.length > k) { ids.pop(); vals.pop(); }
  }
  return ids.map((id, i) => ({ id, logp: vals[i] - logZ }));
}

/**
 * Score a sequence from one forward pass. `ids[0]` is the start token; `logits` is [seq, V] row-major.
 * P(ids[i] | ids[<i]) = softmax(logits row i-1)[ids[i]], for i = 1..n-1.
 */
export function scoreLogits(logits: ArrayLike<number>, ids: readonly number[], V: number, k = 8) {
  if (ids.length < 2) throw new RangeError('Need at least one token after the start token.');
  const logp: number[] = [], top: Pick[][] = [];
  for (let i = 1; i < ids.length; i++) {
    const off = (i - 1) * V, logZ = logNormalizer(logits, off, V);
    logp.push(Math.min(0, logits[off + ids[i]] - logZ));
    top.push(topK(logits, off, V, k, logZ));
  }
  const last = (ids.length - 1) * V;
  const next = topK(logits, last, V, k, logNormalizer(logits, last, V));
  return { logp, top, next };
}

/**
 * True when a logits row cannot be a real prediction: non-finite, absurdly large, or flat (every logit equal,
 * which ORT-web's WebGPU q4f16 Qwen2.5 returns for the first position: an fp16 overflow).
 */
export function rowIsBroken(x: ArrayLike<number>, off: number, V: number): boolean {
  let lo = Infinity, hi = -Infinity;
  for (let j = 0; j < V; j++) {
    const v = x[off + j];
    if (!Number.isFinite(v) || Math.abs(v) > 1e4) return true;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return hi - lo < 1e-3;
}

/** IEEE 754 half -> number, for browsers without Float16Array (logits then arrive as raw Uint16 bits). */
export function halfToFloat(u: number): number {
  const s = u & 0x8000 ? -1 : 1, e = (u >> 10) & 0x1f, f = u & 0x3ff;
  if (e === 0) return s * 2 ** -14 * (f / 1024);
  if (e === 31) return f ? NaN : s * Infinity;
  return s * 2 ** (e - 15) * (1 + f / 1024);
}

export function toNumbers(data: unknown): ArrayLike<number> {
  if (data instanceof Uint16Array) return Float32Array.from(data, halfToFloat);
  return data as ArrayLike<number>;
}
