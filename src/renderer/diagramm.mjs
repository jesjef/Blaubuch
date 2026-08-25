/**
 * Blaubuch — Diagramme.
 *
 * Baut aus der Geometrie in shared/fluss.mjs die SVG-Elemente. Hier wird
 * nicht gerechnet und nichts eingefärbt: jede Fläche bekommt eine Klasse,
 * die Farbe kommt aus dem Stylesheet. Dadurch wechselt der Hell/Dunkel-
 * Umschalter die Diagramme mit, ohne dass neu gezeichnet werden muss.
 */

import { formatCHF } from "../shared/budget.mjs";
import { flussDaten, sankeyLayout, kuchenLayout, beschrifte, beschriftungsLayout } from "../shared/fluss.mjs";

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

/** Klasse für eine Fläche: Statusrollen zuerst, sonst die Verlaufsstufe. */
function flaechenKlasse(rolle, stufe) {
  if (rolle === "rest") return "f-rest";
  if (rolle === "luecke") return "f-luecke";
  if (rolle === "einkommen") return "f-einkommen";
  if (rolle === "bestand") return "f-bestand";
  if (rolle === "geliehen") return "f-geliehen";
  if (rolle === "nabe") return "f-nabe";
  return "f-stufe" + Math.min(3, stufe ?? 0);
}

/** Text, den Vorlesehilfen statt der Grafik bekommen. */
function alsText(daten) {
  const zeilen = [
    "Verfügbare Mittel " + formatCHF(daten.summe) + ".",
    "Herkunft: " + daten.links.map((x) => x.name + " " + formatCHF(x.wert)).join(", ") + ".",
    "Verwendung: " + daten.rechts.map((x) => x.name + " " + formatCHF(x.wert)).join(", ") + "."
  ];
  return zeilen.join(" ");
}

/* ------------------------------------------------------------------ *
 * Sankey
 * ------------------------------------------------------------------ */

function zeichneSankey(daten) {
  const plan = sankeyLayout(daten);
  const svg = svgEl("svg", {
    viewBox: "0 0 " + plan.breite + " " + plan.hoehe,
    class: "diagramm",
    role: "img",
    preserveAspectRatio: "xMidYMid meet"
  });
  const titel = svgEl("title");
  titel.textContent = "Geldfluss des Monats";
  const beschreibung = svgEl("desc");
  beschreibung.textContent = alsText(daten);
  svg.append(titel, beschreibung);

  /* Bänder zuerst, damit die Knoten darüber liegen. */
  const baender = svgEl("g", { class: "baender" });
  for (const b of plan.baender) {
    baender.append(svgEl("path", { d: b.d, class: "band " + flaechenKlasse(b.rolle, b.stufe) }));
  }
  svg.append(baender);

  const knoten = svgEl("g", { class: "knoten" });
  for (const k of plan.knoten) {
    knoten.append(svgEl("rect", {
      x: k.x, y: k.y, width: k.breite, height: k.h, rx: 2,
      class: "knoten-flaeche " + flaechenKlasse(k.rolle, k.stufe)
    }));
  }

  /* Beschriftungen je Seite getrennt entzerren — dünne Bänder liegen sonst
     übereinander, ohne dass die Geometrie dafür verfälscht werden müsste. */
  for (const seite of ["links", "rechts"]) {
    const gruppe = plan.knoten.filter((k) => k.seite === seite);
    const marken = beschriftungsLayout(gruppe, { hoehe: plan.hoehe });

    gruppe.forEach((k, i) => {
      const marke = marken[i];
      const rechts = seite === "rechts";
      const x = rechts ? k.x + k.breite + 6 : k.x - 6;

      if (marke.verschoben) {
        const kante = rechts ? k.x + k.breite : k.x;
        const zu = rechts ? x - 2 : x + 2;
        knoten.append(svgEl("path", {
          class: "fuehrung",
          d: "M " + kante + " " + marke.ziel + " L " + zu + " " + marke.y
        }));
      }

      const name = svgEl("text", {
        x, y: marke.y - 1, class: "d-name", "text-anchor": rechts ? "start" : "end"
      });
      name.textContent = k.name;

      const betrag = svgEl("text", {
        x, y: marke.y + 10, class: "d-wert", "text-anchor": rechts ? "start" : "end"
      });
      betrag.textContent = formatCHF(k.wert);

      knoten.append(name, betrag);
    });
  }
  svg.append(knoten);

  return svg;
}

/* ------------------------------------------------------------------ *
 * Ring
 * ------------------------------------------------------------------ */

function zeichneKuchen(daten) {
  const plan = kuchenLayout(daten);
  const breite = 360, hoehe = 250;

  const svg = svgEl("svg", {
    viewBox: "0 0 " + breite + " " + hoehe,
    class: "diagramm",
    role: "img",
    preserveAspectRatio: "xMidYMid meet"
  });
  const titel = svgEl("title");
  titel.textContent = "Verwendung der Mittel";
  const beschreibung = svgEl("desc");
  beschreibung.textContent = alsText(daten);
  svg.append(titel, beschreibung);

  const ring = svgEl("g", { class: "ring" });
  for (const s of plan.segmente) {
    ring.append(svgEl("path", { d: s.d, class: "segment " + flaechenKlasse(s.rolle, s.stufe) }));
  }
  svg.append(ring);

  const summe = svgEl("text", { x: plan.cx, y: plan.cy - 2, class: "d-mitte", "text-anchor": "middle" });
  summe.textContent = formatCHF(plan.gesamt);
  const untertitel = svgEl("text", { x: plan.cx, y: plan.cy + 14, class: "d-mitte-klein", "text-anchor": "middle" });
  untertitel.textContent = "verteilt";
  svg.append(summe, untertitel);

  /* Beschriftung als Liste neben dem Ring — im schmalen Feld verlässlicher
     als Fähnchen am Segment, die sich gegenseitig überdecken. */
  const legende = svgEl("g", { class: "d-legende" });
  const x = 178;
  const schritt = Math.min(30, (hoehe - 30) / Math.max(1, plan.segmente.length));
  const oben = (hoehe - schritt * plan.segmente.length) / 2 + schritt / 2;

  plan.segmente.forEach((s, i) => {
    const y = oben + i * schritt;
    legende.append(svgEl("rect", {
      x, y: y - 7, width: 9, height: 9, rx: 2,
      class: "legenden-punkt " + flaechenKlasse(s.rolle, s.stufe)
    }));
    const t = beschrifte(s, plan.gesamt);
    const name = svgEl("text", { x: x + 15, y: y, class: "d-name" });
    name.textContent = t.name;
    const wert = svgEl("text", { x: x + 15, y: y + 11, class: "d-wert" });
    wert.textContent = t.betrag + " · " + t.prozent;
    legende.append(name, wert);
  });
  svg.append(legende);

  return svg;
}

/* ------------------------------------------------------------------ *
 * Öffentlich
 * ------------------------------------------------------------------ */

export const ANSICHTEN = ["sankey", "kuchen"];

/**
 * Baut die Grafik für einen Monat.
 * @param {object} month
 * @param {"sankey"|"kuchen"} ansicht
 * @returns {SVGElement|HTMLElement}
 */
export function zeichne(month, ansicht) {
  const daten = flussDaten(month);
  if (daten.leer) {
    return el("p", "hint", "Sobald Einnahmen und Kosten erfasst sind, zeigt sich hier, wohin das Geld fliesst.");
  }
  return ansicht === "kuchen" ? zeichneKuchen(daten) : zeichneSankey(daten);
}

/** Dieselben Zahlen als Tabelle — für Vorlesehilfen und zum Nachlesen. */
export function alsTabelle(month) {
  const daten = flussDaten(month);
  const tabelle = el("table", "d-tabelle");

  const kopf = el("thead");
  const kopfzeile = el("tr");
  for (const t of ["Posten", "Betrag", "Anteil"]) kopfzeile.append(el("th", null, t));
  kopf.append(kopfzeile);
  tabelle.append(kopf);

  const koerper = el("tbody");
  for (const gruppe of [
    { titel: "Herkunft", zeilen: daten.links },
    { titel: "Verwendung", zeilen: daten.rechts }
  ]) {
    const trenner = el("tr", "d-gruppe");
    const zelle = el("th", null, gruppe.titel);
    zelle.setAttribute("colspan", "3");
    trenner.append(zelle);
    koerper.append(trenner);

    for (const z of gruppe.zeilen) {
      const t = beschrifte(z, daten.summe);
      const zeile = el("tr");
      zeile.append(el("td", null, t.name), el("td", "num", t.betrag), el("td", "num", t.prozent));
      koerper.append(zeile);
    }
  }
  tabelle.append(koerper);
  return tabelle;
}
