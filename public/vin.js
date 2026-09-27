// ---------------------------------------------------------------------------
//  Alvázszám (VIN): gyártó az első 3 karakterből (WMI), évjárat a 10.-ből -
//  de az évjáratot csak ott mondjuk meg, ahol a gyártó tényleg oda kódolja.
//  Az európai gyártóknak ez nem kötelező (pl. a franciáknál ott más áll), és
//  egy rossz évjárat rosszabb, mint semmi.
// ---------------------------------------------------------------------------

export const cleanVin = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// 17 karakter, I, O és Q nélkül.
export const vinLooksValid = (s) => /^[A-HJ-NPR-Z0-9]{17}$/.test(cleanVin(s));

// Hosszabb előtag előre: a 'WVW' fontosabb, mint a 'WV'.
const MAKES = [
    ['WVW', 'Volkswagen'], ['WV1', 'Volkswagen'], ['WV2', 'Volkswagen'], ['WV3', 'Volkswagen'],
    ['WAU', 'Audi'], ['WUA', 'Audi'], ['TRU', 'Audi'],
    ['TMB', 'Skoda'], ['VSS', 'Seat'], ['VS6', 'Ford'],
    ['WBA', 'BMW'], ['WBS', 'BMW'], ['WMW', 'Mini'],
    ['WDD', 'Mercedes-Benz'], ['WDB', 'Mercedes-Benz'], ['WDC', 'Mercedes-Benz'], ['W1K', 'Mercedes-Benz'], ['W1N', 'Mercedes-Benz'], ['WDF', 'Mercedes-Benz'], ['W1V', 'Mercedes-Benz'],
    ['W0L', 'Opel'], ['W0V', 'Opel'], ['VXK', 'Opel'],
    ['WF0', 'Ford'], ['WP0', 'Porsche'],
    ['VF1', 'Renault'], ['VF3', 'Peugeot'], ['VF7', 'Citroen'], ['VR3', 'Peugeot'], ['VR7', 'Citroen'], ['UU1', 'Dacia'],
    ['ZFA', 'Fiat'], ['ZAR', 'Alfa Romeo'],
    ['TSM', 'Suzuki'], ['JS2', 'Suzuki'], ['JSA', 'Suzuki'],
    ['JT', 'Toyota'], ['SB1', 'Toyota'], ['NMT', 'Toyota'], ['VNK', 'Toyota'],
    ['JHM', 'Honda'], ['SHH', 'Honda'], ['SHS', 'Honda'],
    ['JMZ', 'Mazda'], ['JN1', 'Nissan'], ['SJN', 'Nissan'], ['VSK', 'Nissan'], ['JMB', 'Mitsubishi'],
    ['KMH', 'Hyundai'], ['TMA', 'Hyundai'], ['NLH', 'Hyundai'], ['KNA', 'Kia'], ['KNE', 'Kia'], ['U5Y', 'Kia'], ['U6Y', 'Kia'],
    ['YV1', 'Volvo'], ['YS3', 'Saab'], ['SAL', 'Land Rover'], ['SAJ', 'Jaguar'],
    ['LSJ', 'MG'], ['LRW', 'Tesla'], ['5YJ', 'Tesla'],
];

export function vinMake(s) {
    const v = cleanVin(s);
    const hit = MAKES.find(([p]) => v.startsWith(p));
    return hit ? hit[1] : null;
}

// Ezek a gyártók a 10. karakterbe az évjáratot teszik.
const YEAR_RELIABLE = ['Volkswagen', 'Audi', 'Skoda', 'Seat', 'Hyundai', 'Kia', 'Honda', 'Tesla'];
const YEAR_CHARS = 'ABCDEFGHJKLMNPRSTVWXY123456789'; // A=1980 (és 2010), 30 éves ciklus

export function vinYear(s, now = new Date()) {
    const v = cleanVin(s);
    if (!vinLooksValid(v)) return null;
    const make = vinMake(v);
    // Az észak-amerikai gyártású autóknál (1, 4, 5) kötelező.
    if (!YEAR_RELIABLE.includes(make) && !/^[145]/.test(v)) return null;
    const i = YEAR_CHARS.indexOf(v[9]);
    if (i < 0) return null;
    // A két lehetséges év közül a legkésőbbi, ami még nem jövőbeli (+1 modellév).
    let year = 1980 + i;
    while (year + 30 <= now.getFullYear() + 1) year += 30;
    return year;
}
