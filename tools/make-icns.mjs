/**
 * Erzeugt build/icon.icns aus denselben gezeichneten Bildern wie das
 * Windows-Symbol — kein Bildprogramm, kein macOS noetig.
 *
 * Eine .icns-Datei ist ein einfacher Behaelter: Kennung "icns", Gesamtlaenge,
 * danach Bloecke aus Vierzeichen-Kennung, Laenge und Nutzdaten. Seit OS X
 * 10.7 duerfen die Nutzdaten unmittelbar PNG sein, was das Schreiben auf
 * jedem Betriebssystem moeglich macht.
 *
 * Aufruf: npm run icon:mac
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { zeichne, png } from "./symbol.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Welche Kantenlaenge unter welcher Kennung erwartet wird.
 * "ic07" und aufwaerts nehmen PNG entgegen; die kleinen Groessen kommen
 * ueber die Retina-Kennungen mit hinein.
 */
const BLOECKE = [
  { kennung: "icp4", groesse: 16 },
  { kennung: "icp5", groesse: 32 },
  { kennung: "ic11", groesse: 32 },   /* 16pt @2x */
  { kennung: "ic07", groesse: 128 },
  { kennung: "ic12", groesse: 64 },   /* 32pt @2x */
  { kennung: "ic08", groesse: 256 },
  { kennung: "ic13", groesse: 256 },  /* 128pt @2x */
  { kennung: "ic09", groesse: 512 },
  { kennung: "ic14", groesse: 512 },  /* 256pt @2x */
  { kennung: "ic10", groesse: 1024 }  /* 512pt @2x */
];

/** Ein Block: vier Zeichen Kennung, Gesamtlaenge, Nutzdaten. */
function block(kennung, daten) {
  const kopf = Buffer.alloc(8);
  kopf.write(kennung, 0, 4, "ascii");
  kopf.writeUInt32BE(daten.length + 8, 4);
  return Buffer.concat([kopf, daten]);
}

/* Gleiche Groessen nur einmal zeichnen — 1024 Punkte kosten spuerbar Zeit. */
const zwischenlager = new Map();
const bildFuer = (groesse) => {
  if (!zwischenlager.has(groesse)) zwischenlager.set(groesse, png(groesse, zeichne(groesse)));
  return zwischenlager.get(groesse);
};

const bloecke = BLOECKE.map(({ kennung, groesse }) => block(kennung, bildFuer(groesse)));
const inhalt = Buffer.concat(bloecke);

const kopf = Buffer.alloc(8);
kopf.write("icns", 0, 4, "ascii");
kopf.writeUInt32BE(inhalt.length + 8, 4);

await fs.mkdir(path.join(root, "build"), { recursive: true });
await fs.writeFile(path.join(root, "build", "icon.icns"), Buffer.concat([kopf, inhalt]));

console.log("build/icon.icns geschrieben (" + BLOECKE.length + " Bloecke, "
  + [...new Set(BLOECKE.map((b) => b.groesse))].sort((a, b) => a - b).join("/") + " Punkt).");
