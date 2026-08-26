/**
 * Ad-hoc-Signatur fuer macOS.
 *
 * Warum es das gibt: `"identity": null` in package.json weist
 * electron-builder an, das Signieren zu ueberspringen — nachzulesen in
 * app-builder-lib, handleNullIdentity(). Das Ergebnis ist ein Programm
 * ganz ohne Signatur.
 *
 * Auf Apple Silicon fuehrt der Kernel kein arm64-Programm ohne Signatur
 * aus. Der Anwender sieht dann nicht die uebliche Warnung vor einem
 * unbekannten Entwickler, sondern „Blaubuch ist beschaedigt und kann
 * nicht geoeffnet werden" — und der Rechtsklick-Trick hilft dagegen
 * nicht, weil er die Antwort auf eine andere Meldung ist.
 *
 * Eine Ad-hoc-Signatur (`codesign --sign -`) behebt genau das. Sie ist
 * KEINE Vertrauensaussage: sie enthaelt kein Zertifikat und sagt niemandem,
 * wer das Programm gebaut hat. Sie stellt nur sicher, dass das Programm
 * ueberhaupt startet. Die Gatekeeper-Warnung bleibt und muss bleiben,
 * solange kein bezahltes Entwicklerzertifikat dahintersteht.
 *
 * CommonJS, weil electron-builder diese Datei selbst laedt — wie die
 * Dateien unter src/main/ auch.
 */

"use strict";

const { execFileSync } = require("node:child_process");
const path = require("node:path");

module.exports = async function adhocSign(context) {
  if (context.electronPlatformName !== "darwin") return;

  const app = path.join(context.appOutDir, context.packager.appInfo.productFilename + ".app");

  /* --deep gilt beim Signieren mit echtem Zertifikat als ueberholt, ist
     fuer eine Ad-hoc-Signatur aber der Weg, der auch alle mitgelieferten
     Hilfsprogramme und Rahmenwerke erfasst. Ohne sie bliebe ein Teil
     unsigniert und das Programm scheiterte an derselben Stelle. */
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], { stdio: "inherit" });

  /* Sofort nachpruefen: ein stiller Fehlschlag hier faellt sonst erst dem
     Anwender auf, und der kann ihn nicht deuten. */
  execFileSync("codesign", ["--verify", "--deep", "--strict", "--verbose=2", app], { stdio: "inherit" });

  console.log("Ad-hoc-Signatur gesetzt und geprüft: " + app);
};
