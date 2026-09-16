# Queens

[English](README.md) · **Deutsch**

### ▶️ Jetzt spielen: **<https://ilianp.github.io/Queens-clone/>**

Ein Klon des LinkedIn-Spiels **Queens** – reines HTML/CSS/JavaScript, kein Build-Schritt,
läuft direkt auf GitHub Pages und ist für Handy und Desktop optimiert.

## Spielregeln

Auf einem `N × N`-Feld, das in `N` farbige Regionen aufgeteilt ist, platzierst du `N` Damen (👑):

- genau **eine Dame pro Zeile**,
- genau **eine pro Spalte**,
- genau **eine pro Farbregion**,
- und **keine zwei Damen dürfen sich berühren** – auch nicht diagonal.

Jedes erzeugte Rätsel hat **genau eine Lösung** und ist allein durch Logik lösbar
(kein Raten nötig).

## Bedienung

- **Tippen** durchläuft ein Feld: leer → Punkt (Ausschluss) → 👑 → leer.
- **Neues Spiel** erzeugt ein frisches Rätsel.
- **🔊 / 🔇** oben schaltet die Soundeffekte ohne Umweg über die Einstellungen
  direkt stumm bzw. wieder ein.
- **Markierungen löschen** entfernt nur deine Punkte, die Damen bleiben.
- **Zurücksetzen** leert das aktuelle Feld.
- **Prüfen** zeigt kurz an, ob dein aktueller Stand fehlerfrei ist – nur ein
  grünes „✓ Keine Fehler" bzw. rotes „✗ Es gibt Fehler", **ohne** zu
  verraten, wo ein Fehler liegt, und **ohne** den nächsten Zug vorzuschlagen
  (das bleibt dem Hinweis vorbehalten). Als Fehler zählt jeder Regelverstoß im
  aktuellen Stand **und** ein Abweichen von der eindeutigen Lösung, bevor eine
  Regel bricht: eine gesetzte Dame, die nicht zur Lösung gehört, ebenso wie ein
  Punkt auf einem Feld, auf dem laut Lösung eine Dame stehen muss.
- Fehler (sich berührende / kollidierende Damen) werden rot markiert.
- Eine Zeile, Spalte oder Farbregion, in der jedes Feld ausgeschlossen ist und
  keine Dame steht, wird rot pulsierend umrandet – dort ist keine Dame mehr
  möglich, also stimmt etwas nicht.

## Einstellungen (⚙)

- **Sprache:** Deutsch, Englisch, Französisch, Spanisch, Portugiesisch oder
  Russisch; voreingestellt ist *Automatisch (Browser)* – passt die Browsersprache
  zu keiner vorhandenen Übersetzung, wird **Englisch** genommen. Ein Sprachwechsel
  lädt die Seite neu (läuft gerade eine Partie, wird vorher gefragt); ein bereits
  gelöstes, noch nicht eingetragenes Ergebnis geht dabei nicht verloren.
- **Feldgröße:** 5 bis 12. Bei **12** sind ausschließlich schwere Rätsel möglich –
  ein 12×12-Feld ist von Natur aus schwer, „leichte“/„mittlere“ Rätsel dieser Größe
  existieren praktisch nicht –, deshalb wird die Schwierigkeit dort auf *Schwer*
  festgelegt.
- **Schwierigkeit:**
  - *Leicht* – lösbar allein durch „nur ein Feld übrig"-Schlüsse.
  - *Mittel* – benötigt zusätzlich Zeilen-/Spalten-↔-Regionen-Schlüsse.
  - *Schwer* – benötigt eine vorausschauende (Widerspruchs-)Deduktion.

  Die Schwierigkeit ist (bis Feldgröße 11) unabhängig von der Feldgröße. Da die Rätsel
  aus vorberechneten Pools stammen (siehe unten), ist die gewählte Stufe immer exakt
  getroffen – auch bei großen Feldern, wo z. B. sehr leichte Rätsel bei Live-Erzeugung
  selten wären.
- **Schnellmodus:** Beim Setzen einer Dame werden alle dadurch ausgeschlossenen Felder
  automatisch gepunktet: die gesamte Zeile, Spalte, Farbregion und die angrenzenden Felder.
- **Live-Prüfung:** Zeigt dauerhaft ein Statuslämpchen an, ob dein Stand fehlerfrei ist
  (dieselbe Prüfung wie der **Prüfen**-Button, ebenfalls ohne die Fehlerstelle zu
  verraten). Es erscheint erst kurz nach deinem letzten Zug, damit es beim Spielen nicht
  flackert. Ohne diese Option lässt sich der Status jederzeit über **Prüfen** abrufen.
- **Ton:** Kurze, dezente Soundeffekte beim Setzen einer Dame, Punkten, für Hinweise
  und beim Lösen. Lässt sich hier oder direkt über das 🔊/🔇-Symbol oben stummschalten.
- **Sprachsteuerung (Beta, nur auf Deutsch):** Steuere das Spiel per Stimme. Die
  Sprachbefehle sind eine **deutsche** Grammatik (Buchstabiertafel, Zahlwörter,
  „außer") und keine übersetzten Beschriftungen – deshalb ist die Option nur
  verfügbar, wenn die Oberfläche auf Deutsch steht. Felder werden wie beim
  Schach benannt – ein Spalten-Buchstabe (A…, von links) plus eine Zeilen-Zahl (1…,
  von oben), z. B. **„C4"** oder ausbuchstabiert **„Cäsar vier"**. Ein Panel zeigt einen
  🎤-Knopf zum Zuhören, ein <strong>ⓘ</strong>-Knopf mit einem kurzen Sprachbefehl-Tutorial
  sowie das zuletzt Erkannte; bei aktivem Modus werden zusätzlich die
  Koordinaten eingeblendet – wahlweise klein in der Ecke jedes Feldes oder (Unter-Option
  **„Koordinaten groß am Rand"**, nur bei aktiver Sprachsteuerung sichtbar) groß als
  Schachbrett-Leiste am Feldrand. Befehle: **„C4"** durchläuft das Feld (wie
  Tippen), **„C4 Dame"** setzt eine Dame, **„C4 Punkt"** einen Ausschluss, **„C4 leeren"**
  räumt es; dazu **„Hinweis"**, **„Prüfen"**, **„Zurück"**, **„Zurücksetzen"**,
  **„Neues Spiel"** und **„Stopp"** (Zuhören beenden). Mehrere Felder lassen sich in
  einem Befehl aufzählen (**„Punkte auf A2, B2, C3"**) und auch ganze Spalten, Zeilen
  oder Farbregionen mit Ausnahmen ansprechen, z. B. **„Punkte Spalte B und C außer Rot"**
  oder **„Punkte Zeile 2 und 3 außer Spalte D"**. Eine Region lässt sich auch über eine
  Zelle darin ansprechen (**„Punkte Region von C3"**). Der eigentliche Nutzen steckt im
  „außer" – eine ganze Zeile/Spalte/Farbe *komplett* auszupunkten ergibt nie eine Lösung
  (jede braucht eine Dame) und wird als „Sackgasse" gemeldet. Erscheint ein Hinweis, wird
  er vorgelesen und lässt sich mit **„OK"** übernehmen bzw. **„Schließen"** verwerfen. Nutzt die im Browser eingebaute
  Spracherkennung (Web Speech API) – ohne zusätzliche Abhängigkeit oder Server, aber
  aktuell nur in **Chrome/Edge** und mit Mikrofon-Freigabe. Wo die Erkennung fehlt, ist
  die Option deaktiviert und das Spiel läuft unverändert weiter.

Oben rechts in den Einstellungen, auf Höhe der Überschrift, sitzt ein kleiner
**QR-Button**: er zeigt die Web-Adresse des Spiels als QR-Code, damit jemand
neben dir einfach die Kamera darauf hält und sofort losspielt – ganz ohne
Installation. Der Code ist festes Markup (die App bringt keinen Generator mit);
`node tools/generate-qr.mjs` erzeugt ihn neu, falls sich die Adresse einmal
ändert.

Bei einem Eintrag ohne Namen wird **kein** Name gespeichert; „Anonym" ist nur die
Anzeige und erscheint bei allen Lesenden in ihrer eigenen Sprache.

Diese Einstellungen, der zuletzt genutzte Name und die lokalen Bestzeiten werden im
`localStorage` gespeichert (siehe *Bestenliste* unten). Ein laufender **Spielstand**
wird dagegen **nicht** gespeichert – ein Seiten-Reload startet ein frisches Rätsel.

## Bestenliste

Nach dem Lösen zeigt der Gewinn-Bildschirm ein **Ergebnis** und fragt, ob du dich
eintragen möchtest. Das Ergebnis ist eine „effektive Zeit": die reine Lösezeit plus
ein Aufschlag pro genutztem **Tipp** (+30 s). Der Tipp-Button sagt das schon
vorher, beim tatsächlich berechneten Tipp steigt ein kleines „+30 s" darüber auf,
und **die Uhr läuft auf der effektiven Zeit** – die Zahl, die man sieht, ist also
die Zahl, die zählt. Denselben Tipp erneut zu öffnen ist frei. Kleiner ist besser. **Fehler werden
gezählt und angezeigt, kosten aber nichts** – eine falsche Dame kostet ohnehin
Zeit, weil sie bemerkt und zurückgenommen werden muss, und auf dem Handy liegt
ein Fehltipp eine Daumenbreite daneben; ein zusätzlicher Aufschlag bestrafte die
Eingabe statt des Denkens. Jede Kombination aus Feldgröße
und Schwierigkeit hat eine eigene Rangliste; über 🏆 lässt sich jede davon durchblättern.

- **Eigene:** Bestzeiten werden immer auf dem Gerät gespeichert (bis zu **50** je
  Rangliste), ganz ohne Server. Der zuletzt eingegebene Name wird gemerkt, damit er
  nach jeder Runde schon vorausgefüllt ist. Der Reiter hieß früher *Lokal*; „Eigene"
  sagt dasselbe in der Sprache der Spielenden statt in der der Technik – und stellt
  klar, dass hier **jede** deiner Partien steht, auch die, die global nicht
  auftauchen.
- **Global (optional):** Ist eine Online-Rangliste eingerichtet, erscheint zusätzlich
  ein **Eintragen**-Button und ein *Global*-Tab, ebenfalls mit bis zu 50 Einträgen.
  Ohne Einrichtung läuft alles rein lokal weiter – Online ist nie Voraussetzung.

Beide Listen zeigen etwa sechs bis acht Zeilen und **scrollen** darüber hinaus, damit
der Gewinn-Bildschirm nicht wächst; die eigene, frische Zeile wird dabei automatisch in
den sichtbaren Bereich gescrollt.

Bei **exakt gleichem Ergebnis** behält der ältere Eintrag den besseren Platz: eine
Zeit einzustellen reicht nicht, man muss sie unterbieten. Das gilt lokal wie global
und in der Vorschau genauso wie nach dem Speichern – die Liste sortiert sich also
nicht mehr um, sobald man einträgt.

Jede Zeile zeigt außerdem, **wie alt** der Eintrag ist („vor 3 Tagen"; das genaue Datum
steht im Tooltip), und alles aus der letzten Woche ist grün hervorgehoben. Ohne diese
Angabe wirkt eine Rangliste eingefroren – so sieht man auf einen Blick, ob gerade
jemand spielt.

Ist die globale Rangliste eingerichtet und in einer Rangliste genug los, kommt ein
dritter Reiter **„90 Tage"** dazu: dieselbe Liste, aber nur mit Einträgen aus diesem
Zeitfenster. Er erscheint **nur dort, wo er etwas aussagt** – bei weniger als fünf
Einträgen im Fenster gäbe es nichts zu vergleichen, und wenn ohnehin alle Einträge
hineinfallen, wäre er nur eine Kopie der Gesamtliste. Bewusst ein *rollierendes*
Fenster statt „dieser Monat": ein Kalendermonat ist am Ersten leer und am 28. voll,
dasselbe Ergebnis läse sich also je nach Datum völlig anders.

Weil eine Liste irgendwo endet, sagt der erste Platz dahinter für sich genommen nichts.
Deshalb merkt sich das Spiel zusätzlich die **Ergebnisse aller** Partien je Rangliste
(nur Ergebnis und Zeitpunkt, ohne Namen) und zeigt direkt auf dem Gewinn-Bildschirm, wie
die frische Partie im Vergleich dasteht – z. B. *„Besser als 88 % deiner 26 Partien"*,
den Abstand zur eigenen Bestzeit oder *„🏆 Neue Bestzeit!"*. Diese Rückmeldung ist
sofort da und braucht weder Namen noch Internet. Bei wenigen Partien (unter fünf) steht
stattdessen die schlichte Platzierung – ein Prozentwert aus zwei Runden wäre nur Rauschen.
Weil die Partie-Historie zu jeder Partie auch das **Datum** kennt, kommt bei Bedarf
eine dritte Zeile dazu, die dieselbe Partie mit deiner *aktuellen Form* vergleicht:
*„Letzte 30 Tage: besser als 92 % von 12 Partien"* oder *„🔥 Deine beste Zeit der
letzten 30 Tage"*. Auch sie erscheint nur, wenn sie etwas hinzufügt – liegen alle
deine Partien innerhalb der 30 Tage, sagt sie nichts, was die Zeile darüber nicht
schon sagt, und bleibt weg.

Nach dem **Eintragen** in die globale Rangliste ergänzt die Statuszeile den gleichen
Vergleich für das gesamte Feld – und zwar **in Spielern, nicht in Einträgen**:
*„Platz 3 von 12 Spielern"*. Die Liste zeigt weiterhin jede eingereichte Partie, aber
eine Rangliste mit 83 Einträgen von drei Namen beschreibt kein Feld aus 83 Menschen,
und „Platz 28 von 83" liest sich für Neue wie ein geschlossener Club. Wer diesmal
langsamer war als seine eigene Bestzeit, bekommt das auch gesagt (*„Keine neue
Bestzeit – deine beste hält Platz 1 von 3 Spielern"*), statt einen Platz gutgeschrieben
zu bekommen, den dieser Lauf nicht geholt hat.

Im *Global*-Tab wird die eigene, gerade eingetragene Zeile grün umrandet – genau wie im
Reiter *Eigene*. Solange du nicht eingetragen hast, ist dort nichts markiert, weil dein
Ergebnis dort noch nicht existiert (die Statuszeile weist darauf hin). In der
🏆-Bestenliste, wo es kein Eintragen gibt, wird stattdessen deine **beste** Zeile
anhand des gemerkten Namens markiert – ohne Namen bleibt sie unmarkiert, denn eine
fremde Zeile als „du" zu umranden wäre schlicht gelogen.

Wer schon vor dieser Neuerung gespielt hat, verliert den Vergleich nicht: die
bestehenden Einträge der lokalen Bestenliste werden beim ersten Start als
Partie-Historie übernommen – mitsamt ihrem Datum, sodass auch das 30-Tage-Fenster
sofort funktioniert. Das sind allerdings nur die **besten** Partien – solange kaum
neue dazugekommen sind, fällt der Prozentwert deshalb eher zu streng aus.

### Online-Rangliste einrichten (optional, Supabase)

GitHub Pages liefert nur statische Dateien aus, das Spiel kann aber trotzdem per
`fetch()` eine Online-Rangliste ansprechen. Als Backend genügt ein kostenloses
[Supabase](https://supabase.com)-Projekt – der eigene Server wird nicht gebraucht.

1. Supabase-Projekt anlegen.
2. `docs/leaderboard-setup.sql` im **SQL-Editor** des Projekts ausführen. Das legt die
   Tabelle sowie die geprüften Funktionen `submit_score` / `top_scores` /
   `score_counts` an (die serverseitige Plausibilitätsprüfung = der Missbrauchsschutz).
   Wer die Rangliste schon länger betreibt, führt die Datei einfach erneut aus: ohne
   das laufen Alter und 90-Tage-Reiter nicht – der Rest bleibt unverändert, weil
   beides still zurückfällt, statt etwas kaputtzumachen.
3. In `js/leaderboard.js` die **Projekt-URL** und den **öffentlichen anon-Key**
   eintragen. Beide Werte dürfen im Browser stehen; der `service_role`-Key gehört
   **niemals** dorthin.

**Ehrlicher Hinweis:** Da der Browser die Zeit selbst meldet, ist keine solche
Rangliste manipulationssicher. Die Serverprüfungen (unmögliche Zeiten ablehnen,
Werte begrenzen, Best-Effort Rate-Limit) halten nur groben Unfug ab – für ein
Hobbyspiel genug, kein Turnier-Anspruch. Statt roher IP wird nur ein gesalzener
Tageshash fürs Rate-Limit gespeichert.

Genau deshalb ist die Zeit-Untergrenze **absichtlich sehr locker**: sie lag früher
bei „Feldgröße in Sekunden" und hat damit echte schnelle Läufe abgewiesen (ein 6×6
in 5 s ist mit Schnellmodus gut machbar). Da ohnehin jeder Manipulierende einfach
eine plausibel aussehende Zeit senden könnte, kostete diese Prüfung nur
Funktionalität. Abgewiesen wird jetzt nur noch Unmögliches (0 Sekunden). Wer die
Rangliste schon eingerichtet hat, führt den **MIGRATION**-Block am Ende von
`docs/leaderboard-setup.sql` nach (oder einfach die ganze Datei erneut – sie ist
wiederholbar und lässt vorhandene Daten unberührt).

Lehnt der Server einen Eintrag ab, sagt der Gewinn-Bildschirm jetzt **warum**
(z. B. „Global abgelehnt: Zeit als unmöglich eingestuft") statt „nicht erreichbar" –
und bietet keinen sinnlosen zweiten Versuch an. Lokal gespeichert wird in jedem
Fall, bevor überhaupt gesendet wird.

## Rätsel-Pools

„Neues Spiel" startet sofort: Die Rätsel werden nicht live berechnet, sondern aus
vorberechneten Pools in `levels/` gezogen – eine JSON-Datei pro Kombination aus
Feldgröße und Schwierigkeit, je 50 Rätsel. Das sind **22 Pools mit zusammen 1100
Rätseln** (Feldgröße 12 hat nur einen `schwer`-Pool, siehe unten). Damit sich
nichts einprägt, wird jedes
gezogene Rätsel zufällig **gedreht oder gespiegelt** (8 Symmetrien) und bekommt wie
bisher zufällige Farben – aus 50 gespeicherten Formen entstehen so hunderte
unterscheidbare Bretter. Innerhalb einer Sitzung wiederholt sich keine Form, bevor
nicht alle an der Reihe waren (nur im Speicher, nichts wird persistiert).

### Zwei Formensprachen

Die Farbregionen werden in **zwei verschiedenen Stilen** gebaut, und jeder Pool
enthält beide zur Hälfte:

- **organisch** – amöbenartige Regionen mit ausgefransten Grenzen.
- **blockig** – Regionen wachsen in geraden Streifen, dadurch lange gerade
  Grenzen, rechteckige Formen und eine große Hintergrundfarbe.

Weil jedes Rätsel eines Pools einmal an die Reihe kommt, bevor sich etwas
wiederholt, wechseln sich beide Looks beim Spielen gleichmäßig ab. **An der
Schwierigkeit ändert der Stil nichts** – sie hängt allein davon ab, welche
Denktechniken ein Brett verlangt. Nur bei *Leicht* fällt der Unterschied kaum
auf: diese Stufe braucht die kleinen „geschenkten" Regionen, die den blockigen
Look erst ausmachen würden.

Schlägt das Laden eines Pools fehl (z. B. offline geänderte Dateien), erzeugt das
Spiel das Rätsel wie früher live im Hintergrund – es gibt also immer ein Brett,
dann mit zufällig gewähltem Stil.

Die Pools werden mit `node tools/generate-levels.mjs` erzeugt und mit
`node tools/verify-levels.mjs` geprüft (Eindeutigkeit, Schwierigkeit, Symmetrien,
Lösbarkeit rein über Hinweise). Nach Änderungen an Generator-/Solver-Logik müssen
beide erneut laufen.

## Deployment auf GitHub Pages

Das Repo enthält einen GitHub-Actions-Workflow (`.github/workflows/deploy.yml`), der die
Seite bei jedem Push automatisch deployt. Einmalige Einrichtung:

1. In den Repository-**Settings → Pages** unter *Build and deployment → Source* den Wert
   **„GitHub Actions"** auswählen.
2. Auf einen der im Workflow konfigurierten Branches pushen (`main`, `master` oder den
   Entwicklungs-Branch).
3. Nach dem Durchlauf der Action ist die Seite unter der angezeigten Pages-URL erreichbar.

Da es sich um eine statische Seite handelt, kannst du alternativ in den Pages-Settings
auch „Deploy from a branch" wählen und den Repo-Root (`/`) veröffentlichen.

## Projektstruktur

```
index.html                – Seitengerüst
css/styles.css            – Layout & responsives, mobiles Design
js/solver.js              – Regeln, Lösungszählung, Logik-Solver (Schwierigkeitsbewertung)
js/generator.js           – Rätselerzeugung mit garantiert eindeutiger Lösung (Fallback & Pool-Erzeugung)
js/levels.js              – Lädt die vorberechneten Pools, dreht/spiegelt zufällig
js/game.js                – Spielzustand, Schnellmodus, Konflikt- & Gewinnerkennung
js/hint.js                – Nächster logischer Schluss als erklärbarer Hinweis
js/highscores.js          – Score-Modell, lokale Bestzeiten & Partie-Historie für den Vergleich (localStorage)
js/leaderboard.js         – Optionale globale Online-Rangliste (Supabase, fällt still auf lokal zurück)
js/settings.js            – Einstellungen & letzter Name (localStorage)
js/i18n.js                – Übersetzungsschicht: t(), Sprachwahl (ohne DOM)
js/i18n/en.js, de.js,     – Sprachpakete (ein Schlüsselsatz, identisch je Sprache)
  fr.js, es.js, pt.js, ru.js
js/audio.js               – Minimalistische Soundeffekte (Web Audio API, ohne Asset-Dateien)
js/voice.js               – Sprachsteuerung: reiner Befehls-Parser + Web-Speech-Wrapper (ohne DOM)
js/main.js                – DOM-Anbindung, Rendering, Steuerung
levels/                   – Vorberechnete Rätsel-Pools (JSON, pro Größe × Schwierigkeit)
docs/leaderboard-setup.sql – SQL zum Einrichten der optionalen Supabase-Rangliste
tools/generate-levels.mjs – Erzeugt die Pools neu
tools/verify-levels.mjs   – Prüft alle Pools (Eindeutigkeit, Stufe, Symmetrien, Hinweise)
tools/build-artifact.mjs  – Bündelt die App in eine Datei (Mobil-Test als Artifact)
tools/generate-qr.mjs     – Erzeugt den Teilen-QR-Code in index.html neu
tests/logic/verify-i18n.mjs – Prüft die Sprachpakete auf gleiche Schlüssel (läuft in CI)
```

## Übersetzen

Die Oberfläche gibt es auf **Deutsch**, **Englisch**, **Französisch**,
**Spanisch**, **Portugiesisch** und **Russisch**. Alle Texte liegen in
`js/i18n/<sprache>.js`; jede Datei enthält exakt denselben Satz Schlüssel. Eine
weitere Sprache ist eine Kopie von `js/i18n/en.js` plus ein Eintrag in
`I18N_PACKS`/`I18N_LANGUAGES` in `js/i18n.js` und in der Modulliste in
`tools/build-artifact.mjs`.

Ein Sprachpaket ist keine Wort-für-Wort-Übersetzung: zusammengesetzte Sätze sind
**Funktionen**, jede Sprache schreibt also ihren eigenen Satz, statt fremde
Platzhalter zu füllen, und die Grammatikregeln liegen in dem Paket, das sie
braucht – nichts davon ist geteilt, und `js/i18n.js` weiß von keiner einzelnen
Sprache. Genau das trägt Russisch mit seinen **drei** Pluralformen
(1 подсказка · 2 подсказки · 5 подсказок) und der Deklination der Einheitenwörter
durch vier Fälle, ohne dass ein einziger Aufrufer angefasst werden müsste –
während Französisch die 0 als Singular behandelt und Portugiesisch nicht. Was
Locale-*Daten* sind – Prozentschreibweise, Datum, relative Zeit, Pluralklassen –
übernimmt `Intl`, statt es von Hand zu tippen; eine neue Sprache braucht deshalb
keine neue Abhängigkeit.

Auch das Layout im Blick behalten: die Beschriftungen sind `white-space: nowrap`,
und die dreispaltige Tab-Zeile der Bestenliste ist die engste Zeile der App – sie
hat die russischen Tab-Beschriftungen zur Kürzung gezwungen.
`node tests/browser/i18n-layout.mjs` misst genau das.

`node tests/logic/verify-i18n.mjs` prüft, dass keine Sprache Schlüssel oder
Platzhalter verliert – das läuft auch in CI, ein Versehen fällt also beim Build
auf und nicht erst auf dem Bildschirm. Nicht übersetzt sind bewusst die
**Sprachsteuerung** (eine deutsche Sprach-Grammatik, siehe oben) und das
**Debug-Protokoll** (Entwickler-Ausgabe; eine feste Sprache hält Fehlermeldungen
lesbar).

## Lokal ausführen

Wegen ES-Modulen muss die Seite über einen Webserver laufen (nicht per `file://`):

```bash
python3 -m http.server 8000
# dann http://localhost:8000 öffnen
```

## Mitmachen

Bug-Reports, Ideen und Pull Requests sind willkommen – siehe
[CONTRIBUTING.md](./CONTRIBUTING.md) (Englisch) für den Einstieg und was vor
einem PR zu prüfen ist. In den Spiel-Einstellungen (⚙ → der ⓘ-Button) geht es
ebenfalls zum Repository.

## Lizenz

[MIT](./LICENSE)
