/**
 * Abnahme der Sicherheitseigenschaften.
 *
 * Jeder Test hier haelt genau eine Zusage fest, die im Sicherheitsbericht
 * steht. Sie lassen sich als Pruefliste lesen: was hier gruen ist, ist
 * gemessen und nicht behauptet.
 *
 * Laeuft ohne Electron — geprueft wird die Ablage und der Tresor, also
 * genau die Schichten, die die Platte und den Schluessel anfassen.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

import { readHeader, create as tresorAnlegen, KDF_STANDARD } from "../src/shared/vault.mjs";
import { beispielState } from "./fixtures.mjs";

const require = createRequire(import.meta.url);
const { Store, DATA_NAME, VERSUCHE_NAME, LOESCHEN_NACH } = require("../src/main/store.js");

const PASSWORT = "eine lange und gute Wortfolge";   /* pruefung:erlaubt — frei erfundenes Testpasswort */
const INHALT = JSON.stringify(beispielState(), null, 2);

async function frisch(t) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "blaubuch-sicherheit-"));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  return { dir, store: new Store(() => dir) };
}

const liegtVor = (dir, name) => fsp.access(path.join(dir, name)).then(() => true, () => false);

/* ------------------------------------------------------------------ *
 * Loeschumfang
 *
 * SECURITY.md sagt dem Anwender zu, dass von Hand gesicherte Kopien von
 * der Loeschung nicht betroffen sind. Im Stick-Betrieb ist der Datenordner
 * derselbe Ordner, in dem er arbeitet — die Zusage muss also auch dann
 * gelten, wenn die Kopie direkt daneben liegt.
 * ------------------------------------------------------------------ */

test("die Löschung fasst nur die eigenen Dateien an", async (t) => {
  const { dir, store } = await frisch(t);

  await store.create(PASSWORT, INHALT);
  await fsp.mkdir(path.join(dir, "backups"), { recursive: true });
  await fsp.writeFile(path.join(dir, "backups", "blaubuch-2026-08-01T10-00-00.json"), "automatische Sicherung");

  /* Genau die Dateinamen, die der Speicherdialog von sich aus vorschlaegt. */
  await fsp.writeFile(path.join(dir, "blaubuch-2026-08-26.json"), "von Hand gesicherte Kopie");
  await fsp.writeFile(path.join(dir, "blaubuch-klartext-2026-08-26.json"), "von Hand gesicherte Klartextkopie");
  /* Und etwas, das nur zufaellig aehnlich heisst. */
  await fsp.writeFile(path.join(dir, "Blaubuch-Steuern-2025.json"), "voellig unbeteiligt");
  await fsp.writeFile(path.join(dir, "notizen.txt"), "voellig unbeteiligt");

  await store.wipe();

  assert.equal(await liegtVor(dir, DATA_NAME), false, "der Tresor muss weg sein");
  assert.equal(await liegtVor(dir, VERSUCHE_NAME), false, "der Zähler muss weg sein");
  assert.equal(await liegtVor(dir, "backups"), false, "die automatischen Sicherungen müssen weg sein");

  assert.equal(await liegtVor(dir, "blaubuch-2026-08-26.json"), true,
    "eine von Hand gesicherte Kopie darf die Löschung überleben — SECURITY.md sagt das zu");
  assert.equal(await liegtVor(dir, "blaubuch-klartext-2026-08-26.json"), true,
    "auch die Klartextkopie gehört dem Anwender, nicht dem Programm");
  assert.equal(await liegtVor(dir, "Blaubuch-Steuern-2025.json"), true,
    "eine fremde Datei mit ähnlichem Namen geht das Programm nichts an");
  assert.equal(await liegtVor(dir, "notizen.txt"), true);
});

test("die Löschung entfernt auch die Umstellungsdatei und liegengebliebene Bruchstücke", async (t) => {
  const { dir, store } = await frisch(t);
  await store.create(PASSWORT, INHALT);

  /* Bleibt liegen, wenn ein Schreibvorgang mitten drin abbricht. Inhalt ist
     verschluesselt, gehoert aber trotzdem zum Programm. */
  await fsp.writeFile(path.join(dir, DATA_NAME + ".tmp"), "abgebrochener Schreibvorgang");
  /* Legt encryptExisting an: der alte Klartext, zur Seite gelegt. */
  await fsp.writeFile(path.join(dir, "blaubuch-unverschluesselt-2026-08-26T10-00-00.json"), "alter Klartext");

  await store.wipe();

  assert.equal(await liegtVor(dir, DATA_NAME + ".tmp"), false,
    "ein Bruchstück des eigenen Schreibvorgangs muss mit weg");
  assert.equal(await liegtVor(dir, "blaubuch-unverschluesselt-2026-08-26T10-00-00.json"), false,
    "die zur Seite gelegte Klartextdatei muss mit weg");
});

/* ------------------------------------------------------------------ *
 * Fehlversuche
 *
 * Der Zaehler des eigenen Tresors entscheidet ueber die Loeschung. Was an
 * einer fremden Datei geschieht, darf ihn nicht bewegen — sonst bringt ein
 * vergessenes Passwort einer alten Sicherung den laufenden Tresor in Gefahr.
 * ------------------------------------------------------------------ */

test("Fehlversuche an einer fremden Datei bringen den eigenen Tresor nicht in Gefahr", async (t) => {
  const { dir, store } = await frisch(t);
  await store.create(PASSWORT, INHALT);
  store.lock();

  const { text: fremd } = await tresorAnlegen('{"version":4,"months":{}}', "ein ganz anderes Passwort");

  for (let i = 0; i < LOESCHEN_NACH + 2; i++) {
    await store.decryptForeign(fremd, "falsch-" + i);
  }

  const zustand = await store.status();
  assert.equal(zustand.fehlversuche, 0,
    "der Zähler des eigenen Tresors darf von einer fremden Datei nicht bewegt werden");
  assert.equal(zustand.rest, LOESCHEN_NACH);
  assert.equal(await liegtVor(dir, DATA_NAME), true, "der eigene Tresor muss unangetastet sein");

  /* Und er laesst sich danach ganz normal oeffnen. */
  assert.equal((await store.unlock(PASSWORT)).ok, true);
});

test("Fehlversuche an einer fremden Datei werden trotzdem gebremst", async (t) => {
  const { store } = await frisch(t);
  const { text: fremd } = await tresorAnlegen('{"version":4,"months":{}}', "ein ganz anderes Passwort");

  /* Die ersten Versuche laufen ohne Bremse, danach greift sie. Gemessen
     wird nur, DASS gebremst wird — nicht wie genau. */
  for (let i = 0; i < 3; i++) await store.decryptForeign(fremd, "falsch");

  const vorher = Date.now();
  await store.decryptForeign(fremd, "falsch");
  assert.ok(Date.now() - vorher >= 1000,
    "nach mehreren Fehlversuchen muss auch der fremde Weg spürbar bremsen");
});

/* ------------------------------------------------------------------ *
 * Fremde Dateien
 * ------------------------------------------------------------------ */

test("unplausible Schlüsselparameter werden abgewiesen, bevor Speicher belegt wird", async (t) => {
  /* Einzeln liegen alle Werte in den erlaubten Grenzen. Ihr Produkt
     bestimmt aber den Speicherbedarf: 128 * N * r sind hier 4 GiB, und
     zwar im Hauptprozess. */
  const kopf = {
    format: "blaubuch-vault",
    version: 1,
    kdf: { name: "scrypt", N: 1048576, r: 32, p: 1, keylen: 32, salt: Buffer.alloc(16).toString("base64") },
    cipher: { name: "aes-256-gcm", iv: Buffer.alloc(12).toString("base64"), tag: Buffer.alloc(16).toString("base64") },
    data: ""
  };

  assert.throws(
    () => readHeader(JSON.stringify(kopf)),
    (err) => err.code === "bad_params",
    "eine Datei darf nicht mehrere Gigabyte Arbeitsspeicher anfordern dürfen"
  );

  /* Die Standardparameter müssen selbstverständlich weiterhin durchgehen. */
  const gut = { ...kopf, kdf: { ...KDF_STANDARD, salt: Buffer.alloc(16).toString("base64") } };
  assert.doesNotThrow(() => readHeader(JSON.stringify(gut)));
});

test("eine übergrosse Datei wird abgewiesen statt eingelesen", async (t) => {
  const { dir, store } = await frisch(t);
  const riesig = path.join(dir, "riesig.json");

  /* Deutlich ueber jeder plausiblen Tresorgroesse, aber klein genug,
     dass der Test schnell bleibt. */
  await fsp.writeFile(riesig, Buffer.alloc(70 * 1024 * 1024, 0x20));

  const res = await store.readForImport(riesig);
  assert.equal(res.ok, false);
  assert.equal(res.code, "too_large");
});

/* ------------------------------------------------------------------ *
 * Zuruecksetzen
 *
 * Das vollstaendige Zuruecksetzen ist die einzige Funktion, die Daten
 * ohne Rueckweg vernichtet. Sie gehoert hinter das Passwort — die
 * Loeschung nach zehn Fehlversuchen ist der andere, bewusst gewaehlte Weg.
 * ------------------------------------------------------------------ */

test("Zurücksetzen auf Zuruf verlangt einen offenen Tresor", async (t) => {
  const { dir, store } = await frisch(t);
  await store.create(PASSWORT, INHALT);
  store.lock();

  const res = await store.wipeByUser();
  assert.equal(res.ok, false);
  assert.equal(res.code, "locked");
  assert.equal(await liegtVor(dir, DATA_NAME), true,
    "am Sperrbildschirm darf sich der Tresor nicht vernichten lassen");

  await store.unlock(PASSWORT);
  assert.equal((await store.wipeByUser()).ok, true);
  assert.equal(await liegtVor(dir, DATA_NAME), false);
});

/* ------------------------------------------------------------------ *
 * Automatische Sperre
 *
 * Der Waechter haengt am Fenster, laesst sich aber ohne DOM pruefen: er
 * braucht nur addEventListener, localStorage und setTimeout. Die Zeitgeber
 * sind gestellt — sonst liefe der Test eine Viertelstunde.
 * ------------------------------------------------------------------ */

/** Minimales Fenster und ein Speicher, der nur im Arbeitsspeicher lebt. */
function stelleFensterBereit(t, gespeichert = null) {
  const handler = [];
  const werte = new Map();
  if (gespeichert !== null) werte.set("blaubuch-sperre", gespeichert);

  globalThis.window = { addEventListener: (_art, fn) => handler.push(fn) };
  globalThis.localStorage = {
    getItem: (k) => (werte.has(k) ? werte.get(k) : null),
    setItem: (k, v) => werte.set(k, String(v)),
    removeItem: (k) => werte.delete(k)
  };
  t.after(() => { delete globalThis.window; delete globalThis.localStorage; });

  /** Eine Eingabe des Anwenders nachstellen. */
  return { eingabe: () => handler.forEach((fn) => fn()) };
}

const MINUTE = 60 * 1000;

test("der Tresor sperrt sich nach der eingestellten Zeit ohne Eingabe", async (t) => {
  stelleFensterBereit(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { starteWaechter } = await import("../src/renderer/sperre.mjs?fall=1");

  let gesperrt = 0;
  const waechter = starteWaechter(() => { gesperrt += 1; });

  /* Vor dem Scharfstellen passiert nichts — am Torbildschirm gibt es
     nichts zu sperren. */
  t.mock.timers.tick(60 * MINUTE);
  assert.equal(gesperrt, 0, "ohne offenen Tresor darf nichts geschehen");

  waechter.an();
  t.mock.timers.tick(14 * MINUTE);
  assert.equal(gesperrt, 0, "vor Ablauf der Zeit bleibt der Tresor offen");
  t.mock.timers.tick(2 * MINUTE);
  assert.equal(gesperrt, 1, "nach 15 Minuten ohne Eingabe wird gesperrt");

  /* Und nur einmal: das Sperren entschaerft den Waechter selbst. */
  t.mock.timers.tick(60 * MINUTE);
  assert.equal(gesperrt, 1);
});

test("jede Eingabe stellt die Uhr zurück", async (t) => {
  const fenster = stelleFensterBereit(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { starteWaechter } = await import("../src/renderer/sperre.mjs?fall=2");

  let gesperrt = 0;
  starteWaechter(() => { gesperrt += 1; }).an();

  for (let i = 0; i < 10; i++) {
    t.mock.timers.tick(14 * MINUTE);
    fenster.eingabe();
  }
  assert.equal(gesperrt, 0, "wer arbeitet, wird nicht ausgesperrt");

  t.mock.timers.tick(16 * MINUTE);
  assert.equal(gesperrt, 1, "nach der letzten Eingabe läuft die Zeit normal weiter");
});

test("auf „Aus“ gestellt sperrt nichts", async (t) => {
  stelleFensterBereit(t, "aus");
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { starteWaechter, leseSperre } = await import("../src/renderer/sperre.mjs?fall=3");

  assert.equal(leseSperre(), "aus");
  let gesperrt = 0;
  starteWaechter(() => { gesperrt += 1; }).an();

  t.mock.timers.tick(24 * 60 * MINUTE);
  assert.equal(gesperrt, 0, "wer die Sperre abschaltet, bleibt offen");
});

test("ein unsinniger gespeicherter Wert fällt auf die Voreinstellung zurück", async (t) => {
  stelleFensterBereit(t, "niemals");
  const { leseSperre } = await import("../src/renderer/sperre.mjs?fall=4");
  assert.equal(leseSperre(), "15",
    "eine manipulierte Einstellung darf die Sperre nicht abschalten");
});
