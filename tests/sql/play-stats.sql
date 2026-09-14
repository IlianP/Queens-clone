-- Do the anonymous play counters count what they claim, and nothing else?
--
-- bump_stat() is the one function in this project that `anon` may call freely
-- and that WRITES. It is also the only place where test traffic is separated
-- from real play. Three things therefore have to hold, and none of them is
-- visible from the client side:
--
--   1. Only valid input reaches the table. Invalid input is dropped SILENTLY
--      (the client is fire-and-forget and can't act on an error), so a bug here
--      would look exactly like a quiet success — hence the explicit assertions.
--   2. Sources stay apart. A 'test' bump must never land in the 'web' row; the
--      whole point is that a Playwright run doesn't read as somebody playing.
--   3. The rate limit bites. bump_stat is open to anon, so without a brake a
--      loop could inflate the weekly report at will.
--
-- ⚠ Run this against a THROWAWAY local database only. It TRUNCATES
-- public.play_stats and public.stat_limits. Never point it at the live project.
--
--   export PGBIN=/usr/lib/postgresql/16/bin PGDIR=$(mktemp -d)
--   useradd -m pgtest; chown pgtest "$PGDIR"
--   su pgtest -c "$PGBIN/initdb -D $PGDIR/db -A trust -U postgres"
--   su pgtest -c "$PGBIN/pg_ctl -D $PGDIR/db -o '-k $PGDIR -p 5433 -c listen_addresses=' -w start"
--   psql -h "$PGDIR" -p 5433 -U postgres -f tests/sql/play-stats.sql   # from the repo root
--
-- Nothing here runs in CI — there is no database there, exactly like Playwright
-- for tests/browser/.

\set ON_ERROR_STOP on
\pset footer off

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;

-- The file under test, applied exactly as the project owner would apply it.
\i docs/leaderboard-setup.sql

truncate public.play_stats;
truncate public.stat_limits;

-- 1) Valid bumps land, invalid ones vanish without a trace ---------------------
select public.bump_stat('app_open', 'web');
select public.bump_stat('game_start', 'web', 8, 'hard');
select public.bump_stat('game_start', 'web', 8, 'hard');
select public.bump_stat('game_win', 'web', 8, 'hard');
-- Every one of these is rejected inside the function:
select public.bump_stat('submit', 'web', 8, 'hard');          -- unknown kind
select public.bump_stat('game_start', 'production', 8, 'hard'); -- unknown source
select public.bump_stat('game_start', 'web', 99, 'hard');      -- size out of range
select public.bump_stat('game_start', 'web', 8, 'unmoeglich'); -- unknown difficulty

do $$
declare v_total bigint; v_rows bigint;
begin
  select coalesce(sum(count), 0), count(*) into v_total, v_rows from public.play_stats;
  if v_total <> 4 then
    raise exception 'FAIL: % bumps counted, expected 4 (invalid input got through)', v_total;
  end if;
  -- app_open + game_start + game_win, three distinct counter rows.
  if v_rows <> 3 then
    raise exception 'FAIL: % counter rows, expected 3', v_rows;
  end if;
  if not exists (select 1 from public.play_stats
                  where kind = 'game_start' and source = 'web' and size = 8
                    and difficulty = 'hard' and count = 2) then
    raise exception 'FAIL: repeated bumps do not accumulate into one row';
  end if;
  -- app_open is not board-specific and must not invent a size.
  if not exists (select 1 from public.play_stats
                  where kind = 'app_open' and size = 0 and difficulty = '') then
    raise exception 'FAIL: app_open is stored against a board';
  end if;
end $$;

-- 2) Test traffic is a different row, not a different number -------------------
select public.bump_stat('game_start', 'test', 8, 'hard');
select public.bump_stat('game_start', 'dev', 8, 'hard');

do $$
declare v_web bigint; v_test bigint; v_dev bigint;
begin
  select count into v_web from public.play_stats
    where kind = 'game_start' and source = 'web' and size = 8 and difficulty = 'hard';
  select count into v_test from public.play_stats
    where kind = 'game_start' and source = 'test' and size = 8 and difficulty = 'hard';
  select count into v_dev from public.play_stats
    where kind = 'game_start' and source = 'dev' and size = 8 and difficulty = 'hard';
  if v_web <> 2 or v_test <> 1 or v_dev <> 1 then
    raise exception 'FAIL: sources bled into each other (web=%, test=%, dev=%)', v_web, v_test, v_dev;
  end if;
end $$;

-- 3) anon may bump and may NOT read -------------------------------------------
-- The counters are for the owner's report, not for anyone who opens the page.
do $$
declare v_before bigint; v_after bigint;
begin
  select coalesce(sum(count), 0) into v_before from public.play_stats;
  set local role anon;
  perform public.bump_stat('game_win', 'web', 6, 'easy');
  reset role;
  select coalesce(sum(count), 0) into v_after from public.play_stats;
  if v_after <> v_before + 1 then
    raise exception 'FAIL: anon cannot bump a counter (% -> %)', v_before, v_after;
  end if;
end $$;

do $$
declare v_readable bigint;
begin
  set local role anon;
  select count(*) into v_readable from public.play_stats;
  reset role;
  raise exception 'FAIL: anon can read play_stats (% rows)', v_readable;
exception
  when insufficient_privilege then
    reset role; -- expected: no select grant for anon
end $$;

-- 4) The rate limit bites ------------------------------------------------------
-- 60 per client per minute. Over a unix socket inet_client_addr() is NULL, so
-- every call here shares one client_key — which is exactly the loop the limit
-- is meant to stop.
truncate public.play_stats;
truncate public.stat_limits;

do $$
declare v_total bigint; v_hits int;
begin
  for i in 1..80 loop perform public.bump_stat('app_open', 'web'); end loop;
  select coalesce(sum(count), 0) into v_total from public.play_stats;
  select hits into v_hits from public.stat_limits limit 1;
  if v_total <> 60 then
    raise exception 'FAIL: % bumps counted from 80 attempts, expected the 60/minute cap', v_total;
  end if;
  if v_hits < 80 then
    raise exception 'FAIL: the limiter stopped counting attempts at % ', v_hits;
  end if;
end $$;

-- 5) Re-running the setup file keeps the counters ------------------------------
-- Same promise section 3 makes for `scores`: the file is repeatable.
\i docs/leaderboard-setup.sql

do $$
declare v_total bigint;
begin
  select coalesce(sum(count), 0) into v_total from public.play_stats;
  if v_total <> 60 then
    raise exception 'FAIL: re-running the setup file changed the counters (now %)', v_total;
  end if;
end $$;

truncate public.play_stats;
truncate public.stat_limits;

\echo 'play-stats: all checks passed'
