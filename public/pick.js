// ---------------------------------------------------------------------------
//  Melyik alkatrész? Egy autóra gyakran több változat is illik (első/hátsó,
//  Brembo/ATE fék, 300/334 mm tárcsa). A rendszer csak azt kérdezi meg, ami
//  a jelöltek között tényleg különbözik, és a válaszok után a műhely első
//  márkájából ajánl. Böngészőben és a tesztben ugyanez fut.
// ---------------------------------------------------------------------------

// A TecDoc angolul adja a műszaki adatot; a gyakoriakat magyarul mutatjuk.
const SPEC_HU = [
    [/^fitting position/i, 'Beépítés'], [/^brake disc thickness/i, 'Vastagság'], [/^brake disc type/i, 'Típus'],
    [/^minimum thickness/i, 'Min. vastagság'], [/^outer diameter/i, 'Külső átmérő'], [/^inner diameter/i, 'Belső átmérő'],
    [/^diameter/i, 'Átmérő'], [/^height/i, 'Magasság'], [/^length/i, 'Hossz'], [/^width/i, 'Szélesség'], [/^thickness/i, 'Vastagság'],
    [/^filter type/i, 'Kivitel'], [/^number of teeth/i, 'Fogszám'], [/^number of ribs/i, 'Bordaszám'], [/^wear warning contact/i, 'Kopásjelző'],
    [/^thread size/i, 'Menet'], [/^supplementary article/i, 'Kiegészítő'], [/^for pulley/i, 'Tárcsához'],
    [/^brake system/i, 'Fékrendszer'], [/^manufacturer restriction/i, 'Csak ehhez'], [/^material/i, 'Anyag'],
];
const VAL_HU = [[/front axle/gi, 'első tengely'], [/rear axle/gi, 'hátsó tengely'], [/\bleft\b/gi, 'bal'], [/\bright\b/gi, 'jobb'],
    [/internally vented/gi, 'belső hűtésű'], [/perforated/gi, 'perforált'], [/slotted/gi, 'hornyolt'], [/\bcoated\b/gi, 'bevonatos'], [/\bvented\b/gi, 'hűtött'], [/\bsolid\b/gi, 'tömör'], [/filter insert/gi, 'betét'],
    [/screw-on filter/gi, 'csavaros'], [/prepared for wear warning indicator/gi, 'kopásjelzőre előkészítve'],
    [/excl\. wear warning contact/gi, 'kopásjelző nélkül'], [/incl\. wear warning contact/gi, 'kopásjelzővel']];

export const specLabel = (name) => SPEC_HU.find(([re]) => re.test(name))?.[1] || null;
export const isMm = (name) => /\[mm\]/.test(name);
export const huValue = (v) => VAL_HU.reduce((s, [re, hu]) => s.replace(re, hu), String(v));
export function specText(s) {
    return `${specLabel(s.name) || s.name.replace(/\s*\[.*\]/, '')}: ${huValue(s.value)}${isMm(s.name) ? ' mm' : ''}`;
}

// Ami a döntéshez kell, az elöl; ami csak zaj, az nem látszik.
const SPEC_ORDER = ['Beépítés', 'Fékrendszer', 'Csak ehhez', 'Külső átmérő', 'Átmérő', 'Vastagság', 'Típus', 'Kivitel', 'Fogszám', 'Bordaszám', 'Kopásjelző', 'Hossz', 'Szélesség', 'Magasság'];
const SPEC_NOISE = /^(test mark|brake lining|supplementary article|weight|packing|quantity|ean)/i;
export const specRank = (s) => { const i = SPEC_ORDER.indexOf(specLabel(s.name)); return i < 0 ? 99 : i; };
export const visibleSpecs = (specs = [], n = 6) => specs.filter((s) => !SPEC_NOISE.test(s.name)).sort((x, y) => specRank(x) - specRank(y)).slice(0, n);

// ---------- Kérdések ----------
// Csak olyan adatra kérdezünk, ami tényleg alkatrész-változatot jelent. A
// méreteknél a gyártók pár tizedet eltérnek ugyanarra a darabra: 3%-on belül
// egy válasznak számít.
// Sorrend = kérdezési sorrend: ami a legtöbbet dönt, az előbb.
const TEXT_Q = ['Beépítés', 'Fékrendszer', 'Csak ehhez'];
const NUM_Q = ['Külső átmérő', 'Átmérő', 'Vastagság', 'Fogszám', 'Bordaszám', 'Hossz'];
const LATE_Q = ['Kivitel', 'Típus'];
// Az első/hátsó adat sok cikknél hiányzik ebben a forrásban: már kevés adatból is kérdezünk.
const MIN_COVER = { 'Beépítés': 0.25 };
// Ugyanaz a gyártó több néven: az ATE a Continental Teves márkája.
const SAME_AS = [[/teves|\bate\b/i, 'ATE'], [/brembo/i, 'Brembo'], [/lucas|trw/i, 'TRW/Lucas'], [/bosch/i, 'Bosch'], [/akebono/i, 'Akebono']];
const QUESTION = {
    'Beépítés': 'Melyik tengelyre kell?',
    'Fékrendszer': 'Milyen gyártmányú fék (féknyereg) van az autón?',
    'Csak ehhez': 'Milyen fékrendszerhez kell?',
    'Külső átmérő': 'Mekkora a tárcsa átmérője? (első és hátsó tengelyen általában eltér)',
    'Átmérő': 'Mekkora az átmérője?',
    'Vastagság': 'Milyen vastag a tárcsa?',
    'Típus': 'Milyen típusú?',
    'Kivitel': 'Milyen kivitelű?',
    'Fogszám': 'Hány fogú a szíj?',
    'Bordaszám': 'Hány bordás a szíj?',
    'Hossz': 'Milyen hosszú?',
};
export const SHARED = ['Beépítés']; // egy munkán belül minden alkatrészre érvényes

const TOL = 0.03;
const num = (v) => parseFloat(String(v).replace(',', '.'));

// A cikk értéke egy kérdésre: szövegnél a szöveg, méretnél a szám.
function valueOf(a, label) {
    const specs = a.specs || [];
    // Tárcsánál csak a tárcsavastagság számít; a sima "Thickness" ott más méret.
    const s = label === 'Vastagság'
        ? specs.find((x) => /brake disc thickness/i.test(x.name)) || specs.find((x) => specLabel(x.name) === label && !specs.some((y) => /diameter/i.test(y.name)))
        : specs.find((x) => specLabel(x.name) === label);
    if (!s) return null;
    if (NUM_Q.includes(label)) { const n = num(s.value); return Number.isFinite(n) ? n : null; }
    const v = String(s.value).trim();
    if (label === 'Fékrendszer' || label === 'Csak ehhez') return SAME_AS.find(([re]) => re.test(v))?.[1] || v;
    return v;
}
const sameVal = (label, x, y) => NUM_Q.includes(label) ? Math.abs(x - y) <= TOL * Math.max(x, y) : x === y;

// Méretek csoportosítása: egymás után következők 3%-on belül egy csoport.
function groupValues(label, vals) {
    if (!NUM_Q.includes(label)) {
        const m = new Map();
        vals.forEach((v) => m.set(v, (m.get(v) || 0) + 1));
        return [...m].map(([value, count]) => ({ value, count }));
    }
    const sorted = [...vals].sort((a, b) => a - b), out = [];
    for (const v of sorted) {
        const last = out[out.length - 1];
        if (last && v - last.max <= TOL * v) { last.max = v; last.count++; last.sum += v; } else out.push({ min: v, max: v, count: 1, sum: v });
    }
    return out.map((g) => ({ value: Math.round((g.sum / g.count) * 10) / 10, count: g.count }));
}

// Melyik kérdésnek van értelme? A méretek közül a vastagság csak tárcsánál
// (a fékbetétek vastagsága gyártónként szór), a hossz csak szíjnál.
function allowed(label, pool) {
    if (label === 'Vastagság') return pool.some((a) => valueOf(a, 'Külső átmérő') != null || valueOf(a, 'Átmérő') != null);
    if (label === 'Hossz') return pool.some((a) => valueOf(a, 'Bordaszám') != null || valueOf(a, 'Fogszám') != null);
    return true;
}

export const matches = (a, label, answer) => {
    const v = valueOf(a, label);
    return v == null || sameVal(label, v, answer);
};

// articles: a csoport cikkei (specs, preferred, rank, name); main: a fő
// terméknév; answers: { címke: érték | null } (null = "nem tudom").
// Vissza: a következő kérdés (vagy null), a jelöltek és az ajánlott cikk.
export function analyze(articles, { main = null, answers = {} } = {}) {
    let pool = articles.map((a, i) => ({ a, i })).filter(({ a }) => !main || a.name === main);
    for (const [label, ans] of Object.entries(answers)) {
        if (ans == null) continue;
        const kept = pool.filter(({ a }) => matches(a, label, ans));
        if (kept.length) pool = kept;
    }
    // Kérdés a műhely márkái közül (ha van legalább kettő), különben mindből.
    const withSpecs = pool.filter(({ a }) => a.specs);
    const shop = withSpecs.filter(({ a }) => a.preferred);
    const base = (shop.length >= 2 ? shop : withSpecs).map(({ a }) => a);

    let question = null;
    for (const label of [...TEXT_Q, ...NUM_Q, ...LATE_Q]) {
        if (label in answers || !allowed(label, base)) continue;
        const vals = base.map((a) => valueOf(a, label)).filter((v) => v != null);
        if (vals.length < Math.max(2, base.length * (MIN_COVER[label] ?? 0.5))) continue;
        let options = groupValues(label, vals);
        // Egyetlen cikk furcsa értéke (elírás, más alkatrész) ne legyen külön válasz.
        if (options.length >= 3 || vals.length >= 5) options = options.filter((o) => o.count > 1);
        if (options.length < 2 || options.length > 5) continue;
        question = { label, text: QUESTION[label] || label, mm: NUM_Q.includes(label) && label !== 'Fogszám' && label !== 'Bordaszám',
            options: options.sort((x, y) => y.count - x.count) };
        break;
    }

    // Ajánlás: a válaszokhoz pontosan illő (van adata és egyezik) előre, aztán a műhely márkasorrendje.
    const exact = (a) => Object.entries(answers).every(([l, v]) => v == null || valueOf(a, l) != null);
    const ranked = [...pool].sort((x, y) => (exact(y.a) - exact(x.a)) || (x.a.rank - y.a.rank));
    const rec = ranked.find(({ a }) => a.preferred) || ranked[0] || null;
    const alternatives = ranked.filter((p) => p !== rec && p.a.preferred).slice(0, 4).map((p) => p.i);
    // Ugyanabból a márkából több cikkszám is illik, és a kérdések nem választják szét:
    // évjárat vagy motorváltozat szerint válik ketté, ezt a szerelő tudja.
    const twins = rec && !question ? pool.filter((p) => p !== rec && p.a.brand === rec.a.brand).map((p) => p.a.articleNo) : [];
    return { question, candidates: pool.map((p) => p.i), recommended: rec ? rec.i : null, alternatives, twins,
        unsure: Object.values(answers).some((v) => v == null) };
}

// Kérdés-válasz kiírása emberi nyelven.
export const answerText = (label, value, mm) => value == null ? 'nem tudom' : `${huValue(value)}${mm ? ' mm' : ''}`;
export const isMmLabel = (label) => NUM_Q.includes(label) && label !== 'Fogszám' && label !== 'Bordaszám';
