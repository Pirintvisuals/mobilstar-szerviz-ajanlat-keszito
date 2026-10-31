// node tools/ic-import.mjs <ProductInformation.csv> [kimenet.json]
// Az Inter Cars napi termékfájljából márka + cikkszám -> SKU tábla (lib/intercars.js).
// A kimenet IC-adat, a repo nyilvános: alapból a gitignore-olt private/ mappába kerül.
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';
import { skuTable } from '../lib/intercars.js';

const [src, dest = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'private', 'ic-sku.json')] = process.argv.slice(2);
if (!src) { console.error('Használat: node tools/ic-import.mjs <ProductInformation.csv> [kimenet.json]'); process.exit(1); }

const t = skuTable();
let n = 0;
for await (const line of readline.createInterface({ input: fs.createReadStream(src, 'utf8'), crlfDelay: Infinity })) {
    if (line.trim()) { t.add(line.replace(/^﻿/, '')); n++; }
}
const { skus, ambiguous } = t.result();
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, JSON.stringify(skus));
console.log(`${n - 1} sor -> ${Object.keys(skus).length} márka + cikkszám, ${ambiguous} kétértelmű kihagyva.`);
console.log(`Mentve: ${dest} (${Math.round(fs.statSync(dest).size / 1e6)} MB)`);
