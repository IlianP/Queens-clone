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
  score          int         not null,
  client_key     text,
  submission_id  uuid
);

-- Nullable keeps historical rows untouched; new clients provide a UUID.
alter table public.scores add column if not exists submission_id uuid;

create index if not exists scores_bucket_idx
  on public.scores (size, difficulty, score, seconds);
create index if not exists scores_ratelimit_idx
  on public.scores (client_key, created_at);
-- One solved game can own this UUID only once; historical rows have no key.
create unique index if not exists scores_submission_id_unique
  on public.scores (submission_id) where submission_id is not null;
-- Für die zeitlich begrenzte Bestenliste ("letzte N Tage"): der Bucket-Index
-- oben trägt den Zeitfilter nicht, weil created_at dort gar nicht vorkommt.
create index if not exists scores_recent_idx
  on public.scores (size, difficulty, created_at);

-- 2) Row Level Security: an, ohne Policy = kein Direktzugriff für anon ---------
alter table public.scores enable row level security;
revoke all on public.scores from anon, authenticated;

-- 3) Score-Formel – muss zu js/highscores.js passen ---------------------------
-- FEHLER WERDEN GEZÄHLT, ABER NICHT MEHR BESTRAFT. Der Aufschlag von 15 s je
-- Fehler bestrafte die Eingabe statt des Denkens: auf dem Handy ist ein Fehltipp
-- eine Daumenbreite weit weg, und eine falsche Dame kostet ohnehin Zeit (sie
-- muss bemerkt und zurückgenommen werden) – der Aufschlag kassierte also zweimal
-- für denselben Patzer. p_mistakes bleibt in der Signatur (und die Spalte
-- `mistakes` in der Tabelle): die Rohwerte werden weiter gespeichert und
-- angezeigt, nur ihr Gewicht ist 0. Die Signatur zu behalten heißt auch, dass
-- submit_score() unverändert aufgerufen werden kann.
create or replace function public.queens_score(p_seconds int, p_hints int, p_mistakes int)
  returns int language sql immutable as $$
  select p_seconds + 30 * p_hints;
$$;

-- Bestandsdaten auf die aktuelle Formel ziehen. Genau dafür liegen seconds,
-- hints und mistakes einzeln in der Tabelle: ein früher eingetragener Lauf mit
-- Fehlern war nie wirklich langsamer, er wurde nur schlechter gerechnet – und
-- das lässt sich exakt zurückrechnen, ohne dass jemand etwas neu spielen muss.
-- Idempotent (`is distinct from` schreibt nur, was abweicht), also bei jedem
-- erneuten Ausführen der Datei ein No-Op; created_at bleibt unberührt, die
-- Reihenfolge der Bestenliste ergibt sich danach aus den neuen Werten.
update public.scores
   set score = public.queens_score(seconds, hints, mistakes)
 where score is distinct from public.queens_score(seconds, hints, mistakes);

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
  if p_size < 5 or p_size > 14 then raise exception 'bad size'; end if;
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

-- 4b) Idempotent submit for current clients --------------------------------------
-- The original six-argument function remains for already-cached clients.
create or replace function public.submit_score(
  p_name text, p_size int, p_difficulty text,
  p_seconds int, p_hints int, p_mistakes int, p_submission_id uuid
) returns table (rank bigint, total bigint)
  language plpgsql security definer set search_path = public as $idempotent$
declare
  v_name text; v_score int; v_key text; v_recent int;
  v_id bigint; v_at timestamptz; v_size int; v_difficulty text; v_seconds int;
begin
  if p_submission_id is null then raise exception 'missing submission id'; end if;
  v_name := left(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), 20);
  if p_size < 5 or p_size > 14 then raise exception 'bad size'; end if;
  if p_difficulty not in ('easy', 'medium', 'hard') then raise exception 'bad difficulty'; end if;
  if p_seconds is null or p_seconds < queens_min_seconds(p_size) or p_seconds > 86400 then
    raise exception 'implausible time';
  end if;
  if coalesce(p_hints, 0) < 0 or coalesce(p_hints, 0) > 999
     or coalesce(p_mistakes, 0) < 0 or coalesce(p_mistakes, 0) > 9999 then
    raise exception 'bad counters';
  end if;

  -- A previous accepted key bypasses the rate limit and is returned as-is.
  select id, size, difficulty, score, seconds, created_at
    into v_id, v_size, v_difficulty, v_score, v_seconds, v_at
    from public.scores where submission_id = p_submission_id;

  if not found then
    v_key := md5(coalesce(host(inet_client_addr()), '') || '|' || current_date::text);
    select count(*) into v_recent from public.scores
      where client_key = v_key and created_at > now() - interval '1 minute';
    if v_recent >= 20 then raise exception 'rate limited'; end if;

    v_score := queens_score(p_seconds, coalesce(p_hints, 0), coalesce(p_mistakes, 0));
    v_size := p_size; v_difficulty := p_difficulty; v_seconds := p_seconds;
    insert into public.scores (name, size, difficulty, seconds, hints, mistakes, score, client_key, submission_id)
    values (v_name, v_size, v_difficulty, v_seconds, coalesce(p_hints, 0), coalesce(p_mistakes, 0), v_score, v_key, p_submission_id)
    on conflict (submission_id) where submission_id is not null do nothing
    returning id, created_at into v_id, v_at;

    -- A concurrent identical request may have won the unique-index race.
    if not found then
      select id, size, difficulty, score, seconds, created_at
        into v_id, v_size, v_difficulty, v_score, v_seconds, v_at
        from public.scores where submission_id = p_submission_id;
    end if;
  end if;

  return query
    with bucket as (
      select s.id, s.score, s.seconds, s.created_at from public.scores s
        where s.size = v_size and s.difficulty = v_difficulty
    )
    select (select count(*) + 1 from bucket b
              where (b.score, b.seconds, b.created_at, b.id)
                  < (v_score, v_seconds, v_at, v_id))::bigint,
           (select count(*) from bucket)::bigint;
end;
$idempotent$;

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

-- 5c) Rang auf SPIELER-Ebene statt auf Eintrags-Ebene --------------------------
-- WARUM ES DAS GIBT: `scores` hält eine Zeile je eingereichter Partie, und ein
-- Vielspieler erzeugt davon beliebig viele. Gemessen (8x8 schwer, September
-- 2026): 83 Einträge von DREI Namen, 34 der ersten 50 Plätze von einer Person.
-- "Platz 28 von 83" liest sich dann wie ein Feld aus 83 Menschen, obwohl der
-- Einreichende in Wahrheit Dritter von dreien ist – und das demotiviert genau
-- die neuen Spieler, die man halten möchte.
--
-- Diese Funktion beantwortet deshalb die andere Frage: "Der wievielte SPIELER
-- bin ich?" Sie ändert die Liste NICHT und löscht nichts – top_scores() gibt
-- weiterhin jede Zeile aus. Nur die Zahl daneben zählt ab jetzt Menschen.
--
-- SPIELER-SCHLÜSSEL: ein Paar aus einem Anonym-Kennzeichen und einem Text, NICHT
-- ein Text allein. Benannte Spieler gruppieren über (false, normalisierter Name),
-- namenlose Zeilen über (true, id) – jede für sich, denn sonst fielen sämtliche
-- anonymen Einreichungen aller Menschen weltweit in eine einzige Zeile zusammen.
--
-- Dass das Kennzeichen eine eigene Spalte ist und kein Präfix im Text, ist der
-- Punkt: ein früherer Entwurf schrieb 'row:' || id und ließ damit den Namen
-- "row:17" mit der anonymen Zeile 17 verschmelzen. Der Name ist freier Text,
-- also ist JEDES Präfix ein wählbarer Name – nachgewiesen wurden dabei ein um
-- eins zu kleines `total` und, schlimmer, die Bestzeit des anonymen Spielers,
-- die dem benannten zugeschrieben wurde. Ein Textraum, den Nutzereingaben
-- teilen, kann nicht sicher partitioniert werden; zwei Spalten können es.
--
-- Der Name ist im Übrigen nicht besetzt; wer einen fremden tippt, verschmilzt
-- mit ihm. Das nimmt niemandem etwas (es verschenkt nur den eigenen Platz) und
-- ist der Preis dafür, ohne eine persistente Gerätekennung auszukommen.
--
-- WELCHE ZEILE SIND WIR? Mit Namen: unsere beste. Ohne Namen gibt es keinen
-- Schlüssel, unter dem man uns suchen könnte – deshalb nennt der Client die
-- submission_id, die submit_score() ohnehin schon führt, und wir lesen genau
-- diese Zeile. Die frühere Heuristik "die jüngste namenlose Zeile mit diesem
-- Wert" war angreifbar durch schlichtes Timing: reicht ein zweiter anonymer
-- Client zwischen submit_score und player_rank denselben Wert ein, bekommt der
-- erste den Rang der fremden Zeile. Die Heuristik bleibt nur für Clients ohne
-- submission_id (die alte Sechs-Parameter-Variante von submit_score) übrig.
--
-- GLEICHSTAND: exakt dieselbe totale Ordnung wie submit_score() und
-- top_scores() – Score, dann Zeit, dann Alter, dann id. Wer gleichzieht,
-- überholt also nicht, und zwei Spieler mit identischer Bestzeit bekommen
-- verschiedene Plätze (der ältere Eintrag steht vorn). Der Zeilenvergleich
-- unten IST diese lexikografische Ordnung; dass wir selbst nicht kleiner als
-- wir selbst sind, schließt uns dabei von allein aus.
--
-- AUFRUFVERTRAG: erst NACH einem bestätigten submit_score() aufrufen. Findet
-- die Funktion die eigene Zeile nicht, gibt sie GAR KEINE Zeile zurück statt zu
-- raten – der Client fällt dann still auf die alte Anzeige zurück.
--
-- ACHTUNG beim erneuten Ausführen: die Signatur hat sich um p_submission_id
-- erweitert, und eine neue Parameterliste legt in Postgres eine ZWEITE Funktion
-- an, statt die alte zu ersetzen – daher das `drop` davor. Daten werden dabei
-- nicht angefasst.
drop function if exists public.player_rank(int, text, text, int, int);
create or replace function public.player_rank(
  p_size int, p_difficulty text, p_name text,
  p_score int default null, p_seconds int default null,
  p_submission_id uuid default null
) returns table (rank bigint, total bigint, is_best boolean)
  language sql security definer set search_path = public stable as $player_rank$
  with bucket as (
    select s.id, s.score, s.seconds, s.created_at, s.submission_id,
           btrim(coalesce(s.name, '')) = '' as anon,
           case when btrim(coalesce(s.name, '')) = ''
                then s.id::text
                else lower(btrim(s.name)) end as pkey
      from public.scores s
     where s.size = p_size and s.difficulty = p_difficulty
  ),
  best as (
    -- Je Spieler genau seine beste Zeile, in der Ordnung der Bestenliste.
    -- Gruppiert wird über BEIDE Schlüsselspalten, siehe oben.
    select distinct on (b.anon, b.pkey)
           b.anon, b.pkey, b.score, b.seconds, b.created_at, b.id
      from bucket b
     order by b.anon, b.pkey, b.score asc, b.seconds asc, b.created_at asc, b.id asc
  ),
  me as (
    -- Genau ein Zweig kann Zeilen liefern: der erste verlangt einen Namen, die
    -- beiden anderen dessen Abwesenheit und schließen sich über p_submission_id
    -- gegenseitig aus. `pref` hält die Reihenfolge trotzdem fest, damit die
    -- Auswahl nicht von der Auswertungsreihenfolge des UNION abhängt.
    select 0 as pref, b.score, b.seconds, b.created_at, b.id
      from best b
     where not b.anon
       and b.pkey = nullif(lower(btrim(coalesce(p_name, ''))), '')
    union all
    -- Namenlos, aber identifizierbar: die Zeile, die dieser Einreichung gehört.
    select 1 as pref, b.score, b.seconds, b.created_at, b.id
      from bucket b
     where nullif(lower(btrim(coalesce(p_name, ''))), '') is null
       and p_submission_id is not null
       and b.submission_id = p_submission_id
    union all
    -- Namenlos und ohne submission_id: nur noch die alte Heuristik möglich.
    select 2 as pref, b.score, b.seconds, b.created_at, b.id
      from bucket b
     where nullif(lower(btrim(coalesce(p_name, ''))), '') is null
       and p_submission_id is null
       and b.anon
       and b.score = p_score and b.seconds = p_seconds
     order by pref, created_at desc, id desc
     limit 1
  )
  select (select count(*) + 1 from best b
            where (b.score, b.seconds, b.created_at, b.id)
                < (m.score, m.seconds, m.created_at, m.id))::bigint,
         (select count(*) from best)::bigint,
         (m.score, m.seconds) is not distinct from (p_score, p_seconds)
    from me m;
$player_rank$;

-- 6) Ausführrechte nur für diese Funktionen ------------------------------------
grant execute on function public.submit_score(text, int, text, int, int, int) to anon;
grant execute on function public.submit_score(text, int, text, int, int, int, uuid) to anon;
grant execute on function public.top_scores(int, text, int, timestamptz) to anon;
grant execute on function public.score_counts(int, text, timestamptz) to anon;
grant execute on function public.player_rank(int, text, text, int, int, uuid) to anon;

-- 7) Auswertung: Lesen für den Wochenbericht -----------------------------------
-- .github/workflows/weekly-report.yml wertet einmal pro Woche die Aktivität aus
-- (tools/weekly-report.mjs) und liest die Tabelle dafür DIREKT, nicht über die
-- Funktionen oben: top_scores() gibt client_key bewusst nie heraus, und genau
-- den braucht die Zählung aktiver Geräte. Gelesen wird als service_role, der
-- RLS umgeht.
--
-- Der service_role-Key gehört ausschließlich in das GitHub-Secret
-- SUPABASE_SERVICE_KEY. Er darf NIE in js/leaderboard.js oder sonst in den
-- Browser – dort steht der öffentliche anon-Key, und das ist der Unterschied
-- zwischen "lesbar" und "beschreibbar von jedem".
--
-- In Supabase hat service_role diese Rechte meist schon über die
-- Default-Privileges; das Grant ist idempotent und macht die Abhängigkeit
-- ausdrücklich, statt sie zu vermuten.
grant select on public.scores to service_role;

-- 8) Anonyme Spielzähler (Pings) -----------------------------------------------
-- Die Rangliste weiß nur von Partien, die gelöst UND eingereicht wurden. Alles
-- davor – geöffnet, angefangen, gelöst-aber-nicht-eingereicht – war bisher
-- unsichtbar. Diese Tabelle schließt die Lücke, und zwar bewusst ALS ZÄHLER,
-- nicht als Ereignisprotokoll:
--
--   * Eine Zeile ist ein Zähler je (Stunde, Art, Quelle, Größe, Schwierigkeit).
--     Es gibt KEINE Zeile pro Spiel, keine IP, keinen client_key, keine Sitzung,
--     kein Cookie, keine Kennung irgendeiner Art. Aus einem Zähler lässt sich
--     nichts auf eine Person zurückrechnen – es ist schlicht eine Zahl, die um
--     eins steigt.
--   * Stundenauflösung, nicht Tag: der Wochenbericht läuft montags um 06:00 UTC
--     und muss sein Fenster ohne Überlappung an das des Vorberichts anschließen
--     können. Ein Tageszähler ließe sich an einer 06:00-Grenze nicht teilen.
--
-- GETRENNT VON DER RANGLISTE, und das ist der Punkt: `scores` und `play_stats`
-- werden nie addiert. Einreichungen zählt weiterhin ausschließlich `scores`
-- (exakt, mit Namen und Zeiten), Pings zählen ausschließlich hier. Es gibt
-- deshalb absichtlich KEINE Ping-Art "eingereicht" – die gäbe es dann zweimal.
-- Die drei Arten stehen zueinander wie ein Trichter:
--
--   app_open  → game_start → game_win → (Einreichung, aus `scores`)
--
-- QUELLE: 'web' ist echtes Spiel, 'test' ein automatisierter Browser-Testlauf
-- (js/stats.js erkennt ihn an navigator.webdriver), 'dev' eine lokale
-- Entwicklungsinstanz. Der Bericht rechnet nur mit 'web' und weist die anderen
-- getrennt aus – so verfälschen Testläufe die Statistik nicht, bleiben aber
-- sichtbar.
create table if not exists public.play_stats (
  bucket_hour timestamptz not null,
  kind        text        not null,
  source      text        not null,
  -- 0 bzw. '' heißt "nicht brettbezogen" (app_open gilt keiner Größe).
  size        int         not null default 0,
  difficulty  text        not null default '',
  count       bigint      not null default 0,
  primary key (bucket_hour, kind, source, size, difficulty)
);

-- Rate-Limit-Hilfstabelle. Sie hält NUR den täglich gesalzenen IP-Hash (wie das
-- Rate-Limit in submit_score) und einen Zähler, keine Ereignisse. Dass sie
-- überhaupt nötig ist, liegt daran, dass bump_stat für anon offen ist: ohne
-- Bremse könnte eine Schleife den Wochenbericht beliebig aufblasen.
create table if not exists public.stat_limits (
  client_key   text        primary key,
  window_start timestamptz not null,
  hits         int         not null
);

alter table public.play_stats  enable row level security;
alter table public.stat_limits enable row level security;
revoke all on public.play_stats  from anon, authenticated;
revoke all on public.stat_limits from anon, authenticated;

-- Einen Zähler um eins erhöhen. Fire-and-forget: der Client wartet die Antwort
-- nicht ab und kann mit einem Fehler ohnehin nichts anfangen, deshalb wird
-- Unsinn STILL verworfen (`return`) statt mit einer Exception beantwortet. Was
-- durchkommt, ist damit per Konstruktion aus der erlaubten Wertemenge – die
-- Tabelle kann keine erfundenen Arten, Quellen oder Größen enthalten.
create or replace function public.bump_stat(
  p_kind text, p_source text, p_size int default 0, p_difficulty text default ''
) returns void
  language plpgsql security definer set search_path = public as $bump$
declare
  v_size int;
  v_diff text;
  v_key  text;
  v_hits int;
  v_minute timestamptz := date_trunc('minute', now());
begin
  if p_kind   not in ('app_open', 'game_start', 'game_win') then return; end if;
  if p_source not in ('web', 'test', 'dev')                 then return; end if;
  v_size := coalesce(p_size, 0);
  if v_size <> 0 and (v_size < 5 or v_size > 14) then return; end if;
  v_diff := coalesce(p_difficulty, '');
  if v_diff <> '' and v_diff not in ('easy', 'medium', 'hard') then return; end if;

  -- Best-Effort-Bremse: 60 Pings je Minute und Client. Ein echter Spieler
  -- erzeugt eine Handvoll pro Stunde; 60 trifft nur Schleifen.
  v_key := md5(coalesce(host(inet_client_addr()), '') || '|' || current_date::text);
  insert into public.stat_limits as l (client_key, window_start, hits)
  values (v_key, v_minute, 1)
  on conflict (client_key) do update
    set window_start = case when l.window_start < v_minute then v_minute else l.window_start end,
        hits         = case when l.window_start < v_minute then 1 else l.hits + 1 end
  returning l.hits into v_hits;
  if v_hits > 60 then return; end if;

  -- Gelegentlich aufräumen. Die Tabelle ist klein und ihr Inhalt ist nach einem
  -- Tag wertlos (der Hash-Salt wechselt täglich); ein Vollscan bei jedem Ping
  -- wäre trotzdem Verschwendung.
  if random() < 0.01 then
    delete from public.stat_limits where window_start < now() - interval '1 day';
  end if;

  insert into public.play_stats as s (bucket_hour, kind, source, size, difficulty, count)
  values (date_trunc('hour', now()), p_kind, p_source, v_size, v_diff, 1)
  on conflict (bucket_hour, kind, source, size, difficulty)
    do update set count = s.count + 1;
end;
$bump$;

grant execute on function public.bump_stat(text, text, int, text) to anon;
-- Gelesen wird nur vom Wochenbericht (tools/weekly-report.mjs), wie `scores`.
grant select on public.play_stats to service_role;

-- MIGRATION für bereits eingerichtete Projekte ---------------------------------
-- Die ganze Datei erneut auszuführen ist immer sicher (alles ist `if not exists`
-- bzw. `create or replace`, keine Daten werden angefasst). Wer nur die Änderung
-- will, führt genau diesen Block aus:
--
--   2026-09: Feldgrößen 13 und 14 zugelassen. Vorher wies `submit_score` (und
--   `submit_score_v2`) jede Größe über 12 mit "bad size" (P0001, HTTP 400) ab –
--   bis diese Datei erneut läuft, kommt ein 13×13- oder 14×14-Ergebnis also als
--   ABGELEHNT zurück, nicht als "nicht erreichbar" (rejectionCopy in main.js
--   sagt das auch so), und landet weiterhin in der lokalen Bestenliste. Das
--   Spiel selbst funktioniert ohne diese Migration vollständig; nur die globale
--   Liste kennt die zwei neuen Buckets dann nicht.
--
--     -- in submit_score, submit_score_v2 UND bump_stat die Grenze `> 12`
--     -- auf `> 14` anheben; am einfachsten durch erneutes Ausführen der
--     -- ganzen Datei (Abschnitt 3 und 8).
--
--   Die drei Stellen verhalten sich unterschiedlich, wenn sie alt bleiben:
--   submit_score und submit_score_v2 LEHNEN ab (P0001 „bad size", HTTP 400,
--   im Debug-Export als submitFailure sichtbar), bump_stat verwirft den Ping
--   dagegen STILL – die Spielzähler für 13×13/14×14 fehlen dann im
--   Wochenbericht, ohne dass irgendwo ein Fehler auftaucht.
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

-- 2026-09: Fehler kosten keine Zeit mehr. queens_score() rechnet nur noch
-- `seconds + 30 * hints`; der Aufschlag von 15 s je Fehler entfällt (Begründung
-- in Abschnitt 3). Die ganze Datei erneut ausführen – das ersetzt die Funktion
-- UND rechnet die Bestandszeilen um (das `update` in Abschnitt 3). Wer nur den
-- Kern will:
--
--     create or replace function public.queens_score(p_seconds int, p_hints int, p_mistakes int)
--       returns int language sql immutable as $$
--       select p_seconds + 30 * p_hints;
--     $$;
--     update public.scores
--        set score = public.queens_score(seconds, hints, mistakes)
--      where score is distinct from public.queens_score(seconds, hints, mistakes);
--
-- Die Rückrechnung ist verlustfrei: seconds/hints/mistakes stehen seit der
-- Ersteinrichtung einzeln auf jeder Zeile, der gespeicherte score war immer nur
-- deren abgeleitete Summe. Alte Einträge stehen danach also mit der Zeit da, die
-- sie ohne Fehlerstrafe gehabt hätten, und Alt und Neu sind wieder vergleichbar.
-- Ohne diese Migration läuft alles weiter, nur rechnet der Server dann noch mit
-- der alten Formel – die globale Liste wäre gegenüber der lokalen um 15 s je
-- Fehler verschoben.
--
-- 2026-09: Idempotente Score-Einreichung. Die ganze Datei erneut ausführen,
-- um submission_id, den Unique-Index, die sichere sieben-Parameter-Funktion
-- und ihre Berechtigung zu ergänzen. Bestehende Score-Zeilen bleiben unverändert.
--
-- 2026-09: Lesezugriff für den Wochenbericht. Nur eine Zeile (Abschnitt 7):
--
--     grant select on public.scores to service_role;
--
-- Ohne sie liest der Berichts-Job je nach Projekt-Default nichts und meldet
-- HTTP 401/permission denied. Am Spiel selbst ändert sich nichts – die
-- Rangliste im Browser läuft unverändert über anon und die SECURITY-DEFINER-
-- Funktionen.
--
-- 2026-09: Rang auf Spieler-Ebene (player_rank, Abschnitt 5c). Die ganze
-- Datei erneut ausführen (oder nur Abschnitt 5c plus das zugehörige `grant` in
-- Abschnitt 6). Es werden KEINE Daten angefasst und keine bestehende Funktion
-- geändert – die Funktion kommt additiv dazu. Ohne diese Migration antwortet
-- player_rank mit 404; js/leaderboard.js fällt still auf null zurück und das
-- Spiel meldet weiter "Platz 28 von 83" statt "Platz 3 von 3 Spielern".
-- Abschnitt 5c enthält ein `drop function` für die frühere Fünf-Parameter-Form:
-- p_submission_id kam dazu, und eine neue Parameterliste legt in Postgres sonst
-- eine zweite Funktion an, statt die alte zu ersetzen.
--
-- 2026-09: Anonyme Spielzähler. Die ganze Datei erneut ausführen (oder nur
-- Abschnitt 8) legt play_stats, stat_limits und bump_stat() an. Bestehende
-- Daten werden nicht angefasst, die Rangliste ändert sich nicht. Ohne diese
-- Migration antwortet bump_stat mit 404; js/stats.js verschluckt das still und
-- das Spiel läuft unverändert – im Wochenbericht bleibt der Abschnitt
-- "Spielverlauf" dann einfach leer.
