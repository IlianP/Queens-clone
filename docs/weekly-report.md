# Wochenbericht zur Spielaktivität

Einmal pro Woche legt GitHub Actions ein Issue mit einem Aktivitätsbericht an;
die Benachrichtigungsmail von GitHub ist die wöchentliche Mail. Kein SMTP, kein
Drittanbieter, kein Passwort, das ablaufen kann.

| Teil | Datei |
|------|-------|
| Bericht (Auswertung + Text) | `tools/weekly-report.mjs` |
| Zeitplan, Zustand, Issue | `.github/workflows/weekly-report.yml` |
| Test | `tests/logic/weekly-report.mjs` (läuft in CI mit) |
| Lesezugriff | `docs/leaderboard-setup.sql`, Abschnitt 7 |
| Anonyme Zähler | `js/stats.js`, `docs/leaderboard-setup.sql` Abschnitt 8 |
| Test dazu | `tests/logic/stats.mjs`, `tests/sql/play-stats.sql` |

Der Bericht ist **deterministisch**: dieselben Zeilen und dasselbe Zeitfenster
ergeben zeichengleichen Text. Keine KI im Spiel, keine Modellausgabe, kein
`Intl`, keine lokale Zeitzone — der Text hängt nur von den Daten ab.

## Einrichten (einmalig, ~5 Minuten)

1. **SQL nachziehen.** `docs/leaderboard-setup.sql` im Supabase-SQL-Editor
   erneut ausführen (die Datei ist wiederholbar). Neu sind Abschnitt 7 (ein
   `grant select … to service_role`) und Abschnitt 8 (die anonymen Zähler:
   `play_stats`, `stat_limits`, `bump_stat`). Bestehende Daten bleiben
   unberührt.
2. **Secret key holen.** Supabase → Project Settings → API Keys → Reiter
   „Publishable and secret API keys" → einen **Secret key** anlegen (`sb_secret_…`,
   z. B. `github-weekly-report`). Er handelt serverseitig als `service_role`, lässt
   sich aber einzeln widerrufen — anders als der Legacy-`service_role`-Key, bei
   dessen Leak man das JWT-Secret neu erzeugen müsste, was auch den öffentlichen
   `anon`-Key in `js/leaderboard.js` ungültig machen würde. Der Legacy-Key
   funktioniert weiterhin; `supabaseHeaders` in `tools/weekly-report.mjs`
   erkennt die Art am Präfix und schickt einen `sb_`-Key nur als `apikey`, nie
   als `Authorization: Bearer` — er ist kein JWT.
3. **Secret setzen.** Im GitHub-Repo → Settings → Secrets and variables →
   Actions → New repository secret, Name `SUPABASE_SERVICE_KEY`, Wert der Key
   aus Schritt 2.
4. **Testlauf.** Actions → „Wochenbericht" → Run workflow → `dry_run` auf
   `true`. Der Bericht erscheint dann in der Job-Zusammenfassung, es wird kein
   Issue angelegt und der Zeitraum rückt nicht weiter.
5. **Benachrichtigung prüfen.** Damit die Mail ankommt, muss das Repo auf
   *Watch → All Activity* (oder mindestens *Issues*) stehen und in den
   GitHub-Benachrichtigungseinstellungen „Email" aktiv sein.

> **Der Schlüssel umgeht Row Level Security** (beide Arten). Er gehört ausschließlich in
> dieses GitHub-Secret — nie in `js/leaderboard.js`, nie in den Browser, nie in
> ein Issue. Im Browser steht der öffentliche `anon`-Key, und das ist der
> Unterschied zwischen „darf die Funktionen aufrufen" und „darf alles lesen".

## Zeitplan

`cron: '0 6 * * 1'` — montags 06:00 UTC (08:00 MESZ / 07:00 MEZ). GitHub führt
Cron-Jobs in UTC aus und kann sich bei Last um Minuten verspäten; das ist
folgenlos, weil das Fenster am tatsächlichen Laufzeitpunkt endet und der nächste
Bericht dort weitermacht.

Ein anderer Tag oder eine andere Uhrzeit ist eine Zeile im Workflow. Öfter als
wöchentlich ergibt bei der aktuellen Datenmenge wenig — die meisten Tage hätten
null Einreichungen.

## Der Zeitraum („seit der letzten Mail")

Das Fenster beginnt dort, wo der letzte Bericht endete. Dieser Zeitpunkt steht
als HTML-Kommentar am Ende jedes Bericht-Issues:

```html
<!-- queens-report-state: {"until":"2026-09-14T06:00:00.000Z","lastId":248} -->
```

Der nächste Lauf sucht das jüngste Issue mit dem Label `wochenbericht`, liest
den Marker und rechnet ab dort weiter. Daraus folgt:

- **Fällt ein Lauf aus, geht nichts verloren** — der nächste Bericht deckt beide
  Wochen ab und sagt das über seinen Zeitraum in der Kopfzeile.
- **Der Zeitraum rückt nur weiter, wenn ein Bericht auch zugestellt wurde.**
  Bricht der Job nach dem Abfragen, aber vor dem Anlegen des Issues ab, bleibt
  der alte Marker stehen.
- **Wird das letzte Issue gelöscht oder sein Label entfernt**, fällt der nächste
  Bericht auf die Standardwoche (7 Tage) zurück und sagt das ebenfalls dazu.

Bewusst **kein** Zustand im Repo: `main` ist geschützt (ein Bot-Push scheitert am
Statuscheck `logic-tests`), und ein Commit auf `main` würde über `deploy.yml`
jede Woche die Seite neu ausrollen.

## Die anonymen Zähler (Pings)

Die Rangliste weiß nur von Partien, die gelöst **und** eingereicht wurden. Alles
davor war unsichtbar. `js/stats.js` schließt die Lücke mit drei Zählern:

| Ping | Wann | Was er beantwortet |
|------|------|--------------------|
| `app_open` | einmal je Seitenaufruf | Wie oft wird das Spiel überhaupt geöffnet? |
| `game_start` | sobald ein Brett bespielbar ist | Wie viele Partien werden angefangen? |
| `game_win` | bei jedem gelösten Brett | Wie viele werden gelöst — auch ohne Einreichung? |

**Es gibt bewusst keinen Ping fürs Einreichen.** Diese Zahl steht exakt in
`scores`; ein Zähler dafür wäre dieselbe Zahl ein zweites Mal, aus einer zweiten
Quelle, die abweichen kann. Der Bericht setzt die vier Stufen stattdessen als
Trichter untereinander und schreibt an die letzte dazu, dass sie aus der
Rangliste kommt.

### Was gesendet wird — und was nicht

Ein Ping ist ein **Zähler**, kein Ereignis. Der Server addiert eins auf eine
Zeile `(Stunde, Art, Quelle, Größe, Schwierigkeit)`. Es gibt keine Zeile je
Spiel, keine IP, keine Kennung, keine Sitzung, kein Cookie, keinen
`localStorage`-Eintrag. Der vollständige Inhalt einer Anfrage:

```json
{ "p_kind": "game_start", "p_source": "web", "p_size": 8, "p_difficulty": "hard" }
```

Daraus lässt sich niemand wiedererkennen — deshalb braucht das keinen
Einwilligungsbanner, und deshalb bleibt „wie viele eindeutige Nutzer" auch mit
den Zählern unbeantwortbar. Wer eine echte Nutzerzahl will, müsste eine Kennung
speichern; genau das tut das hier nicht.

Fehlschläge sind folgenlos: `bumpStat` gibt nichts zurück (man kann einen Zähler
also gar nicht abwarten), verschluckt jeden Fehler, und wenn der Server mit
404/401/403 antwortet — etwa weil Abschnitt 8 noch nicht ausgeführt wurde —
stellt er die Versuche für den Rest des Seitenaufrufs ein.

### Testläufe zählen getrennt

Ein automatisierter Browsertest fährt dieselbe Oberfläche wie ein Mensch. Damit
er nicht als Spiel zählt, trägt jeder Ping eine **Quelle**:

| Quelle | Woran erkannt | Im Bericht |
|--------|---------------|------------|
| `test` | `navigator.webdriver` (setzt jede WebDriver-/CDP-Automatisierung) | eigene Zeile „Nicht mitgezählt" |
| `dev` | `localhost`, `127.0.0.1`, `*.local`, `file:` | eigene Zeile „Nicht mitgezählt" |
| `web` | alles andere | die echten Zahlen |

Zwei Eigenschaften machen das verlässlich:

- **Kein Test muss etwas tun.** Die Erkennung passiert im Spielcode, nicht in den
  Tests — eine vergessene Test-Einstellung kann also keinen Testlauf in die
  echten Zahlen rutschen lassen. `navigator.webdriver` wird **vor** dem Hostnamen
  geprüft, weil Browsertests gegen `localhost` laufen und sonst als `dev`
  gälten.
- **Im Zweifel nicht `web`.** Eine Umgebung, die sich nicht einordnen lässt,
  gilt als `dev`. Einen echten Spieler als Entwicklung zu zählen kostet einen
  Strich; einen Roboter als Spieler zu zählen ist genau das, was die Quelle
  verhindern soll.

Zusätzlich beantworten die Browsertests den Ping lokal (`stubStats` in
`tests/browser/board-helpers.mjs`), damit die Testsuite die echte Datenbank gar
nicht erst anfasst. Die Quelle ist der Gürtel, der Stub die Hosenträger. Wer
Testverkehr wirklich im Bericht sehen will, öffnet die Seite mit
`openGame({ stats: 'live' })`.

### Zeitfenster

Einreichungen werden sekundengenau abgegrenzt, Zähler liegen nur stundenweise
vor. Das Ping-Fenster wird deshalb auf volle Stunden gerundet und endet bei der
letzten **abgeschlossenen** Stunde; die angebrochene gehört dem nächsten Bericht.
Sein Ende steht getrennt im Zustandsmarker (`statsUntil`), sodass zwei
aufeinanderfolgende Berichte dieselbe Stunde weder doppelt zählen noch auslassen.
Beide Zeiträume stehen in der Kopfzeile des Berichts.

### Missbrauch

`bump_stat` ist für `anon` offen — es muss aus dem Browser aufrufbar sein. Zwei
Bremsen: die Funktion nimmt nur Werte aus festen Listen an (alles andere wird
still verworfen, die Tabelle kann also keine erfundenen Zeilen enthalten), und
sie zählt höchstens 60 Pings pro Minute und Client (`stat_limits`, derselbe
täglich gesalzene IP-Hash wie beim Rate-Limit der Rangliste). Wie bei der
Rangliste gilt: das hält groben Unfug ab, mehr nicht. Eine Zahl, die der Browser
meldet, ist nie fälschungssicher.

## Was im Bericht steht

- **Aktivität** — neue Einreichungen, Vergleich zum Vorzeitraum, Gesamtzahl,
  Tage mit Aktivität, aktive Geräte, Balken pro Tag (gestartete Spiele, sobald
  Zähler vorliegen, sonst Einreichungen).
- **Spielverlauf** — der Trichter geöffnet → gestartet → gelöst → eingereicht,
  Testverkehr getrennt darunter, und eine Tabelle „gestartet / gelöst /
  Lösungsquote" je Größe. Fehlt die Zähler-Migration, fehlt der ganze Abschnitt.
- **Spielerinnen und Spieler** — Namen im Zeitraum, neu dabei, wiedergekommen,
  Einreichungen ohne Namen.
- **🏆 Neue Bestzeiten** — je Bucket, wenn der Altbestand geschlagen wurde, mit
  dem vorherigen Wert daneben.
- **Gespielte Größen** — Einreichungen, Median-Spielzeit und die aktuelle
  Bestenliste je aktivem Bucket.
- **Wie gespielt wurde** — Median-Spielzeit, Tipps und Fehler pro Lauf, Anteil
  der Läufe ganz ohne Tipp bzw. ohne Fehler.
- **Neueste Einreichungen** — die Einzelzeilen seit der letzten Mail (max. 25,
  danach „… und N weitere").
- **Lesehilfe** — eingeklappt, sagt bei jedem Bericht dazu, was die Zahlen nicht
  sind.

## Was der Bericht nicht wissen kann

Die einzige Datenquelle ist `public.scores`. Eine Zeile entsteht nur, wenn ein
Spiel **gelöst und global eingereicht** wurde:

- **Wie viele Menschen das sind, bleibt offen.** Die Zähler sagen, wie oft
  geöffnet, gestartet und gelöst wurde — nicht, von wie vielen Personen. Ohne
  gespeicherte Kennung ist das nicht unterscheidbar, und eine solche Kennung
  einzuführen wäre eine andere Entscheidung als diese hier.
- **Eindeutige Nutzer gibt es nicht.** `client_key` ist der täglich gesalzene
  IP-Hash, den `submit_score` ohnehin fürs Rate-Limit führt. Er wechselt täglich
  und ist pro Netz grob. Deshalb zählt der Bericht **Geräte pro Tag** und
  **Gerätetage**, nicht „Nutzer" — und der Hash selbst wird nie ausgegeben
  (`tests/logic/weekly-report.mjs` prüft das).
- **Namen sind selbstgewählt** und nicht eindeutig. „Neu dabei" heißt nur: dieser
  Name stand vorher nie in der Tabelle.

Die Zähler holen davon das Messbare herein (geöffnet, gestartet, gelöst). Der
Rest — wer, wie oft, wiederkehrend — bliebe nur mit einer gespeicherten Kennung
beantwortbar und ist deshalb bewusst **nicht** enthalten.

## Lokal ausprobieren

Ohne Netz, mit erfundenen Zeilen:

```bash
cat > /tmp/rows.json <<'JSON'
[{"id":1,"created_at":"2026-09-10T10:00:00Z","name":"Test","size":8,
  "difficulty":"hard","seconds":210,"hints":1,"mistakes":0,"score":240,
  "client_key":"abc"}]
JSON
node tools/weekly-report.mjs --fixture /tmp/rows.json --now 2026-09-14T06:00:00Z
```

Mit Zähler-Zeilen dazu (`--fixture-stats` erwartet Zeilen aus `play_stats`):

```bash
node tools/weekly-report.mjs --fixture /tmp/rows.json \
  --fixture-stats /tmp/stats.json --now 2026-09-14T06:00:00Z
```

Gegen die echte Datenbank (nur lesend):

```bash
SUPABASE_SERVICE_KEY=… node tools/weekly-report.mjs --now 2026-09-14T06:00:00Z
```

Weitere Schalter: `--state <datei>` (Text des letzten Berichts, für die
Fortsetzung), `--out-body` / `--out-title` (Dateien statt stdout),
`--window-days <n>`.

## Wartung

- **Der Cron kann einschlafen.** GitHub deaktiviert geplante Workflows in
  öffentlichen Repos nach 60 Tagen ohne Repository-Aktivität und schickt vorher
  eine Mail. Ein Klick auf „Enable workflow" (oder irgendein Commit) reicht.
- **Bleibt die Mail aus**, zuerst unter Actions nachsehen, ob der Lauf rot ist.
  Häufigste Ursache: das Secret fehlt oder wurde rotiert — der Job bricht dann
  mit einer ausdrücklichen Fehlermeldung ab.
- **HTTP 401 / „permission denied for table scores"** heißt, dass Abschnitt 7
  von `docs/leaderboard-setup.sql` noch nicht gelaufen ist.
- **Der Abschnitt „Spielverlauf" fehlt** heißt, dass keine Zähler-Zeilen im
  Zeitraum liegen: entweder ist Abschnitt 8 noch nicht ausgeführt (dann
  antwortet `play_stats` mit 404 und der Bericht erscheint trotzdem), oder es
  wurde tatsächlich nicht gespielt.
