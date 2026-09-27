// node test.mjs - a számolás, a Fuchs-válasz feldolgozása és az alvázszám
// ellenőrzése. Hálózat nélkül fut.
import assert from 'assert/strict';
import { chargedLiters, pickOil, buildQuote, quoteText } from './public/quote.js';
import { normalizeRecommendation } from './lib/olyslager.js';
import { vinMake, vinYear, vinLooksValid } from './public/vin.js';
import { engineCodes } from './lib/store.js';

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

console.log(`\n${passed} teszt rendben.`);
