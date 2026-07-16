# Queens

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
- **Markierungen löschen** entfernt nur deine Punkte, die Damen bleiben.
- **Zurücksetzen** leert das aktuelle Feld.
- **Prüfen** zeigt kurz an, ob dein aktueller Stand fehlerfrei ist – nur ein
  grünes „✓ Keine Fehler" bzw. rotes „✗ Es gibt Fehler", **ohne** zu
  verraten, wo ein Fehler liegt, und **ohne** den nächsten Zug vorzuschlagen
  (das bleibt dem Hinweis vorbehalten). Als Fehler zählt jeder Regelverstoß im
  aktuellen Stand **und** eine gesetzte Dame, die nicht zur eindeutigen Lösung
  gehört – so fällt auch ein Abweichen vom Lösungsweg auf, bevor eine Regel bricht.
- Fehler (sich berührende / kollidierende Damen) werden rot markiert.
- Eine Zeile, Spalte oder Farbregion, in der jedes Feld ausgeschlossen ist und
  keine Dame steht, wird rot pulsierend umrandet – dort ist keine Dame mehr
  möglich, also stimmt etwas nicht.

## Einstellungen (⚙)

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

Diese Einstellungen, der zuletzt genutzte Name und die lokalen Bestzeiten werden im
`localStorage` gespeichert (siehe *Bestenliste* unten). Ein laufender **Spielstand**
wird dagegen **nicht** gespeichert – ein Seiten-Reload startet ein frisches Rätsel.

## Bestenliste

Nach dem Lösen zeigt der Gewinn-Bildschirm ein **Ergebnis** und fragt, ob du dich
eintragen möchtest. Das Ergebnis ist eine „effektive Zeit": die reine Lösezeit plus
ein Aufschlag pro genutztem **Tipp** (+30 s) und pro **Fehler** (+15 s, eine Dame
abseits der eindeutigen Lösung). Kleiner ist besser. Jede Kombination aus Feldgröße
und Schwierigkeit hat eine eigene Rangliste; über 🏆 lässt sich jede davon durchblättern.

- **Lokal:** Bestzeiten werden immer auf dem Gerät gespeichert (Top 10 je Rangliste),
  ganz ohne Server. Der zuletzt eingegebene Name wird gemerkt, damit er nach jeder
  Runde schon vorausgefüllt ist.
- **Global (optional):** Ist eine Online-Rangliste eingerichtet, erscheint zusätzlich
  ein **Eintragen**-Button und ein *Global*-Tab. Ohne Einrichtung läuft alles rein
  lokal weiter – Online ist nie Voraussetzung.

### Online-Rangliste einrichten (optional, Supabase)

GitHub Pages liefert nur statische Dateien aus, das Spiel kann aber trotzdem per
`fetch()` eine Online-Rangliste ansprechen. Als Backend genügt ein kostenloses
[Supabase](https://supabase.com)-Projekt – der eigene Server wird nicht gebraucht.

1. Supabase-Projekt anlegen.
2. `docs/leaderboard-setup.sql` im **SQL-Editor** des Projekts ausführen. Das legt die
   Tabelle sowie die geprüften Funktionen `submit_score` / `top_scores` an (die
   serverseitige Plausibilitätsprüfung = der Missbrauchsschutz).
3. In `js/leaderboard.js` die **Projekt-URL** und den **öffentlichen anon-Key**
   eintragen. Beide Werte dürfen im Browser stehen; der `service_role`-Key gehört
   **niemals** dorthin.

**Ehrlicher Hinweis:** Da der Browser die Zeit selbst meldet, ist keine solche
Rangliste manipulationssicher. Die Serverprüfungen (unmögliche Zeiten ablehnen,
Werte begrenzen, Best-Effort Rate-Limit) halten nur groben Unfug ab – für ein
Hobbyspiel genug, kein Turnier-Anspruch. Statt roher IP wird nur ein gesalzener
Tageshash fürs Rate-Limit gespeichert.

## Rätsel-Pools

„Neues Spiel" startet sofort: Die Rätsel werden nicht live berechnet, sondern aus
vorberechneten Pools in `levels/` gezogen (eine JSON-Datei pro Kombination aus
Feldgröße und Schwierigkeit, je 50 Rätsel; Feldgröße 12 hat nur einen
`schwer`-Pool). Damit sich nichts einprägt, wird jedes
gezogene Rätsel zufällig **gedreht oder gespiegelt** (8 Symmetrien) und bekommt wie
bisher zufällige Farben – aus 50 gespeicherten Formen entstehen so hunderte
unterscheidbare Bretter. Innerhalb einer Sitzung wiederholt sich keine Form, bevor
nicht alle an der Reihe waren (nur im Speicher, nichts wird persistiert).

Schlägt das Laden eines Pools fehl (z. B. offline geänderte Dateien), erzeugt das
Spiel das Rätsel wie früher live im Hintergrund – es gibt also immer ein Brett.

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
js/highscores.js          – Score-Modell & lokale Bestzeiten (localStorage)
js/leaderboard.js         – Optionale globale Online-Rangliste (Supabase, fällt still auf lokal zurück)
js/settings.js            – Einstellungen & letzter Name (localStorage)
js/main.js                – DOM-Anbindung, Rendering, Steuerung
levels/                   – Vorberechnete Rätsel-Pools (JSON, pro Größe × Schwierigkeit)
docs/leaderboard-setup.sql – SQL zum Einrichten der optionalen Supabase-Rangliste
tools/generate-levels.mjs – Erzeugt die Pools neu
tools/verify-levels.mjs   – Prüft alle Pools (Eindeutigkeit, Stufe, Symmetrien, Hinweise)
tools/build-artifact.mjs  – Bündelt die App in eine Datei (Mobil-Test als Artifact)
```

## Lokal ausführen

Wegen ES-Modulen muss die Seite über einen Webserver laufen (nicht per `file://`):

```bash
python3 -m http.server 8000
# dann http://localhost:8000 öffnen
```
