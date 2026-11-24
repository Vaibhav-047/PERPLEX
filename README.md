# PERPLEX — Surprise Terrain

A website that shows how a real language model gives a probability to every token of a sentence, and how those
probabilities become one number: perplexity. Each token is a ridge whose height is its surprisal, h = −ln P. The mean
height is a water plane, and perplexity = e^(water level). *Perplexity is how high the water rises.*

The models run entirely in the visitor's browser (Transformers.js in a Web Worker). There is no API, no key and no backend.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
```

The first Run downloads the chosen model from Hugging Face (Fast ≈ 137 MB, Accurate ≈ 786 MB). The browser caches
the files after that.

## Test

```bash
npm test           # Vitest: perplexity math, log-softmax scoring, formatting, models, Lab parsing, signal bus, projection, height field, palette contrast
npm run typecheck  # tsc -b
npm run lint       # ESLint (typescript-eslint + react-hooks)
npm run build      # typecheck + production build into dist/
```

## Deploy

Static build, no environment variables. `vercel.json` sets build `npm run build`, output `dist`, and the install command
`ONNXRUNTIME_NODE_INSTALL_CUDA=skip npm install`. Transformers.js depends on `onnxruntime-node`, whose install script
tries to download CUDA binaries on Linux and fails on Vercel (404). The site only uses `onnxruntime-web`, so it is skipped.
On other Linux CI, use the same install command.

```bash
npx vercel --prod
```

Any static host works: serve `dist/`. The ONNX runtime's WebAssembly file (~21.6 MB, ~5 MB gzipped) is bundled
next to the JavaScript, so nothing but the model weights is fetched from a third party.

## How it is built

- `src/worker/model.worker.ts`: loads the model, runs one forward pass with int64 `input_ids` and `attention_mask`,
  and turns the logits into P(token i | earlier tokens) with a stable log-softmax of the row at position i−1.
  It returns each token's `{ token, id, p, h, top8 }`, the top 8 next tokens, perplexity, mean surprisal and run time.
  **Continue** calls `model.generate` (greedy, up to 30 tokens). A logits processor streams each new token with its
  probability, and the new ridges grow at the far edge of the terrain.
- `src/lib/`: perplexity math in log space (`perplexity.ts`), formatting, the model table, token types, Lab parsing, and the worked calculation.
- `src/viz/`: `bus.ts` (signal bus the visuals read), `loop.ts` (GSAP's ticker is the only rAF loop: it drives Lenis,
  steps the bus and draws every registered canvas), `useCanvas.ts`, `project.ts` (camera, perspective projection,
  ground unprojection, height field), `scenes.ts` (all Canvas 2D drawing), `color.ts` (101-step elevation LUT, noise).
- `src/components/`: Hero, Story, ConsoleHeader, Controls, Terrain, Readouts, Inspector, Lab, Cursor, ui.

## Notes on choices

- **The spec's math test is wrong.** It says `[0.5, 0.8, 0.2] → ≈ 2.92`. The product of the 1/P values is
  2 × 1.25 × 5 = 12.5, and its cube root is **≈ 2.32**. The test asserts 2.32, and the "View math" sheet shows the same worked example.
- **Start token, per each `tokenizer_config.json`.** Qwen2.5-0.5B sets no `bos_token`, so the start token is
  `<|endoftext|>` (151643). SmolLM2-135M-Instruct sets `bos_token: "<|im_start|>"` (id 1). Following the spec's rule,
  that token goes first. `<|im_start|>` opens a chat turn, though, so the model expects a role name next, and the opening
  words of plain text look very unlikely. Measured on "The capital of France is Paris": PPL 1309 with `<|im_start|>`,
  against 196 with `<|endoftext|>` (id 0), mostly from " capital" (5.9e-9 vs 8.3e-5). The spec's rule is kept. Switching is a
  one-line change in the worker.
- **Fast runs on WASM only.** The int8 SmolLM2 file returns garbage logits (about 2e10) on ORT-web's WebGPU backend.
  The same file is exact on WASM (checked against an independent log-softmax in the page), so `MODELS.fast.devices` is `['wasm']`.
- **Every loaded model is probed.** After loading, the worker runs one forward pass from the start token. If any logits
  row is non-finite, huge or flat, it disposes the session and falls back to the next backend (WebGPU → WASM). Bad numbers never reach the terrain.
- **Accurate uses `q4`, not the spec's `q4f16` / `int8`. This is a deliberate change from the spec.** Both specified files give wrong
  numbers for Qwen2.5-0.5B ("The capital of France is Paris", checked 2026-11-24):
  - `q4f16` on WebGPU (483 MB): the first position's logits come back as exactly 0, so the first token always gets
    P = 1/151936. This is most likely Qwen2.5's very large first-token activations overflowing fp16. The probe catches it.
  - `int8` on WASM (512 MB): it runs, but P(" Paris" | "The capital of France is") = 2.0e-4, and the first-position
    candidates are junk (" a", " ey", " touch").
  - `q4` (4-bit weights, fp32 activations, 786 MB): P(" Paris") = 0.729, PPL 159.9. WebGPU and WASM agree to 3 significant
    figures. A forward pass took 249 ms on WebGPU and 625 ms on WASM here.

  The cost is a larger download (786 MB instead of 483/512 MB). To go back to the spec's files, edit `MODELS.accurate.dtype` in `src/lib/models.ts`.
- Heights are linear in −ln P, so the water plane (the mean) is honest. The camera backs off and aims higher for tall terrain instead of compressing it.
- Colour is a fixed scale: 0 nats = teal, 6 nats (P ≈ 0.0025) and above = hot red, so colours compare across runs.
  Every chip, ridge label, bar and table cell also shows its number.
- Points are re-sorted by depth only when the camera has turned more than ~2.3° since the last sort, not every frame.
  The budget is ≤ 6,000 points on desktop and ≤ 2,000 on phones (tested).
- Sentences are capped at 96 tokens, plus up to 30 per Continue.
- Section entrances (blur-to-sharp) clear their inline `filter` and `transform` when they finish. A leftover one would
  become the containing block for `position: fixed` and break the GSAP pin and the phone bottom sheets.
- The model choice is stored in `localStorage` (`perplex.model`). Nothing else is stored.
- Fonts load from Google Fonts. No user text is sent anywhere.
- Transformers.js is pinned to v3 (3.8.1) as specified. v4 is the current major.
- Contrast on panels (deck #0B0D0F): ink 17.1:1, ink-dim 8.4:1, ink-faint 5.2:1 (tested). On the input well (#13161A)
  ink is 15.9:1, just under the 16:1 target, which the spec sets for panels.

## Not verified

- **Real phones.** The 375 px layout was checked in a desktop browser at phone width only.
- **Safari and Firefox.** Only Chromium was used (WebGPU available). WebGPU-less and WASM-only paths ran only via the forced fallbacks above.
- **Lighthouse** (performance, accessibility scores) was not run.
- **Slow laptops / low memory.** The Accurate model needs roughly 0.5–1 GB of memory in the worker. Behaviour when the tab runs out of memory was not tested.
- **Accurate on WASM in the app itself.** q4 on WASM was checked only in a test worker in the page (matching numbers, 625 ms).
  The app's own WASM path for Accurate ran only with the older int8 file.
- **Model quality beyond one sentence.** Each model/dtype was compared on "The capital of France is Paris" only.
- **Screen readers.** ARIA roles, labels and live regions are in place, but no screen reader (VoiceOver, NVDA) was used.
- Cache behaviour across browser restarts, and a deploy to Vercel itself.
