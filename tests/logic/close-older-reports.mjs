// Pure-Node test for .github/scripts/close-older-reports.js — the step that
// leaves only the newest weekly report open in the private report repo.
//
// Three things here are load-bearing and none of them is obvious from the diff:
//
//   * Closing must not break the window. The report's state marker lives in the
//     newest issue's body, and "Letzten Bericht suchen" finds it with
//     state: 'all'. If that ever became state: 'open', closing last week's
//     report would silently reset the window to the default 7 days and the
//     report would start double-counting or skipping. So this test reads that
//     step out of the workflow and fails if the state filter moves.
//   * It must never fail the run. By the time it runs the report is already
//     published; a red run over a cosmetic step would report a delivered
//     report as a failure. It warns instead — and because every run closes
//     *all* older open reports rather than just the previous one, a failed
//     close heals itself next week.
//   * It must only touch its own issues: hand-written notes in the same private
//     repo, and pull requests, stay open.
//
// Run: node tests/logic/close-older-reports.mjs

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const { closeOlderReports, REPORT_LABEL } = require(`${root}/.github/scripts/close-older-reports.js`);

let failed = false;
const ok = (cond, what) => {
  if (!cond) { failed = true; console.error(`  FAIL ${what}`); } else console.log(`  ok   ${what}`);
};
const same = (a, b, what) => ok(JSON.stringify(a) === JSON.stringify(b), `${what} (${JSON.stringify(a)})`);

const TARGET = { owner: 'IlianP', repo: 'queens-report' };
const report = (number) => ({ number, labels: [{ name: REPORT_LABEL }] });

// A stand-in for actions/github-script's `github` and `core`. `paginate` is
// handed the same listForRepo reference the real one gets, so a call that
// forgot to go through paginate would show up as an unused stub.
const harness = ({ list, update }) => {
  const calls = { list: [], update: [] };
  const core = { warnings: [], infos: [] };
  core.warning = (m) => core.warnings.push(String(m));
  core.info = (m) => core.infos.push(String(m));
  const listForRepo = async (args) => { calls.list.push(args); return list(args); };
  const github = {
    paginate: async (fn, args) => fn(args),
    rest: {
      issues: {
        listForRepo,
        update: async (args) => { calls.update.push(args); return update ? update(args) : {}; },
      },
    },
  };
  return { github, core, calls };
};

// --- the ordinary week ------------------------------------------------------
console.log('closes the older reports and keeps the new one');
{
  const { github, core, calls } = harness({
    list: async () => [report(9), report(8), report(7), report(1)],
  });
  const closed = await closeOlderReports(github, core, TARGET, 9);
  same(closed, [8, 7, 1], 'every older report is closed, the new one is not');
  ok(calls.update.every((c) => c.state === 'closed'), 'each one is closed');
  ok(calls.update.every((c) => c.state_reason === 'completed'),
    'closed as completed, not as "not planned" — the report did its job');
  ok(calls.update.every((c) => c.owner === 'IlianP' && c.repo === 'queens-report'),
    'all of them in the report repo, never in this one');
  ok(core.warnings.length === 0, 'nothing is warned about');
}

console.log('asks GitHub only for its own open issues');
{
  const { github, core, calls } = harness({ list: async () => [] });
  await closeOlderReports(github, core, TARGET, 9);
  ok(calls.list.length === 1, 'one listing');
  ok(calls.list[0].state === 'open', 'only open ones — closed reports are not closed again');
  ok(calls.list[0].labels === REPORT_LABEL, 'filtered by the report label server-side');
  ok(calls.list[0].per_page === 100, 'a full page, and via paginate, so a long backlog is not cut off');
}

// --- somebody else's issues stay open --------------------------------------
console.log('leaves everything that is not a report alone');
{
  const { github, core, calls } = harness({
    list: async () => [
      report(9),
      report(8),
      { number: 7, labels: [{ name: 'notiz' }] },            // hand-written note
      { number: 6, labels: [] },                             // no label at all
      { number: 5, labels: [{ name: REPORT_LABEL }], pull_request: { url: 'x' } }, // a PR
      { number: 4, labels: [REPORT_LABEL] },                 // label as a bare string
    ],
    update: async () => ({}),
  });
  const closed = await closeOlderReports(github, core, TARGET, 9);
  same(closed, [8, 4], 'only labelled issues close; a note, an unlabelled issue and a PR stay open');
}

console.log('the issue being kept is never closed, whatever else is in the list');
{
  const { github, core } = harness({ list: async () => [report(9)] });
  same(await closeOlderReports(github, core, TARGET, 9), [], 'a list holding only the new report closes nothing');
}

// --- failure must not fail the run -----------------------------------------
console.log('a failure warns and returns, it never throws');
{
  const { github, core } = harness({
    list: async () => { const e = new Error('Bad credentials'); e.status = 401; throw e; },
  });
  let threw = false;
  let closed = null;
  try { closed = await closeOlderReports(github, core, TARGET, 9); } catch { threw = true; }
  ok(!threw, 'a failing listing does not throw');
  same(closed, [], 'and reports nothing closed');
  ok(core.warnings.length === 1, 'it is warned about, not swallowed');
  ok(/angelegt/.test(core.warnings[0]), 'the warning says the report itself did land');
}
{
  // One bad close must not stop the others: next week would close them anyway,
  // but a half-done pass should still do the half it can.
  const { github, core } = harness({
    list: async () => [report(8), report(7), report(6)],
    update: async ({ issue_number }) => {
      if (issue_number === 7) { const e = new Error('nope'); e.status = 403; throw e; }
      return {};
    },
  });
  let threw = false;
  let closed = null;
  try { closed = await closeOlderReports(github, core, TARGET, 9); } catch { threw = true; }
  ok(!threw, 'one unclosable issue does not throw');
  same(closed, [8, 6], 'the others are still closed');
  ok(core.warnings.length === 1 && /#7/.test(core.warnings[0]), 'the one that failed is named');
}

// --- nothing leaks into the public log -------------------------------------
console.log('the log carries numbers, never titles');
{
  const src = readFileSync(`${root}/.github/scripts/close-older-reports.js`, 'utf8');
  ok(!/\.title/.test(src), 'the script never reads an issue title (this repo\'s run log is public)');
  ok(!/\.body/.test(src), 'and never an issue body');
}

// --- the wiring, read out of the workflow ----------------------------------
console.log('the workflow closes after creating, and still finds its state');
{
  const wf = readFileSync(`${root}/.github/workflows/weekly-report.yml`, 'utf8');
  const create = wf.indexOf('issues.create(');
  const close = wf.indexOf('closeOlderReports(github');
  ok(create > 0 && close > create,
    'closeOlderReports runs AFTER issues.create — closing first would close the week it keeps');
  ok(wf.includes('.github/scripts/close-older-reports.js'), 'the workflow requires this very file');
  ok(wf.includes('process.env.GITHUB_WORKSPACE'),
    'by absolute workspace path — a relative require resolves against the action, not the repo');

  // The label the workflow puts ON the new issue has to be the one this script
  // filters BY, or it would close nothing for ever and nobody would notice.
  ok(wf.includes(`labels: ['${REPORT_LABEL}']`), `the workflow labels new reports '${REPORT_LABEL}'`);

  // And the state lookup must keep reading closed issues too.
  const start = wf.indexOf('- name: Letzten Bericht suchen');
  const end = wf.indexOf('- name:', start + 1);
  const step = start >= 0 && end > start ? wf.slice(start, end) : '';
  ok(step.length > 0, 'there is a step named "Letzten Bericht suchen"');
  ok(/state:\s*'all'/.test(step),
    "it reads state: 'all' — on 'open' the marker would vanish with the close and reset the window");
  ok(/queens-report-state/.test(step), 'and it is the step that reads the window marker');
}

if (failed) {
  console.error('\nclose-older-reports: FAILED');
  process.exit(1);
}
console.log('\nclose-older-reports: all checks passed');
