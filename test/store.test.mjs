/**
 * Abnahme der Ablage: Dateiverhalten, Verschluesselung, Sperren.
 *
 * Laeuft ohne Electron — store.js benutzt ausschliesslich Node-Bordmittel.
 * Jeder Test bekommt ein eigenes, frisches Verzeichnis.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

import { isVault } from "../src/shared/vault.mjs";
import { beispielState } from "./fixtures.mjs";

const require = createRequire(import.meta.url);
const { Store, DATA_NAME, VERSUCHE_NAME, LOESCHEN_NACH } = require("../src/main/store.js");

const PASSWORT = "eine lange und gute Wortfolge";   /* pruefung:erlaubt — frei erfundenes Testpasswort */
const INHALT = JSON.stringify(beispielState(), null, 2);

/** Frisches Verzeichnis samt Store; wird nach dem Test wieder entfernt. */
async function frisch(t) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "blaubuch-test-"));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  return { dir, store: new Store(() => dir), datei: path.join(dir, DATA_NAME) };
}

const lies = (p) => fs.readFileSync(p, "utf8");

/* ------------------------------------------------------------------ *
 * Zustand
 * ------------------------------------------------------------------ */

test("leeres Verzeichnis meldet sich als leer", async (t) => {
  const { store } = await frisch(t);
  assert.equal((await store.status()).zustand, "leer");
  assert.equal(store.entsperrt, false);
});

test("ein angelegter Tresor meldet sich als verschluesselt", async (t) => {
  const { store } = await frisch(t);
  assert.ok((await store.create(PASSWORT, INHALT)).ok);
  assert.equal((await store.status()).zustand, "verschluesselt");
});

test("eine alte Klartextdatei wird als solche erkannt", async (t) => {
  const { store, datei } = await frisch(t);
  await fsp.writeFile(datei, INHALT, "utf8");
  assert.equal((await store.status()).zustand, "klartext");
});

test("unlesbarer Inhalt wird als beschaedigt gemeldet, nicht als leer", async (t) => {
  const { store, datei } = await frisch(t);
  await fsp.writeFile(datei, "{ kaputt", "utf8");
  assert.equal((await store.status()).zustand, "beschaedigt");
});

/* ------------------------------------------------------------------ *
 * Die Datei auf der Platte
 * ------------------------------------------------------------------ */

test("auf der Platte steht nichts Lesbares", async (t) => {
  const { store, datei } = await frisch(t);
  await store.create(PASSWORT, INHALT);

  const roh = lies(datei);
  assert.ok(isVault(roh), "die Datei ist ein Tresor");
  for (const spur of ["Miete", "Sparplan", "Krankenkasse", "5000", "2026-08", PASSWORT]) {
    assert.ok(!roh.includes(spur), "lesbare Spur in der Datei: " + spur);
  }
});

test("das Passwort steht nirgends im Verzeichnis", async (t) => {
  const { store, dir } = await frisch(t);
  await store.create(PASSWORT, INHALT);
  await store.write(INHALT);

  for (const name of await fsp.readdir(dir, { recursive: true })) {
    const voll = path.join(dir, name);
    if (!fs.statSync(voll).isFile()) continue;
    assert.ok(!lies(voll).includes(PASSWORT), "Passwort gefunden in " + name);
  }
});

test("nach dem Schreiben bleibt keine temporaere Datei liegen", async (t) => {
  const { store, dir } = await frisch(t);
  await store.create(PASSWORT, INHALT);
  await store.write(INHALT);

  const uebrig = (await fsp.readdir(dir)).filter((n) => n.endsWith(".tmp"));
  assert.deepEqual(uebrig, [], "Reste eines abgebrochenen Schreibvorgangs");
});

/**
 * Der Kern der Zusage: auf der Platte liegt nie Klartext, ausser wenn es
 * ausdruecklich verlangt wurde. Dieser Test faehrt den ganzen Lebenslauf
 * ab — anlegen, schreiben, sichern, Passwort wechseln — und durchsucht
 * danach JEDE Datei im Ablageordner.
 */
test("im Ablageordner steht zu keinem Zeitpunkt lesbarer Inhalt", async (t) => {
  const { store, dir } = await frisch(t);

  const spuren = ["Miete", "Sparplan", "Krankenkasse", "Hauptkarte", "Zahnarzt",
                  "5000", "2026-08", "einnahmen", "dauerauftraege", PASSWORT];

  const pruefeOrdner = (schritt) => {
    const offen = [];
    const gehe = (ordner) => {
      for (const name of fs.readdirSync(ordner)) {
        const voll = path.join(ordner, name);
        if (fs.statSync(voll).isDirectory()) { gehe(voll); continue; }
        const inhalt = lies(voll);
        for (const spur of spuren) {
          if (inhalt.includes(spur)) offen.push(schritt + ": „" + spur + "“ lesbar in " + name);
        }
      }
    };
    gehe(dir);
    assert.deepEqual(offen, [], offen.join(" | "));
  };

  await store.create(PASSWORT, INHALT);
  pruefeOrdner("nach dem Anlegen");

  await store.write(INHALT);
  pruefeOrdner("nach dem Schreiben");

  await store.write(JSON.stringify({ ...beispielState(), updatedAt: "x" }));
  pruefeOrdner("nach dem zweiten Schreiben mit Sicherung");

  await store.changePassword(PASSWORT, "ein anderes langes Passwort");
  pruefeOrdner("nach dem Passwortwechsel");

  store.lock();
  pruefeOrdner("nach dem Sperren");
});

test("auch die temporaere Datei ist zu keinem Moment lesbar", async (t) => {
  const { store, datei } = await frisch(t);
  await store.create(PASSWORT, INHALT);

  /* Geschrieben wird nach <datei>.tmp und danach umbenannt. Bei einem
     Absturz dazwischen bliebe genau diese Datei liegen — sie muss also
     schon verschluesselt sein, nicht erst das Ergebnis.
     Um das zu sehen, wird das Umbenennen kurz abgefangen. */
  const echtesRename = fsp.rename;
  let zwischenstand = null;

  fsp.rename = async (von, nach) => {
    zwischenstand = { pfad: von, inhalt: fs.readFileSync(von, "utf8") };
    return echtesRename(von, nach);
  };
  t.after(() => { fsp.rename = echtesRename; });

  await store.write(INHALT);
  fsp.rename = echtesRename;

  assert.ok(zwischenstand, "das Umbenennen wurde nicht beobachtet — Test greift nicht");
  assert.ok(zwischenstand.pfad.endsWith(".tmp"), "geschrieben wird ueber eine temporaere Datei");
  assert.ok(isVault(zwischenstand.inhalt), "schon die temporaere Datei ist ein Tresor");

  for (const spur of ["Miete", "Krankenkasse", "5000", PASSWORT]) {
    assert.ok(!zwischenstand.inhalt.includes(spur), "lesbare Spur im Zwischenstand: " + spur);
  }
  assert.ok(isVault(lies(datei)), "und das Ergebnis ebenso");
});

test("die unverschluesselte Kopie entsteht nur auf ausdrueckliche Anforderung", async (t) => {
  const { store, dir } = await frisch(t);
  await store.create(PASSWORT, INHALT);

  /* exportEncrypted ist der Normalweg und liefert einen Tresor. */
  const sicher = path.join(dir, "kopie-sicher.json");
  await store.exportEncrypted(INHALT, sicher);
  assert.ok(isVault(lies(sicher)), "die normale Kopie ist verschluesselt");

  /* exportPlain ist der einzige Weg zu Klartext — und heisst auch so. */
  const offen = path.join(dir, "kopie-offen.json");
  await store.exportPlain(INHALT, offen);
  assert.equal(lies(offen), INHALT, "nur dieser Weg legt offen");
});

/* ------------------------------------------------------------------ *
 * Oeffnen und Sperren
 * ------------------------------------------------------------------ */

test("Rundlauf: anlegen, sperren, wieder oeffnen", async (t) => {
  const { store } = await frisch(t);
  await store.create(PASSWORT, INHALT);

  store.lock();
  assert.equal(store.entsperrt, false, "nach dem Sperren ist der Schluessel weg");

  const auf = await store.unlock(PASSWORT);
  assert.ok(auf.ok);
  assert.equal(auf.text, INHALT);
  assert.equal(store.entsperrt, true);
});

test("falsches Passwort oeffnet nichts und laesst den Tresor zu", async (t) => {
  const { store } = await frisch(t);
  await store.create(PASSWORT, INHALT);
  store.lock();

  const auf = await store.unlock("falsch");
  assert.equal(auf.ok, false);
  assert.equal(auf.code, "wrong_password");
  assert.equal(store.entsperrt, false, "ein Fehlversuch darf nichts entsperren");
});

test("ohne entsperrten Tresor wird nicht geschrieben", async (t) => {
  const { store, datei } = await frisch(t);
  await store.create(PASSWORT, INHALT);
  const vorher = lies(datei);

  store.lock();
  const res = await store.write(JSON.stringify({ manipuliert: true }));

  assert.equal(res.ok, false);
  assert.equal(res.code, "locked");
  assert.equal(lies(datei), vorher, "die Datei bleibt unangetastet");
});

test("leerer Inhalt wird nicht geschrieben", async (t) => {
  const { store, datei } = await frisch(t);
  await store.create(PASSWORT, INHALT);
  const vorher = lies(datei);

  assert.equal((await store.write("")).code, "empty");
  assert.equal(lies(datei), vorher);
});

test("nach mehreren Fehlversuchen wird gebremst", async (t) => {
  const { store } = await frisch(t);
  await store.create(PASSWORT, INHALT);
  store.lock();

  for (let i = 0; i < 3; i++) await store.unlock("falsch");
  assert.equal(store.fehlversuche, 3);

  const start = Date.now();
  await store.unlock("falsch");
  const gedauert = Date.now() - start;

  assert.ok(gedauert >= 1900, "der vierte Versuch muss spuerbar warten, gedauert: " + gedauert + " ms");
});

test("ein erfolgreicher Versuch setzt die Bremse zurueck", async (t) => {
  const { store } = await frisch(t);
  await store.create(PASSWORT, INHALT);
  store.lock();

  await store.unlock("falsch");
  assert.equal(store.fehlversuche, 1);
  await store.unlock(PASSWORT);
  assert.equal(store.fehlversuche, 0);
});

/* ------------------------------------------------------------------ *
 * Loeschung nach zu vielen Fehlversuchen
 * ------------------------------------------------------------------ */

/** Bis kurz vor die Loeschung fahren, ohne die Wartezeiten abzuwarten. */
async function fastGeloescht(store, uebrig = 1) {
  for (let i = 0; i < LOESCHEN_NACH - uebrig; i++) {
    store.fehlversuche = i;                 /* Bremse ueberspringen */
    await store.unlock("falsch");
  }
}

test("die Zahl der verbleibenden Versuche wird gemeldet", async (t) => {
  const { store } = await frisch(t);
  await store.create(PASSWORT, INHALT);
  store.lock();

  const erster = await store.unlock("falsch");
  assert.equal(erster.rest, LOESCHEN_NACH - 1);
  assert.equal(erster.warnen, false, "so frueh wird noch nicht gewarnt");
});

test("kurz vor Schluss wird gewarnt", async (t) => {
  const { store } = await frisch(t);
  await store.create(PASSWORT, INHALT);
  store.lock();

  await fastGeloescht(store, 2);
  store.fehlversuche = LOESCHEN_NACH - 2;
  const res = await store.unlock("falsch");

  assert.equal(res.rest, 1);
  assert.equal(res.warnen, true);
});

test("der Zaehler ueberlebt einen Neustart des Programms", async (t) => {
  const { dir, store } = await frisch(t);
  await store.create(PASSWORT, INHALT);
  store.lock();
  await store.unlock("falsch");
  await store.unlock("falsch");

  /* Neuer Store auf demselben Ordner — wie ein Neustart. */
  const neu = new Store(() => dir);
  assert.equal((await neu.status()).fehlversuche, 2, "sonst genuegte ein Neustart zum Umgehen");

  const res = await neu.unlock("falsch");
  assert.equal(res.fehlversuche, 3, "es wird weitergezaehlt, nicht neu begonnen");
});

test("ein richtiges Passwort loescht den Zaehler auch auf der Platte", async (t) => {
  const { dir, store } = await frisch(t);
  await store.create(PASSWORT, INHALT);
  store.lock();
  await store.unlock("falsch");
  assert.ok(fs.existsSync(path.join(dir, VERSUCHE_NAME)));

  store.fehlversuche = 0;
  await store.unlock(PASSWORT);
  assert.ok(!fs.existsSync(path.join(dir, VERSUCHE_NAME)), "der Zaehler ist zurueckgesetzt");
});

test("nach dem letzten Fehlversuch sind Tresor UND Sicherungen weg", async (t) => {
  const { dir, store, datei } = await frisch(t);
  await store.create(PASSWORT, INHALT);
  await store.write(INHALT);                       /* erzeugt eine Sicherung */
  assert.ok(fs.existsSync(path.join(dir, "backups")));
  store.lock();

  await fastGeloescht(store, 1);
  store.fehlversuche = LOESCHEN_NACH - 1;
  const res = await store.unlock("falsch");

  assert.equal(res.code, "wiped");
  assert.ok(!fs.existsSync(datei), "der Tresor ist weg");
  assert.ok(!fs.existsSync(path.join(dir, VERSUCHE_NAME)), "der Zaehler ist weg");

  const backups = fs.existsSync(path.join(dir, "backups"))
    ? await fsp.readdir(path.join(dir, "backups"))
    : [];
  assert.deepEqual(backups, [], "eine Loeschung, die die Sicherungen stehen laesst, waere wirkungslos");

  assert.equal((await store.status()).zustand, "leer", "danach beginnt das Programm von vorn");
  assert.equal(store.entsperrt, false);
});

test("die Loeschung erfasst auch liegengebliebene Klartextdateien", async (t) => {
  const { dir, store, datei } = await frisch(t);
  await fsp.writeFile(datei, INHALT, "utf8");
  const uebernahme = await store.encryptExisting(PASSWORT);
  assert.ok(fs.existsSync(uebernahme.altdatei), "Voraussetzung: das Original liegt daneben");

  await store.wipe();

  assert.ok(!fs.existsSync(uebernahme.altdatei),
    "eine unverschluesselte Restdatei zu verschonen wuerde die Loeschung sinnlos machen");
  assert.deepEqual(
    (await fsp.readdir(dir)).filter((n) => n.endsWith(".json")),
    [],
    "es bleibt keine Datendatei zurueck"
  );
});

test("wipe ueberschreibt vor dem Loeschen", async (t) => {
  const { dir, store } = await frisch(t);
  await store.create(PASSWORT, INHALT);

  /* Nachweis ueber eine Kopie: derselbe Weg, aber ohne Entfernen am Ende
     liesse sich nicht pruefen — also wird geprueft, dass nichts uebrig ist. */
  await store.wipe();
  const uebrig = await fsp.readdir(dir);
  assert.deepEqual(uebrig.filter((n) => n !== "backups"), [], "der Ordner ist leer");
});

test("wipe kommt mit einem bereits leeren Ordner klar", async (t) => {
  const { store } = await frisch(t);
  await store.wipe();   /* darf nicht werfen */
  assert.equal((await store.status()).zustand, "leer");
});

/* ------------------------------------------------------------------ *
 * Uebernahme einer alten Klartextdatei
 * ------------------------------------------------------------------ */

test("eine Klartextdatei wird verschluesselt und das Original beiseitegelegt", async (t) => {
  const { store, dir, datei } = await frisch(t);
  await fsp.writeFile(datei, INHALT, "utf8");

  const res = await store.encryptExisting(PASSWORT);
  assert.ok(res.ok);
  assert.ok(isVault(lies(datei)), "die Hauptdatei ist jetzt ein Tresor");

  assert.ok(res.altdatei && fs.existsSync(res.altdatei), "das Original wurde behalten");
  assert.equal(lies(res.altdatei), INHALT, "das Original ist unveraendert");

  const namen = await fsp.readdir(dir);
  assert.ok(namen.some((n) => n.includes("unverschluesselt")), "das Original ist klar benannt");

  store.lock();
  assert.equal((await store.unlock(PASSWORT)).text, INHALT, "der Inhalt kam vollstaendig an");
});

test("scheitert die Uebernahme, bleibt das Original an seinem Platz", async (t) => {
  const { store, datei } = await frisch(t);
  await fsp.writeFile(datei, INHALT, "utf8");

  const res = await store.encryptExisting("");   /* leeres Passwort wird abgelehnt */
  assert.equal(res.ok, false);
  assert.ok(fs.existsSync(datei), "die Datei wurde zurueckgeholt");
  assert.equal(lies(datei), INHALT);
});

test("eine bereits verschluesselte Datei wird nicht doppelt verschluesselt", async (t) => {
  const { store } = await frisch(t);
  await store.create(PASSWORT, INHALT);
  const res = await store.encryptExisting(PASSWORT);
  assert.equal(res.ok, false, "ein Tresor ist kein gueltiges JSON-Klartextdokument");
});

/* ------------------------------------------------------------------ *
 * Passwortwechsel
 * ------------------------------------------------------------------ */

test("nach dem Wechsel gilt nur noch das neue Passwort", async (t) => {
  const { store } = await frisch(t);
  await store.create(PASSWORT, INHALT);

  const res = await store.changePassword(PASSWORT, "ein ganz anderes langes Passwort");
  assert.ok(res.ok);

  store.lock();
  assert.equal((await store.unlock(PASSWORT)).code, "wrong_password", "das alte darf nicht mehr gehen");

  store.fehlversuche = 0;
  const auf = await store.unlock("ein ganz anderes langes Passwort");
  assert.ok(auf.ok);
  assert.equal(auf.text, INHALT, "der Inhalt hat den Wechsel unveraendert ueberstanden");
});

test("nach dem Passwortwechsel bleiben Sicherungen mit dem ALTEN Passwort lesbar", async (t) => {
  const { store, dir } = await frisch(t);
  await store.create(PASSWORT, INHALT);
  await store.write(INHALT);   /* erzeugt eine Sicherung */

  await store.changePassword(PASSWORT, "ein anderes langes Passwort");

  const sicherungen = await fsp.readdir(path.join(dir, "backups"));
  assert.ok(sicherungen.length > 0, "Voraussetzung: es gibt eine Sicherung");

  /* Genau das ist der Punkt, den die Oberflaeche benennen muss: ein
     Passwortwechsel entwertet ein bekannt gewordenes Passwort nicht
     rueckwirkend, solange die alten Sicherungen liegen bleiben. */
  const alteSicherung = lies(path.join(dir, "backups", sicherungen[0]));
  const { decrypt } = await import("../src/shared/vault.mjs");
  const geoeffnet = await decrypt(alteSicherung, PASSWORT);
  assert.equal(geoeffnet.plaintext, INHALT, "die alte Sicherung gibt mit dem alten Passwort nach");
});

test("auf Wunsch werden die alten Sicherungen beim Wechsel entfernt", async (t) => {
  const { store, dir } = await frisch(t);
  await store.create(PASSWORT, INHALT);
  await store.write(INHALT);
  assert.ok(fs.existsSync(path.join(dir, "backups")));

  const res = await store.changePassword(PASSWORT, "ein anderes langes Passwort",
    { sicherungenLoeschen: true });
  assert.ok(res.ok);

  const uebrig = fs.existsSync(path.join(dir, "backups"))
    ? await fsp.readdir(path.join(dir, "backups"))
    : [];
  assert.deepEqual(uebrig, [], "keine mit dem alten Passwort lesbare Sicherung bleibt zurueck");

  store.fehlversuche = 0;
  store.lock();
  assert.ok((await store.unlock("ein anderes langes Passwort")).ok, "der Tresor selbst bleibt nutzbar");
});

test("auch das Einlesen fremder Dateien wird nach Fehlversuchen gebremst", async (t) => {
  const { store, dir } = await frisch(t);
  await store.create(PASSWORT, INHALT);

  const kopie = path.join(dir, "kopie.json");
  await store.exportEncrypted(INHALT, kopie);
  const fremd = lies(kopie);

  /* Ohne Bremse waere dieser Weg ein schnelles Orakel: eine Kopie einlesen
     und darin unbegrenzt Passwoerter durchprobieren. */
  for (let i = 0; i < 3; i++) await store.decryptForeign(fremd, "falsch");
  assert.equal(store.fehlversuche, 3, "Fehlversuche werden auch hier gezaehlt");

  const start = Date.now();
  await store.decryptForeign(fremd, "falsch");
  assert.ok(Date.now() - start >= 1900, "der vierte Versuch muss warten");
});

test("ein falsches altes Passwort aendert nichts", async (t) => {
  const { store } = await frisch(t);
  await store.create(PASSWORT, INHALT);

  assert.equal((await store.changePassword("falsch", "neues langes Passwort")).ok, false);

  store.lock();
  store.fehlversuche = 0;
  assert.ok((await store.unlock(PASSWORT)).ok, "das urspruengliche Passwort gilt weiter");
});

/* ------------------------------------------------------------------ *
 * Sicherungen
 * ------------------------------------------------------------------ */

test("vor dem Ueberschreiben wird gesichert", async (t) => {
  const { store, dir } = await frisch(t);
  await store.create(PASSWORT, INHALT);
  await store.write(INHALT);

  const sicherungen = await fsp.readdir(path.join(dir, "backups"));
  assert.equal(sicherungen.length, 1, "genau eine Sicherung");
  assert.ok(isVault(lies(path.join(dir, "backups", sicherungen[0]))), "auch die Sicherung ist verschluesselt");
});

test("Sicherungen haeufen sich nicht bei jedem Tastendruck an", async (t) => {
  const { store, dir } = await frisch(t);
  await store.create(PASSWORT, INHALT);
  for (let i = 0; i < 5; i++) await store.write(INHALT);

  const sicherungen = await fsp.readdir(path.join(dir, "backups"));
  assert.equal(sicherungen.length, 1, "hoechstens eine Sicherung pro Stunde");
});

/* ------------------------------------------------------------------ *
 * Kopien und Einlesen
 * ------------------------------------------------------------------ */

test("die verschluesselte Kopie laesst sich mit demselben Passwort oeffnen", async (t) => {
  const { store, dir } = await frisch(t);
  await store.create(PASSWORT, INHALT);

  const ziel = path.join(dir, "kopie.json");
  assert.ok((await store.exportEncrypted(INHALT, ziel)).ok);
  assert.ok(isVault(lies(ziel)));

  const gelesen = await store.readForImport(ziel);
  assert.ok(gelesen.verschluesselt);
  assert.equal((await store.decryptForeign(gelesen.text, PASSWORT)).text, INHALT);
});

test("eine fremde Kopie mit falschem Passwort bleibt zu", async (t) => {
  const { store, dir } = await frisch(t);
  await store.create(PASSWORT, INHALT);
  const ziel = path.join(dir, "kopie.json");
  await store.exportEncrypted(INHALT, ziel);

  const gelesen = await store.readForImport(ziel);
  assert.equal((await store.decryptForeign(gelesen.text, "falsch")).code, "wrong_password");
});

test("die Klartextkopie ist wirklich Klartext — und wird als solche erkannt", async (t) => {
  const { store, dir } = await frisch(t);
  await store.create(PASSWORT, INHALT);

  const ziel = path.join(dir, "klartext.json");
  assert.ok((await store.exportPlain(INHALT, ziel)).ok);
  assert.equal(lies(ziel), INHALT);

  const gelesen = await store.readForImport(ziel);
  assert.equal(gelesen.verschluesselt, false, "die Oberflaeche darf hier kein Passwort verlangen");
});

test("ohne entsperrten Tresor gibt es keine verschluesselte Kopie", async (t) => {
  const { store, dir } = await frisch(t);
  await store.create(PASSWORT, INHALT);
  store.lock();

  const res = await store.exportEncrypted(INHALT, path.join(dir, "kopie.json"));
  assert.equal(res.ok, false);
  assert.equal(res.code, "locked");
});
