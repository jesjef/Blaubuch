/**
 * Testdaten. Frei erfunden und bewusst so gewaehlt, dass die Summen
 * von Hand nachrechenbar sind.
 *
 * Hier stehen keine echten Zahlen einer realen Person — Tests wandern in
 * das oeffentliche Repository und duerfen nichts verraten.
 *
 * Seit Fassung 6 braucht ein Monat seinen Stammsatz: Konten und
 * Klassifizierungen liegen dort, nicht im Monat. Deshalb liefert
 * `beispiel()` beides zusammen — ein Monat allein waere nicht rechenbar.
 */

import { SCHEMA_VERSION, standardKlassen, uid } from "../src/shared/budget.mjs";

let n = 0;
const id = () => "t" + (++n);

/* Feste Kennungen, damit Tests sie direkt ansprechen koennen. */
export const KONTO_HAUPT = "k-haupt";
export const KONTO_BAR = "k-bar";

/**
 * Ein Monat mit runden Zahlen:
 *   Erwerbseinkommen  5000 + 200  = 5200
 *   Bestand            300 + 100  =  400
 *   verfuegbare Mittel             = 5600
 *   Daueraufftraege   1500 + 300  = 1800   (300 davon Investition)
 *   Fixkosten          200 +  50  =  250
 *   Kreditkarten       400 + 100  =  500
 *   Ausgaben                       =  250
 *   Gesamtkosten                   = 2800
 *   Restwert                       = 2800
 */
export function beispielMonat() {
  return {
    anfangsbestaende: { [KONTO_HAUPT]: 300, [KONTO_BAR]: 100 },
    einnahmen: [
      { id: id(), name: "Nettolohn", betrag: 5000, art: "erwerb", konto: KONTO_HAUPT, aktiv: true, faelligAm: null, notiz: "" },
      { id: id(), name: "Spesen", betrag: 200, art: "erwerb", konto: KONTO_HAUPT, aktiv: true, faelligAm: null, notiz: "" }
    ],
    dauerauftraege: [
      zeile("Miete", 1500, "ausgaben"),
      zeile("Sparplan", 300, "investition")
    ],
    fixkosten: [
      zeile("Krankenkasse", 200, "ausgaben"),
      zeile("Handyabo", 50, "ausgaben")
    ],
    kreditkarten: [
      { id: id(), name: "Hauptkarte", betrag: 400, limit: 0, vonKonto: KONTO_HAUPT, notiz: "" },
      { id: id(), name: "Zweitkarte", betrag: 100, limit: 0, vonKonto: KONTO_HAUPT, notiz: "" }
    ],
    ausgaben: [zeile("Zahnarzt", 250, "ausgaben")]
  };
}

function zeile(name, betrag, klasse) {
  return {
    id: id(), name, betrag, klasse,
    vonKonto: KONTO_HAUPT, nachKonto: null,
    aktiv: true, faelligAm: null, laeuftBis: null, notiz: ""
  };
}

/** Zwei Monate, damit der Monatsvergleich etwas zu vergleichen hat. */
export function beispielState() {
  const juli = beispielMonat();
  juli.ausgaben = [];                 /* 250 weniger Kosten als August */

  return {
    version: SCHEMA_VERSION,
    updatedAt: "2026-08-01T00:00:00.000Z",
    currentMonth: "2026-08",
    klassen: standardKlassen(),
    konten: [
      { id: KONTO_HAUPT, name: "Kontostand", institut: "", aktiv: true },
      { id: KONTO_BAR, name: "Bargeld", institut: "", aktiv: true }
    ],
    months: { "2026-07": juli, "2026-08": beispielMonat() }
  };
}

/**
 * Stammsatz und Monat in einem Griff — seit Fassung 6 rechnet `totals`
 * gegen beides, ein Monat allein reicht nicht mehr.
 */
export function beispiel(key = "2026-08") {
  const state = beispielState();
  return { state, monat: state.months[key], vormonat: state.months["2026-07"] };
}

/**
 * Betrag einer Einnahmezeile lesen oder setzen — Bequemlichkeit fuer die
 * Tests, damit nicht in jedem Test dieselbe Suche nach dem Namen steht.
 */
export function einnahmeBetrag(monat, name, wert) {
  const e = (monat.einnahmen ?? []).find((x) => x.name === name);
  if (!e) return undefined;
  if (wert !== undefined) e.betrag = wert;
  return e.betrag;
}

/** Anfangsbestand eines Kontos lesen oder setzen. */
export function anfangsbestand(monat, kontoId, wert) {
  if (wert !== undefined) monat.anfangsbestaende[kontoId] = wert;
  return monat.anfangsbestaende[kontoId];
}

/** Eine zusaetzliche Einnahmezeile anhaengen. */
export function fuegeEinnahmeHinzu(monat, name, betrag, art = "sonstige", konto = KONTO_HAUPT) {
  monat.einnahmen.push({ id: uid(), name, betrag, art, konto, aktiv: true, faelligAm: null, notiz: "" });
  return monat.einnahmen[monat.einnahmen.length - 1];
}
