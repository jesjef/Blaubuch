/**
 * Blaubuch — automatische Sperre bei Untätigkeit.
 *
 * Das Bedrohungsmodell in SECURITY.md nennt „jeden, der Zugang zu deinem
 * entsperrten Rechner hat“ ausdrücklich als ungeschützt. Ein Tresor, der
 * nach dem Öffnen bis zum Programmende offen bleibt, macht diese Lücke
 * unnötig gross: der Rechner ist irgendwann gesperrt, Blaubuch nicht.
 *
 * Was hier passiert, ist bewusst schlicht: bei Eingaben läuft die Uhr neu,
 * nach der eingestellten Zeit ohne Eingabe wird gespeichert und gesperrt.
 * Kein Vorwarn-Dialog — er wäre genau in dem Moment im Weg, in dem niemand
 * da ist, und würde die Sperre bei einem Klick daneben aufheben.
 *
 * Die Einstellung liegt im Browserspeicher des Fensters, nicht im Tresor.
 * Sie muss gelten, bevor irgendetwas entschlüsselt ist, und wer sie dort
 * verändern kann, hat ohnehin Zugriff auf die Tresordatei selbst. Das
 * steht so auch in SECURITY.md.
 */

const SCHLUESSEL = "blaubuch-sperre";
const STANDARD = "15";

/** Die angebotenen Zeiten. `minuten: 0` heisst: gar nicht sperren. */
export const SPERR_ZEITEN = [
  { key: "aus", name: "Aus", minuten: 0 },
  { key: "5", name: "5 Min.", minuten: 5 },
  { key: "15", name: "15 Min.", minuten: 15 },
  { key: "30", name: "30 Min.", minuten: 30 },
  { key: "60", name: "60 Min.", minuten: 60 }
];

const zeit = (key) => SPERR_ZEITEN.find((z) => z.key === key) ?? SPERR_ZEITEN.find((z) => z.key === STANDARD);

export function leseSperre() {
  try {
    const wert = localStorage.getItem(SCHLUESSEL);
    return SPERR_ZEITEN.some((z) => z.key === wert) ? wert : STANDARD;
  } catch {
    return STANDARD;
  }
}

export function setzeSperre(key) {
  try {
    if (key === STANDARD) localStorage.removeItem(SCHLUESSEL);
    else localStorage.setItem(SCHLUESSEL, key);
  } catch { /* dann gilt eben nur die laufende Sitzung */ }
}

/**
 * Hängt sich an die Eingabeereignisse des Fensters und ruft `beiAblauf`,
 * wenn die eingestellte Zeit ohne eine einzige Eingabe vergangen ist.
 *
 * `capture: true`, damit auch Eingaben in Feldern zählen, die das Ereignis
 * selbst abfangen. `passive: true`, weil hier nichts verhindert wird.
 */
export function starteWaechter(beiAblauf) {
  let timer = null;
  let scharf = false;

  const plane = () => {
    clearTimeout(timer);
    timer = null;
    if (!scharf) return;
    const minuten = zeit(leseSperre()).minuten;
    if (minuten === 0) return;
    timer = setTimeout(() => {
      /* Vor dem Aufruf entschärfen: beiAblauf sperrt und öffnet den
         Torbildschirm, und der soll die Uhr nicht gleich neu starten. */
      scharf = false;
      timer = null;
      beiAblauf();
    }, minuten * 60 * 1000);
  };

  for (const ereignis of ["pointerdown", "keydown", "wheel", "focus"]) {
    window.addEventListener(ereignis, plane, { passive: true, capture: true });
  }

  return {
    /** Ab jetzt zählen — nach dem Öffnen des Tresors. */
    an() { scharf = true; plane(); },
    /** Uhr anhalten — beim Sperren, und solange der Torbildschirm steht. */
    aus() { scharf = false; clearTimeout(timer); timer = null; },
    /** Nach einer Änderung der Einstellung neu rechnen. */
    neuLesen: plane
  };
}
