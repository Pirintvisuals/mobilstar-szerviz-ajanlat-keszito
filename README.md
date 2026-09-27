# Olajcsere-ajánlat - Mobil Star Szerviz, prototípus

A munkafelvevőnek készült: **autó → Fuchs olaj → cikkszám → ár → kész
ajánlat**, fél perc alatt, minden sor mellett a forrás linkjével.

## Mit csinál

1. **Autó.** Alvázszám (nem kötelező; a gyártót és - ahol megbízható - az
   évjáratot kiolvassa belőle), és keresés típusra, motorra vagy motorkódra,
   pont úgy, mint a Fuchs keresője.
2. **Olaj - élőben a Fuchs olajválasztóból.** Melyik Fuchs olaj (gyári
   jóváhagyású előre), a Fuchs termékkódja, a feltöltési mennyiség, a
   csereciklus. Link: *„Megnézem ugyanezt a Fuchs oldalán"* - ugyanaz az autó
   a Fuchs saját oldalán.
3. **Olajszűrő - motorkód szerint.** A tábla a MANN-FILTER nyilvános
   katalógusából előre fel van töltve (~1000 motorkód, a 2005 utáni Fuchs
   típusok ~83%-ánál magától jön). Ha nincs találat, a szerelő egyszer megadja
   a cikkszámot, és onnantól minden ugyanilyen motorú autónál magától jön; a
   szerelő bejegyzése erősebb, mint a MANN-é.
4. **Ajánlat.** Olaj, szűrő, alátét, fáradtolaj, munkadíj, árrés, 27% ÁFA.
   Minden szám átírható. Kimásolható szöveg az ügyfélnek. Mutatja, hány
   másodperc alatt állt össze.
5. **Ellenőrzés fül.** A műhely korábbi olajcsere-ajánlatait újraszámolja, és
   soronként összeveti: ugyanaz az olaj, liter, szűrő, végösszeg?

**Az árat mindig a kód számolja (`public/quote.js`), sosem az AI.**

## Adat-slotok - ugyanaz az app a prototípusban és élesben

| slot | most | élesben |
|---|---|---|
| autó → olaj + liter | Fuchs olajválasztó (Olyslager), élő | ugyanez, írásos engedéllyel |
| motorkód → szűrő cikkszám | `data/filters.json` (MANN katalógus + szerelő) | Unix / Inter Cars / TecDoc |
| cikkszám → ár | `data/prices.json` (Unix-számlákból) | Unix / Inter Cars adatkapcsolat |
| árrés, munkadíj, kerekítés | `lib/shop.js` | ugyanez |

Élesítéskor csak a `lib/store.js` függvényei kapnak új forrást; a képernyők
és a számolás nem változnak.

## Olajszűrő-tábla: honnan jön, mire figyelj

`tools/mann-to-filters.mjs` a MANN-FILTER online katalógusból
(catalog.mann-filter.com) végigjárt autókból építi a `byEngine` táblát.
A MANN-cikkszám szabványos hivatkozás, a Unix és az Inter Cars is tartja.

- **A motorkód nem mindig elég.** Ugyanaz a kód autónként más szűrőt kaphat
  (pl. 1.9 TDI ATD: Golf IV/Octavia I HU 726/2 x, Polo IV HU 719/7 x), vagy
  szűrőház / évjárat / motorszám szerint válik ketté (Z13DT: UFI vagy
  Purflux ház). Ezek a forrásban **ELLENŐRIZD** / **vagy …** jelzést kapnak,
  a többi lehetőséggel együtt.
- **Motorcsalád-találat** (pl. a Fuchs `K9K 638`, a táblában `K9K`) a forrásban
  jelölve van: „motorcsalád alapján, ellenőrizd”.
- **Nem talál:** ahol a Fuchs csak családnevet ad kód helyett (Ford
  „Duratec”, Hyundai „Gamma”), vagy a MANN nem ír motorkódot (Suzuki SX4
  dízelek). Ott a szerelő adja meg egyszer.

## Ami még István válaszára vár

`lib/shop.js`-ben minden **MINTA** jelölésű érték: árrés, munkadíj, alátét,
fáradtolaj-díj, literkerekítés, a műhely saját olajai. A `data/prices.json`
üres, amíg meg nem jönnek a korábbi ajánlatok és Unix-számlák. Addig az
ajánlat MINTA olajárral számol, és ezt az ajánlaton jelzi.

## Futtatás

```bash
node server.js      # http://localhost:8897
npm test            # számolás, Fuchs-válasz feldolgozás, alvázszám
```

`.env.local`: `OLY_SUBSCRIPTION` (Fuchs olajválasztó hozzáférés). Nélküle a
keresés hibát ad, a többi működik.

## Jogi

A Fuchs olajválasztó adatai az Olyslager tulajdonát képezik. A Fuchs
Hungária 2026-09-23-án telefonon hozzájárult a demóhoz. **Fizetős, éles
használat előtt írásos engedély kell** (Fuchs Hungária / Olyslager).

Készítette: **Landscale Agency**
