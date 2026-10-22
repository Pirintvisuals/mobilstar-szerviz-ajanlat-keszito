// ---------------------------------------------------------------------------
//  Új ajánlat, TecDoc és Fuchs nélkül:
//    autó (márka, típus, motor) + motorkód -> munka (egy vagy több).
//    Olajcserénél (és kis szerviznél): olajszűrő a MANN-táblából, a változatok
//    közül a gyártás hónapja szerint választva -> a műhely saját márkája (ha
//    egyszer megadták) -> az olaj és a mennyiség, amit erre a motorra legutóbb
//    választottak. A többi munkánál az alkatrészt egyszer kell beírni erre a
//    motorra, utána magától jön. Apró tételek és munkadíj munkánként (a műhely
//    fix díja vagy normaidő x óradíj) -> ajánlat kedvezménnyel, PDF a műhely
//    kísérőlevelével. Amit a munkafelvevő egyszer megad, azt megjegyezzük.
//    Az árat mindig a kód számolja, sosem az AI.
// ---------------------------------------------------------------------------
import { apiFetch } from './auth.js';
import { huf } from './quote.js';
import { cleanVin, vinLooksValid, vinMake, vinYear } from './vin.js';
import { letterParts, letterText, printQuoteHtml, fmtQty } from './print.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const M = new URLSearchParams(location.search).get('m') || '';
const api = async (params, body) => {
    const res = body
        ? await apiFetch('/api/olajcsere', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        : await apiFetch('/api/olajcsere?' + new URLSearchParams(params));
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || 'HTTP ' + res.status);
    return json;
};
const post = (body) => api(null, body).catch(() => null); // tanulás: ha nem sikerül, az ajánlat attól még megy
const parseNum = (s) => {
    const n = parseFloat(String(s).replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : null;
};
// Ugyanaz a kulcs, mint a szerveren (lib/store.js priceKey).
const normCode = (s) => String(s || '').toUpperCase().replace(/[\s.\-/]/g, '');
const priceKey = (brand, articleNo) => `${String(brand || '').toUpperCase()}|${normCode(articleNo)}`;
const OIL = 'OIL';

const fresh = () => ({ eng: null, engKey: null, filterSel: null, useOwn: true, oil: '', liters: null, oilTouched: false,
    sel: [], partEdits: {}, manual: [], hours: null,
    extraOn: {}, prices: {}, qty: {}, disc: {}, quoteNo: null, t0: null, doneIn: null, localFilter: null });
const st = { shop: null, cars: [], jobs: [], ...fresh() };

// ---------- Indulás ----------
Promise.all([
    api({ action: 'config', m: M }),
    fetch('/cars.json').then((r) => r.json()).catch(() => ({ makes: [] })),
]).then(([{ shop, jobs }, cars]) => {
    st.shop = shop;
    st.jobs = jobs || [];
    st.cars = cars.makes || [];
    $('shop-name').textContent = `${shop.name} · árajánlat`;
    $('dl-makes').innerHTML = st.cars.map((m) => `<option value="${esc(m.make)}">`).join('');
    $('dl-oils').innerHTML = (shop.oils || []).map((o) => `<option value="${esc(o.name)}">`).join('');
    $('dl-fbrands').innerHTML = (shop.brandsByPart?.['Oil Filter'] || []).map((b) => `<option value="${esc(b)}">`).join('');
    renderJobs();
}).catch((e) => { $('quote-empty').textContent = e.message; });

const val = (id) => $(id).value.trim();
const startClock = () => { if (!st.t0) st.t0 = performance.now(); };
const carName = () => [val('oc-make'), val('oc-model'), val('oc-engine')].filter(Boolean).join(' ');

// ---------- Autó ----------
// Ékezet és kis-nagybetű nélkül: "skoda" = "Škoda", "citroen" = "Citroën".
const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const findMake = () => st.cars.find((m) => fold(m.make) === fold(val('oc-make')));
const findModel = () => findMake()?.models.find((m) => fold(m.name) === fold(val('oc-model')));
function fillLists() {
    $('dl-models').innerHTML = (findMake()?.models || []).map((m) => `<option value="${esc(m.name)}">`).join('');
    $('dl-engines').innerHTML = (findModel()?.engines || []).map((e) => `<option value="${esc(e)}">`).join('');
}

let loadTimer = null;
['oc-make', 'oc-model', 'oc-engine', 'oc-code', 'oc-when'].forEach((id) => $(id).addEventListener('input', () => {
    startClock();
    fillLists();
    clearTimeout(loadTimer);
    loadTimer = setTimeout(load, 350);
}));

$('vin').addEventListener('input', () => {
    startClock();
    const v = cleanVin($('vin').value);
    const hint = $('vin-hint');
    if (!v) { hint.textContent = ''; render(); return; }
    if (!vinLooksValid(v)) { hint.textContent = `${v.length}/17 karakter`; return; }
    const make = vinMake(v), year = vinYear(v);
    hint.innerHTML = [make && `<b>${esc(make)}</b>`, year && `${year}-es évjárat`].filter(Boolean).join(' · ') || 'Érvényes alvázszám';
    if (make && !val('oc-make')) { $('oc-make').value = make; fillLists(); }
    if (year && !val('oc-when')) $('oc-when').value = String(year);
    load();
});

let seq = 0;
async function load() {
    const code = val('oc-code'), car = carName();
    if (!code && !(val('oc-make') && val('oc-model'))) { st.eng = null; renderAll(); return; }
    const my = ++seq;
    let eng;
    try {
        eng = await api({ action: 'oc-engine', code, car, when: val('oc-when'), m: M });
    } catch (e) {
        if (my === seq) { $('filter-src').textContent = e.message; }
        return;
    }
    if (my !== seq) return;
    const key = normCode(code) || 'C|' + normCode(car);
    if (key !== st.engKey) {
        // Másik motor: a szűrő-választás és az olaj ennek a motornak a megjegyzett adatából indul.
        st.engKey = key;
        st.filterSel = null;
        st.useOwn = true;
        st.localFilter = null;
        st.oilTouched = false;
        st.partEdits = {};
        delete st.prices.filter; delete st.prices.oil;
        for (const k of Object.keys(st.prices)) if (k.startsWith('p-')) delete st.prices[k];
    }
    st.eng = eng;
    if (!st.oilTouched) {
        st.oil = eng.oil?.oil || '';
        st.liters = eng.oil?.liters ?? null;
        $('oc-oil').value = st.oil;
        $('liters').value = st.liters != null ? fmtQty(st.liters) : '';
    }
    renderAll();
}

// ---------- Munka ----------
const selJobs = () => st.sel.map((k) => st.jobs.find((j) => j.key === k)).filter(Boolean);
const hasOil = () => selJobs().some((j) => j.oil);
function renderJobs() {
    $('jobs').innerHTML = st.jobs.map((j) => `<button class="chip${st.sel.includes(j.key) ? ' on' : ''}" type="button" data-job="${esc(j.key)}" aria-pressed="${st.sel.includes(j.key)}">
        <span class="ct">${esc(j.label)}</span><span class="m">${esc(j.parts.map((p) => p.label).join(', ') || 'munkadíj')}</span></button>`).join('');
}
$('jobs').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-job]');
    if (!b) return;
    startClock();
    const k = b.dataset.job;
    if (st.sel.includes(k)) st.sel = st.sel.filter((x) => x !== k);
    else {
        // A kis szerviz tartalmazza az olajcserét: a kettő közül egyszerre csak az egyik.
        if (k === 'oil') st.sel = st.sel.filter((x) => x !== 'service');
        if (k === 'service') st.sel = st.sel.filter((x) => x !== 'oil');
        st.sel = [...st.sel, k];
    }
    st.hours = null;
    renderJobs();
    renderAll();
});

// ---------- Alkatrészek a többi munkához ----------
//  Az olajszűrőt a szűrő-kártya intézi; a többi alkatrész itt: márka, cikkszám,
//  mennyiség. Motorkódonként megjegyezzük (lib/store.js parts).
function partList() {
    const seen = new Set(), out = [];
    for (const j of selJobs()) for (const p of j.parts) {
        if (p.name === 'Oil Filter' || seen.has(p.name)) continue;
        seen.add(p.name);
        out.push({ ...p, job: j.key });
    }
    return out;
}
const partData = (name) => st.partEdits[name] ?? st.eng?.parts?.[name] ?? {};
function renderParts() {
    const list = partList();
    $('card-parts').hidden = !st.eng || (!list.length && !st.manual.length && !st.sel.length);
    if ($('card-parts').hidden) return;
    const rows = list.map((p, i) => {
        const d = partData(p.name);
        const brands = st.shop.brandsByPart?.[p.name] || st.shop.preferredBrands || [];
        return `<div class="prow" data-part="${esc(p.name)}">
            <div class="lab">${esc(p.label)}${st.eng?.parts?.[p.name] && !st.partEdits[p.name] ? ' <span class="badge">megjegyezve</span>' : ''}</div>
            <div class="row3">
              <div><input class="inp" data-f="brand" list="dl-pb-${i}" value="${esc(d.brand || '')}" placeholder="márka" aria-label="${esc(p.label)} márka"><datalist id="dl-pb-${i}">${brands.map((b) => `<option value="${esc(b)}">`).join('')}</datalist></div>
              <div><input class="inp mono" data-f="cikkszam" value="${esc(d.cikkszam || '')}" placeholder="cikkszám" aria-label="${esc(p.label)} cikkszám"></div>
              <div class="unit-inp"><input class="inp num" data-f="qty" inputmode="decimal" value="${esc(fmtQty(d.qty ?? 1))}" aria-label="${esc(p.label)} mennyiség"><span>db</span></div>
            </div></div>`;
    });
    const manual = st.manual.map((m) => `<div class="prow" data-man="${esc(m.id)}">
            <div class="row3">
              <div><input class="inp" data-f="label" value="${esc(m.label)}" placeholder="megnevezés" aria-label="Tétel megnevezése"></div>
              <div><input class="inp mono" data-f="cikkszam" value="${esc(m.cikkszam)}" placeholder="cikkszám (nem kötelező)" aria-label="Tétel cikkszáma"></div>
              <div class="unit-inp"><input class="inp num" data-f="qty" inputmode="decimal" value="${esc(fmtQty(m.qty))}" aria-label="Tétel mennyisége"><span>db</span> <button class="linkbtn" type="button" data-rm="${esc(m.id)}" aria-label="Törlés">✕</button></div>
            </div></div>`);
    $('parts').innerHTML = rows.join('') + manual.join('')
        || '<p class="hint">Ehhez a munkához nincs külön alkatrész. Ha kell, add hozzá lent.</p>';
}
let partTimer = {};
$('parts').addEventListener('input', (ev) => {
    const f = ev.target.dataset.f;
    if (!f) return;
    const row = ev.target.closest('.prow');
    if (row.dataset.man) {
        const m = st.manual.find((x) => x.id === row.dataset.man);
        if (f === 'qty') { const n = parseNum(ev.target.value); m.qty = n > 0 ? n : 1; } else m[f] = ev.target.value.trim();
        render();
        return;
    }
    const name = row.dataset.part;
    const d = { ...partData(name) };
    if (f === 'qty') { const n = parseNum(ev.target.value); d.qty = n > 0 && n < 100 ? n : 1; } else d[f] = ev.target.value.trim();
    st.partEdits[name] = d;
    delete st.prices['p-' + name];
    render();
    clearTimeout(partTimer[name]);
    partTimer[name] = setTimeout(() => {
        post({ action: 'oc-part', engineCode: val('oc-code'), car: carName(), part: name, ...d });
        if (d.brand && d.cikkszam) oilPriceFor(null, d.brand, d.cikkszam);
    }, 700);
});
$('parts').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-rm]');
    if (!b) return;
    st.manual = st.manual.filter((m) => m.id !== b.dataset.rm);
    delete st.prices['m-' + b.dataset.rm];
    renderParts(); render();
});
$('add-line').addEventListener('click', () => {
    st.manual.push({ id: String(Date.now()), label: '', cikkszam: '', qty: 1 });
    renderParts();
    $('parts').querySelector('.prow:last-child [data-f="label"]')?.focus();
});

// ---------- Olajszűrő ----------
function filterChoice() {
    const f = st.eng?.filter;
    if (!f) return null;
    if (f.kind === 'none') return st.localFilter;
    const idx = st.filterSel ?? f.auto ?? (f.kind === 'date' ? null : 0);
    if (idx == null) return null;
    const base = f.options[idx];
    const own = st.eng.xrefs?.[priceKey(base.brand, base.cikkszam)] || null;
    const pick = own && st.useOwn ? own : base;
    return { ...pick, base, own, idx };
}

function renderFilter() {
    const f = hasOil() ? st.eng?.filter : null;
    $('card-filter').hidden = !f;
    if (!f) return;
    const ch = filterChoice();
    const code = val('oc-code');
    $('filter-src').textContent = f.kind === 'none' ? '' : f.learned ? 'műhely adta meg' : `MANN katalógus · ${f.family ? `motorcsalád: ${f.family}` : `motorkód: ${f.code}`}`;

    if (f.kind === 'none') {
        $('filter-opts').innerHTML = ch
            ? `<div class="found"><span class="code">${esc(ch.cikkszam)}</span><span class="m">${esc(ch.brand || '')} · csak erre az ajánlatra</span></div>` : '';
        $('filter-own').innerHTML = '';
        $('filter-why').innerHTML = code
            ? `Ehhez a motorkódhoz (<b class="mono">${esc(code)}</b>) még nincs szűrő a táblában. Add meg egyszer, és minden ${esc(code)} motoros autónál magától jön.`
            : 'Motorkód nélkül a szűrőt nem tudom kikeresni. Írd be a motorkódot, vagy add meg a szűrőt kézzel erre az ajánlatra.';
        $('filter-form').hidden = false;
        return;
    }
    $('filter-form').hidden = true;

    const many = f.options.length > 1;
    const head = f.kind === 'date' && f.auto == null && st.filterSel == null
        ? `<div class="warn">Ennél a motornál a szűrő a gyártás idejétől függ. Írd be fent a gyártás hónapját (pl. 2014-03), vagy válaszd ki:</div>`
        : f.kind === 'check' && st.filterSel == null
            ? `<div class="warn">Ennél a motornál a szűrő ${f.options.some((o) => /más autónál/.test(o.cond)) ? 'autótól' : 'a szűrőháztól vagy a motorszámtól'} függ. Nézd meg, melyik illik:</div>`
            : f.family ? `<div class="warn">Pontos motorkód nincs a táblában, a motorcsalád (${esc(f.family)}) alapján hozom. Ellenőrizd a cikkszámot.</div>` : '';
    // Egy szűrő + megadott saját márka: a lenti választó már mindkettőt mutatja.
    $('filter-opts').innerHTML = !many && ch?.own ? head : head + f.options.map((o, i) => {
        const on = ch && ch.idx === i;
        const why = on && f.auto === i && st.filterSel == null ? '<span class="badge">gyártás alapján</span>' : '';
        return `<label class="oil"><input type="radio" name="filter" value="${i}" ${on ? 'checked' : ''} ${many ? '' : 'hidden'}>
            <span class="t"><span class="mono">${esc(o.cikkszam)}</span> · ${esc(o.brand)}${why}</span>
            ${o.cond ? `<span class="m">${esc(o.cond)}</span>` : ''}</label>`;
    }).join('');

    // A műhely saját márkája ugyanerre a szűrőre (pl. Bosch a MANN helyett).
    if (!ch) { $('filter-own').innerHTML = ''; return; }
    const brands = (st.shop.brandsByPart?.['Oil Filter'] || []).filter((b) => normCode(b) !== normCode(ch.base.brand));
    if (ch.own) {
        $('filter-own').innerHTML = `<div class="oils own">
            <label class="oil"><input type="radio" name="own" value="1" ${st.useOwn ? 'checked' : ''}><span class="t"><span class="mono">${esc(ch.own.cikkszam)}</span> · ${esc(ch.own.brand)} <span class="badge">a ti márkátok</span></span></label>
            <label class="oil"><input type="radio" name="own" value="0" ${st.useOwn ? '' : 'checked'}><span class="t"><span class="mono">${esc(ch.base.cikkszam)}</span> · ${esc(ch.base.brand)}</span></label>
            <button class="linkbtn" type="button" id="own-edit">Másik megfelelő</button></div>`;
        $('own-edit').onclick = () => showOwnForm(ch, brands);
    } else if (brands.length) {
        $('filter-own').innerHTML = `<p class="hint">Ha ${esc(brands.join(' / '))} szűrőt tesztek be: <button class="linkbtn" type="button" id="own-add">add meg egyszer a ${esc(ch.base.cikkszam)} megfelelőjét →</button></p>`;
        $('own-add').onclick = () => showOwnForm(ch, brands);
    } else $('filter-own').innerHTML = '';
}

function showOwnForm(ch, brands) {
    $('filter-own').innerHTML = `<form id="own-form" class="filter-form">
        <p class="hint">A <b class="mono">${esc(ch.base.cikkszam)}</b> (${esc(ch.base.brand)}) megfelelője a ti márkátokban. Egyszer kell megadni, utána minden autónál ez jön, ahol ez a szűrő kell.</p>
        <div class="row">
          <div><label class="lbl" for="own-brand">Márka</label><select id="own-brand" class="inp">${brands.map((b) => `<option ${ch.own?.brand === b ? 'selected' : ''}>${esc(b)}</option>`).join('')}</select></div>
          <div><label class="lbl" for="own-code">Cikkszám</label><input id="own-code" class="inp mono" maxlength="40" value="${esc(ch.own?.cikkszam || '')}" placeholder="pl. F 026 407 ..."></div>
        </div>
        <button class="btn" type="submit">Megjegyzem</button> <button class="btn ghost" type="button" id="own-cancel">Mégse</button></form>`;
    $('own-code').focus();
    $('own-cancel').onclick = () => renderFilter();
    $('own-form').onsubmit = async (ev) => {
        ev.preventDefault();
        const to = { brand: $('own-brand').value, cikkszam: $('own-code').value.trim() };
        if (!to.cikkszam) return;
        await post({ action: 'oc-xref', from: { brand: ch.base.brand, cikkszam: ch.base.cikkszam }, to });
        st.useOwn = true;
        delete st.prices.filter;
        await load();
    };
}

$('filter-opts').addEventListener('change', (ev) => {
    if (ev.target.name !== 'filter') return;
    st.filterSel = Number(ev.target.value);
    delete st.prices.filter;
    renderFilter(); render();
});
$('filter-own').addEventListener('change', (ev) => {
    if (ev.target.name !== 'own') return;
    st.useOwn = ev.target.value === '1';
    delete st.prices.filter;
    render();
});
$('filter-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const entry = { cikkszam: $('f-code').value.trim(), brand: $('f-brand').value.trim() };
    if (!entry.cikkszam) return;
    const code = val('oc-code');
    if (code) {
        await post({ action: 'filter', engineCode: code, ...entry, source: 'szerelő adta meg' });
        await load();
    } else {
        st.localFilter = { ...entry, base: entry, own: null, idx: 0 };
        renderAll();
    }
});

// ---------- Olaj ----------
let learnTimer = null;
function learnOil() {
    clearTimeout(learnTimer);
    learnTimer = setTimeout(() => {
        if (!st.oil || !(st.liters > 0)) return;
        post({ action: 'oc-learn', engineCode: val('oc-code'), car: carName(), oil: st.oil, liters: st.liters });
    }, 600);
}
async function oilPriceFor(name, brand, articleNo) {
    const k = name ? priceKey(OIL, name) : priceKey(brand, articleNo);
    if (!(name || articleNo) || st.eng?.prices?.[k] != null || (name && (st.shop.oils || []).some((o) => o.name === name))) return;
    const r = await api({ action: 'price', key: k }).catch(() => null);
    if (r?.net != null && st.eng) { st.eng.prices[k] = r.net; render(); }
}
$('oc-oil').addEventListener('input', () => {
    st.oil = val('oc-oil'); st.oilTouched = true;
    delete st.prices.oil;
    render(); learnOil(); oilPriceFor(st.oil);
});
$('liters').addEventListener('input', () => {
    const n = parseNum($('liters').value);
    st.liters = n != null && n > 0 && n < 50 ? n : null;
    st.oilTouched = true;
    render(); learnOil();
});
function renderOil() {
    $('card-oil').hidden = !st.eng || !hasOil();
    const m = st.eng?.oil;
    $('oil-memo').innerHTML = m
        ? `Erre a motorra legutóbb: <b>${esc(m.oil)}</b>, ${esc(fmtQty(m.liters))} l.`
        : 'Ehhez a motorhoz még nincs megjegyzett olaj: válaszd ki egyszer.';
}

// ---------- Apró tételek ----------
const extrasList = () => {
    const seen = new Set(), out = [];
    for (const j of st.sel) for (const x of st.shop?.jobExtras?.[j] || []) if (!seen.has(x.key)) { seen.add(x.key); out.push({ ...x, on: st.extraOn[x.key] ?? x.on }); }
    return out;
};
function renderExtras() {
    $('card-extras').hidden = !st.eng || !extrasList().length;
    $('extras').innerHTML = extrasList().map((x) => `<label class="oil"><input type="checkbox" data-x="${esc(x.key)}" ${x.on ? 'checked' : ''}>
        <span class="t">${esc(x.label)}</span><span class="m">${esc(fmtQty(x.qty))} ${esc(x.unit)} · ${huf(x.unitNet)}${x.own ? '' : ' · minta'}</span></label>`).join('');
}
$('extras').addEventListener('change', (ev) => {
    const k = ev.target.dataset.x;
    if (!k) return;
    st.extraOn[k] = ev.target.checked;
    render();
});

// ---------- Ajánlat ----------
function lines() {
    const out = [];
    const sh = st.shop, eng = st.eng;
    if (!eng || !st.sel.length) return out;
    const oilJob = hasOil();
    if (oilJob && st.oil) {
        const k = priceKey(OIL, st.oil);
        const learned = eng.prices?.[k];
        const listed = (sh.oils || []).find((o) => o.name === st.oil);
        out.push({ key: 'oil', label: st.oil, cikkszam: '', qty: st.liters ?? 0, unit: 'l', auto: learned ?? listed?.unitNet ?? null,
            source: learned != null ? 'legutóbbi ár' : listed ? (sh.ownOils ? 'a műhely olajlistája' : null) : null,
            live: learned == null && listed && !sh.ownOils ? 'minta ár · írd át egyszer, megjegyzi' : null,
            priceKey: { brand: OIL, articleNo: st.oil }, missingQty: !(st.liters > 0) });
    }
    const ch = oilJob ? filterChoice() : null;
    if (!oilJob) { /* nincs olajos munka */ } else if (ch) {
        const learned = eng.prices?.[priceKey(ch.brand, ch.cikkszam)];
        const sample = sh.samplePrices?.['Oil Filter'] ?? null;
        out.push({ key: 'filter', label: `Olajszűrő, ${ch.brand || 'márka?'}`, cikkszam: ch.cikkszam, qty: 1, unit: 'db', auto: learned ?? sample,
            source: learned != null ? 'legutóbbi ár' : null, live: learned == null ? 'minta ár · írd át egyszer, megjegyzi' : null,
            priceKey: { brand: ch.brand, articleNo: ch.cikkszam } });
    } else {
        out.push({ key: 'filter', label: 'Olajszűrő', cikkszam: '', qty: 1, unit: 'db', auto: null, open: true });
    }
    for (const p of partList()) {
        const d = partData(p.name);
        const has = d.brand || d.cikkszam;
        const learned = has ? eng.prices?.[priceKey(d.brand, d.cikkszam)] : null;
        const sample = sh.samplePrices?.[p.name] ?? null;
        out.push({ key: 'p-' + p.name, label: `${p.label}${d.brand ? ', ' + d.brand : ''}`, cikkszam: d.cikkszam || '', qty: d.qty ?? 1, unit: 'db',
            auto: learned ?? sample, source: learned != null ? 'legutóbbi ár' : null,
            live: learned == null ? (has ? 'minta ár · írd át egyszer, megjegyzi' : 'add meg a cikkszámot bal oldalt · minta ár') : null,
            priceKey: d.cikkszam ? { brand: d.brand, articleNo: d.cikkszam } : null, needsCode: !d.cikkszam });
    }
    for (const m of st.manual) out.push({ key: 'm-' + m.id, label: m.label || 'Tétel', cikkszam: m.cikkszam, qty: m.qty, unit: 'db', auto: null });
    for (const x of extrasList()) if (x.on) out.push({ key: 'x-' + x.key, label: x.label, cikkszam: '', qty: x.qty, unit: x.unit, auto: x.unitNet,
        source: x.own ? 'műhely' : null, live: x.own ? null : 'minta · élesben a műhely saját ára' });
    // Munkadíj: a műhely fix díjas munkái külön sorban; a többi normaidő x óradíj.
    const fixed = sh.jobLabour || {};
    let hours = 0;
    for (const j of selJobs()) {
        if (j.key === 'oil') out.push({ key: 'lab-oil', label: sh.labour.label, cikkszam: '', qty: 1, unit: 'db', auto: sh.labour.net,
            source: sh.ownLabour ? 'műhely munkadíja' : null, live: sh.ownLabour ? null : 'minta · élesben a műhely saját díja' });
        else if (fixed[j.key]) fixed[j.key].forEach((f, i) => out.push({ key: `lab-${j.key}-${i}`, label: f.label, cikkszam: '', qty: 1, unit: 'db', auto: f.net, source: 'műhely munkadíja' }));
        else hours += j.hours || 0;
    }
    if (hours > 0 || st.hours != null) {
        out.push({ key: 'labour', label: 'Munkadíj', cikkszam: '', qty: st.hours ?? Math.round(hours * 100) / 100, unit: 'óra', auto: sh.hourlyRate, labour: true,
            live: st.hours == null ? `becsült normaidő · ${huf(sh.hourlyRate)}/óra${sh.sampleRate ? ' (minta)' : ''} · írd át` : null });
    }
    return out.map((l) => {
        const qty = st.qty[l.key] ?? l.qty;
        const unitNet = st.prices[l.key] ?? l.auto ?? null;
        const disc = st.disc[l.key] || 0; // kedvezmény %, soronként (mint a műhely ajánlatain)
        return { ...l, qty, unitNet, disc, typed: st.prices[l.key] != null, net: Math.round(qty * (unitNet || 0) * (1 - disc / 100)), priceMissing: unitNet == null };
    });
}
const totals = (ls) => {
    const net = ls.reduce((s, l) => s + l.net, 0);
    const vat = Math.round(net * st.shop.vatRate);
    return { net, vat, gross: net + vat, missing: ls.filter((l) => l.priceMissing).length };
};
const customer = () => ({ name: val('cust-name'), plate: val('cust-plate').toUpperCase(), phone: val('cust-phone'), km: val('cust-km') });
const carLabel = () => carName() + (val('oc-code') ? ` (${val('oc-code').toUpperCase()})` : '');
const jobLabels = () => selJobs().map((j) => j.label.toLowerCase());
const letter = () => letterParts(st.shop, { name: customer().name, jobKeys: st.sel, jobLabels: jobLabels() });

function render() {
    if (!st.shop) return;
    const ls = lines();
    $('quote-empty').hidden = ls.length > 0;
    $('quote').hidden = ls.length === 0;
    $('oc-no').textContent = st.quoteNo ? `№ ${st.quoteNo}` : '';
    if (!ls.length) { $('timer').textContent = ''; return; }

    $('lines').innerHTML = ls.map((l) => {
        const src = l.open ? '<span class="miss">válaszd ki a szűrőt</span>'
            : l.typed ? esc(l.priceKey ? 'kézzel megadva - megjegyezve' : 'kézzel megadva')
                : l.live ? `<span class="live">● ${esc(l.live)}</span>`
                    : l.priceMissing ? '<span class="miss">ár hiányzik - írd be, megjegyzi</span>' : esc(l.source || '');
        return `<tr><td><div class="lab">${esc(l.label)}</div>
            <div class="sub">${l.cikkszam ? `<span class="cik">${esc(l.cikkszam)}</span> · ` : ''}${src}${l.missingQty ? ' · <span class="miss">mennyiség?</span>' : ''}</div></td>
          <td class="r"><input class="cell" data-k="${l.key}" data-f="qty" value="${esc(fmtQty(l.qty))}" aria-label="${esc(l.label)} mennyiség"> ${esc(l.unit)}</td>
          <td class="r"><input class="cell${l.priceMissing || l.typed ? ' edited' : ''}${l.live && !l.typed ? ' live' : ''}" data-k="${l.key}" data-f="price" value="${l.unitNet ?? ''}" placeholder="ár" aria-label="${esc(l.label)} egységár"></td>
          <td class="r"><input class="cell disc" data-k="${l.key}" data-f="disc" value="${l.disc || ''}" placeholder="0" aria-label="${esc(l.label)} kedvezmény %">%</td>
          <td class="r">${l.priceMissing ? '–' : huf(l.net)}</td></tr>`;
    }).join('');

    const t = totals(ls);
    $('t-net').textContent = huf(t.net);
    $('t-vat-l').textContent = `ÁFA ${Math.round(st.shop.vatRate * 100)}%`;
    $('t-vat').textContent = huf(t.vat);
    $('t-gross').textContent = huf(t.gross);

    const oj = hasOil();
    const f = oj ? st.eng?.filter : null, ch = oj ? filterChoice() : null;
    const noCode = ls.filter((l) => l.needsCode).map((l) => l.label);
    const warn = [
        !st.sel.length && 'Válaszd ki a munkát.',
        t.missing && `${t.missing} tételnek még nincs ára - írd be a táblázatban.`,
        noCode.length && `Cikkszám még nincs: ${noCode.join(', ')} - add meg egyszer bal oldalt, erre a motorra megjegyzi.`,
        !ch && f?.kind === 'none' && 'Olajszűrő: ehhez a motorhoz még nincs a táblában - add meg egyszer.',
        !ch && f?.kind === 'date' && 'Olajszűrő: a gyártás hónapjától függ - írd be, vagy válassz.',
        ch && f?.kind === 'check' && st.filterSel == null && `Olajszűrő: ellenőrizd, melyik változat illik (most: ${ch.base.cikkszam}).`,
        ch && f?.family && `Olajszűrő: motorcsalád (${f.family}) alapján - ellenőrizd.`,
        oj && !st.oil && 'Motorolaj: válaszd ki egyszer erre a motorra.',
        oj && st.oil && !(st.liters > 0) && 'Motorolaj: add meg a mennyiséget.',
        ls.some((l) => l.live && !l.typed) && '● Pirossal: minta adat. Amit átírsz, azt a program megjegyzi, legközelebb magától jön.',
    ].filter(Boolean);
    $('warn').hidden = !warn.length;
    $('warn').innerHTML = warn.map(esc).join('<br>');
    $('plain').textContent = plainText(ls, t);

    if (st.t0 && st.doneIn == null && !t.missing && !noCode.length && (!oj || (ch && st.oil && st.liters > 0))) st.doneIn = Math.max(1, Math.round((performance.now() - st.t0) / 1000));
    $('timer').textContent = st.doneIn != null ? `kész ${st.doneIn} mp alatt` : '';
}

function plainText(ls, t) {
    const c = customer(), vin = cleanVin($('vin').value);
    const lt = letterText(letter());
    return [
        lt && lt + '\n\n----------------\n',
        `${st.shop.name} - Árajánlat${st.quoteNo ? ' ' + st.quoteNo : ''}: ${jobLabels().join(', ')}`,
        c.name && `Ügyfél: ${c.name}`,
        `Autó: ${carLabel()}${c.plate ? ` (${c.plate})` : ''}`,
        vin && `Alvázszám: ${vin}`,
        c.km && `Km-óra: ${c.km}`,
        '',
        ...ls.map((l) => `• ${l.label}${l.cikkszam ? ` (${l.cikkszam})` : ''}: ${fmtQty(l.qty)} ${l.unit}${l.disc ? `, -${l.disc}%` : ''} → ${l.priceMissing ? 'ár később' : huf(l.net)}`),
        '',
        `Nettó${t.missing ? ' (eddig)' : ''}: ${huf(t.net)}`,
        `ÁFA ${Math.round(st.shop.vatRate * 100)}%: ${huf(t.vat)}`,
        `Fizetendő${t.missing ? ' (előzetes)' : ''}: ${huf(t.gross)}`,
        '',
        !st.shop.letter && st.shop.quoteNote,
    ].filter((x) => x !== false && x != null).join('\n').replace(/\n{3,}/g, '\n\n');
}

// A munkafelvevő bármelyik számot átírhatja. A beírt alkatrész- és olajár
// megjegyződik (cikkszám, ill. olajnév szerint), legközelebb magától jön.
$('lines').addEventListener('change', (ev) => {
    const el = ev.target.closest('.cell');
    if (!el) return;
    const n = parseNum(el.value), k = el.dataset.k;
    if (el.dataset.f === 'disc') {
        if (n == null || n <= 0) delete st.disc[k]; else st.disc[k] = Math.min(n, 100);
    } else if (el.dataset.f === 'qty') {
        if (k === 'oil') {
            st.liters = n != null && n > 0 && n < 50 ? n : null; st.oilTouched = true;
            $('liters').value = st.liters != null ? fmtQty(st.liters) : ''; learnOil();
        } else if (k === 'labour') st.hours = n != null && n >= 0 ? n : null;
        else if (k.startsWith('p-')) {
            const name = k.slice(2), d = { ...partData(name), qty: n > 0 && n < 100 ? n : 1 };
            st.partEdits[name] = d; renderParts();
            post({ action: 'oc-part', engineCode: val('oc-code'), car: carName(), part: name, ...d });
        } else if (k.startsWith('m-')) { const m = st.manual.find((x) => 'm-' + x.id === k); if (m) m.qty = n > 0 ? n : 1; renderParts(); }
        else if (n == null || n < 0) delete st.qty[k]; else st.qty[k] = n;
    } else {
        if (n == null || n < 0) delete st.prices[k]; else st.prices[k] = n;
        const l = lines().find((x) => x.key === k);
        if (l?.priceKey) {
            post({ action: 'td-price', ...l.priceKey, net: n });
            if (st.eng) { const pk = priceKey(l.priceKey.brand, l.priceKey.articleNo); if (n == null) delete st.eng.prices[pk]; else st.eng.prices[pk] = n; }
        }
    }
    render();
});
['cust-name', 'cust-plate', 'cust-phone', 'cust-km'].forEach((id) => $(id).addEventListener('input', () => render()));

$('copy').addEventListener('click', async () => {
    learnOil();
    try {
        await navigator.clipboard.writeText($('plain').textContent);
        $('copy').textContent = 'Kimásolva ✓';
    } catch {
        $('copy').textContent = 'Nem sikerült - jelöld ki lent';
        $('plain').closest('details').open = true;
    }
    setTimeout(() => { $('copy').textContent = 'Szöveg másolása'; }, 1800);
});

// PDF: külön lap a műhely fejlécével és kísérőlevelével; a böngésző "Mentés PDF-be" opciójával PDF lesz belőle.
$('print').addEventListener('click', async () => {
    const win = window.open('', '_blank');
    if (!win) { $('print').textContent = 'Engedélyezd a felugró ablakot'; return; }
    learnOil();
    if (!st.quoteNo) {
        const r = await api(null, { action: 'quote-no' }).catch(() => null);
        st.quoteNo = r?.number || new Date().toISOString().slice(0, 10);
        render();
    }
    const ls = lines();
    win.document.write(printQuoteHtml({ shop: st.shop, quoteNo: st.quoteNo, customer: customer(), carName: carLabel(), vin: cleanVin($('vin').value), lines: ls, totals: totals(ls), letter: letter() }));
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 300);
});

$('reset').addEventListener('click', () => {
    Object.assign(st, fresh());
    ['oc-make', 'oc-model', 'oc-engine', 'oc-code', 'oc-when', 'vin', 'oc-oil', 'liters', 'cust-name', 'cust-plate', 'cust-phone', 'cust-km'].forEach((id) => { $(id).value = ''; });
    $('vin-hint').textContent = '';
    renderJobs();
    renderAll();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    $('oc-make').focus();
});

function renderAll() {
    renderParts();
    renderFilter();
    renderOil();
    renderExtras();
    render();
}

// ---------- Fülek ----------
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((x) => { x.classList.toggle('is-on', x === t); x.setAttribute('aria-selected', x === t); });
    ['quote', 'parts', 'proof'].forEach((k) => { $('view-' + k).hidden = t.dataset.tab !== k; });
}));
