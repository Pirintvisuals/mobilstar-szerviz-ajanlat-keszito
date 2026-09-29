// ---------------------------------------------------------------------------
//  /api/olajcsere - egyetlen végpont, az "action" mondja meg, mit kérünk.
//    GET  ?action=search&q=octavia 1.6 tdi   -> Fuchs járműlista
//    GET  ?action=vehicle&typeId=65998       -> olaj, mennyiség, szűrő, árak
//    POST {action:'filter', engineCode, cikkszam, brand, net} -> megjegyzi
//    GET  ?action=proof                      -> korábbi ajánlatok ellenőrzése
//  Alvázszámos alkatrész-ajánlat (TecDoc-teszt):
//    GET  ?action=td-status                  -> be van-e állítva, maradék keret
//    GET  ?action=td-vin&vin=...             -> autó(k) az alvázszámból
//    GET  ?action=td-job&vehicleId=..&job=.. -> illő alkatrészek, márkák
//    GET  ?action=td-oem&oem=...             -> gyári szám -> utángyártott
//    POST {action:'td-learn', vehicleId, part, answers, brand, articleNo}
//    POST {action:'td-price', brand, articleNo, net}  -> kézzel megadott ár megjegyzése
//    POST {action:'quote-no'}                -> következő ajánlatszám
// ---------------------------------------------------------------------------

import { searchVehicles, engineOilFor, olyslagerConfigured } from '../lib/olyslager.js';
import { JOBS, tecdocStatus, vinLookup, partsForJob, oemLookup } from '../lib/tecdoc.js';
import { oilPrice, filterFor, rememberFilter, proofCases, normCode,
    learnedPicks, rememberPick, priceKey, learnedPrice, rememberPrice, nextQuoteNumber } from '../lib/store.js';
import { SHOP, brandsFor } from '../lib/shop.js';
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

    try {
        if (action === 'config') {
            return res.status(200).json({ shop: SHOP, live: olyslagerConfigured() });
        }
        if (action === 'search') {
            return res.status(200).json({ results: await searchVehicles(q.q) });
        }
        if (action === 'vehicle') {
            return res.status(200).json(await vehiclePayload(q.typeId));
        }
        if (action === 'filter' && req.method === 'POST') {
            return res.status(200).json(rememberFilter(body.engineCode, body));
        }
        if (action === 'td-status') {
            return res.status(200).json({ ...tecdocStatus(), jobs: JOBS.map(({ key, label, hours, oil, parts }) => ({ key, label, hours, oil: !!oil, parts: parts.map((p) => p.label) })) });
        }
        if (action === 'td-vin') {
            return res.status(200).json({ ...(await vinLookup(q.vin)), status: tecdocStatus() });
        }
        if (action === 'td-job') {
            const r = await partsForJob(q.vehicleId, q.job, brandsFor);
            // Amit a szerelő erre az autóra már eldöntött, és a kézzel megadott árak.
            const learned = learnedPicks(q.vehicleId, [...r.parts.map((p) => p.name), 'FUCHS']);
            r.fuchsTypeId = learned.FUCHS?.articleNo || null; // a Fuchs-motor, amit erre az autóra választottak
            for (const p of r.parts) {
                p.learned = learned[p.name] || null;
                for (const a of p.articles) { const pr = learnedPrice(priceKey(a.brand, a.articleNo)); if (pr != null) a.price = pr; }
            }
            return res.status(200).json({ ...r, status: tecdocStatus() });
        }
        if (action === 'td-oem') {
            const r = await oemLookup(q.oem, SHOP.preferredBrands);
            for (const a of r.articles) { const pr = learnedPrice(priceKey(a.brand, a.articleNo)); if (pr != null) a.price = pr; }
            return res.status(200).json({ ...r, status: tecdocStatus() });
        }
        if (action === 'td-learn' && req.method === 'POST') {
            return res.status(200).json(rememberPick(body.vehicleId, body.part, body));
        }
        if (action === 'td-price' && req.method === 'POST') {
            const net = body.net == null || body.net === '' ? null : Number(body.net);
            return res.status(200).json(rememberPrice(body.key || priceKey(body.brand, body.articleNo), net));
        }
        if (action === 'quote-no' && req.method === 'POST') {
            return res.status(200).json({ number: nextQuoteNumber() });
        }
        if (action === 'proof') {
            const cases = proofCases();
            const results = [];
            for (const c of cases) {
                try { results.push(await runProofCase(c)); } catch (error) { results.push({ id: c.id, error: error.message, ok: false }); }
            }
            return res.status(200).json({ results });
        }
        return res.status(400).json({ error: 'Ismeretlen kérés' });
    } catch (error) {
        return res.status(502).json({ error: error.message });
    }
}
