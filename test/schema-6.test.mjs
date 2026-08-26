/**
 * Abnahme der Umstellung auf Fassung 6.
 *
 * Das ist der einzige Schritt in 1.3.0, bei dem ein Fehler bestehende Daten
 * beschaedigt — deshalb steht hier mehr als sonst. Jeder Test haelt eine
 * Zusage fest und laesst sich als Pruefliste lesen.
 *
 * Drei Umstellungen laufen zugleich:
 *  - Konten werden Stammdaten; ihr Saldo haengt am Monat
 *  - jede Zeile weiss, von welchem Konto sie geht und auf welches sie kommt
 *  - aus drei Markierungen werden Klassifizierungen mit drei Wirkungen
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  SCHEMA_VERSION, migrate, emptyMonth, totals, kontoSaldo,
  monthFromPrevious, EINNAHME_ARTEN
} from "../src/shared/budget.mjs";

/** Eine Datei, wie Fassung 4 sie geschrieben hat. */
const datei4 = () => ({
  version: 4,
  updatedAt: "2026-07-01T00:00:00.000Z",
  currentMonth: "2026-07",
  months: {
    "2026-07": {
      einnahmen: { netto: 5000, spesen: 200, konto: 300, bar: 100, fremdschulden: 1000 },
      dauerauftraege: [
        { id: "a", name: "Miete", betrag: 1500, tag: "rot" },
        { id: "b", name: "Sparplan", betrag: 300, tag: "gruen" },
        { id: "c", name: "Pensionskasse", betrag: 400, tag: "gelb" }
      ],
      fixkosten: [{ id: "d", name: "Krankenkasse", betrag: 200, tag: "rot" }],
      kreditkarten: [{ id: "e", name: "Hauptkarte", betrag: 250, limit: 3000 }],
      ausgaben: [{ id: "f", name: "Zahnarzt", betrag: 180, tag: "rot" }]
    }
  }
});

const m7 = (state) => state.months["2026-07"];
const zeile = (monat, name) =>
  [...monat.dauerauftraege, ...monat.fixkosten, ...monat.ausgaben].find((z) => z.name === name);
const einnahme = (monat, name) => monat.einnahmen.find((e) => e.name === name);

/* ------------------------------------------------------------------ *
 * Kontenstamm
 * ------------------------------------------------------------------ */

test("Konten sind Stammdaten, ihr Saldo hängt am Monat", () => {
  const { state } = migrate(datei4());

  assert.equal(state.version, SCHEMA_VERSION);
  assert.ok(Array.isArray(state.konten), "Konten liegen im Stammsatz, nicht im Monat");
  assert.deepEqual(state.konten.map((k) => k.name), ["Kontostand", "Bargeld"]);
  assert.ok(state.konten.every((k) => k.aktiv === true && typeof k.id === "string" && k.id));

  const monat = m7(state);
  assert.equal(monat.konten, undefined, "im Monat stehen keine Konten mehr");
  const [konto, bar] = state.konten;
  assert.equal(monat.anfangsbestaende[konto.id], 300);
  assert.equal(monat.anfangsbestaende[bar.id], 100);
});

test("die alten Einnahmefelder werden zu Zeilen mit Zielkonto", () => {
  const { state } = migrate(datei4());
  const monat = m7(state);
  const lohnkonto = state.konten[0].id;

  assert.deepEqual(
    monat.einnahmen.map((e) => [e.name, e.betrag, e.art]),
    [["Nettolohn", 5000, "erwerb"], ["Spesen", 200, "erwerb"], ["Geliehen", 1000, "geliehen"]]
  );
  assert.ok(monat.einnahmen.every((e) => e.konto === lohnkonto), "alles landet zunächst auf dem ersten Konto");
  assert.ok(monat.einnahmen.every((e) => e.aktiv === true));
});

test("ein gesplitteter Lohn ist zwei Zeilen auf zwei Konten", () => {
  const { state } = migrate(datei4());
  const monat = m7(state);
  const [erstes, zweites] = state.konten;

  monat.einnahmen.push({
    id: "split", name: "Lohn Zweitkonto", betrag: 1100,
    art: "erwerb", konto: zweites.id, aktiv: true
  });

  const t = totals(state, monat);
  assert.equal(t.erwerb, 6300, "5000 + 200 + 1100");
  assert.equal(kontoSaldo(state, monat, zweites.id), 100 + 1100, "Anfangsbestand plus Zufluss");
  assert.equal(kontoSaldo(state, monat, erstes.id) < t.rest, true, "das Geld liegt jetzt verteilt");
});

/* ------------------------------------------------------------------ *
 * Umbuchung — der Kern
 * ------------------------------------------------------------------ */

test("eine Zeile mit Zielkonto ist eine Umbuchung und keine Kostenstelle", () => {
  const { state } = migrate(datei4());
  const monat = m7(state);
  const [konto, sparkonto] = state.konten;

  const vorher = totals(state, monat);

  /* Der Sparplan geht auf ein Konto, das Blaubuch führt — also eine
     Umbuchung, kein verlorenes Geld. */
  zeile(monat, "Sparplan").nachKonto = sparkonto.id;
  const nachher = totals(state, monat);

  assert.equal(vorher.kosten - nachher.kosten, 300, "die 300 zählen nicht mehr als Kosten");
  assert.equal(nachher.rest - vorher.rest, 300, "und erhöhen damit den Restwert");
  assert.equal(nachher.umgebucht, 300);
  assert.ok(nachher.sparquote > vorher.sparquote, "eigenes Geld darf die Sparquote nicht drücken");
});

test("eine Umbuchung verschiebt den Saldo, ohne die Summe zu ändern", () => {
  const { state } = migrate(datei4());
  const monat = m7(state);
  const [von, nach] = state.konten;
  zeile(monat, "Sparplan").nachKonto = nach.id;

  const summeVorher = state.konten.reduce((s, k) => s + kontoSaldo(state, monat, k.id), 0);
  zeile(monat, "Sparplan").betrag = 500;
  const summeNachher = state.konten.reduce((s, k) => s + kontoSaldo(state, monat, k.id), 0);

  assert.equal(summeVorher, summeNachher, "was von A nach B geht, verlässt das Vermögen nicht");
  assert.equal(kontoSaldo(state, monat, nach.id), 100 + 500);
});

test("ein Zielkonto, das es nicht gibt, macht die Zeile wieder zur Ausgabe", () => {
  const { state } = migrate(datei4());
  const monat = m7(state);
  const mitKonto = totals(state, monat);

  zeile(monat, "Sparplan").nachKonto = "gibt-es-nicht";
  const ohneKonto = totals(state, monat);

  assert.equal(ohneKonto.kosten, mitKonto.kosten,
    "führt Blaubuch das Zielkonto nicht, ist es eine Ausgabe — Niklas' Regel");
  assert.equal(ohneKonto.umgebucht, 0);
});

/* ------------------------------------------------------------------ *
 * Wirkungen
 * ------------------------------------------------------------------ */

test("gelb wird lila, nicht Sparen", () => {
  const { state, repariert } = migrate(datei4());
  const monat = m7(state);

  assert.equal(zeile(monat, "Pensionskasse").klasse, "blockiert");
  assert.equal(zeile(monat, "Miete").klasse, "ausgaben");
  assert.equal(zeile(monat, "Sparplan").klasse, "investition");
  /* Feld heisst jetzt faelligAm und traegt einen Tag im Monat; das alte
     „tag" mit der Markierung darf nirgends ueberleben. */
  assert.ok([...monat.dauerauftraege, ...monat.fixkosten, ...monat.ausgaben]
    .every((z) => z.tag === undefined && z.faelligAm === null));

  const meldung = repariert.find((r) => /blockiert|lila/i.test(r));
  assert.ok(meldung && /\b1\b|Eine Zeile/.test(meldung), "die Umschlüsselung wird gemeldet: " + meldung);
});

test("Durchlaufgeld zählt weder in Einkommen noch Kosten noch Restwert", () => {
  const { state } = migrate(datei4());
  const monat = m7(state);
  const konto = state.konten[0].id;
  const vorher = totals(state, monat);

  /* Ein Kollege zahlt eine Auslage zurueck und ich reiche sie weiter. */
  monat.einnahmen.push({ id: "d1", name: "TWINT zurück", betrag: 80, art: "durchlauf", konto, aktiv: true });
  monat.ausgaben.push({ id: "d2", name: "weitergereicht", betrag: 80, klasse: "durchlauf", vonKonto: konto, aktiv: true });

  const nachher = totals(state, monat);
  assert.equal(nachher.einnahmen, vorher.einnahmen, "kein Einkommen");
  assert.equal(nachher.kosten, vorher.kosten, "keine Kosten");
  assert.equal(nachher.rest, vorher.rest, "und kein Einfluss auf den Restwert");
  assert.equal(nachher.durchlauf, 160, "sichtbar bleibt es trotzdem");
});

test("die Wirkung entscheidet die Rechnung, nicht die Farbe", () => {
  const { state } = migrate(datei4());
  const monat = m7(state);
  const vorher = totals(state, monat).verloren;

  zeile(monat, "Miete").klasse = "sparen";
  assert.equal(vorher - totals(state, monat).verloren, 1500);
});

/* ------------------------------------------------------------------ *
 * Summen und Sparquote
 * ------------------------------------------------------------------ */

test("die Summen aus Fassung 4 bleiben nach der Umstellung gleich", () => {
  const { state } = migrate(datei4());
  const t = totals(state, m7(state));

  assert.equal(t.bestand, 400, "300 Konto + 100 Bar");
  assert.equal(t.erwerb, 5200, "5000 + 200");
  assert.equal(t.geliehen, 1000);
  assert.equal(t.einnahmen, 6600);
  assert.equal(t.kosten, 2830, "1500 + 300 + 400 Dauerauftraege + 200 Fixkosten + 180 Ausgaben + 250 Karte");
  assert.equal(t.rest, 3770, "6600 verfügbare Mittel minus 2830 Kosten");
});

test("ein deaktiviertes Erwerbskonto senkt die Sparquote, ein Bestand nicht", () => {
  const { state } = migrate(datei4());
  const monat = m7(state);
  const basis = totals(state, monat);

  einnahme(monat, "Spesen").aktiv = false;
  assert.equal(totals(state, monat).erwerb, 5000, "der Nenner der Sparquote ändert sich mit");

  einnahme(monat, "Spesen").aktiv = true;
  state.konten[1].aktiv = false;
  const ohneBar = totals(state, monat);
  assert.equal(ohneBar.bestand, 300, "das deaktivierte Konto zählt nicht mehr mit");
  assert.equal(ohneBar.erwerb, basis.erwerb, "die Sparquote misst weiter am Erwerb");
});

test("eine pausierte Zeile behält ihren Betrag, zählt aber nicht", () => {
  const { state } = migrate(datei4());
  const monat = m7(state);
  const vorher = totals(state, monat).kosten;

  zeile(monat, "Miete").aktiv = false;
  assert.equal(totals(state, monat).kosten, vorher - 1500);
  assert.equal(zeile(monat, "Miete").betrag, 1500, "der Betrag bleibt erhalten");
});

/* ------------------------------------------------------------------ *
 * Tage und Enddatum
 * ------------------------------------------------------------------ */

test("Zeilen dürfen einen Tag im Monat tragen", () => {
  const { state } = migrate(datei4());
  const monat = m7(state);
  assert.equal(zeile(monat, "Miete").faelligAm, null, "ohne Angabe bleibt es leer");

  zeile(monat, "Miete").faelligAm = 27;
  const { state: erneut } = migrate(state);
  assert.equal(zeile(m7(erneut), "Miete").faelligAm, 27, "und übersteht das Einlesen");
});

test("ein unsinniger Tag wird verworfen statt übernommen", () => {
  const { state } = migrate(datei4());
  const monat = m7(state);
  for (const unsinn of [0, 32, -3, "morgen", 1.5]) {
    zeile(monat, "Miete").faelligAm = unsinn;
    const { state: erneut } = migrate(state);
    assert.equal(zeile(m7(erneut), "Miete").faelligAm, null, "Tag " + JSON.stringify(unsinn));
  }
});

test("eine Zeile mit „läuft bis“ fällt im Folgemonat weg", () => {
  const { state } = migrate(datei4());
  const monat = m7(state);
  zeile(monat, "Krankenkasse").laeuftBis = "2026-07";
  zeile(monat, "Miete").laeuftBis = "2026-09";

  const neu = monthFromPrevious(monat, "2026-08");
  assert.ok(!neu.fixkosten.some((z) => z.name === "Krankenkasse"), "abgelaufen, also weg");
  assert.ok(neu.dauerauftraege.some((z) => z.name === "Miete"), "läuft noch");
});

/* ------------------------------------------------------------------ *
 * Folgemonat
 * ------------------------------------------------------------------ */

test("der Endbestand wird als Anfangsbestand vorgeschlagen", () => {
  const { state } = migrate(datei4());
  const monat = m7(state);
  const konto = state.konten[0].id;
  const endbestand = kontoSaldo(state, monat, konto);

  const neu = monthFromPrevious(monat, "2026-08", state);
  assert.equal(neu.anfangsbestaende[konto], endbestand,
    "kein automatisches Fortschreiben — ein Vorschlag, den man überschreiben kann");
});

test("wiederkehrendes wandert mit, Einmaliges nicht", () => {
  const { state } = migrate(datei4());
  const neu = monthFromPrevious(m7(state), "2026-08", state);

  assert.equal(neu.dauerauftraege.length, 3);
  assert.equal(neu.fixkosten.length, 1);
  assert.deepEqual(neu.ausgaben, [], "Ausgaben sind einmalig");
  assert.equal(neu.einnahmen.find((e) => e.name === "Nettolohn").betrag, 5000, "Erwerb wiederholt sich");
  assert.equal(neu.einnahmen.find((e) => e.name === "Geliehen").betrag, 0, "Geliehenes ist eine Momentaufnahme");
  assert.equal(neu.kreditkarten[0].betrag, 0, "der Saldo fängt bei 0 an, das Limit bleibt");
});

/* ------------------------------------------------------------------ *
 * Robustheit
 * ------------------------------------------------------------------ */

test("zweimal angewandt ändert die Umstellung nichts mehr", () => {
  const einmal = migrate(datei4()).state;
  assert.deepEqual(migrate(einmal).state, einmal);
});

test("eine Zeile ohne Herkunftskonto bekommt eines und wird gemeldet", () => {
  const { state } = migrate(datei4());
  assert.ok(zeile(m7(state), "Miete").vonKonto, "die Migration setzt das erste Konto");
  assert.equal(zeile(m7(state), "Miete").vonKonto, state.konten[0].id);
});

test("bekannte Einnahmearten und nichts sonst", () => {
  assert.deepEqual(EINNAHME_ARTEN, ["erwerb", "geliehen", "sonstige", "durchlauf"]);
  const { state } = migrate(datei4());
  const monat = m7(state);
  monat.einnahmen.push({ id: "x", name: "Unfug", betrag: 50, art: "erfunden", konto: state.konten[0].id });
  const { state: erneut } = migrate(state);
  assert.equal(einnahme(m7(erneut), "Unfug").art, "sonstige",
    "eine unbekannte Art zählt zu den Mitteln, aber nicht als Erwerb");
});

test("völliger Unsinn ergibt einen leeren, benutzbaren Zustand", () => {
  for (const muell of [null, undefined, 42, "text", [], { months: "nein" }]) {
    const { state } = migrate(muell);
    assert.equal(state.version, SCHEMA_VERSION);
    assert.ok(state.konten.length >= 1, "ohne Konto liesse sich nichts buchen");
    assert.ok(state.klassen.length >= 4);
    const monat = state.months[state.currentMonth];
    assert.ok(Array.isArray(monat.einnahmen) && Array.isArray(monat.dauerauftraege));
    assert.ok(monat.anfangsbestaende && typeof monat.anfangsbestaende === "object");
    assert.doesNotThrow(() => totals(state, monat));
  }
});

test("ein leerer Monat ergibt lauter Nullen statt NaN", () => {
  const { state } = migrate(null);
  const t = totals(state, emptyMonth(state));
  for (const [feld, wert] of Object.entries(t)) {
    if (feld === "byKlasse" || feld === "sparquote") continue;
    assert.equal(Number.isFinite(wert), true, feld + " ist " + wert);
  }
  assert.equal(t.sparquote, null, "ohne Erwerb gibt es keine Quote");
});
