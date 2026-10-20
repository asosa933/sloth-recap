// Built-in demo chats (written by hand for the demo; all names are invented).
// Each line: "HH:MM|Author|topic|text". The topic label is NOT used by the app: it is the
// hand-made "ground truth" used by tests/eval to measure how well topics are grouped.
const FLAT = `#19/10/26
22:40|Sara|chat|Anyone still awake? The new season of that baking show is out
22:41|Tom|chat|lol I'm watching it right now
22:58|Giulia|wash|Guys the washing machine is making a horrible noise again
23:05|Alessio|wash|I'll look at it tomorrow, going to bed. Night all 😴
23:14|Marco|wash|It just died. Water everywhere in the bathroom 😩
23:15|Giulia|wash|NOOO my clothes are still inside
23:15|Tom|chat|😂😂
23:16|Marco|wash|I put towels on the floor, don't use it until it's fixed
23:20|Sara|wash|I'll write to the landlord, the machine is his
23:21|Tom|chat|rip
23:40|Sara|wash|Landlord answered already lol. He says he'll send a technician
23:41|Sara|wash|Technician comes Wednesday between 9 and 12, someone must be home to open the door
23:42|Giulia|wash|I have class all Wednesday morning
23:42|Marco|wash|Work for me
23:43|Tom|wash|Alessio works from home on Wednesdays right? @Alessio can you open the door for the technician?
23:44|Sara|wash|If not I can skip my 11am lecture, tell us tomorrow
23:50|Sara|rent|Also bad news: the landlord is coming on Thursday at 6pm for the yearly inspection
23:51|Giulia|rent|Thursday?? The kitchen is a disaster
23:51|Marco|rent|We need to clean the kitchen and the balcony before Thursday
23:52|Tom|rent|And he said the rent goes up 30€ from January, check the email he sent
23:53|Giulia|rent|30€ each or total??
23:53|Tom|rent|Total, so 7,50€ each
23:54|Giulia|chat|ok
23:55|Marco|rent|Cleaning plan: I do the kitchen Wednesday night, someone takes the balcony
23:56|Giulia|rent|I'll do the balcony
#20/10/26
00:10|Sara|party|Different topic: Giulia graduates on Friday 🎓 dinner party here on Saturday at 8pm?
00:11|Giulia|party|Yesss 🥹
00:11|Tom|party|I'm in. I can cook lasagna
00:12|Marco|party|Can I invite my cousin and his band? 😅
00:12|Sara|party|No band please, think of the neighbours
00:13|Marco|chat|haha ok ok
00:14|Sara|party|Budget 10€ each for food and drinks, I'll make a list
00:15|Tom|party|Alessio always makes the dessert, @Alessio tiramisu for Saturday?
00:20|Giulia|chat|goodnight people
00:21|Tom|chat|night
01:30|Marco|chat|can't sleep, the whole flat smells like wet towels
01:31|Marco|chat|👍
07:02|Sara|party|Shopping list for Saturday: pasta, salad, 2 bottles of wine, juice, plates. I'll buy everything on Friday
07:05|Giulia|wash|Morning! Can someone confirm for the technician? The landlord wants a name by noon
07:06|Tom|chat|😴
07:10|Marco|rent|Reminder: kitchen Wednesday night, balcony Giulia, inspection Thursday 6pm
07:12|Sara|wash|Alessio when you wake up please answer about Wednesday 🙏`;

const CALCETTO = `#19/10/26
22:25|Luca|chat|Partita incredibile stasera
22:30|Alessio|chat|Buonanotte ragazzi, domani vi leggo
22:41|Luca|time|Raga il campo delle 21 di giovedì non c'è più, l'hanno dato a un torneo
22:42|Davide|time|Ma dai 😡
22:42|Luca|time|Ci hanno proposto giovedì alle 21:30 sul campo 2, quello coperto
22:43|Fede|time|Per me va bene alle 21:30
22:44|Davide|time|Ok anche per me, ma finiamo alle 22:30?
22:45|Luca|time|Sì, un'ora di campo come sempre
22:50|Fede|player|Problema: Simone ha la febbre, siamo in 9
22:51|Davide|player|Chiedo a mio fratello se viene
22:52|Luca|player|Se non trovate nessuno chiedo nel gruppo del lavoro
22:58|Davide|player|Mio fratello non può, ha il turno
23:01|Matteo|chat|Avete visto il gol di ieri sera? Assurdo
23:02|Fede|chat|Fuorigioco netto dai
23:02|Matteo|chat|Ma quale fuorigioco 😂
23:03|Luca|chat|ahahah
23:04|Davide|chat|Il VAR ormai è una lotteria
23:05|Matteo|chat|vabbè
23:10|Luca|money|Il campo coperto costa di più: 60€ invece di 50, quindi 6€ a testa
23:11|Fede|money|Pago con Satispay a te Luca?
23:11|Luca|money|Sì, Satispay a me entro mercoledì, così prenoto il campo
23:12|Matteo|money|Fatto ✅ 6€ inviati
23:20|Luca|ball|Chi porta il pallone? Il mio è bucato
23:21|Fede|ball|Alessio ne ha uno nuovo, @Alessio lo porti tu?
23:22|Davide|player|Comunque ci serve ancora il decimo giocatore, Alessio chiedi al tuo coinquilino?
23:30|Matteo|chat|notte
#20/10/26
07:15|Luca|player|Buongiorno, siamo ancora in 9. Se entro stasera non troviamo nessuno giochiamo 4 contro 5
07:20|Fede|money|Ricordatevi il Satispay a Luca entro mercoledì
07:21|Davide|chat|👍`;

// Turns the compact format above into a real-looking chat export.
// style 'android': "20/10/26, 07:12 - Name: text"   style 'ios': "[20/10/26, 07:12:00] Name: text"
export function buildExport(src, style = 'android') {
  const out = []; let day = '';
  for (const line of src.split('\n')) {
    if (line.startsWith('#')) { day = line.slice(1); continue; }
    const [time, author, , ...rest] = line.split('|');
    const text = rest.join('|');
    out.push(style === 'ios' ? `[${day}, ${time}:00] ${author}: ${text}` : `${day}, ${time} - ${author}: ${text}`);
  }
  return out.join('\n');
}

export function goldTopics(src) {
  return src.split('\n').filter((l) => !l.startsWith('#')).map((l) => l.split('|')[2]);
}

export const SAMPLES = {
  flat: { title: 'Flat 3B 🏠 (English)', me: 'Alessio', src: FLAT,
    text: 'Messages and calls are end-to-end encrypted.\n' + buildExport(FLAT, 'android') },
  calcetto: { title: 'Calcetto del giovedì ⚽ (Italiano)', me: 'Alessio', src: CALCETTO,
    text: buildExport(CALCETTO, 'ios') },
};
