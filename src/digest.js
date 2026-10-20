// The "lazy" part: turns hundreds of chat messages into a 2-line recap, a "needs you" list and
// a few topics. Pure functions. Works with any message vectors: EmbeddingGemma vectors from the
// local model, or TF-IDF vectors (the no-AI fallback built in this file).

const FILLER = new Set(('ok okay okk k kk yes yeah yep yup no nope lol lmao haha ahah ahahah hahaha hehe xd rip ' +
  'thanks thx ty grazie grz perfetto perfect top bene ottimo vabbè vabbe va bè boh mah si sì sisi ' +
  'night goodnight notte buonanotte morning buongiorno ciao hi hey same true vero fatto done cool nice ' +
  'people ragazzi raga guys all tutti').split(' '));

export function words(text) { return (String(text).toLowerCase().match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu) || []); }

export function isFiller(text) {
  const w = words(text);
  if (w.length === 0) return true; // emoji / punctuation only
  if (w.length <= 3 && w.every((x) => FILLER.has(x) || /^(ha|ah|he|eh)+h?$/.test(x) || /^lo+l$/.test(x))) return true;
  return false;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function sameName(a, b) { return String(a).trim().toLowerCase() === String(b).trim().toLowerCase(); }

// Which messages are new for me? Everything after my last message (or everything).
export function catchUpWindow(msgs, me, mode = 'since-me') {
  if (mode === 'all' || !me) return { start: 0, reason: 'all' };
  let last = -1;
  for (let i = msgs.length - 1; i >= 0; i--) if (sameName(msgs[i].author, me)) { last = i; break; }
  if (last < 0) return { start: 0, reason: 'never-wrote' };
  return { start: last + 1, reason: 'since-me', lastMine: msgs[last] };
}

const QUESTION = /\?|\b(can you|could you|will you|are you|do you|did you|puoi|potresti|riesci|vieni|ci sei|porti|chiedi)\b/i;
export function needsYou(msgs, me) {
  if (!me) return [];
  const first = escapeRe(String(me).trim().split(/\s+/)[0]);
  const mention = new RegExp(`(^|[^\\p{L}])@?${first}(?![\\p{L}])`, 'iu');
  const everyone = /(^|\s)@(everyone|all|tutti)\b/i;
  const out = [];
  for (const m of msgs) {
    if (sameName(m.author, me) || m.kind !== 'text') continue;
    if (mention.test(m.text)) out.push({ ...m, why: QUESTION.test(m.text) ? 'asks you' : 'mentions you' });
    else if (everyone.test(m.text)) out.push({ ...m, why: 'pings everyone' });
  }
  return out;
}

// ---------- TF-IDF fallback vectors ----------
const STOP = new Set(('the a an and or but if to of in on at for with from by is are was were be been it its this that these those ' +
  'i you he she we they me my your our their him her them us so too very just also not no yes do does did have has had ' +
  'will would can could should there here what who when where why how all any some about up out then than as into ' +
  'il lo la i gli le un una uno e ed o ma se di da in con su per tra fra che chi non mi ti si ci vi ne è sono era ' +
  'ho hai ha abbiamo avete hanno al alla allo ai agli alle del della dello dei degli delle nel nella sul sulla ' +
  'anche come più poi già ancora quindi però perché cosa questo questa quello quella tu io noi voi lui lei loro ' +
  'me te se ok lol raga ma dai ' +
  'each someone anyone everyone please i\'ll i\'m let\'s it\'s don\'t can\'t that\'s think tell need want make take ' +
  'get got go going know like right still always really maybe now later again one two only same other ' +
  'qualcuno tutti ciao fare fa fatto può puoi vuoi devo dobbiamo ok va bene sì così tu mio tuo suo').split(' '));
export function tokens(text) { return words(text).filter((w) => w.length > 1 && !STOP.has(w) && !/^\d+$/.test(w)); }

export function tfidfVectors(texts) {
  const docs = texts.map(tokens); const df = new Map();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) || 0) + 1);
  const vocab = [...df.keys()]; const idx = new Map(vocab.map((t, i) => [t, i])); const N = docs.length;
  return docs.map((d) => {
    const v = new Float32Array(vocab.length);
    for (const t of d) v[idx.get(t)] += Math.log(1 + N / df.get(t));
    let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1;
    for (let i = 0; i < v.length; i++) v[i] /= n;
    return v;
  });
}

export function dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }

// Remove the "common direction" shared by all messages of this chat, then re-normalise.
// Small embedding models give every chat message a high baseline similarity (~0.6-0.8);
// centering makes "same topic" vs "different topic" much easier to tell apart.
export function centerVectors(V) {
  if (!V.length) return V;
  const d = V[0].length; const mu = new Float64Array(d);
  for (const v of V) for (let i = 0; i < d; i++) mu[i] += v[i] / V.length;
  return V.map((v) => {
    const w = new Float32Array(d); let n = 0;
    for (let i = 0; i < d; i++) { w[i] = v[i] - mu[i]; n += w[i] * w[i]; }
    n = Math.sqrt(n) || 1; for (let i = 0; i < d; i++) w[i] /= n;
    return w;
  });
}

// Chat messages are short ("Work for me", "Ma dai"), so each one borrows a little meaning from
// the messages right before and after it.
export function withContext(V, c = 0.3) {
  return V.map((v, i) => {
    const w = Float32Array.from(v); let n = 0;
    for (const j of [i - 1, i + 1]) if (V[j]) for (let k = 0; k < w.length; k++) w[k] += c * V[j][k];
    for (const x of w) n += x * x; n = Math.sqrt(n) || 1;
    return w.map((x) => x / n);
  });
}

export const FACT = /(\d|€|\$|£|\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b|\b(luned|marted|mercoled|gioved|venerd|sabat|domenic)[a-zì]*|tomorrow|tonight|today|noon|domani|stasera|oggi|entro|deadline|\bby (noon|tonight|tomorrow))/i;

// keywords that are frequent in this group and rare in the rest of the chat
export function topicKeywords(texts, members, k = 3) {
  const all = texts.map(tokens); const df = new Map();
  for (const d of all) for (const t of new Set(d)) df.set(t, (df.get(t) || 0) + 1);
  const tf = new Map();
  for (const i of members) for (const t of new Set(all[i])) tf.set(t, (tf.get(t) || 0) + 1);
  const min = members.length > 4 ? 2 : 1;
  return [...tf.entries()].filter(([t, c]) => c >= min && t.length > 2)
    .map(([t, c]) => [t, c * Math.log(1 + all.length / df.get(t))])
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, k).map(([t]) => t);
}

export const DEFAULTS = { maxLines: 4, redundancy: 2, concrete: 0.35, recency: 0.15, minSim: 0.05, context: 0.3 };

// Main entry. msgs = the new messages, vecs = one vector per message (EmbeddingGemma or TF-IDF).
// opts.boost = Set of message ids (msg.i) that need me: topics containing one are shown first.
// 1) importance = how much of the chat talks about the same thing ("topic mass")
//    + a bonus for concrete facts (times, days, money) + a small bonus for recent messages
// 2) pick key messages greedily, penalising messages too similar to ones already picked (MMR)
// 3) put every other message under the key message it is most similar to
export function buildDigest(msgs, vecs, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const use = msgs.map((m, i) => i).filter((i) => msgs[i].kind === 'text' && !isFiller(msgs[i].text));
  let V = use.map((i) => vecs[i]);
  if (o.center) V = centerVectors(V);
  if (o.context) V = withContext(V, o.context);
  const texts = use.map((i) => msgs[i].text);
  const n = use.length;
  if (!n) return { topics: [], fillers: msgs.length, used: 0 };
  const sim = (a, b) => dot(V[a], V[b]);
  const mass = V.map((_, a) => { let s = 0; for (let b = 0; b < n; b++) if (b !== a) s += Math.max(0, sim(a, b)); return s / Math.max(1, n - 1); });
  const mx = Math.max(...mass) || 1;
  const imp = mass.map((m, a) => m / mx + (FACT.test(texts[a]) ? o.concrete : 0) +
    o.recency * (a / Math.max(1, n - 1)) + 0.1 * Math.min(words(texts[a]).length, 15) / 15);
  const keys = [];
  while (keys.length < Math.min(o.maxLines, n)) {
    let best = -Infinity, bi = -1;
    for (let a = 0; a < n; a++) {
      if (keys.includes(a)) continue;
      const red = keys.length ? Math.max(...keys.map((k) => Math.max(0, sim(a, k)))) : 0;
      const sc = imp[a] - o.redundancy * red;
      if (sc > best) { best = sc; bi = a; }
    }
    keys.push(bi);
  }
  const groups = keys.map(() => []); const other = [];
  for (let a = 0; a < n; a++) {
    const ki = keys.indexOf(a); if (ki >= 0) { groups[ki].push(a); continue; }
    let best = -Infinity, bk = -1;
    keys.forEach((k, j) => { const s = sim(a, k); if (s > best) { best = s; bk = j; } });
    if (best >= o.minSim) groups[bk].push(a); else other.push(a);
  }
  const topics = keys.map((k, j) => {
    const members = groups[j].sort((x, y) => x - y);
    return { key: use[k], keyMsg: msgs[use[k]], members: members.map((a) => use[a]),
      authors: [...new Set(members.map((a) => msgs[use[a]].author))],
      keywords: topicKeywords(texts, members), importance: imp[k],
      facts: members.filter((a) => FACT.test(texts[a])).length,
      needsMe: members.filter((a) => o.boost && o.boost.has(msgs[use[a]].i)).length };
  }).map((t) => ({ ...t, score: t.members.length + t.facts + 3 * Math.min(1, t.needsMe) })) // facts and "asks me" beat banter
    .sort((x, y) => y.score - x.score || y.importance - x.importance);
  return { topics, other: other.map((a) => use[a]), fillers: msgs.length - n, used: n };
}

export function trimText(t, n = 140) { t = String(t).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t; }

// "2 lines": the key messages of the two biggest topics.
export function twoLines(digest) {
  return digest.topics.slice(0, 2).map((t) => ({ keywords: t.keywords, text: trimText(t.keyMsg.text),
    author: t.keyMsg.author, count: t.members.length }));
}

// Reading time estimate (200 words per minute is a common average for reading on a screen).
export function readingSeconds(texts, wpm = 200) {
  const w = texts.reduce((a, t) => a + words(t).length, 0);
  return Math.round((w / wpm) * 60);
}

// Pairwise F1 between predicted groups and gold labels (used by tests/eval only).
export function pairwiseF1(groups, gold) {
  const pred = new Map(); groups.forEach((g, gi) => g.forEach((i) => pred.set(i, gi)));
  const items = [...pred.keys()]; let tp = 0, fp = 0, fn = 0;
  for (let a = 0; a < items.length; a++) for (let b = a + 1; b < items.length; b++) {
    const i = items[a], j = items[b]; const sp = pred.get(i) === pred.get(j), sg = gold[i] === gold[j];
    if (sp && sg) tp++; else if (sp) fp++; else if (sg) fn++;
  }
  const p = tp / (tp + fp || 1), r = tp / (tp + fn || 1);
  return { precision: p, recall: r, f1: p + r ? (2 * p * r) / (p + r) : 0 };
}
