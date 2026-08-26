/**
 * Testdaten. Frei erfunden und bewusst so gewaehlt, dass die Summen
 * von Hand nachrechenbar sind.
 *
 * Hier stehen keine echten Zahlen einer realen Person — Tests wandern in
 * das oeffentliche Repository und duerfen nichts verraten.
 */

import { SCHEMA_VERSION, emptyMonth, standardKlassen } from "../src/shared/budget.mjs";

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
  /* Die Konten kommen aus emptyMonth() und heissen dort schon richtig —
     hier werden nur die Betraege gesetzt. */
  const betrag = (name, wert) => { m.konten.find((k) => k.name === name).betrag = wert; };
  betrag("Nettolohn", 5000);
  betrag("Spesen", 200);
  betrag("Kontostand", 300);
  betrag("Bargeld", 100);

  m.dauerauftraege = [
    { id: id(), name: "Miete", betrag: 1500, klasse: "ausgaben" },
    { id: id(), name: "Sparplan", betrag: 300, klasse: "investition" }
  ];
  m.fixkosten = [
    { id: id(), name: "Krankenkasse", betrag: 200, klasse: "ausgaben" },
    { id: id(), name: "Handyabo", betrag: 50, klasse: "ausgaben" }
  ];
  m.kreditkarten = [
    { id: id(), name: "Hauptkarte", betrag: 400, limit: 0 },
    { id: id(), name: "Zweitkarte", betrag: 100, limit: 0 }
  ];
  m.ausgaben = [{ id: id(), name: "Zahnarzt", betrag: 250, klasse: "ausgaben" }];
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
    klassen: standardKlassen(),
    months: { "2026-07": juli, "2026-08": beispielMonat() }
  };
}

/**
 * Betrag eines Kontos lesen oder setzen — Bequemlichkeit fuer die Tests.
 * Seit Fassung 5 sind Einnahmen eine Liste; ohne diesen Helfer stuende in
 * jedem Test dieselbe Suche nach dem Namen.
 */
export function kontoBetrag(monat, name, wert) {
  const k = (monat.konten ?? []).find((x) => x.name === name);
  if (!k) return undefined;
  if (wert !== undefined) k.betrag = wert;
  return k.betrag;
}
