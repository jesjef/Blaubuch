/**
 * Blaubuch — Jahresüberblick und Liquiditätsverlauf.
 *
 * Zwei Auswertungen, die keine neuen Zahlen erfinden:
 *
 *  - Der **Jahresüberblick** summiert, was `totals()` je Monat ohnehin
 *    rechnet. Die Kosten werden nach *Wirkung* gestapelt, damit sichtbar
 *    wird, wie sich „weg" zu „liegt woanders" über das Jahr verschiebt.
 *  - Der **Liquiditätsverlauf** verteilt die Beträge eines Monats auf
 *    seine Tage. Er beantwortet die Frage, die eine Monatssumme nicht
 *    beantworten kann: reicht das Geld auch *zwischendurch*, wenn der
 *    Dauerauftrag vor dem Lohn läuft?
 *
 * Zwei Entscheide, die man kennen muss:
 *
 *  1. **Umbuchungen bewegen den Verlauf nicht.** Geld, das nur das Konto
 *     wechselt, hat das Vermögen nicht verlassen — dieselbe Regel wie in
 *     `totals()`. Wer die Liquidität *eines einzelnen Kontos* sehen will,
 *     braucht etwas anderes; hier geht es um die Gesamtlage.
 *  2. **Ohne Tag heisst Monatsanfang.** Eine undatierte Zeile lässt sich
 *     nicht einordnen, und die vorsichtige Annahme ist, dass sie früh
 *     fällig wird — sonst zeigte der Tiefpunkt eine Sicherheit, die es
 *     nicht gibt. `ohneTag` meldet, wie viele Zeilen das betrifft, damit
 *     die Oberfläche es sagen kann.
 *
 * Reine Funktionen, kein DOM — dieselbe Machart wie `fluss.mjs`.
 */

import {
  totals, parseAmount, toRappen, monthLabel, sortedMonths,
  alleZeilen, istUmbuchung, standardKlassen, klasseVon
} from "./budget.mjs";

const rund = (n) => Math.round(n * 100) / 100;

/** Der letzte Tag, den ein Verlauf kennt. Monate sind hier gleich lang. */
export const TAGE_IM_MONAT = 31;

/* ------------------------------------------------------------------ *
 * Jahresüberblick
 * ------------------------------------------------------------------ */

/** Die Jahre, zu denen es überhaupt Monate gibt — aufsteigend. */
export function jahre(state) {
  const gesehen = new Set(sortedMonths(state ?? { months: {} }).map((k) => k.slice(0, 4)));
  return [...gesehen].sort();
}

/**
 * Ein Jahr als Reihe von Monaten. Fehlende Monate erscheinen **nicht** als
 * Null: eine Null behauptet „nichts ausgegeben", ein fehlender Monat sagt
 * „nicht erfasst". Das ist nicht dasselbe.
 */
export function jahresDaten(state, jahr) {
  const klassen = state?.klassen ?? standardKlassen();
  const keys = sortedMonths(state ?? { months: {} }).filter((k) => k.startsWith(jahr + "-"));

  const monate = keys.map((key) => {
    const t = totals(state, state.months[key]);

    /* Die Kosten nach Wirkung schneiden. `durchlauf` ist keine Kostenart
       und taucht deshalb nicht auf; der Kartensaldo steckt bereits über
       die Standardklasse in `byKlasse`. */
    const byWirkung = { verloren: 0, erhalten: 0 };
    for (const k of klassen) {
      if (k.wirkung === "durchlauf") continue;
      byWirkung[k.wirkung] = toRappen((byWirkung[k.wirkung] ?? 0) + (t.byKlasse[k.id] ?? 0));
    }

    return {
      key,
      label: monthLabel(key),
      kurz: monthLabel(key).slice(0, 3),
      einnahmen: t.einnahmen,
      kosten: t.kosten,
      rest: t.rest,
      erwerb: t.erwerb,
      umgebucht: t.umgebucht,
      byWirkung,
      byKlasse: t.byKlasse
    };
  });

  const summiere = (feld) => toRappen(monate.reduce((s, m) => s + m[feld], 0));
  const summe = {
    einnahmen: summiere("einnahmen"),
    kosten: summiere("kosten"),
    rest: summiere("rest"),
    erwerb: summiere("erwerb")
  };
  const teiler = Math.max(1, monate.length);
  const schnitt = Object.fromEntries(
    Object.entries(summe).map(([k, v]) => [k, rund(v / teiler)])
  );

  return {
    jahr,
    monate,
    summe,
    schnitt,
    /* Die höchste Säule bestimmt den Massstab — Einnahmen und Kosten
       teilen ihn, sonst liessen sich die beiden Reihen nicht vergleichen. */
    max: Math.max(0, ...monate.map((m) => Math.max(m.einnahmen, m.kosten))),
    leer: monate.length === 0
  };
}

/** Summe und Durchschnitt je Klassifizierung, absteigend nach Summe. */
export function jahresKlassen(daten, klassen) {
  const teiler = Math.max(1, daten.monate.length);
  return (klassen ?? [])
    .map((k) => {
      const summe = toRappen(daten.monate.reduce((s, m) => s + (m.byKlasse[k.id] ?? 0), 0));
      return {
        id: k.id, name: k.name, farbe: k.farbe, wirkung: k.wirkung,
        summe, schnitt: rund(summe / teiler)
      };
    })
    .filter((r) => r.summe > 0)
    .sort((a, b) => b.summe - a.summe);
}

/**
 * Geometrie des Balkenbands: je Monat eine Einnahmesäule und daneben eine
 * Kostensäule, die nach Wirkung gestapelt ist. Der Restwert läuft als
 * Linie darüber — er ist eine Differenz, keine dritte Säule.
 */
export function jahresLayout(daten, mass = {}) {
  const {
    breite = 720, hoehe = 240, randOben = 12, randUnten = 22,
    randX = 10, luecke = 6
  } = mass;

  if (daten.leer) return { saeulen: [], restPfad: "", breite, hoehe, leer: true, nullY: hoehe - randUnten };

  const nutzHoehe = hoehe - randOben - randUnten;
  const feld = (breite - 2 * randX) / daten.monate.length;
  const saeulenBreite = Math.max(4, (feld - luecke) / 2);
  const boden = hoehe - randUnten;
  const skala = (wert) => (daten.max > 0 ? (wert / daten.max) * nutzHoehe : 0);

  /* Der Restwert bekommt seine eigene Skala: er ist meist viel kleiner als
     die Säulen und läge sonst als flache Linie auf dem Boden. */
  const restMax = Math.max(1, ...daten.monate.map((m) => Math.abs(m.rest)));

  const saeulen = daten.monate.map((m, i) => {
    const x = randX + i * feld;
    const einnahmeH = skala(m.einnahmen);

    /* Kostensäule von unten nach oben stapeln: erst was weg ist, darüber
       was nur woanders liegt. */
    const kostenX = x + saeulenBreite + luecke;
    const stapel = [];
    let unten = boden;
    for (const wirkung of ["verloren", "erhalten"]) {
      const wert = m.byWirkung[wirkung] ?? 0;
      if (wert <= 0) continue;
      const h = skala(wert);
      unten -= h;
      stapel.push({ wirkung, wert, x: kostenX, breite: rund(saeulenBreite), y: rund(unten), h: rund(h) });
    }
    /* Von oben nach unten ausliefern, damit „ohne Lücke aufeinander"
       auch als Reihenfolge stimmt. */
    stapel.reverse();

    return {
      key: m.key, label: m.label, kurz: m.kurz,
      x: rund(x), breite: rund(saeulenBreite),
      mitte: rund(x + feld / 2 - luecke / 2),
      einnahme: { wert: m.einnahmen, x: rund(x), breite: rund(saeulenBreite), y: rund(boden - einnahmeH), h: rund(einnahmeH) },
      kosten: { wert: m.kosten, x: rund(kostenX), breite: rund(saeulenBreite) },
      stapel,
      rest: {
        wert: m.rest,
        x: rund(x + feld / 2 - luecke / 2),
        y: rund(boden - (m.rest / restMax) * nutzHoehe)
      }
    };
  });

  const restPfad = saeulen
    .map((s, i) => (i === 0 ? "M " : "L ") + s.rest.x + " " + s.rest.y)
    .join(" ");

  return { saeulen, restPfad, breite, hoehe, nullY: boden, restMax, leer: false };
}

/* ------------------------------------------------------------------ *
 * Liquiditätsverlauf
 * ------------------------------------------------------------------ */

/**
 * Der Stand über die Tage eines Monats.
 *
 * Beginnt beim Anfangsbestand und endet exakt auf dem Restwert — sonst
 * erzählte die Kurve etwas anderes als die Kennzahl darüber.
 */
export function liquiditaet(state, month) {
  const klassen = state?.klassen ?? standardKlassen();
  const kontoIds = new Set((state?.konten ?? []).map((k) => k.id));
  const t = totals(state, month);

  /* Tag 1..31, Index 0 bleibt leer. */
  const bewegung = new Array(TAGE_IM_MONAT + 1).fill(0);
  let ohneTag = 0;
  let bewegt = false;

  const buche = (tag, betrag) => {
    if (betrag === 0) return;
    const ziel = tag ?? 1;
    if (tag == null) ohneTag += 1;
    bewegung[ziel] = toRappen(bewegung[ziel] + betrag);
    bewegt = true;
  };

  for (const e of month?.einnahmen ?? []) {
    if (!e || e.aktiv === false || e.art === "durchlauf") continue;
    buche(e.faelligAm, parseAmount(e.betrag));
  }

  for (const z of alleZeilen(month)) {
    if (!z || z.aktiv === false) continue;
    if (klasseVon(klassen, z.klasse).wirkung === "durchlauf") continue;
    /* Eine Umbuchung wechselt nur das Konto — die Gesamtlage bleibt. */
    if (istUmbuchung(z, kontoIds)) continue;
    buche(z.faelligAm, -parseAmount(z.betrag));
  }

  /* Karten tragen keinen Tag; sie zählen wie alles Undatierte an den Anfang. */
  for (const k of month?.kreditkarten ?? []) {
    buche(null, -parseAmount(k?.betrag));
  }

  if (!bewegt) {
    return { start: t.bestand, ende: t.bestand, punkte: [], tiefster: null, ohneTag: 0, leer: true };
  }

  let stand = t.bestand;
  const punkte = [];
  let tiefster = null;
  for (let tag = 1; tag <= TAGE_IM_MONAT; tag++) {
    stand = toRappen(stand + bewegung[tag]);
    punkte.push({ tag, stand });
    if (!tiefster || stand < tiefster.stand) tiefster = { tag, stand };
  }

  return {
    start: t.bestand,
    ende: punkte[punkte.length - 1].stand,
    punkte,
    tiefster,
    ohneTag,
    leer: false
  };
}

/**
 * Geometrie der Kurve. Die Skala fasst immer die Null mit ein — eine
 * Kurve, die im Minus verläuft, muss das auch zeigen.
 */
export function liquiditaetLayout(daten, mass = {}) {
  const { breite = 720, hoehe = 160, randOben = 12, randUnten = 18, randX = 10 } = mass;

  if (daten.leer) {
    return { pfad: "", punkte: [], tiefster: null, breite, hoehe, nullY: hoehe - randUnten, leer: true };
  }

  const werte = daten.punkte.map((p) => p.stand);
  const oben = Math.max(0, ...werte);
  const unten = Math.min(0, ...werte);
  const spanne = Math.max(1, oben - unten);
  const nutzHoehe = hoehe - randOben - randUnten;
  const schritt = (breite - 2 * randX) / Math.max(1, daten.punkte.length - 1);

  const y = (wert) => rund(randOben + ((oben - wert) / spanne) * nutzHoehe);
  const punkte = daten.punkte.map((p, i) => ({ ...p, x: rund(randX + i * schritt), y: y(p.stand) }));

  const pfad = punkte.map((p, i) => (i === 0 ? "M " : "L ") + p.x + " " + p.y).join(" ");
  const tief = punkte.find((p) => p.tag === daten.tiefster.tag);

  return {
    pfad,
    punkte,
    tiefster: { tag: daten.tiefster.tag, stand: daten.tiefster.stand, x: tief.x, y: tief.y },
    breite,
    hoehe,
    nullY: y(0),
    /* Nur zeichnen, wenn die Null im Bild liegt — sonst wäre die Linie
       eine Behauptung über den Rand hinaus. */
    zeigeNull: unten < 0,
    leer: false
  };
}
