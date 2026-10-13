// ---------------------------------------------------------------------------
//  TecDoc-adat: alvázszám -> autó -> munka -> illő alkatrészek, és gyári
//  cikkszám -> utángyártott megfelelők.
//
//  FORRÁS MOST: a RapidAPI "Auto Parts Catalog" (nem hivatalos TecDoc-másolat,
//  a saját leírása szerint csak fejlesztésre / tesztre). Fizető ügyfél ezzel
//  nem mehet élesbe: élesben ugyanezek a függvények a licencelt TecDoc Web
//  Service-ből olvasnak, az app többi része nem változik.
//
//  A kulcs csak a szerveren van (RAPIDAPI_KEY). Minden választ elmentünk,
//  mert a havi keret kicsi: ugyanaz a kérés másodszor nem fogy.
// ---------------------------------------------------------------------------

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const HOST = 'auto-parts-catalog.p.rapidapi.com';
const TYPE_ID = 1;   // személyautó
const LANG_ID = 4;   // angol - a kategórianevek ezen a nyelven jönnek
const COUNTRY_ID = 63;
const SPEC_BATCH = 40; // ennyi cikk műszaki adata jön le egy kérésben
const CACHE_DIR = process.env.VERCEL
    ? '/tmp/tecdoc-cache'
    : path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.tecdoc-cache');

// A demóautó (Mercedes SL 500, jármű 9433) elmentett válaszai a repóban: a
// Verceles /tmp minden hidegindításkor üres, így a bemutató sosem fogyaszt keretet.
const DEMO_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'tecdoc-demo');
export const DEMO_VEHICLE = { vehicleId: 9433, name: 'MERCEDES-BENZ SL (R129) 500 (129.068)' };

const memory = new Map();
const status = { calls: 0, remaining: null };

export const tecdocConfigured = () => !!process.env.RAPIDAPI_KEY;
export const tecdocStatus = () => ({ configured: tecdocConfigured(), ...status });

// body: csak a POST-os kérésekhez (pl. több cikk adatai egyben).
async function get(route, body = null) {
    const url = `https://${HOST}${route}`;
    const payload = body ? JSON.stringify(body) : '';
    const id = url + payload;
    if (memory.has(id)) return memory.get(id);
    const name = crypto.createHash('md5').update(id).digest('hex') + '.json';
    const file = path.join(CACHE_DIR, name);
    for (const f of [file, path.join(DEMO_DIR, name)]) {
        try {
            const cached = JSON.parse(fs.readFileSync(f, 'utf8'));
            memory.set(id, cached);
            return cached;
        } catch (error) { /* nincs még elmentve */ }
    }

    if (!tecdocConfigured()) throw new Error('A TecDoc-teszt nincs beállítva (RAPIDAPI_KEY).');
    status.calls++;
    const headers = { 'x-rapidapi-host': HOST, 'x-rapidapi-key': process.env.RAPIDAPI_KEY };
    if (body) headers['Content-Type'] = 'application/json';
    const res = await fetch(url, {
        method: body ? 'POST' : 'GET', headers, body: body ? payload : undefined,
        signal: AbortSignal.timeout(90_000),
    });
    const left = res.headers.get('x-ratelimit-requests-remaining');
    if (left != null) status.remaining = Number(left);
    if (res.status === 429) throw new Error('Elfogyott a havi TecDoc-tesztkeret.');
    if (!res.ok) throw new Error(`TecDoc hiba (${res.status})`);
    const data = await res.json();
    memory.set(id, data);
    try {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
        fs.writeFileSync(file, JSON.stringify(data));
    } catch (error) { /* csak olvasható fájlrendszer: marad a memóriában */ }
    return data;
}

// ---------- Munkák: magyar név -> TecDoc kategóriák ----------
// A TecDoc-fában ugyanaz a név több ágon is előfordul; a "parent" mondja
// meg, melyiket választjuk. A munkaóra MINTA - a szerelő átírja.
// oil: true = a munkához motorolaj is kell (Fuchs olajválasztó).
//
// checks: amit az alkatrész-adat nem tud eldönteni, csak a munkafelvevő, mert
// az autón kell megnézni vagy az ügyféllel megbeszélni (kettőstömegű
// lendkerék, vízpumpa, kopásjelző). Ezektől ugrik az ár 200 ezerről 300-ra,
// ezért a munka elején kérdezzük, nem utólag. Opciónként:
//   parts   - ezek az alkatrész-csoportok kerülnek az ajánlatba (TecDoc-ból)
//   without - a munka ezen alkatrészei kimaradnak (pl. "csak betét")
//   extras  - a mellé járó tételek ki-be kapcsolása (lib/shop.js jobExtras)
//   hours   - ennyivel változik a munkaidő
//   job     - ez a munka is kell hozzá (lánc után olajcsere)
//   note    - figyelmeztetés a munkafelvevőnek (az ajánlat alatt)
// auto: a jármű adatlapjából magától megválaszolható (dízel/benzin, 4x4);
//   { field, rules: [[regex, opció]] } - a munkafelvevő átírhatja.
// perCylinder: a darabszám a hengerek száma (gyertya, izzító).
const P = {
    oilFilter: { label: 'Olajszűrő', name: 'Oil Filter', parent: 'Filters' },
    airFilter: { label: 'Levegőszűrő', name: 'Air Filter', parent: 'Filters' },
    cabinFilter: { label: 'Pollenszűrő', name: 'Cabin Air Filter', parent: 'Filters' },
    fuelFilter: { label: 'Üzemanyagszűrő', name: 'Fuel Filter', parent: 'Filters' },
    filterHousing: { label: 'Olajszűrőház-tömítés', name: 'Oil Filter Housing/Seal', parent: 'Engine' },
    sumpGasket: { label: 'Olajteknő-tömítés', name: 'Oil Sump Gasket', parent: 'Engine' },
    sparkPlug: { label: 'Gyújtógyertya', name: 'Spark Plug', parent: 'Spark/Glow Ignition', perCylinder: true },
    glowPlug: { label: 'Izzítógyertya', name: 'Glow Plug', parent: 'Spark/Glow Ignition', perCylinder: true },
    wiper: { label: 'Ablaktörlő lapát', name: 'Wiper Blade/-Rubber', parent: 'Window Cleaning', qty: 2 },
    beltKit: { label: 'Vezérműszíj-készlet', name: 'Timing Belt Kit', parent: 'Belt Drive' },
    waterPump: { label: 'Vízpumpa', name: 'Water Pump', parent: 'Cooling System' },
    thermostat: { label: 'Termosztát', name: 'Thermostat', parent: 'Cooling System' },
    ribbedBelt: { label: 'Hosszbordás szíj', name: 'V-Ribbed Belt Set', parent: 'Belt Drive' },
    auxTensioner: { label: 'Hosszbordás szíj feszítő', name: 'Belt Tensioner (Tensioner Unit)', parent: 'Belt Drive' },
    shaftSeal: { label: 'Szimering', name: 'Shaft Seal/Set', parent: 'Engine' },
    engineMount: { label: 'Motortartó bak', name: 'Engine Mounting', parent: 'Engine' },
    chainKit: { label: 'Vezérműlánc-készlet', name: 'Timing Chain Kit', parent: 'Engine' },
    valveCover: { label: 'Szelepfedél-tömítés', name: 'Valve Cover Gasket', parent: 'Engine' },
    pad: { label: 'Fékbetét', name: 'Brake Pad', parent: 'Braking System' },
    disc: { label: 'Féktárcsa', name: 'Brake Disc', parent: 'Braking System', qty: 2 },
    wear: { label: 'Kopásjelző', name: 'Wear Indicator', parent: 'Braking System' },
    caliper: { label: 'Féknyereg', name: 'Brake Caliper', parent: 'Braking System' },
    brakeHose: { label: 'Fékcső (gumi)', name: 'Brake Hoses', parent: 'Braking System', qty: 2 },
    clutchKit: { label: 'Kuplungszett', name: 'Clutch Kit', parent: 'Clutch/Attachment Parts' },
    flywheel: { label: 'Kettőstömegű lendkerék', name: 'Flywheel', parent: 'Clutch/Attachment Parts' },
    csc: { label: 'Központi kinyomó', name: 'Central Slave Cylinder', parent: 'Clutch/Attachment Parts' },
    slaveCyl: { label: 'Kuplung munkahenger', name: 'Slave Cylinder', parent: 'Clutch/Attachment Parts' },
    masterCyl: { label: 'Kuplung főhenger', name: 'Master Cylinder', parent: 'Clutch/Attachment Parts' },
    gearMount: { label: 'Váltótartó gumibak', name: 'Transmission Mounting', parent: 'Transmission' },
    shock: { label: 'Lengéscsillapító', name: 'Shock Absorber', parent: 'Suspension/Damping', qty: 2 },
    strutMount: { label: 'Toronycsapágy', name: 'Suspension Strut/Shock Absorber Mount', parent: 'Suspension/Damping', qty: 2 },
    spring: { label: 'Rugó', name: 'Coil Springs', parent: 'Suspension/Damping' },
    battery: { label: 'Akkumulátor', name: 'Battery', parent: 'Electrics' },
};
const YES = 'Igen', NO = 'Nem';
const DIESEL = { field: 'fuel', rules: [['diesel', 0], ['petrol|benzin', 1]] };

export const JOBS = [
    { key: 'oil', label: 'Olajcsere', hours: 0.5, oil: true, parts: [P.oilFilter], checks: [
        { id: 'use', text: 'Hogyan használják az autót?', why: 'A Fuchs több olajat is jóváhagyhat. Sok km vagy olajfogyasztás: inkább sűrűbb (pl. 5W-40). Rövid utak, hideg indítás: inkább hígabb (0W-30).',
            options: [{ label: 'Átlagos' }, { label: 'Sok km / eszi az olajat', note: 'Olaj: a jóváhagyottak közül a sűrűbbet válaszd (pl. 5W-40).' },
                { label: 'Rövid utak, hideg indítás', note: 'Olaj: a jóváhagyottak közül a hígabbat válaszd (pl. 0W-30).' }] },
        { id: 'filters', text: 'Levegő- és pollenszűrő is?', why: 'Olajcserénél a legtöbbször ezt is felajánlják.',
            options: [{ label: 'Mindkettő', parts: [P.airFilter, P.cabinFilter], hours: 0.3 }, { label: 'Csak levegőszűrő', parts: [P.airFilter], hours: 0.1 },
                { label: 'Csak pollenszűrő', parts: [P.cabinFilter], hours: 0.2 }, { label: 'Egyik sem' }] },
        { id: 'leak', text: 'Olajos alul a motor?', why: 'Ha a szűrőháztól vagy a teknőtől folyik, most kell megcsinálni, mert az új olaj is elfolyik.',
            options: [{ label: 'Szűrőház szivárog', parts: [P.filterHousing], hours: 0.7 }, { label: 'Olajteknő szivárog', parts: [P.sumpGasket], hours: 1.5 }, { label: 'Nem olajos' }] },
        { id: 'reset', text: 'Szervizintervallum nullázás kell?', why: 'Újabb autókon csak diagnosztikával.',
            options: [{ label: YES, hours: 0.2 }, { label: NO }] }] },
    { key: 'service', label: 'Kis szerviz (olaj + szűrők)', hours: 1, oil: true, parts: [P.oilFilter, P.airFilter, P.cabinFilter], checks: [
        { id: 'fuel', text: 'Üzemanyagszűrő is?', why: 'Dízelen szinte mindig. Sok benzinesen a tankban van, ott nem szokás cserélni.', auto: DIESEL,
            options: [{ label: YES, parts: [P.fuelFilter], hours: 0.3 }, { label: NO }] },
        { id: 'plug', text: 'Gyújtógyertya is?', why: 'Benzinesnél. A darabszám a hengerek száma.', auto: { field: 'fuel', rules: [['petrol|benzin', 0], ['diesel', 1]] },
            options: [{ label: YES, parts: [P.sparkPlug], hours: 0.4 }, { label: 'Nem / dízel' }] },
        { id: 'belt', text: 'Repedezett a hosszbordás szíj?', why: 'Nézd meg a hornyok oldalát. Ha szakad, a vízpumpa és a generátor is leáll.',
            options: [{ label: 'Szíj csere', parts: [P.ribbedBelt], hours: 0.4 }, { label: 'Szíj + feszítő', parts: [P.ribbedBelt, P.auxTensioner], hours: 0.7 }, { label: 'Jó' }] },
        { id: 'fluid', text: 'Fékfolyadék-csere is?', why: 'Kétévente esedékes. A szervizkönyvben vagy a tartály matricáján látszik, mikor volt.',
            options: [{ label: YES, extras: { fluid: true }, hours: 0.5 }, { label: NO, extras: { fluid: false } }] },
        { id: 'wiper', text: 'Ablaktörlő lapát?', why: 'Ha csíkoz vagy szakadt.',
            options: [{ label: 'Elöl', parts: [P.wiper] }, { label: NO }] },
        { id: 'reset', text: 'Szervizintervallum nullázás kell?', why: 'Újabb autókon csak diagnosztikával.',
            options: [{ label: YES, hours: 0.2 }, { label: NO }] }] },
    { key: 'belt', label: 'Vezérműszíj-csere', hours: 3, parts: [P.beltKit], checks: [
        { id: 'pump', text: 'Vízpumpa is cserélődik?', why: 'Ha a vezérműszíj hajtja, ugyanazzal a szétszereléssel cserélik. Utólag dupla munka.',
            options: [{ label: YES, parts: [P.waterPump], extras: { coolant: true } }, { label: NO, extras: { coolant: false } }] },
        { id: 'thermo', text: 'Termosztát is?', why: 'A hűtőfolyadék úgyis le van engedve. Ha lassan melegszik a motor, ez a hibás.',
            options: [{ label: YES, parts: [P.thermostat], hours: 0.3, extras: { coolant: true } }, { label: NO }] },
        { id: 'aux', text: 'Hosszbordás szíj is?', why: 'A vezérléshez úgyis le kell venni.',
            options: [{ label: 'Szíj', parts: [P.ribbedBelt] }, { label: 'Szíj + feszítő', parts: [P.ribbedBelt, P.auxTensioner], hours: 0.3 }, { label: NO }] },
        { id: 'seal', text: 'Olajos a vezérlés környéke?', why: 'Ha a szimering szivárog, most kell cserélni, különben az új szíj is olajos lesz.',
            options: [{ label: 'Szimering csere', parts: [P.shaftSeal], hours: 0.5 }, { label: 'Nem olajos' }] },
        { id: 'mount', text: 'Szakadt a motortartó bak?', why: 'Sok autón a vezérléshez ki kell venni. Ha szakadt, most olcsóbb cserélni.',
            options: [{ label: 'Csere', parts: [P.engineMount], hours: 0.3 }, { label: 'Jó' }] }] },
    { key: 'chain', label: 'Vezérműlánc-csere', hours: 6, parts: [P.chainKit], checks: [
        { id: 'cover', text: 'Szelepfedél-tömítés is?', why: 'Sok motoron a lánchoz le kell venni a szelepfedelet, és a régi tömítés nem tömít újra.',
            options: [{ label: YES, parts: [P.valveCover] }, { label: NO }] },
        { id: 'pump', text: 'Vízpumpa is?', why: 'Ha a lánc hajtja vagy útban van, ugyanazzal a munkával cserélik.',
            options: [{ label: YES, parts: [P.waterPump], extras: { coolant: true } }, { label: NO }] },
        { id: 'seal', text: 'Olajos a vezérlés fedele?', why: 'A főtengely első szimeringje ilyenkor olcsón cserélhető.',
            options: [{ label: 'Szimering csere', parts: [P.shaftSeal], hours: 0.3 }, { label: 'Nem olajos' }] },
        { id: 'aux', text: 'Hosszbordás szíj is?', why: 'Úgyis le kell venni.',
            options: [{ label: YES, parts: [P.ribbedBelt] }, { label: NO }] },
        { id: 'oil', text: 'Olajcsere is?', why: 'Lánccsere után az olajat is cserélni kell.',
            options: [{ label: YES, job: 'oil' }, { label: 'Nem (nemrég volt)' }] }] },
    { key: 'brake', label: 'Fékbetét + féktárcsa', hours: 1.5, parts: [P.pad, P.disc], checks: [
        { id: 'scope', text: 'Mit cserélünk?', why: 'Ha a tárcsa még a minimum vastagság fölött van és nem barázdás, maradhat.',
            options: [{ label: 'Betét + tárcsa' }, { label: 'Csak betét', without: ['Brake Disc'], hours: -0.7 }] },
        { id: 'wear', text: 'Van külön kopásjelző, és cserélni kell?', why: 'Márkánként más: van, ahol a betétben van, van, ahol külön kábel. Ha világít a lámpa, cserélni kell.',
            options: [{ label: YES, parts: [P.wear] }, { label: NO }] },
        { id: 'caliper', text: 'Szorul a féknyereg, vagy szakadt a porvédője?', why: 'Szoruló nyeregnél az egyik oldali betét jobban kopik, és a kerék melegszik.',
            options: [{ label: 'Nyereg csere', parts: [P.caliper], hours: 0.7, extras: { fluid: true } }, { label: 'Rendben' }] },
        { id: 'hose', text: 'Repedt a fékcső (gumi)?', why: '',
            options: [{ label: 'Csere', parts: [P.brakeHose], hours: 0.5, extras: { fluid: true } }, { label: 'Rendben' }] },
        { id: 'fluid', text: 'Fékfolyadék-csere is?', why: 'Kétévente esedékes. Nyereg- vagy csőcserénél úgyis légteleníteni kell.',
            options: [{ label: YES, extras: { fluid: true }, hours: 0.5 }, { label: NO, extras: { fluid: false } }] },
        { id: 'epb', text: 'Hátul elektromos kézifék van?', why: 'Csak diagnosztikával tehető szervizállásba: több idő.',
            options: [{ label: YES, hours: 0.3 }, { label: 'Nem / első tengely' }] }] },
    { key: 'clutch', label: 'Kuplungcsere', hours: 4, parts: [P.clutchKit], checks: [
        { id: 'dmf', text: 'Kettőstömegű lendkerék: cserélni kell?', why: 'Ettől lesz egy kuplungcsere 200 ezer helyett 300. Ha zörög, rángat vagy nagy a holtjátéka, kell. Kopott lendkerékkel az új kuplung sem tart.',
            options: [{ label: 'Igen, csere', parts: [P.flywheel], hours: 0.5 }, { label: 'Van, de jó' }, { label: 'Merev lendkerék' }] },
        { id: 'csc', text: 'Hidraulikus központi kinyomó van (a váltóban)?', why: 'Sok mai autón a kinyomócsapágy és a munkahenger egy darab. Ha ez van, kuplungcserekor szinte mindig vele cserélik.',
            options: [{ label: YES, parts: [P.csc], extras: { fluid: true } }, { label: 'Nem, hagyományos' }] },
        { id: 'hydr', text: 'Szivárog a kuplung fő- vagy munkahengere?', why: 'Ha lent marad a pedál vagy fogy a folyadék.',
            options: [{ label: 'Munkahenger', parts: [P.slaveCyl], hours: 0.5, extras: { fluid: true } }, { label: 'Főhenger', parts: [P.masterCyl], hours: 1, extras: { fluid: true } }, { label: 'Rendben' }] },
        { id: 'rms', text: 'Olajos a váltóharang (főtengely hátsó szimering)?', why: 'Ha a szimering ereszt, az új kuplung is olajos lesz. Most csak az alkatrész ára.',
            options: [{ label: 'Szimering csere', parts: [P.shaftSeal], hours: 0.5 }, { label: 'Nem olajos' }] },
        { id: 'mount', text: 'Szakadt a váltótartó gumibak?', why: 'A váltó úgyis lent van.',
            options: [{ label: 'Csere', parts: [P.gearMount], hours: 0.3 }, { label: 'Jó' }] },
        { id: 'awd', text: 'Összkerékhajtású?', why: 'A kardán és az osztómű miatt jóval több munka.', auto: { field: 'drive', rules: [['all|4wd|four', 0], ['front|rear', 1]] },
            options: [{ label: YES, hours: 2 }, { label: NO }] },
        { id: 'gearoil', text: 'Váltóolaj csere is?', why: 'Ha úgyis le van engedve, csak az olaj ára.',
            options: [{ label: YES, extras: { gearoil: true } }, { label: NO, extras: { gearoil: false } }] }] },
    { key: 'shocks', label: 'Lengéscsillapító', hours: 2, parts: [P.shock], checks: [
        { id: 'mount', text: 'Toronycsapágy is?', why: 'Ha kopog vagy zörög kormányzáskor, most kell, mert ugyanígy szét kell szedni.',
            options: [{ label: YES, parts: [P.strutMount], hours: 0.5 }, { label: NO }] },
        { id: 'spring', text: 'Törött a rugó?', why: 'A rugó vége gyakran a tányérnál törik. Párban cseréld.',
            options: [{ label: 'Egy oldal', parts: [P.spring], hours: 0.3 }, { label: 'Mindkét oldal', parts: [{ ...P.spring, qty: 2 }], hours: 0.5 }, { label: 'Ép' }] },
        { id: 'align', text: 'Futómű-beállítás utána?', why: 'Első tengelyen szinte mindig kell.',
            options: [{ label: YES, extras: { align: true } }, { label: NO, extras: { align: false } }] }] },
    { key: 'battery', label: 'Akkumulátorcsere', hours: 0.3, parts: [P.battery], checks: [
        { id: 'ss', text: 'Start-stop van az autóban?', why: 'Start-stophoz AGM vagy EFB akku kell. Sima savas akku pár hónap alatt tönkremegy benne.',
            options: [{ label: YES, note: 'Akku: AGM vagy EFB kell (start-stop).' }, { label: NO }] },
        { id: 'code', text: 'Kell az akkut regisztrálni / kódolni?', why: 'BMW, VAG, Mercedes újabb típusainál a töltésvezérlő csak így tudja, hogy új az akku.',
            options: [{ label: YES, hours: 0.3 }, { label: NO }] },
        { id: 'place', text: 'Hol van az akku?', why: 'Csomagtartóban vagy ülés alatt több idő.',
            options: [{ label: 'Motortérben' }, { label: 'Csomagtartó / ülés alatt', hours: 0.3 }] }] },
    { key: 'glow', label: 'Izzítógyertya-csere', hours: 1, parts: [P.glowPlug], checks: [
        { id: 'stuck', text: 'Beragadhat a gyertya?', why: 'Régi, sok km-es dízelnél a gyertya beéghet, és kifúrni kell. Ezt előre mondd meg az ügyfélnek.',
            options: [{ label: 'Lehet (sok km)', hours: 1, note: 'Izzító: beragadt gyertya esetén a kifúrás külön munka, előre egyeztesd.' }, { label: 'Nem valószínű' }] }] },
];

// A munka egy kérdésének egy válasza (a böngésző csak a sorszámokat küldi).
export function checkOption(jobKey, checkId, opt) {
    const c = JOBS.find((j) => j.key === jobKey)?.checks.find((x) => x.id === checkId);
    const o = c?.options[Number(opt)];
    if (!o) throw new Error('Ismeretlen kérdés');
    return o;
}

// ---------- Tiszta függvények (tesztelhetők hálózat nélkül) ----------

// VIN-válasz -> autók listája.
export function vehiclesFromVin(data) {
    const d = data?.data || {};
    const out = (d.matchingVehicles?.array || []).map((v) => ({
        vehicleId: v.vehicleId, modelId: v.modelId, name: v.carName || v.vehicleTypeDescription || String(v.vehicleId),
    }));
    const models = (d.matchingModels?.array || []).map((m) => ({ modelId: m.modelId, name: m.modelName }));
    const make = d.matchingManufacturers?.array?.[0]?.manuName || null;
    return { vehicles: out, models, make };
}

// A jármű adatlapja: motorkód, teljesítmény, évjárat, üzemanyag. Ebből
// keressük meg magától a Fuchs-motort, és ezt veti össze a munkafelvevő a
// forgalmival.
export function detailsFrom(data) {
    const d = data?.vehicleTypeDetails;
    if (!d) return null;
    const n = (x) => { const v = parseFloat(x); return Number.isFinite(v) ? v : null; };
    const year = (x) => (x ? Number(String(x).slice(0, 4)) || null : null);
    return {
        make: d.manufacturerName || '', model: d.modelType || '', type: d.typeEngineName || '',
        engineCodes: String(d.engCodes || '').split(/[,;]+/).map((c) => c.trim()).filter(Boolean),
        powerKw: n(d.powerKw), powerPs: n(d.powerPs), ccm: n(d.capacityTech) || n(d.capacityTax),
        fuel: d.fuelType || '', from: year(d.constructionIntervalStart), to: year(d.constructionIntervalEnd),
        cylinders: n(d.numberOfCylinders), body: d.bodyType || '', drive: d.driveType || '',
    };
}

// A lapos kategórialista (level + categoryName1..4) -> { név, id, szülő }.
export function flattenCategories(data) {
    return (data?.categories || []).map((c) => ({
        id: c[`categoryId${c.level}`], name: c[`categoryName${c.level}`], parent: c.categoryName1,
    })).filter((c) => c.id && c.name);
}

// Pontos névegyezés, a kért szülőág előnyben; ha nincs, "tartalmazza".
export function findCategory(cats, { name, parent }) {
    const n = name.toLowerCase();
    const exact = cats.filter((c) => c.name.toLowerCase() === n);
    return exact.find((c) => c.parent === parent) || exact[0]
        || cats.find((c) => c.name.toLowerCase().includes(n)) || null;
}

const normNo = (s) => String(s || '').toUpperCase().replace(/[\s.\-/]/g, '');

// Cikkek -> egyedi márka+cikkszám lista, a műhely márkái előre.
export function tidyArticles(list, brands = []) {
    const pref = brands.map((b) => b.toUpperCase());
    const seen = new Set(), out = [];
    for (const a of list || []) {
        const brand = a.supplierName, no = a.articleNo;
        if (!brand || !no) continue;
        const k = brand + '|' + no;
        if (seen.has(k)) continue;
        seen.add(k);
        const rank = pref.indexOf(brand.toUpperCase());
        out.push({ brand, articleNo: no, name: a.articleProductName || '', articleId: a.articleId || null, img: a.s3image || null, preferred: rank >= 0, rank: rank >= 0 ? rank : 999 });
    }
    return out.sort((a, b) => a.rank - b.rank || a.brand.localeCompare(b.brand) || a.articleNo.localeCompare(b.articleNo));
}

// Műszaki adatok (egy kérésben sok cikkre) -> a cikkekre ráírva. A beépítési
// hely (első/hátsó tengely) külön mezőt kap, mert fékeknél ez az első kérdés.
export function attachSpecs(articles, data) {
    const byId = new Map((data?.articles || []).map((a) => [a.articleId, a.allSpecifications || []]));
    for (const a of articles) {
        const specs = byId.get(a.articleId);
        if (!specs) continue;
        a.specs = specs.map((s) => ({ name: s.criteriaName, value: s.criteriaValue })).filter((s) => s.name && s.value != null);
        const pos = a.specs.find((s) => /fitting position/i.test(s.name));
        if (pos) a.position = /front/i.test(pos.value) ? 'front' : /rear/i.test(pos.value) ? 'rear' : null;
    }
    return articles;
}

// A gyári-szám keresés minden gyártó számát visszaadja: csak azok maradnak,
// amelyek tényleg erre a gyári számra hivatkoznak.
export function tidyOem(data, oem, brands = []) {
    const want = normNo(oem);
    const rows = (data?.articles || []).filter((a) => normNo(a.crossNumber) === want);
    const oemMaker = rows[0]?.crossManufacturerName || null;
    return { oemMaker, articles: tidyArticles(rows, brands) };
}

// ---------- Hálózati hívások ----------

export async function vinLookup(vin) {
    const v = String(vin || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (v.length !== 17) throw new Error('Az alvázszám 17 karakter.');
    return vehiclesFromVin(await get(`/vin/tecdoc-vin-check/${v}`));
}

export async function vehicleDetails(vehicleId) {
    return detailsFrom(await get(`/types/type-id/${TYPE_ID}/vehicle-type-details/${Number(vehicleId)}/lang-id/${LANG_ID}/country-filter-id/${COUNTRY_ID}`));
}

// Egy alkatrész-csoport az autóra: illő cikkek, a műhely márkái elöl, műszaki adattal.
// brandsFor(tecdocNév) -> a műhely márkái erre az alkatrészre, sorrendben.
async function partFor(vehicleId, p, brandsFor) {
    const cats = flattenCategories(await get(`/category/type-id/${TYPE_ID}/products-groups-variant-1/${Number(vehicleId)}/lang-id/${LANG_ID}`));
    const cat = findCategory(cats, p);
    if (!cat) return { ...p, category: null, articles: [] };
    const data = await get(`/articles/list/type-id/${TYPE_ID}/vehicle-id/${Number(vehicleId)}/category-id/${cat.id}/lang-id/${LANG_ID}`);
    const articles = tidyArticles(data?.articles, brandsFor(p.name));
    // Műszaki adat a lista elejére (a műhely márkái állnak elöl): egy kérés.
    const ids = articles.slice(0, SPEC_BATCH).map((a) => a.articleId).filter(Boolean);
    if (ids.length) {
        try {
            attachSpecs(articles, await get('/articles/get-article-specifications-list-of-articles-ids', { articleIds: ids, langId: LANG_ID, countryFilterId: COUNTRY_ID }));
        } catch (error) { /* adat nélkül is megy */ }
    }
    return { ...p, category: cat, articles };
}

export async function partsForJob(vehicleId, jobKey, brandsFor) {
    const job = JOBS.find((j) => j.key === jobKey);
    if (!job) throw new Error('Ismeretlen munka');
    const parts = [];
    for (const p of job.parts) parts.push(await partFor(vehicleId, p, brandsFor));
    return { job: { key: job.key, label: job.label, hours: job.hours }, parts };
}

// Egy kérdésre adott válasz alkatrészei (pl. "kettőstömegű: igen" -> lendkerék).
export async function partsForCheck(vehicleId, jobKey, checkId, opt, brandsFor) {
    const parts = [];
    for (const p of checkOption(jobKey, checkId, opt).parts || []) parts.push(await partFor(vehicleId, p, brandsFor));
    return { parts };
}

export async function oemLookup(oem, brands) {
    const clean = String(oem || '').trim();
    if (normNo(clean).length < 4) throw new Error('Adj meg egy gyári cikkszámot.');
    return tidyOem(await get(`/artlookup/search-for-analogue-of-spare-parts-by-oem-number/article-oem-no/${encodeURIComponent(clean)}`), clean, brands);
}
