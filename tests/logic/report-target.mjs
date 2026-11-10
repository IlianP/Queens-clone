// Pure-Node test for .github/scripts/report-target.js — the guard that keeps
// the weekly report out of a public repository.
//
// The report carries player names and per-day device counts, and an issue once
// published is a one-way door. The workflow's own check only established that
// REPORT_REPO differs from this repository, which is NOT the same as private: a
// second public repo, or a repo later flipped to public, passed it. So the
// destination's visibility is asked at the destination, and the one thing this
// test exists for is that *not knowing* counts as not private — a 404 (repo
// gone, or the token lost access), any other HTTP error, and a response without
// a `private` field must all stop the run rather than fall through to the
// publish step.
//
// It also pins the wiring, read out of the workflow rather than restated: the
// guard has to run BEFORE issues.create in the same script, because a guard
// that sits after the write protects nothing.
//
// Run: node tests/logic/report-target.mjs

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const SCRIPT = `${root}/.github/scripts/report-target.js`;
const { assertPrivate } = require(SCRIPT);

let failed = false;
const ok = (cond, what) => {
  if (!cond) { failed = true; console.error(`  FAIL ${what}`); } else console.log(`  ok   ${what}`);
};

// A stand-in for actions/github-script's `core` and `github`, so nothing here
// needs the network or a token.
const spyCore = () => {
  const c = { failures: [], infos: [] };
  c.setFailed = (m) => c.failures.push(String(m));
  c.info = (m) => c.infos.push(String(m));
  return c;
};
const client = (get) => ({ rest: { repos: { get } } });
const httpError = (status) => async () => {
  const err = new Error(`HTTP ${status}`);
  err.status = status;
  throw err;
};
const unreachable = async () => { throw new Error('repos.get must not be called'); };

// Returns { refused, core, result } — `refused` is the property under test:
// the call threw AND said why, so the calling step fails.
const call = async (get, reportRepo) => {
  const core = spyCore();
  let threw = false;
  let result = null;
  try { result = await assertPrivate(client(get), core, reportRepo); } catch { threw = true; }
  return { refused: threw && core.failures.length > 0, core, result };
};

// --- the happy path ---------------------------------------------------------
console.log('a private destination is accepted');
{
  const seen = [];
  const get = async (args) => {
    seen.push(args);
    return { data: { private: true, visibility: 'private' } };
  };
  const { refused, core, result } = await call(get, 'IlianP/queens-report');
  ok(!refused, 'a private repo is not refused');
  ok(result && result.owner === 'IlianP' && result.repo === 'queens-report',
    'owner and repo come back split, so the caller cannot re-split them differently');
  ok(seen.length === 1 && seen[0].owner === 'IlianP' && seen[0].repo === 'queens-report',
    'the visibility is asked about exactly the repo named in REPORT_REPO');
  ok(core.failures.length === 0, 'nothing is reported as failed');
}

// --- a public destination ---------------------------------------------------
console.log('a public destination is refused');
{
  const { refused, core } = await call(async () => ({ data: { private: false, visibility: 'public' } }),
    'IlianP/queens-clone-reports');
  ok(refused, 'private: false stops the run');
  ok(/nicht privat/.test(core.failures[0]), 'the message says the repo is not private');
  ok(/IlianP\/queens-clone-reports/.test(core.failures[0]),
    'the message names the repo, so the fix is obvious from the log alone');
}

// --- not knowing is not a pass ----------------------------------------------
// This is the half that would rot silently: every one of these used to be
// "no check at all", and a `catch` that logged and continued would read as
// defensive while publishing the report anyway.
console.log('an unknown visibility is refused, every way it can be unknown');
for (const [what, get] of [
  ['404 — repo gone, or the token lost access to it', httpError(404)],
  ['403 — token present but not permitted', httpError(403)],
  ['500 — GitHub itself is unwell', httpError(500)],
  ['a thrown error with no status at all', async () => { throw new Error('socket hang up'); }],
  ['a 200 whose body has no private field', async () => ({ data: {} })],
  ['a 200 whose private field is a truthy string', async () => ({ data: { private: 'false' } })],
]) {
  const { refused } = await call(get, 'IlianP/queens-report');
  ok(refused, `refused: ${what}`);
}
{
  const { core } = await call(httpError(404), 'IlianP/queens-report');
  ok(/REPORT_GITHUB_TOKEN/.test(core.failures[0]),
    'the 404 message names the token, since "repo missing" and "no access" look identical from here');
}

// --- a malformed REPORT_REPO never reaches the API --------------------------
console.log('a malformed REPORT_REPO is refused without asking GitHub');
for (const value of ['', 'queens-report', '/', 'IlianP/', '/queens-report', undefined, null]) {
  const { refused } = await call(unreachable, value);
  ok(refused, `refused without an API call: ${JSON.stringify(value)}`);
}

// --- the wiring, read out of the workflow -----------------------------------
// Read rather than restated: the whole point is that the live workflow calls
// this, in the right order. A guard after the write protects nothing.
console.log('the workflow calls the guard, and calls it before writing');
{
  const wf = readFileSync(`${root}/.github/workflows/weekly-report.yml`, 'utf8');
  const calls = wf.match(/assertPrivate\(/g) || [];
  ok(calls.length >= 2,
    'the guard runs in its own early step AND again in the step that creates the issue');
  ok(wf.includes('.github/scripts/report-target.js'),
    'the workflow requires this very file (a rename must break the build, not the guard)');
  ok(wf.includes('process.env.GITHUB_WORKSPACE'),
    'it is required by absolute workspace path — a relative require resolves against the action, not the repo');

  const guard = wf.lastIndexOf('assertPrivate(');
  const create = wf.indexOf('issues.create(');
  ok(create > 0, 'the workflow still creates the issue (otherwise this test proves nothing)');
  ok(guard > 0 && guard < create, 'the last guard call sits before issues.create');

  // And the early step must not be gated on dry_run: a test run is exactly when
  // a misconfigured destination should surface.
  // Slice the step itself, from its own `- name:` to the next one. Not from the
  // bare title: the header comment mentions later step names, so an indexOf on
  // those matches the prose and silently yields an empty slice that passes.
  const start = wf.indexOf('- name: Zielrepository privat?');
  const end = wf.indexOf('- name:', start + 1);
  const step = start >= 0 && end > start ? wf.slice(start, end) : '';
  ok(step.length > 0, 'there is a step named "Zielrepository privat?" with a step after it');
  ok(!/\bif:/.test(step), 'the early step is unconditional, so dry_run checks the destination too');
  ok(/REPORT_GITHUB_TOKEN/.test(step), 'the early step authenticates with the reporting token');
}

if (failed) {
  console.error('\nreport-target: FAILED');
  process.exit(1);
}
console.log('\nreport-target: all checks passed');
