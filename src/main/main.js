/**
 * Blaubuch — Hauptprozess.
 *
 * Haelt das Fenster, das Menue und die Ablage. Die Oberflaeche bekommt
 * keinen Node-Zugriff und kennt den Schluessel nicht; sie spricht ueber
 * die schmale Bruecke in preload.js mit diesem Prozess.
 */

"use strict";

const { app, BrowserWindow, ipcMain, dialog, shell, Menu, clipboard, nativeTheme } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { Store, DATA_NAME } = require("./store");

let mainWindow = null;
let darfSchliessen = false;
let schliessTimer = null;

/* ------------------------------------------------------------------ *
 * Ablageort
 * ------------------------------------------------------------------ */

/**
 * Neben der .exe gewinnt eine dort liegende blaubuch.json — so laesst sich
 * das Programm mitsamt Daten auf einen Stick legen. Sonst der uebliche
 * Benutzerordner.
 */
function resolveDataDir() {
  if (process.env.BLAUBUCH_DATA) return process.env.BLAUBUCH_DATA;
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
  if (portableDir && fs.existsSync(path.join(portableDir, DATA_NAME))) return portableDir;
  return app.getPath("userData");
}

const store = new Store(resolveDataDir);
const windowFile = () => path.join(app.getPath("userData"), "window.json");

async function revealData() {
  if (fs.existsSync(store.datei)) shell.showItemInFolder(store.datei);
  else await shell.openPath(resolveDataDir());
}

/* ------------------------------------------------------------------ *
 * IPC — bewusst wenige, eng geschnittene Kanaele
 * ------------------------------------------------------------------ */

/**
 * Nimmt nur Aufrufe aus dem eigenen Fenster entgegen.
 *
 * Heute gibt es kein zweites: keine Rahmen, keine eingebetteten Seiten,
 * und die CSP verbietet ohnehin alles Fremde. Die Pruefung kostet nichts
 * und haelt den Kanal auch dann eng, wenn spaeter jemand ein Fenster
 * hinzufuegt, ohne an diese Datei zu denken.
 */
function nurEigenesFenster(handler) {
  return (ev, ...rest) => {
    if (!mainWindow || mainWindow.isDestroyed() || ev.sender !== mainWindow.webContents) {
      return { ok: false, code: "fremder_absender", error: "Aufruf aus einem unbekannten Fenster." };
    }
    return handler(ev, ...rest);
  };
}
const handle = (kanal, handler) => ipcMain.handle(kanal, nurEigenesFenster(handler));

handle("vault:status", () => store.status());
handle("vault:unlock", (_ev, password) => store.unlock(String(password ?? "")));
handle("vault:create", (_ev, { password, text }) => store.create(String(password ?? ""), String(text ?? "")));
handle("vault:encrypt-existing", (_ev, password) => store.encryptExisting(String(password ?? "")));
handle("vault:change-password", (_ev, { alt, neu, sicherungenLoeschen }) =>
  store.changePassword(String(alt ?? ""), String(neu ?? ""), { sicherungenLoeschen: sicherungenLoeschen === true }));
handle("vault:lock", () => { store.lock(); return { ok: true }; });

/**
 * Vollstaendiges Zuruecksetzen: Tresor, Sicherungen, Zaehler und
 * liegengebliebene Klartextreste werden ueberschrieben und entfernt.
 * Danach steht das Programm wie bei einer frischen Installation da.
 */
handle("vault:reset", async () => {
  try {
    /* wipeByUser statt wipe: das vollstaendige Zuruecksetzen gehoert hinter
       das Passwort. Die Loeschung nach zehn Fehlversuchen ist der andere,
       bewusst gewaehlte Weg — sie laeuft in store.unlock. */
    return await store.wipeByUser();
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

handle("store:write", (_ev, text) => store.write(String(text ?? "")));

handle("store:reveal", async () => { await revealData(); return { ok: true }; });

handle("store:export", async (_ev, { text, klartext }) => {
  const wann = new Date().toISOString().slice(0, 10);
  const vorschlag = klartext ? "blaubuch-klartext-" + wann + ".json" : "blaubuch-" + wann + ".json";

  if (klartext) {
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: "warning",
      buttons: ["Trotzdem sichern", "Abbrechen"],
      defaultId: 1,
      cancelId: 1,
      title: "Unverschlüsselt sichern",
      message: "Diese Kopie ist für jeden lesbar.",
      detail: "Alle Beträge, Namen und Salden stehen im Klartext in der Datei. "
        + "Sinnvoll nur zum Prüfen der Daten — nicht als Sicherung und nicht in einem Cloud-Ordner."
    });
    if (response !== 0) return { ok: false, canceled: true };
  }

  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: klartext ? "Unverschlüsselte Kopie sichern" : "Verschlüsselte Kopie sichern",
    defaultPath: path.join(app.getPath("documents"), vorschlag),
    filters: [{ name: "Blaubuch-Daten", extensions: ["json"] }]
  });
  if (canceled || !filePath) return { ok: false, canceled: true };

  return klartext
    ? store.exportPlain(String(text ?? ""), filePath)
    : store.exportEncrypted(String(text ?? ""), filePath);
});

handle("store:import", async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: "Blaubuch-Daten einlesen",
    properties: ["openFile"],
    filters: [{ name: "Blaubuch-Daten", extensions: ["json"] }]
  });
  if (canceled || filePaths.length === 0) return { ok: false, canceled: true };
  return store.readForImport(filePaths[0]);
});

handle("store:decrypt-foreign", (_ev, { text, password }) =>
  store.decryptForeign(String(text ?? ""), String(password ?? "")));

handle("clipboard:write", (_ev, text) => {
  clipboard.writeText(String(text ?? ""));
  return { ok: true };
});

handle("app:info", () => ({
  version: app.getVersion(),
  dataPath: store.datei,
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  node: process.versions.node
}));

handle("dialog:confirm", async (_ev, { title, message, detail, confirmLabel }) => {
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: "question",
    buttons: [confirmLabel || "Fortfahren", "Abbrechen"],
    defaultId: 1,
    cancelId: 1,
    title: title || "Blaubuch",
    message: message || "",
    detail: detail || ""
  });
  return response === 0;
});

let beendenLaeuft = false;

ipcMain.on("app:ready-to-close", () => {
  clearTimeout(schliessTimer);
  schliessTimer = null;
  darfSchliessen = true;
  if (beendenLaeuft) app.quit();
  else if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
});

/**
 * Unter macOS beendet Cmd+Q das Programm ueber `before-quit`, nicht ueber
 * das Schliessen des Fensters. Ohne diesen Haken ginge die letzte Aenderung
 * dabei verloren — und ein `preventDefault` im Fenster-Handler wuerde das
 * Beenden sogar ganz abbrechen.
 */
app.on("before-quit", (event) => {
  if (darfSchliessen || beendenLaeuft || !mainWindow || mainWindow.isDestroyed()) return;
  event.preventDefault();
  beendenLaeuft = true;
  mainWindow.webContents.send("app:flush-close");
  schliessTimer = setTimeout(() => { darfSchliessen = true; app.quit(); }, 2000);
});

function erlaubeSchliessen() {
  clearTimeout(schliessTimer);
  schliessTimer = null;
  darfSchliessen = true;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
}

/* ------------------------------------------------------------------ *
 * Fenster
 * ------------------------------------------------------------------ */

function readWindowState() {
  try {
    const s = JSON.parse(fs.readFileSync(windowFile(), "utf8"));
    /* Auch x und y pruefen: eine verkorkste Datei koennte das Fenster
       sonst ausserhalb jedes Bildschirms aufziehen, und das Programm
       waere von aussen nicht von „startet nicht" zu unterscheiden. */
    const zahl = (v) => v === undefined || Number.isFinite(v);
    if (Number.isFinite(s.width) && Number.isFinite(s.height) && zahl(s.x) && zahl(s.y)) return s;
  } catch { /* erster Start */ }
  return { width: 1180, height: 900 };
}

function saveWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const b = mainWindow.getNormalBounds();
  try {
    fs.writeFileSync(windowFile(), JSON.stringify({ ...b, maximized: mainWindow.isMaximized() }), "utf8");
  } catch { /* nicht schlimm */ }
}

function createWindow() {
  const s = readWindowState();
  mainWindow = new BrowserWindow({
    width: s.width,
    height: s.height,
    x: s.x,
    y: s.y,
    minWidth: 420,
    minHeight: 560,
    title: "Blaubuch",
    /* Die Flaeche, die vor dem ersten Bild zu sehen ist. Fest hell wuerde
       im Dunkelmodus kurz aufblitzen. Die Oberflaeche kann ihre eigene
       Wahl noch nicht kennen — die Systemeinstellung ist die beste
       Naeherung, und sie stimmt in der Voreinstellung ohnehin. */
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0C1128" : "#F4F6FD",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false
    }
  });

  if (s.maximized) mainWindow.maximize();
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("closed", () => { mainWindow = null; });

  /**
   * Erst speichern, dann schliessen. Der erste Schliessversuch wird
   * angehalten, die Oberflaeche schreibt ihre letzte Aenderung weg und
   * meldet sich zurueck. Antwortet sie nicht, wird nach zwei Sekunden
   * trotzdem geschlossen — ein haengendes Fenster waere schlimmer.
   */
  mainWindow.on("close", (event) => {
    saveWindowState();
    if (darfSchliessen) return;
    event.preventDefault();
    if (schliessTimer) return;
    mainWindow.webContents.send("app:flush-close");
    schliessTimer = setTimeout(erlaubeSchliessen, 2000);
  });

  /* Die App ist rein lokal und enthaelt keinen einzigen Verweis nach
     aussen. Frueher wurden https-Adressen hier an den Systembrowser
     weitergereicht — das war ein Weg an der CSP vorbei: sie verbietet dem
     Fenster jede Netzwerkverbindung, ueber diesen Handler haette sich
     trotzdem etwas hinausschicken lassen. Es gibt nichts zu oeffnen,
     also wird nichts geoeffnet. */
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url !== mainWindow.webContents.getURL()) event.preventDefault();
  });
  /* Kein Nachladen von aussen — die Oberflaeche bringt alles mit. */
  mainWindow.webContents.session.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  /* Nicht jede Berechtigung wird erfragt — manche werden nur geprueft.
     Ohne diesen zweiten Handler gilt fuer die die Voreinstellung. */
  mainWindow.webContents.session.setPermissionCheckHandler(() => false);

  /* Mit BLAUBUCH_DEBUG=1 landen Meldungen der Oberflaeche auf der Konsole.
     Hilfreich beim Entwickeln, im Normalbetrieb still. */
  if (process.env.BLAUBUCH_DEBUG) {
    mainWindow.webContents.on("console-message", (ev) => {
      console.log("[oberflaeche]", ev.level + ":", ev.message, "(" + ev.sourceId + ":" + ev.lineNumber + ")");
    });
    mainWindow.webContents.on("render-process-gone", (_ev, details) => {
      console.log("[oberflaeche] abgestuerzt:", JSON.stringify(details));
    });
    mainWindow.webContents.on("did-fail-load", (_ev, code, beschreibung, url) => {
      console.log("[oberflaeche] nicht geladen:", code, beschreibung, url);
    });
  }

  mainWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
}

/* ------------------------------------------------------------------ *
 * Menue
 * ------------------------------------------------------------------ */

const istMac = process.platform === "darwin";
const send = (kanal) => () => mainWindow?.webContents.send(kanal);

/**
 * Auf macOS erwartet das System als erstes Menue das mit dem Programmnamen.
 * Electron legt es nicht von selbst an — ohne dieses Menue gaebe es weder
 * „Über“ noch Cmd+Q an der gewohnten Stelle.
 */
function macAppMenue() {
  return {
    label: "Blaubuch",
    submenu: [
      { label: "Über Blaubuch", click: zeigeUeber },
      { type: "separator" },
      { role: "hide", label: "Blaubuch ausblenden" },
      { role: "hideOthers", label: "Andere ausblenden" },
      { role: "unhide", label: "Alle einblenden" },
      { type: "separator" },
      { role: "quit", label: "Blaubuch beenden" }
    ]
  };
}

function zeigeUeber() {
  dialog.showMessageBox(mainWindow, {
    type: "info",
    title: "Über Blaubuch",
    message: "Blaubuch " + app.getVersion(),
    detail: [
      "Monatsbudget für den Schweizer Alltag. Läuft vollständig lokal,",
      "ohne Konto und ohne Netzwerkverbindung. Die Daten liegen mit",
      "AES-256-GCM verschlüsselt auf dieser Festplatte.",
      "",
      "Daten: " + store.datei,
      "Electron " + process.versions.electron + " · Chrome " + process.versions.chrome
    ].join("\n"),
    buttons: ["Schliessen"]
  });
}

function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(istMac ? [macAppMenue()] : []),
    {
      label: "Datei",
      submenu: [
        { label: "Speichern", accelerator: "CmdOrCtrl+S", click: send("menu:save") },
        { type: "separator" },
        { label: "Verschlüsselte Kopie sichern …", click: send("menu:export") },
        { label: "Unverschlüsselte Kopie sichern …", click: send("menu:export-plain") },
        { label: "Daten einlesen …", click: send("menu:import") },
        { type: "separator" },
        { label: "Datenordner öffnen", click: revealData },
        /* Auf macOS liegt „Beenden“ im Programmmenue, nicht unter „Datei“. */
        ...(istMac ? [] : [{ type: "separator" }, { role: "quit", label: "Beenden" }])
      ]
    },
    {
      label: "Bearbeiten",
      submenu: [
        { label: "Rückgängig", accelerator: "CmdOrCtrl+Z", click: send("menu:undo") },
        { type: "separator" },
        { role: "cut", label: "Ausschneiden" },
        { role: "copy", label: "Kopieren" },
        { role: "paste", label: "Einfügen" },
        { role: "selectAll", label: "Alles auswählen" }
      ]
    },
    {
      label: "Monat",
      submenu: [
        { label: "Vorheriger Monat", accelerator: "CmdOrCtrl+Left", click: send("menu:prev") },
        { label: "Nächster Monat", accelerator: "CmdOrCtrl+Right", click: send("menu:next") },
        { type: "separator" },
        { label: "Neuen Monat anlegen", accelerator: "CmdOrCtrl+N", click: send("menu:new-month") },
        { label: "Aktuellen Monat löschen", click: send("menu:delete-month") }
      ]
    },
    {
      label: "Tresor",
      submenu: [
        { label: "Jetzt sperren", accelerator: "CmdOrCtrl+L", click: send("menu:lock") },
        { label: "Passwort ändern …", click: send("menu:change-password") }
      ]
    },
    {
      label: "Ansicht",
      submenu: [
        { role: "resetZoom", label: "Normale Grösse" },
        { role: "zoomIn", label: "Grösser" },
        { role: "zoomOut", label: "Kleiner" },
        { type: "separator" },
        { role: "togglefullscreen", label: "Vollbild" },
        { role: "toggleDevTools", label: "Entwicklerwerkzeuge" }
      ]
    },
    {
      label: "Hilfe",
      submenu: [
        /* Unter macOS steht „Über“ bereits im Programmmenue. */
        ...(istMac ? [] : [{ label: "Über Blaubuch", click: zeigeUeber }]),
        { label: "Datenordner öffnen", click: revealData }
      ]
    }
  ]));
}

/* ------------------------------------------------------------------ *
 * Start
 * ------------------------------------------------------------------ */

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    buildMenu();
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    store.lock();
    if (process.platform !== "darwin") app.quit();
  });
}
