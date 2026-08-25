/**
 * Blaubuch — Oberflaeche.
 *
 * Baut das Fenster aus dem Zustand auf und schickt Aenderungen ueber
 * window.blaubuch an den Hauptprozess. Gerechnet wird hier nichts —
 * das macht budget.mjs.
 */

import {
  TAGS, TAG_TITLE, SCHEMA_VERSION,
  formatCHF, parseAmount, monthLabel, isMonthKey, nextMonthKey, sortedMonths,
  totals, buildInsights, buildReport, migrate, monthFromPrevious, uid
} from "../shared/budget.mjs";
import { createSeedState } from "../shared/seed.mjs";
import { openVault, changePassword, askForeignPassword } from "./lock.mjs";
import { verbindeSchalter, verbindePrivatSchalter } from "./thema.mjs";
import { baueEinstellungen } from "./einstellungen.mjs";
import { zeichne, alsTabelle, ANSICHTEN } from "./diagramm.mjs";

const AUTOSAVE_MS = 1200;
const UNDO_MAX = 50;

const $ = (id) => document.getElementById(id);
const appEl = $("app");
const liveEl = $("live");
const saveBtn = $("save");
const saveEl = $("save-state");
const undoBtn = $("undo");
const monthSelect = $("month-select");

let state = null;
let dirty = false;
let saving = false;
let saveTimer = null;
let notice = null;               /* {text, kind} */
let appInfo = null;              /* Version und Ablageort, einmal beim Start geholt */
const undoStack = [];
const refs = {};

const announce = (text) => { liveEl.textContent = text; };
const currentMonth = () => state.months[state.currentMonth];

/* ------------------------------------------------------------------ *
 * Speichern
 * ------------------------------------------------------------------ */

function setSaveState(text, kind) {
  saveEl.textContent = text;
  saveEl.className = "save-state" + (kind ? " " + kind : "");
}

/** Nach jeder Aenderung: Zustand stempeln, Speichern anstossen. */
function touch() {
  state.updatedAt = new Date().toISOString();
  dirty = true;
  saveBtn.disabled = false;
  setSaveState("Nicht gesichert", "dirty");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { save(); }, AUTOSAVE_MS);
}

async function save() {
  if (saving || !dirty || !state) return;
  clearTimeout(saveTimer);
  saving = true;
  saveBtn.disabled = true;
  setSaveState("Speichern …");

  const text = JSON.stringify(state, null, 2);
  const res = await window.blaubuch.write(text);
  saving = false;

  if (res.ok) {
    dirty = false;
    saveBtn.disabled = true;
    const zeit = new Date(res.savedAt).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" });
    setSaveState("Gespeichert " + zeit);
  } else if (res.code === "locked") {
    saveBtn.disabled = false;
    setSaveState("Tresor gesperrt", "err");
    showNotice("Der Tresor ist gesperrt — es wurde nichts geschrieben. Öffne ihn erneut, um zu speichern.", "err");
  } else {
    saveBtn.disabled = false;
    setSaveState("Nicht gespeichert", "err");
    showNotice("Speichern fehlgeschlagen: " + res.error + " — die Daten sind noch im Fenster. Sichere sie über „Verschlüsselte Kopie sichern …“, bevor du das Programm schliesst.", "err");
  }
}

/* ------------------------------------------------------------------ *
 * Rückgängig
 * ------------------------------------------------------------------ */

function pushUndo(label, snapshot) {
  undoStack.push({ label, snapshot: snapshot ?? JSON.stringify(state) });
  if (undoStack.length > UNDO_MAX) undoStack.shift();
  refreshUndo();
}

function refreshUndo() {
  undoBtn.disabled = undoStack.length === 0;
  const titel = undoStack.length
    ? "Rückgängig: " + undoStack[undoStack.length - 1].label
    : "Rückgängig";
  undoBtn.title = titel;
  undoBtn.setAttribute("aria-label", titel);
}

function undo() {
  const letzte = undoStack.pop();
  if (!letzte) return;
  state = JSON.parse(letzte.snapshot);
  refreshUndo();
  touch();
  render();
  announce("Rückgängig gemacht: " + letzte.label);
  showNotice("Rückgängig gemacht: " + letzte.label);
}

/* ------------------------------------------------------------------ *
 * Hinweise
 * ------------------------------------------------------------------ */

function showNotice(text, kind) {
  notice = { text, kind: kind || "" };
  const vorhanden = appEl.querySelector(".notice");
  if (vorhanden) {
    vorhanden.firstChild.textContent = text;
    vorhanden.className = "notice" + (notice.kind ? " " + notice.kind : "");
  } else {
    render();
  }
}

/* ------------------------------------------------------------------ *
 * Bausteine
 * ------------------------------------------------------------------ */

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/**
 * Betragsfeld. Bewusst ein Textfeld: type="number" wirft in Schweizer
 * Schreibweise getippte Kommazahlen stillschweigend weg.
 */
function amountInput(wert, onChange, label) {
  const i = document.createElement("input");
  i.type = "text";
  i.className = "amount" + (wert ? "" : " zero");
  i.inputMode = "decimal";
  i.autocomplete = "off";
  i.value = wert ? String(wert) : "";
  i.placeholder = "0.00";
  i.setAttribute("aria-label", label);

  let vorher = null;
  i.addEventListener("focus", () => { vorher = JSON.stringify(state); i.select(); });
  i.addEventListener("input", () => {
    const v = parseAmount(i.value);
    onChange(v);
    i.classList.toggle("zero", !v);
    touch();
    updateComputed();
  });
  i.addEventListener("blur", () => {
    const v = parseAmount(i.value);
    i.value = v ? v.toFixed(2) : "";
    if (vorher && vorher !== JSON.stringify(state)) pushUndo(label, vorher);
    vorher = null;
  });
  return i;
}

function tagButton(item) {
  const b = el("button", "tag " + (TAGS.includes(item.tag) ? item.tag : "rot"));
  b.type = "button";
  const beschriften = () => {
    const titel = TAG_TITLE[item.tag] + " — klicken zum Wechseln";
    b.title = titel;
    b.setAttribute("aria-label", item.name + ": " + titel);
  };
  beschriften();
  b.addEventListener("click", () => {
    pushUndo(item.name + ": Kategorie");
    item.tag = TAGS[(TAGS.indexOf(item.tag) + 1) % TAGS.length];
    b.className = "tag " + item.tag;
    beschriften();
    announce(item.name + ": " + TAG_TITLE[item.tag]);
    touch();
    updateComputed();
  });
  return b;
}

/**
 * Bezeichnung, die sich durch Anklicken ändern lässt.
 *
 * Bis zum Klick ist es ein Knopf mit dem blossen Text — kein Feldrahmen,
 * der die Kachel unruhig macht. Erst beim Anklicken erscheint das
 * Eingabefeld. Enter oder Verlassen übernimmt, Escape verwirft; ein leerer
 * Name wird abgelehnt, sonst hiesse die Zeile danach gar nichts mehr.
 */
function nameField(item, onRename) {
  const wrap = el("span", "name");

  const anzeige = el("button", "name-text", item.name);
  anzeige.type = "button";
  anzeige.title = "Klicken zum Umbenennen";

  const feld = document.createElement("input");
  feld.type = "text";
  feld.className = "name-eingabe";
  feld.hidden = true;
  feld.setAttribute("aria-label", "Bezeichnung von " + item.name);

  const zeigeFeld = () => {
    feld.value = item.name;
    anzeige.hidden = true;
    feld.hidden = false;
    feld.focus();
    feld.select();
  };

  const beenden = (uebernehmen) => {
    if (feld.hidden) return;
    const neu = feld.value.trim();
    if (uebernehmen && neu && neu !== item.name) {
      pushUndo(item.name + " umbenannt");
      item.name = neu;
      anzeige.textContent = neu;
      feld.setAttribute("aria-label", "Bezeichnung von " + neu);
      announce("Umbenannt in " + neu);
      onRename?.(neu);
      touch();
      updateComputed();
    }
    feld.hidden = true;
    anzeige.hidden = false;
  };

  anzeige.addEventListener("click", zeigeFeld);
  feld.addEventListener("blur", () => beenden(true));
  feld.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") { ev.preventDefault(); beenden(true); anzeige.focus(); }
    else if (ev.key === "Escape") { ev.preventDefault(); beenden(false); anzeige.focus(); }
  });

  wrap.append(anzeige, feld);
  return wrap;
}

function listRow(item, list, listenName) {
  const row = el("div", "row");
  row.append(tagButton(item));
  row.append(nameField(item));
  row.append(amountInput(parseAmount(item.betrag), (v) => { item.betrag = v; }, item.name + " Betrag"));

  const del = el("button", "del", "×");
  del.type = "button";
  del.title = "Entfernen";
  del.setAttribute("aria-label", item.name + " entfernen");
  del.addEventListener("click", () => {
    pushUndo(item.name + " (" + listenName + ") gelöscht");
    list.splice(list.indexOf(item), 1);
    announce(item.name + " entfernt");
    touch();
    render();
  });
  row.append(del);
  return row;
}

function addControl(label, list, listenName) {
  const wrap = el("div", "add-line");
  const opener = el("button", "opener", "+ " + label);
  opener.type = "button";

  const form = el("form", "add-form");
  form.hidden = true;

  const nameIn = document.createElement("input");
  nameIn.type = "text";
  nameIn.className = "text";
  nameIn.placeholder = "Bezeichnung";
  nameIn.setAttribute("aria-label", label + " Bezeichnung");

  const betragIn = document.createElement("input");
  betragIn.type = "text";
  betragIn.className = "amount";
  betragIn.inputMode = "decimal";
  betragIn.placeholder = "0.00";
  betragIn.setAttribute("aria-label", label + " Betrag");

  const ok = el("button", "btn-primary", "Hinzufügen");
  ok.type = "submit";
  const cancel = el("button", "btn-plain", "Abbrechen");
  cancel.type = "button";

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const name = nameIn.value.trim();
    if (!name) { nameIn.focus(); return; }
    pushUndo(name + " (" + listenName + ") hinzugefügt");
    list.push({ id: uid(), name, betrag: parseAmount(betragIn.value), tag: "rot" });
    announce(name + " hinzugefügt");
    touch();
    render();
  });
  cancel.addEventListener("click", () => { form.hidden = true; opener.hidden = false; });
  opener.addEventListener("click", () => { form.hidden = false; opener.hidden = true; nameIn.focus(); });

  form.append(nameIn, betragIn, ok, cancel);
  wrap.append(opener, form);
  return wrap;
}

/**
 * Kartenkopf. Eine Erklaerung wird nicht dauerhaft angezeigt, sondern
 * haengt am Fragezeichen neben dem Titel — sie ist beim ersten Mal
 * noetig und danach nur noch Rauschen auf dem Dashboard.
 *
 * Der Hinweis reagiert auf Zeiger UND Tastaturfokus und ist ueber
 * aria-describedby mit dem Titel verbunden, damit er nicht nur fuer
 * Mausbenutzer existiert.
 */
function card(titel, mitSumme, beschreibung) {
  const s = el("section", "card");
  const h = el("header");
  const ueberschrift = el("h2", null, titel);
  h.append(ueberschrift);

  if (beschreibung) {
    const id = "hinweis-" + titel.replace(/[^a-zA-Z]/g, "").toLowerCase();
    const halter = el("span", "hinweis-halter");
    const marke = el("button", "hinweis-marke", "?");
    marke.type = "button";
    marke.setAttribute("aria-label", "Erklärung zu " + titel);
    marke.setAttribute("aria-describedby", id);

    const blase = el("span", "hinweis-blase", beschreibung);
    blase.id = id;
    blase.setAttribute("role", "tooltip");

    halter.append(marke, blase);
    h.append(halter);
  }

  let summe = null;
  if (mitSumme) { summe = el("span", "total"); h.append(summe); }
  s.append(h);
  return { section: s, summe };
}

/* ------------------------------------------------------------------ *
 * Vollständiger Aufbau
 * ------------------------------------------------------------------ */

function render() {
  if (!state) return;   /* Tresor zu — der Zugangsbildschirm gehoert appEl */
  const d = currentMonth();
  appEl.textContent = "";

  /* Monatsauswahl */
  monthSelect.textContent = "";
  const keys = sortedMonths(state);
  for (const key of keys) {
    const o = document.createElement("option");
    o.value = key;
    o.textContent = monthLabel(key);
    o.selected = key === state.currentMonth;
    monthSelect.append(o);
  }
  const idx = keys.indexOf(state.currentMonth);
  $("prev-month").disabled = idx <= 0;
  $("next-month").disabled = idx >= keys.length - 1;

  if (notice) {
    const n = el("div", "notice" + (notice.kind ? " " + notice.kind : ""));
    n.append(document.createTextNode(notice.text));
    const x = el("button", null, "×");
    x.type = "button";
    x.setAttribute("aria-label", "Hinweis schliessen");
    x.addEventListener("click", () => { notice = null; n.remove(); });
    n.append(x);
    appEl.append(n);
  }

  /* Kennzahlen */
  const summary = el("div", "summary");
  const s1 = el("div", "stat");
  refs.v1 = el("div", "value");
  refs.sub1 = el("div", "sub");
  s1.append(el("div", "label", "Verfügbare Mittel"), refs.v1, refs.sub1);

  const s2 = el("div", "stat");
  refs.v2 = el("div", "value");
  refs.sub2 = el("div", "sub");
  s2.append(el("div", "label", "Gesamtkosten"), refs.v2, refs.sub2);

  const s3 = el("div", "stat");
  refs.box3 = s3;
  refs.v3 = el("div", "value");
  refs.sub3 = el("div", "sub");
  s3.append(el("div", "label", "Restwert " + monthLabel(state.currentMonth)), refs.v3, refs.sub3);

  summary.append(s1, s2, s3);
  appEl.append(summary);

  /* Alle Erfassungskarten im selben Raster — sie fliessen je nach
     Fensterbreite in eine, zwei oder drei Spalten. */
  const raster = el("div", "sections");
  appEl.append(raster);

  /* Einnahmen */
  const ein = card("Einnahmen", true,
    "Netto und Spesen sind das Einkommen dieses Monats. Konto, Bar und Fremdschulden "
    + "erhöhen die verfügbaren Mittel, zählen aber nicht als Einkommen.");
  refs.totE = ein.summe;
  const felder = [
    ["netto", "Netto Gehalt"],
    ["spesen", "Spesen"],
    ["konto", "Konto aktuell"],
    ["bar", "Bar"],
    ["fremdschulden", "Fremdschulden (Eingang)"]
  ];
  for (const [key, label] of felder) {
    const row = el("div", "row");
    row.append(el("span", "name", label));
    row.append(amountInput(parseAmount(d.einnahmen[key]), (v) => { d.einnahmen[key] = v; }, label));
    ein.section.append(row);
  }
  raster.append(ein.section);

  /* Daueraufträge */
  const da = card("Daueraufträge / LSV", true,
    "Betrag leer oder 0 heisst: läuft diesen Monat nicht und wird nicht abgezogen.");
  refs.totD = da.summe;
  for (const x of d.dauerauftraege) da.section.append(listRow(x, d.dauerauftraege, "Dauerauftrag"));
  da.section.append(addControl("Dauerauftrag", d.dauerauftraege, "Dauerauftrag"));
  raster.append(da.section);

  /* Fixkosten */
  const fix = card("Fixkosten", true);
  refs.totF = fix.summe;
  if (d.fixkosten.length === 0) fix.section.append(el("p", "hint", "Noch keine Fixkosten erfasst."));
  for (const x of d.fixkosten) fix.section.append(listRow(x, d.fixkosten, "Fixkosten"));
  fix.section.append(addControl("Fixkosten", d.fixkosten, "Fixkosten"));
  raster.append(fix.section);

  /* Kreditkarten */
  raster.append(buildKarten(d));

  /* Ausgaben */
  const re = card("Ausgaben", true,
    "Einmalige Ausgaben dieses Monats — Rechnungen, Anschaffungen, Reparaturen. Wiederkehrendes gehört zu Daueraufträgen oder Fixkosten.");
  refs.totR = re.summe;
  if (d.ausgaben.length === 0) re.section.append(el("p", "hint", "Diesen Monat keine Ausgaben erfasst."));
  for (const x of d.ausgaben) re.section.append(listRow(x, d.ausgaben, "Ausgabe"));
  re.section.append(addControl("Ausgabe", d.ausgaben, "Ausgabe"));
  raster.append(re.section);

  /* Geldfluss — füllt den freien Platz im Raster. */
  raster.append(buildFluss(d));

  /* Analyse — über die volle Breite unter den Erfassungskarten. */
  const an = card("Analyse", false);
  an.section.classList.add("wide");
  refs.insights = el("div", "insights");
  refs.breakdown = el("div", "breakdown");

  const spalten = el("div", "analyse-spalten");
  spalten.append(refs.insights, refs.breakdown);
  an.section.append(spalten);

  const legende = el("div", "legend");
  for (const tg of TAGS) {
    const sp = el("span", "l-" + tg);
    sp.append(el("i"), document.createTextNode(TAG_TITLE[tg]));
    legende.append(sp);
  }
  an.section.append(legende);
  appEl.append(an.section);

  updateComputed();
}

/**
 * Geldfluss-Kachel mit zwei Ansichten auf denselben Sachverhalt:
 * Sankey zeigt den Weg von der Herkunft zur Verwendung, der Ring die
 * Verteilung. Die Wahl bleibt erhalten, liegt aber im Browserspeicher —
 * eine Ansichtseinstellung gehört nicht in den verschlüsselten Tresor.
 */
function buildFluss(d) {
  const box = card("Geldfluss", false,
    "Links die Herkunft der Mittel, rechts ihre Verwendung. Sehr kleine Posten "
    + "ergeben dünne Bänder; ihre Beschriftung rückt dann beiseite.");
  box.section.classList.add("fluss");

  const umschalter = el("div", "umschalter");
  umschalter.setAttribute("role", "group");
  umschalter.setAttribute("aria-label", "Darstellung des Geldflusses");

  const buehne = el("div", "diagramm-buehne");
  const tabelle = el("div", "d-tabelle-huelle");
  tabelle.hidden = true;

  const zeichneNeu = () => {
    buehne.textContent = "";
    buehne.append(zeichne(d, ansicht));
    for (const k of umschalter.children) {
      const aktiv = k.dataset.ansicht === ansicht;
      k.classList.toggle("aktiv", aktiv);
      k.setAttribute("aria-pressed", String(aktiv));
    }
  };

  for (const [wert, beschriftung] of [["sankey", "Fluss"], ["kuchen", "Ring"]]) {
    const k = el("button", "umschalt-knopf", beschriftung);
    k.type = "button";
    k.dataset.ansicht = wert;
    k.addEventListener("click", () => {
      ansicht = wert;
      merkeAnsicht(wert);
      zeichneNeu();
      announce("Ansicht: " + beschriftung);
    });
    umschalter.append(k);
  }

  box.section.querySelector("header").append(umschalter);
  box.section.append(buehne, tabelle);

  /* Zahlen zum Nachlesen — die Grafik allein ist keine zugängliche Quelle. */
  const zahlen = el("button", "d-tabelle-knopf", "Zahlen anzeigen");
  zahlen.type = "button";
  zahlen.setAttribute("aria-expanded", "false");
  zahlen.addEventListener("click", () => {
    const zeigen = tabelle.hidden;
    if (zeigen && !tabelle.firstChild) tabelle.append(alsTabelle(d));
    tabelle.hidden = !zeigen;
    zahlen.textContent = zeigen ? "Zahlen ausblenden" : "Zahlen anzeigen";
    zahlen.setAttribute("aria-expanded", String(zeigen));
  });
  box.section.append(zahlen);

  zeichneNeu();
  return box.section;
}

const ANSICHT_SCHLUESSEL = "blaubuch-fluss-ansicht";
let ansicht = (() => {
  try {
    const w = localStorage.getItem(ANSICHT_SCHLUESSEL);
    return ANSICHTEN.includes(w) ? w : "sankey";
  } catch { return "sankey"; }
})();
function merkeAnsicht(wert) {
  try { localStorage.setItem(ANSICHT_SCHLUESSEL, wert); } catch { /* egal */ }
}

/**
 * Kreditkarten legt der Benutzer selbst an. Zwei Zahlenspalten je Zeile —
 * Limit und Saldo — mit einer Kopfzeile, damit nicht jede Zeile beschriftet
 * werden muss.
 */
function buildKarten(d) {
  const kk = card("Kreditkarten", true,
    "Karten legst du selbst an. Das Limit ist freiwillig; ohne Limit wird nichts überwacht.");
  refs.totK = kk.summe;
  refs.cards = [];

  if (d.kreditkarten.length === 0) {
    kk.section.append(el("p", "hint",
      "Noch keine Karte angelegt. Trage Name, Limit und aktuellen Saldo ein."));
  } else {
    const kopf = el("div", "row kopfzeile");
    kopf.append(el("span", "name", "Karte"), el("span", "num", "Limit"), el("span", "num", "Saldo"), el("span", "platzhalter"));
    kk.section.append(kopf);
  }

  for (const karte of d.kreditkarten) {
    const row = el("div", "row");
    row.append(nameField(karte));
    row.append(amountInput(parseAmount(karte.limit), (v) => { karte.limit = v; }, karte.name + " Limit"));
    row.append(amountInput(parseAmount(karte.betrag), (v) => { karte.betrag = v; }, karte.name + " Saldo"));

    const del = el("button", "del", "×");
    del.type = "button";
    del.title = "Karte entfernen";
    del.setAttribute("aria-label", karte.name + " entfernen");
    del.addEventListener("click", () => {
      pushUndo(karte.name + " (Kreditkarte) gelöscht");
      d.kreditkarten.splice(d.kreditkarten.indexOf(karte), 1);
      announce(karte.name + " entfernt");
      touch();
      render();
    });
    row.append(del);
    kk.section.append(row);

    const bar = el("div", "limitbar");
    const fuellung = el("i");
    bar.append(fuellung);
    const note = el("div", "limit-note");
    kk.section.append(bar, note);
    refs.cards.push({ karte, bar, fuellung, note });
  }

  kk.section.append(addKarteControl(d.kreditkarten));
  return kk.section;
}

/** Eingabe für eine neue Karte: Name, Limit, Saldo. */
function addKarteControl(liste) {
  const wrap = el("div", "add-line");
  const opener = el("button", "opener", "+ Karte");
  opener.type = "button";

  const form = el("form", "add-form");
  form.hidden = true;

  const nameIn = document.createElement("input");
  nameIn.type = "text";
  nameIn.className = "text";
  nameIn.placeholder = "Bezeichnung";
  nameIn.setAttribute("aria-label", "Name der Karte");

  const mach = (platzhalter, label) => {
    const i = document.createElement("input");
    i.type = "text";
    i.className = "amount";
    i.inputMode = "decimal";
    i.placeholder = platzhalter;
    i.setAttribute("aria-label", label);
    return i;
  };
  const limitIn = mach("Limit", "Limit der Karte");
  const saldoIn = mach("Saldo", "Aktueller Saldo");

  const ok = el("button", "btn-primary", "Hinzufügen");
  ok.type = "submit";
  const cancel = el("button", "btn-plain", "Abbrechen");
  cancel.type = "button";

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const name = nameIn.value.trim();
    if (!name) { nameIn.focus(); return; }
    pushUndo(name + " (Kreditkarte) hinzugefügt");
    liste.push({
      id: uid(),
      name,
      betrag: parseAmount(saldoIn.value),
      limit: parseAmount(limitIn.value)
    });
    announce(name + " hinzugefügt");
    touch();
    render();
  });
  cancel.addEventListener("click", () => { form.hidden = true; opener.hidden = false; });
  opener.addEventListener("click", () => { form.hidden = false; opener.hidden = true; nameIn.focus(); });

  form.append(nameIn, limitIn, saldoIn, ok, cancel);
  wrap.append(opener, form);
  return wrap;
}

async function sichereKopie(klartext) {
  const res = await window.blaubuch.exportTo(JSON.stringify(state, null, 2), klartext);
  if (res.ok) {
    showNotice((klartext ? "Unverschlüsselte" : "Verschlüsselte") + " Kopie gesichert: " + res.path,
      klartext ? "warn" : "");
  } else if (!res.canceled) {
    showNotice("Sichern fehlgeschlagen: " + res.error, "err");
  }
}

/* ------------------------------------------------------------------ *
 * Einstellungen — alles, was nicht zum Erfassen gehört
 * ------------------------------------------------------------------ */

const einstellungen = baueEinstellungen({
  bericht: async () => {
    await window.blaubuch.copy(buildReport(state, state.currentMonth));
    announce("Monatsbericht in die Zwischenablage kopiert");
    showNotice("Monatsbericht kopiert — kann jetzt eingefügt werden.");
  },
  kopieSichern: (klartext) => sichereKopie(klartext),
  einlesen: () => importieren(),
  ordner: () => window.blaubuch.reveal(),
  passwort: () => passwortAendern(),
  sperren: () => sperrenUndNeuOeffnen(),
  /* Ein Wechsel der Darstellung faerbt sich ueber CSS-Variablen selbst um;
     nur der Schnellschalter in der Kopfleiste muss sein Zeichen nachziehen. */
  beiDarstellung: () => aktualisiereThemaKnopf?.(),
  datenLoeschen: () => eintraegeLoeschen(),
  kontoZuruecksetzen: () => kontoZuruecksetzen()
});

/**
 * Leert alle Monate, laesst Tresor und Passwort unangetastet.
 * Der alte Stand liegt im Rueckgaengig-Stapel — das ist der Unterschied
 * zum vollstaendigen Zuruecksetzen.
 */
async function eintraegeLoeschen() {
  const anzahl = Object.keys(state.months).length;
  const ok = await window.blaubuch.confirm({
    title: "Einträge löschen",
    message: "Alle Einträge aus " + anzahl + " Monat(en) löschen?",
    detail: "Passwort und Tresor bleiben bestehen. Über den Pfeil in der Kopfleiste "
      + "lässt sich das rückgängig machen, solange das Programm offen ist.",
    confirmLabel: "Löschen"
  });
  if (!ok) return;

  pushUndo("Alle Einträge gelöscht");
  state = createSeedState();
  touch();
  render();
  announce("Alle Einträge gelöscht");
  showNotice("Alle Einträge gelöscht. Rückgängig über den Pfeil in der Kopfleiste.", "warn");
}

/**
 * Loescht Tresor, Sicherungen, Zaehler und Ansichtseinstellungen.
 * Danach beginnt das Programm bei der Passwortvergabe von vorn.
 */
async function kontoZuruecksetzen() {
  const ok = await window.blaubuch.confirm({
    title: "Konto zurücksetzen",
    message: "Tresor, Passwort und alle Sicherungen unwiderruflich löschen?",
    detail: "Danach steht Blaubuch wie frisch installiert da. Ohne eine gesicherte Kopie "
      + "sind die Daten dann weg — es gibt keinen Weg zurück.",
    confirmLabel: "Unwiderruflich löschen"
  });
  if (!ok) return;

  /* Nichts mehr wegschreiben — der Tresor wird gerade entfernt. */
  clearTimeout(saveTimer);
  dirty = false;

  const res = await window.blaubuch.resetAll();
  if (!res.ok) {
    showNotice("Zurücksetzen fehlgeschlagen: " + res.error, "err");
    return;
  }

  /* Auch die Ansichtseinstellungen gehoeren zum lokalen Konto. */
  try {
    for (const k of ["blaubuch-thema", "blaubuch-farbe", "blaubuch-privat", "blaubuch-fluss-ansicht"]) {
      localStorage.removeItem(k);
    }
  } catch { /* egal */ }

  state = null;
  undoStack.length = 0;
  refreshUndo();
  announce("Konto zurückgesetzt");
  await boot();
}

/* ------------------------------------------------------------------ *
 * Nur die Zahlen erneuern — Eingabefelder und Fokus bleiben stehen
 * ------------------------------------------------------------------ */

function updateComputed() {
  if (!refs.v1) return;
  const d = currentMonth();
  const t = totals(d);

  refs.v1.textContent = formatCHF(t.einnahmen);
  refs.sub1.textContent = "Erwerbseinkommen " + formatCHF(t.erwerb);
  refs.v2.textContent = formatCHF(t.kosten);
  refs.sub2.textContent = "Daueraufträge " + formatCHF(t.da) + " · Übrige " + formatCHF(t.kosten - t.da);
  refs.v3.textContent = formatCHF(t.rest);
  refs.sub3.textContent = t.rest < 0 ? "Monat im Minus" : "verfügbar nach allen Abzügen";
  refs.box3.className = "stat " + (t.rest < 0 ? "neg" : "pos");

  refs.totE.textContent = formatCHF(t.einnahmen);
  refs.totD.textContent = formatCHF(t.da);
  refs.totF.textContent = formatCHF(t.fix);
  refs.totK.textContent = formatCHF(t.kk);
  refs.totR.textContent = formatCHF(t.re);

  for (const c of refs.cards) {
    const wert = parseAmount(c.karte.betrag);
    const limit = parseAmount(c.karte.limit);
    const drueber = limit > 0 && wert > limit;
    c.fuellung.style.width = (limit > 0 ? Math.min(100, (wert / limit) * 100) : 0) + "%";
    c.bar.className = "limitbar" + (drueber ? " over" : "") + (limit > 0 ? "" : " leer");
    c.note.className = "limit-note" + (drueber ? " over" : "");
    c.note.textContent = limit <= 0
      ? "Kein Limit gesetzt"
      : drueber
        ? "Limit " + formatCHF(limit) + " um " + formatCHF(wert - limit) + " überschritten"
        : formatCHF(wert) + " von Limit " + formatCHF(limit);
  }

  refs.insights.textContent = "";
  for (const ins of buildInsights(state, state.currentMonth)) {
    const n = el("div", "insight" + (ins.kind ? " " + ins.kind : ""));
    const text = el("div");
    for (const teil of ins.parts) {
      if (typeof teil === "string") text.append(document.createTextNode(teil));
      else text.append(el("b", null, teil.b));
    }
    n.append(text);
    refs.insights.append(n);
  }

  refs.breakdown.textContent = "";
  const bloecke = [
    ["Daueraufträge", t.da, "var(--blue)"],
    ["Fixkosten", t.fix, "var(--blue)"],
    ["Kreditkarten", t.kk, "var(--blue)"],
    ["Ausgaben", t.re, "var(--blue)"],
    ["· Konsum", t.byTag.rot, "var(--rot)"],
    ["· Invest. kontrolliert", t.byTag.gruen, "var(--gruen)"],
    ["· Invest. blockiert", t.byTag.gelb, "var(--gelb)"]
  ];
  const max = Math.max(t.kosten, 1);
  for (const [label, wert, farbe] of bloecke) {
    const brow = el("div", "brow");
    brow.append(el("span", "bl", label));
    const bar = el("div", "bar");
    const f = el("i");
    f.style.width = Math.min(100, (wert / max) * 100) + "%";
    f.style.background = farbe;
    bar.append(f);
    brow.append(bar, el("span", "bv", formatCHF(wert)));
    refs.breakdown.append(brow);
  }
}

/* ------------------------------------------------------------------ *
 * Monate
 * ------------------------------------------------------------------ */

function gotoMonth(key) {
  if (!state.months[key]) return;
  state.currentMonth = key;
  touch();
  render();
  announce(monthLabel(key) + " geöffnet");
}

function stepMonth(richtung) {
  const keys = sortedMonths(state);
  const i = keys.indexOf(state.currentMonth) + richtung;
  if (i >= 0 && i < keys.length) gotoMonth(keys[i]);
}

function anlegen(key) {
  if (!isMonthKey(key)) return;
  if (state.months[key]) {
    gotoMonth(key);
    showNotice(monthLabel(key) + " gibt es schon — geöffnet.");
    return;
  }
  pushUndo("Monat " + monthLabel(key) + " angelegt");
  const keys = sortedMonths(state);
  state.months[key] = monthFromPrevious(state.months[keys[keys.length - 1]]);
  state.currentMonth = key;
  touch();
  render();
  showNotice("Monat angelegt. Daueraufträge und Fixkosten wurden übernommen — was diesmal nicht läuft, einfach auf 0 setzen.");
}

async function monatLoeschen() {
  const keys = sortedMonths(state);
  if (keys.length <= 1) {
    showNotice("Der letzte verbliebene Monat lässt sich nicht löschen.", "warn");
    return;
  }
  const key = state.currentMonth;
  const ok = await window.blaubuch.confirm({
    title: "Monat löschen",
    message: monthLabel(key) + " löschen?",
    detail: "Alle Werte dieses Monats werden entfernt. Rückgängig machen geht danach noch über den Pfeil in der Kopfleiste.",
    confirmLabel: "Löschen"
  });
  if (!ok) return;

  pushUndo("Monat " + monthLabel(key) + " gelöscht");
  delete state.months[key];
  const rest = sortedMonths(state);
  state.currentMonth = rest[Math.max(0, rest.indexOf(key) - 1)] ?? rest[0];
  touch();
  render();
  announce(monthLabel(key) + " gelöscht");
}

/* ------------------------------------------------------------------ *
 * Einlesen
 * ------------------------------------------------------------------ */

async function importieren() {
  const res = await window.blaubuch.importFrom();
  if (!res.ok) {
    if (!res.canceled) showNotice("Einlesen fehlgeschlagen: " + res.error, "err");
    return;
  }

  let inhalt = res.text;

  /* Eine verschluesselte Datei braucht ihr eigenes Passwort — das muss
     nicht dasselbe sein wie das des geoeffneten Tresors. */
  if (res.verschluesselt) {
    document.body.classList.add("gated");
    inhalt = await askForeignPassword(res.text, appEl);
    document.body.classList.remove("gated");
    render();
  }

  let roh;
  try {
    roh = JSON.parse(inhalt);
  } catch {
    showNotice("Die Datei ist keine gültige Blaubuch-Datei — sie enthält kein lesbares JSON.", "err");
    return;
  }

  const { state: neu, repariert } = migrate(roh);
  const anzahl = Object.keys(neu.months).length;
  const ok = await window.blaubuch.confirm({
    title: "Daten einlesen",
    message: anzahl + " Monat(e) aus der Datei übernehmen?",
    detail: "Der aktuelle Stand wird ersetzt. Über den Pfeil in der Kopfleiste lässt sich das rückgängig machen.",
    confirmLabel: "Übernehmen"
  });
  if (!ok) return;

  pushUndo("Daten eingelesen");
  state = neu;
  touch();
  render();
  const meldung = "Eingelesen: " + anzahl + " Monat(e)."
    + (repariert.length ? " Hinweise: " + repariert.join(" ") : "");
  showNotice(meldung, repariert.length ? "warn" : "");
}

/* ------------------------------------------------------------------ *
 * Verdrahtung
 * ------------------------------------------------------------------ */

const aktualisiereThemaKnopf = verbindeSchalter($("thema"));
verbindePrivatSchalter($("privat"));
$("einstellungen").addEventListener("click", () => einstellungen.oeffnen(appInfo));

monthSelect.addEventListener("change", (ev) => gotoMonth(ev.target.value));
$("prev-month").addEventListener("click", () => stepMonth(-1));
$("next-month").addEventListener("click", () => stepMonth(1));
undoBtn.addEventListener("click", undo);
saveBtn.addEventListener("click", () => save());

const nmForm = $("newmonth-form");
const nmInput = $("newmonth-input");
$("new-month").addEventListener("click", () => {
  const keys = sortedMonths(state);
  nmInput.value = nextMonthKey(keys[keys.length - 1]);
  nmForm.hidden = !nmForm.hidden;
  if (!nmForm.hidden) nmInput.focus();
});
$("newmonth-cancel").addEventListener("click", () => { nmForm.hidden = true; });
nmForm.addEventListener("submit", (ev) => {
  ev.preventDefault();
  const key = nmInput.value.trim();
  if (!isMonthKey(key)) { nmInput.focus(); return; }
  nmForm.hidden = true;
  anlegen(key);
});

window.blaubuch.onMenu("menu:save", () => save());
window.blaubuch.onMenu("menu:undo", undo);
window.blaubuch.onMenu("menu:prev", () => stepMonth(-1));
window.blaubuch.onMenu("menu:next", () => stepMonth(1));
window.blaubuch.onMenu("menu:new-month", () => $("new-month").click());
window.blaubuch.onMenu("menu:delete-month", monatLoeschen);
window.blaubuch.onMenu("menu:import", importieren);
window.blaubuch.onMenu("menu:export", () => sichereKopie(false));
window.blaubuch.onMenu("menu:export-plain", () => sichereKopie(true));
window.blaubuch.onMenu("menu:lock", () => sperrenUndNeuOeffnen());
window.blaubuch.onMenu("menu:change-password", passwortAendern);

/* Der Hauptprozess haelt das Schliessen an, bis die letzte Aenderung
   auf der Platte ist. Ohne das gingen bis zu AUTOSAVE_MS Tipparbeit verloren. */
window.blaubuch.onMenu("app:flush-close", async () => {
  clearTimeout(saveTimer);
  if (dirty) await save();
  window.blaubuch.readyToClose();
});

/* Wer das Fenster verlaesst, will das Getippte sicher wissen. */
window.addEventListener("blur", () => { if (dirty && state) save(); });

/* ------------------------------------------------------------------ *
 * Start
 * ------------------------------------------------------------------ */

/**
 * Passwort wechseln. Ungesicherte Aenderungen kommen vorher auf die Platte,
 * sonst laegen sie nach dem Wechsel noch mit dem alten Schluessel dort.
 */
async function passwortAendern() {
  clearTimeout(saveTimer);
  if (dirty) await save();

  document.body.classList.add("gated");
  const gewechselt = await changePassword(appEl);
  document.body.classList.remove("gated");
  render();

  if (gewechselt) {
    showNotice("Passwort geändert. Bereits gesicherte Kopien bleiben beim alten Passwort — "
      + "lege bei Bedarf eine neue an.");
    announce("Passwort geändert");
  }
}

/** Schluessel vergessen und wieder nach dem Passwort fragen. */
async function sperrenUndNeuOeffnen() {
  clearTimeout(saveTimer);
  if (dirty) await save();
  await window.blaubuch.lock();
  state = null;
  undoStack.length = 0;
  refreshUndo();
  await boot();
}

async function boot() {
  appInfo = await window.blaubuch.info().catch(() => null);

  /* Solange der Tresor zu ist, gibt es nichts zu bedienen. */
  document.body.classList.add("gated");
  let startState = null;
  const startText = () => {
    startState = createSeedState();
    return JSON.stringify(startState, null, 2);
  };

  const tor = await openVault(startText, appEl);
  document.body.classList.remove("gated");

  if (tor.text === null) {
    /* Frisch angelegt — der Tresor enthaelt bereits genau diesen Stand. */
    state = startState;
    render();
    markClean("Angelegt");
    showNotice("Blaubuch ist eingerichtet. Trage deine Zahlen für "
      + monthLabel(state.currentMonth) + " ein — gespeichert wird verschlüsselt unter "
      + (appInfo?.dataPath ?? "deinem Benutzerordner") + ".");
    return;
  }

  let roh;
  try {
    roh = JSON.parse(tor.text);
  } catch {
    state = createSeedState();
    render();
    setSaveState("Nicht gespeichert", "err");
    showNotice("Der Tresor liess sich öffnen, sein Inhalt ist aber beschädigt. "
      + "Es wurde NICHTS überschrieben — im Unterordner „backups“ liegen ältere Stände.", "err");
    return;
  }

  const { state: geladen, repariert } = migrate(roh);
  state = geladen;
  render();
  markLoaded(roh.version !== SCHEMA_VERSION, repariert);

  if (tor.altdatei) {
    showNotice("Die Daten sind jetzt verschlüsselt. Die alte unverschlüsselte Datei liegt "
      + "weiterhin unter " + tor.altdatei + " — lösche sie, sobald du sicher bist, dass alles stimmt.", "warn");
  }
}

function markClean(text) {
  dirty = false;
  saveBtn.disabled = true;
  setSaveState(text || "Gespeichert");
}

function markLoaded(migriert, repariert) {
  if (migriert || repariert.length) {
    dirty = true;
    saveBtn.disabled = false;
    setSaveState("Nicht gesichert", "dirty");
    showNotice(
      "Die Daten wurden auf das aktuelle Format gebracht."
      + (repariert.length ? " " + repariert.join(" ") : "")
      + " Einmal speichern übernimmt das dauerhaft.",
      "warn"
    );
  } else {
    dirty = false;
    saveBtn.disabled = true;
    setSaveState("Geladen");
  }
}

boot();
