/**
 * Kontofluss — Knoten, Kanten, Ebenen und Layout.
 *
 * Der Graph darf nie etwas anderes erzaehlen als die Zahlen: jede Summe
 * hier wird gegen totals() gespiegelt, nicht gegen eigene Erwartungswerte
 * allein. Wo die Rechnung eine Zeile ausschliesst (durchlauf, pausiert),
 * muss auch der Graph sie ausschliessen.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { totals, emptyMonth, uid } from "../src/shared/budget.mjs";
import {
  QUELLE, SENKE, KNOTEN_ART, KANTEN_ART,
  kontoflussDaten, ebenen, kantenPfad, kontenLayout
} from "../src/shared/kontofluss.mjs";
import { beispielState, KONTO_HAUPT, KONTO_BAR, fuegeEinnahmeHinzu } from "./fixtures.mjs";

/* ------------------------------------------------------------------ *
 * Aufbauhilfen
 * ------------------------------------------------------------------ */

function umbuchung(name, betrag, von, nach) {
  return {
    id: uid(), name, betrag, klasse: "sparen",
    vonKonto: von, nachKonto: nach,
    aktiv: true, faelligAm: null, laeuftBis: null, notiz: ""
  };
}

/**
 * Jeffreys Beispiel woertlich: der Lohn kommt aufs Lohnkonto, von dort
 * gehen 400 aufs Sparkonto, 500 aufs Taggeldkonto, 400 zu Saxo.
 */
function jeffrey() {
  const state = beispielState();
  state.konten.push(
    { id: "k-spar", name: "Sparkonto", institut: "", aktiv: true },
    { id: "k-tagg", name: "Taggeldkonto", institut: "", aktiv: true },
    { id: "k-saxo", name: "Saxo", institut: "", aktiv: true }
  );
  const monat = state.months["2026-08"];
  monat.dauerauftraege.push(
    umbuchung("Sparen", 400, KONTO_HAUPT, "k-spar"),
    umbuchung("Taggeld", 500, KONTO_HAUPT, "k-tagg"),
    umbuchung("Depot", 400, KONTO_HAUPT, "k-saxo")
  );
  return { state, monat };
}

const summe = (kanten, art) =>
  kanten.filter((k) => k.art === art).reduce((s, k) => s + k.wert, 0);

/* ------------------------------------------------------------------ *
 * Daten
 * ------------------------------------------------------------------ */

test("Einnahmen buendeln sich zur Kante Quelle → Zielkonto", () => {
  const state = beispielState();
  const monat = state.months["2026-08"];
  const daten = kontoflussDaten(state, monat);

  const einnahmen = daten.kanten.filter((k) => k.art === KANTEN_ART.einnahme);
  assert.equal(einnahmen.length, 1);                       /* beide Lohnzeilen aggregiert */
  assert.equal(einnahmen[0].von, QUELLE);
  assert.equal(einnahmen[0].nach, KONTO_HAUPT);
  assert.equal(einnahmen[0].wert, 5200);
});

test("eine Umbuchungszeile wird zur Konto→Konto-Kante, nie zur Ausgabe", () => {
  const { state, monat } = jeffrey();
  const daten = kontoflussDaten(state, monat);
  const t = totals(state, monat);

  const umbuchungen = daten.kanten.filter((k) => k.art === KANTEN_ART.umbuchung);
  assert.equal(umbuchungen.length, 3);
  assert.deepEqual(
    umbuchungen.map((k) => [k.von, k.nach, k.wert]).sort((a, b) => a[1] < b[1] ? -1 : 1),
    [[KONTO_HAUPT, "k-saxo", 400], [KONTO_HAUPT, "k-spar", 400], [KONTO_HAUPT, "k-tagg", 500]]
  );
  assert.equal(summe(daten.kanten, KANTEN_ART.umbuchung), t.umgebucht);
  assert.equal(t.umgebucht, 1300);
});

test("Summenspiegel: Kanten erzaehlen exakt dieselben Zahlen wie totals", () => {
  const { state, monat } = jeffrey();
  fuegeEinnahmeHinzu(monat, "Geschenk", 100, "sonstige", KONTO_BAR);
  fuegeEinnahmeHinzu(monat, "Vorschuss", 50, "geliehen", KONTO_HAUPT);
  const daten = kontoflussDaten(state, monat);
  const t = totals(state, monat);

  assert.equal(summe(daten.kanten, KANTEN_ART.einnahme), t.erwerb + t.geliehen + t.sonstige);
  assert.equal(summe(daten.kanten, KANTEN_ART.ausgabe), t.kosten);
  assert.equal(summe(daten.kanten, KANTEN_ART.umbuchung), t.umgebucht);
});

test("durchlauf und pausierte Zeilen erscheinen nirgends", () => {
  const { state, monat } = jeffrey();
  const vorher = kontoflussDaten(state, monat);

  fuegeEinnahmeHinzu(monat, "Fremdes Geld", 999, "durchlauf", KONTO_HAUPT);
  monat.ausgaben.push({ ...umbuchung("Auslage", 77, KONTO_HAUPT, null), klasse: "durchlauf" });
  monat.fixkosten.push({ ...umbuchung("Pausiert", 55, KONTO_HAUPT, "k-spar"), aktiv: false });

  const nachher = kontoflussDaten(state, monat);
  assert.deepEqual(nachher.kanten, vorher.kanten);
});

test("nachKonto gleich vonKonto oder unbekannt zaehlt als Ausgabe", () => {
  const { state, monat } = jeffrey();
  monat.ausgaben.push(
    umbuchung("Kreisbuchung", 60, KONTO_HAUPT, KONTO_HAUPT),
    umbuchung("Ins Leere", 40, KONTO_HAUPT, "gibt-es-nicht")
  );
  const daten = kontoflussDaten(state, monat);
  const t = totals(state, monat);

  assert.equal(summe(daten.kanten, KANTEN_ART.umbuchung), 1300);   /* unveraendert */
  assert.equal(summe(daten.kanten, KANTEN_ART.ausgabe), t.kosten); /* 60 + 40 zaehlen als Kosten */
});

test("Ketten ergeben Ebenen: Lohn → Spar → Depot liegt auf 1, 2, 3", () => {
  const state = beispielState();
  state.konten.push(
    { id: "k-spar", name: "Sparkonto", institut: "", aktiv: true },
    { id: "k-saxo", name: "Saxo", institut: "", aktiv: true }
  );
  const monat = state.months["2026-08"];
  monat.dauerauftraege.push(
    umbuchung("Sparen", 400, KONTO_HAUPT, "k-spar"),
    umbuchung("Depot", 100, "k-spar", "k-saxo")
  );
  const daten = kontoflussDaten(state, monat);
  const ebeneVon = (id) => daten.knoten.find((k) => k.id === id).ebene;

  assert.equal(ebeneVon(KONTO_HAUPT), 1);
  assert.equal(ebeneVon("k-spar"), 2);
  assert.equal(ebeneVon("k-saxo"), 3);
  assert.equal(ebeneVon(KONTO_BAR), 1);                  /* ohne Kanten: Ebene 1 */
  assert.equal(ebeneVon(QUELLE), 0);
  assert.equal(ebeneVon(SENKE), 4);                      /* hinter der tiefsten Kontoebene */
});

test("ein Kreis aus Umbuchungen terminiert, statt endlos zu steigen", () => {
  const eb = ebenen(["a", "b"], [
    { von: "a", nach: "b", wert: 10 },
    { von: "b", nach: "a", wert: 10 }
  ]);
  for (const wert of eb.values()) {
    assert.ok(Number.isFinite(wert) && wert >= 1);
  }
});

test("inaktive Konten bleiben Knoten, ein leerer Monat meldet sich leer", () => {
  const state = beispielState();
  state.konten.find((k) => k.id === KONTO_BAR).aktiv = false;
  const monat = state.months["2026-08"];

  const daten = kontoflussDaten(state, monat);
  const bar = daten.knoten.find((k) => k.id === KONTO_BAR);
  assert.ok(bar);
  assert.equal(bar.aktiv, false);

  const leerer = kontoflussDaten(state, emptyMonth(state));
  assert.equal(leerer.leer, true);
  assert.equal(leerer.kanten.length, 0);
  /* Alle Konten stehen trotzdem da — die Seite zeigt, was es gibt. */
  assert.deepEqual(
    leerer.knoten.filter((k) => k.art === KNOTEN_ART.konto).map((k) => k.id),
    state.konten.map((k) => k.id)
  );
});

test("jeder Kontoknoten traegt seinen gerechneten Saldo", () => {
  const { state, monat } = jeffrey();
  const daten = kontoflussDaten(state, monat);
  const spar = daten.knoten.find((k) => k.id === "k-spar");
  assert.equal(spar.saldo, 400);                          /* nur die Umbuchung */
});

/* ------------------------------------------------------------------ *
 * Geometrie
 * ------------------------------------------------------------------ */

test("kantenPfad ist eine wohlgeformte Kurve von links nach rechts", () => {
  const d = kantenPfad(10, 20, 110, 80);
  assert.match(d, /^M 10 20 C 60 20 60 80 110 80$/);
});

test("das Layout bleibt innerhalb der Zeichenflaeche und ohne NaN", () => {
  const { state, monat } = jeffrey();
  const plan = kontenLayout(kontoflussDaten(state, monat));

  assert.ok(plan.knoten.length >= 7);                     /* Quelle, 5 Konten, Senke */
  for (const k of plan.knoten) {
    for (const wert of [k.x, k.y, k.b, k.h]) assert.ok(Number.isFinite(wert));
    assert.ok(k.x >= 0 && k.x + k.b <= plan.breite);
    assert.ok(k.y >= 0 && k.y + k.h <= plan.hoehe);
  }
  for (const kante of plan.kanten) {
    assert.ok(kante.d.startsWith("M "));
    assert.ok(Number.isFinite(kante.staerke));
    assert.ok(Number.isFinite(kante.mx) && Number.isFinite(kante.my));
    assert.equal(typeof kante.beschriftung, "string");
    assert.match(kante.beschriftung, /Fr\.$/);
  }
});

test("die Kantenstaerke waechst mit dem Betrag und bleibt geklemmt", () => {
  const { state, monat } = jeffrey();
  const mass = { minStaerke: 1.5, maxStaerke: 10 };
  const plan = kontenLayout(kontoflussDaten(state, monat), mass);

  const staerken = new Map(plan.kanten.map((k) => [k.wert, k.staerke]));
  assert.ok(staerken.get(5200) > staerken.get(500));
  assert.ok(staerken.get(500) > staerken.get(400));
  for (const k of plan.kanten) {
    assert.ok(k.staerke >= mass.minStaerke && k.staerke <= mass.maxStaerke);
  }
});

test("viele Konten auf einer Ebene lassen die Flaeche wachsen statt stapeln", () => {
  const state = beispielState();
  for (let i = 0; i < 9; i++) {
    state.konten.push({ id: "k-x" + i, name: "Konto " + i, institut: "", aktiv: true });
  }
  const monat = state.months["2026-08"];
  const plan = kontenLayout(kontoflussDaten(state, monat));

  assert.ok(plan.hoehe > 220);
  /* Kein Knoten ueberlappt einen anderen derselben Spalte. */
  const spalten = new Map();
  for (const k of plan.knoten) {
    const liste = spalten.get(k.x) ?? [];
    liste.push(k);
    spalten.set(k.x, liste);
  }
  for (const liste of spalten.values()) {
    liste.sort((a, b) => a.y - b.y);
    for (let i = 1; i < liste.length; i++) {
      assert.ok(liste[i].y >= liste[i - 1].y + liste[i - 1].h);
    }
  }
});

test("das Layout ist deterministisch", () => {
  const { state, monat } = jeffrey();
  const a = kontenLayout(kontoflussDaten(state, monat));
  const b = kontenLayout(kontoflussDaten(state, monat));
  assert.deepEqual(a, b);
});

test("ein leerer Monat ergibt ein leeres Layout ohne Fehler", () => {
  const state = beispielState();
  const plan = kontenLayout(kontoflussDaten(state, emptyMonth(state)));
  assert.equal(plan.leer, true);
  assert.equal(plan.kanten.length, 0);
});
