import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  worker: { format: 'es' },
  // Transformers.js ships its own ONNX runtime loader; pre-bundling it breaks the wasm paths.
  optimizeDeps: { exclude: ['@huggingface/transformers'] },
  build: { chunkSizeWarningLimit: 1200 },
  test: { environment: 'node' },
});
