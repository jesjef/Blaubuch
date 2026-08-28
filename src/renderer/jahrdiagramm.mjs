/**
 * Blaubuch — Jahresüberblick und Liquiditätskurve als SVG.
 *
 * Wie in den übrigen Diagrammen wird hier nichts gerechnet und nichts
 * eingefärbt: die Geometrie kommt aus shared/jahr.mjs, jede Fläche
 * bekommt eine Klasse, die Farbe steht im Stylesheet.
 */

import { formatCHF } from "../shared/budget.mjs";
import {
  jahresDaten, jahresKlassen, jahresLayout,
  liquiditaet, liquiditaetLayout
} from "../shared/jahr.mjs";

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

const rahmen = (plan, titel, beschreibung) => {
  const svg = svgEl("svg", {
    viewBox: "0 0 " + plan.breite + " " + plan.hoehe,
    class: "diagramm",
    role: "img",
    preserveAspectRatio: "xMidYMid meet"
  });
  const t = svgEl("title");
  t.textContent = titel;
  const d = svgEl("desc");
  d.textContent = beschreibung;
  svg.append(t, d);
  return svg;
};

/* ------------------------------------------------------------------ *
 * Jahresüberblick
 * ------------------------------------------------------------------ */

const WIRKUNG_KLASSE = { verloren: "j-verloren", erhalten: "j-erhalten" };

function jahrText(daten) {
  return "Jahr " + daten.jahr + " über " + daten.monate.length + " Monate: "
    + "Mittel " + formatCHF(daten.summe.einnahmen)
    + ", Kosten " + formatCHF(daten.summe.kosten)
    + ", Restwert " + formatCHF(daten.summe.rest)
    + " (im Schnitt " + formatCHF(daten.schnitt.rest) + " je Monat).";
}

/**
 * Das Balkenband: je Monat Mittel gegen Kosten, die Kosten nach Wirkung
 * gestapelt, der Restwert als Linie darüber.
 */
export function zeichneJahr(state, jahr) {
  const daten = jahresDaten(state, jahr);
  if (daten.leer) {
    return el("p", "hint", "Für " + jahr + " ist noch kein Monat erfasst.");
  }
  const plan = jahresLayout(daten);
  const svg = rahmen(plan, "Jahresüberblick " + jahr, jahrText(daten));

  /* Bodenlinie zuerst — sie liegt hinter allem. */
  svg.append(svgEl("line", {
    x1: 0, y1: plan.nullY, x2: plan.breite, y2: plan.nullY, class: "j-achse"
  }));

  const saeulen = svgEl("g", { class: "j-saeulen" });
  for (const s of plan.saeulen) {
    saeulen.append(svgEl("rect", {
      x: s.einnahme.x, y: s.einnahme.y, width: s.einnahme.breite, height: s.einnahme.h,
      rx: 2, class: "j-einnahme"
    }));
    for (const teil of s.stapel) {
      saeulen.append(svgEl("rect", {
        x: teil.x, y: teil.y, width: teil.breite, height: teil.h,
        class: WIRKUNG_KLASSE[teil.wirkung] ?? "j-verloren"
      }));
    }
    const beschriftung = svgEl("text", {
      x: s.mitte, y: plan.hoehe - 6, class: "d-wert", "text-anchor": "middle"
    });
    beschriftung.textContent = s.kurz;
    saeulen.append(beschriftung);
  }
  svg.append(saeulen);

  /* Der Restwert ist eine Differenz, keine dritte Säule — deshalb Linie. */
  svg.append(svgEl("path", { d: plan.restPfad, class: "j-rest-linie" }));
  for (const s of plan.saeulen) {
    svg.append(svgEl("circle", { cx: s.rest.x, cy: s.rest.y, r: 2.5, class: "j-rest-punkt" }));
  }

  return svg;
}

/** Summe und Durchschnitt je Klassifizierung — die Zahlen zum Band. */
export function jahrTabelle(state, jahr) {
  const daten = jahresDaten(state, jahr);
  const reihen = jahresKlassen(daten, state.klassen);
  const tabelle = el("table", "d-tabelle");

  const kopf = el("thead");
  const kopfzeile = el("tr");
  for (const t of ["Klassifizierung", "Summe", "Ø je Monat"]) kopfzeile.append(el("th", null, t));
  kopf.append(kopfzeile);
  tabelle.append(kopf);

  const koerper = el("tbody");
  for (const r of reihen) {
    const zeile = el("tr");
    const name = el("td");
    name.append(el("i", "tabellen-punkt kf-" + r.farbe), document.createTextNode(r.name));
    zeile.append(name, el("td", "num", formatCHF(r.summe)), el("td", "num", formatCHF(r.schnitt)));
    koerper.append(zeile);
  }

  /* Die Gesamtzeile gehört dazu: ohne sie muss der Leser selbst addieren. */
  const gesamt = el("tr", "d-gruppe");
  gesamt.append(
    el("th", null, "Kosten gesamt"),
    el("th", "num", formatCHF(daten.summe.kosten)),
    el("th", "num", formatCHF(daten.schnitt.kosten))
  );
  koerper.append(gesamt);

  tabelle.append(koerper);
  return tabelle;
}

/* ------------------------------------------------------------------ *
 * Liquiditätsverlauf
 * ------------------------------------------------------------------ */

function verlaufText(daten) {
  /* formatCHF endet bereits auf „Fr.“ — kein zweiter Punkt dahinter. */
  return "Verlauf über den Monat: Start " + formatCHF(daten.start)
    + ", tiefster Stand " + formatCHF(daten.tiefster.stand)
    + " am " + daten.tiefster.tag + ". des Monats"
    + ", Ende " + formatCHF(daten.ende);
}

/** Die Kurve über die Tage, mit dem Tiefpunkt als Marke. */
export function zeichneLiquiditaet(state, month) {
  const daten = liquiditaet(state, month);
  if (daten.leer) {
    return el("p", "hint",
      "Sobald Einnahmen und Kosten erfasst sind, zeigt sich hier, wie der Stand "
      + "über den Monat läuft.");
  }
  const plan = liquiditaetLayout(daten);
  const svg = rahmen(plan, "Liquidität im Monat", verlaufText(daten));

  /* Nulllinie nur, wenn der Verlauf sie überhaupt berührt. */
  if (plan.zeigeNull) {
    svg.append(svgEl("line", {
      x1: 0, y1: plan.nullY, x2: plan.breite, y2: plan.nullY, class: "l-null"
    }));
  }

  /* Fläche unter der Kurve — sie macht die Richtung auf einen Blick lesbar. */
  const ersteX = plan.punkte[0].x;
  const letzteX = plan.punkte[plan.punkte.length - 1].x;
  const boden = plan.zeigeNull ? plan.nullY : plan.hoehe;
  svg.append(svgEl("path", {
    d: plan.pfad + " L " + letzteX + " " + boden + " L " + ersteX + " " + boden + " Z",
    class: "l-flaeche"
  }));
  svg.append(svgEl("path", { d: plan.pfad, class: "l-kurve" }));

  /* Der Tiefpunkt ist der Grund, warum es diese Kurve gibt. */
  const tief = plan.tiefster;
  svg.append(svgEl("circle", {
    cx: tief.x, cy: tief.y, r: 3.5,
    class: "l-tief" + (tief.stand < 0 ? " negativ" : "")
  }));
  const marke = svgEl("text", {
    x: Math.min(plan.breite - 4, Math.max(4, tief.x)),
    y: Math.max(10, tief.y - 8),
    class: "d-wert l-tief-text",
    "text-anchor": tief.x > plan.breite / 2 ? "end" : "start"
  });
  marke.textContent = formatCHF(tief.stand) + " am " + tief.tag + ".";
  svg.append(marke);

  return svg;
}

/** Der Verlauf als Tabelle — nur Tage, an denen sich etwas bewegt. */
export function liquiditaetTabelle(state, month) {
  const daten = liquiditaet(state, month);
  const tabelle = el("table", "d-tabelle");

  const kopf = el("thead");
  const kopfzeile = el("tr");
  for (const t of ["Tag", "Stand"]) kopfzeile.append(el("th", null, t));
  kopf.append(kopfzeile);
  tabelle.append(kopf);

  const koerper = el("tbody");
  let vorher = null;
  for (const p of daten.punkte) {
    if (vorher !== null && p.stand === vorher) continue;
    vorher = p.stand;
    const zeile = el("tr");
    zeile.append(el("td", null, p.tag + "."), el("td", "num", formatCHF(p.stand)));
    koerper.append(zeile);
  }
  tabelle.append(koerper);
  return tabelle;
}
