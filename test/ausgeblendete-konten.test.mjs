/**
 * Ausgeblendete Konten (aktiv: false).
 *
 * Fehlerbericht von Niklas, 2026-10-14, Blaubuch 1.3.1: Das Häkchen nahm
 * nur den Anfangsbestand aus der Rechnung. Buchungen auf oder von einem
 * ausgeblendeten Konto zählten weiter — eine Umbuchung dorthin verschwand
 * sogar ganz. Im echten Fall stand 2'903.28 statt 1'244.08 als Restwert.
 *
 * Die Zusage, die hier festgehalten wird:
 *
 *   Restwert = Summe der Saldi aller aktiven Konten.
 *
 * So liest sich die Kontentabelle, und so muss die Hauptzahl stimmen.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  totals, kontoSaldo, standardKlassen, buildInsights, buildReport, SCHEMA_VERSION, ZEILEN_LISTEN
} from "../src/shared/budget.mjs";
import { liquiditaet } from "../src/shared/jahr.mjs";
import { gruppen } from "../src/shared/listen.mjs";

const zeile = (name, betrag, vonKonto, nachKonto, klasse = "ausgaben") => ({
  id: name, name, betrag, klasse, vonKonto, nachKonto,
  aktiv: true, faelligAm: null, laeuftBis: null, notiz: ""
});
const einnahme = (name, betrag, konto, art) => ({
  id: name, name, betrag, art, konto, aktiv: true, faelligAm: null, notiz: ""
});

/** Niklas' Minimalbeispiel, Wort für Wort aus dem Bericht. */
function beispiel() {
  const state = {
    version: SCHEMA_VERSION,
    currentMonth: "2026-10",
    klassen: standardKlassen(),
    konten: [
      { id: "privat", name: "Privatkonto", institut: "", aktiv: true },
      { id: "spar", name: "Sparkonto", institut: "", aktiv: false }
    ],
    months: {}
  };
  const monat = {
    anfangsbestaende: { privat: 1000, spar: 5000 },
    einnahmen: [
      einnahme("Lohn", 5000, "privat", "erwerb"),
      einnahme("Zins Sparkonto", 50, "spar", "sonstige")
    ],
    fixkosten: [
      zeile("Miete", 1500, "privat", null),
      zeile("Sparauftrag", 500, "privat", "spar", "sparen")
    ],
    kreditkarten: [],
    ausgaben: [zeile("Möbel ab Sparkonto", 200, "spar", null)]
  };
  state.months["2026-10"] = monat;
  return { state, monat };
}

const summeAktiv = (state, monat) => Math.round(
  state.konten.filter((k) => k.aktiv !== false)
    .reduce((s, k) => s + kontoSaldo(state, monat, k.id), 0) * 100
) / 100;

test("Niklas' Beispiel: Mittel, Kosten, Umgebucht und Restwert", () => {
  const { state, monat } = beispiel();
  const t = totals(state, monat);

  assert.equal(t.einnahmen, 6000, "der Zins landet auf dem ausgeblendeten Konto");
  assert.equal(t.kosten, 2000, "Miete und Sparauftrag verlassen das aktive Geld");
  assert.equal(t.umgebucht, 0, "eine Umbuchung ins Ausgeblendete ist keine Umbuchung im Sichtbaren");
  assert.equal(t.byKlasse.sparen, 500, "der Sparauftrag steht unter Sparen — nicht verloren");
  assert.equal(t.verloren, 1500, "die Möbel vom Sparkonto zählen nicht");
  assert.equal(t.rest, 4000);
  assert.equal(t.rest, kontoSaldo(state, monat, "privat"));
});

test("Sparen aufs ausgeblendete Konto drückt die Sparquote nicht", () => {
  const { state, monat } = beispiel();
  const t = totals(state, monat);
  /* Verdient 5000, verloren 1500; die 500 sind gespart, nicht ausgegeben. */
  assert.equal(t.ueberschuss, 3500);
  assert.equal(t.sparquote, 70);
});

test("Geld aus dem ausgeblendeten Konto erhöht die Mittel, aber nicht die Sparquote", () => {
  const { state, monat } = beispiel();
  const vorher = totals(state, monat);
  monat.ausgaben.push(zeile("Bezug vom Sparkonto", 800, "spar", "privat"));
  const nachher = totals(state, monat);

  assert.equal(nachher.einnahmen - vorher.einnahmen, 800);
  assert.equal(nachher.rest - vorher.rest, 800);
  assert.equal(nachher.kosten, vorher.kosten, "ein Zufluss ist keine Ausgabe");
  assert.equal(nachher.sparquote, vorher.sparquote, "vom Ersparten leben ist kein Sparen");
  assert.equal(nachher.rest, summeAktiv(state, monat));
});

test("eine Karte, die vom ausgeblendeten Konto bezahlt wird, zählt nicht", () => {
  const { state, monat } = beispiel();
  monat.kreditkarten.push({ id: "k", name: "Karte", betrag: 300, limit: 0, vonKonto: "spar", notiz: "" });
  const t = totals(state, monat);
  assert.equal(t.kk, 0);
  assert.equal(t.rest, 4000);
});

test("ein Konto, das es nicht gibt, wird nicht wie ein ausgeblendetes behandelt", () => {
  const { state, monat } = beispiel();
  monat.ausgaben.push(zeile("Ohne Konto", 100, "gibt-es-nicht", null));
  assert.equal(totals(state, monat).kosten, 2100, "im Zweifel zählt die Ausgabe");
});

test("Liquiditätsverlauf endet auch mit ausgeblendetem Konto auf dem Restwert", () => {
  const { state, monat } = beispiel();
  monat.ausgaben.push(zeile("Bezug vom Sparkonto", 800, "spar", "privat"));
  assert.equal(liquiditaet(state, monat).ende, totals(state, monat).rest);
});

test("die Untersummen der Gruppen ergeben die Kartensumme", () => {
  const { state, monat } = beispiel();
  monat.ausgaben.push(zeile("Bezug vom Sparkonto", 800, "spar", "privat"));
  const t = totals(state, monat);
  const summe = (liste) => gruppen(state, monat, liste).reduce((s, g) => s + g.summe, 0);
  assert.equal(summe("fixkosten"), t.fix);
  assert.equal(summe("ausgaben"), t.re);
});

/* ------------------------------------------------------------------ *
 * Eigenschaft über zufällige Monate
 * ------------------------------------------------------------------ */

/** Kleiner, reproduzierbarer Zufall — ein Fehlschlag muss sich wiederholen lassen. */
function zufall(saat) {
  let s = saat >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

test("Eigenschaft: Restwert = Summe der aktiven Saldi = Ende des Liquiditätsverlaufs", () => {
  const r = zufall(20261014);
  const wahl = (liste) => liste[Math.floor(r() * liste.length)];
  const betrag = () => Math.round(r() * 300000) / 100;
  const klassen = ["ausgaben", "investition", "sparen", "blockiert"];

  for (let lauf = 0; lauf < 300; lauf++) {
    const konten = ["a", "b", "c", "d"].map((id) => ({ id, name: id, institut: "", aktiv: r() < 0.6 }));
    const ids = konten.map((k) => k.id);
    const ziele = [...ids, null, ""];
    const state = { version: SCHEMA_VERSION, klassen: standardKlassen(), konten, months: {} };
    const monat = {
      anfangsbestaende: Object.fromEntries(ids.map((id) => [id, betrag()])),
      einnahmen: Array.from({ length: 3 }, (_, i) =>
        einnahme("e" + i, betrag(), wahl(ids), wahl(["erwerb", "geliehen", "sonstige"]))),
      fixkosten: [], ausgaben: [],
      kreditkarten: Array.from({ length: 2 }, (_, i) =>
        ({ id: "k" + i, name: "k" + i, betrag: betrag(), limit: 0, vonKonto: wahl(ids), notiz: "" }))
    };
    for (const liste of ZEILEN_LISTEN) {
      monat[liste] = Array.from({ length: 5 }, (_, i) =>
        zeile(liste + i, betrag(), wahl(ids), wahl(ziele), wahl(klassen)));
    }

    const t = totals(state, monat);
    const fall = "Lauf " + lauf + ": " + JSON.stringify({ konten, monat });
    assert.equal(t.rest, summeAktiv(state, monat), fall);
    assert.equal(liquiditaet(state, monat).ende, t.rest, fall);
  }
});

test("Analyse und Bericht sagen, was ins Ausgeblendete geht und von dort kommt", () => {
  const { state, monat } = beispiel();
  monat.ausgaben.push(zeile("Bezug vom Sparkonto", 800, "spar", "privat"));
  const text = buildInsights(state, "2026-10")
    .map((i) => i.parts.map((p) => (typeof p === "string" ? p : p.b)).join("")).join("\n");
  assert.match(text, /Auf ausgeblendete Konten gebucht: 500/);
  assert.match(text, /Aus ausgeblendeten Konten geholt: 800/);
  assert.doesNotMatch(text, /Zwischen eigenen Konten umgebucht/, "der Sparauftrag ist keine Umbuchung mehr");

  const bericht = buildReport(state, "2026-10");
  assert.match(bericht, /Sparauftrag: .*Sparkonto \(ausgeblendet\), zählt als Kosten/);
  assert.doesNotMatch(bericht, /Sparauftrag: .*keine Kosten/);
});
