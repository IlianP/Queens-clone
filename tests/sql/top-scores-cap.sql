-- Does the global list cap each player fairly, and only the list?
--
-- top_scores() shows each player at most per_player = ceil(p_limit / players)
-- of their best rows, counted over the same slice it shows (bucket, and the
-- p_since window when given). What this pins, none of it visible from the
-- client side:
--
--   1. The motivating case: one enthusiast with 34 rows among three players no
--      longer fills the list — 17 each at most, and the others move up.
--   2. The cap is per PLAYER with player_rank()'s key: case/whitespace variants
--      of a name are one player, anonymous rows are never merged or capped.
--   3. It is dynamic: 50+ players means one row each, one player means no cap.
--   4. The window gets its own cap from the players inside it.
--   5. It is display only: every row stays in the table, a capped player's
--      shown rows are exactly their best ones, and `hidden` says how many
--      rows the cap is holding back.
--   6. The visible rows keep the list's total order.
--
-- ⚠ Run this against a THROWAWAY local database only. It TRUNCATES
-- public.scores. Never point it at the live project. Setup as in the header of
-- tests/sql/rank-order.sql, then from the repo root:
--
--   psql -h "$PGDIR" -p 5433 -U postgres -f tests/sql/top-scores-cap.sql
--
-- Nothing here runs in CI — there is no database there.

\set ON_ERROR_STOP on
\pset footer off

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;

\i docs/leaderboard-setup.sql

truncate public.scores;

-- Rows are inserted directly: submit_score() has a per-client rate limit, and
-- what is under test is the read, not the write. Seconds rise with i so every
-- row has a distinct, predictable place.
create or replace function pg_temp.put(p_name text, p_size int, p_diff text, p_sec int,
                                       p_at timestamptz default now())
returns void language sql as $$
  insert into public.scores (name, size, difficulty, seconds, hints, mistakes, score, client_key, created_at)
  values (p_name, p_size, p_diff, p_sec, 0, 0, p_sec, 'test', p_at);
$$;

do $$
declare
  v record;
  n int;
  bad int := 0;
begin
  -- 1) The measured shape: 34 + 5 + 2 rows from three players, 50 places.
  for i in 1..34 loop perform pg_temp.put('Viel', 8, 'hard', 100 + i); end loop;
  for i in 1..5  loop perform pg_temp.put('Mittel', 8, 'hard', 110 + 3 * i); end loop;
  for i in 1..2  loop perform pg_temp.put('Neu', 8, 'hard', 140 + i); end loop;

  select count(*) as rows, min(per_player) as lo, max(per_player) as hi
    into v from public.top_scores(8, 'hard', 50);
  if v.rows <> 24 or v.lo <> 17 or v.hi <> 17 then
    raise warning '1) expected 24 rows at per_player 17, got % rows at %..%', v.rows, v.lo, v.hi; bad := bad + 1;
  end if;
  if (select min(hidden) from public.top_scores(8, 'hard', 50)) <> 17 then
    raise warning '1) hidden should be 34 - 17 = 17'; bad := bad + 1;
  end if;
  select count(*) into n from public.top_scores(8, 'hard', 50) where name = 'Viel';
  if n <> 17 then raise warning '1) Viel should show 17 rows, shows %', n; bad := bad + 1; end if;
  select count(*) into n from public.top_scores(8, 'hard', 50) where name = 'Neu';
  if n <> 2 then raise warning '1) Neu should keep both rows, shows %', n; bad := bad + 1; end if;

  -- 5) The shown rows are Viel's BEST 17 (101..117), and nothing was deleted.
  if (select max(seconds) from public.top_scores(8, 'hard', 50) where name = 'Viel') <> 117 then
    raise warning '5) Viel''s shown rows are not their best 17'; bad := bad + 1;
  end if;
  if (select count(*) from public.scores where size = 8 and difficulty = 'hard') <> 41 then
    raise warning '5) the cap deleted rows'; bad := bad + 1;
  end if;

  -- 6) Visible rows keep the total order (score, seconds, created_at, id).
  if exists (
    select 1 from (
      select score, lag(score) over (order by ord) as prev
        from (select score, row_number() over () as ord from public.top_scores(8, 'hard', 50)) q
    ) z where prev > score) then
    raise warning '6) visible rows are out of order'; bad := bad + 1;
  end if;

  -- 2) One player regardless of case and whitespace.
  truncate public.scores;
  for i in 1..10 loop perform pg_temp.put(case when i % 2 = 0 then 'Anna' else '  anna ' end, 8, 'hard', 100 + i); end loop;
  for i in 1..10 loop perform pg_temp.put('Ben', 8, 'hard', 200 + i); end loop;
  -- two players, 10 places -> 5 each; Anna's variants must share one cap
  select count(*) into n from public.top_scores(8, 'hard', 10) where lower(btrim(name)) = 'anna';
  if n <> 5 then raise warning '2) Anna + anna should share one cap of 5, shows %', n; bad := bad + 1; end if;

  -- 2) Anonymous rows: each its own player, never capped away.
  truncate public.scores;
  for i in 1..30 loop perform pg_temp.put('', 8, 'hard', 100 + i); end loop;
  for i in 1..20 loop perform pg_temp.put('Viel', 8, 'hard', 50 + i); end loop;
  -- 31 players, 50 places -> ceil(50/31) = 2 per player
  select min(per_player) into n from public.top_scores(8, 'hard', 50);
  if n <> 2 then raise warning '2) 31 players on 50 places should cap at 2, got %', n; bad := bad + 1; end if;
  select count(*) into n from public.top_scores(8, 'hard', 50) where name = '';
  if n <> 30 then raise warning '2) all 30 anonymous rows should show, % do', n; bad := bad + 1; end if;
  select count(*) into n from public.top_scores(8, 'hard', 50) where name = 'Viel';
  if n <> 2 then raise warning '2) Viel should be capped to 2, shows %', n; bad := bad + 1; end if;

  -- 3) Dynamic: 60 players -> one row each; a lone player -> no cap at all.
  truncate public.scores;
  for p in 1..60 loop
    perform pg_temp.put('P' || p, 8, 'hard', 100 + p);
    perform pg_temp.put('P' || p, 8, 'hard', 300 + p);
  end loop;
  select count(*) as rows, min(per_player) as cap, count(distinct name) as players
    into v from public.top_scores(8, 'hard', 50);
  if v.cap <> 1 or v.rows <> 50 or v.players <> 50 then
    raise warning '3) 60 players: expected 50 rows from 50 players at cap 1, got % rows / % players at cap %', v.rows, v.players, v.cap; bad := bad + 1;
  end if;
  truncate public.scores;
  for i in 1..40 loop perform pg_temp.put('Allein', 8, 'hard', 100 + i); end loop;
  select count(*) as rows, min(per_player) as cap, min(hidden) as held
    into v from public.top_scores(8, 'hard', 50);
  if v.rows <> 40 or v.cap <> 50 or v.held <> 0 then
    raise warning '3) a lone player should show all 40 rows uncapped, got % at cap %, hidden %', v.rows, v.cap, v.held; bad := bad + 1;
  end if;

  -- 4) The window counts its own players.
  truncate public.scores;
  for i in 1..20 loop perform pg_temp.put('Alt', 8, 'hard', 100 + i, now() - interval '200 days'); end loop;
  for i in 1..20 loop perform pg_temp.put('Jetzt', 8, 'hard', 150 + i); end loop;
  -- all time: 2 players on 10 places -> 5 each; last 90 days: only Jetzt -> 10
  select min(per_player) into n from public.top_scores(8, 'hard', 10);
  if n <> 5 then raise warning '4) all-time cap should be 5, got %', n; bad := bad + 1; end if;
  select min(per_player) into n from public.top_scores(8, 'hard', 10, now() - interval '90 days');
  if n <> 10 then raise warning '4) window cap should be 10 (one player inside), got %', n; bad := bad + 1; end if;

  -- An empty bucket answers with no rows, not an error.
  select count(*) into n from public.top_scores(14, 'hard', 50);
  if n <> 0 then raise warning 'empty bucket returned % rows', n; bad := bad + 1; end if;

  if bad > 0 then raise exception 'top-scores-cap: % check(s) failed', bad; end if;
  raise notice 'top-scores-cap: all checks passed';
end $$;
