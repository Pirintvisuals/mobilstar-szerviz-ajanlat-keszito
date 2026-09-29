// ---------------------------------------------------------------------------
//  Új ajánlat: alvázszám -> autó -> munka -> kérdések -> alkatrész a műhely
//  márkáival, Fuchs olaj, mellé járó tételek, munkadíj -> kész ajánlat (PDF).
//  Az ár még kézzel megy (és megjegyezzük): élesben a műhely nagykerének
//  (Inter Cars) nettó ára jön ide. Az árat a kód számolja, sosem az AI.
// ---------------------------------------------------------------------------
import { huf, pickOil } from './quote.js';
import { analyze, answerText, isMmLabel, specText, specRank, visibleSpecs, SHARED } from './pick.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const api = async (params, body) => {
    const res = body
        ? await fetch('/api/olajcsere', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        : await fetch('/api/olajcsere?' + new URLSearchParams(params));
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || 'HTTP ' + res.status);
    if (json.status) showLeft(json.status);
    return json;
};
const post = (body) => api(null, body).catch(() => null); // tanulás: ha nem sikerül, az ajánlat attól még megy
const parseNum = (s) => {
    const n = parseFloat(String(s).replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : null;
};
const fmtQty = (n) => String(n).replace('.', ',');
const cleanVin = () => $('td-vin').value.toUpperCase().replace(/[^A-Z0-9]/g, '');

// shared: munkánként a közös válaszok (első/hátsó a betétre és a tárcsára is).
// extraOn: a mellé járó tételek ki-be kapcsolva. oil: a Fuchs-olaj állapota.
const fresh = () => ({ car: null, loaded: [], groups: [], shared: {}, oemLines: [], extraOn: {}, prices: {}, qty: {}, hours: null, oil: null, quoteNo: null });
const st = { shop: null, jobs: [], ...fresh() };

function showLeft(s) {
    $('td-left').textContent = s.remaining != null ? `tesztkeret: ${s.remaining} kérés maradt` : 'TecDoc-teszt';
}

Promise.all([api({ action: 'config' }), api({ action: 'td-status' })]).then(([cfg, td]) => {
    st.shop = cfg.shop;
    st.jobs = td.jobs;
    showLeft(td);
    if (!td.configured) $('td-vin-hint').innerHTML = '<b>A TecDoc-teszt nincs beállítva</b> (RAPIDAPI_KEY a .env.local-ban).';
}).catch((e) => { $('td-vin-hint').textContent = e.message; });

$('to-type').addEventListener('click', () => document.querySelector('.tab[data-tab="quote"]').click());

// ---------- 1. Autó ----------
$('td-vin-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const vin = cleanVin();
    if (vin.length !== 17) { $('td-vin-hint').textContent = `${vin.length}/17 karakter`; return; }
    $('td-vin-hint').textContent = 'Keresés a TecDoc-ban…';
    $('td-cars').innerHTML = '';
    try {
        const r = await api({ action: 'td-vin', vin });
        if (!r.vehicles.length) {
            $('td-vin-hint').innerHTML = r.models.length
                ? `A TecDoc a típust tudja (<b>${esc(r.make || '')} ${esc(r.models.map((m) => m.name).join(', '))}</b>), a pontos motorváltozatot nem.`
                : 'Erre az alvázszámra a TecDoc nem ad autót.';
            return;
        }
        $('td-vin-hint').innerHTML = r.vehicles.length === 1 ? 'Megvan az autó.' : `${r.vehicles.length} változat illik rá - válaszd ki a motort.`;
        $('td-cars').innerHTML = r.vehicles.map((v) => `
            <button class="res" type="button" data-id="${v.vehicleId}" data-name="${esc(v.name)}">
              <span class="t">${esc(v.name)}</span><span class="code">${esc(v.vehicleId)}</span>
              <span class="m">TecDoc jármű-azonosító</span>
            </button>`).join('');
        if (r.vehicles.length === 1) pickCar(r.vehicles[0].vehicleId, r.vehicles[0].name);
    } catch (e) {
        $('td-vin-hint').textContent = e.message;
    }
});
$('td-cars').addEventListener('click', (ev) => {
    const b = ev.target.closest('.res');
    if (b) pickCar(Number(b.dataset.id), b.dataset.name);
});

function pickCar(vehicleId, name) {
    $('td-cars').querySelectorAll('.res').forEach((b) => b.setAttribute('aria-pressed', b.dataset.id === String(vehicleId)));
    Object.assign(st, fresh(), { car: { vehicleId, name }, oemLines: st.oemLines });
    $('td-car').innerHTML = `<div class="t">${esc(name)}</div><div class="m">TecDoc jármű: <b class="mono">${esc(vehicleId)}</b></div>`;
    $('td-card-job').hidden = false;
    renderAll();
}

// ---------- 2. Munka ----------
function renderJobs() {
    $('td-jobs').innerHTML = st.jobs.map((j) => {
        const on = st.loaded.includes(j.key);
        const parts = [...(j.oil ? ['Fuchs olaj'] : []), ...j.parts];
        return `<button type="button" class="chip${on ? ' on' : ''}" data-job="${j.key}" aria-pressed="${on}">${esc(j.label)}
            <span class="m">${esc(parts.join(', '))}</span></button>`;
    }).join('');
}
$('td-jobs').addEventListener('click', async (ev) => {
    const b = ev.target.closest('.chip');
    if (!b || !st.car) return;
    const key = b.dataset.job;
    if (st.loaded.includes(key)) {           // második kattintás: kiveszi
        st.loaded = st.loaded.filter((k) => k !== key);
        st.groups = st.groups.filter((g) => g.job !== key);
        if (!needsOil()) st.oil = null;
        renderAll();
        return;
    }
    b.classList.add('busy');
    b.disabled = true;
    try {
        const r = await api({ action: 'td-job', vehicleId: st.car.vehicleId, job: key });
        st.loaded.push(key);
        st.shared[key] = {};
        r.parts.forEach((p, i) => {
            // Ugyanaz az alkatrész két munkában (olajszűrő: olajcsere + kis szerviz) csak egyszer kerül fel.
            if (st.groups.some((g) => g.name === p.name)) return;
            const g = { id: `${key}-${i}`, job: key, name: p.name, label: p.label, qty: p.qty || 1, category: p.category, articles: p.articles, answers: {}, sel: null, manual: false };
            g.main = mainName(g);
            applyLearned(g, p.learned);
            st.groups.push(g);
        });
        if (needsOil() && !st.oil) startOil(r.fuchsTypeId);
    } catch (e) {
        $('td-jobs').insertAdjacentHTML('afterend', `<div class="hint">${esc(e.message)}</div>`);
    }
    renderAll();
});
const needsOil = () => st.jobs.some((j) => j.oil && st.loaded.includes(j.key));

// ---------- 3. Melyik alkatrész: kérdések, aztán ajánlás ----------
// Egy TecDoc-csoportban mellékes cikk is lehet (a fékbetétek közt a kopásjelző):
// a leggyakoribb terméknév a fő termék, abból kérdezünk és ajánlunk.
function mainName(g) {
    const n = {};
    for (const a of g.articles) n[a.name] = (n[a.name] || 0) + 1;
    return Object.entries(n).sort((x, y) => y[1] - x[1])[0]?.[0] ?? '';
}
const answersOf = (g) => ({ ...st.shared[g.job], ...g.answers });
function refresh(g) {
    g.r = analyze(g.articles, { main: g.main, answers: answersOf(g) });
    if (!g.manual) g.sel = g.r.recommended;
}
// Amit a szerelő erre az autóra egyszer eldöntött: a válaszai és a választott cikk.
function applyLearned(g, learned) {
    if (learned) {
        for (const [l, v] of Object.entries(learned.answers || {})) (SHARED.includes(l) ? st.shared[g.job] : g.answers)[l] = v;
    }
    refresh(g);
    if (!learned?.articleNo) return;
    const i = g.articles.findIndex((a) => a.brand === learned.brand && a.articleNo === learned.articleNo);
    if (i >= 0) { g.sel = i; g.manual = i !== g.r.recommended; g.learned = true; }
}
function learn(g) {
    const a = g.sel != null ? g.articles[g.sel] : null;
    post({ action: 'td-learn', vehicleId: st.car.vehicleId, part: g.name, answers: answersOf(g), brand: a?.brand || '', articleNo: a?.articleNo || '' });
}

// pic=false: a hosszú listában nincs kép, különben több száz tölt be.
function option(g, a, i, pic = true) {
    const specs = visibleSpecs(a.specs).map((s) => `<span class="spec${specRank(s) < 3 ? ' key' : ''}">${esc(specText(s))}</span>`).join('');
    return `<label class="oil part${pic ? '' : ' nopic'}"><input type="radio" name="g-${g.id}" value="${i}" ${g.sel === i ? 'checked' : ''}>
        ${!pic ? '' : a.img ? `<img class="thumb" src="${esc(a.img)}" alt="" loading="lazy">` : '<span class="thumb"></span>'}
        <span class="info"><span class="t">${esc(a.brand)} <span class="mono">${esc(a.articleNo)}</span>${a.preferred ? '<span class="badge">a műhely márkája</span>' : ''}</span>
        <span class="m">${esc(a.name)}${a.price != null ? ` · legutóbbi ár: ${esc(huf(a.price))}` : ''}</span>${specs ? `<span class="specs">${specs}</span>` : ''}</span></label>`;
}

function renderGroups() {
    const open = new Set([...$('td-parts').querySelectorAll('[data-g] details[open]')].map((d) => d.closest('[data-g]').dataset.g));
    $('td-parts').innerHTML = st.groups.map((g) => {
        if (!g.category) return `<div class="card"><h2>${esc(g.label)}</h2><div class="hint">Ehhez az autóhoz a TecDoc nem ad ilyen csoportot.</div></div>`;
        if (!g.articles.length) return `<div class="card"><h2>${esc(g.label)}</h2><div class="hint">Nincs illő cikk.</div></div>`;
        const r = g.r, q = r.question;
        const answered = Object.entries(answersOf(g)).map(([l, v]) =>
            `<button type="button" class="ans" data-undo="${esc(l)}" title="Válasz törlése">${esc(l)}: <b>${esc(answerText(l, v, isMmLabel(l)))}</b> ✕</button>`).join('');
        const ask = q ? `<div class="ask">
                <div class="qtext">${esc(q.text)}</div>
                <div class="opts">${q.options.map((o) => `<button type="button" class="btn opt" data-ans="${esc(q.label)}" data-val="${esc(o.value)}">${esc(answerText(q.label, o.value, q.mm))}<span class="m">${o.count} cikk</span></button>`).join('')}
                <button type="button" class="btn ghost opt" data-ans="${esc(q.label)}" data-skip="1">Nem tudom</button></div>
                <div class="hint">Ebben különböznek az erre az autóra illő alkatrészek. ${r.candidates.length} jelölt maradt.</div>
            </div>` : '';
        const rec = r.recommended != null ? g.articles[r.recommended] : null;
        const chosen = g.sel != null ? g.articles[g.sel] : null;
        const why = g.learned ? 'Legutóbb ezt választottad erre az autóra.'
            : g.manual ? 'A szerelő választotta.'
                : !rec ? '' : q ? 'Eddigi legjobb - a kérdés után pontosodik.'
                    : r.unsure ? 'Ellenőrizd: volt „nem tudom” válasz, több változat is lehet.'
                        : r.twins.length ? `Ellenőrizd: a ${rec.brand}-ből ez is illik: ${r.twins.slice(0, 3).join(', ')} - évjárat vagy motorváltozat dönti el.`
                            : rec.preferred ? 'A műhely első márkája, ami a válaszaidra illik.' : 'A műhely márkái közül egyik sem illik - ez a legközelebbi.';
        const tag = g.learned ? 'Megjegyezve' : g.manual ? 'Kézzel választva' : q ? 'Eddigi legjobb' : 'Ajánlott';
        const soft = !g.learned && !g.manual && (q || r.unsure || r.twins.length);
        const alts = r.alternatives.filter((i) => i !== g.sel);
        return `<div class="card" data-g="${g.id}">
            <h2>${esc(g.label)} <span class="src">${esc(g.category.parent)} › ${esc(g.category.name)} · ${g.articles.length} cikk</span></h2>
            ${answered ? `<div class="answers">${answered}</div>` : ''}
            ${ask}
            ${chosen ? `<div class="rec"><div class="rec-h"><span class="tag${soft ? ' soft' : ''}">${tag}</span><span class="hint">${esc(why)}</span></div>
                <div class="oils">${option(g, chosen, g.sel)}</div></div>` : '<p class="hint">Nincs ajánlható cikk - válassz a listából.</p>'}
            ${alts.length ? `<div class="lbl">Másik márka a műhely listájáról</div><div class="oils">${alts.map((i) => option(g, g.articles[i], i)).join('')}</div>` : ''}
            <details class="plain"${open.has(g.id) ? ' open' : ''}><summary>Összes illő cikk (${r.candidates.length})</summary><div class="oils all">${r.candidates.map((i) => option(g, g.articles[i], i, false)).join('')}</div></details>
        </div>`;
    }).join('');
}

$('td-parts').addEventListener('click', (ev) => {
    const card = ev.target.closest('[data-g]');
    const ans = ev.target.closest('[data-ans]'), undo = ev.target.closest('[data-undo]');
    if (!card || (!ans && !undo)) return;
    const g = st.groups.find((x) => x.id === card.dataset.g);
    const label = ans ? ans.dataset.ans : undo.dataset.undo;
    const target = SHARED.includes(label) ? st.shared[g.job] : g.answers;
    if (undo) delete target[label];
    else if (ans.dataset.skip) target[label] = null;
    else {
        const raw = ans.dataset.val, n = Number(raw);
        target[label] = raw !== '' && Number.isFinite(n) && (isMmLabel(label) || /^(Fogszám|Bordaszám)$/.test(label)) ? n : raw;
    }
    const affected = SHARED.includes(label) ? st.groups.filter((x) => x.job === g.job) : [g];
    affected.forEach((x) => { x.manual = false; x.learned = false; refresh(x); learn(x); });
    renderAll();
});
$('td-parts').addEventListener('change', (ev) => {
    const card = ev.target.closest('[data-g]');
    if (!card || ev.target.type !== 'radio') return;
    const g = st.groups.find((x) => x.id === card.dataset.g);
    g.sel = Number(ev.target.value);
    g.manual = g.sel !== g.r.recommended;
    g.learned = false;
    learn(g);
    renderAll();
});

// ---------- Motorolaj (Fuchs) ----------
// A TecDoc autónevéből keresünk a Fuchs-ban ("MERCEDES-BENZ SL (R129) 500
// (129.068)" -> "MERCEDES-BENZ SL 500"); a pontos motort a szerelő bökő rá.
async function startOil(learnedTypeId) {
    st.oil = { results: null, data: null, code: null, liters: 0 };
    // Erre az autóra már kiválasztották a motort: nem kell újra.
    if (learnedTypeId && await loadFuchs(learnedTypeId, false)) { $('td-oil-hint').textContent = 'Legutóbb ezt a motort választottad erre az autóra.'; return; }
    const q = st.car.name.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
    $('td-oil-hint').textContent = 'Keresés a Fuchs olajválasztóban…';
    try {
        const { results } = await api({ action: 'search', q });
        st.oil.results = results;
        $('td-oil-hint').textContent = results.length ? 'Válaszd ki a motort - innen jön az olaj és a mennyiség.' : 'A Fuchs nem talált ilyen autót. Keress rá a „Olajcsere típusból” fülön.';
    } catch (e) {
        $('td-oil-hint').textContent = e.message;
    }
    renderOil();
}
function renderOil() {
    const o = st.oil;
    $('td-oil').hidden = !o;
    if (!o) return;
    $('td-oil-res').innerHTML = o.data ? '' : (o.results || []).map((r) => `
        <button class="res" type="button" data-fuchs="${r.typeId}">
          <span class="t">${esc(r.make)} ${esc(r.model)} ${esc(r.type)}</span><span class="code">${esc(r.engineCode || '—')}</span>
          <span class="m">${esc([r.yearStart && `${r.yearStart}–${r.yearEnd || ''}`, r.fuel, r.powerKw && `${r.powerKw} kW`].filter(Boolean).join(' · '))}</span>
        </button>`).join('');
    $('td-oil-pick').hidden = !o.data;
    if (!o.data) return;
    const v = o.data.vehicle;
    $('td-oil-car').innerHTML = `<div class="t">${esc(v.make)} ${esc(v.type)}</div><div class="m">Motorkód: <b class="mono">${esc(v.engineCode || '—')}</b> · <button class="linkbtn" type="button" id="td-oil-other">másik motor</button></div>`;
    $('td-oils').innerHTML = o.data.oils.length ? o.data.oils.map((x) => `<label class="oil"><input type="radio" name="td-oil" value="${esc(x.code)}" ${x.code === o.code ? 'checked' : ''}>
        <span class="t">${esc(x.name)}${x.approved ? '<span class="badge">gyári jóváhagyás</span>' : ''}</span>
        <span class="m">Fuchs kód: <span class="mono">${esc(x.code)}</span> · ${esc(x.uses.map((u) => u.name + (u.interval ? ` (${u.interval})` : '')).join(' · '))}</span></label>`).join('')
        : '<div class="hint">A Fuchs erre a motorra nem ad olajajánlást.</div>';
    $('td-oil-cap').textContent = o.data.capacityL ? fmtQty(o.data.capacityL) + ' l' : 'nincs adat';
    if (document.activeElement !== $('td-liters')) $('td-liters').value = fmtQty(o.liters || '');
    $('td-fuchs-link').href = v.fuchsUrl;
    $('td-oil-other').onclick = () => { o.data = null; o.code = null; renderAll(); };
}
async function loadFuchs(typeId, remember) {
    $('td-oil-hint').textContent = 'Olaj betöltése…';
    try {
        const data = await api({ action: 'vehicle', typeId });
        Object.assign(st.oil, { data, code: data.chosenOil || pickOil(data.oils, st.shop.preferredOils)?.code || null, liters: data.liters });
        $('td-oil-hint').textContent = '';
        if (remember) post({ action: 'td-learn', vehicleId: st.car.vehicleId, part: 'FUCHS', answers: {}, brand: 'FUCHS', articleNo: String(typeId) });
        return true;
    } catch (e) {
        $('td-oil-hint').textContent = e.message;
        return false;
    } finally {
        renderAll();
    }
}
$('td-oil-res').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-fuchs]');
    if (b) loadFuchs(b.dataset.fuchs, true);
});
$('td-oils').addEventListener('change', (ev) => { if (ev.target.name === 'td-oil') { st.oil.code = ev.target.value; delete st.prices.oil; render(); } });
$('td-liters').addEventListener('input', () => {
    const n = parseNum($('td-liters').value);
    if (n != null && n >= 0 && n < 50) { st.oil.liters = n; render(); }
});

// ---------- Mellé járó tételek ----------
function extrasList() {
    const seen = new Set(), out = [];
    for (const key of st.loaded) for (const x of st.shop.jobExtras?.[key] || []) {
        if (seen.has(x.key)) continue;
        seen.add(x.key);
        out.push({ ...x, on: st.extraOn[x.key] ?? x.on });
    }
    return out;
}
function renderExtras() {
    const xs = extrasList();
    $('td-extras').hidden = !xs.length;
    $('td-extras-list').innerHTML = xs.map((x) => `<label class="oil"><input type="checkbox" data-extra="${esc(x.key)}" ${x.on ? 'checked' : ''}>
        <span class="t">${esc(x.label)}</span><span class="m">${fmtQty(x.qty)} ${esc(x.unit)} · ${esc(huf(x.unitNet))}/${esc(x.unit)} (MINTA ár)</span></label>`).join('');
}
$('td-extras-list').addEventListener('change', (ev) => {
    const k = ev.target.dataset.extra;
    if (k) { st.extraOn[k] = ev.target.checked; render(); }
});

// ---------- Gyári szám -> utángyártott ----------
let oemResult = null;
$('td-oem-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const oem = $('td-oem').value.trim();
    if (!oem) return;
    $('td-oem-out').innerHTML = '<div class="hint">Keresés… (az első keresés egy gyári számra lassú lehet)</div>';
    try {
        const r = await api({ action: 'td-oem', oem });
        oemResult = { oem, ...r };
        const list = r.articles;
        if (!list.length) { $('td-oem-out').innerHTML = '<div class="hint">Erre a gyári számra nincs utángyártott megfelelő.</div>'; return; }
        const row = (a, i) => `<div class="found oemrow"><span><b>${esc(a.brand)}</b> <span class="mono">${esc(a.articleNo)}</span>${a.preferred ? '<span class="badge">a műhely márkája</span>' : ''}</span>
            <button class="linkbtn" type="button" data-i="${i}">+ ajánlatba</button></div>`;
        const top = list.map((a, i) => [a, i]).filter(([a]) => a.preferred);
        $('td-oem-out').innerHTML = `<p class="hint">${esc(r.oemMaker || '')} ${esc(oem)}: <b>${list.length}</b> utángyártott cikk, ${new Set(list.map((a) => a.brand)).size} márka.</p>
            ${top.map(([a, i]) => row(a, i)).join('')}
            <details class="plain"${top.length ? '' : ' open'}><summary>Összes (${list.length})</summary>${list.map(row).join('')}</details>`;
    } catch (e) {
        $('td-oem-out').innerHTML = `<div class="hint">${esc(e.message)}</div>`;
    }
});
$('td-oem-out').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-i]');
    if (!b || !oemResult) return;
    const a = oemResult.articles[Number(b.dataset.i)];
    st.oemLines.push({ id: `oem-${Date.now()}`, label: `Alkatrész (gyári ${oemResult.oem} helyett)`, brand: a.brand, articleNo: a.articleNo, qty: 1, price: a.price ?? null });
    b.textContent = 'hozzáadva ✓';
    render();
});

// ---------- Ajánlat ----------
function oilLine() {
    const o = st.oil;
    const oil = o?.data?.oils.find((x) => x.code === o.code);
    if (!oil) return null;
    const markup = 1 + (st.shop.partsMarkup || 0);
    const list = o.data.oilPrices?.[oil.code];
    const learned = o.data.learnedSale?.[oil.code];
    const unitNet = learned ?? Math.round((list ? list.netPerLiter : st.shop.fallbackOilNetPerLiter) * markup);
    return { key: 'oil', label: `FUCHS ${oil.name}`, cikkszam: list?.cikkszam || oil.code, qty: o.liters, unit: 'l', part: true,
        auto: unitNet, source: learned != null ? 'legutóbbi ár' : list ? 'árlista' : 'MINTA ár', priceKey: { brand: 'FUCHS', articleNo: oil.code } };
}
function lines() {
    const out = [];
    const ol = oilLine();
    if (ol) out.push(ol);
    for (const g of st.groups) {
        const a = g.sel != null ? g.articles[g.sel] : null;
        if (!a) continue;
        const pos = answersOf(g)['Beépítés'];
        const side = pos ? ` (${answerText('Beépítés', pos)})` : '';
        out.push({ key: g.id, label: `${g.label}${side}, ${a.brand}`, cikkszam: a.articleNo, qty: g.qty, unit: 'db', part: true,
            auto: a.price ?? null, source: a.price != null ? 'legutóbbi ár' : null, priceKey: { brand: a.brand, articleNo: a.articleNo }, open: g.r?.question?.text || null });
    }
    for (const o of st.oemLines) out.push({ key: o.id, label: `${o.label}, ${o.brand}`, cikkszam: o.articleNo, qty: o.qty, unit: 'db', part: true, removable: true,
        auto: o.price, source: o.price != null ? 'legutóbbi ár' : null, priceKey: { brand: o.brand, articleNo: o.articleNo } });
    for (const x of extrasList()) if (x.on) out.push({ key: 'x-' + x.key, label: x.label, cikkszam: '', qty: x.qty, unit: x.unit, auto: x.unitNet, source: 'műhely (MINTA)' });
    if (out.length) {
        const jobHours = st.jobs.filter((j) => st.loaded.includes(j.key)).reduce((s, j) => s + j.hours, 0);
        out.push({ key: 'labour', label: 'Munkadíj', cikkszam: '', qty: st.hours ?? (jobHours || 1), unit: 'óra', auto: st.shop.hourlyRate, labour: true });
    }
    return out.map((l) => {
        const qty = st.qty[l.key] ?? l.qty;
        const unitNet = st.prices[l.key] ?? l.auto ?? null;
        return { ...l, qty, unitNet, typed: st.prices[l.key] != null, net: Math.round(qty * (unitNet || 0)), priceMissing: unitNet == null };
    });
}

function totals(ls) {
    const net = ls.reduce((s, l) => s + l.net, 0);
    const vat = Math.round(net * st.shop.vatRate);
    return { net, vat, gross: net + vat, missing: ls.filter((l) => l.priceMissing).length };
}

function render() {
    if (!st.shop) return;
    const ls = lines();
    $('td-quote-empty').hidden = ls.length > 0;
    $('td-quote').hidden = ls.length === 0;
    $('td-no').textContent = st.quoteNo ? `№ ${st.quoteNo}` : '';
    if (!ls.length) return;

    $('td-lines').innerHTML = ls.map((l) => {
        const src = l.labour ? `${huf(l.unitNet)}/óra · a szerelő dönti el`
            : l.priceMissing ? '<span class="miss">ár: Inter Cars (még kézzel)</span>'
                : esc(l.typed ? 'kézzel megadva - megjegyezve' : l.source || '');
        return `<tr>
        <td><div class="lab">${esc(l.label)}${l.removable ? ` <button class="linkbtn" type="button" data-rm="${l.key}" aria-label="Törlés">✕</button>` : ''}</div>
            <div class="sub">${l.open ? '<span class="miss">kérdés nyitva</span> · ' : ''}${l.cikkszam ? `<span class="cik">${esc(l.cikkszam)}</span> · ` : ''}${src}</div></td>
        <td class="r"><input class="cell" data-k="${l.key}" data-f="qty" value="${esc(fmtQty(l.qty))}" aria-label="${esc(l.label)} mennyiség"> ${esc(l.unit)}</td>
        <td class="r"><input class="cell${l.priceMissing || l.typed ? ' edited' : ''}" data-k="${l.key}" data-f="price" value="${l.unitNet ?? ''}" placeholder="ár" aria-label="${esc(l.label)} egységár"></td>
        <td class="r">${l.priceMissing ? '–' : huf(l.net)}</td></tr>`;
    }).join('');

    const t = totals(ls);
    $('td-net').textContent = huf(t.net);
    $('td-vat-l').textContent = `ÁFA ${Math.round(st.shop.vatRate * 100)}%`;
    $('td-vat').textContent = huf(t.vat);
    $('td-gross').textContent = huf(t.gross);

    const unpicked = st.groups.filter((g) => g.category && g.articles.length && g.sel == null).map((g) => g.label);
    const open = st.groups.filter((g) => g.r?.question).map((g) => `${g.label}: ${g.r.question.text}`);
    const warn = [
        open.length && `Nyitott kérdés - a tétel addig csak javaslat: ${open.join(' · ')}`,
        st.oil && !st.oil.data && 'Motorolaj: válaszd ki a motort a Fuchs-listában.',
        t.missing && `${t.missing} tételnek még nincs ára. Élesben a műhely Inter Cars nettó ára jön ide magától; most kézzel írható, és a rendszer megjegyzi.`,
        unpicked.length && `Nincs kiválasztva: ${unpicked.join(', ')}.`,
        'Adatforrás: TecDoc-teszt (nem hivatalos) - éles ügyfélnél licencelt TecDoc.',
    ].filter(Boolean);
    $('td-warn').hidden = false;
    $('td-warn').innerHTML = warn.map(esc).join('<br>');
    $('td-plain').textContent = plainText(ls, t);
}

function customer() {
    return { name: $('td-cust-name').value.trim(), plate: $('td-cust-plate').value.trim().toUpperCase(), phone: $('td-cust-phone').value.trim(), km: $('td-cust-km').value.trim() };
}
function plainText(ls, t) {
    const c = customer(), vin = cleanVin();
    return [
        `${st.shop.name} - Árajánlat${st.quoteNo ? ' ' + st.quoteNo : ''}`,
        c.name && `Ügyfél: ${c.name}`,
        st.car && `Autó: ${st.car.name}${c.plate ? ` (${c.plate})` : ''}`,
        vin && `Alvázszám: ${vin}`,
        '',
        ...ls.map((l) => `• ${l.label}${l.cikkszam ? ` (${l.cikkszam})` : ''}: ${fmtQty(l.qty)} ${l.unit} → ${l.priceMissing ? 'ár később' : huf(l.net)}`),
        '',
        `Nettó${t.missing ? ' (eddig)' : ''}: ${huf(t.net)}`,
        `ÁFA ${Math.round(st.shop.vatRate * 100)}%: ${huf(t.vat)}`,
        `Fizetendő${t.missing ? ' (előzetes)' : ''}: ${huf(t.gross)}`,
        '',
        st.shop.quoteNote,
    ].filter((x) => x !== false && x !== null && x !== undefined).join('\n');
}

$('td-lines').addEventListener('change', (ev) => {
    const el = ev.target.closest('.cell');
    if (!el) return;
    const n = parseNum(el.value), k = el.dataset.k;
    if (el.dataset.f === 'qty') {
        if (k === 'labour') st.hours = n != null && n >= 0 ? n : null;
        else if (k === 'oil') { if (n != null && n >= 0) st.oil.liters = n; renderOil(); }
        else if (n == null || n < 0) delete st.qty[k]; else st.qty[k] = n;
    } else {
        if (n == null || n < 0) delete st.prices[k]; else st.prices[k] = n;
        // Kézzel beírt alkatrész- és olajár: megjegyezzük, legközelebb magától jön.
        const l = lines().find((x) => x.key === k);
        if (l?.priceKey) post({ action: 'td-price', ...l.priceKey, net: n });
    }
    render();
});
$('td-lines').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-rm]');
    if (!b) return;
    st.oemLines = st.oemLines.filter((o) => o.id !== b.dataset.rm);
    render();
});
['td-cust-name', 'td-cust-plate', 'td-cust-phone', 'td-cust-km'].forEach((id) => $(id).addEventListener('input', () => render()));

// Kész ajánlat (PDF vagy másolás): minden választást megjegyzünk erre az autóra,
// az elfogadott ajánlásokat is - legközelebb nem kérdez.
const learnAll = () => st.groups.filter((g) => g.sel != null && !g.r?.question).forEach(learn);

$('td-copy').addEventListener('click', async () => {
    learnAll();
    try {
        await navigator.clipboard.writeText($('td-plain').textContent);
        $('td-copy').textContent = 'Kimásolva ✓';
    } catch {
        $('td-copy').textContent = 'Nem sikerült - jelöld ki lent';
        $('td-plain').closest('details').open = true;
    }
    setTimeout(() => { $('td-copy').textContent = 'Szöveg másolása'; }, 1800);
});

// ---------- PDF / nyomtatás ----------
// Külön lap a műhely fejlécével; a böngésző "Mentés PDF-be" opciójával PDF lesz belőle.
$('td-print').addEventListener('click', async () => {
    const win = window.open('', '_blank');
    if (!win) { $('td-print').textContent = 'Engedélyezd a felugró ablakot'; return; }
    learnAll();
    if (!st.quoteNo) {
        const r = await api(null, { action: 'quote-no' }).catch(() => null);
        st.quoteNo = r?.number || new Date().toISOString().slice(0, 10);
        render();
    }
    win.document.write(printHtml());
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 300);
});

function printHtml() {
    const s = st.shop, ls = lines(), t = totals(ls), c = customer(), vin = cleanVin();
    const today = new Date(), until = new Date(today.getTime() + (s.quoteValidDays || 15) * 864e5);
    const d = (x) => x.toLocaleDateString('hu-HU');
    const initials = s.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
    const rows = ls.map((l) => `<tr><td>${esc(l.label)}${l.cikkszam ? `<div class="no">${esc(l.cikkszam)}</div>` : ''}</td>
        <td class="r">${esc(fmtQty(l.qty))} ${esc(l.unit)}</td><td class="r">${l.priceMissing ? '–' : esc(huf(l.unitNet))}</td><td class="r">${l.priceMissing ? 'ár később' : esc(huf(l.net))}</td></tr>`).join('');
    return `<!doctype html><html lang="hu"><head><meta charset="utf-8"><title>Árajánlat ${esc(st.quoteNo || '')}</title>
<style>
  @page { size: A4; margin: 16mm; }
  body { font: 11pt/1.45 'Segoe UI', Arial, sans-serif; color: #1a1d21; margin: 0; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #F59E0B; padding-bottom: 12px; }
  .brand { display: flex; gap: 12px; align-items: center; }
  .logo { width: 48px; height: 48px; border-radius: 50%; background: #16191D; color: #F59E0B; display: grid; place-items: center; font-weight: 800; font-size: 18pt; }
  .shop b { font-size: 14pt; } .shop div { color: #555; font-size: 9.5pt; }
  .meta { text-align: right; } .meta h1 { margin: 0; font-size: 18pt; } .meta div { font-size: 9.5pt; color: #555; }
  .info { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 16px 0; }
  .box { border: 1px solid #ddd; border-radius: 6px; padding: 8px 10px; } .box .l { font-size: 8.5pt; text-transform: uppercase; color: #777; letter-spacing: .05em; }
  table { width: 100%; border-collapse: collapse; } th { text-align: left; font-size: 9pt; color: #555; border-bottom: 1px solid #999; padding: 5px 4px; }
  td { padding: 6px 4px; border-bottom: 1px solid #e5e5e5; vertical-align: top; } .r { text-align: right; white-space: nowrap; } .no { font-family: Consolas, monospace; font-size: 9pt; color: #555; }
  .tot { margin-left: auto; width: 45%; margin-top: 10px; } .tot div { display: flex; justify-content: space-between; padding: 2px 0; }
  .tot .g { font-size: 14pt; font-weight: 800; border-top: 2px solid #1a1d21; margin-top: 4px; padding-top: 6px; }
  .note { margin-top: 18px; font-size: 9.5pt; color: #444; } .sign { margin-top: 40px; display: flex; justify-content: space-between; font-size: 9.5pt; color: #555; }
  .sign span { border-top: 1px solid #999; padding-top: 4px; width: 40%; text-align: center; }
</style></head><body>
<div class="head">
  <div class="brand"><div class="logo">${esc(initials)}</div><div class="shop"><b>${esc(s.name)}</b><div>${esc(s.address || '')}</div><div>${esc(s.phone || '')}${s.taxNumber ? ` · Adószám: ${esc(s.taxNumber)}` : ''}</div></div></div>
  <div class="meta"><h1>Árajánlat</h1><div>Szám: <b>${esc(st.quoteNo || '')}</b></div><div>Kelt: ${d(today)}</div><div>Érvényes: ${d(until).replace(/\.$/, '')}-ig</div></div>
</div>
<div class="info">
  <div class="box"><div class="l">Ügyfél</div>${esc(c.name || '-')}${c.phone ? `<br>${esc(c.phone)}` : ''}</div>
  <div class="box"><div class="l">Jármű</div>${esc(st.car?.name || '-')}${c.plate ? `<br>Rendszám: <b>${esc(c.plate)}</b>` : ''}${vin ? `<br>Alvázszám: ${esc(vin)}` : ''}${c.km ? `<br>Km-óra: ${esc(c.km)}` : ''}</div>
</div>
<table><thead><tr><th>Tétel</th><th class="r">Mennyiség</th><th class="r">Egységár (nettó)</th><th class="r">Nettó</th></tr></thead><tbody>${rows}</tbody></table>
<div class="tot"><div><span>Nettó${t.missing ? ' (eddig)' : ''}</span><b>${esc(huf(t.net))}</b></div><div><span>ÁFA ${Math.round(s.vatRate * 100)}%</span><b>${esc(huf(t.vat))}</b></div>
  <div class="g"><span>Fizetendő${t.missing ? ' (előzetes)' : ''}</span><span>${esc(huf(t.gross))}</span></div></div>
<p class="note">${esc(s.quoteNote || '')}</p>
<div class="sign"><span>${esc(s.name)}</span><span>Ügyfél</span></div>
</body></html>`;
}

$('td-reset').addEventListener('click', () => {
    Object.assign(st, fresh());
    $('td-vin').value = ''; $('td-vin-hint').textContent = ''; $('td-cars').innerHTML = '';
    ['td-cust-name', 'td-cust-plate', 'td-cust-phone', 'td-cust-km'].forEach((id) => { $(id).value = ''; });
    $('td-card-job').hidden = true; $('td-oem-out').innerHTML = ''; $('td-oem').value = '';
    renderAll();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    $('td-vin').focus();
});

function renderAll() {
    renderJobs();
    renderOil();
    renderGroups();
    renderExtras();
    render();
}
