/**
 * Jahresueberblick und Liquiditaetsverlauf.
 *
 * Beides sind Auswertungen, keine neuen Zahlen: der Jahresueberblick
 * summiert Monate, die die App ohnehin rechnet, und der Verlauf verteilt
 * die Betraege eines Monats auf seine Tage. Deshalb wird hier gegen
 * `totals()` gespiegelt — eine Auswertung, die etwas anderes sagt als die
 * Buchhaltung, waere schlimmer als gar keine.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { totals, emptyMonth, uid } from "../src/shared/budget.mjs";
import {
  jahre, jahresDaten, jahresKlassen, jahresLayout,
  liquiditaet, liquiditaetLayout
} from "../src/shared/jahr.mjs";
import { beispielState, KONTO_HAUPT } from "./fixtures.mjs";

const zeile = (name, betrag, klasse, faelligAm = null, extra = {}) => ({
  id: uid(), name, betrag, klasse,
  vonKonto: KONTO_HAUPT, nachKonto: null,
  aktiv: true, faelligAm, laeuftBis: null, notiz: "", ...extra
});

/* ------------------------------------------------------------------ *
 * Jahresueberblick
 * ------------------------------------------------------------------ */

test("jahre listet die Jahre, zu denen es Monate gibt", () => {
  const state = beispielState();
  state.months["2025-11"] = emptyMonth(state);
  assert.deepEqual(jahre(state), ["2025", "2026"]);
});

test("der Jahresueberblick summiert genau das, was totals je Monat rechnet", () => {
  const state = beispielState();
  const daten = jahresDaten(state, "2026");

  assert.equal(daten.monate.length, 2, "Juli und August");
  for (const m of daten.monate) {
    const t = totals(state, state.months[m.key]);
    assert.equal(m.einnahmen, t.einnahmen, m.key + ": Einnahmen");
    assert.equal(m.kosten, t.kosten, m.key + ": Kosten");
    assert.equal(m.rest, t.rest, m.key + ": Restwert");
  }

  const summeKosten = daten.monate.reduce((s, m) => s + m.kosten, 0);
  assert.equal(daten.summe.kosten, summeKosten);
  assert.equal(daten.schnitt.kosten, Math.round((summeKosten / 2) * 100) / 100);
});

test("Monate ohne Eintrag im Jahr fehlen, statt als Null zu erscheinen", () => {
  const state = beispielState();
  const daten = jahresDaten(state, "2026");
  assert.deepEqual(daten.monate.map((m) => m.key), ["2026-07", "2026-08"]);

  const leeres = jahresDaten(state, "2024");
  assert.equal(leeres.leer, true);
  assert.deepEqual(leeres.monate, []);
});

test("die Wirkung teilt die Kosten auf, ohne dass etwas verlorengeht", () => {
  const state = beispielState();
  const daten = jahresDaten(state, "2026");
  for (const m of daten.monate) {
    const teile = Object.values(m.byWirkung).reduce((s, w) => s + w, 0);
    assert.equal(Math.round(teile * 100) / 100, m.kosten, m.key + ": Wirkungen ergeben die Kosten");
  }
});

test("die Klassentabelle nennt Summe und Durchschnitt und sortiert absteigend", () => {
  const state = beispielState();
  const daten = jahresDaten(state, "2026");
  const reihen = jahresKlassen(daten, state.klassen);

  assert.ok(reihen.length > 0);
  for (let i = 1; i < reihen.length; i++) {
    assert.ok(reihen[i - 1].summe >= reihen[i].summe, "nicht absteigend sortiert");
  }
  const ausgaben = reihen.find((r) => r.id === "ausgaben");
  const erwartet = daten.monate.reduce((s, m) => s + (m.byKlasse.ausgaben ?? 0), 0);
  assert.equal(ausgaben.summe, Math.round(erwartet * 100) / 100);
  assert.equal(ausgaben.schnitt, Math.round((erwartet / 2) * 100) / 100);
});

test("das Jahreslayout bleibt in der Flaeche und stapelt lueckenlos", () => {
  const state = beispielState();
  const plan = jahresLayout(jahresDaten(state, "2026"));

  assert.equal(plan.saeulen.length, 2);
  for (const s of plan.saeulen) {
    for (const wert of [s.x, s.breite, s.einnahme.y, s.einnahme.h]) assert.ok(Number.isFinite(wert));
    assert.ok(s.x >= 0 && s.x + s.breite <= plan.breite);
    assert.ok(s.einnahme.y >= 0 && s.einnahme.y + s.einnahme.h <= plan.hoehe);
    /* Der Stapel sitzt ohne Luecke auf sich selbst. */
    for (let i = 1; i < s.stapel.length; i++) {
      const oben = s.stapel[i - 1];
      assert.ok(Math.abs(oben.y + oben.h - s.stapel[i].y) < 0.02, "Luecke im Stapel");
    }
  }
  assert.ok(plan.restPfad.startsWith("M "));
});

test("ein leeres Jahr zeichnet nichts, statt durch null zu teilen", () => {
  const plan = jahresLayout(jahresDaten(beispielState(), "2024"));
  assert.equal(plan.leer, true);
  assert.deepEqual(plan.saeulen, []);
});

/* ------------------------------------------------------------------ *
 * Liquiditaetsverlauf
 * ------------------------------------------------------------------ */

test("der Verlauf endet auf dem Restwert des Monats", () => {
  const state = beispielState();
  const monat = state.months["2026-08"];
  monat.dauerauftraege[0].faelligAm = 1;
  monat.einnahmen[0].faelligAm = 25;

  const v = liquiditaet(state, monat);
  const t = totals(state, monat);
  assert.equal(v.ende, t.rest, "Endstand weicht vom Restwert ab");
  assert.equal(v.start, t.bestand, "Startstand ist nicht der Anfangsbestand");
});

test("der tiefste Stand liegt vor dem Lohn, wenn die Miete vorher laeuft", () => {
  const state = beispielState();
  const monat = state.months["2026-08"];
  /* Alles ohne Tag zaehlt zum Monatsanfang — hier bekommt jede Zeile einen. */
  for (const e of monat.einnahmen) e.faelligAm = 25;
  for (const z of [...monat.dauerauftraege, ...monat.fixkosten, ...monat.ausgaben]) z.faelligAm = 3;
  monat.kreditkarten = [];

  const v = liquiditaet(state, monat);
  assert.equal(v.tiefster.tag, 3, "der Tiefpunkt liegt nicht am Zahltag der Kosten");
  assert.ok(v.tiefster.stand < v.start, "der Tiefpunkt ist nicht tiefer als der Start");
  assert.ok(v.tiefster.stand < v.ende, "nach dem Lohn muesste es wieder hoeher sein");
});

test("eine Umbuchung bewegt den Verlauf nicht — das Geld bleibt im Vermoegen", () => {
  const state = beispielState();
  state.konten.push({ id: "k-spar", name: "Sparkonto", institut: "", aktiv: true });
  const monat = state.months["2026-08"];
  const vorher = liquiditaet(state, monat);

  monat.dauerauftraege.push(zeile("Sparen", 400, "sparen", 10, { nachKonto: "k-spar" }));
  const nachher = liquiditaet(state, monat);

  assert.equal(nachher.ende, vorher.ende);
  assert.deepEqual(nachher.punkte, vorher.punkte);
});

test("Durchlaufgeld und pausierte Zeilen bleiben aussen vor", () => {
  const state = beispielState();
  const monat = state.months["2026-08"];
  const vorher = liquiditaet(state, monat);

  monat.ausgaben.push(zeile("Auslage", 500, "durchlauf", 12));
  monat.fixkosten.push(zeile("Pausiert", 300, "ausgaben", 12, { aktiv: false }));
  assert.deepEqual(liquiditaet(state, monat).punkte, vorher.punkte);
});

test("Zeilen ohne Tag zaehlen zum Monatsanfang und werden gemeldet", () => {
  const state = beispielState();
  const monat = state.months["2026-08"];
  const v = liquiditaet(state, monat);

  assert.ok(v.ohneTag > 0, "die undatierten Zeilen werden nicht gemeldet");
  assert.equal(v.punkte[0].tag, 1);
  /* Am ersten Tag liegt bereits alles Undatierte drin. */
  assert.notEqual(v.punkte[0].stand, v.start);
});

test("ein leerer Monat ergibt einen leeren Verlauf statt einer Nulllinie", () => {
  const state = beispielState();
  const v = liquiditaet(state, emptyMonth(state));
  assert.equal(v.leer, true);
  assert.deepEqual(v.punkte, []);

  const plan = liquiditaetLayout(v);
  assert.equal(plan.leer, true);
  assert.equal(plan.pfad, "");
});

test("die Kurve bleibt in der Flaeche und markiert den Tiefpunkt", () => {
  const state = beispielState();
  const monat = state.months["2026-08"];
  for (const e of monat.einnahmen) e.faelligAm = 25;
  for (const z of monat.dauerauftraege) z.faelligAm = 3;

  const v = liquiditaet(state, monat);
  const plan = liquiditaetLayout(v);

  assert.ok(plan.pfad.startsWith("M "));
  for (const p of plan.punkte) {
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
    assert.ok(p.x >= 0 && p.x <= plan.breite);
    assert.ok(p.y >= 0 && p.y <= plan.hoehe);
  }
  assert.ok(Number.isFinite(plan.tiefster.x) && Number.isFinite(plan.tiefster.y));
  assert.equal(plan.tiefster.tag, v.tiefster.tag);
});
