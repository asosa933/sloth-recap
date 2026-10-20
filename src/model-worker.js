// Runs EmbeddingGemma (Google's open-weight Gemma embedding model, 300M parameters) fully in the
// browser with transformers.js. The chat never leaves the device: the weights (~200 MB) are
// downloaded once from Hugging Face and cached by the browser; the text is embedded locally.
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1';

const MODEL = 'onnx-community/embeddinggemma-300m-ONNX';
const PREFIX = 'task: sentence similarity | query: '; // EmbeddingGemma task prompt
const BATCH = 16;
let extractor = null; let device = 'wasm'; const cache = new Map();

async function load() {
  if (extractor) return;
  const progress_callback = (p) => self.postMessage({ type: 'progress', p });
  try { if (self.navigator.gpu && await self.navigator.gpu.requestAdapter()) device = 'webgpu'; } catch { /* wasm */ }
  // WebGPU: 4-bit weights (~175 MB). CPU/WASM: 8-bit weights (~310 MB). I measured the 8-bit
  // model ~3x faster on CPU than the 4-bit "no_gather" export (the WASM backend has no fast
  // kernel for the 4-bit gather op), so the bigger download is worth it.
  const wasmOpts = { device: 'wasm', dtype: 'q8', progress_callback };
  try {
    extractor = device === 'webgpu'
      ? await pipeline('feature-extraction', MODEL, { device: 'webgpu', dtype: 'q4f16', progress_callback })
      : await pipeline('feature-extraction', MODEL, wasmOpts);
  } catch (err) {
    if (device !== 'webgpu') throw err;
    device = 'wasm'; extractor = await pipeline('feature-extraction', MODEL, wasmOpts);
  }
  self.postMessage({ type: 'ready', device, model: MODEL,
    threads: device === 'webgpu' ? null : (env.backends.onnx.wasm.numThreads || 1), isolated: self.crossOriginIsolated });
}

async function embedAll(texts, id) {
  const todo = [...new Set(texts.filter((t) => !cache.has(t)))];
  for (let i = 0; i < todo.length; i += BATCH) {
    const chunk = todo.slice(i, i + BATCH);
    const out = await extractor(chunk.map((t) => PREFIX + t.slice(0, 1000)), { pooling: 'mean', normalize: true });
    out.tolist().forEach((v, k) => cache.set(chunk[k], v));
    self.postMessage({ type: 'embed-progress', id, done: Math.min(i + BATCH, todo.length), total: todo.length });
  }
  return { vecs: texts.map((t) => cache.get(t)), fresh: todo.length };
}

self.onmessage = async (e) => {
  const { type, texts, id } = e.data;
  try {
    if (type === 'load') { await load(); return; }
    if (type === 'embed') {
      await load();
      const t0 = performance.now();
      const { vecs, fresh } = await embedAll(texts, id);
      self.postMessage({ type: 'vectors', id, vecs, fresh, ms: Math.round(performance.now() - t0), device });
    }
  } catch (err) {
    self.postMessage({ type: 'error', id, message: String(err && err.message || err) });
  }
};
