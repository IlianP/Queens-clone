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

Der Bericht ist **deterministisch**: dieselben Zeilen und dasselbe Zeitfenster
ergeben zeichengleichen Text. Keine KI im Spiel, keine Modellausgabe, kein
`Intl`, keine lokale Zeitzone — der Text hängt nur von den Daten ab.

## Einrichten (einmalig, ~5 Minuten)

1. **SQL nachziehen.** `docs/leaderboard-setup.sql` im Supabase-SQL-Editor
   erneut ausführen (die Datei ist wiederholbar). Neu ist nur eine Zeile:
   `grant select on public.scores to service_role;`.
2. **service_role-Key holen.** Supabase → Project Settings → API →
   `service_role` (der geheime Key, nicht der `anon`-Key).
3. **Secret setzen.** Im GitHub-Repo → Settings → Secrets and variables →
   Actions → New repository secret, Name `SUPABASE_SERVICE_KEY`, Wert der Key
   aus Schritt 2.
4. **Testlauf.** Actions → „Wochenbericht" → Run workflow → `dry_run` auf
   `true`. Der Bericht erscheint dann in der Job-Zusammenfassung, es wird kein
   Issue angelegt und der Zeitraum rückt nicht weiter.
5. **Benachrichtigung prüfen.** Damit die Mail ankommt, muss das Repo auf
   *Watch → All Activity* (oder mindestens *Issues*) stehen und in den
   GitHub-Benachrichtigungseinstellungen „Email" aktiv sein.

> **Der service_role-Key umgeht Row Level Security.** Er gehört ausschließlich in
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

## Was im Bericht steht

- **Aktivität** — neue Einreichungen, Vergleich zum Vorzeitraum, Gesamtzahl,
  Tage mit Aktivität, aktive Geräte, Balken pro Tag.
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

- **Gespielte Partien, Seitenaufrufe, Abbrüche** erzeugen keine Zeile. Wer lokal
  spielt oder nicht einreicht, taucht nirgends auf. Es gibt kein Analytics, kein
  Cookie, keinen Ping.
- **Eindeutige Nutzer gibt es nicht.** `client_key` ist der täglich gesalzene
  IP-Hash, den `submit_score` ohnehin fürs Rate-Limit führt. Er wechselt täglich
  und ist pro Netz grob. Deshalb zählt der Bericht **Geräte pro Tag** und
  **Gerätetage**, nicht „Nutzer" — und der Hash selbst wird nie ausgegeben
  (`tests/logic/weekly-report.mjs` prüft das).
- **Namen sind selbstgewählt** und nicht eindeutig. „Neu dabei" heißt nur: dieser
  Name stand vorher nie in der Tabelle.

Das ließe sich ändern — mit einem anonymen Zählschritt im Spiel (nur Tageszähler
je Ereignis, keine Einzelzeile, kein Cookie). Das wäre eine eigene Entscheidung
mit eigenem Datenschutz-Abwägen und ist hier bewusst **nicht** enthalten.

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
