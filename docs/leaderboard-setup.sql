-- Queens-clone – Einrichtung der optionalen globalen Rangliste (Supabase / Postgres)
-- =============================================================================
-- Einmalig im Supabase-Dashboard unter "SQL Editor" ausführen. Danach in
-- js/leaderboard.js SUPABASE_URL und den öffentlichen anon-Key eintragen.
--
-- Sicherheitsmodell:
--   * Row Level Security ist an, die Tabelle hat KEINE Schreib-Policy und wird
--     nicht direkt gelesen. Schreiben und Lesen laufen ausschließlich über die
--     beiden SECURITY-DEFINER-Funktionen unten, die als Eigentümer laufen und
--     nur unbedenkliche Spalten zurückgeben (nie die IP).
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
  values (v_name, p_size, p_difficulty, p_seconds, coalesce(p_hints, 0), coalesce(p_mistakes, 0), v_score, v_key);

  return query
    with bucket as (
      select s.score, s.seconds from public.scores s
        where s.size = p_size and s.difficulty = p_difficulty
    )
    select (select count(*) + 1 from bucket b
              where b.score < v_score or (b.score = v_score and b.seconds < p_seconds))::bigint,
           (select count(*) from bucket)::bigint;
end;
$$;

-- 5) Bestenliste lesen (nur unbedenkliche Spalten, best-first) -----------------
create or replace function public.top_scores(p_size int, p_difficulty text, p_limit int default 10)
  returns table (name text, seconds int, hints int, mistakes int, score int)
  language sql security definer set search_path = public stable as $$
  select s.name, s.seconds, s.hints, s.mistakes, s.score
    from public.scores s
    where s.size = p_size and s.difficulty = p_difficulty
    order by s.score asc, s.seconds asc, s.created_at asc
    limit least(greatest(coalesce(p_limit, 10), 1), 100);
$$;

-- 6) Ausführrechte nur für die beiden Funktionen ------------------------------
grant execute on function public.submit_score(text, int, text, int, int, int) to anon;
grant execute on function public.top_scores(int, text, int) to anon;

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
