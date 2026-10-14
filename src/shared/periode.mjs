/**
 * Blaubuch — Monatsbeginn.
 *
 * Ein Monat muss nicht am 1. anfangen. Wer den Lohn am 25. bekommt,
 * rechnet vom 25. bis und mit dem 24. des Folgemonats — dazwischen liegt
 * das Geld, das dieser Lohn tragen muss.
 *
 * Der Schluessel bleibt "JJJJ-MM" und meint den Monat, in dem die Periode
 * beginnt: "2026-10" mit Beginn 25 ist der 25. Oktober bis 24. November.
 * Damit bleiben alle Buchungen, Vergleiche und Sortierungen, wie sie sind;
 * die Einstellung aendert nur Bezeichnung, Zeitraum und die Reihenfolge
 * der Tage.
 *
 * Hoechstens der 28.: diesen Tag hat jeder Monat. Ein Beginn am 31. haette
 * im Februar keinen Anfang.
 */

export const MONATSBEGINN_MAX = 28;

export const MONTH_NAMES = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember"
];

const KURZ = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

/** Tag 1–28, sonst 1. Unsinn wird verworfen, nicht zurechtgebogen. */
export function leseMonatsbeginn(raw) {
  if (raw === null || raw === undefined || raw === "") return 1;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= MONATSBEGINN_MAX ? n : 1;
}

export const monatsbeginn = (state) => leseMonatsbeginn(state?.monatsbeginn);

const zerlege = (key) => String(key).split("-").map(Number);
const iso = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0")
  + "-" + String(d.getDate()).padStart(2, "0");

/** Erster und letzter Tag der Periode als Datum (oertliche Zeit). */
function grenzen(key, beginn) {
  const [y, m] = zerlege(key);
  const b = leseMonatsbeginn(beginn);
  /* Der Tag vor dem Beginn des Folgemonats — Date rechnet den
     Monatswechsel und den Februar selbst. */
  return { von: new Date(y, m - 1, b), bis: new Date(y, m, b - 1) };
}

/** Zeitraum als ISO-Daten, z. B. { von: "2026-10-25", bis: "2026-11-24" }. */
export function zeitraum(key, beginn = 1) {
  const g = grenzen(key, beginn);
  return { von: iso(g.von), bis: iso(g.bis) };
}

/**
 * "Oktober 2026" — oder mit Beginn 25 "25. Okt – 24. Nov | 2026".
 * Ueber den Jahreswechsel traegt das Jahr beide Teile: "2026/27".
 */
export function periodeLabel(key, beginn = 1) {
  const [y, m] = zerlege(key);
  if (!y || !m || m < 1 || m > 12) return String(key);
  const b = leseMonatsbeginn(beginn);
  if (b === 1) return MONTH_NAMES[m - 1] + " " + y;
  const { von, bis } = grenzen(key, b);
  const jahr = bis.getFullYear() === y ? String(y) : y + "/" + String(bis.getFullYear()).slice(2);
  return von.getDate() + ". " + KURZ[von.getMonth()] + " – "
    + bis.getDate() + ". " + KURZ[bis.getMonth()] + " | " + jahr;
}

/** Schluessel der Periode, in die ein Datum faellt. */
export function periodeVon(datum = new Date(), beginn = 1) {
  const b = leseMonatsbeginn(beginn);
  let y = datum.getFullYear();
  let m = datum.getMonth() + 1;
  if (datum.getDate() < b) {
    m -= 1;
    if (m < 1) { m = 12; y -= 1; }
  }
  return y + "-" + String(m).padStart(2, "0");
}

/**
 * Die Tage 1–31 in der Reihenfolge der Periode: ab dem Beginn bis 31,
 * dann ab dem 1. bis zum Tag davor. Wie bisher hat jeder Monat 31 Tage —
 * ein Tag 31 im November ist ein Eingabefehler, kein Grund, ihn zu
 * verlieren.
 */
export function tagesfolge(beginn = 1) {
  const b = leseMonatsbeginn(beginn);
  return Array.from({ length: 31 }, (_, i) => ((b - 1 + i) % 31) + 1);
}
