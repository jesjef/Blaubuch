/**
 * Durchsucht das Repository nach Dingen, die nicht veroeffentlicht werden
 * sollten: Zugangsdaten, Kontonummern, personenbezogene Spuren und
 * Datendateien, die versehentlich mitgenommen wurden.
 *
 * Aufruf:  npm run check:secrets
 * Rueckgabe: 0 = sauber, 1 = etwas gefunden (taugt fuer CI und pre-commit)
 *
 * Eigene Suchbegriffe — Namen von Angehoerigen, Arbeitgeber, Bankverbindungen —
 * gehoeren in eine Datei `.secretwords` im Projektstamm: eine Zeile je Begriff,
 * `#` leitet einen Kommentar ein. Diese Datei ist in .gitignore eingetragen
 * und darf niemals mit veroeffentlicht werden — sonst waere die Liste selbst
 * das Leck.
 */

import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Ordner, die nie durchsucht werden. */
const UEBERSPRINGEN = new Set(["node_modules", ".git", "dist", "fonts"]);

/** Nur Textdateien haben lesbaren Inhalt. */
const TEXTENDUNGEN = new Set([".js", ".mjs", ".cjs", ".json", ".md", ".html", ".css", ".txt", ".yml", ".yaml"]);

/** Dateien, die im Repository nichts zu suchen haben. */
const VERBOTENE_DATEIEN = [
  { muster: /^blaubuch\.json$/i, warum: "Datendatei des Programms" },
  { muster: /^blaubuch-.*\.json$/i, warum: "Sicherung oder Kopie der Daten" },
  { muster: /^versuche\.json$/i, warum: "Zähler der Fehlversuche" },
  { muster: /\.local\.json$/i, warum: "lokale Konfiguration" },
  { muster: /^\.env($|\.)/i, warum: "Umgebungsdatei" },
  { muster: /\.(pem|key|p12|pfx|keystore)$/i, warum: "Schlüsselmaterial" },
  { muster: /^\.secretwords$/i, warum: "die Suchliste selbst — sie nennt genau das, was geheim bleiben soll" }
];

/** Allgemeine Muster, unabhaengig von dieser Person. */
const MUSTER = [
  { name: "Schweizer IBAN", regex: /\bCH\d{2}[ ]?(?:\d{4}[ ]?){4}\d\b/g },
  { name: "IBAN (allgemein)", regex: /\b[A-Z]{2}\d{2}[ ]?(?:[A-Z0-9]{4}[ ]?){3,7}[A-Z0-9]{1,4}\b/g },
  { name: "Kreditkartennummer", regex: /\b(?:\d[ -]?){13,19}\b/g },
  { name: "Privater Schlüssel", regex: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g },
  { name: "API-Schlüssel", regex: /\b(?:sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})\b/g },
  { name: "Zugangsdaten im Klartext", regex: /\b(?:password|passwort|passphrase|secret|token|api[_-]?key)\s*[:=]\s*["'][^"']{6,}["']/gi },
  { name: "AHV-Nummer", regex: /\b756\.\d{4}\.\d{4}\.\d{2}\b/g },
  { name: "Telefonnummer (CH)", regex: /\b(?:\+41|0041|0)[ ]?[1-9]{2}[ ]?\d{3}[ ]?\d{2}[ ]?\d{2}\b/g }
];

/**
 * Stellen, an denen die Muster bewusst stehen duerfen: dieses Werkzeug
 * selbst und Dokumentation, die die Muster erklaert.
 */
const AUSNAHMEN = [
  "tools/check-secrets.mjs",
  "SECURITY.md"
];

/* ------------------------------------------------------------------ */

async function eigeneBegriffe() {
  const datei = path.join(root, ".secretwords");
  if (!fsSync.existsSync(datei)) return [];
  const zeilen = (await fs.readFile(datei, "utf8")).split(/\r?\n/);
  return zeilen
    .map((z) => z.split("#")[0].trim())
    .filter((z) => z.length >= 3);
}

async function* dateien(verzeichnis) {
  for (const eintrag of await fs.readdir(verzeichnis, { withFileTypes: true })) {
    if (UEBERSPRINGEN.has(eintrag.name)) continue;
    const voll = path.join(verzeichnis, eintrag.name);
    if (eintrag.isDirectory()) yield* dateien(voll);
    else yield voll;
  }
}

/** Eine Kreditkartennummer erfuellt die Luhn-Pruefsumme — Versionsnummern nicht. */
function luhnGueltig(text) {
  const ziffern = text.replace(/\D/g, "");
  if (ziffern.length < 13 || ziffern.length > 19) return false;
  let summe = 0;
  let doppeln = false;
  for (let i = ziffern.length - 1; i >= 0; i--) {
    let z = Number(ziffern[i]);
    if (doppeln) { z *= 2; if (z > 9) z -= 9; }
    summe += z;
    doppeln = !doppeln;
  }
  return summe % 10 === 0;
}

/* ------------------------------------------------------------------ */

const begriffe = await eigeneBegriffe();
const funde = [];

for await (const voll of dateien(root)) {
  const relativ = path.relative(root, voll).split(path.sep).join("/");
  const name = path.basename(voll);

  for (const { muster, warum } of VERBOTENE_DATEIEN) {
    if (muster.test(name)) funde.push({ relativ, zeile: 0, was: "Datei gehört nicht ins Repository (" + warum + ")", auszug: name });
  }

  if (!TEXTENDUNGEN.has(path.extname(voll))) continue;
  if (AUSNAHMEN.includes(relativ)) continue;

  const zeilen = (await fs.readFile(voll, "utf8")).split(/\r?\n/);
  zeilen.forEach((zeile, i) => {
    /* Ausdrueckliche Einzelfallfreigabe. Bewusst sichtbar in der Zeile,
       damit sie beim Lesen des Codes auffaellt und begruendet werden muss. */
    if (zeile.includes("pruefung:erlaubt")) return;

    for (const { name: musterName, regex } of MUSTER) {
      regex.lastIndex = 0;
      for (const treffer of zeile.matchAll(regex)) {
        if (musterName === "Kreditkartennummer" && !luhnGueltig(treffer[0])) continue;
        funde.push({ relativ, zeile: i + 1, was: musterName, auszug: treffer[0].slice(0, 60) });
      }
    }
    for (const begriff of begriffe) {
      if (zeile.toLowerCase().includes(begriff.toLowerCase())) {
        /* Der Begriff selbst wird nicht ausgegeben — sonst stuende er im Protokoll. */
        funde.push({ relativ, zeile: i + 1, was: "Eigener Suchbegriff aus .secretwords", auszug: "(nicht angezeigt)" });
      }
    }
  });
}

/* ------------------------------------------------------------------ */

if (funde.length === 0) {
  console.log("Sauber: keine Zugangsdaten, Kontonummern oder Datendateien gefunden.");
  console.log(begriffe.length > 0
    ? "Zusätzlich geprüft gegen " + begriffe.length + " eigene Suchbegriffe aus .secretwords."
    : "Hinweis: keine .secretwords angelegt — eigene Namen und Bankverbindungen werden nicht geprüft.");
  process.exit(0);
}

console.error(funde.length + " Fund(e):\n");
for (const f of funde) {
  console.error("  " + f.relativ + (f.zeile ? ":" + f.zeile : "") + "  —  " + f.was);
  console.error("      " + f.auszug);
}
console.error("\nBitte prüfen und entfernen, bevor das Repository veröffentlicht wird.");
process.exit(1);
