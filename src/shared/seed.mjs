/**
 * Startzustand einer frischen Installation.
 *
 * Bewusst leer: Blaubuch bringt keine erfundenen Musterzahlen mit und
 * erst recht keine fremden. Wer das Programm startet, sieht den laufenden
 * Monat und traegt seine eigenen Werte ein.
 *
 * Wer aus einer bestehenden Datei kommt, nimmt „Daten einlesen …“.
 */

import { SCHEMA_VERSION, emptyMonth, standardKlassen, standardKonten } from "./budget.mjs";

/** Schluessel des laufenden Monats, z. B. "2026-08". */
export function currentMonthKey(datum = new Date()) {
  return datum.getFullYear() + "-" + String(datum.getMonth() + 1).padStart(2, "0");
}

export function createSeedState(datum = new Date()) {
  const key = currentMonthKey(datum);

  /* Klassifizierungen und Konten gehoeren von Anfang an in den Stammsatz.
     Ohne Konto liesse sich keine Zeile buchen, und ohne Klassifizierung
     nicht einordnen — beides waere kein benutzbarer Startzustand. Die
     Namen sind Bezeichnungen des Programms, keine erfundenen Zahlen. */
  const state = {
    version: SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    currentMonth: key,
    klassen: standardKlassen(),
    konten: standardKonten(),
    months: {}
  };
  state.months[key] = emptyMonth(state);
  return state;
}
