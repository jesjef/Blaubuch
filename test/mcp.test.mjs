/**
 * Der MCP-Server (1.4.0, Stufe 1).
 *
 * Zwei Generationen des Protokolls:
 *  - bis 2025-11-25 mit `initialize`-Handshake — geprüft mit dem
 *    offiziellen SDK-Client, also mit dem Werkzeug, das die Clients selbst
 *    benutzen. Das SDK ist nur Entwicklungsabhängigkeit.
 *  - ab 2026-07-28 zustandslos, Version je Anfrage in `_meta` — geprüft mit
 *    Anfragen, die den Beispielen der Spezifikation nachgebaut sind. Kein
 *    offizieller Client spricht diese Fassung bei Abfassung (Oktober 2026).
 *
 * Dazu die Abwehr: Zugangsschlüssel, Origin, Host, nur 127.0.0.1, und
 * bei gesperrtem Tresor keine Daten.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { starteServer, MODERNE_VERSIONEN, AELTERE_VERSIONEN } from "../src/main/mcp.mjs";
import { WERKZEUGE } from "../src/shared/ki.mjs";
import { Vorschlagsliste } from "../src/shared/vorschlaege.mjs";
import { totals } from "../src/shared/budget.mjs";
import { beispielState } from "./fixtures.mjs";

const TOKEN = "a".repeat(64);
const MODERN = "2026-07-28";

/** Ein Server mit einem Stand im Speicher. `lage` lässt sich je Test ändern. */
async function mitServer(t, lage = {}) {
  const state = beispielState();
  const protokoll = [];
  const liste = new Vorschlagsliste();
  const dienst = {
    name: "blaubuch", version: "0.0.0-test",
    entsperrt: () => lage.entsperrt ?? true,
    stand: async () => state,
    protokolliere: (e) => protokoll.push(e),
    schlageVor: (v) => liste.hinzufuegen(v),
    vorschlaege: () => liste.alle()
  };
  const server = await starteServer({ port: 0, token: TOKEN, dienst });
  t.after(() => server.close());
  return { server, state, protokoll, liste, url: "http://127.0.0.1:" + server.port + "/mcp" };
}

async function post(url, body, kopf = {}) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: "Bearer " + TOKEN,
      ...kopf
    },
    body: typeof body === "string" ? body : JSON.stringify(body)
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null, headers: res.headers };
}

/** Eine moderne Anfrage mit allen Pflicht-Kopfzeilen, wie in der Spezifikation. */
function modern(method, params = {}, { version = MODERN, kopf = {} } = {}) {
  const name = params.name ?? params.uri;
  return {
    body: {
      jsonrpc: "2.0", id: 1, method,
      params: {
        ...params,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": version,
          "io.modelcontextprotocol/clientInfo": { name: "Test", version: "1.0.0" },
          "io.modelcontextprotocol/clientCapabilities": {}
        }
      }
    },
    kopf: {
      "mcp-protocol-version": version,
      "mcp-method": method,
      ...(name !== undefined ? { "mcp-name": name } : {}),
      ...kopf
    }
  };
}
const sende = (url, m) => post(url, m.body, m.kopf);

/* ------------------------------------------------------------------ *
 * Ältere Generation — mit dem offiziellen SDK
 * ------------------------------------------------------------------ */

async function sdkClient(t, url, token = TOKEN) {
  const client = new Client({ name: "blaubuch-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { authorization: "Bearer " + token } }
  });
  await client.connect(transport);
  t.after(() => client.close());
  return client;
}

test("SDK-Client: verbindet sich, listet die Werkzeuge in fester Reihenfolge", async (t) => {
  const { url } = await mitServer(t);
  const client = await sdkClient(t, url);
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((w) => w.name), WERKZEUGE.map((w) => w.name));
  assert.equal(client.getServerVersion().name, "blaubuch");
});

test("SDK-Client: monat_lesen liefert dieselben Zahlen wie totals()", async (t) => {
  const { url, state } = await mitServer(t);
  const client = await sdkClient(t, url);
  const r = await client.callTool({ name: "monat_lesen", arguments: { monat: "2026-08" } });
  assert.equal(r.isError, undefined);
  assert.equal(r.structuredContent.summen.rest, totals(state, state.months["2026-08"]).rest);
  assert.deepEqual(JSON.parse(r.content[0].text), r.structuredContent, "Text und Struktur sagen dasselbe");
});

test("SDK-Client: eine falsche Frage kommt als lesbarer Werkzeugfehler zurück", async (t) => {
  const { url } = await mitServer(t);
  const client = await sdkClient(t, url);
  const r = await client.callTool({ name: "monat_lesen", arguments: { monat: "1999-01" } });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /1999-01/);
});

test("SDK-Client: das Datenmodell ist als Ressource lesbar", async (t) => {
  const { url } = await mitServer(t);
  const client = await sdkClient(t, url);
  const { resources } = await client.listResources();
  assert.equal(resources[0].uri, "blaubuch://datenmodell");
  const r = await client.readResource({ uri: "blaubuch://datenmodell" });
  assert.match(r.contents[0].text, /Sparquote/);
});

test("SDK-Client: ohne gültigen Zugangsschlüssel kein Verbindungsaufbau", async (t) => {
  const { url } = await mitServer(t);
  await assert.rejects(sdkClient(t, url, "b".repeat(64)));
});

test("ältere Generation: unbekannte Version beim Handshake → der Server nennt seine", async (t) => {
  const { url } = await mitServer(t);
  const r = await post(url, {
    jsonrpc: "2.0", id: 1, method: "initialize",
    params: { protocolVersion: "2099-01-01", capabilities: {}, clientInfo: { name: "x", version: "1" } }
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.result.protocolVersion, AELTERE_VERSIONEN[0]);
  assert.equal(r.headers.get("mcp-session-id"), null, "Blaubuch vergibt keine Sitzungen");
});

test("ältere Generation: eine Benachrichtigung bekommt 202 ohne Inhalt", async (t) => {
  const { url } = await mitServer(t);
  const r = await post(url, { jsonrpc: "2.0", method: "notifications/initialized" });
  assert.equal(r.status, 202);
  assert.equal(r.json, null);
});

/* ------------------------------------------------------------------ *
 * Neue Generation (2026-07-28) — nach den Beispielen der Spezifikation
 * ------------------------------------------------------------------ */

test("server/discover nennt Versionen, Fähigkeiten und Identität", async (t) => {
  const { url } = await mitServer(t);
  const r = await sende(url, modern("server/discover"));
  assert.equal(r.status, 200);
  const res = r.json.result;
  assert.equal(res.resultType, "complete");
  assert.ok(res.supportedVersions.includes(MODERN));
  assert.deepEqual(Object.keys(res.capabilities).sort(), ["resources", "tools"]);
  assert.equal(res._meta["io.modelcontextprotocol/serverInfo"].name, "blaubuch");
  assert.equal(res.cacheScope, "private", "Finanzdaten gehören in keinen geteilten Zwischenspeicher");
  assert.ok(Number.isInteger(res.ttlMs));
});

test("tools/list: Ergebnis mit resultType, ttlMs und cacheScope", async (t) => {
  const { url } = await mitServer(t);
  const r = await sende(url, modern("tools/list"));
  assert.equal(r.status, 200);
  assert.equal(r.json.result.resultType, "complete");
  assert.equal(r.json.result.cacheScope, "private");
  assert.equal(r.json.result.tools.length, WERKZEUGE.length);
  assert.equal(r.json.result.tools[0].run, undefined, "nur die Beschreibung verlässt den Server");
});

test("tools/call: dieselben Zahlen wie totals()", async (t) => {
  const { url, state } = await mitServer(t);
  const r = await sende(url, modern("tools/call", { name: "monat_lesen", arguments: { monat: "2026-07" } }));
  assert.equal(r.status, 200);
  assert.equal(r.json.result.resultType, "complete");
  assert.equal(r.json.result.structuredContent.summen.kosten, totals(state, state.months["2026-07"]).kosten);
});

test("tools/call: Mcp-Name im Base64-Format wird entschlüsselt und verglichen", async (t) => {
  const { url } = await mitServer(t);
  const b64 = "=?base64?" + Buffer.from("analyse").toString("base64") + "?=";
  const r = await sende(url, modern("tools/call", { name: "analyse", arguments: {} }, { kopf: { "mcp-name": b64 } }));
  assert.equal(r.status, 200);
});

test("Kopfzeilen, die fehlen oder nicht zum Inhalt passen → 400 HeaderMismatch", async (t) => {
  const { url } = await mitServer(t);
  const faelle = [
    modern("tools/call", { name: "analyse" }, { kopf: { "mcp-name": "bericht" } }),
    modern("tools/list", {}, { kopf: { "mcp-method": "tools/call" } }),
    modern("tools/list", {}, { kopf: { "mcp-protocol-version": "2025-11-25" } })
  ];
  const ohneName = modern("tools/call", { name: "analyse" });
  delete ohneName.kopf["mcp-name"];
  const ohneMethode = modern("tools/list");
  delete ohneMethode.kopf["mcp-method"];
  for (const m of [...faelle, ohneName, ohneMethode]) {
    const r = await sende(url, m);
    assert.equal(r.status, 400, JSON.stringify(m.kopf));
    assert.equal(r.json.error.code, -32020, JSON.stringify(m.kopf));
  }
});

test("unbekannte Version → 400 mit der Liste der unterstützten", async (t) => {
  const { url } = await mitServer(t);
  const r = await sende(url, modern("tools/list", {}, { version: "1900-01-01" }));
  assert.equal(r.status, 400);
  assert.equal(r.json.error.code, -32022);
  assert.equal(r.json.error.data.requested, "1900-01-01");
  assert.ok(r.json.error.data.supported.includes(MODERN));
  for (const v of MODERNE_VERSIONEN) assert.ok(r.json.error.data.supported.includes(v));
});

test("unbekannte Methode → 404 mit -32601", async (t) => {
  const { url } = await mitServer(t);
  const r = await sende(url, modern("prompts/list"));
  assert.equal(r.status, 404);
  assert.equal(r.json.error.code, -32601);
});

/* ------------------------------------------------------------------ *
 * Abwehr
 * ------------------------------------------------------------------ */

test("der Server lauscht nur auf 127.0.0.1", async (t) => {
  const { server } = await mitServer(t);
  assert.equal(server.adresse, "127.0.0.1");
});

test("ohne, mit falschem oder fast richtigem Zugangsschlüssel → 401", async (t) => {
  const { url } = await mitServer(t);
  for (const auth of [undefined, "Bearer falsch", "Bearer " + "a".repeat(63) + "b", "Basic " + TOKEN, TOKEN]) {
    const kopf = { "content-type": "application/json" };
    if (auth !== undefined) kopf.authorization = auth;
    const res = await fetch(url, { method: "POST", headers: kopf, body: JSON.stringify(modern("tools/list").body) });
    assert.equal(res.status, 401, String(auth));
    assert.equal(res.headers.get("www-authenticate"), "Bearer");
  }
});

test("fremder Origin oder fremder Host → 403 (DNS-Rebinding)", async (t) => {
  const { url, server } = await mitServer(t);
  const m = modern("tools/list");
  for (const origin of ["https://boese.example", "http://localhost:1", "null"]) {
    const r = await post(url, m.body, { ...m.kopf, origin });
    assert.equal(r.status, 403, origin);
  }
  const eigener = await post(url, m.body, { ...m.kopf, origin: "http://127.0.0.1:" + server.port });
  assert.equal(eigener.status, 200, "der eigene Ursprung ist erlaubt");

  /* Fetch lässt den Host nicht überschreiben — deshalb direkt über http. */
  const http = await import("node:http");
  const status = await new Promise((ok, fehler) => {
    const req = http.request({
      host: "127.0.0.1", port: server.port, path: "/mcp", method: "POST",
      headers: { host: "boese.example:" + server.port, authorization: "Bearer " + TOKEN, "content-type": "application/json", ...m.kopf }
    }, (res) => { res.resume(); ok(res.statusCode); });
    req.on("error", fehler);
    req.end(JSON.stringify(m.body));
  });
  assert.equal(status, 403, "fremder Host");
});

test("GET, DELETE, falscher Pfad, Stapel und übergrosse Anfragen werden abgewiesen", async (t) => {
  const { url } = await mitServer(t);
  const auth = { authorization: "Bearer " + TOKEN };
  assert.equal((await fetch(url, { headers: auth })).status, 405);
  assert.equal((await fetch(url, { method: "DELETE", headers: auth })).status, 405);
  assert.equal((await fetch(url.replace("/mcp", "/anderes"), { method: "POST", headers: auth })).status, 404);
  assert.equal((await post(url, [modern("tools/list").body])).status, 400, "JSON-RPC-Stapel gibt es nicht mehr");
  assert.equal((await post(url, "{kaputt")).status, 400);
  assert.equal((await post(url, JSON.stringify({ x: "y".repeat(2_000_000) }))).status, 413);
});

test("gesperrt: Werkzeuge liefern keine Daten, nur den Hinweis", async (t) => {
  const lage = { entsperrt: false };
  const { url } = await mitServer(t, lage);
  const r = await sende(url, modern("tools/call", { name: "monat_lesen", arguments: {} }));
  assert.equal(r.json.result.isError, true);
  assert.match(r.json.result.content[0].text, /gesperrt/);
  assert.equal(r.json.result.structuredContent, undefined);
  assert.doesNotMatch(JSON.stringify(r.json), /Miete|5000/, "kein Stück Monat im Fehler");

  lage.entsperrt = true;
  const offen = await sende(url, modern("tools/call", { name: "monat_lesen", arguments: {} }));
  assert.equal(offen.json.result.isError, undefined);
});

test("das Abfrageprotokoll nennt Werkzeug und Monat, nie Beträge", async (t) => {
  const { url, protokoll } = await mitServer(t);
  await sende(url, modern("tools/call", { name: "monat_lesen", arguments: { monat: "2026-08" } }));
  await sende(url, modern("tools/call", { name: "bericht", arguments: {} }));
  assert.equal(protokoll.length, 2);
  for (const e of protokoll) {
    assert.deepEqual(Object.keys(e).sort(), ["monat", "werkzeug", "zeit"].sort(), JSON.stringify(e));
  }
  assert.equal(protokoll[0].monat, "2026-08");
  assert.equal(protokoll[1].monat, null);
});

/* ------------------------------------------------------------------ *
 * Vorschläge (Stufe 2)
 * ------------------------------------------------------------------ */

test("SDK-Client: ein Vorschlag landet in der Liste, der Stand bleibt unberührt", async (t) => {
  const { url, state, liste } = await mitServer(t);
  const vorher = JSON.stringify(state);
  const client = await sdkClient(t, url);
  const r = await client.callTool({
    name: "zeile_vorschlagen",
    arguments: { liste: "ausgaben", name: "Velo-Service", betrag: 89.5, begruendung: "Steht im Kontoauszug." }
  });
  assert.equal(r.isError, undefined, r.content?.[0]?.text);
  assert.equal(r.structuredContent.status, "offen");
  assert.equal(liste.offene().length, 1);
  assert.equal(JSON.stringify(state), vorher, "über das Protokoll ändert sich nichts");

  const s = await client.callTool({ name: "vorschlaege_status", arguments: {} });
  assert.equal(s.structuredContent.vorschlaege[0].status, "offen");
});

test("gesperrt: auch Vorschlagen geht nicht", async (t) => {
  const { url, liste } = await mitServer(t, { entsperrt: false });
  const r = await sende(url, modern("tools/call", {
    name: "zeile_vorschlagen", arguments: { liste: "ausgaben", name: "x", betrag: 1, begruendung: "y" }
  }));
  assert.equal(r.json.result.isError, true);
  assert.equal(liste.alle().length, 0);
});

test("ein fehlerhafter Vorschlag kommt als lesbarer Werkzeugfehler zurück", async (t) => {
  const { url, liste } = await mitServer(t);
  const r = await sende(url, modern("tools/call", {
    name: "zeile_vorschlagen", arguments: { liste: "ausgaben", name: "x", betrag: 1, von: "Postfinance", begruendung: "y" }
  }));
  assert.equal(r.json.result.isError, true);
  assert.match(r.json.result.content[0].text, /Postfinance/);
  assert.equal(liste.alle().length, 0);
});
