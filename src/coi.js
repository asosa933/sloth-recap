// Turn on cross-origin isolation through sw.js (once per session, falls back silently).
// Isolation lets onnxruntime-web use several CPU threads for the local model.
export function enableIsolation() {
  if (self.crossOriginIsolated || !('serviceWorker' in navigator) || !window.isSecureContext) return;
  if (sessionStorage.getItem('slothRecap.coiTried')) return;
  sessionStorage.setItem('slothRecap.coiTried', '1');
  navigator.serviceWorker.register(new URL('../sw.js', import.meta.url)).then(async (reg) => {
    await navigator.serviceWorker.ready;
    if (!self.crossOriginIsolated) location.reload();
  }).catch((e) => console.info('Isolation not available, using 1 CPU thread:', e.message));
}
