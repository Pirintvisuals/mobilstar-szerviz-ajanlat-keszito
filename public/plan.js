// ---------------------------------------------------------------------------
//  Az ajánlat váza: a kiválasztott munkákból és a válaszokból mely
//  alkatrészek, apró tételek és munkadíjak kerülnek bele. Nincs benne DOM,
//  így a böngésző (app.js) és a visszamérés (backtest.mjs) ugyanazt rakja össze.
//  A munkák a szerver config-válaszából jönnek (lib/tecdoc.js jobsForClient).
// ---------------------------------------------------------------------------

// A munkák: a kiválasztottak, plusz amit egy válasz hoz magával (lánc után
// olajcsere). A behozott munka kérdéseit nem tesszük fel külön, és ha kis
// szerviz is van, az olajcserét nem hozzuk be, mert az már benne van.
export function activeJobs(all, sel, ans = []) {
    const byKey = (k) => all.find((j) => j.key === k);
    const out = sel.map(byKey).filter(Boolean);
    for (const x of ans) {
        const k = x.o.job;
        if (!k || out.some((j) => j.key === k) || (k === 'oil' && out.some((j) => j.key === 'service'))) continue;
        if (byKey(k)) out.push({ ...byKey(k), pulled: true });
    }
    return out;
}

// A kérdések, munkánként egyszer (azonos id csak egyszer).
export function checkList(jobs) {
    const seen = new Set(), out = [];
    for (const j of jobs) if (!j.pulled) for (const c of j.checks || []) {
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        out.push({ ...c, job: j.key });
    }
    return out;
}

export const answeredOf = (checks, answerOf) => checks.map((c) => ({ c, i: answerOf(c) }))
    .filter((x) => x.i != null && x.c.options[x.i]).map((x) => ({ ...x, o: x.c.options[x.i] }));

export const needsOil = (jobs) => jobs.some((j) => j.oil);

// Alkatrész-sorok. Féknél tengelyenként külön sor. Az olajszűrőt a szűrő-kártya
// intézi, ezért csak akkor jön ide, ha oilFilter igaz (nincs szűrőtábla-adat).
export function partList(jobs, ans, axles, { oilFilter = false } = {}) {
    const seen = new Set(), out = [];
    const without = new Set(ans.flatMap((x) => x.o.without || []));
    const sources = [...jobs.map((j) => ({ job: j.key, parts: j.parts })), ...ans.map((x) => ({ job: x.c.job, parts: x.o.parts || [] }))];
    for (const { job, parts } of sources) for (const p of parts) {
        if ((p.name === 'Oil Filter' && !oilFilter) || without.has(p.name)) continue;
        const variants = job === 'brake' ? axles.map((a) => ({ name: `${p.name}|${a}`, label: `${p.label} (${a})`, axle: a })) : [{ name: p.name, label: p.label }];
        for (const v of variants) {
            if (seen.has(v.name)) continue;
            seen.add(v.name);
            out.push({ ...v, base: p.name, job, qty: p.qty ?? 1 });
        }
    }
    return out;
}

// Apró tételek. Bekapcsolva: a szerelő pipája, különben a válasz, különben ha
// bármelyik munkánál alapból benne van (fékfolyadék-csere mint külön munka).
export function extrasList(shop, jobs, ans, extraOn = {}) {
    const fromAnswers = Object.assign({}, ...ans.map((x) => x.o.extras || {}));
    const byKey = new Map();
    for (const j of jobs) for (const x of shop?.jobExtras?.[j.key] || []) {
        const had = byKey.get(x.key);
        if (had) had.on = had.on || x.on;
        else byKey.set(x.key, { ...x });
    }
    return [...byKey.values()].map((x) => ({ ...x, on: extraOn[x.key] ?? fromAnswers[x.key] ?? x.on }));
}

// Munkadíj: a műhely fix díjas munkái külön sorban; a többi normaidő x óradíj.
export function labourOf(shop, jobs, ans, axleCount = 1) {
    const fixed = [], perAxle = (job) => (job === 'brake' ? axleCount : 1);
    let hours = 0;
    for (const j of jobs) {
        if (j.key === 'oil') fixed.push({ key: 'lab-oil', label: shop.labour.label, net: shop.labour.net, own: !!shop.ownLabour });
        else if (shop.jobLabour?.[j.key]) shop.jobLabour[j.key].forEach((f, i) => fixed.push({ key: `lab-${j.key}-${i}`, label: f.label, net: f.net, own: true }));
        else hours += (j.hours || 0) * perAxle(j.key);
    }
    for (const x of ans) hours += (x.o.hours || 0) * perAxle(x.c.job);
    return { fixed, hours: Math.max(0, Math.round(hours * 100) / 100) };
}
