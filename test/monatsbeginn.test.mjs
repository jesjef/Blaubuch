/**
 * Monatsbeginn — der Monat muss nicht am 1. anfangen.
 *
 * Wer den Lohn am 25. bekommt, rechnet vom 25. bis und mit dem 24. des
 * Folgemonats. Der Schluessel eines Monats bleibt "JJJJ-MM" und meint den
 * Monat, in dem die Periode beginnt: "2026-10" mit Beginn 25 ist der
 * 25. Oktober bis 24. November 2026. Die Buchungen bleiben, wo sie sind —
 * die Einstellung aendert Bezeichnung, Zeitraum und die Reihenfolge der
 * Tage, nicht die Zahlen.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { migrate, totals, monthLabel, buildReport, uid } from "../src/shared/budget.mjs";
import {
  MONATSBEGINN_MAX, leseMonatsbeginn, monatsbeginn,
  zeitraum, periodeLabel, periodeVon, tagesfolge
} from "../src/shared/periode.mjs";
import { liquiditaet, jahresDaten } from "../src/shared/jahr.mjs";
import { buildMarkdown } from "../src/shared/markdown.mjs";
import { WERKZEUGE } from "../src/shared/ki.mjs";
import { beispielState, KONTO_HAUPT } from "./fixtures.mjs";

const werkzeug = (name) => WERKZEUGE.find((w) => w.name === name);

/* ------------------------------------------------------------------ *
 * Einlesen des Werts
 * ------------------------------------------------------------------ */

test("ohne Angabe beginnt der Monat am 1.", () => {
  assert.equal(leseMonatsbeginn(undefined), 1);
  assert.equal(monatsbeginn({}), 1);
});

test("nur ganze Tage von 1 bis 28 gelten — jeder Monat hat diesen Tag", () => {
  assert.equal(MONATSBEGINN_MAX, 28);
  assert.equal(leseMonatsbeginn(25), 25);
  assert.equal(leseMonatsbeginn("25"), 25);
  for (const falsch of [0, 29, 31, -1, 2.5, "x", null]) {
    assert.equal(leseMonatsbeginn(falsch), 1, String(falsch));
  }
});

test("migrate behaelt den Monatsbeginn und verwirft Unsinn", () => {
  const roh = beispielState();
  roh.monatsbeginn = 25;
  assert.equal(migrate(roh).state.monatsbeginn, 25);
  roh.monatsbeginn = 31;
  assert.equal(migrate(roh).state.monatsbeginn, 1);
  delete roh.monatsbeginn;
  assert.equal(migrate(roh).state.monatsbeginn, 1);
});

/* ------------------------------------------------------------------ *
 * Zeitraum und Bezeichnung
 * ------------------------------------------------------------------ */

test("mit Beginn 25 laeuft 2026-10 vom 25. Oktober bis und mit 24. November", () => {
  assert.deepEqual(zeitraum("2026-10", 25), { von: "2026-10-25", bis: "2026-11-24" });
});

test("mit Beginn 1 ist der Zeitraum der Kalendermonat, auch im Februar und Schaltjahr", () => {
  assert.deepEqual(zeitraum("2026-10", 1), { von: "2026-10-01", bis: "2026-10-31" });
  assert.deepEqual(zeitraum("2026-02", 1), { von: "2026-02-01", bis: "2026-02-28" });
  assert.deepEqual(zeitraum("2028-02", 1), { von: "2028-02-01", bis: "2028-02-29" });
});

test("ein Zeitraum ueber den Jahreswechsel endet im neuen Jahr", () => {
  assert.deepEqual(zeitraum("2026-12", 25), { von: "2026-12-25", bis: "2027-01-24" });
});

test("die Bezeichnung zeigt den Zeitraum, wenn der Monat nicht am 1. beginnt", () => {
  assert.equal(periodeLabel("2026-10", 25), "25. Okt – 24. Nov | 2026");
  assert.equal(periodeLabel("2026-12", 25), "25. Dez – 24. Jan | 2026/27");
  assert.equal(periodeLabel("2026-10", 1), "Oktober 2026");
});

test("monthLabel nimmt den Beginn mit und bleibt ohne ihn wie bisher", () => {
  assert.equal(monthLabel("2026-10"), "Oktober 2026");
  assert.equal(monthLabel("2026-10", 25), "25. Okt – 24. Nov | 2026");
});

test("ein Datum gehoert zu dem Monat, in dem seine Periode begann", () => {
  assert.equal(periodeVon(new Date(2026, 9, 14), 25), "2026-09");
  assert.equal(periodeVon(new Date(2026, 9, 24), 25), "2026-09");
  assert.equal(periodeVon(new Date(2026, 9, 25), 25), "2026-10");
  assert.equal(periodeVon(new Date(2027, 0, 3), 25), "2026-12");
  assert.equal(periodeVon(new Date(2026, 9, 14), 1), "2026-10");
});

test("eine leere Datei beginnt im laufenden Zeitraum, nicht im Kalendermonat", () => {
  const { state } = migrate({ version: 7, monatsbeginn: 25, months: {} });
  assert.equal(state.currentMonth, periodeVon(new Date(), 25));
});

/* ------------------------------------------------------------------ *
 * Tage und Liquiditaet
 * ------------------------------------------------------------------ */

test("die Tage beginnen am Monatsbeginn und laufen ueber das Monatsende weiter", () => {
  const folge = tagesfolge(25);
  assert.equal(folge.length, 31);
  assert.deepEqual(folge.slice(0, 8), [25, 26, 27, 28, 29, 30, 31, 1]);
  assert.equal(folge[folge.length - 1], 24);
  assert.deepEqual(tagesfolge(1), Array.from({ length: 31 }, (_, i) => i + 1));
});

test("Liquiditaet: der Lohn am 25. kommt vor der Miete am 1. — der Stand faellt nie ins Minus", () => {
  const state = beispielState();
  state.monatsbeginn = 25;
  const m = state.months[state.currentMonth];
  m.anfangsbestaende = { [KONTO_HAUPT]: 0 };
  m.einnahmen = [{ id: uid(), name: "Lohn", betrag: 5000, art: "erwerb", konto: KONTO_HAUPT, aktiv: true, faelligAm: 25, notiz: "" }];
  m.fixkosten = [{ id: uid(), name: "Miete", betrag: 1500, klasse: "ausgaben", vonKonto: KONTO_HAUPT, nachKonto: null, aktiv: true, faelligAm: 1, laeuftBis: null, notiz: "" }];
  m.ausgaben = [];
  m.kreditkarten = [];

  const d = liquiditaet(state, m);
  assert.equal(d.punkte[0].tag, 25);
  assert.equal(d.punkte[0].stand, 5000);
  assert.ok(d.punkte.every((p) => p.stand >= 0), "kein Tag unter null");
  assert.equal(d.ende, totals(state, m).rest);
});

test("Liquiditaet: Undatiertes zaehlt am ersten Tag der Periode", () => {
  const state = beispielState();
  state.monatsbeginn = 25;
  const m = state.months[state.currentMonth];
  const d = liquiditaet(state, m);
  assert.equal(d.punkte[0].tag, 25);
  assert.equal(d.punkte[0].stand, totals(state, m).rest);
});

/* ------------------------------------------------------------------ *
 * Ueberall dieselbe Bezeichnung
 * ------------------------------------------------------------------ */

test("Bericht, Jahresueberblick, Auszug und KI zeigen den Zeitraum", () => {
  const state = beispielState();
  state.monatsbeginn = 25;
  const key = state.currentMonth;
  const label = periodeLabel(key, 25);

  assert.ok(buildReport(state, key).includes(label), "Bericht");
  const jahr = key.slice(0, 4);
  assert.equal(jahresDaten(state, jahr).monate.find((x) => x.key === key).label, label, "Jahr");
  assert.ok(buildMarkdown(state).includes("## " + label), "Auszug");

  const liste = werkzeug("monate_auflisten").run(state).daten.monate.find((x) => x.key === key);
  assert.equal(liste.bezeichnung, label);
  assert.deepEqual(liste.zeitraum, zeitraum(key, 25));

  const monat = werkzeug("monat_lesen").run(state, { monat: key }).daten;
  assert.equal(monat.bezeichnung, label);
  assert.deepEqual(monat.zeitraum, zeitraum(key, 25));
});

test("die Zahlen haengen nicht am Monatsbeginn", () => {
  const state = beispielState();
  const key = state.currentMonth;
  const vorher = totals(state, state.months[key]);
  state.monatsbeginn = 25;
  assert.deepEqual(totals(state, state.months[key]), vorher);
});
