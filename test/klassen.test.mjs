/**
 * Abnahme der Klassifizierungen.
 *
 * Der Kern ist `wirkung`, nicht die Farbe. Sie entscheidet, ob ein Betrag
 * das Vermoegen mindert, es nur verschiebt, oder ueberhaupt nicht dazu
 * gehoert. Wer hier etwas aendert, aendert die Rechnung — deshalb steht
 * jede Zusage einzeln da.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  WIRKUNGEN, STANDARD_KLASSEN, STANDARD_KLASSE, TAG_ZU_KLASSE,
  KLASSEN_FARBEN, FARB_KEYS, farbe, standardKlassen, leseKlassen, klasseVon
} from "../src/shared/klassen.mjs";

test("es gibt genau drei Wirkungen, und jede mitgelieferte Klasse hat eine", () => {
  assert.deepEqual(WIRKUNGEN, ["verloren", "erhalten", "durchlauf"]);
  for (const k of standardKlassen()) {
    assert.ok(WIRKUNGEN.includes(k.wirkung), k.id + " hat keine gültige Wirkung");
    assert.ok(FARB_KEYS.includes(k.farbe), k.id + " hat keine gültige Farbe");
  }
});

test("die mitgelieferten Klassen decken alle drei Wirkungen ab", () => {
  const vorhanden = new Set(standardKlassen().map((k) => k.wirkung));
  assert.deepEqual([...vorhanden].sort(), ["durchlauf", "erhalten", "verloren"]);
});

test("standardKlassen gibt jedes Mal frische Objekte", () => {
  const a = standardKlassen();
  a[0].name = "verändert";
  assert.equal(standardKlassen()[0].name, "Ausgaben", "die Vorlage darf nicht mitwandern");
  assert.notEqual(a[0], STANDARD_KLASSEN[0]);
});

/* ------------------------------------------------------------------ *
 * Einlesen fremder oder alter Daten
 * ------------------------------------------------------------------ */

test("eine fehlende oder unsinnige Wirkung gilt als „verloren“", () => {
  assert.equal(leseKlassen([{ id: "a", name: "A" }])[0].wirkung, "verloren");
  assert.equal(leseKlassen([{ id: "b", name: "B", wirkung: "egal" }])[0].wirkung, "verloren",
    "im Zweifel gilt Geld als ausgegeben — die vorsichtigere Annahme");
});

test("der alte Wahrheitswert aus der Zwischenfassung wird mitgelesen", () => {
  /* Zwischen Schema 4 und 6 gab es kurz `verloren: true|false`. Wer eine
     solche Datei hat, darf sie nicht verlieren. */
  assert.equal(leseKlassen([{ id: "a", name: "A", verloren: false }])[0].wirkung, "erhalten");
  assert.equal(leseKlassen([{ id: "b", name: "B", verloren: true }])[0].wirkung, "verloren");
});

test("unbrauchbare Einträge fliegen raus, doppelte Kennungen ebenso", () => {
  const k = leseKlassen([
    { id: "gut", name: "Gut", wirkung: "erhalten" },
    { id: "gut", name: "Nochmal", wirkung: "verloren" },
    { id: "", name: "Ohne Kennung" },
    { id: "leer", name: "   " },
    null,
    "text"
  ]);
  assert.deepEqual(k.map((x) => x.id), ["gut"]);
  assert.equal(k[0].wirkung, "erhalten", "der erste Eintrag gewinnt");
});

test("ohne brauchbare Klassen kommen die mitgelieferten zurück", () => {
  for (const muell of [null, undefined, 42, "text", [], [null, {}]]) {
    const k = leseKlassen(muell);
    assert.equal(k.length, STANDARD_KLASSEN.length, "ohne Klassen liesse sich keine Zeile einordnen");
  }
});

test("eine erfundene Farbe fällt auf Rot zurück, statt unsichtbar zu werden", () => {
  assert.equal(leseKlassen([{ id: "a", name: "A", farbe: "neonpink" }])[0].farbe, "rot");
  assert.equal(farbe("gibt-es-nicht").key, "rot");
  assert.equal(farbe("lila").hell, "#B64FDE");
});

/* ------------------------------------------------------------------ *
 * Umschluesselung aus Fassung 4
 * ------------------------------------------------------------------ */

test("gelb wird zu blockiert, nicht zu sparen", () => {
  assert.equal(TAG_ZU_KLASSE.rot, "ausgaben");
  assert.equal(TAG_ZU_KLASSE.gruen, "investition");
  assert.equal(TAG_ZU_KLASSE.gelb, "blockiert",
    "„Investition gebunden“ heisst jetzt „Investition blockiert“ — Gelb ist neu Sparen");
  assert.notEqual(TAG_ZU_KLASSE.gelb, "sparen");
});

test("klasseVon fällt auf die Standardklasse zurück, nicht auf undefined", () => {
  const k = standardKlassen();
  assert.equal(klasseVon(k, "sparen").id, "sparen");
  assert.equal(klasseVon(k, "gibt-es-nicht").id, STANDARD_KLASSE);
  assert.equal(klasseVon(k, undefined).id, STANDARD_KLASSE);
  /* Auch wenn die Standardklasse selbst fehlt, kommt etwas Brauchbares. */
  const ohne = k.filter((x) => x.id !== STANDARD_KLASSE);
  assert.ok(klasseVon(ohne, "gibt-es-nicht"));
});

test("jede Farbe der Palette ist eindeutig benannt", () => {
  const keys = KLASSEN_FARBEN.map((f) => f.key);
  assert.equal(new Set(keys).size, keys.length, "doppelte Farbkennung");
  for (const f of KLASSEN_FARBEN) {
    assert.match(f.hell, /^#[0-9A-F]{6}$/, f.key + " hell");
    assert.match(f.dunkel, /^#[0-9A-F]{6}$/, f.key + " dunkel");
  }
});
