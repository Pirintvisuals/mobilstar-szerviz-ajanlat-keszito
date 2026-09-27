// ---------------------------------------------------------------------------
//  Fuchs olajválasztó, élőben.
//  A https://www.fuchs.com/hu/hu/olajvalaszto/ oldal az Olyslager adatbázisából
//  dolgozik (api.olyslager.com, "fuchs_eu" adatkészlet). Ugyanazt kérdezzük le,
//  amit a munkafelvevő a Fuchs oldalán látna. A Fuchs Hungária telefonon
//  hozzájárult a demóhoz (2026-09-23); éles, fizetős termék előtt írásban is
//  kérjük meg.
//
//  A hozzáférési kulcs nincs a kódban: OLY_SUBSCRIPTION környezeti változó.
// ---------------------------------------------------------------------------

const BASE = 'https://api.olyslager.com/rest';
const LANG = 'hu';
const CAR_CATEGORIES = new Set(['Személyautók', 'Könnyű haszongépjárművek (< 7,5t)']);

export const olyslagerConfigured = () => Boolean(process.env.OLY_SUBSCRIPTION);

function headers() {
    return {
        'x-oly-subscription': process.env.OLY_SUBSCRIPTION || '',
        'x-oly-dataset': process.env.OLY_DATASET || 'fuchs_eu',
    };
}

// Egy napig tartjuk a választ: a Fuchs adatai nem változnak óránként, és ha
// épp lassú vagy nem elérhető, a már egyszer lekért autó akkor is megy.
const TTL_MS = 24 * 60 * 60 * 1000;
const cache = new Map();

async function get(path) {
    if (!olyslagerConfigured()) {
        throw new Error('Nincs beállítva a Fuchs-hozzáférés (OLY_SUBSCRIPTION).');
    }
    const hit = cache.get(path);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.data;
    let res;
    try {
        res = await fetch(BASE + path, { headers: headers(), signal: AbortSignal.timeout(12000) });
    } catch (error) {
        if (hit) return hit.data;
        throw new Error('A Fuchs olajválasztó nem érhető el (' + error.message + ')');
    }
    if (!res.ok) {
        if (hit) return hit.data;
        throw new Error('A Fuchs olajválasztó hibát adott: HTTP ' + res.status);
    }
    const json = await res.json();
    if (!json.success) throw new Error('A Fuchs olajválasztó hibát adott: ' + (json.message || 'ismeretlen'));
    cache.set(path, { at: Date.now(), data: json.resultData });
    if (cache.size > 2000) cache.delete(cache.keys().next().value);
    return json.resultData;
}

export const fuchsLink = (typeId) => `https://www.fuchs.com/hu/hu/olajvalaszto/#vehicle/${typeId}`;

// --- Márka -> típus -> motor, ugyanazok a listák, mint a Fuchs oldalán ------
const PASSENGER_CAR_ID = 1;
const idOf = (v) => {
    const n = parseInt(v, 10);
    if (!Number.isInteger(n) || n <= 0) throw new Error('Érvénytelen azonosító');
    return n;
};

export async function listMakes() {
    const data = await get(`/makes?language=${LANG}&categoryId=${PASSENGER_CAR_ID}`);
    return (data || []).map((m) => ({ id: m.id, name: m.makeName, from: m.typeYearStart || null, to: m.typeYearEnd || null }));
}

export async function listModels(makeId) {
    const data = await get(`/models?language=${LANG}&makeId=${idOf(makeId)}`);
    return (data || []).map((m) => ({ id: m.id, name: m.modelName, code: m.code || '', from: m.yearStart || null, to: m.yearEnd || null }));
}

export async function listTypes(modelId) {
    const data = await get(`/types?language=${LANG}&modelId=${idOf(modelId)}`);
    return (data || []).map((t) => ({
        id: t.id,
        name: t.typeName,
        code: t.code || '',
        from: t.yearStart || null,
        to: t.yearEnd || null,
        fuel: t.fuel || '',
        ccm: t.cylinderCC || null,
        kw: t.powerKW || null,
        hp: t.powerHP || null,
    }));
}

// Szabad szöveges keresés, pont mint a Fuchs keresőmezője: "octavia 1.6 tdi",
// "golf 7 CRKB", "astra j 1.4 turbo". Motorkód is működik.
export async function searchVehicles(text, count = 40) {
    const q = String(text || '').trim().slice(0, 80);
    if (q.length < 2) return [];
    const data = await get(`/search?language=${LANG}&searchText=${encodeURIComponent(q)}&searchCount=${count}&facetCount=0`);
    return (data.results || [])
        .filter((r) => CAR_CATEGORIES.has(r.category))
        .map((r) => ({
            typeId: r.typeId,
            make: r.make,
            model: r.model,
            type: r.type,
            engineCode: r.engineCode || '',
            yearStart: r.yearStart || null,
            yearEnd: r.yearEnd || null,
            fuel: r.fuel,
            powerKw: r.powerKw,
            powerHp: r.powerHp,
            ccm: r.cilinderCapacity,
        }));
}

const num = (s) => {
    const n = parseFloat(String(s || '').replace(',', '.'));
    return Number.isFinite(n) ? n : null;
};

// Egy autó (Fuchs "type") motorolaj-ajánlása: melyik Fuchs olaj, mennyi, és
// milyen csereciklussal. Csak a motor komponenst nézzük - ez olajcsere.
export async function engineOilFor(typeId) {
    const id = parseInt(typeId, 10);
    if (!Number.isInteger(id) || id <= 0) throw new Error('Érvénytelen jármű-azonosító');
    return normalizeRecommendation(await get(`/recommendations/${id}?language=${LANG}`));
}

export function normalizeRecommendation(r) {
    const components = r.components || [];
    const engine = components.find((c) => c.componentCategoryId === 1)
        || components.find((c) => /motor/i.test(c.componentName));

    const vehicle = {
        typeId: r.id,
        make: r.makeName,
        model: r.modelName,
        type: r.typeName,
        engineCode: engine?.componentCode || '',
        yearStart: r.yearStart || null,
        yearEnd: r.yearEnd || null,
        fuel: r.fuel,
        ccm: r.cylinderCC,
        powerKw: r.powerKW,
        powerHp: r.powerHP,
        fuchsUrl: fuchsLink(r.id),
    };
    if (!engine) return { vehicle, capacityL: null, capacities: [], oils: [] };

    const capacities = (engine.capacities || []).map((c) => ({
        label: c.item,
        liters: c.unit === 'liter' ? num(c.value) : null,
        raw: `${c.value} ${c.unit}`,
        condition: c.condition || '',
    }));

    // Ugyanaz az olaj több "use"-szal is jön (normál / hosszított csere).
    // Olajonként egy sor, a használati módok felsorolva mellette.
    const byCode = new Map();
    for (const p of engine.productRecommendations || []) {
        const key = p.productCode || p.productName;
        let o = byCode.get(key);
        if (!o) {
            o = {
                code: p.productCode,
                name: p.productName,
                order: byCode.size,
                approved: (p.approvalClassifications || []).includes('universal_approval'),
                temperature: p.temperatureName || '',
                uses: [],
            };
            byCode.set(key, o);
        }
        const interval = (p.intervals || []).map((i) => i.intervalName).join(', ');
        if (!o.uses.some((u) => u.name === p.useName)) o.uses.push({ name: p.useName, interval });
    }
    // Gyári jóváhagyású olaj előre; azon belül a Fuchs saját sorrendje.
    const oils = [...byCode.values()].sort((a, b) => (b.approved - a.approved) || (a.order - b.order));

    // Az első, literben megadott mennyiség a "feltöltés szűrővel" érték.
    const capacityL = capacities.find((c) => c.liters)?.liters ?? null;
    return { vehicle, capacityL, capacities, oils };
}
