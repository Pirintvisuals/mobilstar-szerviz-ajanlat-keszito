// ---------------------------------------------------------------------------
//  Kész ajánlat: a műhely kísérőlevele és a nyomtatható lap (PDF). Az olajcsere
//  és az alvázszámos ajánlat is ezt használja, hogy ugyanúgy nézzen ki.
// ---------------------------------------------------------------------------
import { huf } from './quote.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmtQty = (n) => String(n).replace('.', ',');

// A műhely kísérőlevele (profilból): megszólítás, munkánként a saját szövege,
// lábléc, aláírás. Ha a profilban nincs levél: null.
export function letterParts(shop, { name, jobKeys = [], jobLabels = [] }) {
    const L = shop.letter;
    if (!L) return null;
    return {
        greeting: name ? `Tisztelt ${name}!` : 'Tisztelt Ügyfelünk!',
        intro: `Köszönöm, hogy megkereste cégünket ${jobLabels.join(', ')} ügyében. Alább megtalálja az ajánlatunkat a javításra.`,
        paras: [...new Set(jobKeys.flatMap((k) => L.jobs?.[k] || []))],
        footer: L.footer || [],
        signature: L.signature || [],
    };
}

export function letterText(parts) {
    if (!parts) return '';
    return [parts.greeting, '', parts.intro, '', ...parts.paras.flatMap((p) => [p, '']), ...parts.footer.flatMap((p) => [p, '']), ...parts.signature].join('\n');
}

// lines: [{ label, cikkszam, qty, unit, unitNet, disc, net, priceMissing }]
// totals: { net, vat, gross, missing }
export function printQuoteHtml({ shop: s, quoteNo, customer: c, carName, vin, lines: ls, totals: t, letter }) {
    const today = new Date(), until = new Date(today.getTime() + (s.quoteValidDays || 15) * 864e5);
    const d = (x) => x.toLocaleDateString('hu-HU');
    const initials = s.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
    const anyDisc = ls.some((l) => l.disc);
    const rows = ls.map((l) => `<tr><td>${esc(l.label)}${l.cikkszam ? `<div class="no">${esc(l.cikkszam)}</div>` : ''}</td>
        <td class="r">${esc(fmtQty(l.qty))} ${esc(l.unit)}</td><td class="r">${l.priceMissing ? '–' : esc(huf(l.unitNet))}</td>${anyDisc ? `<td class="r">${l.disc ? esc(l.disc) + '%' : ''}</td>` : ''}<td class="r">${l.priceMissing ? 'ár később' : esc(huf(l.net))}</td></tr>`).join('');
    const p = (x) => `<p>${esc(x)}</p>`;
    return `<!doctype html><html lang="hu"><head><meta charset="utf-8"><title>Árajánlat ${esc(quoteNo || '')}</title>
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
  .letter p { margin: 0 0 8px; } .letter.after { margin-top: 18px; font-size: 10pt; } .letter .sig p { margin: 0; }
  table { width: 100%; border-collapse: collapse; } th { text-align: left; font-size: 9pt; color: #555; border-bottom: 1px solid #999; padding: 5px 4px; }
  td { padding: 6px 4px; border-bottom: 1px solid #e5e5e5; vertical-align: top; } .r { text-align: right; white-space: nowrap; } .no { font-family: Consolas, monospace; font-size: 9pt; color: #555; }
  .tot { margin-left: auto; width: 45%; margin-top: 10px; } .tot div { display: flex; justify-content: space-between; padding: 2px 0; }
  .tot .g { font-size: 14pt; font-weight: 800; border-top: 2px solid #1a1d21; margin-top: 4px; padding-top: 6px; }
  .note { margin-top: 18px; font-size: 9.5pt; color: #444; } .sign { margin-top: 40px; display: flex; justify-content: space-between; font-size: 9.5pt; color: #555; }
  .sign span { border-top: 1px solid #999; padding-top: 4px; width: 40%; text-align: center; }
</style></head><body>
<div class="head">
  <div class="brand"><div class="logo">${esc(initials)}</div><div class="shop"><b>${esc(s.name)}</b><div>${esc(s.address || '')}</div><div>${esc(s.phone || '')}${s.taxNumber ? ` · Adószám: ${esc(s.taxNumber)}` : ''}</div></div></div>
  <div class="meta"><h1>Árajánlat</h1><div>Szám: <b>${esc(quoteNo || '')}</b></div><div>Kelt: ${d(today)}</div><div>Érvényes: ${d(until).replace(/\.$/, '')}-ig</div></div>
</div>
<div class="info">
  <div class="box"><div class="l">Ügyfél</div>${esc(c.name || '-')}${c.phone ? `<br>${esc(c.phone)}` : ''}</div>
  <div class="box"><div class="l">Jármű</div>${esc(carName || '-')}${c.plate ? `<br>Rendszám: <b>${esc(c.plate)}</b>` : ''}${vin ? `<br>Alvázszám: ${esc(vin)}` : ''}${c.km ? `<br>Km-óra: ${esc(c.km)}` : ''}</div>
</div>
${letter ? `<div class="letter">${p(letter.greeting)}${p(letter.intro)}</div>` : ''}
<table><thead><tr><th>Tétel</th><th class="r">Mennyiség</th><th class="r">Egységár (nettó)</th>${anyDisc ? '<th class="r">Kedv.</th>' : ''}<th class="r">Nettó</th></tr></thead><tbody>${rows}</tbody></table>
<div class="tot"><div><span>Nettó${t.missing ? ' (eddig)' : ''}</span><b>${esc(huf(t.net))}</b></div><div><span>ÁFA ${Math.round(s.vatRate * 100)}%</span><b>${esc(huf(t.vat))}</b></div>
  <div class="g"><span>Fizetendő${t.missing ? ' (előzetes)' : ''}</span><span>${esc(huf(t.gross))}</span></div></div>
${letter
        ? `<div class="letter after">${letter.paras.map(p).join('')}${letter.footer.map(p).join('')}<div class="sig">${letter.signature.map(p).join('')}</div></div>`
        : `<p class="note">${esc(s.quoteNote || '')}</p><div class="sign"><span>${esc(s.name)}</span><span>Ügyfél</span></div>`}
</body></html>`;
}
