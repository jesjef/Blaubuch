/**
 * Blaubuch — Kontofluss-Diagramm.
 *
 * Baut aus der Geometrie in shared/kontofluss.mjs das SVG. Wie in
 * diagramm.mjs wird hier nichts gerechnet und nichts eingefaerbt: jede
 * Linie und Flaeche bekommt eine Klasse, die Farbe kommt aus dem
 * Stylesheet — Hell/Dunkel wechselt ohne Neuzeichnen, und die Klasse
 * `diagramm` unterstellt das Bild automatisch der Privatsicht.
 */

import { formatCHF } from "../shared/budget.mjs";
import { kontoflussDaten, kontenLayout, KNOTEN_ART, KANTEN_ART } from "../shared/kontofluss.mjs";

const NS = "http://www.w3.org/2000/svg";

const svgEl = (tag, attrs = {}) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
};

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

const KANTEN_KLASSE = {
  [KANTEN_ART.einnahme]: "k-einnahme",
  [KANTEN_ART.umbuchung]: "k-umbuchung",
  [KANTEN_ART.ausgabe]: "k-ausgabe"
};

/** Text, den Vorlesehilfen statt der Grafik bekommen. */
function alsText(daten) {
  const name = new Map(daten.knoten.map((k) => [k.id, k.name]));
  const zeilen = daten.kanten.map(
    (k) => name.get(k.von) + " nach " + name.get(k.nach) + " " + formatCHF(k.wert)
  );
  return "Kontofluss des Monats: " + zeilen.join(", ") + ".";
}

/**
 * Der Graph als SVG — oder ein Hinweis, solange es nichts zu zeigen gibt.
 * @param {object} state
 * @param {object} month
 * @returns {SVGElement|HTMLElement}
 */
export function zeichneKontofluss(state, month) {
  const daten = kontoflussDaten(state, month);
  if (daten.leer) {
    return el("p", "hint",
      "Sobald Einnahmen, Konten und Buchungen erfasst sind, zeigt sich hier, "
      + "wie das Geld zwischen den Konten fliesst.");
  }
  const plan = kontenLayout(daten);

  const svg = svgEl("svg", {
    viewBox: "0 0 " + plan.breite + " " + plan.hoehe,
    class: "diagramm kontofluss",
    role: "img",
    preserveAspectRatio: "xMidYMid meet"
  });
  const titel = svgEl("title");
  titel.textContent = "Kontofluss des Monats";
  const beschreibung = svgEl("desc");
  beschreibung.textContent = alsText(daten);
  svg.append(titel, beschreibung);

  /* Linien zuerst, damit die Knoten darueber liegen. Die Pfadrichtung
     ist die Flussrichtung — die Ameisenlinie laeuft ihr entlang. */
  const kanten = svgEl("g", { class: "kanten" });
  for (const k of plan.kanten) {
    kanten.append(svgEl("path", {
      d: k.d,
      class: "kante ameise " + KANTEN_KLASSE[k.art],
      "stroke-width": k.staerke
    }));
  }
  svg.append(kanten);

  /* Betraege am Pfadmittelpunkt, leicht ueber der Linie. */
  const werte = svgEl("g", { class: "kanten-werte" });
  for (const k of plan.kanten) {
    const wert = svgEl("text", {
      x: k.mx, y: k.my - 4, class: "d-wert kante-wert", "text-anchor": "middle"
    });
    wert.textContent = k.beschriftung;
    werte.append(wert);
  }
  svg.append(werte);

  const knoten = svgEl("g", { class: "knoten" });
  for (const k of plan.knoten) {
    const istKonto = k.art === KNOTEN_ART.konto;
    const klasse = istKonto
      ? "k-knoten" + (k.aktiv ? "" : " k-inaktiv")
      : (k.art === KNOTEN_ART.quelle ? "k-knoten k-quelle" : "k-knoten k-senke");
    knoten.append(svgEl("rect", { x: k.x, y: k.y, width: k.b, height: k.h, rx: 6, class: klasse }));

    const mitte = k.x + k.b / 2;
    if (istKonto) {
      const name = svgEl("text", { x: mitte, y: k.y + 13, class: "d-name" + (k.aktiv ? "" : " k-inaktiv"), "text-anchor": "middle" });
      name.textContent = k.name;
      const saldo = svgEl("text", { x: mitte, y: k.y + 26, class: "d-wert" + (k.aktiv ? "" : " k-inaktiv"), "text-anchor": "middle" });
      saldo.textContent = formatCHF(k.saldo);
      knoten.append(name, saldo);
    } else {
      const name = svgEl("text", { x: mitte, y: k.y + k.h / 2 + 3, class: "d-name", "text-anchor": "middle" });
      name.textContent = k.name;
      knoten.append(name);
    }
  }
  svg.append(knoten);

  return svg;
}

/** Dieselben Zahlen als Tabelle — für Vorlesehilfen und zum Nachlesen. */
export function kontoflussTabelle(state, month) {
  const daten = kontoflussDaten(state, month);
  const name = new Map(daten.knoten.map((k) => [k.id, k.name]));
  const tabelle = el("table", "d-tabelle");

  const kopf = el("thead");
  const kopfzeile = el("tr");
  for (const t of ["Von", "Nach", "Betrag"]) kopfzeile.append(el("th", null, t));
  kopf.append(kopfzeile);
  tabelle.append(kopf);

  const koerper = el("tbody");
  for (const k of daten.kanten) {
    const zeile = el("tr");
    zeile.append(
      el("td", null, name.get(k.von)),
      el("td", null, name.get(k.nach)),
      el("td", "num", formatCHF(k.wert))
    );
    koerper.append(zeile);
  }
  tabelle.append(koerper);
  return tabelle;
}
