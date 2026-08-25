/**
 * Bruecke zwischen Oberflaeche und Hauptprozess.
 *
 * Die Oberflaeche bekommt genau diese Funktionen und sonst nichts —
 * kein require, kein Dateisystem, kein ipcRenderer, kein Schluessel.
 * Passwoerter fliessen nur in eine Richtung: hinein.
 */

"use strict";

const { contextBridge, ipcRenderer } = require("electron");

/** Menuebefehle, die die Oberflaeche entgegennehmen darf. */
const MENU_EVENTS = [
  "menu:save", "menu:export", "menu:export-plain", "menu:import", "menu:undo",
  "menu:prev", "menu:next", "menu:new-month", "menu:delete-month",
  "menu:lock", "menu:change-password",
  "app:flush-close"
];

contextBridge.exposeInMainWorld("blaubuch", {

  /* ---- Tresor ---- */

  /** Was liegt auf der Platte: leer, verschluesselt, klartext, beschaedigt. */
  vaultStatus: () => ipcRenderer.invoke("vault:status"),

  /** Mit Passwort oeffnen. Gibt bei Erfolg den Klartext zurueck. */
  unlock: (password) => ipcRenderer.invoke("vault:unlock", password),

  /** Neuen Tresor anlegen. */
  createVault: (password, text) => ipcRenderer.invoke("vault:create", { password, text }),

  /** Bestehende Klartextdatei uebernehmen und ab jetzt verschluesseln. */
  encryptExisting: (password) => ipcRenderer.invoke("vault:encrypt-existing", password),

  /** Passwort wechseln. */
  changePassword: (alt, neu, sicherungenLoeschen) =>
    ipcRenderer.invoke("vault:change-password", { alt, neu, sicherungenLoeschen }),

  /** Schluessel aus dem Speicher werfen. */
  lock: () => ipcRenderer.invoke("vault:lock"),

  /** Alles loeschen: Tresor, Sicherungen, Zaehler. Nicht rueckgaengig zu machen. */
  resetAll: () => ipcRenderer.invoke("vault:reset"),

  /* ---- Daten ---- */

  /** Klartext uebergeben; verschluesselt wird im Hauptprozess. */
  write: (text) => ipcRenderer.invoke("store:write", text),

  /** Kopie sichern. klartext=true fragt vorher ausdruecklich nach. */
  exportTo: (text, klartext = false) => ipcRenderer.invoke("store:export", { text, klartext }),

  /** Datei auswaehlen und einlesen. Sagt, ob sie verschluesselt ist. */
  importFrom: () => ipcRenderer.invoke("store:import"),

  /** Eine fremde verschluesselte Datei mit eigenem Passwort oeffnen. */
  decryptForeign: (text, password) => ipcRenderer.invoke("store:decrypt-foreign", { text, password }),

  /* ---- Umgebung ---- */

  reveal: () => ipcRenderer.invoke("store:reveal"),
  copy: (text) => ipcRenderer.invoke("clipboard:write", text),
  info: () => ipcRenderer.invoke("app:info"),
  confirm: (options) => ipcRenderer.invoke("dialog:confirm", options ?? {}),

  /** Meldet, dass gespeichert ist und geschlossen werden darf. */
  readyToClose: () => ipcRenderer.send("app:ready-to-close"),

  /**
   * Auf einen Menuebefehl hoeren. Gibt eine Funktion zum Abmelden zurueck.
   * Unbekannte Kanaele werden abgewiesen.
   */
  onMenu: (channel, handler) => {
    if (!MENU_EVENTS.includes(channel) || typeof handler !== "function") return () => {};
    const listener = () => handler();
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  }
});
