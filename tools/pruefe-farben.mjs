/**
 * Prueft die Farben der Klassifizierungen — mit Zahlen statt mit dem Auge.
 *
 * Zwei Zusagen stehen hier auf dem Pruefstand:
 *
 *  1. Jede Farbe hebt sich von der Flaeche ab, auf der sie sitzt. Ziel ist
 *     3:1 nach WCAG 1.4.11 — der Wert fuer grafische Elemente, die kein
 *     Text sind. Geprueft wird gegen die Karte in hell und gegen die Karte
 *     in dunkel, und zwar unter jedem Farbschema: die Flaeche traegt den
 *     Ton des Schemas mit, also aendert sie sich mit ihm.
 *
 *  2. Zwei Farben sind nicht verwechselbar. Punkte in einer Liste
 *     unterscheiden sich nur durch die Farbe; liegen zwei Toene zu nah
 *     beieinander, ist die Markierung wertlos.
 *
 * Laeuft in `npm run verify` und in der CI mit. Ein Auge ermuedet, eine
 * Zahl nicht.
 */

import { KLASSEN_FARBEN } from "../src/shared/klassen.mjs";

/* Die Farbschemata aus thema.mjs. Bewusst hier wiederholt und nicht
   importiert: thema.mjs fasst localStorage an und braucht ein Fenster. */
const SCHEMA_TOENE = [272, 250, 205, 300, 335];

const ZIEL_KONTRAST = 3.0;
const ZIEL_ABSTAND_GRAD = 25;

/* ---- Farbrechnung ---- */

/* Die langen Dezimalzahlen unten sind die Koeffizienten der Umrechnung
   zwischen sRGB und OKLab. Die Suche nach Zugangsdaten haelt zehnstellige
   Ziffernfolgen sonst fuer Rufnummern — daher die Freigaben je Zeile. */

const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gam = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

const ausHex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);

function oklchZuRgb(L, C, H) {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;   /* pruefung:erlaubt */
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;   /* pruefung:erlaubt */
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;   /* pruefung:erlaubt */
  return [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,   /* pruefung:erlaubt */
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,   /* pruefung:erlaubt */
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s   /* pruefung:erlaubt */
  ].map((v) => Math.max(0, Math.min(1, gam(v))));
}

function rgbZuOklch(rgb) {
  const [r, g, b] = rgb.map(lin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);   /* pruefung:erlaubt */
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);   /* pruefung:erlaubt */
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);   /* pruefung:erlaubt */
  const A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;   /* pruefung:erlaubt */
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;   /* pruefung:erlaubt */
  let H = (Math.atan2(B, A) * 180) / Math.PI;
  if (H < 0) H += 360;
  return { C: Math.hypot(A, B), H };
}

const relLeuchte = (rgb) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);

function kontrast(a, b) {
  const [hoch, tief] = [relLeuchte(a), relLeuchte(b)].sort((x, y) => y - x);
  return (hoch + 0.05) / (tief + 0.05);
}

/* ---- Die Flaechen aus styles.css ---- */

const KARTE_HELL = ausHex("#FFFFFF");
/* --card im Dunkeln: oklch(0.236 0.062 var(--h)) */
const KARTEN_DUNKEL = SCHEMA_TOENE.map((ton) => oklchZuRgb(0.236, 0.062, ton));

/* ---- Pruefung ---- */

const fehler = [];
const zeilen = [];

for (const f of KLASSEN_FARBEN) {
  const hell = ausHex(f.hell);
  const dunkel = ausHex(f.dunkel);

  const kHell = kontrast(hell, KARTE_HELL);
  const kDunkel = Math.min(...KARTEN_DUNKEL.map((flaeche) => kontrast(dunkel, flaeche)));

  if (kHell < ZIEL_KONTRAST) {
    fehler.push(`${f.key}: hell nur ${kHell.toFixed(2)}:1 gegen die Karte (Ziel ${ZIEL_KONTRAST}:1)`);
  }
  if (kDunkel < ZIEL_KONTRAST) {
    fehler.push(`${f.key}: dunkel nur ${kDunkel.toFixed(2)}:1 gegen die Karte (Ziel ${ZIEL_KONTRAST}:1)`);
  }

  zeilen.push(
    "  " + f.key.padEnd(9) + f.hell + "  " + kHell.toFixed(2).padStart(5) + ":1"
    + "   " + f.dunkel + "  " + kDunkel.toFixed(2).padStart(5) + ":1"
  );
}

/* Sind zwei Toene verwechselbar? Gemessen am Winkelabstand, und nur unter
   Farben, die ueberhaupt bunt sind — bei sehr geringer Saettigung sagt der
   Ton nichts mehr aus. */
const toene = KLASSEN_FARBEN.map((f) => ({ key: f.key, ...rgbZuOklch(ausHex(f.hell)) }));
for (let i = 0; i < toene.length; i++) {
  for (let j = i + 1; j < toene.length; j++) {
    const a = toene[i];
    const b = toene[j];
    if (a.C < 0.04 || b.C < 0.04) continue;
    const roh = Math.abs(a.H - b.H);
    const abstand = Math.min(roh, 360 - roh);
    if (abstand < ZIEL_ABSTAND_GRAD) {
      fehler.push(`${a.key} und ${b.key} liegen nur ${abstand.toFixed(1)}° auseinander (Ziel ${ZIEL_ABSTAND_GRAD}°)`);
    }
  }
}

console.log("Farben der Klassifizierungen — Kontrast gegen die Karte:\n");
console.log("  Farbe     hell               dunkel (schlechtestes Schema)");
console.log(zeilen.join("\n"));

if (fehler.length > 0) {
  console.error("\nNicht bestanden:");
  for (const f of fehler) console.error("  - " + f);
  process.exit(1);
}

console.log(
  "\nSauber: " + KLASSEN_FARBEN.length + " Farben, alle über "
  + ZIEL_KONTRAST + ":1 in beiden Darstellungen und unter allen "
  + SCHEMA_TOENE.length + " Farbschemata, keine zwei näher als " + ZIEL_ABSTAND_GRAD + "°."
);
