/**
 * Abnahme der Umstellung auf Fassung 5.
 *
 * Das ist der einzige Schritt in 1.1.0, bei dem ein Fehler bestehende Daten
 * beschaedigt — deshalb steht hier mehr als sonst. Jeder Test beschreibt in
 * Prosa, was er festhaelt, und laesst sich als Pruefliste lesen.
 *
 * Zwei Umstellungen laufen zugleich:
 *  - die fuenf festen Einnahmefelder werden zu frei benennbaren Konten
 *  - aus drei Markierungen werden vier Klassifizierungen, und Gelb
 *    bedeutet dabei etwas anderes als vorher
 */

import test from "node:test";
import assert from "node:assert/strict";

import { SCHEMA_VERSION, migrate, emptyMonth, totals } from "../src/shared/budget.mjs";
import { STANDARD_KLASSEN } from "../src/shared/klassen.mjs";

/** Eine Datei, wie Fassung 4 sie geschrieben hat. */
const datei4 = () => ({
  version: 4,
  updatedAt: "2026-07-01T00:00:00.000Z",
  currentMonth: "2026-07",
  months: {
    "2026-07": {
      einnahmen: { netto: 5000, spesen: 200, konto: 300, bar: 0, fremdschulden: 1000 },
      dauerauftraege: [
        { id: "a", name: "Miete", betrag: 1500, tag: "rot" },
        { id: "b", name: "Sparplan", betrag: 300, tag: "gruen" },
        { id: "c", name: "Pensionskasse", betrag: 400, tag: "gelb" }
      ],
      fixkosten: [{ id: "d", name: "Krankenkasse", betrag: 200, tag: "gelb" }],
      kreditkarten: [{ id: "e", name: "Hauptkarte", betrag: 250, limit: 3000 }],
      ausgaben: [{ id: "f", name: "Zahnarzt", betrag: 180, tag: "rot" }]
    }
  }
});

const alleZeilen = (monat) => [
  ...monat.dauerauftraege, ...monat.fixkosten, ...monat.ausgaben
];

/* ------------------------------------------------------------------ *
 * Konten
 * ------------------------------------------------------------------ */

test("die fünf festen Einnahmefelder werden zu benannten Konten", () => {
  const { state } = migrate(datei4());
  const monat = state.months["2026-07"];

  assert.equal(state.version, SCHEMA_VERSION);
  assert.ok(Array.isArray(monat.konten), "Konten sind jetzt eine Liste");
  assert.equal(monat.einnahmen, undefined, "das alte Objekt darf nicht liegenbleiben");

  const nach = (name) => monat.konten.find((k) => k.name === name);
  assert.deepEqual(
    monat.konten.map((k) => [k.name, k.art, k.betrag]),
    [
      ["Nettolohn", "erwerb", 5000],
      ["Spesen", "erwerb", 200],
      ["Kontostand", "bestand", 300],
      ["Bargeld", "bestand", 0],
      ["Geliehen", "geliehen", 1000]
    ]
  );
  assert.ok(monat.konten.every((k) => k.aktiv === true), "alles zählt zunächst mit");
  assert.ok(monat.konten.every((k) => typeof k.id === "string" && k.id), "jedes Konto braucht eine Kennung");
  assert.ok(nach("Bargeld"), "auch ein Feld mit 0 wandert mit — sonst verschwindet eine bekannte Zeile");
});

test("ein deaktiviertes Konto zählt nicht mehr mit", () => {
  const { state } = migrate(datei4());
  const monat = state.months["2026-07"];

  const vorher = totals(monat);
  assert.equal(vorher.erwerb, 5200);
  assert.equal(vorher.einnahmen, 6500, "5200 Erwerb + 300 Bestand + 1000 geliehen");

  monat.konten.find((k) => k.name === "Geliehen").aktiv = false;
  const ohne = totals(monat);
  assert.equal(ohne.geliehen, 0);
  assert.equal(ohne.einnahmen, 5500);
  assert.equal(ohne.erwerb, 5200, "die Sparquote misst weiter am Erwerb");
});

test("ein deaktiviertes Erwerbskonto senkt die Sparquote, ein Bestandskonto nicht", () => {
  const { state } = migrate(datei4());
  const monat = state.months["2026-07"];
  const basis = totals(monat).sparquote;

  monat.konten.find((k) => k.name === "Kontostand").aktiv = false;
  const ohneBestand = totals(monat).sparquote;
  assert.ok(ohneBestand < basis, "weniger Mittel bei gleichem Erwerb: die Quote sinkt");

  monat.konten.find((k) => k.name === "Kontostand").aktiv = true;
  monat.konten.find((k) => k.name === "Spesen").aktiv = false;
  const ohneErwerb = totals(monat);
  assert.equal(ohneErwerb.erwerb, 5000, "der Nenner der Sparquote ändert sich mit");
});

test("Umbuchungen gibt es neu und sie fangen leer an", () => {
  const { state } = migrate(datei4());
  assert.deepEqual(state.months["2026-07"].umbuchungen, []);
  assert.deepEqual(emptyMonth().umbuchungen, []);
});

/* ------------------------------------------------------------------ *
 * Klassifizierungen
 * ------------------------------------------------------------------ */

test("die vier mitgelieferten Klassen stehen im Stammsatz", () => {
  const { state } = migrate(datei4());
  assert.deepEqual(
    state.klassen.map((k) => k.id),
    STANDARD_KLASSEN.map((k) => k.id)
  );
  assert.equal(state.klassen.find((k) => k.id === "ausgaben").verloren, true);
  assert.equal(state.klassen.find((k) => k.id === "sparen").verloren, false);
  assert.equal(state.klassen.find((k) => k.id === "blockiert").verloren, false);
});

test("was gelb war, wird lila — nicht Sparen", () => {
  const { state } = migrate(datei4());
  const zeilen = alleZeilen(state.months["2026-07"]);

  const pensionskasse = zeilen.find((z) => z.name === "Pensionskasse");
  const krankenkasse = zeilen.find((z) => z.name === "Krankenkasse");

  assert.equal(pensionskasse.klasse, "blockiert",
    "„Investition gebunden“ heisst jetzt „Investition blockiert“ und ist lila");
  assert.equal(krankenkasse.klasse, "blockiert");

  assert.ok(zeilen.every((z) => z.klasse !== "sparen"),
    "Sparen fängt leer an — sonst bedeuteten alte Zahlen rückwirkend etwas anderes");
  assert.ok(zeilen.every((z) => z.tag === undefined), "die alte Markierung darf nicht liegenbleiben");
});

test("rot und grün behalten ihre Bedeutung", () => {
  const { state } = migrate(datei4());
  const zeilen = alleZeilen(state.months["2026-07"]);
  assert.equal(zeilen.find((z) => z.name === "Miete").klasse, "ausgaben");
  assert.equal(zeilen.find((z) => z.name === "Zahnarzt").klasse, "ausgaben");
  assert.equal(zeilen.find((z) => z.name === "Sparplan").klasse, "investition");
});

test("die Umschlüsselung wird gemeldet, nicht stillschweigend gemacht", () => {
  const { repariert } = migrate(datei4());
  const meldung = repariert.find((z) => /lila|blockiert/i.test(z));
  assert.ok(meldung, "der Benutzer muss erfahren, dass sich eine Bedeutung verschoben hat");
  assert.ok(/\b2\b/.test(meldung), "und wie viele Zeilen es betrifft: " + meldung);
});

test("eine unbekannte Markierung landet bei Ausgaben", () => {
  const roh = datei4();
  roh.months["2026-07"].ausgaben[0].tag = "tuerkis-erfunden";
  const { state } = migrate(roh);
  const zeile = state.months["2026-07"].ausgaben[0];
  assert.equal(zeile.klasse, "ausgaben", "im Zweifel gilt Geld als ausgegeben, nicht als angelegt");
});

test("verloren entscheidet die Rechnung, nicht die Farbe", () => {
  const { state } = migrate(datei4());
  const monat = state.months["2026-07"];

  const vorher = totals(monat).verloren;
  /* Dieselbe Zeile, andere Klasse: aus „weg“ wird „liegt woanders“. */
  monat.dauerauftraege.find((z) => z.name === "Miete").klasse = "sparen";
  const nachher = totals(monat).verloren;

  assert.equal(vorher - nachher, 1500, "die Miete zählt danach nicht mehr als verloren");
});

/* ------------------------------------------------------------------ *
 * Aeltere Fassungen und Sonderfaelle
 * ------------------------------------------------------------------ */

test("auch eine Datei aus Fassung 3 kommt vollständig an", () => {
  const { state, repariert } = migrate({
    version: 3,
    currentMonth: "2026-07",
    limits: { hauptkarte: 3000 },
    months: {
      "2026-07": {
        einnahmen: { netto: 4000, konto: 100 },
        dauerauftraege: [{ id: "x", name: "Pensionskasse", betrag: 500, tag: "gelb" }],
        fixkosten: [],
        kreditkarten: { hauptkarte: 250 },
        rechnungen: [{ id: "y", name: "Arzt", betrag: 90, tag: "rot" }]
      }
    }
  });

  const monat = state.months["2026-07"];
  assert.equal(monat.konten.find((k) => k.name === "Nettolohn").betrag, 4000);
  assert.equal(monat.konten.find((k) => k.name === "Spesen").betrag, 0, "fehlende Felder werden 0, nicht weggelassen");
  assert.equal(monat.kreditkarten[0].name, "Hauptkarte", "die Karten aus Fassung 3 bleiben erhalten");
  assert.equal(monat.kreditkarten[0].limit, 3000);
  assert.equal(monat.ausgaben[0].name, "Arzt", "„rechnungen“ heisst seit Fassung 4 „ausgaben“");
  assert.equal(monat.dauerauftraege[0].klasse, "blockiert");
  assert.ok(repariert.length > 0);
});

test("zweimal angewandt ändert die Umstellung nichts mehr", () => {
  const einmal = migrate(datei4()).state;
  const zweimal = migrate(einmal).state;
  assert.deepEqual(zweimal, einmal);
});

test("eigene Klassen einer Fassung-5-Datei überleben das Einlesen", () => {
  const einmal = migrate(datei4()).state;
  einmal.klassen.push({ id: "spende", name: "Spenden", farbe: "tuerkis", verloren: true });
  einmal.months["2026-07"].ausgaben[0].klasse = "spende";

  const { state } = migrate(einmal);
  const spende = state.klassen.find((k) => k.id === "spende");
  assert.ok(spende, "eine selbst angelegte Klasse darf nicht verschwinden");
  assert.equal(spende.farbe, "tuerkis");
  assert.equal(spende.verloren, true);
  assert.equal(state.months["2026-07"].ausgaben[0].klasse, "spende");
});

test("eine Zeile, die auf eine gelöschte Klasse zeigt, fällt auf Ausgaben zurück", () => {
  const einmal = migrate(datei4()).state;
  einmal.months["2026-07"].ausgaben[0].klasse = "gibt-es-nicht";
  const { state } = migrate(einmal);
  assert.equal(state.months["2026-07"].ausgaben[0].klasse, "ausgaben");
});

test("eine erfundene Farbe fällt auf Rot zurück, statt unsichtbar zu werden", () => {
  const einmal = migrate(datei4()).state;
  einmal.klassen.push({ id: "eigen", name: "Eigen", farbe: "neonpink", verloren: false });
  const { state } = migrate(einmal);
  assert.equal(state.klassen.find((k) => k.id === "eigen").farbe, "rot");
});

test("völliger Unsinn ergibt einen leeren, benutzbaren Zustand", () => {
  for (const muell of [null, undefined, 42, "text", [], { months: "nein" }]) {
    const { state } = migrate(muell);
    assert.equal(state.version, SCHEMA_VERSION);
    assert.ok(Array.isArray(state.klassen) && state.klassen.length >= 4);
    const monat = state.months[state.currentMonth];
    assert.ok(Array.isArray(monat.konten));
    assert.ok(Array.isArray(monat.umbuchungen));
  }
});
