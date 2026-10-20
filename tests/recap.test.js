import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseChat, authorsOf } from '../src/parse.js';
import { isFiller, catchUpWindow, needsYou, tfidfVectors, buildDigest, twoLines, readingSeconds, pairwiseF1, centerVectors, dot } from '../src/digest.js';
import { listZip, pickChatEntry, readChatFromZip } from '../src/zip.js';
import { SAMPLES, goldTopics } from '../src/samples.js';
import { deflateRawSync } from 'node:zlib';

test('parses WhatsApp Android export with multi-line messages and system lines', () => {
  const m = parseChat('19/10/26, 23:05 - Alessio: night\n20/10/26, 07:12 - Sara: first line\nsecond line\n20/10/26, 07:13 - Sara added Tom\n20/10/26, 07:14 - Tom: <Media omitted>');
  assert.equal(m.length, 3);
  assert.equal(m[1].text, 'first line\nsecond line');
  assert.equal(m[2].kind, 'media');
  assert.equal(new Date(m[1].ts).toISOString().slice(0, 16), '2026-10-20T07:12');
});

test('parses iPhone export and US dates with AM/PM', () => {
  const ios = parseChat('[20/10/26, 07:12:03] ~ Luca: Ciao\n[20/10/26, 07:13:00] Fede: immagine omessa');
  assert.equal(ios[0].author, 'Luca'); assert.equal(ios[1].kind, 'media');
  const us = parseChat('10/20/26, 7:12 PM - Bob: hi\n10/20/26, 12:05 AM - Ann: late');
  assert.equal(new Date(us[0].ts).toISOString().slice(0, 16), '2026-10-20T19:12');
  assert.equal(new Date(us[1].ts).toISOString().slice(11, 16), '00:05');
});

test('plain "Name: text" chats work too, without treating "Reminder:" lines as authors', () => {
  const m = parseChat('Bob: hey\nAnn: Reminder: kitchen tonight');
  assert.equal(m.length, 2); assert.equal(m[1].author, 'Ann'); assert.equal(m[1].text, 'Reminder: kitchen tonight');
});

test('both demo chats parse fully and keep the hand-made labels aligned', () => {
  for (const s of Object.values(SAMPLES)) {
    const m = parseChat(s.text);
    assert.equal(m.length, goldTopics(s.src).length);
    assert.ok(authorsOf(m).includes('Alessio'));
  }
});

test('filler detection (EN + IT)', () => {
  for (const t of ['ok', 'lol', '😂😂', 'ahahah', 'grazie', 'night', 'ok ok', '👍']) assert.equal(isFiller(t), true, t);
  for (const t of ['Work for me', 'Ma dai, alle 21:30?', 'Technician comes Wednesday']) assert.equal(isFiller(t), false, t);
});

test('catch-up window starts after my last message', () => {
  const m = parseChat(SAMPLES.flat.text);
  const w = catchUpWindow(m, 'alessio');
  assert.equal(w.reason, 'since-me'); assert.equal(m[w.start - 1].author, 'Alessio');
  assert.equal(catchUpWindow(m, 'Nobody').reason, 'never-wrote');
  assert.equal(catchUpWindow(m, 'Alessio', 'all').start, 0);
});

test('"needs you" finds mentions and questions, not my own messages', () => {
  const m = parseChat(SAMPLES.flat.text);
  const w = catchUpWindow(m, 'Alessio');
  const n = needsYou(m.slice(w.start), 'Alessio');
  assert.equal(n.length, 3);
  assert.ok(n.every((x) => x.author !== 'Alessio'));
  assert.equal(n[0].why, 'asks you');
  const it = parseChat(SAMPLES.calcetto.text); const wi = catchUpWindow(it, 'Alessio');
  assert.equal(needsYou(it.slice(wi.start), 'Alessio').length, 2);
  assert.equal(needsYou(parseChat('a: Alessandro is here'), 'Alessio').length, 0); // whole word only
});

test('fallback digest (TF-IDF) gives 2 lines about real topics in the demo chat', () => {
  const all = parseChat(SAMPLES.flat.text); const w = catchUpWindow(all, 'Alessio'); const msgs = all.slice(w.start);
  const gold = goldTopics(SAMPLES.flat.src).slice(w.start);
  const d = buildDigest(msgs, tfidfVectors(msgs.map((x) => x.text)));
  const lines = twoLines(d);
  assert.equal(lines.length, 2);
  const topics = d.topics.slice(0, 2).map((t) => gold[t.key]);
  assert.ok(topics.every((t) => t !== 'chat')); assert.notEqual(topics[0], topics[1]);
  // every non-filler message is in exactly one place
  const seen = d.topics.flatMap((t) => t.members).concat(d.other);
  assert.equal(seen.length, new Set(seen).size); assert.equal(seen.length, d.used);
});

test('digest handles tiny inputs', () => {
  assert.equal(buildDigest([], []).topics.length, 0);
  const one = parseChat('a: Dinner at 8?');
  assert.equal(buildDigest(one, tfidfVectors(['Dinner at 8?'])).topics.length, 1);
});

test('centering and helpers', () => {
  const c = centerVectors([[1, 0], [0.9, 0.1], [0.8, 0.2]]);
  assert.ok(Math.abs(dot(c[0], c[0]) - 1) < 1e-6);
  assert.ok(dot(c[0], c[2]) < 0); // the shared direction is removed
  assert.equal(readingSeconds(['one two three four five six seven eight nine ten']), 3);
  assert.equal(pairwiseF1([[0, 1], [2]], ['a', 'a', 'b']).f1, 1);
});

test('reads the chat .txt out of a WhatsApp-style zip (deflate)', async () => {
  const text = '20/10/26, 07:12 - Sara: ciao ✨';
  const zip = makeZip('_chat.txt', Buffer.from(text, 'utf8'));
  const entries = listZip(zip);
  assert.equal(pickChatEntry(entries).name, '_chat.txt');
  assert.equal(await readChatFromZip(zip), text);
});

// tiny zip writer for the test (one deflated file)
function makeZip(name, data) {
  const comp = deflateRawSync(data); const n = Buffer.from(name);
  const crc = crc32(data);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(crc, 14); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(n.length, 26);
  const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(8, 10);
  cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(data.length, 24); cd.writeUInt16LE(n.length, 28); cd.writeUInt32LE(0, 42);
  const body = Buffer.concat([local, n, comp]);
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(46 + n.length, 12); eocd.writeUInt32LE(body.length, 16);
  const buf = Buffer.concat([body, cd, n, eocd]); return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
}
function crc32(b) { let c, crc = 0xffffffff; for (const x of b) { c = (crc ^ x) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
