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

    // Fix tételek minden olajcserén. MINTA.
    labour: { label: 'Olajcsere munkadíj', net: 8000 },
    extras: [
        { key: 'washer', label: 'Leeresztőcsavar-tömítés', cikkszam: '', qty: 1, unitNet: 250, markup: true },
        { key: 'waste', label: 'Fáradtolaj-kezelés', cikkszam: '', qty: 1, unitNet: 1000, markup: false },
    ],
};

export const MINTA_FIELDS = ['partsMarkup', 'oilRounding', 'preferredOils', 'labour', 'extras', 'fallbackOilNetPerLiter'];
