import test from "node:test";
import assert from "node:assert/strict";

import {
  herkunft, verwendung, flussDaten,
  sankeyLayout, kuchenLayout, ringPfad, bandPfad, beschrifte, beschriftungsLayout, ROLLE
} from "../src/shared/fluss.mjs";
import { emptyMonth, totals } from "../src/shared/budget.mjs";
import { beispielMonat } from "./fixtures.mjs";

/* Beispielmonat: Mittel 5600, Kosten 2800 (DA 1800, Fix 250, KK 500, Re 250),
   Restwert 2800. */

/* ------------------------------------------------------------------ *
 * Herkunft und Verwendung
 * ------------------------------------------------------------------ */

test("Herkunft trennt Einkommen, Bestand und Geliehenes", () => {
  const m = beispielMonat();
  m.einnahmen.fremdschulden = 300;

  const q = herkunft(m);
  assert.deepEqual(q.map((x) => x.key), ["erwerb", "bestand", "geliehen"]);
  assert.equal(q[0].wert, 5200);
  assert.equal(q[1].wert, 400);
  assert.equal(q[2].wert, 300);
});

test("Quellen ohne Betrag tauchen gar nicht erst auf", () => {
  const m = emptyMonth();
  m.einnahmen.netto = 4000;
  assert.deepEqual(herkunft(m).map((x) => x.key), ["erwerb"], "kein leerer Knoten im Bild");
});

test("ein Monat im Minus zeigt die Deckungslücke als Quelle", () => {
  const m = emptyMonth();
  m.einnahmen.netto = 1000;
  m.ausgaben = [{ id: "r", name: "Grosse Rechnung", betrag: 1500, tag: "rot" }];

  const q = herkunft(m);
  const luecke = q.find((x) => x.rolle === ROLLE.luecke);
  assert.ok(luecke, "sonst ginge die Bilanz im Bild nicht auf");
  assert.equal(luecke.wert, 500);
});

test("Verwendung sortiert die Kostenblöcke absteigend, Restwert zuletzt", () => {
  const v = verwendung(beispielMonat());
  assert.deepEqual(v.map((x) => x.key), ["da", "kk", "fix", "re", "rest"]);
  assert.deepEqual(v.slice(0, 4).map((x) => x.stufe), [0, 1, 2, 3], "die Reihenfolge ist die Farbstufe");
  assert.equal(v.at(-1).rolle, ROLLE.rest);
});

test("gleich grosse Blöcke bekommen trotzdem verschiedene Stufen", () => {
  const v = verwendung(beispielMonat());
  const stufen = v.filter((x) => x.rolle === ROLLE.kosten).map((x) => x.stufe);
  assert.equal(new Set(stufen).size, stufen.length, "keine doppelte Verlaufsstufe");
});

test("bei negativem Restwert erscheint kein Restwert-Knoten", () => {
  const m = emptyMonth();
  m.einnahmen.netto = 1000;
  m.ausgaben = [{ id: "r", name: "Rechnung", betrag: 1500, tag: "rot" }];
  assert.ok(!verwendung(m).some((x) => x.rolle === ROLLE.rest));
});

test("Herkunft und Verwendung summieren sich auf denselben Betrag", () => {
  for (const monat of [beispielMonat(), (() => {
    const m = emptyMonth();
    m.einnahmen.netto = 1000;
    m.ausgaben = [{ id: "r", name: "R", betrag: 1500, tag: "rot" }];
    return m;
  })()]) {
    const d = flussDaten(monat);
    const rechts = d.rechts.reduce((s, x) => s + x.wert, 0);
    assert.equal(
      Math.round(d.summe * 100) / 100,
      Math.round(rechts * 100) / 100,
      "ein Sankey, dessen Seiten nicht gleich sind, lügt"
    );
  }
});

test("ein leerer Monat wird als leer gemeldet statt gezeichnet", () => {
  assert.equal(flussDaten(emptyMonth()).leer, true);
});

/* ------------------------------------------------------------------ *
 * Sankey
 * ------------------------------------------------------------------ */

test("Sankey legt alle Knoten innerhalb der Zeichenfläche ab", () => {
  const plan = sankeyLayout(flussDaten(beispielMonat()), { breite: 360, hoehe: 250 });
  for (const k of plan.knoten) {
    assert.ok(k.y >= 0, k.name + " ragt oben heraus");
    assert.ok(k.y + k.h <= 250.5, k.name + " ragt unten heraus");
    assert.ok(k.x >= 0 && k.x + k.breite <= 360, k.name + " ragt seitlich heraus");
    assert.ok(k.h >= 1, k.name + " wäre unsichtbar dünn");
  }
});

test("Knotenhöhen verhalten sich wie die Beträge", () => {
  const daten = flussDaten(beispielMonat());
  const plan = sankeyLayout(daten, { breite: 360, hoehe: 250 });
  const rechts = plan.knoten.filter((k) => k.seite === "rechts");

  const da = rechts.find((k) => k.key === "da");
  const fix = rechts.find((k) => k.key === "fix");
  /* 1800 zu 250 — das Verhältnis muss sich in den Höhen wiederfinden. */
  assert.ok(da.h / fix.h > 5, "Verhältnis verzerrt: " + da.h + " zu " + fix.h);
});

test("es gibt genau ein Band je Quelle und je Verwendung", () => {
  const daten = flussDaten(beispielMonat());
  const plan = sankeyLayout(daten);
  assert.equal(plan.baender.length, daten.links.length + daten.rechts.length);
  assert.equal(new Set(plan.baender.map((b) => b.key)).size, plan.baender.length, "doppelte Bänder");
});

test("die Nabe ist so hoch wie die Zeichenfläche und liegt in der Mitte", () => {
  const plan = sankeyLayout(flussDaten(beispielMonat()), { breite: 360, hoehe: 250, randOben: 8, randUnten: 8 });
  const nabe = plan.knoten.find((k) => k.seite === "mitte");
  assert.equal(nabe.h, 234);
  assert.ok(Math.abs(nabe.x + nabe.breite / 2 - 180) < 0.6, "die Nabe sitzt nicht mittig");
});

test("Sankey eines leeren Monats zeichnet nichts", () => {
  const plan = sankeyLayout(flussDaten(emptyMonth()));
  assert.deepEqual(plan.knoten, []);
  assert.deepEqual(plan.baender, []);
});

test("Bandpfade sind wohlgeformt", () => {
  const d = bandPfad(10, 20, 100, 40, 30, 50);
  assert.match(d, /^M [\d.-]+ [\d.-]+ C .* Z$/, "unerwarteter Pfadaufbau: " + d);
  assert.ok(!/NaN|undefined|Infinity/.test(d), "kaputte Zahl im Pfad: " + d);
});

/* ------------------------------------------------------------------ *
 * Entzerrung der Beschriftungen
 * ------------------------------------------------------------------ */

/**
 * Ein Monat, in dem zwei Posten winzig sind: Fixkosten 75 und Restwert 125
 * von 5000 verfuegbaren Mitteln — also je rund zwei Prozent. Genau dieses
 * Verhaeltnis laesst die Baender auf wenige Einheiten zusammenschrumpfen
 * und bringt die Beschriftungen zum Kollidieren.
 *
 * Die Zahlen sind frei erfunden und bewusst rund. Sie stammen NICHT aus
 * einer echten Buchhaltung — Tests wandern ins oeffentliche Repository.
 */
function monatMitWinzigenPosten() {
  const m = emptyMonth();
  m.einnahmen = { netto: 4800, spesen: 100, konto: 80, bar: 20, fremdschulden: 0 };
  m.dauerauftraege = [
    { id: "1", name: "Miete", betrag: 1200, tag: "rot" },
    { id: "2", name: "Leasing", betrag: 300, tag: "rot" },
    { id: "3", name: "Sparplan", betrag: 100, tag: "gruen" },
    { id: "4", name: "Vorsorge", betrag: 100, tag: "gelb" }
  ];
  m.fixkosten = [
    { id: "5", name: "Abo", betrag: 30, tag: "rot" },
    { id: "6", name: "Versicherung", betrag: 45, tag: "rot" }
  ];
  m.kreditkarten = [
    { id: "7", name: "Erste", betrag: 1200, limit: 2000 },
    { id: "8", name: "Zweite", betrag: 300, limit: 1000 }
  ];
  m.ausgaben = [
    { id: "9", name: "Steuer", betrag: 1000, tag: "rot" },
    { id: "10", name: "Reparatur", betrag: 550, tag: "rot" },
    { id: "11", name: "Kleinteil", betrag: 50, tag: "rot" }
  ];
  return m;
}

test("winzige Posten erzeugen ohne Entzerrung überlappende Beschriftungen", () => {
  const plan = sankeyLayout(flussDaten(monatMitWinzigenPosten()));
  const rechts = plan.knoten.filter((k) => k.seite === "rechts");
  const mitten = rechts.map((k) => k.y + k.h / 2);

  const engste = Math.min(...mitten.slice(1).map((y, i) => y - mitten[i]));
  assert.ok(engste < 22, "Voraussetzung des Tests: die Knotenmitten liegen zu eng (" + engste.toFixed(1) + ")");
});

test("nach der Entzerrung hält jede Beschriftung den Mindestabstand", () => {
  const plan = sankeyLayout(flussDaten(monatMitWinzigenPosten()));
  for (const seite of ["links", "rechts"]) {
    const gruppe = plan.knoten.filter((k) => k.seite === seite);
    const marken = beschriftungsLayout(gruppe, { hoehe: plan.hoehe, mindestAbstand: 24 });
    for (let i = 1; i < marken.length; i++) {
      assert.ok(
        marken[i].y - marken[i - 1].y >= 23.99,
        seite + ": " + marken[i - 1].key + " und " + marken[i].key + " liegen nur "
          + (marken[i].y - marken[i - 1].y).toFixed(1) + " auseinander"
      );
    }
  }
});

test("Beschriftungen bleiben innerhalb der Zeichenfläche", () => {
  const plan = sankeyLayout(flussDaten(monatMitWinzigenPosten()));
  const gruppe = plan.knoten.filter((k) => k.seite === "rechts");
  const marken = beschriftungsLayout(gruppe, { hoehe: 250, randOben: 10, randUnten: 16 });
  for (const m of marken) {
    /* Die Betragszeile hängt 10 Einheiten unter der Grundlinie des Namens —
       der untere Rand muss sie mitfassen. */
    assert.ok(m.y >= 9.99, m.key + " ragt oben heraus: " + m.y);
    assert.ok(m.y + 10 <= 244.01, m.key + ": die Betragszeile ragt unten heraus");
  }
});

test("verschobene Beschriftungen sind als solche gekennzeichnet", () => {
  const plan = sankeyLayout(flussDaten(monatMitWinzigenPosten()));
  const gruppe = plan.knoten.filter((k) => k.seite === "rechts");
  const marken = beschriftungsLayout(gruppe, { hoehe: plan.hoehe });

  assert.ok(marken.some((m) => m.verschoben), "sonst wird keine Führungslinie gezeichnet");
  for (const m of marken) {
    if (!m.verschoben) assert.ok(Math.abs(m.y - m.ziel) <= 1, m.key + " gilt als unverschoben, ist es aber nicht");
  }
});

test("die Reihenfolge der Beschriftungen bleibt erhalten", () => {
  const plan = sankeyLayout(flussDaten(monatMitWinzigenPosten()));
  const gruppe = plan.knoten.filter((k) => k.seite === "rechts");
  const marken = beschriftungsLayout(gruppe, { hoehe: plan.hoehe });

  assert.deepEqual(marken.map((m) => m.key), gruppe.map((k) => k.key), "Etiketten dürfen nicht die Plätze tauschen");
  for (let i = 1; i < marken.length; i++) {
    assert.ok(marken[i].y > marken[i - 1].y, "die Reihenfolge von oben nach unten muss stimmen");
  }
});

test("bei reichlich Platz bleibt jede Beschriftung an ihrem Knoten", () => {
  const plan = sankeyLayout(flussDaten(beispielMonat()));
  const gruppe = plan.knoten.filter((k) => k.seite === "links");
  const marken = beschriftungsLayout(gruppe, { hoehe: plan.hoehe });
  assert.ok(marken.every((m) => !m.verschoben), "ohne Not darf nichts verrückt werden");
});

test("Entzerrung kommt mit einem einzelnen oder gar keinem Knoten klar", () => {
  assert.deepEqual(beschriftungsLayout([], { hoehe: 250 }), []);
  const eins = beschriftungsLayout([{ key: "a", y: 100, h: 50 }], { hoehe: 250 });
  assert.equal(eins.length, 1);
  assert.equal(eins[0].verschoben, false);
});

test("mehr Posten als Platz: es wird gleichmässig verteilt statt gestapelt", () => {
  /* 12 Posten zu je 22 Einheiten brauchen 242 — knapp mehr als die Fläche. */
  const viele = Array.from({ length: 12 }, (_, i) => ({ key: "k" + i, y: i * 2, h: 2 }));
  const marken = beschriftungsLayout(viele, { hoehe: 250, mindestAbstand: 24 });

  assert.equal(marken.length, 12);
  for (let i = 1; i < marken.length; i++) {
    assert.ok(marken[i].y > marken[i - 1].y, "auch im Engpass bleibt die Reihenfolge");
  }
});

/* ------------------------------------------------------------------ *
 * Ring
 * ------------------------------------------------------------------ */

test("die Ringanteile ergeben zusammen hundert Prozent", () => {
  const plan = kuchenLayout(flussDaten(beispielMonat()));
  const summe = plan.segmente.reduce((s, x) => s + x.anteil, 0);
  assert.ok(Math.abs(summe - 1) < 1e-9, "Anteile summieren sich zu " + summe);
  assert.equal(plan.gesamt, 5600);
});

test("jedes Segment bekommt einen gültigen Pfad", () => {
  const plan = kuchenLayout(flussDaten(beispielMonat()));
  assert.ok(plan.segmente.length > 0);
  for (const s of plan.segmente) {
    assert.match(s.d, /^M .* A .* Z$/, s.name + ": " + s.d);
    assert.ok(!/NaN|undefined|Infinity/.test(s.d), "kaputte Zahl bei " + s.name);
  }
});

test("ein einzelner Posten entartet nicht zum Nullbogen", () => {
  const m = emptyMonth();
  m.einnahmen.netto = 1000;
  m.fixkosten = [{ id: "f", name: "Alles", betrag: 1000, tag: "rot" }];

  const plan = kuchenLayout(flussDaten(m));
  assert.equal(plan.segmente.length, 1);
  assert.ok(!/NaN/.test(plan.segmente[0].d));
  assert.ok(plan.segmente[0].anteil > 0.999);
});

test("der Ring bleibt innerhalb seines Rahmens", () => {
  const plan = kuchenLayout(flussDaten(beispielMonat()), { cx: 80, cy: 125, rAussen: 68, rInnen: 42 });
  const zahlen = plan.segmente.flatMap((s) => s.d.match(/-?\d+(\.\d+)?/g).map(Number));
  assert.ok(Math.min(...zahlen) >= 0, "negative Koordinate im Ring");
  assert.ok(Math.max(...zahlen) <= 250, "Ring ragt aus dem Rahmen");
});

test("ringPfad erzeugt bei sinnvollen Winkeln saubere Zahlen", () => {
  const d = ringPfad(80, 125, 68, 42, -Math.PI / 2, Math.PI / 4);
  assert.ok(!/NaN|Infinity/.test(d), d);
});

test("Ring eines leeren Monats bleibt leer", () => {
  assert.deepEqual(kuchenLayout(flussDaten(emptyMonth())).segmente, []);
});

/* ------------------------------------------------------------------ *
 * Beschriftung
 * ------------------------------------------------------------------ */

test("Beschriftungen nennen Betrag und Anteil", () => {
  const daten = flussDaten(beispielMonat());
  const t = beschrifte(daten.rechts[0], daten.summe);
  assert.equal(t.name, "Daueraufträge");
  assert.match(t.betrag, /1.800\.00 Fr\./);
  assert.equal(t.prozent, "32.1%");
});

test("Beschriftung teilt nicht durch null", () => {
  const t = beschrifte({ name: "X", wert: 0 }, 0);
  assert.equal(t.prozent, "0.0%");
});

/* ------------------------------------------------------------------ *
 * Zusammenspiel mit den Summen
 * ------------------------------------------------------------------ */

test("die Verwendung stimmt mit den Kartensummen überein", () => {
  const m = beispielMonat();
  const t = totals(m);
  const v = verwendung(m);
  const finde = (k) => v.find((x) => x.key === k)?.wert ?? 0;

  assert.equal(finde("da"), t.da);
  assert.equal(finde("fix"), t.fix);
  assert.equal(finde("kk"), t.kk);
  assert.equal(finde("re"), t.re);
  assert.equal(finde("rest"), t.rest);
});
