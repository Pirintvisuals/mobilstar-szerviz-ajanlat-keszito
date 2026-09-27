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

// Vercelen a fájlrendszer csak olvasható: ott a mentés a futó példány
// memóriájában marad (a válaszban persisted:false jelzi).
function save(name) {
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
        t.byEngine[c] = {
            cikkszam,
            brand: String(entry.brand || '').trim(),
            ...(net != null && { net }),
            source: String(entry.source || 'szerelő adta meg'),
        };
    }
    return { filter: filterFor(engineCode), persisted: save('filters.json') };
}

// --- Ellenőrzés: a műhely korábbi ajánlatai ------------------------------------
//  data/proof.json: { cases: [{ id, typeId, expected: { oil, liters, filterCikkszam, gross } }] }
export function proofCases() {
    return load('proof.json', { cases: [] }).cases || [];
}
