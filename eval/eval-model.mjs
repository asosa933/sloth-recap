// Offline check of Sloth Recap with the real open-weight model, in Node.
// Usage: npm i --no-save @huggingface/transformers && node eval/eval-model.mjs
// Compares EmbeddingGemma vectors with the no-AI TF-IDF fallback on 5 small hand-labelled chats
// (2 demo chats + 3 held-out chats in eval/heldout.js). Tiny data: a sanity check, not a benchmark.
import { pipeline } from '@huggingface/transformers';
import { SAMPLES, goldTopics, buildExport } from '../src/samples.js';
import { STUDY, FAMIGLIA, ERASMUS } from './heldout.js';
import { parseChat } from '../src/parse.js';
import { isFiller, dot, tfidfVectors, centerVectors, catchUpWindow, buildDigest, twoLines } from '../src/digest.js';

const MODEL = 'onnx-community/embeddinggemma-300m-ONNX';
const PREFIX = 'task: sentence similarity | query: ';
const ex = await pipeline('feature-extraction', MODEL, { dtype: 'q8' }); // same weights the browser uses on CPU
const chats = { flat: SAMPLES.flat.src, calcetto: SAMPLES.calcetto.src, study: STUDY, famiglia: FAMIGLIA, erasmus: ERASMUS };
const T = { gemma: { nn: [0, 0], cover: [0, 0], group: [0, 0], chatLines: 0 }, tfidf: { nn: [0, 0], cover: [0, 0], group: [0, 0], chatLines: 0 } };
let embMs = 0, embN = 0;
for (const [name, src] of Object.entries(chats)) {
  const all = parseChat(buildExport(src)); const gold0 = goldTopics(src);
  const w = catchUpWindow(all, 'Alessio'); const msgs = all.slice(w.start); const gold = gold0.slice(w.start);
  const t0 = performance.now();
  const ge = (await ex(msgs.map((m) => PREFIX + m.text), { pooling: 'mean', normalize: true })).tolist();
  embMs += performance.now() - t0; embN += msgs.length;
  const vecSets = { gemma: { v: ge, center: true }, tfidf: { v: tfidfVectors(msgs.map((m) => m.text)), center: false } };
  const realTopics = new Set(gold.filter((g, i) => g !== 'chat' && !isFiller(msgs[i].text)));
  for (const [kind, { v, center }] of Object.entries(vecSets)) {
    // (a) nearest neighbour agreement
    const use = msgs.map((m, i) => i).filter((i) => !isFiller(msgs[i].text));
    const V = center ? centerVectors(use.map((i) => v[i])) : use.map((i) => v[i]);
    use.forEach((i, a) => { if (gold[i] === 'chat') return; let b = -Infinity, bj = -1;
      use.forEach((j, c) => { if (c !== a) { const s = dot(V[a], V[c]); if (s > b) { b = s; bj = j; } } });
      T[kind].nn[1]++; T[kind].nn[0] += gold[bj] === gold[i]; });
    // (b,c) digest
    const d = buildDigest(msgs, v, { center });
    const top3 = d.topics.slice(0, 3);
    const covered = new Set(top3.map((t) => gold[t.key]).filter((g) => g !== 'chat'));
    T[kind].cover[0] += covered.size; T[kind].cover[1] += Math.min(3, realTopics.size);
    T[kind].chatLines += top3.filter((t) => gold[t.key] === 'chat').length;
    let gOk = 0, gN = 0;
    for (const t of d.topics) for (const m of t.members) if (gold[m] !== 'chat') { gN++; gOk += gold[m] === gold[t.key]; }
    T[kind].group[0] += gOk; T[kind].group[1] += gN;
    (T[kind].perChat ||= []).push(`${name} ${gOk}/${gN}`);
    if (name === 'flat' || name === 'calcetto' || name === 'erasmus') {
      console.log(`\n[${name} / ${kind}] two lines:`);
      for (const l of twoLines(d)) console.log(`  • (${l.count} msgs, ${l.keywords.join(' · ')}) ${l.author}: ${l.text}`);
    }
  }
}
const pct = ([a, b]) => `${a}/${b} (${Math.round((100 * a) / b)}%)`;
console.log('\n=== Results (5 chats, catch-up window = messages after my last one) ===');
for (const k of ['gemma', 'tfidf']) {
  console.log(`${k === 'gemma' ? 'EmbeddingGemma' : 'TF-IDF fallback'}:`);
  console.log(`  nearest message is about the same topic: ${pct(T[k].nn)}`);
  console.log(`  real topics covered by the top 3 lines:  ${pct(T[k].cover)}`);
  console.log(`  messages grouped under the right line:   ${pct(T[k].group)}`);
  console.log(`  chit-chat picked as a top-3 line:        ${T[k].chatLines}`);
  console.log(`  grouped right, per chat: ${T[k].perChat.join(', ')}`);
}
console.log(`\nEmbedding speed in Node (CPU, q8, native onnxruntime): ${embN} messages in ${(embMs / 1000).toFixed(1)} s`);
