// node test.mjs - a számolás, a Fuchs-válasz feldolgozása és az alvázszám
// ellenőrzése. Hálózat nélkül fut.
import assert from 'assert/strict';
import { chargedLiters, pickOil, buildQuote, quoteText } from './public/quote.js';
import { normalizeRecommendation } from './lib/olyslager.js';
import { vinMake, vinYear, vinLooksValid, vinConflicts } from './public/vin.js';
import { engineCodes } from './lib/store.js';
import { analyze } from './public/pick.js';
import { vehiclesFromVin, flattenCategories, findCategory, tidyArticles, tidyOem, attachSpecs, detailsFrom, JOBS, checkOption } from './lib/tecdoc.js';
import { codeMatch, matchFuchs, sameOil } from './lib/match.js';
import { SHOP } from './lib/shop.js';

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

console.log(`\n${passed} teszt rendben.`);
