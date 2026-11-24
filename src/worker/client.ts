import type { ModelKey } from '../lib/models';
import type { FromWorker, RunResult, TokenScore, ToWorker } from '../lib/tokens';

export class ModelError extends Error {
  constructor(message: string, public stage: 'load' | 'run') { super(message); }
}

type Pending = { resolve: (v: RunResult | void) => void; reject: (e: ModelError) => void; onToken?: (t: TokenScore) => void };

/** Promise wrapper around the model worker. Progress and ready events go to `onEvent`. */
export function createClient(onEvent: (e: FromWorker) => void) {
  const w = new Worker(new URL('./model.worker.ts', import.meta.url), { type: 'module' });
  const pending = new Map<number, Pending>();
  let seq = 0;
  w.onmessage = (e: MessageEvent<FromWorker>) => {
    const m = e.data;
    if (m.type === 'result') { pending.get(m.req)?.resolve(m.result); pending.delete(m.req); }
    else if (m.type === 'gen') pending.get(m.req)?.onToken?.(m.token);
    else if (m.type === 'gen-done') { pending.get(m.req)?.resolve(); pending.delete(m.req); }
    else if (m.type === 'error') { pending.get(m.req)?.reject(new ModelError(m.message, m.stage)); pending.delete(m.req); onEvent(m); }
    else onEvent(m);
  };
  w.onerror = (e) => {
    for (const p of pending.values()) p.reject(new ModelError(e.message || 'The model worker crashed (often: out of memory).', 'load'));
    pending.clear();
  };
  const send = (msg: Omit<ToWorker, 'req'>, onToken?: (t: TokenScore) => void) =>
    new Promise<RunResult | void>((resolve, reject) => {
      const req = ++seq;
      pending.set(req, { resolve, reject, onToken });
      w.postMessage({ ...msg, req } as ToWorker);
    });
  return {
    score: (model: ModelKey, text: string) => send({ type: 'score', model, text }) as Promise<RunResult>,
    continue: (model: ModelKey, text: string, onToken: (t: TokenScore) => void) => send({ type: 'continue', model, text }, onToken) as Promise<void>,
    terminate: () => w.terminate(),
  };
}
