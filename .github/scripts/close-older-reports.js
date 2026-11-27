// Schließt die älteren Wochenberichte, damit die Issue-Liste des privaten
// Berichts-Repositories standardmäßig nur den neuesten zeigt.
//
// Offene Issues sind die Standardansicht auf GitHub. Bleiben alle Berichte
// offen, muss man jede Woche aus einer wachsenden Liste den neuesten
// heraussuchen; geschlossene bleiben vollständig lesbar und auffindbar.
//
// Der Zeitraum-Zustand hängt NICHT daran: "Letzten Bericht suchen" liest mit
// state: 'all' und sortiert nach Erstellungsdatum, also findet es den Marker
// auch in einem geschlossenen Issue. Schließen ist reine Darstellung.

const REPORT_LABEL = 'wochenbericht';

/**
 * Schließt alle offenen Issues mit dem Berichts-Label außer `keepNumber`.
 *
 * Wirft nie: der Bericht ist zu diesem Zeitpunkt schon angelegt, und ein roter
 * Lauf wegen einer Darstellungsfrage würde einen zugestellten Bericht als
 * Fehlschlag ausgeben. Der nächste Lauf schließt ohnehin *alle* älteren
 * offenen, nicht nur den der Vorwoche — es heilt sich also selbst.
 * Fehler werden als Annotation sichtbar gemacht, nicht verschwiegen.
 *
 * @returns {Promise<number[]>} die Nummern der geschlossenen Issues
 */
async function closeOlderReports(github, core, target, keepNumber) {
  const closed = [];
  try {
    const open = await github.paginate(github.rest.issues.listForRepo, {
      ...target,
      state: 'open',
      labels: REPORT_LABEL,
      per_page: 100,
    });

    // Nur eigene Berichte: ein Pull Request taucht in dieser Liste ebenfalls
    // auf, und ein Issue ohne das Label gehört jemand anderem (von Hand
    // angelegte Notizen im gleichen Repo bleiben unangetastet — die API
    // filtert nach Label, das ist hier der Gürtel zum Hosenträger).
    const older = open.filter((i) =>
      !i.pull_request
      && i.number !== keepNumber
      && (i.labels || []).some((l) => (typeof l === 'string' ? l : l.name) === REPORT_LABEL));

    for (const issue of older) {
      try {
        await github.rest.issues.update({
          ...target,
          issue_number: issue.number,
          state: 'closed',
          state_reason: 'completed',
        });
        closed.push(issue.number);
      } catch (err) {
        // Einzelne Nummer, kein Titel: das Log dieses Repositories ist öffentlich.
        core.warning(`Issue #${issue.number} konnte nicht geschlossen werden (HTTP ${err.status ?? '?'}).`);
      }
    }

    core.info(closed.length
      ? `${closed.length} älteren Bericht(e) geschlossen: ${closed.map((n) => `#${n}`).join(', ')}.`
      : 'Keine älteren offenen Berichte zu schließen.');
  } catch (err) {
    core.warning(`Ältere Berichte konnten nicht geschlossen werden (HTTP ${err.status ?? '?'}: ${err.message}). Der Bericht selbst ist angelegt.`);
  }
  return closed;
}

module.exports = { closeOlderReports, REPORT_LABEL };
