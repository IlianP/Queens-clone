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
-- Supabase supplies the `anon` / `authenticated` roles that the setup file
-- grants to; a bare Postgres doesn't, so create them first (below). Nothing here
-- runs in CI — there is no database there, exactly like Playwright for
-- tests/browser/.

\set ON_ERROR_STOP on
\pset footer off

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
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
