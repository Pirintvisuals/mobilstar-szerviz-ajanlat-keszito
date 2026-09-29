// ---------------------------------------------------------------------------
//  A szerviz saját szabályai. MINDEN "MINTA" jelölésű szám helyőrző, amíg
//  István válasza (árrés, munkadíj, kerekítés, melyik olaj) meg nem jön -
//  onnantól ez a fájl az egyetlen hely, ahol ezeket át kell írni.
// ---------------------------------------------------------------------------

export const SHOP = {
    name: 'Mobil Star Szerviz',
    vatRate: 0.27,

    // Árrés a beszerzési (Unix) nettó árra, alkatrészen és olajon. MINTA.
    partsMarkup: 0.25,

    // Olajmennyiség kerekítése a Fuchs szerinti feltöltésből:
    //   'exact' = pontosan (hordóból literre), 'half' = felfelé 0,5 l-re,
    //   'whole' = felfelé egész literre. MINTA.
    oilRounding: 'half',

    // Ha a Fuchs több olajat ajánl: a műhely saját olajai, sorrendben (Fuchs
    // termékkód, pl. 'CP1003290'). Üres lista = a Fuchs első, gyári
    // jóváhagyású ajánlása. MINTA.
    preferredOils: [],

    // Olaj nettó beszerzési ára literenként, amíg nincs Unix-ár. MINTA.
    fallbackOilNetPerLiter: 3200,

    // Alvázszámos alkatrész-ajánlat: a műhely márkái, sorrendben - ezekből
    // választ magától, és ezek állnak elöl a listában. MINTA.
    preferredBrands: ['MANN-FILTER', 'MAHLE', 'BOSCH', 'CONTITECH', 'GATES', 'SKF', 'INA', 'LuK', 'SACHS', 'TRW', 'ATE', 'BREMBO', 'FEBI BILSTEIN'],

    // Alkatrészenként a műhely márkái (TecDoc-név szerint), sorrendben. Ahol
    // nincs külön lista, ott a preferredBrands érvényes. MINTA.
    brandsByPart: {
        'Oil Filter': ['MANN-FILTER', 'MAHLE', 'BOSCH'],
        'Air Filter': ['MANN-FILTER', 'MAHLE', 'BOSCH'],
        'Cabin Air Filter': ['MANN-FILTER', 'MAHLE', 'BOSCH'],
        'Fuel Filter': ['MANN-FILTER', 'MAHLE', 'BOSCH'],
        'Brake Pad': ['TRW', 'ATE', 'BOSCH', 'BREMBO', 'TEXTAR'],
        'Brake Disc': ['TRW', 'ATE', 'BREMBO', 'BOSCH', 'ZIMMERMANN'],
        'Timing Belt Kit': ['CONTITECH', 'GATES', 'INA', 'SKF'],
        'V-Ribbed Belt Set': ['CONTITECH', 'GATES', 'INA', 'SKF'],
        'Water Pump': ['SKF', 'INA', 'GATES', 'HEPU'],
        'Timing Chain Kit': ['FEBI BILSTEIN', 'SWAG', 'INA'],
        'Clutch Kit': ['LuK', 'SACHS', 'VALEO'],
        'Shock Absorber': ['SACHS', 'BILSTEIN', 'MONROE', 'KYB'],
    },

    // Munkadíj óradíja az alkatrész-ajánlatnál (nettó Ft/óra). MINTA.
    hourlyRate: 12000,

    // Munkánként a mellé járó apró tételek (eladási nettó egységár). on: alapból
    // benne van-e; a szerelő ki-be kapcsolja. MINTA.
    jobExtras: {
        oil: [
            { key: 'washer', label: 'Leeresztőcsavar-tömítés', qty: 1, unit: 'db', unitNet: 300, on: true },
            { key: 'waste', label: 'Fáradtolaj-kezelés', qty: 1, unit: 'db', unitNet: 1000, on: true }],
        service: [
            { key: 'washer', label: 'Leeresztőcsavar-tömítés', qty: 1, unit: 'db', unitNet: 300, on: true },
            { key: 'waste', label: 'Fáradtolaj-kezelés', qty: 1, unit: 'db', unitNet: 1000, on: true }],
        brake: [
            { key: 'cleaner', label: 'Féktisztító', qty: 1, unit: 'db', unitNet: 1500, on: true },
            { key: 'fluid', label: 'Fékfolyadék DOT 4 (csere)', qty: 1, unit: 'l', unitNet: 3000, on: false }],
        belt: [
            { key: 'coolant', label: 'Fagyálló (vízpumpa miatt)', qty: 3, unit: 'l', unitNet: 1800, on: true }],
        chain: [
            { key: 'coolant', label: 'Fagyálló', qty: 2, unit: 'l', unitNet: 1800, on: false }],
        clutch: [
            { key: 'gearoil', label: 'Váltóolaj', qty: 2, unit: 'l', unitNet: 3500, on: true },
            { key: 'fluid', label: 'Kuplungfolyadék (légtelenítés)', qty: 0.5, unit: 'l', unitNet: 3000, on: false }],
        shocks: [
            { key: 'align', label: 'Futómű-beállítás', qty: 1, unit: 'db', unitNet: 12000, on: true }],
    },

    // Az ajánlat fejléce és lábléce. MINTA.
    address: '1234 Minta, Szerviz utca 1.',
    phone: '+36 30 000 0000',
    taxNumber: '12345678-2-12',
    quoteValidDays: 15,
    quoteNote: 'Tájékoztató ajánlat. Ha szétszereléskor további hiba derül ki, a javítás előtt egyeztetünk.',

    // Fix tételek minden olajcserén. MINTA.
    labour: { label: 'Olajcsere munkadíj', net: 8000 },
    extras: [
        { key: 'washer', label: 'Leeresztőcsavar-tömítés', cikkszam: '', qty: 1, unitNet: 250, markup: true },
        { key: 'waste', label: 'Fáradtolaj-kezelés', cikkszam: '', qty: 1, unitNet: 1000, markup: false },
    ],
};

export const MINTA_FIELDS = ['partsMarkup', 'oilRounding', 'preferredOils', 'labour', 'extras', 'fallbackOilNetPerLiter', 'preferredBrands', 'brandsByPart', 'hourlyRate', 'jobExtras', 'address', 'phone', 'taxNumber'];

export const brandsFor = (tecdocName) => SHOP.brandsByPart[tecdocName] || SHOP.preferredBrands;
