import { parseChat, authorsOf } from './parse.js';
import { catchUpWindow, needsYou, tfidfVectors, buildDigest, twoLines, readingSeconds, trimText, isFiller } from './digest.js';
import { readChatFromZip } from './zip.js';
import { SAMPLES } from './samples.js';
import { enableIsolation } from './coi.js';

enableIsolation();

const $ = (id) => document.getElementById(id);
const MAX_MSGS = 400; // keep it snappy on phones: only the most recent 400 new messages
const ME_KEY = 'slothRecap.me';
let worker = null, modelState = 'off', reqId = 0; const pending = new Map();

// ---------- local AI (EmbeddingGemma in a Web Worker) ----------
function setStatus(text, cls) { const s = $('aiStatus'); s.textContent = text; s.className = 'ai-status ' + cls; }
function showProgress(pct, text) { $('progress').hidden = false; $('bar').style.width = Math.max(2, Math.min(100, pct)) + '%'; $('progressText').textContent = text; }
function hideProgress() { $('progress').hidden = true; }

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./model-worker.js', import.meta.url), { type: 'module' });
  const files = new Map();
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'progress') {
      const p = m.p || {};
      if (p.status === 'progress' && p.total) {
        files.set(p.file, [p.loaded, p.total]);
        let l = 0, t = 0; for (const [a, b] of files.values()) { l += a; t += b; }
        showProgress((l / t) * 100, `Downloading EmbeddingGemma once: ${(l / 1e6).toFixed(0)} / ${(t / 1e6).toFixed(0)} MB`);
      } else if (p.status === 'ready') showProgress(100, 'Starting the model…');
      setStatus('Local AI: loading…', 'busy');
    } else if (m.type === 'ready') {
      modelState = 'ready'; window.__sr.device = m.device; window.__sr.threads = m.threads;
      setStatus(`Local AI: ready (${m.device === 'webgpu' ? 'WebGPU' : `CPU, ${m.threads} thread${m.threads > 1 ? 's' : ''}`})`, 'on'); hideProgress();
      for (const [, p] of pending) if (p.onReady) p.onReady();
      if (pending.has('load')) { pending.get('load').resolve(); pending.delete('load'); }
    } else if (m.type === 'embed-progress') {
      showProgress((m.done / m.total) * 100, `Reading the chat with local AI: ${m.done} / ${m.total} messages`);
    } else if (m.type === 'vectors') {
      const p = pending.get(m.id); if (p) { pending.delete(m.id); p.resolve(m); }
    } else if (m.type === 'error') {
      modelState = 'error'; setStatus('Local AI: failed to load', 'err'); hideProgress();
      const p = pending.get(m.id ?? 'load') || [...pending.values()][0];
      for (const [k, q] of pending) { q.reject(new Error(m.message)); pending.delete(k); }
      if (!p) console.error(m.message);
    }
  };
  worker.onerror = (e) => { modelState = 'error'; setStatus('Local AI: failed to load', 'err'); for (const [k, q] of pending) { q.reject(new Error(e.message || 'worker error')); pending.delete(k); } };
  return worker;
}
function loadModel() {
  if (modelState === 'ready') return Promise.resolve();
  modelState = 'loading'; setStatus('Local AI: loading…', 'busy'); showProgress(1, 'Preparing the local model…');
  return new Promise((resolve, reject) => { pending.set('load', { resolve, reject }); getWorker().postMessage({ type: 'load' }); });
}
function embed(texts) {
  const id = ++reqId;
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); getWorker().postMessage({ type: 'embed', id, texts }); });
}

// ---------- helpers ----------
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hhmm = (ts) => ts == null ? '' : new Date(ts).toISOString().slice(11, 16);
const dur = (s) => s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
function showError(msg) { const e = $('error'); e.textContent = msg; e.hidden = !msg; }

function refreshAuthors() {
  const msgs = parseChat($('chat').value);
  $('authors').innerHTML = authorsOf(msgs).map((a) => `<option value="${esc(a)}">`).join('');
  return msgs;
}

// ---------- main ----------
async function run() {
  showError('');
  const all = parseChat($('chat').value);
  if (!all.length) { showError('I could not find any messages. Paste a chat export (lines like "20/10/26, 07:12 - Name: message").'); return; }
  const me = $('me').value.trim(); if (me) localStorage.setItem(ME_KEY, me);
  const w = catchUpWindow(all, me, $('mode').value);
  let msgs = all.slice(w.start);
  if (!msgs.length) { showError('Nothing new since your last message. Enjoy the nap. 🦥'); $('result').hidden = true; return; }
  let truncated = 0; if (msgs.length > MAX_MSGS) { truncated = msgs.length - MAX_MSGS; msgs = msgs.slice(-MAX_MSGS); }
  $('goBtn').disabled = true; $('goBtn').textContent = '🦥 Catching up…';
  let vecs, engine, aiError = null; const t0 = performance.now();
  if ($('useAI').checked) {
    try {
      await loadModel();
      const r = await embed(msgs.map((m) => m.text));
      vecs = r.vecs; engine = { ai: true, device: r.device, ms: r.ms, fresh: r.fresh };
    } catch (err) { aiError = String(err.message || err); console.warn('AI failed, using fallback', err); }
  }
  if (!vecs) { vecs = tfidfVectors(msgs.map((m) => m.text)); engine = { ai: false }; }
  hideProgress();
  const needs = needsYou(msgs, me);
  const digest = buildDigest(msgs, vecs, { center: engine.ai, boost: new Set(needs.map((n) => n.i)) });
  const result = { all, msgs, w, me, digest, needs, engine, aiError, truncated, ms: Math.round(performance.now() - t0) };
  window.__sr.last = result;
  render(result);
  $('goBtn').disabled = false; $('goBtn').textContent = '🦥 Catch me up';
}

function recapText(r) {
  const lines = twoLines(r.digest);
  const out = [`🦥 Sloth Recap (${r.msgs.length} new messages)`];
  lines.forEach((l, i) => out.push(`${i + 1}. ${l.text} (${l.author})`));
  if (r.needs.length) { out.push(`🙋 Needs you (${r.needs.length}):`); r.needs.forEach((n) => out.push(`- ${n.author}: ${trimText(n.text, 120)}`)); }
  return out.join('\n');
}

function render(r) {
  $('result').hidden = false;
  const lines = twoLines(r.digest);
  $('lines').innerHTML = lines.length ? lines.map((l) => `<li><span class="kw">${esc(l.keywords.join(' · ') || 'topic')}</span>“${esc(l.text)}” <span class="who">— ${esc(l.author)}, +${l.count - 1} related</span></li>`).join('')
    : '<li>Only small talk since you left. Nothing to catch up on. 🦥</li>';
  const readAll = readingSeconds(r.msgs.map((m) => m.text));
  const readRecap = readingSeconds(lines.map((l) => l.text).concat(r.needs.map((n) => n.text)));
  const since = r.w.reason === 'since-me' ? ` since your last message (${hhmm(r.w.lastMine.ts)})` : r.w.reason === 'never-wrote' && r.me ? ` (I didn't find “${esc(r.me)}” as an author, so this is the whole chat)` : '';
  $('stats').innerHTML = `<strong>${r.msgs.length}</strong> new messages${since}` +
    (r.truncated ? ` (only the latest ${MAX_MSGS}; ${r.truncated} older ones skipped)` : '') +
    ` · ${r.digest.fillers} were just “ok / lol / 👍” · reading them all ≈ <strong>${dur(readAll)}</strong>, this recap ≈ <strong>${dur(Math.max(readRecap, 1))}</strong>`;
  $('needsWrap').hidden = !r.me;
  $('needsCount').textContent = r.needs.length;
  $('needs').innerHTML = r.needs.length ? r.needs.map((n) => `<li><span class="why">${esc(n.why)}</span><strong>${esc(n.author)}</strong> <span class="muted small">${hhmm(n.ts)}</span><br>${esc(trimText(n.text, 220))}</li>`).join('')
    : '<li>Nobody asked you anything. Perfect sloth morning. 🌿</li>';
  $('topics').innerHTML = r.digest.topics.map((t, i) => `<details${i === 0 ? '' : ''}><summary><strong>${esc(t.keywords.join(' · ') || 'topic')}</strong> <span class="n">· ${t.members.length} messages · ${esc(t.authors.join(', '))}</span></summary><ul class="msgs">` +
    t.members.map((k) => `<li class="${k === t.key ? 'key' : ''}"><time>${hhmm(r.msgs[k].ts)}</time><strong>${esc(r.msgs[k].author)}:</strong> ${esc(trimText(r.msgs[k].text, 200))}</li>`).join('') + '</ul></details>').join('') +
    (r.digest.other.length ? `<details><summary><strong>other small talk</strong> <span class="n">· ${r.digest.other.length} messages</span></summary><ul class="msgs">` +
      r.digest.other.map((k) => `<li><time>${hhmm(r.msgs[k].ts)}</time><strong>${esc(r.msgs[k].author)}:</strong> ${esc(trimText(r.msgs[k].text, 200))}</li>`).join('') + '</ul></details>' : '');
  $('engine').innerHTML = r.engine.ai
    ? `🧠 Topics found by <strong>EmbeddingGemma</strong> running locally on ${r.engine.device === 'webgpu' ? 'WebGPU' : `CPU (WASM, ${window.__sr.threads || 1} thread${(window.__sr.threads || 1) > 1 ? 's' : ''})`} · ${r.engine.fresh ? `${r.engine.fresh} messages read in ${(r.engine.ms / 1000).toFixed(1)} s` : 'messages already read before, reused'} · nothing was uploaded.`
    : `🔤 Simple mode (keyword TF-IDF, no AI)${r.aiError ? ` because the local AI could not load: <em>${esc(trimText(r.aiError, 120))}</em>` : ''}. Turn on “Use local AI” for better topic grouping.`;
  $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------- wiring ----------
async function loadFile(file) {
  if (!file) return;
  try {
    const buf = await file.arrayBuffer(); const head = new Uint8Array(buf.slice(0, 2));
    const text = head[0] === 0x50 && head[1] === 0x4b ? await readChatFromZip(buf) : new TextDecoder().decode(buf);
    $('chat').value = text; const msgs = refreshAuthors();
    $('fileInfo').textContent = `Loaded ${file.name}: ${msgs.length} messages (read locally, not uploaded)`;
  } catch (err) { showError('Could not read that file: ' + (err.message || err)); }
}
document.querySelectorAll('[data-sample]').forEach((b) => b.addEventListener('click', () => {
  const s = SAMPLES[b.dataset.sample]; $('chat').value = s.text; $('me').value = s.me; $('mode').value = 'since-me';
  refreshAuthors(); $('fileInfo').textContent = `Sample chat: ${s.title}`; showError('');
}));
$('goBtn').addEventListener('click', run);
$('loadBtn').addEventListener('click', () => loadModel().catch((e) => showError('Local AI failed to load: ' + e.message)));
$('copyBtn').addEventListener('click', async () => {
  const t = recapText(window.__sr.last); window.__sr.copied = t;
  try { await navigator.clipboard.writeText(t); $('copyBtn').textContent = 'Copied ✓'; } catch { $('copyBtn').textContent = 'Copy failed'; }
  setTimeout(() => { $('copyBtn').textContent = 'Copy recap'; }, 1500);
});
$('file').addEventListener('change', (e) => loadFile(e.target.files[0]));
$('chat').addEventListener('change', refreshAuthors);
const drop = $('drop');
['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (e) => loadFile(e.dataTransfer.files[0]));
$('me').value = localStorage.getItem(ME_KEY) || '';

window.__sr = { run, recapText, parseChat, isFiller, SAMPLES, device: null, last: null };
