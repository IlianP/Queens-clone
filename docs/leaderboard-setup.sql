-- Queens-clone – Einrichtung der optionalen globalen Rangliste (Supabase / Postgres)
-- =============================================================================
-- Einmalig im Supabase-Dashboard unter "SQL Editor" ausführen. Danach in
-- js/leaderboard.js SUPABASE_URL und den öffentlichen anon-Key eintragen.
--
-- Sicherheitsmodell:
--   * Row Level Security ist an, die Tabelle hat KEINE Schreib-Policy und wird
--     nicht direkt gelesen. Schreiben und Lesen laufen ausschließlich über die
--     SECURITY-DEFINER-Funktionen unten, die als Eigentümer laufen und nur
--     unbedenkliche Spalten zurückgeben (nie die IP, nie den client_key).
--   * submit_score() ist der "Missbrauchsschutz": Name säubern, Werte prüfen,
--     unmögliche Zeiten ablehnen, Best-Effort Rate-Limit pro Client. Der Score
--     wird serverseitig berechnet (Client-Angaben zählen nur als Rohwerte).
--   * Ehrlich: Da der Browser die Zeit selbst meldet, ist keine solche Rangliste
--     manipulationssicher – die Prüfungen halten nur groben Unfug ab. Genau
--     deshalb sind sie bewusst LOCKER: eine Prüfung, die echte schnelle Läufe
--     abweist, kostet Funktionalität und bringt keine Sicherheit (siehe
--     queens_min_seconds).
--
-- Bereits eingerichtet? Dann genügt es, die geänderten Funktionen erneut
-- auszuführen – `create or replace` ersetzt sie an Ort und Stelle, Tabelle und
-- Daten bleiben unberührt. Der Abschnitt "MIGRATION" am Ende dieser Datei listet,
-- was sich seit der Ersteinrichtung geändert hat.
--
-- Datenschutz: Statt der rohen IP wird nur ein täglich gesalzener Hash
-- gespeichert (client_key), rein fürs Rate-Limit – die IP selbst wird nicht
-- abgelegt.

-- 1) Tabelle ------------------------------------------------------------------
create table if not exists public.scores (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  name        text        not null,
  size        int         not null,
  difficulty  text        not null,
  seconds     int         not null,
  hints       int         not null default 0,
  mistakes    int         not null default 0,
  score       int         not null,
  client_key  text
);

create index if not exists scores_bucket_idx
  on public.scores (size, difficulty, score, seconds);
create index if not exists scores_ratelimit_idx
  on public.scores (client_key, created_at);
-- Für die zeitlich begrenzte Bestenliste ("letzte N Tage"): der Bucket-Index
-- oben trägt den Zeitfilter nicht, weil created_at dort gar nicht vorkommt.
create index if not exists scores_recent_idx
  on public.scores (size, difficulty, created_at);

-- 2) Row Level Security: an, ohne Policy = kein Direktzugriff für anon ---------
alter table public.scores enable row level security;
revoke all on public.scores from anon, authenticated;

-- 3) Score-Formel – muss zu js/highscores.js passen ---------------------------
create or replace function public.queens_score(p_seconds int, p_hints int, p_mistakes int)
  returns int language sql immutable as $$
  select p_seconds + 30 * p_hints + 15 * p_mistakes;
$$;

-- Untergrenze für die gemeldete Zeit. ABSICHTLICH sehr niedrig: sie war früher
-- `greatest(3, p_size)` – also z. B. 6 Sekunden bei 6×6 – und hat damit echte,
-- schnelle Läufe abgewiesen (ein 6×6 in 5 s ist mit Schnellmodus problemlos
-- machbar). Das war kein Schutz, sondern nur ein Ärgernis: da der Browser seine
-- Zeit selbst meldet, hätte jeder Manipulierende einfach eine „plausible" Zeit
-- geschickt. Abgelehnt wird deshalb nur noch das physikalisch Unmögliche (0 s
-- oder negativ); Funktionalität geht hier vor Schein-Sicherheit.
create or replace function public.queens_min_seconds(p_size int)
  returns int language sql immutable as $$
  select 1;
$$;

-- 4) Eintragen: prüft serverseitig, rechnet den Score, gibt Rang + Gesamt -----
create or replace function public.submit_score(
  p_name text, p_size int, p_difficulty text,
  p_seconds int, p_hints int, p_mistakes int
) returns table (rank bigint, total bigint)
  language plpgsql security definer set search_path = public as $$
declare
  v_name   text;
  v_score  int;
  v_key    text;
  v_recent int;
  v_id     bigint;
  v_at     timestamptz;
begin
  -- Name säubern (Whitespace zusammenfassen, kürzen). Ein leerer Name bleibt
  -- LEER und wird NICHT durch ein Wort ersetzt: die Liste ist mehrsprachig, und
  -- ein gespeichertes "Anonym" würde für immer in der Sprache stehen, in der es
  -- geschrieben wurde. Den Platzhalter setzt der Client beim Anzeigen, also in
  -- der Sprache der lesenden Person (renderScoreList in js/main.js).
  v_name := left(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), 20);

  -- Wertebereiche prüfen.
  if p_size < 5 or p_size > 12 then raise exception 'bad size'; end if;
  if p_difficulty not in ('easy', 'medium', 'hard') then raise exception 'bad difficulty'; end if;
  if p_seconds is null or p_seconds < queens_min_seconds(p_size) or p_seconds > 86400 then
    raise exception 'implausible time';
  end if;
  if coalesce(p_hints, 0) < 0 or coalesce(p_hints, 0) > 999
     or coalesce(p_mistakes, 0) < 0 or coalesce(p_mistakes, 0) > 9999 then
    raise exception 'bad counters';
  end if;

  -- Best-Effort Rate-Limit: gesalzener Tageshash der Client-IP, max. 20/Minute.
  -- (Hinter dem Supabase-Pooler kann die IP grob sein – daher bewusst locker.)
  v_key := md5(coalesce(host(inet_client_addr()), '') || '|' || current_date::text);
  select count(*) into v_recent from public.scores
    where client_key = v_key and created_at > now() - interval '1 minute';
  if v_recent >= 20 then raise exception 'rate limited'; end if;

  v_score := queens_score(p_seconds, coalesce(p_hints, 0), coalesce(p_mistakes, 0));

  insert into public.scores (name, size, difficulty, seconds, hints, mistakes, score, client_key)
  values (v_name, p_size, p_difficulty, p_seconds, coalesce(p_hints, 0), coalesce(p_mistakes, 0), v_score, v_key)
  returning id, created_at into v_id, v_at;

  -- Rang = wie viele Einträge VOR diesem stehen, und zwar in exakt der
  -- Reihenfolge, die top_scores ausgibt (Score, dann Zeit, dann Alter). Der
  -- zeilenweise Vergleich unten ist genau diese lexikografische Ordnung.
  --
  -- Gleichstand überholt also NICHT: wer dieselbe Zeit noch einmal erreicht,
  -- steht hinter dem älteren Eintrag. Vorher zählte hier nur `seconds <`, was
  -- den neuen Eintrag bei Gleichstand VOR den bestehenden setzte – der Rang
  -- zeigte dann auf die erste Zeile der Gleichstandsgruppe, während er in der
  -- Liste als letzte steht. Die Oberfläche markierte prompt die falsche Zeile.
  return query
    with bucket as (
      select s.id, s.score, s.seconds, s.created_at from public.scores s
        where s.size = p_size and s.difficulty = p_difficulty
    )
    select (select count(*) + 1 from bucket b
              where (b.score, b.seconds, b.created_at, b.id)
                  < (v_score, p_seconds, v_at, v_id))::bigint,
           (select count(*) from bucket)::bigint;
end;
$$;

-- 5) Bestenliste lesen (nur unbedenkliche Spalten, best-first) -----------------
-- created_at wird MITGELIEFERT: die Oberfläche zeigt daneben das Alter des
-- Eintrags ("vor 3 Tagen"). Das ist unbedenklich – der Zeitpunkt einer Übermittlung
-- verrät nichts über die Person, und ohne ihn wirkt eine Liste eingefroren.
--
-- p_since (optional) begrenzt die Liste auf Einträge ab diesem Zeitpunkt, also
-- die zeitlich begrenzte Wertung. NULL = alle. Der Client schickt den Parameter
-- nur, wenn er ihn braucht; ein Aufruf ohne ihn ist exakt der alte.
--
-- ACHTUNG beim erneuten Ausführen: die Rückgabespalten haben sich geändert, und
-- das kann `create or replace` in Postgres nicht – deshalb das `drop` davor.
-- Zwischen drop und create existiert die Funktion für Sekundenbruchteile nicht;
-- ein Aufruf genau in dieser Lücke fällt im Spiel auf "nicht erreichbar"
-- zurück, was folgenlos ist. Daten werden dabei nicht angefasst.
drop function if exists public.top_scores(int, text, int);
create or replace function public.top_scores(
  p_size int, p_difficulty text, p_limit int default 10, p_since timestamptz default null
) returns table (name text, seconds int, hints int, mistakes int, score int, created_at timestamptz)
  language sql security definer set search_path = public stable as $$
  select s.name, s.seconds, s.hints, s.mistakes, s.score, s.created_at
    from public.scores s
    where s.size = p_size and s.difficulty = p_difficulty
      and (p_since is null or s.created_at >= p_since)
    -- `id` als letztes Kriterium macht die Ordnung total: created_at allein
    -- könnte bei zwei exakt gleichzeitigen Einträgen kippen, und submit_score
    -- rechnet den Rang in genau dieser Reihenfolge aus.
    order by s.score asc, s.seconds asc, s.created_at asc, s.id asc
    limit least(greatest(coalesce(p_limit, 10), 1), 100);
$$;

-- 5b) Wie voll ist ein Bucket – insgesamt und im Zeitfenster? ------------------
-- Grundlage für die *adaptive* Zeitwertung: die Oberfläche bietet sie nur an,
-- wo das Fenster wirklich ein Feld enthält (sonst stünde da "Platz 1 von 2").
-- Zwei Zahlen statt einer, weil auch der umgekehrte Fall zählt: liegt alles
-- innerhalb des Fensters, ist die Zeitwertung nur eine Kopie der Gesamtliste und
-- wird ebenfalls weggelassen.
create or replace function public.score_counts(
  p_size int, p_difficulty text, p_since timestamptz default null
) returns table (total bigint, recent bigint)
  language sql security definer set search_path = public stable as $$
  select count(*)::bigint,
         count(*) filter (where p_since is null or s.created_at >= p_since)::bigint
    from public.scores s
    where s.size = p_size and s.difficulty = p_difficulty;
$$;

-- 6) Ausführrechte nur für diese Funktionen ------------------------------------
grant execute on function public.submit_score(text, int, text, int, int, int) to anon;
grant execute on function public.top_scores(int, text, int, timestamptz) to anon;
grant execute on function public.score_counts(int, text, timestamptz) to anon;

-- MIGRATION für bereits eingerichtete Projekte ---------------------------------
-- Die ganze Datei erneut auszuführen ist immer sicher (alles ist `if not exists`
-- bzw. `create or replace`, keine Daten werden angefasst). Wer nur die Änderung
-- will, führt genau diesen Block aus:
--
--   2026-07: Zeit-Untergrenze gelockert. Vorher `greatest(3, p_size)`, was echte
--   schnelle Läufe mit "implausible time" (Fehlercode P0001, HTTP 400) abwies –
--   z. B. ein 6×6 in 5 s. Neu: nur noch 0/negativ wird abgelehnt.
--
--     create or replace function public.queens_min_seconds(p_size int)
--       returns int language sql immutable as $$
--       select 1;
--     $$;
--
-- Bereits abgewiesene Einträge sind nicht nachträglich rekonstruierbar (sie
-- wurden nie geschrieben) – sie liegen aber lokal auf dem Gerät des Spielenden,
-- weil die lokale Bestenliste vor dem Senden gespeichert wird.
--
--   2026-07: Namenloser Eintrag wird nicht mehr serverseitig "Anonym" genannt.
--   Die Oberfläche gibt es jetzt auf Deutsch und Englisch (weitere Sprachen
--   folgen), und ein gespeicherter Name ist unveränderlich – er stünde also bei
--   allen Lesenden auf Deutsch. Neu wird der leere Name leer gespeichert; den
--   Platzhalter setzt der Client in seiner eigenen Sprache. Nur diese eine Zeile
--   entfällt in submit_score():
--
--     if v_name = '' then v_name := 'Anonym'; end if;
--
--   Am einfachsten die Datei komplett erneut ausführen. Bereits gespeicherte
--   "Anonym"-Zeilen bleiben, wie sie sind – sie nachträglich zu leeren wäre
--   möglich, aber nicht nötig:
--
--     -- optional, nur falls Altbestand vereinheitlicht werden soll:
--     -- update public.scores set name = '' where name = 'Anonym';
--
--   2026-08: Zeitbezug in der Rangliste. top_scores() liefert jetzt created_at
--   mit (Alter pro Zeile: "vor 3 Tagen") und kennt den optionalen Parameter
--   p_since für eine Wertung der letzten N Tage; neu dazu kommen score_counts()
--   und ein Index auf (size, difficulty, created_at). Bestandsdaten reichen
--   dafür aus: created_at steht seit der Ersteinrichtung auf jeder Zeile, die
--   Zeitwertung gilt also rückwirkend. Am einfachsten die ganze Datei erneut
--   ausführen (Abschnitte 1, 5, 5b und 6). Wer nur den Kern will:
--
--     create index if not exists scores_recent_idx
--       on public.scores (size, difficulty, created_at);
--     drop function if exists public.top_scores(int, text, int);
--     -- danach top_scores() und score_counts() aus Abschnitt 5/5b anlegen
--     -- und die grants aus Abschnitt 6 erneut setzen.
--
--   Das `drop` ist nötig, weil sich die Rückgabespalten ändern – `create or
--   replace` allein reicht dafür in Postgres nicht. Die anschließend erzeugte
--   Funktion hat vier Parameter, der vierte mit Default; ein alter Client, der
--   nur p_size/p_difficulty/p_limit schickt, wird von PostgREST weiterhin
--   korrekt aufgelöst und läuft unverändert.
--
--   Solange diese Migration NICHT gelaufen ist, verhält sich das Spiel wie
--   bisher: kein Alter an den Zeilen (created_at fehlt in der Antwort), keine
--   Zeitwertung (score_counts antwortet 404, und die Oberfläche bietet den
--   Reiter dann gar nicht erst an). Beides fällt still zurück, nichts bricht.
--
--   2026-08: Gleichstand überholt nicht mehr. submit_score() zählt den Rang
--   jetzt in derselben Reihenfolge, die top_scores ausgibt (Score, Zeit, Alter);
--   vorher landete ein neuer Eintrag bei exaktem Gleichstand VOR dem älteren,
--   sodass gemeldeter Rang und Listenposition um eine Zeile auseinanderfielen.
--   Nur die Funktion erneut ausführen (Abschnitt 4) – kein drop nötig, die
--   Signatur bleibt gleich, Daten werden nicht angefasst. Ohne diese Migration
--   markiert die Oberfläche trotzdem die richtige Zeile (sie verlässt sich nicht
--   mehr auf den Rang); nur die Statuszeile kann bei Gleichstand einen Platz zu
--   gut anzeigen.
