// Minimal reader for WhatsApp "Export chat" .zip files: finds the chat .txt inside and inflates it
// with the browser's built-in DecompressionStream. No library, nothing uploaded.
const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

export function listZip(buf) {
  const b = new Uint8Array(buf);
  let e = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 66000); i--) if (u32(b, i) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('Not a zip file');
  const count = u16(b, e + 10); let p = u32(b, e + 16); const out = [];
  for (let n = 0; n < count && u32(b, p) === 0x02014b50; n++) {
    const method = u16(b, p + 10), csize = u32(b, p + 20), nlen = u16(b, p + 28), xlen = u16(b, p + 30), clen = u16(b, p + 32);
    const local = u32(b, p + 42);
    const name = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nlen));
    const start = local + 30 + u16(b, local + 26) + u16(b, local + 28);
    out.push({ name, method, data: b.subarray(start, start + csize) });
    p += 46 + nlen + xlen + clen;
  }
  return out;
}

export function pickChatEntry(entries) {
  const txt = entries.filter((x) => /\.txt$/i.test(x.name) && !x.name.startsWith('__MACOSX'));
  return txt.find((x) => /(^|\/)_chat\.txt$/i.test(x.name)) || txt.find((x) => /chat/i.test(x.name)) || txt[0] || null;
}

export async function readChatFromZip(buf) {
  const entry = pickChatEntry(listZip(buf));
  if (!entry) throw new Error('No .txt chat file found in the zip');
  if (entry.method === 0) return new TextDecoder().decode(entry.data);
  if (entry.method !== 8) throw new Error('Unsupported zip compression');
  const stream = new Blob([entry.data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return await new Response(stream).text();
}
