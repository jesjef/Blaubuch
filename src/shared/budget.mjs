/**
 * Blaubuch — Rechenkern.
 *
 * Reine Funktionen ohne DOM, ohne Dateizugriff, ohne Electron.
 * Alles hier ist direkt testbar und wird von der Oberflaeche wie auch
 * von den Tests unveraendert benutzt.
 */

export const SCHEMA_VERSION = 4;

export const TAGS = ["rot", "gruen", "gelb"];

export const TAG_TITLE = {
  rot: "Konsum",
  gruen: "Investition (Kontrolle durch mich)",
  gelb: "Investition (blockiert)"
};

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
 * Bewusst getrennt:
 *   erwerb    — was der Monat tatsaechlich verdient hat (Netto + Spesen)
 *   bestand   — was schon da war (Konto + Bar), kein Einkommen
 *   geliehen  — Fremdschulden, kein Einkommen und spaeter zurueckzuzahlen
 *   einnahmen — alle verfuegbaren Mittel zusammen
 *
 * Die Sparquote rechnet gegen `erwerb`, nicht gegen `einnahmen`: sonst
 * verbessert ein hoher Kontostand oder ein Darlehen die Quote, ohne dass
 * ein Franken mehr verdient wurde.
 */
export function totals(month) {
  const e = month.einnahmen ?? {};
  const erwerb = toRappen(parseAmount(e.netto) + parseAmount(e.spesen));
  const bestand = toRappen(parseAmount(e.konto) + parseAmount(e.bar));
  const geliehen = parseAmount(e.fremdschulden);
  const einnahmen = toRappen(erwerb + bestand + geliehen);

  const sum = (list) => toRappen((list ?? []).reduce((s, x) => s + parseAmount(x.betrag), 0));
  const da = sum(month.dauerauftraege);
  const fix = sum(month.fixkosten);
  const re = sum(month.ausgaben);
  const kk = sum(month.kreditkarten);
  const kosten = toRappen(da + fix + kk + re);

  /* Kreditkartensaldo zaehlt als Konsum — er traegt kein eigenes Etikett. */
  const byTag = { rot: kk, gruen: 0, gelb: 0 };
  for (const x of [...(month.dauerauftraege ?? []), ...(month.fixkosten ?? []), ...(month.ausgaben ?? [])]) {
    const tag = TAGS.includes(x.tag) ? x.tag : "rot";
    byTag[tag] = toRappen(byTag[tag] + parseAmount(x.betrag));
  }

  const rest = toRappen(einnahmen - kosten);
  return {
    erwerb, bestand, geliehen, einnahmen,
    da, fix, kk, re, kosten, rest, byTag,
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
  const t = totals(month);
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

  const invest = toRappen(t.byTag.gruen + t.byTag.gelb);
  if (invest > 0) {
    out.push({
      kind: "good",
      parts: [
        "Investitionen: ", { b: formatCHF(invest) },
        " (" + formatCHF(t.byTag.gruen) + " kontrolliert, " + formatCHF(t.byTag.gelb) + " blockiert) — kein verlorenes Geld."
      ]
    });
  }

  const keys = sortedMonths(state);
  const idx = keys.indexOf(monthKey);
  if (idx > 0) {
    const pt = totals(state.months[keys[idx - 1]]);
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
  const t = totals(month);
  const L = [];

  L.push("Analysiere meine Monatsbuchhaltung " + monthLabel(monthKey) + " (CHF) und gib mir konkrete Spar- und Optimierungstipps:");
  L.push("");
  L.push("VERFÜGBARE MITTEL gesamt " + formatCHF(t.einnahmen) + ":");
  L.push("- Netto Gehalt: " + formatCHF(parseAmount(month.einnahmen.netto)));
  L.push("- Spesen: " + formatCHF(parseAmount(month.einnahmen.spesen)));
  L.push("  → Erwerbseinkommen des Monats: " + formatCHF(t.erwerb));
  L.push("- Konto aktuell (Bestand, kein Einkommen): " + formatCHF(parseAmount(month.einnahmen.konto)));
  L.push("- Bar (Bestand, kein Einkommen): " + formatCHF(parseAmount(month.einnahmen.bar)));
  L.push("- Fremdschulden (geliehen, rückzahlbar): " + formatCHF(t.geliehen));
  L.push("");
  L.push("DAUERAUFTRÄGE gesamt " + formatCHF(t.da) + ":");
  for (const x of month.dauerauftraege) {
    if (parseAmount(x.betrag)) L.push("- " + x.name + ": " + formatCHF(parseAmount(x.betrag)) + " [" + (TAG_TITLE[x.tag] ?? TAG_TITLE.rot) + "]");
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
  L.push("Investitionen kontrolliert: " + formatCHF(t.byTag.gruen) + " / blockiert: " + formatCHF(t.byTag.gelb));
  return L.join("\n");
}

let idCounter = 0;
export function uid() {
  idCounter += 1;
  return "i" + Date.now().toString(36) + idCounter.toString(36) + Math.random().toString(36).slice(2, 6);
}

export function emptyMonth() {
  return {
    einnahmen: { netto: 0, spesen: 0, konto: 0, bar: 0, fremdschulden: 0 },
    dauerauftraege: [],
    fixkosten: [],
    kreditkarten: [],
    ausgaben: []
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
    id: uid(), name: x.name, betrag: parseAmount(x.betrag), tag: TAGS.includes(x.tag) ? x.tag : "rot"
  }));
  return {
    einnahmen: {
      netto: parseAmount(prev.einnahmen?.netto),
      spesen: 0, konto: 0, bar: 0, fremdschulden: 0
    },
    dauerauftraege: copyList(prev.dauerauftraege),
    fixkosten: copyList(prev.fixkosten),
    /* Karten bleiben bestehen, der Saldo faengt bei 0 an — das Limit
       gehoert zum Kartenvertrag und aendert sich nicht monatlich. */
    kreditkarten: (prev.kreditkarten ?? []).map((k) => ({
      id: uid(), name: k.name, betrag: 0, limit: parseAmount(k.limit)
    })),
    ausgaben: []
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
 */
export function migrate(raw) {
  const repariert = [];
  const state = {
    version: SCHEMA_VERSION,
    updatedAt: typeof raw?.updatedAt === "string" ? raw.updatedAt : new Date().toISOString(),
    currentMonth: null,
    months: {}
  };

  /* Bis Fassung 3 gab es zwei fest benannte Karten und ihre Limits im
     Stammsatz. Beim Einlesen werden daraus gewoehnliche Kartenzeilen. */
  const altLimits = (raw && typeof raw.limits === "object" && raw.limits) || {};

  const rawMonths = (raw && typeof raw.months === "object" && raw.months) || {};
  for (const [key, m] of Object.entries(rawMonths)) {
    if (!isMonthKey(key)) { repariert.push("Monat „" + key + "“ hat keinen gültigen Schlüssel und wurde ausgelassen."); continue; }
    const base = emptyMonth();
    const e = m?.einnahmen ?? {};
    for (const f of Object.keys(base.einnahmen)) base.einnahmen[f] = parseAmount(e[f]);
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
          tag: TAGS.includes(x.tag) ? x.tag : "rot"
        }));
      if (base[listName].length !== list.length) {
        repariert.push("In " + monthLabel(key) + " wurden " + (list.length - base[listName].length) + " unvollständige Zeilen ausgelassen.");
      }
    }
    state.months[key] = base;
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
