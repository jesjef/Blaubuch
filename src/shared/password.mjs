/**
 * Passwortbewertung.
 *
 * Bewusst ohne node:crypto und ohne jede Abhaengigkeit, damit die
 * Oberflaeche das hier laden kann — dort gibt es kein Node.
 * Der Tresor selbst liegt in vault.mjs und laeuft nur im Hauptprozess.
 */

/**
 * Bewertet ein Passwort. Kein Verbot, nur eine ehrliche Auskunft —
 * die Entscheidung trifft der Mensch davor.
 *
 * Bewusst laengenlastig: eine lange Wortfolge ist widerstandsfaehiger
 * als ein kurzes Wort mit Sonderzeichen, auch wenn Letzteres
 * komplizierter aussieht.
 */
export function passwordStrength(password) {
  const s = String(password ?? "");
  const klassen = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((r) => r.test(s)).length;
  const laenge = s.length;

  if (laenge === 0) return { stufe: "leer", text: "Kein Passwort eingegeben." };
  if (laenge < 8) return { stufe: "schwach", text: "Zu kurz — mindestens 8 Zeichen, besser eine ganze Wortfolge." };
  if (laenge >= 20) return { stufe: "stark", text: "Gut: lange Wortfolgen sind sicherer als kurze Sonderzeichenkombinationen." };
  if (laenge >= 12 && klassen >= 3) return { stufe: "stark", text: "Gut." };
  if (laenge >= 12 || klassen >= 3) return { stufe: "mittel", text: "Brauchbar. Länger wäre besser als komplizierter." };
  return { stufe: "schwach", text: "Schwach — nimm lieber vier zufällige Wörter als ein kurzes Kunstwort." };
}
