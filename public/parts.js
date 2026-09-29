// ---------------------------------------------------------------------------
//  Alvázszám -> autó -> munka -> alkatrészek a műhely márkáival -> ajánlat.
//  Az ár még kézzel megy: élesben a műhely nagykerének (Inter Cars) nettó
//  ára kerül a sorba. Az árat itt is a kód számolja, sosem az AI.
// ---------------------------------------------------------------------------
import { huf } from './quote.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const api = async (params) => {
    const res = await fetch('/api/olajcsere?' + new URLSearchParams(params));
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || 'HTTP ' + res.status);
    if (json.status) showLeft(json.status);
    return json;
};
const parseNum = (s) => {
    const n = parseFloat(String(s).replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : null;
};
const fmtQty = (n) => String(n).replace('.', ',');

const st = { shop: null, jobs: [], car: null, loaded: [], groups: [], oemLines: [], prices: {}, qty: {}, hours: null };

function showLeft(s) {
    $('td-left').textContent = s.remaining != null ? `tesztkeret: ${s.remaining} kérés maradt` : 'TecDoc-teszt';
}

Promise.all([api({ action: 'config' }), api({ action: 'td-status' })]).then(([cfg, td]) => {
    st.shop = cfg.shop;
    st.jobs = td.jobs;
    showLeft(td);
    if (!td.configured) $('td-vin-hint').innerHTML = '<b>A TecDoc-teszt nincs beállítva</b> (RAPIDAPI_KEY a .env.local-ban).';
}).catch((e) => { $('td-vin-hint').textContent = e.message; });

// ---------- 1. Autó ----------
$('td-vin-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const vin = $('td-vin').value.toUpperCase().replace(/[^A-Z0-9]/g, '');
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
    Object.assign(st, { car: { vehicleId, name }, loaded: [], groups: [], hours: null, prices: {}, qty: {} });
    $('td-car').innerHTML = `<div class="t">${esc(name)}</div><div class="m">TecDoc jármű: <b class="mono">${esc(vehicleId)}</b></div>`;
    renderJobs();
    $('td-card-job').hidden = false;
    renderGroups();
    render();
}

// ---------- 2. Munka ----------
function renderJobs() {
    $('td-jobs').innerHTML = st.jobs.map((j) => {
        const on = st.loaded.includes(j.key);
        return `<button type="button" class="chip${on ? ' on' : ''}" data-job="${j.key}" aria-pressed="${on}">${esc(j.label)}
            <span class="m">${esc(j.parts.join(', '))}</span></button>`;
    }).join('');
}
$('td-jobs').addEventListener('click', async (ev) => {
    const b = ev.target.closest('.chip');
    if (!b || !st.car) return;
    const key = b.dataset.job;
    if (st.loaded.includes(key)) {           // második kattintás: kiveszi
        st.loaded = st.loaded.filter((k) => k !== key);
        st.groups = st.groups.filter((g) => g.job !== key);
        renderJobs(); renderGroups(); render();
        return;
    }
    b.classList.add('busy');
    b.disabled = true;
    try {
        const r = await api({ action: 'td-job', vehicleId: st.car.vehicleId, job: key });
        st.loaded.push(key);
        r.parts.forEach((p, i) => {
            const pick = p.articles.findIndex((a) => a.preferred);
            st.groups.push({ id: `${key}-${i}`, job: key, label: p.label, qty: p.qty || 1, category: p.category, articles: p.articles, sel: pick >= 0 ? pick : null });
        });
    } catch (e) {
        alertIn($('td-jobs'), e.message);
    }
    renderJobs(); renderGroups(); render();
});
const alertIn = (el, msg) => el.insertAdjacentHTML('afterend', `<div class="hint">${esc(msg)}</div>`);

// ---------- 3. Alkatrészek, márkák ----------
function option(g, a, i) {
    return `<label class="oil"><input type="radio" name="g-${g.id}" value="${i}" ${g.sel === i ? 'checked' : ''}>
        <span class="t">${esc(a.brand)} <span class="mono">${esc(a.articleNo)}</span>${a.preferred ? '<span class="badge">a műhely márkája</span>' : ''}</span>
        <span class="m">${esc(a.name)}</span></label>`;
}
// A kiválasztott márkából több cikkszám is illik? Akkor a szerelőnek kell döntenie.
function twins(g) {
    const a = g.sel != null ? g.articles[g.sel] : null;
    return a && g.articles.filter((x) => x.brand === a.brand).length > 1 ? a.brand : '';
}
function renderGroups() {
    const open = new Set([...$('td-parts').querySelectorAll('[data-g] details[open]')].map((d) => d.closest('[data-g]').dataset.g));
    $('td-parts').innerHTML = st.groups.map((g) => {
        if (!g.category) return `<div class="card"><h2>${esc(g.label)}</h2><div class="hint">Ehhez az autóhoz a TecDoc nem ad ilyen csoportot.</div></div>`;
        const brands = new Set(g.articles.map((a) => a.brand)).size;
        const top = g.articles.map((a, i) => [a, i]).filter(([a]) => a.preferred).slice(0, 8);
        const shown = top.length ? top : g.articles.slice(0, 6).map((a, i) => [a, i]);
        return `<div class="card" data-g="${g.id}">
            <h2>${esc(g.label)} <span class="src">${esc(g.category.parent)} › ${esc(g.category.name)} · ${g.articles.length} cikk, ${brands} márka</span></h2>
            ${g.articles.length ? '' : '<div class="hint">Nincs illő cikk.</div>'}
            ${top.length ? '' : g.articles.length ? '<p class="hint">A műhely márkái közül egyik sincs a listában - válassz kézzel.</p>' : ''}
            ${twins(g) ? `<p class="hint"><b>Ellenőrizd:</b> ${esc(twins(g))} is több cikkszámmal illik erre az autóra (évjárat vagy motorváltozat szerint válik szét).</p>` : ''}
            <div class="oils">${shown.map(([a, i]) => option(g, a, i)).join('')}</div>
            ${g.articles.length > shown.length ? `<details class="plain"${open.has(g.id) ? ' open' : ''}><summary>Összes márka (${g.articles.length} cikk)</summary><div class="oils all">${g.articles.map((a, i) => option(g, a, i)).join('')}</div></details>` : ''}
        </div>`;
    }).join('');
}
$('td-parts').addEventListener('change', (ev) => {
    const card = ev.target.closest('[data-g]');
    if (!card || ev.target.type !== 'radio') return;
    const g = st.groups.find((x) => x.id === card.dataset.g);
    g.sel = Number(ev.target.value);
    renderGroups();
    render();
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
    st.oemLines.push({ id: `oem-${Date.now()}`, label: `Alkatrész (gyári ${oemResult.oem} helyett)`, brand: a.brand, articleNo: a.articleNo, qty: 1 });
    b.textContent = 'hozzáadva ✓';
    render();
});

// ---------- Ajánlat ----------
function lines() {
    const out = [];
    for (const g of st.groups) {
        const a = g.sel != null ? g.articles[g.sel] : null;
        if (a) out.push({ key: g.id, label: `${g.label}, ${a.brand}`, cikkszam: a.articleNo, qty: g.qty, unit: 'db', part: true });
    }
    for (const o of st.oemLines) out.push({ key: o.id, label: `${o.label}, ${o.brand}`, cikkszam: o.articleNo, qty: o.qty, unit: 'db', part: true, removable: true });
    if (out.length) {
        const jobHours = st.jobs.filter((j) => st.loaded.includes(j.key)).reduce((s, j) => s + j.hours, 0);
        const hours = st.hours ?? (jobHours || 1);
        out.push({ key: 'labour', label: 'Munkadíj', cikkszam: '', qty: hours, unit: 'óra', rate: st.shop.hourlyRate });
    }
    return out.map((l) => {
        const qty = st.qty[l.key] ?? l.qty;
        const unitNet = l.key === 'labour' ? (st.prices.labour ?? l.rate) : st.prices[l.key] ?? null;
        return { ...l, qty, unitNet, net: Math.round(qty * (unitNet || 0)), priceMissing: unitNet == null };
    });
}

function render() {
    if (!st.shop) return;
    const ls = lines();
    $('td-quote-empty').hidden = ls.length > 0;
    $('td-quote').hidden = ls.length === 0;
    if (!ls.length) return;

    $('td-lines').innerHTML = ls.map((l) => `<tr>
        <td><div class="lab">${esc(l.label)}${l.removable ? ` <button class="linkbtn" type="button" data-rm="${l.key}" aria-label="Törlés">✕</button>` : ''}</div>
            <div class="sub">${l.cikkszam ? `<span class="cik">${esc(l.cikkszam)}</span> · ` : ''}${l.part ? (l.priceMissing ? '<span class="miss">ár: Inter Cars (még kézzel)</span>' : 'kézzel megadva') : `${huf(st.prices.labour ?? l.rate)}/óra · a szerelő dönti el`}</div></td>
        <td class="r"><input class="cell" data-k="${l.key}" data-f="qty" value="${esc(fmtQty(l.qty))}" aria-label="${esc(l.label)} mennyiség"> ${l.unit}</td>
        <td class="r"><input class="cell${l.priceMissing ? ' edited' : ''}" data-k="${l.key}" data-f="price" value="${l.unitNet ?? ''}" placeholder="ár" aria-label="${esc(l.label)} egységár"></td>
        <td class="r">${l.priceMissing ? '–' : huf(l.net)}</td></tr>`).join('');

    const net = ls.reduce((s, l) => s + l.net, 0);
    const vat = Math.round(net * st.shop.vatRate);
    $('td-net').textContent = huf(net);
    $('td-vat-l').textContent = `ÁFA ${Math.round(st.shop.vatRate * 100)}%`;
    $('td-vat').textContent = huf(vat);
    $('td-gross').textContent = huf(net + vat);

    const missing = ls.filter((l) => l.priceMissing).length;
    const unpicked = st.groups.filter((g) => g.category && g.articles.length && g.sel == null).map((g) => g.label);
    const warn = [
        missing && `${missing} alkatrésznek még nincs ára. Élesben a műhely Inter Cars nettó ára jön ide magától; most kézzel írható.`,
        unpicked.length && `Nincs kiválasztva: ${unpicked.join(', ')}.`,
        'Adatforrás: TecDoc-teszt (nem hivatalos) - éles ügyfélnél licencelt TecDoc.',
    ].filter(Boolean);
    $('td-warn').hidden = false;
    $('td-warn').innerHTML = warn.map(esc).join('<br>');

    const car = st.car ? st.car.name : '';
    const vin = $('td-vin').value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    $('td-plain').textContent = [
        `${st.shop.name} - Árajánlat`,
        car && `Autó: ${car}`,
        vin && `Alvázszám: ${vin}`,
        '',
        ...ls.map((l) => `• ${l.label}${l.cikkszam ? ` (${l.cikkszam})` : ''}: ${fmtQty(l.qty)} ${l.unit} → ${l.priceMissing ? 'ár később' : huf(l.net)}`),
        '',
        `Nettó${missing ? ' (eddig)' : ''}: ${huf(net)}`,
        `ÁFA ${Math.round(st.shop.vatRate * 100)}%: ${huf(vat)}`,
        `Fizetendő${missing ? ' (előzetes)' : ''}: ${huf(net + vat)}`,
    ].filter((x) => x !== false && x !== null && x !== undefined).join('\n');
}

$('td-lines').addEventListener('change', (ev) => {
    const el = ev.target.closest('.cell');
    if (!el) return;
    const n = parseNum(el.value), k = el.dataset.k;
    if (el.dataset.f === 'qty') {
        if (k === 'labour') st.hours = n != null && n >= 0 ? n : null;
        else if (n == null || n < 0) delete st.qty[k]; else st.qty[k] = n;
    } else if (n == null || n < 0) delete st.prices[k]; else st.prices[k] = n;
    render();
});
$('td-lines').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-rm]');
    if (!b) return;
    st.oemLines = st.oemLines.filter((o) => o.id !== b.dataset.rm);
    render();
});

$('td-copy').addEventListener('click', async () => {
    try {
        await navigator.clipboard.writeText($('td-plain').textContent);
        $('td-copy').textContent = 'Kimásolva ✓';
    } catch {
        $('td-copy').textContent = 'Nem sikerült - jelöld ki lent';
        $('td-plain').closest('details').open = true;
    }
    setTimeout(() => { $('td-copy').textContent = 'Ajánlat másolása'; }, 1800);
});

$('td-reset').addEventListener('click', () => {
    Object.assign(st, { car: null, loaded: [], groups: [], oemLines: [], prices: {}, qty: {}, hours: null });
    $('td-vin').value = ''; $('td-vin-hint').textContent = ''; $('td-cars').innerHTML = '';
    $('td-card-job').hidden = true; $('td-parts').innerHTML = ''; $('td-oem-out').innerHTML = ''; $('td-oem').value = '';
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    $('td-vin').focus();
});
