import { buildQuote, quoteText, huf, liters as fmtL } from './quote.js';
import { cleanVin, vinLooksValid, vinMake, vinYear } from './vin.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const api = async (params, body) => {
    const res = body
        ? await fetch('/api/olajcsere', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        : await fetch('/api/olajcsere?' + new URLSearchParams(params));
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || 'HTTP ' + res.status);
    return json;
};
const parseNum = (s) => {
    const n = parseFloat(String(s).replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : null;
};
const years = (a, b) => (a ? `${a}–${b || ''}` : '');

const state = { shop: null, data: null, oilCode: null, liters: 0, filter: null, overrides: {}, t0: null, doneIn: null };

// ---------- Indulás ----------
api({ action: 'config' }).then(({ shop, live }) => {
    state.shop = shop;
    $('shop-name').textContent = `${shop.name} · olajcsere-ajánlat`;
    if (!live) $('results').innerHTML = '<div class="note">A Fuchs-kapcsolat nincs beállítva (OLY_SUBSCRIPTION).</div>';
}).catch((e) => { $('results').innerHTML = `<div class="note">${esc(e.message)}</div>`; });

const startClock = () => { if (!state.t0) state.t0 = performance.now(); };

// ---------- Alvázszám ----------
$('vin').addEventListener('input', () => {
    startClock();
    const v = cleanVin($('vin').value);
    const hint = $('vin-hint');
    if (!v) { hint.textContent = ''; return; }
    if (!vinLooksValid(v)) { hint.textContent = `${v.length}/17 karakter`; return; }
    const make = vinMake(v), year = vinYear(v);
    hint.innerHTML = [make && `<b>${esc(make)}</b>`, year && `${year}-es évjárat`].filter(Boolean).join(' · ') || 'Érvényes alvázszám';
    if (make && !$('q').value.trim()) { $('q').value = make + ' '; $('q').focus(); }
    if (lastResults.length) renderResults(lastResults);
});

// ---------- Keresés ----------
let timer = null, seq = 0, lastResults = [];
$('q').addEventListener('input', () => {
    startClock();
    clearTimeout(timer);
    const text = $('q').value.trim();
    if (text.length < 2) { $('results').innerHTML = ''; return; }
    timer = setTimeout(async () => {
        const my = ++seq;
        $('results').innerHTML = '<div class="note">Keresés a Fuchs adatbázisában…</div>';
        try {
            const { results } = await api({ action: 'search', q: text });
            if (my !== seq) return;
            lastResults = results;
            renderResults(results);
        } catch (e) {
            if (my === seq) $('results').innerHTML = `<div class="note">${esc(e.message)}</div>`;
        }
    }, 280);
});

function renderResults(results) {
    const box = $('results');
    if (!results.length) { box.innerHTML = '<div class="note">Nincs találat. Próbáld rövidebben (pl. „octavia 1.6”) vagy motorkóddal.</div>'; return; }
    // Ha az alvázszámból tudjuk az évjáratot, a nem illő típusok halványak és hátrébb kerülnek.
    const year = vinYear($('vin').value);
    const fits = (r) => !year || !r.yearStart || (r.yearStart <= year && (!r.yearEnd || r.yearEnd >= year));
    const sorted = [...results].sort((a, b) => fits(b) - fits(a));
    box.innerHTML = sorted.map((r) => `
        <button class="res${fits(r) ? '' : ' dim'}" data-id="${r.typeId}">
          <span class="t">${esc(r.make)} ${esc(r.type)}</span>
          <span class="code">${esc(r.engineCode || '—')}</span>
          <span class="m">${esc([years(r.yearStart, r.yearEnd), r.fuel, r.powerKw && `${r.powerKw} kW / ${r.powerHp} LE`].filter(Boolean).join(' · '))}</span>
        </button>`).join('') + (results.length >= 40 ? '<div class="note">Sok találat - pontosíts (évjárat, kW, motorkód).</div>' : '');
}

$('results').addEventListener('click', (ev) => {
    const btn = ev.target.closest('.res');
    if (btn) loadVehicle(btn.dataset.id);
});

// ---------- Egy autó ----------
async function loadVehicle(typeId) {
    $('results').querySelectorAll('.res').forEach((b) => b.setAttribute('aria-pressed', b.dataset.id === String(typeId)));
    let data;
    try {
        data = await api({ action: 'vehicle', typeId });
    } catch (e) {
        $('results').insertAdjacentHTML('afterbegin', `<div class="note">${esc(e.message)}</div>`);
        return;
    }
    state.data = data;
    state.oilCode = data.chosenOil;
    state.liters = data.liters;
    state.filter = data.filter;
    state.overrides = {};
    state.doneIn = null;

    const v = data.vehicle;
    $('vehicle').innerHTML = `<div class="t">${esc(v.make)} ${esc(v.type)}</div>
        <div class="m">Motorkód: <b class="mono">${esc(v.engineCode || '—')}</b> · ${esc([years(v.yearStart, v.yearEnd), v.fuel, v.ccm && `${v.ccm} cm³`, v.powerKw && `${v.powerKw} kW`].filter(Boolean).join(' · '))}</div>`;
    $('cap').textContent = data.capacityL ? fmtL(data.capacityL) : 'nincs adat';
    $('liters').value = String(data.liters || '').replace('.', ',');
    $('fuchs-link').href = v.fuchsUrl;
    renderOils();
    renderFilter();
    $('card-oil').hidden = false;
    $('card-filter').hidden = false;
    render();
    if (window.innerWidth < 880) $('card-oil').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderOils() {
    const { oils, oilPrices } = state.data;
    if (!oils.length) { $('oils').innerHTML = '<div class="hint">A Fuchs erre a motorra nem ad olajajánlást.</div>'; return; }
    $('oils').innerHTML = oils.map((o) => {
        const p = oilPrices[o.code];
        const uses = o.uses.map((u) => `${u.name}${u.interval ? ' (' + u.interval + ')' : ''}`).join(' · ');
        return `<label class="oil"><input type="radio" name="oil" value="${esc(o.code)}" ${o.code === state.oilCode ? 'checked' : ''}>
            <span class="t">${esc(o.name)}${o.approved ? '<span class="badge">gyári jóváhagyás</span>' : ''}</span>
            <span class="m">Fuchs kód: <span class="mono">${esc(o.code)}</span>${p?.cikkszam ? ` · Unix: <span class="mono">${esc(p.cikkszam)}</span>` : ''} · ${esc(uses)}</span></label>`;
    }).join('');
}
$('oils').addEventListener('change', (ev) => {
    if (ev.target.name !== 'oil') return;
    state.oilCode = ev.target.value;
    delete state.overrides.oil;
    render();
});
$('liters').addEventListener('input', () => {
    const n = parseNum($('liters').value);
    if (n != null && n >= 0 && n < 50) { state.liters = n; delete state.overrides.oil; render(); }
});

// ---------- Szűrő ----------
function renderFilter() {
    const f = state.filter, eng = state.data.vehicle.engineCode;
    $('filter-src').textContent = f ? f.source : '';
    if (f) {
        $('filter-found').innerHTML = `<div class="found">
            <span class="code">${esc(f.cikkszam)}</span>
            <button class="linkbtn" type="button" id="f-change">Másik szűrő</button>
            <span class="m">${esc([f.brand, f.net != null ? 'beszerzés ' + huf(f.net) + ' + ÁFA' : 'ár hiányzik', eng && `motorkód ${eng}`].filter(Boolean).join(' · '))}</span>
          </div>`;
        $('filter-found').hidden = false;
        $('filter-form').hidden = true;
        $('f-change').onclick = () => showFilterForm(f);
    } else {
        $('filter-found').hidden = true;
        showFilterForm(null);
    }
}
function showFilterForm(f) {
    const eng = state.data.vehicle.engineCode;
    $('filter-why').innerHTML = f
        ? 'Add meg a helyes szűrőt - ezentúl ez jön erre a motorra.'
        : eng
            ? `Ehhez a motorhoz (<b class="mono">${esc(eng)}</b>) még nincs szűrő a táblában. Add meg egyszer, és legközelebb minden ${esc(eng)} motoros autónál magától jön.`
            : 'A Fuchs nem ad motorkódot ehhez az autóhoz, így a szűrő csak erre az ajánlatra kerül fel.';
    $('f-code').value = f?.cikkszam || '';
    $('f-brand').value = f?.brand || '';
    $('f-net').value = f?.net ?? '';
    $('filter-form').hidden = false;
    $('f-code').focus();
}
$('filter-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const entry = { cikkszam: $('f-code').value.trim(), brand: $('f-brand').value.trim(), net: parseNum($('f-net').value) };
    if (!entry.cikkszam) return;
    const eng = state.data.vehicle.engineCode;
    if (eng) {
        try {
            const r = await api(null, { action: 'filter', engineCode: eng, ...entry, source: 'szerelő adta meg' });
            state.filter = r.filter;
        } catch (e) {
            state.filter = { ...entry, source: 'csak erre az ajánlatra' };
        }
    } else {
        state.filter = { ...entry, source: 'csak erre az ajánlatra' };
    }
    delete state.overrides.filter;
    renderFilter();
    render();
});

// ---------- Ajánlat ----------
function currentQuote() {
    const { data, shop } = state;
    const oil = data.oils.find((o) => o.code === state.oilCode) || null;
    return buildQuote({ shop, oil, liters: state.liters, oilPrice: oil ? data.oilPrices[oil.code] : null, filter: state.filter, overrides: state.overrides });
}

function render() {
    if (!state.data || !state.shop) return;
    const q = currentQuote();
    const v = state.data.vehicle;
    $('quote-empty').hidden = true;
    $('quote').hidden = false;

    $('lines').innerHTML = q.lines.map((l) => {
        let sub = '';
        if (l.key === 'oil') sub = `<span class="cik">${esc(l.cikkszam)}</span> · <a href="${esc(v.fuchsUrl)}" target="_blank" rel="noopener">Fuchs ↗</a>`;
        else if (l.key === 'filter') sub = l.cikkszam
            ? `<span class="cik">${esc(l.cikkszam)}</span> · <a href="https://www.google.com/search?q=${encodeURIComponent(l.cikkszam + ' olajszűrő')}" target="_blank" rel="noopener">keresés ↗</a>`
            : '<span class="miss">cikkszám hiányzik</span>';
        else if (l.cikkszam) sub = `<span class="cik">${esc(l.cikkszam)}</span>`;
        const src = l.priceMissing ? `<span class="miss">${esc(l.source)}</span>` : esc(l.source);
        const qtyTxt = l.unit === 'l' ? String(l.qty).replace('.', ',') : String(l.qty);
        return `<tr>
          <td><div class="lab">${esc(l.label)}</div><div class="sub">${sub}${sub ? ' · ' : ''}${src}</div></td>
          <td class="r"><input class="cell${state.overrides[l.key]?.qty != null ? ' edited' : ''}" data-k="${l.key}" data-f="qty" value="${esc(qtyTxt)}" aria-label="${esc(l.label)} mennyiség"> ${l.unit}</td>
          <td class="r"><input class="cell${state.overrides[l.key]?.unitNet != null ? ' edited' : ''}" data-k="${l.key}" data-f="unitNet" value="${l.unitNet}" aria-label="${esc(l.label)} egységár"></td>
          <td class="r">${huf(l.net)}</td>
        </tr>`;
    }).join('');

    $('t-net').textContent = huf(q.net);
    $('t-vat-l').textContent = `ÁFA ${Math.round(state.shop.vatRate * 100)}%`;
    $('t-vat').textContent = huf(q.vat);
    $('t-gross').textContent = huf(q.gross);

    const missing = q.lines.filter((l) => l.priceMissing).map((l) => l.key === 'oil' ? 'olaj ára (MINTA ár)' : l.key === 'filter' ? 'olajszűrő' : l.label);
    $('warn').hidden = !missing.length;
    $('warn').textContent = missing.length ? `Még hiányzik: ${missing.join(', ')}. A valós Unix-árak a műhely számláiból kerülnek be.` : '';

    $('plain').textContent = quoteText({ shop: state.shop, vehicle: v, vin: cleanVin($('vin').value), quote: q });

    if (state.t0 && state.doneIn == null && q.lines.find((l) => l.key === 'filter').cikkszam) {
        state.doneIn = Math.max(1, Math.round((performance.now() - state.t0) / 1000));
    }
    $('timer').textContent = state.doneIn != null ? `kész ${state.doneIn} mp alatt` : '';
}

// A szerelő bármelyik számot átírhatja; csak az átírt szám számít.
$('lines').addEventListener('change', (ev) => {
    const el = ev.target.closest('.cell');
    if (!el) return;
    const n = parseNum(el.value);
    const o = state.overrides[el.dataset.k] || (state.overrides[el.dataset.k] = {});
    if (n == null || n < 0) delete o[el.dataset.f]; else o[el.dataset.f] = n;
    render();
});

$('copy').addEventListener('click', async () => {
    try {
        await navigator.clipboard.writeText($('plain').textContent);
        $('copy').textContent = 'Kimásolva ✓';
    } catch {
        $('copy').textContent = 'Nem sikerült - jelöld ki lent';
        $('plain').closest('details').open = true;
    }
    setTimeout(() => { $('copy').textContent = 'Ajánlat másolása'; }, 1800);
});

$('reset').addEventListener('click', () => {
    Object.assign(state, { data: null, filter: null, overrides: {}, t0: null, doneIn: null });
    $('vin').value = ''; $('q').value = ''; $('vin-hint').textContent = '';
    $('results').innerHTML = ''; lastResults = [];
    $('card-oil').hidden = true; $('card-filter').hidden = true;
    $('quote').hidden = true; $('quote-empty').hidden = false; $('timer').textContent = '';
    window.scrollTo({ top: 0, behavior: 'smooth' });
    $('vin').focus();
});

// ---------- Fülek ----------
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((x) => { x.classList.toggle('is-on', x === t); x.setAttribute('aria-selected', x === t); });
    ['quote', 'parts', 'proof'].forEach((k) => { $('view-' + k).hidden = t.dataset.tab !== k; });
}));

// ---------- Ellenőrzés ----------
$('run-proof').addEventListener('click', async () => {
    const box = $('proof');
    box.innerHTML = '<div class="hint">Fut…</div>';
    try {
        const { results } = await api({ action: 'proof' });
        if (!results.length) {
            box.innerHTML = '<div class="empty">Ide kerülnek a műhely korábbi olajcsere-ajánlatai. Amint megjönnek, a rendszer mindegyiket újraszámolja, és soronként összeveti.</div>';
            return;
        }
        const good = results.filter((r) => r.ok).length;
        box.innerHTML = `<div class="score">${good} / ${results.length} egyezik</div>` + results.map((r) => r.error
            ? `<div class="pcase bad"><div class="h"><span>${esc(r.id)}</span><span class="x">hiba</span></div><div class="hint">${esc(r.error)}</div></div>`
            : `<div class="pcase ${r.ok ? 'ok' : 'bad'}">
                <div class="h"><span>${esc(r.id)} · ${esc(r.vehicle.make)} ${esc(r.vehicle.type)}</span><span class="muted">${(r.ms / 1000).toFixed(1)} mp</span></div>
                <table>${r.checks.map((c) => `<tr><td>${esc(c.what)}</td><td>ajánlaton: <b>${esc(typeof c.expected === 'number' && c.what === 'Végösszeg' ? huf(c.expected) : c.expected ?? '-')}</b></td><td>rendszer: <b>${esc(typeof c.got === 'number' && c.what === 'Végösszeg' ? huf(c.got) : c.got)}</b></td><td class="${c.ok ? 'y' : 'x'}">${c.ok ? '✓' : '✗'}</td></tr>`).join('')}</table>
              </div>`).join('');
    } catch (e) {
        box.innerHTML = `<div class="hint">${esc(e.message)}</div>`;
    }
});
