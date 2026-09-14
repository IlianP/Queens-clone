-- Does the server hand out the same order the list shows?
--
-- submit_score() reports a rank and top_scores() renders the list. They are two
-- separate pieces of SQL, and when they disagree about ONE case — an exact tie —
-- the win screen outlines the wrong row: the reported rank pointed at the first
-- entry of a tied run while the list put the fresh one at its end. This checks
-- that every submit's reported rank equals the row's real position, ties and
-- duplicate submissions included.
--
-- ⚠ Run this against a THROWAWAY local database only. It TRUNCATES public.scores.
-- Never point it at the live Supabase project.
--
--   export PGBIN=/usr/lib/postgresql/16/bin PGDIR=$(mktemp -d)
--   useradd -m pgtest; chown pgtest "$PGDIR"
--   su pgtest -c "$PGBIN/initdb -D $PGDIR/db -A trust -U postgres"
--   su pgtest -c "$PGBIN/pg_ctl -D $PGDIR/db -o '-k $PGDIR -p 5433 -c listen_addresses=' -w start"
--   psql -h "$PGDIR" -p 5433 -U postgres -f tests/sql/rank-order.sql   # from the repo root
--
-- Supabase supplies the `anon` / `authenticated` / `service_role` roles that the
-- setup file grants to; a bare Postgres doesn't, so create them first (below). Nothing here
-- runs in CI — there is no database there, exactly like Playwright for
-- tests/browser/.

\set ON_ERROR_STOP on
\pset footer off

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  -- service_role reads the tables for tools/weekly-report.mjs (sections 7/8 of
  -- the setup file grant to it), so a bare Postgres needs it too or the file
  -- fails on the grant rather than on anything this test is about.
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;

-- The file under test, applied exactly as the project owner would apply it.
\i docs/leaderboard-setup.sql

truncate public.scores;

do $$
declare
  r      record;
  v_rank bigint;
  v_pos  bigint;
  bad    int := 0;
begin
  -- Deliberately full of collisions: two players on the same score, the same
  -- player submitting an identical solve twice, and a tie on the worst score.
  for r in select * from (values
      ('Alt', 100), ('Schnell', 60), ('Gleich', 100), ('Langsam', 200), ('Ich', 100),
      ('Ich', 100), ('Ich', 60), ('Neu', 45), ('Gleich', 200)) as t(n, s)
  loop
    select rank into v_rank from submit_score(r.n, 9, 'hard', r.s, 0, 0);
    -- Our row is the LAST one carrying these values: top_scores orders ties
    -- oldest-first and this insert is the newest. That is the same rule
    -- matchOwnEntry applies on the client (js/highscores.js).
    select max(pos) into v_pos from (
      select row_number() over () as pos, name, score from top_scores(9, 'hard', 100)) q
      where q.name = r.n and q.score = r.s;
    if v_rank is distinct from v_pos then
      bad := bad + 1;
      raise notice 'MISMATCH % (%s): reported rank % but list position %', r.n, r.s, v_rank, v_pos;
    end if;
  end loop;
  if bad > 0 then
    raise exception 'rank-order: % of 9 submits disagree with the list', bad;
  end if;
  raise notice 'ok: reported rank == list position for all 9 submits (ties included)';
end $$;

-- The time window: score_counts must agree with what the windowed list returns.
update public.scores set created_at = now() - interval '200 days'
  where name in ('Alt', 'Schnell');

do $$
declare v_total bigint; v_recent bigint; v_rows bigint;
begin
  select total, recent into v_total, v_recent
    from score_counts(9, 'hard', now() - interval '90 days');
  select count(*) into v_rows from top_scores(9, 'hard', 100, now() - interval '90 days');
  if v_recent is distinct from v_rows then
    raise exception 'score_counts says % inside the window, top_scores returns %', v_recent, v_rows;
  end if;
  if v_total <> 9 or v_recent <> 7 then
    raise exception 'unexpected counts: total=% recent=% (want 9 / 7)', v_total, v_recent;
  end if;
  -- An all-time call must still see everything.
  select count(*) into v_rows from top_scores(9, 'hard', 100);
  if v_rows <> v_total then
    raise exception 'all-time list has % rows but score_counts says %', v_rows, v_total;
  end if;
  raise notice 'ok: score_counts and the windowed list agree (% of % inside 90 days)', v_recent, v_total;
end $$;

-- Re-running the setup file must stay safe on a populated database.
\i docs/leaderboard-setup.sql

do $$
declare v_rows bigint;
begin
  select count(*) into v_rows from public.scores;
  if v_rows <> 9 then raise exception 're-running the setup file lost rows: % left', v_rows; end if;
  raise notice 'ok: the setup file is repeatable, all 9 rows survived';
end $$;

-- The same key represents one solved game, even if its response was lost.
do $$
declare v_first record; v_second record; v_rows bigint;
  v_key uuid := '7a39bfa2-9518-4c87-a861-1fb394b8cf4d';
begin
  select rank, total into v_first from submit_score('Einmal', 8, 'easy', 77, 0, 0, v_key);
  select rank, total into v_second from submit_score('Einmal', 8, 'easy', 77, 0, 0, v_key);
  select count(*) into v_rows from public.scores where submission_id = v_key;
  if v_rows <> 1 then raise exception 'idempotency failed: same key created % rows', v_rows; end if;
  if v_first.rank is distinct from v_second.rank or v_first.total is distinct from v_second.total then
    raise exception 'idempotency failed: retry returned different rank or total';
  end if;
  raise notice 'ok: repeated idempotency key leaves one row and returns its rank';
end $$;

-- Fehler kosten keine Zeit mehr, und Bestandszeilen werden mitgezogen.
-- Der zweite Teil ist der eigentliche Punkt: die Rohwerte liegen einzeln in der
-- Tabelle, also lässt sich eine unter der alten Formel eingetragene Zeile exakt
-- zurückrechnen — hier simuliert durch eine von Hand auf den alten Wert
-- gesetzte Zeile, die das erneute Ausführen der Datei reparieren muss.
do $$
declare v_clean int; v_sloppy int; v_id bigint; v_score int;
begin
  perform submit_score('Sauber', 10, 'hard', 120, 1, 0);
  perform submit_score('Patzer', 10, 'hard', 120, 1, 7);
  select score into v_clean  from public.scores where name = 'Sauber' and size = 10;
  select score into v_sloppy from public.scores where name = 'Patzer' and size = 10;
  if v_clean <> 150 then raise exception 'hint penalty changed: expected 150, got %', v_clean; end if;
  if v_sloppy <> v_clean then
    raise exception 'mistakes still cost time: % vs %', v_sloppy, v_clean;
  end if;

  select id into v_id from public.scores where name = 'Patzer' and size = 10;
  update public.scores set score = 255 where id = v_id; -- 120 + 30 + 15*7, die alte Formel
end $$;

\i docs/leaderboard-setup.sql

do $$
declare v_score int; v_mistakes int; v_rows bigint;
begin
  select score, mistakes into v_score, v_mistakes
    from public.scores where name = 'Patzer' and size = 10;
  if v_score <> 150 then
    raise exception 'backfill did not recompute the old row: got %', v_score;
  end if;
  if v_mistakes <> 7 then
    raise exception 'backfill lost the raw mistake count: got %', v_mistakes;
  end if;
  select count(*) into v_rows from public.scores;
  if v_rows <> 12 then raise exception 'backfill changed the row count: % left', v_rows; end if;
  raise notice 'ok: mistakes are counted but unpenalised, and old rows are recomputed';
end $$;
