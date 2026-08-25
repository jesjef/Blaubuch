/**
 * Blaubuch — Zugangsbildschirme.
 *
 * Sammelt Passwoerter ein und reicht sie an den Hauptprozess weiter.
 * Hier wird nichts entschluesselt und nichts zwischengespeichert: das
 * Passwort steht genau so lange im Eingabefeld, bis es verschickt ist.
 */

import { passwordStrength } from "../shared/password.mjs";

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

/** Ein Passwortfeld mit Beschriftung. */
function feld(labelText, id, autocomplete) {
  const wrap = el("div", "gate-field");
  const label = el("label", null, labelText);
  label.setAttribute("for", id);
  const input = document.createElement("input");
  input.type = "password";
  input.id = id;
  input.autocomplete = autocomplete;
  input.spellcheck = false;
  wrap.append(label, input);
  return { wrap, input };
}

/**
 * Baut einen Zugangsbildschirm und loest auf, wenn er beantwortet ist.
 *
 * @param {object} o
 * @param {string} o.titel
 * @param {string[]} o.text            Absaetze ueber dem Formular
 * @param {boolean} o.bestaetigen      zweites Feld zur Wiederholung
 * @param {boolean} o.altesPasswort    zusaetzliches Feld fuer das bisherige
 * @param {string} o.knopf
 * @param {(werte) => Promise<{ok:boolean, error?:string}>} o.absenden
 */
function bildschirm({ titel, text = [], bestaetigen = false, altesPasswort = false, kaestchen = null, knopf, absenden, ziel }) {
  return new Promise((resolve) => {
    ziel.textContent = "";

    const karte = el("section", "gate");
    karte.append(el("h1", null, titel));
    for (const absatz of text) karte.append(el("p", "gate-text", absatz));

    const form = el("form", "gate-form");
    const alt = altesPasswort ? feld("Bisheriges Passwort", "gate-alt", "current-password") : null;
    const eins = feld(bestaetigen ? "Neues Passwort" : "Passwort", "gate-pw", bestaetigen ? "new-password" : "current-password");
    const zwei = bestaetigen ? feld("Wiederholen", "gate-pw2", "new-password") : null;

    if (alt) form.append(alt.wrap);
    form.append(eins.wrap);
    if (zwei) form.append(zwei.wrap);

    const hinweis = el("p", "gate-strength");
    if (bestaetigen) {
      form.append(hinweis);
      eins.input.addEventListener("input", () => {
        const s = passwordStrength(eins.input.value);
        hinweis.textContent = s.text;
        hinweis.className = "gate-strength s-" + s.stufe;
      });
    }

    let haken = null;
    if (kaestchen) {
      const zeile = el("label", "gate-kaestchen");
      haken = document.createElement("input");
      haken.type = "checkbox";
      zeile.append(haken, document.createTextNode(" " + kaestchen));
      form.append(zeile);
    }

    const fehler = el("p", "gate-error");
    fehler.setAttribute("role", "alert");
    form.append(fehler);

    const senden = el("button", "gate-submit", knopf);
    senden.type = "submit";
    form.append(senden);
    karte.append(form);
    ziel.append(karte);

    (alt ?? eins).input.focus();

    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      fehler.textContent = "";

      if (bestaetigen && eins.input.value !== zwei.input.value) {
        fehler.textContent = "Die beiden Eingaben stimmen nicht überein.";
        zwei.input.focus();
        return;
      }
      if (eins.input.value.length === 0) {
        fehler.textContent = "Bitte ein Passwort eingeben.";
        return;
      }

      senden.disabled = true;
      const beschriftung = senden.textContent;
      senden.textContent = "Einen Moment …";

      const res = await absenden({
        passwort: eins.input.value,
        alt: alt ? alt.input.value : null,
        kaestchen: haken ? haken.checked : false
      });

      /* Eingabefelder leeren, sobald sie nicht mehr gebraucht werden.
         `beenden` schliesst den Bildschirm auch ohne Erfolg — etwa wenn
         es nach der Loeschung nichts mehr zu oeffnen gibt. */
      if (res.ok || res.beenden) {
        for (const f of [alt, eins, zwei]) if (f) f.input.value = "";
        resolve(res);
        return;
      }

      senden.disabled = false;
      senden.textContent = beschriftung;
      fehler.textContent = res.error;
      eins.input.select();
    });
  });
}

/** Reiner Hinweis mit einem einzigen Knopf. */
function hinweisBildschirm({ titel, text, knopf, ziel }) {
  return new Promise((resolve) => {
    ziel.textContent = "";
    const karte = el("section", "gate");
    karte.append(el("h1", null, titel));
    for (const absatz of text) karte.append(el("p", "gate-text", absatz));
    const ok = el("button", "gate-submit", knopf);
    ok.type = "button";
    ok.addEventListener("click", () => resolve());
    karte.append(ok);
    ziel.append(karte);
    ok.focus();
  });
}

/* ------------------------------------------------------------------ */

const FEHLERTEXT = {
  wrong_password: "Falsches Passwort.",
  not_a_vault: "Diese Datei ist kein Blaubuch-Tresor.",
  unsupported_version: "Die Datei stammt aus einer neueren Programmfassung.",
  unsupported_cipher: "Die Datei nutzt ein unbekanntes Verschlüsselungsverfahren.",
  bad_params: "Die Datei wurde verändert und lässt sich nicht mehr öffnen.",
  not_json: "Die Datei ist beschädigt.",
  no_file: "Die Datendatei wurde nicht gefunden."
};

const fehlertext = (res) => FEHLERTEXT[res.code] ?? (res.error || "Unbekannter Fehler.");

/**
 * Fuehrt durch alles, was vor dem ersten Blick auf die Zahlen noetig ist,
 * und liefert am Ende den entschluesselten Klartext.
 *
 * @param {() => string} startText  Inhalt fuer einen frisch angelegten Tresor
 * @returns {Promise<{text: string, neu: boolean}>}
 */
export async function openVault(startText, ziel) {
  const status = await window.blaubuch.vaultStatus();

  if (status.zustand === "verschluesselt") {
    const einleitung = ["Deine Daten liegen verschlüsselt auf dieser Festplatte."];
    if (status.loeschenNach > 0) {
      einleitung.push(
        status.rest <= status.warnenAbRest && status.fehlversuche > 0
          ? "Achtung: noch " + status.rest + " Versuch(e). Danach werden die Daten gelöscht."
          : "Nach " + status.loeschenNach + " Fehlversuchen werden die Daten gelöscht."
      );
    }

    const res = await bildschirm({
      ziel,
      titel: "Blaubuch öffnen",
      text: einleitung,
      knopf: "Öffnen",
      absenden: async ({ passwort }) => {
        const r = await window.blaubuch.unlock(passwort);
        if (r.ok) return { ok: true, text: r.text };
        if (r.code === "wiped") return { ok: false, beenden: true, geloescht: true };

        let meldung = fehlertext(r);
        if (r.rest !== null && r.rest !== undefined) {
          meldung += r.warnen
            ? " Noch " + r.rest + " Versuch(e), danach werden die Daten gelöscht."
            : " Verbleibende Versuche: " + r.rest + ".";
        }
        if (r.fehlversuche >= 3) meldung += " Jeder weitere Versuch dauert länger.";
        return { ok: false, error: meldung };
      }
    });

    if (res.geloescht) {
      await hinweisBildschirm({
        ziel,
        titel: "Daten gelöscht",
        text: [
          "Das Passwort wurde " + status.loeschenNach + " Mal falsch eingegeben. "
          + "Blaubuch hat den Tresor und alle Sicherungen gelöscht.",
          "Falls du eine Kopie gesichert hast, kannst du sie nach dem Neuanlegen "
          + "über „Daten einlesen …“ zurückholen — dafür brauchst du das Passwort, "
          + "mit dem die Kopie gesichert wurde."
        ],
        knopf: "Weiter"
      });
      return openVault(startText, ziel);   /* der Ordner ist jetzt leer */
    }
    return { text: res.text, neu: false };
  }

  if (status.zustand === "klartext") {
    const res = await bildschirm({
      ziel,
      titel: "Daten verschlüsseln",
      text: [
        "Es liegen Daten aus einer früheren Fassung ohne Verschlüsselung vor. "
        + "Lege ein Passwort fest, damit sie ab jetzt geschützt sind.",
        "Die bisherige unverschlüsselte Datei wird nicht gelöscht, sondern daneben "
        + "abgelegt — lösche sie selbst, sobald du sicher bist, dass alles passt.",
        "Für ein vergessenes Passwort gibt es keine Wiederherstellung."
      ],
      bestaetigen: true,
      knopf: "Verschlüsseln",
      absenden: async ({ passwort }) => {
        const r = await window.blaubuch.encryptExisting(passwort);
        if (!r.ok) return { ok: false, error: fehlertext(r) };
        const auf = await window.blaubuch.unlock(passwort);
        return auf.ok
          ? { ok: true, text: auf.text, altdatei: r.altdatei }
          : { ok: false, error: fehlertext(auf) };
      }
    });
    return { text: res.text, neu: false, altdatei: res.altdatei };
  }

  if (status.zustand === "beschaedigt" || status.zustand === "fehler") {
    const res = await bildschirm({
      ziel,
      titel: "Datei nicht lesbar",
      text: [
        "Die Datei " + status.path + " lässt sich nicht lesen. Sie wird nicht überschrieben.",
        "Im Unterordner „backups“ liegen ältere Stände, die du von Hand zurückkopieren kannst.",
        "Mit einem neuen Passwort startest du hier mit einem leeren Blaubuch."
      ],
      bestaetigen: true,
      knopf: "Neu beginnen",
      absenden: async ({ passwort }) => {
        const r = await window.blaubuch.createVault(passwort, startText());
        return r.ok ? { ok: true, text: null } : { ok: false, error: fehlertext(r) };
      }
    });
    return { text: res.text, neu: true };
  }

  /* zustand === "leer": erster Start */
  const res = await bildschirm({
    ziel,
    titel: "Willkommen bei Blaubuch",
    text: [
      "Blaubuch führt dein Monatsbudget — ausschliesslich auf diesem Rechner, "
      + "ohne Konto und ohne Netzwerkverbindung.",
      "Lege ein Passwort fest. Damit werden deine Zahlen auf der Festplatte verschlüsselt.",
      "Merke es dir gut: für ein vergessenes Passwort gibt es keine Wiederherstellung. "
      + "Eine lange Wortfolge ist sicherer und leichter zu merken als ein kurzes Kunstwort."
    ],
    bestaetigen: true,
    knopf: "Blaubuch anlegen",
    absenden: async ({ passwort }) => {
      const r = await window.blaubuch.createVault(passwort, startText());
      return r.ok ? { ok: true, text: null } : { ok: false, error: fehlertext(r) };
    }
  });
  return { text: res.text, neu: true };
}

/** Passwortwechsel. Liefert true, wenn gewechselt wurde. */
export async function changePassword(ziel) {
  const res = await bildschirm({
    ziel,
    titel: "Passwort ändern",
    text: [
      "Die Daten werden mit dem neuen Passwort neu verschlüsselt.",
      "Achtung: die automatischen Sicherungen im Datenordner bleiben mit dem "
      + "ALTEN Passwort lesbar. Ein Wechsel entwertet ein bekannt gewordenes "
      + "Passwort also nicht rückwirkend.",
      "Setze unten das Häkchen, wenn die alten Sicherungen dabei gelöscht werden "
      + "sollen — dann gibt es aber keinen Weg zurück auf einen früheren Stand.",
      "Von Hand gesicherte Kopien sind davon nicht betroffen."
    ],
    kaestchen: "Alte Sicherungen mitlöschen",
    altesPasswort: true,
    bestaetigen: true,
    knopf: "Ändern",
    absenden: async ({ alt, passwort, kaestchen }) => {
      const r = await window.blaubuch.changePassword(alt, passwort, kaestchen);
      return r.ok ? { ok: true } : { ok: false, error: fehlertext(r) };
    }
  });
  return res.ok;
}

/** Fragt nach dem Passwort einer fremden Datei, ohne den eigenen Tresor anzutasten. */
export async function askForeignPassword(text, ziel) {
  const res = await bildschirm({
    ziel,
    titel: "Verschlüsselte Datei",
    text: ["Diese Datei ist mit einem Passwort geschützt. Gib das Passwort ein, mit dem sie gesichert wurde."],
    knopf: "Einlesen",
    absenden: async ({ passwort }) => {
      const r = await window.blaubuch.decryptForeign(text, passwort);
      return r.ok ? { ok: true, text: r.text } : { ok: false, error: fehlertext(r) };
    }
  });
  return res.text;
}
