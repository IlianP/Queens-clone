-- Do hints and "Prüfen" cost what the client says they cost?
--
-- Both surcharges are computed twice — hintPenalty()/checkPenalty()/
-- computeScore() in js/highscores.js and queens_hint_penalty()/
-- queens_check_penalty()/queens_score() here — and a drift between them would
-- put the global list out of step with the local one without any error. This
-- pins the server half: three seconds per row per hint and one per check; the
-- eight-argument submit_score stores and scores checks; the seven-argument call
-- (a solve without checks, which the client still sends exactly as before)
-- stores 0 and prices its hints by size too; the size-less three-argument
-- queens_score is gone; top_scores hands the count back; a re-run moves no
-- score; and the counter is range-checked like the others.
--
-- ⚠ Run this against a THROWAWAY local database only. It TRUNCATES public.scores.
-- Setup commands: see the header of tests/sql/rank-order.sql.

\set ON_ERROR_STOP on
\pset footer off

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;

\i docs/leaderboard-setup.sql

truncate public.scores;

do $$
declare
  v_score int; v_checks int; v_rows bigint; v_top record; v_failed boolean;
begin
  -- The penalty itself: one second per row.
  if public.queens_check_penalty(5) <> 5 or public.queens_check_penalty(14) <> 14 then
    raise exception 'check penalty is not one second per row';
  end if;
  if public.queens_score(100, 1, 3, 2, 8) <> 100 + 3 * 8 + 2 * 8 then
    raise exception 'five-argument queens_score: got %', public.queens_score(100, 1, 3, 2, 8);
  end if;
  -- The hint: three seconds per row, so 10×10 keeps the old flat 30 s.
  if public.queens_hint_penalty(5) <> 15 or public.queens_hint_penalty(10) <> 30
     or public.queens_hint_penalty(14) <> 42 then
    raise exception 'hint penalty is not three seconds per row';
  end if;
  -- The size-less three-argument form is gone: it could not price a hint.
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'queens_score' and p.pronargs = 3) then
    raise exception 'three-argument queens_score still exists';
  end if;

  -- With checks: 8×8, 40 s, one hint, three checks → 40 + 24 + 3·8 = 88.
  perform * from public.submit_score('Prüfer', 8, 'hard', 40, 1, 0,
                                     gen_random_uuid(), 3);
  select score, checks into v_score, v_checks from public.scores where name = 'Prüfer';
  if v_score <> 88 then raise exception 'checked submit scored %, expected 88', v_score; end if;
  if v_checks <> 3 then raise exception 'checked submit stored % checks', v_checks; end if;

  -- Without: the seven-argument call the client sends when no check was used.
  perform * from public.submit_score('Ohne', 8, 'hard', 120, 0, 0, gen_random_uuid());
  select score, checks into v_score, v_checks from public.scores where name = 'Ohne';
  if v_score <> 120 or v_checks <> 0 then
    raise exception 'unchecked submit: score %, checks %', v_score, v_checks;
  end if;

  -- The seven-argument call prices a hint by size too: 5×5, 20 s, one hint → 35.
  perform * from public.submit_score('Klein', 5, 'hard', 20, 1, 0, gen_random_uuid());
  select score into v_score from public.scores where name = 'Klein';
  if v_score <> 35 then raise exception 'seven-argument hint on 5×5 scored %, expected 35', v_score; end if;

  -- The list carries the count, so the row tooltip can spell the surcharge out.
  select * into v_top from public.top_scores(8, 'hard', 10) limit 1;
  if v_top.name <> 'Prüfer' or v_top.checks <> 3 or v_top.score <> 88 then
    raise exception 'top_scores row: % / % checks / %', v_top.name, v_top.checks, v_top.score;
  end if;

  -- Range check: a negative count is refused as 'bad counters'.
  v_failed := false;
  begin
    perform * from public.submit_score('Minus', 8, 'hard', 60, 0, 0, gen_random_uuid(), -1);
  exception when others then
    v_failed := sqlerrm = 'bad counters';
  end;
  if not v_failed then raise exception 'negative checks were accepted'; end if;

  select count(*) into v_rows from public.scores;
  if v_rows <> 3 then raise exception 'expected 3 rows, found %', v_rows; end if;
end $$;

-- Re-running the file must not move any score (the backfill in section 3 is a
-- no-op for rows that already match).
\i docs/leaderboard-setup.sql

do $$
declare v_score int;
begin
  select score into v_score from public.scores where name = 'Prüfer';
  if v_score <> 88 then raise exception 're-run changed the checked row to %', v_score; end if;
  raise notice 'check-penalty: all checks passed';
end $$;
