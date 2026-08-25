/**
 * Winziger Dateiserver nur für die Layoutvorschau.
 *
 * Electron liefert die Oberfläche sonst per file://, was sich schlecht
 * in einem Browser prüfen lässt. Dieser Server dient ausschliesslich der
 * Entwicklung und wird nicht mit ausgeliefert.
 *
 * Aufruf: npm run vorschau  →  http://localhost:8123
 */

import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT ?? 8123);

const TYPEN = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

http.createServer(async (req, res) => {
  const pfad = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  const relativ = pfad === "/" ? "tools/vorschau.html" : pfad.slice(1);
  const datei = path.join(root, relativ);

  /* Nichts ausserhalb des Projektordners ausliefern. */
  if (!datei.startsWith(root + path.sep)) {
    res.writeHead(403).end("Ausserhalb des Projekts");
    return;
  }

  try {
    const inhalt = await fs.readFile(datei);
    res.writeHead(200, {
      "Content-Type": TYPEN[path.extname(datei)] ?? "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(inhalt);
  } catch {
    res.writeHead(404).end("Nicht gefunden: " + relativ);
  }
}).listen(PORT, "127.0.0.1", () => {
  console.log("Layoutvorschau auf http://localhost:" + PORT);
});
