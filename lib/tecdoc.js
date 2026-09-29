// ---------------------------------------------------------------------------
//  TecDoc-adat: alvázszám -> autó -> munka -> illő alkatrészek, és gyári
//  cikkszám -> utángyártott megfelelők.
//
//  FORRÁS MOST: a RapidAPI "Auto Parts Catalog" (nem hivatalos TecDoc-másolat,
//  a saját leírása szerint csak fejlesztésre / tesztre). Fizető ügyfél ezzel
//  nem mehet élesbe: élesben ugyanezek a függvények a licencelt TecDoc Web
//  Service-ből olvasnak, az app többi része nem változik.
//
//  A kulcs csak a szerveren van (RAPIDAPI_KEY). Minden választ elmentünk,
//  mert a havi keret kicsi: ugyanaz a kérés másodszor nem fogy.
// ---------------------------------------------------------------------------

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const HOST = 'auto-parts-catalog.p.rapidapi.com';
const TYPE_ID = 1;   // személyautó
const LANG_ID = 4;   // angol - a kategórianevek ezen a nyelven jönnek
const CACHE_DIR = process.env.VERCEL
    ? '/tmp/tecdoc-cache'
    : path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.tecdoc-cache');

const memory = new Map();
const status = { calls: 0, remaining: null };

export const tecdocConfigured = () => !!process.env.RAPIDAPI_KEY;
export const tecdocStatus = () => ({ configured: tecdocConfigured(), ...status });

async function get(route) {
    if (memory.has(route)) return memory.get(route);
    const url = `https://${HOST}${route}`;
    const file = path.join(CACHE_DIR, crypto.createHash('md5').update(url).digest('hex') + '.json');
    try {
        const cached = JSON.parse(fs.readFileSync(file, 'utf8'));
        memory.set(route, cached);
        return cached;
    } catch (error) { /* nincs még elmentve */ }

    if (!tecdocConfigured()) throw new Error('A TecDoc-teszt nincs beállítva (RAPIDAPI_KEY).');
    status.calls++;
    const res = await fetch(url, {
        headers: { 'x-rapidapi-host': HOST, 'x-rapidapi-key': process.env.RAPIDAPI_KEY },
        signal: AbortSignal.timeout(90_000),
    });
    const left = res.headers.get('x-ratelimit-requests-remaining');
    if (left != null) status.remaining = Number(left);
    if (res.status === 429) throw new Error('Elfogyott a havi TecDoc-tesztkeret.');
    if (!res.ok) throw new Error(`TecDoc hiba (${res.status})`);
    const data = await res.json();
    memory.set(route, data);
    try {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
        fs.writeFileSync(file, JSON.stringify(data));
    } catch (error) { /* csak olvasható fájlrendszer: marad a memóriában */ }
    return data;
}

// ---------- Munkák: magyar név -> TecDoc kategóriák ----------
// A TecDoc-fában ugyanaz a név több ágon is előfordul; a "parent" mondja
// meg, melyiket választjuk. A munkaóra MINTA - a szerelő átírja.
export const JOBS = [
    { key: 'oil', label: 'Olajcsere', hours: 0.5, parts: [
        { label: 'Olajszűrő', name: 'Oil Filter', parent: 'Filters' }] },
    { key: 'service', label: 'Kis szerviz (szűrők)', hours: 1, parts: [
        { label: 'Olajszűrő', name: 'Oil Filter', parent: 'Filters' },
        { label: 'Levegőszűrő', name: 'Air Filter', parent: 'Filters' },
        { label: 'Pollenszűrő', name: 'Cabin Air Filter', parent: 'Filters' },
        { label: 'Üzemanyagszűrő', name: 'Fuel Filter', parent: 'Filters' }] },
    { key: 'belt', label: 'Vezérműszíj-csere', hours: 3, parts: [
        { label: 'Vezérműszíj-készlet', name: 'Timing Belt Kit', parent: 'Belt Drive' },
        { label: 'Vízpumpa', name: 'Water Pump', parent: 'Cooling System' },
        { label: 'Hosszbordás szíj', name: 'V-Ribbed Belt Set', parent: 'Belt Drive' }] },
    { key: 'chain', label: 'Vezérműlánc-csere', hours: 6, parts: [
        { label: 'Vezérműlánc-készlet', name: 'Timing Chain Kit', parent: 'Engine' }] },
    { key: 'brake', label: 'Fékbetét + féktárcsa', hours: 1.5, parts: [
        { label: 'Fékbetét', name: 'Brake Pad', parent: 'Braking System' },
        { label: 'Féktárcsa', name: 'Brake Disc', parent: 'Braking System', qty: 2 }] },
    { key: 'clutch', label: 'Kuplungcsere', hours: 4, parts: [
        { label: 'Kuplungszett', name: 'Clutch Kit', parent: 'Clutch/Attachment Parts' }] },
    { key: 'shocks', label: 'Lengéscsillapító', hours: 2, parts: [
        { label: 'Lengéscsillapító', name: 'Shock Absorber', parent: 'Suspension/Damping', qty: 2 }] },
];

// ---------- Tiszta függvények (tesztelhetők hálózat nélkül) ----------

// VIN-válasz -> autók listája.
export function vehiclesFromVin(data) {
    const d = data?.data || {};
    const out = (d.matchingVehicles?.array || []).map((v) => ({
        vehicleId: v.vehicleId, modelId: v.modelId, name: v.carName || v.vehicleTypeDescription || String(v.vehicleId),
    }));
    const models = (d.matchingModels?.array || []).map((m) => ({ modelId: m.modelId, name: m.modelName }));
    const make = d.matchingManufacturers?.array?.[0]?.manuName || null;
    return { vehicles: out, models, make };
}

// A lapos kategórialista (level + categoryName1..4) -> { név, id, szülő }.
export function flattenCategories(data) {
    return (data?.categories || []).map((c) => ({
        id: c[`categoryId${c.level}`], name: c[`categoryName${c.level}`], parent: c.categoryName1,
    })).filter((c) => c.id && c.name);
}

// Pontos névegyezés, a kért szülőág előnyben; ha nincs, "tartalmazza".
export function findCategory(cats, { name, parent }) {
    const n = name.toLowerCase();
    const exact = cats.filter((c) => c.name.toLowerCase() === n);
    return exact.find((c) => c.parent === parent) || exact[0]
        || cats.find((c) => c.name.toLowerCase().includes(n)) || null;
}

const normNo = (s) => String(s || '').toUpperCase().replace(/[\s.\-/]/g, '');

// Cikkek -> egyedi márka+cikkszám lista, a műhely márkái előre.
export function tidyArticles(list, brands = []) {
    const pref = brands.map((b) => b.toUpperCase());
    const seen = new Set(), out = [];
    for (const a of list || []) {
        const brand = a.supplierName, no = a.articleNo;
        if (!brand || !no) continue;
        const k = brand + '|' + no;
        if (seen.has(k)) continue;
        seen.add(k);
        const rank = pref.indexOf(brand.toUpperCase());
        out.push({ brand, articleNo: no, name: a.articleProductName || '', articleId: a.articleId || null, preferred: rank >= 0, rank: rank >= 0 ? rank : 999 });
    }
    return out.sort((a, b) => a.rank - b.rank || a.brand.localeCompare(b.brand) || a.articleNo.localeCompare(b.articleNo));
}

// A gyári-szám keresés minden gyártó számát visszaadja: csak azok maradnak,
// amelyek tényleg erre a gyári számra hivatkoznak.
export function tidyOem(data, oem, brands = []) {
    const want = normNo(oem);
    const rows = (data?.articles || []).filter((a) => normNo(a.crossNumber) === want);
    const oemMaker = rows[0]?.crossManufacturerName || null;
    return { oemMaker, articles: tidyArticles(rows, brands) };
}

// ---------- Hálózati hívások ----------

export async function vinLookup(vin) {
    const v = String(vin || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (v.length !== 17) throw new Error('Az alvázszám 17 karakter.');
    return vehiclesFromVin(await get(`/vin/tecdoc-vin-check/${v}`));
}

export async function partsForJob(vehicleId, jobKey, brands) {
    const job = JOBS.find((j) => j.key === jobKey);
    if (!job) throw new Error('Ismeretlen munka');
    const cats = flattenCategories(await get(`/category/type-id/${TYPE_ID}/products-groups-variant-1/${Number(vehicleId)}/lang-id/${LANG_ID}`));
    const parts = [];
    for (const p of job.parts) {
        const cat = findCategory(cats, p);
        if (!cat) { parts.push({ ...p, category: null, articles: [] }); continue; }
        const data = await get(`/articles/list/type-id/${TYPE_ID}/vehicle-id/${Number(vehicleId)}/category-id/${cat.id}/lang-id/${LANG_ID}`);
        parts.push({ ...p, category: cat, articles: tidyArticles(data?.articles, brands) });
    }
    return { job: { key: job.key, label: job.label, hours: job.hours }, parts };
}

export async function oemLookup(oem, brands) {
    const clean = String(oem || '').trim();
    if (normNo(clean).length < 4) throw new Error('Adj meg egy gyári cikkszámot.');
    return tidyOem(await get(`/artlookup/search-for-analogue-of-spare-parts-by-oem-number/article-oem-no/${encodeURIComponent(clean)}`), clean, brands);
}
