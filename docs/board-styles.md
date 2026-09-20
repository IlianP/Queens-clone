# Brettstile: Metriken, Messung, Maßstab

Jeder Stil in `js/generator.js` erzeugt Bretter, die **gleich gültig** sind —
eindeutige Lösung, mit reiner Logik lösbar, ehrlich eingestuft. Sie
unterscheiden sich nur in der **Geometrie**. Bisher wurde über diese Geometrie
anhand von Screenshots argumentiert, und das skaliert nicht: „das sieht anders
aus" ist keine Aussage, die man gegen den nächsten Vorschlag prüfen kann.

Dieses Dokument ist der Maßstab. Es definiert, womit ein Brett vermessen wird,
wo die vorhandenen Stile darin liegen, und **welche Hürden ein neuer Stil
nehmen muss**, bevor er in die Pools darf.

| Teil | Datei |
|------|-------|
| Metriken (rein, importierbar) | `tools/lib/board-metrics.mjs` |
| Stichproben + Technikmix | `tools/lib/sample.mjs` |
| Referenz-Screenshots + Signaturen | `tools/lib/references.mjs` |
| Messwerkzeug (CLI) | `tools/compare-styles.mjs` |
| Regressionstest (läuft in CI mit) | `tests/logic/style-metrics.mjs` |
| Die Stile selbst | `js/generator.js` |

```bash
node tools/compare-styles.mjs              # die volle Tabelle
node tools/compare-styles.mjs --pools      # die ausgelieferten Pools vermessen
node tools/compare-styles.mjs --erosion    # Rohwuchs vs. fertiges Brett
node tools/compare-styles.mjs --show 8 hard
```

## Drei Ebenen, die getrennt bleiben

Ein Stil ist nicht *eine* Zahl. Die drei Fragen unten haben unterschiedliche
Antworten und werden regelmäßig verwechselt — ein Brett kann exotisch aussehen
und sich völlig gewöhnlich spielen.

| Ebene | Frage | Wo |
|-------|-------|-----|
| **Form** | Wie sieht die Einfärbung aus? | `boardShape(N, region)` |
| **Spiel** | Auf welchen Deduktionen läuft es? | `playProfile(...)`, `nakedSingleReach`, `difficultyLevel` |
| **Kosten** | Was kostet ein akzeptiertes Brett? | ms/Brett, gemessen vom Sampler |

## Die neun Formmetriken

Alle neun bilden zusammen die **Signatur** eines Stils. Sie sind so gewählt,
dass jede etwas fängt, das keine andere sieht — eine zehnte, die mit einer
vorhandenen korreliert, macht die Tabelle länger und nicht klüger.

| Metrik | Was sie misst | Rechteck | Was sie *nicht* sieht |
|--------|---------------|----------|------------------------|
| `corners` | Ø Ecken der Regionsumrisse (Eckenregel über Gitterpunkte) | 4 | ob die Ecken an einer Stelle sitzen oder über die Region verteilt sind |
| `bboxFill` | Ø Fläche / Fläche der Bounding-Box | 1,0 | Löcher vs. L-Form (beide senken den Wert) |
| `straight` | Ø Länge eines maximalen geraden Stücks **innerer** Grenze | hoch | den Brettrand — der ist bei jedem Stil gleich und wurde bewusst ausgeschlossen |
| `maxShare` | Anteil der größten Region | — | ob es *eine* große gibt oder drei |
| `gini` | Ungleichheit der Regionsgrößen (0 = alle gleich) | 0 | welche Region groß ist |
| `ones` | Anzahl Ein-Zellen-Regionen (geschenkte Damen) | 0 | fast-geschenkte Zwei-Zellen-Regionen |
| `stripShare` | Anteil Regionen, die ein massiver 1-Zellen-Streifen sind (Fläche ≥ 2) | 0 | die Länge der Streifen |
| `degree` | Ø Zahl benachbarter Farben | — | *welche* benachbart sind |
| `edgeBound` | Anteil Regionen mit Fuß auf dem äußeren Ring | — | wie viel Ring eine Region hält |

Zwei davon kamen erst mit Screenshot D dazu, und beide schließen eine echte
Lücke:

- **`gini`** — `maxShare` sieht nur die *größte* Region. Ein Brett mit **drei**
  großen Farben und vier winzigen liest sich dort als „kein Hintergrund",
  obwohl es genauso hierarchisch ist wie eines mit einem einzigen dominanten
  Farbblock. Genau das ist Screenshot D: `maxShare` 0,24 (unauffällig), `gini`
  0,32 (deutlich).
- **`edgeBound`** — die Achse, auf der Screenshot D überhaupt erst als
  Ausreißer sichtbar wird: 0,43 gegen 0,88 bei `organic`. Vier seiner sieben
  Farben haben **keinen** Fuß auf dem Brettrand, sie liegen eingeschlossen in
  der Mitte. Ohne diese Metrik landete D mitten in der organic-Wolke
  (Signaturabstand 0,32) und die Antwort wäre „gibt's schon" gewesen — was
  nachweislich falsch ist (siehe Trefferquoten unten).

## Signatur und Abstand

`signatureDistance(a, b)` ist die **mittlere absolute Differenz über die neun
Metriken, jede in Einheiten ihrer eigenen Skala** (`SIGNATURE_SCALE`). Lies sie
als: „um wie viele gerade-noch-sichtbare Stufen unterscheiden sich zwei Stile
im Schnitt pro Metrik".

Die Skalen sind **fest von Hand gesetzt**, nicht aus der Stichprobe berechnet.
Eine Standardabweichung aus den Daten würde sich mit jedem neuen Stil
verschieben und die Abstände von gestern mit denen von heute unvergleichbar
machen — der Maßstab muss stillstehen, sonst ist er keiner.

| Abstand | Lesart |
|---------|--------|
| < 0,5 | derselbe Look. Ein Knopf, kein Stil. |
| 0,5 – 1,0 | Variante. Erkennbar anders, aber aus derselben Familie. |
| > 1,0 | andere Konstruktion. Rechtfertigt einen eigenen Grower. |

Die Bänder sind an dem geeicht, was wir schon wissen: `organic` ↔ `blocky`
liegen bei **0,5 – 0,6** (zwei Varianten desselben Flood-Fill-Gedankens),
`strips` liegt **1,5 – 2,1** von beiden entfernt (und brauchte tatsächlich eine
eigene Konstruktion *und* eine eigene Reparatur).

## Referenztabelle

Vier transkribierte Screenshots aus dem LinkedIn-Original
(`tools/lib/references.mjs`), alle mit unserem eigenen Solver geprüft: jeder hat
genau eine Lösung.

| Board | Ecken | Füllung | gerade | maxAnt | Gini | 1er | Strips | Grad | Rand | Rating | passt zu |
|-------|-------|---------|--------|--------|------|-----|--------|------|------|--------|----------|
| Shot A (8×8) | 8,5 | 0,74 | 1,65 | 0,38 | 0,43 | 0 | 0,25 | 3,25 | 0,75 | hard | `blocky` |
| Shot B (7×7) | 6,0 | 0,75 | 2,58 | 0,33 | 0,40 | 0 | 0,29 | 3,14 | 0,71 | hard | `blocky` |
| Shot C (8×8) | 7,0 | 0,96 | 2,00 | 0,64 | 0,57 | 0 | 0,88 | 2,75 | 0,63 | hard | `strips` |
| Shot D (7×7) | 9,1 | 0,67 | 1,82 | 0,24 | 0,32 | **1** | 0,14 | 3,71 | **0,43** | **medium** | `frame` |

Shot D ist doppelt der Ausreißer: das einzige **medium** in der Sammlung und
das einzige mit einer geschenkten Ein-Zellen-Region. Die drei großen Farben
(12/11/10 von 49 Zellen) teilen sich den Außenring untereinander auf; die vier
kleinen liegen eingeschlossen in der Mitte.

## Der Reparaturverschleiß — die wichtigste Zahl

Ein Stil ist **Konstruktion plus Reparatur**, und die Reparatur hat das letzte
Wort. `makeUnique` erkauft Eindeutigkeit, indem es eine Zelle in eine
*beliebige* Nachbarregion verschiebt — es biegt ein Rechteck bedenkenlos zu
einem L. `--erosion` misst genau das: dieselbe Signatur vor und nach der
Reparatur.

Gemessen bei 8×8 hard:

| Stil | Ecken roh → fertig | Füllung roh → fertig | gerade roh → fertig | **Verschleiß** |
|------|--------------------|----------------------|---------------------|----------------|
| `organic` | 8,0 → 9,2 | 0,70 → 0,67 | 1,86 → 1,66 | 0,52 |
| `blocky` | 7,8 → 8,4 | 0,76 → 0,75 | 1,89 → 1,75 | **0,23** |
| `strips` | 6,6 → 6,7 | 0,95 → 0,96 | 2,74 → 2,43 | **0,21** |
| `quilt` | **4,0 → 8,3** | **1,00 → 0,75** | **5,72 → 1,85** | **1,52** |
| `voronoi` | 9,7 → 8,5 | 0,67 → 0,73 | 1,40 → 1,65 | 0,61 |
| `frame` | 8,5 → 8,9 | 0,69 → 0,70 | 1,95 → 1,83 | **0,21** |

**Die Regel, die daraus folgt:** ist der Verschleiß eines Stils größer als sein
Abstand zu den Stilen, die wir schon haben, liefert er seinen eigenen Look
nicht aus — egal wie gut der Rohwuchs aussieht. `strips` hat deshalb
`makeUniqueStrips` bekommen; `quilt` scheitert genau daran.

## Die drei Look-Signaturen

Ja/Nein-Ablesungen an einem einzelnen Brett (`tools/lib/references.mjs`), mit
denen sich „wie oft erzeugt ein vorhandener Stil das zufällig?" beantworten
lässt. Gemessen über die **1200 ausgelieferten Bretter** in `levels/`
(`--pools`):

| | `shotLike` (A/B) | `stripLike` (C) | `frameLike` (D) |
|---|---|---|---|
| **organic** (n=430) | 3,5 % | 0,0 % | **0,0 %** |
| **blocky** (n=430) | 38,1 % | 0,0 % | 1,6 % |
| **strips** (n=340) | 100 % | 98,2 % | 0,0 % |

Das ist die Zahl, die entscheidet, ob ein Screenshot ein **Konstruktions-** oder
ein **Tuning**-Problem ist — dieselbe Methode, mit der schon `strips`
gerechtfertigt wurde (0,15 % bei blocky, 0 % bei organic). Für Screenshot D:
**kein einziges** der 430 organic-Bretter hat den Look, und nur 1,6 % der
blocky. Ein neuer Grower ist damit gerechtfertigt, ein Knopf an `growRegions`
nicht.

## Die Kandidaten (Stand: bewertet, nicht ausgeliefert)

Drei neue Konstruktionen, bewusst in drei verschiedene Richtungen gezielt.
Alle drei sind über `generatePuzzle(N, d, { style })` erreichbar und laufen
durch die echte Reparatur und die echte Bewertung — ein Stil, den nur ein
Skript erzeugt hat, ist nicht bewertet. **Keiner ist verdrahtet**: `mixFor` und
`randomStyle()` ziehen sie nicht, es wird kein Pool aus ihnen gebaut, kein
Spieler sieht sie.

### `quilt` — rekursive Guillotine-Schnitte ❌ abgelehnt

Zerteilt das Brett, statt es wachsen zu lassen: schneide es entlang einer
durchgehenden Linie in zwei Teile, so dass beide Seiten mindestens eine Dame
behalten, und rekursiere bis ein Stück genau eine Dame hat. Jede Region ist per
Konstruktion ein Rechteck mit genau einer Dame, die Rekursion kann nicht
fehlschlagen, es braucht **keine Wiederholungsschleife**.

Der Rohwuchs ist das rechteckigste, was dieses Repo je erzeugt hat — `corners`
exakt **4,00**, `bboxFill` exakt **1,00**, `straight` **5,7**. Und davon bleibt
nichts übrig: `makeUnique` biegt die Rechtecke in Verschleiß **1,52** zu
gewöhnlichen Klecksen, und das fertige Brett liegt **0,20** von `voronoi` und
**0,43** von `blocky` entfernt — also mitten in dem, was wir schon ausliefern.

Abgelehnt, aber nicht wertlos: das ist der sauberste vorhandene Beleg für die
Verschleißregel. Wer ihn wiederbeleben will, braucht ein `makeUniqueQuilt` mit
formerhaltenden Zügen (nur ganze Kantenreihen zwischen zwei Rechtecken
verschieben) — genau der Schritt, den `strips` gegangen ist. Ob das genug
Freiheitsgrade für Eindeutigkeit lässt, ist offen.

### `voronoi` — Wachstum nach Entfernung ❌ abgelehnt

Jede Zelle geht an die Dame, zu der sie am wenigsten Schritte braucht
(Prioritätsflut, Kontiguität per Konstruktion). Der Unterschied zu `growRegions`
ist nur die *Reihenfolge*, in der die Front bedient wird — dort zufällig, hier
nach Entfernung.

Die Hypothese „glatte Fronten, gleichmäßige Flächen" stimmte nur zur Hälfte:
die Flächen kommen tatsächlich sehr gleich heraus (`gini` **0,18** roh, der
niedrigste Wert im ganzen Feld) und Streifen gibt es exakt keine, aber die
Ränder sind mit `corners` **9,7** *zackiger* als bei organic, nicht glatter.
Nach der Reparatur (Verschleiß 0,61) ist auch das weg: das fertige Brett liegt
**0,19** von `blocky` und **0,30** von `organic` entfernt — derselbe Look.

### `frame` — Rand außen, Kleinkram eingeschlossen ✅ trägt

Der Look von Screenshot D. Die `round(N/2,5)` Regionen, deren Dame dem Rand am
nächsten sitzt, werden zu „Außenregionen": sie beanspruchen zuerst freie
**Ringzellen** (kleinste Region zuerst, damit der Rand in vergleichbare Bögen
zerfällt und nicht eine Farbe alles nimmt), danach alles andere, bis sie 62 %
des Bretts halten. Der Rest flutet von den übrigen Damen aus zufällig nach —
und bleibt dabei klein und eingeschlossen, gelegentlich bis auf eine einzelne
Zelle, die Screenshot D auch hat.

| | 7×7 medium | 7×7 hard | Abstand zu Shot D |
|---|---|---|---|
| `edgeBound` | 0,53 | 0,55 | Shot D: 0,43 |
| `gini` | 0,34 | 0,29 | Shot D: 0,32 |
| `maxShare` | 0,25 | 0,25 | Shot D: 0,24 |
| `frameLike`-Trefferquote | ja | ja | — |
| Signaturabstand | — | — | **0,23 / 0,29** |

Verschleiß **0,21** — so niedrig wie `blocky` und `strips`, die Signatur
übersteht die Reparatur also. Der nächste andere Stil ist **0,37 – 0,50**
entfernt, also eine klar erkennbare **Variante**, keine Dublette und keine
eigene Familie. Kosten 5 – 15 ms/Brett, in derselben Größenordnung wie organic.
Anders als `strips` hat `frame` **easy-Bretter** (die eingeschlossene
Ein-Zellen-Region liefert genau die erzwungene Eröffnung, die easy braucht).

**Offen, bevor das ausgeliefert werden könnte:** der Technikmix ist von organic
praktisch nicht zu unterscheiden (naked 51 % / conf 27 % / dead 18 %), es ist
also rein eine Optik-Erweiterung; und `ones` liegt bei medium/hard mit 0,9 – 1,4
höher als bei organic (0,2 – 1,0), was auf hard mehr geschenkte Damen bedeutet
als dort bisher üblich. Beides sind Entscheidungen, keine Fehler.

## Was die Suite *nicht* misst

Ehrlich aufgeschrieben, damit niemand mehr hineinliest, als drinsteht:

- **Anordnung.** Gemessen werden die *Statistiken* der Regionen, nicht ihre
  Anordnung zueinander. Vier 2×2-Blöcke und vier durchgehende Bänder sind beides
  gleich große, saubere Rechtecke und liegen nur **0,8** auseinander
  (Variante), obwohl sie offensichtlich verschieden aussehen. Nur `stripShare`
  und `degree` trennen sie. Für die Stile, die wir haben, reicht das; ein
  Layout-Maß wäre der nächste Schritt, falls das je gebraucht wird.
- **Farbe.** Die Palette wird beim Rendern gemischt, die gespeicherte
  Regionsnummer sagt nichts über den optischen Eindruck.
- **Symmetrie.** `drawLevel` dreht/spiegelt jedes Brett zufällig (D4), und alle
  neun Metriken sind gegen D4 invariant — das ist Absicht, sonst würde dieselbe
  Vorlage je nach Drehung anders gemessen.
- **Schönheit.** Die Suite sagt „anders", nie „besser". Ob ein Look Spaß macht,
  entscheidet ein Mensch am Handy — siehe CLAUDE.md, „Testing a branch on
  mobile".

## Rezept: einen neuen Stil bewerten

Der Maßstab, an dem sich die nächste Generation messen lassen muss. Die
Reihenfolge ist bewusst so: die billigen Ausschlusskriterien zuerst.

1. **Ist der Look überhaupt neu?** Signatur des Vorbilds bestimmen, dann
   `node tools/compare-styles.mjs --pools`. Erzeugt ein vorhandener Stil ihn in
   mehr als ~5 % der Fälle, ist es ein **Tuning**-Problem — Knopf drehen, keinen
   Grower schreiben. Unter ~1 % ist es ein **Konstruktions**-Problem.
2. **Grower schreiben**, in `js/generator.js`, und in `EXPERIMENTAL_GROWERS`
   eintragen. Nicht in `mixFor` / `randomStyle()` — erst bewerten, dann
   ausliefern.
3. **Invarianten prüfen**, vor allem anderen: Kontiguität, genau eine Lösung,
   Rating ≤ 2, mit Hinweisen allein lösbar. Ein hübscheres Brett, das diese
   Zusagen bricht, ist wertlos. `tests/logic/style-metrics.mjs` und die
   Helfer in `tests/logic/lib/board-checks.mjs` machen das fertig.
4. **`--erosion` laufen lassen.** Ist der Verschleiß größer als der Abstand zu
   den vorhandenen Stilen, liefert der Stil seinen Look nicht aus. Dann
   entweder eine formerhaltende Reparatur schreiben (wie `makeUniqueStrips`)
   oder verwerfen. Diesen Schritt nicht überspringen: der Rohwuchs sieht
   *immer* überzeugender aus als das Ergebnis.
5. **`node tools/compare-styles.mjs` laufen lassen.** Signaturabstand zum
   nächsten vorhandenen Stil: unter 0,5 ist es kein eigener Stil.
6. **Spiel- und Kostenebene ansehen.** Verschiebt der Stil den Technikmix
   (dann ist er mehr als Optik)? Gibt es alle drei Schwierigkeitsgrade, oder
   verbietet die Konstruktion einen — und ist das ein Fakt oder ein Knopf?
   Wie viele ms kostet ein akzeptiertes Brett bei N = 12 und N = 14?
7. **Auf dem Handy ansehen.** Einzelstil-Bundle bauen und veröffentlichen
   (CLAUDE.md, „Testing a branch on mobile"). Alles darüber ist eine Zahl; das
   hier ist das Spiel.
8. **Erst dann verdrahten**: `stylesFor` / `mixFor`, Pools neu bauen
   (`tools/generate-levels.mjs`, dann `tools/verify-levels.mjs`), Bänder in
   `tests/logic/style-metrics.mjs` eintragen und dieses Dokument nachziehen.
