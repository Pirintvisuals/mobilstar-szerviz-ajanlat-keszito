// node test.mjs - a számolás, a Fuchs-válasz feldolgozása és az alvázszám
// ellenőrzése. Hálózat nélkül fut.
import assert from 'assert/strict';
import { chargedLiters, pickOil, buildQuote, quoteText } from './public/quote.js';
import { normalizeRecommendation } from './lib/olyslager.js';
import { vinMake, vinYear, vinLooksValid } from './public/vin.js';
import { engineCodes } from './lib/store.js';
import { vehiclesFromVin, flattenCategories, findCategory, tidyArticles, tidyOem } from './lib/tecdoc.js';

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
t('gyári szám: csak az erre hivatkozó sorok maradnak', () => {
    const r = tidyOem({ articles: [
        { supplierName: 'MANN-FILTER', articleNo: 'W 7008', crossManufacturerName: 'FORD', crossNumber: '1714 387' },
        { supplierName: 'EUROREPAR', articleNo: '1611660080', crossManufacturerName: 'PEUGEOT', crossNumber: '1109 AY' },
    ] }, '1714387', []);
    assert.equal(r.oemMaker, 'FORD');
    assert.deepEqual(r.articles.map((a) => a.articleNo), ['W 7008']);
});

console.log(`\n${passed} teszt rendben.`);
