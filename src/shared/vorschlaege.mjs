/**
 * Blaubuch — Vorschläge der KI (1.4.0-Plan, Stufe 2).
 *
 * Eine KI kann vorschlagen, aber nichts ändern. Dieses Modul
 *
 *  - prüft einen Vorschlag und löst Namen zu Kennungen auf (erstelleVorschlag),
 *  - erkennt, ob er noch passt (istVeraltet),
 *  - wendet ihn an, wenn der Anwender zustimmt (wendeAn),
 *  - beschreibt ihn für die Karte „Vorschläge“ (beschreibe),
 *  - führt die Liste der Vorschläge (Vorschlagsliste).
 *
 * Reine Funktionen bis auf `wendeAn`, das den übergebenen Stand ändert —
 * so wie jede Eingabe von Hand in der Oberfläche auch, nach `pushUndo`.
 *
 * Bewusst nicht: neue Monate oder Konten anlegen, Zeilen löschen. Das
 * bleibt beim Anwender.
 */

import {
  formatCHF, monthLabel, isMonthKey, sortedMonths, uid, standardKlassen,
  EINNAHME_ARTEN, EINNAHME_ART_TITEL, STANDARD_KLASSE
} from "./budget.mjs";
import { KiFehler, pruefeArgumente, saeubere } from "./ki-fehler.mjs";

export const MAX_OFFEN = 20;
const MAX_BETRAG = 10_000_000;

const LISTEN_TITEL = { fixkosten: "Fixkosten & Daueraufträge", ausgaben: "Ausgaben", einnahmen: "Einnahmen" };

/* ------------------------------------------------------------------ *
 * Schemas — zugleich die inputSchema der Werkzeuge
 * ------------------------------------------------------------------ */

const S = {
  monat: {
    type: "string", pattern: "^\\d{4}-(0[1-9]|1[0-2])$",
    description: "Monat im Format JJJJ-MM. Ohne Angabe gilt der in Blaubuch gewählte Monat."
  },
  name: { type: "string", minLength: 1, maxLength: 120, description: "Bezeichnung der Zeile." },
  betrag: {
    type: "number", not: { const: 0 }, maximum: MAX_BETRAG,
    description: "Betrag in CHF als Zahl, z. B. 89.5. Negativ nur für Korrekturen."
  },
  klassifizierung: {
    type: "string", minLength: 1, maxLength: 60,
    description: "Name oder Kennung einer Klassifizierung aus monat_lesen, z. B. „Ausgaben“ oder „Sparen“."
  },
  von: { type: "string", minLength: 1, maxLength: 120, description: "Name oder Kennung des Kontos, von dem bezahlt wird." },
  nach: {
    type: ["string", "null"], maxLength: 120,
    description: "Name oder Kennung eines eigenen Zielkontos (Umbuchung) — oder „extern“ bzw. null."
  },
  konto: { type: "string", minLength: 1, maxLength: 120, description: "Name oder Kennung des Kontos, auf das die Einnahme geht." },
  art: { type: "string", enum: EINNAHME_ARTEN, description: "erwerb, geliehen, sonstige oder durchlauf." },
  tag: { type: ["integer", "null"], minimum: 1, maximum: 31, description: "Tag im Monat (1–31) oder null." },
  notiz: { type: "string", maxLength: 500, description: "Freie Notiz." },
  begruendung: {
    type: "string", minLength: 1, maxLength: 1000,
    description: "Warum du das vorschlägst — der Anwender liest es, bevor er zustimmt."
  },
  id: { type: "string", minLength: 1, maxLength: 64, description: "Kennung der Zeile aus monat_lesen." }
};

export const SCHEMA = Object.freeze({
  zeile: {
    type: "object",
    properties: {
      monat: S.monat,
      liste: { type: "string", enum: ["fixkosten", "ausgaben"], description: "fixkosten (wiederkehrend) oder ausgaben (einmalig)." },
      name: S.name, betrag: S.betrag, klassifizierung: S.klassifizierung,
      von: S.von, nach: S.nach, tag: S.tag, notiz: S.notiz, begruendung: S.begruendung
    },
    required: ["liste", "name", "betrag", "begruendung"],
    additionalProperties: false
  },
  einnahme: {
    type: "object",
    properties: {
      monat: S.monat, name: S.name, betrag: S.betrag, art: S.art,
      konto: S.konto, tag: S.tag, notiz: S.notiz, begruendung: S.begruendung
    },
    required: ["name", "betrag", "art", "begruendung"],
    additionalProperties: false
  },
  aenderung: {
    type: "object",
    properties: {
      monat: S.monat, id: S.id,
      name: S.name, betrag: S.betrag, klassifizierung: S.klassifizierung,
      von: S.von, nach: S.nach, art: S.art, konto: S.konto, tag: S.tag, notiz: S.notiz,
      begruendung: S.begruendung
    },
    required: ["id", "begruendung"],
    additionalProperties: false
  }
});

/** Welche Felder eine Änderung je Zeilenart setzen darf, und wohin sie gehen. */
const AENDERBAR = {
  zeile: { name: "name", betrag: "betrag", klassifizierung: "klasse", von: "vonKonto", nach: "nachKonto", tag: "faelligAm", notiz: "notiz" },
  einnahme: { name: "name", betrag: "betrag", art: "art", konto: "konto", tag: "faelligAm", notiz: "notiz" }
};

/* ------------------------------------------------------------------ *
 * Auflösen: Namen zu Kennungen
 * ------------------------------------------------------------------ */

const gleich = (a, b) => a.trim().toLocaleLowerCase("de-CH") === b.trim().toLocaleLowerCase("de-CH");

function findeKonto(state, wert, feld) {
  const konten = state.konten ?? [];
  const treffer = konten.find((k) => k.id === wert) ?? konten.filter((k) => gleich(k.name, wert));
  if (!Array.isArray(treffer)) return treffer.id;
  if (treffer.length === 1) return treffer[0].id;
  throw new KiFehler((treffer.length ? "Mehrere Konten heissen „" : "Kein Konto heisst „") + wert + "“ (" + feld
    + "). Vorhanden: " + konten.map((k) => k.name).join(", ") + ". Bei Gleichnamigen die Kennung angeben.");
}

function findeKlasse(state, wert) {
  const klassen = (state.klassen ?? standardKlassen()).filter((k) => !k.stillgelegt);
  const treffer = klassen.find((k) => k.id === wert) ?? klassen.find((k) => gleich(k.name, wert));
  if (treffer) return treffer.id;
  throw new KiFehler("Keine Klassifizierung „" + wert + "“. Wählbar: " + klassen.map((k) => k.name).join(", ") + ".");
}

const erstesSichtbaresKonto = (state) =>
  (state.konten ?? []).find((k) => k.aktiv !== false)?.id ?? state.konten?.[0]?.id ?? null;

function waehleMonat(state, monat) {
  const key = monat ?? state.currentMonth;
  if (!isMonthKey(key) || !state.months?.[key]) {
    throw new KiFehler("Den Monat " + key + " gibt es nicht. Vorhanden: " + (sortedMonths(state).join(", ") || "keine")
      + ". Neue Monate legt der Anwender selbst an.");
  }
  return key;
}

function text(wert, feld, pflicht) {
  const t = saeubere(wert);
  if (pflicht && !t) throw new KiFehler("„" + feld + "“ ist leer.");
  return t;
}

/** Sucht eine Zeile über alle Listen eines Monats. */
function findeZeile(month, id) {
  for (const liste of ["einnahmen", "fixkosten", "ausgaben"]) {
    const zeile = (month[liste] ?? []).find((z) => z?.id === id);
    if (zeile) return { liste, zeile };
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Erstellen
 * ------------------------------------------------------------------ */

/**
 * Prüft einen Vorschlag und löst ihn auf. Ändert den Stand nicht.
 *
 * @param {"zeile"|"einnahme"|"aenderung"} art
 * @returns {object} der aufgelöste Vorschlag (ohne Kennung und Status — die vergibt die Liste)
 */
export function erstelleVorschlag(art, rohArgs, state) {
  const schema = SCHEMA[art];
  if (!schema) throw new KiFehler("Unbekannte Vorschlagsart „" + art + "“.");
  const a = pruefeArgumente(schema, rohArgs);
  const monat = waehleMonat(state, a.monat);
  const begruendung = text(a.begruendung, "begruendung", true);

  if (art === "zeile") {
    return {
      art, monat, liste: a.liste, begruendung,
      neu: {
        name: text(a.name, "name", true),
        betrag: a.betrag,
        klasse: a.klassifizierung !== undefined ? findeKlasse(state, a.klassifizierung) : STANDARD_KLASSE,
        vonKonto: a.von !== undefined ? findeKonto(state, a.von, "von") : erstesSichtbaresKonto(state),
        nachKonto: a.nach == null || gleich(a.nach, "extern") || !a.nach.trim() ? null : findeKonto(state, a.nach, "nach"),
        faelligAm: a.tag ?? null,
        notiz: text(a.notiz, "notiz", false)
      }
    };
  }

  if (art === "einnahme") {
    return {
      art, monat, liste: "einnahmen", begruendung,
      neu: {
        name: text(a.name, "name", true),
        betrag: a.betrag,
        art: a.art,
        konto: a.konto !== undefined ? findeKonto(state, a.konto, "konto") : erstesSichtbaresKonto(state),
        faelligAm: a.tag ?? null,
        notiz: text(a.notiz, "notiz", false)
      }
    };
  }

  /* Änderung einer bestehenden Zeile */
  const fund = findeZeile(state.months[monat], a.id);
  if (!fund) throw new KiFehler("In " + monthLabel(monat) + " gibt es keine Zeile mit der Kennung „" + a.id + "“. Kennungen liefert monat_lesen.");
  const sorte = fund.liste === "einnahmen" ? "einnahme" : "zeile";
  const erlaubt = AENDERBAR[sorte];

  const aenderungen = {};
  for (const [feld, wert] of Object.entries(a)) {
    if (["monat", "id", "begruendung"].includes(feld) || wert === undefined) continue;
    if (!(feld in erlaubt)) {
      throw new KiFehler("„" + feld + "“ lässt sich bei " + (sorte === "einnahme" ? "einer Einnahme" : "einer Buchungszeile")
        + " nicht ändern. Möglich: " + Object.keys(erlaubt).join(", ") + ".");
    }
    const ziel = erlaubt[feld];
    aenderungen[ziel] =
      feld === "klassifizierung" ? findeKlasse(state, wert)
        : feld === "von" || feld === "konto" ? findeKonto(state, wert, feld)
          : feld === "nach" ? (wert == null || gleich(wert, "extern") || !wert.trim() ? null : findeKonto(state, wert, "nach"))
            : feld === "name" ? text(wert, "name", true)
              : feld === "notiz" ? text(wert, "notiz", false)
                : feld === "tag" ? (wert ?? null)
                  : wert;
  }
  if (Object.keys(aenderungen).length === 0) {
    throw new KiFehler("Eine Änderung braucht mindestens ein Feld. Möglich: " + Object.keys(erlaubt).join(", ") + ".");
  }
  return {
    art, monat, liste: fund.liste, zeileId: a.id, begruendung, aenderungen,
    /* So sah die Zeile beim Vorschlagen aus. Weicht sie beim Annehmen
       davon ab, ist der Vorschlag veraltet. */
    vorher: JSON.stringify(fund.zeile)
  };
}

/* ------------------------------------------------------------------ *
 * Veraltet?
 * ------------------------------------------------------------------ */

/** Gibt einen Grund zurück, wenn der Vorschlag nicht mehr passt — sonst null. */
export function istVeraltet(v, state) {
  const month = state.months?.[v.monat];
  if (!month) return "Den Monat " + monthLabel(v.monat) + " gibt es nicht mehr.";

  const kontoIds = new Set((state.konten ?? []).map((k) => k.id));
  const klassen = (state.klassen ?? standardKlassen()).filter((k) => !k.stillgelegt).map((k) => k.id);
  const werte = v.art === "aenderung" ? v.aenderungen : v.neu;
  for (const feld of ["vonKonto", "nachKonto", "konto"]) {
    const id = werte[feld];
    if (id && !kontoIds.has(id)) return "Ein Konto aus dem Vorschlag gibt es nicht mehr.";
  }
  if (werte.klasse && !klassen.includes(werte.klasse)) return "Die Klassifizierung ist nicht mehr wählbar.";

  if (v.art === "aenderung") {
    const zeile = (month[v.liste] ?? []).find((z) => z?.id === v.zeileId);
    if (!zeile) return "Die Zeile wurde inzwischen gelöscht.";
    if (JSON.stringify(zeile) !== v.vorher) return "Die Zeile wurde seit dem Vorschlag geändert.";
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Anwenden
 * ------------------------------------------------------------------ */

/**
 * Wendet den Vorschlag auf den Stand an. Wirft KiFehler, wenn er veraltet
 * ist — dann bleibt der Stand unberührt. Gibt eine kurze Beschreibung für
 * den Rückgängig-Knopf zurück.
 */
export function wendeAn(v, state) {
  const grund = istVeraltet(v, state);
  if (grund) throw new KiFehler(grund);
  const month = state.months[v.monat];

  if (v.art === "zeile") {
    month[v.liste] = month[v.liste] ?? [];
    month[v.liste].push({ id: uid(), ...v.neu, aktiv: true, laeuftBis: null });
    return v.neu.name + " (" + LISTEN_TITEL[v.liste] + ") hinzugefügt";
  }
  if (v.art === "einnahme") {
    month.einnahmen = month.einnahmen ?? [];
    month.einnahmen.push({ id: uid(), ...v.neu, aktiv: true });
    return "Einnahme " + v.neu.name + " hinzugefügt";
  }
  const zeile = month[v.liste].find((z) => z.id === v.zeileId);
  Object.assign(zeile, v.aenderungen);
  return zeile.name + " geändert";
}

/* ------------------------------------------------------------------ *
 * Beschreiben
 * ------------------------------------------------------------------ */

function lesbar(state, feld, wert) {
  const kontoName = (id) => (state.konten ?? []).find((k) => k.id === id)?.name ?? "unbekannt";
  const klassen = state.klassen ?? standardKlassen();
  switch (feld) {
    case "betrag": return formatCHF(wert);
    case "klasse": return klassen.find((k) => k.id === wert)?.name ?? "unbekannt";
    case "vonKonto": case "konto": return kontoName(wert);
    case "nachKonto": return wert ? kontoName(wert) : "extern";
    case "art": return EINNAHME_ART_TITEL[wert] ?? String(wert);
    case "faelligAm": return wert ? wert + "." : "—";
    default: return wert === "" || wert == null ? "—" : String(wert);
  }
}

const FELD_TITEL = {
  name: "Bezeichnung", betrag: "Betrag", klasse: "Klassifizierung", vonKonto: "Von",
  nachKonto: "Nach", konto: "Konto", art: "Art", faelligAm: "Tag", notiz: "Notiz"
};

/**
 * Was die Karte zeigt: ein Titel und je Feld alt → neu. Nur Namen,
 * nie Kennungen.
 */
export function beschreibe(v, state) {
  if (v.art === "aenderung") {
    const vorher = JSON.parse(v.vorher);
    return {
      titel: "Ändern: " + vorher.name + " (" + LISTEN_TITEL[v.liste] + ", " + monthLabel(v.monat) + ")",
      felder: Object.entries(v.aenderungen).map(([feld, neu]) => ({
        feld: FELD_TITEL[feld] ?? feld, alt: lesbar(state, feld, vorher[feld]), neu: lesbar(state, feld, neu)
      }))
    };
  }
  return {
    titel: (v.art === "einnahme" ? "Neue Einnahme: " : "Neu in " + LISTEN_TITEL[v.liste] + ": ")
      + v.neu.name + " (" + monthLabel(v.monat) + ")",
    felder: Object.entries(v.neu)
      .filter(([feld, wert]) => feld !== "name" && !(feld === "notiz" && !wert) && !(feld === "faelligAm" && !wert))
      .map(([feld, neu]) => ({ feld: FELD_TITEL[feld] ?? feld, alt: null, neu: lesbar(state, feld, neu) }))
  };
}

/* ------------------------------------------------------------------ *
 * Die Liste
 * ------------------------------------------------------------------ */

export const STATUS = Object.freeze(["offen", "angenommen", "abgelehnt", "veraltet"]);
const ERLEDIGT_BEHALTEN = 30;

/**
 * Lebt nur im Speicher. Beim Sperren und Ausschalten wird sie geleert —
 * Vorschläge beziehen sich auf Daten, die dann nicht mehr offen liegen.
 */
export class Vorschlagsliste {
  #eintraege = [];
  #naechste = 1;

  hinzufuegen(v) {
    if (this.offene().length >= MAX_OFFEN) {
      throw new KiFehler("Es sind schon " + MAX_OFFEN + " Vorschläge offen. Warte, bis der Anwender sie bearbeitet hat.");
    }
    const eintrag = { ...v, id: "v" + this.#naechste++, status: "offen", erstellt: new Date().toISOString() };
    this.#eintraege.push(eintrag);
    return eintrag;
  }

  setzeStatus(id, status) {
    if (!STATUS.includes(status) || status === "offen") throw new KiFehler("Unbekannter Status „" + status + "“.");
    const e = this.#eintraege.find((x) => x.id === id);
    if (!e) throw new KiFehler("Den Vorschlag „" + id + "“ gibt es nicht.");
    if (e.status !== "offen") throw new KiFehler("Der Vorschlag „" + id + "“ ist schon " + e.status + ".");
    e.status = status;
    e.erledigt = new Date().toISOString();

    /* Erledigte nur begrenzt aufheben. */
    const erledigte = this.#eintraege.filter((x) => x.status !== "offen");
    if (erledigte.length > ERLEDIGT_BEHALTEN) {
      const weg = new Set(erledigte.slice(0, erledigte.length - ERLEDIGT_BEHALTEN));
      this.#eintraege = this.#eintraege.filter((x) => !weg.has(x));
    }
    return e;
  }

  offene() { return this.#eintraege.filter((e) => e.status === "offen"); }
  alle() { return this.#eintraege.slice(); }
  leeren() { this.#eintraege = []; }
}
