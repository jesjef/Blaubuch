import test from "node:test";
import assert from "node:assert/strict";

import {
  parseAmount, formatCHF, totals, migrate, monthFromPrevious,
  buildInsights, buildReport, monthLabel, isMonthKey, nextMonthKey,
  emptyMonth, KEIN_LIMIT, SCHEMA_VERSION
} from "../src/shared/budget.mjs";
import { createSeedState, currentMonthKey } from "../src/shared/seed.mjs";
import { beispielMonat, beispielState } from "./fixtures.mjs";

/**
 * Node und Chromium setzen im de-CH-Format unterschiedliche Apostrophe
 * als Tausendertrennzeichen (U+0027 gegen U+2019). Fuer die Pruefung ist
 * das gleichgueltig — also vorher vereinheitlichen.
 */
const norm = (s) => String(s).replace(/[’'`]/g, "'");

/* ------------------------------------------------------------------ *
 * Betraege lesen
 * ------------------------------------------------------------------ */

test("parseAmount liest Schweizer Schreibweise", () => {
  assert.equal(parseAmount("1'234.50"), 1234.5);
  assert.equal(parseAmount("1’234,50"), 1234.5);
  assert.equal(parseAmount("1234,50"), 1234.5);
  assert.equal(parseAmount(" 57.15 "), 57.15);
  assert.equal(parseAmount(110), 110);
});

test("parseAmount macht aus Unlesbarem eine 0 statt NaN", () => {
  for (const eingabe of ["", "   ", "abc", "1.2.3", null, undefined, NaN, {}]) {
    assert.equal(parseAmount(eingabe), 0, "fehlgeschlagen bei " + String(eingabe));
  }
});

test("parseAmount laesst negative Korrekturen zu", () => {
  assert.equal(parseAmount("-50"), -50);
  assert.equal(parseAmount("−50"), 0, "das typografische Minus ist keine Zahl und darf nicht geraten werden");
});

test("formatCHF schreibt Betraege schweizerisch", () => {
  assert.equal(norm(formatCHF(1234.5)), "1'234.50 Fr.");
  assert.equal(formatCHF(0), "0.00 Fr.");
  assert.equal(formatCHF(-143.17), "-143.17 Fr.");
  assert.match(formatCHF(1234.5), /^1.234\.50 Fr\.$/, "Tausender getrennt, Rappen mit Punkt");
});

/* ------------------------------------------------------------------ *
 * Summen
 * ------------------------------------------------------------------ */

test("totals rechnet einen Beispielmonat korrekt", () => {
  const t = totals(beispielMonat());

  assert.equal(t.erwerb, 5200, "Netto plus Spesen");
  assert.equal(t.bestand, 400, "Konto plus Bar");
  assert.equal(t.einnahmen, 5600);
  assert.equal(t.da, 1800);
  assert.equal(t.fix, 250);
  assert.equal(t.kk, 500);
  assert.equal(t.re, 250);
  assert.equal(t.kosten, 2800);
  assert.equal(t.rest, 2800);
});

test("die Etiketten summieren sich exakt zu den Gesamtkosten", () => {
  const state = beispielState();
  for (const key of Object.keys(state.months)) {
    const t = totals(state.months[key]);
    const summe = Math.round((t.byTag.rot + t.byTag.gruen + t.byTag.gelb) * 100) / 100;
    assert.equal(summe, t.kosten, "Etikettensumme weicht ab in " + key);
  }
});

test("der Kreditkartensaldo zaehlt als Konsum", () => {
  const t = totals(beispielMonat());
  assert.equal(t.byTag.gruen, 300, "nur der Sparplan ist gruen");
  assert.equal(t.byTag.rot, 2500, "alles Uebrige inklusive der 500 Kartensaldo");
});

test("Sparquote misst am Erwerbseinkommen, nicht an Bestand oder Darlehen", () => {
  const monat = emptyMonth();
  monat.einnahmen.netto = 5000;
  const ohne = totals(monat).sparquote;

  monat.einnahmen.konto = 4000;
  monat.einnahmen.fremdschulden = 1000;
  const mit = totals(monat);

  assert.equal(ohne, 100, "ohne Kosten bleibt alles uebrig");
  assert.equal(mit.erwerb, 5000, "Bestand und Darlehen sind kein Einkommen");
  assert.equal(mit.einnahmen, 10000, "verfuegbare Mittel steigen sehr wohl");
  assert.ok(mit.sparquote > 100, "die Bezugsgroesse bleibt aber das Einkommen");
});

test("Einnahmen kennen genau fuenf Felder", () => {
  assert.deepEqual(
    Object.keys(emptyMonth().einnahmen),
    ["netto", "spesen", "konto", "bar", "fremdschulden"],
    "kommt ein Feld dazu, muss auch die Oberflaeche es zeigen"
  );
});

test("Felder aus einer Altfassung werden beim Einlesen verworfen", () => {
  /* „kontouebertrag“ gab es frueher und wurde von den Einnahmen abgezogen.
     Es darf nicht als unsichtbarer Posten in den Daten weiterleben. */
  const { state } = migrate({
    months: {
      "2026-08": { einnahmen: { netto: 5000, kontouebertrag: 500, irgendwas: 42 } }
    }
  });

  const einnahmen = state.months["2026-08"].einnahmen;
  assert.ok(!("kontouebertrag" in einnahmen), "das alte Feld ist weg");
  assert.ok(!("irgendwas" in einnahmen), "unbekannte Felder werden nicht uebernommen");
  assert.equal(totals(state.months["2026-08"]).einnahmen, 5000, "und beeinflussen die Summe nicht");
});

test("Rappenrundung haelt Summen sauber", () => {
  const monat = emptyMonth();
  monat.ausgaben = [
    { id: "a", name: "A", betrag: 0.1, tag: "rot" },
    { id: "b", name: "B", betrag: 0.2, tag: "rot" }
  ];
  assert.equal(totals(monat).re, 0.3, "0.1 + 0.2 darf nicht 0.30000000000000004 ergeben");
});

test("ein voellig leerer Monat ergibt lauter Nullen statt NaN", () => {
  const t = totals(emptyMonth());
  for (const [feld, wert] of Object.entries(t)) {
    if (feld === "byTag" || feld === "sparquote") continue;
    assert.equal(wert, 0, feld + " sollte 0 sein");
  }
  assert.equal(t.sparquote, null, "ohne Einkommen gibt es keine Quote");
});

/* ------------------------------------------------------------------ *
 * Einlesen fremder oder alter Dateien
 * ------------------------------------------------------------------ */

test("migrate repariert eine kaputte Datei, statt zu scheitern", () => {
  const { state, repariert } = migrate({
    version: 1,
    months: {
      "2026-08": {
        einnahmen: { netto: "5'000.00", spesen: null },
        dauerauftraege: [
          { name: "Miete", betrag: "1,200.00", tag: "violett" },
          { name: "   ", betrag: 50 },
          null
        ],
        kreditkarten: [{ name: "Hauptkarte", betrag: "abc", limit: "1'000" }, { betrag: 50 }]
      },
      "kein-monat": { einnahmen: {} }
    }
  });

  assert.equal(state.version, SCHEMA_VERSION);
  assert.deepEqual(Object.keys(state.months), ["2026-08"], "ungueltiger Monatsschluessel fliegt raus");

  const m = state.months["2026-08"];
  assert.equal(m.einnahmen.netto, 5000, "Text wird zur Zahl");
  assert.equal(m.einnahmen.spesen, 0, "null wird zu 0");
  assert.equal(m.kreditkarten.length, 1, "namenlose Kartenzeilen fliegen raus");
  assert.equal(m.kreditkarten[0].betrag, 0, "unlesbarer Betrag wird zu 0");
  assert.equal(m.kreditkarten[0].limit, 1000, "das Limit wird gelesen");
  assert.equal(m.dauerauftraege.length, 1, "namenlose und leere Zeilen werden verworfen");
  assert.equal(m.dauerauftraege[0].tag, "rot", "unbekanntes Etikett faellt auf rot zurueck");
  assert.ok(m.dauerauftraege[0].id, "fehlende id wird vergeben");
  assert.ok(Array.isArray(m.fixkosten), "fehlende Listen werden angelegt");
  assert.ok(repariert.length >= 2, "Reparaturen werden gemeldet");
});

test("Eintraege aus dem alten Feld „rechnungen“ gehen nicht verloren", () => {
  /* Bis Fassung 4 hiess die Liste „rechnungen“. Wer eine aeltere Datei
     einliest, darf dadurch keine Zeile verlieren. */
  const { state } = migrate({
    version: 4,
    months: {
      "2026-08": {
        rechnungen: [{ name: "Zahnarzt", betrag: 250, tag: "rot" }]
      }
    }
  });

  const m = state.months["2026-08"];
  assert.equal(m.ausgaben.length, 1, "die alte Liste wird uebernommen");
  assert.equal(m.ausgaben[0].name, "Zahnarzt");
  assert.equal(totals(m).re, 250, "und zaehlt in der Summe mit");
  assert.ok(!("rechnungen" in m), "das alte Feld bleibt nicht daneben stehen");
});

test("liegen beide Felder vor, gewinnt das neue", () => {
  const { state } = migrate({
    months: {
      "2026-08": {
        ausgaben: [{ name: "Neu", betrag: 10, tag: "rot" }],
        rechnungen: [{ name: "Alt", betrag: 999, tag: "rot" }]
      }
    }
  });
  const m = state.months["2026-08"];
  assert.equal(m.ausgaben.length, 1);
  assert.equal(m.ausgaben[0].name, "Neu");
  assert.equal(totals(m).re, 10, "der alte Stand darf nicht doppelt zaehlen");
});

test("migrate uebersteht voelligen Unsinn", () => {
  for (const muell of [null, undefined, 42, "text", [], {}, { months: "nein" }]) {
    const { state } = migrate(muell);
    assert.equal(Object.keys(state.months).length, 1, "es gibt immer einen Monat");
    assert.ok(isMonthKey(state.currentMonth));
  }
});

test("migrate haelt an einem gueltigen aktuellen Monat fest", () => {
  const state = beispielState();
  state.currentMonth = "2026-07";
  assert.equal(migrate(state).state.currentMonth, "2026-07");

  state.currentMonth = "2099-01";
  assert.equal(migrate(state).state.currentMonth, "2026-08", "zeigt sonst auf den letzten Monat");
});

test("migrate ist stabil: zweimal angewandt aendert nichts mehr", () => {
  const einmal = migrate(beispielState()).state;
  const zweimal = migrate(einmal).state;
  assert.deepEqual(zweimal.months, einmal.months);
  assert.deepEqual(zweimal.months["2026-08"].kreditkarten, einmal.months["2026-08"].kreditkarten);
});

test("die festen Karten der Fassung 3 werden zu frei benennbaren Zeilen", () => {
  const { state, repariert } = migrate({
    version: 3,
    limits: { karteA: "2'500", karteB: 3000 },
    months: { "2026-08": { kreditkarten: { karteA: 400, karteB: 0 } } }
  });

  const karten = state.months["2026-08"].kreditkarten;
  assert.equal(karten.length, 2, "aus jedem Schluessel wird eine Zeile");
  assert.equal(karten[0].name, "KarteA", "der Schluessel wird zum Namen — nichts wird erfunden");
  assert.equal(karten[0].betrag, 400);
  assert.equal(karten[0].limit, 2500, "das Limit wandert aus dem Stammsatz an die Karte");
  assert.ok(!("limits" in state), "es gibt keine Limits mehr im Stammsatz");
  assert.ok(repariert.some((r) => r.includes("umgewandelt")), "die Umstellung wird gemeldet");
});

test("negative Limits werden auf „kein Limit“ zurueckgesetzt", () => {
  const { state } = migrate({
    months: { "2026-08": { kreditkarten: [{ name: "Karte", betrag: 10, limit: -5 }] } }
  });
  assert.equal(state.months["2026-08"].kreditkarten[0].limit, KEIN_LIMIT);
});

/* ------------------------------------------------------------------ *
 * Monate
 * ------------------------------------------------------------------ */

test("neuer Monat uebernimmt Wiederkehrendes, aber nichts Einmaliges", () => {
  const vorlage = beispielMonat();
  const neu = monthFromPrevious(vorlage);

  assert.equal(neu.einnahmen.netto, 5000, "Gehalt wird uebernommen");
  assert.equal(neu.einnahmen.spesen, 0, "Spesen nicht");
  assert.equal(neu.einnahmen.konto, 0, "Kontostand nicht");
  assert.equal(neu.dauerauftraege.length, 2, "Auftraege kommen mit");
  assert.equal(neu.fixkosten.length, 2);
  assert.deepEqual(neu.ausgaben, [], "Ausgaben sind einmalig");
  assert.equal(neu.kreditkarten.length, 2, "die Karten selbst bleiben bestehen");
  assert.ok(neu.kreditkarten.every((k) => k.betrag === 0), "aber jeder Saldo faengt bei 0 an");

  const alteIds = vorlage.dauerauftraege.map((x) => x.id);
  assert.ok(neu.dauerauftraege.every((x) => !alteIds.includes(x.id)), "jede Zeile bekommt eine eigene id");
});

test("monthFromPrevious kommt auch ohne Vorlage klar", () => {
  assert.equal(totals(monthFromPrevious(undefined)).kosten, 0);
});

test("Monatsschluessel: Pruefung und Fortschreibung", () => {
  assert.ok(isMonthKey("2026-01"));
  assert.ok(!isMonthKey("2026-13"));
  assert.ok(!isMonthKey("2026-00"));
  assert.ok(!isMonthKey("26-01"));
  assert.equal(nextMonthKey("2026-12"), "2027-01", "Jahreswechsel");
  assert.equal(nextMonthKey("2026-08"), "2026-09");
  assert.equal(monthLabel("2026-03"), "März 2026");
});

/* ------------------------------------------------------------------ *
 * Analyse
 * ------------------------------------------------------------------ */

const alsText = (insights) =>
  insights.map((i) => i.parts.map((p) => (typeof p === "string" ? p : p.b)).join(""));

test("Analyse warnt bei Darlehen im Restwert", () => {
  const state = beispielState();
  state.months["2026-08"].einnahmen.fremdschulden = 500;
  assert.ok(
    alsText(buildInsights(state, "2026-08")).some((t) => t.includes("geliehenes Geld")),
    "ein Darlehen im Restwert muss benannt werden"
  );
});

test("Analyse warnt beim Ueberschreiten des Kartenlimits", () => {
  const state = beispielState();
  state.months["2026-08"].kreditkarten[0].limit = 100;   /* Saldo im Beispiel ist 400 */
  assert.ok(alsText(buildInsights(state, "2026-08")).some((t) => t.includes("über Limit")));
});

test("Analyse schweigt zum Limit, solange keines gesetzt ist", () => {
  const state = beispielState();
  assert.ok(!alsText(buildInsights(state, "2026-08")).some((t) => t.includes("über Limit")));
});

test("Analyse vergleicht mit dem Vormonat", () => {
  const texte = alsText(buildInsights(beispielState(), "2026-08"));
  assert.ok(texte.some((t) => t.includes("Vergleich Juli 2026")), "der Vormonat wird herangezogen");
});

test("Analyse liefert bei leerem Monat trotzdem eine Aussage", () => {
  const { state } = migrate(null);
  const insights = buildInsights(state, state.currentMonth);
  assert.ok(insights.length >= 1);
  assert.ok(insights.every((i) => Array.isArray(i.parts)));
});

test("Analyse enthaelt kein Markup — die Oberflaeche setzt nie innerHTML", () => {
  const state = beispielState();
  state.months["2026-08"].ausgaben.push({ id: "x", name: "<script>böse</script>", betrag: 10, tag: "rot" });

  for (const key of Object.keys(state.months)) {
    for (const ins of buildInsights(state, key)) {
      for (const teil of ins.parts) {
        const text = typeof teil === "string" ? teil : teil.b;
        assert.ok(!/[<>]/.test(text), "spitze Klammer im Analysetext: " + text);
      }
    }
  }
});

/* ------------------------------------------------------------------ *
 * Bericht
 * ------------------------------------------------------------------ */

test("Bericht nennt Einkommen und Bestand getrennt", () => {
  const bericht = norm(buildReport(beispielState(), "2026-08"));

  assert.ok(bericht.includes("Erwerbseinkommen des Monats: 5'200.00 Fr."));
  assert.ok(bericht.includes("Bestand, kein Einkommen"));
  assert.ok(bericht.includes("geliehen, rückzahlbar"));
  assert.ok(bericht.includes("RESTWERT: 2'800.00 Fr."));
  assert.ok(bericht.includes("Sparquote auf Erwerbseinkommen: 53.8%"));
});

test("Bericht kommt mit einem leeren Monat zurecht", () => {
  const { state } = migrate(null);
  const bericht = buildReport(state, state.currentMonth);
  assert.ok(bericht.includes("RESTWERT: 0.00 Fr."));
  assert.ok(bericht.includes("- keine"), "leere Rechnungsliste wird benannt");
});

/* ------------------------------------------------------------------ *
 * Startzustand
 * ------------------------------------------------------------------ */

test("eine frische Installation startet leer", () => {
  const state = createSeedState(new Date("2026-08-25T10:00:00Z"));

  assert.deepEqual(Object.keys(state.months), ["2026-08"], "genau der laufende Monat");
  assert.equal(state.currentMonth, "2026-08");
  assert.equal(state.version, SCHEMA_VERSION);

  const m = state.months["2026-08"];
  assert.deepEqual(m.dauerauftraege, [], "keine vorgegebenen Auftraege");
  assert.deepEqual(m.fixkosten, [], "keine vorgegebenen Fixkosten");
  assert.deepEqual(m.ausgaben, []);
  assert.equal(totals(m).einnahmen, 0);
  assert.deepEqual(m.kreditkarten, [], "keine vorgegebenen Karten");
});

/**
 * Prueft strukturell statt gegen eine Wortliste.
 *
 * Eine Liste verbotener Begriffe waere selbst das Leck: sie nennt in einer
 * oeffentlichen Datei genau die Namen und Betraege, die geheim bleiben
 * sollen. „Keine Namen und keine Betraege ueberhaupt“ ist ausserdem die
 * schaerfere Zusage.
 */
test("der Startzustand enthaelt weder Namen noch Betraege", () => {
  const state = createSeedState();

  const namen = [];
  const betraege = [];
  for (const monat of Object.values(state.months)) {
    for (const liste of [monat.dauerauftraege, monat.fixkosten, monat.ausgaben]) {
      for (const zeile of liste) { namen.push(zeile.name); betraege.push(zeile.betrag); }
    }
    for (const k of monat.kreditkarten) { namen.push(k.name); betraege.push(k.betrag, k.limit); }
    betraege.push(...Object.values(monat.einnahmen));
  }

  assert.deepEqual(namen, [], "der Startzustand darf keine einzige benannte Zeile mitbringen");
  assert.ok(betraege.every((b) => b === 0), "jeder Betrag im Startzustand muss 0 sein");

  /* Nichts Unerwartetes im Datensatz — etwa Notizfelder aus einer Altfassung. */
  assert.deepEqual(Object.keys(state).sort(), ["currentMonth", "months", "updatedAt", "version"]);
});

test("currentMonthKey formatiert einstellige Monate mit fuehrender Null", () => {
  assert.equal(currentMonthKey(new Date("2026-01-15T12:00:00Z")), "2026-01");
  assert.equal(currentMonthKey(new Date("2026-12-31T12:00:00Z")), "2026-12");
});
