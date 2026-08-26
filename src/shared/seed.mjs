/**
 * Startzustand einer frischen Installation.
 *
 * Bewusst leer: Blaubuch bringt keine erfundenen Musterzahlen mit und
 * erst recht keine fremden. Wer das Programm startet, sieht den laufenden
 * Monat und traegt seine eigenen Werte ein.
 *
 * Wer aus einer bestehenden Datei kommt, nimmt „Daten einlesen …“.
 */

import { SCHEMA_VERSION, emptyMonth, standardKlassen } from "./budget.mjs";

/** Schluessel des laufenden Monats, z. B. "2026-08". */
export function currentMonthKey(datum = new Date()) {
  return datum.getFullYear() + "-" + String(datum.getMonth() + 1).padStart(2, "0");
}

export function createSeedState(datum = new Date()) {
  const key = currentMonthKey(datum);
  return {
    version: SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    currentMonth: key,
    /* Die vier mitgelieferten Klassifizierungen gehoeren von Anfang an in
       den Bestand — sonst stuenden sie erst nach dem ersten Einlesen drin. */
    klassen: standardKlassen(),
    months: { [key]: emptyMonth() }
  };
}
