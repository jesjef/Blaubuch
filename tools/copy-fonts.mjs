/**
 * Holt die benoetigten Schriftschnitte aus den @fontsource-Paketen nach
 * src/renderer/fonts/ und legt die Lizenztexte daneben.
 *
 * Grund: die App laeuft offline und laedt nichts nach. Die Schriften
 * gehoeren also ins Programm, nicht an einen Font-Dienst.
 *
 * Aufruf: npm run fonts
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ziel = path.join(root, "src", "renderer", "fonts");

/** Nur diese Schnitte werden im Stylesheet wirklich benutzt. */
const SCHNITTE = [
  { paket: "sora", datei: "sora-latin-600-normal.woff2" },
  { paket: "sora", datei: "sora-latin-700-normal.woff2" },
  { paket: "instrument-sans", datei: "instrument-sans-latin-400-normal.woff2" },
  { paket: "instrument-sans", datei: "instrument-sans-latin-500-normal.woff2" },
  { paket: "instrument-sans", datei: "instrument-sans-latin-600-normal.woff2" }
];

const LIZENZEN = [
  { paket: "sora", ziel: "Sora-OFL.txt" },
  { paket: "instrument-sans", ziel: "InstrumentSans-OFL.txt" }
];

await fs.mkdir(ziel, { recursive: true });

let kopiert = 0;
for (const { paket, datei } of SCHNITTE) {
  const quelle = path.join(root, "node_modules", "@fontsource", paket, "files", datei);
  try {
    await fs.copyFile(quelle, path.join(ziel, datei));
    kopiert += 1;
  } catch (err) {
    console.error("Fehlt: " + datei + " (" + err.code + ")");
    console.error("Bitte zuerst `npm install` ausfuehren.");
    process.exit(1);
  }
}

for (const { paket, ziel: name } of LIZENZEN) {
  const quelle = path.join(root, "node_modules", "@fontsource", paket, "LICENSE");
  await fs.copyFile(quelle, path.join(ziel, name)).catch(() => {
    console.warn("Lizenztext von " + paket + " nicht gefunden — bitte pruefen.");
  });
}

console.log(kopiert + " Schriftschnitte und " + LIZENZEN.length + " Lizenztexte nach src/renderer/fonts/ kopiert.");
