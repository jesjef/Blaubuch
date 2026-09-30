/**
 * Abnahme der Umstellung auf Fassung 7: Dauerauftraege und Fixkosten
 * werden eine Liste.
 *
 * Die Zusage ist schlicht und deshalb streng pruefbar: keine Zeile geht
 * verloren, keine Zahl aendert sich. Nur der Ort, an dem die Zeile steht.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  SCHEMA_VERSION, ZEILEN_LISTEN, migrate, totals, kontoSaldo, monthFromPrevious
} from "../src/shared/budget.mjs";

/** Eine Datei, wie Fassung 6 (Blaubuch 1.3.0) sie geschrieben hat. */
const datei6 = () => ({
  version: 6,
  updatedAt: "2026-09-01T00:00:00.000Z",
  currentMonth: "2026-09",
  konten: [
    { id: "k-lohn", name: "Lohnkonto", institut: "", aktiv: true },
    { id: "k-spar", name: "Sparkonto", institut: "", aktiv: true }
  ],
  months: {
    "2026-09": {
      anfangsbestaende: { "k-lohn": 500, "k-spar": 2000 },
      einnahmen: [
        { id: "e", name: "Nettolohn", betrag: 5000, art: "erwerb", konto: "k-lohn", aktiv: true, faelligAm: 25, notiz: "" }
      ],
      dauerauftraege: [
        { id: "a", name: "Miete", betrag: 1500, klasse: "ausgaben", vonKonto: "k-lohn", nachKonto: null,
          aktiv: true, faelligAm: 1, laeuftBis: null, notiz: "Vermieter" },
        { id: "b", name: "Sparen", betrag: 400, klasse: "sparen", vonKonto: "k-lohn", nachKonto: "k-spar",
          aktiv: true, faelligAm: 26, laeuftBis: null, notiz: "" },
        { id: "c", name: "Leasing", betrag: 300, klasse: "ausgaben", vonKonto: "k-lohn", nachKonto: null,
          aktiv: false, faelligAm: null, laeuftBis: "2026-10", notiz: "" }
      ],
      fixkosten: [
        { id: "d", name: "Krankenkasse", betrag: 350, klasse: "ausgaben", vonKonto: "k-lohn", nachKonto: null,
          aktiv: true, faelligAm: null, laeuftBis: null, notiz: "" }
      ],
      kreditkarten: [{ id: "kk", name: "Karte", betrag: 200, limit: 1000, vonKonto: "k-lohn", notiz: "" }],
      ausgaben: [
        { id: "f", name: "Zahnarzt", betrag: 180, klasse: "ausgaben", vonKonto: "k-lohn", nachKonto: null,
          aktiv: true, faelligAm: null, laeuftBis: null, notiz: "" }
      ]
    }
  }
});

/**
 * Was Fassung 6 fuer diese Datei gerechnet hat, von Hand:
 *   Kosten  1500 Miete + 350 Krankenkasse + 180 Zahnarzt + 200 Karte = 2230
 *           (Sparen ist Umbuchung, Leasing pausiert)
 *   Mittel  2500 Bestand + 5000 Lohn = 7500
 *   Rest    5270
 */
const KOSTEN_6 = 2230;
const REST_6 = 5270;

const monat = (state) => state.months["2026-09"];

test("es gibt nur noch zwei Buchungslisten", () => {
  assert.equal(SCHEMA_VERSION, 7);
  assert.deepEqual(ZEILEN_LISTEN, ["fixkosten", "ausgaben"]);
});

test("jeder Dauerauftrag landet vor den Fixkosten, in seiner Reihenfolge", () => {
  const { state } = migrate(datei6());
  const m = monat(state);

  assert.deepEqual(m.fixkosten.map((z) => z.id), ["a", "b", "c", "d"]);
  assert.equal(m.dauerauftraege, undefined, "die alte Liste lebt nicht weiter");
  assert.equal(m.ausgaben.length, 1, "Ausgaben bleiben, wo sie waren");
});

test("jedes Feld einer Zeile übersteht das Zusammenlegen", () => {
  const roh = datei6();
  const { state } = migrate(roh);
  const nachher = new Map(monat(state).fixkosten.map((z) => [z.id, z]));

  for (const vorher of roh.months["2026-09"].dauerauftraege) {
    assert.deepEqual(nachher.get(vorher.id), vorher, vorher.name + " hat sich verändert");
  }
});

test("Summen, Umbuchungen und Kontosalden bleiben gleich", () => {
  const { state } = migrate(datei6());
  const m = monat(state);
  const t = totals(state, m);

  assert.equal(t.kosten, KOSTEN_6);
  assert.equal(t.rest, REST_6);
  assert.equal(t.fix, 1850, "1500 Miete + 350 Krankenkasse");
  assert.equal(t.umgebucht, 400, "Sparen bleibt eine Umbuchung, keine Kosten");
  assert.equal(kontoSaldo(state, m, "k-spar"), 2400, "das Sparkonto bekommt seine 400 weiterhin");
  assert.equal(kontoSaldo(state, m, "k-lohn"), 500 + 5000 - 1500 - 400 - 350 - 180 - 200);
});

test("die Umstellung wird gemeldet, mit der Zahl der Aufträge", () => {
  const { repariert } = migrate(datei6());
  const meldung = repariert.find((r) => /einer Liste/.test(r));
  assert.ok(meldung, "der Benutzer muss erfahren, warum eine Karte fehlt");
  assert.match(meldung, /3 Zeilen/);
});

test("eine Datei ohne Daueraufträge meldet nichts", () => {
  const roh = datei6();
  roh.months["2026-09"].dauerauftraege = [];
  const { repariert } = migrate(roh);
  assert.ok(!repariert.some((r) => /einer Liste/.test(r)), "nichts umgestellt, nichts zu melden");
});

test("zweimal angewandt ändert die Umstellung nichts mehr", () => {
  const einmal = migrate(datei6()).state;
  const zweimal = migrate(einmal);
  assert.deepEqual(zweimal.state, einmal);
  assert.deepEqual(zweimal.repariert, [], "beim zweiten Mal gibt es nichts mehr zu melden");
});

test("„läuft bis“ gilt weiter — auch für frühere Daueraufträge", () => {
  const { state } = migrate(datei6());
  const okt = monthFromPrevious(monat(state), "2026-10", state);
  const nov = monthFromPrevious(okt, "2026-11", state);

  assert.ok(okt.fixkosten.some((z) => z.name === "Leasing"), "läuft bis Oktober");
  assert.ok(!nov.fixkosten.some((z) => z.name === "Leasing"), "im November vorbei");
  assert.equal(okt.dauerauftraege, undefined, "ein neuer Monat kennt die alte Liste nicht");
});
