/**
 * Blaubuch — Geldfluss.
 *
 * Bereitet einen Monat für die beiden Darstellungen auf und rechnet ihre
 * Geometrie aus. Reine Funktionen: kein DOM, kein SVG-Element, nur Zahlen
 * und Pfadangaben — damit lässt sich das hier vollständig testen.
 *
 * Farbwahl (nach der Datenvisualisierungs-Methode, Prüfprotokoll in
 * SECURITY.md nicht nötig, aber hier festgehalten):
 *
 *  - Die vier Kostenblöcke sind *geordnete Grössen*, keine gleichrangigen
 *    Kategorien. Sie bekommen deshalb einen sequenziellen Ein-Ton-Verlauf,
 *    nach Betrag sortiert: der grösste Block am dunkelsten. Die Helligkeit
 *    trägt die Information, was auch bei Farbsehschwäche funktioniert.
 *  - Der Restwert ist kein fünfter Kostenblock, sondern ein Zustand
 *    („was bleibt“). Er bekommt die reservierte Statusfarbe Grün.
 *  - Eine Deckungslücke bekommt Rot — ebenfalls Status, nicht Kategorie.
 *  - Jeder Knoten und jedes Segment ist zusätzlich beschriftet. Identität
 *    hängt nie allein an der Farbe.
 */

import { totals, parseAmount, formatCHF } from "./budget.mjs";

/** Rollen bestimmen die Farbe. "stufe0…3" sind die Verlaufsstufen. */
export const ROLLE = {
  einkommen: "einkommen",
  bestand: "bestand",
  geliehen: "geliehen",
  luecke: "luecke",
  kosten: "kosten",
  rest: "rest"
};

/**
 * Woher die verfügbaren Mittel kommen.
 * Ist der Monat im Minus, erscheint die Differenz als Deckungslücke —
 * sonst ginge die Bilanz im Bild nicht auf.
 */
export function herkunft(state, month) {
  const t = totals(state, month);
  const aus = [];

  if (t.erwerb > 0) aus.push({ key: "erwerb", name: "Einkommen", wert: t.erwerb, rolle: ROLLE.einkommen });
  if (t.bestand > 0) aus.push({ key: "bestand", name: "Bestand", wert: t.bestand, rolle: ROLLE.bestand });
  if (t.sonstige > 0) aus.push({ key: "sonstige", name: "Sonstige Mittel", wert: t.sonstige, rolle: ROLLE.bestand });
  if (t.geliehen > 0) aus.push({ key: "geliehen", name: "Geliehen", wert: t.geliehen, rolle: ROLLE.geliehen });
  if (t.rest < 0) aus.push({ key: "luecke", name: "Deckungslücke", wert: -t.rest, rolle: ROLLE.luecke });

  return aus;
}

/**
 * Wohin die Mittel gehen: die Kostenblöcke absteigend nach Betrag,
 * danach der Restwert. Die Reihenfolge ist zugleich die Farbreihenfolge.
 */
export function verwendung(state, month) {
  const t = totals(state, month);

  const bloecke = [
    { key: "da", name: "Daueraufträge", wert: t.da },
    { key: "fix", name: "Fixkosten", wert: t.fix },
    { key: "kk", name: "Kreditkarten", wert: t.kk },
    { key: "re", name: "Ausgaben", wert: t.re }
  ]
    .filter((b) => b.wert > 0)
    .sort((a, b) => b.wert - a.wert)
    .map((b, i) => ({ ...b, rolle: ROLLE.kosten, stufe: i }));

  if (t.rest > 0) {
    bloecke.push({ key: "rest", name: "Restwert", wert: t.rest, rolle: ROLLE.rest, stufe: null });
  }
  return bloecke;
}

/** Beide Seiten plus die Summe, die sie verbindet. */
export function flussDaten(state, month) {
  const links = herkunft(state, month);
  const rechts = verwendung(state, month);
  const summe = links.reduce((s, x) => s + x.wert, 0);
  return { links, rechts, summe, leer: summe <= 0 || rechts.length === 0 };
}

/* ------------------------------------------------------------------ *
 * Sankey
 * ------------------------------------------------------------------ */

const rund = (n) => Math.round(n * 100) / 100;

/**
 * Ordnet eine Liste als senkrechten Stapel an: jeder Eintrag bekommt
 * eine Höhe im Verhältnis zu seinem Betrag, dazwischen bleibt eine Lücke.
 */
function stapel(eintraege, { oben, hoehe, summe, luecke }) {
  const gesamtLuecke = luecke * Math.max(0, eintraege.length - 1);
  const nutzbar = Math.max(1, hoehe - gesamtLuecke);
  let y = oben;
  return eintraege.map((e) => {
    const h = Math.max(1, (e.wert / summe) * nutzbar);
    const knoten = { ...e, y: rund(y), h: rund(h) };
    y += h + luecke;
    return knoten;
  });
}

/** Bandpfad zwischen zwei senkrechten Kanten, als weiche Kurve. */
export function bandPfad(x0, y0, x1, y1, h0, h1) {
  const xm = (x0 + x1) / 2;
  return [
    "M", rund(x0), rund(y0),
    "C", rund(xm), rund(y0), rund(xm), rund(y1), rund(x1), rund(y1),
    "L", rund(x1), rund(y1 + h1),
    "C", rund(xm), rund(y1 + h1), rund(xm), rund(y0 + h0), rund(x0), rund(y0 + h0),
    "Z"
  ].join(" ");
}

/**
 * Sankey-Geometrie: Quellen links, ein Sammelknoten in der Mitte,
 * Verwendungen rechts. Der Sammelknoten verhindert die falsche Aussage,
 * eine bestimmte Quelle habe einen bestimmten Posten bezahlt.
 */
export function sankeyLayout(daten, mass = {}) {
  const {
    breite = 360, hoehe = 250,
    randOben = 8, randUnten = 8,
    knotenBreite = 7, beschriftung = 86, luecke = 5
  } = mass;

  if (daten.leer) return { knoten: [], baender: [], breite, hoehe };

  const nutzHoehe = hoehe - randOben - randUnten;
  const xQuelle = beschriftung;
  const xNabe = (breite - knotenBreite) / 2;
  const xZiel = breite - beschriftung - knotenBreite;

  const links = stapel(daten.links, { oben: randOben, hoehe: nutzHoehe, summe: daten.summe, luecke })
    .map((k) => ({ ...k, x: xQuelle, breite: knotenBreite, seite: "links" }));
  const rechts = stapel(daten.rechts, { oben: randOben, hoehe: nutzHoehe, summe: daten.summe, luecke })
    .map((k) => ({ ...k, x: xZiel, breite: knotenBreite, seite: "rechts" }));

  const nabe = {
    key: "nabe", name: "Verfügbare Mittel", wert: daten.summe, rolle: "nabe",
    x: xNabe, y: randOben, h: nutzHoehe, breite: knotenBreite, seite: "mitte"
  };

  /* Die Nabe wird von oben nach unten belegt — in derselben Reihenfolge
     wie die Stapel, damit sich die Bänder nicht kreuzen. */
  const baender = [];
  let yNabeLinks = randOben;
  for (const k of links) {
    const h = (k.wert / daten.summe) * nutzHoehe;
    baender.push({
      key: "in-" + k.key, rolle: k.rolle, wert: k.wert,
      d: bandPfad(k.x + knotenBreite, k.y, xNabe, yNabeLinks, k.h, h)
    });
    yNabeLinks += h;
  }

  let yNabeRechts = randOben;
  for (const k of rechts) {
    const h = (k.wert / daten.summe) * nutzHoehe;
    baender.push({
      key: "aus-" + k.key, rolle: k.rolle, stufe: k.stufe, wert: k.wert,
      d: bandPfad(xNabe + knotenBreite, yNabeRechts, k.x, k.y, h, k.h)
    });
    yNabeRechts += h;
  }

  return { knoten: [...links, nabe, ...rechts], baender, breite, hoehe, beschriftung };
}

/**
 * Verteilt Beschriftungen so, dass sie sich nicht überdecken.
 *
 * Kleine Posten ergeben dünne Bänder — 85 Fr. von 5'500 Fr. sind gut drei
 * Einheiten hoch. Zwei Textzeilen brauchen aber rund 22. Die Bänder selbst
 * zu vergrössern wäre gelogen, also bleibt die Geometrie exakt und nur der
 * Text rückt beiseite; eine Führungslinie hält ihn an seinem Knoten.
 *
 * Verfahren: erst nach unten schieben, bis der Mindestabstand überall
 * eingehalten ist, dann von unten zurück, falls unten kein Platz mehr war.
 *
 * Bezugspunkt ist die Grundlinie der Namenszeile. Darunter hängt die
 * Betragszeile — der Mindestabstand und die Ränder müssen den ganzen
 * zweizeiligen Block fassen, nicht nur die erste Zeile.
 *
 * @returns {{key: string, y: number, verschoben: boolean, ziel: number}[]}
 */
export function beschriftungsLayout(
  knoten,
  { hoehe = 250, mindestAbstand = 24, randOben = 10, randUnten = 16 } = {}
) {
  if (knoten.length === 0) return [];

  const marken = knoten.map((k) => {
    const ziel = k.y + k.h / 2;
    return { key: k.key, ziel, y: ziel };
  });

  /* Nach unten auffächern. */
  for (let i = 1; i < marken.length; i++) {
    marken[i].y = Math.max(marken[i].y, marken[i - 1].y + mindestAbstand);
  }

  /* Ist unten der Rand überschritten, von hinten zurückschieben. */
  const unten = hoehe - randUnten;
  if (marken[marken.length - 1].y > unten) {
    marken[marken.length - 1].y = unten;
    for (let i = marken.length - 2; i >= 0; i--) {
      marken[i].y = Math.min(marken[i].y, marken[i + 1].y - mindestAbstand);
    }
  }

  /* Oben genauso — bei sehr vielen Posten kann es beidseitig eng werden. */
  if (marken[0].y < randOben) {
    marken[0].y = randOben;
    for (let i = 1; i < marken.length; i++) {
      marken[i].y = Math.max(marken[i].y, marken[i - 1].y + mindestAbstand);
    }
  }

  return marken.map((m) => ({
    key: m.key,
    y: rund(m.y),
    ziel: rund(m.ziel),
    verschoben: Math.abs(m.y - m.ziel) > 1
  }));
}

/* ------------------------------------------------------------------ *
 * Kuchen
 * ------------------------------------------------------------------ */

const punkt = (cx, cy, r, winkel) => [
  rund(cx + r * Math.cos(winkel)),
  rund(cy + r * Math.sin(winkel))
];

/** Ringsegment als Pfad. Winkel im Bogenmass, 0 = rechts, im Uhrzeigersinn. */
export function ringPfad(cx, cy, rAussen, rInnen, von, bis) {
  const gross = bis - von > Math.PI ? 1 : 0;
  const [ax, ay] = punkt(cx, cy, rAussen, von);
  const [bx, by] = punkt(cx, cy, rAussen, bis);
  const [cx2, cy2] = punkt(cx, cy, rInnen, bis);
  const [dx, dy] = punkt(cx, cy, rInnen, von);
  return [
    "M", ax, ay,
    "A", rAussen, rAussen, 0, gross, 1, bx, by,
    "L", cx2, cy2,
    "A", rInnen, rInnen, 0, gross, 0, dx, dy,
    "Z"
  ].join(" ");
}

/**
 * Ringdiagramm über dieselbe Verwendung wie der Sankey — beide Ansichten
 * zeigen denselben Sachverhalt, nur anders geschnitten.
 *
 * Beginnt oben (12 Uhr) und läuft im Uhrzeigersinn. Zwischen den Segmenten
 * bleibt eine kleine Lücke stehen, damit die Flächen sich nicht berühren.
 */
export function kuchenLayout(daten, mass = {}) {
  const { cx = 80, cy = 125, rAussen = 68, rInnen = 42, luecke = 0.02 } = mass;
  const gesamt = daten.rechts.reduce((s, x) => s + x.wert, 0);
  if (daten.leer || gesamt <= 0) return { segmente: [], gesamt: 0, cx, cy, rAussen, rInnen };

  const start = -Math.PI / 2;
  const echteLuecke = daten.rechts.length > 1 ? luecke : 0;
  let winkel = start;

  const segmente = daten.rechts.map((e) => {
    const anteil = e.wert / gesamt;
    /* Voller Kreis darf nicht als Nullbogen entarten. */
    const spanne = Math.min(anteil * Math.PI * 2, Math.PI * 2 - 0.001);
    const von = winkel + echteLuecke / 2;
    const bis = winkel + spanne - echteLuecke / 2;
    winkel += spanne;
    return {
      ...e,
      anteil,
      prozent: Math.round(anteil * 1000) / 10,
      d: ringPfad(cx, cy, rAussen, rInnen, von, Math.max(von + 0.001, bis))
    };
  });

  return { segmente, gesamt, cx, cy, rAussen, rInnen };
}

/** Kurzfassung für die Mitte des Rings. */
export function kuchenMitte(daten) {
  const gesamt = daten.rechts.reduce((s, x) => s + x.wert, 0);
  return { betrag: formatCHF(gesamt), beschriftung: "verteilt" };
}

/** Beträge für Beschriftungen — hier gebündelt, damit die Oberfläche nichts rechnet. */
export function beschrifte(eintrag, gesamt) {
  const anteil = gesamt > 0 ? (eintrag.wert / gesamt) * 100 : 0;
  return {
    name: eintrag.name,
    betrag: formatCHF(eintrag.wert),
    prozent: (Math.round(anteil * 10) / 10).toFixed(1) + "%"
  };
}

export { parseAmount };
