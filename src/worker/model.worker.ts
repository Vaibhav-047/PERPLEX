/// <reference lib="webworker" />
// Runs the language models off the main thread. One request at a time (the UI disables Run while busy).
import {
  AutoModelForCausalLM, AutoTokenizer, Tensor, env,
  type PreTrainedModel, type PreTrainedTokenizer, type ProgressInfo,
} from '@huggingface/transformers';
import { CONTINUE_TOKENS, MAX_TOKENS, MODELS, type Backend, type ModelKey } from '../lib/models';
import { logNormalizer, rowIsBroken, scoreLogits, statsFromLogprobs, toNumbers, topK, type Pick } from '../lib/perplexity';
import type { Cand, FromWorker, RunResult, ToWorker, TokenScore } from '../lib/tokens';

env.allowLocalModels = false; // always fetch from the Hub; the browser Cache API keeps the files after the first run

const post = (m: FromWorker) => self.postMessage(m);

interface Loaded { tok: PreTrainedTokenizer; model: PreTrainedModel; backend: Backend; bos: number; eos: number }
const loaded = new Map<ModelKey, Promise<Loaded>>();

async function webgpuAvailable() {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    return !!(gpu && (await gpu.requestAdapter()));
  } catch { return false; }
}

function load(key: ModelKey) {
  let p = loaded.get(key);
  if (!p) {
    p = doLoad(key);
    loaded.set(key, p);
    p.catch(() => loaded.delete(key)); // allow a retry after a failure
  }
  return p;
}

async function doLoad(key: ModelKey): Promise<Loaded> {
  const m = MODELS[key];
  const progress_callback = (e: ProgressInfo) => {
    if (e.status === 'ready') return;
    post({ type: 'progress', model: key, status: e.status, file: e.file, loaded: 'loaded' in e ? e.loaded : undefined, total: 'total' in e ? e.total : undefined });
  };
  const tok = await AutoTokenizer.from_pretrained(m.id, { progress_callback });
  // Start token: tokenizer.bos_token_id if set, otherwise the id of "<|endoftext|>" (checked against each tokenizer_config.json:
  // SmolLM2-135M-Instruct sets bos_token "<|im_start|>" = 1; Qwen2.5-0.5B sets none, so it uses "<|endoftext|>" = 151643).
  const bos = tok.bos_token_id ?? tok.model.tokens_to_ids.get('<|endoftext|>');
  if (bos == null) throw new Error('This tokenizer has neither a start token nor <|endoftext|>.');
  const eos = tok.eos_token_id ?? bos;

  const gpu = await webgpuAvailable();
  const backends = m.devices.filter((b) => b === 'wasm' || gpu);
  let lastErr: unknown;
  for (const backend of backends) {
    if (backend !== backends[0]) post({ type: 'fallback', model: key, backend, note: 'WebGPU gave invalid results, so this runs on WASM' });
    try {
      const model = await AutoModelForCausalLM.from_pretrained(m.id, { dtype: m.dtype[backend], device: backend, progress_callback });
      await probe(model, bos); // a backend can load fine and still compute nonsense; never show that
      post({ type: 'ready', model: key, backend, dtype: m.dtype[backend], note: backend !== backends[0] ? 'WebGPU gave invalid results, so this runs on WASM' : undefined });
      return { tok, model, backend, bos, eos };
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

/** One tiny forward pass from the start token: every row of logits must look like a real prediction. */
async function probe(model: PreTrainedModel, bos: number) {
  const ids = new Tensor('int64', BigInt64Array.from([bos, bos], (i) => BigInt(i)), [1, 2]);
  const out = await model({ input_ids: ids, attention_mask: new Tensor('int64', new BigInt64Array(2).fill(1n), [1, 2]) });
  const logits = out.logits as Tensor, V = logits.dims[2], x = toNumbers(logits.data);
  if (rowIsBroken(x, 0, V) || rowIsBroken(x, V, V)) {
    await model.dispose();
    throw new Error('The model returned invalid numbers on this backend.');
  }
}

const cands = (L: Loaded, picks: Pick[]): Cand[] => picks.map((t) => ({ token: L.tok.decode([t.id]), p: Math.exp(t.logp), id: t.id }));

function encode(L: Loaded, text: string) {
  const enc = L.tok.encode(text, { add_special_tokens: false });
  if (!enc.length) throw new Error('Type at least one word to score.');
  const ids = [L.bos, ...enc.slice(0, MAX_TOKENS)];
  const n = ids.length;
  return {
    ids,
    input_ids: new Tensor('int64', BigInt64Array.from(ids, (i) => BigInt(i)), [1, n]),
    attention_mask: new Tensor('int64', new BigInt64Array(n).fill(1n), [1, n]),
  };
}

async function score(key: ModelKey, text: string): Promise<RunResult> {
  const L = await load(key);
  const t0 = performance.now();
  const { ids, input_ids, attention_mask } = encode(L, text);
  const out = await L.model({ input_ids, attention_mask });
  const logits = out.logits as Tensor;
  const V = logits.dims[2];
  const r = scoreLogits(toNumbers(logits.data), ids, V, 8);
  const tokens: TokenScore[] = r.logp.map((lp, i) => ({
    token: L.tok.decode([ids[i + 1]]), id: ids[i + 1], p: Math.exp(lp), h: -lp, top8: cands(L, r.top[i]),
  }));
  const s = statsFromLogprobs(r.logp);
  return { model: key, backend: L.backend, tokens, next8: cands(L, r.next), perplexity: s.perplexity, meanSurprisal: s.meanSurprisal, ms: performance.now() - t0 };
}

async function continueText(key: ModelKey, text: string, req: number) {
  const L = await load(key);
  const { input_ids, attention_mask } = encode(L, text);
  // Greedy decoding with no repetition penalty adds no other logits processors, so this one sees the raw logits:
  // the probability we stream is the model's own P(next token | everything so far).
  const capture = (_ids: bigint[][], logits: Tensor) => {
    const x = toNumbers(logits.data), V = logits.dims.at(-1)!;
    const logZ = logNormalizer(x, 0, V), top = topK(x, 0, V, 8, logZ), best = top[0];
    if (best.id !== L.eos) {
      post({ type: 'gen', req, token: { token: L.tok.decode([best.id]), id: best.id, p: Math.exp(best.logp), h: -best.logp, top8: cands(L, top), generated: true } });
    }
    return logits;
  };
  await L.model.generate({
    input_ids, attention_mask, max_new_tokens: CONTINUE_TOKENS, do_sample: false, repetition_penalty: 1,
    logits_processor: [capture] as never,
  } as never);
  post({ type: 'gen-done', req });
}

let queue = Promise.resolve();
self.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  queue = queue.then(async () => {
    let stage: 'load' | 'run' = 'load';
    try {
      await load(m.model);
      stage = 'run';
      if (m.type === 'score') post({ type: 'result', req: m.req, result: await score(m.model, m.text) });
      else await continueText(m.model, m.text, m.req);
    } catch (err) {
      post({ type: 'error', req: m.req, model: m.model, stage, message: err instanceof Error ? err.message : String(err) });
    }
  });
};
