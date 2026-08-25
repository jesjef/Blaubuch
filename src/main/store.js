/**
 * Blaubuch — Ablage.
 *
 * Der einzige Ort, der die Festplatte anfasst, und der einzige, der den
 * Schluessel kennt. Der Schluessel lebt ausschliesslich hier im Speicher
 * des Hauptprozesses: er wird nie geschrieben, nie protokolliert und nie
 * an die Oberflaeche gegeben.
 *
 * Auf der Platte liegt nur der Tresor aus vault.mjs — verschluesselt und
 * gegen Manipulation gesichert.
 */

"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const { pathToFileURL } = require("node:url");

const DATA_NAME = "blaubuch.json";
const BACKUP_DIR = "backups";
const VERSUCHE_NAME = "versuche.json";
const BACKUP_KEEP = 20;
const BACKUP_MIN_ABSTAND_MS = 60 * 60 * 1000;

/* Nach Fehlversuchen wird gewartet — gegen stures Durchprobieren.
   scrypt kostet ohnehin schon Zeit, das hier deckelt die Rate zusaetzlich. */
const SPERRE_AB = 3;
const SPERRE_STUFE_MS = 2000;
const SPERRE_MAX_MS = 30000;

/**
 * Nach so vielen Fehlversuchen werden die Daten geloescht.
 *
 * Was das leistet und was nicht — ehrlich:
 *  - Es schuetzt NICHT gegen jemanden, der die Datei kopiert und die Kopie
 *    in Ruhe durchprobiert. Dagegen hilft ausschliesslich das Passwort.
 *  - Es schuetzt gegen jemanden, der nur dieses Programm vor sich hat und
 *    darin herumprobiert.
 *  - Es trifft zuverlaessig den Besitzer nach einem vergessenen Passwort.
 *
 * Der Zaehler liegt in einer eigenen Datei neben dem Tresor: im Tresor
 * ginge es nicht (ohne Passwort nicht schreibbar) und im signierten Kopf
 * auch nicht (das macht ihn unlesbar). Wer die Zaehlerdatei loescht,
 * setzt ihn zurueck — wer so weit kommt, haette aber auch den Tresor
 * kopieren koennen.
 *
 * Auf 0 gesetzt ist die Loeschung abgeschaltet.
 */
const LOESCHEN_NACH = 10;

/** Ab hier wird in der Oberflaeche gewarnt, wie viele Versuche bleiben. */
const WARNEN_AB_REST = 5;

/* vault.mjs ist ein ES-Modul, dieser Hauptprozess laeuft als CommonJS. */
let vaultPromise = null;
const vault = () => (vaultPromise ??= import(pathToFileURL(path.join(__dirname, "..", "shared", "vault.mjs")).href));

class Store {
  /** @param {() => string} verzeichnis liefert den Ablageordner */
  constructor(verzeichnis) {
    this.verzeichnis = verzeichnis;
    this.schluessel = null;   /* Buffer, nur im Speicher */
    this.params = null;       /* {kdf, salt} */
    this.fehlversuche = 0;
  }

  get datei() { return path.join(this.verzeichnis(), DATA_NAME); }
  get sicherungen() { return path.join(this.verzeichnis(), BACKUP_DIR); }
  get zaehlerdatei() { return path.join(this.verzeichnis(), VERSUCHE_NAME); }
  get entsperrt() { return this.schluessel !== null; }

  /* ---------------------------------------------------------------- *
   * Fehlversuche — ueber Programmstarts hinweg
   * ---------------------------------------------------------------- */

  async #ladeVersuche() {
    try {
      const o = JSON.parse(await fsp.readFile(this.zaehlerdatei, "utf8"));
      return Number.isInteger(o?.fehlversuche) && o.fehlversuche >= 0 ? o.fehlversuche : 0;
    } catch {
      return 0;
    }
  }

  async #speichereVersuche(anzahl) {
    try {
      await fsp.mkdir(this.verzeichnis(), { recursive: true });
      await fsp.writeFile(
        this.zaehlerdatei,
        JSON.stringify({ fehlversuche: anzahl, zuletzt: new Date().toISOString() }, null, 2),
        "utf8"
      );
    } catch { /* nicht schlimm — dann zaehlt eben nur die laufende Sitzung */ }
  }

  async #versucheZuruecksetzen() {
    this.fehlversuche = 0;
    await fsp.unlink(this.zaehlerdatei).catch(() => {});
  }

  /**
   * Loescht Tresor, Sicherungen, den Zaehler und liegengebliebene
   * Klartextdateien aus der Umstellung.
   *
   * Vor dem Entfernen wird einmal mit Zufallsdaten ueberschrieben. Das
   * erschwert einfaches Wiederherstellen, ist aber KEINE forensische
   * Loeschung: auf SSDs und kopierenden Dateisystemen koennen alte Bloecke
   * physisch bestehen bleiben.
   */
  async wipe() {
    const dir = this.verzeichnis();
    const ueberschreibenUndLoeschen = async (datei) => {
      try {
        const { size } = await fsp.stat(datei);
        if (size > 0) await fsp.writeFile(datei, randomBytes(size));
        await fsp.unlink(datei);
      } catch { /* schon weg */ }
    };

    let namen = [];
    try { namen = await fsp.readdir(dir); } catch { /* Ordner fehlt */ }

    for (const name of namen) {
      if (name === DATA_NAME || name === VERSUCHE_NAME || /^blaubuch.*\.json$/i.test(name)) {
        await ueberschreibenUndLoeschen(path.join(dir, name));
      }
    }

    try {
      for (const name of await fsp.readdir(this.sicherungen)) {
        await ueberschreibenUndLoeschen(path.join(this.sicherungen, name));
      }
      await fsp.rmdir(this.sicherungen).catch(() => {});
    } catch { /* keine Sicherungen vorhanden */ }

    this.lock();
    this.fehlversuche = 0;
  }

  /* ---------------------------------------------------------------- *
   * Zustand
   * ---------------------------------------------------------------- */

  /**
   * Was liegt da? Beantwortet die Frage, welchen Bildschirm die
   * Oberflaeche zeigen muss, ohne irgendetwas zu entschluesseln.
   */
  async status() {
    const datei = this.datei;
    const fehlversuche = await this.#ladeVersuche();
    const rest = LOESCHEN_NACH > 0 ? Math.max(0, LOESCHEN_NACH - fehlversuche) : null;
    const grenze = { fehlversuche, rest, loeschenNach: LOESCHEN_NACH, warnenAbRest: WARNEN_AB_REST };

    let text;
    try {
      text = await fsp.readFile(datei, "utf8");
    } catch (err) {
      if (err.code === "ENOENT") return { zustand: "leer", path: datei, ...grenze };
      return { zustand: "fehler", path: datei, error: err.message, ...grenze };
    }

    const v = await vault();
    if (v.isVault(text)) return { zustand: "verschluesselt", path: datei, ...grenze };

    /* Eine Datei aus einer Fassung vor der Verschluesselung. */
    try {
      JSON.parse(text);
      return { zustand: "klartext", path: datei, ...grenze };
    } catch {
      return { zustand: "beschaedigt", path: datei, ...grenze };
    }
  }

  /* ---------------------------------------------------------------- *
   * Oeffnen und Anlegen
   * ---------------------------------------------------------------- */

  async #warteNachFehlversuch() {
    if (this.fehlversuche < SPERRE_AB) return;
    const ms = Math.min(SPERRE_MAX_MS, SPERRE_STUFE_MS * (this.fehlversuche - SPERRE_AB + 1));
    await new Promise((r) => setTimeout(r, ms));
  }

  /** Tresor mit Passwort oeffnen. Der Schluessel bleibt danach im Speicher. */
  async unlock(password) {
    const v = await vault();

    /* Der gespeicherte Zaehler gilt — sonst genuegte ein Neustart. */
    this.fehlversuche = Math.max(this.fehlversuche, await this.#ladeVersuche());
    await this.#warteNachFehlversuch();

    let text;
    try {
      text = await fsp.readFile(this.datei, "utf8");
    } catch (err) {
      return { ok: false, code: "no_file", error: err.message };
    }

    try {
      const { plaintext, key, kdf, salt } = await v.decrypt(text, password);
      this.schluessel = key;
      this.params = { kdf, salt };
      await this.#versucheZuruecksetzen();
      return { ok: true, text: plaintext };
    } catch (err) {
      if (err.code !== "wrong_password") {
        return { ok: false, code: err.code ?? "unknown", error: err.message };
      }

      this.fehlversuche += 1;
      await this.#speichereVersuche(this.fehlversuche);

      if (LOESCHEN_NACH > 0 && this.fehlversuche >= LOESCHEN_NACH) {
        await this.wipe();
        return {
          ok: false,
          code: "wiped",
          error: "Nach " + LOESCHEN_NACH + " Fehlversuchen wurden die Daten gelöscht.",
          fehlversuche: LOESCHEN_NACH,
          rest: 0
        };
      }

      const rest = LOESCHEN_NACH > 0 ? LOESCHEN_NACH - this.fehlversuche : null;
      return {
        ok: false,
        code: "wrong_password",
        error: err.message,
        fehlversuche: this.fehlversuche,
        rest,
        warnen: rest !== null && rest <= WARNEN_AB_REST
      };
    }
  }

  /** Neuen Tresor anlegen — beim ersten Start oder nach dem Zuruecksetzen. */
  async create(password, plaintext) {
    const v = await vault();
    try {
      const { text, key, kdf, salt } = await v.create(plaintext, password);
      await fsp.mkdir(this.verzeichnis(), { recursive: true });
      await this.#schreibeAtomar(this.datei, text);
      this.schluessel = key;
      this.params = { kdf, salt };
      await this.#versucheZuruecksetzen();
      return { ok: true, path: this.datei, savedAt: new Date().toISOString() };
    } catch (err) {
      return { ok: false, code: err.code ?? "unknown", error: err.message };
    }
  }

  /**
   * Eine alte Klartextdatei uebernehmen und ab sofort verschluesseln.
   * Das Original wird nicht geloescht, sondern zur Seite gelegt — wer sich
   * beim Passwort vertippt hat, steht sonst ohne Daten da.
   */
  async encryptExisting(password) {
    const v = await vault();
    let klartext;
    try {
      klartext = await fsp.readFile(this.datei, "utf8");
      JSON.parse(klartext);
    } catch (err) {
      return { ok: false, code: "unreadable", error: err.message };
    }

    /* Ein Tresor ist selbst gueltiges JSON — ohne diese Pruefung wuerde er
       ein zweites Mal verschluesselt und waere nur noch mit beiden
       Passwoertern in der richtigen Reihenfolge zu oeffnen. */
    if (v.isVault(klartext)) {
      return { ok: false, code: "already_encrypted", error: "Diese Datei ist bereits verschlüsselt." };
    }

    const beiseite = this.datei.replace(/\.json$/, "") + "-unverschluesselt-"
      + new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19) + ".json";

    try {
      await fsp.rename(this.datei, beiseite);
    } catch (err) {
      return { ok: false, code: "rename_failed", error: err.message };
    }

    const res = await this.create(password, klartext);
    if (!res.ok) {
      /* Anlegen gescheitert — Original zurueckholen, nichts verloren. */
      await fsp.rename(beiseite, this.datei).catch(() => {});
      return res;
    }
    return { ...res, altdatei: beiseite };
  }

  /**
   * Passwort wechseln: alter Tresor wird gelesen, neu verschluesselt.
   *
   * Wichtig und leicht zu uebersehen: die Sicherungen im Unterordner bleiben
   * mit dem ALTEN Passwort lesbar. Ein Passwortwechsel entwertet ein
   * bekannt gewordenes Passwort also nicht rueckwirkend.
   *
   * `sicherungenLoeschen` raeumt sie deshalb auf Wunsch mit weg — der
   * Aufrufer muss die Entscheidung treffen, nicht diese Ebene: es ist ein
   * Abwaegen zwischen Vertraulichkeit und Wiederherstellbarkeit.
   */
  async changePassword(alt, neu, { sicherungenLoeschen = false } = {}) {
    const auf = await this.unlock(alt);
    if (!auf.ok) return auf;

    if (sicherungenLoeschen) await this.#sicherungenEntfernen();
    else await this.#sicherung();

    return this.create(neu, auf.text);
  }

  /** Alle Sicherungen ueberschreiben und entfernen. */
  async #sicherungenEntfernen() {
    try {
      for (const name of await fsp.readdir(this.sicherungen)) {
        const voll = path.join(this.sicherungen, name);
        const { size } = await fsp.stat(voll);
        if (size > 0) await fsp.writeFile(voll, randomBytes(size));
        await fsp.unlink(voll);
      }
      await fsp.rmdir(this.sicherungen).catch(() => {});
    } catch { /* keine Sicherungen vorhanden */ }
  }

  /** Schluessel vergessen. Danach ist wieder das Passwort noetig. */
  lock() {
    if (this.schluessel) this.schluessel.fill(0);
    this.schluessel = null;
    this.params = null;
  }

  /* ---------------------------------------------------------------- *
   * Schreiben
   * ---------------------------------------------------------------- */

  /**
   * Ueber eine temporaere Datei schreiben und umbenennen. Ein Absturz
   * mitten im Vorgang laesst die alte, vollstaendige Datei stehen.
   */
  async #schreibeAtomar(datei, text) {
    const tmp = datei + ".tmp";
    const handle = await fsp.open(tmp, "w");
    try {
      await handle.writeFile(text, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fsp.rename(tmp, datei);
  }

  async #sicherung() {
    if (!fs.existsSync(this.datei)) return;
    await fsp.mkdir(this.sicherungen, { recursive: true });

    const liste = async () => (await fsp.readdir(this.sicherungen))
      .filter((n) => n.startsWith("blaubuch-") && n.endsWith(".json"))
      .sort();

    const vorhanden = await liste();
    if (vorhanden.length > 0) {
      const neueste = path.join(this.sicherungen, vorhanden[vorhanden.length - 1]);
      const stat = await fsp.stat(neueste).catch(() => null);
      if (stat && Date.now() - stat.mtimeMs < BACKUP_MIN_ABSTAND_MS) return;
    }

    const stempel = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    await fsp.copyFile(this.datei, path.join(this.sicherungen, "blaubuch-" + stempel + ".json"));

    const nachher = await liste();
    for (const alt of nachher.slice(0, Math.max(0, nachher.length - BACKUP_KEEP))) {
      await fsp.unlink(path.join(this.sicherungen, alt)).catch(() => {});
    }
  }

  /** Klartext entgegennehmen, verschluesselt ablegen. */
  async write(plaintext) {
    if (!this.entsperrt) return { ok: false, code: "locked", error: "Der Tresor ist verschlossen." };
    if (typeof plaintext !== "string" || plaintext.length === 0) {
      return { ok: false, code: "empty", error: "Leerer Inhalt wird nicht geschrieben." };
    }

    const v = await vault();
    try {
      const text = v.encrypt(plaintext, this.schluessel, this.params);
      await fsp.mkdir(this.verzeichnis(), { recursive: true });
      await this.#sicherung();
      await this.#schreibeAtomar(this.datei, text);
      return { ok: true, path: this.datei, savedAt: new Date().toISOString() };
    } catch (err) {
      return { ok: false, code: err.code ?? "unknown", error: err.message };
    }
  }

  /* ---------------------------------------------------------------- *
   * Kopien
   * ---------------------------------------------------------------- */

  /** Verschluesselte Kopie an einen frei gewaehlten Ort. */
  async exportEncrypted(plaintext, ziel) {
    if (!this.entsperrt) return { ok: false, code: "locked" };
    const v = await vault();
    try {
      await this.#schreibeAtomar(ziel, v.encrypt(plaintext, this.schluessel, this.params));
      return { ok: true, path: ziel };
    } catch (err) {
      return { ok: false, code: err.code ?? "unknown", error: err.message };
    }
  }

  /** Klartextkopie — nur auf ausdrueckliche Bestaetigung hin. */
  async exportPlain(plaintext, ziel) {
    try {
      await this.#schreibeAtomar(ziel, plaintext);
      return { ok: true, path: ziel };
    } catch (err) {
      return { ok: false, code: err.code ?? "unknown", error: err.message };
    }
  }

  /** Datei einlesen und sagen, ob sie ein Tresor ist. Entschluesselt nichts. */
  async readForImport(quelle) {
    const v = await vault();
    try {
      const text = await fsp.readFile(quelle, "utf8");
      return { ok: true, text, verschluesselt: v.isVault(text), path: quelle };
    } catch (err) {
      return { ok: false, code: "unreadable", error: err.message };
    }
  }

  /**
   * Einen fremden Tresor mit eigenem Passwort oeffnen — ohne den eigenen
   * anzutasten.
   *
   * Auch hier greift die Bremse nach Fehlversuchen. Ohne sie waere dieser
   * Weg ein schnelles Orakel: wer eine Kopie des eigenen Tresors einliest,
   * koennte darin unbegrenzt und ohne Verzoegerung Passwoerter durchprobieren
   * und damit sowohl die Bremse als auch die Loeschung umgehen.
   */
  async decryptForeign(text, password) {
    const v = await vault();
    this.fehlversuche = Math.max(this.fehlversuche, await this.#ladeVersuche());
    await this.#warteNachFehlversuch();
    try {
      const { plaintext } = await v.decrypt(text, password);
      return { ok: true, text: plaintext };
    } catch (err) {
      if (err.code === "wrong_password") {
        this.fehlversuche += 1;
        await this.#speichereVersuche(this.fehlversuche);
      }
      return { ok: false, code: err.code ?? "unknown", error: err.message };
    }
  }
}

module.exports = { Store, DATA_NAME, VERSUCHE_NAME, LOESCHEN_NACH, WARNEN_AB_REST };
