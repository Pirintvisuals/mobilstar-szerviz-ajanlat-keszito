// ---------------------------------------------------------------------------
//  Inter Cars: élő ár és készlet egy adott márkához és cikkszámhoz.
//    márka + cikkszám -> SKU (TOW_KOD, a ProductInformation CSV-ből) -> ár, készlet
//  Az IC API-nak nincs autó- és cikkszámkeresése, csak SKU-t ismer, ezért kell a
//  CSV-ből épített tábla (tools/ic-import.mjs).
//
//  A dokumentációból (docs.webapi.intercars.eu), éles kulccsal még NEM próbálva:
//    POST /ic/pricing/quote, POST /ic/inventory/stock, a válaszmezők nevei.
//  Feltételezés: a token client_credentials + Basic (a token címe csak a kulccsal
//  együtt érkező Postman-fájlban van). Ha más, itt kell javítani.
// ---------------------------------------------------------------------------
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normCode } from './store.js';

const BASE = () => process.env.IC_BASE_URL || 'https://api.webapi.intercars.eu';
const SKU_PATH = () => process.env.IC_SKU_PATH
    || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'private', 'ic-sku.json');
// A dokumentáció 20-at, 30-at és 100-at is ír egy kérésre: a legkisebbel megyünk.
const BATCH = 20;

export const icConfigured = () => !!(process.env.IC_CLIENT_ID && process.env.IC_CLIENT_SECRET && process.env.IC_TOKEN_URL);

// Ugyanaz a gyártó más néven a TecDocban és az IC-nél. Csak biztos párok kerülhetnek ide.
const BRAND_ALIAS = { MANNFILTER: 'MANN', FEBIBILSTEIN: 'FEBI', HENGSTFILTER: 'HENGST' };
export function icBrand(brand) {
    const b = String(brand || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    return BRAND_ALIAS[b] || b;
}
export const icKey = (brand, articleNo) => `${icBrand(brand)}|${normCode(articleNo)}`;

// --- CSV: pontosvessző, az első sor a fejléc, a szöveg lehet idézőjelben ----------
export function csvFields(line) {
    const out = [];
    let cur = '', quoted = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (quoted) {
            if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
            else if (ch === '"') quoted = false;
            else cur += ch;
        } else if (ch === '"') quoted = true;
        else if (ch === ';') { out.push(cur); cur = ''; }
        else cur += ch;
    }
    out.push(cur);
    return out.map((s) => s.trim());
}

// Sorról sorra épül a tábla. Ha egy márka + cikkszám két SKU-hoz is tartozik, nem
// találgatunk: az a sor nem kap automatikus árat, a munkafelvevő adja meg.
export function skuTable() {
    const skus = {}, dup = new Set();
    let col = null;
    return {
        add(line) {
            const f = csvFields(line);
            if (!col) {
                col = { sku: f.indexOf('TOW_KOD'), no: f.indexOf('ARTICLE_NUMBER'), brand: f.indexOf('MANUFACTURER') };
                if (Object.values(col).includes(-1)) throw new Error('Nem ProductInformation fájl: hiányzik a TOW_KOD, ARTICLE_NUMBER vagy MANUFACTURER oszlop');
                return;
            }
            const sku = f[col.sku];
            if (!sku || !f[col.no] || !f[col.brand]) return;
            const k = icKey(f[col.brand], f[col.no]);
            if (skus[k] && skus[k] !== sku) dup.add(k); else skus[k] = sku;
        },
        result() {
            for (const k of dup) delete skus[k];
            return { skus, ambiguous: dup.size };
        },
    };
}

let table = null;
function skuFor(brand, articleNo) {
    if (table === null) {
        try { table = JSON.parse(fs.readFileSync(SKU_PATH(), 'utf8')); } catch { table = {}; }
    }
    return table[icKey(brand, articleNo)] || null;
}
export function resetSkuTable() { table = null; }

// --- Kapcsolat ---------------------------------------------------------------------
let token = null;
async function getToken(fetchFn) {
    if (token && token.until > Date.now()) return token.value;
    const basic = Buffer.from(`${process.env.IC_CLIENT_ID}:${process.env.IC_CLIENT_SECRET}`).toString('base64');
    const res = await fetchFn(process.env.IC_TOKEN_URL, {
        method: 'POST',
        headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=client_credentials',
    });
    if (!res.ok) throw new Error(`Inter Cars belépés sikertelen (${res.status})`);
    const j = await res.json();
    token = { value: j.access_token, until: Date.now() + Math.max(0, (j.expires_in || 300) - 60) * 1000 };
    return token.value;
}
export function resetToken() { token = null; }

async function call(fetchFn, route, body) {
    const res = await fetchFn(`${BASE()}${route}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await getToken(fetchFn)}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Inter Cars ${route}: ${res.status}`);
    return res.json();
}

// A válasz gyökerét a dokumentáció nem mutatja: lista vagy { lines } is lehet.
const rows = (j) => (Array.isArray(j) ? j : j?.lines || j?.items || j?.products || []);

export function tidyPrices(j) {
    const out = {};
    for (const r of rows(j)) {
        const p = r?.price;
        if (!r?.sku || !p || (p.currencyCode && p.currencyCode !== 'HUF')) continue; // más pénznemet nem írunk ajánlatba
        out[r.sku] = { listNet: p.listPriceNet ?? null, customerNet: p.customerPriceNet ?? null };
    }
    return out;
}
// Egy SKU több raktárban is lehet: a darabszámokat összeadjuk.
export function tidyStock(j) {
    const out = {};
    for (const r of rows(j)) if (r?.sku) out[r.sku] = (out[r.sku] || 0) + (Number(r.availability) || 0);
    return out;
}

// items: [{ brand, articleNo }] -> { 'MÁRKA|CIKKSZÁM': { sku, listNet, customerNet, available } }
export async function icPrices(items, keyOf, fetchFn = fetch) {
    const found = items.map((i) => ({ key: keyOf(i.brand, i.articleNo), sku: skuFor(i.brand, i.articleNo) })).filter((i) => i.sku);
    const skus = [...new Set(found.map((i) => i.sku))];
    const prices = {}, stock = {};
    for (let i = 0; i < skus.length; i += BATCH) {
        const part = skus.slice(i, i + BATCH);
        // Egységár kell, ezért a mennyiség mindig 1.
        Object.assign(prices, tidyPrices(await call(fetchFn, '/ic/pricing/quote', { lines: part.map((sku) => ({ sku, quantity: 1 })) })));
        for (const [sku, n] of Object.entries(tidyStock(await call(fetchFn, '/ic/inventory/stock', { sku: part.join(',') })))) stock[sku] = n;
    }
    const out = {};
    for (const { key, sku } of found) {
        if (prices[sku]) out[key] = { sku, ...prices[sku], available: stock[sku] ?? null };
    }
    return out;
}
