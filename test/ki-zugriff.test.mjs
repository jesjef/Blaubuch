/**
 * Die Verdrahtung im Hauptprozess (src/main/ki-zugriff.js), ohne Electron:
 * app, ipcMain und das Fenster sind Attrappen. Geprüft wird, was der Plan
 * zusagt — aus bleibt aus, ein neuer Schlüssel macht den alten ungültig,
 * ein belegter Port wird gemeldet statt still gewechselt.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { richteKiZugriffEin, STANDARD_PORT } = require("../src/main/ki-zugriff.js");

/** Ein freier Port — vom System vergeben und sofort wieder frei. */
const freierPort = () => new Promise((ok) => {
  const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => ok(p)); });
});

const lauscht = (port) => new Promise((ok) => {
  const s = net.connect(port, "127.0.0.1");
  s.once("connect", () => { s.destroy(); ok(true); });
  s.once("error", () => ok(false));
});

async function aufbau(t, vorher) {
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), "blaubuch-ki-"));
  t.after(() => fs.rmSync(ordner, { recursive: true, force: true }));
  if (vorher) fs.writeFileSync(path.join(ordner, "ki.json"), JSON.stringify(vorher));

  const kanaele = {};
  const beimBeenden = [];
  const gesendet = [];
  const fenster = { isDestroyed: () => false, webContents: { send: (k, d) => gesendet.push([k, d]) } };
  const zugriff = richteKiZugriffEin({
    app: { getVersion: () => "0.0.0-test", on: (ev, f) => { if (ev === "will-quit") beimBeenden.push(f); } },
    ipcMain: { on: () => {} },
    handle: (kanal, f) => { kanaele[kanal] = (...args) => f({}, ...args); },
    store: { entsperrt: true },
    fenster: () => fenster,
    verzeichnis: () => ordner
  });
  t.after(async () => { await kanaele["ki:ausschalten"]?.(); });
  return { zugriff, kanaele, ordner, gesendet, beenden: () => beimBeenden.forEach((f) => f()) };
}

const tools = (port, token) => fetch("http://127.0.0.1:" + port + "/mcp", {
  method: "POST",
  headers: { "content-type": "application/json", authorization: "Bearer " + token },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
});

test("ausgeschaltet bleibt aus — auch wenn vom letzten Mal ein Schlüssel übrig ist", async (t) => {
  const port = await freierPort();
  /* So sieht ki.json nach „Ausschalten“ aus: der Schlüssel bleibt stehen. */
  const { zugriff, kanaele } = await aufbau(t, { an: false, port, token: "x".repeat(43) });
  await zugriff.starte();
  const s = await kanaele["ki:status"]();
  assert.equal(s.an, false);
  assert.equal(s.laeuft, false);
  assert.equal(s.token, null, "ausgeschaltet verrät die Seite keinen Schlüssel");
  assert.equal(await lauscht(port), false);
});

test("ganz ohne Datei: aus, Standardport", async (t) => {
  const { kanaele } = await aufbau(t);
  const s = await kanaele["ki:status"]();
  assert.equal(s.an, false);
  assert.equal(s.port, STANDARD_PORT);
});

test("einschalten öffnet den Port, ausschalten schliesst ihn wieder", async (t) => {
  const port = await freierPort();
  const { kanaele, ordner } = await aufbau(t, { an: false, port });
  const an = await kanaele["ki:einschalten"]();
  assert.equal(an.laeuft, true);
  assert.ok(an.token.length >= 32);
  assert.equal(await lauscht(port), true);
  assert.equal((await tools(port, an.token)).status, 200);
  assert.equal(JSON.parse(fs.readFileSync(path.join(ordner, "ki.json"), "utf8")).an, true, "bleibt über einen Neustart an");

  const aus = await kanaele["ki:ausschalten"]();
  assert.equal(aus.laeuft, false);
  assert.equal(await lauscht(port), false);
});

test("ein neuer Schlüssel macht den alten sofort ungültig", async (t) => {
  const port = await freierPort();
  const { kanaele } = await aufbau(t, { an: false, port });
  const alt = (await kanaele["ki:einschalten"]()).token;
  const neu = (await kanaele["ki:neuer-schluessel"]()).token;
  assert.notEqual(alt, neu);
  assert.equal((await tools(port, alt)).status, 401);
  assert.equal((await tools(port, neu)).status, 200);
});

test("ein belegter Port wird gemeldet, nicht still gewechselt", async (t) => {
  const port = await freierPort();
  const besetzer = net.createServer().listen(port, "127.0.0.1");
  t.after(() => besetzer.close());
  await new Promise((r) => besetzer.once("listening", r));

  const { kanaele } = await aufbau(t, { an: false, port });
  const s = await kanaele["ki:einschalten"]();
  assert.equal(s.laeuft, false);
  assert.match(s.fehler, new RegExp("Port " + port + " ist belegt"));
  assert.equal(s.port, port);
});

test("unsinnige Ports werden abgelehnt", async (t) => {
  const { kanaele } = await aufbau(t);
  for (const p of [80, 70000, "abc", 1.5]) {
    const s = await kanaele["ki:port"](p);
    assert.match(s.fehler, /zwischen 1024 und 65535/, String(p));
  }
});

test("beim Beenden schliesst der Server", async (t) => {
  const port = await freierPort();
  const { kanaele, beenden } = await aufbau(t, { an: false, port });
  await kanaele["ki:einschalten"]();
  beenden();
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(await lauscht(port), false);
});

test("das MCP-SDK ist nur Entwicklungsabhängigkeit und wird nirgends im Programm geladen", () => {
  const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.deepEqual(Object.keys(pkg.dependencies ?? {}), [], "Electron bleibt die einzige Laufzeitabhängigkeit");
  assert.ok(pkg.devDependencies["@modelcontextprotocol/sdk"]);

  const treffer = [];
  const durch = (dir) => {
    for (const n of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, n.name);
      if (n.isDirectory()) durch(p);
      else if (/\.(m?js|cjs|html)$/.test(n.name) && /@modelcontextprotocol/.test(fs.readFileSync(p, "utf8"))) treffer.push(p);
    }
  };
  durch(new URL("../src", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
  assert.deepEqual(treffer, []);
});

/* ------------------------------------------------------------------ *
 * Vorschläge (Stufe 2)
 * ------------------------------------------------------------------ */

const { beispielState } = await import("./fixtures.mjs");
const { erstelleVorschlag } = await import("../src/shared/vorschlaege.mjs");
const vorschlag = () => erstelleVorschlag("zeile",
  { liste: "ausgaben", name: "Velo", betrag: 10, begruendung: "Test" }, beispielState());

test("ein Vorschlag wird ans Fenster gemeldet und lässt sich dort erledigen", async (t) => {
  const port = await freierPort();
  const { zugriff, kanaele, gesendet } = await aufbau(t, { an: false, port });
  await kanaele["ki:einschalten"]();
  const e = zugriff.dienst.schlageVor(vorschlag());

  const meldung = gesendet.filter(([k]) => k === "ki:vorschlaege").at(-1);
  assert.equal(meldung[1].length, 1, "das Fenster erfährt sofort davon");
  assert.equal((await kanaele["ki:vorschlaege"]())[0].id, e.id);

  const r = await kanaele["ki:vorschlag-erledigt"]({ id: e.id, status: "angenommen" });
  assert.equal(r.ok, true);
  assert.equal(zugriff.dienst.vorschlaege()[0].status, "angenommen");
  const doppelt = await kanaele["ki:vorschlag-erledigt"]({ id: e.id, status: "abgelehnt" });
  assert.equal(doppelt.ok, false, "erledigt bleibt erledigt");
});

test("Sperren und Ausschalten leeren die Vorschläge", async (t) => {
  const port = await freierPort();
  const { zugriff, kanaele } = await aufbau(t, { an: false, port });
  await kanaele["ki:einschalten"]();
  zugriff.dienst.schlageVor(vorschlag());
  zugriff.vergiss();
  assert.equal((await kanaele["ki:vorschlaege"]()).length, 0, "nach dem Sperren");

  zugriff.dienst.schlageVor(vorschlag());
  await kanaele["ki:ausschalten"]();
  assert.equal((await kanaele["ki:vorschlaege"]()).length, 0, "nach dem Ausschalten");
});
