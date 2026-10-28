// ---------------------------------------------------------------------------
//  A szerviz saját szabályai. MINDEN "MINTA" jelölésű szám helyőrző, amíg
//  a műhely meg nem adja a sajátját (árrés, munkadíj, kerekítés, melyik
//  olaj) - onnantól ez a fájl az egyetlen hely, ahol ezeket át kell írni.
//  A demó minden műhelynek ugyanez: semleges név, ne látsszon más ügyfél.
// ---------------------------------------------------------------------------

export const SHOP = {
    name: 'Minta Autószerviz',
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

    // Olajcsere: a műhely olajai, eladási nettó literárral. Ebből választ a
    // munkafelvevő egy motorhoz (egyszer), és a beírt ár megjegyződik. MINTA.
    oils: [
        { name: 'FUCHS TITAN GT1 PRO C-3 5W-30', unitNet: 4400 },
        { name: 'FUCHS TITAN GT1 PRO FLEX 5W-30', unitNet: 4400 },
        { name: 'FUCHS TITAN GT1 PRO C-2 0W-30', unitNet: 4900 },
        { name: 'FUCHS TITAN GT1 EVO 0W-20', unitNet: 4900 },
        { name: 'FUCHS TITAN SUPERSYN 5W-40', unitNet: 3900 },
        { name: 'FUCHS TITAN GT1 PRO B-2 10W-40', unitNet: 3300 },
    ],

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
        'Flywheel': ['LuK', 'SACHS', 'VALEO'],
        'Central Slave Cylinder': ['LuK', 'SACHS', 'VALEO'],
        'Slave Cylinder': ['LuK', 'SACHS', 'FTE'],
        'Master Cylinder': ['LuK', 'SACHS', 'FTE'],
        'Spark Plug': ['NGK', 'BOSCH', 'DENSO'],
        'Glow Plug': ['BERU', 'BOSCH', 'NGK'],
        'Battery': ['VARTA', 'BOSCH', 'EXIDE'],
        'Brake Caliper': ['TRW', 'ATE', 'BOSCH'],
        'Thermostat': ['MAHLE', 'WAHLER', 'GATES'],
        'Coil Springs': ['SACHS', 'LESJÖFORS', 'KYB'],
        'Wiper Blade/-Rubber': ['BOSCH', 'VALEO'],
    },

    // Munkadíj óradíja az alkatrész-ajánlatnál (nettó Ft/óra). MINTA: kerek
    // szám egy budapesti Bosch Car Service kiírt díja (19 685 Ft) alatt.
    hourlyRate: 18000,

    // Munkánként a mellé járó apró tételek (eladási nettó egységár). on: alapból
    // benne van-e; a szerelő ki-be kapcsolja. Ha több munkánál is szerepel, a
    // mennyiség az elsőé. A féktisztító a műhely ajánlatain szinte minden
    // munkán ott van (szerviz 0,1 - lánc, ATF 0,5 doboz). MINTA.
    jobExtras: {
        oil: [
            { key: 'washer', label: 'Leeresztőcsavar-tömítés', qty: 1, unit: 'db', unitNet: 300, on: true },
            { key: 'waste', label: 'Fáradtolaj-kezelés', qty: 1, unit: 'db', unitNet: 1000, on: true }],
        service: [
            { key: 'washer', label: 'Leeresztőcsavar-tömítés', qty: 1, unit: 'db', unitNet: 300, on: true },
            { key: 'waste', label: 'Fáradtolaj-kezelés', qty: 1, unit: 'db', unitNet: 1000, on: true },
            { key: 'cleaner', label: 'Féktisztító', qty: 0.1, unit: 'db', unitNet: 1500, on: true },
            { key: 'fluid', label: 'Fékfolyadék DOT 4 (csere)', qty: 1, unit: 'l', unitNet: 3000, on: false }],
        brake: [
            { key: 'cleaner', label: 'Féktisztító', qty: 1, unit: 'db', unitNet: 1500, on: true },
            { key: 'fluid', label: 'Fékfolyadék DOT 4 (csere)', qty: 1, unit: 'l', unitNet: 3000, on: false }],
        fluid: [
            { key: 'fluid', label: 'Fékfolyadék DOT 4 (csere)', qty: 1, unit: 'l', unitNet: 3000, on: true }],
        belt: [
            { key: 'cleaner', label: 'Féktisztító', qty: 0.5, unit: 'db', unitNet: 1500, on: true },
            { key: 'coolant', label: 'Fagyálló (vízpumpa / termosztát miatt)', qty: 3, unit: 'l', unitNet: 1800, on: false }],
        chain: [
            { key: 'cleaner', label: 'Féktisztító', qty: 0.5, unit: 'db', unitNet: 1500, on: true },
            { key: 'coolant', label: 'Fagyálló', qty: 2.5, unit: 'l', unitNet: 1800, on: false },
            // Ha a klímakompresszort le kell venni (kérdés a láncnál).
            { key: 'acrefill', label: 'Klíma hűtőközeg leszívás, visszatöltés', qty: 1, unit: 'db', unitNet: 14000, on: false },
            { key: 'acgas', label: 'Klíma hűtőközeg', qty: 580, unit: 'g', unitNet: 24, on: false },
            { key: 'nitro', label: 'Nitrogénes nyomáspróba', qty: 1, unit: 'db', unitNet: 11000, on: false }],
        clutch: [
            { key: 'gearoil', label: 'Váltóolaj', qty: 2, unit: 'l', unitNet: 3500, on: true },
            { key: 'fluid', label: 'Kuplungfolyadék (légtelenítés)', qty: 0.5, unit: 'l', unitNet: 3000, on: false }],
        shocks: [
            { key: 'align', label: 'Futómű-beállítás', qty: 1, unit: 'db', unitNet: 12000, on: true }],
        atf: [
            { key: 'atfoil', label: 'Automataváltó-olaj (ATF)', qty: 8, unit: 'l', unitNet: 4600, on: true },
            { key: 'diffoil', label: 'Differenciálmű-olaj', qty: 1, unit: 'l', unitNet: 5300, on: false },
            { key: 'cleaner', label: 'Féktisztító', qty: 0.5, unit: 'db', unitNet: 1500, on: true }],
        ac: [
            { key: 'acrefill', label: 'Klíma hűtőközeg leszívás, visszatöltés', qty: 1, unit: 'db', unitNet: 14000, on: true },
            { key: 'acgas', label: 'Klíma hűtőközeg', qty: 580, unit: 'g', unitNet: 24, on: true },
            { key: 'nitro', label: 'Nitrogénes nyomáspróba', qty: 1, unit: 'db', unitNet: 11000, on: true },
            { key: 'acflush', label: 'Klímarendszer átmosás', qty: 1, unit: 'db', unitNet: 150000, on: false },
            { key: 'cleaner', label: 'Féktisztító', qty: 0.2, unit: 'db', unitNet: 1500, on: true }],
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

export const MINTA_FIELDS = ['partsMarkup', 'oilRounding', 'preferredOils', 'oils', 'labour', 'extras', 'fallbackOilNetPerLiter', 'preferredBrands', 'brandsByPart', 'hourlyRate', 'jobExtras', 'address', 'phone', 'taxNumber'];

export const brandsFor = (tecdocName) => SHOP.brandsByPart[tecdocName] || SHOP.preferredBrands;

// Bemutató: alkatrészenkénti mintaár (eladási nettó Ft/db, TecDoc-név szerint),
// hogy a demóban minden ajánlatnak legyen végösszege. Élesben a műhely
// beszállítói ára jön helyette; a képernyőn "minta ár" jelölést kap.
export const SAMPLE_PRICES = {
    'Oil Filter': 3500, 'Air Filter': 5500, 'Cabin Air Filter': 6500, 'Fuel Filter': 9500,
    'Oil Filter Housing/Seal': 6000, 'Oil Sump Gasket': 9000, 'Spark Plug': 3800, 'Glow Plug': 6500,
    'Wiper Blade/-Rubber': 9000, 'Timing Belt Kit': 48000, 'Water Pump': 24000, 'Thermostat': 12000,
    'V-Ribbed Belt Set': 9500, 'Belt Tensioner (Tensioner Unit)': 15000, 'Shaft Seal/Set': 4500,
    'Engine Mounting': 26000, 'Timing Chain Kit': 125000, 'Valve Cover Gasket': 13000,
    'Brake Pad': 19000, 'Brake Disc': 17000, 'Wear Indicator': 4500, 'Brake Caliper': 48000, 'Brake Hoses': 6500,
    'Clutch Kit': 89000, 'Flywheel': 165000, 'Central Slave Cylinder': 42000, 'Slave Cylinder': 16000,
    'Master Cylinder': 23000, 'Transmission Mounting': 19000, 'Shock Absorber': 32000,
    'Suspension Strut/Shock Absorber Mount': 13000, 'Coil Springs': 21000, 'Battery': 46000,
    'Hydraulic Filter': 46000, 'Compressor, air conditioning': 141000, 'Condenser, air conditioning': 62000,
    'Expansion Valve, air conditioning': 23000, 'Gasket, timing case': 19000, 'Tappet': 4100, 'Camshaft Adjuster': 97000,
    'Control Valve, camshaft adjustment': 42000, 'Plug Housing, automatic transmission control unit': 7500,
};

// Műhelyenkénti bemutató-link (?m=...): a fejlécben és a PDF-en a műhely neve.
// Csak nyilvános adat (a műhely honlapja). Ezt a linket csak az adott műhely kapja.
// A Mobilstar-adatok a műhely 2026-10-14-i árajánlataiból: fix munkadíjak,
// márkák, apró tételek, kísérőlevél. Ügyféladat nincs benne.
const DEPOSIT_150 = 'Ilyen összegű és időtartamú javítás esetén bruttó 150 000 Ft javítási előleget kérünk. Lemondás esetén, ha a gyári alkatrészek visszaküldésével kapcsolatban plusz költségünk keletkezik, az levonásra kerül az előlegből.';
const QUALITY = 'A beépített alkatrészeket úgy választottam, hogy gyártójuk az utángyártott piacra és az autógyáraknak is szállít, így a minőség garantált.';
const PROFILES = {
    mobilstar: {
        name: 'Mobil Star Szerviz', address: '1108 Budapest, Újhegyi út 7.', phone: '(+36-1) 412 0950', taxNumber: '', hourlyRate: 19685,
        // Munkák saját fix munkadíjjal (nettó): ezek nem óradíjból számolnak.
        jobLabour: {
            oil: [{ label: 'Motorolajcsere munkadíj (1-es típus)', net: 9843 }],
            service: [{ label: 'Időszakos szemle (olaj-, olajszűrőcsere), átvizsgálás munkadíj - nagy', net: 19685 },
                { label: 'Levegőszűrő-betét ki-, beszerelése munkadíj', net: 6693 },
                { label: 'Utastérszűrő (pollenszűrő) cseréje munkadíj', net: 6562 }],
            atf: [{ label: 'Automataváltó teljes olajcsere géppel, olajszűrő-cserével munkadíj', net: 55118 },
                { label: 'Automataváltó olajszint-ellenőrzés, beállítás', net: 9843 }],
            fluid: [{ label: 'Fékfolyadék csere munkadíj és légtelenítés computerrel', net: 19685 },
                { label: 'Fékmérés fékpadon (javítás után)', net: 3281 }],
        },
        // A műhely olajai az ajánlataiból (eladási nettó literár, kedvezmény előtt).
        // own: a műhely saját ára; a többi a minta lista, "minta ár" jelöléssel.
        oils: [{ name: 'FUCHS TITAN GT1 FLEX 5 0W-20 (C5)', unitNet: 4622, own: true },
            { name: 'FUCHS TITAN SUPERSYN F ECO-DT 5W-30', unitNet: 3406, own: true },
            { name: 'FUCHS TITAN GT1 FLEX C23 5W-30', unitNet: 3263, own: true },
            ...SHOP.oils],
        brandsByPart: {
            'Timing Chain Kit': ['SKF', 'INA', 'SWAG'], 'Water Pump': ['SKF', 'INA'], 'Timing Belt Kit': ['SKF', 'INA', 'CONTITECH'],
            'Valve Cover Gasket': ['ELRING'], 'Oil Sump Gasket': ['ELRING'], 'Shaft Seal/Set': ['ELRING'],
            'Oil Filter': ['BOSCH', 'FILTRON', 'MANN-FILTER'], 'Air Filter': ['BOSCH', 'FILTRON', 'MANN-FILTER'],
            'Cabin Air Filter': ['FILTRON', 'BOSCH', 'MANN-FILTER'], 'V-Ribbed Belt Set': ['BOSCH', 'CONTITECH'],
            'Hydraulic Filter': ['PURFLUX', 'ZF', 'MANN-FILTER'], 'Compressor, air conditioning': ['BOSCH'],
            'Condenser, air conditioning': ['BOSCH'], 'Expansion Valve, air conditioning': ['BOSCH'],
        },
        // A műhely apró tételei (kulcs szerint felülírja az alapot).
        extrasOverride: {
            coolant: { label: 'Fagyálló G12+ (piros, -72) + ioncserélt víz', unitNet: 2140 },
            fluid: { label: 'Fékfolyadék DOT-4 LV', qty: 1, unitNet: 4009 },
            cleaner: { label: 'Féktisztító', unitNet: 2760 },
            washer: { label: 'Olajleeresztő csavar tömítéssel', unitNet: 1050 },
            // A műhely ajánlatain nincs fáradtolaj-kezelés sor: alapból kikapcsolva.
            waste: { on: false },
            atfoil: { label: 'Automataváltó-olaj (Fuchs TITAN ATF)', unitNet: 4566 },
            diffoil: { label: 'Differenciálmű-olaj (Fuchs TITAN Sintopoid LS 75W-90)', unitNet: 5255 },
            acgas: { label: 'Klíma hűtőközeg R134a', unitNet: 24 },
            acrefill: { label: 'Klíma hűtőközeg eltávolítás, visszatöltés munkadíj (R134a)', unitNet: 14173 },
            nitro: { label: 'Nitrogénes nyomáspróba munkadíj', unitNet: 11024 },
        },
        // Kísérőlevél: munkánként a műhely saját szövege.
        letter: {
            jobs: {
                belt: [DEPOSIT_150, QUALITY + ' A hosszbordás szíj cseréje szorosan nem tartozik a vezérműszíj cseréjéhez, de ajánlatba tettem, mert futásteljesítménye hasonló, és a javítás során egyébként is megbontjuk, így munkadíj-többletet nem jelent.'],
                chain: [DEPOSIT_150, QUALITY],
                clutch: [DEPOSIT_150,
                    'Az Ön járművét kettős tömegű lendkerékkel szerelték. Ha a lendkeréknek axiális vagy radiális holtjátéka nagyobb a megengedettnél, vagy megégett a súrlódó felület, az alkatrészt cserélni kell. Ha a lendkerék cseréjét a javítás során nem kéri, az abból adódó meghibásodásra (pl. a váltót szétrázza) és a későbbi javítás munkadíjára nem tudunk garanciát vállalni. Nem javaslom a kettős tömegű lendkerék egytömegűre cserélését, mert bár a beszerzési ára kedvező, nagymértékben csökkenti a sebességváltó élettartamát.',
                    QUALITY,
                    'Az ajánlatunk az alábbi tételeket nem tartalmazza: váltóolaj-csere, főtengely-szimering csere, féltengely-szimeringek cseréje. A kuplungjavításnak ezek nem feltételei, de javasoltak. Ha szeretné, jelezze, és kiegészítjük az ajánlatot. Ha ezeket nem cseréljük, a későbbi hibájukból adódó meghibásodást nem tudjuk garanciában intézni.'],
                atf: ['Az időpontfoglaláshoz bruttó 50 000 Ft foglalót kérünk, mert több ügyfél nem jelent meg a lefoglalt időpontban. Ha a megrendelés 24 órán belül kerül lemondásra, a foglalót nem áll módunkban visszaadni, kivéve vis maior esetén.',
                    'A járművel a javítás elején és végén próbakört megyünk, és a tisztítás során percekig forog a kerék, ezért 5–40 km többlet futásteljesítmény jelentkezhet. A gyári technológia határozza meg, milyen körülmények között állítható be az olajszint.'],
            },
            footer: ['Az anyagok a pillanatnyi készletből lettek kiválasztva. Ha hiány lépne fel, értékben és minőségben megegyező cikkel helyettesítjük. Ajánlatunk 15 munkanapig érvényes.',
                'Remélem, ajánlatunk elnyeri tetszését, és minket tisztel meg megrendelésével.'],
            signature: ['Üdvözlettel:', 'Mobilstar Autótechnikai Kft', '1108 Budapest, Újhegyi út 7.', 'Telefon: (+36-1) 412 0950', 'E-mail: ujhegyi@mobilstar.hu'],
        },
    },
};
// sampleRate: az óradíj minta (nincs a műhely saját adata) - a képernyőn jelöljük.
export const shopFor = (m) => {
    const p = PROFILES[String(m || '').toLowerCase()];
    const ov = p?.extrasOverride || {};
    // own: a műhely saját ára (csak ha a felülírás árat is ad, nem csak ki-be kapcsol).
    const jobExtras = Object.fromEntries(Object.entries(SHOP.jobExtras).map(([job, xs]) => [job, xs.map((x) => ({ ...x, ...(ov[x.key] || {}), own: ov[x.key]?.unitNet != null }))]));
    // Olajcsere: a műhely saját fix munkadíja (ha van), különben a MINTA.
    const oilLabour = p?.jobLabour?.oil?.[0];
    return { ...SHOP, ...(p || {}), jobExtras, brandsByPart: { ...SHOP.brandsByPart, ...(p?.brandsByPart || {}) },
        labour: oilLabour || SHOP.labour, ownLabour: !!oilLabour, ownOils: !!p?.oils,
        samplePrices: SAMPLE_PRICES, sampleRate: !p?.hourlyRate, ownExtras: !!p?.extrasOverride };
};
// A műhely márkasorrendje (a ?m= profil szerint) - ebből rendezi a szerver a cikkeket.
export const brandsForShop = (m) => { const s = shopFor(m); return (name) => s.brandsByPart[name] || s.preferredBrands; };
