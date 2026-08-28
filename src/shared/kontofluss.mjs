/**
 * Blaubuch — Kontofluss.
 *
 * Bereitet einen Monat als Graph zwischen den Konten auf: Einnahmen
 * fliessen von aussen auf die Konten, Umbuchungen zwischen den Konten,
 * Ausgaben hinaus. Reine Funktionen ohne DOM — dieselbe Machart wie
 * fluss.mjs, damit sich alles hier vollstaendig testen laesst.
 *
 * Die Kantensemantik ist bewusst das Spiegelbild von totals():
 *
 *   - Umbuchung (istUmbuchung) → Kante Konto → Konto
 *   - alles andere mit Betrag  → Kante Konto → Senke „Ausgaben“
 *   - Einnahmen (ohne Durchlauf) → Kante Quelle „Einnahmen“ → Konto
 *   - Durchlauf und pausierte Zeilen erscheinen gar nicht
 *
 * So kann der Graph nie etwas anderes erzaehlen als die Zahlen darunter.
 */

import {
  totals, parseAmount, formatCHF, toRappen,
  kontoSaldo, istUmbuchung, alleZeilen,
  standardKlassen, klasseVon
} from "./budget.mjs";

/* Kennungen der beiden synthetischen Knoten. Konten tragen ihre eigene Id. */
export const QUELLE = "quelle";
export const SENKE = "senke";

export const KNOTEN_ART = { quelle: "quelle", konto: "konto", senke: "senke" };
export const KANTEN_ART = { einnahme: "einnahme", umbuchung: "umbuchung", ausgabe: "ausgabe" };

const rund = (n) => Math.round(n * 100) / 100;

/**
 * Schichtet die Konten entlang der Umbuchungskanten: wer nur empfaengt,
 * rueckt hinter seinen Geldgeber (Lohn → Spar → Depot ergibt 1, 2, 3).
 *
 * Longest-Path im Kleinen: alle starten auf 1, dann hebt jede Kante ihr
 * Ziel ueber ihre Quelle. Die Rundenzahl ist auf die Kontenzahl gedeckelt —
 * ein Kreis aus Umbuchungen (A→B→A im selben Monat) terminiert damit,
 * statt die Ebenen endlos zu treiben.
 *
 * @returns {Map<string, number>} Kontokennung → Ebene ≥ 1
 */
export function ebenen(kontoIds, kanten) {
  const ebene = new Map();
  for (const id of kontoIds) ebene.set(id, 1);

  const runden = Math.max(1, ebene.size);
  for (let runde = 0; runde < runden; runde++) {
    let geaendert = false;
    for (const k of kanten) {
      if (!ebene.has(k.von) || !ebene.has(k.nach)) continue;
      const ziel = ebene.get(k.von) + 1;
      if (ziel > ebene.get(k.nach)) {
        ebene.set(k.nach, ziel);
        geaendert = true;
      }
    }
    if (!geaendert) break;
  }
  return ebene;
}

/**
 * Knoten und Kanten eines Monats. Kanten sind je (von, nach)-Paar
 * aggregiert — drei Dauerauftraege aufs selbe Sparkonto sind eine Linie.
 *
 * Alle Konten erscheinen als Knoten, auch inaktive und solche ohne
 * Kanten: die Seite zeigt, was es gibt. `saldo` ist der gerechnete
 * Monatsendstand aus kontoSaldo().
 */
export function kontoflussDaten(state, month) {
  const klassen = state?.klassen ?? standardKlassen();
  const konten = state?.konten ?? [];
  const kontoIds = new Set(konten.map((k) => k.id));

  /* Aggregation je Kante. Schluessel: von + "→" + nach. */
  const sammle = (ziel, von, nach, betrag) => {
    const key = von + "→" + nach;
    ziel.set(key, { von, nach, wert: toRappen((ziel.get(key)?.wert ?? 0) + betrag) });
  };

  const einnahmen = new Map();
  for (const e of month?.einnahmen ?? []) {
    if (!e || e.aktiv === false || e.art === "durchlauf") continue;
    if (!kontoIds.has(e.konto)) continue;
    const betrag = parseAmount(e.betrag);
    if (betrag === 0) continue;
    sammle(einnahmen, QUELLE, e.konto, betrag);
  }

  const umbuchungen = new Map();
  const ausgaben = new Map();
  for (const z of alleZeilen(month)) {
    if (!z || z.aktiv === false) continue;
    if (klasseVon(klassen, z.klasse).wirkung === "durchlauf") continue;
    const betrag = parseAmount(z.betrag);
    if (betrag === 0) continue;
    if (istUmbuchung(z, kontoIds)) sammle(umbuchungen, z.vonKonto, z.nachKonto, betrag);
    else if (kontoIds.has(z.vonKonto)) sammle(ausgaben, z.vonKonto, SENKE, betrag);
  }
  /* Der Kartensaldo zaehlt als Ausgabe — wie in totals(). */
  for (const k of month?.kreditkarten ?? []) {
    const betrag = parseAmount(k?.betrag);
    if (betrag === 0 || !kontoIds.has(k?.vonKonto)) continue;
    sammle(ausgaben, k.vonKonto, SENKE, betrag);
  }

  /* Eine aggregierte Kante ohne positiven Wert laesst sich nicht
     zeichnen — negative Korrekturen loeschen ihre Linie aus. */
  const nurPositive = (m) => [...m.values()].filter((k) => k.wert > 0);
  const einnahmeKanten = nurPositive(einnahmen).map((k) => ({ ...k, art: KANTEN_ART.einnahme }));
  const umbuchungsKanten = nurPositive(umbuchungen).map((k) => ({ ...k, art: KANTEN_ART.umbuchung }));
  const ausgabeKanten = nurPositive(ausgaben).map((k) => ({ ...k, art: KANTEN_ART.ausgabe }));
  const kanten = [...einnahmeKanten, ...umbuchungsKanten, ...ausgabeKanten];

  const eb = ebenen(konten.map((k) => k.id), umbuchungsKanten);
  const maxKontoEbene = Math.max(1, ...eb.values());

  const knoten = [];
  if (einnahmeKanten.length > 0) {
    knoten.push({ id: QUELLE, name: "Einnahmen", art: KNOTEN_ART.quelle, saldo: null, aktiv: true, ebene: 0 });
  }
  for (const k of konten) {
    knoten.push({
      id: k.id, name: k.name, art: KNOTEN_ART.konto,
      saldo: kontoSaldo(state, month, k.id),
      aktiv: k.aktiv !== false,
      ebene: eb.get(k.id) ?? 1
    });
  }
  if (ausgabeKanten.length > 0) {
    knoten.push({ id: SENKE, name: "Ausgaben", art: KNOTEN_ART.senke, saldo: null, aktiv: true, ebene: maxKontoEbene + 1 });
  }

  return {
    knoten, kanten,
    summe: toRappen(kanten.reduce((s, k) => s + k.wert, 0)),
    leer: kanten.length === 0
  };
}

/** Kubische Mittellinie von einer rechten Knotenkante zur linken des Ziels. */
export function kantenPfad(x0, y0, x1, y1) {
  const xm = rund((x0 + x1) / 2);
  return ["M", rund(x0), rund(y0), "C", xm, rund(y0), xm, rund(y1), rund(x1), rund(y1)].join(" ");
}

/**
 * Koordinaten fuer den Graphen: Spalten sind Ebenen, links die Quelle,
 * rechts die Senke, dazwischen die Konten. Die Hoehe waechst mit der
 * vollsten Spalte, damit nichts uebereinanderfaellt.
 *
 * Kanten docken gefaechert an den Knotenkanten an — mehrere Linien am
 * selben Konto teilen sich die Kante, statt sich zu ueberdecken. Die
 * Staerke traegt den Betrag, linear zwischen minStaerke und maxStaerke
 * skaliert: so bleibt sie streng monoton, statt dass kleine Betraege
 * alle auf der Untergrenze zusammenfallen. `mx`/`my` ist der
 * Pfadmittelpunkt fuer die Betragsbeschriftung.
 */
export function kontenLayout(daten, mass = {}) {
  const {
    breite = 720, zeilenHoehe = 46, knotenB = 120, knotenH = 34,
    randX = 8, randY = 10, minStaerke = 1.5, maxStaerke = 10
  } = mass;

  /* Ebenen zu lueckenlosen Spalten zusammenschieben — fehlt die Quelle,
     beginnt die erste Kontenspalte trotzdem ganz links. */
  const stufen = [...new Set(daten.knoten.map((k) => k.ebene))].sort((a, b) => a - b);
  const spalteVon = new Map(stufen.map((e, i) => [e, i]));
  const spalten = Math.max(1, stufen.length);

  const jeSpalte = new Map();
  for (const k of daten.knoten) {
    const s = spalteVon.get(k.ebene);
    jeSpalte.set(s, (jeSpalte.get(s) ?? 0) + 1);
  }
  const dichteste = Math.max(1, ...jeSpalte.values());
  const hoehe = Math.max(220, dichteste * zeilenHoehe + 2 * randY);

  const schritt = spalten > 1 ? (breite - knotenB - 2 * randX) / (spalten - 1) : 0;
  const xVon = (spalte) => spalten > 1
    ? randX + spalte * schritt
    : (breite - knotenB) / 2;

  /* Knoten je Spalte stapeln, senkrecht zentriert. Reihenfolge ist die
     Reihenfolge im Stammsatz — deterministisch, kein Sortieren nach Wert. */
  const belegt = new Map();
  const knoten = daten.knoten.map((k) => {
    const spalte = spalteVon.get(k.ebene);
    const anzahl = jeSpalte.get(spalte);
    const index = belegt.get(spalte) ?? 0;
    belegt.set(spalte, index + 1);
    const oben = (hoehe - anzahl * zeilenHoehe) / 2;
    return {
      ...k,
      x: rund(xVon(spalte)),
      y: rund(oben + index * zeilenHoehe + (zeilenHoehe - knotenH) / 2),
      b: knotenB,
      h: knotenH
    };
  });
  const anKnoten = new Map(knoten.map((k) => [k.id, k]));

  /* Andockpunkte faechern: die k-te von n Kanten an einer Knotenkante
     sitzt bei h * (k+1) / (n+1). */
  const ausgang = new Map(), eingang = new Map();
  for (const kante of daten.kanten) {
    ausgang.set(kante.von, (ausgang.get(kante.von) ?? 0) + 1);
    eingang.set(kante.nach, (eingang.get(kante.nach) ?? 0) + 1);
  }
  const ausgangIndex = new Map(), eingangIndex = new Map();
  const maxWert = Math.max(1, ...daten.kanten.map((k) => k.wert));

  const kanten = daten.kanten.map((kante) => {
    const von = anKnoten.get(kante.von);
    const nach = anKnoten.get(kante.nach);
    const ai = ausgangIndex.get(kante.von) ?? 0;
    ausgangIndex.set(kante.von, ai + 1);
    const ei = eingangIndex.get(kante.nach) ?? 0;
    eingangIndex.set(kante.nach, ei + 1);

    const x0 = von.x + von.b;
    const y0 = von.y + von.h * (ai + 1) / (ausgang.get(kante.von) + 1);
    const x1 = nach.x;
    const y1 = nach.y + nach.h * (ei + 1) / (eingang.get(kante.nach) + 1);

    return {
      ...kante,
      d: kantenPfad(x0, y0, x1, y1),
      staerke: rund(minStaerke + (kante.wert / maxWert) * (maxStaerke - minStaerke)),
      mx: rund((x0 + x1) / 2),
      my: rund((y0 + y1) / 2),
      beschriftung: formatCHF(kante.wert)
    };
  });

  return { knoten, kanten, breite, hoehe, leer: daten.leer };
}

/* Der Renderer soll nichts selbst rechnen muessen. */
export { totals, formatCHF };
