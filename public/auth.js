// ---------------------------------------------------------------------------
//  Egyszerű jelszó: egyszer kérjük, a böngésző megjegyzi. Ha a szerver 401-et
//  ad (rossz vagy hiányzó jelszó), újra megkérdezzük.
// ---------------------------------------------------------------------------
const KEY = 'olajcsere-pass';
const stored = () => { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } };
const remember = (p) => { try { localStorage.setItem(KEY, p); } catch {} };

export async function apiFetch(url, opts = {}) {
    for (let attempt = 0; attempt < 3; attempt++) {
        const res = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), 'x-pass': stored() } });
        if (res.status !== 401) return res;
        const p = window.prompt('Jelszó:');
        if (p == null) return res;
        remember(p.trim());
    }
    return fetch(url, { ...opts, headers: { ...(opts.headers || {}), 'x-pass': stored() } });
}
