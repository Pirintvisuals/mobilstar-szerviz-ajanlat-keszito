// ---------------------------------------------------------------------------
//  Egyszerű jelszó: egyszer kérjük, a böngésző megjegyzi. Ha a szerver 401-et
//  ad (rossz vagy hiányzó jelszó), újra megkérdezzük. Betöltéskor több kérés
//  indul egyszerre: csak egyszer kérdezünk, a többi az így megadott jelszóval
//  próbálja újra.
// ---------------------------------------------------------------------------
const KEY = 'olajcsere-pass';
const stored = () => { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } };
const remember = (p) => { try { localStorage.setItem(KEY, p); } catch {} };

let asking = null;
function askOnce() {
    if (!asking) {
        asking = Promise.resolve().then(() => {
            const p = window.prompt('Jelszó:');
            if (p != null) remember(p.trim());
            return p;
        });
        asking.finally(() => setTimeout(() => { asking = null; }, 0));
    }
    return asking;
}

export async function apiFetch(url, opts = {}) {
    let res;
    for (let attempt = 0; attempt < 4; attempt++) {
        const sent = stored();
        res = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), 'x-pass': sent } });
        if (res.status !== 401) return res;
        if (stored() !== sent) continue; // közben egy másik kérés már megkapta a jelszót
        if (await askOnce() == null) return res;
    }
    return res;
}
