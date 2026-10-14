/**
 * Die Werkzeuge für den KI-Zugriff (1.4.0, Stufe 1: Lesen).
 *
 * Die wichtigste Zusage: Die KI sieht dieselben Zahlen wie der Bildschirm.
 * Deshalb rechnen die Werkzeuge mit denselben Funktionen — und diese Tests
 * vergleichen gegen genau diese Funktionen, nicht gegen abgeschriebene Werte.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { totals, kontoSaldo, buildReport, sortedMonths } from "../src/shared/budget.mjs";
import { jahresDaten, liquiditaet } from "../src/shared/jahr.mjs";
import { WERKZEUGE, fuehreAus, KiFehler, RESSOURCEN, leseRessource } from "../src/shared/ki.mjs";
import { beispielState, KONTO_BAR } from "./fixtures.mjs";

const NAMEN = [
  "monate_auflisten", "konten_lesen", "monat_lesen", "analyse",
  "bericht", "jahresueberblick", "liquiditaet"
];

test("es gibt genau die sieben Lese-Werkzeuge aus dem Plan, in fester Reihenfolge", () => {
  assert.deepEqual(WERKZEUGE.map((w) => w.name), NAMEN);
  for (const w of WERKZEUGE) {
    assert.equal(typeof w.description, "string");
    assert.ok(w.description.length > 20, w.name + " braucht eine Beschreibung, die eine KI versteht");
    assert.equal(w.inputSchema.type, "object", w.name);
    assert.equal(w.inputSchema.additionalProperties, false, w.name + " nimmt nur bekannte Argumente");
    assert.equal(w.annotations?.readOnlyHint, true, w.name + " liest nur");
  }
});

test("monate_auflisten nennt alle Monate und den aktuellen", () => {
  const state = beispielState();
  const r = fuehreAus("monate_auflisten", {}, state);
  assert.deepEqual(r.daten.monate.map((m) => m.key), sortedMonths(state));
  assert.equal(r.daten.aktuell, state.currentMonth);
});

test("monat_lesen liefert exakt die Summen aus totals()", () => {
  const state = beispielState();
  const r = fuehreAus("monat_lesen", { monat: "2026-08" }, state);
  const t = totals(state, state.months["2026-08"]);
  for (const feld of ["einnahmen", "kosten", "rest", "ueberschuss", "sparquote", "umgebucht", "verloren", "erwerb", "bestand"]) {
    assert.equal(r.daten.summen[feld], t[feld], feld);
  }
  assert.equal(r.daten.fixkosten.length, state.months["2026-08"].fixkosten.length);
});

test("ohne Monat gilt der aktuelle", () => {
  const state = beispielState();
  assert.equal(fuehreAus("monat_lesen", {}, state).daten.monat, state.currentMonth);
});

test("ausgeblendete Konten: die KI sieht dieselbe Rechnung wie der Bildschirm", () => {
  const state = beispielState();
  state.konten.find((k) => k.id === KONTO_BAR).aktiv = false;
  const monat = state.months["2026-08"];
  monat.fixkosten[0].vonKonto = KONTO_BAR;
  const r = fuehreAus("monat_lesen", { monat: "2026-08" }, state);
  assert.equal(r.daten.summen.rest, totals(state, monat).rest);
  const zeile = r.daten.fixkosten[0];
  assert.equal(zeile.wirkung, "aussen", "die Zeile sagt, warum sie nicht zählt");
});

test("konten_lesen nennt Saldo und ob das Konto zählt", () => {
  const state = beispielState();
  state.konten[1].aktiv = false;
  const r = fuehreAus("konten_lesen", { monat: "2026-08" }, state);
  assert.equal(r.daten.konten.length, 2);
  for (const k of r.daten.konten) {
    assert.equal(k.saldo, kontoSaldo(state, state.months["2026-08"], k.id));
  }
  assert.equal(r.daten.konten[1].ausgeblendet, true);
});

test("bericht ist der bekannte Monatsbericht", () => {
  const state = beispielState();
  assert.equal(fuehreAus("bericht", { monat: "2026-07" }, state).text, buildReport(state, "2026-07"));
});

test("analyse liefert die Beobachtungen als Sätze", () => {
  const r = fuehreAus("analyse", { monat: "2026-08" }, beispielState());
  assert.ok(r.daten.beobachtungen.some((b) => b.text.startsWith("Sparquote")));
});

test("jahresueberblick und liquiditaet rechnen mit den bekannten Funktionen", () => {
  const state = beispielState();
  const j = fuehreAus("jahresueberblick", { jahr: "2026" }, state).daten;
  assert.equal(j.summe.rest, jahresDaten(state, "2026").summe.rest);
  const l = fuehreAus("liquiditaet", { monat: "2026-08" }, state).daten;
  assert.equal(l.ende, liquiditaet(state, state.months["2026-08"]).ende);
  assert.equal(l.punkte, undefined, "31 Tagespunkte sind Ballast — Start, Ende und Tiefpunkt genügen");
});

test("ein unbekannter Monat ergibt einen verständlichen Fehler", () => {
  assert.throws(
    () => fuehreAus("monat_lesen", { monat: "1999-01" }, beispielState()),
    (e) => e instanceof KiFehler && /1999-01/.test(e.message) && /2026-08/.test(e.message)
  );
});

test("unsinnige Argumente werden abgewiesen statt erraten", () => {
  const state = beispielState();
  assert.throws(() => fuehreAus("monat_lesen", { monat: "August" }, state), KiFehler);
  assert.throws(() => fuehreAus("monat_lesen", { monat: "2026-08", extra: 1 }, state), KiFehler);
  assert.throws(() => fuehreAus("jahresueberblick", { jahr: 2026 }, state), KiFehler);
  assert.throws(() => fuehreAus("gibt_es_nicht", {}, state), KiFehler);
});

test("das Datenmodell ist als Ressource lesbar und erklärt die Begriffe", () => {
  assert.equal(RESSOURCEN.length, 1);
  const r = leseRessource(RESSOURCEN[0].uri);
  assert.equal(r.mimeType, "text/markdown");
  for (const begriff of ["Umbuchung", "ausgeblendet", "Sparquote", "Durchlaufgeld", "Erwerbseinkommen"]) {
    assert.ok(r.text.includes(begriff), begriff);
  }
  assert.throws(() => leseRessource("blaubuch://gibt-es-nicht"), KiFehler);
});
