// CLI-black-box-but-format-exempt assertions for results-contract
// (docs/engineering/e2e-ci/README.md §4.2 explicitly exempts this repo: format IS what
// it tests). Style follows docs/engineering/e2e-ci/verification.md: shell-literal
// commands via spawnSync, node:assert/strict, no test framework — one linear script that
// throws on the first broken contract.
//
// Four things get checked against the SAME real run, per docs/engineering/e2e-ci/report.md:
//   1. on-disk format        — snapshot.json / result.json / events.json / sources.json / o11y.json
//   2. openResults() parity  — the public read library is a faithful projection of #1
//   3. --json parity         — the CLI's machine summary agrees with #1/#2
//   4. --junit folding       — failed → <failure>, errored → <error>
// plus the README §4.3 CLI read-back (show / show --execution) on the real passed attempt.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { openResults } from "niceeval/results";

const RESULTS_ROOT = ".niceeval";
const LOCATOR_RE = /^@[0-9a-z]{8}$/;
const PROVIDER_FAULT_RE = /errored.*(429|5\d\d|ECONNREFUSED|ETIMEDOUT)/i;

/** Thrown only for the main Experiment's command — see e2e.ts's exit-code classification. */
export class InfraError extends Error {}

function sh(cmd: string, expect: number | "nonzero" = 0): string {
  const res = spawnSync(cmd, { shell: true, encoding: "utf8" });
  const exit = res.status ?? -1;
  const ok = expect === "nonzero" ? exit !== 0 : exit === expect;
  assert.ok(
    ok,
    `${cmd}\nexited ${exit}, expected ${expect}. stderr tail:\n${res.stderr.slice(-2000)}\nstdout tail:\n${res.stdout.slice(-2000)}`,
  );
  return res.stdout;
}

/**
 * Same as `sh` but for the one command that's expected to exit 0 (the real gateway
 * call): an unexpected nonzero exit here throws InfraError instead of a plain
 * AssertionError when --output ci's own text confirms a provider-side fault
 * (429/5xx/network) — the doc-specified confirmable-external-fault signal
 * (docs/engineering/e2e-ci/verification.md「失败分类」). Anything else stays a regression.
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

interface AssertionResultLike {
  outcome: "passed" | "failed" | "unavailable";
  score?: number;
}

interface AttemptRecordLike {
  id: string;
  verdict: "passed" | "failed" | "skipped" | "errored";
  durationMs: number;
  assertions: AssertionResultLike[];
  usage?: { inputTokens: number; outputTokens: number };
  estimatedCostUSD?: number;
  locator?: string;
  error?: unknown;
}

export async function runVerify(): Promise<void> {
  // ---------------------------------------------------------------------
  // Run the three Experiments as three separate invocations (keeps the
  // exit-code + --json reasoning scoped to one Experiment each).
  //
  // deliberate-fail / deliberate-error run FIRST, deliberately: they never call the real
  // gateway, so point 4's assertions below always execute regardless of whether the main
  // Experiment's real HTTP call succeeds — and a deliberately broken deliberate-fail/error
  // Eval (or a broken point-4 assertion) fails right here, before main ever runs, instead
  // of being masked by a later, unrelated main-experiment failure.
  // ---------------------------------------------------------------------
  sh("pnpm exec niceeval exp deliberate-fail --force --output ci --junit fail.xml", "nonzero");
  sh("pnpm exec niceeval exp deliberate-error --force --output ci --junit error.xml", "nonzero");

  // ---------------------------------------------------------------------
  // Point 4: JUnit folding — failed → <failure>, errored → <error>, mutually exclusive.
  // ---------------------------------------------------------------------
  const failXml = readFileSync("fail.xml", "utf8");
  assert.ok(failXml.includes("<failure"), "deliberate-fail's JUnit has no <failure> — failed verdict didn't fold correctly");
  assert.ok(!failXml.includes("<error"), "deliberate-fail's JUnit unexpectedly has an <error> — failed/errored folding isn't mutually exclusive");

  const errorXml = readFileSync("error.xml", "utf8");
  assert.ok(errorXml.includes("<error"), "deliberate-error's JUnit has no <error> — errored verdict didn't fold correctly");
  assert.ok(!errorXml.includes("<failure"), "deliberate-error's JUnit unexpectedly has a <failure> — errored got miscategorized as a failed assertion");

  // ---------------------------------------------------------------------
  // The real gateway call. Everything below this line (points 1-3 + CLI read-back)
  // needs the main Experiment to have actually passed.
  // ---------------------------------------------------------------------
  shExpectZero("pnpm exec niceeval exp main --force --output ci --json main.json --junit main.xml");

  // ---------------------------------------------------------------------
  // Point 1: on-disk format, read directly (this repo is exempt from the CLI-only rule).
  // ---------------------------------------------------------------------
  const expDir = join(RESULTS_ROOT, "main");
  assert.ok(existsSync(expDir), `${expDir} missing — the main Experiment produced no experiment directory`);
  const snapDir = singleSubdir(expDir, "main experiment directory after a single --force run");

  const snapshot = readJson<Record<string, unknown>>(join(snapDir, "snapshot.json"));
  assert.equal(snapshot.format, "niceeval.results", 'snapshot.json.format must be the literal string "niceeval.results"');
  assert.equal(typeof snapshot.schemaVersion, "number", "snapshot.json.schemaVersion must be a number");
  assert.equal((snapshot.producer as { name?: string } | undefined)?.name, "niceeval", 'snapshot.json.producer.name must be "niceeval" for the official writer');
  assert.equal(snapshot.experimentId, "main", "snapshot.json.experimentId must be the experiment id");
  assert.equal(snapshot.agent, "openai-compat", "snapshot.json.agent must be the Agent's name");
  assert.equal(snapshot.model, "deepseek-chat", "snapshot.json.model must be the experiment's model");
  assert.equal(typeof snapshot.startedAt, "string", "snapshot.json.startedAt must be an ISO string");
  for (const perAttemptField of ["attempts", "evals", "results"]) {
    assert.ok(
      !(perAttemptField in snapshot),
      `snapshot.json must carry no per-attempt data — found "${perAttemptField}" (architecture.md: 快照元数据...不含任何逐 attempt 数据)`,
    );
  }

  const evalDir = join(snapDir, "tool-call");
  const attemptDirNames = subdirNames(evalDir);
  assert.equal(
    attemptDirNames.length,
    2,
    `expected 2 attempt directories under ${evalDir} (runs:2, earlyExit:false), found ${attemptDirNames.length}: ${attemptDirNames.join(", ")}`,
  );

  const attemptRecords: AttemptRecordLike[] = [];
  const sourceShas = new Set<string>();
  let sharedSha: string | undefined;

  for (const name of attemptDirNames) {
    const attemptDir = join(evalDir, name);
    const result = readJson<AttemptRecordLike>(join(attemptDir, "result.json"));
    attemptRecords.push(result);

    assert.equal(result.id, "tool-call", `result.json.id mismatch in ${attemptDir}`);
    assert.ok(["passed", "failed", "skipped", "errored"].includes(result.verdict), `result.json.verdict "${result.verdict}" isn't one of the 4 documented states in ${attemptDir}`);
    assert.equal(result.verdict, "passed", `tool-call attempt in ${attemptDir} did not pass: ${JSON.stringify(result.error ?? result.assertions)}`);
    assert.equal(typeof result.durationMs, "number", `result.json.durationMs missing in ${attemptDir}`);

    assert.ok(Array.isArray(result.assertions) && result.assertions.length > 0, `result.json.assertions missing/empty in ${attemptDir}`);
    for (const a of result.assertions) {
      assert.ok(["passed", "failed", "unavailable"].includes(a.outcome), `assertion outcome "${a.outcome}" not one of passed/failed/unavailable in ${attemptDir}`);
      if (a.outcome !== "unavailable") {
        assert.equal(typeof a.score, "number", `assertion missing numeric score in ${attemptDir}: ${JSON.stringify(a)}`);
      }
    }

    // durationMs / usage / estimatedCostUSD trio: usage present ⇒ estimatedCostUSD present too.
    assert.ok(result.usage, `result.json.usage missing in ${attemptDir} — the real gateway call didn't report usage`);
    assert.equal(typeof result.usage!.inputTokens, "number", `usage.inputTokens missing in ${attemptDir}`);
    assert.equal(typeof result.usage!.outputTokens, "number", `usage.outputTokens missing in ${attemptDir}`);
    assert.equal(typeof result.estimatedCostUSD, "number", `estimatedCostUSD missing alongside usage in ${attemptDir} (architecture.md: durationMs/usage/estimatedCostUSD 三件套成组出现)`);
    assert.ok(result.estimatedCostUSD! > 0, `estimatedCostUSD should be > 0 in ${attemptDir}, got ${result.estimatedCostUSD}`);

    assert.ok(LOCATOR_RE.test(result.locator ?? ""), `result.json.locator "${result.locator}" doesn't match the @<scheme><7 base36 chars> shape in ${attemptDir}`);

    const events = readJson<{ type: string; name?: string; callId?: string; status?: string; role?: string }[]>(join(attemptDir, "events.json"));
    const called = events.find((e) => e.type === "action.called" && e.name === "get_stock_price");
    assert.ok(called, `events.json in ${attemptDir} has no action.called for get_stock_price`);
    const actionResult = events.find((e) => e.type === "action.result" && e.callId === called!.callId);
    assert.ok(actionResult, `events.json in ${attemptDir} has no action.result matching callId ${called!.callId}`);
    assert.equal(actionResult!.status, "completed", `action.result.status in ${attemptDir} should be "completed"`);
    assert.ok(events.some((e) => e.type === "message" && e.role === "assistant"), `events.json in ${attemptDir} has no assistant message event`);

    const sources = readJson<{ path: string; sha256: string }[]>(join(attemptDir, "sources.json"));
    assert.ok(Array.isArray(sources) && sources.length > 0, `sources.json missing/empty in ${attemptDir}`);
    const evalSource = sources.find((s) => s.path.includes("tool-call.eval"));
    assert.ok(evalSource, `sources.json in ${attemptDir} doesn't reference tool-call.eval.ts (entries: ${JSON.stringify(sources)})`);
    assert.ok(!("content" in (evalSource as unknown as Record<string, unknown>)), `sources.json entries must be references (path+sha256), not inlined content, in ${attemptDir}`);
    sourceShas.add(evalSource!.sha256);
    sharedSha = evalSource!.sha256;

    const o11y = readJson<{ totalToolCalls: number; usage?: unknown }>(join(attemptDir, "o11y.json"));
    assert.ok(o11y.totalToolCalls >= 1, `o11y.json.totalToolCalls should be >= 1 in ${attemptDir}, got ${o11y.totalToolCalls}`);
    assert.ok(o11y.usage, `o11y.json.usage missing in ${attemptDir}`);
  }

  // Both attempts of the same eval file must dedup to the SAME snapshot-level source blob.
  assert.equal(
    sourceShas.size,
    1,
    `the 2 attempts of tool-call reference ${sourceShas.size} distinct source sha256s — expected 1 (same eval file, snapshot-level dedup across attempts)`,
  );
  const blobPath = join(snapDir, "sources", `${sharedSha}.json`);
  assert.ok(existsSync(blobPath), `snapshot-level dedup repository missing ${blobPath} for the shared eval source`);
  const blob = readJson<{ content: string }>(blobPath);
  assert.ok(blob.content.includes("get_stock_price"), `sources/${sharedSha}.json content doesn't look like tool-call.eval.ts`);

  // ---------------------------------------------------------------------
  // Point 2: openResults() parity — faithful projection of point 1, not a second source of truth.
  // ---------------------------------------------------------------------
  const results = await openResults(RESULTS_ROOT);
  const exp = results.experiments.find((e) => e.id === "main");
  assert.ok(exp, 'openResults() has no experiment "main"');
  const snap = exp!.latest;
  assert.equal(snap.experimentId, snapshot.experimentId, "openResults() snapshot.experimentId disagrees with disk snapshot.json");
  assert.equal(snap.agent, snapshot.agent, "openResults() snapshot.agent disagrees with disk snapshot.json");
  assert.equal(snap.model, snapshot.model, "openResults() snapshot.model disagrees with disk snapshot.json");
  assert.equal(snap.schemaVersion, snapshot.schemaVersion, "openResults() schemaVersion disagrees with disk snapshot.json");

  const toolCallEval = snap.evals.find((e) => e.id === "tool-call");
  assert.ok(toolCallEval, 'openResults() snapshot has no eval "tool-call"');
  assert.equal(toolCallEval!.attempts.length, 2, `openResults() reports ${toolCallEval!.attempts.length} attempts for tool-call, disk has 2`);

  const diskByLocator = new Map(attemptRecords.map((r) => [r.locator, r]));
  for (const attempt of toolCallEval!.attempts) {
    const onDisk = diskByLocator.get(attempt.result.locator);
    assert.ok(onDisk, `openResults() attempt with locator ${attempt.result.locator} has no matching on-disk result.json`);
    assert.equal(attempt.result.verdict, onDisk!.verdict, "openResults() verdict disagrees with disk result.json");
    assert.equal(attempt.result.estimatedCostUSD, onDisk!.estimatedCostUSD, "openResults() estimatedCostUSD disagrees with disk result.json");
    assert.equal(attempt.result.usage?.inputTokens, onDisk!.usage!.inputTokens, "openResults() usage.inputTokens disagrees with disk result.json");
    assert.equal(attempt.result.usage?.outputTokens, onDisk!.usage!.outputTokens, "openResults() usage.outputTokens disagrees with disk result.json");

    const events = await attempt.events();
    assert.ok(events, "openResults() attempt.events() returned null for a fresh attempt that has events.json on disk");
    assert.ok(
      events!.some((e) => e.type === "action.called" && (e as { name?: string }).name === "get_stock_price"),
      "openResults() events() is missing the action.called seen on disk",
    );

    const sourceArtifacts = await attempt.sources();
    assert.ok(sourceArtifacts, "openResults() attempt.sources() returned null");
    assert.ok(
      sourceArtifacts!.some((s) => "content" in s && (s as { path: string }).path.includes("tool-call.eval")),
      "openResults() sources() should resolve the reference+blob into {path, content}[], not leave it as a raw reference",
    );

    const o11ySummary = await attempt.o11y();
    assert.ok(o11ySummary, "openResults() attempt.o11y() returned null despite o11y.json existing on disk");
  }

  // ---------------------------------------------------------------------
  // Point 3: --json parity — the CLI's machine summary agrees with disk + openResults().
  // ---------------------------------------------------------------------
  const jsonSummary = readJson<{
    agent: string;
    model?: string;
    passed: number;
    failed: number;
    errored: number;
    results: AttemptRecordLike[];
  }>("main.json");
  assert.equal(jsonSummary.agent, "openai-compat", "--json RunSummary.agent disagrees with the Agent's name");
  assert.equal(jsonSummary.model, "deepseek-chat", "--json RunSummary.model disagrees with the experiment's model");
  assert.equal(jsonSummary.passed, 2, "--json RunSummary.passed should count both tool-call attempts");
  assert.equal(jsonSummary.failed, 0, "--json RunSummary.failed should be 0 for the main Experiment");
  assert.equal(jsonSummary.errored, 0, "--json RunSummary.errored should be 0 for the main Experiment");
  assert.ok(Array.isArray(jsonSummary.results) && jsonSummary.results.length === 2, "--json RunSummary.results should have 2 entries (2 attempts)");

  for (const r of jsonSummary.results) {
    const onDisk = diskByLocator.get(r.locator);
    assert.ok(onDisk, `--json result with locator ${r.locator} has no matching on-disk result.json`);
    assert.equal(r.verdict, onDisk!.verdict, "--json verdict disagrees with disk result.json");
    assert.equal(r.estimatedCostUSD, onDisk!.estimatedCostUSD, "--json estimatedCostUSD disagrees with disk result.json");
  }

  // ---------------------------------------------------------------------
  // README §4.3 CLI read-back, on the real passed attempt.
  // ---------------------------------------------------------------------
  const locator = attemptRecords[0].locator!;
  const board = sh(`pnpm exec niceeval show ${locator}`);
  assert.ok(board.includes("tool-call"), "show @locator output doesn't mention the tool-call eval id");
  assert.ok(board.includes("passed"), "show @locator output doesn't show a passed verdict");

  const execution = sh(`pnpm exec niceeval show ${locator} --execution`);
  assert.ok(execution.includes("get_stock_price"), "show --execution is missing the get_stock_price call node — the tool call didn't reach the display layer");
}
