/**
 * Blaubuch — Fehler und Argumentprüfung für den KI-Zugriff.
 *
 * Eigenes Modul, damit ki.mjs (Werkzeuge) und vorschlaege.mjs (Vorschläge)
 * beide darauf bauen können, ohne sich gegenseitig zu importieren.
 */

/** Ein Fehler, den die KI zu sehen bekommt. Die Meldung muss ihr helfen. */
export class KiFehler extends Error {}

/**
 * Prüft Argumente gegen das kleine Schema eines Werkzeugs.
 *
 * Bewusst kein allgemeiner JSON-Schema-Prüfer: Er kennt genau das, was die
 * Werkzeuge verwenden — string (minLength, maxLength, pattern, enum),
 * number (Betrag: endlich, nicht null, Obergrenze), integer (minimum,
 * maximum), dazu `required` und keine fremden Felder. Typ-Listen mit
 * "null" sind erlaubt.
 */
export function pruefeArgumente(schema, args) {
  if (args === undefined || args === null) args = {};
  if (typeof args !== "object" || Array.isArray(args)) {
    throw new KiFehler("Argumente müssen ein Objekt sein.");
  }
  const eigenschaften = schema.properties ?? {};
  const erlaubt = Object.keys(eigenschaften);

  for (const name of Object.keys(args)) {
    if (!erlaubt.includes(name)) {
      throw new KiFehler("Unbekanntes Argument „" + name + "“. Erlaubt: "
        + (erlaubt.length ? erlaubt.join(", ") : "keine") + ".");
    }
  }
  for (const name of schema.required ?? []) {
    if (args[name] === undefined) throw new KiFehler("„" + name + "“ fehlt.");
  }

  for (const [name, wert] of Object.entries(args)) {
    if (wert === undefined) continue;
    const s = eigenschaften[name];
    const typen = Array.isArray(s.type) ? s.type : [s.type];
    const falsch = (was) => new KiFehler("„" + name + "“ " + was + (s.description ? " " + s.description : ""));

    if (wert === null) {
      if (!typen.includes("null")) throw falsch("darf nicht leer sein.");
      continue;
    }
    if (typen.includes("string") && typeof wert === "string") {
      if (s.minLength !== undefined && wert.trim().length < s.minLength) throw falsch("ist zu kurz.");
      if (s.maxLength !== undefined && wert.length > s.maxLength) throw falsch("ist zu lang (höchstens " + s.maxLength + " Zeichen).");
      if (s.pattern !== undefined && !new RegExp(s.pattern).test(wert)) throw falsch("hat das falsche Format.");
      if (s.enum !== undefined && !s.enum.includes(wert)) throw falsch("muss eines davon sein: " + s.enum.join(", ") + ".");
      continue;
    }
    if (typen.includes("integer") && Number.isInteger(wert)) {
      if (s.minimum !== undefined && wert < s.minimum) throw falsch("ist zu klein.");
      if (s.maximum !== undefined && wert > s.maximum) throw falsch("ist zu gross.");
      continue;
    }
    if (typen.includes("number") && typeof wert === "number") {
      if (!Number.isFinite(wert)) throw falsch("ist keine Zahl.");
      if (s.not?.const === 0 && wert === 0) throw falsch("darf nicht 0 sein.");
      if (s.maximum !== undefined && Math.abs(wert) > s.maximum) throw falsch("ist unplausibel gross.");
      continue;
    }
    throw falsch("hat den falschen Typ (erwartet: " + typen.join(" oder ") + ").");
  }
  return args;
}

/**
 * Steuer- und Richtungszeichen entfernen, Leerraum glätten. Was die KI
 * schreibt, landet in der Oberfläche — es soll dort genau so aussehen,
 * wie es dasteht, und sich nicht umdrehen oder verstecken können.
 */
export function saeubere(text) {
  return String(text ?? "")
    .replace(/[\t\n\r]/g, " ")
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
