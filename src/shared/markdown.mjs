/**
 * Blaubuch — Export über alle Monate als Markdown.
 *
 * Eine Abschrift, keine zweite Rechnung: jede Zahl hier kommt aus
 * `totals()` und `kontoSaldo()`. Wo der Export etwas anderes sagen würde
 * als die Oberfläche, wäre er falsch.
 *
 * Gedacht zum Nachlesen, Ausdrucken und Weitergeben — und deshalb
 * **unverschlüsselt**. Der Hauptprozess warnt davor wie bei der
 * Klartextkopie; das ist kein Versehen, sondern der Zweck.
 *
 * Steht bewusst nicht in budget.mjs: die Datei ist mit über 800 Zeilen
 * an der Grenze, und ein Ausgabeformat ist kein Rechenkern.
 */

import {
  totals, kontoSaldo, formatCHF, parseAmount, monthLabel, sortedMonths,
  istUmbuchung, klasseVon, standardKlassen,
  ZEILEN_LISTEN, EINNAHME_ART_TITEL, KEIN_LIMIT
} from "./budget.mjs";

const TITEL = {
  dauerauftraege: "Daueraufträge / LSV",
  fixkosten: "Fixkosten",
  ausgaben: "Ausgaben"
};

/** Senkrechte Striche würden die Tabelle zerreissen. */
const zelle = (text) => String(text ?? "").replace(/\|/g, "∣").replace(/\n/g, " ");

const tabelle = (kopf, zeilen) => {
  if (zeilen.length === 0) return [];
  return [
    "| " + kopf.map(zelle).join(" | ") + " |",
    "|" + kopf.map(() => "---").join("|") + "|",
    ...zeilen.map((z) => "| " + z.map(zelle).join(" | ") + " |")
  ];
};

/**
 * Das ganze Buch als Markdown.
 *
 * @param {object} state
 * @returns {string}
 */
export function buildMarkdown(state) {
  const klassen = state?.klassen ?? standardKlassen();
  const konten = state?.konten ?? [];
  const kontoIds = new Set(konten.map((k) => k.id));
  const kontoName = (id) => konten.find((k) => k.id === id)?.name ?? "unbekannt";
  const keys = sortedMonths(state ?? { months: {} });

  const L = [];
  L.push("# Blaubuch — Auszug über " + keys.length + " Monat" + (keys.length === 1 ? "" : "e"));
  L.push("");
  L.push("Erstellt am " + new Date().toISOString().slice(0, 10)
    + ". Alle Beträge in CHF. Diese Datei ist **nicht verschlüsselt**.");
  L.push("");

  /* --- Übersicht über alle Monate --- */
  L.push("## Übersicht");
  L.push("");
  L.push(...tabelle(
    ["Monat", "Verfügbare Mittel", "Kosten", "Restwert", "Umgebucht", "Sparquote"],
    keys.map((key) => {
      const t = totals(state, state.months[key]);
      return [
        monthLabel(key),
        formatCHF(t.einnahmen),
        formatCHF(t.kosten),
        formatCHF(t.rest),
        formatCHF(t.umgebucht),
        t.sparquote === null ? "—" : t.sparquote.toFixed(1) + "%"
      ];
    })
  ));
  if (keys.length === 0) L.push("Noch kein Monat erfasst.");
  L.push("");

  /* --- Je Monat die Einzelheiten --- */
  for (const key of keys) {
    const month = state.months[key];
    const t = totals(state, month);

    L.push("## " + monthLabel(key));
    L.push("");

    L.push("### Konten");
    L.push("");
    L.push(...tabelle(
      ["Konto", "Anfangsbestand", "Saldo am Monatsende", "Hinweis"],
      konten.map((k) => [
        k.name + (k.institut ? " (" + k.institut + ")" : ""),
        formatCHF(parseAmount(month.anfangsbestaende?.[k.id])),
        formatCHF(kontoSaldo(state, month, k.id)),
        k.aktiv === false ? "zählt nicht mit" : ""
      ])
    ));
    if (konten.length === 0) L.push("Keine Konten angelegt.");
    L.push("");

    L.push("### Einnahmen");
    L.push("");
    L.push(...tabelle(
      ["Bezeichnung", "Betrag", "Art", "Auf Konto", "Tag", "Notiz"],
      (month.einnahmen ?? []).map((e) => [
        e.name + (e.aktiv === false ? " (pausiert)" : ""),
        formatCHF(parseAmount(e.betrag)),
        EINNAHME_ART_TITEL[e.art] ?? "Sonstige Mittel",
        kontoName(e.konto),
        e.faelligAm ? e.faelligAm + "." : "",
        e.notiz ?? ""
      ])
    ));
    if ((month.einnahmen ?? []).length === 0) L.push("Keine Einnahmen erfasst.");
    L.push("");
    L.push("Erwerbseinkommen: **" + formatCHF(t.erwerb) + "** · "
      + "Bestand zu Monatsbeginn: " + formatCHF(t.bestand));
    L.push("");

    const SUMME = { dauerauftraege: t.da, fixkosten: t.fix, ausgaben: t.re };
    for (const liste of ZEILEN_LISTEN) {
      const zeilen = month[liste] ?? [];
      L.push("### " + TITEL[liste] + " — " + formatCHF(SUMME[liste]));
      L.push("");
      L.push(...tabelle(
        ["Bezeichnung", "Betrag", "Klassifizierung", "Von", "Nach", "Tag", "Läuft bis", "Notiz"],
        zeilen.map((z) => [
          z.name + (z.aktiv === false ? " (pausiert)" : ""),
          formatCHF(parseAmount(z.betrag)),
          klasseVon(klassen, z.klasse).name,
          kontoName(z.vonKonto),
          istUmbuchung(z, kontoIds) ? kontoName(z.nachKonto) + " (Umbuchung)" : "extern",
          z.faelligAm ? z.faelligAm + "." : "",
          z.laeuftBis ?? "",
          z.notiz ?? ""
        ])
      ));
      if (zeilen.length === 0) L.push("Keine Einträge.");
      L.push("");
    }

    L.push("### Kreditkarten — " + formatCHF(t.kk));
    L.push("");
    L.push(...tabelle(
      ["Karte", "Saldo", "Limit", "Von Konto"],
      (month.kreditkarten ?? []).map((k) => [
        k.name,
        formatCHF(parseAmount(k.betrag)),
        parseAmount(k.limit) > KEIN_LIMIT ? formatCHF(parseAmount(k.limit)) : "kein Limit",
        kontoName(k.vonKonto)
      ])
    ));
    if ((month.kreditkarten ?? []).length === 0) L.push("Keine Karten angelegt.");
    L.push("");

    L.push("### Summen");
    L.push("");
    L.push(...tabelle(
      ["Posten", "Betrag"],
      [
        ["Verfügbare Mittel", formatCHF(t.einnahmen)],
        ["Gesamtkosten", formatCHF(t.kosten)],
        ["Restwert", formatCHF(t.rest)],
        ["Zwischen eigenen Konten umgebucht (keine Kosten)", formatCHF(t.umgebucht)],
        ["Durchlaufgeld (zählt nirgends)", formatCHF(t.durchlauf)],
        ["Nicht verloren (angelegt oder gespart)", formatCHF(t.angelegt)],
        ...klassen
          .filter((k) => (t.byKlasse[k.id] ?? 0) > 0)
          .map((k) => ["· " + k.name, formatCHF(t.byKlasse[k.id])])
      ]
    ));
    L.push("");
  }

  return L.join("\n");
}
