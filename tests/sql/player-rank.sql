-- Zählt der Rang Spieler – und zählt er sie richtig?
--
-- player_rank() (Abschnitt 5c von docs/leaderboard-setup.sql) beantwortet "der
-- wievielte SPIELER bin ich?", während top_scores() weiterhin jede eingereichte
-- Partie ausgibt. Beide müssen sich bei der einen Frage einig sein, bei der das
-- Projekt schon einmal danebenlag: dem Gleichstand. Wer gleichzieht, überholt
-- nicht – auch auf Spieler-Ebene nicht.
--
-- Geprüft wird hier ausserdem alles, was am Spieler-Schlüssel schiefgehen kann:
-- Gross-/Kleinschreibung, Leerraum, und vor allem, dass LEERE Namen NICHT
-- zusammenfallen (sonst wäre jede anonyme Einreichung weltweit derselbe
-- "Spieler").
--
-- ⚠ Nur gegen eine WEGWERF-Datenbank laufen lassen. Die Datei TRUNCATED
-- public.scores. Niemals auf das Live-Supabase-Projekt richten.
--
--   export PGBIN=/usr/lib/postgresql/16/bin PGDIR=$(mktemp -d)
--   useradd -m pgtest; chown pgtest "$PGDIR"
--   su pgtest -c "$PGBIN/initdb -D $PGDIR/db -A trust -U postgres"
--   su pgtest -c "$PGBIN/pg_ctl -D $PGDIR/db -o '-k $PGDIR -p 5433 -c listen_addresses=' -w start"
--   psql -h "$PGDIR" -p 5433 -U postgres -f docs/leaderboard-setup.sql   # zuerst
--   psql -h "$PGDIR" -p 5433 -U postgres -f tests/sql/player-rank.sql    # aus dem Repo-Wurzelverzeichnis
--
-- Läuft wie tests/sql/rank-order.sql NICHT in CI – dort gibt es keine Datenbank.

\set ON_ERROR_STOP on
\pset footer off

truncate public.scores;

-- Prüfhelfer: vergleicht (rank, total, is_best) mit der Erwartung.
create or replace function pg_temp.expect(
  p_label text, p_size int, p_difficulty text, p_name text,
  p_score int, p_seconds int,
  p_rank bigint, p_total bigint, p_is_best boolean
) returns void language plpgsql as $$
declare r record;
begin
  select * into r from public.player_rank(p_size, p_difficulty, p_name, p_score, p_seconds);
  if not found then
    raise exception '% : player_rank lieferte KEINE Zeile (erwartet %/%)', p_label, p_rank, p_total;
  end if;
  if r.rank <> p_rank or r.total <> p_total or r.is_best is distinct from p_is_best then
    raise exception '% : erwartet rank=% total=% is_best=% – bekommen rank=% total=% is_best=%',
      p_label, p_rank, p_total, p_is_best, r.rank, r.total, r.is_best;
  end if;
  raise notice 'ok  %', p_label;
end $$;

-- Ein Einfügehelfer, der created_at kontrolliert (die Ordnung hängt daran)
-- und die id der neuen Zeile zurückgibt.
create or replace function pg_temp.add(
  p_name text, p_size int, p_difficulty text, p_seconds int, p_min int,
  p_submission_id uuid default null
) returns bigint language sql as $$
  insert into public.scores (name, size, difficulty, seconds, hints, mistakes, score, created_at, submission_id)
  values (p_name, p_size, p_difficulty, p_seconds, 0, 0,
          public.queens_score(p_seconds, 0, 0),
          timestamptz '2026-01-01 00:00:00+00' + (p_min || ' minutes')::interval,
          p_submission_id)
  returning id;
$$;

-- ---------------------------------------------------------------------------
-- 1) Der reale Fall: 8x8 schwer, wenige Namen, viele Einträge.
--    Goose spielt sechsmal, IlianP dreimal, D genau einmal.
-- ---------------------------------------------------------------------------
select pg_temp.add('Goose',  8, 'hard',  5,  10);
select pg_temp.add('Goose',  8, 'hard',  9,  20);
select pg_temp.add('Goose',  8, 'hard', 10,  30);
select pg_temp.add('Goose',  8, 'hard', 12,  40);
select pg_temp.add('Goose',  8, 'hard', 14,  50);
select pg_temp.add('Goose',  8, 'hard', 18,  60);
select pg_temp.add('IlianP', 8, 'hard',  7,  70);
select pg_temp.add('IlianP', 8, 'hard', 11,  80);
select pg_temp.add('IlianP', 8, 'hard', 16,  90);
select pg_temp.add('D',      8, 'hard', 15, 100);

-- Die Liste ist zehn Zeilen lang, das Feld aber drei Spieler gross.
do $$ begin
  if (select count(*) from public.top_scores(8, 'hard', 50)) <> 10 then
    raise exception 'top_scores soll weiterhin JEDE Partie zeigen (10 Zeilen)';
  end if;
end $$;

-- D ist Letzter – aber Dritter von drei, nicht 8. von 10.
select pg_temp.expect('D: Letzter von drei Spielern',
                      8, 'hard', 'D', 15, 15, 3, 3, true);
-- Ein Lauf, der schlechter als die eigene Bestzeit ist, ändert den Platz nicht
-- und meldet sich als "nicht die Bestzeit".
select pg_temp.expect('Goose: schlechterer Lauf, Platz bleibt, is_best=false',
                      8, 'hard', 'Goose', 18, 18, 1, 3, false);
select pg_temp.expect('Goose: die Bestzeit selbst, is_best=true',
                      8, 'hard', 'Goose', 5, 5, 1, 3, true);
select pg_temp.expect('IlianP: Zweiter von drei',
                      8, 'hard', 'IlianP', 7, 7, 2, 3, true);

-- ---------------------------------------------------------------------------
-- 2) Der Schlüssel normalisiert: Gross-/Kleinschreibung und Leerraum.
-- ---------------------------------------------------------------------------
select pg_temp.expect('Schreibweise egal ("goose")',
                      8, 'hard', 'goose', 5, 5, 1, 3, true);
select pg_temp.expect('Leerraum egal ("  GOOSE  ")',
                      8, 'hard', '  GOOSE  ', 5, 5, 1, 3, true);

-- ---------------------------------------------------------------------------
-- 3) Gleichstand überholt nicht – auch nicht zwischen Spielern.
--    Zwei Spieler mit exakt derselben Bestzeit bekommen VERSCHIEDENE Plätze,
--    und der ältere Eintrag steht vorn. (Vorher bekamen beide denselben Platz
--    und Platz 1 blieb unbesetzt.)
-- ---------------------------------------------------------------------------
select pg_temp.add('Alt', 9, 'medium', 20, 10);
select pg_temp.add('Neu', 9, 'medium', 20, 20);
select pg_temp.expect('Gleichstand: der ältere Spieler steht vorn',
                      9, 'medium', 'Alt', 20, 20, 1, 2, true);
select pg_temp.expect('Gleichstand: der jüngere überholt nicht',
                      9, 'medium', 'Neu', 20, 20, 2, 2, true);

-- ---------------------------------------------------------------------------
-- 4) Leere Namen fallen NICHT zusammen. Drei anonyme Einreichungen sind drei
--    Spieler, nicht einer – sonst wäre "anonym" ein globaler Sammel-Account.
-- ---------------------------------------------------------------------------
select pg_temp.add('',    10, 'hard', 30, 10);
select pg_temp.add('   ', 10, 'hard', 40, 20);
select pg_temp.add('',    10, 'hard', 50, 30);
select pg_temp.add('Ada', 10, 'hard', 45, 40);
select pg_temp.expect('anonym: drei anonyme + ein benannter Spieler = 4',
                      10, 'hard', '', 30, 30, 1, 4, true);
select pg_temp.expect('anonym: die mittlere anonyme Zeile',
                      10, 'hard', '', 50, 50, 4, 4, true);
select pg_temp.expect('anonym: benannter Spieler dazwischen',
                      10, 'hard', 'Ada', 45, 45, 3, 4, true);

-- ---------------------------------------------------------------------------
-- 5) Kennt die Funktion uns nicht, rät sie nicht: keine Zeile.
--    (Der Client fällt dann still auf die eintragsbasierte Anzeige zurück.)
-- ---------------------------------------------------------------------------
do $$ begin
  if exists (select 1 from public.player_rank(8, 'hard', 'NieDagewesen', 99, 99)) then
    raise exception 'unbekannter Spieler darf keine Zeile liefern';
  end if;
  if exists (select 1 from public.player_rank(7, 'easy', 'Goose', 5, 5)) then
    raise exception 'leerer Bucket darf keine Zeile liefern';
  end if;
  raise notice 'ok  unbekannter Spieler / leerer Bucket liefern nichts';
end $$;

-- ---------------------------------------------------------------------------
-- ---------------------------------------------------------------------------
-- 5b) Ein Name darf nicht im Namensraum der anonymen Zeilen landen.
--     `name` ist freier Text, also ist JEDES Präfix ein wählbarer Name. Der
--     erste Entwurf schlüsselte anonyme Zeilen als 'row:' || id – wer sich
--     "row:17" nannte, verschmolz mit der anonymen Zeile 17: `total` fiel um
--     eins, und die Bestzeit des anonymen Spielers wurde dem benannten
--     zugeschrieben (der dann seine eigene als "nicht die beste" gemeldet bekam).
--     Deshalb ist der Schlüssel heute ein Paar aus Kennzeichen und Text.
-- ---------------------------------------------------------------------------
do $$
declare v_anon bigint; v_name text; r record;
begin
  v_anon := pg_temp.add('',    11, 'hard', 20, 10);   -- anonym
  v_name := 'row:' || v_anon;                          -- ... und jemand heißt so
  perform pg_temp.add(v_name,  11, 'hard', 50, 20);
  perform pg_temp.add('Ada',   11, 'hard', 30, 30);

  select * into r from public.player_rank(11, 'hard', v_name, 50, 50);
  if r.total <> 3 then
    raise exception 'Namensraum-Kollision: total=% (erwartet 3, drei echte Spieler)', r.total;
  end if;
  if r.rank <> 3 or r.is_best is not true then
    raise exception 'Namensraum-Kollision: "%" bekam rank=% is_best=% (erwartet 3/true)',
      v_name, r.rank, r.is_best;
  end if;

  -- Und die anonyme Zeile bleibt ihr eigener Spieler.
  select * into r from public.player_rank(11, 'hard', '', 20, 20);
  if r.rank <> 1 or r.total <> 3 then
    raise exception 'anonyme Zeile verschmolzen: rank=%/% (erwartet 1/3)', r.rank, r.total;
  end if;
  raise notice 'ok  ein Name wie "row:<id>" verschmilzt nicht mit der anonymen Zeile';
end $$;

-- ---------------------------------------------------------------------------
-- 5c) Anonyme Einreichungen werden über die submission_id identifiziert, nicht
--     über "die jüngste Zeile mit diesem Wert". Sonst entscheidet Timing: reicht
--     ein zweiter anonymer Client zwischen submit_score und player_rank denselben
--     Wert ein, bekommt der erste den Rang der fremden Zeile.
-- ---------------------------------------------------------------------------
do $$
declare v_a uuid := gen_random_uuid(); v_b uuid := gen_random_uuid(); r record;
begin
  perform pg_temp.add('',    12, 'hard', 25, 10, v_a);  -- A, älter
  perform pg_temp.add('',    12, 'hard', 25, 20, v_b);  -- B, jünger, gleicher Wert
  perform pg_temp.add('Ada', 12, 'hard', 10, 30);

  select * into r from public.player_rank(12, 'hard', '', 25, 25, v_a);
  if r.rank <> 2 or r.total <> 3 then
    raise exception 'A bekam rank=%/% (erwartet 2/3 – das ist SEINE Zeile, die ältere)', r.rank, r.total;
  end if;
  select * into r from public.player_rank(12, 'hard', '', 25, 25, v_b);
  if r.rank <> 3 or r.total <> 3 then
    raise exception 'B bekam rank=%/% (erwartet 3/3)', r.rank, r.total;
  end if;

  -- Ohne id bleibt nur die Heuristik: sie greift weiter (alte Clients, Altdaten),
  -- trifft aber eben die jüngste passende Zeile. Bewusst so, und hier festgehalten.
  select * into r from public.player_rank(12, 'hard', '', 25, 25);
  if r.rank <> 3 then
    raise exception 'Heuristik ohne id: rank=% (erwartet 3, die jüngste passende Zeile)', r.rank;
  end if;

  -- Eine unbekannte id ist kein Grund zu raten.
  if exists (select 1 from public.player_rank(12, 'hard', '', 25, 25, gen_random_uuid())) then
    raise exception 'unbekannte submission_id darf keine Zeile liefern';
  end if;
  raise notice 'ok  anonyme Einreichungen werden über die submission_id identifiziert';
end $$;

-- 6) Gegenprobe auf ANDEREM Weg: der Rang eines Spielers muss die Position
--    seiner besten Zeile in der nach derselben Ordnung sortierten Liste der
--    Spieler-Bestzeilen sein. Hier über eine Fensterfunktion hergeleitet,
--    also ohne Code mit player_rank zu teilen – wie tests/logic/qr-code.mjs
--    den QR-Code liest statt ihn nachzubauen.
-- ---------------------------------------------------------------------------
do $$
declare r record; v record;
begin
  for r in
    with bucket as (
      -- Derselbe zweiteilige Schlüssel wie in der Funktion: das Anonym-Kennzeichen
      -- ist eine eigene Spalte, kein Präfix im Text. Ein Bucket unten enthält
      -- absichtlich einen Spieler, der sich nach einer Zeilen-id benennt – mit
      -- einem Text-Präfix würde diese Gegenprobe denselben Fehler machen wie die
      -- Funktion und ihn dadurch bestätigen statt aufdecken.
      select s.id, s.size, s.difficulty, s.score, s.seconds, s.created_at, s.name,
             btrim(s.name) = '' as anon,
             case when btrim(s.name) = '' then s.id::text
                  else lower(btrim(s.name)) end as pkey
        from public.scores s
    ),
    best as (
      select distinct on (b.size, b.difficulty, b.anon, b.pkey)
             b.size, b.difficulty, b.anon, b.pkey, b.name, b.score, b.seconds, b.created_at, b.id
        from bucket b
       order by b.size, b.difficulty, b.anon, b.pkey, b.score, b.seconds, b.created_at, b.id
    ),
    ranked as (
      -- Das Fenster muss ALLE Spieler sehen (auch die anonymen), sonst zählt es
      -- ein zurechtgeschnittenes Feld. Gefiltert wird deshalb erst danach.
      select b.size, b.difficulty, b.name, b.score, b.seconds,
             row_number() over (partition by b.size, b.difficulty
                                order by b.score, b.seconds, b.created_at, b.id) as pos,
             count(*)     over (partition by b.size, b.difficulty)               as field
        from best b
    )
    select q.size, q.difficulty, q.name, q.score, q.seconds, q.pos, q.field
      from ranked q
     where btrim(q.name) <> ''
  loop
    select * into v from public.player_rank(r.size, r.difficulty, r.name, r.score, r.seconds);
    if v.rank <> r.pos or v.total <> r.field then
      raise exception '% %x% : rank=%/% erwartet=%/%',
        r.name, r.size, r.difficulty, v.rank, v.total, r.pos, r.field;
    end if;
  end loop;
  raise notice 'ok  Rang und Feldgrösse stimmen mit der sortierten Bestenliste überein';
end $$;

select 'ALLE PRÜFUNGEN BESTANDEN' as result;
