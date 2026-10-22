// ---------------------------------------------------------------------------
//  /api/olajcsere - egyetlen végpont, az "action" mondja meg, mit kérünk.
//    GET  ?action=search&q=octavia 1.6 tdi   -> Fuchs járműlista
//    GET  ?action=vehicle&typeId=65998       -> olaj, mennyiség, szűrő, árak
//    POST {action:'filter', engineCode, cikkszam, brand, net} -> megjegyzi
//    GET  ?action=proof                      -> korábbi ajánlatok ellenőrzése
//  Alvázszámos alkatrész-ajánlat (TecDoc-teszt):
//    GET  ?action=td-status                  -> be van-e állítva, maradék keret
//    GET  ?action=td-vin&vin=...             -> autó(k) az alvázszámból
//    GET  ?action=td-car&vehicleId=..         -> motorkód, kW, évjárat (adatlap)
//    GET  ?action=td-oil&vehicleId=..&name=.. -> a Fuchs-motor magától (vagy jelöltek)
//    GET  ?action=td-job&vehicleId=..&job=.. -> illő alkatrészek, márkák
//    GET  ?action=td-check&vehicleId=..&job=..&check=..&opt=.. -> egy válasz alkatrészei
//    GET  ?action=td-oem&oem=...             -> gyári szám -> utángyártott
//    POST {action:'td-learn', vehicleId, part, answers, brand, articleNo}
//    POST {action:'td-price', brand, articleNo, net}  -> kézzel megadott ár megjegyzése
//    POST {action:'quote-no'}                -> következő ajánlatszám
// ---------------------------------------------------------------------------

import { searchVehicles, engineOilFor, olyslagerConfigured } from '../lib/olyslager.js';
import { JOBS, DEMO_VEHICLE, tecdocStatus, vinLookup, vehicleDetails, partsForJob, partsForCheck, jobAvailability, oemLookup } from '../lib/tecdoc.js';
import { matchFuchs, sameOil } from '../lib/match.js';
import { oilPrice, filterFor, rememberFilter, proofCases, normCode,
    learnedPicks, rememberPick, priceKey, learnedPrice, rememberPrice, nextQuoteNumber, hydrate, flush,
    filterOptions, xrefFor, rememberXref, oilForEngine, rememberOilForEngine } from '../lib/store.js';
import { SHOP, brandsFor, brandsForShop, shopFor } from '../lib/shop.js';
import { buildQuote, chargedLiters, pickOil } from '../public/quote.js';

async function vehiclePayload(typeId) {
    const rec = await engineOilFor(typeId);
    const prices = {}, learnedSale = {};
    for (const o of rec.oils) {
        prices[o.code] = oilPrice(o.code);
        // Kézzel megadott eladási literár (alvázszámos ajánlat), amíg nincs árlista.
        const l = learnedPrice(priceKey('FUCHS', o.code));
        if (l != null) learnedSale[o.code] = l;
    }
    return {
        ...rec,
        learnedSale,
        chosenOil: pickOil(rec.oils, SHOP.preferredOils)?.code || null,
        liters: chargedLiters(rec.capacityL, SHOP.oilRounding),
        oilPrices: prices,
        filter: rec.vehicle.engineCode ? filterFor(rec.vehicle.engineCode) : null,
    };
}

// Alkatrész-csoportok + amit erre az autóra már eldöntöttek, és a kézzel megadott árak.
function withLearned(vehicleId, parts, extra = []) {
    const learned = learnedPicks(vehicleId, [...parts.map((p) => p.name), ...extra]);
    for (const p of parts) {
        p.learned = learned[p.name] || null;
        for (const a of p.articles) { const pr = learnedPrice(priceKey(a.brand, a.articleNo)); if (pr != null) a.price = pr; }
    }
    return learned;
}

// Az alvázszámból kiválasztott autó Fuchs-motorja. Keresés a TecDoc-névvel és
// a motorkóddal is, aztán pontozás (lib/match.js). Ha több jelölt egyformán
// jó, és mind ugyanazt az olajat adja, mindegy, melyik: választunk.
async function fuchsForCar(vehicleId, name) {
    let details = null;
    try { details = await vehicleDetails(vehicleId); } catch (error) { /* adatlap nélkül csak a név */ }
    const make = (details?.make || String(name || '')).split(/[\s-]/)[0];
    const queries = [String(name || '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim(),
        ...(details?.engineCodes || []).slice(0, 2).map((c) => `${make} ${c}`)];
    const results = [];
    for (const q of queries) {
        try { results.push(...await searchVehicles(q)); } catch (error) { /* a többi keresés még jó lehet */ }
    }
    const m = matchFuchs({ ...(details || {}), name }, results);
    let auto = m.auto[0] || null;
    if (m.auto.length > 1) {
        const recs = await Promise.all(m.auto.slice(0, 4).map((id) => engineOilFor(id).catch(() => null)));
        if (!recs.every((r) => sameOil(r, recs[0]))) auto = null;
    }
    return { details, ranked: m.ranked, auto };
}

// Egy korábbi ajánlat újraszámolása és soronkénti összevetése.
async function runProofCase(c) {
    const started = Date.now();
    const v = await vehiclePayload(c.typeId);
    const oil = v.oils.find((o) => o.code === v.chosenOil) || null;
    const quote = buildQuote({ shop: SHOP, oil, liters: v.liters, oilPrice: oil ? v.oilPrices[oil.code] : null, filter: v.filter });
    const e = c.expected || {};
    const oilLine = quote.lines.find((l) => l.key === 'oil');
    const checks = [
        { what: 'Olaj', expected: e.oil, got: oil ? `${oil.code}${oilLine?.cikkszam && oilLine.cikkszam !== oil.code ? ' / ' + oilLine.cikkszam : ''}` : '-',
            ok: !!oil && [oil.code, oilLine?.cikkszam].map(normCode).includes(normCode(e.oil)) },
        { what: 'Mennyiség', expected: e.liters, got: v.liters, ok: Math.abs((e.liters ?? -1) - v.liters) < 0.05 },
        { what: 'Olajszűrő', expected: e.filterCikkszam, got: v.filter?.cikkszam || '-', ok: !!v.filter && normCode(v.filter.cikkszam) === normCode(e.filterCikkszam) },
        { what: 'Végösszeg', expected: e.gross, got: quote.gross, ok: Math.abs((e.gross ?? -1e9) - quote.gross) <= 1 },
    ];
    return { id: c.id, vehicle: v.vehicle, checks, ok: checks.every((k) => k.ok), ms: Date.now() - started };
}

export default async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    const q = req.query || {};
    let body = req.body || {};
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    const action = req.method === 'POST' ? body.action : q.action;

    // Egyszerű jelszó (APP_PASSWORD a Vercel beállításai közt). Ha nincs
    // beállítva - helyi gépen -, nincs jelszó.
    const password = process.env.APP_PASSWORD;
    if (password && req.headers?.['x-pass'] !== password) {
        return res.status(401).json({ error: 'Jelszó kell' });
    }
    const send = async (code, payload) => { await flush(); return res.status(code).json(payload); };

    try {
        await hydrate();
        if (action === 'config') {
            return send(200, { shop: shopFor(q.m), live: olyslagerConfigured(), demoVehicle: DEMO_VEHICLE });
        }
        if (action === 'search') {
            return send(200, { results: await searchVehicles(q.q) });
        }
        if (action === 'vehicle') {
            return send(200, await vehiclePayload(q.typeId));
        }
        if (action === 'filter' && req.method === 'POST') {
            return send(200, rememberFilter(body.engineCode, body));
        }
        // --- Olajcsere típusból (Fuchs nélkül): motorkód -> szűrő-változatok, a
        //     megjegyzett olaj és mennyiség, a műhely márkájának megfelelője, árak.
        if (action === 'oc-engine') {
            const shop = shopFor(q.m);
            const filter = filterOptions(q.code, q.when);
            const oil = oilForEngine(q.code, q.car);
            const xrefs = {}, prices = {};
            const price = (brand, cik) => { const k = priceKey(brand, cik); const v = learnedPrice(k); if (v != null) prices[k] = v; };
            for (const o of filter.options) {
                price(o.brand, o.cikkszam);
                const x = xrefFor(o.brand, o.cikkszam);
                if (x) { xrefs[priceKey(o.brand, o.cikkszam)] = x; price(x.brand, x.cikkszam); }
            }
            for (const o of [...(shop.oils || []), ...(oil ? [{ name: oil.oil }] : [])]) price('OIL', o.name);
            return send(200, { filter, oil, xrefs, prices });
        }
        if (action === 'oc-learn' && req.method === 'POST') {
            return send(200, rememberOilForEngine(body.engineCode, body.car, body));
        }
        if (action === 'oc-xref' && req.method === 'POST') {
            return send(200, rememberXref(body.from, body.to));
        }
        if (action === 'price') {
            return send(200, { net: learnedPrice(String(q.key || '')) });
        }
        if (action === 'td-status') {
            return send(200, { ...tecdocStatus(), jobs: JOBS.map(({ key, label, hours, oil, parts, checks }) => ({ key, label, hours, oil: !!oil, parts: parts.map((p) => p.label), partNames: parts.map((p) => p.name),
                checks: checks.map((c) => ({ id: c.id, text: c.text, why: c.why, auto: c.auto || null,
                    options: c.options.map((o) => ({ label: o.label, parts: (o.parts || []).map((p) => p.label), partNames: (o.parts || []).map((p) => p.name), extras: o.extras || {}, hours: o.hours || 0,
                        without: o.without || [], job: o.job || null, note: o.note || '' })) })) })) });
        }
        if (action === 'td-vin') {
            return send(200, { ...(await vinLookup(q.vin)), status: tecdocStatus() });
        }
        if (action === 'td-car') {
            return send(200, { details: await vehicleDetails(q.vehicleId).catch(() => null), status: tecdocStatus() });
        }
        if (action === 'td-avail') {
            return send(200, { jobs: await jobAvailability(q.vehicleId).catch(() => null), status: tecdocStatus() });
        }
        if (action === 'td-oil') {
            return send(200, { ...(await fuchsForCar(q.vehicleId, q.name)), status: tecdocStatus() });
        }
        if (action === 'td-job') {
            const r = await partsForJob(q.vehicleId, q.job, brandsForShop(q.m), brandsFor);
            const learned = withLearned(q.vehicleId, r.parts, ['FUCHS']);
            r.fuchsTypeId = learned.FUCHS?.articleNo || null; // a Fuchs-motor, amit erre az autóra választottak
            return send(200, { ...r, status: tecdocStatus() });
        }
        if (action === 'td-check') {
            const r = await partsForCheck(q.vehicleId, q.job, q.check, q.opt, brandsForShop(q.m), brandsFor);
            withLearned(q.vehicleId, r.parts);
            return send(200, { ...r, status: tecdocStatus() });
        }
        if (action === 'td-oem') {
            const r = await oemLookup(q.oem, SHOP.preferredBrands);
            for (const a of r.articles) { const pr = learnedPrice(priceKey(a.brand, a.articleNo)); if (pr != null) a.price = pr; }
            return send(200, { ...r, status: tecdocStatus() });
        }
        if (action === 'td-learn' && req.method === 'POST') {
            return send(200, rememberPick(body.vehicleId, body.part, body));
        }
        if (action === 'td-price' && req.method === 'POST') {
            const net = body.net == null || body.net === '' ? null : Number(body.net);
            return send(200, rememberPrice(body.key || priceKey(body.brand, body.articleNo), net));
        }
        if (action === 'quote-no' && req.method === 'POST') {
            return send(200, { number: nextQuoteNumber() });
        }
        if (action === 'proof') {
            const cases = proofCases();
            const results = [];
            for (const c of cases) {
                try { results.push(await runProofCase(c)); } catch (error) { results.push({ id: c.id, error: error.message, ok: false }); }
            }
            return send(200, { results });
        }
        return send(400, { error: 'Ismeretlen kérés' });
    } catch (error) {
        return send(502, { error: error.message });
    }
}
