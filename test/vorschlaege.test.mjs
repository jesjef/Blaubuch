/**
 * Vorschläge der KI (1.4.0-Plan, Stufe 2).
 *
 * Die Zusage: Eine KI kann vorschlagen, aber nichts ändern. Ein Vorschlag
 * gilt erst, wenn der Anwender ihn annimmt — und nur, wenn sich die
 * betroffene Zeile seither nicht verändert hat.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { totals } from "../src/shared/budget.mjs";
import {
  erstelleVorschlag, istVeraltet, wendeAn, beschreibe, Vorschlagsliste, MAX_OFFEN
} from "../src/shared/vorschlaege.mjs";
import { KiFehler } from "../src/shared/ki-fehler.mjs";
import { beispielState, KONTO_HAUPT, KONTO_BAR } from "./fixtures.mjs";

const kopie = (x) => JSON.parse(JSON.stringify(x));
const B = "Weil es im Bericht so steht.";

/* ------------------------------------------------------------------ *
 * Erstellen: prüfen und auflösen, ohne etwas zu ändern
 * ------------------------------------------------------------------ */

test("eine neue Zeile wird geprüft und aufgelöst — der Stand bleibt unberührt", () => {
  const state = beispielState();
  const vorher = JSON.stringify(state);
  const v = erstelleVorschlag("zeile", {
    monat: "2026-08", liste: "ausgaben", name: "Velo-Service", betrag: 89.5,
    klassifizierung: "ausgaben", von: "Bargeld", tag: 12, begruendung: B
  }, state);

  assert.equal(JSON.stringify(state), vorher, "Vorschlagen ändert nichts");
  assert.equal(v.art, "zeile");
  assert.equal(v.neu.vonKonto, KONTO_BAR, "Kontoname wird zur Kennung");
  assert.equal(v.neu.klasse, "ausgaben");
  assert.equal(v.neu.nachKonto, null);
  assert.equal(v.neu.faelligAm, 12);
});

test("Namen werden ohne Rücksicht auf Gross-/Kleinschreibung gefunden, Kennungen auch", () => {
  const state = beispielState();
  const a = erstelleVorschlag("zeile", { liste: "fixkosten", name: "x", betrag: 1, klassifizierung: "SPAREN", von: KONTO_HAUPT, nach: "bargeld", begruendung: B }, state);
  assert.equal(a.neu.klasse, "sparen");
  assert.equal(a.neu.nachKonto, KONTO_BAR);
  const b = erstelleVorschlag("zeile", { liste: "fixkosten", name: "x", betrag: 1, nach: "extern", begruendung: B }, state);
  assert.equal(b.neu.nachKonto, null);
  assert.equal(b.neu.vonKonto, KONTO_HAUPT, "ohne Angabe das erste sichtbare Konto");
  assert.equal(b.monat, state.currentMonth, "ohne Monat der gewählte");
});

test("unbekannte Konten, Klassifizierungen, Monate und Listen werden mit Auswahl abgewiesen", () => {
  const state = beispielState();
  const fall = (args, muster) => assert.throws(
    () => erstelleVorschlag("zeile", { liste: "ausgaben", name: "x", betrag: 1, begruendung: B, ...args }, state),
    (e) => e instanceof KiFehler && muster.test(e.message), JSON.stringify(args));
  fall({ von: "Postfinance" }, /Kontostand.*Bargeld|Bargeld.*Kontostand/);
  fall({ klassifizierung: "Luxus" }, /Ausgaben/);
  fall({ monat: "1999-01" }, /2026-08/);
  fall({ liste: "kreditkarten" }, /fixkosten.*ausgaben/);
});

test("eine stillgelegte Klassifizierung lässt sich nicht vorschlagen", () => {
  const state = beispielState();
  state.klassen.find((k) => k.id === "blockiert").stillgelegt = true;
  assert.throws(() => erstelleVorschlag("zeile", { liste: "ausgaben", name: "x", betrag: 1, klassifizierung: "blockiert", begruendung: B }, state), KiFehler);
});

test("ohne Begründung, mit Unsinnsbetrag oder überlangem Text: abgewiesen", () => {
  const state = beispielState();
  const basis = { liste: "ausgaben", name: "x", betrag: 1, begruendung: B };
  for (const kaputt of [
    { begruendung: undefined }, { begruendung: "  " }, { betrag: 0 }, { betrag: Number.NaN },
    { betrag: 1e8 }, { betrag: "viel" }, { name: "" }, { name: "x".repeat(121) },
    { begruendung: "x".repeat(1001) }, { tag: 32 }, { tag: 1.5 }, { unbekannt: 1 }
  ]) {
    assert.throws(() => erstelleVorschlag("zeile", { ...basis, ...kaputt }, state), KiFehler, JSON.stringify(kaputt));
  }
});

test("Steuerzeichen in Texten werden entfernt", () => {
  const v = erstelleVorschlag("zeile", { liste: "ausgaben", name: "A\u0000B\u202Ec", betrag: 1, begruendung: "Zeile\u0007" }, beispielState());
  assert.equal(v.neu.name, "ABc");
  assert.equal(v.begruendung, "Zeile");
});

test("eine neue Einnahme: Art und Konto werden geprüft", () => {
  const state = beispielState();
  const v = erstelleVorschlag("einnahme", { name: "Bonus", betrag: 1000, art: "erwerb", konto: "Kontostand", begruendung: B }, state);
  assert.equal(v.neu.art, "erwerb");
  assert.equal(v.neu.konto, KONTO_HAUPT);
  assert.throws(() => erstelleVorschlag("einnahme", { name: "x", betrag: 1, art: "lotto", begruendung: B }, state), KiFehler);
});

test("eine Änderung merkt sich die Zeile, wie sie beim Vorschlagen war", () => {
  const state = beispielState();
  const miete = state.months["2026-08"].fixkosten[0];
  const v = erstelleVorschlag("aenderung", { monat: "2026-08", id: miete.id, betrag: 1450, begruendung: B }, state);
  assert.equal(v.liste, "fixkosten");
  assert.deepEqual(v.aenderungen, { betrag: 1450 });
  assert.deepEqual(JSON.parse(v.vorher), miete);
});

test("eine Änderung braucht eine bekannte Zeile und mindestens ein passendes Feld", () => {
  const state = beispielState();
  const miete = state.months["2026-08"].fixkosten[0];
  const lohn = state.months["2026-08"].einnahmen[0];
  assert.throws(() => erstelleVorschlag("aenderung", { id: "gibt-es-nicht", betrag: 1, begruendung: B }, state), KiFehler);
  assert.throws(() => erstelleVorschlag("aenderung", { id: miete.id, begruendung: B }, state), /mindestens/);
  assert.throws(() => erstelleVorschlag("aenderung", { id: miete.id, art: "erwerb", begruendung: B }, state), /art/,
    "eine Buchungszeile hat keine Einnahme-Art");
  assert.throws(() => erstelleVorschlag("aenderung", { id: lohn.id, klassifizierung: "sparen", begruendung: B }, state), /klassifizierung/,
    "eine Einnahme hat keine Klassifizierung");
  const ok = erstelleVorschlag("aenderung", { id: lohn.id, betrag: 5100, konto: "Bargeld", begruendung: B }, state);
  assert.deepEqual(ok.aenderungen, { betrag: 5100, konto: KONTO_BAR });
});

/* ------------------------------------------------------------------ *
 * Anwenden
 * ------------------------------------------------------------------ */

test("angenommen: die neue Zeile steht da und zählt", () => {
  const state = beispielState();
  const vorher = totals(state, state.months["2026-08"]).kosten;
  const v = erstelleVorschlag("zeile", { monat: "2026-08", liste: "ausgaben", name: "Velo", betrag: 100, begruendung: B }, state);
  wendeAn(v, state);
  const z = state.months["2026-08"].ausgaben.at(-1);
  assert.equal(z.name, "Velo");
  assert.ok(z.id && z.id !== v.id);
  assert.equal(totals(state, state.months["2026-08"]).kosten, vorher + 100);
});

test("angenommen: eine Änderung ändert genau die genannten Felder", () => {
  const state = beispielState();
  const miete = state.months["2026-08"].fixkosten[0];
  const v = erstelleVorschlag("aenderung", { monat: "2026-08", id: miete.id, betrag: 1450, nach: "Bargeld", begruendung: B }, state);
  const davor = kopie(miete);
  wendeAn(v, state);
  assert.deepEqual(miete, { ...davor, betrag: 1450, nachKonto: KONTO_BAR });
});

test("veraltet: geänderte oder gelöschte Zeile, verschwundener Monat, Konto oder Klasse", () => {
  const state = beispielState();
  const miete = state.months["2026-08"].fixkosten[0];
  const aend = erstelleVorschlag("aenderung", { monat: "2026-08", id: miete.id, betrag: 1450, begruendung: B }, state);
  const neu = erstelleVorschlag("zeile", { monat: "2026-08", liste: "ausgaben", name: "x", betrag: 1, von: "Bargeld", klassifizierung: "sparen", begruendung: B }, state);
  assert.equal(istVeraltet(aend, state), null);
  assert.equal(istVeraltet(neu, state), null);

  const a = kopie(state); a.months["2026-08"].fixkosten[0].betrag = 1499;
  assert.match(istVeraltet(aend, a), /geändert/);
  const b = kopie(state); b.months["2026-08"].fixkosten.shift();
  assert.match(istVeraltet(aend, b), /gelöscht/);
  const c = kopie(state); delete c.months["2026-08"];
  assert.match(istVeraltet(neu, c), /Monat/);
  const d = kopie(state); d.konten = d.konten.filter((k) => k.id !== KONTO_BAR);
  assert.match(istVeraltet(neu, d), /Konto/);
  const e = kopie(state); e.klassen.find((k) => k.id === "sparen").stillgelegt = true;
  assert.match(istVeraltet(neu, e), /Klassifizierung/);
});

test("ein veralteter Vorschlag lässt sich nicht anwenden — und ändert dabei nichts", () => {
  const state = beispielState();
  const miete = state.months["2026-08"].fixkosten[0];
  const v = erstelleVorschlag("aenderung", { monat: "2026-08", id: miete.id, betrag: 1450, begruendung: B }, state);
  miete.notiz = "von Hand geändert";
  const vorher = JSON.stringify(state);
  assert.throws(() => wendeAn(v, state), KiFehler);
  assert.equal(JSON.stringify(state), vorher);
});

/* ------------------------------------------------------------------ *
 * Beschreiben — für die Karte in der Oberfläche
 * ------------------------------------------------------------------ */

test("die Beschreibung nennt alt und neu mit Namen, nicht Kennungen", () => {
  const state = beispielState();
  const miete = state.months["2026-08"].fixkosten[0];
  const v = erstelleVorschlag("aenderung", { monat: "2026-08", id: miete.id, betrag: 1450, nach: "Bargeld", begruendung: B }, state);
  const d = beschreibe(v, state);
  assert.match(d.titel, /Miete/);
  const betrag = d.felder.find((f) => f.feld === "Betrag");
  assert.match(betrag.alt, /1.500\.00/);
  assert.match(betrag.neu, /1.450\.00/);
  const nach = d.felder.find((f) => f.feld === "Nach");
  assert.equal(nach.alt, "extern");
  assert.equal(nach.neu, "Bargeld");
  assert.doesNotMatch(JSON.stringify(d), new RegExp(KONTO_BAR));
});

/* ------------------------------------------------------------------ *
 * Die Liste
 * ------------------------------------------------------------------ */

test("die Liste vergibt Kennungen, kennt Zustände und hält höchstens 20 offene", () => {
  const state = beispielState();
  const liste = new Vorschlagsliste();
  const v = () => erstelleVorschlag("zeile", { liste: "ausgaben", name: "x", betrag: 1, begruendung: B }, state);
  const ersterEintrag = liste.hinzufuegen(v());
  assert.equal(ersterEintrag.status, "offen");
  for (let i = 1; i < MAX_OFFEN; i++) liste.hinzufuegen(v());
  assert.throws(() => liste.hinzufuegen(v()), (e) => e instanceof KiFehler && /20/.test(e.message));

  liste.setzeStatus(ersterEintrag.id, "abgelehnt");
  assert.equal(liste.offene().length, MAX_OFFEN - 1);
  liste.hinzufuegen(v());
  assert.throws(() => liste.setzeStatus(ersterEintrag.id, "angenommen"), KiFehler, "erledigt bleibt erledigt");
  assert.throws(() => liste.setzeStatus(liste.offene()[0].id, "irgendwas"), KiFehler);

  liste.leeren();
  assert.equal(liste.alle().length, 0);
});
