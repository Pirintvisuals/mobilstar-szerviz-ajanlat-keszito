// ---------------------------------------------------------------------------
//  Az adat-"slotok". Ma JSON fájlok a data/ mappában, István számláiból és
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
//    quoteNo: utolsó ajánlatszám }
const LEARNED = { picks: {}, prices: {}, quoteNo: 0 };
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
