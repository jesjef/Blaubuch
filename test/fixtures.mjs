/**
 * Testdaten. Frei erfunden und bewusst so gewaehlt, dass die Summen
 * von Hand nachrechenbar sind.
 *
 * Hier stehen keine echten Zahlen einer realen Person — Tests wandern in
 * das oeffentliche Repository und duerfen nichts verraten.
 */

import { SCHEMA_VERSION, emptyMonth } from "../src/shared/budget.mjs";

let n = 0;
const id = () => "t" + (++n);

/**
 * Ein Monat mit runden Zahlen:
 *   Erwerbseinkommen  5000 + 200  = 5200
 *   Bestand            300 + 100  =  400
 *   verfuegbare Mittel             = 5600
 *   Daueraufftraege   1500 + 300  = 1800   (300 davon gruen)
 *   Fixkosten          200 +  50  =  250
 *   Kreditkarten       400 + 100  =  500
 *   Rechnungen                     =  250
 *   Gesamtkosten                   = 2800
 *   Restwert                       = 2800
 */
export function beispielMonat() {
  const m = emptyMonth();
  m.einnahmen = { netto: 5000, spesen: 200, konto: 300, bar: 100, fremdschulden: 0 };
  m.dauerauftraege = [
    { id: id(), name: "Miete", betrag: 1500, tag: "rot" },
    { id: id(), name: "Sparplan", betrag: 300, tag: "gruen" }
  ];
  m.fixkosten = [
    { id: id(), name: "Krankenkasse", betrag: 200, tag: "rot" },
    { id: id(), name: "Handyabo", betrag: 50, tag: "rot" }
  ];
  m.kreditkarten = [
    { id: id(), name: "Hauptkarte", betrag: 400, limit: 0 },
    { id: id(), name: "Zweitkarte", betrag: 100, limit: 0 }
  ];
  m.ausgaben = [{ id: id(), name: "Zahnarzt", betrag: 250, tag: "rot" }];
  return m;
}

/** Zwei Monate, damit der Monatsvergleich etwas zu vergleichen hat. */
export function beispielState() {
  const juli = beispielMonat();
  juli.ausgaben = [];                 /* 250 weniger Kosten als August */

  return {
    version: SCHEMA_VERSION,
    updatedAt: "2026-08-01T00:00:00.000Z",
    currentMonth: "2026-08",
    months: { "2026-07": juli, "2026-08": beispielMonat() }
  };
}
