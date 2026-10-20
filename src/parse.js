// Chat export parser: WhatsApp (Android + iPhone, EN/IT), Telegram-style "[time] Name: text",
// and plain "Name: text" lines. Pure function, no AI, tested in Node.

// date, time, optional seconds, optional AM/PM
const DATE = String.raw`(\d{1,4})[\/.\-](\d{1,2})[\/.\-](\d{1,4}),?\s+(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?\s*([AaPp]\.?\s?[Mm]\.?)?`;
const IOS = new RegExp(String.raw`^\[` + DATE + String.raw`\]\s*(.*)$`);
const ANDROID = new RegExp('^' + DATE + String.raw`\s*[-–]\s*(.*)$`);
const SIMPLE = /^(?:\[?(\d{1,2})[:.](\d{2})\]?\s+)?([^:\[\]\n]{1,32}?):\s+(.+)$/;

const MEDIA = /^(<media omitted>|<media omessi>|<allegato:.*>|<attached:.*>|(image|video|audio|sticker|gif|document|immagine|vocale|documento) (omitted|omess[oa]))$/i;
const SYSTEM = /(end-to-end encrypted|crittografati end-to-end|this message was deleted|questo messaggio è stato eliminato|you deleted this message|hai eliminato questo messaggio|^null$|<this message was edited>)/i;

function cleanAuthor(a) { return a.replace(/^[~\u202f\s]+/, '').replace(/[\u200e\u200f\u202a-\u202e]/g, '').trim(); }

function decideOrder(triples) {
  if (triples.some(([a]) => a.length === 4)) return 'ymd';
  if (triples.some(([a]) => +a > 12)) return 'dmy';
  if (triples.some(([, b]) => +b > 12)) return 'mdy';
  return 'dmy'; // European default
}

function toTs(order, a, b, c, h, mi, ap) {
  let d, m, y;
  if (order === 'ymd') [y, m, d] = [a, b, c]; else if (order === 'mdy') [m, d, y] = [a, b, c]; else [d, m, y] = [a, b, c];
  y = +y; if (y < 100) y += 2000; h = +h;
  if (ap) { const pm = /p/i.test(ap); if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; }
  return Date.UTC(y, +m - 1, +d, h, +mi);
}

export function parseChat(raw) {
  const lines = String(raw || '').replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '').split('\n');
  const dated = []; let anyDated = false;
  for (const line0 of lines) {
    const line = line0.replace(/^[\u200e\u200f]+/, '');
    const m = line.match(IOS) || line.match(ANDROID);
    if (m) { anyDated = true; dated.push({ m, line }); } else dated.push({ m: null, line });
  }
  const msgs = [];
  if (anyDated) {
    const order = decideOrder(dated.filter((d) => d.m).map((d) => d.m.slice(1, 4)));
    for (const { m, line } of dated) {
      if (m) {
        const rest = m[8]; const colon = rest.indexOf(': ');
        const ts = toTs(order, m[1], m[2], m[3], m[4], m[5], m[7]);
        if (colon < 1 || colon > 40) { msgs.push({ ts, author: '', text: rest.trim(), kind: 'system' }); continue; }
        msgs.push({ ts, author: cleanAuthor(rest.slice(0, colon)), text: rest.slice(colon + 2).trim(), kind: 'text' });
      } else if (msgs.length && line.trim()) {
        msgs[msgs.length - 1].text += '\n' + line.trim();
      }
    }
  } else {
    for (const line of lines) {
      const m = line.match(SIMPLE);
      if (m && m[3].trim().split(/\s+/).length <= 3) {
        const ts = m[1] ? Date.UTC(2000, 0, 1, +m[1], +m[2]) : null;
        msgs.push({ ts, author: cleanAuthor(m[3]), text: m[4].trim(), kind: 'text' });
      } else if (msgs.length && line.trim()) msgs[msgs.length - 1].text += '\n' + line.trim();
    }
  }
  for (const msg of msgs) {
    msg.text = msg.text.replace(/[\u200e\u200f]/g, '').trim();
    if (msg.kind === 'text' && MEDIA.test(msg.text)) msg.kind = 'media';
    else if (msg.kind === 'text' && SYSTEM.test(msg.text)) msg.kind = 'system';
  }
  return msgs.filter((m) => m.kind !== 'system').map((m, i) => ({ ...m, i }));
}

export function authorsOf(msgs) {
  const c = new Map(); for (const m of msgs) c.set(m.author, (c.get(m.author) || 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1]).map(([a]) => a);
}
