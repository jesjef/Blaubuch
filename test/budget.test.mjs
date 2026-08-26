import test from "node:test";
import assert from "node:assert/strict";

import {
  parseAmount, formatCHF, totals, migrate, monthFromPrevious,
  buildInsights, buildReport, monthLabel, isMonthKey, nextMonthKey,
  emptyMonth, KEIN_LIMIT, SCHEMA_VERSION, nachbarMonat
} from "../src/shared/budget.mjs";
import { createSeedState, currentMonthKey } from "../src/shared/seed.mjs";
import {
  beispielMonat, beispielState, einnahmeBetrag, anfangsbestand,
  fuegeEinnahmeHinzu, KONTO_HAUPT, KONTO_BAR
} from "./fixtures.mjs";

/* Seit Fassung 6 rechnet der Kern gegen den Stammsatz: Konten und
   Klassifizierungen liegen dort, nicht im Monat. `totals` liest daraus nur
   diese beiden — ein gemeinsamer Stamm genuegt deshalb fuer alle Monate,
   die aus derselben Vorlage stammen. */
const stamm = beispielState();
const leererMonat = () => emptyMonth(stamm);

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
  const t = totals(stamm, beispielMonat());

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
    const t = totals(stamm, state.months[key]);
    const summe = Math.round((t.byKlasse.ausgaben + t.byKlasse.investition + t.byKlasse.blockiert) * 100) / 100;
    assert.equal(summe, t.kosten, "Etikettensumme weicht ab in " + key);
  }
});

test("der Kreditkartensaldo zaehlt als Konsum", () => {
  const t = totals(stamm, beispielMonat());
  assert.equal(t.byKlasse.investition, 300, "nur der Sparplan ist gruen");
  assert.equal(t.byKlasse.ausgaben, 2500, "alles Uebrige inklusive der 500 Kartensaldo");
});

test("Sparquote misst am Erwerbseinkommen, nicht an Bestand oder Darlehen", () => {
  const monat = leererMonat();
  fuegeEinnahmeHinzu(monat, "Nettolohn", 5000, "erwerb");
  const ohne = totals(stamm, monat).sparquote;

  anfangsbestand(monat, KONTO_HAUPT, 4000);
  fuegeEinnahmeHinzu(monat, "Geliehen", 1000, "geliehen");
  const mit = totals(stamm, monat);

  assert.equal(ohne, 100, "ohne Kosten bleibt alles uebrig");
  assert.equal(mit.erwerb, 5000, "Bestand und Darlehen sind kein Einkommen");
  assert.equal(mit.einnahmen, 10000, "verfuegbare Mittel steigen sehr wohl");
  assert.ok(mit.sparquote > 100, "die Bezugsgroesse bleibt aber das Einkommen");
});

test("ein frischer Monat kennt jedes Konto, aber noch keine Einnahmezeile", () => {
  const monat = leererMonat();
  assert.deepEqual(monat.einnahmen, [], "Einnahmen sind seit Fassung 6 Zeilen, keine festen Felder");
  assert.deepEqual(
    Object.keys(monat.anfangsbestaende).sort(),
    stamm.konten.map((k) => k.id).sort(),
    "jedes Konto im Stamm bekommt einen Anfangsbestand — sonst fehlt es in der Rechnung"
  );
  assert.ok(Object.values(monat.anfangsbestaende).every((b) => b === 0));
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
  assert.equal(totals(stamm, state.months["2026-08"]).einnahmen, 5000, "und beeinflussen die Summe nicht");
});

test("Rappenrundung haelt Summen sauber", () => {
  const monat = leererMonat();
  monat.ausgaben = [
    { id: "a", name: "A", betrag: 0.1, klasse: "ausgaben", vonKonto: KONTO_HAUPT },
    { id: "b", name: "B", betrag: 0.2, klasse: "ausgaben", vonKonto: KONTO_HAUPT }
  ];
  assert.equal(totals(stamm, monat).re, 0.3, "0.1 + 0.2 darf nicht 0.30000000000000004 ergeben");
});

test("ein voellig leerer Monat ergibt lauter Nullen statt NaN", () => {
  const t = totals(stamm, leererMonat());
  for (const [feld, wert] of Object.entries(t)) {
    if (feld === "byKlasse" || feld === "sparquote") continue;
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
  assert.equal(einnahmeBetrag(m, "Nettolohn"), 5000, "Text wird zur Zahl");
  assert.equal(einnahmeBetrag(m, "Spesen"), 0, "null wird zu 0");
  assert.equal(m.kreditkarten.length, 1, "namenlose Kartenzeilen fliegen raus");
  assert.equal(m.kreditkarten[0].betrag, 0, "unlesbarer Betrag wird zu 0");
  assert.equal(m.kreditkarten[0].limit, 1000, "das Limit wird gelesen");
  assert.equal(m.dauerauftraege.length, 1, "namenlose und leere Zeilen werden verworfen");
  assert.equal(m.dauerauftraege[0].klasse, "ausgaben",
    "eine unbekannte Markierung gilt als ausgegeben — die vorsichtigere Annahme");
  assert.ok(m.dauerauftraege[0].vonKonto, "und bekommt ein Herkunftskonto");
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
        rechnungen: [{ name: "Zahnarzt", betrag: 250, klasse: "ausgaben", vonKonto: KONTO_HAUPT }]
      }
    }
  });

  const m = state.months["2026-08"];
  assert.equal(m.ausgaben.length, 1, "die alte Liste wird uebernommen");
  assert.equal(m.ausgaben[0].name, "Zahnarzt");
  assert.equal(totals(stamm, m).re, 250, "und zaehlt in der Summe mit");
  assert.ok(!("rechnungen" in m), "das alte Feld bleibt nicht daneben stehen");
});

test("liegen beide Felder vor, gewinnt das neue", () => {
  const { state } = migrate({
    months: {
      "2026-08": {
        ausgaben: [{ name: "Neu", betrag: 10, klasse: "ausgaben", vonKonto: KONTO_HAUPT }],
        rechnungen: [{ name: "Alt", betrag: 999, klasse: "ausgaben", vonKonto: KONTO_HAUPT }]
      }
    }
  });
  const m = state.months["2026-08"];
  assert.equal(m.ausgaben.length, 1);
  assert.equal(m.ausgaben[0].name, "Neu");
  assert.equal(totals(stamm, m).re, 10, "der alte Stand darf nicht doppelt zaehlen");
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
  const neu = monthFromPrevious(vorlage, "2026-09", stamm);

  assert.equal(einnahmeBetrag(neu, "Nettolohn"), 5000, "Gehalt wird uebernommen");
  /* Seit Fassung 6 entscheidet die Art, nicht der Feldname: Erwerb
     wiederholt sich Monat fuer Monat, also auch die Spesen. Frueher blieb
     nur „netto" stehen und die Spesen fielen unter den Tisch. */
  assert.equal(einnahmeBetrag(neu, "Spesen"), 200, "auch die Spesen — sie sind Erwerb");
  /* Der Endbestand des Vormonats steht als Vorschlag da — fortgeschrieben
     wird nichts, ueberschreiben bleibt moeglich. Auf dem Hauptkonto sind es
     2700, die uebrigen 100 liegen als Bargeld daneben. */
  assert.equal(anfangsbestand(neu, KONTO_HAUPT), 2700);
  assert.equal(anfangsbestand(neu, KONTO_BAR), 100);
  const summe = stamm.konten.reduce((s, k) => s + anfangsbestand(neu, k.id), 0);
  assert.equal(summe, totals(stamm, vorlage).rest,
    "die Summe der Kontosalden ist der Restwert — sonst ist eine Buchung verlorengegangen");
  assert.equal(neu.dauerauftraege.length, 2, "Auftraege kommen mit");
  assert.equal(neu.fixkosten.length, 2);
  assert.deepEqual(neu.ausgaben, [], "Ausgaben sind einmalig");
  assert.equal(neu.kreditkarten.length, 2, "die Karten selbst bleiben bestehen");
  assert.ok(neu.kreditkarten.every((k) => k.betrag === 0), "aber jeder Saldo faengt bei 0 an");

  const alteIds = vorlage.dauerauftraege.map((x) => x.id);
  assert.ok(neu.dauerauftraege.every((x) => !alteIds.includes(x.id)), "jede Zeile bekommt eine eigene id");
});

test("monthFromPrevious kommt auch ohne Vorlage klar", () => {
  assert.equal(totals(stamm, monthFromPrevious(undefined, "2026-09", stamm)).kosten, 0);
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
  fuegeEinnahmeHinzu(state.months["2026-08"], "Geliehen", 500, "geliehen");
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
  state.months["2026-08"].ausgaben.push({ id: "x", name: "<script>böse</script>", betrag: 10, klasse: "ausgaben", vonKonto: KONTO_HAUPT });

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
  assert.ok(bericht.includes("Bestand zu Monatsbeginn: 400.00 Fr. (kein Einkommen)"));
  assert.ok(bericht.includes("KONTEN (Stand am Monatsende)"), "die Konten stehen jetzt oben");
  assert.ok(bericht.includes("Nettolohn → Kontostand"), "jede Einnahme nennt ihr Zielkonto");
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
  assert.equal(totals(stamm, m).einnahmen, 0);
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
    for (const e of monat.einnahmen) { namen.push(e.name); betraege.push(e.betrag); }
    betraege.push(...Object.values(monat.anfangsbestaende));
  }

  assert.deepEqual(namen, [], "der Startzustand darf keine einzige benannte Zeile mitbringen");
  assert.ok(betraege.every((b) => b === 0), "jeder Betrag im Startzustand muss 0 sein");

  /* Konten und Klassifizierungen tragen Namen, aber es sind Bezeichnungen
     des Programms und keine Daten eines Menschen. Ohne sie waere der
     Startzustand nicht benutzbar: keine Zeile liesse sich buchen oder
     einordnen. Geprueft wird, dass es genau die mitgelieferten sind. */
  assert.deepEqual(state.konten.map((k) => k.name), ["Kontostand", "Bargeld"]);
  assert.deepEqual(
    state.klassen.map((k) => k.id),
    ["ausgaben", "investition", "sparen", "blockiert", "durchlauf"]
  );

  /* Nichts Unerwartetes im Datensatz — etwa Notizfelder aus einer Altfassung. */
  assert.deepEqual(Object.keys(state).sort(),
    ["currentMonth", "klassen", "konten", "months", "updatedAt", "version"]);
});

test("currentMonthKey formatiert einstellige Monate mit fuehrender Null", () => {
  assert.equal(currentMonthKey(new Date("2026-01-15T12:00:00Z")), "2026-01");
  assert.equal(currentMonthKey(new Date("2026-12-31T12:00:00Z")), "2026-12");
});

/* ------------------------------------------------------------------ *
 * Nach dem Loeschen eines Monats
 * ------------------------------------------------------------------ */

test("nach dem Löschen wird der Nachbarmonat gezeigt, nicht der älteste", () => {
  const drei = ["2026-06", "2026-07", "2026-08"];

  /* Der haeufigste Fall: den neuesten Monat loeschen. Genau hier lag der
     Fehler — die Oberflaeche landete auf 2026-06 statt auf 2026-07. */
  assert.equal(nachbarMonat(drei, "2026-08"), "2026-07", "der nächstältere");
  assert.equal(nachbarMonat(drei, "2026-07"), "2026-06");

  /* Den aeltesten geloescht: es gibt keinen aelteren, also der naechste. */
  assert.equal(nachbarMonat(drei, "2026-06"), "2026-07", "sonst der nächstjüngere");

  /* Ueber eine Luecke hinweg und ueber den Jahreswechsel. */
  assert.equal(nachbarMonat(["2025-11", "2026-03", "2026-04"], "2026-04"), "2026-03");
  assert.equal(nachbarMonat(["2025-12", "2026-01"], "2026-01"), "2025-12", "Jahreswechsel");

  /* Ein Monat, den es in der Liste gar nicht gibt: nichts faellt weg, und
     der naechstaeltere zu 2030-01 ist der neueste vorhandene. */
  assert.equal(nachbarMonat(drei, "2030-01"), "2026-08");

  assert.equal(nachbarMonat(["2026-08"], "2026-08"), null, "war es der letzte, bleibt nichts");
  assert.equal(nachbarMonat([], "2026-08"), null);
});
