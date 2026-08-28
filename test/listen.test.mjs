/**
 * Gruppen und Untersummen in den Listen.
 *
 * Die harte Zusage: die Untersummen einer Liste ergeben zusammen genau
 * die Summe, die im Kartenkopf steht. Eine Gruppierung, die anders
 * rechnet als die Karte darueber, waere schlimmer als gar keine.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { totals, uid, toRappen } from "../src/shared/budget.mjs";
import { gruppen } from "../src/shared/listen.mjs";
import { beispielState, KONTO_HAUPT } from "./fixtures.mjs";

const zeile = (name, betrag, klasse, extra = {}) => ({
  id: uid(), name, betrag, klasse,
  vonKonto: KONTO_HAUPT, nachKonto: null,
  aktiv: true, faelligAm: null, laeuftBis: null, notiz: "", ...extra
});

test("die Untersummen ergeben genau die Summe der Karte", () => {
  const state = beispielState();
  const monat = state.months["2026-08"];
  const t = totals(state, monat);

  for (const [liste, summe] of [["dauerauftraege", t.da], ["fixkosten", t.fix], ["ausgaben", t.re]]) {
    const g = gruppen(state, monat, liste);
    const zusammen = toRappen(g.reduce((s, x) => s + x.summe, 0));
    assert.equal(zusammen, summe, liste + ": Untersummen weichen von der Kartensumme ab");
  }
});

test("jede Zeile taucht in genau einer Gruppe auf", () => {
  const state = beispielState();
  const monat = state.months["2026-08"];
  monat.dauerauftraege.push(zeile("Extra", 50, "sparen"));

  const g = gruppen(state, monat, "dauerauftraege");
  const ids = g.flatMap((x) => x.zeilen.map((z) => z.id));
  assert.equal(ids.length, monat.dauerauftraege.length);
  assert.equal(new Set(ids).size, ids.length, "eine Zeile steht doppelt");
});

test("Gruppen stehen absteigend nach Untersumme", () => {
  const state = beispielState();
  const monat = state.months["2026-08"];
  monat.dauerauftraege.push(zeile("Klein", 10, "sparen"), zeile("Gross", 9000, "blockiert"));

  const g = gruppen(state, monat, "dauerauftraege");
  for (let i = 1; i < g.length; i++) {
    assert.ok(g[i - 1].summe >= g[i].summe, "nicht absteigend");
  }
});

test("Umbuchungen und pausierte Zeilen bleiben sichtbar, zaehlen aber nicht mit", () => {
  const state = beispielState();
  state.konten.push({ id: "k-spar", name: "Sparkonto", institut: "", aktiv: true });
  const monat = state.months["2026-08"];
  monat.dauerauftraege.push(
    zeile("Sparen", 400, "sparen", { nachKonto: "k-spar" }),
    zeile("Pausiert", 300, "sparen", { aktiv: false })
  );

  const g = gruppen(state, monat, "dauerauftraege");
  const sparen = g.find((x) => x.id === "sparen");
  assert.equal(sparen.zeilen.length, 2, "beide Zeilen muessen sichtbar bleiben");
  assert.equal(sparen.summe, 0, "keine der beiden zaehlt als Kosten");
  assert.equal(sparen.ausgenommen, 2, "die Zahl der nicht gezaehlten Zeilen fehlt");

  /* Und die Zusage haelt weiterhin. */
  const t = totals(state, monat);
  assert.equal(toRappen(g.reduce((s, x) => s + x.summe, 0)), t.da);
});

test("eine leere Liste ergibt keine Gruppen statt einer leeren Gruppe", () => {
  const state = beispielState();
  assert.deepEqual(gruppen(state, state.months["2026-07"], "ausgaben"), []);
});

test("eine Zeile mit unbekannter Klasse landet in der Standardgruppe", () => {
  const state = beispielState();
  const monat = state.months["2026-08"];
  monat.ausgaben.push(zeile("Verwaist", 20, "gibt-es-nicht"));

  const g = gruppen(state, monat, "ausgaben");
  const ids = g.flatMap((x) => x.zeilen.map((z) => z.name));
  assert.ok(ids.includes("Verwaist"));
  assert.ok(g.every((x) => state.klassen.some((k) => k.id === x.id)), "unbekannte Gruppe erfunden");
});
