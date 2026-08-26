/**
 * Blaubuch — Rechenkern.
 *
 * Reine Funktionen ohne DOM, ohne Dateizugriff, ohne Electron.
 * Alles hier ist direkt testbar und wird von der Oberflaeche wie auch
 * von den Tests unveraendert benutzt.
 *
 * Fassung 6 bringt drei Aenderungen, die zusammengehoeren:
 *
 *  1. Konten sind Stammdaten. Ihr Saldo haengt am Monat, nicht am Konto.
 *  2. Jede Zeile weiss, von welchem Konto sie geht — und ob sie auf ein
 *     anderes eigenes Konto kommt. Dann ist sie eine Umbuchung und keine
 *     Ausgabe: das Geld hat das Vermoegen nicht verlassen.
 *  3. Klassifizierungen tragen eine Wirkung mit drei Werten statt eines
 *     Wahrheitswerts (siehe klassen.mjs).
 *
 * Punkt 2 behebt eine falsche Zahl, kein fehlendes Feature. Bis Fassung 4
 * galt `kosten = da + fix + kk + re`, und ein Dauerauftrag auf das eigene
 * Sparkonto senkte damit Restwert und Sparquote — ausgerechnet in der App,
 * die bei den Einnahmen sorgfaeltig darauf achtet, dass ein Darlehen die
 * Sparquote nicht schoent.
 */

import {
  STANDARD_KLASSE, TAG_ZU_KLASSE,
  leseKlassen, standardKlassen, klasseVon
} from "./klassen.mjs";

export {
  KLASSEN_FARBEN, FARB_KEYS, farbe, WIRKUNGEN, WIRKUNG_TITEL,
  STANDARD_KLASSEN, STANDARD_KLASSE, standardKlassen, klasseVon, leseKlassen
} from "./klassen.mjs";

export const SCHEMA_VERSION = 6;

/**
 * Woher eine Einnahme kommt. Entscheidet die Rechnung, nicht die
 * Beschriftung:
 *
 *   erwerb     verdientes Geld — und nur das zaehlt fuer die Sparquote
 *   geliehen   Fremdmittel, spaeter zurueckzuzahlen
 *   sonstige   erhoeht die Mittel, ist aber kein Erwerb (Geschenk, Rueckerstattung)
 *   durchlauf  gehoert mir gar nicht und zaehlt nirgends mit
 */
export const EINNAHME_ARTEN = ["erwerb", "geliehen", "sonstige", "durchlauf"];

export const EINNAHME_ART_TITEL = {
  erwerb: "Erwerbseinkommen",
  geliehen: "Geliehen",
  sonstige: "Sonstige Mittel",
  durchlauf: "Durchlaufgeld"
};

export const MONTH_NAMES = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember"
];

/**
 * Kein Limit vorgegeben — die Oberflaeche zeigt dann „Kein Limit gesetzt“.
 * Ein sinnvoller Wert haengt am eigenen Kartenvertrag.
 */
export const KEIN_LIMIT = 0;

/** Die Listen, in denen Buchungszeilen stehen. Reihenfolge ist Anzeigereihenfolge. */
export const ZEILEN_LISTEN = ["dauerauftraege", "fixkosten", "ausgaben"];

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

/**
 * Tag im Monat, oder null. Bewusst streng: ein unsinniger Wert wird
 * verworfen statt uebernommen — ein Liquiditaetsverlauf mit Tag 32 waere
 * schlimmer als einer ohne Tag.
 */
export function leseFaelligAm(raw) {
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 31 ? n : null;
}

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
 * Welcher Monat nach dem Loeschen anzuzeigen ist.
 *
 * Bevorzugt der naechstaeltere — man loescht meist den neuesten und will
 * dann dorthin, wo man herkam. Gibt es keinen aelteren, der aelteste der
 * verbliebenen. Ist nichts mehr da, null.
 *
 * Steht bewusst hier und nicht in der Oberflaeche: die frueher dort
 * stehende Fassung rechnete `rest.indexOf(key)` NACH dem Loeschen und
 * bekam deshalb immer -1 zurueck — `Math.max(0, -2)` ergab 0, also landete
 * jeder Loeschvorgang auf dem aeltesten Monat statt beim Nachbarn.
 */
export function nachbarMonat(keys, geloescht) {
  const rest = keys.filter((k) => k !== geloescht);
  if (rest.length === 0) return null;
  /* Monatsschluessel sind YYYY-MM — der Textvergleich ist zugleich der zeitliche. */
  const aeltere = rest.filter((k) => k < geloescht);
  return aeltere.length > 0 ? aeltere[aeltere.length - 1] : rest[0];
}

let idCounter = 0;
export function uid() {
  idCounter += 1;
  return "i" + Date.now().toString(36) + idCounter.toString(36) + Math.random().toString(36).slice(2, 6);
}

/* ------------------------------------------------------------------ *
 * Konten
 * ------------------------------------------------------------------ */

/**
 * Die Konten, die eine frische Installation mitbringt — und zugleich die
 * Umschluesselung der festen Bestandsfelder aus Fassung 4 und aelter.
 */
const KONTO_VORLAGE = [
  ["konto", "Kontostand"],
  ["bar", "Bargeld"]
];

export const standardKonten = () =>
  KONTO_VORLAGE.map(([, name]) => ({ id: uid(), name, institut: "", aktiv: true }));

const aktiveKonten = (state) => (state?.konten ?? []).filter((k) => k && k.aktiv !== false);

/** Alle Buchungszeilen eines Monats, quer ueber die drei Listen. */
export const alleZeilen = (month) =>
  ZEILEN_LISTEN.flatMap((name) => month?.[name] ?? []);

/**
 * Ist diese Zeile eine Umbuchung?
 *
 * Niklas' Regel, und sie ist besser als jede Faustregel ueber Betraege:
 * geht das Geld auf ein Konto, das Blaubuch fuehrt, ist es eine Umbuchung.
 * Geht es irgendwohin, wo Blaubuch nichts sieht, ist es eine Ausgabe.
 */
export function istUmbuchung(zeile, kontoIds) {
  return typeof zeile?.nachKonto === "string"
    && zeile.nachKonto !== ""
    && kontoIds.has(zeile.nachKonto)
    && zeile.nachKonto !== zeile.vonKonto;
}

/**
 * Saldo eines Kontos am Monatsende.
 *
 *   Anfangsbestand + Eingaenge − Ausgaenge ± Umbuchungen
 *
 * Durchlaufgeld bleibt aussen vor: es gehoert dem Anwender nicht und darf
 * seinen Kontostand nicht schoenen.
 */
export function kontoSaldo(state, month, kontoId) {
  const klassen = state?.klassen ?? standardKlassen();
  const kontoIds = new Set((state?.konten ?? []).map((k) => k.id));

  let saldo = parseAmount(month?.anfangsbestaende?.[kontoId]);

  for (const e of month?.einnahmen ?? []) {
    if (!e || e.aktiv === false || e.art === "durchlauf") continue;
    if (e.konto === kontoId) saldo += parseAmount(e.betrag);
  }

  for (const z of alleZeilen(month)) {
    if (!z || z.aktiv === false) continue;
    if (klasseVon(klassen, z.klasse).wirkung === "durchlauf") continue;
    const betrag = parseAmount(z.betrag);
    if (z.vonKonto === kontoId) saldo -= betrag;
    if (istUmbuchung(z, kontoIds) && z.nachKonto === kontoId) saldo += betrag;
  }

  for (const k of month?.kreditkarten ?? []) {
    if (k && k.vonKonto === kontoId) saldo -= parseAmount(k.betrag);
  }

  return toRappen(saldo);
}

/* ------------------------------------------------------------------ *
 * Summen
 * ------------------------------------------------------------------ */

/**
 * Summen eines Monats.
 *
 * Bewusst getrennt:
 *   bestand    was zu Monatsbeginn schon da war — kein Einkommen
 *   erwerb     was der Monat verdient hat
 *   geliehen   Fremdmittel, kein Einkommen und zurueckzuzahlen
 *   sonstige   erhoeht die Mittel, ist aber kein Erwerb
 *   einnahmen  alle verfuegbaren Mittel zusammen
 *
 * Die Sparquote rechnet gegen `erwerb`, nicht gegen `einnahmen`: sonst
 * verbessert ein hoher Kontostand oder ein Darlehen die Quote, ohne dass
 * ein Franken mehr verdient wurde.
 *
 * `umgebucht` steht neben den Kosten und nicht darin. `verloren` kommt aus
 * der Wirkung der Klassifizierungen — nicht aus ihrer Farbe.
 */
export function totals(state, month) {
  const klassen = state?.klassen ?? standardKlassen();
  const konten = aktiveKonten(state);
  const kontoIds = new Set((state?.konten ?? []).map((k) => k.id));

  const bestand = toRappen(
    konten.reduce((s, k) => s + parseAmount(month?.anfangsbestaende?.[k.id]), 0)
  );

  let erwerb = 0, geliehen = 0, sonstige = 0, durchlauf = 0;
  for (const e of month?.einnahmen ?? []) {
    if (!e || e.aktiv === false) continue;
    const betrag = parseAmount(e.betrag);
    if (e.art === "erwerb") erwerb += betrag;
    else if (e.art === "geliehen") geliehen += betrag;
    else if (e.art === "durchlauf") durchlauf += betrag;
    else sonstige += betrag;
  }
  const einnahmen = toRappen(bestand + erwerb + geliehen + sonstige);

  const byKlasse = {};
  for (const k of klassen) byKlasse[k.id] = 0;

  const bloecke = { dauerauftraege: 0, fixkosten: 0, ausgaben: 0 };
  let umgebucht = 0;

  for (const liste of ZEILEN_LISTEN) {
    for (const z of month?.[liste] ?? []) {
      if (!z || z.aktiv === false) continue;
      const betrag = parseAmount(z.betrag);
      const klasse = klasseVon(klassen, z.klasse);

      /* Durchlaufgeld faellt vor allem anderen heraus: es ist weder Kosten
         noch Umbuchung, es gehoert dem Anwender schlicht nicht. */
      if (klasse.wirkung === "durchlauf") { durchlauf += betrag; continue; }

      if (istUmbuchung(z, kontoIds)) { umgebucht = toRappen(umgebucht + betrag); continue; }

      bloecke[liste] = toRappen(bloecke[liste] + betrag);
      byKlasse[klasse.id] = toRappen((byKlasse[klasse.id] ?? 0) + betrag);
    }
  }

  const kk = toRappen((month?.kreditkarten ?? []).reduce((s, k) => s + parseAmount(k?.betrag), 0));
  /* Der Kartensaldo traegt kein eigenes Etikett und zaehlt als Ausgabe. */
  const standard = klasseVon(klassen, STANDARD_KLASSE);
  byKlasse[standard.id] = toRappen((byKlasse[standard.id] ?? 0) + kk);

  const da = bloecke.dauerauftraege;
  const fix = bloecke.fixkosten;
  const re = bloecke.ausgaben;
  const kosten = toRappen(da + fix + re + kk);

  const verloren = toRappen(
    klassen.filter((k) => k.wirkung === "verloren").reduce((s, k) => s + (byKlasse[k.id] ?? 0), 0)
  );

  const rest = toRappen(einnahmen - kosten);

  return {
    bestand, erwerb, geliehen, sonstige, einnahmen,
    da, fix, kk, re, kosten, rest,
    umgebucht, durchlauf: toRappen(durchlauf),
    byKlasse, verloren,
    /* Was ausgegeben, aber nicht verloren ist: angelegt oder gespart. */
    angelegt: toRappen(kosten - verloren),
    sparquote: erwerb > 0 ? (rest / erwerb) * 100 : null
  };
}

/* ------------------------------------------------------------------ *
 * Monate
 * ------------------------------------------------------------------ */

export function emptyMonth(state) {
  const anfangsbestaende = {};
  for (const k of state?.konten ?? []) anfangsbestaende[k.id] = 0;
  return {
    anfangsbestaende,
    einnahmen: [],
    dauerauftraege: [],
    fixkosten: [],
    kreditkarten: [],
    ausgaben: []
  };
}

/** Laeuft diese Zeile im angegebenen Monat noch? */
const laeuftNoch = (zeile, key) =>
  !isMonthKey(zeile?.laeuftBis) || !isMonthKey(key) || zeile.laeuftBis >= key;

/**
 * Neuer Monat auf Basis des zuletzt erfassten: wiederkehrende Posten werden
 * uebernommen, einmalige nicht.
 *
 * Der Endbestand des Vormonats steht als *Vorschlag* im Anfangsbestand —
 * nicht als Fortschreibung. Wer eine Buchung vergessen hat, korrigiert
 * damit eine Zahl, statt eine falsche Kette zu erben. Ohne `state` gibt es
 * keinen Vorschlag, dann faengt alles bei 0 an.
 */
export function monthFromPrevious(prev, neuerKey, state) {
  if (!prev) return emptyMonth(state);

  const uebernehmen = (liste) => (liste ?? [])
    .filter((z) => z && laeuftNoch(z, neuerKey))
    .map((z) => ({
      id: uid(),
      name: z.name,
      betrag: parseAmount(z.betrag),
      klasse: typeof z.klasse === "string" && z.klasse ? z.klasse : STANDARD_KLASSE,
      vonKonto: z.vonKonto ?? null,
      nachKonto: z.nachKonto ?? null,
      aktiv: z.aktiv !== false,
      faelligAm: leseFaelligAm(z.faelligAm),
      laeuftBis: isMonthKey(z.laeuftBis) ? z.laeuftBis : null,
      notiz: typeof z.notiz === "string" ? z.notiz : ""
    }));

  const anfangsbestaende = {};
  for (const k of state?.konten ?? []) {
    anfangsbestaende[k.id] = state ? kontoSaldo(state, prev, k.id) : 0;
  }

  return {
    anfangsbestaende,
    /* Erwerb wiederholt sich Monat fuer Monat. Geliehenes, Sonstiges und
       Durchlaufgeld sind Momentaufnahmen und fangen bei 0 an. */
    einnahmen: (prev.einnahmen ?? []).map((e) => ({
      id: uid(),
      name: e.name,
      betrag: e.art === "erwerb" ? parseAmount(e.betrag) : 0,
      art: EINNAHME_ARTEN.includes(e.art) ? e.art : "sonstige",
      konto: e.konto ?? null,
      aktiv: e.aktiv !== false,
      faelligAm: leseFaelligAm(e.faelligAm),
      notiz: typeof e.notiz === "string" ? e.notiz : ""
    })),
    dauerauftraege: uebernehmen(prev.dauerauftraege),
    fixkosten: uebernehmen(prev.fixkosten),
    /* Karten bleiben bestehen, der Saldo faengt bei 0 an — das Limit
       gehoert zum Kartenvertrag und aendert sich nicht monatlich. */
    kreditkarten: (prev.kreditkarten ?? []).map((k) => ({
      id: uid(), name: k.name, betrag: 0,
      limit: parseAmount(k.limit),
      vonKonto: k.vonKonto ?? null,
      notiz: typeof k.notiz === "string" ? k.notiz : ""
    })),
    ausgaben: []
  };
}

/* ------------------------------------------------------------------ *
 * Einlesen
 * ------------------------------------------------------------------ */

/**
 * Liest die Kreditkarten eines Monats.
 *
 * Zwei Formen kommen vor:
 *  - aktuell: eine Liste
 *  - bis Fassung 3: ein Objekt mit festen Schluesseln, die Limits lagen
 *    im Stammsatz.
 */
function leseKarten(roh, altLimits, monatsKey, standardKonto, repariert) {
  const bauen = (k) => ({
    id: typeof k.id === "string" && k.id ? k.id : uid(),
    name: k.name.trim(),
    betrag: parseAmount(k.betrag),
    limit: Math.max(KEIN_LIMIT, parseAmount(k.limit)),
    vonKonto: typeof k.vonKonto === "string" && k.vonKonto ? k.vonKonto : standardKonto,
    notiz: typeof k.notiz === "string" ? k.notiz : ""
  });

  if (Array.isArray(roh)) {
    const karten = roh.filter((k) => k && typeof k.name === "string" && k.name.trim()).map(bauen);
    if (karten.length !== roh.length) {
      repariert.push("In " + monthLabel(monatsKey) + " wurden "
        + (roh.length - karten.length) + " namenlose Kartenzeilen ausgelassen.");
    }
    return karten;
  }

  if (roh && typeof roh === "object") {
    const karten = Object.entries(roh).map(([schluessel, betrag]) => bauen({
      name: schluessel.charAt(0).toUpperCase() + schluessel.slice(1),
      betrag,
      limit: altLimits[schluessel]
    }));
    if (karten.length > 0) {
      repariert.push("Die Kreditkarten aus " + monthLabel(monatsKey)
        + " wurden in frei benennbare Zeilen umgewandelt.");
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
 *  - Die festen Einnahmefelder werden zu Konten und Einnahmezeilen.
 *  - Was „gelb“ war, bedeutete „Investition gebunden“. Heute ist Gelb die
 *    Farbe von Sparen, die alte Bedeutung heisst „Investition blockiert“
 *    und ist lila.
 *
 * Was migrate NICHT kann: erkennen, welche Dauerauftraege in Wahrheit
 * Umbuchungen auf eigene Konten sind. Blaubuch kennt das Zielkonto nicht.
 * Diese Zeilen muessen einmalig von Hand umgehaengt werden — das gehoert
 * in die Release-Notiz.
 */
export function migrate(raw) {
  const repariert = [];
  const klassen = leseKlassen(raw?.klassen);
  const kennungen = new Set(klassen.map((k) => k.id));

  /* Konten: Fassung 6 hat einen Stamm, aeltere nur zwei feste Felder. */
  let konten;
  let ausFestenFeldern = false;
  if (Array.isArray(raw?.konten) && raw.konten.some((k) => k && typeof k.name === "string" && k.name.trim())) {
    konten = raw.konten
      .filter((k) => k && typeof k.name === "string" && k.name.trim())
      .map((k) => ({
        id: typeof k.id === "string" && k.id ? k.id : uid(),
        name: k.name.trim(),
        institut: typeof k.institut === "string" ? k.institut : "",
        aktiv: k.aktiv !== false
      }));
  } else {
    konten = standardKonten();
    ausFestenFeldern = true;
  }
  const kontoIds = new Set(konten.map((k) => k.id));
  const standardKonto = konten[0]?.id ?? null;

  const state = {
    version: SCHEMA_VERSION,
    updatedAt: typeof raw?.updatedAt === "string" ? raw.updatedAt : new Date().toISOString(),
    currentMonth: null,
    klassen,
    konten,
    months: {}
  };

  let ausGelb = 0;

  const leseKlasse = (x) => {
    if (typeof x.klasse === "string" && kennungen.has(x.klasse)) return x.klasse;
    const ziel = typeof x.tag === "string" ? TAG_ZU_KLASSE[x.tag] : undefined;
    if (ziel && kennungen.has(ziel)) {
      if (x.tag === "gelb") ausGelb += 1;
      return ziel;
    }
    /* Im Zweifel gilt Geld als ausgegeben, nicht als angelegt. */
    return STANDARD_KLASSE;
  };

  const leseKontoRef = (wert, ersatz) =>
    typeof wert === "string" && kontoIds.has(wert) ? wert : ersatz;

  /** Fassung 6 hat Einnahmezeilen, aeltere ein Objekt mit festen Feldern. */
  const leseEinnahmen = (m) => {
    if (Array.isArray(m?.einnahmen)) {
      return m.einnahmen
        .filter((e) => e && typeof e.name === "string" && e.name.trim())
        .map((e) => ({
          id: typeof e.id === "string" && e.id ? e.id : uid(),
          name: e.name.trim(),
          betrag: parseAmount(e.betrag),
          art: EINNAHME_ARTEN.includes(e.art) ? e.art : "sonstige",
          konto: leseKontoRef(e.konto, standardKonto),
          aktiv: e.aktiv !== false,
          faelligAm: leseFaelligAm(e.faelligAm),
          notiz: typeof e.notiz === "string" ? e.notiz : ""
        }));
    }
    const e = (m && typeof m.einnahmen === "object" && m.einnahmen) || {};
    /* Alle drei wandern mit, auch die mit 0: sonst verschwindet nach dem
       Einlesen eine Zeile, die der Benutzer kennt. */
    return [
      ["Nettolohn", e.netto, "erwerb"],
      ["Spesen", e.spesen, "erwerb"],
      ["Geliehen", e.fremdschulden, "geliehen"]
    ].map(([name, betrag, art]) => ({
      id: uid(), name, betrag: parseAmount(betrag), art,
      konto: standardKonto, aktiv: true, faelligAm: null, notiz: ""
    }));
  };

  const leseAnfangsbestaende = (m) => {
    const aus = {};
    for (const k of konten) aus[k.id] = 0;
    if (m?.anfangsbestaende && typeof m.anfangsbestaende === "object") {
      for (const k of konten) aus[k.id] = parseAmount(m.anfangsbestaende[k.id]);
      return aus;
    }
    /* Fassung 4: `konto` und `bar` sind die Anfangsbestaende der beiden
       mitgelieferten Konten, in derselben Reihenfolge wie KONTO_VORLAGE. */
    const e = (m && typeof m.einnahmen === "object" && !Array.isArray(m.einnahmen) && m.einnahmen) || {};
    KONTO_VORLAGE.forEach(([feld], i) => {
      if (konten[i]) aus[konten[i].id] = parseAmount(e[feld]);
    });
    return aus;
  };

  const altLimits = (raw && typeof raw.limits === "object" && raw.limits) || {};
  const rawMonths = (raw && typeof raw.months === "object" && raw.months) || {};

  for (const [key, m] of Object.entries(rawMonths)) {
    if (!isMonthKey(key)) {
      repariert.push("Monat „" + key + "“ hat keinen gültigen Schlüssel und wurde ausgelassen.");
      continue;
    }
    const base = emptyMonth(state);
    base.anfangsbestaende = leseAnfangsbestaende(m);
    base.einnahmen = leseEinnahmen(m);
    base.kreditkarten = leseKarten(m?.kreditkarten, altLimits, key, standardKonto, repariert);

    for (const liste of ZEILEN_LISTEN) {
      /* Bis Fassung 4 hiess "ausgaben" noch "rechnungen". */
      const roh = liste === "ausgaben" && !Array.isArray(m?.ausgaben) ? m?.rechnungen : m?.[liste];
      const list = Array.isArray(roh) ? roh : [];
      base[liste] = list
        .filter((x) => x && typeof x.name === "string" && x.name.trim())
        .map((x) => ({
          id: typeof x.id === "string" && x.id ? x.id : uid(),
          name: x.name.trim(),
          betrag: parseAmount(x.betrag),
          klasse: leseKlasse(x),
          vonKonto: leseKontoRef(x.vonKonto, standardKonto),
          nachKonto: leseKontoRef(x.nachKonto, null),
          aktiv: x.aktiv !== false,
          faelligAm: leseFaelligAm(x.faelligAm),
          laeuftBis: isMonthKey(x.laeuftBis) ? x.laeuftBis : null,
          notiz: typeof x.notiz === "string" ? x.notiz : ""
        }));
      if (base[liste].length !== list.length) {
        repariert.push("In " + monthLabel(key) + " wurden "
          + (list.length - base[liste].length) + " unvollständige Zeilen ausgelassen.");
      }
    }

    state.months[key] = base;
  }

  if (ausFestenFeldern && Object.keys(state.months).length > 0) {
    repariert.push(
      "Die festen Einnahmefelder wurden zu Konten und Einnahmezeilen. Konten "
      + "lassen sich jetzt frei anlegen, benennen und einzeln von der Berechnung ausnehmen."
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
    state.months[key] = emptyMonth(state);
    state.currentMonth = key;
    return { state, repariert };
  }

  state.currentMonth = isMonthKey(raw?.currentMonth) && state.months[raw.currentMonth]
    ? raw.currentMonth
    : sortedMonths(state).pop();

  return { state, repariert };
}

/* ------------------------------------------------------------------ *
 * Analyse und Bericht
 * ------------------------------------------------------------------ */

/**
 * Beobachtungen zum Monat. Liefert Textbausteine statt fertigem Markup,
 * damit die Oberflaeche sie ohne innerHTML setzen kann.
 * Ein Baustein ist entweder ein String oder {b: "fett"}.
 */
export function buildInsights(state, monthKey) {
  const month = state.months[monthKey];
  const klassen = state.klassen ?? standardKlassen();
  const t = totals(state, month);
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
    const parts = ["Im Restwert stecken ", { b: formatCHF(t.bestand) }, " Bestand vom Monatsanfang"];
    if (t.geliehen > 0) {
      parts.push(" sowie ", { b: formatCHF(t.geliehen) }, " geliehenes Geld — beides ist kein Einkommen dieses Monats.");
    } else {
      parts.push(" — Bestand ist kein Einkommen dieses Monats.");
    }
    out.push({ kind: t.geliehen > 0 ? "warn" : "", parts });
  }

  /* Der Punkt, an dem sich Fassung 6 von 4 unterscheidet: eigenes Geld,
     das nur den Platz gewechselt hat, ist keine Ausgabe. */
  if (t.umgebucht > 0) {
    out.push({
      kind: "good",
      parts: [
        "Zwischen eigenen Konten umgebucht: ", { b: formatCHF(t.umgebucht) },
        " — zählt nicht als Kosten, das Geld hat dein Vermögen nicht verlassen."
      ]
    });
  }

  if (t.durchlauf > 0) {
    out.push({
      parts: [
        "Durchlaufgeld: ", { b: formatCHF(t.durchlauf) },
        " — fremdes Geld, zählt weder als Einkommen noch als Ausgabe."
      ]
    });
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
    const teile = klassen
      .filter((k) => k.wirkung === "erhalten" && (t.byKlasse[k.id] ?? 0) > 0)
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
    const pt = totals(state, state.months[keys[idx - 1]]);
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
  const konten = state.konten ?? [];
  const kontoIds = new Set(konten.map((k) => k.id));
  const kontoName = (id) => konten.find((k) => k.id === id)?.name ?? "unbekannt";
  const t = totals(state, month);
  const L = [];

  L.push("Analysiere meine Monatsbuchhaltung " + monthLabel(monthKey) + " (CHF) und gib mir konkrete Spar- und Optimierungstipps:");
  L.push("");

  L.push("KONTEN (Stand am Monatsende):");
  for (const k of konten) {
    L.push("- " + k.name + (k.institut ? " (" + k.institut + ")" : "") + ": "
      + formatCHF(kontoSaldo(state, month, k.id))
      + " — Anfangsbestand " + formatCHF(parseAmount(month.anfangsbestaende?.[k.id]))
      + (k.aktiv === false ? " [zählt nicht mit]" : ""));
  }
  L.push("");

  L.push("VERFÜGBARE MITTEL gesamt " + formatCHF(t.einnahmen) + ":");
  L.push("- Bestand zu Monatsbeginn: " + formatCHF(t.bestand) + " (kein Einkommen)");
  for (const e of month.einnahmen ?? []) {
    if (e.art === "durchlauf") continue;
    L.push("- " + e.name + " → " + kontoName(e.konto) + ": " + formatCHF(parseAmount(e.betrag))
      + " [" + (EINNAHME_ART_TITEL[e.art] ?? "Sonstige Mittel") + "]"
      + (e.aktiv === false ? " [zählt nicht mit]" : ""));
  }
  L.push("  → Erwerbseinkommen des Monats: " + formatCHF(t.erwerb));
  L.push("");

  const TITEL = { dauerauftraege: "DAUERAUFTRÄGE", fixkosten: "FIXKOSTEN", ausgaben: "AUSGABEN" };
  const SUMME = { dauerauftraege: t.da, fixkosten: t.fix, ausgaben: t.re };
  for (const liste of ZEILEN_LISTEN) {
    L.push(TITEL[liste] + " gesamt " + formatCHF(SUMME[liste]) + ":");
    const zeilen = month[liste] ?? [];
    if (zeilen.length === 0) L.push("- keine");
    for (const z of zeilen) {
      if (!parseAmount(z.betrag)) continue;
      const teile = [klasseVon(klassen, z.klasse).name];
      if (istUmbuchung(z, kontoIds)) teile.push("Umbuchung → " + kontoName(z.nachKonto) + ", keine Kosten");
      if (z.faelligAm) teile.push("am " + z.faelligAm + ".");
      if (z.aktiv === false) teile.push("pausiert");
      L.push("- " + z.name + ": " + formatCHF(parseAmount(z.betrag)) + " [" + teile.join(", ") + "]");
    }
    L.push("");
  }

  L.push("KREDITKARTEN gesamt " + formatCHF(t.kk) + ":");
  if ((month.kreditkarten ?? []).length === 0) L.push("- keine");
  for (const k of month.kreditkarten ?? []) {
    const limit = parseAmount(k.limit);
    L.push("- " + k.name + ": " + formatCHF(parseAmount(k.betrag))
      + (limit > KEIN_LIMIT ? " (Limit " + formatCHF(limit) + ")" : " (kein Limit gesetzt)"));
  }
  L.push("");

  L.push("GESAMTKOSTEN: " + formatCHF(t.kosten));
  if (t.umgebucht > 0) L.push("Zwischen eigenen Konten umgebucht (keine Kosten): " + formatCHF(t.umgebucht));
  if (t.durchlauf > 0) L.push("Durchlaufgeld (fremdes Geld, zählt nirgends): " + formatCHF(t.durchlauf));
  L.push("RESTWERT: " + formatCHF(t.rest));
  L.push("Sparquote auf Erwerbseinkommen: " + (t.sparquote === null ? "—" : t.sparquote.toFixed(1) + "%"));
  L.push("Davon nicht verloren (angelegt oder gespart): " + formatCHF(t.angelegt));
  for (const k of klassen) {
    if (k.wirkung === "erhalten" && (t.byKlasse[k.id] ?? 0) > 0) {
      L.push("- " + k.name + ": " + formatCHF(t.byKlasse[k.id]));
    }
  }
  return L.join("\n");
}
