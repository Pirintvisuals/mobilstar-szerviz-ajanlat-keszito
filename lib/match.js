// ---------------------------------------------------------------------------
//  Alvázszámból kiválasztott autó -> a Fuchs olajválasztó motorja.
//
//  A TecDoc adatlapja megadja a motorkódot, a kW-ot, az évjáratot és az
//  üzemanyagot; a Fuchs keresője ugyanezeket adja minden találatnál. Ha a
//  motorkód és a kW is egyezik, magától választunk, és ezt ki is írjuk. Ha
//  nem egyértelmű, sorba rakjuk a jelölteket, és a munkafelvevő bök rá.
//  Hálózat nélkül fut (a teszt is ezt hívja).
// ---------------------------------------------------------------------------

const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const codesOf = (s) => (Array.isArray(s) ? s : String(s || '').split(/[,;/]+/)).map((c) => c.trim()).filter(Boolean);

// 'exact' | 'family' | null. A Fuchs kis x-szel jelöli a "bármi" számjegyet
// (M273.96x); a családtalálat a rövidebb kód eleje (M119 ~ M 119.982).
export function codeMatch(carCode, fuchsCode) {
    const a = norm(carCode);
    const raw = String(fuchsCode || '').trim();
    const wild = /x+$/.test(raw) ? raw.match(/x+$/)[0].length : 0;
    const b = norm(raw);
    if (!a || !b) return null;
    if (a === b) return 'exact';
    if (wild && a.length === b.length && a.startsWith(b.slice(0, -wild))) return 'exact';
    if ((a.length >= 3 && b.startsWith(a)) || (b.length >= 3 && a.startsWith(b))) return 'family';
    // Csak az utolsó 1-2 jel más (M113.961 ~ M113.963, CAYC ~ CAYB): rokon motor, nem ugyanaz.
    let i = 0;
    while (i < a.length && a[i] === b[i]) i++;
    if (a.length === b.length && i >= 3 && i >= a.length - 2) return 'family';
    return null;
}

const FUEL = [[/diesel|dízel/i, 'diesel'], [/petrol|benzin|gasoline/i, 'petrol'], [/electric|elektromos/i, 'ev'], [/lpg|cng|gas\b/i, 'gas']];
const fuelOf = (s) => FUEL.find(([re]) => re.test(String(s || '')))?.[1] || null;
const firstWord = (s) => norm(String(s || '').split(/[\s(-]/)[0]);
// Fuchs-típusnévben olyan szó, ami más hajtást/kivitelt jelent, mint amit a TecDoc-név mond.
const VARIANT = /\b(4X4|4MOTION|QUATTRO|XDRIVE|4MATIC|GREENLINE|BLUEMOTION|ECOMOTIVE|HYBRID|PHEV)\b/gi;

// car: lib/tecdoc.js detailsFrom() + name (a TecDoc autóneve).
export function scoreFuchs(car, r) {
    const why = [];
    let score = 0;
    if (car.make && r.make && firstWord(car.make) !== firstWord(r.make)) score -= 200;
    if (/usa|can\b/i.test(r.make || '')) score -= 10;

    const fuchsCodes = codesOf(r.engineCode);
    const hits = (car.engineCodes || []).flatMap((c) => fuchsCodes.map((f) => codeMatch(c, f))).filter(Boolean);
    if (hits.includes('exact')) { score += 100; why.push('motorkód egyezik'); }
    else if (hits.includes('family')) { score += 40; why.push('motorcsalád egyezik'); }
    else if (car.engineCodes?.length && fuchsCodes.length) { score -= 60; why.push('más motorkód'); }

    const kw = parseFloat(r.powerKw);
    if (car.powerKw && Number.isFinite(kw)) {
        const d = Math.abs(car.powerKw - kw);
        if (d <= 2) { score += 30; why.push(`${kw} kW`); }
        else if (d > 5) { score -= 50; why.push(`más teljesítmény (${kw} kW)`); }
    }
    const cf = fuelOf(car.fuel), rf = fuelOf(r.fuel);
    if (cf && rf) score += cf === rf ? 10 : -100;

    if (car.from && r.yearStart) {
        const carTo = car.to || 9999, rTo = r.yearEnd || 9999;
        if (r.yearStart <= carTo && car.from <= rTo) score += 15;
        else { score -= 30; why.push('más évjárat'); }
    }
    // Döntetlennél: a típusnév szavai. A Fuchs-név olyan kivitele (4x4,
    // Greenline), amit a TecDoc-név nem mond, inkább nem az.
    const carWords = new Set(String(`${car.name || ''} ${car.model} ${car.type}`).toUpperCase().split(/[^A-Z0-9.]+/).filter((w) => w.length > 1));
    for (const w of String(`${r.model} ${r.type}`).toUpperCase().split(/[^A-Z0-9.]+/)) if (w.length > 1 && carWords.has(w)) score += 2;
    for (const v of String(r.type || '').match(VARIANT) || []) if (!carWords.has(v.toUpperCase())) score -= 5;
    return { score, why };
}

// -> { ranked: [{...r, score, why}], auto: típusId-k listája, amelyek közül
// bármelyik jó (a legjobb pontszámúak), vagy üres, ha nem egyértelmű }.
// Magától csak akkor választunk, ha a motorkód pontosan egyezik, és a kW
// sem mond ellent (vagy nincs kW-adat).
export function matchFuchs(car, results) {
    const seen = new Set();
    const ranked = (results || []).filter((r) => !seen.has(r.typeId) && seen.add(r.typeId))
        .map((r) => ({ ...r, ...scoreFuchs(car, r) }))
        .sort((x, y) => y.score - x.score);
    const top = ranked[0];
    const sure = top && top.why.includes('motorkód egyezik') && !top.why.some((w) => /^más /.test(w)) && top.score >= 100;
    const auto = sure ? ranked.filter((r) => r.score === top.score).map((r) => r.typeId) : [];
    return { ranked: ranked.slice(0, 8), auto };
}

// Két Fuchs-ajánlás ugyanaz-e (ugyanazok az olajok, ugyanannyi liter)?
// Ha a döntetlen jelöltek mind ugyanazt adják, mindegy, melyiket választjuk.
export const sameOil = (a, b) => !!a && !!b && a.capacityL === b.capacityL
    && a.oils.map((o) => o.code).join() === b.oils.map((o) => o.code).join();
