// Wöchentlicher Aktivitätsbericht über die globale Rangliste.
//
//   node tools/weekly-report.mjs --out-body body.md --out-title title.txt
//
// Läuft in .github/workflows/weekly-report.yml einmal pro Woche und schreibt
// das Ergebnis als GitHub-Issue; GitHub schickt daraus die Benachrichtigungsmail.
// Der Bericht ist ABSICHTLICH deterministisch: gleiche Zeilen + gleiches Fenster
// ergeben zeichengleichen Text. Deshalb hier keine KI, kein `Intl`, kein
// `toLocaleString` und keine lokale Zeitzone — der CI-Runner steht auf UTC, ein
// anderer Rechner nicht, und ein Bericht, der je nach Laufort andere Tage
// gruppiert, wäre nicht mehr vergleichbar. Alles läuft über UTC und feste
// Formatierer (fmtDate, fmtNum, fmtDuration).
//
// SPRACHE: Deutsch, und das ist kein vergessener i18n-Schritt. Wie das
// Debug-Journal und die Kommentare in docs/leaderboard-setup.sql ist das hier
// Betreiber-Ausgabe, keine Spieleroberfläche — sie wird von einer Person
// gelesen und gehört in keinen Sprachpack.
//
// DATENQUELLE ist ausschließlich `public.scores`. Was dort nicht ankommt, kann
// der Bericht nicht wissen, und er behauptet es auch nicht: gespielte Partien,
// Seitenaufrufe und Abbrüche erzeugen keine Zeile. Nur ein gelöstes UND global
// eingereichtes Spiel tut das. Jede Zahl unten ist deshalb eine Aussage über
// Einreichungen, nie über "Spiele" — siehe den Abschnitt "Lesehilfe" im Bericht.
//
// ZEITFENSTER: Einreichungen werden sekundengenau abgegrenzt, Pings liegen nur
// stundenweise vor. Das Ping-Fenster wird deshalb auf volle Stunden abgeschnitten
// und sein Ende getrennt im Zustandsmarker geführt (statsUntil), damit zwei
// aufeinanderfolgende Berichte dieselbe Stunde nicht doppelt zählen und keine
// auslassen. Beide Fenster stehen in der Kopfzeile des Berichts.
//
// client_key wird gelesen, aber NIE gedruckt. Der Wert ist der täglich gesalzene
// IP-Hash aus submit_score(); er taugt als Zählmerkmal für aktive Geräte und
// sonst zu nichts. Weil er täglich wechselt, ist "eindeutige Geräte über eine
// Woche" keine sinnvolle Zahl — dasselbe Gerät liefert bis zu sieben Hashes.
// Der Bericht zählt deshalb Geräte PRO TAG und nennt das auch so.
// tests/logic/weekly-report.mjs prüft, dass kein Hash im Text landet.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DAY_MS = 86400000;
const DEFAULT_WINDOW_DAYS = 7;
// Wie viele Einzeleinreichungen die Liste "Neueste Einreichungen" zeigt, bevor
// sie auf "… und N weitere" kürzt. Eine Mail soll lesbar bleiben.
const MAX_LISTED = 25;
// So viele Plätze zeigt die Bestenliste je aktivem Bucket.
const TOP_PER_BUCKET = 3;

const HOUR_MS = 3600000;
const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
// Muss zu js/stats.js und bump_stat() passen. 'web' ist echtes Spiel; alles
// andere wird getrennt ausgewiesen und fließt in keine Quote ein.
const REAL_SOURCE = 'web';
// Dativ, weil die Beschriftung nur hinter "aus …" auftaucht.
const SOURCE_LABEL = { test: 'automatisierten Testläufen', dev: 'lokaler Entwicklung' };
const DIFF_LABEL = { easy: 'leicht', medium: 'mittel', hard: 'schwer' };

// --- Formatierer (alle deterministisch, alle UTC) ----------------------------

const pad2 = (n) => String(n).padStart(2, '0');

export function fmtDate(ms) {
  const d = new Date(ms);
  return `${pad2(d.getUTCDate())}.${pad2(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
}

export function fmtDateTime(ms) {
  const d = new Date(ms);
  return `${fmtDate(ms)} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())} UTC`;
}

// YYYY-MM-DD in UTC — der Schlüssel, unter dem Tage gruppiert werden.
export function dayKey(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

// Sekunden als m:ss (bzw. h:mm:ss) — dieselbe Lesart wie die Uhr im Spiel.
export function fmtDuration(sec) {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(r)}` : `${m}:${pad2(r)}`;
}

// Deutsches Dezimalkomma ohne Intl, damit die Ausgabe nicht von der Locale des
// Runners abhängt.
export function fmtNum(n, digits = 1) {
  if (!Number.isFinite(n)) return '–';
  return n.toFixed(digits).replace('.', ',');
}

export function fmtPct(part, whole) {
  if (!whole) return '–';
  return `${fmtNum((part / whole) * 100, 0)} %`;
}

// Veränderung gegenüber dem Vorzeitraum. Von 0 auf irgendwas ist KEIN
// "+∞ %", sondern schlicht "neu" — eine Prozentzahl wäre da eine Scheinpräzision.
export function fmtDelta(now, prev) {
  const diff = now - prev;
  const sign = diff > 0 ? '+' : diff < 0 ? '−' : '±';
  const abs = Math.abs(diff);
  if (prev === 0) return now === 0 ? '±0' : `+${now} (neu)`;
  return `${sign}${abs} (${sign}${fmtNum((abs / prev) * 100, 0)} %)`;
}

export function bucketLabel(size, difficulty) {
  return `${size}×${size} ${DIFF_LABEL[difficulty] || difficulty}`;
}

// ISO-Wochennummer (Montag als erster Tag), rein gerechnet statt über Intl.
export function isoWeek(ms) {
  const d = new Date(Date.UTC(new Date(ms).getUTCFullYear(), new Date(ms).getUTCMonth(), new Date(ms).getUTCDate()));
  // Auf den Donnerstag derselben Woche schieben: dessen Jahr ist per Definition
  // das ISO-Jahr, was den Jahreswechsel korrekt macht (der 31.12. kann in KW 1
  // des Folgejahres liegen).
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const isoYear = d.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * DAY_MS));
  return { year: isoYear, week };
}

// --- Zustand („seit der letzten Mail") ---------------------------------------
//
// Der Zustand liegt NICHT im Repo, sondern im zuletzt erzeugten Issue, als
// HTML-Kommentar in dessen Text. Zwei Gründe: `main` ist geschützt (ein
// Bot-Push scheitert am Statuscheck) und ein Commit auf `main` würde über
// deploy.yml wöchentlich die Seite neu ausrollen. Der eigentliche Gewinn ist
// aber die Invariante: der Zeitraum rückt genau dann weiter, wenn ein Bericht
// tatsächlich zugestellt wurde. Bricht ein Lauf nach dem Lesen, aber vor dem
// Schreiben ab, deckt der nächste Bericht beide Fenster ab — es geht nichts
// verloren, es kommt nur später.
const MARKER_PREFIX = 'queens-report-state:';
const MARKER_RE = /<!--\s*queens-report-state:\s*(\{[\s\S]*?\})\s*-->/g;

export function parseStateMarker(text) {
  // Der echte Marker steht am Ende des Berichts. Ausgewertet wird deshalb der
  // LETZTE Treffer: alles darüber ist Berichtstext, der Namen von außen enthält
  // (siehe safeText) — ein vorgetäuschter Marker weiter oben soll das Fenster
  // nicht verschieben können.
  const matches = [...String(text || '').matchAll(MARKER_RE)];
  const m = matches[matches.length - 1];
  if (!m) return null;
  try {
    const state = JSON.parse(m[1]);
    const at = Date.parse(state.until);
    if (!Number.isFinite(at)) return null;
    // statsUntil fehlt in Berichten von vor den Zählern — dann beginnt das
    // Ping-Fenster einfach bei der angebrochenen Stunde von `since`.
    const statsAt = Date.parse(state.statsUntil);
    return {
      until: at,
      lastId: Number.isFinite(state.lastId) ? state.lastId : null,
      statsUntil: Number.isFinite(statsAt) ? statsAt : null,
    };
  } catch {
    return null;
  }
}

export function renderStateMarker({ until, lastId, statsUntil }) {
  const payload = JSON.stringify({
    until: new Date(until).toISOString(),
    lastId: lastId ?? null,
    statsUntil: Number.isFinite(statsUntil) ? new Date(statsUntil).toISOString() : null,
  });
  return `<!-- ${MARKER_PREFIX} ${payload} -->`;
}

// Fenster = [since, until]. `since` ist das Ende des letzten Berichts; ohne
// Vorlauf (erster Bericht, gelöschtes Issue) fällt es auf die Standardwoche
// zurück, damit die erste Mail nicht die gesamte Historie als "neu" meldet.
export function windowFor(state, now, windowDays = DEFAULT_WINDOW_DAYS) {
  const until = now;
  const fallback = until - windowDays * DAY_MS;
  const since = state && Number.isFinite(state.until) ? Math.min(state.until, until) : fallback;
  return { since, until, continued: !!(state && Number.isFinite(state.until)) };
}

export const floorHour = (ms) => Math.floor(ms / HOUR_MS) * HOUR_MS;

// Ping-Fenster: halboffen [statsSince, statsUntil) auf vollen Stunden. Das Ende
// ist die letzte ABGESCHLOSSENE Stunde vor dem Lauf — die angebrochene Stunde
// gehört dem nächsten Bericht, sonst würde sie zweimal gezählt (hier anteilig,
// dort vollständig). Der Anfang ist das Ende des Vorberichts; ohne einen solchen
// die Stunde, in der das Berichtsfenster beginnt.
export function statsWindowFor(state, { since, until }) {
  const statsUntil = floorHour(until);
  const prev = state && Number.isFinite(state.statsUntil) ? state.statsUntil : null;
  const statsSince = Math.min(prev !== null ? prev : floorHour(since), statsUntil);
  return { statsSince, statsUntil };
}

// --- Auswertung (pur) --------------------------------------------------------

function normalizeRow(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const size = Number(raw.size);
  const seconds = Number(raw.seconds);
  if (!Number.isFinite(size) || !Number.isFinite(seconds)) return null;
  const t = raw.created_at ? Date.parse(raw.created_at) : NaN;
  return {
    id: Number(raw.id) || 0,
    // Undatierte Zeilen kann es geben (theoretisch), und sie werden nicht
    // weggeworfen: sie zählen in der Gesamtsumme und in den Rekord-Vergleichen
    // mit, nur in keinem Zeitfenster. Dieselbe Regel wie bei den undatierten
    // Einträgen in js/highscores.js.
    t: Number.isFinite(t) ? t : null,
    name: String(raw.name || '').trim(),
    size,
    difficulty: String(raw.difficulty || ''),
    seconds,
    hints: Number(raw.hints) || 0,
    mistakes: Number(raw.mistakes) || 0,
    score: Number(raw.score) || 0,
    key: raw.client_key ? String(raw.client_key) : null,
  };
}

function median(values) {
  if (!values.length) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

const sum = (xs) => xs.reduce((a, b) => a + b, 0);

// Die Ordnung der Rangliste, identisch zu top_scores() in
// docs/leaderboard-setup.sql: Score, dann Zeit, dann Alter, dann id. Sie hier
// nachzubilden ist wichtig, weil der Bericht sonst einen "Rekord" melden
// könnte, den die Liste im Spiel gar nicht als Platz 1 zeigt.
function betterThan(a, b) {
  if (a.score !== b.score) return a.score < b.score;
  if (a.seconds !== b.seconds) return a.seconds < b.seconds;
  const at = a.t ?? 0;
  const bt = b.t ?? 0;
  if (at !== bt) return at < bt;
  return a.id < b.id;
}

function bestOf(rows) {
  let best = null;
  for (const r of rows) if (!best || betterThan(r, best)) best = r;
  return best;
}

function normalizeStat(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw.bucket_hour ? Date.parse(raw.bucket_hour) : NaN;
  const count = Number(raw.count);
  if (!Number.isFinite(t) || !Number.isFinite(count)) return null;
  return {
    t,
    kind: String(raw.kind || ''),
    source: String(raw.source || ''),
    size: Number(raw.size) || 0,
    difficulty: String(raw.difficulty || ''),
    count,
  };
}

// Die Ping-Seite. Bewusst eine eigene Funktion mit eigenem Rückgabewert: die
// Zähler dürfen an keiner Stelle in dieselbe Zahl fließen wie eine Einreichung,
// und getrennte Auswertungen sind der einfachste Weg, das nicht versehentlich
// doch zu tun.
export function summarizePlay(rawStats, { statsSince, statsUntil }) {
  const rows = (Array.isArray(rawStats) ? rawStats : [])
    .map(normalizeStat)
    .filter((r) => r && r.t >= statsSince && r.t < statsUntil);

  const real = rows.filter((r) => r.source === REAL_SOURCE);
  const sumOf = (list) => list.reduce((a, r) => a + r.count, 0);
  const kind = (k) => sumOf(real.filter((r) => r.kind === k));

  // Alles, was nicht 'web' ist, wird NUR als Gesamtzahl je Quelle ausgewiesen
  // und geht in keine Quote ein. Es soll sichtbar sein, dass es existiert (ein
  // Testlauf, der plötzlich fehlt, ist auch eine Information), aber es darf die
  // Zahlen daneben nicht anfassen.
  const others = new Map();
  for (const r of rows) {
    if (r.source === REAL_SOURCE) continue;
    others.set(r.source, (others.get(r.source) || 0) + r.count);
  }

  // Je Bucket: gestartet und gelöst — was gespielt wird, unabhängig davon, ob
  // es jemand einreicht.
  const buckets = new Map();
  for (const r of real) {
    if (!r.size || !r.difficulty) continue;
    if (r.kind !== 'game_start' && r.kind !== 'game_win') continue;
    const key = `${r.size}|${r.difficulty}`;
    if (!buckets.has(key)) buckets.set(key, { size: r.size, difficulty: r.difficulty, started: 0, won: 0 });
    const b = buckets.get(key);
    if (r.kind === 'game_start') b.started += r.count;
    else b.won += r.count;
  }

  const byDay = new Map();
  for (const r of real.filter((x) => x.kind === 'game_start')) {
    byDay.set(dayKey(r.t), (byDay.get(dayKey(r.t)) || 0) + r.count);
  }

  return {
    statsSince,
    statsUntil,
    // Ohne eine einzige Zeile ist die Migration nicht gelaufen (oder es wurde
    // nichts gespielt) — der Bericht lässt den Abschnitt dann ganz weg, statt
    // Nullen zu drucken, die wie ein Einbruch aussehen.
    available: rows.length > 0,
    opens: kind('app_open'),
    started: kind('game_start'),
    won: kind('game_win'),
    startsByDay: byDay,
    buckets: [...buckets.values()].sort((a, b) => b.started - a.started || a.size - b.size),
    otherSources: [...others.entries()].sort((a, b) => b[1] - a[1]),
  };
}

export function summarize(rawRows, { since, until, stats, statsSince, statsUntil }) {
  const rows = (Array.isArray(rawRows) ? rawRows : []).map(normalizeRow).filter(Boolean);
  const span = Math.max(1, until - since);

  const inWindow = (r) => r.t !== null && r.t > since && r.t <= until;
  const inPrev = (r) => r.t !== null && r.t > since - span && r.t <= since;
  // Alles, was vor dem Fenster liegt — inklusive undatierter Zeilen, die
  // zwangsläufig aus der Vergangenheit stammen. Das ist die Vergleichsbasis für
  // "neuer Rekord" und "Name schon einmal dagewesen".
  const before = rows.filter((r) => r.t === null || r.t <= since);
  const window = rows.filter(inWindow);
  const prev = rows.filter(inPrev);

  // Aktivität pro UTC-Tag. Die Tageskette wird lückenlos aufgebaut (auch leere
  // Tage), sonst zeigt der Balken bei wenig Verkehr ein falsches Bild.
  const byDay = new Map();
  for (const r of window) {
    const k = dayKey(r.t);
    if (!byDay.has(k)) byDay.set(k, { count: 0, keys: new Set() });
    const d = byDay.get(k);
    d.count++;
    if (r.key) d.keys.add(r.key);
  }
  const days = [];
  for (let t = Date.UTC(new Date(since).getUTCFullYear(), new Date(since).getUTCMonth(), new Date(since).getUTCDate());
       t <= until; t += DAY_MS) {
    const k = dayKey(t);
    const d = byDay.get(k) || { count: 0, keys: new Set() };
    days.push({ at: t, key: k, count: d.count, devices: d.keys.size });
  }

  // Namen. Ein leerer Name ist kein Spieler-Merkmal (er ist absichtlich leer,
  // siehe submit_score) — er wird separat gezählt, nie als "ein Name".
  const namesBefore = new Set(before.map((r) => r.name).filter(Boolean));
  const namesWindow = new Set(window.map((r) => r.name).filter(Boolean));
  const newNames = [...namesWindow].filter((n) => !namesBefore.has(n)).sort();
  const returningNames = [...namesWindow].filter((n) => namesBefore.has(n)).sort();
  const unnamed = window.filter((r) => !r.name).length;

  // Rekorde: je Bucket der beste Eintrag VOR dem Fenster gegen den besten
  // darin. Gemeldet wird nur, was den Altbestand wirklich schlägt — und bei
  // einem noch leeren Bucket der Ersteintrag, der dort unstrittig Platz 1 ist.
  const buckets = new Map();
  for (const r of rows) {
    const b = `${r.size}|${r.difficulty}`;
    if (!buckets.has(b)) buckets.set(b, { size: r.size, difficulty: r.difficulty, all: [], before: [], window: [] });
    const entry = buckets.get(b);
    entry.all.push(r);
    if (inWindow(r)) entry.window.push(r);
    else if (r.t === null || r.t <= since) entry.before.push(r);
  }
  const records = [];
  const activeBuckets = [];
  for (const entry of buckets.values()) {
    if (!entry.window.length) continue;
    const prevBest = bestOf(entry.before);
    const newBest = bestOf(entry.window);
    activeBuckets.push({
      size: entry.size,
      difficulty: entry.difficulty,
      count: entry.window.length,
      medianSeconds: median(entry.window.map((r) => r.seconds)),
      top: [...entry.all].sort((a, b) => (betterThan(a, b) ? -1 : betterThan(b, a) ? 1 : 0)).slice(0, TOP_PER_BUCKET),
    });
    if (newBest && (!prevBest || betterThan(newBest, prevBest))) {
      records.push({ size: entry.size, difficulty: entry.difficulty, entry: newBest, previous: prevBest });
    }
  }
  activeBuckets.sort((a, b) => b.count - a.count || a.size - b.size || a.difficulty.localeCompare(b.difficulty));
  records.sort((a, b) => a.size - b.size || a.difficulty.localeCompare(b.difficulty));

  const hintFree = window.filter((r) => r.hints === 0).length;
  const cleanRun = window.filter((r) => r.mistakes === 0).length;

  // Die Ping-Auswertung als eigener Block — und dazu die Einreichungen über
  // GENAU dasselbe Fenster, damit der Trichter im Bericht Stufen vergleicht,
  // die denselben Zeitraum meinen (siehe renderReport).
  const play = summarizePlay(stats, {
    statsSince: Number.isFinite(statsSince) ? statsSince : floorHour(since),
    statsUntil: Number.isFinite(statsUntil) ? statsUntil : floorHour(until),
  });
  play.submitted = rows.filter(
    (r) => r.t !== null && r.t >= play.statsSince && r.t < play.statsUntil,
  ).length;

  return {
    since,
    until,
    // Eigenes Feld, nicht eingemischt in die Einreichungszahlen darüber.
    play,
    total: rows.length,
    lastId: rows.reduce((max, r) => Math.max(max, r.id), 0) || null,
    submissions: window.length,
    previousSubmissions: prev.length,
    days,
    peakDevices: days.reduce((max, d) => Math.max(max, d.devices), 0),
    deviceDays: sum(days.map((d) => d.devices)),
    activeDays: days.filter((d) => d.count > 0).length,
    names: { active: namesWindow.size, new: newNames, returning: returningNames, unnamed },
    records,
    activeBuckets,
    quality: {
      medianSeconds: median(window.map((r) => r.seconds)),
      avgHints: window.length ? sum(window.map((r) => r.hints)) / window.length : NaN,
      avgMistakes: window.length ? sum(window.map((r) => r.mistakes)) / window.length : NaN,
      hintFree,
      cleanRun,
    },
    latest: [...window].sort((a, b) => b.t - a.t || b.id - a.id),
  };
}

// --- Darstellung -------------------------------------------------------------

export function reportTitle(stats) {
  const { year, week } = isoWeek(stats.until);
  return `Wochenbericht ${year}-W${pad2(week)} (${fmtDate(stats.since)}–${fmtDate(stats.until)})`;
}

// Ein Block je Einreichung, solange das passt. Erst oberhalb der Breite wird
// skaliert — sonst malt ein Balken bei zwei Einreichungen zwanzig Blöcke und
// suggeriert Verkehr, den es nicht gibt.
function bar(count, max, width = 20) {
  if (!count) return '';
  if (max <= width) return '█'.repeat(count);
  return '█'.repeat(Math.max(1, Math.round((count / max) * width)));
}

export function renderReport(stats, { continued = true } = {}) {
  const out = [];
  const w = stats.submissions;

  const play = stats.play || { available: false };
  out.push(`**Zeitraum:** ${fmtDateTime(stats.since)} → ${fmtDateTime(stats.until)}`);
  if (play.available) {
    out.push(`**Zähler-Zeitraum:** ${fmtDateTime(play.statsSince)} → ${fmtDateTime(play.statsUntil)} (auf volle Stunden gerundet)`);
  }
  if (!continued) {
    // Die Länge wird aus dem Fenster gerechnet, nicht hingeschrieben:
    // --window-days kann bei einem manuellen Lauf etwas anderes als 7 sein, und
    // ein Satz, der 7 behauptet, während die Zeitstempel eine Zeile darüber 14
    // Tage zeigen, ist schlimmer als gar kein Satz.
    const days = Math.max(1, Math.round((stats.until - stats.since) / DAY_MS));
    const span = days === 1 ? 'den letzten Tag' : `die letzten ${days} Tage`;
    out.push('');
    out.push(`> Kein vorheriger Bericht gefunden — dieser deckt ${span} ab.`);
  }
  out.push('');
  out.push('## Aktivität');
  out.push('');
  out.push(`- **Neue Einreichungen:** ${w} (Vorzeitraum: ${stats.previousSubmissions}, ${fmtDelta(w, stats.previousSubmissions)})`);
  out.push(`- **Einreichungen gesamt:** ${stats.total}`);
  out.push(`- **Tage mit Aktivität:** ${stats.activeDays} von ${stats.days.length} Kalendertagen`);
  out.push(`- **Aktive Geräte:** bis zu ${stats.peakDevices} an einem Tag, ${stats.deviceDays} Gerätetage im Zeitraum`);

  // Der Balken zeigt gestartete Spiele, wo es sie gibt — das ist das ehrlichere
  // Aktivitätsmaß —, sonst Einreichungen. Beide Zahlen stehen beschriftet
  // daneben, aus zwei Quellen, nie addiert.
  const startsOf = (d) => (play.available ? play.startsByDay.get(d.key) || 0 : null);
  const chartOn = play.available || w > 0;
  if (chartOn) {
    const max = stats.days.reduce((m, d) => Math.max(m, play.available ? startsOf(d) : d.count), 0);
    out.push('');
    out.push('```');
    for (const d of stats.days) {
      const label = `${WEEKDAYS[new Date(d.at).getUTCDay()]} ${fmtDate(d.at).slice(0, 6)}`;
      const value = play.available ? startsOf(d) : d.count;
      const tail = play.available
        ? `${startsOf(d)} gestartet · ${d.count} eingereicht`
        : `${d.count} eingereicht`;
      out.push(`${label.padEnd(10)}${bar(value, max).padEnd(21)}${tail}`);
    }
    out.push('```');
  }

  if (play.available) {
    out.push('');
    out.push('## Spielverlauf');
    out.push('');
    out.push('Aus den anonymen Zählern — sie wissen von jedem Spiel, nicht nur von den');
    out.push('eingereichten. Die letzte Zeile stammt als einzige aus der Rangliste.');
    out.push('');
    out.push(`- **Seite geöffnet:** ${play.opens}`);
    out.push(`- **Spiele gestartet:** ${play.started}` +
      (play.opens ? ` (${fmtNum(play.started / play.opens, 1)} je Öffnung)` : ''));
    out.push(`- **Spiele gelöst:** ${play.won}` +
      (play.started ? ` (${fmtPct(play.won, play.started)} der gestarteten)` : ''));
    // Diese Stufe zählt Einreichungen über das ZÄHLER-Fenster, nicht über das
    // exakte oben. Beide Fenster liegen bis zu eine Stunde auseinander (das
    // Ping-Fenster ist auf volle Stunden gerundet), und eine Quote aus zwei
    // verschiedenen Zeiträumen ist bestenfalls schief und kann über 100 %
    // gehen: eine Einreichung um 06:05 fällt in `w`, ihr Sieg-Ping liegt aber
    // in der 06:00-Stunde, die erst der nächste Bericht zählt. Weichen die
    // beiden Zahlen ab, steht das ausdrücklich dabei — sonst wäre es genau die
    // stille Unstimmigkeit, die einen Bericht unglaubwürdig macht.
    const submittedInWindow = play.submitted;
    out.push(`- **Davon eingereicht:** ${submittedInWindow} aus der Rangliste` +
      (play.won ? ` (${fmtPct(submittedInWindow, play.won)} der gelösten)` : '') +
      (submittedInWindow === w
        ? ''
        : ` — im Zähler-Zeitraum gezählt, damit die Quote auf dieselbe Stunde trifft; oben stehen ${w} für den sekundengenauen Zeitraum`));
    if (play.otherSources.length) {
      const parts = play.otherSources.map(([src, n]) => `${n} aus ${SOURCE_LABEL[src] || src}`);
      out.push('');
      out.push(`> **Nicht mitgezählt:** ${parts.join(', ')}. Diese Pings stehen in keiner Zahl oben.`);
    }
    if (play.buckets.length) {
      out.push('');
      out.push('| Bucket | Gestartet | Gelöst | Lösungsquote |');
      out.push('| --- | ---: | ---: | ---: |');
      for (const b of play.buckets) {
        out.push(`| ${bucketLabel(b.size, b.difficulty)} | ${b.started} | ${b.won} | ${fmtPct(b.won, b.started)} |`);
      }
    }
  }

  out.push('');
  out.push('## Spielerinnen und Spieler');
  out.push('');
  if (w === 0) {
    out.push('Keine Einreichungen in diesem Zeitraum.');
  } else {
    out.push(`- **Namen im Zeitraum:** ${stats.names.active}` +
      (stats.names.unnamed ? ` (dazu ${stats.names.unnamed} Einreichung${stats.names.unnamed === 1 ? '' : 'en'} ohne Namen)` : ''));
    out.push(`- **Neu dabei:** ${stats.names.new.length}${stats.names.new.length ? ` — ${stats.names.new.map(safeText).join(', ')}` : ''}`);
    out.push(`- **Wiedergekommen:** ${stats.names.returning.length}${stats.names.returning.length ? ` — ${stats.names.returning.map(safeText).join(', ')}` : ''}`);
  }

  if (stats.records.length) {
    out.push('');
    out.push('## 🏆 Neue Bestzeiten');
    out.push('');
    for (const rec of stats.records) {
      const who = playerName(rec.entry.name);
      const old = rec.previous
        ? `bisher ${fmtDuration(rec.previous.score)} von ${playerName(rec.previous.name)}`
        : 'erster Eintrag in diesem Bucket';
      out.push(`- **${bucketLabel(rec.size, rec.difficulty)}:** ${fmtDuration(rec.entry.score)} von ${who} — ${old}`);
    }
  }

  if (stats.activeBuckets.length) {
    out.push('');
    out.push('## Gespielte Größen');
    out.push('');
    out.push('| Bucket | Einreichungen | Median-Spielzeit | Bestenliste (gesamt) |');
    out.push('| --- | ---: | ---: | --- |');
    for (const b of stats.activeBuckets) {
      const top = b.top
        .map((r, i) => `${i + 1}. ${fmtDuration(r.score)} ${playerName(r.name)}`)
        .join(' · ');
      out.push(`| ${bucketLabel(b.size, b.difficulty)} | ${b.count} | ${fmtDuration(b.medianSeconds)} | ${top} |`);
    }
  }

  if (w > 0) {
    out.push('');
    out.push('## Wie gespielt wurde');
    out.push('');
    out.push(`- **Median-Spielzeit:** ${fmtDuration(stats.quality.medianSeconds)} (reine Spielzeit, ohne Tippaufschlag)`);
    out.push(`- **Tipps pro Lauf:** ${fmtNum(stats.quality.avgHints, 2)} im Schnitt — ${stats.quality.hintFree} von ${w} ganz ohne (${fmtPct(stats.quality.hintFree, w)})`);
    out.push(`- **Fehler pro Lauf:** ${fmtNum(stats.quality.avgMistakes, 2)} im Schnitt — ${stats.quality.cleanRun} von ${w} fehlerfrei (${fmtPct(stats.quality.cleanRun, w)})`);

    out.push('');
    out.push('## Neueste Einreichungen');
    out.push('');
    out.push('| Wann | Name | Bucket | Ergebnis | Zeit | Tipps | Fehler |');
    out.push('| --- | --- | --- | ---: | ---: | ---: | ---: |');
    for (const r of stats.latest.slice(0, MAX_LISTED)) {
      out.push(`| ${fmtDateTime(r.t)} | ${playerName(r.name)} | ${bucketLabel(r.size, r.difficulty)} | ${fmtDuration(r.score)} | ${fmtDuration(r.seconds)} | ${r.hints} | ${r.mistakes} |`);
    }
    if (stats.latest.length > MAX_LISTED) {
      out.push('');
      out.push(`… und ${stats.latest.length - MAX_LISTED} weitere.`);
    }
  }

  out.push('');
  out.push('---');
  out.push('');
  out.push('<details><summary>Lesehilfe: was diese Zahlen sind (und was nicht)</summary>');
  out.push('');
  out.push('- **Zwei Quellen, nie addiert.** „Einreichungen" kommen aus der Ranglisten-Tabelle (exakt, mit Namen und Zeiten); „geöffnet / gestartet / gelöst" kommen aus anonymen Zählern. Jede Zahl gehört zu genau einer der beiden — deshalb gibt es auch keinen Zähler fürs Einreichen, den gäbe es sonst doppelt.');
  out.push('- **Die Zähler enthalten keine Kennung.** Kein Cookie, keine IP, keine Sitzung, keine Zeile je Spiel — nur „Stunde X, Art Y, Größe Z: plus eins". Daraus lässt sich niemand wiedererkennen, also auch keine Nutzerzahl ableiten.');
  out.push('- **Testläufe zählen getrennt.** Ein automatisierter Browsertest fährt dieselbe Oberfläche und würde sonst wie ein Mensch aussehen; er meldet sich selbst als `test` (über `navigator.webdriver`), lokale Entwicklung als `dev`. Beides steht nur in der eigenen Zeile „Nicht mitgezählt".');
  out.push('- **„Einreichung" ≠ „gespieltes Spiel".** Eine Zeile in der Rangliste entsteht nur, wenn ein Spiel gelöst *und* geschickt wurde. Reine Seitenaufrufe von Leuten, die nie ein Spiel starten, sieht nur der Zähler `app_open`.');
  out.push('- **„Aktive Geräte" ist eine Untergrenze pro Tag.** Gezählt wird der tägliche IP-Hash aus `submit_score`, den die Rangliste ohnehin fürs Rate-Limit führt. Er wechselt täglich und ist pro Netz grob — zwei Personen im selben WLAN sind ein Gerät, dieselbe Person an zwei Tagen sind zwei Gerätetage. Eine echte Nutzerzahl ist das nicht und kann es ohne Tracking auch nicht werden.');
  out.push('- **Namen sind selbstgewählt und nicht eindeutig.** „Neu dabei" heißt: dieser Name stand vorher nie in der Tabelle.');
  out.push('- **Ergebnis = Spielzeit + 30 s je Tipp** (`queens_score`), Fehler kosten nichts. Die Spalte „Zeit" ist die reine Spielzeit.');
  out.push('- Der Zeitraum beginnt dort, wo der letzte Bericht endete. Fällt ein Lauf aus, deckt der nächste beide Wochen ab. Die Zähler liegen nur stundenweise vor, ihr Fenster ist deshalb auf volle Stunden gerundet — die angebrochene Stunde gehört dem nächsten Bericht. Die Trichterstufen zählen alle über dieses gerundete Fenster, damit ihre Quoten zueinander passen; weicht die Einreichungszahl dadurch von der oben ab, steht es an der Stelle dabei.');
  out.push('');
  out.push('</details>');
  out.push('');
  out.push(renderStateMarker({
    until: stats.until,
    lastId: stats.lastId,
    statsUntil: play.statsUntil,
  }));
  return out.join('\n');
}

// Namen kommen von außen: submit_score kürzt sie auf 20 Zeichen und faltet
// Whitespace, prüft aber sonst nichts — jeder kann sich beim Einreichen nennen,
// wie er will. Im Bericht landen sie in einem GitHub-Issue, und dort hat eine
// ganze Reihe von Zeichenfolgen Bedeutung. Die unangenehmste ist `@name`:
// GitHub macht daraus eine echte Erwähnung und benachrichtigt den Account oder
// das Team — ein beliebiger Name in der Rangliste könnte also jede Woche
// Unbeteiligte anpingen lassen. Daneben: `#123` verlinkt ein Issue, nackte URLs
// werden verlinkt, Pipes zerlegen die Tabelle, `<` eröffnet rohes HTML.
//
// Statt jede dieser Formen einzeln zu entschärfen, wird der Name als
// **Code-Span** gesetzt: darin rendert GitHub überhaupt kein Markdown und kein
// HTML mehr. Das nimmt allen auf einmal die Bedeutung — auch denen, an die
// heute niemand denkt — und der Name bleibt zeichengetreu lesbar. Jede Stelle,
// an der ein Name gedruckt wird, geht hier durch.
export function safeText(text) {
  const body = String(text)
    .replace(/[\r\n]+/g, ' ')
    // Pipes müssen auch INNERHALB eines Code-Spans maskiert werden, sonst
    // zerlegt GitHub die Tabellenzeile daran. (Außerhalb einer Tabelle bleibt
    // der Backslash dann sichtbar — ein kosmetischer Rest bei einem Namen, der
    // ohnehin absichtlich seltsam ist.)
    .replace(/\|/g, '\\|');
  if (!body) return '';
  // Der Zaun muss länger sein als die längste Backtick-Folge im Namen, sonst
  // bricht der Name aus dem Span aus und alles dahinter wird wieder Markdown.
  const longest = (body.match(/`+/g) || []).reduce((m, run) => Math.max(m, run.length), 0);
  const fence = '`'.repeat(longest + 1);
  // Beginnt oder endet der Inhalt mit einem Backtick, braucht der Span je ein
  // Leerzeichen Polster; CommonMark entfernt genau dieses eine wieder.
  const pad = body.startsWith('`') || body.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${body}${pad}${fence}`;
}

// „(ohne Namen)" ist unser eigener Text und bleibt deshalb normaler Fließtext —
// nur was von außen kommt, wird eingezäunt.
const playerName = (name) => (name ? safeText(name) : '(ohne Namen)');

export function buildReport(rows, { since, until, continued = true, stats: statRows, statsSince, statsUntil }) {
  const stats = summarize(rows, { since, until, stats: statRows, statsSince, statsUntil });
  return { stats, title: reportTitle(stats), body: renderReport(stats, { continued }) };
}

// --- Datenzugriff ------------------------------------------------------------

// Die Projekt-URL steht schon in js/leaderboard.js (sie ist öffentlich). Sie
// hier aus der Datei zu lesen statt sie zu kopieren hält beide Stellen
// zwangsläufig in Übereinstimmung; der Test prüft, dass der Zugriff greift.
export function readSupabaseUrl(root = ROOT) {
  const src = readFileSync(join(root, 'js', 'leaderboard.js'), 'utf8');
  const m = /const\s+SUPABASE_URL\s*=\s*'([^']+)'/.exec(src);
  if (!m) throw new Error('SUPABASE_URL nicht in js/leaderboard.js gefunden');
  return m[1].replace(/\/+$/, '');
}

const PAGE_SIZE = 1000;

// Welche Header ein Schlüssel braucht, hängt von seiner Art ab — und davon gibt
// es seit 2025 zwei:
//   - der Legacy-`service_role`-Key ist ein JWT. Er geht als `apikey` UND als
//     `Authorization: Bearer`, so wie bisher.
//   - die neuen Secret keys (`sb_secret_…`) sind KEINE JWTs. Sie gehören nur in
//     `apikey`; das Gateway tauscht sie intern gegen die service_role-Rolle.
//     Als Bearer mitgeschickt würde PostgREST sie als JWT zu prüfen versuchen,
//     und das kann nur scheitern.
// Supabase empfiehlt die neuen Keys, weil sich einer einzeln widerrufen lässt —
// ein geleakter Legacy-Key heißt dagegen: JWT-Secret neu erzeugen, womit auch
// der öffentliche anon-Key in js/leaderboard.js ungültig würde.
export function supabaseHeaders(key) {
  const headers = { apikey: key, Accept: 'application/json' };
  if (!key.startsWith('sb_')) headers.Authorization = `Bearer ${key}`;
  return headers;
}

// Liest die ganze Tabelle. Der service_role-Key umgeht RLS — er darf NUR hier
// in der Action existieren und niemals in den Browser. Gelesen wird über
// PostgREST direkt, nicht über die SECURITY-DEFINER-Funktionen: die geben
// client_key bewusst nie heraus, und genau den braucht die Gerätezählung.
// Alles auf einmal zu holen macht die Auswertung darüber zu reiner Rechnung
// auf einem Array — testbar mit Fixtures, ohne SQL im Spiel.
async function fetchAllScores(baseUrl, serviceKey) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const url = `${baseUrl}/rest/v1/scores` +
      '?select=id,created_at,name,size,difficulty,seconds,hints,mistakes,score,client_key' +
      `&order=id.asc&limit=${PAGE_SIZE}&offset=${offset}`;
    const res = await fetch(url, {
      headers: supabaseHeaders(serviceKey),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Supabase antwortete ${res.status}: ${body.slice(0, 300)}`);
    }
    const page = await res.json();
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

// Dieselbe Schleife für die Zählertabelle. Auch hier wird alles geholt und in
// JS gefiltert: die Tabelle wächst pro Stunde um eine Handvoll Zeilen, und ein
// Array ist mit Fixtures testbar, ein SQL-Filter nicht.
async function fetchAllStats(baseUrl, serviceKey) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const url = `${baseUrl}/rest/v1/play_stats` +
      '?select=bucket_hour,kind,source,size,difficulty,count' +
      `&order=bucket_hour.asc&limit=${PAGE_SIZE}&offset=${offset}`;
    const res = await fetch(url, {
      headers: supabaseHeaders(serviceKey),
    });
    // Ein 404 heißt: die Migration für die Zähler ist nicht gelaufen. Das ist
    // kein Fehler, sondern der dokumentierte Zustand davor — der Bericht lässt
    // den Abschnitt dann weg und erscheint trotzdem.
    if (res.status === 404) return [];
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Supabase antwortete ${res.status} für play_stats: ${body.slice(0, 300)}`);
    }
    const page = await res.json();
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

// --- CLI ---------------------------------------------------------------------

function parseArgs(argv) {
  const args = { windowDays: DEFAULT_WINDOW_DAYS };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--state') args.state = next();
    else if (a === '--out-body') args.outBody = next();
    else if (a === '--out-title') args.outTitle = next();
    else if (a === '--fixture') args.fixture = next();
    else if (a === '--fixture-stats') args.fixtureStats = next();
    else if (a === '--now') args.now = next();
    else if (a === '--window-days') args.windowDays = Number(next());
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`Unbekanntes Argument: ${a}`);
  }
  return args;
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log('node tools/weekly-report.mjs [--state <datei>] [--out-body <datei>] [--out-title <datei>] [--fixture <datei>] [--fixture-stats <datei>] [--now <iso>] [--window-days <n>]');
    return 0;
  }

  const now = args.now ? Date.parse(args.now) : Date.now();
  if (!Number.isFinite(now)) throw new Error(`--now ist kein gültiger Zeitpunkt: ${args.now}`);

  let state = null;
  if (args.state) {
    try {
      state = parseStateMarker(readFileSync(args.state, 'utf8'));
    } catch {
      // Kein Zustand ist ein normaler Zustand (erster Lauf, gelöschtes Issue).
      state = null;
    }
  }
  const { since, until, continued } = windowFor(state, now, args.windowDays);
  const { statsSince, statsUntil } = statsWindowFor(state, { since, until });

  let rows;
  let statRows;
  if (args.fixture) {
    rows = JSON.parse(readFileSync(args.fixture, 'utf8'));
    statRows = args.fixtureStats ? JSON.parse(readFileSync(args.fixtureStats, 'utf8')) : [];
  } else {
    const key = process.env.SUPABASE_SERVICE_KEY;
    if (!key) throw new Error('SUPABASE_SERVICE_KEY fehlt (GitHub-Secret bzw. Umgebungsvariable).');
    const base = process.env.SUPABASE_URL?.replace(/\/+$/, '') || readSupabaseUrl();
    rows = await fetchAllScores(base, key);
    statRows = await fetchAllStats(base, key);
  }

  const { title, body, stats } = buildReport(rows, {
    since, until, continued, stats: statRows, statsSince, statsUntil,
  });
  if (args.outBody) {
    mkdirSync(dirname(resolve(args.outBody)), { recursive: true });
    writeFileSync(args.outBody, body + '\n');
  }
  if (args.outTitle) {
    mkdirSync(dirname(resolve(args.outTitle)), { recursive: true });
    writeFileSync(args.outTitle, title + '\n');
  }
  if (!args.outBody) console.log(body);
  console.error(`${title}: ${stats.submissions} neue Einreichung(en), ${stats.total} gesamt` +
    (stats.play.available ? `, ${stats.play.started} Spiel(e) gestartet.` : ' (keine Zähler).'));
  return 0;
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(`weekly-report: ${err.message}`);
      process.exit(1);
    },
  );
}
