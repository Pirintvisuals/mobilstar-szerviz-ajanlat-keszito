// node backtest.mjs [esetfájl] - visszamérés a műhely valódi ajánlatain:
// ugyanarra a munkára és ugyanazokra a válaszokra mit rakna össze az app
// (public/plan.js, mint a böngészőben), mi hiányzik belőle, és hol más az összeg.
// Az esetek a private/ mappában vannak, nincsenek a gitben (a műhely árai).
// Az alkatrészek árát nem méri: az app ott még minta árat ad, amíg nincs beszállítói ár.
import fs from 'fs';
import { jobsForClient } from './lib/tecdoc.js';
import { shopFor } from './lib/shop.js';
import { activeJobs, checkList, answeredOf, needsOil, partList, extrasList, labourOf } from './public/plan.js';

const FILE = process.argv[2] || 'private/backtest-cases.json';
if (!fs.existsSync(FILE)) {
    console.log(`Nincs esetfájl (${FILE}). A valódi ajánlatok nincsenek a gitben - lásd a fájl elejét.`);
    process.exit(0);
}
const { shop: m, cases } = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const shop = shopFor(m);
const ALL = jobsForClient();
const ft = (n) => new Intl.NumberFormat('hu-HU').format(Math.round(n)) + ' Ft';

// Az app sorai erre az esetre, kulcs szerint (mint az app.js lines()).
function appQuote(c) {
    const checks = checkList(activeJobs(ALL, c.jobs));
    for (const id of Object.keys(c.answers)) if (!checks.some((ch) => ch.id === id)) throw new Error(`${c.id}: nincs ilyen kérdés: ${id}`);
    const answerOf = (ch) => {
        const a = c.answers[ch.id];
        if (a == null) return null;
        const i = ch.options.findIndex((o) => o.label === a);
        if (i < 0) throw new Error(`${c.id}: a(z) "${ch.id}" kérdésre nincs ilyen válasz: ${a}`);
        return i;
    };
    const ans = answeredOf(checks, answerOf);
    const jobs = activeJobs(ALL, c.jobs, ans);
    const axles = c.axles || ['első'];
    const lines = new Map();
    const add = (key, label, net = null) => lines.set(key, { key, label, net });
    if (needsOil(jobs)) { add('oil', 'Motorolaj'); add('filter', 'Olajszűrő'); }
    for (const p of partList(jobs, ans, axles)) add('p-' + p.name, p.label + (p.qty > 1 ? ` (${p.qty} db)` : ''));
    for (const x of extrasList(shop, jobs, ans)) if (x.on) add('x-' + x.key, x.label, x.qty * x.unitNet);
    const { fixed, hours } = labourOf(shop, jobs, ans, axles.length);
    for (const f of fixed) add(f.key, f.label, f.net);
    if (hours > 0) add('labour', `Munkadíj, ${String(hours).replace('.', ',')} óra`, hours * shop.hourlyRate);
    return { lines, open: checks.filter((ch) => answerOf(ch) == null).map((ch) => ch.text) };
}

let inScope = 0, covered = 0, moneyIn = 0, moneyCovered = 0, moneyAll = 0;
for (const c of cases) {
    const { lines, open } = appQuote(c);
    const groups = new Map();
    for (const r of c.real) {
        const g = groups.get(r.kind) || { kind: r.kind, labels: [], net: 0 };
        g.labels.push(r.label);
        g.net += r.net;
        groups.set(r.kind, g);
    }
    const total = c.real.reduce((s, r) => s + r.net, 0);
    moneyAll += total;
    console.log(`\n${c.car} - ${c.id} (${c.source}), valódi nettó ${ft(total)}`);
    for (const g of groups.values()) {
        const label = g.labels.join(' + ');
        if (g.kind === 'manual') { console.log(`  –  ${label}: az app nem ismeri ezt a munkát (kézi sor)`); continue; }
        inScope++;
        moneyIn += g.net;
        if (g.kind === 'letter') { covered++; console.log(`  ✓  ${label}: a kísérőlevélben`); continue; }
        const a = lines.get(g.kind);
        if (!a) { console.log(`  ✗  ${label} (${ft(g.net)}): HIÁNYZIK az app ajánlatából`); continue; }
        covered++;
        moneyCovered += g.net;
        const diff = a.net != null && Math.abs(a.net - g.net) > Math.max(2, g.net * 0.01) ? `  ← app: ${ft(a.net)}, valódi: ${ft(g.net)}` : '';
        console.log(`  ✓  ${label}${diff}`);
    }
    const kinds = new Set(groups.keys());
    for (const l of lines.values()) if (!kinds.has(l.key)) console.log(`  +  az appban van, a valódin nincs: ${l.label}${l.net ? ` (${ft(l.net)})` : ''}`);
    if (open.length) console.log(`  ?  megválaszolatlan kérdés: ${open.join(' · ')}`);
}
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0) + '%';
console.log(`\nÖsszesen: ${covered}/${inScope} tétel megvan (${pct(covered, inScope)}), az összeg ${pct(moneyCovered, moneyIn)}-a.`);
console.log(`Az app munkáin kívül esik (kézi sor): ${ft(moneyAll - moneyIn)} a ${ft(moneyAll)}-ból.`);
