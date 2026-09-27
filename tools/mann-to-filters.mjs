// node tools/mann-to-filters.mjs data/mann-raw.json
//
// A MANN-FILTER online katalógusból (catalog.mann-filter.com) kézzel
// végigjárt autók -> data/filters.json "byEngine" bejegyzései.
// Bemenet: [{ m: modell, n: típus, e: "BJB, BKC, BXE", y: "2004-2010",
//             oil: ["HU 719/7 x Elérhető", "HU 7008 z Elérhető Motorkód: CLCB [SKODA]"] }]
// Motorkódonként egy szűrő. Ha két autónál ugyanaz a kód más szűrőt kap,
// nem írjuk be, hanem kiírjuk ellenőrzésre.

import fs from 'fs';
import { engineCodes } from '../lib/store.js';

const rawPath = process.argv[2] || 'data/mann-raw.json';
const raw = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
const out = 'data/filters.json';
const table = JSON.parse(fs.readFileSync(out, 'utf8'));

// "W 712/94 Elérhető 07/2010" -> { cikkszam: 'W 712/94', rest: '07/2010' }
// "W 712/22 Helyettesítve W 712/75 Kifutott 11/2013 óta 09/2000 Motorkód: X 14 XE"
//   -> az utód: { cikkszam: 'W 712/75', rest: '09/2000 Motorkód: X 14 XE' }
function parseItem(s) {
    const repl = s.match(/^(.+?) Helyettesítve (.+?) Kifutott(?: \d\d\/\d{4} óta)?\s*(.*)$/);
    if (repl) return { cikkszam: repl[2].trim(), rest: repl[3].trim() };
    const m = s.match(/^(.+?) (?:Elérhető|Kifutott(?: \d\d\/\d{4} óta)?)\s*(.*)$/);
    return m ? { cikkszam: m[1].trim(), rest: m[2].trim() } : { cikkszam: s.trim(), rest: '' };
}

// "Motorkód: Z 13 DTJ [OPEL] szűrőrendszer: UFI" -> ['Z13DTJ']
// "Motormeghatározás: A20NHT (LDK) Szűrőbetét"   -> ['A20NHT']
const CODE_TAG = /(Motorkód|Motormeghatározás):/;
// A "Motorkód:" utáni nagybetűs szavak a kód; ami utána jön (kisbetűs szó,
// zárójel, [MÁRKA]), az már feltétel.
function splitTag(rest) {
    const [before, , after = ''] = rest.split(CODE_TAG);
    const words = after.replace(/\[[^\]]*\]/g, ' ').trim().split(/\s+/);
    let n = 0;
    while (n < words.length && words[n] && !/[a-zá-ű(]/.test(words[n])) n++;
    return { codes: words.slice(0, n).join(' '), cond: `${before} ${words.slice(n).join(' ')}`.replace(/\s+/g, ' ').trim() };
}
const onlyFor = (rest) => (CODE_TAG.test(rest) ? engineCodes(splitTag(rest).codes) : []);
const condition = (rest) => (CODE_TAG.test(rest) ? splitTag(rest).cond : rest);

// MANN néha így írja: "M13A VVT", "G16B SOHC" - ezek a szavak nem a kód
// részei; a Fordnál viszont a zárójelben van a kód: "Duratorq (G6DA,G6DB)".
const mannClean = (e) => String(e || '').replace(/[()]/g, ',').replace(/\b(VVT|VVTI|SOHC|DOHC|16V|8V|12V|24V|TURBO)\b/g, ' ');
const mannCodes = (e) => engineCodes(mannClean(e));
// Motorcsalád: "K9K-732" -> K9K, "M271.910" -> M271 (betű és szám is kell
// bele: a Fiat "199 A2.000" "199"-e túl tág).
const mannFamily = (part) => {
    const clean = part.replace(/[^\s,;/]*[a-z][^\s,;/]*/g, ' ').trim().toUpperCase();
    if (!/[\s.\-]/.test(clean)) return null;
    const fam = clean.split(/[\s.\-]/)[0];
    return fam.length >= 3 && /[A-Z]/.test(fam) && /\d/.test(fam) ? fam : null;
};
const familyOf = {};   // teljes kód -> család
const dated = (rest, suffix) => (/^\d\d\/\d{4}$/.test(rest) ? `${rest}-${suffix}` : rest);

const found = {};   // kód -> Map(cikkszam -> {notes, cars})
const add = (code, cikkszam, note, car) => {
    const byCode = (found[code] ||= new Map());
    const e = byCode.get(cikkszam) || { notes: new Set(), cars: new Set() };
    if (note) e.notes.add(note);
    e.cars.add(car);
    byCode.set(cikkszam, e);
};

let skipped = 0;
for (const r of raw) {
    if (!Array.isArray(r.oil) || !r.oil.length) { skipped++; continue; }
    const car = `${r.m} ${r.n}${r.y ? ` (${r.y})` : ''}`;
    const codes = mannCodes(r.e);
    for (const part of mannClean(r.e).split(/[,;/]/)) {
        const fam = mannFamily(part);
        for (const c of engineCodes(part)) if (fam && c !== fam) familyOf[c] = fam;
    }
    const items = r.oil.filter((t) => /Elérhető|Kifutott|Helyettesítve/.test(t)).map(parseItem);
    if (!items.length) { skipped++; continue; }
    // Motorkódra szűkített tételek ("Motorkód: CLCB [SKODA]")
    const perCode = items.filter((i) => onlyFor(i.rest).length);
    // Ugyanarra a kódra több tétel (pl. UFI / Purflux ház): egymás alternatívái.
    const byCode = {};
    for (const i of perCode) for (const code of onlyFor(i.rest)) (byCode[code] ||= []).push(i);
    for (const [code, list] of Object.entries(byCode)) {
        const uniq = [...new Map(list.map((i) => [i.cikkszam, i])).values()];
        const pick = uniq[uniq.length - 1];
        const alts = uniq.slice(0, -1).map((i) => `vagy ${i.cikkszam}${condition(i.rest).trim() ? ' (' + dated(condition(i.rest).trim(), 'ig') + ')' : ''}`);
        add(code, pick.cikkszam, [uniq.length > 1 ? dated(condition(pick.rest).trim(), 'tól') : '', ...alts].filter(Boolean).join(' · '), car);
    }
    const general = items.filter((i) => !onlyFor(i.rest).length);
    if (!general.length) continue;
    const distinct = [...new Set(general.map((i) => i.cikkszam))];
    // Évjárat szerint kettéváló szűrő: az újabbat vesszük, a régit megjegyezzük.
    const pick = general[general.length - 1];
    const note = distinct.length > 1
        ? [dated(pick.rest, 'tól'), ...general.filter((i) => i.cikkszam !== pick.cikkszam).map((i) => `vagy ${i.cikkszam}${i.rest ? ' (' + dated(i.rest, 'ig') + ')' : ''}`)].filter(Boolean).join(' · ')
        : '';
    const codesLeft = codes.filter((c) => !perCode.some((i) => onlyFor(i.rest).includes(c)));
    for (const code of codesLeft) add(code, pick.cikkszam, note, car);
}

const conflicts = [];
let added = 0, kept = 0;
for (const [code, byCik] of Object.entries(found)) {
    // Ha ugyanaz a kód autónként más szűrőt kap: a leggyakoribb megy be,
    // "ELLENŐRIZD" jelzéssel és a többi lehetőséggel - a szerelő dönt.
    const ranked = [...byCik].sort((a, b) => b[1].cars.size - a[1].cars.size);
    const [cikkszam, info] = ranked[0];
    if (ranked.length > 1) {
        conflicts.push(`${code}: ` + ranked.map(([k, v]) => `${k} [${[...v.cars].join('; ')}]`).join('  vs  '));
        info.notes = new Set(['ELLENŐRIZD, autótól függ: ' + ranked.slice(1).map(([k, v]) => `${k} (${[...v.cars][0]}${[...v.notes][0] ? ', ' + [...v.notes][0] : ''})`).join(', ')]);
    }
    const existing = table.byEngine[code];
    if (existing && !/MANN katalógus/.test(existing.source || '')) { kept++; continue; } // a szerelőé az erősebb
    table.byEngine[code] = {
        cikkszam,
        brand: 'MANN-FILTER',
        source: 'MANN katalógus' + (info.notes.size ? ' · ' + [...info.notes].join(' | ') : ''),
    };
    added++;
}

// Családkulcsok: csak ha a család minden ismert tagja ugyanazt a szűrőt kapja,
// és a család neve maga nem egy már meglévő (pontos) kód.
const families = {};
for (const [code, fam] of Object.entries(familyOf)) {
    const e = table.byEngine[code];
    if (e && /MANN katalógus/.test(e.source)) (families[fam] ||= []).push([code, e.cikkszam]);
}
let famAdded = 0;
for (const [fam, members] of Object.entries(families)) {
    if (table.byEngine[fam] || new Set(members.map((m) => m[1])).size !== 1) continue;
    table.byEngine[fam] = { cikkszam: members[0][1], brand: 'MANN-FILTER', source: `MANN katalógus · a család tagjai szerint (${members.map((m) => m[0]).slice(0, 4).join(', ')})` };
    famAdded++;
}

table.byEngine = Object.fromEntries(Object.entries(table.byEngine).sort(([a], [b]) => a.localeCompare(b)));
fs.writeFileSync(out, JSON.stringify(table, null, 2) + '\n');
console.log(`${raw.length} autó -> ${added} motorkód + ${famAdded} motorcsalád beírva, ${kept} szerelői megtartva, ${skipped} szűrő nélkül.`);
if (conflicts.length) console.log(`\nEllenőrizni (${conflicts.length}):\n` + conflicts.join('\n'));
