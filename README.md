# Szerviz-árajánlat - Mobil Star Szerviz, prototípus

A munkafelvevőnek készült.

## Új ajánlat (alapfül) - TecDoc és Fuchs nélkül

1. **Autó:** márka, típus, motor (`public/cars.json`), **motorkód**, gyártás
   hónapja, alvázszám (nem kötelező). A motorkód a kulcs: erre jegyez meg mindent.
2. **Munka:** egy vagy több (olajcsere, kis szerviz, fék, vezérlés, kuplung…).
3. **Olajcsere / kis szerviz:** olajszűrő a MANN-táblából (`data/filters.json`).
   A változatokat (`lib/store.js` filterOptions) kezeli: dátum szerint magától
   választ a gyártás hónapjából, ház-, motorszám- vagy autófüggőnél jelöl, a
   motorcsalád-találatot jelzi. A MANN-szám megfelelője a műhely márkájában
   (pl. Bosch) egyszer megadva, utána az jön. Az olaj és a mennyiség
   motorkódonként megjegyezve.
4. **Többi munka:** az alkatrész (márka, cikkszám, mennyiség) egyszer beírva,
   ugyanilyen motornál magától jön. Féknél tengelyenként (első / hátsó / mindkettő).
   Szabad tétel is felvehető.
5. **Apró tételek és munkadíj** munkánként: a műhely fix díja (`lib/shop.js`
   PROFILES jobLabour), különben becsült normaidő x óradíj (átírható).
6. **Ajánlat:** soronkénti kedvezmény, ügyféladatok, PDF a műhely kísérőlevelével
   (`public/print.js`). Minden átírt ár megjegyződik (cikkszám / olajnév szerint).
7. **Korábbi ajánlatok** fül: a kinyomtatottak listája, újranyomtatható
   (ügyféladat: élesítés előtt adatfeldolgozói szerződés kell).

## Alvázszámból (teszt) - csak `?dev=1` vagy `?teszt=1` linkkel

Ügyfélnek nem látszik: nem licencelt TecDoc-másolatra épül.

1. **Alvázszám → autó** (TecDoc).
2. **Munka:** olajcsere, kis szerviz, vezérműszíj/-lánc, fék, kuplung,
   lengéscsillapító (`lib/tecdoc.js` JOBS).
3. **Kérdések, aztán ajánlás** (`public/pick.js`): csak azt kérdezi, amiben az
   autóra illő alkatrészek tényleg különböznek (fékrendszer, tárcsaátmérő…),
   aztán a műhely márkájából ajánl (`lib/shop.js` brandsByPart). Kép és magyar
   műszaki adat minden cikknél.
4. **Motorolaj a Fuchs-ból**, ha a munkához kell: a szerelő egyszer rábök a motorra.
5. **Mellé járó tételek** munkánként (fékfolyadék, fagyálló…), ki-be kapcsolhatók.
6. **Ajánlat:** ügyfél, rendszám, ajánlatszám, PDF a műhely fejlécével.
7. **Tanul** (`data/learned.json`): autónként megjegyzi a válaszokat, a választott
   cikket, a Fuchs-motort és a kézzel beírt árakat - legközelebb nem kérdez.

Adatforrás most: RapidAPI TecDoc-másolat (`RAPIDAPI_KEY`, csak demóra, a
válaszok a `.tecdoc-cache/`-ben). Élesben: licencelt TecDoc + a műhely Inter
Cars nettó árai.

## Olajcsere típusból (alvázszám nélkül)

A munkafelvevőnek készült: **autó → Fuchs olaj → cikkszám → ár → kész
ajánlat**, fél perc alatt, minden sor mellett a forrás linkjével.

### Mit csinál

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
