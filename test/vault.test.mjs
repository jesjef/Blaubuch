import test from "node:test";
import assert from "node:assert/strict";

import {
  create, decrypt, decryptWithKey, deriveKey, encrypt, newVaultParams,
  readHeader, isVault, passwordStrength, samePassword,
  VaultError, FORMAT, KDF_STANDARD
} from "../src/shared/vault.mjs";

/* Fuer die Tests bewusst die schwaechsten erlaubten Parameter — sonst
   dauert jeder einzelne Fall eine halbe Sekunde. Die App benutzt KDF_STANDARD. */
const SCHNELL = { name: "scrypt", N: 16384, r: 8, p: 1, keylen: 32 };

const GEHEIM = JSON.stringify({
  version: 3,
  months: { "2026-08": { einnahmen: { netto: 4321.75 } } }
});

/* ------------------------------------------------------------------ */

test("Rundlauf: verschluesseln und wieder lesen", async () => {
  const { text } = await create(GEHEIM, "ein gutes langes Passwort", SCHNELL);
  const { plaintext } = await decrypt(text, "ein gutes langes Passwort");
  assert.equal(plaintext, GEHEIM);
});

test("die Datei verraet den Klartext nicht", async () => {
  const { text } = await create(GEHEIM, "passwort123456", SCHNELL);

  assert.ok(!text.includes("4321.75"), "Betrag darf nicht lesbar sein");
  assert.ok(!text.includes("netto"), "Feldname darf nicht lesbar sein");
  assert.ok(!text.includes("2026-08"), "Monat darf nicht lesbar sein");
  assert.ok(!text.includes("passwort123456"), "Passwort darf nirgends auftauchen");

  const kopf = JSON.parse(text);
  assert.equal(kopf.format, FORMAT);
  assert.equal(kopf.cipher.name, "aes-256-gcm");
  assert.ok(!("password" in kopf) && !("key" in kopf), "kein Schluesselmaterial in der Datei");
});

test("falsches Passwort wird abgewiesen", async () => {
  const { text } = await create(GEHEIM, "richtiges Passwort", SCHNELL);
  await assert.rejects(
    () => decrypt(text, "falsches Passwort"),
    (err) => err instanceof VaultError && err.code === "wrong_password"
  );
});

test("ein einziges veraendertes Byte macht die Datei ungueltig", async () => {
  const { text } = await create(GEHEIM, "passwort123456", SCHNELL);
  const o = JSON.parse(text);

  const daten = Buffer.from(o.data, "base64");
  daten[0] ^= 0x01;
  o.data = daten.toString("base64");

  await assert.rejects(
    () => decrypt(JSON.stringify(o), "passwort123456"),
    (err) => err.code === "wrong_password",
    "GCM muss die Manipulation bemerken"
  );
});

test("die Pruefsumme laesst sich nicht austauschen", async () => {
  const { text } = await create(GEHEIM, "passwort123456", SCHNELL);
  const o = JSON.parse(text);
  o.cipher.tag = Buffer.alloc(16).toString("base64");

  await assert.rejects(() => decrypt(JSON.stringify(o), "passwort123456"), (err) => err.code === "wrong_password");
});

test("heruntergesetzte Parameter machen die Datei unlesbar, nicht schwaecher", async () => {
  const { text } = await create(GEHEIM, "passwort123456", { ...SCHNELL, N: 32768 });
  const o = JSON.parse(text);

  /* Ein Angreifer senkt N, um das Durchprobieren zu beschleunigen. */
  o.kdf.N = 16384;

  await assert.rejects(
    () => decrypt(JSON.stringify(o), "passwort123456"),
    (err) => err.code === "wrong_password",
    "der Kopf ist mitsigniert — Absenken faellt auf"
  );
});

test("unplausible Parameter werden zurueckgewiesen", async () => {
  const { text } = await create(GEHEIM, "passwort123456", SCHNELL);

  const faelle = [
    ["N", 4],            /* zu klein, macht Knacken billig */
    ["N", 3],            /* keine Zweierpotenz */
    ["N", 99999999],     /* Speicherbombe */
    ["r", 0],
    ["p", 999],
    ["keylen", 8]        /* zu kurzer Schluessel */
  ];

  for (const [feld, wert] of faelle) {
    const o = JSON.parse(text);
    o.kdf[feld] = wert;
    assert.throws(
      () => readHeader(JSON.stringify(o)),
      (err) => err.code === "bad_params",
      "durchgerutscht: " + feld + " = " + wert
    );
  }
});

test("abgeschnittene oder falsch lange Felder werden erkannt", async () => {
  const { text } = await create(GEHEIM, "passwort123456", SCHNELL);

  for (const pfad of [["kdf", "salt"], ["cipher", "iv"], ["cipher", "tag"]]) {
    const o = JSON.parse(text);
    o[pfad[0]][pfad[1]] = Buffer.alloc(3).toString("base64");
    assert.throws(() => readHeader(JSON.stringify(o)), (err) => err.code === "bad_params", pfad.join("."));
  }
});

test("zweimal dasselbe verschluesseln ergibt nie dieselbe Datei", async () => {
  const params = newVaultParams(SCHNELL);
  const key = await deriveKey("passwort123456", params.salt, params.kdf);

  const a = encrypt(GEHEIM, key, params);
  const b = encrypt(GEHEIM, key, params);

  assert.notEqual(a, b, "der Initialisierungsvektor muss je Speichervorgang neu sein");
  assert.notEqual(JSON.parse(a).cipher.iv, JSON.parse(b).cipher.iv);
  assert.equal(decryptWithKey(a, key), decryptWithKey(b, key), "beide bleiben lesbar");
});

test("jeder Tresor bekommt ein eigenes Salz", async () => {
  const a = await create(GEHEIM, "gleiches Passwort", SCHNELL);
  const b = await create(GEHEIM, "gleiches Passwort", SCHNELL);
  assert.notEqual(
    JSON.parse(a.text).kdf.salt,
    JSON.parse(b.text).kdf.salt,
    "gleiches Passwort darf nicht denselben Schluessel ergeben"
  );
});

test("der abgeleitete Schluessel ist reproduzierbar", async () => {
  const params = newVaultParams(SCHNELL);
  const a = await deriveKey("passwort123456", params.salt, params.kdf);
  const b = await deriveKey("passwort123456", params.salt, params.kdf);
  assert.ok(a.equals(b));
  assert.equal(a.length, 32, "256 Bit fuer AES-256");
});

test("leeres Passwort wird nicht akzeptiert", async () => {
  await assert.rejects(
    () => create(GEHEIM, "", SCHNELL),
    (err) => err.code === "empty_password"
  );
});

test("Umlaute im Passwort sind unabhaengig von der Zeichenzusammensetzung", async () => {
  /* "ü" als ein Zeichen gegen "u" plus Trema — beide Schreibweisen muessen
     dasselbe Passwort ergeben, sonst sperrt sich das Programm je nach Tastatur aus. */
  const zusammen = "Schlüssel-Passwort";
  const zerlegt = "Schlüssel-Passwort";
  assert.notEqual(zusammen, zerlegt, "Voraussetzung: die Zeichenketten sind roh verschieden");

  const { text } = await create(GEHEIM, zusammen, SCHNELL);
  const { plaintext } = await decrypt(text, zerlegt);
  assert.equal(plaintext, GEHEIM);
});

/* ------------------------------------------------------------------ */

test("isVault erkennt Tresor und Klartext auseinander", async () => {
  const { text } = await create(GEHEIM, "passwort123456", SCHNELL);
  assert.ok(isVault(text));
  assert.ok(!isVault(GEHEIM), "unverschluesselte Daten sind kein Tresor");
  assert.ok(!isVault("kein json"));
  assert.ok(!isVault(""));
  assert.ok(!isVault(null));
  assert.ok(!isVault('{"format":"etwas-anderes"}'));
});

test("readHeader meldet klar, was mit der Datei nicht stimmt", () => {
  assert.throws(() => readHeader("kaputt"), (e) => e.code === "not_json");
  assert.throws(() => readHeader('{"a":1}'), (e) => e.code === "not_a_vault");
  assert.throws(
    () => readHeader(JSON.stringify({ format: FORMAT, version: 99 })),
    (e) => e.code === "unsupported_version"
  );
});

test("ein fremdes Verschluesselungsverfahren wird nicht stillschweigend akzeptiert", async () => {
  const { text } = await create(GEHEIM, "passwort123456", SCHNELL);
  const o = JSON.parse(text);
  o.cipher.name = "aes-256-cbc";
  assert.throws(() => readHeader(JSON.stringify(o)), (e) => e.code === "unsupported_cipher");
});

/* ------------------------------------------------------------------ */

test("die Standardparameter sind nicht versehentlich schwach", () => {
  assert.equal(KDF_STANDARD.name, "scrypt");
  assert.ok(KDF_STANDARD.N >= 65536, "N unter 65536 waere zu billig zu durchsuchen");
  assert.equal(KDF_STANDARD.keylen, 32, "AES-256 braucht 256 Bit");
  assert.equal((KDF_STANDARD.N & (KDF_STANDARD.N - 1)), 0, "N muss eine Zweierpotenz sein");
});

test("Passwortbewertung sagt ehrlich, was sie sieht", () => {
  assert.equal(passwordStrength("").stufe, "leer");
  assert.equal(passwordStrength("kurz").stufe, "schwach");
  assert.equal(passwordStrength("Sommer2026!x").stufe, "stark");
  assert.equal(passwordStrength("vier zufaellige woerter hier").stufe, "stark");
  assert.ok(passwordStrength("abcdefghijkl").stufe !== "schwach", "Laenge zaehlt");
});

test("Passwortvergleich ist laufzeitunabhaengig und trotzdem korrekt", () => {
  assert.ok(samePassword("abc", "abc"));
  assert.ok(!samePassword("abc", "abd"));
  assert.ok(!samePassword("abc", "abcd"), "unterschiedliche Laenge");
  assert.ok(samePassword("café", "café"), "gleiche Schreibweise nach Normalisierung");
  assert.ok(!samePassword("abc", null));
});
