/**
 * Erzeugt build/icon.ico für Windows und build/icon.png für Linux.
 *
 * Gezeichnet wird in tools/symbol.mjs — dieselbe Quelle, aus der auch das
 * macOS-Symbol entsteht. Sonst driften die Symbole mit der Zeit auseinander.
 *
 * Aufruf: npm run icon
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { zeichne, png } from "./symbol.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GROESSEN = [256, 128, 64, 48, 32, 16];

/** Symboldatei im ICO-Format. Seit Vista duerfen die Bilder PNG sein. */
function ico(bilder) {
  const kopf = Buffer.alloc(6);
  kopf.writeUInt16LE(0, 0);
  kopf.writeUInt16LE(1, 2);            /* Typ 1 = Symbol */
  kopf.writeUInt16LE(bilder.length, 4);

  const eintraege = [];
  let versatz = 6 + bilder.length * 16;

  for (const { groesse, daten } of bilder) {
    const e = Buffer.alloc(16);
    e[0] = groesse >= 256 ? 0 : groesse;  /* 0 steht fuer 256 */
    e[1] = groesse >= 256 ? 0 : groesse;
    e[2] = 0;                             /* Farbpalette: keine */
    e[3] = 0;
    e.writeUInt16LE(1, 4);                /* Ebenen */
    e.writeUInt16LE(32, 6);               /* Bit je Bildpunkt */
    e.writeUInt32LE(daten.length, 8);
    e.writeUInt32LE(versatz, 12);
    eintraege.push(e);
    versatz += daten.length;
  }

  return Buffer.concat([kopf, ...eintraege, ...bilder.map((b) => b.daten)]);
}

const bilder = GROESSEN.map((groesse) => ({ groesse, daten: png(groesse, zeichne(groesse)) }));

await fs.mkdir(path.join(root, "build"), { recursive: true });
await fs.writeFile(path.join(root, "build", "icon.ico"), ico(bilder));
await fs.writeFile(path.join(root, "build", "icon.png"), bilder[0].daten);

console.log("build/icon.ico geschrieben (" + GROESSEN.join(", ") + " Punkt) und build/icon.png fuer Linux.");
