// Produces the ONE body of evidence every scripts/verify-<domain>.ts module in this repo
// asserts against (docs/engineering/testing/e2e/report.md: "一次真实运行产出的证据被下面
// 全部验收组共用,断言条数不增加模型成本"). Runs the three Experiments exactly once, exports
// a real static site once, and returns a structured `Evidence` object carrying every
// locator/path a verify-<domain>.ts module needs to make assertions — so new domains never
// re-run an Experiment or re-derive a locator by scanning `.niceeval/` themselves.
//
// This module only PRODUCES evidence and asserts the minimum structural shape needed to
// type it (attempt-directory counts, locator format). It does not judge the evidence against
// report.md's format/rendering/read-back contract — that's each verify-<domain>.ts's job,
// reading the paths/locators handed back here.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { sh } from "./sh.ts";

const RESULTS_ROOT = ".niceeval";
const SITE_EXPORT_DIR = "site-export";
const LOCATOR_RE = /^@[0-9a-z]{8}$/;
const PROVIDER_FAULT_RE = /errored.*(429|5\d\d|ECONNREFUSED|ETIMEDOUT)/i;

/** Thrown only for the main Experiment's real gateway call — see scripts/e2e.ts's exit-code classification. */
export class InfraError extends Error {}

export type Verdict = "passed" | "failed" | "skipped" | "errored";

/** One attempt's coordinates — enough to run `niceeval show @<locator> ...` or read its files directly. */
export interface AttemptEvidence {
  /** Eval id this attempt belongs to (e.g. "tool-call", "deliberate-fail", "deliberate-error"). */
  evalId: string;
  /** This attempt's real verdict, as produced by this run — read off disk, not assumed. */
  verdict: Verdict;
  /** Opaque `@<locator>` string, ready to use in `niceeval show @<locator>`, `--exp`, etc. */
  locator: string;
  /** Attempt directory holding this attempt's result.json/events.json/sources.json/o11y.json, relative to repo root (cwd when scripts run). */
  attemptDir: string;
}

/** Structured evidence for one of this repo's three Experiments. */
export interface Evidence {
  /** Results root all three Experiments share — pass to `openResults()` or `--results`. Relative to repo root; scripts run with cwd = repo root. */
  resultsRoot: string;
  /** `niceeval view --out` export directory for this same run — real static site, shared by the rendering/CLI-readback domains. Relative to repo root. */
  siteExportDir: string;
  /** main: `runs: 2` real gateway attempts of "tool-call", both expected passed. */
  main: {
    id: "main";
    evalId: "tool-call";
    /** This run's snapshot directory, `.niceeval/main/<timestamp-suffix>/`. */
    snapshotDir: string;
    /** Both real attempts (length 2). */
    attempts: AttemptEvidence[];
  };
  /** deliberate-fail: exactly 1 deterministic failed attempt. */
  deliberateFail: {
    id: "deliberate-fail";
    evalId: "deliberate-fail";
    snapshotDir: string;
    attempt: AttemptEvidence;
  };
  /** deliberate-error: exactly 1 deterministic errored attempt. */
  deliberateError: {
    id: "deliberate-error";
    evalId: "deliberate-error";
    snapshotDir: string;
    attempt: AttemptEvidence;
  };
  /** JUnit files from each Experiment invocation, relative to repo root. */
  junit: { main: string; fail: string; error: string };
  /** `--json` machine summary path from the main Experiment's invocation, relative to repo root. */
  jsonSummaryPath: string;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/** Exactly one subdirectory expected (e.g. the single snapshot dir after one --force run). Never hardcode the timestamp+suffix name. */
function singleSubdir(dir: string, context: string): string {
  const names = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
  assert.equal(names.length, 1, `expected exactly one directory under ${dir} (${context}), found ${names.length}: ${names.join(", ")}`);
  return join(dir, names[0]);
}

function subdirNames(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

/**
 * Same as `sh` but for the one command that's expected to exit 0 (the real gateway call):
 * an unexpected nonzero exit here throws InfraError instead of a plain AssertionError when
 * `--output ci`'s own text confirms a provider-side fault (429/5xx/network) — the
 * doc-specified confirmable-external-fault signal
 * (docs/engineering/testing/e2e/verification.md「失败分类」). Anything else stays a regression.
 */
function shExpectZero(cmd: string): string {
  const res = spawnSync(cmd, { shell: true, encoding: "utf8" });
  const exit = res.status ?? -1;
  if (exit === 0) return res.stdout;
  const combined = `${res.stdout}\n${res.stderr}`;
  if (PROVIDER_FAULT_RE.test(combined)) {
    throw new InfraError(`${cmd} exited ${exit} with a provider-side fault visible in --output ci text:\n${combined.slice(-3000)}`);
  }
  throw new Error(`${cmd}\nexited ${exit}, expected 0. stdout/stderr tail:\n${combined.slice(-3000)}`);
}

/** Reads back one Experiment's single-attempt result (deliberate-fail / deliberate-error shape). */
function readSingleAttempt(experimentId: string, evalId: string): { snapshotDir: string; attempt: AttemptEvidence } {
  const expDir = join(RESULTS_ROOT, experimentId);
  assert.ok(existsSync(expDir), `${expDir} missing — the ${experimentId} Experiment produced no experiment directory`);
  const snapshotDir = singleSubdir(expDir, `${experimentId} experiment directory after a single --force run`);
  const evalDir = join(snapshotDir, evalId);
  const attemptDirNames = subdirNames(evalDir);
  assert.equal(attemptDirNames.length, 1, `expected exactly 1 attempt directory under ${evalDir}, found ${attemptDirNames.length}: ${attemptDirNames.join(", ")}`);
  const attemptDir = join(evalDir, attemptDirNames[0]!);
  const result = readJson<{ verdict: Verdict; locator?: string }>(join(attemptDir, "result.json"));
  assert.ok(LOCATOR_RE.test(result.locator ?? ""), `result.json.locator "${result.locator}" in ${attemptDir} doesn't match the @<7 base36 chars> shape`);
  return { snapshotDir, attempt: { evalId, verdict: result.verdict, locator: result.locator!, attemptDir } };
}

/**
 * Runs this repo's three Experiments exactly once, exports a static site of the combined
 * result, and returns the coordinates every verify-<domain>.ts module needs.
 */
export async function produceEvidence(): Promise<Evidence> {
  // ---------------------------------------------------------------------
  // deliberate-fail / deliberate-error run FIRST, deliberately: they never call the real
  // gateway, so the evidence they produce is available regardless of whether the main
  // Experiment's real HTTP call succeeds — a deliberately broken deliberate-fail/error Eval
  // fails right here, before main ever runs, instead of being masked by a later, unrelated
  // main-experiment failure.
  // ---------------------------------------------------------------------
  sh("pnpm exec niceeval exp deliberate-fail --force --output ci --junit fail.xml", "nonzero");
  sh("pnpm exec niceeval exp deliberate-error --force --output ci --junit error.xml", "nonzero");

  // ---------------------------------------------------------------------
  // The real gateway call, last.
  // ---------------------------------------------------------------------
  shExpectZero("pnpm exec niceeval exp main --force --output ci --json main.json --junit main.xml");

  const deliberateFail = readSingleAttempt("deliberate-fail", "deliberate-fail");
  const deliberateError = readSingleAttempt("deliberate-error", "deliberate-error");

  const mainExpDir = join(RESULTS_ROOT, "main");
  assert.ok(existsSync(mainExpDir), `${mainExpDir} missing — the main Experiment produced no experiment directory`);
  const mainSnapshotDir = singleSubdir(mainExpDir, "main experiment directory after a single --force run");
  const mainEvalDir = join(mainSnapshotDir, "tool-call");
  const mainAttemptDirNames = subdirNames(mainEvalDir);
  assert.equal(
    mainAttemptDirNames.length,
    2,
    `expected 2 attempt directories under ${mainEvalDir} (runs:2, earlyExit:false), found ${mainAttemptDirNames.length}: ${mainAttemptDirNames.join(", ")}`,
  );
  const mainAttempts: AttemptEvidence[] = mainAttemptDirNames.map((name) => {
    const attemptDir = join(mainEvalDir, name);
    const result = readJson<{ verdict: Verdict; locator?: string }>(join(attemptDir, "result.json"));
    assert.ok(LOCATOR_RE.test(result.locator ?? ""), `result.json.locator "${result.locator}" in ${attemptDir} doesn't match the @<7 base36 chars> shape`);
    return { evalId: "tool-call", verdict: result.verdict, locator: result.locator!, attemptDir };
  });

  // ---------------------------------------------------------------------
  // All three Experiments have run and now coexist under RESULTS_ROOT (passed/failed/errored).
  // Export a static site of the combined result once, shared by every rendering/CLI-readback
  // verify-<domain>.ts module — no domain re-exports its own site.
  // ---------------------------------------------------------------------
  sh(`pnpm exec niceeval view --out ${SITE_EXPORT_DIR}`);

  return {
    resultsRoot: RESULTS_ROOT,
    siteExportDir: SITE_EXPORT_DIR,
    main: { id: "main", evalId: "tool-call", snapshotDir: mainSnapshotDir, attempts: mainAttempts },
    deliberateFail: { id: "deliberate-fail", evalId: "deliberate-fail", snapshotDir: deliberateFail.snapshotDir, attempt: deliberateFail.attempt },
    deliberateError: { id: "deliberate-error", evalId: "deliberate-error", snapshotDir: deliberateError.snapshotDir, attempt: deliberateError.attempt },
    junit: { main: "main.xml", fail: "fail.xml", error: "error.xml" },
    jsonSummaryPath: "main.json",
  };
}
