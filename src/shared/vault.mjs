/**
 * Blaubuch — Tresor.
 *
 * Verschluesselt den Datenbestand mit einem Passwort, das nie gespeichert
 * wird. Bewusst klein gehalten und ohne fremde Abhaengigkeiten: alles hier
 * kommt aus node:crypto und laesst sich in einem Durchgang lesen.
 *
 * Aufbau der Datei:
 *
 *   {
 *     "format": "blaubuch-vault",
 *     "version": 1,
 *     "kdf":    { "name": "scrypt", "N":…, "r":…, "p":…, "keylen":…, "salt": base64 },
 *     "cipher": { "name": "aes-256-gcm", "iv": base64, "tag": base64 },
 *     "data":   base64
 *   }
 *
 * Warum so:
 *  - scrypt statt PBKDF2, weil es zusaetzlich Arbeitsspeicher fordert und
 *    damit Angriffe mit Grafikkarten teuer macht.
 *  - AES-256-GCM statt AES-CBC, weil GCM neben der Verschluesselung auch
 *    erkennt, ob jemand an der Datei manipuliert hat.
 *  - Der Kopf der Datei wird als zusaetzliche Authentifizierungsdaten
 *    mitsigniert. Wer die Parameter herunterschraubt, um das Knacken zu
 *    erleichtern, macht die Datei damit unlesbar statt schwaecher.
 */

import { randomBytes, scrypt as scryptCb, createCipheriv, createDecipheriv, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

/* Weitergereicht, damit Aufrufer im Hauptprozess nur ein Modul brauchen.
   Die Oberflaeche laedt password.mjs direkt — sie darf node:crypto nicht sehen. */
export { passwordStrength } from "./password.mjs";

const scrypt = promisify(scryptCb);

export const FORMAT = "blaubuch-vault";
export const FORMAT_VERSION = 1;

/**
 * scrypt-Parameter. N=65536 bei r=8 belegt rund 64 MB und braucht auf
 * einem heutigen Rechner etwa eine halbe Sekunde — fuer einen Start
 * unauffaellig, fuer das Durchprobieren von Passwoertern teuer.
 */
export const KDF_STANDARD = Object.freeze({ name: "scrypt", N: 65536, r: 8, p: 1, keylen: 32 });

const SALT_BYTES = 16;
const IV_BYTES = 12;   /* fuer GCM empfohlene Laenge */
const TAG_BYTES = 16;

/** Grenzen gegen absichtlich absurde Werte aus einer fremden Datei. */
const KDF_GRENZEN = {
  N: { min: 16384, max: 1048576 },
  r: { min: 1, max: 32 },
  p: { min: 1, max: 16 },
  keylen: { min: 32, max: 64 }
};

class VaultError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "VaultError";
    this.code = code;
  }
}
export { VaultError };

const b64 = (buf) => Buffer.from(buf).toString("base64");
const unb64 = (s) => Buffer.from(String(s), "base64");

/** Erkennt eine verschluesselte Datei, ohne sie zu entschluesseln. */
export function isVault(text) {
  if (typeof text !== "string") return false;
  const kopf = text.slice(0, 200);
  if (!kopf.includes(FORMAT)) return false;
  try {
    const o = JSON.parse(text);
    return o?.format === FORMAT;
  } catch {
    return false;
  }
}

function pruefeKdf(kdf) {
  if (!kdf || kdf.name !== "scrypt") {
    throw new VaultError("unsupported_kdf", "Unbekanntes Schlüsselverfahren in der Datei.");
  }
  for (const [feld, { min, max }] of Object.entries(KDF_GRENZEN)) {
    const wert = kdf[feld];
    if (!Number.isInteger(wert) || wert < min || wert > max) {
      throw new VaultError("bad_params", "Die Datei nennt unplausible Parameter für " + feld + ".");
    }
  }
  /* scrypt verlangt, dass N eine Zweierpotenz ist. */
  if ((kdf.N & (kdf.N - 1)) !== 0) {
    throw new VaultError("bad_params", "Der Parameter N muss eine Zweierpotenz sein.");
  }
  return kdf;
}

/**
 * Leitet den Schluessel aus dem Passwort ab. Bewusst langsam.
 * maxmem muss mitwachsen, sonst weist node:crypto die Anfrage ab.
 */
export async function deriveKey(password, salt, kdf = KDF_STANDARD) {
  if (typeof password !== "string" || password.length === 0) {
    throw new VaultError("empty_password", "Ohne Passwort lässt sich kein Schlüssel bilden.");
  }
  const p = pruefeKdf(kdf);
  const maxmem = 256 * p.N * p.r + 2 * 1024 * 1024;
  return scrypt(password.normalize("NFC"), salt, p.keylen, { N: p.N, r: p.r, p: p.p, maxmem });
}

/** Frische Parameter fuer einen neuen Tresor. */
export function newVaultParams(kdf = KDF_STANDARD) {
  return { kdf: { ...pruefeKdf(kdf) }, salt: randomBytes(SALT_BYTES) };
}

/**
 * Verschluesselt Klartext zu einer fertigen Datei.
 * Der Schluessel wird uebergeben, damit er beim Speichern nicht jedes Mal
 * neu abgeleitet werden muss — das dauert absichtlich lange.
 */
export function encrypt(plaintext, key, { kdf, salt }) {
  if (typeof plaintext !== "string") throw new VaultError("bad_input", "Nur Text lässt sich verschlüsseln.");
  if (!Buffer.isBuffer(key) || key.length !== kdf.keylen) {
    throw new VaultError("bad_key", "Der Schlüssel passt nicht zu den Parametern der Datei.");
  }

  const iv = randomBytes(IV_BYTES);
  const kopf = {
    format: FORMAT,
    version: FORMAT_VERSION,
    kdf: { ...kdf, salt: b64(salt) },
    cipher: { name: "aes-256-gcm", iv: b64(iv) }
  };

  /* Der Kopf wird mitsigniert: Parameter aendern macht die Datei unlesbar. */
  const aad = Buffer.from(JSON.stringify(kopf), "utf8");
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad);
  const daten = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return JSON.stringify({
    ...kopf,
    cipher: { ...kopf.cipher, tag: b64(tag) },
    data: b64(daten)
  }, null, 2);
}

/** Liest Kopfdaten einer Datei, ohne das Passwort zu kennen. */
export function readHeader(text) {
  let o;
  try {
    o = JSON.parse(text);
  } catch {
    throw new VaultError("not_json", "Die Datei enthält kein lesbares JSON.");
  }
  if (o?.format !== FORMAT) throw new VaultError("not_a_vault", "Die Datei ist kein Blaubuch-Tresor.");
  if (o.version !== FORMAT_VERSION) {
    throw new VaultError("unsupported_version", "Die Datei stammt aus einer neueren Programmfassung (Format " + o.version + ").");
  }
  if (o.cipher?.name !== "aes-256-gcm") {
    throw new VaultError("unsupported_cipher", "Unbekanntes Verschlüsselungsverfahren in der Datei.");
  }

  const kdf = pruefeKdf({
    name: o.kdf?.name, N: o.kdf?.N, r: o.kdf?.r, p: o.kdf?.p, keylen: o.kdf?.keylen
  });
  const salt = unb64(o.kdf?.salt);
  const iv = unb64(o.cipher?.iv);
  const tag = unb64(o.cipher?.tag);
  const daten = unb64(o.data);

  if (salt.length !== SALT_BYTES) throw new VaultError("bad_params", "Das Salz hat die falsche Länge.");
  if (iv.length !== IV_BYTES) throw new VaultError("bad_params", "Der Initialisierungsvektor hat die falsche Länge.");
  if (tag.length !== TAG_BYTES) throw new VaultError("bad_params", "Die Prüfsumme hat die falsche Länge.");

  return { kdf, salt, iv, tag, daten, rohkopf: { format: o.format, version: o.version, kdf: o.kdf, cipher: { name: o.cipher.name, iv: o.cipher.iv } } };
}

/**
 * Entschluesselt eine Datei mit bereits abgeleitetem Schluessel.
 * Ein falsches Passwort und eine manipulierte Datei sind von aussen nicht
 * zu unterscheiden — beides scheitert an der Pruefsumme, was richtig ist.
 */
export function decryptWithKey(text, key) {
  const { kdf, iv, tag, daten, rohkopf } = readHeader(text);
  if (!Buffer.isBuffer(key) || key.length !== kdf.keylen) {
    throw new VaultError("bad_key", "Der Schlüssel passt nicht zu den Parametern der Datei.");
  }

  const aad = Buffer.from(JSON.stringify(rohkopf), "utf8");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);

  try {
    return Buffer.concat([decipher.update(daten), decipher.final()]).toString("utf8");
  } catch {
    throw new VaultError("wrong_password", "Falsches Passwort, oder die Datei wurde verändert.");
  }
}

/** Bequemer Weg: Passwort hinein, Klartext heraus. */
export async function decrypt(text, password) {
  const { kdf, salt } = readHeader(text);
  const key = await deriveKey(password, salt, kdf);
  return { plaintext: decryptWithKey(text, key), key, kdf, salt };
}

/** Bequemer Weg fuer einen neuen Tresor: Passwort hinein, Datei heraus. */
export async function create(plaintext, password, kdf = KDF_STANDARD) {
  const params = newVaultParams(kdf);
  const key = await deriveKey(password, params.salt, params.kdf);
  return { text: encrypt(plaintext, key, params), key, ...params };
}

/** Vergleicht zwei Passwoerter ohne verwertbaren Zeitunterschied. */
export function samePassword(a, b) {
  const ba = Buffer.from(String(a ?? "").normalize("NFC"), "utf8");
  const bb = Buffer.from(String(b ?? "").normalize("NFC"), "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
