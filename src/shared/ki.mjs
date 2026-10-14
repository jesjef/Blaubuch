/**
 * Blaubuch — Werkzeuge für den KI-Zugriff (1.4.0: Lesen, 1.5.0: Vorschläge).
 *
 * Reine Funktionen auf einem Stand. Kein Electron, kein Netz, kein
 * Dateisystem: Was die KI abfragt, wird mit denselben Funktionen
 * gerechnet wie das, was auf dem Bildschirm steht — `totals`,
 * `buildInsights`, `jahresDaten`, `liquiditaet`. Eine zweite Rechnung
 * gibt es nicht, und damit auch keine zweite Wahrheit.
 *
 * Das Protokoll (MCP) liegt in src/main/mcp.mjs. Dieses Modul weiss
 * nichts davon: Es kennt Werkzeuge, Argumente und Ergebnisse.
 */

import {
  totals, kontoSaldo, kontoLage, buchungsArt, buildInsights, buildReport,
  sortedMonths, monthLabel, isMonthKey, parseAmount, klasseVon,
  standardKlassen, EINNAHME_ART_TITEL, ZEILEN_LISTEN
} from "./budget.mjs";
import { jahre, jahresDaten, liquiditaet } from "./jahr.mjs";
import { KiFehler, pruefeArgumente } from "./ki-fehler.mjs";
import { erstelleVorschlag, beschreibe, SCHEMA } from "./vorschlaege.mjs";

export { KiFehler };

/* ------------------------------------------------------------------ *
 * Argumente
 * ------------------------------------------------------------------ */

const MONAT = {
  type: "string",
  pattern: "^\\d{4}-(0[1-9]|1[0-2])$",
  description: "Monat im Format JJJJ-MM, z. B. 2026-10. Ohne Angabe gilt der in Blaubuch gewählte Monat."
};

const nurMonat = { type: "object", properties: { monat: MONAT }, additionalProperties: false };

function waehleMonat(state, monat) {
  const key = monat ?? state.currentMonth;
  if (!isMonthKey(key) || !state.months?.[key]) {
    throw new KiFehler("Den Monat " + key + " gibt es in Blaubuch nicht. Vorhanden: "
      + (sortedMonths(state).join(", ") || "keine") + ".");
  }
  return key;
}

/* ------------------------------------------------------------------ *
 * Aufbereitung
 * ------------------------------------------------------------------ */

const textAus = (parts) => parts.map((p) => (typeof p === "string" ? p : p.b)).join("");

/** Eine Zeile so, wie sie die KI braucht: mit Namen statt Kennungen. */
function zeileFuerKi(z, state, lage, kontoName) {
  const klassen = state.klassen ?? standardKlassen();
  return {
    id: z.id,
    name: z.name,
    betrag: parseAmount(z.betrag),
    klassifizierung: klasseVon(klassen, z.klasse).name,
    von: kontoName(z.vonKonto),
    nach: z.nachKonto ? kontoName(z.nachKonto) : "extern",
    /* Warum die Zeile so zählt, wie sie zählt — sonst rät die KI. */
    wirkung: z.aktiv === false ? "pausiert" : buchungsArt(z, lage),
    tag: z.faelligAm ?? null,
    laeuftBis: z.laeuftBis ?? null,
    notiz: z.notiz ?? ""
  };
}

function monatLesen(state, key) {
  const month = state.months[key];
  const lage = kontoLage(state);
  const konten = state.konten ?? [];
  const kontoName = (id) => konten.find((k) => k.id === id)?.name ?? "unbekannt";
  const t = totals(state, month);

  const daten = {
    monat: key,
    bezeichnung: monthLabel(key),
    einnahmen: (month.einnahmen ?? []).map((e) => ({
      id: e.id,
      name: e.name,
      betrag: parseAmount(e.betrag),
      art: EINNAHME_ART_TITEL[e.art] ?? e.art,
      konto: kontoName(e.konto),
      zaehlt: e.aktiv !== false && lage.zaehlt(e.konto),
      tag: e.faelligAm ?? null,
      notiz: e.notiz ?? ""
    })),
    kreditkarten: (month.kreditkarten ?? []).map((k) => ({
      id: k.id,
      name: k.name,
      saldo: parseAmount(k.betrag),
      limit: parseAmount(k.limit) || null,
      von: kontoName(k.vonKonto),
      zaehlt: lage.zaehlt(k.vonKonto)
    })),
    summen: {
      bestand: t.bestand, erwerb: t.erwerb, geliehen: t.geliehen, sonstige: t.sonstige,
      zufluss: t.zufluss, einnahmen: t.einnahmen,
      fixkosten: t.fix, kreditkarten: t.kk, ausgaben: t.re, kosten: t.kosten,
      rest: t.rest, ueberschuss: t.ueberschuss, sparquote: t.sparquote,
      umgebucht: t.umgebucht, abgelegt: t.abgelegt, durchlauf: t.durchlauf,
      verloren: t.verloren, angelegt: t.angelegt
    }
  };
  for (const liste of ZEILEN_LISTEN) {
    daten[liste] = (month[liste] ?? []).map((z) => zeileFuerKi(z, state, lage, kontoName));
  }
  return daten;
}

/* ------------------------------------------------------------------ *
 * Werkzeuge
 * ------------------------------------------------------------------ */

const lesend = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
/* Legt einen Vorschlag an — der Stand bleibt unberührt, bis der Anwender zustimmt. */
const vorschlagend = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

const HINWEIS_VORSCHLAG = "Nichts ist geändert. Der Vorschlag wartet in Blaubuch auf die Zustimmung "
  + "des Anwenders. Ob er angenommen wurde, sagt vorschlaege_status.";

function brauchtListe(kontext) {
  if (!kontext?.schlageVor) throw new KiFehler("Vorschläge sind hier nicht möglich.");
  return kontext;
}

/** Gemeinsamer Ablauf der drei Vorschlagswerkzeuge. */
const schlageVor = (art) => (state, args, kontext) => {
  const k = brauchtListe(kontext);
  const v = erstelleVorschlag(art, args, state);
  const eintrag = k.schlageVor(v);
  return {
    daten: { vorschlag: eintrag.id, status: eintrag.status, beschreibung: beschreibe(v, state), hinweis: HINWEIS_VORSCHLAG }
  };
};

/**
 * Reihenfolge ist fest: Clients dürfen die Liste zwischenspeichern, und
 * eine wechselnde Reihenfolge würde jeden Zwischenspeicher verwerfen.
 */
export const WERKZEUGE = Object.freeze([
  {
    name: "monate_auflisten",
    title: "Monate auflisten",
    description: "Listet alle in Blaubuch erfassten Monate und nennt den gerade gewählten. "
      + "Zuerst aufrufen, um zu wissen, welche Monate es gibt.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: lesend,
    run: (state) => ({
      daten: {
        aktuell: state.currentMonth,
        monate: sortedMonths(state).map((key) => ({ key, bezeichnung: monthLabel(key) }))
      }
    })
  },
  {
    name: "konten_lesen",
    title: "Konten lesen",
    description: "Die Konten mit Anfangsbestand und Saldo am Monatsende. Ausgeblendete Konten "
      + "(ausgeblendet: true) zählen weder für die verfügbaren Mittel noch für den Restwert.",
    inputSchema: nurMonat,
    annotations: lesend,
    run: (state, { monat }) => {
      const key = waehleMonat(state, monat);
      const month = state.months[key];
      return {
        daten: {
          monat: key,
          konten: (state.konten ?? []).map((k) => ({
            id: k.id,
            name: k.name,
            institut: k.institut ?? "",
            ausgeblendet: k.aktiv === false,
            anfangsbestand: parseAmount(month.anfangsbestaende?.[k.id]),
            saldo: kontoSaldo(state, month, k.id)
          }))
        }
      };
    }
  },
  {
    name: "monat_lesen",
    title: "Monat lesen",
    description: "Alle Buchungen eines Monats — Einnahmen, Fixkosten & Daueraufträge, Ausgaben, "
      + "Kreditkarten — und die Summen genau so, wie Blaubuch sie anzeigt. Das Feld `wirkung` "
      + "sagt je Zeile, wie sie zählt (kosten, umbuchung, ablage, zufluss, aussen, pausiert).",
    inputSchema: nurMonat,
    annotations: lesend,
    run: (state, { monat }) => ({ daten: monatLesen(state, waehleMonat(state, monat)) })
  },
  {
    name: "analyse",
    title: "Analyse",
    description: "Die Beobachtungen, die Blaubuch selbst zu einem Monat macht: Sparquote, "
      + "Kartenlimits, grösster Kostenblock, Vergleich mit dem Vormonat.",
    inputSchema: nurMonat,
    annotations: lesend,
    run: (state, { monat }) => {
      const key = waehleMonat(state, monat);
      return {
        daten: {
          monat: key,
          beobachtungen: buildInsights(state, key).map((i) => ({
            art: i.kind || "info",
            text: textAus(i.parts)
          }))
        }
      };
    }
  },
  {
    name: "bericht",
    title: "Monatsbericht",
    description: "Der Monatsbericht als Fliesstext — derselbe, den Blaubuch zum Kopieren in "
      + "einen Chat anbietet. Gut als Ausgangspunkt für Spar- und Optimierungstipps.",
    inputSchema: nurMonat,
    annotations: lesend,
    run: (state, { monat }) => ({ text: buildReport(state, waehleMonat(state, monat)) })
  },
  {
    name: "jahresueberblick",
    title: "Jahresüberblick",
    description: "Einnahmen, Kosten und Restwert je Monat eines Jahres, mit Summe und Schnitt. "
      + "Nicht erfasste Monate fehlen — sie sind nicht null.",
    inputSchema: {
      type: "object",
      properties: {
        jahr: {
          type: "string",
          pattern: "^\\d{4}$",
          description: "Jahr als Text, z. B. \"2026\". Ohne Angabe gilt das Jahr des gewählten Monats."
        }
      },
      additionalProperties: false
    },
    annotations: lesend,
    run: (state, { jahr }) => {
      const j = jahr ?? String(state.currentMonth ?? "").slice(0, 4);
      if (!jahre(state).includes(j)) {
        throw new KiFehler("Zum Jahr " + j + " gibt es keine Monate. Vorhanden: "
          + (jahre(state).join(", ") || "keine") + ".");
      }
      const d = jahresDaten(state, j);
      return {
        daten: {
          jahr: d.jahr,
          summe: d.summe,
          schnitt: d.schnitt,
          monate: d.monate.map((m) => ({
            monat: m.key, einnahmen: m.einnahmen, kosten: m.kosten, rest: m.rest,
            erwerb: m.erwerb, umgebucht: m.umgebucht, verloren: m.byWirkung.verloren
          }))
        }
      };
    }
  },
  {
    name: "liquiditaet",
    title: "Liquidität im Monat",
    description: "Wie sich das verfügbare Geld über den Monat bewegt: Stand zu Beginn, am Ende "
      + "und am tiefsten Punkt. Zeigt, ob das Geld zwischendurch knapp wird.",
    inputSchema: nurMonat,
    annotations: lesend,
    run: (state, { monat }) => {
      const key = waehleMonat(state, monat);
      const l = liquiditaet(state, state.months[key]);
      return {
        daten: {
          monat: key, start: l.start, ende: l.ende, tiefster: l.tiefster,
          zeilenOhneTag: l.ohneTag, leer: l.leer
        }
      };
    }
  },
  {
    name: "zeile_vorschlagen",
    title: "Zeile vorschlagen",
    description: "Schlägt eine neue Zeile in Fixkosten & Daueraufträge oder Ausgaben vor. Ändert nichts: "
      + "Der Anwender sieht den Vorschlag mit deiner Begründung in Blaubuch und nimmt ihn an oder lehnt ab. "
      + "Konten und Klassifizierungen mit Namen aus monat_lesen angeben.",
    inputSchema: SCHEMA.zeile,
    annotations: vorschlagend,
    run: schlageVor("zeile")
  },
  {
    name: "einnahme_vorschlagen",
    title: "Einnahme vorschlagen",
    description: "Schlägt eine neue Einnahmezeile vor. Ändert nichts, bis der Anwender zustimmt. "
      + "Die Art entscheidet die Rechnung: nur erwerb zählt als Einkommen für die Sparquote.",
    inputSchema: SCHEMA.einnahme,
    annotations: vorschlagend,
    run: schlageVor("einnahme")
  },
  {
    name: "aenderung_vorschlagen",
    title: "Änderung vorschlagen",
    description: "Schlägt vor, Felder einer bestehenden Zeile zu ändern (Kennung aus monat_lesen). Nur die "
      + "genannten Felder ändern sich. Ändert der Anwender die Zeile vorher selbst, verfällt der Vorschlag.",
    inputSchema: SCHEMA.aenderung,
    annotations: vorschlagend,
    run: schlageVor("aenderung")
  },
  {
    name: "vorschlaege_status",
    title: "Stand der Vorschläge",
    description: "Listet deine Vorschläge mit Stand: offen, angenommen, abgelehnt oder veraltet.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: lesend,
    run: (state, _args, kontext) => ({
      daten: {
        vorschlaege: brauchtListe(kontext).vorschlaege().map((e) => ({
          id: e.id, status: e.status, titel: beschreibe(e, state).titel, erstellt: e.erstellt
        }))
      }
    })
  }
].map((w) => Object.freeze(w)));

/**
 * Ein Werkzeug ausführen. Ergebnis: `{daten}` für strukturierte Antworten
 * oder `{text}` für Fliesstext. Wirft KiFehler, wenn die KI etwas falsch
 * gefragt hat.
 *
 * `kontext` braucht nur, wer vorschlägt: `{schlageVor(v), vorschlaege()}`.
 */
export function fuehreAus(name, args, state, kontext) {
  const werkzeug = WERKZEUGE.find((w) => w.name === name);
  if (!werkzeug) {
    throw new KiFehler("Das Werkzeug „" + name + "“ gibt es nicht. Vorhanden: "
      + WERKZEUGE.map((w) => w.name).join(", ") + ".");
  }
  return werkzeug.run(state, pruefeArgumente(werkzeug.inputSchema, args), kontext);
}

/* ------------------------------------------------------------------ *
 * Ressource: das Datenmodell
 * ------------------------------------------------------------------ */

const DATENMODELL = `# Blaubuch — wie gerechnet wird

Blaubuch ist ein Monatsbudget in Schweizer Franken. Alle Beträge in CHF.

## Konten
Konten sind eigene Konten (Lohnkonto, Sparkonto, Bargeld …). Jedes hat je
Monat einen Anfangsbestand. Ein Konto kann **ausgeblendet** sein: Dann
zählen weder sein Bestand noch Buchungen darauf oder davon für die
verfügbaren Mittel und den Restwert. Typisch für Spartöpfe, die nicht als
frei verfügbar gelten sollen.

**Restwert = Summe der Saldi aller nicht ausgeblendeten Konten.**

## Einnahmen
Jede Einnahme hat eine Art:
- **Erwerbseinkommen** — verdientes Geld. Nur das ist die Bezugsgrösse der Sparquote.
- **Geliehen** — Fremdmittel, zurückzuzahlen. Erhöht die Mittel, ist kein Einkommen.
- **Sonstige Mittel** — Geschenk, Rückerstattung. Erhöht Mittel und Überschuss.
- **Durchlaufgeld** — gehört dem Anwender nicht und zählt nirgends.

## Buchungszeilen
Zwei Listen: **Fixkosten & Daueraufträge** (wiederkehrend, werden in den
Folgemonat übernommen) und **Ausgaben** (einmalig). Dazu Kreditkarten mit
ihrem Saldo; der Kartensaldo zählt als Ausgabe.

Jede Zeile geht von einem Konto aus und optional auf ein eigenes Konto.
Daraus folgt ihre Wirkung (Feld \`wirkung\`):
- **kosten** — Geld verlässt die eigenen Konten.
- **umbuchung** — von einem sichtbaren auf ein sichtbares Konto. Keine Kosten.
- **ablage** — von einem sichtbaren auf ein ausgeblendetes Konto. Zählt als
  Kosten (der Restwert sinkt), in der Sparquote aber als gespart.
- **zufluss** — von einem ausgeblendeten auf ein sichtbares Konto. Erhöht
  die Mittel, ist aber kein Einkommen.
- **aussen** — berührt nur ausgeblendete Konten. Zählt nicht.
- **pausiert** — vom Anwender ausgesetzt. Zählt nicht.

## Klassifizierungen
Jede Zeile trägt eine Klassifizierung mit einer Wirkung:
- **verloren** (z. B. „Ausgaben“) — das Geld ist weg.
- **erhalten** (z. B. „Investition“, „Sparen“, „Investition blockiert“) —
  ausgegeben, aber nicht verloren; es liegt woanders.
- **Durchlaufgeld** — zählt weder als Kosten noch als Einkommen.

Blaubuch unterscheidet bewusst, *wie viel weg ist* (Kosten) und *wie viel
davon tatsächlich verloren ist* (verloren).

## Kennzahlen
- **Verfügbare Mittel** = Bestand + Erwerb + Geliehen + Sonstige + Zufluss.
- **Kosten** = Fixkosten + Ausgaben + Kreditkarten (ohne Umbuchungen).
- **Restwert** = Mittel − Kosten.
- **Überschuss** = Erwerb + Sonstige − (Kosten − Ablage).
- **Sparquote** = Überschuss / Erwerbseinkommen. Bestand, Darlehen und
  Zuflüsse aus ausgeblendeten Konten heben sie nicht.

## Vorschläge
Du kannst Zeilen, Einnahmen und Änderungen vorschlagen — nicht selbst
buchen. Der Anwender sieht jeden Vorschlag mit deiner Begründung und nimmt
ihn an oder lehnt ab. Ändert er die betroffene Zeile vorher selbst, verfällt
der Vorschlag. Neue Monate, neue Konten und Löschungen sind keine
Vorschläge; das macht der Anwender selbst.

## Grenzen
Blaubuch ist Buchhaltung: erfassen, ordnen, aufsummieren. Es rechnet nicht
in die Zukunft und bewertet kein Vermögen.
`;

export const RESSOURCEN = Object.freeze([
  Object.freeze({
    uri: "blaubuch://datenmodell",
    name: "datenmodell",
    title: "Blaubuch — wie gerechnet wird",
    description: "Begriffe und Rechenregeln: Konten, Einnahme-Arten, Wirkung einer Zeile, "
      + "Klassifizierungen, Restwert und Sparquote. Vor der Auswertung lesen.",
    mimeType: "text/markdown"
  })
]);

export function leseRessource(uri) {
  const r = RESSOURCEN.find((x) => x.uri === uri);
  if (!r) throw new KiFehler("Die Ressource „" + uri + "“ gibt es nicht.");
  return { uri: r.uri, mimeType: r.mimeType, text: DATENMODELL };
}
