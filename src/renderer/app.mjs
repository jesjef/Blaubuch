/**
 * Blaubuch — Oberflaeche.
 *
 * Baut das Fenster aus dem Zustand auf und schickt Aenderungen ueber
 * window.blaubuch an den Hauptprozess. Gerechnet wird hier nichts —
 * das macht budget.mjs.
 */

import {
  SCHEMA_VERSION, EINNAHME_ARTEN, EINNAHME_ART_TITEL,
  formatCHF, parseAmount, monthLabel, isMonthKey, nextMonthKey, sortedMonths,
  totals, buildInsights, buildReport, migrate, monthFromPrevious, uid, nachbarMonat,
  kontoSaldo, istUmbuchung, leseFaelligAm,
  STANDARD_KLASSE, WIRKUNG_TITEL, WIRKUNGEN, klasseVon, FARB_KEYS, farbe
} from "../shared/budget.mjs";
import { createSeedState } from "../shared/seed.mjs";
import { openVault, changePassword, askForeignPassword } from "./lock.mjs";
import { verbindeSchalter, verbindePrivatSchalter } from "./thema.mjs";
import { baueEinstellungen } from "./einstellungen.mjs";
import { starteWaechter } from "./sperre.mjs";
import { zeichne, alsTabelle, ANSICHTEN } from "./diagramm.mjs";
import { zeichneKontofluss, kontoflussTabelle } from "./kontodiagramm.mjs";
import { zeichneJahr, jahrTabelle, zeichneLiquiditaet, liquiditaetTabelle } from "./jahrdiagramm.mjs";
import { jahre, liquiditaet } from "../shared/jahr.mjs";

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

/* Sperrt nach Untaetigkeit. Wird erst scharf gestellt, wenn ein Tresor
   offen ist — am Torbildschirm gibt es nichts zu sperren. */
const sperrWaechter = starteWaechter(() => sperrenUndNeuOeffnen());
const refs = {};

const announce = (text) => { liveEl.textContent = text; };
const currentMonth = () => state.months[state.currentMonth];

/* Konten sind Stammdaten — diese Griffe braucht fast jede Karte. */
const kontoIdSet = () => new Set((state?.konten ?? []).map((k) => k.id));
const aktiveKonten = () => (state?.konten ?? []).filter((k) => k.aktiv !== false);
const erstesAktivesKonto = () => aktiveKonten()[0]?.id ?? state?.konten?.[0]?.id ?? null;

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

function klasseButton(item) {
  const b = el("button", "tag");
  b.type = "button";
  const beschriften = () => {
    const k = klasseVon(state.klassen, item.klasse);
    b.className = "tag kf-" + k.farbe;
    const titel = k.name + " (" + WIRKUNG_TITEL[k.wirkung] + ") — klicken zum Wechseln";
    b.title = titel;
    b.setAttribute("aria-label", item.name + ": " + titel);
  };
  beschriften();
  b.addEventListener("click", () => {
    /* Stillgelegte Klassen bleiben an alten Zeilen, sind aber nicht waehlbar. */
    const waehlbar = state.klassen.filter((k) => !k.stillgelegt);
    const liste = waehlbar.length > 0 ? waehlbar : state.klassen;
    pushUndo(item.name + ": Klassifizierung");
    const aktuelle = klasseVon(state.klassen, item.klasse);
    const i = liste.findIndex((k) => k.id === aktuelle.id);
    item.klasse = liste[(i + 1) % liste.length].id;
    beschriften();
    announce(item.name + ": " + klasseVon(state.klassen, item.klasse).name);
    touch();
    updateComputed();
  });
  return b;
}

/**
 * Kontoauswahl als schmales Feld. `mitExtern` erlaubt „extern“ (null) —
 * fuer Zielkonten: extern heisst, das Geld verlaesst die eigenen Konten
 * und die Zeile ist eine Ausgabe, keine Umbuchung.
 */
function kontoSelect({ wert, onChange, label, mitExtern }) {
  const s = document.createElement("select");
  s.className = "konto-wahl";
  s.setAttribute("aria-label", label);

  const optionen = [];
  if (mitExtern) optionen.push(["", "extern"]);
  for (const k of state.konten) {
    /* Inaktive Konten nur anbieten, wenn die Zeile schon darauf zeigt. */
    if (k.aktiv === false && k.id !== wert) continue;
    optionen.push([k.id, k.name]);
  }
  /* Ein Verweis auf ein unbekanntes Konto (aus eingelesenen Daten) bleibt
     sichtbar, statt stillschweigend umgehaengt zu werden. */
  if (wert && !optionen.some(([id]) => id === wert)) optionen.push([wert, "unbekannt"]);

  for (const [id, name] of optionen) {
    const o = document.createElement("option");
    o.value = id;
    o.textContent = name;
    o.selected = (wert ?? "") === id;
    s.append(o);
  }
  s.addEventListener("change", () => {
    pushUndo(label);
    onChange(s.value === "" ? null : s.value);
    touch();
    updateComputed();
  });
  return s;
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

/**
 * Kleines Feld fuer die Detailzeile. Bewusst schmal und ohne eigenes
 * Etikett — die Beschriftung steht davor in der Zeile.
 */
function detailFeld({ typ = "text", wert, platzhalter, label, breit, onChange }) {
  const i = document.createElement("input");
  i.type = typ;
  i.className = "detail-feld" + (breit ? " breit" : "");
  i.autocomplete = "off";
  i.value = wert ?? "";
  if (platzhalter) i.placeholder = platzhalter;
  i.setAttribute("aria-label", label);

  let vorher = null;
  i.addEventListener("focus", () => { vorher = JSON.stringify(state); });
  i.addEventListener("change", () => {
    onChange(i.value);
    if (vorher && vorher !== JSON.stringify(state)) pushUndo(label, vorher);
    vorher = null;
    touch();
    updateComputed();
  });
  return i;
}

/**
 * Die Detailzeile: Tag im Monat, Laufzeitende, Notiz und Pause.
 *
 * Sie steht eingeklappt hinter „mehr“ — ausgeschrieben braeuchte jede
 * Zeile vier zusaetzliche Felder, und das Dashboard soll ruhig bleiben.
 * Was sie schaltet, bleibt trotzdem sichtbar: eine pausierte Zeile ist
 * gedaempft und traegt ihre Marke, auch wenn die Zeile zugeklappt ist.
 *
 * @param {object} opts.mitLaufzeit  Einnahmen kennen kein `laeuftBis`.
 */
function detailZeile(item, block, { mitLaufzeit }) {
  const zeile = el("div", "detail-zeile");
  zeile.hidden = true;

  zeile.append(el("span", "kz-label", "am"));
  zeile.append(detailFeld({
    wert: item.faelligAm ?? "",
    platzhalter: "Tag",
    label: item.name + ": Tag im Monat",
    onChange: (v) => { item.faelligAm = leseFaelligAm(v); }
  }));

  if (mitLaufzeit) {
    zeile.append(el("span", "kz-label", "läuft bis"));
    zeile.append(detailFeld({
      typ: "month",
      wert: item.laeuftBis ?? "",
      label: item.name + ": läuft bis",
      onChange: (v) => { item.laeuftBis = isMonthKey(v) ? v : null; }
    }));
  }

  zeile.append(el("span", "kz-label", "Notiz"));
  zeile.append(detailFeld({
    wert: item.notiz ?? "",
    platzhalter: "Verwendungszweck",
    label: item.name + ": Notiz",
    breit: true,
    onChange: (v) => { item.notiz = v.trim(); }
  }));

  /* Pausiert: der Betrag bleibt stehen, gerechnet wird er nicht. Eine 0
     wuerde die Information „normalerweise 500“ verlieren. */
  const marke = el("span", "pause-marke", "❙❙ pausiert");
  marke.title = "Betrag bleibt erhalten, zählt diesen Monat aber nicht";
  const zeigePause = () => {
    const pausiert = item.aktiv === false;
    block.classList.toggle("pausiert", pausiert);
    marke.hidden = !pausiert;
  };

  const pause = document.createElement("label");
  pause.className = "pause-wahl";
  const kaestchen = document.createElement("input");
  kaestchen.type = "checkbox";
  kaestchen.checked = item.aktiv === false;
  kaestchen.setAttribute("aria-label", item.name + " pausieren");
  kaestchen.addEventListener("change", () => {
    pushUndo(item.name + (kaestchen.checked ? " pausiert" : " wieder aktiv"));
    item.aktiv = !kaestchen.checked;
    zeigePause();
    announce(item.name + (item.aktiv ? " zählt wieder mit" : " ist pausiert"));
    touch();
    updateComputed();
  });
  pause.append(kaestchen, document.createTextNode("pausiert"));
  zeile.append(pause);

  zeigePause();
  return { zeile, marke };
}

/** Der Knopf, der die Detailzeile auf- und zuklappt. */
function detailKnopf(zeile, name) {
  const k = el("button", "detail-knopf", "mehr");
  k.type = "button";
  k.setAttribute("aria-expanded", "false");
  k.setAttribute("aria-label", "Weitere Angaben zu " + name);
  k.addEventListener("click", () => {
    const zeigen = zeile.hidden;
    zeile.hidden = !zeigen;
    k.textContent = zeigen ? "weniger" : "mehr";
    k.setAttribute("aria-expanded", String(zeigen));
  });
  return k;
}

function listRow(item, list, listenName) {
  const block = el("div", "zeile-block");
  const row = el("div", "row");
  row.append(klasseButton(item));
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

  /* Von welchem Konto die Zeile geht — und ob sie auf ein eigenes Konto
     kommt. Dann ist sie eine Umbuchung und zaehlt nicht als Kosten. */
  const marke = el("span", "umbuchung-marke", "⇄ Umbuchung");
  marke.title = "Geht auf ein eigenes Konto — zählt nicht als Kosten";

  const zeigeUmbuchung = () => {
    const ist = istUmbuchung(item, kontoIdSet());
    block.classList.toggle("umbuchung", ist);
    marke.hidden = !ist;
  };

  const details = detailZeile(item, block, { mitLaufzeit: true });

  const kontoZeile = el("div", "konto-zeile");
  kontoZeile.append(
    el("span", "kz-label", "von"),
    kontoSelect({
      wert: item.vonKonto,
      onChange: (v) => { item.vonKonto = v; zeigeUmbuchung(); },
      label: item.name + ": von Konto"
    }),
    el("span", "kz-label", "nach"),
    kontoSelect({
      wert: item.nachKonto,
      mitExtern: true,
      onChange: (v) => { item.nachKonto = v; zeigeUmbuchung(); },
      label: item.name + ": nach Konto"
    }),
    marke,
    details.marke,
    detailKnopf(details.zeile, item.name)
  );
  zeigeUmbuchung();

  block.append(row, kontoZeile, details.zeile);
  return block;
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
    list.push({
      id: uid(), name,
      betrag: parseAmount(betragIn.value),
      klasse: STANDARD_KLASSE,
      vonKonto: erstesAktivesKonto(),
      nachKonto: null,
      aktiv: true, faelligAm: null, laeuftBis: null, notiz: ""
    });
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

  /* Beim Neuaufbau zeigen alte refs auf tote Knoten. updateComputed darf
     nur beschreiben, was die aktuelle Seite tatsaechlich zeigt — deshalb
     wird hier geleert und dort je Block einzeln geprueft. */
  for (const k of Object.keys(refs)) delete refs[k];

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

  if (seite === "fluss") renderFluss(d);
  else renderBuchhaltung(d);

  updateComputed();
}

/** Die Erfassungsseite — Kennzahlen und alle Karten zum Eintragen. */
function renderBuchhaltung(d) {
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

  /* Konten */
  raster.append(buildKonten(d));

  /* Einnahmen */
  const ein = card("Einnahmen", true,
    "Jede Einnahme hat eine Art und ein Zielkonto. Nur Erwerbseinkommen zählt "
    + "für die Sparquote; Geliehenes und Sonstiges erhöhen die Mittel, "
    + "Durchlaufgeld zählt nirgends mit.");
  refs.totE = ein.summe;
  if (d.einnahmen.length === 0) ein.section.append(el("p", "hint", "Noch keine Einnahmen erfasst."));
  for (const e of d.einnahmen) ein.section.append(einnahmeRow(e, d.einnahmen));
  ein.section.append(addEinnahmeControl(d.einnahmen));
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
}

/**
 * Die Auswertungsseite: oben die Analyse, darunter der Kontofluss.
 * Erfasst wird hier nichts — Konten und Beträge pflegt die Buchhaltung.
 */
function renderFluss(d) {
  const halter = el("div", "seite-fluss");
  appEl.append(halter);

  /* Analyse */
  const an = card("Analyse", false);
  refs.insights = el("div", "insights");
  refs.breakdown = el("div", "breakdown");

  const spalten = el("div", "analyse-spalten");
  spalten.append(refs.insights, refs.breakdown);
  an.section.append(spalten);

  const legende = el("div", "legend");
  for (const k of state.klassen) {
    if (k.stillgelegt) continue;
    const sp = el("span");
    sp.title = WIRKUNG_TITEL[k.wirkung];
    sp.append(el("i", "kf-" + k.farbe), document.createTextNode(k.name));
    legende.append(sp);
  }
  an.section.append(legende);
  halter.append(an.section);

  /* Kontofluss */
  halter.append(diagrammKarte({
    titel: "Kontofluss",
    beschreibung: "Jede Linie ist Geld in Bewegung: von den Einnahmen auf deine Konten, "
      + "zwischen den Konten, und hinaus als Ausgabe. Konten und Beträge "
      + "pflegst du auf der Seite Buchhaltung.",
    zeichnen: () => zeichneKontofluss(state, d),
    tabelle: () => kontoflussTabelle(state, d)
  }).section);

  /* Liquidität im Monat */
  const v = liquiditaet(state, d);
  const liq = diagrammKarte({
    titel: "Liquidität im Monat",
    beschreibung: "Der Stand über die Tage. Er beantwortet, was eine Monatssumme nicht "
      + "kann: reicht das Geld auch zwischendurch, wenn der Dauerauftrag vor dem Lohn läuft? "
      + "Umbuchungen bewegen die Kurve nicht — das Geld hat dein Vermögen nicht verlassen.",
    zeichnen: () => zeichneLiquiditaet(state, d),
    tabelle: () => liquiditaetTabelle(state, d)
  });
  /* Ehrlich sagen, worauf die Kurve beruht: undatiertes Geld kann sie
     nicht einordnen und rechnet es zum Monatsanfang. */
  if (v.ohneTag > 0) {
    liq.section.insertBefore(
      el("p", "hint", v.ohneTag === 1
        ? "Eine Zeile hat keinen Tag und zählt zum Monatsanfang. Trage unter „mehr“ einen Tag ein, damit die Kurve stimmt."
        : v.ohneTag + " Zeilen haben keinen Tag und zählen zum Monatsanfang. Trage sie unter „mehr“ ein, damit die Kurve stimmt."),
      liq.buehne
    );
  }
  halter.append(liq.section);

  /* Jahresüberblick */
  const jahrListe = jahre(state);
  if (jahrListe.length > 0) {
    if (!jahrListe.includes(gewaehltesJahr)) {
      gewaehltesJahr = state.currentMonth.slice(0, 4);
      if (!jahrListe.includes(gewaehltesJahr)) gewaehltesJahr = jahrListe[jahrListe.length - 1];
    }

    const wahl = document.createElement("select");
    wahl.className = "konto-wahl";
    wahl.setAttribute("aria-label", "Jahr wählen");
    for (const j of jahrListe) {
      const o = document.createElement("option");
      o.value = j;
      o.textContent = j;
      o.selected = j === gewaehltesJahr;
      wahl.append(o);
    }
    wahl.addEventListener("change", () => {
      gewaehltesJahr = wahl.value;
      render();
      announce("Jahr " + gewaehltesJahr);
    });

    halter.append(diagrammKarte({
      titel: "Jahresüberblick",
      beschreibung: "Je Monat die verfügbaren Mittel gegen die Kosten, die Kosten nach "
        + "Wirkung geteilt: unten, was weg ist, darüber, was nur woanders liegt. "
        + "Die Linie ist der Restwert.",
      zeichnen: () => zeichneJahr(state, gewaehltesJahr),
      tabelle: () => jahrTabelle(state, gewaehltesJahr),
      kopfZusatz: wahl
    }).section);
  }
}

/* Welches Jahr der Ueberblick zeigt. Wie die Seitenwahl eine Frage des
   Fensters und nicht der Daten — sie muss keinen Neustart ueberleben. */
let gewaehltesJahr = null;

/**
 * Karte mit einer Grafik und dem Knopf, der dieselben Zahlen als Tabelle
 * nachliefert. Die Grafik allein ist keine zugaengliche Quelle — deshalb
 * gibt es den Knopf ueberall, wo gezeichnet wird.
 */
function diagrammKarte({ titel, beschreibung, zeichnen, tabelle, kopfZusatz }) {
  const box = card(titel, false, beschreibung);
  if (kopfZusatz) box.section.querySelector("header").append(kopfZusatz);

  const buehne = el("div", "kontofluss-buehne");
  buehne.append(zeichnen());
  const huelle = el("div", "d-tabelle-huelle");
  huelle.hidden = true;
  box.section.append(buehne, huelle);

  const zahlen = el("button", "d-tabelle-knopf", "Zahlen anzeigen");
  zahlen.type = "button";
  zahlen.setAttribute("aria-expanded", "false");
  zahlen.addEventListener("click", () => {
    const zeigen = huelle.hidden;
    if (zeigen) { huelle.textContent = ""; huelle.append(tabelle()); }
    huelle.hidden = !zeigen;
    zahlen.textContent = zeigen ? "Zahlen ausblenden" : "Zahlen anzeigen";
    zahlen.setAttribute("aria-expanded", String(zeigen));
  });
  box.section.append(zahlen);

  return { section: box.section, buehne, huelle };
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
    buehne.append(zeichne(state, d, ansicht));
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
    if (zeigen && !tabelle.firstChild) tabelle.append(alsTabelle(state, d));
    tabelle.hidden = !zeigen;
    zahlen.textContent = zeigen ? "Zahlen ausblenden" : "Zahlen anzeigen";
    zahlen.setAttribute("aria-expanded", String(zeigen));
  });
  box.section.append(zahlen);

  zeichneNeu();
  return box.section;
}

/**
 * Welche Seite offen ist: Buchhaltung (erfassen) oder Fluss (auswerten).
 * Wie die Diagrammansicht eine Sache des Fensters, nicht der Daten —
 * darum Browserspeicher statt Tresor.
 */
const SEITEN = ["buchhaltung", "fluss"];
const SEITE_SCHLUESSEL = "blaubuch-seite";
let seite = (() => {
  try {
    const w = localStorage.getItem(SEITE_SCHLUESSEL);
    return SEITEN.includes(w) ? w : "buchhaltung";
  } catch { return "buchhaltung"; }
})();
function merkeSeite(wert) {
  try { localStorage.setItem(SEITE_SCHLUESSEL, wert); } catch { /* egal */ }
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
 * Eine Einnahmezeile: Bezeichnung und Betrag oben, Art und Zielkonto in
 * der kleinen Zeile darunter — dieselbe Grammatik wie bei den Buchungen.
 */
function einnahmeRow(e, liste) {
  const block = el("div", "zeile-block");
  const row = el("div", "row");
  row.append(nameField(e));
  row.append(amountInput(parseAmount(e.betrag), (v) => { e.betrag = v; }, e.name + " Betrag"));

  const del = el("button", "del", "×");
  del.type = "button";
  del.title = "Entfernen";
  del.setAttribute("aria-label", e.name + " entfernen");
  del.addEventListener("click", () => {
    pushUndo(e.name + " (Einnahme) gelöscht");
    liste.splice(liste.indexOf(e), 1);
    announce(e.name + " entfernt");
    touch();
    render();
  });
  row.append(del);

  const artSel = document.createElement("select");
  artSel.className = "konto-wahl";
  artSel.setAttribute("aria-label", e.name + ": Art der Einnahme");
  for (const art of EINNAHME_ARTEN) {
    const o = document.createElement("option");
    o.value = art;
    o.textContent = EINNAHME_ART_TITEL[art];
    o.selected = e.art === art;
    artSel.append(o);
  }
  artSel.addEventListener("change", () => {
    pushUndo(e.name + ": Art");
    e.art = artSel.value;
    touch();
    updateComputed();
  });

  const details = detailZeile(e, block, { mitLaufzeit: false });

  const kontoZeile = el("div", "konto-zeile");
  kontoZeile.append(
    el("span", "kz-label", "als"),
    artSel,
    el("span", "kz-label", "auf"),
    kontoSelect({
      wert: e.konto,
      onChange: (v) => { e.konto = v; },
      label: e.name + ": Zielkonto"
    }),
    details.marke,
    detailKnopf(details.zeile, e.name)
  );

  block.append(row, kontoZeile, details.zeile);
  return block;
}

/** Eingabe für eine neue Einnahme: Bezeichnung und Betrag reichen. */
function addEinnahmeControl(liste) {
  const wrap = el("div", "add-line");
  const opener = el("button", "opener", "+ Einnahme");
  opener.type = "button";

  const form = el("form", "add-form");
  form.hidden = true;

  const nameIn = document.createElement("input");
  nameIn.type = "text";
  nameIn.className = "text";
  nameIn.placeholder = "Bezeichnung";
  nameIn.setAttribute("aria-label", "Einnahme Bezeichnung");

  const betragIn = document.createElement("input");
  betragIn.type = "text";
  betragIn.className = "amount";
  betragIn.inputMode = "decimal";
  betragIn.placeholder = "0.00";
  betragIn.setAttribute("aria-label", "Einnahme Betrag");

  const ok = el("button", "btn-primary", "Hinzufügen");
  ok.type = "submit";
  const cancel = el("button", "btn-plain", "Abbrechen");
  cancel.type = "button";

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const name = nameIn.value.trim();
    if (!name) { nameIn.focus(); return; }
    pushUndo(name + " (Einnahme) hinzugefügt");
    liste.push({
      id: uid(), name,
      betrag: parseAmount(betragIn.value),
      art: "erwerb",
      konto: erstesAktivesKonto(),
      aktiv: true, faelligAm: null, notiz: ""
    });
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
 * Konten sind Stammdaten und gelten fuer alle Monate; nur der
 * Anfangsbestand gehoert zum Monat. Der Saldo wird gerechnet und nicht
 * eingetragen. Loeschen gibt es bewusst nicht — alte Monate verweisen auf
 * das Konto; wer es nicht mehr braucht, nimmt das Haekchen heraus.
 */
function buildKonten(d) {
  const box = card("Konten", false,
    "Konten gelten für alle Monate. Der Anfangsbestand gehört zum Monat, "
    + "der Saldo wird gerechnet. Ohne Häkchen zählt ein Konto nicht mit — "
    + "gelöscht wird nicht, damit alte Monate gültig bleiben.");
  refs.kontoSalden = [];

  if (state.konten.length > 0) {
    const kopf = el("div", "row kopfzeile");
    kopf.append(el("span", "name", "Konto"), el("span", "num", "Anfang"), el("span", "num", "Saldo"), el("span", "platzhalter"));
    box.section.append(kopf);
  }

  for (const k of state.konten) {
    const row = el("div", "row" + (k.aktiv === false ? " konto-inaktiv" : ""));
    /* Nach dem Umbenennen neu aufbauen — der Name steht auch in den
       Kontoauswahlen der anderen Karten. */
    row.append(nameField(k, () => render()));
    row.append(amountInput(
      parseAmount(d.anfangsbestaende[k.id]),
      (v) => { d.anfangsbestaende[k.id] = v; },
      k.name + " Anfangsbestand"
    ));

    const saldo = el("span", "konto-saldo");
    row.append(saldo);
    refs.kontoSalden.push({ kontoId: k.id, elem: saldo });

    const schalter = document.createElement("input");
    schalter.type = "checkbox";
    schalter.className = "konto-aktiv";
    schalter.checked = k.aktiv !== false;
    schalter.title = "Zählt mit";
    schalter.setAttribute("aria-label", k.name + " zählt mit");
    schalter.addEventListener("change", () => {
      pushUndo(k.name + (schalter.checked ? " zählt wieder mit" : " ausgenommen"));
      k.aktiv = schalter.checked;
      announce(k.name + (k.aktiv ? " zählt wieder mit" : " zählt nicht mehr mit"));
      touch();
      render();
    });
    row.append(schalter);

    box.section.append(row);
  }

  box.section.append(addKontoControl());
  return box.section;
}

/** Eingabe für ein neues Konto — der Anfangsbestand startet überall bei 0. */
function addKontoControl() {
  const wrap = el("div", "add-line");
  const opener = el("button", "opener", "+ Konto");
  opener.type = "button";

  const form = el("form", "add-form");
  form.hidden = true;

  const nameIn = document.createElement("input");
  nameIn.type = "text";
  nameIn.className = "text";
  nameIn.placeholder = "Bezeichnung";
  nameIn.setAttribute("aria-label", "Name des Kontos");

  const ok = el("button", "btn-primary", "Hinzufügen");
  ok.type = "submit";
  const cancel = el("button", "btn-plain", "Abbrechen");
  cancel.type = "button";

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const name = nameIn.value.trim();
    if (!name) { nameIn.focus(); return; }
    pushUndo(name + " (Konto) hinzugefügt");
    const neu = { id: uid(), name, institut: "", aktiv: true };
    state.konten.push(neu);
    for (const m of Object.values(state.months)) {
      if (m.anfangsbestaende[neu.id] === undefined) m.anfangsbestaende[neu.id] = 0;
    }
    announce(name + " hinzugefügt");
    touch();
    render();
  });
  cancel.addEventListener("click", () => { form.hidden = true; opener.hidden = false; });
  opener.addEventListener("click", () => { form.hidden = false; opener.hidden = true; nameIn.focus(); });

  form.append(nameIn, ok, cancel);
  wrap.append(opener, form);
  return wrap;
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

    /* Von welchem Konto der Kartensaldo abgeht — der Kontosaldo rechnet damit. */
    const kontoZeile = el("div", "konto-zeile");
    kontoZeile.append(
      el("span", "kz-label", "von"),
      kontoSelect({
        wert: karte.vonKonto,
        onChange: (v) => { karte.vonKonto = v; },
        label: karte.name + ": von Konto"
      })
    );
    kk.section.append(kontoZeile);

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
      limit: parseAmount(limitIn.value),
      vonKonto: erstesAktivesKonto(),
      notiz: ""
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

/* ------------------------------------------------------------------ *
 * Klassifizierungen — Stammdaten, bearbeitet im Einstellungsdialog
 * ------------------------------------------------------------------ */

/**
 * Auswahlfeld fuer den Editor. Baut die Optionen aus Paaren
 * [wert, beschriftung] und meldet jede Aenderung mit Rueckgaengig.
 */
function klassenWahl({ wert, optionen, label, klasse, onChange }) {
  const s = document.createElement("select");
  s.className = klasse;
  s.setAttribute("aria-label", label);
  for (const [id, name] of optionen) {
    const o = document.createElement("option");
    o.value = id;
    o.textContent = name;
    o.selected = id === wert;
    s.append(o);
  }
  s.addEventListener("change", () => {
    pushUndo(label);
    onChange(s.value);
    touch();
    render();
    einstellungen.aktualisiereKlassen();
  });
  return s;
}

/**
 * Der Editor fuer die Klassifizierungen.
 *
 * Aendert der Benutzer eine Wirkung, aendert sich die Rechnung — deshalb
 * baut jede Aenderung die Oberflaeche neu auf und legt einen Schritt auf
 * den Rueckgaengig-Stapel. Geloescht wird nie: alte Zeilen zeigen auf ihre
 * Klasse, und ein Monat von vorletztem Jahr soll seine Zahlen behalten.
 */
function baueKlassenEditor() {
  if (!state) return null;
  const halter = el("div", "klassen-liste");

  for (const k of state.klassen) {
    const zeile = el("div", "klassen-zeile" + (k.stillgelegt ? " stillgelegt" : ""));

    const punkt = el("span", "klassen-punkt kf-" + k.farbe);
    punkt.setAttribute("aria-hidden", "true");
    zeile.append(punkt);
    zeile.append(nameField(k, () => render()));

    zeile.append(klassenWahl({
      wert: k.farbe,
      optionen: FARB_KEYS.map((key) => [key, farbe(key).name]),
      label: k.name + ": Farbe",
      klasse: "konto-wahl",
      onChange: (v) => { k.farbe = v; }
    }));

    zeile.append(klassenWahl({
      wert: k.wirkung,
      optionen: WIRKUNGEN.map((w) => [w, WIRKUNG_TITEL[w]]),
      label: k.name + ": Wirkung",
      klasse: "konto-wahl",
      onChange: (v) => { k.wirkung = v; }
    }));

    /* „In Auswahl“ statt „stillgelegt“: der Haken sagt, was er bewirkt,
       und steht in derselben Richtung wie das Haekchen bei den Konten. */
    const wahl = document.createElement("label");
    wahl.className = "pause-wahl";
    const kaestchen = document.createElement("input");
    kaestchen.type = "checkbox";
    kaestchen.checked = !k.stillgelegt;
    kaestchen.setAttribute("aria-label", k.name + " zur Auswahl anbieten");
    kaestchen.addEventListener("change", () => {
      const uebrig = state.klassen.filter((x) => !x.stillgelegt && x.id !== k.id);
      if (!kaestchen.checked && uebrig.length === 0) {
        /* Ohne waehlbare Klasse liesse sich keine Zeile mehr einordnen. */
        kaestchen.checked = true;
        const grund = "Die letzte Klassifizierung lässt sich nicht stilllegen — "
          + "ohne sie liesse sich keine Zeile mehr einordnen.";
        announce(grund);
        showNotice(grund, "warn");
        return;
      }
      pushUndo(k.name + (kaestchen.checked ? " wieder in der Auswahl" : " stillgelegt"));
      k.stillgelegt = !kaestchen.checked;
      touch();
      render();
      einstellungen.aktualisiereKlassen();
    });
    wahl.append(kaestchen, document.createTextNode("in Auswahl"));
    zeile.append(wahl);

    halter.append(zeile);
  }

  halter.append(addKlasseControl());
  return halter;
}

/** Eingabe fuer eine neue Klasse: Name, Farbe und Wirkung. */
function addKlasseControl() {
  const wrap = el("div", "add-line");
  const opener = el("button", "opener", "+ Klassifizierung");
  opener.type = "button";

  const form = el("form", "add-form");
  form.hidden = true;

  const nameIn = document.createElement("input");
  nameIn.type = "text";
  nameIn.className = "text";
  nameIn.placeholder = "Bezeichnung";
  nameIn.setAttribute("aria-label", "Name der Klassifizierung");

  const mach = (optionen, label) => {
    const s = document.createElement("select");
    s.className = "konto-wahl";
    s.setAttribute("aria-label", label);
    for (const [id, name] of optionen) {
      const o = document.createElement("option");
      o.value = id;
      o.textContent = name;
      s.append(o);
    }
    return s;
  };
  const farbIn = mach(FARB_KEYS.map((key) => [key, farbe(key).name]), "Farbe der Klassifizierung");
  const wirkungIn = mach(WIRKUNGEN.map((w) => [w, WIRKUNG_TITEL[w]]), "Wirkung der Klassifizierung");

  /* Eine Farbe vorschlagen, die noch niemand hat — zwei gleichfarbige
     Klassen waeren in Legende und Balken nicht auseinanderzuhalten. */
  const vergeben = new Set(state?.klassen?.map((k) => k.farbe) ?? []);
  farbIn.value = FARB_KEYS.find((key) => !vergeben.has(key)) ?? FARB_KEYS[0];

  const ok = el("button", "btn-primary", "Hinzufügen");
  ok.type = "submit";
  const cancel = el("button", "btn-plain", "Abbrechen");
  cancel.type = "button";

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const name = nameIn.value.trim();
    if (!name) { nameIn.focus(); return; }
    pushUndo(name + " (Klassifizierung) hinzugefügt");
    state.klassen.push({
      id: uid(), name,
      farbe: farbIn.value,
      wirkung: wirkungIn.value,
      stillgelegt: false
    });
    announce(name + " hinzugefügt");
    touch();
    render();
    einstellungen.aktualisiereKlassen();   /* damit die neue Zeile erscheint */
  });
  cancel.addEventListener("click", () => { form.hidden = true; opener.hidden = false; });
  opener.addEventListener("click", () => { form.hidden = false; opener.hidden = true; nameIn.focus(); });

  form.append(nameIn, farbIn, wirkungIn, ok, cancel);
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
  klassenEditor: () => baueKlassenEditor(),
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
  kontoZuruecksetzen: () => kontoZuruecksetzen(),
  beiSperrzeit: () => sperrWaechter.neuLesen(),
  monatLoeschen: () => monatLoeschen()
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
    for (const k of ["blaubuch-thema", "blaubuch-farbe", "blaubuch-privat", "blaubuch-fluss-ansicht", "blaubuch-seite"]) {
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
  if (!state) return;
  const d = currentMonth();
  const t = totals(state, d);

  /* Kennzahlen und Kartensummen gibt es nur auf der Buchhaltungsseite —
     nach einem Seitenwechsel zeigen diese refs sonst ins Leere. */
  if (refs.v1) {
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

    for (const ks of refs.kontoSalden ?? []) {
      const saldo = kontoSaldo(state, d, ks.kontoId);
      ks.elem.textContent = formatCHF(saldo);
      ks.elem.classList.toggle("neg", saldo < 0);
    }

    for (const c of refs.cards ?? []) {
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
  }

  if (!refs.insights) return;

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
    ["Daueraufträge", t.da, null],
    ["Fixkosten", t.fix, null],
    ["Kreditkarten", t.kk, null],
    ["Ausgaben", t.re, null],
    /* Danach dieselben Kosten nach Klassifizierung geschnitten. Durchlauf
       hat hier nichts verloren: es sind keine Kosten. */
    ...state.klassen
      /* Durchlauf sind keine Kosten. Eine stillgelegte Klasse nur zeigen,
         solange noch Betraege an ihr haengen — sonst waere sie Rauschen. */
      .filter((k) => k.wirkung !== "durchlauf" && (!k.stillgelegt || (t.byKlasse[k.id] ?? 0) > 0))
      .map((k) => ["· " + k.name, t.byKlasse[k.id] ?? 0, "kf-" + k.farbe]),
    ["Umgebucht (keine Kosten)", t.umgebucht, null]
  ];
  const max = Math.max(t.kosten, 1);
  for (const [label, wert, klasse] of bloecke) {
    const brow = el("div", "brow");
    brow.append(el("span", "bl", label));
    const bar = el("div", "bar");
    const f = el("i", klasse ?? undefined);
    f.style.width = Math.min(100, (wert / max) * 100) + "%";
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
  state.months[key] = monthFromPrevious(state.months[keys[keys.length - 1]], key, state);
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
  state.currentMonth = nachbarMonat(keys, key);
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

/* Seitenumschalter in der Kopfleiste. */
const seitenKnoepfe = { buchhaltung: $("seite-buchhaltung"), fluss: $("seite-fluss") };
function zeigeSeitenwahl() {
  for (const [wert, k] of Object.entries(seitenKnoepfe)) {
    const aktiv = wert === seite;
    k.classList.toggle("aktiv", aktiv);
    k.setAttribute("aria-pressed", String(aktiv));
  }
}
for (const [wert, k] of Object.entries(seitenKnoepfe)) {
  k.addEventListener("click", () => {
    if (seite === wert) return;
    seite = wert;
    merkeSeite(wert);
    zeigeSeitenwahl();
    render();
    announce("Seite: " + k.textContent);
  });
}
zeigeSeitenwahl();

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
  sperrWaechter.aus();
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
  /* Ab hier liegt Klartext im Fenster — jetzt zaehlt die Uhr. */
  sperrWaechter.an();

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
