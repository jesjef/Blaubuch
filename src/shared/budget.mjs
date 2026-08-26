/**
 * Blaubuch — Rechenkern.
 *
 * Reine Funktionen ohne DOM, ohne Dateizugriff, ohne Electron.
 * Alles hier ist direkt testbar und wird von der Oberflaeche wie auch
 * von den Tests unveraendert benutzt.
 */

import {
  STANDARD_KLASSE, TAG_ZU_KLASSE,
  leseKlassen, standardKlassen, klasseVon
} from "./klassen.mjs";

export {
  KLASSEN_FARBEN, FARB_KEYS, farbe, STANDARD_KLASSEN, STANDARD_KLASSE,
  standardKlassen, klasseVon
} from "./klassen.mjs";

export const SCHEMA_VERSION = 5;

/**
 * Die Arten eines Kontos. Nicht frei erfindbar, weil sie die Rechnung
 * bestimmen und nicht die Beschriftung:
 *
 *   erwerb    — was der Monat verdient hat. Nur das zaehlt fuer die Sparquote.
 *   bestand   — was schon da war. Erhoeht die Mittel, ist kein Einkommen.
 *   geliehen  — Fremdschulden. Wie Bestand, aber zurueckzuzahlen.
 */
export const KONTO_ARTEN = ["erwerb", "bestand", "geliehen"];

export const KONTO_ART_TITLE = {
  erwerb: "Erwerbseinkommen",
  bestand: "Bestand",
  geliehen: "Geliehen"
};

/**
 * Die Konten, die eine frische Installation mitbringt — und zugleich die
 * Umschluesselung der fuenf festen Felder aus Fassung 4 und aelter.
 * Reihenfolge und Namen sind dieselben, damit nichts fremd wirkt.
 */
const KONTO_VORLAGE = [
  ["netto", "Nettolohn", "erwerb"],
  ["spesen", "Spesen", "erwerb"],
  ["konto", "Kontostand", "bestand"],
  ["bar", "Bargeld", "bestand"],
  ["fremdschulden", "Geliehen", "geliehen"]
];

export const standardKonten = () =>
  KONTO_VORLAGE.map(([, name, art]) => ({ id: uid(), name, betrag: 0, art, aktiv: true }));

export const MONTH_NAMES = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember"
];

/**
 * Kein Limit vorgegeben — die Oberflaeche zeigt dann „Kein Limit gesetzt“.
 * Ein sinnvoller Wert haengt am eigenen Kartenvertrag und laesst sich
 * nicht erraten.
 */
/**
 * Kreditkarten legt jeder selbst an — Namen, Salden und Limits haengen am
 * eigenen Kartenvertrag und lassen sich nicht erraten. Ein Limit von 0
 * bedeutet „keines gesetzt“ und wird nicht ueberwacht.
 */
export const KEIN_LIMIT = 0;

const CHF = new Intl.NumberFormat("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "1'234.50 Fr." — Schweizer Schreibweise mit Tausendertrennzeichen. */
export function formatCHF(n) {
  const v = Number.isFinite(n) ? n : 0;
  return CHF.format(Math.round(v * 100) / 100) + " Fr.";
}

/**
 * Liest einen Betrag aus freier Eingabe.
 * Akzeptiert "1'234,50", "1’234.50", "1234.5", " 12 " und leere Eingabe.
 * Unlesbares ergibt 0 statt NaN — ein Budget kennt keinen undefinierten Betrag.
 */
export function parseAmount(raw) {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0;
  const s = String(raw ?? "").trim().replace(/[\s'’`]/g, "").replace(",", ".");
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/** Auf Rappen runden — schuetzt Summen vor Gleitkomma-Resten. */
export const toRappen = (n) => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;

export function monthLabel(key) {
  const [y, m] = String(key).split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) return String(key);
  return MONTH_NAMES[m - 1] + " " + y;
}

export function isMonthKey(key) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(key));
}

export function nextMonthKey(key) {
  let [y, m] = String(key).split("-").map(Number);
  m += 1;
  if (m > 12) { m = 1; y += 1; }
  return y + "-" + String(m).padStart(2, "0");
}

export const sortedMonths = (state) => Object.keys(state.months).sort();

/**
 * Summen eines Monats.
 *
 * Bewusst getrennt, und die Trennung kommt aus der `art` der Konten:
 *   erwerb    — was der Monat tatsaechlich verdient hat
 *   bestand   — was schon da war, kein Einkommen
 *   geliehen  — Fremdschulden, kein Einkommen und spaeter zurueckzuzahlen
 *   einnahmen — alle verfuegbaren Mittel zusammen
 *
 * Die Sparquote rechnet gegen `erwerb`, nicht gegen `einnahmen`: sonst
 * verbessert ein hoher Kontostand oder ein Darlehen die Quote, ohne dass
 * ein Franken mehr verdient wurde.
 *
 * `verloren` ist die zweite Zahl, die dieses Programm ausmacht: nicht wie
 * viel weg ist, sondern wie viel davon tatsaechlich verloren ist. Sie kommt
 * aus dem Feld `verloren` der Klassifizierungen — nicht aus ihrer Farbe.
 *
 * Die Klassen kommen aus dem Stammsatz. Ohne Angabe gelten die vier
 * mitgelieferten, damit sich ein einzelner Monat auch fuer sich rechnen
 * laesst.
 */
export function totals(month, klassen = standardKlassen()) {
  /* Ein deaktiviertes Konto bleibt sichtbar, zaehlt aber nicht mit. Das ist
     etwas anderes als ein Betrag von 0: der Betrag bleibt erhalten, man
     kann den Monat ohne diese Quelle durchspielen und sie zurueckholen. */
  const konten = (month.konten ?? []).filter((k) => k && k.aktiv !== false);
  const summeArt = (art) => toRappen(
    konten.filter((k) => k.art === art).reduce((s, k) => s + parseAmount(k.betrag), 0)
  );

  const erwerb = summeArt("erwerb");
  const bestand = summeArt("bestand");
  const geliehen = summeArt("geliehen");
  const einnahmen = toRappen(erwerb + bestand + geliehen);

  const sum = (list) => toRappen((list ?? []).reduce((s, x) => s + parseAmount(x.betrag), 0));
  const da = sum(month.dauerauftraege);
  const fix = sum(month.fixkosten);
  const re = sum(month.ausgaben);
  const kk = sum(month.kreditkarten);
  const kosten = toRappen(da + fix + kk + re);

  /* Kreditkartensaldo zaehlt als Ausgabe — er traegt kein eigenes Etikett. */
  const byKlasse = {};
  for (const k of klassen) byKlasse[k.id] = 0;
  const standard = klasseVon(klassen, STANDARD_KLASSE);
  byKlasse[standard.id] = kk;

  for (const x of [...(month.dauerauftraege ?? []), ...(month.fixkosten ?? []), ...(month.ausgaben ?? [])]) {
    const k = klasseVon(klassen, x.klasse);
    byKlasse[k.id] = toRappen((byKlasse[k.id] ?? 0) + parseAmount(x.betrag));
  }

  const verloren = toRappen(
    klassen.filter((k) => k.verloren).reduce((s, k) => s + (byKlasse[k.id] ?? 0), 0)
  );

  const rest = toRappen(einnahmen - kosten);
  return {
    erwerb, bestand, geliehen, einnahmen,
    da, fix, kk, re, kosten, rest,
    byKlasse, verloren,
    /* Was ausgegeben, aber nicht verloren ist: angelegt oder gespart. */
    angelegt: toRappen(kosten - verloren),
    sparquote: erwerb > 0 ? (rest / erwerb) * 100 : null
  };
}

/**
 * Beobachtungen zum Monat. Liefert Textbausteine statt fertigem Markup,
 * damit die Oberflaeche sie ohne innerHTML setzen kann.
 * Ein Baustein ist entweder ein String oder {b: "fett"}.
 */
export function buildInsights(state, monthKey) {
  const month = state.months[monthKey];
  const klassen = state.klassen ?? standardKlassen();
  const t = totals(month, klassen);
  const out = [];

  if (t.sparquote !== null) {
    out.push({
      kind: t.rest < 0 ? "warn" : t.sparquote >= 10 ? "good" : "",
      parts: [
        "Sparquote auf Erwerbseinkommen: ", { b: t.sparquote.toFixed(1) + "%" },
        " (" + formatCHF(t.rest) + " von " + formatCHF(t.erwerb) + ")."
      ]
    });
  }

  if (t.bestand > 0 || t.geliehen > 0) {
    const parts = ["Im Restwert stecken ", { b: formatCHF(t.bestand) }, " Bestand aus Konto und Bar"];
    if (t.geliehen > 0) {
      parts.push(" sowie ", { b: formatCHF(t.geliehen) }, " geliehenes Geld — beides ist kein Einkommen dieses Monats.");
    } else {
      parts.push(" — Bestand ist kein Einkommen dieses Monats.");
    }
    out.push({ kind: t.geliehen > 0 ? "warn" : "", parts });
  }

  /* Je Karte nur melden, was auffaellt: ueber dem Limit oder nahe daran. */
  for (const karte of month.kreditkarten ?? []) {
    const betrag = parseAmount(karte.betrag);
    const limit = parseAmount(karte.limit);
    if (limit <= KEIN_LIMIT || betrag <= 0) continue;

    if (betrag > limit) {
      out.push({
        kind: "warn",
        parts: [karte.name + " über Limit: ", { b: formatCHF(betrag) }, " bei Limit " + formatCHF(limit) + "."]
      });
    } else if (betrag / limit >= 0.8) {
      out.push({
        kind: "warn",
        parts: [karte.name + " fast am Limit: ", { b: Math.round((betrag / limit) * 100) + "%" },
                " von " + formatCHF(limit) + " ausgeschöpft."]
      });
    }
  }

  const blocks = [
    ["Daueraufträge", t.da], ["Fixkosten", t.fix],
    ["Kreditkarten", t.kk], ["Ausgaben", t.re]
  ].sort((a, b) => b[1] - a[1]);
  if (blocks[0][1] > 0 && t.kosten > 0) {
    out.push({
      parts: [
        "Grösster Kostenblock: ", { b: blocks[0][0] },
        " mit " + formatCHF(blocks[0][1]) + " (" + Math.round((blocks[0][1] / t.kosten) * 100) + "% der Kosten)."
      ]
    });
  }

  if (t.angelegt > 0) {
    /* Aufgeschluesselt nach Klasse, damit man sieht, wohin es gegangen ist —
       aber nur die, die in diesem Monat ueberhaupt vorkommen. */
    const teile = klassen
      .filter((k) => !k.verloren && (t.byKlasse[k.id] ?? 0) > 0)
      .map((k) => formatCHF(t.byKlasse[k.id]) + " " + k.name);
    out.push({
      kind: "good",
      parts: [
        "Nicht verloren: ", { b: formatCHF(t.angelegt) },
        teile.length > 0 ? " (" + teile.join(", ") + ") — dieses Geld liegt woanders, es ist nicht weg." : "."
      ]
    });
  }

  const keys = sortedMonths(state);
  const idx = keys.indexOf(monthKey);
  if (idx > 0) {
    const pt = totals(state.months[keys[idx - 1]], klassen);
    const dRest = toRappen(t.rest - pt.rest);
    const dKosten = toRappen(t.kosten - pt.kosten);
    out.push({
      kind: dRest < 0 ? "warn" : "good",
      parts: [
        "Vergleich " + monthLabel(keys[idx - 1]) + ": Restwert " + (dRest >= 0 ? "+" : "−"),
        { b: formatCHF(Math.abs(dRest)) },
        ", Kosten " + (dKosten >= 0 ? "+" : "−") + formatCHF(Math.abs(dKosten))
      ]
    });
  }

  if (out.length === 0) {
    out.push({ parts: ["Werte eintragen — die Analyse aktualisiert sich sofort."] });
  }
  return out;
}

/** Monatsbericht als Fliesstext, gedacht zum Einfuegen in einen Chat. */
export function buildReport(state, monthKey) {
  const month = state.months[monthKey];
  const klassen = state.klassen ?? standardKlassen();
  const t = totals(month, klassen);
  const L = [];

  L.push("Analysiere meine Monatsbuchhaltung " + monthLabel(monthKey) + " (CHF) und gib mir konkrete Spar- und Optimierungstipps:");
  L.push("");
  const ART_ZUSATZ = {
    erwerb: "",
    bestand: " (Bestand, kein Einkommen)",
    geliehen: " (geliehen, rückzahlbar)"
  };
  L.push("VERFÜGBARE MITTEL gesamt " + formatCHF(t.einnahmen) + ":");
  for (const k of month.konten ?? []) {
    L.push("- " + k.name + (ART_ZUSATZ[k.art] ?? "") + ": " + formatCHF(parseAmount(k.betrag))
      + (k.aktiv === false ? " [zählt diesen Monat nicht mit]" : ""));
  }
  L.push("  → Erwerbseinkommen des Monats: " + formatCHF(t.erwerb));
  L.push("");
  L.push("DAUERAUFTRÄGE gesamt " + formatCHF(t.da) + ":");
  for (const x of month.dauerauftraege) {
    if (parseAmount(x.betrag)) L.push("- " + x.name + ": " + formatCHF(parseAmount(x.betrag)) + " [" + klasseVon(klassen, x.klasse).name + "]");
  }
  L.push("");
  L.push("FIXKOSTEN gesamt " + formatCHF(t.fix) + ":");
  for (const x of month.fixkosten) L.push("- " + x.name + ": " + formatCHF(parseAmount(x.betrag)));
  L.push("");
  L.push("KREDITKARTEN gesamt " + formatCHF(t.kk) + ":");
  if (month.kreditkarten.length === 0) L.push("- keine");
  for (const k of month.kreditkarten) {
    const limit = parseAmount(k.limit);
    L.push("- " + k.name + ": " + formatCHF(parseAmount(k.betrag))
      + (limit > KEIN_LIMIT ? " (Limit " + formatCHF(limit) + ")" : " (kein Limit gesetzt)"));
  }
  L.push("");
  L.push("AUSGABEN gesamt " + formatCHF(t.re) + ":");
  if (month.ausgaben.length === 0) L.push("- keine");
  for (const x of month.ausgaben) L.push("- " + x.name + ": " + formatCHF(parseAmount(x.betrag)));
  L.push("");
  L.push("GESAMTKOSTEN: " + formatCHF(t.kosten));
  L.push("RESTWERT: " + formatCHF(t.rest));
  L.push("Sparquote auf Erwerbseinkommen: " + (t.sparquote === null ? "—" : t.sparquote.toFixed(1) + "%"));
  L.push("Davon nicht verloren (angelegt oder gespart): " + formatCHF(t.angelegt));
  for (const k of klassen) {
    if (!k.verloren && (t.byKlasse[k.id] ?? 0) > 0) L.push("- " + k.name + ": " + formatCHF(t.byKlasse[k.id]));
  }
  return L.join("\n");
}

let idCounter = 0;
export function uid() {
  idCounter += 1;
  return "i" + Date.now().toString(36) + idCounter.toString(36) + Math.random().toString(36).slice(2, 6);
}

export function emptyMonth() {
  return {
    konten: standardKonten(),
    dauerauftraege: [],
    fixkosten: [],
    kreditkarten: [],
    ausgaben: [],
    umbuchungen: []
  };
}

/**
 * Neuer Monat auf Basis des zuletzt erfassten: wiederkehrende Posten werden
 * uebernommen, einmalige nicht. Betraege bleiben stehen, damit ein normaler
 * Monat ohne Tipparbeit stimmt; was diesmal nicht laeuft, wird auf 0 gesetzt.
 */
export function monthFromPrevious(prev) {
  if (!prev) return emptyMonth();
  const copyList = (list) => (list ?? []).map((x) => ({
    id: uid(), name: x.name, betrag: parseAmount(x.betrag),
    klasse: typeof x.klasse === "string" && x.klasse ? x.klasse : STANDARD_KLASSE
  }));
  return {
    /* Einkommen wiederholt sich Monat fuer Monat und bleibt stehen. Ein
       Bestand oder ein Darlehen ist eine Momentaufnahme — der faengt bei 0
       an, sonst schleppt man den Kontostand vom Vormonat mit. */
    konten: (prev.konten ?? standardKonten()).map((k) => ({
      id: uid(), name: k.name, art: k.art, aktiv: k.aktiv !== false,
      betrag: k.art === "erwerb" ? parseAmount(k.betrag) : 0
    })),
    dauerauftraege: copyList(prev.dauerauftraege),
    fixkosten: copyList(prev.fixkosten),
    /* Karten bleiben bestehen, der Saldo faengt bei 0 an — das Limit
       gehoert zum Kartenvertrag und aendert sich nicht monatlich. */
    kreditkarten: (prev.kreditkarten ?? []).map((k) => ({
      id: uid(), name: k.name, betrag: 0, limit: parseAmount(k.limit)
    })),
    ausgaben: [],
    /* Umbuchungen sind Ereignisse eines Monats, keine Dauerposten. */
    umbuchungen: []
  };
}

/**
 * Liest die Kreditkarten eines Monats.
 *
 * Zwei Formen kommen vor:
 *  - aktuell: eine Liste aus {id, name, betrag, limit}
 *  - bis Fassung 3: ein Objekt mit festen Schluesseln, die Limits lagen
 *    im Stammsatz. Daraus wird je Schluessel eine Kartenzeile; der
 *    Schluessel wird zum Namen, damit nichts erfunden werden muss.
 */
function leseKarten(roh, altLimits, monatsKey, repariert) {
  if (Array.isArray(roh)) {
    const karten = roh
      .filter((k) => k && typeof k.name === "string" && k.name.trim())
      .map((k) => ({
        id: typeof k.id === "string" && k.id ? k.id : uid(),
        name: k.name.trim(),
        betrag: parseAmount(k.betrag),
        limit: Math.max(KEIN_LIMIT, parseAmount(k.limit))
      }));
    if (karten.length !== roh.length) {
      repariert.push("In " + monthLabel(monatsKey) + " wurden " + (roh.length - karten.length) + " namenlose Kartenzeilen ausgelassen.");
    }
    return karten;
  }

  if (roh && typeof roh === "object") {
    const karten = Object.entries(roh).map(([schluessel, betrag]) => ({
      id: uid(),
      name: schluessel.charAt(0).toUpperCase() + schluessel.slice(1),
      betrag: parseAmount(betrag),
      limit: Math.max(KEIN_LIMIT, parseAmount(altLimits[schluessel]))
    }));
    if (karten.length > 0) {
      repariert.push("Die Kreditkarten aus " + monthLabel(monatsKey) + " wurden in frei benennbare Zeilen umgewandelt.");
    }
    return karten;
  }

  return [];
}

/**
 * Bringt beliebige gespeicherte Daten in die aktuelle Form.
 * Wirft nie — eine defekte Datei darf die App nicht am Start hindern.
 * Gibt {state, repariert} zurueck, damit die Oberflaeche es melden kann.
 *
 * Zwei Umstellungen aus Fassung 4 und aelter veraendern Bedeutung und
 * werden deshalb gemeldet statt still gemacht:
 *
 *  - Die fuenf festen Einnahmefelder werden zu benannten Konten.
 *  - Was „gelb“ war, bedeutete „Investition gebunden“. Heute ist Gelb die
 *    Farbe von Sparen, und die alte Bedeutung heisst „Investition
 *    blockiert“ und ist lila. Ohne Umschluesselung bedeuteten alte Zahlen
 *    rueckwirkend etwas anderes, als der Benutzer eingetragen hat.
 */
export function migrate(raw) {
  const repariert = [];
  const klassen = leseKlassen(raw?.klassen);
  const kennungen = new Set(klassen.map((k) => k.id));

  const state = {
    version: SCHEMA_VERSION,
    updatedAt: typeof raw?.updatedAt === "string" ? raw.updatedAt : new Date().toISOString(),
    currentMonth: null,
    klassen,
    months: {}
  };

  let ausGelb = 0;
  let konvertiert = 0;

  /** Fassung 5 nennt die Klasse, aeltere tragen eine Markierung. */
  const leseKlasse = (x) => {
    if (typeof x.klasse === "string" && kennungen.has(x.klasse)) return x.klasse;
    const ziel = typeof x.tag === "string" ? TAG_ZU_KLASSE[x.tag] : undefined;
    if (ziel && kennungen.has(ziel)) {
      if (x.tag === "gelb") ausGelb += 1;
      return ziel;
    }
    /* Im Zweifel gilt Geld als ausgegeben und nicht als angelegt — das ist
       die vorsichtigere der beiden Annahmen. */
    return STANDARD_KLASSE;
  };

  /** Fassung 5 hat eine Kontenliste, aeltere fuenf feste Felder. */
  const leseKonten = (m) => {
    if (Array.isArray(m?.konten)) {
      return m.konten
        .filter((k) => k && typeof k.name === "string" && k.name.trim())
        .map((k) => ({
          id: typeof k.id === "string" && k.id ? k.id : uid(),
          name: k.name.trim(),
          betrag: parseAmount(k.betrag),
          art: KONTO_ARTEN.includes(k.art) ? k.art : "bestand",
          aktiv: k.aktiv !== false
        }));
    }
    konvertiert += 1;
    const e = (m && typeof m.einnahmen === "object" && m.einnahmen) || {};
    /* Alle fuenf wandern mit, auch die mit 0: sonst verschwindet nach dem
       Einlesen eine Zeile, die der Benutzer kennt. */
    return KONTO_VORLAGE.map(([feld, name, art]) => ({
      id: uid(), name, betrag: parseAmount(e[feld]), art, aktiv: true
    }));
  };

  /** Nur was auf zwei verschiedene, vorhandene Konten zeigt, ueberlebt. */
  const leseUmbuchungen = (roh, konten) => {
    if (!Array.isArray(roh)) return [];
    const vorhanden = new Set(konten.map((k) => k.id));
    return roh
      .filter((u) => u && vorhanden.has(u.von) && vorhanden.has(u.nach) && u.von !== u.nach)
      .map((u) => ({
        id: typeof u.id === "string" && u.id ? u.id : uid(),
        von: u.von,
        nach: u.nach,
        betrag: parseAmount(u.betrag),
        notiz: typeof u.notiz === "string" ? u.notiz : ""
      }));
  };

  /* Bis Fassung 3 lagen die Kartenlimits im Stammsatz. */
  const altLimits = (raw && typeof raw.limits === "object" && raw.limits) || {};
  const rawMonths = (raw && typeof raw.months === "object" && raw.months) || {};

  for (const [key, m] of Object.entries(rawMonths)) {
    if (!isMonthKey(key)) {
      repariert.push("Monat „" + key + "“ hat keinen gültigen Schlüssel und wurde ausgelassen.");
      continue;
    }
    const base = emptyMonth();
    base.konten = leseKonten(m);
    base.kreditkarten = leseKarten(m?.kreditkarten, altLimits, key, repariert);

    for (const listName of ["dauerauftraege", "fixkosten", "ausgaben"]) {
      /* Bis Fassung 4 hiess "ausgaben" noch "rechnungen". Alte Dateien
         dürfen dadurch nicht ihre Einträge verlieren. */
      const roh = listName === "ausgaben" && !Array.isArray(m?.ausgaben) ? m?.rechnungen : m?.[listName];
      const list = Array.isArray(roh) ? roh : [];
      base[listName] = list
        .filter((x) => x && typeof x.name === "string" && x.name.trim())
        .map((x) => ({
          id: typeof x.id === "string" && x.id ? x.id : uid(),
          name: x.name.trim(),
          betrag: parseAmount(x.betrag),
          klasse: leseKlasse(x)
        }));
      if (base[listName].length !== list.length) {
        repariert.push("In " + monthLabel(key) + " wurden " + (list.length - base[listName].length) + " unvollständige Zeilen ausgelassen.");
      }
    }

    base.umbuchungen = leseUmbuchungen(m?.umbuchungen, base.konten);
    state.months[key] = base;
  }

  if (konvertiert > 0) {
    repariert.push(
      "Die festen Einnahmefelder wurden zu frei benennbaren Konten. Sie lassen "
      + "sich jetzt umbenennen, ergänzen und einzeln von der Berechnung ausnehmen."
    );
  }
  if (ausGelb > 0) {
    repariert.push(
      (ausGelb === 1 ? "Eine Zeile war" : ausGelb + " Zeilen waren")
      + " mit Gelb als „Investition gebunden“ markiert und heisst jetzt "
      + "„Investition blockiert“ (lila). Gelb steht neu für Sparen."
    );
  }

  if (Object.keys(state.months).length === 0) {
    const key = new Date().toISOString().slice(0, 7);
    state.months[key] = emptyMonth();
    state.currentMonth = key;
    return { state, repariert };
  }

  state.currentMonth = isMonthKey(raw?.currentMonth) && state.months[raw.currentMonth]
    ? raw.currentMonth
    : sortedMonths(state).pop();

  return { state, repariert };
}
