/**
 * Blaubuch — Einstellungen.
 *
 * Alles, was nicht zum Erfassen gehört, liegt hier: Darstellung, Datei-
 * aktionen, Tresor. Das Dashboard bleibt dadurch frei für die Zahlen.
 *
 * Ein natives <dialog> statt einer selbstgebauten Überlagerung — es bringt
 * Fokusfang, Escape und die Hintergrundsperre mit.
 */

import { FARBSCHEMATA, leseFarbe, setzeFarbe, leseThema, setzeThema } from "./thema.mjs";
import { SPERR_ZEITEN, leseSperre, setzeSperre } from "./sperre.mjs";

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

const THEMEN = [
  { key: "system", name: "Wie das System" },
  { key: "light", name: "Hell" },
  { key: "dark", name: "Dunkel" }
];

/**
 * Eine Gruppe sich ausschliessender Schalter.
 * Bewusst Knöpfe statt <select>: die Wahl wirkt sofort und ist sichtbar.
 */
function wahlgruppe({ titel, optionen, aktuell, beiWahl, punkte = false }) {
  const block = el("section", "e-block");
  block.append(el("h3", null, titel));

  const reihe = el("div", "e-wahl");
  reihe.setAttribute("role", "radiogroup");
  reihe.setAttribute("aria-label", titel);

  const knoepfe = optionen.map((o) => {
    const k = el("button", "e-option");
    k.type = "button";
    k.setAttribute("role", "radio");
    k.dataset.key = o.key;

    if (punkte) {
      const punkt = el("span", "e-punkt");
      /* Der Punkt zeigt den Ton, den das Schema setzt — ohne ihn müsste
         man die Namen auswendig kennen. */
      punkt.style.background = "oklch(0.55 0.19 " + o.ton + ")";
      k.append(punkt);
    }
    k.append(el("span", null, o.name));

    k.addEventListener("click", () => {
      beiWahl(o.key);
      markiere(o.key);
    });
    return k;
  });

  const markiere = (key) => {
    for (const k of knoepfe) {
      const aktiv = k.dataset.key === key;
      k.classList.toggle("aktiv", aktiv);
      k.setAttribute("aria-checked", String(aktiv));
    }
  };
  markiere(aktuell);

  reihe.append(...knoepfe);
  block.append(reihe);
  return block;
}

/**
 * Fragezeichen mit Erklärung — dieselbe Machart wie an den Kartenköpfen.
 * Sichtbar auf Zeiger und auf Tastaturfokus.
 */
function hinweis(text, id) {
  const halter = el("span", "hinweis-halter");
  const marke = el("button", "hinweis-marke", "?");
  marke.type = "button";
  marke.setAttribute("aria-label", "Erklärung");
  marke.setAttribute("aria-describedby", id);

  const blase = el("span", "hinweis-blase", text);
  blase.id = id;
  blase.setAttribute("role", "tooltip");

  halter.append(marke, blase);
  return halter;
}

/** Eine Reihe Knöpfe mit Überschrift. */
function knopfgruppe(titel, beschreibung, knoepfe, erklaerung) {
  const block = el("section", "e-block");
  const kopf = el("h3", null, titel);
  block.append(kopf);
  if (erklaerung) kopf.append(" ", hinweis(erklaerung, "e-hinweis-" + titel.replace(/[^a-zA-Z]/g, "").toLowerCase()));
  if (beschreibung) block.append(el("p", "e-text", beschreibung));
  const reihe = el("div", "e-reihe");
  reihe.append(...knoepfe);
  block.append(reihe);
  return block;
}

function knopf(text, beiKlick, klasse = "btn-tool") {
  const k = el("button", klasse, text);
  k.type = "button";
  k.addEventListener("click", beiKlick);
  return k;
}

/* ------------------------------------------------------------------ *
 * KI-Zugriff
 * ------------------------------------------------------------------ */

const uhrzeit = (iso) => new Date(iso).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" });

/**
 * Der Block „KI-Zugriff“. Baut sich bei jedem Statuswechsel neu — der
 * Status kommt aus dem Hauptprozess, nicht aus einem Zustand hier.
 *
 * @param {object} ki  status, einschalten, ausschalten, neuerSchluessel, port, kopieren, beiStatus
 */
function baueKiBlock(ki) {
  const block = el("section", "e-block e-ki");
  const kopf = el("h3", null, "KI-Zugriff");
  kopf.append(" ", hinweis(
    "Eine KI wie Claude oder ein lokales Modell kann über MCP lesen, was in Blaubuch steht — "
    + "nur auf diesem Rechner (127.0.0.1), nur mit dem Zugangsschlüssel und nur, solange "
    + "Blaubuch entsperrt ist. Ändern kann sie nichts selbst — ihre Vorschläge erscheinen oben "
    + "in Blaubuch und gelten erst, wenn du sie annimmst.",
    "hinweis-ki"));
  const inhalt = el("div", "e-ki-inhalt");
  block.append(kopf, inhalt);

  async function zeige(status) {
    if (!status) return;
    ki.beiStatus?.(status);
    inhalt.textContent = "";

    if (!status.an) {
      inhalt.append(el("p", "e-text",
        "Aus. Eingeschaltet kann eine KI deine Monate lesen und auswerten. "
        + "Mit Claude gehen die abgefragten Zahlen an Anthropic; mit einem lokalen Modell "
        + "bleibt alles auf diesem Rechner."));
      const reihe = el("div", "e-reihe");
      reihe.append(knopf("Einschalten …", async () => zeige(await ki.einschalten())));
      inhalt.append(reihe);
      return;
    }

    const zeile = el("p", "e-text e-ki-status");
    if (status.fehler) {
      zeile.classList.add("fehler");
      zeile.textContent = status.fehler;
    } else {
      zeile.textContent = "An · ";
      zeile.append(el("code", null, status.adresse));
    }
    inhalt.append(zeile);

    /* Der Schluessel bleibt verdeckt, bis er gebraucht wird. */
    const schluessel = el("div", "e-ki-schluessel");
    const feld = el("input");
    feld.type = "password";
    feld.readOnly = true;
    feld.value = status.token ?? "";
    feld.setAttribute("aria-label", "Zugangsschlüssel");
    feld.spellcheck = false;
    const zeigen = knopf("Anzeigen", () => {
      const verdeckt = feld.type === "password";
      feld.type = verdeckt ? "text" : "password";
      zeigen.textContent = verdeckt ? "Verbergen" : "Anzeigen";
    });
    schluessel.append(feld, zeigen);
    inhalt.append(schluessel);

    const befehl = "claude mcp add --transport http blaubuch " + status.adresse
      + " --header \"Authorization: Bearer " + status.token + "\"";

    const reihe = el("div", "e-reihe");
    reihe.append(
      knopf("Befehl für Claude Code kopieren", () => ki.kopieren(befehl, "Befehl für Claude Code kopiert")),
      knopf("Schlüssel kopieren", () => ki.kopieren(status.token, "Zugangsschlüssel kopiert")),
      knopf("Neuer Schlüssel", async () => zeige(await ki.neuerSchluessel())),
      knopf("Ausschalten", async () => zeige(await ki.ausschalten()))
    );
    inhalt.append(reihe);

    const portForm = el("form", "e-ki-port");
    const portLabel = el("label", null, "Port ");
    const portFeld = el("input");
    portFeld.type = "number";
    portFeld.min = "1024";
    portFeld.max = "65535";
    portFeld.value = String(status.port);
    portLabel.append(portFeld);
    const portKnopf = el("button", "btn-tool", "Übernehmen");
    portKnopf.type = "submit";
    portForm.append(portLabel, portKnopf);
    portForm.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      await zeige(await ki.port(Number(portFeld.value)));
    });
    inhalt.append(portForm);

    inhalt.append(el("p", "e-text",
      "Der Schlüssel liegt unverschlüsselt in den Programmeinstellungen. Er ist kein Passwort: "
      + "Bei gesperrtem Tresor öffnet er nichts, und „Neuer Schlüssel“ macht den alten sofort ungültig."));

    /* Was gefragt wurde — ohne Beträge, nur im Speicher. */
    const liste = el("ol", "e-ki-protokoll");
    liste.setAttribute("aria-label", "Letzte Abfragen");
    for (const e of (status.protokoll ?? []).slice(0, 10)) {
      liste.append(el("li", null, uhrzeit(e.zeit) + "  " + e.werkzeug + (e.monat ? "  " + e.monat : "")));
    }
    if (liste.childElementCount === 0) liste.append(el("li", "leer", "Noch keine Abfragen."));
    inhalt.append(el("h4", null, "Letzte Abfragen"), liste);
  }

  return { block, aktualisiere: async () => zeige(await ki.status()) };
}

/**
 * Baut den Dialog und gibt eine Funktion zum Öffnen zurück.
 *
 * @param {object} aktionen  Rückrufe der Oberfläche
 */
export function baueEinstellungen(aktionen) {
  const dialog = document.createElement("dialog");
  dialog.className = "einstellungen";
  dialog.setAttribute("aria-label", "Einstellungen");

  const kopf = el("header", "e-kopf");
  kopf.append(el("h2", null, "Einstellungen"));
  const schliessen = el("button", "icon", "×");
  schliessen.type = "button";
  schliessen.setAttribute("aria-label", "Einstellungen schliessen");
  schliessen.addEventListener("click", () => dialog.close());
  kopf.append(schliessen);

  const koerper = el("div", "e-koerper");

  koerper.append(wahlgruppe({
    titel: "Darstellung",
    optionen: THEMEN,
    aktuell: leseThema(),
    beiWahl: (k) => { setzeThema(k); aktionen.beiDarstellung?.(); }
  }));

  koerper.append(wahlgruppe({
    titel: "Farbe",
    optionen: FARBSCHEMATA,
    aktuell: leseFarbe(),
    beiWahl: setzeFarbe,
    punkte: true
  }));

  const farbHinweis = el("p", "e-text",
    "Das Schema setzt nur den Farbton. Helligkeit und Kontrast bleiben gleich — "
    + "und Rot, Grün und Gelb bleiben den Markierungen vorbehalten.");
  koerper.lastChild.append(farbHinweis);

  /* Klassifizierungen sind Stammdaten und aendern sich selten — sie
     gehoeren nicht auf das Dashboard. Den Inhalt baut die Oberflaeche,
     weil nur sie den Zustand kennt; hier steht nur das Fach dafuer. */
  const klassenBlock = el("section", "e-block");
  klassenBlock.append(el("h3", null, "Klassifizierungen"));
  klassenBlock.lastChild.append(hinweis(
    "Die Wirkung entscheidet die Rechnung, nicht die Farbe: „verloren“ mindert das "
    + "Vermögen, „erhalten“ verschiebt es nur, „durchlauf“ gehört dir gar nicht. "
    + "Gelöscht wird nicht — eine stillgelegte Klasse verschwindet aus der Auswahl, "
    + "bleibt aber an alten Zeilen.",
    "hinweis-klassen"));
  const klassenHalter = el("div", "e-klassen");
  klassenBlock.append(klassenHalter);
  koerper.append(klassenBlock);

  /* Der Zustand kann sich seit dem letzten Aufbau geaendert haben. */
  function baueKlassen() {
    klassenHalter.textContent = "";
    const inhalt = aktionen.klassenEditor?.();
    klassenBlock.hidden = !inhalt;
    if (inhalt) klassenHalter.append(inhalt);
  }

  koerper.append(knopfgruppe("Monat", null, [
    knopf("Bericht kopieren", () => aktionen.bericht(), "btn-report"),
    knopf("Diesen Monat löschen …", () => { dialog.close(); aktionen.monatLoeschen(); })
  ]));

  koerper.append(knopfgruppe("Daten", "Sicherungen liegen verschlüsselt im Datenordner.", [
    knopf("Verschlüsselte Kopie sichern …", () => aktionen.kopieSichern(false)),
    knopf("Unverschlüsselte Kopie …", () => aktionen.kopieSichern(true)),
    knopf("Auszug als Markdown …", () => aktionen.auszug()),
    knopf("Daten einlesen …", () => { dialog.close(); aktionen.einlesen(); }),
    knopf("Datenordner öffnen", () => aktionen.ordner())
  ]));

  koerper.append(wahlgruppe({
    titel: "Automatisch sperren",
    optionen: SPERR_ZEITEN,
    aktuell: leseSperre(),
    beiWahl: (k) => { setzeSperre(k); aktionen.beiSperrzeit?.(); }
  }));
  koerper.lastChild.append(el("p", "e-text",
    "Nach dieser Zeit ohne Eingabe wird gespeichert und der Tresor geschlossen. "
    + "Zum Weiterarbeiten ist dann wieder das Passwort nötig."));

  const kiBlock = aktionen.ki ? baueKiBlock(aktionen.ki) : null;
  if (kiBlock) koerper.append(kiBlock.block);

  koerper.append(knopfgruppe("Tresor", "Für ein vergessenes Passwort gibt es keine Wiederherstellung.", [
    knopf("Passwort ändern …", () => { dialog.close(); aktionen.passwort(); }),
    knopf("Jetzt sperren", () => { dialog.close(); aktionen.sperren(); })
  ]));

  /* Bewusst am Ende und ohne erklaerenden Dauertext: was hier steht, ist
     unwiderruflich. Die Erklaerung haengt am Fragezeichen. */
  koerper.append(knopfgruppe("Zurücksetzen", null, [
    knopf("Einträge löschen", () => { dialog.close(); aktionen.datenLoeschen(); }, "btn-tool danger"),
    knopf("Konto zurücksetzen", () => { dialog.close(); aktionen.kontoZuruecksetzen(); }, "btn-tool danger")
  ],
    "„Einträge löschen“ leert alle Monate, behält aber Passwort und Tresor — rückgängig zu machen. "
    + "„Konto zurücksetzen“ löscht Tresor, Sicherungen und Passwort: danach steht das Programm wie frisch installiert da, "
    + "und ohne gesicherte Kopie sind die Daten weg."));

  const fuss = el("p", "e-fuss");
  koerper.append(fuss);

  dialog.append(kopf, koerper);
  document.body.append(dialog);

  /* Klick auf die Fläche neben dem Dialog schliesst ihn. */
  dialog.addEventListener("click", (ev) => {
    if (ev.target === dialog) dialog.close();
  });

  return {
    oeffnen(info) {
      baueKlassen();
      void kiBlock?.aktualisiere();
      fuss.textContent = info
        ? "Blaubuch " + info.version + " · Daten: " + info.dataPath
        : "";
      dialog.showModal();
    },
    /* Nach einer Aenderung an den Klassifizierungen: nur dieses Fach neu
       bauen. Der Dialog bleibt offen — showModal ein zweites Mal waere
       ein Fehler, und der Benutzer verloere seine Stelle. */
    aktualisiereKlassen: baueKlassen,
    schliessen: () => dialog.close()
  };
}
