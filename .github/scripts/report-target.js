// Prüft, dass das Berichts-Repository wirklich privat ist.
//
// Der Wochenbericht enthält Spielernamen und Gerätezahlen. Dass REPORT_REPO auf
// ein *anderes* Repository zeigt, sagt nichts über dessen Sichtbarkeit: ein
// zweites öffentliches Repo, oder ein zunächst privates, das später öffentlich
// gestellt wird, würde den Bericht für alle lesbar machen. Deshalb wird die
// Sichtbarkeit am Ziel abgefragt und nicht aus dem Namen geschlossen.
//
// Gemeinsame Datei, damit die Prüfung vor dem Lesen und die unmittelbar vor dem
// Schreiben nicht auseinanderlaufen können.

async function assertPrivate(github, core, reportRepo) {
  const [owner, repo] = String(reportRepo || '').split('/');
  if (!owner || !repo) {
    core.setFailed('REPORT_REPO muss die Form owner/name haben.');
    throw new Error('REPORT_REPO ungültig');
  }

  let data;
  try {
    ({ data } = await github.rest.repos.get({ owner, repo }));
  } catch (err) {
    // 404 heißt hier beides: Repository gibt es nicht, oder das Token kommt
    // nicht daran. Beides muss den Lauf stoppen — ohne Antwort ist die
    // Sichtbarkeit unbekannt, und unbekannt gilt als nicht privat.
    const hint = err.status === 404
      ? `${owner}/${repo} ist über REPORT_GITHUB_TOKEN nicht erreichbar (Repository fehlt, oder das Token hat keinen Zugriff darauf).`
      : `Sichtbarkeit von ${owner}/${repo} nicht feststellbar (HTTP ${err.status ?? '?'}: ${err.message}).`;
    core.setFailed(`${hint} Der Bericht wird nicht angelegt.`);
    throw err;
  }

  if (data.private !== true) {
    core.setFailed(
      `${owner}/${repo} ist nicht privat (visibility: ${data.visibility ?? 'unbekannt'}). `
      + 'Der Bericht enthält Spielernamen und wird deshalb nicht angelegt. '
      + 'Entweder das Repository auf privat stellen oder REPORT_REPO auf ein privates ändern.'
    );
    throw new Error('Zielrepository ist nicht privat');
  }

  core.info(`Zielrepository ${owner}/${repo} ist privat.`);
  return { owner, repo };
}

module.exports = { assertPrivate };
