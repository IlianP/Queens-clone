# Queens

Ein Klon des LinkedIn-Spiels **Queens** – reines HTML/CSS/JavaScript, kein Build-Schritt,
läuft direkt auf GitHub Pages und ist für Handy und Desktop optimiert.

👉 **Live:** nach dem ersten Deploy unter `https://<dein-user>.github.io/<repo>/`

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
- Fehler (sich berührende / kollidierende Damen) werden rot markiert.

## Einstellungen (⚙)

- **Feldgröße:** 5 bis 11.
- **Schwierigkeit:**
  - *Leicht* – lösbar allein durch „nur ein Feld übrig"-Schlüsse.
  - *Mittel* – benötigt zusätzlich Zeilen-/Spalten-↔-Regionen-Schlüsse.
  - *Schwer* – benötigt eine vorausschauende (Widerspruchs-)Deduktion.

  Die Schwierigkeit ist unabhängig von der Feldgröße. Bei großen Feldern sind sehr
  leichte Rätsel selten – dann wird das nächstpassende, eindeutige Rätsel gewählt.
- **Schnellmodus:** Beim Setzen einer Dame werden alle dadurch ausgeschlossenen Felder
  automatisch gepunktet: die gesamte Zeile, Spalte, Farbregion und die angrenzenden Felder.

Nur diese Einstellungen werden lokal (im `localStorage`) gespeichert, damit sie beim
nächsten neuen Spiel wieder da sind. Es wird **kein** Spielstand und **kein** Highscore
gespeichert – ein Seiten-Reload startet frisch.

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
index.html            – Seitengerüst
css/styles.css        – Layout & responsives, mobiles Design
js/solver.js          – Regeln, Lösungszählung, Logik-Solver (Schwierigkeitsbewertung)
js/generator.js       – Rätselerzeugung mit garantiert eindeutiger Lösung
js/game.js            – Spielzustand, Schnellmodus, Konflikt- & Gewinnerkennung
js/settings.js        – Einstellungen (localStorage)
js/main.js            – DOM-Anbindung, Rendering, Steuerung
```

## Lokal ausführen

Wegen ES-Modulen muss die Seite über einen Webserver laufen (nicht per `file://`):

```bash
python3 -m http.server 8000
# dann http://localhost:8000 öffnen
```
