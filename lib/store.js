// ---------------------------------------------------------------------------
//  Az adat-"slotok". Ma JSON fájlok a data/ mappában, a műhely számláiból és
//  korábbi ajánlataiból feltöltve. Élesben ugyanezek a függvények a Unix /
//  Inter Cars / TecDoc kapcsolatból olvasnak - az app többi része nem változik.
//
//  data/prices.json   Unix-árak: olaj (Fuchs termékkód szerint) és szűrők
//  data/filters.json  motorkód -> olajszűrő cikkszám (tanuló tábla)

// ---------------------------------------------------------------------------

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const memory = {};

function load(name, fallback) {
    if (memory[name]) return memory[name];
    try {
        memory[name] = JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), 'utf8'));
    } catch (error) {
        memory[name] = structuredClone(fallback);
    }
    return memory[name];
}

// Vercelen a fájlrendszer csak olvasható, ezért ott a tanult adat egy Redisben
// (Upstash, a Vercel Marketplace-ről) él. A Vercel a KV_REST_API_* néven adja
// a kulcsot, az Upstash maga UPSTASH_REDIS_REST_* néven - mindkettő jó.
// Ha nincs beállítva (helyi gépen), marad a data/ mappa.
const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
export const remoteStore = () => !!(REDIS_URL && REDIS_TOKEN);

// learned.json egészében, a filters.json-ból csak a szerelő bejegyzései (a MANN
// tábla a repóban marad, így egy újabb tábla nem vész el a tanult adat alatt).
const KEYS = { learned: 'olajcsere:learned', filters: 'olajcsere:filters-learned' };
let filterOverrides = {};
const pending = [];

async function redis(command) {
    const res = await fetch(REDIS_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(command),
    });
    if (!res.ok) throw new Error('Tároló: HTTP ' + res.status);
    return (await res.json()).result;
}

// Minden kérés elején: a legfrissebb tanult adat, hogy egy régi példány ne
// írja felül, amit közben egy másik megjegyzett.
export async function hydrate() {
    if (!remoteStore()) return;
    const [learned, filters] = await Promise.all([redis(['GET', KEYS.learned]), redis(['GET', KEYS.filters])]);
    memory['learned.json'] = learned ? JSON.parse(learned) : structuredClone(LEARNED);
    filterOverrides = filters ? JSON.parse(filters) : {};
    delete memory['filters.json'];
    const t = load('filters.json', { byEngine: {} });
    Object.assign(t.byEngine, filterOverrides);
}

// A válasz előtt: a függő írások tényleg megtörténjenek.
export async function flush() {
    const jobs = pending.splice(0);
    await Promise.all(jobs.map((j) => j()));
}

function save(name) {
    if (remoteStore()) {
        const key = name === 'learned.json' ? KEYS.learned : KEYS.filters;
        const value = JSON.stringify(name === 'learned.json' ? memory[name] : filterOverrides);
        pending.push(() => redis(['SET', key, value]));
        return true;
    }
    try {
        fs.writeFileSync(path.join(DATA_DIR, name), JSON.stringify(memory[name], null, 2) + '\n');
        return true;
    } catch (error) {
        return false;
    }
}

export const normCode = (s) => String(s || '').toUpperCase().replace(/[\s.\-/]/g, '');

// A Fuchs egy mezőben több motorkódot is adhat, és a Fuchs meg a MANN
// másképp írja ugyanazt: "ATD, AXR, BEW (PD)", "M 13A", "1ND-TV",
// "188A4000" / "188A4.000", "JQDA/JQDB Sigma EcoBoost". A tábla kódonként,
// írásjel nélkül tárol (ATD, AXR, BEW, M13A, 1NDTV, 188A4000, JQDA, JQDB);
// a kisbetűs szavak (Sigma, EcoBoost) és a zárójeles részek nem a kód részei.
const codeParts = (s) => String(s || '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^\s,;/]*[a-z][^\s,;/]*/g, ' ')
    .split(/[,;/]/)
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);

export const engineCodes = (s) => codeParts(s)
    .map((c) => c.replace(/[\s.\-]/g, ''))
    .filter((c) => c.length >= 3);

// Motorcsalád: "K9K 638" -> K9K, "OM646.962" -> OM646. Csak akkor nézzük,
// ha a pontos kódra nincs találat, és ezt a forrásban jelezzük.
const familyCodes = (s) => codeParts(s)
    .map((c) => c.split(/[\s.\-]/)[0])
    .filter((c) => c.length >= 3);

// --- Olaj ára ---------------------------------------------------------------
export function oilPrice(fuchsCode) {
    const p = load('prices.json', { oils: {}, filters: {} });
    const hit = p.oils[fuchsCode];
    return hit && hit.netPerLiter != null ? { cikkszam: hit.cikkszam || '', netPerLiter: hit.netPerLiter, source: hit.source || 'árlista' } : null;
}

// --- Olajszűrő --------------------------------------------------------------
function filterPrice(cikkszam) {
    const p = load('prices.json', { oils: {}, filters: {} });
    return p.filters[normCode(cikkszam)] || null;
}

export function filterFor(engineCode) {
    const t = load('filters.json', { byEngine: {} });
    let code = engineCodes(engineCode).find((c) => t.byEngine[c]);
    const family = !code && familyCodes(engineCode).find((c) => t.byEngine[c]);
    code = code || family;
    const hit = code && t.byEngine[code];
    if (!hit) return null;
    const price = filterPrice(hit.cikkszam);
    return {
        cikkszam: hit.cikkszam,
        brand: hit.brand || price?.brand || '',
        name: hit.name || '',
        net: price?.net ?? hit.net ?? null,
        source: (price?.source || hit.source || 'tanuló tábla') + (family ? ` · motorcsalád (${family}) alapján, ellenőrizd` : ''),
    };
}

// A szerelő megadta a szűrőt: az autó összes motorkódjához megjegyezzük.
export function rememberFilter(engineCode, entry) {
    const codes = engineCodes(engineCode);
    const cikkszam = String(entry?.cikkszam || '').trim();
    if (!codes.length || !cikkszam) return { filter: null, persisted: false };
    const t = load('filters.json', { byEngine: {} });
    const net = Number.isFinite(entry.net) ? entry.net : null;
    for (const c of codes) {
        t.byEngine[c] = filterOverrides[c] = {
            cikkszam,
            brand: String(entry.brand || '').trim(),
            ...(net != null && { net }),
            source: String(entry.source || 'szerelő adta meg'),
        };
    }
    return { filter: filterFor(engineCode), persisted: save('filters.json') };
}

// --- Tanulás: amit a szerelő egyszer eldöntött, azt legközelebb nem kérdezzük -
//  data/learned.json: {
//    picks:  { "<TecDoc jármű>|<alkatrész>": { answers, brand, articleNo } },
//    prices: { "<MÁRKA>|<CIKKSZÁM>": nettó egységár },   (amíg nincs Inter Cars ár)
//    engines: { "E|<MOTORKÓD>": { oil, liters } },      (olajcsere, lent)
//    quoteNo: utolsó ajánlatszám }
const LEARNED = { picks: {}, prices: {}, engines: {}, quoteNo: 0 };
const learnedData = () => load('learned.json', LEARNED);
const pickKey = (vehicleId, part) => `${Number(vehicleId)}|${String(part)}`;

export function learnedPicks(vehicleId, parts) {
    const l = learnedData();
    return Object.fromEntries(parts.map((p) => [p, l.picks[pickKey(vehicleId, p)] || null]).filter(([, v]) => v));
}

export function rememberPick(vehicleId, part, entry) {
    if (!vehicleId || !part) return { persisted: false };
    const l = learnedData();
    l.picks[pickKey(vehicleId, part)] = {
        answers: entry?.answers && typeof entry.answers === 'object' ? entry.answers : {},
        brand: String(entry?.brand || ''), articleNo: String(entry?.articleNo || ''),
    };
    return { persisted: save('learned.json') };
}

export const priceKey = (brand, articleNo) => `${String(brand || '').toUpperCase()}|${normCode(articleNo)}`;
export const learnedPrice = (key) => learnedData().prices[key] ?? null;

export function rememberPrice(key, net) {
    const l = learnedData();
    if (net == null || !Number.isFinite(net) || net < 0) delete l.prices[key]; else l.prices[key] = Math.round(net);
    return { persisted: save('learned.json') };
}

// --- Olajszűrő-változatok ---------------------------------------------------------
//  A MANN-tábla forrás-szövege jelöli, ha egy motorkódhoz több szűrő is tartozik:
//    "MANN katalógus · 04/2003-tól · vagy W 68 (05/2000-ig) · vagy HU 611 x (06/2000 03/2003)"
//    "MANN katalógus · ELLENŐRIZD, autótól függ: HU 719/7 x (Polo IV, …), …"
//  Ebből választható lehetőségek lesznek, feltétellel. Ahol a feltétel dátum, a
//  gyártás/forgalomba helyezés hónapjából magától választunk (lásd pickByDate).
const MONTH = /(\d{2})\/(\d{4})/g;
export function dateRange(cond) {
    const s = String(cond || '');
    const ds = [...s.matchAll(MONTH)].map((m) => Number(m[2]) * 12 + Number(m[1]) - 1);
    if (!ds.length) return null;
    if (ds.length >= 2) return { from: ds[0], to: ds[1] };
    if (/\d{4}\s*-?tól/.test(s)) return { from: ds[0], to: null };
    if (/\d{4}\s*-?ig/.test(s)) return { from: null, to: ds[0] };
    return null;
}
// "2014-03", "2014.03", "03/2014", "2014" -> hónap-index (évnél: az év közepe, de jelöljük)
export function parseMonth(s) {
    const t = String(s || '').trim();
    let m = t.match(/^(\d{4})\D+(\d{1,2})/) || null;
    if (m) return { m: Number(m[1]) * 12 + Number(m[2]) - 1, yearOnly: false };
    m = t.match(/^(\d{1,2})\D+(\d{4})/);
    if (m) return { m: Number(m[2]) * 12 + Number(m[1]) - 1, yearOnly: false };
    m = t.match(/^(\d{4})$/);
    if (m) return { m: Number(m[1]) * 12, yearOnly: true, year: Number(m[1]) };
    return null;
}
const inRange = (r, m) => (r.from == null || m >= r.from) && (r.to == null || m <= r.to);
// Csak évnél: akkor biztos, ha az egész év a tartományba esik.
const yearInRange = (r, y) => inRange(r, y * 12) && inRange(r, y * 12 + 11);

export function pickByDate(options, when) {
    const d = parseMonth(when);
    if (!d || options.length < 2) return null;
    const hits = options.map((o, i) => [i, o.range]).filter(([, r]) => r && (d.yearOnly ? yearInRange(r, d.year) : inRange(r, d.m)));
    return hits.length === 1 ? hits[0][0] : null;
}

// "HU 719/7 x (Polo IV (9N) 1.9 TDI (2002-2009)), W 610/1 (…)" -> elemek, a
// zárójeleken belüli vesszőt nem vágjuk el.
function topLevelItems(s) {
    const out = [];
    let depth = 0, cur = '';
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (ch === '(') depth++;
        if (ch === ')') depth--;
        if (depth === 0 && s.startsWith(', ', i)) { out.push(cur); cur = ''; i++; continue; }
        cur += ch;
    }
    if (cur.trim()) out.push(cur);
    return out.map((x) => x.trim()).filter(Boolean);
}

function parseFilterSource(hit) {
    let raw = String(hit.source || '');
    const brand = hit.brand || 'MANN-FILTER';
    const main = { cikkszam: hit.cikkszam, brand, cond: '' };
    const alts = [];
    let carDependent = false;
    // "ELLENŐRIZD, autótól függ: <cikkszám> (<másik autó>, <feltétel>)": a táblabeli
    // szűrő a legtöbb autóé, ezek a kivételek - a munkafelvevő dönt.
    const TAG = 'ELLENŐRIZD, autótól függ:';
    const at = raw.indexOf(TAG);
    if (at >= 0) {
        carDependent = true;
        for (const item of topLevelItems(raw.slice(at + TAG.length).trim())) {
            const p = item.indexOf(' (');
            const cik = p > 0 ? item.slice(0, p) : item;
            const inner = p > 0 ? item.slice(p + 2).replace(/\)$/, '') : '';
            alts.push({ cikkszam: cik.trim(), brand, cond: inner ? `más autónál: ${inner.replace(/ · /g, ', ').replace(/-9999\)/g, '-)')}` : 'más autónál' });
        }
        raw = raw.slice(0, at).replace(/\s*·\s*$/, '');
    }
    const segs = raw.split(/ · | \| /).map((x) => x.trim()).filter(Boolean);
    const condParts = [];
    for (const s of segs.slice(1)) {
        const vagy = s.match(/^vagy (.+?)(?: \((.*)\))?$/);
        if (vagy) { alts.push({ cikkszam: vagy[1].trim(), brand, cond: (vagy[2] || '').trim() }); continue; }
        if (/motorcsalád|család tagjai/.test(s)) continue;
        condParts.push(s);
    }
    if (carDependent && !condParts.length) condParts.push('a legtöbb autónál');
    main.cond = condParts.join(', ');
    const options = [main, ...alts].map((o) => ({ ...o, range: dateRange(o.cond) }));
    const seen = new Set();
    return { options: options.filter((o) => !seen.has(normCode(o.cikkszam)) && seen.add(normCode(o.cikkszam))), carDependent };
}

//  filterOptions: minden, amit a szűrő-kártya mutat. kind:
//    'one'   - egy szűrő, nincs mit eldönteni
//    'date'  - dátum szerint válik ketté (gyártás hónapjából választunk)
//    'check' - más feltétel (ház, motorszám, autó) - a munkafelvevő dönt
//    'none'  - nincs a táblában
export function filterOptions(engineCode, when) {
    const t = load('filters.json', { byEngine: {} });
    let code = engineCodes(engineCode).find((c) => t.byEngine[c]);
    const family = !code && familyCodes(engineCode).find((c) => t.byEngine[c]);
    code = code || family;
    const hit = code && t.byEngine[code];
    if (!hit) return { kind: 'none', code: engineCodes(engineCode)[0] || null, options: [] };
    const learned = !/MANN katalógus/.test(hit.source || '');
    const { options, carDependent } = learned
        ? { options: [{ cikkszam: hit.cikkszam, brand: hit.brand || '', cond: '', range: null }], carDependent: false }
        : parseFilterSource(hit);
    const byDate = options.length > 1 && options.every((o) => o.range);
    const kind = options.length === 1 ? 'one' : byDate && !carDependent ? 'date' : 'check';
    const auto = kind === 'date' ? pickByDate(options, when) : null;
    return { kind, code, family: family || null, learned, source: learned ? hit.source : 'MANN katalógus', options, auto };
}

// --- Saját márka: a MANN-szám megfelelője a műhely márkájában (pl. Bosch) ------
//  learned.json "xref": { "MANN-FILTER|W71295": { brand, cikkszam } }. Amíg nincs
//  TecDoc, a munkafelvevő egyszer megadja, és onnantól az ajánlat azt hozza.
export function xrefFor(brand, cikkszam) {
    return (learnedData().xref || {})[priceKey(brand, cikkszam)] || null;
}
export function rememberXref(from, to) {
    const key = priceKey(from?.brand, from?.cikkszam);
    const l = learnedData();
    l.xref ||= {};
    const cik = String(to?.cikkszam || '').trim().slice(0, 40), br = String(to?.brand || '').trim().slice(0, 30);
    if (!from?.cikkszam) return { persisted: false };
    if (!cik) delete l.xref[key]; else l.xref[key] = { brand: br, cikkszam: cik };
    return { xref: l.xref[key] || null, persisted: save('learned.json') };
}

// --- Olajcsere: motorkódonként az olaj és a mennyiség -------------------------
//  learned.json "engines": { "E|<MOTORKÓD>" | "C|<AUTÓ>": { oil, liters } }.
//  Amit a munkafelvevő egyszer kiválasztott, legközelebb magától jön. Motorkód
//  nélkül az autó neve a kulcs (gyengébb: más motorral is ugyanaz a név lehet).
const engineKeys = (engineCode, car) => {
    const codes = engineCodes(engineCode);
    if (codes.length) return codes.map((c) => `E|${c}`);
    const c = normCode(car);
    return c ? [`C|${c}`] : [];
};

export function oilForEngine(engineCode, car) {
    const engines = learnedData().engines || {};
    for (const k of engineKeys(engineCode, car)) if (engines[k]) return engines[k];
    return null;
}

export function rememberOilForEngine(engineCode, car, entry) {
    const keys = engineKeys(engineCode, car);
    const oil = String(entry?.oil || '').trim().slice(0, 80);
    const liters = Number(entry?.liters);
    if (!keys.length || !oil || !(liters > 0 && liters < 50)) return { persisted: false };
    const l = learnedData();
    l.engines ||= {};
    for (const k of keys) l.engines[k] = { oil, liters: Math.round(liters * 10) / 10 };
    return { persisted: save('learned.json') };
}

// --- Többi munka: alkatrész motorkódonként (pl. levegőszűrő, fékbetét) -------
//  learned.json "parts": { "E|<MOTORKÓD>|<alkatrész>": { brand, cikkszam, qty } }.
//  Amíg nincs TecDoc, a munkafelvevő egyszer beírja, és ugyanilyen motornál jön.
export function partsForEngine(engineCode, car) {
    const parts = learnedData().parts || {};
    const out = {};
    for (const k of engineKeys(engineCode, car).reverse()) {
        for (const [key, v] of Object.entries(parts)) if (key.startsWith(k + '|')) out[key.slice(k.length + 1)] = v;
    }
    return out;
}

export function rememberPartForEngine(engineCode, car, part, entry) {
    const keys = engineKeys(engineCode, car);
    const name = String(part || '').slice(0, 60);
    if (!keys.length || !name) return { persisted: false };
    const l = learnedData();
    l.parts ||= {};
    const cikkszam = String(entry?.cikkszam || '').trim().slice(0, 40), brand = String(entry?.brand || '').trim().slice(0, 30);
    const qty = Number(entry?.qty);
    for (const k of keys) {
        if (!cikkszam && !brand) delete l.parts[`${k}|${name}`];
        else l.parts[`${k}|${name}`] = { brand, cikkszam, ...(qty > 0 && qty < 100 && { qty }) };
    }
    return { persisted: save('learned.json') };
}

// Ajánlatszám: év + sorszám, pl. 2026-0007.
export function nextQuoteNumber(now = new Date()) {
    const l = learnedData();
    l.quoteNo = (l.quoteNo || 0) + 1;
    save('learned.json');
    return `${now.getFullYear()}-${String(l.quoteNo).padStart(4, '0')}`;
}

// --- Ellenőrzés: a műhely korábbi ajánlatai ------------------------------------
//  data/proof.json: { cases: [{ id, typeId, expected: { oil, liters, filterCikkszam, gross } }] }
export function proofCases() {
    return load('proof.json', { cases: [] }).cases || [];
}
