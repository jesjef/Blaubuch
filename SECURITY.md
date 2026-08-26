# Sicherheit

Dieses Dokument beschreibt, wogegen Blaubuch schützt, wogegen ausdrücklich
nicht, und wo die Angriffsfläche liegt. Es ist bewusst nüchtern gehalten —
eine Sicherheitszusage, die man nicht halten kann, ist schlimmer als keine.

## Was Blaubuch schützt

Blaubuch verwaltet Gehalt, Schulden, Zahlungen an Angehörige und
Kartensalden. Das ist der Datenbestand, um den es geht. Er liegt in genau
einer Datei:

```
%APPDATA%\Blaubuch\blaubuch.json        (Windows)
~/.config/Blaubuch/blaubuch.json        (Linux)
```

Die Datei ist mit **AES-256-GCM** verschlüsselt. Der Schlüssel wird mit
**scrypt** (N=65536, r=8, p=1, 32 Byte) aus dem Passwort abgeleitet. Das
Passwort wird nirgends gespeichert.

## Bedrohungsmodell

| Angreifer | Geschützt? | Warum |
|---|---|---|
| Findet die Datei in einem Cloud-Ordner, Backup oder auf einem Stick | **Ja** | Ohne Passwort ist die Datei Rauschen. |
| Stiehlt die Festplatte oder den Rechner im ausgeschalteten Zustand | **Ja** | Wie oben. |
| Verändert die Datei, um Beträge zu manipulieren | **Ja** | GCM erkennt jede Änderung; die Datei lässt sich dann nicht mehr öffnen. |
| Setzt die scrypt-Parameter herunter, um schneller zu raten | **Ja** | Der Kopf der Datei ist mitsigniert; abgesenkte Parameter machen sie unlesbar. |
| Probiert Passwörter *im Programm* durch | **Teilweise** | Verzögerung ab dem 3. Fehlversuch, Löschung nach dem 10. |
| Kopiert die Datei und probiert die Kopie offline durch | **Nein** | Nur das Passwort schützt. Deshalb: lange Wortfolge, kein kurzes Kunstwort. |
| Führt Schadsoftware unter deinem Windows-Konto aus, während Blaubuch offen ist | **Nein** | Der Schlüssel liegt dann im Arbeitsspeicher. Kein lokales Programm kann das verhindern. |
| Liest den Bildschirm mit oder protokolliert Tastatureingaben | **Nein** | Ausserhalb der Reichweite einer Anwendung. |

Kurz: Blaubuch schützt die Daten **im Ruhezustand**. Gegen einen bereits
kompromittierten Rechner schützt es nicht und kann es nicht.

## Löschung nach 10 Fehlversuchen

Nach zehn falschen Passwörtern löscht Blaubuch den Tresor, alle Sicherungen
im Unterordner `backups` und liegengebliebene Klartextdateien aus einer
Umstellung.

**Was das leistet:** Es verhindert, dass jemand, der nur dieses Programm vor
sich hat, in Ruhe herumprobiert.

**Was es nicht leistet:** Es hält niemanden auf, der die Datei zuerst
kopiert. Der Zähler liegt in `versuche.json` neben dem Tresor — er kann
nicht in der verschlüsselten Datei stehen (ohne Passwort nicht schreibbar)
und nicht im signierten Kopf (das macht ihn unlesbar). Wer die Zählerdatei
löscht, setzt ihn zurück; wer so weit kommt, hätte aber ohnehin den Tresor
kopieren können.

**Wen es zuverlässig trifft:** dich, nach einem vergessenen Passwort. Und
jeden, der Zugang zu deinem entsperrten Rechner hat und zehnmal etwas
eintippt. Es ist ein Selbstzerstörungsknopf, den jeder drücken kann, der
das Programm öffnen kann.

**Deshalb:** Lege eine verschlüsselte Kopie an einem zweiten Ort ab
(*Datei → Verschlüsselte Kopie sichern …*). Sie ist von der Löschung nicht
betroffen.

Abschalten lässt sich die Löschung über die Konstante `LOESCHEN_NACH` in
[`src/main/store.js`](src/main/store.js); `0` deaktiviert sie.

Das Überschreiben vor dem Entfernen erschwert einfaches Wiederherstellen,
ist aber **keine forensische Löschung**: auf SSDs und kopierenden
Dateisystemen können alte Blöcke physisch bestehen bleiben.

## Aufbau der Datei

```json
{
  "format": "blaubuch-vault",
  "version": 1,
  "kdf":    { "name": "scrypt", "N": 65536, "r": 8, "p": 1, "keylen": 32, "salt": "…" },
  "cipher": { "name": "aes-256-gcm", "iv": "…", "tag": "…" },
  "data":   "…"
}
```

- **Salz**: 16 Byte, je Tresor neu. Gleiches Passwort ergibt nie denselben Schlüssel.
- **IV**: 12 Byte, bei **jedem** Speichervorgang neu. Zweimal derselbe IV unter demselben Schlüssel würde GCM brechen.
- **AAD**: der gesamte Kopf ohne `tag` und `data`. Damit sind Parameter und IV mitsigniert.
- **Prüfsumme**: 16 Byte GCM-Tag.

Fremde Dateien werden vor der Verwendung geprüft: unbekanntes Verfahren,
unplausible Parameter (N zu klein, keine Zweierpotenz, Speicherbombe) und
falsch lange Felder werden abgewiesen, statt sie zu verarbeiten.

## Härtung der Anwendung

| Massnahme | Wo |
|---|---|
| `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` | [`src/main/main.js`](src/main/main.js) |
| Content-Security-Policy ohne `unsafe-inline`, ohne externe Quellen | [`src/renderer/index.html`](src/renderer/index.html) |
| Navigation nach aussen blockiert, Links öffnen im Systembrowser | [`src/main/main.js`](src/main/main.js) |
| Alle Berechtigungsanfragen werden abgelehnt | [`src/main/main.js`](src/main/main.js) |
| Schriften liegen im Programm, nichts wird nachgeladen | [`src/renderer/fonts/`](src/renderer/) |
| Die Oberfläche setzt nie `innerHTML` — alles über `textContent` | [`src/renderer/app.mjs`](src/renderer/app.mjs) |
| Diagramme werden als SVG aus eigenen Zahlen gebaut, ohne Fremdbibliothek | [`src/shared/fluss.mjs`](src/shared/fluss.mjs) |
| Nur benannte IPC-Kanäle, Menübefehle gegen eine feste Liste geprüft | [`src/main/preload.js`](src/main/preload.js) |
| Der Schlüssel verlässt den Hauptprozess nie | [`src/main/store.js`](src/main/store.js) |
| Atomares Schreiben über temporäre Datei und Umbenennen | [`src/main/store.js`](src/main/store.js) |
| Keine Laufzeitabhängigkeiten ausser Electron selbst | [`package.json`](package.json) |

## Die Ad-hoc-Signatur ist keine Vertrauensaussage

Die macOS-Fassung wird beim Bauen ad-hoc signiert
([`tools/adhoc-sign.js`](tools/adhoc-sign.js)). Das ist eine technische
Notwendigkeit, keine Beglaubigung: auf Apple Silicon führt der Kernel kein
Programm ohne Signatur aus. Eine Ad-hoc-Signatur enthält **kein
Zertifikat**, nennt keinen Urheber und ist von niemandem geprüft. Sie sagt
nur: dieses Programm ist seit dem Signieren nicht verändert worden.

Wer der Datei trauen will, hat weiterhin genau einen belastbaren Weg —
selbst aus dem Quelltext bauen. Die Windows-Fassung ist gar nicht signiert.

## Was bewusst unverschlüsselt ist

- **Zwischenablage**: *Bericht kopieren* legt den Monatsbericht im Klartext
  in die Zwischenablage. Das ist der Zweck der Funktion. Andere Programme
  können die Zwischenablage lesen.
- **Unverschlüsselte Kopie**: *Datei → Unverschlüsselte Kopie sichern …*
  schreibt Klartext. Es gibt eine ausdrückliche Rückfrage davor.
- **Fenstergrösse** in `window.json` — enthält keine Finanzdaten.
- **Fehlversuchszähler** in `versuche.json` — enthält keine Finanzdaten.
- **Ansichtseinstellungen** im Browserspeicher des Fensters: die gewählte
  Darstellung (hell/dunkel), das Farbschema und die zuletzt benutzte
  Diagrammansicht. Es sind Schlüssel mit Werten wie `light`/`dark`,
  `petrol` oder `sankey`/`kuchen` — keine Beträge, keine Namen. Sie liegen bewusst dort und nicht im Tresor: eine
  Ansichtseinstellung soll auch dann gelten, wenn der Tresor noch zu ist.

## Sicherungen tragen das Passwort von damals

Ein Passwortwechsel verschlüsselt den Tresor neu — **die automatischen
Sicherungen im Unterordner `backups` bleiben aber mit dem alten Passwort
lesbar**. Wer ein bekannt gewordenes Passwort ersetzt, entwertet es damit
nicht rückwirkend.

Deshalb bietet der Passwortwechsel an, die alten Sicherungen dabei zu
löschen. Das ist ein Abwägen: danach gibt es keinen Weg zurück auf einen
früheren Stand. Von Hand gesicherte Kopien sind nicht betroffen — sie
behalten ohnehin das Passwort, mit dem sie erstellt wurden.

## Privatsicht ist Sichtschutz, keine Verschlüsselung

Das Auge in der Kopfleiste zeichnet Beträge, Kennzahlen und Diagramme
unscharf. Das hilft gegen Mitleser und in Bildschirmfotos — die Werte
stehen aber weiterhin im Dokument und sind über die Entwicklerwerkzeuge
oder durch Ausschalten der Ansicht sofort wieder da. Eine Bequemlichkeit,
keine Schutzmassnahme.

## Selbst prüfen

```bash
npm run verify
```

Das führt die Suche nach Zugangsdaten und personenbezogenen Spuren aus und
danach alle Tests.

Für eigene Suchbegriffe — Namen von Angehörigen, Arbeitgeber, Bankverbindung —
lege eine Datei `.secretwords` im Projektstamm an, eine Zeile je Begriff.
Sie steht in `.gitignore` und darf **niemals** veröffentlicht werden: die
Liste selbst wäre sonst das Leck.

Lohnende Stellen für eine eigene Durchsicht, in dieser Reihenfolge:

1. [`src/shared/vault.mjs`](src/shared/vault.mjs) — die gesamte Kryptografie, rund 200 Zeilen.
2. [`src/main/store.js`](src/main/store.js) — Dateizugriff, Schlüsselhaltung, Löschung.
3. [`src/main/preload.js`](src/main/preload.js) — die vollständige Liste dessen, was die Oberfläche darf.
4. [`src/main/main.js`](src/main/main.js) — Fenstereinstellungen und IPC-Handler.

Die Tests in [`test/vault.test.mjs`](test/vault.test.mjs) und
[`test/store.test.mjs`](test/store.test.mjs) beschreiben das erwartete
Verhalten in Prosa und lassen sich als Prüfliste lesen.

## Abhängigkeiten

Blaubuch hat **keine Laufzeitabhängigkeiten**. Electron und electron-builder
sind reine Entwicklungswerkzeuge, die Schriften stammen aus
`@fontsource`-Paketen und werden beim Bauen hineinkopiert.

```bash
npm audit
```

Die Angriffsfläche zur Laufzeit ist damit Electron/Chromium selbst. Halte
die Electron-Version aktuell — dort erscheinen die sicherheitsrelevanten
Aktualisierungen.

## Eine Lücke melden

Dies ist ein privates Projekt ohne Sicherheitsteam. Melde Funde als
GitHub-Issue. Wenn ein Fund fremde Daten gefährden könnte, beschreibe ihn
zuerst ohne funktionsfähigen Angriffscode.
