export type ModelKey = 'fast' | 'accurate';
export type Backend = 'webgpu' | 'wasm';

export interface ModelInfo {
  key: ModelKey;
  label: string;
  name: string;
  id: string;
  dtype: Record<Backend, 'int8' | 'q4'>;
  /** Weight file size in MB per backend, from the repo's onnx/ folder. */
  mb: Record<Backend, number>;
  /** Backends to try, in order. */
  devices: Backend[];
}

// Sizes checked against the Hugging Face repos (onnx/model_int8.onnx, onnx/model_q4.onnx).
export const MODELS: Record<ModelKey, ModelInfo> = {
  fast: {
    key: 'fast', label: 'Fast', name: 'SmolLM2-135M', id: 'HuggingFaceTB/SmolLM2-135M-Instruct',
    dtype: { webgpu: 'int8', wasm: 'int8' }, mb: { webgpu: 137, wasm: 137 },
    // int8 (MatMulInteger) gives garbage logits (~1e10) on the WebGPU backend in ORT-web, checked 2026-11-24; it is exact on WASM.
    devices: ['wasm'],
  },
  accurate: {
    key: 'accurate', label: 'Accurate', name: 'Qwen2.5-0.5B', id: 'onnx-community/Qwen2.5-0.5B',
    // The spec asks for q4f16 on WebGPU (483 MB) and int8 on WASM (512 MB). Both are wrong in practice (checked 2026-11-24):
    // q4f16 returns an all-zero first logits row on WebGPU (fp16 overflow), and int8 gives P(" Paris" | "The capital of France is")
    // = 2e-4. q4 (4-bit weights, fp32 activations) gives 0.729 and matches across WebGPU and WASM to 3 significant figures.
    dtype: { webgpu: 'q4', wasm: 'q4' }, mb: { webgpu: 786, wasm: 786 },
    devices: ['webgpu', 'wasm'],
  },
};

export const MODEL_KEYS: ModelKey[] = ['accurate', 'fast'];
export const DEFAULT_MODEL: ModelKey = 'accurate';
export const otherModel = (k: ModelKey): ModelKey => (k === 'fast' ? 'accurate' : 'fast');
export const parseModelKey = (s: string | null): ModelKey => (s === 'fast' || s === 'accurate' ? s : DEFAULT_MODEL);
/** The backend a model will use, given what the browser offers. */
export const plannedBackend = (k: ModelKey, detected: Backend | null): Backend =>
  detected === 'webgpu' && MODELS[k].devices.includes('webgpu') ? 'webgpu' : 'wasm';
export const backendLabel = (b: Backend | null) => (b === 'webgpu' ? 'WebGPU' : b === 'wasm' ? 'WASM' : '—');

/** Longest sentence we score, in tokens (keeps logits memory and the point budget sane). */
export const MAX_TOKENS = 96;
export const CONTINUE_TOKENS = 30;
