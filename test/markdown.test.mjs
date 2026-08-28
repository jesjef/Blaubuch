/**
 * Markdown-Export über alle Monate.
 *
 * Der Export ist eine Abschrift, keine zweite Rechnung: jede Zahl darin
 * muss aus `totals()` stammen. Er verlaesst ausserdem den Tresor — was
 * drinsteht, steht danach im Klartext auf der Platte, und genau deshalb
 * wird hier geprueft, dass nichts Unerwartetes mitwandert.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { totals, formatCHF, emptyMonth, SCHEMA_VERSION, standardKlassen } from "../src/shared/budget.mjs";
import { buildMarkdown } from "../src/shared/markdown.mjs";
import { beispielState, KONTO_HAUPT } from "./fixtures.mjs";

test("der Export nennt jeden erfassten Monat", () => {
  const state = beispielState();
  const md = buildMarkdown(state);

  assert.match(md, /Juli 2026/);
  assert.match(md, /August 2026/);
  assert.match(md, /^# Blaubuch/m);
});

test("die Uebersicht traegt exakt die Zahlen aus totals", () => {
  const state = beispielState();
  const md = buildMarkdown(state);

  for (const key of ["2026-07", "2026-08"]) {
    const t = totals(state, state.months[key]);
    assert.ok(md.includes(formatCHF(t.einnahmen)), key + ": Mittel fehlen");
    assert.ok(md.includes(formatCHF(t.kosten)), key + ": Kosten fehlen");
    assert.ok(md.includes(formatCHF(t.rest)), key + ": Restwert fehlt");
  }
});

test("Konten stehen mit ihrem gerechneten Saldo da", () => {
  const state = beispielState();
  const md = buildMarkdown(state);
  assert.match(md, /Kontostand/);
  assert.match(md, /Bargeld/);
});

test("eine Umbuchung wird als solche ausgewiesen und nicht als Kosten", () => {
  const state = beispielState();
  state.konten.push({ id: "k-spar", name: "Sparkonto", institut: "", aktiv: true });
  state.months["2026-08"].dauerauftraege.push({
    id: "z1", name: "Sparen", betrag: 400, klasse: "sparen",
    vonKonto: KONTO_HAUPT, nachKonto: "k-spar",
    aktiv: true, faelligAm: null, laeuftBis: null, notiz: ""
  });

  const md = buildMarkdown(state);
  assert.match(md, /Umbuchung/);
  assert.match(md, /Sparkonto/);
});

test("Tag, Notiz und Pause wandern mit, wenn sie gesetzt sind", () => {
  const state = beispielState();
  const zeile = state.months["2026-08"].dauerauftraege[0];
  zeile.faelligAm = 25;
  zeile.notiz = "Verwendungszweck";
  state.months["2026-08"].fixkosten[0].aktiv = false;

  const md = buildMarkdown(state);
  assert.match(md, /25\./);
  assert.match(md, /Verwendungszweck/);
  assert.match(md, /pausiert/);
});

test("der Export bleibt gueltiges Markdown ohne Luecken", () => {
  const md = buildMarkdown(beispielState());
  assert.ok(!md.includes("undefined"), "undefined im Export");
  assert.ok(!md.includes("NaN"), "NaN im Export");
  assert.ok(!md.includes("[object Object]"), "rohes Objekt im Export");
  /* Jede Tabellenzeile hat gleich viele Spalten wie ihr Kopf. */
  const zeilen = md.split("\n");
  for (let i = 0; i < zeilen.length; i++) {
    if (!zeilen[i].startsWith("|") || !zeilen[i + 1]?.startsWith("|---")) continue;
    const spalten = zeilen[i].split("|").length;
    for (let j = i + 2; j < zeilen.length && zeilen[j].startsWith("|"); j++) {
      assert.equal(zeilen[j].split("|").length, spalten, "Spaltenzahl weicht ab: " + zeilen[j]);
    }
  }
});

test("ein leerer Zustand ergibt ein lesbares Dokument statt eines Fehlers", () => {
  const state = {
    version: SCHEMA_VERSION, updatedAt: "2026-08-01T00:00:00.000Z",
    currentMonth: "2026-08", klassen: standardKlassen(), konten: [], months: {}
  };
  state.months["2026-08"] = emptyMonth(state);

  const md = buildMarkdown(state);
  assert.match(md, /^# Blaubuch/m);
  assert.ok(!md.includes("undefined"));
});
