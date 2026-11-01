// node test.mjs - a számolás, a Fuchs-válasz feldolgozása és az alvázszám
// ellenőrzése. Hálózat nélkül fut.
import assert from 'assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { csvFields, skuTable, icKey, tidyPrices, tidyStock, icPrices, resetSkuTable, resetToken } from './lib/intercars.js';
import { chargedLiters, pickOil, buildQuote, quoteText } from './public/quote.js';
import { normalizeRecommendation } from './lib/olyslager.js';
import { vinMake, vinYear, vinLooksValid, vinConflicts } from './public/vin.js';
import { engineCodes, dateRange, parseMonth, pickByDate, filterOptions, priceKey } from './lib/store.js';
import { analyze } from './public/pick.js';
import { vehiclesFromVin, flattenCategories, findCategory, tidyArticles, tidyOem, attachSpecs, detailsFrom, JOBS, jobsForClient, checkOption } from './lib/tecdoc.js';
import { activeJobs, checkList as planChecks, answeredOf, needsOil, partList as planParts, extrasList as planExtras, labourOf, icLine, codeOptions } from './public/plan.js';
import { seriesMatches, tidyEngineRows } from './lib/tecdoc.js';
import { codeMatch, matchFuchs, sameOil } from './lib/match.js';
import { SHOP, shopFor } from './lib/shop.js';

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('  ✓ ' + name); };

console.log('Számolás');
t('kerekítés', () => {
    assert.equal(chargedLiters(4.3, 'exact'), 4.3);
    assert.equal(chargedLiters(4.3, 'half'), 4.5);
    assert.equal(chargedLiters(4.5, 'half'), 4.5);
    assert.equal(chargedLiters(4.3, 'whole'), 5);
    assert.equal(chargedLiters(4.0, 'whole'), 4);
    assert.equal(chargedLiters(null, 'half'), 0);
});

const oils = [{ code: 'A', name: 'Egyik' }, { code: 'B', name: 'Másik' }];
t('olajválasztás: saját olaj előre, különben a Fuchs első', () => {
    assert.equal(pickOil(oils, []).code, 'A');
    assert.equal(pickOil(oils, ['X', 'B']).code, 'B');
    assert.equal(pickOil([], ['B']), null);
});

const shop = {
    name: 'Teszt', vatRate: 0.27, partsMarkup: 0.25, fallbackOilNetPerLiter: 3200,
    labour: { label: 'Munkadíj', net: 8000 },
    extras: [
        { key: 'washer', label: 'Alátét', qty: 1, unitNet: 200, markup: true },
        { key: 'waste', label: 'Fáradtolaj', qty: 1, unitNet: 1000, markup: false },
    ],
};
t('végösszeg kézzel számolva', () => {
    const q = buildQuote({
        shop, oil: oils[0], liters: 4.5,
        oilPrice: { cikkszam: 'U-1', netPerLiter: 2400, source: 'számla' },
        filter: { cikkszam: 'F-1', net: 2000, source: 'számla' },
    });
    // olaj 2400*1.25=3000 Ft/l * 4.5 = 13500; szűrő 2500; alátét 250; fáradtolaj 1000; munka 8000
    assert.deepEqual(q.lines.map((l) => l.net), [13500, 2500, 250, 1000, 8000]);
    assert.equal(q.net, 25250);
    assert.equal(q.vat, 6818); // 6817.5 -> 6818
    assert.equal(q.gross, 32068);
    assert.equal(q.complete, true);
    assert.equal(q.lines[0].cikkszam, 'U-1');
});
t('hiányzó ár jelölve, nem csendben nulla', () => {
    const q = buildQuote({ shop, oil: oils[0], liters: 4, oilPrice: null, filter: null });
    assert.equal(q.complete, false);
    assert.equal(q.lines[0].unitNet, 4000); // MINTA 3200 * 1.25
    assert.ok(q.lines[0].priceMissing && q.lines[1].priceMissing);
});
t('szerelő átírása csak az adott mezőt írja felül', () => {
    const q = buildQuote({ shop, oil: oils[0], liters: 4, oilPrice: { netPerLiter: 2400 }, filter: { cikkszam: 'F', net: 2000 },
        overrides: { labour: { unitNet: 12000 }, oil: { qty: 5 } } });
    assert.equal(q.lines.find((l) => l.key === 'labour').net, 12000);
    assert.equal(q.lines.find((l) => l.key === 'oil').net, 15000);
    assert.ok(q.lines.find((l) => l.key === 'oil').edited);
});
t('ügyfélszöveg', () => {
    const q = buildQuote({ shop, oil: oils[0], liters: 4.5, oilPrice: { netPerLiter: 2400 }, filter: { cikkszam: 'F-1', net: 2000 } });
    const s = quoteText({ shop, vehicle: { make: 'Skoda', type: 'Octavia', engineCode: 'CAYC' }, vin: 'X', quote: q });
    assert.match(s, /Skoda Octavia \(CAYC\)/);
    assert.match(s, /F-1/);
    assert.match(s, /Fizetendő: 32[\s ]068 Ft/);
});

console.log('Fuchs-válasz feldolgozása');
t('motor komponens, mennyiség, olajok összevonva', () => {
    const r = normalizeRecommendation({
        id: 1, makeName: 'Skoda', modelName: 'Octavia II', typeName: 'Octavia II 1.6 TDI', yearStart: 2009, yearEnd: 2012,
        components: [
            { componentCategoryId: 5, componentName: 'Váltó', capacities: [{ item: 'Kapacitás', value: '1,9', unit: 'liter' }], productRecommendations: [] },
            { componentCategoryId: 1, componentName: 'Motor', componentCode: 'CAYC',
                capacities: [{ item: 'Kapacitás', value: '4,3', unit: 'liter' }],
                productRecommendations: [
                    { productCode: 'M', productName: 'Meets', useName: 'Normál', intervals: [], approvalClassifications: ['meets_requirement'] },
                    { productCode: 'P', productName: 'Pro', useName: 'Normál', intervals: [{ intervalName: '15000 km' }], approvalClassifications: ['universal_approval'] },
                    { productCode: 'P', productName: 'Pro', useName: 'Hosszított', intervals: [{ intervalName: '30000 km' }], approvalClassifications: ['universal_approval'] },
                ] },
        ],
    });
    assert.equal(r.vehicle.engineCode, 'CAYC');
    assert.equal(r.capacityL, 4.3);
    assert.deepEqual(r.oils.map((o) => o.code), ['P', 'M']); // gyári jóváhagyás előre
    assert.equal(r.oils[0].uses.length, 2);
});

console.log('Alvázszám');
t('gyártó és évjárat', () => {
    assert.ok(vinLooksValid('TMBJJ21Z8C2012345'));
    assert.equal(vinMake('TMBJJ21Z8C2012345'), 'Skoda');
    assert.equal(vinYear('TMBJJ21Z8C2012345', new Date('2026-09-23')), 2012);
    assert.equal(vinYear('VF1AAAAAAC0000000'), null); // francia: nem állítunk évet
});
t('ütközés a kiválasztott autóval', () => {
    const now = new Date('2026-10-02');
    const skoda = 'TMBJJ21Z8C2012345'; // 2012
    assert.deepEqual(vinConflicts(skoda, { make: 'ŠKODA', yearStart: 2008, yearEnd: 2013 }, now), []);
    assert.equal(vinConflicts(skoda, { make: 'VW', yearStart: 2008, yearEnd: 2013 }, now).length, 1);
    assert.equal(vinConflicts(skoda, { make: 'Skoda', yearStart: 2015, yearEnd: 2020 }, now).length, 1);
    assert.deepEqual(vinConflicts(skoda, { make: 'Skoda', yearStart: 2013, yearEnd: 2018 }, now), []); // modellév: 1 év tűrés
    assert.deepEqual(vinConflicts('WVWZZZ1KZ9W000000', { make: 'VW' }, now), []);
    assert.deepEqual(vinConflicts('VF1AAAAAAC0000000', { make: 'Renault', yearStart: 1995, yearEnd: 2000 }, now), []); // nincs megbízható év
    assert.deepEqual(vinConflicts('', { make: 'Opel' }, now), []);
});

console.log('Motorkód');
t('a Fuchs több kódos mezője kódonként', () => {
    assert.deepEqual(engineCodes('ATD, AXR, BEW (PD)'), ['ATD', 'AXR', 'BEW']);
    assert.deepEqual(engineCodes('M 13A'), ['M13A']);
    assert.deepEqual(engineCodes('G13BB (SOHC)'), ['G13BB']);
    assert.deepEqual(engineCodes('Z 14 XEP'), ['Z14XEP']);
    assert.deepEqual(engineCodes(''), []);
});

console.log('TecDoc-teszt');
t('alvázszám-válasz -> autó', () => {
    const r = vehiclesFromVin({ data: {
        matchingModels: { array: [{ manuId: 74, modelId: 39, modelName: 'SL (R129)' }] },
        matchingVehicles: { array: [{ carName: 'MERCEDES-BENZ SL (R129) 500 (129.068)', modelId: 39, vehicleId: 9433 }] },
        matchingManufacturers: { array: [{ manuName: 'MERCEDES-BENZ' }] },
    } });
    assert.deepEqual(r.vehicles, [{ vehicleId: 9433, modelId: 39, name: 'MERCEDES-BENZ SL (R129) 500 (129.068)' }]);
    assert.equal(r.make, 'MERCEDES-BENZ');
    assert.deepEqual(vehiclesFromVin({}).vehicles, []);
});
const cats = flattenCategories({ categories: [
    { level: 3, categoryName1: 'Engine', categoryId3: 100470, categoryName3: 'Oil Filter' },
    { level: 2, categoryName1: 'Filters', categoryId2: 100259, categoryName2: 'Oil Filter' },
    { level: 2, categoryName1: 'Filters', categoryId2: 100901, categoryName2: 'Oil Filter Housing' },
] });
t('kategória: a kért ág nyer, különben az első pontos', () => {
    assert.equal(findCategory(cats, { name: 'Oil Filter', parent: 'Filters' }).id, 100259);
    assert.equal(findCategory(cats, { name: 'Oil Filter', parent: 'Nincs' }).id, 100470);
    assert.equal(findCategory(cats, { name: 'housing', parent: 'x' }).id, 100901);
    assert.equal(findCategory(cats, { name: 'Brake Pad', parent: 'x' }), null);
});
t('cikkek: egyedi, a műhely márkái sorrendben elöl', () => {
    const list = tidyArticles([
        { supplierName: 'FILTRON', articleNo: 'OP 629/1' },
        { supplierName: 'MAHLE', articleNo: 'OC 1051' },
        { supplierName: 'MANN-FILTER', articleNo: 'W 7008' },
        { supplierName: 'MANN-FILTER', articleNo: 'W 7008' },
    ], ['MANN-FILTER', 'MAHLE']);
    assert.deepEqual(list.map((a) => a.articleNo), ['W 7008', 'OC 1051', 'OP 629/1']);
    assert.deepEqual(list.map((a) => a.preferred), [true, true, false]);
});
t('műszaki adat: ráírva, első/hátsó tengely kiolvasva', () => {
    const arts = [{ articleId: 1 }, { articleId: 2 }, { articleId: 3 }];
    attachSpecs(arts, { articles: [
        { articleId: 1, allSpecifications: [{ criteriaName: 'Fitting Position', criteriaValue: 'Front Axle' }, { criteriaName: 'Diameter [mm]', criteriaValue: '300' }] },
        { articleId: 2, allSpecifications: [{ criteriaName: 'Fitting Position', criteriaValue: 'Rear Axle' }] },
    ] });
    assert.equal(arts[0].position, 'front');
    assert.equal(arts[0].specs[1].value, '300');
    assert.equal(arts[1].position, 'rear');
    assert.equal(arts[2].specs, undefined);
});
t('gyári szám: csak az erre hivatkozó sorok maradnak', () => {
    const r = tidyOem({ articles: [
        { supplierName: 'MANN-FILTER', articleNo: 'W 7008', crossManufacturerName: 'FORD', crossNumber: '1714 387' },
        { supplierName: 'EUROREPAR', articleNo: '1611660080', crossManufacturerName: 'PEUGEOT', crossNumber: '1109 AY' },
    ] }, '1714387', []);
    assert.equal(r.oemMaker, 'FORD');
    assert.deepEqual(r.articles.map((a) => a.articleNo), ['W 7008']);
});

console.log('Melyik alkatrész');
const disc = (brand, no, d, th, rank) => ({ brand, articleNo: no, name: 'Brake Disc', preferred: rank < 99, rank,
    specs: [{ name: 'Outer Diameter [mm]', value: String(d) }, { name: 'Brake Disc Thickness [mm]', value: String(th) }] });
const discs = [disc('BOSCH', 'B300', 300, 22, 0), disc('BOSCH', 'B334', 334, 32, 0), disc('TRW', 'T300', 300.5, 22, 1), disc('TRW', 'T334', 334, 32, 1), disc('X', 'X1', 300, 22, 99)];
t('csak a tényleg eltérő adatra kérdez, a méret 3%-on belül egy válasz', () => {
    const r = analyze(discs, { main: 'Brake Disc' });
    assert.equal(r.question.label, 'Külső átmérő');
    assert.deepEqual(r.question.options.map((o) => o.value).sort((a, b) => a - b), [300.3, 334]);
});
t('válasz után a műhely első márkáját ajánlja, nincs több kérdés', () => {
    const r = analyze(discs, { main: 'Brake Disc', answers: { 'Külső átmérő': 334 } });
    assert.equal(r.question, null);
    assert.equal(discs[r.recommended].articleNo, 'B334');
    assert.deepEqual(r.alternatives.map((i) => discs[i].articleNo), ['T334']);
});
t('"nem tudom" után nem kérdez újra, de jelzi a bizonytalanságot', () => {
    const r = analyze(discs, { main: 'Brake Disc', answers: { 'Külső átmérő': null } });
    assert.equal(r.unsure, true);
    assert.notEqual(r.question?.label, 'Külső átmérő');
});
t('Teves és ATE ugyanaz a fék', () => {
    const pad = (no, sys) => ({ brand: 'BOSCH', articleNo: no, name: 'Pad', preferred: true, rank: 0, specs: [{ name: 'Brake System', value: sys }] });
    const r = analyze([pad('1', 'Teves'), pad('2', 'ATE'), pad('3', 'Brembo')], { main: 'Pad' });
    assert.deepEqual(r.question.options.map((o) => o.value).sort(), ['ATE', 'Brembo']);
});

// ---------- Alvázszám -> Fuchs-motor, munka-kérdések ----------
t('TecDoc adatlap: motorkód, kW, évjárat, hengerek', () => {
    const d = detailsFrom({ vehicleTypeDetails: { manufacturerName: 'SKODA', modelType: 'OCTAVIA II (1Z3)', typeEngineName: '1.6 TDI', engCodes: 'CAYC, CLHA', powerKw: '77.0000', powerPs: '105.0000', capacityTech: '1598.0000', fuelType: 'Diesel', constructionIntervalStart: '2009-06-01', constructionIntervalEnd: '2013-04-01', numberOfCylinders: 4 } });
    assert.deepEqual(d.engineCodes, ['CAYC', 'CLHA']);
    assert.equal(d.powerKw, 77);
    assert.equal(d.from, 2009);
    assert.equal(d.cylinders, 4);
    assert.equal(detailsFrom({}), null);
});
t('motorkód: pontos, Fuchs-joker (x), család', () => {
    assert.equal(codeMatch('CAYC', 'CAYC'), 'exact');
    assert.equal(codeMatch('M 273.963', 'M273.96x'), 'exact');
    assert.equal(codeMatch('M 113.961', 'M113.963'), 'family');
    assert.equal(codeMatch('K9K 638', 'K9K'), 'family');
    assert.equal(codeMatch('CAYC', 'CRKB'), null);
});
const octavia = { make: 'SKODA', model: 'OCTAVIA II (1Z3)', type: '1.6 TDI', name: 'SKODA OCTAVIA II (1Z3) 1.6 TDI', engineCodes: ['CAYC'], powerKw: 77, fuel: 'Diesel', from: 2009, to: 2013 };
const fuchs = (typeId, type, engineCode, powerKw, yearStart, yearEnd, fuel = 'Dízel') => ({ typeId, make: 'Skoda', model: 'Octavia II', type, engineCode, powerKw: String(powerKw), yearStart, yearEnd, fuel });
t('egyértelmű motorkód + kW: magától választ, a 4x4 hátrébb kerül', () => {
    const m = matchFuchs(octavia, [fuchs(70989, 'Octavia II 1.6 TDI 4x4', 'CAYC', 77, 2009, 2012), fuchs(95276, 'Octavia III 1.6 TDI', 'CRKB', 81, 2013, 2017), fuchs(65998, 'Octavia II 1.6 TDI', 'CAYC', 77, 2009, 2012)]);
    assert.deepEqual(m.auto, [65998]);
    assert.equal(m.ranked.at(-1).typeId, 95276);
});
t('más kW vagy csak motorcsalád: nem választ magától, csak sorba rak', () => {
    assert.deepEqual(matchFuchs(octavia, [fuchs(1, 'Octavia II 1.6 TDI', 'CAYC', 66, 2009, 2012)]).auto, []);
    assert.deepEqual(matchFuchs({ ...octavia, engineCodes: ['CAYB'] }, [fuchs(1, 'Octavia II 1.6 TDI', 'CAYC', 77, 2009, 2012)]).auto, []);
});
t('ugyanaz az olaj és mennyiség = mindegy, melyik jelölt', () => {
    const rec = (codes, cap) => ({ capacityL: cap, oils: codes.map((code) => ({ code })) });
    assert.equal(sameOil(rec(['A', 'B'], 4.3), rec(['A', 'B'], 4.3)), true);
    assert.equal(sameOil(rec(['A'], 4.3), rec(['A'], 5.5)), false);
});
t('minden munka-kérdés válasza ismert alkatrészt és létező tételt kapcsol', () => {
    for (const j of JOBS) for (const c of j.checks) {
        assert.ok(c.text && c.options.length >= 2, `${j.key}.${c.id}`);
        for (const o of c.options) {
            for (const p of o.parts || []) assert.ok(p.label && p.name && p.parent, `${j.key}.${c.id}`);
            for (const x of Object.keys(o.extras || {})) assert.ok((SHOP.jobExtras[j.key] || []).some((e) => e.key === x), `${j.key}.${c.id}: ${x}`);
            for (const w of o.without || []) assert.ok(j.parts.some((p) => p.name === w), `${j.key}.${c.id}: ${w}`);
            if (o.job) assert.ok(JOBS.some((x) => x.key === o.job), `${j.key}.${c.id}: ${o.job}`);
        }
        for (const [re, opt] of c.auto?.rules || []) { assert.ok(c.options[opt], `${j.key}.${c.id}`); new RegExp(re); }
    }
    assert.equal(new Set(JOBS.flatMap((j) => j.checks.map((c) => j.key + c.id))).size, JOBS.reduce((s, j) => s + j.checks.length, 0));
    assert.equal(checkOption('clutch', 'dmf', 0).parts[0].name, 'Flywheel');
    assert.throws(() => checkOption('clutch', 'nincs', 0));
});

console.log('Olajcsere Fuchs nélkül: szűrő-változatok');
t('dátum: "-tól", "-ig", két dátum', () => {
    assert.deepEqual(dateRange('04/2003-tól'), { from: 2003 * 12 + 3, to: null });
    assert.deepEqual(dateRange('05/2000-ig'), { from: null, to: 2000 * 12 + 4 });
    assert.deepEqual(dateRange('06/2000 03/2003'), { from: 2000 * 12 + 5, to: 2003 * 12 + 2 });
    assert.equal(dateRange('Ház: Purflux'), null);
});
t('gyártás hónapja: 2014-03, 03/2014, csak év', () => {
    assert.equal(parseMonth('2014-03').m, 2014 * 12 + 2);
    assert.equal(parseMonth('03/2014').m, 2014 * 12 + 2);
    assert.equal(parseMonth('2014').yearOnly, true);
    assert.equal(parseMonth('valami'), null);
});
const opts = ['04/2003-tól', '05/2000-ig', '06/2000 03/2003'].map((cond) => ({ range: dateRange(cond) }));
t('dátum szerint választ, csak évnél csak ha az egész év egy tartományba esik', () => {
    assert.equal(pickByDate(opts, '2004-05'), 0);
    assert.equal(pickByDate(opts, '1999'), 1);
    assert.equal(pickByDate(opts, '2001-07'), 2);
    assert.equal(pickByDate(opts, '2003'), null); // 2003 eleje HU 611 x, vége W 66
    assert.equal(pickByDate(opts, ''), null);
});
t('MANN-tábla: egy szűrő, dátumfüggő, autófüggő, motorcsalád, ismeretlen', () => {
    assert.equal(filterOptions('CAYC').kind, 'one');
    const d = filterOptions('720', '2004-05');
    assert.equal(d.kind, 'date');
    assert.equal(d.options[d.auto].cikkszam, 'W 66');
    const c = filterOptions('ATD');
    assert.equal(c.kind, 'check');
    assert.deepEqual(c.options.map((o) => o.cikkszam), ['HU 726/2 x', 'HU 719/7 x']);
    assert.match(c.options[1].cond, /^más autónál: Polo IV \(9N\)/);
    assert.equal(filterOptions('K9K 999').family, 'K9K');
    assert.equal(filterOptions('QQ99').kind, 'none');
});
t('Mobilstar-profil: saját olajcsere-munkadíj, saját és minta apró tételek', () => {
    const s = shopFor('mobilstar');
    assert.equal(s.labour.net, 9843);
    assert.equal(s.ownLabour, true);
    const x = Object.fromEntries(s.jobExtras.oil.map((e) => [e.key, e]));
    assert.equal(x.washer.unitNet, 1050);
    assert.equal(x.washer.own, true);
    assert.equal(x.waste.own, false);
    assert.equal(x.waste.on, false); // a műhely ajánlatain nincs fáradtolaj-sor
    assert.equal(shopFor('').ownLabour, false);
    assert.equal(s.oils.find((o) => o.name.includes('GT1 FLEX 5 0W-20')).own, true);
    assert.ok(!shopFor('').oils.some((o) => o.own));
});

console.log('\nAz ajánlat váza (public/plan.js, a böngésző és a visszamérés közös)');
const CJOBS = jobsForClient();
const S = shopFor('mobilstar');
const answers = (jobsSel, picked) => answeredOf(planChecks(activeJobs(CJOBS, jobsSel)), (c) => {
    const i = c.options.findIndex((o) => o.label === picked[c.id]);
    return i < 0 ? null : i;
});
t('lánc + "Olajcsere is? Igen": az olajcsere munkadíja, olaja és szűrője is bekerül', () => {
    const ans = answers(['chain'], { oil: 'Igen' });
    const jobs = activeJobs(CJOBS, ['chain'], ans);
    assert.deepEqual(jobs.map((j) => j.key), ['chain', 'oil']);
    assert.equal(needsOil(jobs), true);
    assert.equal(labourOf(S, jobs, ans).fixed[0].net, 9843);
    // a behozott olajcsere kérdéseit nem kérdezzük
    assert.ok(!planChecks(activeJobs(CJOBS, ['chain'])).some((c) => c.job === 'oil'));
    // kis szerviz mellé nem hozza be még egyszer
    assert.deepEqual(activeJobs(CJOBS, ['chain', 'service'], ans).map((j) => j.key), ['chain', 'service']);
});
t('a darabszám eljut a böngészőbe: féktárcsa tengelyenként 2, hidrotőke 16', () => {
    const disc = planParts(activeJobs(CJOBS, ['brake']), [], ['első', 'hátsó']).filter((p) => p.base === 'Brake Disc');
    assert.deepEqual(disc.map((p) => [p.name, p.qty]), [['Brake Disc|első', 2], ['Brake Disc|hátsó', 2]]);
    const ans = answers(['chain'], { tappet: 'Igen' });
    assert.equal(planParts(activeJobs(CJOBS, ['chain'], ans), ans, ['első']).find((p) => p.base === 'Tappet').qty, 16);
});
t('klíma: több alkatrész egyszerre, munkaidő összeadva; töltet és nyomáspróba apró tétel', () => {
    const ans = answers(['ac'], { comp: 'Igen', cond: 'Igen', valve: 'Igen', flush: 'Nem' });
    const jobs = activeJobs(CJOBS, ['ac'], ans);
    assert.equal(planParts(jobs, ans, ['első']).length, 3);
    assert.equal(labourOf(S, jobs, ans).hours, 5.75);
    const on = planExtras(S, jobs, ans).filter((x) => x.on).map((x) => x.key).sort();
    assert.deepEqual(on, ['acgas', 'acrefill', 'cleaner', 'nitro']);
});
t('lánc, útban a klímakompresszor: leszívás, töltet, nyomáspróba és +2 óra', () => {
    const ans = answers(['chain'], { ac: 'Igen' });
    const jobs = activeJobs(CJOBS, ['chain'], ans);
    const on = planExtras(S, jobs, ans).filter((x) => x.on).map((x) => x.key);
    for (const k of ['acrefill', 'acgas', 'nitro']) assert.ok(on.includes(k), k);
    assert.equal(labourOf(S, jobs, ans).hours, 8);
});
t('féktisztító: munkánként a műhely mennyisége (szerviz 0,1, ATF 0,5)', () => {
    const q = (k) => planExtras(S, activeJobs(CJOBS, [k]), []).find((x) => x.key === 'cleaner');
    assert.equal(q('service').qty, 0.1);
    assert.equal(q('atf').qty, 0.5);
    assert.equal(q('atf').unitNet, 2760);
});
t('fékfolyadékcsere mint külön munka: fix munkadíj + fékpad, a folyadék alapból benne', () => {
    const jobs = activeJobs(CJOBS, ['brake', 'fluid']);
    assert.deepEqual(labourOf(S, jobs, []).fixed.map((f) => f.net), [19685, 3281]);
    assert.equal(planExtras(S, jobs, []).find((x) => x.key === 'fluid').on, true);
});
t('ár- és olajkulcs: ugyanaz írásjelektől függetlenül', () => {
    assert.equal(priceKey('Bosch', 'F 026 407 079'), priceKey('BOSCH', 'F026407079'));
    assert.equal(priceKey('OIL', 'FUCHS TITAN GT1 PRO C-3 5W-30'), 'OIL|FUCHSTITANGT1PROC35W30');
});

console.log('Motorkód-javaslat');
t('magyar típusnév -> TecDoc-sorozat', () => {
    assert.ok(seriesMatches('GOLF IV (1J1)', 'Golf'));
    assert.ok(seriesMatches('3 (E46)', '3-as'));
    assert.ok(!seriesMatches('30 (E46)', '3-as'));
    assert.ok(seriesMatches('A-CLASS (W176)', 'A-osztály'));
    assert.ok(seriesMatches('GLE (W166)', 'ML / GLE'));
    assert.ok(seriesMatches('M-CLASS (W164)', 'ML / GLE'));
    assert.ok(seriesMatches('OCTAVIA III (5E3)', 'Octavia'));
    assert.ok(!seriesMatches('GOLFSTREAM', 'Golf'));
});
const eRow = (n, o) => ({ typeEngineName: n, capacityLt: '2.0000', fuelType: 'Diesel', powerKw: '103.0000', constructionIntervalStart: '2008-06-01', constructionIntervalEnd: null, ...o });
const engRows = tidyEngineRows({ modelTypes: [
    eRow('2.0 CRD', { engineCodes: 'ECE' }), eRow('2.0 CRD', { engineCodes: 'BWD' }), eRow('2.0 CRD', { engineCodes: 'ECE' }),
    eRow('2.4', { engineCodes: 'ED3, ED5', capacityLt: '2.4000', fuelType: 'Petrol', powerKw: '125.0000' }),
    eRow('2.0 TDI', { engineCodes: 'OLD', constructionIntervalEnd: '2010-01-01' }),
] });
t('TecDoc-motorok: kódonként egy sor, ismétlés nélkül', () => {
    assert.deepEqual(engRows.map((r) => r.code), ['ECE', 'BWD', 'ED3', 'ED5', 'OLD']);
});
t('javaslat: a motor szűr, több kód mind megjelenik, üzemanyag és év számít', () => {
    const codes = (e, w) => codeOptions(engRows, e, w).map((o) => o.code);
    assert.deepEqual(codes('2.0 CRD dízel'), ['ECE', 'BWD']);
    assert.deepEqual(codes('2.4 benzin'), ['ED3', 'ED5']);
    assert.deepEqual(codes('2.4 dízel'), []);
    assert.deepEqual(codes('2.0 dízel', '2015-03'), ['ECE', 'BWD']);
    assert.deepEqual(codes('2.0 TDI dízel', '2009'), ['OLD']);
    assert.deepEqual(codes(''), []);
    assert.equal(codeOptions(engRows, '2.0 CRD dízel')[0].label, '2.0 CRD · 103 kW · 2008-');
});

console.log('Inter Cars');
t('CSV-sor: pontosvessző, idézőjel, idézőjelben pontosvessző', () => {
    assert.deepEqual(csvFields('A1;"BOSCH; Kft";"mondta ""ez"""; x '), ['A1', 'BOSCH; Kft', 'mondta "ez"', 'x']);
});
t('SKU-tábla: márkanév és írásjel nem számít, a kétértelmű kimarad', () => {
    const tb = skuTable();
    tb.add('TOW_KOD;IC_INDEX;ARTICLE_NUMBER;MANUFACTURER');
    tb.add('AAA1;x;W 712/75;MANN-FILTER');
    tb.add('BBB2;x;DF 4823;TRW');
    tb.add('CCC3;x;DF4823;TRW');
    const { skus, ambiguous } = tb.result();
    assert.equal(skus[icKey('MANN', 'W712/75')], 'AAA1');
    assert.equal(skus[icKey('TRW', 'DF4823')], undefined);
    assert.equal(ambiguous, 1);
    assert.throws(() => skuTable().add('MAS;FEJLEC'));
});
t('válasz: csak forint kerül be, a készlet raktáranként összeadódik', () => {
    const p = tidyPrices({ lines: [
        { sku: 'A', price: { currencyCode: 'HUF', listPriceNet: 1000, customerPriceNet: 700 } },
        { sku: 'B', price: { currencyCode: 'PLN', listPriceNet: 50 } }] });
    assert.deepEqual(p, { A: { listNet: 1000, customerNet: 700 } });
    assert.deepEqual(tidyStock([{ sku: 'A', availability: 2 }, { sku: 'A', availability: 3 }]), { A: 5 });
});
t('sor ára: listaár vagy saját ár; nincs készlet + megjegyzett ár -> a megjegyzett marad', () => {
    const ic = { listNet: 1000.4, customerNet: 700, available: 3 };
    assert.equal(icLine(ic).auto, 1000);
    assert.equal(icLine(ic).buyNet, 700);
    assert.equal(icLine(ic, { field: 'customer' }).auto, 700);
    assert.equal(icLine({ ...ic, available: 0 }, { remembered: true }).keep, true);
    assert.equal(icLine({ ...ic, available: 0 }).auto, 1000);
    assert.equal(icLine(null), null);
    assert.equal(icLine({ listNet: null, customerNet: 5 }), null);
});
// Hálózat nélkül: a kamu fetch az IC helyett válaszol.
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ic-'));
    process.env.IC_SKU_PATH = path.join(dir, 'sku.json');
    process.env.IC_CLIENT_ID = 'id'; process.env.IC_CLIENT_SECRET = 'secret'; process.env.IC_TOKEN_URL = 'https://token.test/t';
    const n = 45;
    const skus = { [icKey('MANN', 'W71275')]: 'AAA1' };
    for (let i = 0; i < n; i++) skus[icKey('TRW', `X${i}`)] = `S${i}`;
    fs.writeFileSync(process.env.IC_SKU_PATH, JSON.stringify(skus));
    resetSkuTable(); resetToken();
    const calls = [];
    const fake = async (url, opt) => {
        calls.push({ url, body: opt.body });
        const b = url.endsWith('/t') ? null : JSON.parse(opt.body);
        const json = !b ? { access_token: 'tok', expires_in: 3600 }
            : url.endsWith('/quote') ? { lines: b.lines.map((l) => ({ sku: l.sku, price: { currencyCode: 'HUF', listPriceNet: 1000, customerPriceNet: 700 } })) }
                : b.sku.split(',').map((sku) => ({ sku, availability: 4 }));
        return { ok: true, status: 200, json: async () => json };
    };
    const items = [{ brand: 'MANN-FILTER', articleNo: 'W 712/75' }, { brand: 'Ismeretlen', articleNo: 'Z1' },
        ...Array.from({ length: n }, (_, i) => ({ brand: 'TRW', articleNo: `X${i}` }))];
    const r = await icPrices(items, priceKey, fake);
    assert.deepEqual(r[priceKey('MANN-FILTER', 'W 712/75')], { sku: 'AAA1', listNet: 1000, customerNet: 700, available: 4 });
    assert.equal(r[priceKey('Ismeretlen', 'Z1')], undefined);
    assert.equal(Object.keys(r).length, n + 1);
    assert.equal(calls.filter((c) => c.url.endsWith('/t')).length, 1, 'a token újrahasznosul');
    assert.equal(calls.filter((c) => c.url.endsWith('/quote')).length, 3, '46 SKU, 20-asával');
    assert.equal(JSON.parse(calls.find((c) => c.url.endsWith('/quote')).body).lines[0].quantity, 1);
    let bad = false;
    resetToken();
    await icPrices(items, priceKey, async () => ({ ok: false, status: 401 })).catch(() => { bad = true; });
    assert.ok(bad, 'hibás belépés hibát dob');
    fs.rmSync(dir, { recursive: true, force: true });
    delete process.env.IC_SKU_PATH; delete process.env.IC_CLIENT_ID; delete process.env.IC_CLIENT_SECRET; delete process.env.IC_TOKEN_URL;
    resetSkuTable(); resetToken();
    passed++; console.log('  ✓ ár + készlet lekérdezés: SKU-tábla, 20-as csomagok, egy token, hiba esetén hiba');
}

console.log(`\n${passed} teszt rendben.`);
