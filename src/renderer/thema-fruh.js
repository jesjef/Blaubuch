/**
 * Läuft blockierend im Dokumentkopf, noch bevor irgendetwas gezeichnet wird.
 *
 * Grund: würden die gespeicherten Einstellungen erst mit den Modulen
 * angewendet, blitzte beim Start kurz die falsche Darstellung auf. Inline
 * ginge nicht — die Content-Security-Policy lässt nur eigene Dateien zu.
 *
 * Bewusst eigenständig und ohne Import: ein paar Zeilen Doppelung sind hier
 * billiger als eine Modulkette im kritischen Pfad.
 */

(() => {
  const wurzel = document.documentElement;
  try {
    const thema = localStorage.getItem("blaubuch-thema");
    if (thema === "light" || thema === "dark") wurzel.setAttribute("data-theme", thema);

    const farbe = localStorage.getItem("blaubuch-farbe");
    if (farbe && /^[a-z]{3,20}$/.test(farbe)) wurzel.setAttribute("data-farbe", farbe);

    /* Die Privatsicht muss vor dem ersten Bild stehen — sonst waeren die
       Betraege einen Wimpernschlag lang doch zu sehen. */
    if (localStorage.getItem("blaubuch-privat") === "1") wurzel.setAttribute("data-privat", "");
  } catch {
    /* Kein Speicher verfügbar — dann gelten die Vorgaben. */
  }
})();
