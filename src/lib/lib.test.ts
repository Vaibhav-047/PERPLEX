import { describe, expect, it } from 'vitest';
import { halfToFloat, logNormalizer, rowIsBroken, meanSurprisal, perplexity, scoreLogits, statsFromLogprobs, toNumbers, topK } from './perplexity';
import { displayToken, fixed, formatNum } from './format';
import { MODELS, otherModel, parseModelKey, plannedBackend } from './models';
import { parseProb, summarize, workedCalc } from './tokens';

describe('perplexity math', () => {
  it('eight tokens at 0.125 give perplexity 8: a flat plateau at h = ln 8', () => {
    expect(perplexity(Array(8).fill(0.125))).toBeCloseTo(8, 10);
    expect(meanSurprisal(Array(8).fill(0.125))).toBeCloseTo(Math.log(8), 12);
  });

  // The spec says ≈ 2.92. The true value is the cube root of 2 × 1.25 × 5 = 12.5, which is about 2.32.
  it('[0.5, 0.8, 0.2] gives about 2.32 (not 2.92 as the spec says)', () => {
    expect(perplexity([0.5, 0.8, 0.2])).toBeCloseTo(Math.cbrt(12.5), 10);
    expect(perplexity([0.5, 0.8, 0.2])).toBeCloseTo(2.321, 3);
  });

  it('rejects an empty list', () => {
    expect(() => perplexity([])).toThrow(RangeError);
    expect(() => statsFromLogprobs([])).toThrow(RangeError);
  });

  it('rejects p <= 0, p > 1 and NaN', () => {
    expect(() => perplexity([0.5, 0])).toThrow(RangeError);
    expect(() => perplexity([-0.1])).toThrow(RangeError);
    expect(() => perplexity([1.2])).toThrow(RangeError);
    expect(() => perplexity([Number.NaN])).toThrow(RangeError);
  });

  it('stays finite for long, very unlikely sentences (log space)', () => {
    expect(Number.isFinite(perplexity(Array(500).fill(1e-300)))).toBe(true);
    expect(statsFromLogprobs([-800]).meanSurprisal).toBe(800);
  });
});

describe('log-softmax scoring', () => {
  it('is stable for huge logits', () => {
    const z = logNormalizer([1000, 1000], 0, 2);
    expect(z).toBeCloseTo(1000 + Math.log(2), 10);
  });

  it('topK returns the k largest, most likely first', () => {
    const row = [0.1, 3, -2, 5, 3.5, 0];
    const t = topK(row, 0, 6, 3, logNormalizer(row, 0, 6));
    expect(t.map((x) => x.id)).toEqual([3, 4, 1]);
    const sum = row.reduce((s, v) => s + Math.exp(v - logNormalizer(row, 0, 6)), 0);
    expect(sum).toBeCloseTo(1, 12);
  });

  it('P(token i) comes from the logits at position i-1', () => {
    // vocab 3, ids = [BOS=0, 2, 1]; row 0 predicts id 2, row 1 predicts id 1, row 2 is the next token.
    const V = 3;
    const logits = [Math.log(0.2), Math.log(0.3), Math.log(0.5), Math.log(0.1), Math.log(0.8), Math.log(0.1), 0, 0, 5];
    const r = scoreLogits(logits, [0, 2, 1], V, 2);
    expect(Math.exp(r.logp[0])).toBeCloseTo(0.5, 10);
    expect(Math.exp(r.logp[1])).toBeCloseTo(0.8, 10);
    expect(r.top[0][0].id).toBe(2);
    expect(r.next[0].id).toBe(2);
    expect(() => scoreLogits(logits, [0], V)).toThrow(RangeError);
  });

  it('flags logits rows that cannot be real predictions', () => {
    expect(rowIsBroken([0, 0, 0, 0], 0, 4)).toBe(true); // flat: what WebGPU q4f16 Qwen2.5 gives at position 0
    expect(rowIsBroken([2e10, 2.1e10], 0, 2)).toBe(true); // what WebGPU int8 gives
    expect(rowIsBroken([1, Number.NaN], 0, 2)).toBe(true);
    expect(rowIsBroken([6.08, 5.56, 3.93], 0, 3)).toBe(false);
  });

  it('decodes half floats when Float16Array is missing', () => {
    expect(halfToFloat(0x3c00)).toBe(1);
    expect(halfToFloat(0xc000)).toBe(-2);
    expect(halfToFloat(0x7c00)).toBe(Infinity);
    expect(Array.from(toNumbers(new Uint16Array([0x3800])))).toEqual([0.5]);
  });
});

describe('format', () => {
  it('shows whitespace', () => {
    expect(displayToken(' Paris\n')).toBe('␣Paris↵');
  });
  it('uses scientific notation below 0.001 or above 1e6', () => {
    expect(formatNum(0.0004)).toBe('4.00e-4');
    expect(formatNum(2.5e7)).toBe('2.50e7');
    expect(formatNum(0.125)).toBe('0.125');
    expect(fixed(12.44, 1)).toBe('12.4');
    expect(fixed(3e-5)).toBe('3.00e-5');
  });
});

describe('models', () => {
  it('uses the specified repos; Accurate uses q4 because the specified q4f16/int8 files give wrong numbers (see models.ts)', () => {
    expect(MODELS.fast.id).toBe('HuggingFaceTB/SmolLM2-135M-Instruct');
    expect(MODELS.fast.dtype.wasm).toBe('int8');
    expect(MODELS.fast.devices).toEqual(['wasm']);
    expect(MODELS.accurate.id).toBe('onnx-community/Qwen2.5-0.5B');
    expect(MODELS.accurate.dtype).toEqual({ webgpu: 'q4', wasm: 'q4' });
    expect(plannedBackend('accurate', 'webgpu')).toBe('webgpu');
    expect(plannedBackend('fast', 'webgpu')).toBe('wasm');
    expect(plannedBackend('accurate', null)).toBe('wasm');
  });
  it('remembers only known choices, defaulting to Accurate', () => {
    expect(parseModelKey('fast')).toBe('fast');
    expect(parseModelKey('nonsense')).toBe('accurate');
    expect(parseModelKey(null)).toBe('accurate');
    expect(otherModel('fast')).toBe('accurate');
  });
});

describe('tokens', () => {
  it('summarize finds the mean and the highest peak', () => {
    const s = summarize([0.9, 0.9, 0.9, 0.01].map((p) => ({ h: -Math.log(p) })));
    expect(s.peak).toBe(3);
    expect(s.perplexity).toBeCloseTo(perplexity([0.9, 0.9, 0.9, 0.01]), 10);
  });
  it('parseProb accepts decimals, percents and fractions; rejects out of range', () => {
    expect(parseProb('0.25')).toEqual({ ok: true, p: 0.25 });
    expect(parseProb('25%')).toEqual({ ok: true, p: 0.25 });
    expect(parseProb('1/8')).toEqual({ ok: true, p: 0.125 });
    expect(parseProb('1')).toEqual({ ok: true, p: 1 });
    expect(parseProb('0').ok).toBe(false);
    expect(parseProb('-1').ok).toBe(false);
    expect(parseProb('1.01').ok).toBe(false);
    expect(parseProb('abc').ok).toBe(false);
    expect(parseProb('').ok).toBe(false);
  });
  it('workedCalc multiplies 1/P, counts N and takes the N-th root', () => {
    const w = workedCalc([0.5, 0.8, 0.2].map((p) => ({ h: -Math.log(p) })));
    expect(w.factors).toEqual(['2', '1.25', '5']);
    expect(w.product).toBe('12.5');
    expect(w.n).toBe(3);
    expect(w.root).toBeCloseTo(2.321, 3);
    const long = workedCalc(Array(12).fill({ h: Math.log(8) }));
    expect(long.factors).toHaveLength(10);
    expect(long.more).toBe(true);
    expect(workedCalc(Array(500).fill({ h: 3 })).product).toBe('e^1,500');
  });
});
