/**
 * Das Programmsymbol, gezeichnet aus Code.
 *
 * Kein Bildprogramm noetig und auf jedem Betriebssystem reproduzierbar.
 * Windows (.ico) und macOS (.icns) beziehen ihre Bilder aus denselben
 * Funktionen hier — sonst driften die beiden Symbole mit der Zeit
 * auseinander.
 *
 * Gezeichnet wird das Zeichen aus der Kopfleiste: blaues Feld mit
 * gekippter heller Raute.
 */

import zlib from "node:zlib";

const BLAU = [0x1b, 0x33, 0xc0];
const HELL = [0xf4, 0xf6, 0xfd];
const AA = 4; /* Kantenglaettung durch Mehrfachabtastung */

/** Abstandsfunktion eines abgerundeten Quadrats, negativ innerhalb. */
function rundesQuadrat(x, y, halb, radius) {
  const dx = Math.abs(x) - (halb - radius);
  const dy = Math.abs(y) - (halb - radius);
  const ax = Math.max(dx, 0);
  const ay = Math.max(dy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(dx, dy), 0) - radius;
}

/** Deckung eines Punktes: 1 innen, 0 aussen, dazwischen weich. */
const deckung = (abstand, weite) => Math.min(1, Math.max(0, 0.5 - abstand / weite));

/** Zeichnet das Symbol in einen RGBA-Puffer. */
export function zeichne(groesse) {
  const px = Buffer.alloc(groesse * groesse * 4);
  const mitte = groesse / 2;
  const feldHalb = groesse * 0.46;
  const feldRadius = groesse * 0.20;
  const rauteHalb = groesse * 0.21;
  const weite = 1 / AA;

  for (let y = 0; y < groesse; y++) {
    for (let x = 0; x < groesse; x++) {
      let feld = 0;
      let raute = 0;

      for (let sy = 0; sy < AA; sy++) {
        for (let sx = 0; sx < AA; sx++) {
          const px0 = x + (sx + 0.5) / AA - mitte;
          const py0 = y + (sy + 0.5) / AA - mitte;

          feld += deckung(rundesQuadrat(px0, py0, feldHalb, feldRadius), weite);
          /* Die Raute ist ein um 45 Grad gedrehtes Quadrat. */
          raute += deckung(Math.abs(px0) + Math.abs(py0) - rauteHalb, weite * 1.4);
        }
      }

      const proben = AA * AA;
      const aFeld = feld / proben;
      const aRaute = (raute / proben) * aFeld;

      const i = (y * groesse + x) * 4;
      for (let k = 0; k < 3; k++) {
        px[i + k] = Math.round(BLAU[k] * (1 - aRaute) + HELL[k] * aRaute);
      }
      px[i + 3] = Math.round(aFeld * 255);
    }
  }
  return px;
}

/* ------------------------------------------------------------------ *
 * PNG
 * ------------------------------------------------------------------ */

const CRC_TABELLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC_TABELLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(typ, daten) {
  const laenge = Buffer.alloc(4);
  laenge.writeUInt32BE(daten.length);
  const koerper = Buffer.concat([Buffer.from(typ, "ascii"), daten]);
  const pruef = Buffer.alloc(4);
  pruef.writeUInt32BE(crc32(koerper));
  return Buffer.concat([laenge, koerper, pruef]);
}

/** Kodiert einen RGBA-Puffer als PNG. */
export function png(groesse, pixel) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(groesse, 0);
  ihdr.writeUInt32BE(groesse, 4);
  ihdr[8] = 8;    /* 8 Bit je Kanal */
  ihdr[9] = 6;    /* RGBA */

  /* Jede Bildzeile bekommt ein Filterbyte 0 vorangestellt. */
  const roh = Buffer.alloc(groesse * (groesse * 4 + 1));
  for (let y = 0; y < groesse; y++) {
    const ziel = y * (groesse * 4 + 1);
    roh[ziel] = 0;
    pixel.copy(roh, ziel + 1, y * groesse * 4, (y + 1) * groesse * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(roh, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}
