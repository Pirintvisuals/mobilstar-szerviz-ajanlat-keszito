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
// ---------------------------------------------------------------------------

import { searchVehicles, engineOilFor, olyslagerConfigured } from '../lib/olyslager.js';
import { JOBS, tecdocStatus, vinLookup, partsForJob, oemLookup } from '../lib/tecdoc.js';
import { oilPrice, filterFor, rememberFilter, proofCases, normCode } from '../lib/store.js';
import { SHOP } from '../lib/shop.js';
import { buildQuote, chargedLiters, pickOil } from '../public/quote.js';

async function vehiclePayload(typeId) {
    const rec = await engineOilFor(typeId);
    const prices = {};
    for (const o of rec.oils) prices[o.code] = oilPrice(o.code);
    return {
        ...rec,
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
            return res.status(200).json({ ...tecdocStatus(), jobs: JOBS.map(({ key, label, hours, parts }) => ({ key, label, hours, parts: parts.map((p) => p.label) })) });
        }
        if (action === 'td-vin') {
            return res.status(200).json({ ...(await vinLookup(q.vin)), status: tecdocStatus() });
        }
        if (action === 'td-job') {
            return res.status(200).json({ ...(await partsForJob(q.vehicleId, q.job, SHOP.preferredBrands)), status: tecdocStatus() });
        }
        if (action === 'td-oem') {
            return res.status(200).json({ ...(await oemLookup(q.oem, SHOP.preferredBrands)), status: tecdocStatus() });
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
