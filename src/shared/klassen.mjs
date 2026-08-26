/**
 * Blaubuch — Klassifizierungen und ihre Farben.
 *
 * Eine Klassifizierung beantwortet die Frage, die dieses Programm von einer
 * Tabellenkalkulation unterscheidet: Ist dieses Geld danach weg, oder liegt
 * es nur woanders?
 *
 * Deshalb ist `verloren` das eigentliche Feld und die Farbe nur das
 * Etikett. Wer eine eigene Klasse anlegt, muss `verloren` mit angeben —
 * sonst kann totals() sie nicht einordnen.
 *
 * Bis Fassung 4 waren es drei fest verdrahtete Markierungen:
 *
 *   rot   = Konsum
 *   gruen = Investition (Kontrolle durch mich)
 *   gelb  = Investition (blockiert)
 *
 * Ab Fassung 5 sind es Daten im Stammsatz, und die Bedeutungen haben sich
 * verschoben: Gelb heisst jetzt Sparen, „blockiert“ ist Lila. Was frueher
 * gelb war, wird deshalb beim Einlesen zu Lila — siehe TAG_ZU_KLASSE.
 */

/**
 * Die waehlbaren Farben.
 *
 * Je ein Wert fuer hell und dunkel, beide von Hand abgestimmt statt aus
 * einer Formel: Gelb braucht mehr Helligkeit als Rot, um lesbar zu bleiben,
 * eine einheitliche Helligkeit wuerde es absaufen lassen.
 *
 * Kein freies Farbrad. Jeder Wert hier ist gegen die Flaechen geprueft, auf
 * denen er sitzt — in beiden Darstellungen und unter jedem Farbschema.
 * `npm run check:farben` rechnet das nach; ein frei gewaehlter Ton koennte
 * es nicht garantieren.
 *
 * Die ersten vier tragen die Werte aus Fassung 4 unveraendert weiter, damit
 * bestehende Dateien nach dem Einlesen genauso aussehen wie vorher.
 */
export const KLASSEN_FARBEN = [
  { key: "rot",     name: "Rot",     hell: "#C6303E", dunkel: "#F08894" },
  { key: "orange",  name: "Orange",  hell: "#CF630D", dunkel: "#FA7C20" },
  { key: "gelb",    name: "Gelb",    hell: "#B4850E", dunkel: "#E5C05C" },
  { key: "gruen",   name: "Grün",    hell: "#1E8A4C", dunkel: "#6FCB95" },
  { key: "tuerkis", name: "Türkis",  hell: "#3B9696", dunkel: "#16BBBC" },
  { key: "blau",    name: "Blau",    hell: "#0083FD", dunkel: "#62A7FD" },
  { key: "lila",    name: "Lila",    hell: "#B64FDE", dunkel: "#CE7DF1" },
  { key: "magenta", name: "Magenta", hell: "#DF3798", dunkel: "#F46EB4" }
];

export const FARB_KEYS = KLASSEN_FARBEN.map((f) => f.key);

/** Faellt auf Rot zurueck: eine Klasse ohne sichtbare Farbe waere nutzlos. */
export const farbe = (key) => KLASSEN_FARBEN.find((f) => f.key === key) ?? KLASSEN_FARBEN[0];

/**
 * Die vier mitgelieferten Klassen.
 *
 * Die Kennungen sind bewusst Woerter und nicht Farbnamen. Frueher hiess die
 * Markierung „gelb“ und bedeutete „Investition blockiert“; heute ist Gelb
 * die Farbe von Sparen. Waeren die Kennungen weiterhin Farben, hiesse
 * dieselbe Kennung in zwei Fassungen zweierlei — eine Falle, die sich mit
 * sprechenden Namen gar nicht erst stellt.
 */
export const STANDARD_KLASSEN = [
  { id: "ausgaben",    name: "Ausgaben",              farbe: "rot",   verloren: true },
  { id: "investition", name: "Investition",           farbe: "gruen", verloren: false },
  { id: "sparen",      name: "Sparen",                farbe: "gelb",  verloren: false },
  { id: "blockiert",   name: "Investition blockiert", farbe: "lila",  verloren: false }
];

/** Fallback, wenn eine Zeile auf eine Klasse zeigt, die es nicht gibt. */
export const STANDARD_KLASSE = "ausgaben";

/**
 * Umschluesselung aus Fassung 4 und aelter.
 *
 * Der Sprung von gelb auf blockiert ist der Kern: „Investition gebunden“
 * heisst jetzt „Investition blockiert“ und ist lila. Bliebe es gelb,
 * bedeuteten alte Zahlen rueckwirkend „Sparen“ — etwas anderes, als der
 * Benutzer damals eingetragen hat.
 */
export const TAG_ZU_KLASSE = {
  rot: "ausgaben",
  gruen: "investition",
  gelb: "blockiert"
};

/** Frische Fassung der mitgelieferten Klassen — nie die Vorlage selbst. */
export const standardKlassen = () => STANDARD_KLASSEN.map((k) => ({ ...k, stillgelegt: false }));

/**
 * Liest eine Klassenliste aus beliebigen Daten. Wirft nie: eine defekte
 * Datei darf die App nicht am Start hindern.
 *
 * Fehlt alles oder ist nichts Brauchbares dabei, kommen die vier
 * mitgelieferten zurueck — ohne Klassen liesse sich keine Zeile einordnen.
 */
export function leseKlassen(roh) {
  if (!Array.isArray(roh)) return standardKlassen();

  const gesehen = new Set();
  const klassen = [];
  for (const k of roh) {
    if (!k || typeof k.id !== "string" || !k.id.trim()) continue;
    if (typeof k.name !== "string" || !k.name.trim()) continue;
    if (gesehen.has(k.id)) continue;
    gesehen.add(k.id);
    klassen.push({
      id: k.id,
      name: k.name.trim(),
      farbe: FARB_KEYS.includes(k.farbe) ? k.farbe : "rot",
      /* Ausdruecklich true, alles andere false: ein fehlendes Feld darf
         nicht versehentlich als „ist weg“ gelten. */
      verloren: k.verloren === true,
      /* Stillgelegte Klassen bleiben an alten Zeilen, verschwinden aber
         aus der Auswahl. Loeschen wuerde alte Monate entwerten. */
      stillgelegt: k.stillgelegt === true
    });
  }
  return klassen.length > 0 ? klassen : standardKlassen();
}

/** Die Klasse zu einer Kennung, oder die Standardklasse. */
export function klasseVon(klassen, id) {
  return klassen.find((k) => k.id === id)
    ?? klassen.find((k) => k.id === STANDARD_KLASSE)
    ?? klassen[0];
}
