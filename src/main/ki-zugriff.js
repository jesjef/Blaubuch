/**
 * Blaubuch — KI-Zugriff im Hauptprozess (1.4.0, Stufe 1).
 *
 * Verbindet den MCP-Server (mcp.mjs) mit dem Programm:
 *
 *  - Standardmässig aus. Ein- und Ausschalten, Port und Zugangsschlüssel
 *    stehen in ki.json im Benutzerordner. Der Schlüssel liegt dort im
 *    Klartext — er ist kein Passwort, öffnet bei gesperrtem Tresor nichts
 *    und lässt sich jederzeit ersetzen.
 *  - Die Daten kommen aus dem Fenster: Dort lebt der Stand, den der
 *    Anwender sieht, samt ungespeicherter Änderungen. Kein zweiter Weg zur
 *    Tresordatei.
 *  - Das Abfrageprotokoll lebt nur im Speicher und enthält keine Beträge.
 *  - Vorschläge der KI (Stufe 2) leben ebenfalls nur im Speicher. Das
 *    Fenster zeigt sie an und wendet sie an, wenn der Anwender zustimmt;
 *    hier wird nur die Liste geführt. Sperren und Ausschalten leeren sie.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const { pathToFileURL } = require("node:url");

const STANDARD_PORT = 41041;
const PROTOKOLL_LAENGE = 50;
const ANTWORT_FRIST_MS = 3000;

let mcpPromise = null;
const mcp = () => (mcpPromise ??= import(pathToFileURL(path.join(__dirname, "mcp.mjs")).href));
let vorschlagsPromise = null;
const vorschlagsModul = () => (vorschlagsPromise ??=
  import(pathToFileURL(path.join(__dirname, "..", "shared", "vorschlaege.mjs")).href));

const neuerSchluessel = () => randomBytes(32).toString("base64url");
const gueltigerPort = (p) => Number.isInteger(p) && p >= 1024 && p <= 65535;

/**
 * @param {object} o
 * @param {Electron.App} o.app
 * @param {Electron.IpcMain} o.ipcMain
 * @param {(kanal: string, handler: Function) => void} o.handle  nur aus dem eigenen Fenster
 * @param {{entsperrt: boolean}} o.store
 * @param {() => string} o.verzeichnis  wo ki.json liegt
 * @param {() => Electron.BrowserWindow|null} o.fenster
 */
function richteKiZugriffEin({ app, ipcMain, handle, store, fenster, verzeichnis }) {
  const datei = () => path.join(verzeichnis(), "ki.json");

  function lese() {
    try {
      const o = JSON.parse(fs.readFileSync(datei(), "utf8"));
      return {
        an: o.an === true,
        port: gueltigerPort(o.port) ? o.port : STANDARD_PORT,
        token: typeof o.token === "string" && o.token.length >= 32 ? o.token : null
      };
    } catch {
      return { an: false, port: STANDARD_PORT, token: null };
    }
  }
  function schreibe(e) {
    fs.mkdirSync(path.dirname(datei()), { recursive: true });
    fs.writeFileSync(datei(), JSON.stringify(e, null, 2), { encoding: "utf8", mode: 0o600 });
  }

  let einstellung = lese();
  let server = null;
  let fehler = null;
  const protokoll = [];

  /* ---- Stand aus dem Fenster ---- */

  const offen = new Map();
  let naechste = 1;

  ipcMain.on("ki:stand-antwort", (ev, { id, text } = {}) => {
    const w = fenster();
    if (!w || w.isDestroyed() || ev.sender !== w.webContents) return;
    const wartend = offen.get(id);
    if (!wartend) return;
    offen.delete(id);
    clearTimeout(wartend.frist);
    if (typeof text !== "string") wartend.fehlschlag(new Error("kein Stand"));
    else {
      try { wartend.ok(JSON.parse(text)); } catch (e) { wartend.fehlschlag(e); }
    }
  });

  function stand() {
    const w = fenster();
    if (!w || w.isDestroyed()) return Promise.reject(new Error("kein Fenster"));
    return new Promise((ok, fehlschlag) => {
      const id = naechste++;
      const frist = setTimeout(() => { offen.delete(id); fehlschlag(new Error("Zeit abgelaufen")); }, ANTWORT_FRIST_MS);
      offen.set(id, { ok, fehlschlag, frist });
      w.webContents.send("ki:stand-anfrage", id);
    });
  }

  /* ---- Vorschläge ---- */

  /** Wird beim ersten Start geladen — vorher kann keine KI vorschlagen. */
  let liste = null;

  function meldeVorschlaege() {
    const w = fenster();
    if (w && !w.isDestroyed()) w.webContents.send("ki:vorschlaege", liste?.alle() ?? []);
  }

  /** Vorschläge vergessen — beim Sperren und beim Ausschalten. */
  function vergiss() {
    if (!liste?.alle().length) return;
    liste.leeren();
    meldeVorschlaege();
  }

  const dienst = {
    name: "blaubuch",
    version: app.getVersion(),
    entsperrt: () => store.entsperrt,
    stand,
    protokolliere: (e) => {
      protokoll.unshift(e);
      protokoll.length = Math.min(protokoll.length, PROTOKOLL_LAENGE);
    },
    schlageVor: (v) => {
      const e = liste.hinzufuegen(v);
      meldeVorschlaege();
      return e;
    },
    vorschlaege: () => liste?.alle() ?? []
  };

  /* ---- Server ---- */

  async function stoppe() {
    const s = server;
    server = null;
    if (s) await s.close();
  }

  async function starte() {
    await stoppe();
    fehler = null;
    if (!einstellung.an) return;
    try {
      liste ??= new (await vorschlagsModul()).Vorschlagsliste();
      const { starteServer } = await mcp();
      server = await starteServer({ port: einstellung.port, token: einstellung.token, dienst });
    } catch (e) {
      /* Kein stilles Ausweichen auf einen anderen Port: Die Clients sind
         auf diesen eingestellt. */
      fehler = e?.code === "EADDRINUSE"
        ? "Port " + einstellung.port + " ist belegt. Anderen Port wählen."
        : "Der KI-Zugriff liess sich nicht starten.";
    }
  }

  function status() {
    return {
      an: einstellung.an,
      laeuft: server !== null,
      port: einstellung.port,
      adresse: "http://127.0.0.1:" + einstellung.port + "/mcp",
      token: einstellung.an ? einstellung.token : null,
      fehler,
      protokoll: protokoll.slice()
    };
  }

  /* ---- Kanäle ---- */

  handle("ki:status", () => status());

  handle("ki:einschalten", async () => {
    einstellung = { ...einstellung, an: true, token: einstellung.token ?? neuerSchluessel() };
    schreibe(einstellung);
    await starte();
    return status();
  });

  handle("ki:ausschalten", async () => {
    einstellung = { ...einstellung, an: false };
    schreibe(einstellung);
    await stoppe();
    fehler = null;
    vergiss();
    return status();
  });

  handle("ki:vorschlaege", () => liste?.alle() ?? []);

  /* Das Fenster meldet, was der Anwender entschieden hat. */
  handle("ki:vorschlag-erledigt", (_ev, { id, status: neu } = {}) => {
    try {
      liste?.setzeStatus(String(id), String(neu));
      meldeVorschlaege();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  handle("ki:neuer-schluessel", async () => {
    einstellung = { ...einstellung, token: neuerSchluessel() };
    schreibe(einstellung);
    await starte();
    return status();
  });

  handle("ki:port", async (_ev, port) => {
    const p = Number(port);
    if (!gueltigerPort(p)) return { ...status(), fehler: "Port muss zwischen 1024 und 65535 liegen." };
    einstellung = { ...einstellung, port: p };
    schreibe(einstellung);
    await starte();
    return status();
  });

  app.on("will-quit", () => { void stoppe(); });

  return { starte, vergiss, dienst };
}

module.exports = { richteKiZugriffEin, STANDARD_PORT };
