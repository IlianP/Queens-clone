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
liegen bei **0,3 – 0,6** (zwei Varianten desselben Flood-Fill-Gedankens),
`strips` liegt **1,3 – 1,5** vom nächsten anderen Stil entfernt und brauchte
tatsächlich eine eigene Konstruktion *und* eine eigene Reparatur. Was ein
Vorbild reproduzieren soll, wird zusätzlich gegen das Vorbild selbst gemessen:
`blocky` liegt **0,14 – 0,27** von Shot A, `strips` **0,15 – 0,22** von Shot C,
`frame` **0,16 – 0,26** von Shot D. Ein Stil, der weiter von seinem eigenen
Vorbild entfernt ist als von einem fremden, hat sein Ziel verfehlt.

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

Gemessen bei 8×8 hard (`node tools/compare-styles.mjs --erosion`); die
Verschleißspalte zusätzlich für 7×7 medium / 7×7 hard / 8×8 medium:

| Stil | Ecken roh → fertig | Füllung roh → fertig | gerade roh → fertig | **Verschleiß** (7m/7h/8m/**8h**) |
|------|--------------------|----------------------|---------------------|----------------------------------|
| `organic` | 8,1 → 9,1 | 0,71 → 0,68 | 1,84 → 1,66 | 0,37 / 0,46 / 0,43 / **0,52** |
| `blocky` | 7,7 → 8,3 | 0,75 → 0,75 | 1,91 → 1,76 | 0,31 / 0,23 / 0,33 / **0,23** |
| `strips` | 6,6 → 6,7 | 0,95 → 0,96 | 2,74 → 2,42 | 0,25 / 0,15 / 0,30 / **0,26** |
| `quilt` | **4,00 → 8,4** | **1,00 → 0,74** | **5,71 → 1,80** | 1,39 / 1,36 / 1,58 / **1,53** |
| `voronoi` | 9,7 → 8,7 | 0,67 → 0,72 | 1,41 → 1,63 | 0,73 / 0,60 / 0,60 / **0,55** |
| `frame` | 8,5 → 8,9 | 0,69 → 0,69 | 1,97 → 1,85 | 0,43 / 0,29 / 0,26 / **0,23** |

`organic` ist der Sonderfall, der zeigt, dass Verschleiß **allein** nicht
reicht: mit 0,37 – 0,52 ist er hoch, aber organic hat keine Signatur zu
verlieren — der Stil *ist* zufälliges Wachstum, und die Reparatur ist mehr
davon. (Lehrreich trotzdem: bei organic erzeugt die **Reparatur** die
geschenkten Ein-Zellen-Regionen, `ones` 0,00 roh → 0,39 fertig bei 8×8 hard,
nicht das Wachstum.)

### Die Regel: wie viel Eigenständigkeit die Reparatur frisst

Die Frage ist enger als „wie stark ändert sich das Brett". Sie lautet: **wie
weit war die Konstruktion von den ausgelieferten Stilen entfernt, bevor
repariert wurde — und wie viel davon ist danach übrig?** `--erosion` gibt das
unter „Eigenständigkeit" mit aus (8×8 hard):

| Stil | roh → ausgeliefert | fertig → ausgeliefert | **Lücke geschlossen** |
|------|--------------------|-----------------------|------------------------|
| `organic` | 0,88 | 0,58 | 33 % |
| `blocky` | 0,52 | 0,58 | −13 % |
| `strips` | 1,42 | 1,50 | −6 % |
| `quilt` | **1,66** | **0,31** | **81 %** |
| `voronoi` | 0,32 | 0,28 | 13 % |
| `frame` | 0,59 | 0,61 | −3 % |

Negative Werte sind kein Fehler: die Reparatur kann einen Stil auch *weiter*
von den anderen wegschieben, und bei `blocky`, `strips` und `frame` tut sie
genau das — deren Signatur wird von `makeUnique(Strips)` eher geschärft als
angegriffen.

Das trennt die **zwei verschiedenen Arten zu scheitern**, die der reine
Verschleiß in einen Topf wirft:

- **`quilt` war eigenständig und hat es verloren** (1,66 → 0,31, 81 % weg). Das
  ist reparierbar — mit einer formerhaltenden Reparatur, so wie `strips`
  `makeUniqueStrips` bekommen hat.
- **`voronoi` war nie eigenständig** (0,32 roh, also schon vor der Reparatur
  innerhalb des Bandes „gleicher Look"). Keine Reparatur der Welt hilft da; die
  Konstruktion ist schlicht nicht anders.

Ohne diese Aufschlüsselung hätten beide dasselbe Urteil bekommen und `quilt`
wäre als hoffnungslos abgelegt worden, obwohl sein Rohwuchs die
rechteckigsten Bretter im ganzen Repo sind.

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
exakt **4,00**, `bboxFill` exakt **1,00**, `straight` **5,7** gegen 1,4 – 2,7
bei allem anderen. Und davon bleibt nichts übrig: `makeUnique` biegt die
Rechtecke mit Verschleiß **1,36 – 1,58** zu gewöhnlichen Klecksen (Ecken
4,00 → 8,4, gerade 5,71 → 1,80), und das fertige Brett liegt **0,19 – 0,34**
vom nächsten vorhandenen Stil entfernt — also mitten in dem, was wir schon
ausliefern. Dazu kostet es auf 8×8 easy **342 ms/Brett** gegen 45 ms bei
organic: ohne Ein-Zellen-Regionen fehlt easy die erzwungene Eröffnung, genau
wie bei blocky mit Größenboden.

Abgelehnt **wegen der Reparatur, nicht wegen der Konstruktion**: roh liegt es
1,66 von allem Ausgelieferten entfernt, fertig 0,31 — 81 % der
Eigenständigkeit frisst `makeUnique`. Damit ist es der sauberste vorhandene
Beleg für die Regel oben, und der einzige Kandidat, den ein zweiter Anlauf
retten könnte: ein `makeUniqueQuilt` mit formerhaltenden Zügen (nur ganze
Kantenreihen zwischen zwei Rechtecken verschieben), genau der Schritt, den
`strips` gegangen ist. Ob das genug Freiheitsgrade für Eindeutigkeit lässt,
ist offen — und die ehrliche Antwort ist, dass ein 1-Zellen-Streifen dort mehr
Spielraum hatte als ein Rechteck haben wird.

### `voronoi` — Wachstum nach Entfernung ❌ abgelehnt

Jede Zelle geht an die Dame, zu der sie am wenigsten Schritte braucht
(Prioritätsflut, Kontiguität per Konstruktion). Der Unterschied zu `growRegions`
ist nur die *Reihenfolge*, in der die Front bedient wird — dort zufällig, hier
nach Entfernung.

Die Hypothese „glatte Fronten, gleichmäßige Flächen" stimmte nur zur Hälfte:
die Flächen kommen tatsächlich sehr gleich heraus (`gini` **0,18** roh, der
niedrigste Wert im ganzen Feld) und Streifen gibt es exakt keine
(`stripShare` **0,00**), aber die Ränder sind mit `corners` **9,7** *zackiger*
als bei organic, nicht glatter — die Priorität nach Entfernung glättet die
Front nicht, sie lässt die Fronten nur gleichzeitig ankommen. Nach der
Reparatur (Verschleiß 0,55 – 0,73) ist auch das weg: das fertige Brett liegt
**0,18 – 0,24** vom nächsten vorhandenen Stil entfernt — derselbe Look. Bei
8×8 easy kostet es dieselben **338 ms/Brett** wie `quilt`, aus demselben Grund.

Abgelehnt **wegen der Konstruktion, nicht wegen der Reparatur** — der
Gegenfall zu `quilt`: schon der Rohwuchs liegt nur **0,32** von den
ausgelieferten Stilen entfernt, also bereits innerhalb des Bandes „gleicher
Look". Eine formerhaltende Reparatur würde hier nichts retten, weil es nichts
zu retten gibt.

### `frame` — Rand außen, Kleinkram eingeschlossen ✅ trägt

Der Look von Screenshot D. Die `round(N/2,5)` Regionen, deren Dame dem Rand am
nächsten sitzt, werden zu „Außenregionen": sie beanspruchen zuerst freie
**Ringzellen** (kleinste Region zuerst, damit der Rand in vergleichbare Bögen
zerfällt und nicht eine Farbe alles nimmt), danach alles andere, bis sie 62 %
des Bretts halten. Der Rest flutet von den übrigen Damen aus zufällig nach —
und bleibt dabei klein und eingeschlossen, gelegentlich bis auf eine einzelne
Zelle, die Screenshot D auch hat.

`frameLike`-Trefferquote, live erzeugt, je 8 s Stichprobe:

| Stil | 7×7 easy | 7×7 med | 7×7 hard | 8×8 easy | 8×8 med | 8×8 hard |
|---|---|---|---|---|---|---|
| **`frame`** | **58 %** | **43 %** | **30 %** | **99 %** | **97 %** | **92 %** |
| `organic` | 0 % | 0 % | 0 % | 0 % | 0 % | 0 % |
| `blocky` | 0 % | 0 % | 0 % | 1 % | 2 % | 1 % |
| `strips` | – | 0 % | 0 % | – | 0 % | 0 % |
| `quilt` | 0 % | 0 % | 0 % | 0 % | 0 % | 5 % |
| `voronoi` | 0 % | 0 % | 0 % | 0 % | 0 % | 0 % |

Signaturabstand zu Shot D **0,16 – 0,26**, zum nächsten anderen Stil
**0,45 – 0,72** — also eine klar erkennbare **Variante**, keine Dublette und
keine eigene Familie. Verschleiß **0,23 – 0,43**, im Bereich der ausgelieferten
Stile. Kosten 4 – 12 ms/Brett auf medium/hard und 10 – 55 ms auf easy, in
derselben Größenordnung wie organic. Anders als `strips` hat `frame`
**easy-Bretter** (die eingeschlossene Ein-Zellen-Region liefert genau die
erzwungene Eröffnung, die easy braucht).

Zwei Dinge hat die Konstruktion erst getroffen, nachdem sie gemessen war — und
beide sind der Grund, warum Schritt 4 und 5 des Rezepts unten nicht optional
sind. Vorher lag die Trefferquote bei **15 %** statt bei 30 – 99 %:

- **Der Ring muss ganz vergeben werden, bevor das Flächenbudget zählt.** Liefen
  beide Phasen gegen ein Budget, blieben Ringzellen frei, die Nachflut der
  Innenregionen nahm sie mit, und `edgeBound` landete bei 0,54 statt bei 0,43.
- **Eine Region, deren Dame auf dem Ring sitzt, hält eine Ringzelle — immer.**
  Sie muss also Außenregion sein, und sitzen mehr Damen auf dem Ring als
  Außenregionen vorgesehen sind, kann diese Platzierung den Look nicht
  erzeugen. `growRegionsFrame` gibt dann `null` zurück und `generatePuzzle`
  zieht die nächste Platzierung.

**Die 7×7-Schwäche ist echt, und sie liegt an `gini`.** Bei 7×7 hard sitzt
`gini` mit 0,28 exakt auf der Schwelle der Signatur: hard unterdrückt kleine
Regionen, und auf 49 Feldern bleibt für eine Größenhierarchie wenig Platz. Bei
8×8 ist das weg (92 – 99 %). Eine Eigenschaft des Schwierigkeitsgrads, kein
Fehler des Growers.

**Die harte Grenze ist die Brettgröße.** Pro akzeptiertem hard-Brett:

| N | `frame` | `organic` | `strips` | D-Quote `frame` |
|---|---------|-----------|----------|------------------|
| 8 | **11 ms** | 17 ms | 3 ms | 92 % |
| 9 | 227 ms | 178 ms | — | 55 % |
| 10 | **1,9 s** | 2,6 s | — | 100 % |
| 11 | 20 s | 4,1 s | — | 100 % |
| 12 | **kein Brett** | 62 s | 0,14 s | — |
| 14 | **kein Brett** | 248 s | 1,4 s | — |

Bis N = 10 ist `frame` schneller als organic, ab N = 11 dreht sich das, und ab
N = 12 liefert es innerhalb eines vernünftigen Budgets gar nichts mehr. Das ist
dieselbe Wand, an der organic steht, und der Grund, warum `stylesFor` /
`mixFor` Größen ab 13 ohnehin auf `strips` festnageln. Ausliefern hieße also:
`frame` in die Mischung für **N ≤ 10** — genau der Bereich, in dem heute
organic und blocky gemischt werden.

Wichtig dabei: die Konstruktion selbst hält bei jeder Größe durch — der
Rohwuchs liefert `edgeBound` 0,38 – 0,43 und 44 – 51 % D-Look auch bei N = 12
und N = 14. Was ab N = 11 versagt, ist nicht das Wachstum, sondern die
**Eindeutigkeitsreparatur**, die auf einem Brett mit vielen eingeschlossenen
Kleinregionen zu lange braucht.

**Offen, bevor das ausgeliefert werden könnte:** der Technikmix ist von organic
praktisch nicht zu unterscheiden (naked 50 % / conf 28 % / dead 18 %), es ist
also rein eine Optik-Erweiterung; und `ones` liegt auf hard mit 0,45 (7×7) bzw.
0,71 (8×8) über organic (0,26 / 0,41) — etwas mehr geschenkte Damen, als dort
bisher üblich ist. Beides sind Entscheidungen, keine Fehler.

## Die Messfalle: Stichproben, die den falschen Stil enthalten

Das hier hätte die ganze Bewertung von `frame` gekippt und ist in keiner Zahl
sichtbar, wenn man nicht danach sucht.

`generatePuzzle` gibt **Fairness den Vorrang vor dem Stil**: läuft das Budget
ab, ohne dass ein logisch lösbares Brett im gewünschten Stil zustande kam,
fällt der letzte Rettungspfad auf `growRegions` (organic) zurück — bewusst, denn
ein Brett, dessen Hinweise zur „Hier gehört die nächste Dame hin"-Notlösung
degradieren, ist schlimmer als eines im falschen Look. Bei N ≥ 12 und einem
Budget von 1,5 s wird dieser Pfad ständig erreicht.

Die erste Messung von `frame` bei 12×12 meldete daraufhin `edgeBound` **0,85**
— für eine Konstruktion, die roh 0,42 liefert. Die Stichprobe bestand fast nur
aus organic-Brettern unter falschem Namen. Zwei Gegenmittel, beide jetzt
eingebaut:

- `generatePuzzle` gibt **`grownWith`** zurück: den Stil, der das Brett
  tatsächlich gewachsen hat. Er weicht nur auf genau diesem Rettungspfad von
  `opts.style` ab. `sampleStyle` wirft solche Bretter weg und zählt sie als
  `offStyle`, statt sie einzumitteln.
- Das Budget pro Brett **skaliert mit N** (1,5 s bis N = 9, 4 s bis N = 11,
  20 s darüber). Ohne das misst die Stichprobe bei großen Brettern hauptsächlich
  den Rettungspfad.

Merksatz: **eine Stichprobe mit `offStyle > 0` ist keine Messung dieses Stils.**
Steht da eine große Zahl, ist die Frage nicht „wie sieht der Stil aus", sondern
„warum kommt er bei dieser Größe nicht durch".

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
4. **`--erosion` laufen lassen** und die Zeile „Eigenständigkeit" lesen. Ist
   der Rohwuchs schon unter 0,5 von den vorhandenen Stilen entfernt, ist die
   *Konstruktion* nicht anders — verwerfen. War er weiter weg und die Reparatur
   schließt die Lücke (grob: mehr als die Hälfte), ist die *Reparatur* das
   Problem: eine formerhaltende schreiben, wie `makeUniqueStrips`. Diesen
   Schritt nicht überspringen — der Rohwuchs sieht **immer** überzeugender aus
   als das Ergebnis.
5. **`node tools/compare-styles.mjs` laufen lassen.** Signaturabstand zum
   nächsten vorhandenen Stil: unter 0,5 ist es kein eigener Stil.
6. **Spiel- und Kostenebene ansehen.** Verschiebt der Stil den Technikmix
   (dann ist er mehr als Optik)? Gibt es alle drei Schwierigkeitsgrade, oder
   verbietet die Konstruktion einen — und ist das ein Fakt oder ein Knopf?
   Wie viele ms kostet ein akzeptiertes Brett bei N = 10, 12, 14 — und **wie
   groß ist `offStyle` dabei?** Eine Stichprobe mit vielen verworfenen Brettern
   misst den Rettungspfad, nicht den Stil (siehe „Die Messfalle").
7. **Auf dem Handy ansehen.** Einzelstil-Bundle bauen und veröffentlichen
   (CLAUDE.md, „Testing a branch on mobile"). Alles darüber ist eine Zahl; das
   hier ist das Spiel.
8. **Erst dann verdrahten**: `stylesFor` / `mixFor`, Pools neu bauen
   (`tools/generate-levels.mjs`, dann `tools/verify-levels.mjs`), Bänder in
   `tests/logic/style-metrics.mjs` eintragen und dieses Dokument nachziehen.
