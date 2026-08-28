/**
 * Blaubuch — Gruppen und Untersummen in den Listen.
 *
 * Eine lange Liste sagt, was gebucht wurde; sie sagt nicht, wofür das
 * Geld geht. Die Gruppierung nach Klassifizierung beantwortet das, ohne
 * eine zweite Rechnung aufzumachen:
 *
 * **Die Untersummen ergeben zusammen genau die Summe im Kartenkopf.**
 *
 * Deshalb gelten hier dieselben Regeln wie in `totals()`: Durchlaufgeld,
 * pausierte Zeilen und Umbuchungen zählen nicht mit. Sie verschwinden
 * aber nicht — sie stehen weiter in ihrer Gruppe, und `ausgenommen`
 * sagt, wie viele es sind. Wegzulassen, was nicht zählt, würde eine
 * Zeile unsichtbar machen, die der Benutzer selbst erfasst hat.
 */

import {
  parseAmount, toRappen, istUmbuchung, klasseVon, standardKlassen
} from "./budget.mjs";

/**
 * Die Zeilen einer Liste nach Klassifizierung gruppiert, absteigend nach
 * Untersumme.
 *
 * @param {object} state
 * @param {object} month
 * @param {"dauerauftraege"|"fixkosten"|"ausgaben"} liste
 * @returns {{id: string, name: string, farbe: string, wirkung: string,
 *            zeilen: object[], summe: number, ausgenommen: number}[]}
 */
export function gruppen(state, month, liste) {
  const klassen = state?.klassen ?? standardKlassen();
  const kontoIds = new Set((state?.konten ?? []).map((k) => k.id));
  const zeilen = month?.[liste] ?? [];

  const nach = new Map();
  for (const z of zeilen) {
    if (!z) continue;
    const klasse = klasseVon(klassen, z.klasse);
    if (!nach.has(klasse.id)) {
      nach.set(klasse.id, {
        id: klasse.id, name: klasse.name, farbe: klasse.farbe, wirkung: klasse.wirkung,
        zeilen: [], summe: 0, ausgenommen: 0
      });
    }
    const gruppe = nach.get(klasse.id);
    gruppe.zeilen.push(z);

    /* Dieselben drei Ausnahmen wie in totals() — Wort für Wort. */
    const zaehlt = z.aktiv !== false
      && klasse.wirkung !== "durchlauf"
      && !istUmbuchung(z, kontoIds);

    if (zaehlt) gruppe.summe = toRappen(gruppe.summe + parseAmount(z.betrag));
    else gruppe.ausgenommen += 1;
  }

  return [...nach.values()].sort((a, b) => b.summe - a.summe);
}
