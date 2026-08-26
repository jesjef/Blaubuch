# Blaubuch

Monatsbudget für den Schweizer Alltag. Läuft als Programm auf deinem
Rechner — kein Konto, keine Anmeldung, keine Netzwerkverbindung. Die Daten
liegen verschlüsselt in einer Datei, die dir gehört.

Gebaut für die Frage, die eine Tabellenkalkulation schlecht beantwortet:
**Was bleibt diesen Monat übrig, und woran liegt es?**

## Was es kann

- **Monate statt Transaktionen.** Ein Monat besteht aus Einnahmen,
  Daueraufträgen, Fixkosten, Kreditkartensalden und Ausgaben. Ein neuer
  Monat übernimmt das Wiederkehrende und lässt das Einmalige weg.
- **Ausgeben ist nicht gleich verlieren.** Jede Zeile trägt eine von drei
  Markierungen: Konsum, Investition unter eigener Kontrolle, Investition
  gebunden. Am Monatsende steht dadurch nicht nur, wie viel weg ist,
  sondern wie viel davon tatsächlich verloren ist.
- **Ehrliche Sparquote.** Kontostand und geliehenes Geld erhöhen die
  verfügbaren Mittel, zählen aber nicht als Einkommen. Die Sparquote misst
  am Erwerbseinkommen — sonst verbessert ein Darlehen die Zahl, ohne dass
  ein Franken mehr verdient wurde.
- **Eigene Kreditkarten.** Karten legst du selbst an, mit Name, Saldo und
  optionalem Limit. Blaubuch meldet sich, wenn eine Karte über ihr Limit
  geht oder ihm nahekommt.
- **Analyse im selben Fenster.** Grösster Kostenblock, Kartenlimits,
  Vergleich mit dem Vormonat.
- **Geldfluss auf einen Blick.** Eine Kachel zeigt, woher die Mittel kommen
  und wohin sie gehen — als Flussdiagramm oder als Ring, umschaltbar. Die
  Zahlen dahinter lassen sich als Tabelle aufklappen.
- **Hell oder dunkel, in fünf Farben.** Folgt von sich aus dem Betriebssystem;
  der Schalter oben rechts geht auf Wunsch fest auf Weiss oder Dunkel. Unter
  *Einstellungen* stehen fünf Farbschemata bereit — sie setzen nur den Farbton,
  Helligkeit und Kontrast bleiben gleich.
- **Ruhiges Dashboard.** Erklärungen liegen hinter dem Fragezeichen am
  Kartenkopf, Aktionen unter *Einstellungen*. Auf der Fläche stehen die Zahlen.
- **Umbenennen per Klick.** Ein Klick auf eine Bezeichnung macht sie
  editierbar — Enter übernimmt, Escape verwirft. Kein Löschen und Neuanlegen.
- **Privatsicht.** Das Auge oben rechts verdeckt alle Beträge, Kennzahlen
  und Diagramme. Was du gerade brauchst, gibst du mit Zeiger oder Fokus
  einzeln frei — praktisch, wenn jemand mitschaut.
- **Bericht für einen Chat.** Ein Klick legt den Monat als Fliesstext in
  die Zwischenablage, fertig zum Einfügen in ein Sprachmodell.
- **Schweizer Zahleneingabe.** `1'234,50`, `1234.50` oder `1 234.5` —
  alles wird richtig gelesen.

## Installation

Fertige Dateien unter [Releases](../../releases):

| System | Datei | Hinweis beim ersten Start |
|---|---|---|
| Windows | `Blaubuch-*-portable.exe` | SmartScreen: *Weitere Informationen → Trotzdem ausführen* |
| macOS Apple Silicon | `Blaubuch-*-arm64.dmg` | siehe unten |
| macOS Intel | `Blaubuch-*-x64.dmg` | siehe unten |

Keine Installation nötig. Keine der Fassungen trägt ein
Entwicklerzertifikat — daher die Hinweise. Sie erscheinen genau einmal.

**macOS im Einzelnen.** App aus dem `.dmg` nach *Programme* ziehen, dann
öffnen. Zwei verschiedene Meldungen sind möglich, und sie brauchen
verschiedene Antworten:

- *„… kann nicht geöffnet werden, da der Entwickler nicht verifiziert
  werden kann."* — **Systemeinstellungen → Datenschutz & Sicherheit**,
  dort unten auf **Trotzdem öffnen**. Das ist die normale Warnung vor
  Software ohne bezahltes Zertifikat.
- *„… ist beschädigt und kann nicht geöffnet werden."* — das betrifft die
  Fassungen bis einschliesslich 1.0.1. Sie waren fehlerhaft verpackt: das
  Programmpaket trug nur die Restsignatur des Linkers, die weder die
  Ressourcen noch die `Info.plist` abdeckt. macOS wertet das als
  Manipulation und bietet folgerichtig nur den Papierkorb an. **Das
  Entfernen der Quarantänemarkierung behebt das nicht** — es braucht eine
  gültige Signatur. Nimm 1.0.2 oder neuer.

Der Weg *Rechtsklick auf die App → Öffnen* stand hier früher und ist
seit macOS 15 wirkungslos; Apple hat ihn entfernt.

Die macOS-Fassung trägt eine Ad-hoc-Signatur. Ohne sie startet auf Apple
Silicon gar nichts. Sie enthält kein Zertifikat und sagt nichts darüber
aus, wer das Programm gebaut hat — sie sorgt nur dafür, dass es läuft.

Beim ersten Start legst du ein Passwort fest. Damit werden deine Zahlen auf
der Festplatte verschlüsselt. **Für ein vergessenes Passwort gibt es keine
Wiederherstellung** — nimm eine lange Wortfolge, die du dir merkst.

## Wo die Daten liegen

```
%APPDATA%\Blaubuch\blaubuch.json        Windows
~/Library/Application Support/Blaubuch/blaubuch.json    macOS
~/.config/Blaubuch/blaubuch.json                        Linux
```

Ältere Stände liegen im Unterordner `backups`, ebenfalls verschlüsselt.
*Datei → Datenordner öffnen* führt direkt hin.

**Betrieb vom Stick:** Liegt eine `blaubuch.json` neben der `.exe`, wird
diese benutzt statt der im Benutzerordner. Programm und Daten wandern damit
gemeinsam. Ein anderer Ordner lässt sich über die Umgebungsvariable
`BLAUBUCH_DATA` festlegen.

## Bedienung

| Tastenkürzel | Wirkung |
|---|---|
| `Strg` + `S` | Speichern (wird ohnehin automatisch gespeichert) |
| `Strg` + `Z` | Rückgängig |
| `Strg` + `←` / `→` | Vorheriger / nächster Monat |
| `Strg` + `N` | Neuen Monat anlegen |
| `Strg` + `L` | Tresor sperren |

Der Schalter oben rechts wechselt zwischen **System**, **hell** und **dunkel**;
das Zahnrad daneben öffnet die Einstellungen mit Farbwahl, Datei- und
Tresoraktionen.

Ein Betrag von `0` bedeutet: läuft diesen Monat nicht und wird nicht
abgezogen. Zeilen müssen dafür nicht gelöscht werden.

Ein Klick auf den farbigen Punkt links wechselt die Markierung einer Zeile,
ein Klick auf die Bezeichnung benennt sie um.

## Sicherheit

Die Daten sind mit AES-256-GCM verschlüsselt, der Schlüssel wird per scrypt
aus dem Passwort abgeleitet. Nach zehn falschen Passwörtern löscht Blaubuch
den Tresor und alle Sicherungen.

Das ist eine Entscheidung mit einer Kehrseite: sie trifft vor allem den
Besitzer nach einem vergessenen Passwort, und sie hält niemanden auf, der
die Datei vorher kopiert. **Lege eine verschlüsselte Kopie an einem zweiten
Ort ab.**

Bedrohungsmodell, Dateiformat und Härtungsmassnahmen stehen ausführlich in
[SECURITY.md](SECURITY.md). Die Löschung lässt sich dort beschriebenermassen
abschalten.

## Aus dem Quelltext bauen

Voraussetzung: Node.js 20 oder neuer.

```bash
npm install
npm run verify        # Suche nach Zugangsdaten, dann alle Tests
npm start             # Programm starten
npm run dist          # portable .exe nach dist/ bauen
```

Falls `npm install` meldet, dass Installationsskripte blockiert wurden:
Electron lädt seine Binärdatei in einem `postinstall`-Schritt.

```bash
npm install-scripts approve electron
rm -rf node_modules/electron && npm install
```

Weitere Befehle:

| Befehl | Wirkung |
|---|---|
| `npm test` | Alle Tests |
| `npm run check:secrets` | Repository auf Zugangsdaten und personenbezogene Spuren prüfen |
| `npm run assets` | Schriften und Programmsymbol erzeugen |
| `npm run dist:installer` | Installationsprogramm statt portabler `.exe` |
| `npm run pack` | Entpackter Ordner zum Testen, ohne Paketierung |
| `npm run vorschau` | Layoutvorschau im Browser auf http://localhost:8123 |
| `npm run dist:mac` | `.dmg` und `.zip` für macOS — **nur auf einem Mac** |

Ein `.dmg` lässt sich nur auf macOS erzeugen. Der Ablauf unter
`.github/workflows/build.yml` baut deshalb beide Plattformen auf GitHub;
ein Tag wie `v1.0.0` hängt die fertigen Dateien an einen Release-Entwurf.

`BLAUBUCH_DEBUG=1` leitet Meldungen der Oberfläche auf die Konsole um.

## Aufbau

```
src/
  shared/     budget.mjs    Rechnen: Summen, Analyse, Bericht, Einlesen
              fluss.mjs     Geometrie der Diagramme (reine Zahlen)
              vault.mjs     Verschlüsselung (nur Hauptprozess)
              password.mjs  Passwortbewertung (auch Oberfläche)
              seed.mjs      Startzustand einer frischen Installation
  main/       main.js       Fenster, Menü, IPC
              store.js      Dateizugriff, Schlüsselhaltung, Löschung
              preload.js    Die vollständige Liste dessen, was die Oberfläche darf
  renderer/   index.html    Gerüst
              app.mjs       Oberfläche
              lock.mjs      Zugangsbildschirme
              diagramm.mjs  SVG-Aufbau der Diagramme
              thema.mjs     Darstellung, Farbschema, Privatsicht
              einstellungen.mjs  Einstellungsdialog
              styles.css    Gestaltung
test/                       Rechenkern, Tresor, Ablage
tools/                      Schriften kopieren, Symbol erzeugen, Repo prüfen,
                            Layoutvorschau
```

`src/shared/` enthält reine Funktionen ohne DOM und ohne Dateizugriff — dort
liegt alles, was sich direkt testen lässt. Der Hauptprozess ist der einzige,
der die Festplatte anfasst und den Schlüssel kennt; die Oberfläche bekommt
kein Node.

## Was es nicht kann

- Keine Anbindung an Banken, kein Einlesen von Kontoauszügen.
- Keine mehreren Konten oder Währungen. Alles ist CHF.
- Keine Synchronisierung zwischen Geräten. Der Weg dafür ist die
  verschlüsselte Kopie plus *Daten einlesen …*.

## Lizenz

MIT — siehe [LICENSE](LICENSE). Die mitgelieferten Schriften Sora und
Instrument Sans stehen unter der SIL Open Font License 1.1.
