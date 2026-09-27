// ---------------------------------------------------------------------------
//  Az ajánlat számolása - böngészőben és szerveren ugyanez fut.
//  Az árat mindig ez a kód számolja, sosem az AI. Amihez még nincs valós
//  forrás (a Unix ár), azt jelöljük (priceMissing), és a végösszeg
//  megmondja, hogy még nem teljes.
// ---------------------------------------------------------------------------

export function chargedLiters(capacityL, rounding) {
    if (!(capacityL > 0)) return 0;
    if (rounding === 'whole') return Math.ceil(capacityL - 1e-9);
    if (rounding === 'half') return Math.ceil(capacityL * 2 - 1e-9) / 2;
    return Math.round(capacityL * 10) / 10;
}

// A műhely saját olajai közül az első, amit a Fuchs erre az autóra ajánl;
// ha nincs ilyen, a Fuchs első ajánlása.
export function pickOil(oils, preferred = []) {
    if (!oils || !oils.length) return null;
    for (const code of preferred) {
        const hit = oils.find((o) => o.code === code);
        if (hit) return hit;
    }
    return oils[0];
}

const ft = (n) => Math.round(n);

// input: { shop, oil, liters, oilPrice, filter, overrides }
//   oilPrice:  { cikkszam, netPerLiter, source } | null  (Unix)
//   filter:    { cikkszam, brand, net, source } | null    (Unix / tábla)
//   overrides: { [sorkulcs]: { qty?, unitNet? } }         (a szerelő átírta)
// Hiányzó árnál nem nulla megy a végösszegbe csendben: az olaj MINTA árral
// számol, a szűrő 0-val, és mindkettő priceMissing jelzést kap.
export function buildQuote({ shop, oil, liters, oilPrice, filter, overrides = {} }) {
    const markup = 1 + (shop.partsMarkup || 0);
    const lines = [];
    const add = (l) => {
        const o = overrides[l.key] || {};
        const qty = o.qty ?? l.qty;
        const unitNet = o.unitNet ?? l.unitNet;
        const edited = o.qty != null || o.unitNet != null;
        const priceMissing = l.priceMissing && o.unitNet == null;
        lines.push({ ...l, qty, unitNet, net: ft(qty * unitNet), edited, priceMissing,
            source: o.unitNet != null && l.priceMissing ? 'kézzel megadva' : l.source });
    };

    if (oil) {
        add({
            key: 'oil',
            label: `FUCHS ${oil.name}`,
            cikkszam: oilPrice?.cikkszam || oil.code,
            fuchsCode: oil.code,
            qty: liters,
            unit: 'l',
            unitNet: ft((oilPrice ? oilPrice.netPerLiter : shop.fallbackOilNetPerLiter || 0) * markup),
            priceMissing: !oilPrice,
            source: oilPrice ? oilPrice.source || 'árlista' : 'MINTA ár - a valós a Unix-számlából jön',
        });
    }

    const filterNet = filter?.net != null ? ft(filter.net * markup) : null;
    add({
        key: 'filter',
        label: filter?.brand ? `Olajszűrő, ${filter.brand}` : 'Olajszűrő',
        cikkszam: filter?.cikkszam || '',
        qty: 1,
        unit: 'db',
        unitNet: filterNet ?? 0,
        priceMissing: filterNet == null,
        source: !filter ? 'szűrő hiányzik' : filterNet == null ? `${filter.source || 'tábla'} · ár hiányzik` : filter.source || 'árlista',
    });

    for (const x of shop.extras || []) {
        add({ key: x.key, label: x.label, cikkszam: x.cikkszam || '', qty: x.qty, unit: 'db',
            unitNet: ft(x.unitNet * (x.markup ? markup : 1)), source: 'műhely' });
    }
    add({ key: 'labour', label: shop.labour.label, cikkszam: '', qty: 1, unit: 'db', unitNet: shop.labour.net, source: 'műhely' });

    const net = lines.reduce((s, l) => s + l.net, 0);
    const vat = ft(net * shop.vatRate);
    const pending = lines.filter((l) => l.priceMissing).map((l) => l.key);
    return { lines, net, vat, gross: net + vat, complete: pending.length === 0, pending };
}

export const huf = (n) => new Intl.NumberFormat('hu-HU').format(Math.round(n)) + ' Ft';
export const liters = (n) => String(n).replace('.', ',') + ' l';

// Sima szöveges ajánlat, amit a munkafelvevő kimásol az ügyfélnek.
export function quoteText({ shop, vehicle, vin, quote }) {
    const rows = quote.lines.map((l) => {
        const qty = l.unit === 'l' ? liters(l.qty) : `${l.qty} db`;
        const code = l.cikkszam ? ` (${l.cikkszam})` : '';
        return `• ${l.label}${code}: ${qty} → ${l.priceMissing && l.key !== 'oil' ? 'ár később' : huf(l.net)}`;
    });
    const car = [vehicle.make, vehicle.type].filter(Boolean).join(' ') + (vehicle.engineCode ? ` (${vehicle.engineCode})` : '');
    return [
        `${shop.name} - Árajánlat: olajcsere`,
        `Autó: ${car}`,
        ...(vin ? [`Alvázszám: ${vin}`] : []),
        '',
        ...rows,
        '',
        `Nettó${quote.complete ? '' : ' (eddig)'}: ${huf(quote.net)}`,
        `ÁFA ${Math.round(shop.vatRate * 100)}%: ${huf(quote.vat)}`,
        `Fizetendő${quote.complete ? '' : ' (előzetes)'}: ${huf(quote.gross)}`,
    ].join('\n');
}
