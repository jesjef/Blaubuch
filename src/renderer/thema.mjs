/**
 * Blaubuch — Hell/Dunkel.
 *
 * Ohne Zutun folgt das Programm der Einstellung des Betriebssystems.
 * Sobald jemand den Schalter benutzt, gewinnt seine Wahl und bleibt
 * erhalten — sie liegt im Browserspeicher des Fensters, nicht im Tresor:
 * eine Ansichtseinstellung ist keine Finanzangabe und hat in der
 * verschlüsselten Datei nichts zu suchen.
 */

const SCHLUESSEL = "blaubuch-thema";
const FARB_SCHLUESSEL = "blaubuch-farbe";
const REIHENFOLGE = ["system", "light", "dark"];

/**
 * Die wählbaren Farbschemata. Ein Schema setzt nur den Farbton — die
 * Helligkeitsleiter dahinter bleibt gleich, damit Kontrast und Lesbarkeit
 * nicht von der Wahl abhängen.
 *
 * Rot, Grün und Gelb fehlen mit Absicht: sie sind als Statusfarben
 * vergeben (Konsum, Investition, Warnung). Ein Akzent in ihrer Nähe
 * würde die Bedeutung verwischen.
 */
export const FARBSCHEMATA = [
  { key: "koenigsblau", name: "Königsblau", ton: 272 },
  { key: "schiefer", name: "Schiefer", ton: 250 },
  { key: "petrol", name: "Petrol", ton: 205 },
  { key: "violett", name: "Violett", ton: 300 },
  { key: "beere", name: "Beere", ton: 335 }
];

const FARB_KEYS = FARBSCHEMATA.map((f) => f.key);

export function leseFarbe() {
  try {
    const wert = localStorage.getItem(FARB_SCHLUESSEL);
    return FARB_KEYS.includes(wert) ? wert : "koenigsblau";
  } catch {
    return "koenigsblau";
  }
}

/** Königsblau ist der Standard und braucht kein Merkmal am Wurzelelement. */
export function setzeFarbe(key) {
  if (!FARB_KEYS.includes(key)) return;
  const wurzel = document.documentElement;
  if (key === "koenigsblau") wurzel.removeAttribute("data-farbe");
  else wurzel.setAttribute("data-farbe", key);
  try {
    if (key === "koenigsblau") localStorage.removeItem(FARB_SCHLUESSEL);
    else localStorage.setItem(FARB_SCHLUESSEL, key);
  } catch { /* nur für diese Sitzung */ }
}

const BESCHRIFTUNG = {
  system: { zeichen: "◐", titel: "Darstellung: wie das System — klicken für hell" },
  light: { zeichen: "☀", titel: "Darstellung: hell — klicken für dunkel" },
  dark: { zeichen: "☾", titel: "Darstellung: dunkel — klicken für System" }
};

function lies() {
  try {
    const wert = localStorage.getItem(SCHLUESSEL);
    return REIHENFOLGE.includes(wert) ? wert : "system";
  } catch {
    return "system";
  }
}

function schreibe(wert) {
  try {
    if (wert === "system") localStorage.removeItem(SCHLUESSEL);
    else localStorage.setItem(SCHLUESSEL, wert);
  } catch { /* nicht schlimm — dann gilt die Wahl nur für diese Sitzung */ }
}

/**
 * Setzt das Merkmal am Wurzelelement. "system" entfernt es wieder,
 * damit die Medienabfrage im Stylesheet wieder greift.
 */
function anwenden(wert) {
  const wurzel = document.documentElement;
  if (wert === "system") wurzel.removeAttribute("data-theme");
  else wurzel.setAttribute("data-theme", wert);
}

/* ------------------------------------------------------------------ *
 * Privatsicht
 * ------------------------------------------------------------------ */

const PRIVAT_SCHLUESSEL = "blaubuch-privat";

export function lesePrivat() {
  try { return localStorage.getItem(PRIVAT_SCHLUESSEL) === "1"; } catch { return false; }
}

/**
 * Unkenntlich gemacht wird ueber ein Merkmal am Wurzelelement, nicht ueber
 * geaenderte Texte: die Zahlen bleiben im Dokument, sie sind nur nicht
 * lesbar. Dadurch laesst sich weiterarbeiten, und ein Umschalten kostet
 * keinen Neuaufbau.
 */
export function setzePrivat(an) {
  const wurzel = document.documentElement;
  if (an) wurzel.setAttribute("data-privat", "");
  else wurzel.removeAttribute("data-privat");
  try {
    if (an) localStorage.setItem(PRIVAT_SCHLUESSEL, "1");
    else localStorage.removeItem(PRIVAT_SCHLUESSEL);
  } catch { /* nur fuer diese Sitzung */ }
}

/** Haengt den Schalter an einen Knopf. Gibt eine Funktion zum Nachzeichnen zurueck. */
export function verbindePrivatSchalter(knopf) {
  const zeichnen = () => {
    const an = lesePrivat();
    knopf.textContent = an ? "🙈" : "👁";
    const titel = an
      ? "Beträge verborgen — klicken zum Anzeigen"
      : "Beträge anzeigen — klicken zum Verbergen";
    knopf.title = titel;
    knopf.setAttribute("aria-label", titel);
    knopf.setAttribute("aria-pressed", String(an));
  };

  setzePrivat(lesePrivat());
  zeichnen();

  knopf.addEventListener("click", () => {
    setzePrivat(!lesePrivat());
    zeichnen();
  });

  return zeichnen;
}

/** Aktuell gewählte Darstellung: "system", "light" oder "dark". */
export function leseThema() { return lies(); }

/** Darstellung setzen und merken. */
export function setzeThema(wert) {
  if (!REIHENFOLGE.includes(wert)) return;
  schreibe(wert);
  anwenden(wert);
}

/** Was gerade tatsächlich zu sehen ist — für Beschriftungen und Diagrammfarben. */
export function istDunkel() {
  const gewaehlt = lies();
  if (gewaehlt === "dark") return true;
  if (gewaehlt === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/**
 * Hängt den Schalter an einen Knopf.
 *
 * Nachgefärbt werden muss nichts: Flächen und Diagramme beziehen ihre
 * Farben durchgehend aus CSS-Variablen, die mit dem Merkmal umschalten.
 *
 * @param {HTMLElement} knopf
 */
export function verbindeSchalter(knopf) {
  let aktuell = lies();

  const zeichnen = () => {
    const b = BESCHRIFTUNG[aktuell];
    knopf.textContent = b.zeichen;
    knopf.title = b.titel;
    knopf.setAttribute("aria-label", b.titel);
    knopf.dataset.thema = aktuell;
  };

  anwenden(aktuell);
  zeichnen();

  knopf.addEventListener("click", () => {
    aktuell = REIHENFOLGE[(REIHENFOLGE.indexOf(aktuell) + 1) % REIHENFOLGE.length];
    schreibe(aktuell);
    anwenden(aktuell);
    zeichnen();
  });

  /* Wird die Darstellung anderswo geändert — etwa in den Einstellungen —,
     muss der Schnellschalter sein Zeichen nachziehen. */
  return () => { aktuell = lies(); zeichnen(); };
}
